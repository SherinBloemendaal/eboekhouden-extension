// The service worker side of the AI writing help (src/bg/ai.js): which
// calls it lets through, the offscreen document it creates on demand (which
// reads the key itself: no message carries it), Stoppen, and the aiView
// mirror the editors draw their bar from.
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeChrome } from './fake-chrome.mjs';
import { createFakeIndexedDB } from './fake-idb.mjs';

const fake = createFakeChrome();
const idb = createFakeIndexedDB();
globalThis.indexedDB = idb.indexedDB;

// What fake-chrome.mjs does not have: permissions, the offscreen API, the
// runtime's messages to extension pages, and storage change events.
const granted = new Set();
const permissionListeners = { added: [], removed: [] };
const storageListeners = [];
const offscreen = { open: false, created: 0, closed: 0, messages: [], answer: null, pending: [] };

const localSet = fake.storage.local.set.bind(fake.storage.local);
fake.storage.local.set = async (values) => {
  const changes = Object.fromEntries(Object.keys(values).map((key) => [key, { newValue: values[key] }]));
  await localSet(values);
  for (const listener of storageListeners) listener(changes, 'local');
};
chrome.storage.onChanged = { addListener: (listener) => storageListeners.push(listener) };
chrome.permissions = {
  async contains({ origins }) { return origins.every((origin) => granted.has(origin)); },
  async request({ origins }) { for (const origin of origins) granted.add(origin); return true; },
  async remove({ origins }) { for (const origin of origins) granted.delete(origin); return true; },
  onAdded: { addListener: (listener) => permissionListeners.added.push(listener) },
  onRemoved: { addListener: (listener) => permissionListeners.removed.push(listener) },
};
chrome.offscreen = {
  async createDocument({ url, reasons, justification }) {
    assert.equal(url, 'src/offscreen/offscreen.html');
    assert.deepEqual(reasons, ['DOM_PARSER']);
    assert.ok(justification.length > 20);
    offscreen.created += 1;
    offscreen.open = true;
  },
  async closeDocument() {
    offscreen.closed += 1;
    offscreen.open = false;
  },
};
fake.runtime.getURL = (path) => `chrome-extension://ebs-test/${path}`;
fake.runtime.getContexts = async ({ contextTypes }) => (contextTypes.includes('OFFSCREEN_DOCUMENT') && offscreen.open ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []);
fake.runtime.openOptionsPage = async () => { offscreen.optionsOpened = (offscreen.optionsOpened ?? 0) + 1; };
// chrome.runtime.sendMessage from the worker reaches extension pages: here,
// the offscreen document.
fake.runtime.sendMessage = async (message) => {
  if (!offscreen.open) throw new Error('Could not establish connection. Receiving end does not exist.');
  offscreen.messages.push(structuredClone(message));
  if (message.type === 'ai:offscreen:ping') return { ready: true };
  if (message.type === 'ai:offscreen:abort') {
    for (const pending of offscreen.pending.splice(0)) pending({ error: { code: 'aborted', status: null } });
    return {};
  }
  if (offscreen.answer === 'hold') return new Promise((resolve) => offscreen.pending.push(resolve));
  return offscreen.answer;
};

const { router } = await import('../src/background.js');
const { keys, publishView, stateOf } = await import('../src/bg/ai.js');

const TAB = { id: 7, url: 'https://secure20.e-boekhouden.nl/beheer/sjabloon/email/1' };
const frame = { tab: TAB, frameId: 0, id: 'ebs-test' };
const otherFrame = { tab: TAB, frameId: 3, id: 'ebs-test' };
const offscreenPage = { id: 'ebs-test', url: 'chrome-extension://ebs-test/src/offscreen/offscreen.html' };
// The settings page opens in a tab, so it has a sender.tab too.
const settingsPage = { id: 'ebs-test', tab: { id: 50, url: 'chrome-extension://ebs-test/src/options/options.html' }, url: 'chrome-extension://ebs-test/src/options/options.html' };
const KEY = 'sk-or-v1-secret-demo-key';
const REQUEST = {
  action: 'rewrite', option: 'formal', format: 'html', scope: 'all',
  content: '<p>Hierbij je factuur [FACTNUMMER].</p>', templateType: 'mail', variables: [['[FACTNUMMER]', 'Factuurnummer']],
};

