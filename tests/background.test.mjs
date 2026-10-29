import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeChrome } from './fake-chrome.mjs';

const fake = createFakeChrome();
const { isReadOnlyPage, isGenericTitle } = await import('../src/background.js');

const ORIGIN = 'https://secure.e-boekhouden.nl';
const APP = `${ORIGIN}/bh?v2Url=https%3A%2F%2Fsecure20.e-boekhouden.nl%2F`;
const TAB = { id: 7, url: `${ORIGIN}/bh/` };
const top = { tab: TAB, frameId: 0 };
const main = { tab: TAB, frameId: 3 };
const inner = { tab: TAB, frameId: 4 };

function cookie(name, value, domain = 'secure.e-boekhouden.nl', extra = {}) {
  return { name, value, domain, hostOnly: !domain.startsWith('.'), path: '/', secure: true, httpOnly: true, sameSite: 'lax', session: true, storeId: '0', ...extra };
}

const jarValues = () => Object.fromEntries(fake.jar.map((entry) => [entry.name, entry.value]));
const slots = async () => (await chrome.storage.local.get('slots')).slots ?? [];
const view = async () => (await chrome.storage.local.get('view')).view;

async function loginAs(name, cookies) {
  fake.jar = cookies;
  await fake.dispatch({ type: 'top:title', title: name }, top);
  return (await slots()).find((slot) => slot.name === name);
}

beforeEach(() => {
  fake.reset();
  fake.tabs = [TAB];
});

test('logging in registers the administration and keeps its cookies in session storage only', async () => {
  const slot = await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a'), cookie('EBSRV', 'secure.e-boekhouden.nl', '.e-boekhouden.nl')]);
  assert.equal(slot.name, 'Voorbeeld B.V.');
  assert.equal(fake.storage.session.dump()[`cookies:${slot.id}`].length, 2);
  assert.ok(!JSON.stringify(fake.storage.local.dump()).includes('demo-a'), 'no cookie values in local storage');
  assert.deepEqual(await view(), { activeSlotId: slot.id, loggedIn: true, ready: [slot.id] });
});

test('the login screen title does not create a slot', async () => {
  await fake.dispatch({ type: 'top:title', title: 'Inloggen | e-Boekhouden.nl' }, top);
  assert.deepEqual(await slots(), []);
});

test('opening /bh/ in another tab while logged in does not end or expire the session', async () => {
  const slot = await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a')]);
  await fake.dispatch({ type: 'top:title', title: 'Inloggen | e-Boekhouden.nl' }, top);
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/v1login', kind: 'login' }, main);
  await fake.dispatch({ type: 'inner:page', url: `${ORIGIN}/bh/inloggen.asp`, kind: 'already' }, inner);
  assert.equal((await slots())[0].expired, false);
  assert.deepEqual(await view(), { activeSlotId: slot.id, loggedIn: true, ready: [slot.id] });
});

test('the header number is stored for the active administration only', async () => {
  const slot = await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a')]);
  await fake.dispatch({ type: 'header:identity', name: 'Andere B.V.', number: '1000009' }, main);
  assert.equal((await slots())[0].number, null);
  await fake.dispatch({ type: 'header:identity', name: 'Voorbeeld B.V.', number: '1000001' }, main);
  assert.equal((await slots()).find((entry) => entry.id === slot.id).number, '1000001');
  await fake.dispatch({ type: 'header:identity', name: 'Voorbeeld B.V.', number: '<b>1</b>' }, main);
  assert.equal((await slots())[0].number, '1000001', 'non-numeric numbers are ignored');
});

