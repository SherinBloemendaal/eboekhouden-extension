// The shared dialog (dialog.js) in jsdom.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, page } from './dom.mjs';

after(closeAll);

const URL_V2 = 'https://secure20.e-boekhouden.nl/boekhouden/archief';
const HTML = '<!doctype html><html><head></head><body><main id="page"><button id="opener">Openen</button><input id="other"></main><div id="toast"></div></body></html>';

async function dialogPage({ betterDesign = false, serve = null } = {}) {
  const p = page(HTML, { url: URL_V2, store: { settings: { betterDesign } }, serve });
  p.load('shared.js', 'icons.js', 'dialog.js');
  await p.settle(1);
  return p;
}

function content(document) {
  const box = document.createElement('div');
  box.innerHTML = '<p>Tekst</p><button id="first">Eerste</button><button id="last">Laatste</button>';
  return box;
}

const key = (window, target, init) => {
  const event = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};

test('a dialog is modal: labelled, the page behind inert, focus inside, Escape closes and returns focus', async () => {
  const p = await dialogPage();
  const { document, window } = p;
  document.getElementById('opener').focus();
  const dialog = window.EBS.dialog.open({ title: 'Map kiezen', subtitle: '12 mappen', content: content(document), footer: 'Voet' });
  const panel = document.querySelector('.ebs-dialog');
  assert.equal(panel.getAttribute('role'), 'dialog');
  assert.equal(panel.getAttribute('aria-modal'), 'true');
  assert.equal(document.getElementById(panel.getAttribute('aria-labelledby')).textContent, 'Map kiezen');
  assert.equal(document.querySelector('.ebs-dialog-sub').textContent, '12 mappen');
  assert.equal(document.querySelector('.ebs-dialog-foot').textContent, 'Voet');
  assert.equal(document.getElementById('page').inert, true);
  assert.equal(document.getElementById('toast').inert, true);
  assert.notEqual(dialog.host.inert, true);
  assert.equal(document.activeElement, document.querySelector('.ebs-dialog-close'));
  assert.equal(document.querySelector('.ebs-dialog-close svg').getAttribute('class').includes('lucide-x'), true);

  // Something the page adds while the dialog is open is inert too.
  const late = document.createElement('div');
  document.body.append(late);
  await p.settle(1);
  assert.equal(late.inert, true);

  // Escape that something inside used (a dropdown) does not close it.
  const first = document.getElementById('first');
  first.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
  key(window, first, { key: 'Escape' });
  assert.ok(dialog.isOpen);
  key(window, first, { key: 'Escape' });
  assert.equal(dialog.isOpen, false);
  assert.equal(document.querySelector('.ebs-dialog-backdrop'), null, 'without Better design it goes at once');
  assert.equal(document.getElementById('page').inert, false);
  assert.equal(document.getElementById('toast').inert, false);
  assert.equal(late.inert, false);
  assert.equal(document.activeElement, document.getElementById('opener'));
  p.close();
});

test('Tab stays inside the dialog', async () => {
  const p = await dialogPage();
  const { document, window } = p;
  window.EBS.dialog.open({ title: 'Map kiezen', content: content(document) });
  const [start, end] = document.querySelectorAll('.ebs-dialog-sentinel');
  end.focus();
  assert.equal(document.activeElement, document.querySelector('.ebs-dialog-close'), 'past the last: back to the first');
  start.focus();
  assert.equal(document.activeElement, document.getElementById('last'), 'before the first: the last');
  document.getElementById('other').dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
  assert.ok(document.querySelector('.ebs-dialog').contains(document.activeElement), 'focus that lands behind comes back');
  p.close();
});