async function configure({ on = true, key = KEY, model = 'anthropic/claude-sonnet-5.5', permission = true } = {}) {
  if (key) await keys.set('openrouter', key);
  await fake.storage.local.set({
    settings: { aiWriter: on },
    aiConfig: { provider: 'openrouter', models: { openrouter: model } },
  });
  if (permission) granted.add('https://openrouter.ai/*');
}

const run = (request = REQUEST, sender = frame, id = 'ai-1') => fake.dispatch({ type: 'ai:run', id, request }, sender);
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

beforeEach(async () => {
  await settle();
  fake.reset();
  idb.reset();
  granted.clear();
  Object.assign(offscreen, { open: false, created: 0, closed: 0, messages: [], answer: { result: { content: '<p>Bijgaand treft u factuur [FACTNUMMER] aan.</p>' } }, pending: [] });
});

test('a call goes to the offscreen document without the key; the page gets the answer and never the key', async () => {
  await configure();
  const answer = await run();
  assert.deepEqual(answer, { result: { content: '<p>Bijgaand treft u factuur [FACTNUMMER] aan.</p>' } });
  assert.equal(offscreen.created, 1);
  const call = offscreen.messages.find((message) => message.type === 'ai:offscreen:run');
  assert.equal(call.target, 'offscreen');
  assert.deepEqual(call.config, { provider: 'openrouter', model: 'anthropic/claude-sonnet-5.5' }, 'the offscreen document reads the key itself');
  assert.ok(!JSON.stringify(offscreen.messages).includes(KEY), 'no message to extension pages carries the key');
  assert.deepEqual(Object.keys(call.request).sort(), ['action', 'content', 'format', 'instruction', 'option', 'scope', 'subject', 'templateType', 'variables']);
  assert.ok(!JSON.stringify(answer).includes(KEY));

  await run(REQUEST, frame, 'ai-2');
  assert.equal(offscreen.created, 1, 'the open document is reused');
  assert.equal(offscreen.messages.filter((message) => message.type === 'ai:offscreen:run').length, 2, 'one model call per click');
});

test('nothing goes out when the switch is off, there is no key, no permission or no model', async () => {
  for (const [setup, code] of [[{ on: false }, 'off'], [{ key: '' }, 'nokey'], [{ permission: false }, 'permission'], [{ model: '' }, 'model']]) {
    fake.reset();
    idb.reset();
    granted.clear();
    await configure(setup);
    assert.deepEqual(await run(), { error: { code, status: null } }, code);
  }
  assert.equal(offscreen.created, 0);
  assert.deepEqual(offscreen.messages, []);
});

test('a malformed request is refused before anything else', async () => {
  await configure();
  for (const request of [{ ...REQUEST, action: 'send-mail' }, { ...REQUEST, content: 'x'.repeat(70_000) }, { ...REQUEST, variables: [['geen code', 'x']] }, null]) {
    assert.deepEqual(await run(request), { error: { code: 'invalid', status: null } });
  }
  assert.deepEqual(await fake.dispatch({ type: 'ai:run', id: 42, request: REQUEST }, frame), { error: { code: 'invalid', status: null } });
  assert.equal(offscreen.created, 0);
});

test('provider failures reach the page as a code and a status', async () => {
  await configure();
  offscreen.answer = { error: { code: 'auth', status: 401 } };
  assert.deepEqual(await run(), { error: { code: 'auth', status: 401 } });
  offscreen.answer = undefined;
  assert.deepEqual(await run(REQUEST, frame, 'ai-3'), { error: { code: 'unavailable', status: null } });
});

