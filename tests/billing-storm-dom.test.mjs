// The billing redraw stays quiet while the page is idle: no observer where
// no billing screen applies (the /bh/ frameset, the classic frames, other
// routes of the shell), and on a billing screen no redraw for churn that no
// screen reads (outside <body>) or for its own writes.
//
// A redraw is one requestAnimationFrame of the billing schedule; nothing
// else in these pages asks for a frame while they are idle (so the counting
// windows wait with timers, never with settle(), which asks for frames).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll } from './dom.mjs';
import { billingPage, invoiceListHtml, invoiceEditHtml, subscriptionListHtml, subscriptionEditHtml } from './billing-fixtures.mjs';

after(closeAll);

const APP = 'https://secure20.e-boekhouden.nl';
const IDLE_MS = 1500;

// Counts the frames asked for from now on, and what the storm guard said.
function countRenders(p) {
  const counter = { frames: 0, warnings: [] };
  const real = p.window.requestAnimationFrame.bind(p.window);
  p.window.requestAnimationFrame = (callback) => {
    counter.frames += 1;
    return real(callback);
  };
  const warn = p.window.console.warn.bind(p.window.console);
  p.window.console.warn = (...args) => {
    counter.warnings.push(args.join(' '));
    if (!String(args[0]).includes('billing redraw paused')) warn(...args);
  };
  return counter;
}

// Something that changes every 16 ms, as a spinner, a clock or another
// extension's overlay does. `where` builds the node it changes.
function churn(p, where) {
  const node = where(p.document);
  let tick = 0;
  const timer = p.window.setInterval(() => {
    tick += 1;
    node.style.opacity = String((tick % 10) / 10);
    node.classList.toggle('tick', tick % 2 === 0);
    node.textContent = `${tick}`;
  }, 16);
  return () => p.window.clearInterval(timer);
}

const idle = (ms = IDLE_MS) => new Promise((resolve) => setTimeout(resolve, ms));

test('the /bh/ frameset: nothing is observed, a page that keeps changing causes no redraw', async () => {
  const p = billingPage('<html><head><title>Demo</title></head><body><div id="clock"></div><iframe name="mainframe"></iframe></body></html>', { url: 'https://secure.e-boekhouden.nl/bh/' });
  await p.settle(4);
  const counter = countRenders(p);
  const stop = churn(p, (document) => document.getElementById('clock'));
  await idle();
  stop();
  assert.equal(counter.frames, 0, 'no billing screen applies on /bh/: no redraw');
  assert.deepEqual(counter.warnings, []);
  assert.equal(p.document.documentElement.classList.contains('ebs-billing'), false);
  p.close();
});

test('a classic page and another route of the shell: no redraw for a page that keeps changing', async () => {
  for (const url of ['https://secure.e-boekhouden.nl/bh/inkfact.asp', `${APP}/dashboard`, `${APP}/facturen/abonnementfactuur`]) {
    const p = billingPage('<html><head></head><body><div id="spinner"></div></body></html>', { url });
    await p.settle(4);
    const counter = countRenders(p);
    const stop = churn(p, (document) => document.getElementById('spinner'));
    await idle(800);
    stop();
    assert.equal(counter.frames, 0, `${url}: no redraw`);
    assert.deepEqual(counter.warnings, [], url);
    p.close();
  }
});

const SCREENS = [
  ['the invoice list', () => invoiceListHtml([{ number: 'F2026-1' }, { number: 'F2026-2', verwerkt: false }]), `${APP}/facturen/factuur`, '.ebs-b-view'],
  ['the invoice edit screen', () => invoiceEditHtml(), `${APP}/facturen/factuur/toevoegen/0`, '.ebs-b-edit'],
  ['the subscription list', () => subscriptionListHtml([{ name: 'Hosting', relation: 'Demo Klant B.V.' }]), `${APP}/facturen/abonnement`, '.ebs-b-view'],
  ['the subscription edit screen', () => subscriptionEditHtml(), `${APP}/facturen/abonnement/5`, '.ebs-b-edit'],
];

for (const [name, html, url, view] of SCREENS) {
  test(`${name}: a drawn screen stays idle, also while something outside <body> keeps changing`, async () => {
    const p = billingPage(html(), { url, posts: [] });
    await p.settle(6);
    assert.ok(p.document.querySelector(view), `${name} is drawn`);
    const counter = countRenders(p);
    // Our own redraw writes nothing that wakes it again.
    await idle(600);
    assert.equal(counter.frames, 0, `${name}: idle, no redraw of its own`);
    // A host on <html> (the switcher, another extension) and the <head>.
    const stopHost = churn(p, (document) => document.documentElement.appendChild(document.createElement('ebs-test-host')));
    const stopHead = churn(p, (document) => document.head.appendChild(document.createElement('style')));
    await idle();
    stopHost();
    stopHead();
    assert.equal(counter.frames, 0, `${name}: churn outside <body> causes no redraw`);
    assert.deepEqual(counter.warnings, [], name);
    p.close();
  });
}

test('on a billing screen, a change of e-Boekhouden\'s own markup still redraws (once), and the route watch connects and lets go', async () => {
  const p = billingPage(invoiceListHtml([{ number: 'F2026-1' }]), { url: `${APP}/facturen/factuur` });
  await p.settle(6);
  const counter = countRenders(p);
  p.document.querySelector('app-factuur-list .grid-header-title').append(p.document.createElement('i'));
  await idle(300);
  assert.ok(counter.frames >= 1, 'e-Boekhouden changed its grid: a redraw');
  assert.ok(counter.frames <= 2, `and it settles (${counter.frames} frames)`);

  // Angular leaves the route: the screen goes, then nothing is observed.
  p.window.history.pushState({}, '', '/dashboard');
  await idle(400);
  await p.settle(3);
  assert.equal(p.document.querySelector('.ebs-b-view'), null, 'the list view is gone');
  assert.equal(p.document.documentElement.classList.contains('ebs-billing'), false);
  const after = countRenders(p);
  const spinner = p.document.body.appendChild(p.document.createElement('div'));
  const stop = churn(p, () => spinner);
  await idle(800);
  stop();
  assert.equal(after.frames, 0, 'another route: no redraw for a page that keeps changing');

  // And back on the route, the screen is drawn again.
  p.window.history.pushState({}, '', '/facturen/factuur');
  await idle(400);
  await p.settle(3);
  assert.ok(p.document.querySelector('.ebs-b-view'), 'back on the list: drawn again');
  p.close();
});
