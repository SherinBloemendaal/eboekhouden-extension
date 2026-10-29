// The login page scripts (login-page.js, password-fields.js) in jsdom.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, framedPage, page } from './dom.mjs';

after(closeAll);

const loginForm = `<form name="frm" id="frm" action="inloggen.asp?LOGIN=1" method="post"><table id="formWrapper"><tbody>
<tr><td>Inloggen</td></tr>
<tr class="TRNORM"><td>Gebruikersnaam</td><td><input class="INPUTBOX" type="text" id="txtEmail" name="txtEmail"></td></tr>
<tr class="TRNORM"><td>Wachtwoord</td><td><input class="INPUTBOX" type="password" id="txtWachtwoord" name="txtWachtwoord"></td></tr>
<tr><td><input class="act-btn" type="submit" value="Inloggen" id="submit1"></td></tr>
</tbody></table></form>`;
const slots = [{ id: 'a', name: 'Voorbeeld B.V.', number: '1', expired: false }, { id: 'b', name: 'Studio Noord', number: '2', expired: true }];

test('the login host gets one header, also when the swap and DOMContentLoaded race', async () => {
  const p = page('<html><head><title>Inloggen | e-Boekhouden.nl</title></head><body id="ebs-login-host"><iframe id="mainframe" name="mainframe"></iframe></body></html>', {
    url: 'https://secure.e-boekhouden.nl/bh/', answerDelay: 30,
  });
  p.load('shared.js', 'icons.js', 'login-page.js');
  p.document.dispatchEvent(new p.window.CustomEvent('ebs-login-host'));
  await p.settle();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(p.document.querySelectorAll('#ebs-login-header').length, 1);
});

test('the login header steps aside while the login iframe shows the app, so there are never two navbars', async () => {
  const p = page('<html><head><title>Inloggen | e-Boekhouden.nl</title></head><body id="ebs-login-host"><iframe id="mainframe" name="mainframe"></iframe></body></html>', {
    url: 'https://secure.e-boekhouden.nl/bh/',
  });
  p.load('shared.js', 'icons.js', 'login-page.js');
  p.document.dispatchEvent(new p.window.CustomEvent('ebs-login-host'));
  await p.settle();
  const header = p.document.getElementById('ebs-login-header');
  assert.notEqual(p.window.getComputedStyle(header).display, 'none');
  // login-breakout.js sets this class when anything but a login page loads in the iframe.
  p.document.documentElement.classList.add('ebs-login-app');
  assert.equal(p.window.getComputedStyle(header).display, 'none');
  p.document.documentElement.classList.remove('ebs-login-app');
  assert.notEqual(p.window.getComputedStyle(header).display, 'none');
});

test('with the re-login dialog on, the login page leaves the form to it', async () => {
  for (const betterDesign of [false, true]) {
    const p = await framedPage(`<html><body>${loginForm}</body></html>`, {
      url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', parentUrl: 'https://secure.e-boekhouden.nl/bh/',
      store: { settings: { betterDesign }, slots, view: { ready: ['a'] } },
      answer: (message) => (message.type === 'login:context' ? { pendingLoginFor: null, relogin: true } : {}),
    });
    p.load('shared.js', 'icons.js', 'login-page.js');
    await p.settle();
    assert.equal(p.document.getElementById('ebs-better'), null, `no Better design layout (betterDesign ${betterDesign})`);
    assert.equal(p.document.getElementById('ebs-sessions'), null, 'no sessions block inside the dialog');
  }
});

test('without the dialog the classic page lists the sessions above the form', async () => {
  const p = await framedPage(`<html><body>${loginForm}</body></html>`, {
    url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', parentUrl: 'https://secure.e-boekhouden.nl/bh/',
    store: { settings: {}, slots, view: { ready: ['a'] } },
    answer: (message) => (message.type === 'login:context' ? { pendingLoginFor: null, relogin: false } : {}),
  });
  p.load('shared.js', 'icons.js', 'login-page.js');
  await p.settle();
  const block = p.document.getElementById('ebs-sessions');
  assert.ok(block);
  assert.equal(block.querySelectorAll('.row').length, 1);
  assert.match(block.querySelector('.chip').textContent, /Studio Noord · verlopen/);
});

