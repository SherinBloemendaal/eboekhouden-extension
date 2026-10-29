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
