// The Digitaal archief in Better design (features/archive.js), in jsdom over a
// stand-in for e-Boekhouden's own archive components (archive-mock.mjs). The
// page loads its data with its own GETs; the extension reads them through the
// bridge and makes only its own few requests, which the tests count.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, page } from './dom.mjs';
import { answer, demoData, nativeScript, shellHtml } from './archive-mock.mjs';

after(closeAll);

const URL_ARCHIVE = 'https://secure20.e-boekhouden.nl/overig/digitaal-archief';
const FOUNDATION = ['shared.js', 'store.js', 'icons.js', 'dialog.js', 'bridge.js'];
// e-Boekhouden's own GETs; anything else that goes out is ours.
const NATIVE = /\/folder\/(directory|\d+\/(header|filelist|koppel))(\?|$)/;

async function archivePage({ slow = 0, data = demoData(), settings = { betterDesign: true }, store = {}, fakeRequest = false, nativeFirst = false, url = URL_ARCHIVE } = {}) {
  const p = page(shellHtml(), {
    url,
    store: { settings, ...store },
    answer: (message) => (message.type === 'requests:slot' ? { ok: true, lease: 'test' } : {}),
  });
  const { window } = p;
  window.Response ??= Response;
  window.Blob ??= Blob;
  const calls = [];
  const fetchAnswer = async (input) => {
    const href = new URL(String(input?.url ?? input), window.location.href).href;
    calls.push(href);
    if (slow && /\/filelist/.test(href)) await new Promise((resolve) => setTimeout(resolve, slow));
    const reply = answer(data, new URL(href).pathname);
    if (reply.preview) return new Response(new Blob(['%PDF-1.7'], { type: reply.preview }), { status: 200, headers: { 'content-type': reply.preview } });
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  };
  window.fetch = fetchAnswer;
  const items = [];
  const boot = () => window.eval(`(${nativeScript})(${JSON.stringify(data)}, { transport: 'fetch' })`);
  p.load('main-world.js', 'shared.js');
  if (fakeRequest) {
    // A request layer that answers a blob, for the preview (jsdom has no
    // trusted clicks for the real one); it keeps the rules that matter here.
    window.EBS.define('request', Object.freeze({
      bulk: (key, href) => fetchAnswer(href).then((response) => response.json()),
      item: (key, href, options = {}) => {
        if (options.userAction !== true) return Promise.reject(new Error('user-action'));
        items.push({ key, href, as: options.as });
        return fetchAnswer(href).then((response) => response.blob());
      },
      abort() {},
    }));
    window.URL.createObjectURL = (blob) => `blob:${URL_ARCHIVE}#${blob.size}`;
    window.URL.revokeObjectURL = () => {};
  }
  if (nativeFirst) {
    boot();
    await p.settle();
  }
  p.load(...FOUNDATION.slice(1), 'request.js', 'features/archive.js');
  await p.settle();
  if (!nativeFirst) boot();
  await settleAll(p);
  const ours = () => calls.filter((href) => !NATIVE.test(href));
  return { ...p, calls, ours, items, data, $: (selector) => p.document.querySelector(selector), $$: (selector) => [...p.document.querySelectorAll(selector)] };
}

async function settleAll(p, rounds = 4) {
  for (let i = 0; i < rounds; i += 1) await p.settle();
}

const rowNames = (p) => p.$$('.ebs-ar-body .ebs-ar-item').map((node) => node.querySelector('.ebs-ar-name').textContent);
const rowNode = (p, name) => p.$$('.ebs-ar-body .ebs-ar-item').find((node) => node.querySelector('.ebs-ar-name').textContent === name);
const nativeLog = (p) => [...p.window.__archive.log];
const click = (p, node, init = {}) => node.dispatchEvent(new p.window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));

