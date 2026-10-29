// EB Sessions: the storage layer for what features keep, as EBS.store.
//
//   const prefs = EBS.store.feature('import', { administration: '1000001' });
//   await prefs.set('prefs', { hidden: [] });
//   await prefs.get('prefs');                     // { hidden: [] }, or null
//   prefs.onChange('', ({ key, value, source }) => {});
//
//   await EBS.store.get('1000001/import/prefs')   // the same, with the full key
//   await EBS.store.currentAdministration()       // '1000001', from the active entry
//
// Keys are <administration>/<feature>/<name>: the administration number (or
// 'default' when a page does not show one), a feature name and a name of the
// feature's own, so one administration's data never shows in another. Values
// are JSON. Every call is async. Settings (the feature switches) are not in
// here: they stay in chrome.storage.local as `settings`.
//
// Backends. Reads always come from `local` (chrome.storage.local, under
// "store:<key>", with a size guard). A remote backend can be added beside it:
// a write then lands in local first (optimistic, its change event fires at
// once) and is queued for the remote one, which gets one write at a time and,
// after a failure, the same write again with a growing pause. Changes from
// the remote side come in through backend.subscribe and are written to local
// when newer, with source 'remote' in the change event.
//   local      active
//   sync       not configured yet: the end-to-end encrypted sync client
//              plugs in with EBS.store.registerBackend('sync', client)
//   opmerking  not configured yet
// A backend implements, all async: get(key) -> record | null, set(key,
// record), delete(key), list(prefix) -> [{ key, record }], and optionally
// subscribe(fn) -> unsubscribe, where fn({ key, record | null }) reports a
// remote change. A record is { v: value, at: ms since 1970, by: 'local' |
// 'remote' }, and a delete is a record too ({ v: null, deleted: true }), so a
// stale copy elsewhere cannot bring a deleted value back; `at` decides
// between two writes of the same key.