test('switching swaps the cookie jar and opens the app in every e-Boekhouden tab', async () => {
  const first = await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a')]);
  await fake.dispatch({ type: 'switcher:add', origin: ORIGIN }, main);
  assert.deepEqual(fake.jar, [], 'adding a session starts from an empty jar');
  assert.equal(fake.updates.at(-1).url, `${ORIGIN}/bh/`);

  const second = await loginAs('Demo Holding B.V.', [cookie('ASPSESSIONIDBBB', 'demo-b')]);
  await fake.dispatch({ type: 'switcher:switch', slotId: first.id, origin: ORIGIN }, main);
  assert.deepEqual(jarValues(), { ASPSESSIONIDAAA: 'demo-a' });
  assert.equal(fake.updates.at(-1).url, APP);

  await fake.dispatch({ type: 'switcher:switch', slotId: second.id, origin: ORIGIN }, main);
  assert.deepEqual(jarValues(), { ASPSESSIONIDBBB: 'demo-b' });
});

test('with other e-Boekhouden tabs open a switch asks first', async () => {
  const slot = await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a')]);
  fake.tabs = [TAB, { id: 8, url: `${ORIGIN}/bh/` }];
  const ask = await fake.dispatch({ type: 'switcher:switch', slotId: slot.id, origin: ORIGIN }, main);
  assert.deepEqual(ask, { needsConfirm: true, tabCount: 2 });
  assert.deepEqual(fake.updates, [], 'nothing reloads before the answer');
  await fake.dispatch({ type: 'switcher:switch', slotId: slot.id, origin: ORIGIN, confirmed: true }, main);
  assert.equal(fake.updates.length, 2);
});

test('switching to a session without stored cookies opens the login screen', async () => {
  await chrome.storage.local.set({ slots: [{ id: 'x', name: 'Studio Noord', number: null, expired: false }] });
  await fake.dispatch({ type: 'switcher:switch', slotId: 'x', origin: ORIGIN }, main);
  assert.equal(fake.updates.at(-1).url, `${ORIGIN}/bh/`);
});

test('host-only cookies stay host-only and domain cookies stay on the domain', async () => {
  const slot = await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a'), cookie('EBSRV', 'secure.e-boekhouden.nl', '.e-boekhouden.nl')]);
  await fake.dispatch({ type: 'switcher:add', origin: ORIGIN }, main);
  await fake.dispatch({ type: 'switcher:switch', slotId: slot.id, origin: ORIGIN }, main);
  assert.equal(fake.jar.find((entry) => entry.name === 'ASPSESSIONIDAAA').hostOnly, true);
  assert.equal(fake.jar.find((entry) => entry.name === 'EBSRV').domain, '.e-boekhouden.nl');
});

test('cookies that already expired are not restored', async () => {
  const past = Date.now() / 1000 - 60;
  const slot = await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a'), cookie('OLD', 'x', 'secure.e-boekhouden.nl', { session: false, expirationDate: past })]);
  await fake.dispatch({ type: 'switcher:switch', slotId: slot.id, origin: ORIGIN }, main);
  assert.deepEqual(Object.keys(jarValues()), ['ASPSESSIONIDAAA']);
});

test('a session that drops to the login page while in use is marked expired', async () => {
  const slot = await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a')]);
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/welkom', kind: 'app' }, main);
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/v1login', kind: 'login' }, main);
  assert.equal((await slots())[0].expired, false, 'the shell alone proves nothing');
  await fake.dispatch({ type: 'inner:page', url: `${ORIGIN}/bh/inloggen.asp`, kind: 'login' }, inner);
  assert.equal((await slots())[0].expired, true);
  assert.deepEqual((await view()).ready, [], 'its dead cookies are dropped');
  assert.equal(fake.storage.session.dump()[`cookies:${slot.id}`], undefined);

  await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a2')]);
  assert.equal((await slots())[0].expired, false, 'logging in again clears it');
});

test('a switch that lands on the login screen marks that session expired', async () => {
  const slot = await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a')]);
  await fake.dispatch({ type: 'switcher:add', origin: ORIGIN }, main);
  await fake.dispatch({ type: 'switcher:switch', slotId: slot.id, origin: ORIGIN }, main);
  await fake.dispatch({ type: 'top:title', title: 'Inloggen | e-Boekhouden.nl' }, top);
  assert.equal((await slots())[0].expired, true);
});