test('the new view replaces the native archive and shows its rows, folders and inbox', async () => {
  const p = await archivePage();
  assert.ok(p.document.documentElement.classList.contains('ebs-better-archive'));
  assert.ok(p.$('#ebs-archive-style').textContent.includes('.container-da > .main { display: none !important; }'));
  assert.equal(p.$('.ebs-ar h1').textContent, 'Digitaal archief');
  assert.equal(p.$('.ebs-ar-subtitle').textContent, '7 bestanden in Inkoopfacturen 2026 · 2,3 GB van 5 GB gebruikt');
  assert.deepEqual(rowNames(p), [
    'Oktober', 'Bonnetje tankstation.jpg', 'Factuur 2026-0412 Demo Leverancier.pdf', 'Factuur 88231 Voorbeeld Hosting.pdf',
    'Huur kantoor november.pdf', 'Parkeren Utrecht.png', 'Software licentie.xml', 'Telefoonabonnement oktober.pdf',
  ]);
  const hosting = rowNode(p, 'Factuur 88231 Voorbeeld Hosting.pdf');
  assert.equal(hosting.querySelector('.ebs-ar-date').textContent, '15-10-2026');
  assert.equal(hosting.querySelector('.ebs-ar-status').textContent, 'Ingevoerd');
  assert.equal(hosting.querySelector('.ebs-ar-meta').textContent, '88 kb');
  assert.equal(hosting.querySelector('.ebs-ar-linkbutton').textContent, 'Gekoppeld (2)', 'koppelCount from the page\'s own file list');
  assert.equal(rowNode(p, 'Software licentie.xml').querySelector('.ebs-ar-none').textContent, 'Geen');
  assert.equal(rowNode(p, 'Parkeren Utrecht.png').querySelector('.ebs-ar-status').className, 'ebs-ar-status credits');

  const folders = p.$$('.ebs-ar-folder').map((node) => node.querySelector('.ebs-ar-folder-name').textContent);
  assert.deepEqual(folders, ['Basismap', 'Inbox (Mail & Herken)', 'Inkoopfacturen 2026', 'Oktober', 'Leeg']);
  assert.equal(p.$('.ebs-ar-folder.current .ebs-ar-folder-name').textContent, 'Inkoopfacturen 2026');
  assert.equal(p.$('.ebs-ar-folder .ebs-ar-badge').textContent, '4', 'the unprocessed count on the inbox');
  assert.ok(p.$('.ebs-ar-badge').classList.contains('new'));
  assert.equal(p.$('.ebs-ar-menh').textContent, 'Mail & Herken: mail bonnetjes naar 11000001herken@e-Boekhouden.nl');
  assert.equal(p.$('.ebs-ar-preview-none').textContent, 'Kies een bestand om het hier te bekijken.');
  assert.equal(p.$('.ebs-ar-bar').classList.contains('show'), false, 'no bar without a selection');
});

test('opening a folder of 1000 files makes no request of ours; the screen makes one', async () => {
  const p = await archivePage({ data: demoData({ many: 1000 }) });
  assert.deepEqual(p.ours().map((href) => new URL(href).pathname), ['/v1/api/folder/unprocessed/count'], 'one bulk GET per screen load');
  assert.equal(p.sent.filter((message) => message.type === 'requests:slot').length, 1);
  click(p, p.$$('.ebs-ar-folder').find((node) => node.textContent === 'Oktober'));
  await settleAll(p);
  assert.equal(p.$$('.ebs-ar-body .ebs-ar-item').length, 1000);
  assert.equal(p.$('.ebs-ar-subtitle').textContent, '1000 bestanden in Oktober, in één keer geladen · 2,3 GB van 5 GB gebruikt');
  assert.equal(p.$('.ebs-ar-more').hidden, false);
  assert.match(p.$('.ebs-ar-more').textContent, /^Alle 1000 bestanden staan in beeld/);
  // Searching, filtering, selecting and expanding are all local or the page's own.
  p.$('.ebs-ar-search input').value = 'lunch';
  p.$('.ebs-ar-search input').dispatchEvent(new p.window.Event('input'));
  await p.settle();
  assert.equal(p.$$('.ebs-ar-body .ebs-ar-item').length, 143);
  click(p, p.$('.ebs-ar-row-head .ebs-ar-check'));
  await settleAll(p);
  assert.equal(p.window.__archive.state.selected.size, 143);
  click(p, p.$$('.ebs-ar-body .ebs-ar-linkbutton')[0]);
  await settleAll(p);
  assert.equal(p.ours().length, 1, 'still only the one request of ours');
  assert.equal(p.sent.filter((message) => message.type === 'requests:slot').length, 1);
});

