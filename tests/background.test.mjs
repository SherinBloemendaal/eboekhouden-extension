import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeChrome } from './fake-chrome.mjs';

const fake = createFakeChrome();
await import('../src/background.js');

const TAB = { id: 7, url: 'https://secure.e-boekhouden.nl/bh/' };
const top = { tab: TAB, frameId: 0 };
const main = { tab: TAB, frameId: 3 };
const inner = { tab: TAB, frameId: 4 };

function cookie(name, value, domain = 'secure.e-boekhouden.nl', extra = {}) {
  return { name, value, domain, hostOnly: !domain.startsWith('.'), path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: true, storeId: '0', ...extra };
}

function jarValues() {
  return Object.fromEntries(fake.jar.map((entry) => [entry.name, entry.value]));
}

beforeEach(() => {
  fake.reset();
  fake.tabs = [TAB];
});

test('logging in registers the administration as a slot and stores its cookies in session storage only', async () => {
  fake.jar = [cookie('ASPSESSIONIDAAA', 'demo-a'), cookie('EBSRV', 'secure.e-boekhouden.nl', '.e-boekhouden.nl')];
  await fake.dispatch({ type: 'top:title', title: 'Voorbeeld B.V.' }, top);

  const slots = (await chrome.storage.local.get('slots')).slots;
  assert.equal(slots.length, 1);
  assert.equal(slots[0].label, 'Voorbeeld B.V.');
  assert.ok(!JSON.stringify(fake.storage.local.dump()).includes('demo-a'), 'no cookie values in local storage');

  const session = fake.storage.session.dump();
  assert.equal(session[`cookies:${slots[0].id}`].length, 2);
  assert.equal(session.activeSlotId, slots[0].id);
});

test('the login screen title does not create a slot', async () => {
  await fake.dispatch({ type: 'top:title', title: 'Inloggen | e-Boekhouden.nl' }, top);
  assert.equal((await chrome.storage.local.get('slots')).slots, undefined);
  assert.equal(fake.storage.session.dump().loggedIn, false);
});

test('switching swaps the cookie jar and reloads e-Boekhouden tabs', async () => {
  fake.jar = [cookie('ASPSESSIONIDAAA', 'demo-a')];
  await fake.dispatch({ type: 'top:title', title: 'Voorbeeld B.V.' }, top);

  await fake.dispatch({ type: 'switcher:add', origin: 'https://secure.e-boekhouden.nl' }, main);
  assert.deepEqual(fake.jar, [], 'adding a session starts from an empty jar');
  assert.equal(fake.updates.at(-1).url, 'https://secure.e-boekhouden.nl/bh/');

  fake.jar = [cookie('ASPSESSIONIDBBB', 'demo-b')];
  await fake.dispatch({ type: 'top:title', title: 'Demo Holding B.V.' }, top);

  const slots = (await chrome.storage.local.get('slots')).slots;
  assert.deepEqual(slots.map((slot) => slot.label), ['Voorbeeld B.V.', 'Demo Holding B.V.']);

  await fake.dispatch({ type: 'switcher:switch', slotId: slots[0].id, origin: 'https://secure.e-boekhouden.nl' }, main);
  assert.deepEqual(jarValues(), { ASPSESSIONIDAAA: 'demo-a' });

  await fake.dispatch({ type: 'switcher:switch', slotId: slots[1].id, origin: 'https://secure.e-boekhouden.nl' }, main);
  assert.deepEqual(jarValues(), { ASPSESSIONIDBBB: 'demo-b' });
});

test('switching keeps host-only cookies host-only and domain cookies on the domain', async () => {
  fake.jar = [cookie('ASPSESSIONIDAAA', 'demo-a'), cookie('EBSRV', 'secure.e-boekhouden.nl', '.e-boekhouden.nl', { hostOnly: false })];
  await fake.dispatch({ type: 'top:title', title: 'Voorbeeld B.V.' }, top);
  const [slot] = (await chrome.storage.local.get('slots')).slots;

  await fake.dispatch({ type: 'switcher:add', origin: 'https://secure.e-boekhouden.nl' }, main);
  await fake.dispatch({ type: 'switcher:switch', slotId: slot.id, origin: 'https://secure.e-boekhouden.nl' }, main);

  const session = fake.jar.find((entry) => entry.name === 'ASPSESSIONIDAAA');
  const shared = fake.jar.find((entry) => entry.name === 'EBSRV');
  assert.equal(session.hostOnly, true);
  assert.equal(session.domain, 'secure.e-boekhouden.nl');
  assert.equal(shared.domain, '.e-boekhouden.nl');
});

test('expired cookies are not restored', async () => {
  const past = Date.now() / 1000 - 60;
  fake.jar = [cookie('ASPSESSIONIDAAA', 'demo-a'), cookie('OLD', 'x', 'secure.e-boekhouden.nl', { session: false, expirationDate: past })];
  await fake.dispatch({ type: 'top:title', title: 'Voorbeeld B.V.' }, top);
  const [slot] = (await chrome.storage.local.get('slots')).slots;
  await fake.dispatch({ type: 'switcher:switch', slotId: slot.id, origin: 'https://secure.e-boekhouden.nl' }, main);
  assert.deepEqual(Object.keys(jarValues()), ['ASPSESSIONIDAAA']);
});

test('the view model sent to pages carries labels and flags, never cookie values', async () => {
  fake.jar = [cookie('ASPSESSIONIDAAA', 'secret-demo-value')];
  await fake.dispatch({ type: 'top:title', title: 'Voorbeeld B.V.' }, top);
  const view = await fake.dispatch({ type: 'state:get' }, main);
  assert.equal(view.activeLabel, 'Voorbeeld B.V.');
  assert.equal(view.slots[0].ready, true);
  assert.ok(!JSON.stringify(view).includes('secret-demo-value'));
});

