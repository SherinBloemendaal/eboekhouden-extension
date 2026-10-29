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
  p.load('shared.js', 'login-page.js');
  p.document.dispatchEvent(new p.window.CustomEvent('ebs-login-host'));
  await p.settle();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(p.document.querySelectorAll('#ebs-login-header').length, 1);
});

test('the login header steps aside while the login iframe shows the app, so there are never two navbars', async () => {
  const p = page('<html><head><title>Inloggen | e-Boekhouden.nl</title></head><body id="ebs-login-host"><iframe id="mainframe" name="mainframe"></iframe></body></html>', {
    url: 'https://secure.e-boekhouden.nl/bh/',
  });
  p.load('shared.js', 'login-page.js');
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
    p.load('shared.js', 'login-page.js');
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
  p.load('shared.js', 'login-page.js');
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
  p.load('shared.js', 'login-page.js');
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

test('with many sessions the search filters the list and keeps its field', async () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, name: `Studio ${i}`, number: String(i + 1) }));
  const p = await framedPage(`<html><body>${loginForm}</body></html>`, {
    url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', parentUrl: 'https://secure.e-boekhouden.nl/bh/',
    store: { settings: { betterDesign: true }, slots: many, view: { ready: many.map((slot) => slot.id) } },
    answer: (message) => (message.type === 'login:context' ? { pendingLoginFor: null, relogin: false } : {}),
  });
  p.load('shared.js', 'login-page.js');
  await p.settle();
  const search = p.document.querySelector('.ebs-search');
  assert.equal(p.document.querySelectorAll('.ebs-list-row').length, 7);
  search.focus();
  search.value = 'Studio 3';
  search.dispatchEvent(new p.window.Event('input'));
  await p.settle();
  assert.equal(p.document.querySelectorAll('.ebs-list-row').length, 1, 'only the match is listed');
  assert.equal(p.document.querySelector('.ebs-search'), search, 'the same field, so the caret stays');
  assert.equal(p.document.activeElement, search);
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
  p.load('shared.js', 'login-page.js');
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
  p.load('shared.js', 'login-page.js');
  await p.settle();
  const form = p.document.getElementById('frm');
  form.addEventListener('submit', (event) => event.preventDefault(), { capture: true });
  form.dispatchEvent(new p.window.Event('submit', { cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(p.document.getElementById('submit1').disabled, false);
});
