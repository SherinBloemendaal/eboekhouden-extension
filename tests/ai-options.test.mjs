// The settings page of the AI writing help (src/options/), in jsdom with a
// fake chrome and a fake engine: the permission is asked inside the click
// on Opslaan before anything is saved, a refusal saves nothing, a new key
// replaces the old one, the key goes to IndexedDB and never to
// chrome.storage, and every waiting button says it is busy.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { mount } from '../src/options/options.js';
import { createKeyStore } from '../src/offscreen/keys.js';
import { createFakeIndexedDB } from './fake-idb.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readFileSync(join(root, 'src/options/options.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '');
const windows = [];
after(() => windows.forEach((window) => window.close()));

const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeChrome(store, { grant = true, granted: given = [] } = {}) {
  const listeners = [];
  const granted = new Set(given);
  const log = [];
  const chrome = {
    granted,
    log,
    grant,
    storage: {
      local: {
        async get(keys) {
          const list = [].concat(keys);
          return Object.fromEntries(list.filter((key) => key in store).map((key) => [key, structuredClone(store[key])]));
        },
        async set(values) {
          log.push(['set', Object.keys(values)]);
          Object.assign(store, structuredClone(values));
          const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value }]));
          for (const listener of listeners) listener(changes, 'local');
        },
      },
      onChanged: { addListener: (listener) => listeners.push(listener) },
    },
    runtime: {
      async sendMessage(message) {
        log.push(['message', message.type]);
        return {};
      },
    },
    permissions: {
      async contains({ origins }) { return origins.every((origin) => granted.has(origin)); },
      request({ origins }) {
        log.push(['request', origins]);
        if (chrome.grant === 'hold') {
          chrome.pending = deferred();
          return chrome.pending.promise.then((answer) => {
            if (answer) for (const origin of origins) granted.add(origin);
            return answer;
          });
        }
        if (chrome.grant) for (const origin of origins) granted.add(origin);
        return Promise.resolve(Boolean(chrome.grant));
      },
      async remove({ origins }) {
        log.push(['remove', origins]);
        for (const origin of origins) granted.delete(origin);
        return true;
      },
      onAdded: { addListener() {} },
      onRemoved: { addListener() {} },
    },
  };
  return chrome;
}