test('after an expired session the first app page is sent back to the page the user was on', async () => {
  const page = 'https://secure20.e-boekhouden.nl/v1page?url=bh/demo.asp';
  assert.deepEqual(await fake.dispatch({ type: 'main:page', url: page, kind: 'app' }, main), { headerPresent: false });

  const login = await fake.dispatch({ type: 'main:page', url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', kind: 'login' }, main);
  assert.equal(login.relogin, true);

  const start = await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/welkom', kind: 'app' }, main);
  assert.equal(start.navigate, page);

  const back = await fake.dispatch({ type: 'main:page', url: page, kind: 'app' }, main);
  assert.equal(back.navigate, undefined, 'only one redirect');
});

test('the inner classic page is restored after the shell page', async () => {
  const page = 'https://secure20.e-boekhouden.nl/v1page?url=bh/demo.asp';
  await fake.dispatch({ type: 'main:page', url: page, kind: 'app' }, main);
  await fake.dispatch({ type: 'inner:page', url: 'https://secure.e-boekhouden.nl/bh/demo.asp?ID=2', kind: 'app' }, inner);
  await fake.dispatch({ type: 'main:page', url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', kind: 'login' }, main);
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/welkom', kind: 'app' }, main);
  await fake.dispatch({ type: 'main:page', url: page, kind: 'app' }, main);

  const restored = await fake.dispatch({ type: 'inner:page', url: 'https://secure.e-boekhouden.nl/bh/demo.asp', kind: 'app' }, inner);
  assert.equal(restored.navigate, 'https://secure.e-boekhouden.nl/bh/demo.asp?ID=2');
});

test('a voluntary logout does not turn the next login into a re-login', async () => {
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/welkom', kind: 'app' }, main);
  await fake.dispatch({ type: 'main:page', url: 'https://secure.e-boekhouden.nl/bh/uitloggen.asp', kind: 'logout' }, main);
  const login = await fake.dispatch({ type: 'main:page', url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', kind: 'login' }, main);
  assert.equal(login.relogin, false);
});

test('cancelling the dialog drops the return page', async () => {
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/demo', kind: 'app' }, main);
  await fake.dispatch({ type: 'main:page', url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', kind: 'login' }, main);
  await fake.dispatch({ type: 'relogin:cancel' }, main);
  const start = await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/welkom', kind: 'app' }, main);
  assert.equal(start.navigate, undefined);
});

test('the login form inside the secure20 frame gets the re-login dialog', async () => {
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/v1page?url=bh/demo.asp', kind: 'app' }, main);
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/v1login', kind: 'login' }, main);
  const login = await fake.dispatch({ type: 'inner:page', url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', kind: 'login' }, inner);
  assert.equal(login.relogin, true);
  assert.deepEqual(fake.sent, [], 'the form stays where e-Boekhouden put it');
});

test('switching to a stored session enters the app, not the login frameset', async () => {
  fake.jar = [cookie('ASPSESSIONIDAAA', 'demo-a')];
  await fake.dispatch({ type: 'top:title', title: 'Voorbeeld B.V.' }, top);
  const [slot] = (await chrome.storage.local.get('slots')).slots;
  await fake.dispatch({ type: 'switcher:switch', slotId: slot.id, origin: 'https://secure.e-boekhouden.nl' }, main);
  assert.equal(fake.updates.at(-1).url, 'https://secure.e-boekhouden.nl/bh?v2Url=https%3A%2F%2Fsecure20.e-boekhouden.nl%2F');
});

test('switching to a session without stored cookies opens the login screen', async () => {
  await chrome.storage.local.set({ slots: [{ id: 'x', title: 'Studio Noord', label: 'Studio Noord' }] });
  await fake.dispatch({ type: 'switcher:switch', slotId: 'x', origin: 'https://secure.e-boekhouden.nl' }, main);
  assert.equal(fake.updates.at(-1).url, 'https://secure.e-boekhouden.nl/bh/');
});

test('switching clears pending re-login returns so the new administration starts fresh', async () => {
  fake.jar = [cookie('ASPSESSIONIDAAA', 'demo-a')];
  await fake.dispatch({ type: 'top:title', title: 'Voorbeeld B.V.' }, top);
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/demo', kind: 'app' }, main);
  const [slot] = (await chrome.storage.local.get('slots')).slots;
  await fake.dispatch({ type: 'switcher:switch', slotId: slot.id, origin: 'https://secure.e-boekhouden.nl' }, main);
  const login = await fake.dispatch({ type: 'main:page', url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', kind: 'login' }, main);
  assert.equal(login.relogin, false);
});

test('rename changes the label but keeps matching on the administration title', async () => {
  fake.jar = [cookie('ASPSESSIONIDAAA', 'demo-a')];
  await fake.dispatch({ type: 'top:title', title: 'Voorbeeld B.V.' }, top);
  const [slot] = (await chrome.storage.local.get('slots')).slots;
  await fake.dispatch({ type: 'switcher:rename', slotId: slot.id, label: 'Voorbeeld' }, main);
  await fake.dispatch({ type: 'top:title', title: 'Voorbeeld B.V.' }, top);
  const slots = (await chrome.storage.local.get('slots')).slots;
  assert.equal(slots.length, 1);
  assert.equal(slots[0].label, 'Voorbeeld');
});
