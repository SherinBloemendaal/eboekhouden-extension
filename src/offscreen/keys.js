// The API keys of the AI writing help, one per provider, in IndexedDB of the
// extension's own origin (chrome-extension://<id>). The settings page, the
// offscreen document and the service worker can open it; a content script
// cannot, because it runs on the origin of the e-Boekhouden page, and the
// page itself cannot either.
//
// Not chrome.storage.local: Chrome hands every change there, new value
// included, to the onChanged listeners of the content scripts in all open
// e-Boekhouden tabs. A key saved there would reach those contexts on every
// save. IndexedDB fires no such events.
//
//   const keys = createKeyStore();
//   await keys.set('openrouter', 'sk-or-v1-...');   the settings page only
//   await keys.get('openrouter')                     '' when there is none
//   await keys.has('openrouter')                     without reading the key
//   await keys.all()                                 { [provider]: key }
//   await keys.remove('openrouter')
//   await keys.migrate(chrome.storage.local)         once: aiKeys of 0.3.x
//
// tests/ai-keys.test.mjs checks that no storage a content script can reach
// ever holds a key.

import { PROVIDERS, checkKey, checkProvider } from './protocol.js';

const DB_NAME = 'ebs-ai';
const DB_VERSION = 1;
const STORE = 'keys';
// Where the first builds kept the keys, in chrome.storage.local.
const LEGACY_KEY = 'aiKeys';

export function createKeyStore({ indexedDB = globalThis.indexedDB } = {}) {
  let opening = null;

  function open() {
    if (!indexedDB) return Promise.reject(new Error('IndexedDB is not available'));
    opening ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => {
        const db = request.result;
        // A later version, or Chrome closing the connection: open again on
        // the next call instead of using a closed handle.
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        db.onclose = () => { opening = null; };
        resolve(db);
      };
      request.onerror = () => {
        opening = null;
        reject(request.error ?? new Error('IndexedDB did not open'));
      };
      request.onblocked = () => {
        opening = null;
        reject(new Error('IndexedDB is blocked'));
      };
    });
    return opening;
  }

  // work(store) issues its requests at once (a transaction commits when it
  // has none left) and returns a function that reads their results.
  async function transact(mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const read = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(read?.());
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
  }

  async function get(provider) {
    checkProvider(provider);
    const value = await transact('readonly', (store) => {
      const request = store.get(provider);
      return () => request.result;
    });
    return typeof value === 'string' ? value : '';
  }

  async function has(provider) {
    checkProvider(provider);
    return (await transact('readonly', (store) => {
      const request = store.count(provider);
      return () => request.result;
    })) > 0;
  }

  async function all() {
    const entries = await transact('readonly', (store) => {
      const names = store.getAllKeys();
      const values = store.getAll();
      return () => names.result.map((name, index) => [name, values.result[index]]);
    });
    return Object.fromEntries(entries.filter(([name, value]) => Object.hasOwn(PROVIDERS, name) && typeof value === 'string' && value));
  }

  async function set(provider, key) {
    checkProvider(provider);
    const clean = checkKey(key);
    await transact('readwrite', (store) => {
      store.put(clean, provider);
    });
  }

  async function remove(provider) {
    checkProvider(provider);
    await transact('readwrite', (store) => {
      store.delete(provider);
    });
  }

  // Moves the keys an earlier build kept in chrome.storage.local here, once,
  // and deletes them there. A key already here is newer and stays. The old
  // entry is only deleted after the keys are safely written: a failure
  // leaves it for the next try instead of losing the key.
  async function migrate(storage) {
    const { [LEGACY_KEY]: legacy } = await storage.get(LEGACY_KEY);
    if (legacy === undefined) return false;
    if (legacy && typeof legacy === 'object') {
      for (const provider of Object.keys(PROVIDERS)) {
        const value = legacy[provider];
        if (typeof value !== 'string') continue;
        let key;
        try {
          key = checkKey(value);
        } catch {
          continue;
        }
        if (!(await has(provider))) await set(provider, key);
      }
    }
    await storage.remove(LEGACY_KEY);
    return true;
  }

  return Object.freeze({ get, has, all, set, remove, migrate });
}
