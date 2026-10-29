// Pop-ups als venster (features/popups.js) in jsdom, with the real bridge.
//
// jsdom has no navigator.userActivation (gesture.active stands in for a fresh
// click) and its postMessage sets no event.source or origin: wire() gives a
// window's postMessage the one window that talks to it in a test.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeAll, page } from './dom.mjs';

after(closeAll);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFileSync(join(root, 'src', file), 'utf8');
const T = 15_000;

const APP = 'https://secure20.e-boekhouden.nl';
const CLASSIC = 'https://secure.e-boekhouden.nl';
const URL_V2 = `${APP}/boekhouden/facturen`;
const HTML = '<!doctype html><html><head><title>Facturen</title></head><body><main id="app"><button id="go">Herinnering</button>'
  + '<form id="f" action="/bh/print.asp" target="printwin" name="frmPrint"></form>'
  + '<iframe name="hiddenframe" id="hidden"></iframe></main></body></html>';
const SCRIPTS = ['main-world.js', 'shared.js', 'store.js', 'icons.js', 'mark.js', 'dialog.js', 'bridge.js', 'features/popups.js'];
const ON = { popupDialogs: true, betterDesign: false };

function userActivation(window, gesture) {
  class UserActivation {
    get isActive() { return gesture.active; }
    get hasBeenActive() { return gesture.active; }
  }
  Object.defineProperty(window.navigator, 'userActivation', { configurable: true, value: new UserActivation() });
}

// postMessage on `target` as if `from()` sent it: async, with source and origin.
function wire(target, from) {
  target.postMessage = (data) => {
    const sender = from();
    setTimeout(() => target.dispatchEvent(new target.MessageEvent('message', { data, origin: sender.location.origin, source: sender })), 0);
  };
}

// The page's own window.open and form submit, as recorders.
async function popupPage({ settings = ON, html = HTML, url = URL_V2, serve = null, before = null } = {}) {
  const p = page(html, { url, store: { settings }, serve });
  const { window } = p;
  const gesture = { active: false };
  userActivation(window, gesture);
  const log = { opened: [], submitted: [] };
  window.open = function open(...args) {
    log.opened.push(args);
    return 'real-window';
  };
  window.HTMLFormElement.prototype.submit = function submit() {
    log.submitted.push(window.Element.prototype.getAttribute.call(this, 'target'));
  };
  const natives = { open: window.open, submit: window.HTMLFormElement.prototype.submit };
  before?.(window);
  p.load(...SCRIPTS);
  await p.settle(1);
  const frame = () => p.document.querySelector('iframe.ebs-popup-frame');
  wire(window, () => frame().contentWindow);
  return { ...p, gesture, log, natives, frame, dialog: () => p.document.querySelector('.ebs-dialog.ebs-popup') };
}

// The content scripts in a popup frame, as Chrome injects them at document_start.
function loadInFrame(p, iframe, gesture) {
  const win = iframe.contentWindow;
  win.name = iframe.name;
  win.chrome = p.window.chrome;
  userActivation(win, gesture);
  for (const file of SCRIPTS) win.eval(source(file));
  wire(win, () => p.window);
  return win;
}

function loaded(iframe) {
  return new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));
}

const text = (node) => node?.textContent.replace(/\s+/g, ' ').trim();
const noRequests = (p) => assert.deepEqual(p.sent.filter((message) => /^requests:/.test(message.type ?? '')), [], 'no requests to e-Boekhouden');