test('a logout ends the session without marking it expired', async () => {
  const slot = await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a')]);
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/v1page?url=bh/uitloggen.asp', kind: 'app' }, main);
  await fake.dispatch({ type: 'inner:page', url: `${ORIGIN}/bh/uitloggen.asp`, kind: 'logout' }, inner);
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/v1login', kind: 'login' }, main);
  assert.equal((await slots())[0].expired, false);
  assert.equal(fake.storage.session.dump()[`cookies:${slot.id}`], undefined);
});

test('profile pictures are validated and removed with their session', async () => {
  const slot = await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a')]);
  const picture = 'data:image/webp;base64,UklGRhIAAABXRUJQ';
  assert.deepEqual(await fake.dispatch({ type: 'avatar:set', slotId: slot.id, dataUrl: picture }, main), {});
  assert.equal((await chrome.storage.local.get(`avatar:${slot.id}`))[`avatar:${slot.id}`], picture);

  const bad = await fake.dispatch({ type: 'avatar:set', slotId: slot.id, dataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' }, main);
  assert.equal(bad.error, 'invalid image');
  const injection = await fake.dispatch({ type: 'avatar:set', slotId: slot.id, dataUrl: 'data:image/png;base64,AA") } * { color: red' }, main);
  assert.equal(injection.error, 'invalid image');
  const big = await fake.dispatch({ type: 'avatar:set', slotId: slot.id, dataUrl: `data:image/png;base64,${'A'.repeat(100 * 1024)}` }, main);
  assert.equal(big.error, 'invalid image');

  await fake.dispatch({ type: 'switcher:remove', slotId: slot.id }, main);
  assert.equal((await chrome.storage.local.get(`avatar:${slot.id}`))[`avatar:${slot.id}`], undefined);
  assert.deepEqual(await slots(), []);
});

test('after an expired session the first app page is sent back to the page the user was on', async () => {
  const page = 'https://secure20.e-boekhouden.nl/v1page?url=bh/demo.asp';
  await fake.dispatch({ type: 'main:page', url: page, kind: 'app' }, main);
  const login = await fake.dispatch({ type: 'inner:page', url: `${ORIGIN}/bh/inloggen.asp`, kind: 'login' }, inner);
  assert.equal(login.relogin, true);
  const start = await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/welkom', kind: 'app' }, main);
  assert.equal(start.navigate, page);
  const back = await fake.dispatch({ type: 'main:page', url: page, kind: 'app' }, main);
  assert.equal(back.navigate, undefined, 'only one redirect');
});

test('the inner classic page is restored after the shell page', async () => {
  const page = 'https://secure20.e-boekhouden.nl/v1page?url=bh/demo.asp';
  await fake.dispatch({ type: 'main:page', url: page, kind: 'app' }, main);
  await fake.dispatch({ type: 'inner:page', url: `${ORIGIN}/bh/demo.asp?ID=2`, kind: 'app' }, inner);
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/v1login', kind: 'login' }, main);
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/welkom', kind: 'app' }, main);
  await fake.dispatch({ type: 'main:page', url: page, kind: 'app' }, main);
  const restored = await fake.dispatch({ type: 'inner:page', url: `${ORIGIN}/bh/demo.asp`, kind: 'app' }, inner);
  assert.equal(restored.navigate, `${ORIGIN}/bh/demo.asp?ID=2`);
});

test('cancelling the dialog drops the return page', async () => {
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/demo', kind: 'app' }, main);
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/v1login', kind: 'login' }, main);
  await fake.dispatch({ type: 'relogin:cancel' }, main);
  const start = await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/welkom', kind: 'app' }, main);
  assert.equal(start.navigate, undefined);
});

test('switching clears pending re-login returns so the new administration starts fresh', async () => {
  const slot = await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a')]);
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/demo', kind: 'app' }, main);
  await fake.dispatch({ type: 'switcher:switch', slotId: slot.id, origin: ORIGIN }, main);
  const login = await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/v1login', kind: 'login' }, main);
  assert.equal(login.relogin, false);
});

test('pages never get cookie values: only the mirrored view', async () => {
  await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'secret-demo-value')]);
  assert.ok(!JSON.stringify(fake.storage.local.dump()).includes('secret-demo-value'));
});

