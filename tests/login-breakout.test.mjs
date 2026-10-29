// Service worker side of the login breakout (login-breakout.js + background.patch).
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeChrome } from './fake-chrome.mjs';

const fake = createFakeChrome();
await import('../src/background.js');

const ORIGIN = 'https://secure.e-boekhouden.nl';
const V2 = 'https://secure20.e-boekhouden.nl';
const APP = `${ORIGIN}/bh?v2Url=${encodeURIComponent(`${V2}/`)}`;
const TAB = { id: 7, url: `${ORIGIN}/bh/` };
const top = { tab: TAB, frameId: 0 };
const main = { tab: TAB, frameId: 3 };

const page = (url, kind, sender = main) => fake.dispatch({ type: 'main:page', url, kind }, sender);
const host = (active) => fake.dispatch({ type: 'login:host', active }, top);

beforeEach(() => {
  fake.reset();
  fake.tabs = [TAB];
});

test('a secure20 login screen in mainframe asks the top frame to swap the frameset', async () => {
  await host(false);
  await page(`${V2}/v1login?EBM=&v2rnd=1`, 'login');
  assert.deepEqual(fake.sent, [{ tabId: 7, message: { type: 'login:swap' }, options: { frameId: 0 } }]);
});

test('in breakout mode the login iframe is not asked to swap again', async () => {
  await host(true);
  await page(`${V2}/v1login`, 'login');
  assert.deepEqual(fake.sent, []);
});

test('the first app page in the login iframe opens the app through the hybrid route', async () => {
  await host(true);
  const response = await page(`${ORIGIN}/bh/welkom.asp`, 'app');
  assert.deepEqual(response, { navigating: true });
  assert.deepEqual(fake.updates, [{ tabId: 7, url: APP }]);
});

test('inloggen.asp without a form (already logged in, or a login answer) opens the app once', async () => {
  await host(true);
  await fake.dispatch({ type: 'login:done', url: `${ORIGIN}/bh/inloggen.asp?LOGIN=1` }, main);
  await fake.dispatch({ type: 'login:done', url: `${ORIGIN}/bh/inloggen.asp?LOGIN=1` }, main);
  assert.equal(fake.updates.length, 1, 'breakout mode ends with the first app entry');
});

test('the forgotten-password page inside the login iframe is not a login', async () => {
  await host(true);
  await page(`${V2}/overig/vergeten?v2rnd=1`, 'app');
  assert.deepEqual(fake.updates, []);
});

test('the re-login return survives the breakout and is honoured in the restored frameset', async () => {
  const inAppPage = `${V2}/boekhouden/overzicht`;
  await host(false);
  await page(inAppPage, 'app');
  const login = await page(`${V2}/v1login`, 'login');
  assert.equal(login.relogin, true);
  assert.equal(fake.sent.at(-1).message.type, 'login:swap');

  await host(true);
  const dialog = await page(`${ORIGIN}/bh/inloggen.asp`, 'login');
  assert.equal(dialog.relogin, true, 'the dialog shows in the breakout iframe');

  await page(`${ORIGIN}/bh/inloggen.asp?LOGIN=1`, 'app');
  assert.equal(fake.updates.at(-1).url, `${ORIGIN}/bh?v2Url=${encodeURIComponent(inAppPage)}`);

  // The restored frameset reports its first app page: the return still applies.
  await host(false);
  const back = await page(`${inAppPage}?v2rnd=2`, 'app');
  assert.equal(back.navigate, inAppPage);
});

test('a classic return page enters through the app start and is restored by the frameset', async () => {
  const classic = `${ORIGIN}/bh/facturen.asp`;
  await host(false);
  await page(classic, 'app');
  await page(`${V2}/v1login`, 'login');
  await host(true);
  await page(`${ORIGIN}/bh/inloggen.asp?LOGIN=1`, 'app');
  assert.equal(fake.updates.at(-1).url, APP, 'a secure.* page cannot be a v2Url');
  await host(false);
  const back = await page(`${V2}/`, 'app');
  assert.equal(back.navigate, classic);
});

test('bouncing between login iframe and app entry stops after two rounds', async () => {
  for (let round = 0; round < 3; round += 1) {
    await host(true);
    await page(`${ORIGIN}/bh/inloggen.asp?LOGIN=1`, 'app');
  }
  assert.equal(fake.updates.length, 2);
});

test('a fresh top load resets breakout mode and the loop counter', async () => {
  await host(true);
  await page(`${ORIGIN}/bh/inloggen.asp?LOGIN=1`, 'app');
  await host(false);
  await host(false);
  const state = fake.storage.session.dump()['tab:7'];
  assert.equal(state.loginHost, false);
  assert.deepEqual(state.loginDone, []);
});
