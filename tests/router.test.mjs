// The service worker's message router (background.js): feature modules in
// src/bg/ register their own types; long handlers can stay out of the mutex.
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeChrome } from './fake-chrome.mjs';

const fake = createFakeChrome();
const { router } = await import('../src/background.js');
const ai = await import('../src/bg/ai.js');
const requests = await import('../src/bg/requests.js');

const TAB = { id: 7, url: 'https://secure.e-boekhouden.nl/bh/' };
const fromTab = { tab: TAB, frameId: 0, id: 'ebs-test' };
const fromPopup = { id: 'ebs-test', url: 'chrome-extension://ebs-test/src/popup/popup.html' };

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  fake.reset();
  fake.tabs = [TAB];
});

test('the feature modules plug in through register(router) and add nothing yet', () => {
  assert.equal(typeof ai.register, 'function');
  assert.equal(typeof requests.register, 'function');
  assert.throws(() => router.on('top:title', () => ({})), /already registered/, 'no feature can take over a built-in type');
});

test('a handler that opts out of the mutex answers while a serialized one holds it', async () => {
  const hold = deferred();
  const order = [];
  router.on('test:hold', async () => {
    await hold.promise;
    order.push('hold');
    return { held: true };
  });
  router.on('test:after', () => {
    order.push('after');
    return { after: true };
  });
  router.on('test:long-ai-call', () => {
    order.push('free');
    return { free: true };
  }, { serialized: false });

  const held = fake.dispatch({ type: 'test:hold' }, fromTab);
  const after = fake.dispatch({ type: 'test:after' }, fromTab);
  assert.deepEqual(await fake.dispatch({ type: 'test:long-ai-call' }, fromTab), { free: true });
  assert.deepEqual(order, ['free'], 'the serialized ones still wait');
  hold.resolve();
  assert.deepEqual(await held, { held: true });
  assert.deepEqual(await after, { after: true });
  assert.deepEqual(order, ['free', 'hold', 'after'], 'serialized handlers keep their order');
});

test('who may send what: tabs by default, extension pages only when allowed', async () => {
  router.on('test:tab-only', () => ({ ok: 1 }));
  router.on('test:pages-too', () => ({ ok: 2 }), { fromExtension: true });
  router.on('test:pages-only', () => ({ ok: 3 }), { fromTab: false, fromExtension: true });
  assert.deepEqual(await fake.deliver({ type: 'test:tab-only' }, fromTab), { ok: 1 });
  assert.equal(await fake.deliver({ type: 'test:tab-only' }, fromPopup), undefined);
  assert.deepEqual(await fake.deliver({ type: 'test:pages-too' }, fromPopup), { ok: 2 });
  assert.equal(await fake.deliver({ type: 'test:pages-too' }, { id: 'other-extension' }), undefined);
  assert.equal(await fake.deliver({ type: 'test:pages-only' }, fromTab), undefined);
  assert.equal(await fake.deliver({ type: 'test:unknown' }, fromTab), undefined);
  // The popup still reaches its own built-in types.
  assert.deepEqual(await fake.deliver({ type: 'switcher:remove', slotId: 'none' }, fromPopup), {});
  assert.equal(await fake.deliver({ type: 'top:title', title: 'X' }, fromPopup), undefined);
});

test('a handler that throws answers with an error, also outside the mutex', async () => {
  router.on('test:boom', () => {
    throw new Error('kapot');
  }, { serialized: false });
  const errors = console.error;
  console.error = () => {};
  assert.match((await fake.dispatch({ type: 'test:boom' }, fromTab)).error, /kapot/);
  console.error = errors;
});

test('the worker takes its setting defaults from shared.js', async () => {
  const { EBS } = globalThis;
  assert.equal(EBS.SETTINGS_DEFAULTS.popupDialogs, false);
  assert.equal(EBS.SETTINGS_DEFAULTS.aiWriter, false);
});
