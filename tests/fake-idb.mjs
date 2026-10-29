// In-memory stand-in for the part of IndexedDB that src/offscreen/keys.js
// uses: open with an upgrade, one object store with out-of-line keys, and
// get, count, getAll, getAllKeys, put and delete in transactions that
// complete after their last request, asynchronously like the real thing.

const later = (fn) => setTimeout(fn, 0);

export function createFakeIndexedDB() {
  const databases = new Map();
  const log = [];

  function makeRequest() {
    return { result: undefined, error: null, onsuccess: null, onerror: null };
  }

  function connect(record) {
    const db = {
      closed: false,
      onversionchange: null,
      onclose: null,
      objectStoreNames: { contains: (name) => record.stores.has(name) },
      createObjectStore(name) {
        if (!record.upgrading) throw new Error('InvalidStateError: not in an upgrade');
        record.stores.set(name, new Map());
        return {};
      },
      close() {
        db.closed = true;
      },
      transaction(name, mode = 'readonly') {
        if (db.closed) throw new Error('InvalidStateError: the connection is closed');
        const data = record.stores.get(name);
        if (!data) throw new Error(`NotFoundError: no store ${name}`);
        const transaction = { error: null, oncomplete: null, onerror: null, onabort: null };
        let pending = 0;
        let finished = false;
        const queue = (work, write = false) => {
          if (finished) throw new Error('TransactionInactiveError');
          if (write && mode !== 'readwrite') throw new Error('ReadOnlyError');
          const request = makeRequest();
          pending += 1;
          later(() => {
            request.result = work();
            if (write) log.push({ store: name, entries: structuredClone([...data]) });
            request.onsuccess?.();
            pending -= 1;
            if (!pending) {
              finished = true;
              later(() => transaction.oncomplete?.());
            }
          });
          return request;
        };
        transaction.objectStore = () => ({
          get: (key) => queue(() => structuredClone(data.get(key))),
          count: (key) => queue(() => (key === undefined ? data.size : Number(data.has(key)))),
          getAll: () => queue(() => structuredClone([...data.values()])),
          getAllKeys: () => queue(() => [...data.keys()]),
          put: (value, key) => queue(() => {
            data.set(key, structuredClone(value));
            return key;
          }, true),
          delete: (key) => queue(() => {
            data.delete(key);
          }, true),
        });
        // A transaction without requests completes at once.
        later(() => {
          if (!pending && !finished) {
            finished = true;
            transaction.oncomplete?.();
          }
        });
        return transaction;
      },
    };
    return db;
  }

  const indexedDB = {
    open(name, version = 1) {
      const request = { ...makeRequest(), onupgradeneeded: null, onblocked: null };
      later(() => {
        let record = databases.get(name);
        if (!record) {
          record = { version: 0, stores: new Map(), upgrading: false };
          databases.set(name, record);
        }
        const db = connect(record);
        request.result = db;
        if (version > record.version) {
          record.upgrading = true;
          request.onupgradeneeded?.({ oldVersion: record.version, newVersion: version });
          record.upgrading = false;
          record.version = version;
        }
        request.onsuccess?.();
      });
      return request;
    },
  };

  return {
    indexedDB,
    log,
    // Everything in every store, for the tests: { db: { store: { key: value } } }.
    dump() {
      return Object.fromEntries([...databases].map(([name, record]) => [name, Object.fromEntries([...record.stores].map(([store, data]) => [store, Object.fromEntries(data)]))]));
    },
    reset() {
      for (const record of databases.values()) for (const data of record.stores.values()) data.clear();
      log.length = 0;
    },
  };
}