test('a logout keeps the entry, its number and picture; only the bin removes it', async () => {
  const slot = await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a')]);
  await fake.dispatch({ type: 'header:identity', name: 'Voorbeeld B.V.', number: '1000001' }, main);
  await fake.dispatch({ type: 'avatar:set', slotId: slot.id, dataUrl: 'data:image/webp;base64,UklGRhIAAABXRUJQ' }, main);

  // Power button in the new design: the shell loads uitloggen.asp inside its frame.
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/v1page?url=bh/uitloggen.asp', kind: 'app' }, main);
  await fake.dispatch({ type: 'inner:page', url: `${ORIGIN}/bh/uitloggen.asp`, kind: 'logout' }, inner);
  // Legacy design and the login iframe: uitloggen.asp straight in mainframe.
  await fake.dispatch({ type: 'main:page', url: `${ORIGIN}/bh/uitloggen.asp`, kind: 'logout' }, main);

  const [kept] = await slots();
  assert.equal(kept.id, slot.id);
  assert.equal(kept.name, 'Voorbeeld B.V.');
  assert.equal(kept.number, '1000001');
  assert.equal(kept.expired, false, 'a deliberate logout is not Verlopen');
  assert.ok((await chrome.storage.local.get(`avatar:${slot.id}`))[`avatar:${slot.id}`]);
  assert.deepEqual(await view(), { activeSlotId: slot.id, loggedIn: false, ready: [] }, 'shown as Inloggen');

  // Logging in again lands on the same entry, picture included.
  await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a2')]);
  assert.equal((await slots()).length, 1);
  assert.equal((await view()).activeSlotId, slot.id);
});

test('entries saved by the first version (name kept as title) still match', async () => {
  await chrome.storage.local.set({ slots: [{ id: 'old', title: 'Voorbeeld B.V.', label: 'Voorbeeld B.V.' }] });
  await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a')]);
  const list = await slots();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'old');
  assert.equal(list[0].name, 'Voorbeeld B.V.');
});

const popup = { id: 'ebs-test' };

test('the username typed at login is kept with the entry, never anything else', async () => {
  await fake.dispatch({ type: 'login:username', username: '  sherin@example.test ' }, inner);
  const slot = await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a')]);
  assert.equal(slot.username, 'sherin@example.test');
  assert.equal(fake.storage.session.dump().pendingUsername, undefined, 'used once');
});

test('re-match: same username and administration number lands on the old entry, picture and all', async () => {
  await fake.dispatch({ type: 'login:username', username: 'user-a' }, inner);
  const old = await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a')]);
  await fake.dispatch({ type: 'header:identity', name: 'Voorbeeld B.V.', number: '1000001' }, main);
  await fake.dispatch({ type: 'avatar:set', slotId: old.id, dataUrl: 'data:image/webp;base64,UklGRhIAAABXRUJQ' }, main);

  // The administration was renamed in e-Boekhouden; same user, same number.
  await fake.dispatch({ type: 'login:username', username: 'user-a' }, inner);
  await loginAs('Voorbeeld Holding B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a2')]);
  assert.equal((await slots()).length, 2, 'a new name first makes a new entry');
  await fake.dispatch({ type: 'header:identity', name: 'Voorbeeld Holding B.V.', number: '1000001' }, main);

  const list = await slots();
  assert.equal(list.length, 1, 'merged on the number');
  assert.equal(list[0].id, old.id);
  assert.equal(list[0].name, 'Voorbeeld Holding B.V.');
  assert.equal((await view()).activeSlotId, old.id);
  assert.ok((await chrome.storage.local.get(`avatar:${old.id}`))[`avatar:${old.id}`], 'picture kept');
  assert.equal(fake.storage.session.dump()[`cookies:${old.id}`][0].value, 'demo-a2', 'the new session moved over');
});