test('a preview asks for one file per click, never before', async () => {
  const p = await archivePage({ fakeRequest: true });
  assert.deepEqual(p.items, [], 'nothing per row on load');
  click(p, rowNode(p, 'Factuur 2026-0412 Demo Leverancier.pdf').querySelector('.ebs-ar-file'));
  await settleAll(p);
  assert.deepEqual(p.items, [{ key: 'archive:preview:101', href: 'https://secure20.e-boekhouden.nl/v1/api/folder/101/preview?inline=true', as: 'blob' }]);
  assert.equal(p.$('.ebs-ar-preview-name').textContent, 'Factuur 2026-0412 Demo Leverancier.pdf');
  assert.equal(p.$('.ebs-ar-preview-meta').textContent, '28-10-2026 · 182 kb · Ingevoerd');
  assert.match(p.$('.ebs-ar-preview-stage iframe').src, /^blob:/);
  assert.equal(p.$('.ebs-ar-preview-links').textContent, '1 koppeling; klap de regel uit voor de details.');
  assert.equal(p.$('.ebs-ar-pbutton.green').textContent, 'Koppeling bekijken');
  assert.ok(rowNode(p, 'Factuur 2026-0412 Demo Leverancier.pdf').querySelector('.ebs-ar-file').classList.contains('current'));

  click(p, rowNode(p, 'Factuur 2026-0412 Demo Leverancier.pdf').querySelector('.ebs-ar-file'));
  await settleAll(p);
  assert.equal(p.items.length, 1, 'the same file again: no second request');

  click(p, rowNode(p, 'Software licentie.xml').querySelector('.ebs-ar-file'));
  await settleAll(p);
  assert.equal(p.items.length, 1, 'no preview for this type, so no request');
  assert.equal(p.$('.ebs-ar-noshow strong').textContent, 'Geen voorbeeld voor dit bestandstype');
  assert.equal(p.$('.ebs-ar-pbutton.green').textContent, 'Invoeren als mutatie');
  assert.equal(p.$('.ebs-ar-preview-links').textContent, 'Nog niet gekoppeld aan een mutatie, relatie of offerte.');

  click(p, rowNode(p, 'Parkeren Utrecht.png').querySelector('.ebs-ar-file'));
  await settleAll(p);
  assert.equal(p.items.length, 2);
  assert.equal(p.items[1].key, 'archive:preview:106');
  assert.ok(p.$('.ebs-ar-preview-stage img'));
  assert.deepEqual(p.ours().map((href) => new URL(href).pathname), ['/v1/api/folder/unprocessed/count', '/v1/api/folder/101/preview', '/v1/api/folder/106/preview']);
});

test('with the shared request layer a preview sends nothing without a real click', async () => {
  const p = await archivePage();
  click(p, rowNode(p, 'Huur kantoor november.pdf').querySelector('.ebs-ar-file'));
  await settleAll(p);
  assert.equal(p.ours().filter((href) => href.includes('/preview')).length, 0);
  assert.equal(p.$('.ebs-ar-preview-stage [role="alert"]')?.querySelector('strong').textContent, 'Geen voorbeeld');
  assert.ok(p.$('.ebs-ar-pbutton:not(.green)'), 'the buttons stay');
});