test('a sized popup to an e-Boekhouden page opens in a dialog, and the page gets its window', { timeout: T }, async () => {
  const p = await popupPage();
  p.gesture.active = true;
  const popup = p.window.open('/bh/herinnering.asp?ID=demo', '_blank', 'width=770,height=700,toolbar=no,scrollbars=yes');
  const iframe = p.frame();
  assert.ok(iframe, 'a dialog frame');
  assert.ok(popup === iframe.contentWindow, 'window.open answers with the frame\'s window');
  popup.focus();
  assert.deepEqual(p.log.opened, [], 'no real window');
  assert.match(iframe.name, /^ebs-popup-[0-9a-f]{12}$/);
  assert.equal(iframe.src, `${APP}/bh/herinnering.asp?ID=demo`);

  const dialog = p.dialog();
  assert.equal(dialog.getAttribute('role'), 'dialog');
  assert.match(dialog.style.width, /^min\(770px, /);
  assert.match(dialog.style.height, /^min\(700px, /);
  assert.equal(text(dialog.querySelector('.ebs-dialog-title')), 'e-Boekhouden');
  assert.equal(text(dialog.querySelector('.ebs-dialog-sub')), 'secure20.e-boekhouden.nl/bh/herinnering.asp?ID=demo');
  assert.ok(dialog.querySelector('.ebs-popup-stage').classList.contains('loading'), 'the page loads under a cover');
  const loading = dialog.querySelector('.ebs-popup-loading');
  assert.equal(loading.getAttribute('role'), 'status');
  assert.equal(text(loading), 'Bezig met laden…');
  assert.ok(loading.querySelector('.ebs-mark-slot > .ebs-mark.ebs-mark-light.is-still'), 'the loader\'s mark, still without Better design');
  const newWindow = dialog.querySelector('.ebs-popup-secondary');
  assert.equal(text(newWindow), 'Nieuw venster');
  assert.equal(newWindow.title, 'Openen in een nieuw venster');
  assert.ok(newWindow.querySelector('svg.lucide-external-link'));
  assert.equal(dialog.querySelector('.ebs-popup-print'), null, 'Afdrukken only on a print page');
  assert.ok(dialog.querySelector('.ebs-dialog-close svg.lucide-x'));
  assert.equal(p.document.getElementById('app').inert, true, 'the page behind waits');
  noRequests(p);
  p.close();
});

test('which popups stay a real window', { timeout: T }, async () => {
  const p = await popupPage();
  const size = 'width=800,height=600';
  const real = (args, why) => {
    const before = p.log.opened.length;
    assert.equal(p.window.open(...args), 'real-window', why);
    assert.equal(p.log.opened.length, before + 1, why);
    assert.equal(p.frame(), null, why);
  };
  real(['/bh/herinnering.asp', '_blank', size], 'no click of the user');
  p.gesture.active = true;
  real(['/bh/relatie.asp', '_blank'], 'no size: a new tab');
  real(['/bh/relatie.asp'], 'a plain link');
  real(['https://www.e-boekhouden.nl/hulp', '_blank', size], 'www refuses a frame');
  real(['https://www.example.com/', '_blank', size], 'another site');
  real([`blob:${APP}/0b8a`, 'Factuur', size], 'a PDF blob');
  real(['/bh/relatie.asp', '_self', size], 'its own window');
  real(['about:blank', 'bunqauth12', 'width=800,height=800'], 'OAuth: empty with a name, the address follows');
  real([`${APP}/bunq/link`, 'bunqauth12', size], 'and that window keeps the name');
  real(['', 'idealpay7', 'width=1050,height=620,scrollbars'], 'payment');

  // Once: why payment and OAuth stay real.
  await p.settle();
  const toasts = p.document.querySelectorAll('.ebs-popup-toast');
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0].getAttribute('role'), 'status');
  assert.equal(text(toasts[0]), 'Betalen en koppelen met een bank of webshop openen als echt venster: daar log je in bij een andere partij.');
  assert.equal(p.store['store:default/popups/explained']?.v, true);
  noRequests(p);
  p.close();
});