test('re-match: one username with two administrations keeps them apart by number', async () => {
  await fake.dispatch({ type: 'login:username', username: 'user-a' }, inner);
  await loginAs('Voorbeeld B.V.', [cookie('ASPSESSIONIDAAA', 'demo-a')]);
  await fake.dispatch({ type: 'header:identity', name: 'Voorbeeld B.V.', number: '1000001' }, main);
  await fake.dispatch({ type: 'login:username', username: 'user-a' }, inner);
  await loginAs('Studio Noord', [cookie('ASPSESSIONIDBBB', 'demo-b')]);
  await fake.dispatch({ type: 'header:identity', name: 'Studio Noord', number: '1000002' }, main);
  assert.deepEqual((await slots()).map((slot) => [slot.name, slot.number]), [['Voorbeeld B.V.', '1000001'], ['Studio Noord', '1000002']]);
});

test('logging in for a logged-out entry from the popup opens the login page with that name', async () => {
  await chrome.storage.local.set({ slots: [{ id: 'x', name: 'Studio Noord', number: '1000002', expired: false }] });
  fake.tabs = [];
  await fake.dispatch({ type: 'switcher:switch', slotId: 'x' }, popup);
  assert.equal(fake.created.at(-1).url, `${ORIGIN}/bh/`, 'no e-Boekhouden tab open: one is opened');
  assert.equal(fake.storage.session.dump().pendingLoginFor, 'x');
  assert.deepEqual(await fake.dispatch({ type: 'login:context' }, inner), { pendingLoginFor: 'x', relogin: false });
});

test('the popup may only send its own actions', async () => {
  const answer = await Promise.race([
    fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/x', kind: 'app' }, popup),
    new Promise((resolve) => setTimeout(() => resolve('ignored'), 50)),
  ]);
  assert.equal(answer, 'ignored');
});

test('from the popup a switch asks first when it reloads a tab the user is not looking at', async () => {
  await chrome.storage.local.set({ slots: [{ id: 'x', name: 'Studio Noord', number: '1000002', expired: false }] });
  fake.tabs = [{ id: 7, url: `${ORIGIN}/bh/`, active: false }, { id: 3, url: 'https://example.org/', active: true }];
  const ask = await fake.dispatch({ type: 'switcher:switch', slotId: 'x' }, popup);
  assert.deepEqual(ask, { needsConfirm: true, tabCount: 1 });
  assert.deepEqual(fake.updates, [], 'nothing reloads before the answer');
});

test('from the popup over the only e-Boekhouden tab a switch goes straight through', async () => {
  await chrome.storage.local.set({ slots: [{ id: 'x', name: 'Studio Noord', number: '1000002', expired: false }] });
  fake.tabs = [{ ...TAB, active: true }];
  assert.deepEqual(await fake.dispatch({ type: 'switcher:switch', slotId: 'x' }, popup), {});
  assert.equal(fake.updates.length, 1);
});

test('in the page, the tab the click came from does not count as another tab', async () => {
  await chrome.storage.local.set({ slots: [{ id: 'x', name: 'Studio Noord', number: '1000002', expired: false }] });
  fake.tabs = [{ ...TAB, active: false }];
  assert.deepEqual(await fake.dispatch({ type: 'switcher:add', origin: ORIGIN }, main), {});
});

test('two quick switches run one after the other: one jar, nothing mixed', async () => {
  const domainCookie = (name, value) => cookie(name, value, '.e-boekhouden.nl', { hostOnly: false });
  await chrome.storage.local.set({ slots: [{ id: 'C', name: 'Current', number: '3' }, { id: 'A', name: 'Alpha', number: '1' }, { id: 'B', name: 'Beta', number: '2' }] });
  await chrome.storage.session.set({
    activeSlotId: 'C', loggedIn: true,
    'cookies:A': [cookie('ASPSESSIONIDA', 'a'), domainCookie('JWT', 'jwt-a')],
    'cookies:B': [cookie('ASPSESSIONIDB', 'b'), domainCookie('JWT', 'jwt-b')],
  });
  fake.jar = [cookie('ASPSESSIONIDC', 'c'), domainCookie('JWT', 'jwt-c')];
  await Promise.all([
    fake.dispatch({ type: 'switcher:switch', slotId: 'A', origin: ORIGIN }, main),
    fake.dispatch({ type: 'switcher:switch', slotId: 'B', origin: ORIGIN }, main),
  ]);
  assert.deepEqual(jarValues(), { ASPSESSIONIDB: 'b', JWT: 'jwt-b' });
  const stored = fake.storage.session.dump();
  assert.deepEqual(stored['cookies:C'].map((entry) => `${entry.name}=${entry.value}`), ['ASPSESSIONIDC=c', 'JWT=jwt-c']);
  assert.equal(stored.activeSlotId, 'B');
});