test('only the username is sent, also when the form is sent from script', async () => {
  const p = await framedPage(`<html><body>${loginForm}</body></html>`, {
    url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', parentUrl: 'https://secure.e-boekhouden.nl/bh/', store: { settings: {} },
  });
  p.load('shared.js', 'icons.js', 'login-page.js');
  await p.settle();
  p.document.getElementById('txtEmail').value = 'demo@example.org';
  p.document.getElementById('txtWachtwoord').value = 'not-read';
  p.document.getElementById('submit1').dispatchEvent(new p.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  p.window.dispatchEvent(new p.window.Event('pagehide'));
  const usernames = p.sent.filter((message) => message.type === 'login:username');
  // The messages come from the page's own realm: compare them as plain data.
  assert.deepEqual(JSON.parse(JSON.stringify(usernames)), [{ type: 'login:username', username: 'demo@example.org' }]);
  assert.ok(!JSON.stringify(p.sent).includes('not-read'), 'the password never leaves the page');
});

test('login fields are labelled on the login page only, and never moved', async () => {
  const p = page(`<html><body>${loginForm}</body></html>`, { url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', store: { settings: {} } });
  const parent = p.document.getElementById('txtWachtwoord').parentElement;
  p.load('shared.js', 'password-fields.js');
  await p.settle();
  const password = p.document.getElementById('txtWachtwoord');
  assert.equal(password.getAttribute('autocomplete'), 'current-password');
  assert.equal(p.document.getElementById('txtEmail').getAttribute('autocomplete'), 'username');
  assert.equal(password.parentElement, parent, 'the field stays where the page put it');

  const elsewhere = page('<html><body><div><input id="u"><input type="password" id="k" name="apiKey"></div></body></html>', {
    url: 'https://secure20.e-boekhouden.nl/beheer/api', store: { settings: {} },
  });
  elsewhere.load('shared.js', 'password-fields.js');
  await elsewhere.settle();
  assert.equal(elsewhere.document.getElementById('k').getAttribute('autocomplete'), null, 'not on other pages');

  const off = page(`<html><body>${loginForm}</body></html>`, { url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', store: { settings: { onePassword: false } } });
  off.load('shared.js', 'password-fields.js');
  await off.settle();
  assert.equal(off.document.getElementById('txtWachtwoord').getAttribute('autocomplete'), null, 'not with the 1Password switch off');

  const fresh = page('<html><body><form><input id="u"><input type="password" id="n" name="newPassword"></form></body></html>', {
    url: 'https://secure20.e-boekhouden.nl/v1login', store: { settings: {} },
  });
  fresh.load('shared.js', 'password-fields.js');
  await fresh.settle();
  assert.equal(fresh.document.getElementById('n').getAttribute('autocomplete'), null, 'a new password is not a login password');
});

// The Better design login page in its iframe, with these sessions.
async function betterPage({ slots: list, view = {}, pendingLoginFor = null, answer } = {}) {
  const p = await framedPage(`<html><body>${loginForm}</body></html>`, {
    url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', parentUrl: 'https://secure.e-boekhouden.nl/bh/',
    store: { settings: { betterDesign: true }, slots: list, view },
    answer: answer ?? ((message) => (message.type === 'login:context' ? { pendingLoginFor, relogin: false } : {})),
  });
  p.load('shared.js', 'icons.js', 'login-page.js');
  await p.settle();
  return p;
}

test('with many sessions the search filters the list and keeps its field', async () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, name: `Studio ${i}`, number: String(i + 1) }));
  const p = await betterPage({ slots: many, view: { ready: many.map((slot) => slot.id) } });
  const search = p.document.querySelector('.ebs-search input');
  assert.equal(p.document.querySelectorAll('.ebs-list .ebs-row').length, 7);
  search.focus();
  search.value = 'Studio 3';
  search.dispatchEvent(new p.window.Event('input'));
  await p.settle();
  assert.equal(p.document.querySelectorAll('.ebs-list .ebs-row').length, 1, 'only the match is listed');
  assert.equal(p.document.querySelector('.ebs-more-text').textContent, '1 van 7 getoond');
  assert.equal(p.document.querySelector('.ebs-search input'), search, 'the same field, so the caret stays');
  assert.equal(p.document.activeElement, search);
  search.value = 'Nergens';
  search.dispatchEvent(new p.window.Event('input'));
  await p.settle();
  assert.equal(p.document.querySelector('.ebs-no-match').textContent, 'Geen administratie gevonden voor "Nergens".');
});

for (const count of [1, 2, 3, 100]) {
  test(`${count} ${count === 1 ? 'session is' : 'sessions are'} always the list with search, never cards`, async () => {
    const list = Array.from({ length: count }, (_, i) => ({ id: `s${i}`, name: `Administratie ${i}`, number: String(1000001 + i) }));
    const p = await betterPage({ slots: list, view: { ready: list.map((slot) => slot.id) } });
    const { document } = p;
    assert.equal(document.querySelector('.ebs-card, .ebs-cards'), null, 'no card variant');
    assert.ok(document.querySelector('.ebs-left > .ebs-search input'), 'the search box is there');
    assert.equal(document.querySelectorAll('.ebs-list .ebs-row').length, count);
    assert.ok(document.querySelector('.ebs-left > .ebs-fade'), 'the fade under the list');
    assert.equal(document.querySelector('.ebs-more-text').textContent, `${count} ${count === 1 ? 'administratie' : 'administraties'}`);
    assert.equal(document.querySelector('.ebs-sub').textContent, count === 1 ? '1 administratie is nog ingelogd.' : `${count} administraties zijn nog ingelogd.`);
    const first = document.querySelector('.ebs-list .ebs-row');
    assert.equal(first.querySelector('.ebs-row-action').textContent, 'Openen');
    assert.ok(first.querySelector('.ebs-row-action svg.lucide-arrow-right'), 'a Lucide arrow, not a glyph');
  });
}

test('expired and logged-out sessions are rows with a pill, and a click puts their name above the form', async () => {
  const list = [
    { id: 'a', name: 'Voorbeeld B.V.', number: '1000001' },
    { id: 'b', name: 'Studio Noord', number: '1000002' },
    { id: 'c', name: 'Demo Holding B.V.', number: '1000003', expired: true },
    { id: 'd', name: 'Atelier Zuid', number: '1000004' },
  ];
  let pending = null;
  const p = await betterPage({
    slots: list, view: { ready: ['a', 'b'] },
    answer: (message) => {
      if (message.type === 'login:for') pending = message.slotId;
      return message.type === 'login:context' ? { pendingLoginFor: pending, relogin: false } : {};
    },
  });
  const { document } = p;
  assert.equal(document.querySelector('.ebs-sub').textContent, '2 van 4 administraties zijn nog ingelogd. Klik om direct verder te gaan.');
  const rows = [...document.querySelectorAll('.ebs-list .ebs-row')];
  assert.deepEqual(rows.map((row) => row.querySelector('.ebs-pill')?.textContent ?? ''), ['', '', 'Verlopen', 'Niet ingelogd']);
  assert.deepEqual(rows.map((row) => row.querySelector('.ebs-row-action').textContent), ['Openen', 'Openen', 'Inloggen', 'Inloggen']);
  assert.equal(document.querySelector('.ebs-others'), null, 'no separate block for the others');
  assert.equal(document.querySelector('.ebs-for').textContent, 'Kies links een administratie of log direct in.');
  rows[2].click();
  await p.settle();
  assert.equal(document.querySelector('.ebs-for').textContent, 'voor Demo Holding B.V. · 1000003');
  assert.ok(document.querySelector('.ebs-for').classList.contains('picked'));
  const picked = document.querySelector('.ebs-row[data-slot="c"]');
  assert.ok(picked.classList.contains('picked'));
  assert.equal(picked.getAttribute('aria-pressed'), 'true');
  assert.equal(document.activeElement, document.getElementById('txtEmail'), 'on to the username field');
});

test('opening a session waits visibly until the answer is there', async () => {
  const list = [{ id: 'a', name: 'Voorbeeld B.V.', number: '1' }, { id: 'b', name: 'Studio Noord', number: '2' }];
  let release;
  const p = await betterPage({
    slots: list, view: { ready: ['a', 'b'] },
    answer: (message) => {
      if (message.type === 'switcher:switch') return new Promise((resolve) => { release = () => resolve({ error: 'nee' }); });
      return message.type === 'login:context' ? { pendingLoginFor: null, relogin: false } : {};
    },
  });
  const { document } = p;
  document.querySelector('.ebs-row[data-slot="b"]').click();
  await p.settle(1);
  const busy = document.querySelector('.ebs-row[data-slot="b"]');
  assert.equal(busy.querySelector('.ebs-row-action').textContent, 'Bezig…');
  assert.equal(busy.disabled, true);
  assert.equal(busy.getAttribute('aria-busy'), 'true');
  assert.ok(busy.classList.contains('opening'));
  assert.equal(document.querySelector('.ebs-sub').textContent, 'Studio Noord wordt geopend…');
  release();
  await p.settle();
  const back = document.querySelector('.ebs-row[data-slot="b"]');
  assert.equal(back.disabled, false);
  assert.equal(back.querySelector('.ebs-row-action').textContent, 'Openen');
  assert.equal(document.querySelector('.ebs-sub').textContent, 'Openen lukte niet. Probeer het opnieuw.');
});

test('a long list shows nine rows at a time, as the board says, fades its last rows and can show everything', async () => {
  const list = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, name: `Administratie ${i}`, number: String(i) }));
  const p = await betterPage({ slots: list, view: { ready: list.map((slot) => slot.id) } });
  const { document, window } = p;
  const box = document.querySelector('.ebs-list');
  // jsdom does no layout: rows of 60 px in a list of 400 px.
  const rows = () => box.querySelectorAll('.ebs-row').length;
  Object.defineProperty(box, 'clientHeight', { configurable: true, get: () => (box.classList.contains('all') ? rows() * 60 : 400) });
  Object.defineProperty(box, 'scrollHeight', { configurable: true, get: () => rows() * 60 });
  // The first render had no layout yet: start again from nine rows.
  document.querySelector('.ebs-search input').dispatchEvent(new window.Event('input'));
  await p.settle(2);
  assert.equal(rows(), 9, 'nine rows, as on the board');
  assert.equal(document.querySelector('.ebs-more-text').textContent, 'Scroll voor meer · 9 van 100 getoond');
  assert.ok(document.querySelector('.ebs-more-text svg.lucide-arrow-down'));
  assert.ok(document.querySelector('.ebs-fade').classList.contains('on'));
  assert.ok(box.classList.contains('scrolls'), 'room for the thin scrollbar');
  box.scrollTop = 140;
  box.dispatchEvent(new window.Event('scroll'));
  await p.settle(2);
  assert.equal(rows(), 18, 'the end of the list brings the next nine');
  assert.equal(document.querySelector('.ebs-more-text').textContent, 'Scroll voor meer · 18 van 100 getoond');
  assert.equal(box.querySelector('.ebs-row').dataset.slot, 's0', 'the rows above stay');
  // A redraw (a storage change) keeps the rows that were there.
  await p.window.chrome.storage.local.set({ view: { ready: list.map((slot) => slot.id) } });
  await p.settle(3);
  assert.equal(rows(), 18, 'a redraw keeps the rows that were there');
  const all = [...document.querySelectorAll('.ebs-more .ebs-link')].find((button) => button.textContent === 'Alles tonen');
  all.click();
  await p.settle(1);
  assert.ok(box.classList.contains('all'));
  assert.equal(rows(), 100);
  assert.equal(document.querySelector('.ebs-more-text').textContent, '100 administraties');
  assert.ok(!document.querySelector('.ebs-fade').classList.contains('on'));
});