test('the preview button actions are the items of e-Boekhouden\'s right-click menu', async () => {
  const p = await archivePage({ fakeRequest: true });
  click(p, rowNode(p, 'Software licentie.xml').querySelector('.ebs-ar-file'));
  await settleAll(p);
  const pbutton = (label) => p.$$('.ebs-ar-pbutton').find((node) => node.textContent === label);
  click(p, pbutton('Invoeren als mutatie'));
  assert.equal(pbutton('Bezig…')?.getAttribute('aria-busy'), 'true', 'busy until the menu answered');
  assert.equal(pbutton('Bezig…').disabled, true);
  await settleAll(p);
  assert.deepEqual(nativeLog(p), ['Invoeren als mutatie 105']);
  assert.equal(p.$('.contextMenu').hasAttribute('custom-hidden'), true, 'the native menu closed again');
  assert.equal(p.document.documentElement.classList.contains('ebs-archive-driving'), false);
  click(p, pbutton('Koppelen aan relatie'));
  await settleAll(p);
  click(p, pbutton('Naam wijzigen'));
  await settleAll(p);
  click(p, pbutton('Downloaden'));
  await settleAll(p);
  assert.deepEqual(nativeLog(p), ['Invoeren als mutatie 105', 'Koppelen aan relatie 105', 'Naam wijzigen 105', 'download 105']);
  assert.equal(p.items.length, 0);
});

test('search covers name, date and status; quick-selects use the links', async () => {
  const p = await archivePage();
  const search = (value) => {
    p.$('.ebs-ar-search input').value = value;
    p.$('.ebs-ar-search input').dispatchEvent(new p.window.Event('input'));
  };
  assert.deepEqual(p.$$('.ebs-ar-chip').map((node) => node.textContent), ['Alles · 7', 'Zonder koppeling · 3', 'Met koppeling · 4', 'Herkend, nog invoeren · 1']);
  search('huur');
  assert.deepEqual(rowNames(p), ['Huur kantoor november.pdf']);
  search('25-10-2026');
  assert.deepEqual(rowNames(p), ['Telefoonabonnement oktober.pdf']);
  search('niet ingevoerd');
  assert.deepEqual(rowNames(p), ['Software licentie.xml', 'Telefoonabonnement oktober.pdf']);
  search('zzz');
  await p.settle();
  assert.equal(p.$('.ebs-ar').dataset.state, 'nomatch');
  assert.equal(p.$('.ebs-ar-empty-title').textContent, 'Niets gevonden voor "zzz"');
  assert.equal(p.$('.ebs-ar-empty-text').textContent, 'Er is gezocht in naam, datum en status van alle bestanden in deze map. Relatie en bedrag staan niet in de lijst van e-Boekhouden.');
  click(p, p.$('.ebs-ar-empty .ebs-ar-button'));
  await p.settle();
  assert.equal(p.$('.ebs-ar-search input').value, '');
  assert.equal(rowNames(p).length, 8);

  const chip = (label) => p.$$('.ebs-ar-chip').find((node) => node.textContent.startsWith(label));
  click(p, chip('Met koppeling'));
  assert.deepEqual(rowNames(p), ['Factuur 2026-0412 Demo Leverancier.pdf', 'Factuur 88231 Voorbeeld Hosting.pdf', 'Huur kantoor november.pdf', 'Telefoonabonnement oktober.pdf']);
  assert.equal(chip('Met koppeling').getAttribute('aria-pressed'), 'true');
  click(p, chip('Zonder koppeling'));
  assert.deepEqual(rowNames(p), ['Bonnetje tankstation.jpg', 'Parkeren Utrecht.png', 'Software licentie.xml']);
  click(p, chip('Herkend, nog invoeren'));
  assert.deepEqual(rowNames(p), ['Bonnetje tankstation.jpg']);
});