test('a login report next to a page report loses neither', async () => {
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/boekhouden/x', kind: 'app' }, main);
  await Promise.all([
    fake.dispatch({ type: 'main:page', url: `${ORIGIN}/bh/inloggen.asp`, kind: 'login' }, main),
    fake.dispatch({ type: 'login:host', active: true }, top),
  ]);
  const tab = fake.storage.session.dump()['tab:7'];
  assert.equal(tab.loginHost, true);
  assert.equal(tab.relogin, true);
});

test('the login page learns when the re-login dialog takes its form', async () => {
  await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/boekhouden/overzicht', kind: 'app' }, main);
  await fake.dispatch({ type: 'main:page', url: `${ORIGIN}/bh/inloggen.asp`, kind: 'login' }, main);
  assert.equal((await fake.dispatch({ type: 'login:context' }, main)).relogin, true);
  await fake.dispatch({ type: 'relogin:cancel' }, main);
  assert.equal((await fake.dispatch({ type: 'login:context' }, main)).relogin, false);
});

test('only plain page views count as safe to reopen', () => {
  assert.equal(isReadOnlyPage('https://secure20.e-boekhouden.nl/boekhouden/importeren'), true);
  assert.equal(isReadOnlyPage('https://secure20.e-boekhouden.nl/boekhouden/mutatie/0?imId=5&defBedrag=1.00'), true);
  assert.equal(isReadOnlyPage(`${ORIGIN}/bh/facturen.asp`), true);
  assert.equal(isReadOnlyPage(`${ORIGIN}/bh/facturen.asp?ID=12&PAGE=2`), true);
  assert.equal(isReadOnlyPage(`${ORIGIN}/bh/facturen.asp?ACTION=DELETE&ID=12`), false);
  assert.equal(isReadOnlyPage(`${ORIGIN}/bh/relatie.asp?NIEUW=1`), false, 'an unknown parameter is not clearly a view');
  assert.equal(isReadOnlyPage(`https://secure20.e-boekhouden.nl/v1page?url=${encodeURIComponent('/bh/x.asp?ACTION=DEL')}`), false);
  assert.equal(isReadOnlyPage('https://www.e-boekhouden.nl/'), false);
  assert.equal(isReadOnlyPage('not a url'), false);
});

test('after a re-login an action URL is offered as a link, not loaded again', async () => {
  const action = `${ORIGIN}/bh/facturen.asp?ACTION=DELETE&ID=12`;
  await fake.dispatch({ type: 'main:page', url: action, kind: 'app' }, main);
  await fake.dispatch({ type: 'main:page', url: `${ORIGIN}/bh/inloggen.asp`, kind: 'login' }, main);
  const back = await fake.dispatch({ type: 'main:page', url: 'https://secure20.e-boekhouden.nl/', kind: 'app' }, main);
  assert.deepEqual(back, { offerBack: action });
});