async function settingsPage({ store = {}, saved = {}, grant = true, granted = [], engine, keys: given } = {}) {
  const dom = new JSDOM(HTML, { url: 'chrome-extension://ebs-test/src/options/options.html', runScripts: 'outside-only', pretendToBeVisual: true });
  windows.push(dom.window);
  for (const file of ['shared.js', 'icons.js']) dom.window.eval(readFileSync(join(root, 'src', file), 'utf8'));
  const chrome = fakeChrome(store, { grant, granted });
  const keys = given ?? createKeyStore({ indexedDB: createFakeIndexedDB().indexedDB });
  for (const [provider, key] of Object.entries(saved)) await keys.set(provider, key);
  const tests = [];
  const fakeEngine = engine ?? {
    async test(config) {
      tests.push(config);
      if (config.key.includes('bad')) throw Object.assign(new Error('auth'), { code: 'auth', status: 401 });
      return { ok: true, models: ['anthropic/claude-sonnet-5.5', 'openai/gpt-5'], modelKnown: config.model ? ['anthropic/claude-sonnet-5.5', 'openai/gpt-5'].includes(config.model) : null };
    },
  };
  const now = () => new Date(2026, 9, 29, 9, 14);
  const mounted = mount({ document: dom.window.document, chrome, engine: fakeEngine, keys, EBS: dom.window.EBS, now });
  await mounted.ready;
  const $ = (id) => dom.window.document.getElementById(id);
  const type = (id, value) => {
    $(id).value = value;
    $(id).dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  return { dom, document: dom.window.document, chrome, store, keys, tests, $, type, state: mounted.state };
}

test('first time: OpenRouter chosen, an empty key with the board\'s note, the switch off', async () => {
  const p = await settingsPage();
  assert.deepEqual([...p.document.querySelectorAll('.provider')].map((card) => [card.querySelector('.provider-name').textContent, card.getAttribute('aria-checked')]),
    [['OpenRouter', 'true'], ['OpenAI', 'false'], ['Anthropic', 'false']]);
  assert.equal(p.$('key').value, '');
  assert.equal(p.$('key').placeholder, 'sk-or-v1-…');
  assert.equal(p.$('key-note').textContent, 'Maak een sleutel aan bij de aanbieder en plak hem hier.');
  assert.equal(p.$('model').value, 'anthropic/claude-sonnet-5.5');
  assert.match(p.$('model-hint').textContent, /Bij OpenRouter bijvoorbeeld anthropic\/claude-sonnet-5\.5/);
  assert.equal(p.$('enabled').getAttribute('aria-checked'), 'false');
  assert.ok(p.document.body.classList.contains('off'));
  assert.equal(p.$('remove').disabled, true);
  assert.match(p.$('consent-text').textContent, /Bij Opslaan vraagt Chrome toestemming voor alleen openrouter\.ai/);
  assert.ok(p.$('mark').querySelector('.lucide-sparkles'));
});

test('Opslaan asks Chrome first, inside the click, then saves and tests the key', async () => {
  const p = await settingsPage({ grant: 'hold', store: { settings: { aiWriter: true } } });
  p.type('key', 'sk-or-v1-good');
  p.$('save').click();
  // Synchronously in the click: the request is out, nothing is saved yet.
  assert.deepEqual(p.chrome.log, [['request', ['https://openrouter.ai/*']]]);
  assert.equal(p.$('save').getAttribute('aria-busy'), 'true');
  assert.equal(p.$('save').textContent, 'Bezig…');
  assert.ok(p.$('consent').classList.contains('asking'));
  assert.match(p.$('consent-text').textContent, /Chrome vraagt nu of de extensie met openrouter\.ai mag praten/);
  assert.equal(p.$('key-note').textContent, 'Wordt opgeslagen zodra Chrome toestemming geeft.');
  p.chrome.pending.resolve(true);
  await wait(30);
  assert.deepEqual(await p.keys.all(), { openrouter: 'sk-or-v1-good' });
  assert.ok(!JSON.stringify(p.store).includes('sk-or-v1-good'), 'the key is not in chrome.storage.local');
  assert.ok(p.chrome.log.some(([kind, type]) => kind === 'message' && type === 'ai:keys'), 'the service worker hears of the new key');
  assert.equal(p.store.aiConfig.provider, 'openrouter');
  assert.deepEqual(p.store.aiConfig.models, { openrouter: 'anthropic/claude-sonnet-5.5' });
  assert.deepEqual(p.tests, [{ provider: 'openrouter', key: 'sk-or-v1-good', model: 'anthropic/claude-sonnet-5.5' }]);
  assert.equal(p.store.aiConfig.status.openrouter.ok, true);
  assert.deepEqual(p.store.aiConfig.modelLists.openrouter, ['anthropic/claude-sonnet-5.5', 'openai/gpt-5']);
  assert.equal(p.$('key-note').textContent, 'Opgeslagen. Sleutel werkt. Laatst getest vandaag om 09:14.');
  assert.ok(p.$('key-note').classList.contains('ok'));
  assert.equal(p.$('models').children.length, 2);
  assert.equal(p.$('save').disabled, false);
  assert.equal(p.$('save').textContent, 'Opslaan');
});

test('a refusal from Chrome saves nothing and says so', async () => {
  const p = await settingsPage({ grant: false });
  p.type('key', 'sk-or-v1-good');
  p.$('save').click();
  await wait(20);
  assert.deepEqual(await p.keys.all(), {});
  assert.deepEqual(p.tests, []);
  assert.match(p.$('key-note').textContent, /Zonder toestemming van Chrome kan de extensie openrouter\.ai niet bereiken\. De sleutel is niet opgeslagen\./);
  assert.match(p.$('consent-text').textContent, /Chrome gaf geen toestemming voor openrouter\.ai\. Er is niets opgeslagen\./);
});

test('a refused key replaces the old one and is marked as refused', async () => {
  const store = { settings: { aiWriter: true }, aiConfig: { provider: 'openrouter', models: { openrouter: 'openai/gpt-5' }, status: { openrouter: { ok: true, at: 1 } } } };
  const p = await settingsPage({ store, saved: { openrouter: 'sk-or-v1-old' } });
  p.chrome.granted.add('https://openrouter.ai/*');
  assert.equal(p.$('key').value, 'sk-or-v1-old');
  assert.equal(p.$('model').value, 'openai/gpt-5');
  p.type('key', 'sk-or-v1-bad');
  assert.match(p.$('key-note').textContent, /Nog niet opgeslagen/);
  p.$('save').click();
  await wait(30);
  assert.deepEqual(await p.keys.all(), { openrouter: 'sk-or-v1-bad' }, 'the old key is not kept in use');
  assert.deepEqual(p.store.aiConfig.status.openrouter, { ok: false, code: 'auth', status: 401, at: new Date(2026, 9, 29, 9, 14).getTime() });
  assert.equal(p.$('key-note').textContent, 'Opgeslagen, maar: OpenRouter weigert deze sleutel (401). Controleer of hij klopt en nog actief is.');
  assert.ok(p.$('key').classList.contains('bad'));
  assert.ok(p.$('key-note').querySelector('.lucide-triangle-alert'), 'an icon, not a "!"');
});

test('Sleutel testen: busy while it runs, needs no saving, and checks the model', async () => {
  const hold = deferred();
  const engine = { test: async () => { await hold.promise; return { ok: true, models: ['a'], modelKnown: false }; } };
  const p = await settingsPage({ engine, store: { settings: { aiWriter: true } }, granted: ['https://openrouter.ai/*'] });
  p.type('key', 'sk-or-v1-new');
  p.$('test').click();
  await wait();
  assert.equal(p.$('test').textContent, 'Testen…');
  assert.equal(p.$('test').getAttribute('aria-busy'), 'true');
  assert.equal(p.$('key-note').textContent, 'Bezig met testen…');
  hold.resolve();
  await wait(20);
  assert.equal(p.$('test').textContent, 'Sleutel testen');
  assert.equal(p.$('key-note').textContent, 'Sleutel werkt. Laatst getest vandaag om 09:14. Nog niet opgeslagen.');
  assert.match(p.$('model-hint').textContent, /Het model anthropic\/claude-sonnet-5\.5 staat niet in de lijst van OpenRouter/);
  assert.deepEqual(await p.keys.all(), {}, 'a test saves no key');
  assert.deepEqual(p.chrome.log.filter(([kind]) => kind === 'request'), [], 'no prompt for an address that is granted');
});

test('a bad key or model is caught before Chrome is asked', async () => {
  const p = await settingsPage();
  p.$('save').click();
  assert.equal(p.$('key-note').textContent, 'Plak eerst een sleutel.');
  p.type('key', 'twee woorden');
  p.$('save').click();
  assert.match(p.$('key-note').textContent, /één woord zonder spaties/);
  p.type('key', 'sk-ok');
  p.type('model', '');
  p.$('save').click();
  assert.equal(p.$('key-note').textContent, 'Kies eerst een model.');
  assert.deepEqual(p.chrome.log, []);
});

test('Sleutel verwijderen removes the key and takes the permission back', async () => {
  const store = { settings: { aiWriter: true }, aiConfig: { provider: 'openrouter', models: { openrouter: 'm' } } };
  const p = await settingsPage({ store, saved: { openrouter: 'sk-or-v1-old', openai: 'sk-oa' } });
  assert.equal(p.$('remove').disabled, false);
  p.$('remove').click();
  await wait(20);
  assert.deepEqual(await p.keys.all(), { openai: 'sk-oa' });
  assert.ok(p.chrome.log.some(([kind, type]) => kind === 'message' && type === 'ai:keys'));
  assert.deepEqual(p.chrome.log.find(([kind]) => kind === 'remove'), ['remove', ['https://openrouter.ai/*']]);
  assert.equal(p.$('key').value, '');
  assert.match(p.$('key-note').textContent, /Sleutel verwijderd\. De toestemming voor openrouter\.ai is ook ingetrokken\./);
  assert.equal(p.$('remove').disabled, true);
});

test('the switch turns the writing help on and off; off dims the setup and keeps the key', async () => {
  const store = { settings: { aiWriter: true, betterDesign: true }, aiConfig: { provider: 'anthropic', models: { anthropic: 'claude-sonnet-5-5' } } };
  const p = await settingsPage({ store, saved: { anthropic: 'sk-ant-x' } });
  p.chrome.granted.add('https://api.anthropic.com/*');
  assert.equal(p.document.querySelector('.provider[aria-checked="true"]').dataset.provider, 'anthropic');
  p.$('enabled').click();
  await wait();
  assert.deepEqual(p.store.settings, { ...p.dom.window.EBS.SETTINGS_DEFAULTS, aiWriter: false, betterDesign: true });
  assert.equal(p.$('enabled').getAttribute('aria-checked'), 'false');
  assert.ok(p.document.body.classList.contains('off'));
  assert.equal(p.$('key-note').textContent, 'Sleutel bewaard. AI-schrijfhulp staat uit.');
  assert.deepEqual(await p.keys.all(), { anthropic: 'sk-ant-x' });
});

test('picking another provider shows its own key, model and address', async () => {
  const store = { aiConfig: { provider: 'openrouter', models: { openrouter: 'm' } } };
  const p = await settingsPage({ store, saved: { openrouter: 'sk-or-v1-x' } });
  p.document.querySelector('.provider[data-provider="openai"]').click();
  assert.equal(p.$('key').value, '');
  assert.equal(p.$('key').placeholder, 'sk-…');
  assert.equal(p.$('model').value, '');
  assert.equal(p.$('model').placeholder, 'Kies een model van OpenAI');
  assert.match(p.$('consent-text').textContent, /api\.openai\.com/);
  assert.equal(p.document.querySelector('.provider[data-provider="openai"]').getAttribute('aria-checked'), 'true');
});

test('a failing key store says so; the button comes back', async () => {
  const real = createKeyStore({ indexedDB: createFakeIndexedDB().indexedDB });
  const keys = { ...real, set: async () => { throw new Error('QuotaExceededError'); } };
  const p = await settingsPage({ store: { settings: { aiWriter: true } }, granted: ['https://openrouter.ai/*'], keys });
  p.type('key', 'sk-or-v1-good');
  p.$('save').click();
  await wait(30);
  assert.equal(p.$('key-note').textContent, 'Opslaan lukte niet. Probeer het opnieuw.');
  assert.equal(p.$('save').disabled, false);
  assert.equal(p.$('save').getAttribute('aria-busy'), null);
  assert.deepEqual(p.tests, [], 'no test of a key that was not saved');
});
