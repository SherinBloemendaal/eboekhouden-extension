// The API keys of the AI writing help never reach a place a content script
// can read. Chrome hands every chrome.storage.local change, value included,
// to the onChanged listeners of the content scripts in the e-Boekhouden
// tabs, so a key must never be written there; the keys live in IndexedDB of
// the extension's origin (src/offscreen/keys.js) instead.
//
// This runs the real service worker, the real settings page (jsdom), the
// real offscreen host with the real engine and the vendored SDK, over one
// shared fake IndexedDB, and records everything a content script could see:
// every chrome.storage area and every change event of it, every answer to a
// page and every message to a tab. The provider's fetch is mocked; it is the
// one place the key must arrive.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { createFakeChrome } from './fake-chrome.mjs';
import { createFakeIndexedDB } from './fake-idb.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY = 'sk-or-v1-legacy-key-0001';
const FRESH = 'sk-or-v1-fresh-key-0002';
const OTHER = 'sk-ant-other-key-0003';
const SECRETS = [LEGACY, FRESH, OTHER];

const fake = createFakeChrome();
const idb = createFakeIndexedDB();
globalThis.indexedDB = idb.indexedDB;
const windows = [];
after(() => {
  windows.forEach((window) => window.close());
  // The offscreen document's idle minute would keep the test alive.
  offscreen.host?.stop();
});