(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const { EBS } = root;
  if (!EBS || EBS.store) return;

  const PREFIX = 'store:';
  const MIGRATIONS_KEY = 'storeMigrations';
  const MAX_VALUE_BYTES = 1024 * 1024;
  // chrome.storage.local holds 10 MB without unlimitedStorage; leave room
  // for the slots, pictures and settings next to the store.
  const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
  const RETRY_BASE_MS = 5_000;
  const RETRY_MAX_MS = 10 * 60_000;
  const ADMINISTRATION = /^(\d{1,12}|default)$/;
  const FEATURE = /^[a-z][a-z0-9-]{0,31}$/;
  const NAME = /^[A-Za-z0-9._:-]+(\/[A-Za-z0-9._:-]+)*$/;

  class StoreError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'StoreError';
      this.code = code;
    }
  }

  function storage() {
    const local = root.chrome?.storage?.local;
    if (!local) throw new StoreError('unavailable', 'EBS.store: no chrome.storage here');
    return local;
  }

  function checkKey(key) {
    if (typeof key !== 'string' || key.length > 300) throw new StoreError('key', 'EBS.store: a key is <administration>/<feature>/<name>');
    const [administration, feature, ...rest] = key.split('/');
    const name = rest.join('/');
    if (!ADMINISTRATION.test(administration ?? '') || !FEATURE.test(feature ?? '') || !NAME.test(name)) {
      throw new StoreError('key', `EBS.store: "${key}" is not <administration>/<feature>/<name>`);
    }
    return key;
  }

  function checkPrefix(prefix) {
    if (typeof prefix !== 'string' || prefix.length > 300) throw new StoreError('key', 'EBS.store: a prefix is a string');
    return prefix;
  }

  // A JSON copy: what goes in is exactly what comes out again.
  function toJson(value) {
    if (value === undefined) throw new StoreError('value', 'EBS.store: undefined is not a value; use delete');
    let text;
    try {
      text = JSON.stringify(value);
    } catch {
      throw new StoreError('value', 'EBS.store: the value is not JSON');
    }
    if (text === undefined) throw new StoreError('value', 'EBS.store: the value is not JSON');
    if (text.length > MAX_VALUE_BYTES) throw new StoreError('quota', 'EBS.store: one value is at most 1 MB');
    return { text, value: JSON.parse(text) };
  }

  function isRecord(record) {
    return Boolean(record) && typeof record === 'object' && 'v' in record && Number.isFinite(record.at);
  }

  function isLive(record) {
    return isRecord(record) && record.deleted !== true;
  }

  // -------------------------------------------------------------------------
  // Backends
  // -------------------------------------------------------------------------

  const local = {
    name: 'local',
    async get(key) {
      const { [PREFIX + key]: record } = await storage().get(PREFIX + key);
      return isRecord(record) ? record : null;
    },
    async set(key, record, bytes) {
      const area = storage();
      if (typeof area.getBytesInUse === 'function') {
        const used = await area.getBytesInUse(null);
        const current = await area.getBytesInUse(PREFIX + key);
        if (used - current + bytes > MAX_TOTAL_BYTES) throw new StoreError('quota', 'EBS.store: the local storage is full');
      }
      await area.set({ [PREFIX + key]: record });
    },
    // A removal without a trace; the store itself deletes with a record.
    async delete(key) {
      await storage().remove(PREFIX + key);
    },
    async list(prefix) {
      const all = await storage().get(null);
      return Object.entries(all)
        .filter(([name, record]) => name.startsWith(PREFIX + prefix) && isRecord(record))
        .map(([name, record]) => ({ key: name.slice(PREFIX.length), record }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    },
  };

  function notConfigured(name) {
    const fail = async () => {
      throw new StoreError('not-configured', `EBS.store: the ${name} backend is not configured`);
    };
    return { name, stub: true, get: fail, set: fail, delete: fail, list: fail };
  }

  const backends = new Map([['local', local], ['sync', notConfigured('sync')], ['opmerking', notConfigured('opmerking')]]);
  let remote = null;
  let remoteUnsubscribe = null;
  const outbox = [];
  let outboxBusy = false;
  let outboxFailures = 0;
  let outboxTimer = null;

  function checkBackend(impl) {
    for (const method of ['get', 'set', 'delete', 'list']) {
      if (typeof impl?.[method] !== 'function') throw new TypeError(`EBS.store: a backend needs ${method}()`);
    }
  }

  // The sync client (or a later opmerking backend) takes the place of its stub.
  function registerBackend(name, impl) {
    if (name === 'local' || !backends.has(name)) throw new StoreError('backend', `EBS.store: no backend slot "${name}"`);
    if (!backends.get(name).stub) throw new StoreError('backend', `EBS.store: the ${name} backend is already registered`);
    checkBackend(impl);
    backends.set(name, { ...impl, name });
  }

  async function useRemote(name) {
    const backend = backends.get(name);
    if (!backend || name === 'local') throw new StoreError('backend', `EBS.store: no remote backend "${name}"`);
    if (backend.stub) await backend.get('');
    remoteUnsubscribe?.();
    remote = backend;
    remoteUnsubscribe = typeof backend.subscribe === 'function' ? backend.subscribe(onRemoteChange) : null;
  }

  function stopRemote() {
    remoteUnsubscribe?.();
    remoteUnsubscribe = null;
    remote = null;
    outbox.length = 0;
    root.clearTimeout(outboxTimer);
    outboxTimer = null;
  }

  // A later write of a key replaces one still waiting for it.
  function enqueue(entry) {
    if (!remote) return;
    const waiting = outbox.findIndex((item) => item.key === entry.key);
    if (waiting >= 0 && !(outboxBusy && waiting === 0)) outbox.splice(waiting, 1, entry);
    else outbox.push(entry);
    drain();
  }

  async function drain() {
    if (outboxBusy || outboxTimer !== null || !remote || !outbox.length) return;
    outboxBusy = true;
    const entry = outbox[0];
    try {
      await remote.set(entry.key, entry.record);
      outbox.shift();
      outboxFailures = 0;
    } catch (error) {
      outboxFailures += 1;
      const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (outboxFailures - 1));
      console.warn('EB Sessions: remote store write failed, trying again later', error?.message ?? error);
      outboxTimer = root.setTimeout(() => {
        outboxTimer = null;
        drain();
      }, delay);
    } finally {
      outboxBusy = false;
    }
    if (outboxTimer === null) drain();
  }

  async function onRemoteChange(change) {
    try {
      const key = checkKey(change?.key);
      const incoming = change.record;
      if (!isRecord(incoming)) return;
      await ready();
      await chain(async () => {
        const current = await local.get(key);
        if (current && current.at >= incoming.at) return;
        if (incoming.deleted === true) {
          await local.set(key, { v: null, at: incoming.at, by: 'remote', deleted: true }, 64);
          return;
        }
        const { text, value } = toJson(incoming.v);
        await local.set(key, { v: value, at: incoming.at, by: 'remote' }, text.length);
      });
    } catch (error) {
      console.warn('EB Sessions: remote store change ignored', error?.message ?? error);
    }
  }

  // -------------------------------------------------------------------------
  // Writes one at a time, so two quick saves of a key land in their order.
  // -------------------------------------------------------------------------

  let queue = Promise.resolve();
  function chain(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  // -------------------------------------------------------------------------
  // Migrations, once per profile (the marker), each one safe to run twice: a
  // migration only writes keys that are not there yet and keeps the old data.
  // -------------------------------------------------------------------------

  const MIGRATIONS = [
    // 0.2.x kept the import screen's groups and hidden lines as
    // import:<number> = { hidden, groups, groupOf }.
    ['import-prefs', async (area) => {
      const all = await area.get(null);
      for (const [name, value] of Object.entries(all)) {
        const match = /^import:(\d{1,12}|default)$/.exec(name);
        if (!match || !value || typeof value !== 'object') continue;
        const key = `${match[1]}/import/prefs`;
        if (isRecord(all[PREFIX + key])) continue;
        await area.set({ [PREFIX + key]: { v: JSON.parse(JSON.stringify(value)), at: Date.now(), by: 'local' } });
      }
    }],
  ];

  let readyPromise = null;
  function ready() {
    if (!readyPromise) {
      readyPromise = (async () => {
        const area = storage();
        const { [MIGRATIONS_KEY]: done = [] } = await area.get(MIGRATIONS_KEY);
        const finished = Array.isArray(done) ? [...done] : [];
        for (const [name, migrate] of MIGRATIONS) {
          if (finished.includes(name)) continue;
          await migrate(area);
          finished.push(name);
          await area.set({ [MIGRATIONS_KEY]: finished });
        }
      })();
      // A failed run is tried again by the next call.
      readyPromise.catch(() => {
        readyPromise = null;
      });
    }
    return readyPromise;
  }

  // -------------------------------------------------------------------------
  // The API
  // -------------------------------------------------------------------------

  async function get(key) {
    checkKey(key);
    await ready();
    const record = await local.get(key);
    return isLive(record) ? JSON.parse(JSON.stringify(record.v)) : null;
  }

  async function set(key, value) {
    checkKey(key);
    const { text, value: clean } = toJson(value);
    await ready();
    const record = { v: clean, at: Date.now(), by: 'local' };
    await chain(() => local.set(key, record, text.length));
    enqueue({ key, record });
  }

  async function remove(key) {
    checkKey(key);
    await ready();
    const record = { v: null, at: Date.now(), by: 'local', deleted: true };
    await chain(() => local.set(key, record, 64));
    enqueue({ key, record });
  }

  async function list(prefix = '') {
    checkPrefix(prefix);
    await ready();
    return (await local.list(prefix)).filter(({ record }) => isLive(record))
      .map(({ key, record }) => ({ key, value: JSON.parse(JSON.stringify(record.v)) }));
  }

  // fn({ key, value, previous, source }) for every change under the prefix,
  // from this frame, another tab, or the remote backend (source 'remote').
  // value is null after a delete. Returns a function that stops it.
  function onChange(prefix, fn) {
    checkPrefix(prefix);
    if (typeof fn !== 'function') throw new TypeError('EBS.store.onChange needs a function');
    const listener = (changes, area) => {
      if (area !== 'local') return;
      for (const [name, change] of Object.entries(changes)) {
        if (!name.startsWith(PREFIX + prefix)) continue;
        const next = isRecord(change.newValue) ? change.newValue : null;
        const previous = isLive(change.oldValue) ? change.oldValue.v : null;
        try {
          fn({
            key: name.slice(PREFIX.length),
            value: isLive(next) ? next.v : null,
            previous,
            source: next?.by === 'remote' ? 'remote' : 'local',
          });
        } catch (error) {
          console.error('EB Sessions: store listener failed', error);
        }
      }
    };
    const events = root.chrome?.storage?.onChanged;
    if (!events) throw new StoreError('unavailable', 'EBS.store: no chrome.storage here');
    events.addListener(listener);
    return () => events.removeListener?.(listener);
  }

  // The administration number of the active entry, as the service worker
  // mirrors it (view + slots), or null when none is logged in or known.
  async function currentAdministration() {
    const { view, slots } = await storage().get(['view', 'slots']);
    if (!view?.loggedIn || !view.activeSlotId || !Array.isArray(slots)) return null;
    const number = slots.find((slot) => slot?.id === view.activeSlotId)?.number;
    return /^\d{1,12}$/.test(String(number ?? '')) ? String(number) : null;
  }

  // The keys of one feature in one administration.
  function feature(name, { administration } = {}) {
    if (!FEATURE.test(name ?? '')) throw new StoreError('key', `EBS.store: "${name}" is not a feature name`);
    const number = String(administration ?? '');
    if (!ADMINISTRATION.test(number)) throw new StoreError('key', 'EBS.store: the administration is a number (or default)');
    const base = `${number}/${name}/`;
    return Object.freeze({
      prefix: base,
      get: (key) => get(base + key),
      set: (key, value) => set(base + key, value),
      delete: (key) => remove(base + key),
      list: async (prefix = '') => (await list(base + prefix)).map((entry) => ({ ...entry, key: entry.key.slice(base.length) })),
      onChange: (prefix, fn) => onChange(base + prefix, (change) => fn({ ...change, key: change.key.slice(base.length) })),
    });
  }

  EBS.define('store', Object.freeze({
    get, set, delete: remove, list, onChange, feature, currentAdministration, ready,
    registerBackend, useRemote, stopRemote,
    // How far the remote backend is behind: writes not sent yet.
    pending: () => outbox.length,
    StoreError,
    limits: Object.freeze({ valueBytes: MAX_VALUE_BYTES, totalBytes: MAX_TOTAL_BYTES }),
  }));
})();
