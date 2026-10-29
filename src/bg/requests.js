// Service worker part of the request rules: one budget for every frame and
// tab together. EBS.request (src/request.js) keeps the limits in each frame
// as well, and asks here before every request it sends:
//
//   requests:slot  -> { ok: true, lease } or { ok: false, waitMs }
//   requests:done  { lease, status, retryAfterMs } -> {}
//
// At most 2 requests at a time and 20 per minute over all of e-Boekhouden's
// frames and tabs: a dialog frame or a second tab gets no budget of its own.
// After a 429 or 503 every frame waits as long as Retry-After says (2 s at
// least, 5 minutes at most). A lease that never comes back (a tab closed
// mid-request) is free again after 60 s. The minute's starts and the pause
// are kept in chrome.storage.session, so a restart of this worker does not
// reset them. Nothing here sends a request itself.

const CONCURRENT = 2;
const PER_MINUTE = 20;
const WINDOW_MS = 60_000;
const LEASE_MS = 60_000;
const PAUSE_MIN_MS = 2_000;
const PAUSE_MAX_MS = 5 * 60_000;
// When both slots are taken: ask again this much later.
const BUSY_RETRY_MS = 250;
const STATE_KEY = 'requestBudget';

export function createBudget({ now = () => Date.now(), area = globalThis.chrome?.storage?.session } = {}) {
  const leases = new Map();
  let state = null;
  let sequence = 0;
  let queue = Promise.resolve();

  // One step at a time: a slot is counted before the next one is decided.
  function chain(task) {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  }

  async function load() {
    if (state) return state;
    let stored = null;
    try {
      ({ [STATE_KEY]: stored = null } = await area.get(STATE_KEY));
    } catch (error) {
      console.warn('EB Sessions: request budget not read, starting empty', error?.message ?? error);
    }
    state = {
      started: Array.isArray(stored?.started) ? stored.started.filter(Number.isFinite) : [],
      blockedUntil: Number.isFinite(stored?.blockedUntil) ? stored.blockedUntil : 0,
    };
    return state;
  }

  async function save() {
    try {
      await area.set({ [STATE_KEY]: { started: state.started, blockedUntil: state.blockedUntil } });
    } catch (error) {
      console.warn('EB Sessions: request budget not kept', error?.message ?? error);
    }
  }

  function slot() {
    return chain(async () => {
      await load();
      const time = now();
      for (const [lease, expires] of leases) {
        if (expires <= time) leases.delete(lease);
      }
      state.started = state.started.filter((at) => at <= time && time - at < WINDOW_MS);
      if (time < state.blockedUntil) return { ok: false, waitMs: state.blockedUntil - time };
      if (state.started.length >= PER_MINUTE) return { ok: false, waitMs: state.started[0] + WINDOW_MS - time };
      if (leases.size >= CONCURRENT) return { ok: false, waitMs: BUSY_RETRY_MS };
      sequence += 1;
      const lease = `${time.toString(36)}.${sequence}`;
      leases.set(lease, time + LEASE_MS);
      state.started.push(time);
      await save();
      return { ok: true, lease };
    });
  }

  function done(message) {
    return chain(async () => {
      await load();
      leases.delete(String(message?.lease));
      if (message?.status === 429 || message?.status === 503) {
        const asked = Number(message.retryAfterMs);
        const pause = Math.min(PAUSE_MAX_MS, Math.max(PAUSE_MIN_MS, Number.isFinite(asked) ? asked : 0));
        state.blockedUntil = Math.max(state.blockedUntil, now() + pause);
        await save();
      }
      return {};
    });
  }

  return { slot, done, limits: Object.freeze({ concurrent: CONCURRENT, perMinute: PER_MINUTE, leaseMs: LEASE_MS }) };
}

export function register(router) {
  const budget = createBudget();
  // Quick steps that never touch the session state: outside the mutex, so a
  // session switch does not hold up a page's request.
  router.on('requests:slot', () => budget.slot(), { serialized: false });
  router.on('requests:done', (message) => budget.done(message), { serialized: false });
}