const until = async (check, what) => {
  for (let tries = 0; tries < 200; tries += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${what}`);
};

// ---------------------------------------------------------------------------
// What a content script can see, recorded
// ---------------------------------------------------------------------------

const seen = { events: [], answers: [], accessLevels: [] };
const storageListeners = [];
for (const name of ['local', 'session']) {
  const area = fake.storage[name];
  const set = area.set.bind(area);
  const remove = area.remove.bind(area);
  const emit = (changes) => {
    seen.events.push({ area: name, changes: structuredClone(changes) });
    for (const listener of storageListeners) listener(structuredClone(changes), name);
  };
  area.set = async (values) => {
    const before = await area.get(Object.keys(values));
    await set(values);
    emit(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { oldValue: before[key], newValue: value }])));
  };
  area.remove = async (keys) => {
    const list = [].concat(keys);
    const before = await area.get(list);
    await remove(list);
    const changes = Object.fromEntries(list.filter((key) => key in before).map((key) => [key, { oldValue: before[key] }]));
    if (Object.keys(changes).length) emit(changes);
  };
  area.setAccessLevel = async (level) => { seen.accessLevels.push([name, level.accessLevel]); };
}
chrome.storage.onChanged = { addListener: (listener) => storageListeners.push(listener) };

// ---------------------------------------------------------------------------
// The rest of Chrome: permissions, the offscreen document, messages between
// the worker and the extension's pages
// ---------------------------------------------------------------------------

const granted = new Set();
chrome.permissions = {
  async contains({ origins }) { return origins.every((origin) => granted.has(origin)); },
  async request({ origins }) { for (const origin of origins) granted.add(origin); return true; },
  async remove({ origins }) { for (const origin of origins) granted.delete(origin); return true; },
  onAdded: { addListener() {} },
  onRemoved: { addListener() {} },
};

const EXTENSION = 'chrome-extension://ebs-test/';
const workerSender = { id: 'ebs-test', url: `${EXTENSION}src/background.js` };
const offscreenSender = { id: 'ebs-test', url: `${EXTENSION}src/offscreen/offscreen.html` };
const settingsSender = { id: 'ebs-test', tab: { id: 50, url: `${EXTENSION}src/options/options.html` }, url: `${EXTENSION}src/options/options.html` };
const pageSender = { id: 'ebs-test', tab: { id: 7, url: 'https://secure20.e-boekhouden.nl/beheer/sjabloon/email/1' }, frameId: 0, url: 'https://secure20.e-boekhouden.nl/beheer/sjabloon/email/1' };

// Messages between extension contexts. Chrome delivers them to extension
// pages only, not to content scripts, but they are recorded too: no message
// needs the key, so none may carry it.
const messages = [];
const offscreenListeners = [];
function deliver(listeners, message, sender) {
  return new Promise((resolve) => {
    let taken = false;
    for (const listener of listeners) taken = listener(structuredClone(message), sender, resolve) === true || taken;
    if (!taken) resolve(undefined);
  });
}

fake.runtime.getURL = (path) => `${EXTENSION}${path}`;
fake.runtime.openOptionsPage = async () => {};
fake.runtime.sendMessage = async (message) => {
  messages.push({ from: 'worker', message: structuredClone(message) });
  if (!offscreen.host) throw new Error('Could not establish connection. Receiving end does not exist.');
  return deliver(offscreenListeners, message, workerSender);
};

const { createEngine } = await import('../src/offscreen/engine.js');
const { createKeyStore } = await import('../src/offscreen/keys.js');
const { listen } = await import('../src/offscreen/host.js');
globalThis.AI_SDK_LOG_WARNINGS = false;
const sdk = await import(pathToFileURL(join(root, 'vendor/ai-sdk.mjs')).href);
const { DOMParser } = new JSDOM('').window;

// The provider: the only place a key may go.
const provider = { calls: [] };
async function providerFetch(url, init = {}) {
  const headers = Object.fromEntries(new Headers(init.headers));
  provider.calls.push({ url: String(url), authorization: headers.authorization ?? headers['x-api-key'] ?? null });
  let json;
  if (String(url).endsWith('/api/v1/key')) json = { data: { label: 'demo' } };
  else if (String(url).includes('/models')) json = { data: [{ id: 'anthropic/claude-sonnet-5.5' }, { id: 'claude-sonnet-5-5' }] };
  else {
    const body = JSON.parse(init.body);
    const answer = JSON.stringify({ content: '<p>Bijgaand treft u factuur [FACTNUMMER] aan.</p>' });
    json = { id: 'c', object: 'chat.completion', created: 1, model: body.model, choices: [{ index: 0, message: { role: 'assistant', content: answer }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } };
  }
  return new Response(JSON.stringify(json), { status: 200, headers: { 'content-type': 'application/json' } });
}

const offscreen = { host: null, created: 0 };
const offscreenChrome = {
  runtime: {
    id: 'ebs-test',
    onMessage: { addListener: (listener) => offscreenListeners.push(listener) },
    async sendMessage(message) {
      messages.push({ from: 'offscreen', message: structuredClone(message) });
      return fake.deliver(message, offscreenSender);
    },
  },
};
chrome.offscreen = {
  async createDocument() {
    offscreen.created += 1;
    // A fresh document: its own connection to the extension's IndexedDB.
    offscreen.host = listen({ chrome: offscreenChrome, engine: createEngine({ sdk, fetch: providerFetch, DOMParser }), keys: createKeyStore() });
  },
  async closeDocument() {
    offscreen.host?.stop();
    offscreen.host = null;
    offscreenListeners.length = 0;
  },
};
fake.runtime.getContexts = async () => (offscreen.host ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []);

// A build before this one kept the key in chrome.storage.local.
await fake.storage.local.set({
  settings: { aiWriter: true },
  aiKeys: { openrouter: LEGACY },
  aiConfig: { provider: 'openrouter', models: { openrouter: 'anthropic/claude-sonnet-5.5' } },
});
granted.add('https://openrouter.ai/*');
const legacyEvents = seen.events.length;

await import('../src/background.js');

const settingsHtml = readFileSync(join(root, 'src/options/options.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '');
async function openSettings() {
  const dom = new JSDOM(settingsHtml, { url: `${EXTENSION}src/options/options.html`, runScripts: 'outside-only', pretendToBeVisual: true });
  windows.push(dom.window);
  for (const file of ['shared.js', 'icons.js']) dom.window.eval(readFileSync(join(root, 'src', file), 'utf8'));
  const settingsChrome = {
    storage: { local: fake.storage.local, onChanged: chrome.storage.onChanged },
    permissions: chrome.permissions,
    runtime: {
      async sendMessage(message) {
        messages.push({ from: 'settings', message: structuredClone(message) });
        return fake.deliver(message, settingsSender);
      },
    },
  };
  const { mount } = await import('../src/options/options.js');
  const mounted = mount({ document: dom.window.document, chrome: settingsChrome, engine: createEngine({ sdk: null, fetch: providerFetch }), keys: createKeyStore(), EBS: dom.window.EBS });
  await mounted.ready;
  const $ = (id) => dom.window.document.getElementById(id);
  const type = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  return { dom, $, type, state: mounted.state };
}

const REQUEST = {
  action: 'rewrite', option: 'formal', format: 'html', scope: 'all',
  content: '<p>Hierbij je factuur [FACTNUMMER].</p>', templateType: 'mail', variables: [['[FACTNUMMER]', 'Factuurnummer']],
};
async function fromPage(message) {
  const answer = await fake.dispatch(message, pageSender);
  seen.answers.push(structuredClone(answer));
  return answer;
}

const leaks = (value) => SECRETS.filter((secret) => JSON.stringify(value ?? null).includes(secret));
const aiView = async () => (await fake.storage.local.get('aiView')).aiView;

// ---------------------------------------------------------------------------

test('a key of an earlier build moves to IndexedDB once and leaves chrome.storage.local', async () => {
  await until(async () => !(await fake.storage.local.get('aiKeys')).aiKeys, 'the migration');
  assert.equal(idb.dump()['ebs-ai'].keys.openrouter, LEGACY);
  // The only change event of the migration: the deletion of the old entry.
  // Chrome's event still carries the old value; it is the last one ever to.
  const migration = seen.events.slice(legacyEvents).filter(({ changes }) => changes.aiKeys);
  assert.deepEqual(migration, [{ area: 'local', changes: { aiKeys: { oldValue: { openrouter: LEGACY } } } }]);
  await until(async () => (await aiView())?.state === 'ready', 'aiView');
  assert.deepEqual(await aiView(), { state: 'ready', provider: 'openrouter', providerLabel: 'OpenRouter', model: 'anthropic/claude-sonnet-5.5' });

  // Once: a second start finds nothing to move and changes nothing.
  const before = seen.events.length;
  assert.equal(await createKeyStore().migrate(fake.storage.local), false);
  assert.equal(seen.events.length, before);
});

test('a key in IndexedDB is newer than a leftover old entry and stays', async () => {
  const keys = createKeyStore();
  await fake.storage.local.set({ aiKeys: { openrouter: 'sk-or-v1-stale', anthropic: 'twee woorden', openai: 42 } });
  assert.equal(await keys.migrate(fake.storage.local), true);
  assert.deepEqual(await keys.all(), { openrouter: LEGACY }, 'the stored key wins; invalid values are dropped');
  assert.equal((await fake.storage.local.get('aiKeys')).aiKeys, undefined);
});

test('a failing IndexedDB keeps the old entry for the next try instead of losing the key', async () => {
  const broken = createKeyStore({ indexedDB: { open() { const request = {}; setTimeout(() => request.onerror?.()); return request; } } });
  await fake.storage.local.set({ aiKeys: { openai: 'sk-oa-kept' } });
  await assert.rejects(broken.migrate(fake.storage.local));
  assert.deepEqual((await fake.storage.local.get('aiKeys')).aiKeys, { openai: 'sk-oa-kept' });
  await fake.storage.local.remove('aiKeys');
});

test('saving, using, switching and removing keys: no content script can ever see one', async () => {
  const start = seen.events.length;
  const settings = await openSettings();
  assert.equal(settings.$('key').value, LEGACY, 'the settings page reads the migrated key');

  // A new key, saved.
  settings.type('key', FRESH);
  settings.$('save').click();
  await until(() => settings.state.busy === null && settings.$('key-note').textContent.startsWith('Opgeslagen'), 'the save');
  assert.equal(idb.dump()['ebs-ai'].keys.openrouter, FRESH);
  assert.ok(provider.calls.some((call) => call.authorization === `Bearer ${FRESH}`), 'the key test reached the provider');

  // A click in an editor: the offscreen document reads the key itself.
  provider.calls.length = 0;
  const answer = await fromPage({ type: 'ai:run', id: 'ai-1', request: REQUEST });
  assert.deepEqual(answer, { result: { content: '<p>Bijgaand treft u factuur [FACTNUMMER] aan.</p>' } });
  assert.equal(offscreen.created, 1);
  assert.deepEqual(provider.calls.map((call) => call.authorization), [`Bearer ${FRESH}`], 'the provider, and only it, gets the key');

  // Another provider's key, saved, used, then removed.
  settings.dom.window.document.querySelector('.provider[data-provider="anthropic"]').click();
  settings.type('key', OTHER);
  settings.type('model', 'claude-sonnet-5-5');
  settings.$('save').click();
  await until(() => settings.state.busy === null && settings.$('key-note').textContent.startsWith('Opgeslagen'), 'the second save');
  await until(async () => (await aiView())?.provider === 'anthropic', 'aiView for anthropic');
  provider.calls.length = 0;
  await fromPage({ type: 'ai:run', id: 'ai-2', request: REQUEST }).catch(() => {});
  assert.ok(provider.calls.some((call) => call.authorization === OTHER), 'the anthropic key reached its provider');
  settings.$('remove').click();
  await until(() => settings.state.busy === null && /Sleutel verwijderd/.test(settings.$('key-note').textContent), 'the removal');
  await until(async () => (await aiView())?.state === 'nokey', 'aiView nokey');
  assert.deepEqual(await createKeyStore().all(), { openrouter: FRESH });

  // A page asking for things it may not have gets nothing secret either.
  await fromPage({ type: 'ai:keys' });
  await fromPage({ type: 'ai:abort', id: 'ai-2' });
  await fromPage({ type: 'ai:run', id: 'ai-3', request: REQUEST });

  // Everything a content script could have seen.
  const after = seen.events.slice(start);
  assert.ok(after.length > 5, 'the flow wrote to chrome.storage');
  assert.deepEqual(after.flatMap((event) => leaks(event)), [], 'no change event of any chrome.storage area names a key');
  assert.deepEqual(leaks(fake.storage.local.dump()), [], 'chrome.storage.local holds no key');
  assert.deepEqual(leaks(fake.storage.session.dump()), [], 'chrome.storage.session holds no key');
  assert.equal(fake.storage.sync, undefined, 'the extension has no chrome.storage.sync to leak into');
  assert.deepEqual(leaks(seen.answers), [], 'no answer to a page carries a key');
  assert.deepEqual(leaks(fake.sent), [], 'no message to a tab carries a key');
  assert.deepEqual(leaks(messages), [], 'no message between the extension\'s own contexts carries a key either');
  assert.ok(seen.accessLevels.some(([area, level]) => area === 'session' && level === 'TRUSTED_CONTEXTS'));
});

test('only the key store and its migration name the old storage entry', () => {
  const sources = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.(js|mjs|html)$/.test(entry.name)) sources.push(path);
    }
  };
  walk('src');
  const naming = sources.filter((path) => /['"`]aiKeys['"`]/.test(readFileSync(join(root, path), 'utf8')));
  assert.deepEqual(naming, ['src/offscreen/keys.js']);
  // The content script has no way to the keys at all.
  assert.doesNotMatch(readFileSync(join(root, 'src/features/ai.js'), 'utf8'), /indexedDB|aiKeys|keys\.js/);
});
