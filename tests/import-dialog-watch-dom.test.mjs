// The mutation dialog of the import screen watches its own frame: a load
// never waits forever on a word from a script that is not there.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, page } from './dom.mjs';

after(closeAll);

const ORIGIN = 'https://secure20.e-boekhouden.nl';
const LIST = `${ORIGIN}/boekhouden/importeren`;

const line = (i) => `<tr>
  <td><div class="grid-multi-check"><input type="checkbox"></div></td>
  <td><span title="Verwijderen">x</span></td><td><a title="Handmatig invoeren">e</a></td>
  <td>29-09-2026</td><td>NL00DEMO0000000001</td><td>0${i + 1}-09-2026</td><td>1${i},00</td>
  <td>Naam: Partij ${i} Omschrijving: Factuur ${i}</td><td></td><td></td></tr>`;

const html = (attributes = '') => `<!doctype html><html${attributes}><head></head><body>
<app-header-identity-b><div class="header-identity"><div class="userInfo"><span class="userName">Demo</span><span class="administratieId">123</span></div></div></app-header-identity-b>
<div id="content"><app-grid id="import"><app-grid-header><div class="grid-header-title">Niet verwerkte afschriftregels (3 regels)</div></app-grid-header>
<app-grid-body><table class="grid"><thead><tr><th></th><th></th><th></th><th>Importdatum</th><th>RekeningNr</th><th>Boekdatum</th><th>Bedrag</th><th>Omschrijving</th><th>Verwerkingsfouten</th><th>Opmerking</th></tr></thead>
<tbody>${[0, 1, 2].map(line).join('')}</tbody></table></app-grid-body><app-grid-footer><app-pagination></app-pagination></app-grid-footer></app-grid></div></body></html>`;

const SCRIPTS = ['shared.js', 'store.js', 'icons.js', 'mark.js', 'dialog.js', 'request.js', 'import.js'];
const answer = (message) => (message.type === 'requests:slot' ? { ok: true, lease: `lease-${Math.random()}` } : {});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The frame gets the list as e-Boekhouden serves it: none of our scripts run
// in it (jsdom runs no scripts in frames), as when e-Boekhouden replaced the
// document. `frameHtml` stands in for a list where our script did run (its
// phase on <html>).
async function openDialog({ frameHtml = html() } = {}) {
  // The frame asks for the list with our #ebs-edit= hash.
  const serve = new Proxy({}, { get: (_, url) => (String(url).startsWith(LIST) ? frameHtml : undefined) });
  const p = page(html(), { url: LIST, store: { settings: { betterDesign: true } }, answer, serve });
  p.window.fetch = async () => ({ status: 200, ok: true, redirected: false, headers: { get: () => null }, text: async () => JSON.stringify({ data: [], rowCount: 0 }) });
  p.load(...SCRIPTS);
  await p.settle();
  p.document.querySelectorAll('.ebs-body .ebs-action.book')[1].click();
  const frame = p.document.querySelector('.ebs-dialog-frame');
  assert.ok(frame, 'the dialog has its frame');
  await new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  return { ...p, frame };
}

const cover = (document) => document.querySelector('.ebs-dialog-cover');
const coverText = (document) => document.querySelector('.ebs-dialog-cover-text').textContent;
const retryButton = (document) => document.querySelector('.ebs-dialog-cover .ebs-dialog-retry');

test('a frame whose list has none of our script ends in "Het mutatiescherm van e-Boekhouden opende niet op tijd" with Opnieuw, not an endless loader', async () => {
  const p = await openDialog();
  const { document } = p;
  await wait(700);
  assert.equal(coverText(document), 'Het mutatiescherm van e-Boekhouden opende niet op tijd.', 'the cover says so instead of loading on');
  assert.ok(cover(document).classList.contains('error'));
  assert.equal(retryButton(document)?.textContent, 'Opnieuw');

  // Opnieuw really tries again: a new frame (a new window), the loader back.
  const old = p.frame;
  retryButton(document).focus();
  retryButton(document).click();
  assert.equal(document.activeElement, document.querySelector('.ebs-dialog-close'), 'the focus stays in the dialog, not on a button that went');
  const fresh = document.querySelector('.ebs-dialog-frame');
  assert.notEqual(fresh, old, 'a new frame');
  assert.ok(!old.isConnected, 'the old one is gone');
  assert.match(fresh.src, /\/boekhouden\/importeren#ebs-edit=/);
  assert.equal(coverText(document), 'Het mutatiescherm wordt geopend…');
  assert.ok(!cover(document).classList.contains('error'));
  assert.equal(retryButton(document), null);
  p.close();
});

test('the mutation page that came by a full load lifts the cover without a word from the frame', async () => {
  const p = await openDialog({ frameHtml: html(' data-ebs-edit="opening"') });
  const { document, frame } = p;
  await wait(600);
  assert.equal(coverText(document), 'Het mutatiescherm wordt geopend…', 'our script is at work: wait');
  assert.ok(!cover(document).hidden);
  // e-Boekhouden loads the mutation page as a new document: no script of ours, no edit-opened.
  frame.contentWindow.history.pushState(null, '', '/boekhouden/mutatie/0?imId=1');
  frame.contentDocument.documentElement.removeAttribute('data-ebs-edit');
  await wait(600);
  assert.equal(cover(document).hidden, true, 'the mutation page shows');
  // Back on the list in that document (saved): the dialog closes, as with edit-done.
  frame.contentWindow.history.pushState(null, '', '/boekhouden/importeren?IMMUTNR=10052');
  await wait(600);
  assert.equal(document.querySelector('.ebs-dialog-backdrop.open'), null, 'closed');
  p.close();
});

test('a session page in the frame says so, with Pagina verversen', async () => {
  const p = await openDialog({ frameHtml: html(' data-ebs-edit="find"') });
  const { document, frame } = p;
  frame.contentWindow.history.pushState(null, '', '/sessie-verlopen');
  await wait(600);
  assert.equal(coverText(document), 'Je sessie bij e-Boekhouden is verlopen. Ververs de pagina om opnieuw in te loggen.');
  assert.equal(retryButton(document)?.textContent, 'Pagina verversen');
  p.close();
});

test('no progress of the frame for 20 s ends the wait; progress keeps it going', async () => {
  const p = await openDialog({ frameHtml: html(' data-ebs-edit="find"') });
  const { document, window, frame } = p;
  const realNow = window.Date.now.bind(window.Date);
  let shift = 0;
  window.Date.now = () => realNow() + shift;
  shift = 15_000;
  await wait(600);
  assert.ok(!cover(document).classList.contains('error'), 'still within the time');
  // The frame moves on to the next page: its phase changes, the clock starts again.
  frame.contentDocument.documentElement.setAttribute('data-ebs-edit', 'paging');
  await wait(600);
  shift = 30_000;
  await wait(600);
  assert.ok(!cover(document).classList.contains('error'), '15 s after the last progress');
  shift = 36_000;
  await wait(600);
  assert.equal(coverText(document), 'Het mutatiescherm van e-Boekhouden opende niet op tijd.');
  assert.equal(retryButton(document)?.textContent, 'Opnieuw');
  // A late word from the frame still shows the page.
  window.dispatchEvent(new window.MessageEvent('message', { data: { ebs: 'edit-opened' }, origin: ORIGIN, source: frame.contentWindow }));
  assert.equal(cover(document).hidden, true);
  p.close();
});