test('with the switch off every popup is the page\'s own', { timeout: T }, async () => {
  const p = await popupPage({ settings: { popupDialogs: false } });
  assert.equal(p.window.open, p.natives.open, 'window.open untouched');
  assert.equal(p.window.HTMLFormElement.prototype.submit, p.natives.submit, 'form submit untouched');
  p.gesture.active = true;
  assert.equal(p.window.open('/bh/herinnering.asp', '_blank', 'width=800,height=600'), 'real-window');

  // Turned on and off again from the popup.
  await p.window.chrome.storage.local.set({ settings: ON });
  assert.notEqual(p.window.open, p.natives.open);
  await p.window.chrome.storage.local.set({ settings: { popupDialogs: false } });
  assert.equal(p.window.open, p.natives.open);
  assert.equal(p.window.HTMLFormElement.prototype.submit, p.natives.submit);
  p.close();
});

test('a print preview the page writes: Afdrukken prints the frame, close() closes the dialog', { timeout: T }, async () => {
  const p = await popupPage();
  p.gesture.active = true;
  const popup = p.window.open('', '', 'height=1000, width=1200');
  assert.ok(popup === p.frame().contentWindow, 'the frame\'s window');
  assert.ok(popup.opener === p.window, 'window.opener is the page');
  const doc = popup.document;
  doc.open();
  doc.write('<!doctype html><html><head></head><body></body></html>');
  doc.close();
  doc.title = 'Overeenkomst';
  doc.body.innerHTML = '<p>Overeenkomst van Demo Klant B.V.</p>';
  popup.focus();
  await p.settle(1);

  const dialog = p.dialog();
  assert.match(dialog.style.width, /^min\(1200px, /);
  assert.equal(text(dialog.querySelector('.ebs-dialog-title')), 'Overeenkomst', 'the title the page wrote');
  assert.equal(text(dialog.querySelector('.ebs-dialog-sub')), 'Afdrukvoorbeeld van secure20.e-boekhouden.nl/boekhouden/facturen');
  assert.ok(dialog.querySelector('.ebs-popup-stage').classList.contains('ready'), 'no loading cover over a written page');
  assert.equal(dialog.querySelector('.ebs-popup-secondary'), null, 'a written preview has no address to open again');
  const printed = [];
  popup.print = () => printed.push('frame');
  const print = dialog.querySelector('.ebs-popup-print');
  assert.equal(text(print), 'Afdrukken');
  assert.ok(print.querySelector('svg.lucide-printer'));
  print.click();
  assert.deepEqual(printed, ['frame']);

  popup.close();
  await p.settle(1);
  assert.equal(p.dialog(), null, 'closed by the page');
  const toast = p.document.querySelector('.ebs-popup-toast-done');
  assert.equal(text(toast), 'Venster gesloten door e-Boekhouden.');
  assert.ok(toast.querySelector('svg.lucide-check'));
  assert.equal(p.document.getElementById('app').inert, false);
  noRequests(p);
  p.close();
});

test('Escape in a print preview the page writes closes the dialog, also after its document.open()', { timeout: T }, async () => {
  const p = await popupPage();
  p.gesture.active = true;
  const popup = p.window.open('', '', 'height=1000, width=1200');
  const doc = popup.document;
  doc.open();
  doc.write('<!doctype html><html><head><title>Overeenkomst</title></head><body><p>Demo Klant B.V.</p></body></html>');
  doc.close();
  await p.settle(1);
  const used = new popup.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  doc.body.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
  doc.body.dispatchEvent(used);
  assert.ok(p.dialog(), 'an Escape the page used stays with the page');
  doc.body.dispatchEvent(new popup.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(p.dialog(), null, 'Escape closes it, as in a page of its own');
  assert.equal(p.document.querySelector('.ebs-popup-toast'), null, 'closed by the user: no toast');
  p.close();
});

test('under the navbar the dialog fits in the rest of the viewport', { timeout: T }, async () => {
  const p = await popupPage({ html: HTML.replace('<main id="app">', '<div id="navHeader"></div><main id="app">') });
  p.document.getElementById('navHeader').getBoundingClientRect = () => ({ top: 0, bottom: 76, left: 0, right: 1280, width: 1280, height: 76 });
  p.gesture.active = true;
  p.window.open('/bh/herinnering.asp?ID=demo', '_blank', 'width=770,height=2000');
  const host = p.document.querySelector('.ebs-dialog-backdrop');
  assert.equal(host.style.top, '76px', 'below the navbar, as on the board');
  assert.match(p.dialog().style.height, /^min\(2000px, /);
  assert.equal(p.dialog().style.maxHeight, 'calc(100vh - 124px)', 'never taller than what is left, with the 24 px margins');
  p.close();
});

test('inside the dialog: opener, title, messages to the page, Escape and close()', { timeout: T }, async () => {
  const popupHtml = '<!doctype html><html><head><title>Herinnering versturen</title></head><body><button id="save">Opslaan</button></body></html>';
  const p = await popupPage({ serve: { [`${APP}/bh/herinnering.asp?ID=demo`]: popupHtml, [`${APP}/bh/herinnering.asp?ID=2`]: popupHtml } });
  const fromPopup = [];
  p.window.addEventListener('message', (event) => fromPopup.push(event.data));
  p.gesture.active = true;
  p.window.open('/bh/herinnering.asp?ID=demo', 'Herinnering', 'width=770,height=700');
  const iframe = p.frame();
  await loaded(iframe);
  const popup = loadInFrame(p, iframe, p.gesture);
  assert.ok(popup.opener === p.window, 'window.opener is the page that opened it');
  await p.settle();

  const dialog = p.dialog();
  assert.equal(text(dialog.querySelector('.ebs-dialog-title')), 'Herinnering versturen');
  assert.equal(text(dialog.querySelector('.ebs-dialog-sub')), 'secure20.e-boekhouden.nl/bh/herinnering.asp?ID=demo');
  // A later title from the page changes the title only.
  popup.document.title = 'Herinnering voor Demo Klant B.V.';
  popup.dispatchEvent(new popup.Event('load'));
  await p.settle();
  assert.equal(text(dialog.querySelector('.ebs-dialog-title')), 'Herinnering voor Demo Klant B.V.');
  assert.equal(text(dialog.querySelector('.ebs-dialog-sub')), 'secure20.e-boekhouden.nl/bh/herinnering.asp?ID=demo');
  const stage = dialog.querySelector('.ebs-popup-stage');
  assert.ok(stage.classList.contains('ready'));
  assert.deepEqual(fromPopup, [], 'the extension\'s own messages never reach the page');

  // What e-Boekhouden sends its opener reaches the page as before.
  popup.opener.postMessage({ action: 'da-refresh' }, '*');
  await p.settle(1);
  assert.deepEqual(fromPopup, [{ action: 'da-refresh' }]);

  // Escape that the page used (a dropdown) stays with the page.
  const save = popup.document.getElementById('save');
  save.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
  save.dispatchEvent(new popup.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await p.settle(1);
  assert.ok(p.dialog());

  // The same name again: that window, sent to the new page. (Chrome keeps
  // the window across the navigation; jsdom makes a new one, so compare
  // with the frame's window now.)
  const again = p.window.open('/bh/herinnering.asp?ID=2', 'Herinnering', 'width=770,height=700');
  assert.ok(again === iframe.contentWindow, 'the same frame\'s window');
  assert.equal(p.document.querySelectorAll('.ebs-popup-frame').length, 1);
  assert.equal(iframe.src, `${APP}/bh/herinnering.asp?ID=2`);
  assert.ok(stage.classList.contains('loading'), 'the next page loads under the cover');
  await loaded(iframe);
  const next = loadInFrame(p, iframe, p.gesture);
  await p.settle();
  assert.ok(stage.classList.contains('ready'));

  // Escape the page did not use closes it; nothing more.
  next.document.getElementById('save').dispatchEvent(new next.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await p.settle(1);
  assert.equal(p.dialog(), null);
  assert.equal(p.document.querySelector('.ebs-popup-toast'), null, 'closed by the user: no toast');
  p.close();
});

test('window.close() in the page of the dialog closes it, with a toast', { timeout: T }, async () => {
  const p = await popupPage({ serve: { [`${APP}/bh/factuur_print.asp?ID=4`]: '<!doctype html><html><head><title>Factuur 2026-0412</title></head><body></body></html>' } });
  p.gesture.active = true;
  p.window.open('/bh/factuur_print.asp?ID=4', 'print', 'width=900,height=640');
  const iframe = p.frame();
  await loaded(iframe);
  const popup = loadInFrame(p, iframe, p.gesture);
  await p.settle();
  const printed = [];
  popup.print = () => printed.push('frame');
  const print = p.dialog().querySelector('.ebs-popup-print');
  assert.ok(print, 'a print page gets Afdrukken');
  assert.ok(p.dialog().querySelector('.ebs-popup-secondary'), 'and Nieuw venster');
  print.click();
  await p.settle(1);
  assert.deepEqual(printed, ['frame'], 'the page inside prints itself');

  popup.close();
  await p.settle(1);
  assert.equal(p.dialog(), null);
  assert.equal(text(p.document.querySelector('.ebs-popup-toast-done')), 'Venster gesloten door e-Boekhouden.');
  p.close();
});

test('a page that will not show in a frame: "Openen in een nieuw venster" opens it for real', { timeout: T }, async () => {
  // Served, but without the extension in it: as Chrome's error page.
  const p = await popupPage({ serve: {} });
  p.gesture.active = true;
  p.window.open('/bh/hulp.asp?ID=7', 'Hulp', 'width=700,height=700');
  await loaded(p.frame());
  await new Promise((resolve) => setTimeout(resolve, 650));
  const dialog = p.dialog();
  assert.ok(dialog.querySelector('.ebs-popup-stage').classList.contains('problem'));
  const problem = dialog.querySelector('.ebs-popup-problem');
  assert.equal(problem.getAttribute('role'), 'alert');
  assert.equal(text(problem.querySelector('.ebs-popup-problem-title')), 'Deze pagina wil niet in een venster');
  assert.equal(text(problem.querySelector('.ebs-popup-problem-text')), 'e-Boekhouden laat deze pagina alleen als los venster zien. Open hem zoals gewoonlijk; er is niets verloren.');
  const reopen = problem.querySelector('.ebs-popup-primary');
  assert.equal(text(reopen), 'Openen in een nieuw venster');
  reopen.click();
  assert.deepEqual(p.log.opened, [[`${APP}/bh/hulp.asp?ID=7`, 'Hulp', 'width=700,height=700']], 'the same page, name and size');
  assert.equal(p.dialog(), null);
  // That name is a real window now: the next popup to it goes there.
  assert.equal(p.window.open('/bh/hulp.asp?ID=8', 'Hulp', 'width=700,height=700'), 'real-window');
  p.close();
});

test('a page that does not load within 10 seconds offers the real window', { timeout: T }, async () => {
  // The 10 s timer, shortened: the page's clock stays real otherwise.
  const p = await popupPage({
    serve: {},
    before: (window) => {
      const real = window.setTimeout.bind(window);
      window.setTimeout = (fn, ms, ...args) => real(fn, ms >= 10_000 ? 30 : ms, ...args);
    },
  });
  p.gesture.active = true;
  p.window.open('/bh/traag.asp', '_blank', 'width=700,height=500');
  const stage = p.dialog().querySelector('.ebs-popup-stage');
  assert.ok(stage.classList.contains('loading'));
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(stage.classList.contains('problem'), 'after the timeout');
  p.close();
});

test('a session that ended inside the dialog says so instead of showing the login', { timeout: T }, async () => {
  const p = await popupPage({ serve: { [`${CLASSIC}/bh/inloggen.asp`]: '<!doctype html><html><head><title>Inloggen</title></head><body></body></html>' } });
  p.gesture.active = true;
  p.window.open(`${CLASSIC}/bh/inloggen.asp`, '_blank', 'width=700,height=500');
  const iframe = p.frame();
  await loaded(iframe);
  loadInFrame(p, iframe, p.gesture);
  await p.settle();
  const problem = p.dialog().querySelector('.ebs-popup-problem');
  assert.ok(p.dialog().querySelector('.ebs-popup-stage').classList.contains('problem'));
  assert.equal(text(problem.querySelector('.ebs-popup-problem-title')), 'Je sessie is verlopen');
  assert.equal(problem.querySelector('.ebs-popup-primary').hidden, true);
  p.close();
});

test('a form posted to a named window goes into a dialog frame; frames of the page and _blank stay', { timeout: T }, async () => {
  const p = await popupPage();
  const form = p.document.getElementById('f');
  p.gesture.active = true;
  form.submit();
  const iframe = p.frame();
  assert.ok(iframe, 'a dialog for the named window');
  assert.deepEqual(p.log.submitted, [iframe.name], 'posted into the dialog frame');
  assert.equal(form.getAttribute('target'), 'printwin', 'the form keeps its own target');
  const dialog = p.dialog();
  assert.equal(text(dialog.querySelector('.ebs-dialog-sub')), 'secure20.e-boekhouden.nl/bh/print.asp');
  assert.equal(dialog.querySelector('.ebs-popup-secondary'), null, 'a post cannot be opened again from here');
  assert.ok(dialog.querySelector('.ebs-popup-print'));

  // The same name again: the same frame.
  form.submit();
  assert.equal(p.log.submitted.at(-1), iframe.name);
  assert.equal(p.document.querySelectorAll('.ebs-popup-frame').length, 1);
  dialog.querySelector('.ebs-dialog-close').click();

  for (const [target, why] of [['hiddenframe', 'a frame of the page'], ['_blank', 'a new tab'], ['_self', 'its own window']]) {
    form.setAttribute('target', target);
    form.submit();
    assert.equal(p.log.submitted.at(-1), target, why);
    assert.equal(p.frame(), null, why);
  }
  // A name the page opened as a real window.
  p.window.open('about:blank', 'bunqauth3', 'width=800,height=800');
  form.setAttribute('target', 'bunqauth3');
  form.submit();
  assert.equal(p.log.submitted.at(-1), 'bunqauth3');
  p.gesture.active = false;
  form.setAttribute('target', 'printwin');
  form.submit();
  assert.equal(p.log.submitted.at(-1), 'printwin', 'no click: the page\'s own way');
  assert.equal(p.frame(), null);
  p.close();
});

// top (classic frameset) > inner (classic page, the opener) > popup (secure20, POPUP=1)
function nested(popupQuery) {
  const popupUrl = `${APP}/grootboekrekening/kies${popupQuery}`;
  const innerUrl = `${CLASSIC}/bh/mutatie.asp`;
  return {
    html: `<!doctype html><html><head></head><body><iframe name="inner" src="${innerUrl}"></iframe></body></html>`,
    serve: {
      [innerUrl]: `<!doctype html><html><head></head><body><iframe name="ebs-popup-0a1b2c3d4e5f" src="${popupUrl}"></iframe></body></html>`,
      [popupUrl]: '<!doctype html><html><head><title>Grootboekrekening kiezen</title></head><body></body></html>',
    },
  };
}

async function nestedPage(popupQuery) {
  const { html, serve } = nested(popupQuery);
  const p = page(html, { url: `${CLASSIC}/bh/`, store: { settings: ON }, serve });
  const gesture = { active: false };
  userActivation(p.window, gesture);
  const innerFrame = p.document.querySelector('iframe');
  await loaded(innerFrame);
  const inner = innerFrame.contentWindow;
  const popupFrame = inner.document.querySelector('iframe');
  if (inner.document.readyState !== 'complete' || !popupFrame.contentWindow.document.title) await loaded(popupFrame);
  const popup = popupFrame.contentWindow;
  popup.name = popupFrame.name;
  // top hears from the popup (its first word comes while its scripts load),
  // inner from top (a forwarded message).
  wire(p.window, () => popup);
  for (const [win, name] of [[p.window, ''], [inner, 'inner'], [popup, popup.name]]) {
    if (name) win.name = name;
    win.chrome = p.window.chrome;
    userActivation(win, gesture);
    for (const file of SCRIPTS) win.eval(source(file));
  }
  const seen = { top: [], inner: [] };
  p.window.addEventListener('message', (event) => seen.top.push(event.data));
  inner.addEventListener('message', (event) => seen.inner.push(event.data));
  await p.settle();
  wire(inner, () => p.window);
  return { ...p, inner, popup, seen };
}

test('a secure20 popup of a classic page: what it sends to top reaches its opener', { timeout: T }, async () => {
  const p = await nestedPage('?POPUP=1');
  assert.ok(p.popup.opener === p.inner, 'the classic page is its opener');
  // hybridModeDetected: window !== top, so e-Boekhouden posts to top.
  p.popup.top.postMessage({ key: '8000', value: '8000 Omzet hoog' }, '*');
  await p.settle(1);
  assert.deepEqual(p.seen.inner.filter((data) => !data?.ebs), [{ key: '8000', value: '8000 Omzet hoog' }]);
  assert.deepEqual(p.seen.top, [], 'top does not handle it as well');
  p.close();
});

test('a popup that is not one of a classic page leaves top its messages (jwterror, settings)', { timeout: T }, async () => {
  const p = await nestedPage('');
  p.popup.top.postMessage({ action: 'jwterror', error: 'x' }, '*');
  await p.settle(1);
  assert.deepEqual(p.seen.top, [{ action: 'jwterror', error: 'x' }], 'as from any embedded page: the re-login sees it');
  assert.deepEqual(p.seen.inner.filter((data) => !data?.ebs), []);
  p.close();
});

test('top forwards only what an e-Boekhouden page in the popup frame sends, and only to the opener\'s origin', { timeout: T }, async () => {
  const p = await nestedPage('?POPUP=1');
  const posted = [];
  const forward = p.inner.postMessage;
  p.inner.postMessage = (data, origin) => {
    posted.push(origin);
    forward(data, origin);
  };
  p.popup.top.postMessage({ action: 'reload' }, '*');
  await p.settle(1);
  assert.deepEqual(posted, [CLASSIC], 'to the classic page\'s origin, not to any');
  // The frame went to another site (it keeps its window): that site's
  // messages are not passed on as if they came from e-Boekhouden.
  p.window.dispatchEvent(new p.window.MessageEvent('message', { data: { action: 'reload' }, origin: 'https://bank.example', source: p.popup }));
  await p.settle(1);
  assert.equal(posted.length, 1);
  assert.deepEqual(p.seen.top.at(-1), { action: 'reload' }, 'top gets it, as from any other frame');
  p.close();
});

test('a frame named ebs-popup-* in a page of another site gets no opener and tells nothing', { timeout: T }, async () => {
  const popupUrl = `${APP}/bh/herinnering.asp?POPUP=1`;
  const p = page(`<!doctype html><html><head></head><body><iframe name="ebs-popup-0a1b2c3d4e5f" src="${popupUrl}"></iframe></body></html>`, {
    url: 'https://evil.example/',
    store: { settings: ON },
    serve: { [popupUrl]: '<!doctype html><html><head><title>Herinnering</title></head><body></body></html>' },
  });
  const iframe = p.document.querySelector('iframe');
  await loaded(iframe);
  const heard = [];
  p.window.addEventListener('message', (event) => heard.push(event.data));
  const posted = [];
  p.window.postMessage = (data, origin) => posted.push([data, origin]);
  const popup = loadInFrame(p, iframe, { active: true });
  popup.dispatchEvent(new popup.Event('load'));
  await p.settle();
  assert.equal(popup.opener ?? null, null, 'no window.opener to the other site');
  assert.deepEqual(posted, [], 'no hello, ready or title with the page\'s address');
  assert.deepEqual(heard, []);
  p.close();
});
