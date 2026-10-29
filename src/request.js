// EB Sessions: the read-only request layer, as EBS.request.
//
// Sherin's rule: never one request per row. A screen gets its data from one
// bulk request; a single item is fetched only after the user clicked it.
//
//   await EBS.request.bulk('archive:folders', '/api/folder/list')
//   await EBS.request.item(`archive:file:${id}`, `/api/folder/${id}`, { userAction: true })
//
// The rules, enforced here for every feature together:
//   - GET only. Any other method, or a body, is refused.
//   - Same origin only, and only on e-Boekhouden's app hosts (secure*).
//   - bulk(): one request per key per screen. The answer is cached for 60 s
//     (memory of this page only, so a session switch, which reloads the
//     tabs, never shows another administration's data), and the same key
//     while a request runs shares that request. Asked again on the same
//     screen (the same URL), it gets that screen's answer again without a
//     request, until the user clicks (or presses Enter or Space) or the
//     screen changes; after a failure it is refused ('repeat') until then.
//     So a timer or a loop cannot poll.
//   - item(): refused without { userAction: true }, and needs a real click
//     or Enter/Space of the user before it: one network request per click.
//   - At most 2 requests at a time and 20 per minute, counted in this frame
//     and, through the service worker (src/bg/requests.js), over every frame
//     and tab together. More wait in a queue of at most 20 per frame; beyond
//     that a call fails with code 'rate'.
//   - After a failure (network, HTTP error, 429) the next request waits:
//     2 s, then 4, 8 and so on up to 5 minutes, or what Retry-After says; a
//     429 or 503 pauses every frame. Nothing is retried on its own, and there
//     is no polling helper.
//   - abort(key), abortAll() and leaving the page cancel what is running.
//
// options: as ('json', the default, or 'text'), mode ('isolated', the
// default: the content script's own fetch with the page's cookies; or
// 'main': the page's own fetch through the bridge, so whatever auth the page
// adds to its fetch applies), ttl (ms, at most 60 s), signal (AbortSignal).
// bulk() and item() always return a promise; every error is a rejection with
// an EBS.request.RequestError (a TypeError for a wrong option) with a code:
// 'method', 'origin', 'user-action', 'key', 'rate', 'repeat', 'abort',
// 'network', 'http', 'redirected', 'parse', 'unavailable'. Nothing here
// reads, stores or logs a token.

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
  let wakeAt = Infinity;
  let sequence = 0;
  // The last trusted click (or Enter/Space) and whether an item used it.
  const click = { at: -Infinity, used: true };
  // Trusted clicks and keys so far, and per bulk key the screen it was
  // fetched on: { screen, actions, ok, value }.
  let userActions = 0;
  const screens = new Map();
  let lastScreen = null;
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

  // One timer, for the earliest moment something may start.
  function schedule(delay) {
    const at = now() + Math.max(0, delay);
    if (wake !== null && wakeAt <= at) return;
    if (wake !== null) root.clearTimeout(wake);
    wakeAt = at;
    wake = root.setTimeout(() => {
      wake = null;
      wakeAt = Infinity;
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
    if (job.kind === 'bulk') {
      // An aborted request got nothing: the screen may ask again.
      if (error?.code === 'abort') {
        if (screens.get(job.cacheKey)?.job === job.id) screens.delete(job.cacheKey);
      } else {
        screens.set(job.cacheKey, { job: job.id, screen: job.screen, actions: job.actions, ok: !error, value: error ? undefined : value });
      }
    }
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

  // ---------------------------------------------------------------------------
  // The budget of every frame and tab together, kept by the service worker.
  // ---------------------------------------------------------------------------

  async function globalSlot() {
    let answer;
    try {
      answer = await root.chrome.runtime.sendMessage({ type: 'requests:slot' });
    } catch {
      throw new RequestError('unavailable', 'EBS.request: the extension did not answer; reload the page');
    }
    if (answer?.ok === true && typeof answer.lease === 'string') return { ok: true, lease: answer.lease };
    if (answer?.ok === false && Number.isFinite(answer.waitMs)) return { ok: false, waitMs: Math.min(Math.max(answer.waitMs, 0), BACKOFF_MAX_MS) };
    throw new RequestError('unavailable', 'EBS.request: no answer from the request budget');
  }

  function release(lease, status, retryAfter) {
    try {
      root.chrome.runtime.sendMessage({ type: 'requests:done', lease, status, retryAfterMs: retryAfter }).catch(() => {});
    } catch { /* an orphaned script: its lease runs out by itself */ }
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
    job.state = 'running';
    let grant;
    try {
      grant = await globalSlot();
    } catch (caught) {
      active -= 1;
      settle(job, job.aborted ? new RequestError('abort', 'EBS.request: aborted') : caught);
      pump();
      return;
    }
    if (!grant.ok || job.aborted) {
      active -= 1;
      if (grant.ok) release(grant.lease, null, null);
      if (job.aborted) {
        settle(job, new RequestError('abort', 'EBS.request: aborted'));
        pump();
      } else {
        // Other frames or tabs used the budget: back in its place, later.
        job.state = 'queued';
        requeue(job);
        schedule(grant.waitMs);
      }
      return;
    }
    started.push(now());
    let value;
    let error = null;
    let status = null;
    let retryAfter = null;
    try {
      const response = job.mode === 'main' ? await fetchMain(job) : await fetchIsolated(job);
      status = response.status;
      retryAfter = retryAfterMs(response.retryAfter);
      if (response.redirected) {
        // A data URL that redirects is a login or error page, not data.
        error = new RequestError('redirected', 'EBS.request: the server redirected', { status: response.status });
      } else if (!response.ok) {
        error = new RequestError('http', `EBS.request: HTTP ${response.status}`, { status: response.status });
        backoff(response.status === 429 || response.status === 503 ? retryAfter : null);
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
    release(grant.lease, status, retryAfter);
    settle(job, error, value);
    pump();
  }

  // Items before bulk loads, each in the order it came; a job that has to
  // wait again goes back to where it was.
  function requeue(job) {
    const rank = (one) => (one.kind === 'item' ? 0 : 1);
    const at = queue.findIndex((one) => rank(one) > rank(job) || (rank(one) === rank(job) && one.id > job.id));
    if (at < 0) queue.push(job);
    else queue.splice(at, 0, job);
  }

  // The screen is the page's URL: e-Boekhouden changes it for every screen.
  function screenOf() {
    return root.location.href;
  }

  function request(kind, key, url, options = {}) {
    try {
      return start(kind, key, url, options);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function start(kind, key, url, options) {
    checkKey(key);
    const settings = checkOptions(options);
    if (kind === 'item' && options.userAction !== true) {
      throw new RequestError('user-action', 'EBS.request.item: only after a click of the user, with { userAction: true }');
    }
    const href = checkUrl(url);
    const cacheKey = `${settings.mode} ${settings.as} ${key} ${href}`;
    if (settings.signal?.aborted) throw new RequestError('abort', 'EBS.request: aborted');

    const cached = cache.get(cacheKey);
    if (cached && cached.expires > now()) return Promise.resolve(copy(cached.value));
    if (cached) cache.delete(cacheKey);

    const running = [...jobs.values()].find((job) => job.cacheKey === cacheKey && !job.aborted);
    if (running) return addWaiter(running, settings.signal);

    const screen = screenOf();
    if (screen !== lastScreen) {
      // A new screen: what the old ones got is not needed any more.
      for (const [cacheKeyOf, seen] of [...screens]) {
        if (seen.screen !== screen) screens.delete(cacheKeyOf);
      }
      lastScreen = screen;
    }
    if (kind === 'bulk') {
      const seen = screens.get(cacheKey);
      if (seen && seen.screen === screen && seen.actions === userActions) {
        if (seen.ok) return Promise.resolve(copy(seen.value));
        throw new RequestError('repeat', 'EBS.request.bulk: this screen asked already; again after a click of the user');
      }
    }

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
      id: sequence, kind, key, url: href, cacheKey, as: settings.as, mode: settings.mode, ttl: settings.ttl,
      screen, actions: userActions,
      state: 'queued', aborted: false, controller: new AbortController(), waiters: new Set(),
    };
    jobs.set(job.id, job);
    const promise = addWaiter(job, settings.signal);
    // An item answers a click: it goes before the bulk loads that wait.
    requeue(job);
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
    // A held key repeats keydown: that is still one action.
    if (event.type === 'keydown' && ((event.key !== 'Enter' && event.key !== ' ') || event.repeat)) return;
    click.at = now();
    click.used = false;
    userActions += 1;
  }

  if (typeof root.addEventListener === 'function') {
    root.addEventListener('click', onUserAction, true);
    root.addEventListener('keydown', onUserAction, true);
    // Leaving the page: nothing may keep running for a page that is gone.
    root.addEventListener('pagehide', () => {
      abortAll();
      cache.clear();
      screens.clear();
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