test('without any session the left panel shows the empty state, without a search', async () => {
  const p = await betterPage({ slots: [] });
  const { document } = p;
  assert.equal(document.querySelector('.ebs-sub').textContent, 'Er staat nog niets open.');
  assert.ok(document.querySelector('.ebs-empty .ebs-empty-icon svg.lucide-lock'));
  assert.equal(document.querySelector('.ebs-empty strong').textContent, 'Geen actieve sessies');
  assert.equal(document.querySelector('.ebs-left .ebs-search'), null);
  assert.equal(document.querySelector('.ebs-left .ebs-list'), null);
});

test('the login swap waits for the whole frameset and keeps e-Boekhouden\'s other frames alive under their names', async () => {
  const frameset = `<html><head><title>Inloggen | e-Boekhouden.nl</title></head><frameset rows="0,*">
<frame name="topframe" id="topframe" src="top.asp?TST=55">
<frameset cols="0,*,0">
<frame name="menuframe" id="menuframe" src="menu.asp">
<frame name="mainframe" id="mainframe" src="https://secure20.e-boekhouden.nl/v1login?EBM=&v2rnd=1">
<frame name="hiddenframe" id="hiddenframe" src="leeg.html">
<frame name="sessionframe" id="sessionframe" src="updatesessie.asp">
<frame name="jwtframe" id="jwtframe" src="leeg.html">
<frame name="jwtrefreshframe" id="jwtrefreshframe" src="refreshjwt.asp?ACTION=INIT&t=1">
</frameset></frameset></html>`;
  const p = page(frameset, { url: 'https://secure.e-boekhouden.nl/bh/', store: { settings: { onePassword: true } } });
  p.load('shared.js', 'login-breakout.js');
  await p.settle();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const body = p.document.getElementById('ebs-login-host');
  assert.ok(body, 'the frameset is swapped for the login host');
  assert.equal(p.document.querySelector('iframe#mainframe').getAttribute('src'), 'https://secure.e-boekhouden.nl/bh/inloggen.asp');
  const kept = Object.fromEntries([...body.querySelectorAll('iframe:not(#mainframe)')].map((frame) => [frame.name, frame.getAttribute('src')]));
  assert.deepEqual(kept, {
    topframe: 'https://secure.e-boekhouden.nl/bh/top.asp?TST=55',
    menuframe: 'https://secure.e-boekhouden.nl/bh/menu.asp',
    hiddenframe: 'https://secure.e-boekhouden.nl/bh/leeg.html',
    sessionframe: 'https://secure.e-boekhouden.nl/bh/updatesessie.asp',
    jwtframe: 'https://secure.e-boekhouden.nl/bh/leeg.html',
    jwtrefreshframe: 'https://secure.e-boekhouden.nl/bh/refreshjwt.asp?ACTION=INIT&t=1',
  });
});