test('shift-click selects a range on e-Boekhouden\'s checkboxes; the bar counts it', async () => {
  const p = await archivePage();
  const check = (name) => rowNode(p, name).querySelector('.ebs-ar-check');
  click(p, check('Bonnetje tankstation.jpg'));
  await settleAll(p);
  click(p, check('Parkeren Utrecht.png'), { shiftKey: true });
  await settleAll(p);
  assert.deepEqual([...p.window.__archive.state.selected].sort(), [101, 102, 104, 106, 107]);
  assert.equal(check('Huur kantoor november.pdf').getAttribute('aria-checked'), 'true');
  assert.equal(p.$('.ebs-ar-bar').classList.contains('show'), true);
  assert.equal(p.$('.ebs-ar-bar-count').textContent, '5 bestanden geselecteerd');
  assert.equal(p.$('.ebs-ar-bar-sub').textContent, '2 zonder koppeling');
  // Shift-click back to the anchor's state: the range is cleared.
  click(p, check('Huur kantoor november.pdf'));
  await settleAll(p);
  click(p, check('Factuur 2026-0412 Demo Leverancier.pdf'), { shiftKey: true });
  await settleAll(p);
  assert.deepEqual([...p.window.__archive.state.selected].sort(), [102, 106]);

  click(p, p.$$('.ebs-ar-bar-button').find((node) => node.textContent === 'Selectie wissen'));
  await settleAll(p);
  assert.equal(p.window.__archive.state.selected.size, 0);
  assert.equal(p.$('.ebs-ar-bar').classList.contains('show'), false);

  // "Alles in beeld": only what the filter shows.
  click(p, p.$$('.ebs-ar-chip').find((node) => node.textContent.startsWith('Zonder koppeling')));
  click(p, p.$('.ebs-ar-row-head .ebs-ar-check'));
  await settleAll(p);
  assert.deepEqual([...p.window.__archive.state.selected].sort(), [102, 105, 106]);
  assert.equal(p.$('.ebs-ar-row-head .ebs-ar-check').getAttribute('aria-checked'), 'true');
});

test('the action bar clicks e-Boekhouden\'s own actions for the selection', async () => {
  const p = await archivePage();
  const barButton = (label) => p.$$('.ebs-ar-bar-button').find((node) => node.textContent === label);
  for (const name of ['Software licentie.xml', 'Huur kantoor november.pdf']) click(p, rowNode(p, name).querySelector('.ebs-ar-check'));
  await settleAll(p);
  assert.equal(barButton('Herkennen').disabled, false);
  click(p, barButton('Herkennen'));
  await settleAll(p);
  click(p, barButton('Koppelen aan relatie'));
  await settleAll(p);
  click(p, barButton('Downloaden'));
  assert.equal(barButton('Bezig…').getAttribute('aria-busy'), 'true');
  await new Promise((resolve) => setTimeout(resolve, 600));
  click(p, barButton('Verwijderen'));
  await settleAll(p);
  click(p, barButton('Knippen'));
  await settleAll(p);
  assert.deepEqual(nativeLog(p), [
    'Herkennen 105,104',
    'Koppelen aan relatie 105,104',
    'download 104', 'download 105',
    'Geselecteerde items verwijderen 105,104',
    'Geselecteerde items knippen 105,104',
  ]);
  // Paste in another folder: e-Boekhouden's own "plakken".
  click(p, p.$$('.ebs-ar-folder').find((node) => node.textContent === 'Leeg'));
  await settleAll(p);
  const paste = p.$$('.ebs-ar-head-actions .ebs-ar-button').find((node) => node.textContent === 'Plakken hier');
  assert.equal(paste.disabled, false);
  click(p, paste);
  await settleAll(p);
  assert.equal(nativeLog(p).at(-1), 'Geselecteerde items plakken 105,104 naar 14');
  assert.equal(p.ours().length, 1);
});

test('Herkennen stays off for a selection e-Boekhouden cannot recognize', async () => {
  const p = await archivePage();
  click(p, rowNode(p, 'Software licentie.xml').querySelector('.ebs-ar-check'));
  await settleAll(p);
  assert.equal(p.$$('.ebs-ar-bar-button').find((node) => node.textContent === 'Herkennen').disabled, true);
});