test('a username from a login that never finished does not stick to the next one', async () => {
  await fake.dispatch({ type: 'login:username', username: 'user-b' }, inner);
  fake.jar = [cookie('S', 'b')];
  await fake.dispatch({ type: 'top:title', title: 'Beta B.V.' }, top);
  await fake.dispatch({ type: 'header:identity', name: 'Beta B.V.', number: '2' }, main);
  await fake.dispatch({ type: 'switcher:add', origin: ORIGIN }, main);
  await fake.dispatch({ type: 'login:username', username: 'user-a' }, inner); // wrong password, no title follows
  const [beta] = await slots();
  await fake.dispatch({ type: 'switcher:switch', slotId: beta.id, origin: ORIGIN }, main);
  await fake.dispatch({ type: 'top:title', title: 'Beta B.V.' }, top);
  await fake.dispatch({ type: 'header:identity', name: 'Beta B.V.', number: '2' }, main);
  assert.equal((await slots()).length, 1, 'no duplicate entry');
  assert.equal((await view()).activeSlotId, beta.id);
  assert.equal((await slots())[0].username, 'user-b');
});

test('entries with the same name: a switch lands on the entry switched to', async () => {
  await chrome.storage.local.set({ slots: [
    { id: 'A', name: 'Same B.V.', number: '1', username: 'owner', expired: false },
    { id: 'B', name: 'Same B.V.', number: '1', username: 'accountant', expired: false },
  ] });
  await chrome.storage.session.set({ 'cookies:B': [cookie('S', 'session-of-B')] });
  await fake.dispatch({ type: 'switcher:switch', slotId: 'B', origin: ORIGIN }, main);
  await fake.dispatch({ type: 'top:title', title: 'Same B.V.' }, top);
  assert.equal((await view()).activeSlotId, 'B');
  assert.equal(fake.storage.session.dump()['cookies:A'], undefined, 'B\'s cookies are not stored on A');
});

test('maintenance and error titles never become an entry', async () => {
  for (const title of ['Onderhoud', 'e-Boekhouden.nl', 'Fout', '503 Service Unavailable']) {
    await fake.dispatch({ type: 'top:title', title }, top);
  }
  assert.deepEqual(await slots(), []);
});

test('error pages are told apart from names that contain the same words', () => {
  for (const title of ['Onderhoud', 'Gepland onderhoud', 'Storing - we werken eraan', 'Fout: sessie', 'Runtime Error', 'Server Error in \'/\' Application.', '500 - Internal server error.', '404 - File or directory not found.', 'Service Unavailable', 'IIS 10.0 Detailed Error - 500.19']) {
    assert.equal(isGenericTitle(title), true, title);
  }
  for (const name of ['Tuinonderhoud De Vries', 'Onderhoudsbedrijf Jansen', 'Storingsdienst Noord B.V.', 'Trial & Error B.V.', 'Bureau 500 B.V.', 'Foutloos Advies', 'Fout B.V.']) {
    assert.equal(isGenericTitle(name), false, name);
  }
});

test('a switch leaves the website and its analytics cookies alone', async () => {
  const slot = await loginAs('Voorbeeld B.V.', [
    cookie('ASPSESSIONIDAAA', 'demo-a'),
    cookie('EBSRV', 'x', '.e-boekhouden.nl', { hostOnly: false }),
    cookie('_ga', 'GA1', '.e-boekhouden.nl', { hostOnly: false }),
    cookie('wwwpref', 'nl', 'www.e-boekhouden.nl'),
  ]);
  assert.deepEqual(fake.storage.session.dump()[`cookies:${slot.id}`].map((entry) => entry.name), ['ASPSESSIONIDAAA', 'EBSRV']);
  fake.tabs = [TAB, { id: 9, url: 'https://www.e-boekhouden.nl/prijzen', active: false }];
  await fake.dispatch({ type: 'switcher:add', origin: ORIGIN }, main);
  assert.deepEqual(fake.updates.map((update) => update.tabId), [7], 'the website tab is not reloaded');
  assert.deepEqual(fake.jar.map((entry) => entry.name).sort(), ['_ga', 'wwwpref']);
});

test('removing the active entry leaves no entry logged in', async () => {
  const slot = await loginAs('Voorbeeld B.V.', [cookie('S', 'a')]);
  await fake.dispatch({ type: 'switcher:remove', slotId: slot.id }, main);
  assert.deepEqual(await view(), { activeSlotId: null, loggedIn: false, ready: [] });
});