test('one call per frame at a time; Stoppen aborts it in the offscreen document', async () => {
  await configure();
  offscreen.answer = 'hold';
  const first = run();
  await settle();
  assert.deepEqual(await run(REQUEST, frame, 'ai-2'), { error: { code: 'busy', status: null } });
  assert.deepEqual(await fake.dispatch({ type: 'ai:abort', id: 'other' }, frame), { aborted: false }, 'only its own call');
  assert.deepEqual(await fake.dispatch({ type: 'ai:abort', id: 'ai-1' }, otherFrame), { aborted: false }, 'not from another frame');
  assert.deepEqual(await fake.dispatch({ type: 'ai:abort', id: 'ai-1' }, frame), { aborted: true });
  assert.deepEqual(await first, { error: { code: 'aborted', status: null } });
  const abort = offscreen.messages.find((message) => message.type === 'ai:offscreen:abort');
  const call = offscreen.messages.find((message) => message.type === 'ai:offscreen:run');
  assert.equal(abort.id, call.id);
});

test('the idle document is closed, but not while a call runs; only extension pages may say so', async () => {
  await configure();
  await run();
  assert.equal(offscreen.open, true);
  assert.equal(await fake.deliver({ type: 'ai:idle' }, frame), undefined, 'a page cannot close it');
  offscreen.answer = 'hold';
  const pending = run(REQUEST, frame, 'ai-2');
  await settle();
  await fake.deliver({ type: 'ai:idle' }, offscreenPage);
  assert.equal(offscreen.closed, 0);
  await fake.dispatch({ type: 'ai:abort', id: 'ai-2' }, frame);
  await pending;
  await fake.deliver({ type: 'ai:idle' }, offscreenPage);
  assert.equal(offscreen.closed, 1);
});

test('ai:settings opens the settings page; ai:run is for pages only', async () => {
  await fake.dispatch({ type: 'ai:settings' }, frame);
  assert.equal(offscreen.optionsOpened, 1);
  assert.equal(await fake.deliver({ type: 'ai:run', id: 'x', request: REQUEST }, offscreenPage), undefined);
});

test('aiView follows the key, the model, the permission and the last test, without the key', async () => {
  assert.equal(stateOf({ hasKey: false, model: 'm' }, true), 'nokey');
  assert.equal(stateOf({ hasKey: true, model: 'm' }, false), 'permission');
  assert.equal(stateOf({ hasKey: true, model: 'm', status: { ok: false, code: 'auth' } }, true), 'rejected');
  assert.equal(stateOf({ hasKey: true, model: 'm', status: { ok: false, code: 'rate' } }, true), 'ready');
  assert.equal(stateOf({ hasKey: true, model: '' }, true), 'nomodel');

  await configure();
  await settle();
  const { aiView } = await chrome.storage.local.get('aiView');
  assert.deepEqual(aiView, { state: 'ready', provider: 'openrouter', providerLabel: 'OpenRouter', model: 'anthropic/claude-sonnet-5.5' });
  assert.ok(!JSON.stringify(aiView).includes(KEY));

  granted.clear();
  for (const listener of permissionListeners.removed) listener({ origins: ['https://openrouter.ai/*'] });
  await settle();
  assert.equal((await chrome.storage.local.get('aiView')).aiView.state, 'permission');

  granted.add('https://openrouter.ai/*');
  await publishView();
  await keys.remove('openrouter');
  assert.deepEqual(await fake.dispatch({ type: 'ai:keys' }, frame), {}, 'a page may ask, but changes nothing');
  assert.equal((await chrome.storage.local.get('aiView')).aiView.state, 'ready');
  await fake.dispatch({ type: 'ai:keys' }, settingsPage);
  assert.equal((await chrome.storage.local.get('aiView')).aiView.state, 'nokey', 'the settings page says the key is gone');
  assert.equal((await publishView()).state, 'nokey');
});