// jsdom writes calc(100vw - 48px) as -48px + 100vw.
test('the size asked for, clamped to the window', async () => {
  const p = await dialogPage();
  const { document, window } = p;
  const dialog = window.EBS.dialog.open({ title: 'Groot', content: content(document), width: 1040, height: 760 });
  assert.match(dialog.panel.style.width, /^min\(1040px, .*100vw/);
  assert.match(dialog.panel.style.height, /^min\(760px, .*100vh/);
  dialog.close();
  const small = window.EBS.dialog.open({ label: 'Zonder titel', content: content(document) });
  assert.match(small.panel.style.width, /^min\(560px, .*100vw/);
  assert.equal(small.panel.style.height, '', 'no height: it fits its content');
  assert.equal(small.panel.getAttribute('aria-label'), 'Zonder titel');
  p.close();
});

test('loading, error with "Openen in een nieuw venster", and ready', async () => {
  const p = await dialogPage();
  const { document, window } = p;
  const url = 'https://secure20.e-boekhouden.nl/boekhouden/archief/map/3';
  const dialog = window.EBS.dialog.open({ title: 'Map', content: content(document), loading: 'Map wordt geladen…', fallbackUrl: url });
  const cover = document.querySelector('.ebs-dialog-cover');
  assert.equal(cover.hidden, false);
  assert.equal(cover.textContent, 'Map wordt geladen…');
  assert.equal(cover.getAttribute('role'), 'status');
  dialog.setError('De map opende niet.');
  const fallback = cover.querySelector('.ebs-dialog-fallback');
  assert.equal(fallback.textContent, 'Openen in een nieuw venster');
  assert.equal(fallback.href, url);
  assert.equal(fallback.target, '_blank');
  dialog.setError('Weer niet.', { fallbackUrl: 'https://www.example.com/' });
  assert.equal(cover.querySelector('.ebs-dialog-fallback'), null, 'never a link away from e-Boekhouden');
  dialog.setReady();
  assert.equal(cover.hidden, true);
  assert.throws(() => window.EBS.dialog.open({ title: 'x', src: 'https://www.example.com/' }), /e-Boekhouden page/);
  p.close();
});

test('an iframe page: ready on load, and Escape inside it closes the dialog', async () => {
  const frameUrl = 'https://secure20.e-boekhouden.nl/boekhouden/archief/map/3';
  const p = await dialogPage({ serve: { [frameUrl]: '<html><body><input id="field"></body></html>' } });
  const { document, window } = p;
  const dialog = window.EBS.dialog.open({ title: 'Map', src: frameUrl, frameTitle: 'Map 3' });
  assert.equal(dialog.frame.title, 'Map 3');
  assert.equal(document.querySelector('.ebs-dialog-cover').hidden, false, 'covered while it loads');
  await new Promise((resolve) => dialog.frame.addEventListener('load', resolve, { once: true }));
  await p.settle(1);
  assert.equal(document.querySelector('.ebs-dialog-cover').hidden, true);
  const inner = dialog.frame.contentWindow;
  const field = inner.document.getElementById('field');
  const used = new inner.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  field.addEventListener('keydown', (event) => event.preventDefault(), { once: true });
  field.dispatchEvent(used);
  assert.ok(dialog.isOpen, 'Escape that the page in the frame used stays there');
  field.dispatchEvent(new inner.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(dialog.isOpen, false);
  p.close();
});

test('a frame that cannot show the page gets the error and a link to open it in a new window', async () => {
  const frameUrl = 'https://secure20.e-boekhouden.nl/boekhouden/archief/map/4';
  const p = await dialogPage();
  const { document, window } = p;
  const dialog = window.EBS.dialog.open({ title: 'Map', src: frameUrl });
  // What Chrome's error page for a refused frame is to this page: unreadable.
  Object.defineProperty(dialog.frame, 'contentWindow', {
    configurable: true,
    get() {
      return { get location() { throw new window.DOMException('Blocked a frame', 'SecurityError'); } };
    },
  });
  dialog.frame.dispatchEvent(new window.Event('load'));
  const cover = document.querySelector('.ebs-dialog-cover');
  assert.equal(cover.hidden, false);
  assert.ok(cover.classList.contains('error'));
  assert.match(cover.textContent, /kan hier niet worden getoond/);
  assert.equal(cover.querySelector('.ebs-dialog-fallback').href, frameUrl, 'the page itself, in a window of its own');
  p.close();
});

test('Escape that ends a composition (IME) does not close the dialog', async () => {
  const p = await dialogPage();
  const { document, window } = p;
  const dialog = window.EBS.dialog.open({ title: 'Map', content: content(document) });
  key(window, document.getElementById('first'), { key: 'Escape', isComposing: true });
  assert.ok(dialog.isOpen);
  key(window, document.getElementById('first'), { key: 'Escape' });
  assert.equal(dialog.isOpen, false);
  p.close();
});

test('motion only with Better design: open, then a 120 ms close', async () => {
  const p = await dialogPage({ betterDesign: true });
  const { document, window } = p;
  const dialog = window.EBS.dialog.open({ title: 'Map', content: content(document) });
  assert.ok(dialog.host.classList.contains('ebs-motion'));
  assert.ok(dialog.host.classList.contains('open'));
  const css = document.getElementById('ebs-dialog-style').textContent;
  assert.match(css, /opacity 160ms cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
  assert.match(css, /transform: scale\(0\.97\)/);
  assert.match(css, /transform 180ms cubic-bezier\(0\.23, 1, 0\.32, 1\)/);
  assert.match(css, /prefers-reduced-motion: reduce[^}]*\{[^}]*transform: none; transition: opacity/);
  dialog.close();
  assert.ok(dialog.host.classList.contains('closing'));
  assert.ok(dialog.host.isConnected, 'still there while it fades');
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(dialog.host.isConnected, false);
  p.close();
});

test('a second dialog on top: only the top one is live, and closing it gives the first one back', async () => {
  const p = await dialogPage();
  const { document, window } = p;
  const first = window.EBS.dialog.open({ title: 'Eén', content: content(document) });
  const second = window.EBS.dialog.open({ title: 'Twee', content: content(document) });
  assert.equal(first.host.inert, true);
  assert.equal(window.EBS.dialog.top(), second);
  key(window, document.activeElement, { key: 'Escape' });
  assert.equal(second.isOpen, false);
  assert.ok(first.isOpen);
  assert.equal(first.host.inert, false);
  assert.equal(document.getElementById('page').inert, true, 'the page stays inert under the first one');
  first.close();
  assert.equal(document.getElementById('page').inert, false);
  p.close();
});