test('the Inloggen button waits visibly after a submit, and only after the form has been built', async () => {
  const p = await framedPage(`<html><body>${loginForm}</body></html>`, {
    url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', parentUrl: 'https://secure.e-boekhouden.nl/bh/', store: { settings: {} },
  });
  p.load('shared.js', 'icons.js', 'login-page.js');
  await p.settle();
  const form = p.document.getElementById('frm');
  const button = p.document.getElementById('submit1');
  p.document.getElementById('txtEmail').value = 'demo';
  const submit = new p.window.Event('submit', { cancelable: true });
  form.dispatchEvent(submit);
  assert.equal(button.disabled, false, 'still enabled while the browser builds the form data');
  assert.equal(button.value, 'Inloggen');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(button.disabled, true);
  assert.equal(button.value, 'Bezig met inloggen…');
  assert.equal(button.getAttribute('aria-busy'), 'true');
});

test('a submit that e-Boekhouden cancels (empty field) leaves the button as it is', async () => {
  const p = await framedPage(`<html><body>${loginForm}</body></html>`, {
    url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', parentUrl: 'https://secure.e-boekhouden.nl/bh/', store: { settings: {} },
  });
  p.load('shared.js', 'icons.js', 'login-page.js');
  await p.settle();
  const form = p.document.getElementById('frm');
  form.addEventListener('submit', (event) => event.preventDefault(), { capture: true });
  form.dispatchEvent(new p.window.Event('submit', { cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(p.document.getElementById('submit1').disabled, false);
});

// ---------------------------------------------------------------------------
// The username lock: a login for a known entry gets that entry's username,
// read-only, and Inloggen refuses another one.
// ---------------------------------------------------------------------------

const known = [
  { id: 'a', name: 'Voorbeeld B.V.', number: '1000001', username: 'demo@voorbeeld.nl' },
  { id: 'b', name: 'Vitrion B.V.', number: '1000002', username: 'sherin@vitrion.example', expired: true },
  { id: 'c', name: 'Oud Archief', number: '1000003', expired: true },
];
const WRONG = 'Dit is niet het account van Vitrion B.V. Kies het juiste account in 1Password, of klik op Ander account.';

async function lockPage({ betterDesign = false, pendingLoginFor = 'b', list = known, password = '' } = {}) {
  let pending = pendingLoginFor;
  const p = await framedPage(`<html><body>${loginForm}</body></html>`, {
    url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', parentUrl: 'https://secure.e-boekhouden.nl/bh/',
    store: { settings: { betterDesign }, slots: list, view: { ready: [] } },
    answer: (message) => {
      if (message.type === 'login:for') pending = message.slotId;
      return message.type === 'login:context' ? { pendingLoginFor: pending, relogin: false, reloginFor: null } : {};
    },
  });
  const field = p.document.getElementById('txtWachtwoord');
  field.value = password;
  p.passwordBefore = field.outerHTML;
  p.load('shared.js', 'icons.js', 'login-page.js');
  await p.settle();
  return p;
}

const click = (p, element) => {
  const event = new p.window.MouseEvent('click', { bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
};
const submit = (p) => {
  const event = new p.window.Event('submit', { bubbles: true, cancelable: true });
  p.document.getElementById('frm').dispatchEvent(event);
  return event;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const betterDesign of [false, true]) {
  test(`${betterDesign ? 'Better design' : 'classic'}: a login for a known entry fills in its username, read-only, with a lock and its name`, async () => {
    const p = await lockPage({ betterDesign });
    const user = p.document.getElementById('txtEmail');
    assert.equal(user.value, 'sherin@vitrion.example');
    assert.equal(user.readOnly, true, 'read-only');
    assert.equal(user.disabled, false, 'not disabled: a disabled field is not sent');
    const box = p.document.querySelector('.ebs-userlock');
    assert.ok(box.classList.contains(betterDesign ? 'better' : 'classic'));
    assert.equal(box.querySelector('.ebs-userlock-text').textContent, 'Vastgezet voor Vitrion B.V.');
    assert.ok(box.querySelector('.ebs-userlock-icon svg.lucide-lock'), 'a Lucide lock');
    assert.equal(box.querySelector('.ebs-userlock-other').textContent, 'Ander account');
    assert.equal(box.querySelector('.ebs-userlock-other').type, 'button', 'the link never sends the form');
    // The message is laid out from the start (its room reserved), but not shown.
    const message = box.querySelector('.ebs-userlock-msg');
    assert.equal(message.textContent, WRONG);
    assert.ok(!message.classList.contains('on'));
    assert.equal(box.closest('tr').previousElementSibling, user.closest('tr.TRNORM'), 'right under the username');
    assert.equal(p.document.getElementById('txtWachtwoord').outerHTML, p.passwordBefore, 'the password field is untouched');
    if (betterDesign) assert.ok(p.document.querySelector('#ebs-better .ebs-userlock'), 'inside the Better design form');
  });
}

test('an entry without a stored username fills in and locks nothing', async () => {
  const p = await lockPage({ pendingLoginFor: 'c' });
  const user = p.document.getElementById('txtEmail');
  assert.equal(user.value, '');
  assert.equal(user.readOnly, false);
  assert.equal(p.document.querySelector('.ebs-userlock'), null);
  const none = await lockPage({ pendingLoginFor: null });
  assert.equal(none.document.getElementById('txtEmail').value, '');
  assert.equal(none.document.querySelector('.ebs-userlock'), null);
  user.value = 'wie@dan.ook';
  assert.equal(submit(p).defaultPrevented, false, 'the form behaves as before');
});

for (const betterDesign of [false, true]) {
  test(`${betterDesign ? 'Better design' : 'classic'}: Inloggen with another account is stopped, without the busy state, and the username comes back`, async () => {
    const p = await lockPage({ betterDesign, password: 'geheim-van-iemand' });
    const { document } = p;
    const user = document.getElementById('txtEmail');
    const button = document.getElementById('submit1');
    // e-Boekhouden's own ValidateForm (OnSubmit) must not run for a stopped login.
    let validated = 0;
    document.getElementById('frm').addEventListener('submit', () => { validated += 1; });
    const message = document.querySelector('.ebs-userlock-msg');

    // 1Password (or a script) writes another account into the read-only field.
    user.value = 'Iemand@Anders.nl';
    user.dispatchEvent(new p.window.Event('input', { bubbles: true }));
    assert.ok(message.classList.contains('on'), 'the message shows early');

    assert.equal(click(p, button).defaultPrevented, true, 'the Inloggen click is stopped');
    assert.equal(user.value, 'sherin@vitrion.example', 'the entry\'s username is back');
    assert.ok(message.classList.contains('on'));
    // A write that fired no event is caught at the submit itself.
    user.value = 'nog@iemand.nl';
    assert.equal(submit(p).defaultPrevented, true, 'the submit is stopped');
    assert.equal(user.value, 'sherin@vitrion.example');
    // The restored value firing its own input event keeps the message.
    user.dispatchEvent(new p.window.Event('input', { bubbles: true }));
    assert.ok(message.classList.contains('on'), 'still shown after the restore');
    await wait(15);
    assert.equal(validated, 0, 'e-Boekhouden\'s own handlers never saw it');
    assert.equal(button.disabled, false, 'no busy state');
    assert.equal(button.value, 'Inloggen');
    assert.equal(button.getAttribute('aria-busy'), null);
    assert.equal(p.sent.filter((sent) => sent.type === 'login:username').length, 0, 'no username sent for a stopped login');
    assert.equal(document.getElementById('txtWachtwoord').outerHTML, p.passwordBefore, 'the password field is untouched');
    assert.equal(document.getElementById('txtWachtwoord').value, 'geheim-van-iemand');
    assert.ok(!JSON.stringify(p.sent).includes('geheim'), 'the password never leaves the page');
  });
}

test('the entry\'s own account logs in as before, in any case and with spaces, and gets the busy state', async () => {
  const p = await lockPage();
  const user = p.document.getElementById('txtEmail');
  const button = p.document.getElementById('submit1');
  user.value = '  Sherin@Vitrion.Example ';
  user.dispatchEvent(new p.window.Event('input', { bubbles: true }));
  assert.ok(!p.document.querySelector('.ebs-userlock-msg').classList.contains('on'));
  assert.equal(click(p, button).defaultPrevented, false);
  assert.equal(submit(p).defaultPrevented, false);
  assert.equal(button.disabled, false, 'still enabled while the browser builds the form data');
  await wait(10);
  assert.equal(button.disabled, true);
  assert.equal(button.value, 'Bezig met inloggen…');
  assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.deepEqual(JSON.parse(JSON.stringify(p.sent.filter((sent) => sent.type === 'login:username'))), [{ type: 'login:username', username: '  Sherin@Vitrion.Example ' }]);
});

test('Ander account unlocks and empties the field, after which any account logs in', async () => {
  const p = await lockPage({ betterDesign: true });
  const { document } = p;
  const user = document.getElementById('txtEmail');
  const other = document.querySelector('.ebs-userlock-other');
  user.value = 'iemand@anders.nl';
  user.dispatchEvent(new p.window.Event('input', { bubbles: true }));
  other.click();
  assert.equal(user.readOnly, false);
  assert.equal(user.value, '');
  assert.equal(document.activeElement, user);
  assert.equal(document.querySelector('.ebs-userlock-text').textContent, 'Ander account: vul de gebruikersnaam zelf in.');
  assert.ok(document.querySelector('.ebs-userlock-icon svg.lucide-user'));
  assert.ok(!document.querySelector('.ebs-userlock-msg').classList.contains('on'), 'the message goes');
  assert.equal(other.isConnected, true, 'the link stays in place (faded), nothing moves');
  assert.equal(other.disabled, true);
  // A redraw (a storage change) does not lock it again.
  await p.window.chrome.storage.local.set({ view: { ready: [] } });
  await p.settle();
  assert.equal(user.readOnly, false);
  assert.equal(user.value, '');
  user.value = 'iemand@anders.nl';
  assert.equal(submit(p).defaultPrevented, false, 'a deliberate switch logs in');
  await wait(10);
  assert.equal(document.getElementById('submit1').disabled, true);
  assert.equal(document.getElementById('txtWachtwoord').outerHTML, p.passwordBefore);
});

test('picking another entry moves the lock to that entry\'s username, and the caret to the password', async () => {
  const p = await lockPage({ pendingLoginFor: null, list: known.map((slot) => ({ ...slot, expired: true })) });
  const { document } = p;
  const user = document.getElementById('txtEmail');
  assert.equal(user.readOnly, false);
  const chip = (name) => [...document.querySelectorAll('#ebs-sessions .chip')].find((button) => button.textContent.startsWith(name));
  chip('Voorbeeld B.V.').click();
  await p.settle();
  assert.equal(user.value, 'demo@voorbeeld.nl');
  assert.equal(user.readOnly, true);
  assert.equal(document.querySelector('.ebs-userlock-text').textContent, 'Vastgezet voor Voorbeeld B.V.');
  assert.equal(document.activeElement, document.getElementById('txtWachtwoord'));
  chip('Vitrion B.V.').click();
  await p.settle();
  assert.equal(user.value, 'sherin@vitrion.example');
  assert.equal(document.querySelector('.ebs-userlock-text').textContent, 'Vastgezet voor Vitrion B.V.');
  assert.equal(document.querySelectorAll('.ebs-userlock').length, 1, 'one lock row');
  // An entry without a username frees the field again.
  chip('Oud Archief').click();
  await p.settle();
  assert.equal(user.value, '');
  assert.equal(user.readOnly, false);
  assert.equal(document.querySelector('.ebs-userlock'), null);
  assert.equal(document.getElementById('txtWachtwoord').outerHTML, p.passwordBefore);
});

test('the expired re-login dialog locks the username to the entry whose session expired', async () => {
  for (const betterDesign of [false, true]) {
    const p = await framedPage(`<html><body>${loginForm}</body></html>`, {
      url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', parentUrl: 'https://secure.e-boekhouden.nl/bh/',
      store: { settings: { betterDesign }, slots: known, view: { ready: [] } },
      answer: (message) => {
        if (message.type === 'main:page') return { relogin: true };
        // Another entry was picked on the login page earlier: the dialog is not for that one.
        return message.type === 'login:context' ? { pendingLoginFor: 'a', relogin: true, reloginFor: 'b' } : {};
      },
    });
    const before = p.document.getElementById('txtWachtwoord').outerHTML;
    // jsdom gives the frame's window no name: content.js finds its role by it.
    p.window.name = 'mainframe';
    p.load('shared.js', 'icons.js', 'content.js', 'login-page.js');
    await p.settle();
    await wait(20);
    const { document } = p;
    assert.ok(document.documentElement.classList.contains('ebs-relogin'), `the dialog shows (betterDesign ${betterDesign})`);
    assert.equal(document.getElementById('ebs-better'), null);
    const user = document.getElementById('txtEmail');
    assert.equal(user.value, 'sherin@vitrion.example', 'the expired entry\'s username');
    assert.equal(user.readOnly, true);
    assert.equal(document.querySelector('.ebs-userlock-text').textContent, 'Vastgezet voor Vitrion B.V.');
    assert.ok(document.querySelector('.ebs-userlock').classList.contains('classic'));
    assert.equal(document.activeElement, document.getElementById('txtWachtwoord'), 'on to the password');
    user.value = 'demo@voorbeeld.nl';
    assert.equal(submit(p).defaultPrevented, true, 'the other entry\'s account is stopped too');
    assert.equal(user.value, 'sherin@vitrion.example');
    assert.equal(document.getElementById('txtWachtwoord').outerHTML, before, 'the password field is untouched');
  }
});
