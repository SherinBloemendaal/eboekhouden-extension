// EB Sessions: the read-only request layer, as EBS.request.
//
// Sherin's rule: never one request per row. A screen gets its data from one
// bulk request; a single item is fetched only after the user clicked it.
//
//   await EBS.request.bulk('archive:folders', '/api/folder/list')
//   await EBS.request.item(`archive:file:${id}`, `/api/folder/${id}`, { userAction: true })
//
// The rules, enforced here for every feature together (one budget per frame):
//   - GET only. Any other method, or a body, throws.
//   - Same origin only, and only on e-Boekhouden's app hosts (secure*).
//   - bulk(): cached for 60 s (memory of this page only, so a session switch,
//     which reloads the tabs, never shows another administration's data);
//     the same key while a request runs shares that request.
//   - item(): throws without { userAction: true }, and needs a real click or
//     Enter/Space of the user before it: one network request per click.
//   - At most 2 requests at a time and 20 per minute; more wait in a queue of
//     at most 20, and beyond that a call fails with code 'rate'.
//   - After a failure (network, HTTP error, 429) the next request waits:
//     2 s, then 4, 8 and so on up to 5 minutes, or what Retry-After says.
//     Nothing is retried on its own, and there is no polling helper.
//   - abort(key), abortAll() and leaving the page cancel what is running.
//
// options: as ('json', the default, or 'text'), mode ('isolated', the
// default: the content script's own fetch with the page's cookies; or
// 'main': the page's own fetch through the bridge, so whatever auth the page
// adds to its fetch applies), ttl (ms, at most 60 s), signal (AbortSignal).
// Errors are EBS.request.RequestError with a code: 'method', 'origin',
// 'user-action', 'key', 'rate', 'abort', 'network', 'http', 'redirected',
// 'parse', 'unavailable'. Nothing here reads, stores or logs a token.