test('"Gekoppeld (n)" expands through e-Boekhouden\'s own toggle and shows its details', async () => {
  const p = await archivePage();
  const before = p.calls.length;
  click(p, rowNode(p, 'Factuur 88231 Voorbeeld Hosting.pdf').querySelector('.ebs-ar-linkbutton'));
  await settleAll(p);
  const details = [...rowNode(p, 'Factuur 88231 Voorbeeld Hosting.pdf').querySelectorAll('.ebs-ar-details > span')].map((node) => node.textContent);
  assert.deepEqual(details, [
    'Relatie VHOST Voorbeeld Hosting',
    'Mutatie 4790 · 15-10-2026 · € 24,20 · Factuur ontvangen · 88231',
    'Uit e-Boekhouden: het laadt deze details zelf zodra je de regel uitklapt.',
  ]);
  assert.equal(rowNode(p, 'Factuur 88231 Voorbeeld Hosting.pdf').querySelector('.ebs-ar-linkbutton').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(p.calls.slice(before).map((href) => new URL(href).pathname), ['/v1/api/folder/107/koppel'], 'the page\'s own request, not ours');
  click(p, rowNode(p, 'Factuur 88231 Voorbeeld Hosting.pdf').querySelector('.ebs-ar-linkbutton'));
  await settleAll(p);
  assert.equal(rowNode(p, 'Factuur 88231 Voorbeeld Hosting.pdf').querySelector('.ebs-ar-details').children.length, 0);
});

test('folders: loading, empty and the upload window', async () => {
  const p = await archivePage({ slow: 250 });
  click(p, p.$$('.ebs-ar-folder').find((node) => node.textContent === 'Leeg'));
  await new Promise((resolve) => p.window.requestAnimationFrame(resolve));
  await new Promise((resolve) => p.window.requestAnimationFrame(resolve));
  assert.equal(p.$('.ebs-ar').dataset.state, 'loading', 'skeleton while e-Boekhouden loads the folder');
  assert.equal(p.$('.ebs-ar-skeleton').hidden, false);
  assert.equal(p.$('.ebs-ar-preview-none').textContent, 'Voorbeeld volgt zodra de map geladen is.');
  await settleAll(p, 6);
  assert.equal(p.$('.ebs-ar').dataset.state, 'empty');
  assert.equal(p.$('.ebs-ar-empty-title').textContent, 'Deze map is leeg');
  assert.equal(p.$('.ebs-ar-folder.current').textContent, 'Leeg');
  assert.equal(p.$('.ebs-ar-subtitle').textContent, '0 bestanden in Leeg · 2,3 GB van 5 GB gebruikt');
  click(p, p.$('.ebs-ar-empty .ebs-ar-button'));
  await settleAll(p);
  assert.ok(p.$('app-digitaal-archief-upload'), 'e-Boekhouden\'s own upload window');
  assert.equal(p.$('.ebs-ar-upload').hidden, false);
  assert.equal(p.$('.ebs-ar-upload-title').textContent, '3 bestanden uploaden naar Leeg');
  assert.equal(nativeLog(p).at(-1), 'Bestanden uploaden');

  // The tree toggles are e-Boekhouden's own.
  click(p, p.$$('.ebs-ar-folder-toggle').find((node) => node.getAttribute('aria-label').endsWith('Inkoopfacturen 2026')));
  await settleAll(p);
  assert.equal(p.$$('.ebs-ar-folder').some((node) => node.textContent === 'Oktober'), false);
});

test('a failing folder shows the error, and "Opnieuw laden" is e-Boekhouden\'s refresh', async () => {
  const p = await archivePage({ data: demoData({ fail: true }) });
  assert.equal(p.$('.ebs-ar').dataset.state, 'error');
  assert.equal(p.$('.ebs-ar-error-text').textContent, 'De bestanden in deze map konden niet worden geladen. e-Boekhouden meldt: "Er is iets misgegaan." Je bestanden zijn niet weg.');
  click(p, p.$('.ebs-ar-error .ebs-ar-button'));
  await settleAll(p);
  assert.equal(nativeLog(p).filter((line) => line === 'Lijst vernieuwen').length, 1);
});

test('without the page\'s own answer the rows still show, with less detail', async () => {
  const p = await archivePage({ nativeFirst: true, fakeRequest: true });
  assert.equal(rowNames(p).length, 8);
  assert.equal(rowNode(p, 'Factuur 88231 Voorbeeld Hosting.pdf').querySelector('.ebs-ar-linkbutton').textContent, 'Gekoppeld');
  click(p, rowNode(p, 'Huur kantoor november.pdf').querySelector('.ebs-ar-file'));
  await settleAll(p);
  assert.equal(p.items.length, 0, 'no id, no request');
  assert.match(p.$('.ebs-ar-preview-stage').textContent, /Kies de map opnieuw/);
  // Opening the folder again lets the extension read e-Boekhouden's answer.
  click(p, p.$('.ebs-ar-folder.current'));
  await settleAll(p, 6);
  assert.equal(rowNode(p, 'Factuur 88231 Voorbeeld Hosting.pdf').querySelector('.ebs-ar-linkbutton').textContent, 'Gekoppeld (2)');
});

test('Klassieke weergave and back, remembered per screen', async () => {
  const p = await archivePage();
  click(p, p.$('.ebs-ar-classic'));
  await settleAll(p);
  assert.equal(p.$('.ebs-ar'), null);
  assert.equal(p.document.documentElement.classList.contains('ebs-better-archive'), false);
  assert.deepEqual(p.store.classicScreens, { archive: true });
  const back = p.$('app-digitaal-archief .container-da > .ebs-ar-native-toggle a');
  assert.equal(back.textContent, 'Nieuwe weergave');
  click(p, back);
  await settleAll(p);
  assert.ok(p.$('.ebs-ar'));
  assert.equal(p.$('.ebs-ar-native-toggle'), null);
  assert.deepEqual(p.store.classicScreens, { archive: false });
});

test('with Better design off the archive and the page\'s fetch stay e-Boekhouden\'s own', async () => {
  const p = await archivePage({ settings: { betterDesign: false } });
  assert.equal(p.$('.ebs-ar, .ebs-ar-bar, .ebs-ar-native-toggle, #ebs-archive-style'), null);
  assert.equal(p.document.documentElement.classList.contains('ebs-better-archive'), false);
  assert.deepEqual(p.ours(), []);
  assert.equal(p.sent.length, 0);
});

test('on another screen nothing is observed or added', async () => {
  const p = await archivePage({ url: 'https://secure20.e-boekhouden.nl/overig/digitaal-archief/mail-herken-uitleg' });
  assert.equal(p.$('.ebs-ar'), null);
  assert.equal(p.$('#ebs-archive-style'), null);
  assert.deepEqual(p.ours(), []);
});

test('motion: hovers fade, things that appear fade in, reduced motion only fades', async () => {
  const p = await archivePage();
  const css = p.$('#ebs-archive-style').textContent;
  for (const match of css.matchAll(/([^{}\n]*:hover[^{}\n]*)\{([^}]*)\}/g)) {
    assert.ok(!/\b(display|visibility)\s*:/.test(match[2]), `${match[1].trim()} switches display`);
  }
  assert.match(css, /@keyframes ebs-ar-in \{ from \{ opacity: 0; transform: translateY\(4px\); \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.ebs-ar-in[^{]*\{ animation: ebs-ar-fade 150ms/);
  assert.match(reduced, /\.ebs-ar-skel, \.ebs-ar-page-loading \{ animation: none; \}/);
  for (const animated of css.matchAll(/transition:\s*([^;]+);/g)) {
    for (const part of animated[1].split(/,(?![^(]*\))/)) {
      assert.match(part.trim(), /^(opacity|transform|background-color|color|border-color|visibility|none)\b/, `only cheap properties move: ${part}`);
    }
  }
});