(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const { EBS } = root;
  if (!EBS || EBS.request) return;

  const TTL_MS = 60_000;
  const MAX_CONCURRENT = 2;
  const RATE_LIMIT = 20;
  const RATE_WINDOW_MS = 60_000;
  const MAX_QUEUE = 20;
  const BACKOFF_BASE_MS = 2_000;
  const BACKOFF_MAX_MS = 5 * 60_000;
  const CLICK_WINDOW_MS = 10_000;
  const APP_HOST = /^secure\d*\.e-boekhouden\.nl$/;

  class RequestError extends Error {
    constructor(code, message, details = {}) {
      super(message);
      this.name = 'RequestError';
      this.code = code;
      this.status = details.status ?? null;
    }
  }

  const cache = new Map();
  const jobs = new Map();
  const queue = [];
  const started = [];
  let active = 0;
  let failures = 0;
  let blockedUntil = 0;
  let wake = null;
  let sequence = 0;
  // The last trusted click (or Enter/Space) and whether an item used it.
  const click = { at: -Infinity, used: true };
  let mainRequest = null;
  let mainEnabled = false;

  function now() {
    return Date.now();
  }

  // Throws for anything but a same-origin https URL on an app host.
  function checkUrl(url) {
    let parsed;
    try {
      parsed = new URL(String(url), root.location.href);
    } catch {
      throw new RequestError('origin', 'EBS.request: not a URL');
    }
    if (parsed.protocol !== 'https:' || parsed.origin !== root.location.origin || !APP_HOST.test(parsed.hostname)) {
      throw new RequestError('origin', 'EBS.request: only same-origin e-Boekhouden URLs');
    }
    return parsed.href;
  }

  function checkOptions(options) {
    if (options === null || typeof options !== 'object') throw new TypeError('EBS.request: options must be an object');
    if (options.method !== undefined && String(options.method).toUpperCase() !== 'GET') {
      throw new RequestError('method', 'EBS.request: GET only');
    }
    if (options.body !== undefined) throw new RequestError('method', 'EBS.request: GET only, no body');
    if (options.as !== undefined && options.as !== 'json' && options.as !== 'text') throw new TypeError('EBS.request: as must be json or text');
    if (options.mode !== undefined && options.mode !== 'isolated' && options.mode !== 'main') throw new TypeError('EBS.request: mode must be isolated or main');
    const ttl = options.ttl === undefined ? TTL_MS : Number(options.ttl);
    if (!Number.isFinite(ttl) || ttl < 0) throw new TypeError('EBS.request: ttl must be a number of ms');
    return { as: options.as ?? 'json', mode: options.mode ?? 'isolated', ttl: Math.min(ttl, TTL_MS), signal: options.signal ?? null };
  }

  function checkKey(key) {
    if (typeof key !== 'string' || !key || key.length > 200) throw new RequestError('key', 'EBS.request: a key is a short string');
    return key;
  }

  // Answers are parsed JSON or text, so a JSON copy is exact: each caller
  // gets its own and cannot change what another one got.
  function copy(value) {
    return value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
  }

  // ---------------------------------------------------------------------------
  // Scheduling
  // ---------------------------------------------------------------------------

  function schedule(delay) {
    if (wake !== null) root.clearTimeout(wake);
    wake = root.setTimeout(() => {
      wake = null;
      pump();
    }, Math.max(0, delay));
  }

  function pump() {
    while (queue.length && active < MAX_CONCURRENT) {
      const time = now();
      while (started.length && time - started[0] >= RATE_WINDOW_MS) started.shift();
      if (time < blockedUntil) {
        schedule(blockedUntil - time);
        return;
      }
      if (started.length >= RATE_LIMIT) {
        schedule(started[0] + RATE_WINDOW_MS - time);
        return;
      }
      run(queue.shift());
    }
  }

  function backoff(retryAfter) {
    failures += 1;
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
    blockedUntil = Math.max(blockedUntil, now() + Math.max(delay, Math.min(retryAfter ?? 0, BACKOFF_MAX_MS)));
  }

  function retryAfterMs(value) {
    if (!value) return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds)) return seconds * 1000;
    const date = Date.parse(value);
    return Number.isFinite(date) ? date - now() : null;
  }

  // ---------------------------------------------------------------------------
  // One job per key and URL; every caller is a waiter on it.
  // ---------------------------------------------------------------------------

  function settle(job, error, value) {
    jobs.delete(job.id);
    for (const waiter of job.waiters) {
      waiter.detach();
      if (error) waiter.reject(error);
      else waiter.resolve(copy(value));
    }
    job.waiters.clear();
  }

  function addWaiter(job, signal) {
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, detach: () => {} };
      if (signal) {
        if (signal.aborted) {
          reject(new RequestError('abort', 'EBS.request: aborted'));
          return;
        }
        const onAbort = () => {
          job.waiters.delete(waiter);
          reject(new RequestError('abort', 'EBS.request: aborted'));
          // Nobody waits any more: stop the request itself too.
          if (!job.waiters.size) cancel(job);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        waiter.detach = () => signal.removeEventListener('abort', onAbort);
      }
      job.waiters.add(waiter);
    });
  }

  function cancel(job) {
    if (job.state === 'queued') {
      const at = queue.indexOf(job);
      if (at >= 0) queue.splice(at, 1);
      settle(job, new RequestError('abort', 'EBS.request: aborted'));
      return;
    }
    if (job.state === 'running') {
      job.aborted = true;
      job.controller.abort();
      if (job.mode === 'main') mainRequest?.abort(job.id);
    }
  }

  async function fetchIsolated(job) {
    const response = await root.fetch(job.url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: job.as === 'json' ? 'application/json' : '*/*' },
      signal: job.controller.signal,
    });
    return {
      status: response.status,
      ok: response.ok,
      redirected: response.redirected,
      retryAfter: response.headers.get('retry-after') ?? '',
      text: await response.text(),
    };
  }

  async function fetchMain(job) {
    if (!mainRequest) throw new RequestError('unavailable', 'EBS.request: the page bridge is not there');
    if (!(await EBS.bridge.ready())) throw new RequestError('unavailable', 'EBS.request: the page bridge did not answer');
    if (!mainEnabled) {
      mainRequest.enable();
      mainEnabled = true;
    }
    let answer;
    try {
      answer = await mainRequest.get({ id: job.id, url: job.url, accept: job.as === 'json' ? 'application/json' : '*/*' }, { signal: job.controller.signal });
    } catch (error) {
      if (job.aborted || error?.name === 'AbortError' || error?.message === 'abort') throw new DOMException('Aborted', 'AbortError');
      throw new RequestError('network', `EBS.request: ${error?.message ?? 'page request failed'}`);
    }
    // From the page's world: check the shape before using it.
    if (!answer || !Number.isInteger(answer.status) || typeof answer.text !== 'string') {
      throw new RequestError('network', 'EBS.request: the page answered something else');
    }
    return {
      status: answer.status,
      ok: answer.ok === true,
      redirected: answer.redirected === true,
      retryAfter: typeof answer.retryAfter === 'string' ? answer.retryAfter : '',
      text: answer.text,
    };
  }

  async function run(job) {
    active += 1;
    started.push(now());
    job.state = 'running';
    let value;
    let error = null;
    try {
      const response = job.mode === 'main' ? await fetchMain(job) : await fetchIsolated(job);
      if (response.redirected) {
        // A data URL that redirects is a login or error page, not data.
        error = new RequestError('redirected', 'EBS.request: the server redirected', { status: response.status });
      } else if (!response.ok) {
        error = new RequestError('http', `EBS.request: HTTP ${response.status}`, { status: response.status });
        backoff(response.status === 429 || response.status === 503 ? retryAfterMs(response.retryAfter) : null);
      } else if (job.as === 'json') {
        try {
          value = response.text.trim() ? JSON.parse(response.text) : null;
        } catch {
          error = new RequestError('parse', 'EBS.request: the answer is not JSON', { status: response.status });
        }
      } else {
        value = response.text;
      }
      if (!error) {
        failures = 0;
        blockedUntil = 0;
        if (job.ttl > 0) cache.set(job.cacheKey, { key: job.key, value, expires: now() + job.ttl });
      }
    } catch (caught) {
      if (job.aborted || caught?.name === 'AbortError') {
        error = new RequestError('abort', 'EBS.request: aborted');
      } else {
        error = caught instanceof RequestError ? caught : new RequestError('network', 'EBS.request: the request failed');
        if (error.code !== 'unavailable') backoff(null);
      }
    }
    active -= 1;
    settle(job, error, value);
    pump();
  }

  function request(kind, key, url, options = {}) {
    checkKey(key);
    const settings = checkOptions(options);
    if (kind === 'item' && options.userAction !== true) {
      throw new RequestError('user-action', 'EBS.request.item: only after a click of the user, with { userAction: true }');
    }
    const href = checkUrl(url);
    const cacheKey = `${settings.mode} ${settings.as} ${key} ${href}`;

    const cached = cache.get(cacheKey);
    if (cached && cached.expires > now()) return Promise.resolve(copy(cached.value));
    if (cached) cache.delete(cacheKey);

    const running = [...jobs.values()].find((job) => job.cacheKey === cacheKey);
    if (running) return addWaiter(running, settings.signal);

    if (kind === 'item') {
      // One network request per click: a loop over rows in one click handler
      // gets the first item and an error for the rest.
      if (click.used || now() - click.at > CLICK_WINDOW_MS) {
        throw new RequestError('user-action', 'EBS.request.item: one item per click of the user');
      }
      click.used = true;
    }
    if (queue.length >= MAX_QUEUE) return Promise.reject(new RequestError('rate', 'EBS.request: too many requests waiting'));

    sequence += 1;
    const job = {
      id: sequence, key, url: href, cacheKey, as: settings.as, mode: settings.mode, ttl: settings.ttl,
      state: 'queued', aborted: false, controller: new AbortController(), waiters: new Set(),
    };
    jobs.set(job.id, job);
    const promise = addWaiter(job, settings.signal);
    // An item answers a click: it goes before the bulk loads that wait.
    if (kind === 'item') queue.unshift(job);
    else queue.push(job);
    pump();
    return promise;
  }

  function abort(key) {
    for (const job of [...jobs.values()]) {
      if (job.key === key) cancel(job);
    }
  }

  function abortAll() {
    for (const job of [...jobs.values()]) cancel(job);
  }

  // A trusted event comes from the user, never from a page script.
  function onUserAction(event) {
    if (!event.isTrusted) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    click.at = now();
    click.used = false;
  }

  if (typeof root.addEventListener === 'function') {
    root.addEventListener('click', onUserAction, true);
    root.addEventListener('keydown', onUserAction, true);
    // Leaving the page: nothing may keep running for a page that is gone.
    root.addEventListener('pagehide', () => {
      abortAll();
      cache.clear();
    });
  }

  if (EBS.bridge) mainRequest = EBS.bridge.claimRequest();

  EBS.define('request', Object.freeze({
    bulk: (key, url, options) => request('bulk', key, url, options),
    item: (key, url, options) => request('item', key, url, options),
    abort,
    abortAll,
    // Drops cached answers: all, or those of one key.
    clear(key) {
      for (const [cacheKey, entry] of [...cache.entries()]) {
        if (key === undefined || entry.key === key) cache.delete(cacheKey);
      }
    },
    stats() {
      const time = now();
      return {
        active,
        queued: queue.length,
        cached: [...cache.values()].filter((entry) => entry.expires > time).length,
        startedLastMinute: started.filter((at) => time - at < RATE_WINDOW_MS).length,
        waitMs: Math.max(0, blockedUntil - time),
      };
    },
    RequestError,
    limits: Object.freeze({ ttlMs: TTL_MS, concurrent: MAX_CONCURRENT, perMinute: RATE_LIMIT, queue: MAX_QUEUE }),
  }));
})();
