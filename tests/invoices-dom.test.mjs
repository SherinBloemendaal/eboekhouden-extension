// The invoice screens and the billing core (invoices.js) in jsdom pages with
// e-Boekhouden's markup: the invoice list, the invoice form and the line
// window. Also: the request count (a list of 1000 invoices makes exactly
// one request of ours), the pure parts and the style rules of both billing
// files.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeAll } from './dom.mjs';
import { billingPage, invoiceListHtml, invoiceEditHtml, openLineWindow, post } from './billing-fixtures.mjs';

after(closeAll);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const INVOICES = 'https://secure20.e-boekhouden.nl/facturen/factuur';

// Dates around today, as e-Boekhouden writes them.
const pad = (n) => String(n).padStart(2, '0');
function day(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}
const iso = (offset) => {
  const [d, m, y] = day(offset).split('-');
  return `${y}-${m}-${d}T00:00:00`;
};

const ROWS = [
  { number: 'VB-F000000233', date: day(0), excl: '-193,55', incl: '-234,20', due: day(14), verwerkt: false },
  { number: 'VB-F000000232', date: day(-1), excl: '1.560,00', incl: '1.887,60', due: day(13) },
  { number: 'VB-F000000231', date: day(-1), excl: '1.000,00', incl: '1.210,00', due: day(13) },
  { number: 'VB-F000000230', date: day(-5), relation: 'Studio Noord', excl: '10,00', incl: '12,10', due: day(9) },
  { number: 'VB-F000000229', date: day(-26), excl: '2.850,00', incl: '3.448,50', due: day(-12), mail: false },
];
const POSTS = [
  post('VB-F000000232', 1887.6, iso(13)),
  post('VB-F000000231', 1210, iso(13)),
  post('VB-F000000229', 3448.5, iso(-12)),
];

async function invoicePage(options = {}) {
  const p = billingPage(invoiceListHtml(options.rows ?? ROWS, options), { url: INVOICES, posts: options.posts ?? POSTS, ...options });
  await p.settle(4);
  return p;
}

const rowsOf = (document) => [...document.querySelectorAll('.ebs-b-body .ebs-b-row')];
const cell = (row, index) => row.children[index].textContent.trim();

// ---------------------------------------------------------------------------
// The invoice list
// ---------------------------------------------------------------------------

test('the invoice list gets the new view, with the status from the open posts', async () => {
  const p = await invoicePage();
  const { document } = p;
  assert.ok(document.querySelector('.ebs-b-view'), 'the view is there');
  assert.ok(document.documentElement.classList.contains('ebs-billing'));
  assert.equal(document.querySelector('app-factuur-list').getAttribute('data-ebs-billing-list'), '');
  assert.ok(document.getElementById('ebs-billing-style'));
  const rows = rowsOf(document);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((row) => cell(row, 4)), ['Niet verwerkt', 'Open', 'Open', 'Betaald', 'Te laat']);
  assert.equal(cell(rows[0], 7), 'creditnota');
  assert.equal(cell(rows[1], 7), 'over 13 dagen');
  assert.equal(cell(rows[4], 7), '12 dagen te laat');
  assert.equal(cell(rows[4], 3), 'Demo Klant B.V.');
  assert.equal(cell(rows[1], 6), '1.887,60');
  const cards = [...document.querySelectorAll('.ebs-b-card')].map((node) => [node.querySelector('.ebs-b-card-value').textContent, node.querySelector('.ebs-b-card-sub').textContent]);
  assert.deepEqual(cards[0], ['€ 6.546,10', '3 facturen, alle open posten']);
  assert.deepEqual(cards[1], ['€ 3.448,50', '1 factuur, 12 dagen']);
  assert.equal(cards[3][0], '1 factuur');
  assert.match(document.querySelector('.ebs-b-subtitle').textContent, /^5 facturen/);
  assert.match(document.querySelector('.ebs-b-chip').textContent, /Alles · 5/);
  assert.equal(p.fetches.length, 1, 'one request of ours');
  assert.match(p.fetches[0], /\/v1\/api\/openpost\/gridtable\/openpost\?offset=0&limit=2000&.*soort=Debiteur/);
  p.close();
});

test('a list of 1000 invoices makes exactly one request of ours, also after clicks and redraws', async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ number: `VB-F${String(i).padStart(9, '0')}`, date: day(-i % 60), due: day(14 - (i % 30)) }));
  const posts = rows.filter((_, i) => i % 3 === 0).map((row) => post(row.number, 1210, iso(14)));
  const p = await invoicePage({ rows, posts, count: 1000 });
  const { document } = p;
  assert.equal(rowsOf(document).length, 1000);
  assert.equal(p.fetches.length, 1);
  assert.equal(p.slots(), 1, 'one slot from the shared budget');
  // Clicks, typing and native changes redraw; none asks again.
  rowsOf(document)[3].querySelector('.ebs-b-check').click();
  document.querySelector('.ebs-b-chip').click();
  const search = document.querySelector('.ebs-b-search input');
  search.value = 'VB-F00000001';
  search.dispatchEvent(new p.window.Event('input', { bubbles: true }));
  document.querySelector('app-grid-header .grid-header-title span').textContent = ' (1000 regels) ';
  await p.settle(4);
  assert.equal(p.fetches.length, 1, 'still one request');
  assert.ok(rowsOf(document).length < 1000, 'the search filtered');
  p.close();
});

test('our checkbox ticks e-Boekhouden\'s own, and the action bar clicks its bulk action', async () => {
  const p = await invoicePage();
  const { document } = p;
  const native = document.querySelectorAll('app-grid-body tbody .grid-multi-check input');
  rowsOf(document)[1].querySelector('.ebs-b-check').click();
  rowsOf(document)[2].querySelector('.ebs-b-check').click();
  await p.settle();
  assert.equal(native[1].checked, true);
  assert.equal(native[2].checked, true);
  const bar = document.querySelector('.ebs-b-bar');
  assert.ok(bar.classList.contains('show'));
  assert.equal(bar.querySelector('.ebs-b-bar-count').textContent, '2 facturen geselecteerd');
  assert.equal(bar.querySelector('.ebs-b-bar-total').textContent, 'Totaal € 3.097,60 incl.');
  assert.equal(rowsOf(document)[1].getAttribute('class'), 'ebs-b-row on');
  const clicked = [];
  for (const li of document.querySelectorAll('app-grid-bulk-action li')) li.addEventListener('click', () => clicked.push(li.textContent.trim()));
  const mail = [...bar.querySelectorAll('button')].find((node) => node.textContent === 'Klaarzetten voor mailen');
  mail.click();
  assert.deepEqual(clicked, ['Geselecteerde facturen klaarzetten voor mailen']);
  assert.equal(mail.getAttribute('aria-busy'), 'true', 'the button waits');
  assert.equal(mail.textContent, 'Bezig…');
  [...bar.querySelectorAll('button')].find((node) => node.textContent === 'Selectie wissen').click();
  await p.settle();
  assert.equal(native[1].checked, false);
  assert.ok(!bar.classList.contains('show'));
  p.close();
});

test('the row buttons click e-Boekhouden\'s own links; Verwijderen asks with its own words', async () => {
  const p = await invoicePage();
  const { document } = p;
  const tr = document.querySelectorAll('app-grid-body tbody tr')[1];
  const clicks = [];
  for (const node of tr.querySelectorAll('a')) node.addEventListener('click', (event) => {
    event.preventDefault();
    clicks.push(node.querySelector('[title]')?.title ?? node.title);
  });
  const buttons = rowsOf(document)[1].querySelectorAll('.ebs-b-row-actions button');
  for (const node of [...buttons].slice(0, 4)) node.click();
  assert.deepEqual(clicks, ['Wijzigen', 'Factuur kopiëren', 'Factuur printen', 'Factuur e-mailen']);
  assert.equal(rowsOf(document)[4].querySelector('[data-role="mail"]').disabled, true, 'no mail link, no mail button');

  // The native confirmation appears in the hidden row; we show its words.
  const trash = tr.querySelector('[title="Verwijderen"]');
  let confirmed = 0;
  trash.addEventListener('click', () => {
    trash.insertAdjacentHTML('afterend', '<div class="inner-content"><span class="confirmMessage"><b>Let op:</b> Als u doorgaat, dan wordt de factuur definitief verwijderd. <br><span id="confirm">Doorgaan</span><span id="cancel">Annuleren</span></span></div>');
    tr.querySelector('#confirm').addEventListener('click', () => { confirmed += 1; });
  });
  buttons[4].click();
  buttons[4].click();
  await p.settle();
  assert.equal(document.querySelectorAll('.ebs-dialog-backdrop').length, 1, 'a double click asks once');
  const dialog = document.querySelector('.ebs-dialog-backdrop');
  assert.ok(dialog, 'a dialog');
  assert.match(dialog.textContent, /Let op: Als u doorgaat, dan wordt de factuur definitief verwijderd\./);
  assert.equal(confirmed, 0, 'nothing confirmed before the user answers');
  [...dialog.querySelectorAll('button')].find((node) => node.textContent === 'Doorgaan').click();
  assert.equal(confirmed, 1, 'e-Boekhouden\'s own Doorgaan');

  // Annuleren (or Escape) answers e-Boekhouden's question with its own Annuleren.
  await new Promise((resolve) => setTimeout(resolve, 200));
  let cancelled = 0;
  trash.addEventListener('click', () => tr.querySelector('#cancel').addEventListener('click', () => { cancelled += 1; }));
  buttons[4].click();
  await p.settle();
  const again = document.querySelector('.ebs-dialog-backdrop');
  [...again.querySelectorAll('button')].find((node) => node.textContent === 'Annuleren').click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual([confirmed, cancelled], [1, 1], 'cancelled, nothing deleted');
  p.close();
});

test('the status chips filter, the empty search says where it looked, Filters wissen resets', async () => {
  const p = await invoicePage();
  const { document } = p;
  const chips = [...document.querySelectorAll('.ebs-b-chip')];
  assert.deepEqual(chips.slice(0, 3).map((node) => node.textContent), ['Alles · 5', 'Open · 2', 'Te laat · 1']);
  chips[2].click();
  await p.settle();
  assert.deepEqual(rowsOf(document).map((row) => cell(row, 2)), ['VB-F000000229']);
  assert.equal(chips[2].getAttribute('aria-pressed'), 'true');
  chips[4].click();
  await p.settle();
  assert.deepEqual(rowsOf(document).map((row) => cell(row, 2)), ['VB-F000000233']);
  const search = document.querySelector('.ebs-b-search input');
  search.value = 'demo bouw 2025';
  search.dispatchEvent(new p.window.Event('input', { bubbles: true }));
  await p.settle();
  const box = document.querySelector('.ebs-b-message');
  assert.equal(box.querySelector('.ebs-b-message-title').textContent, 'Niets gevonden voor "demo bouw 2025"');
  box.querySelector('button').click();
  await p.settle();
  assert.equal(rowsOf(document).length, 5);
  assert.equal(search.value, '');
  p.close();
});

test('Klaar voor incasso is e-Boekhouden\'s own filter: its checkbox and its Zoeken', async () => {
  const p = await invoicePage();
  const { document } = p;
  let searched = 0;
  document.querySelector('app-factuur-list app-form form').addEventListener('submit', (event) => {
    event.preventDefault();
    searched += 1;
  });
  const chip = [...document.querySelectorAll('.ebs-b-chip')].find((node) => node.textContent === 'Klaar voor incasso');
  chip.click();
  assert.equal(document.getElementById('automatischeIncasso').checked, true);
  assert.equal(searched, 1);
  await p.settle();
  assert.equal(chip.getAttribute('aria-pressed'), 'true');
  p.close();
});

test('Meer filters opens e-Boekhouden\'s own search form in a dialog and puts it back', async () => {
  const p = await invoicePage();
  const { document } = p;
  const form = document.querySelector('#trefwoordRegels').closest('app-form');
  assert.ok(form.closest('.ebs-b-hidden-slot'), 'out of sight first');
  document.querySelector('.ebs-b-more-filters').click();
  await p.settle();
  assert.ok(form.closest('.ebs-dialog-backdrop'), 'in the dialog');
  p.window.EBS.dialog.closeAll?.();
  document.querySelector('.ebs-dialog-backdrop .ebs-dialog-close, .ebs-dialog-backdrop [aria-label="Sluiten"]')?.click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  await p.settle();
  assert.ok(form.closest('.ebs-b-hidden-slot'), 'back where it waits');
  p.close();
});

test('the pagination of e-Boekhouden, in the new footer', async () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({ number: `VB-${i}` }));
  const p = await invoicePage({ rows, count: 233, total: '22.104,07' });
  const { document } = p;
  const footer = document.querySelector('.ebs-b-footer');
  assert.equal(footer.querySelector('.ebs-b-footer-info').textContent, '1 tot 100 van 233 · totaal incl. btw € 22.104,07');
  assert.equal(footer.querySelector('.ebs-b-pager-page').textContent, 'Pagina 1 van 3');
  assert.equal(document.querySelector('.ebs-b-chip').textContent, 'Alles · 233', 'Alles counts every page of e-Boekhouden');
  const search = document.querySelector('.ebs-b-search input');
  search.value = 'VB-1';
  search.dispatchEvent(new p.window.Event('input', { bubbles: true }));
  await p.settle();
  assert.equal(document.querySelector('.ebs-b-chip').textContent, 'Alles · 11', 'a search counts the loaded rows it found');
  assert.equal(footer.querySelector('[aria-label="Vorige pagina"]').disabled, true);
  let next = 0;
  [...document.querySelectorAll('app-pagination li')].at(-1).addEventListener('click', () => { next += 1; });
  footer.querySelector('[aria-label="Volgende pagina"]').click();
  assert.equal(next, 1);
  const native = document.querySelector('select.pagesizes-select');
  let changed = 0;
  native.addEventListener('change', () => { changed += 1; });
  const size = footer.querySelector('select');
  size.value = '500';
  size.dispatchEvent(new p.window.Event('change', { bubbles: true }));
  assert.equal(native.value, '500');
  assert.equal(changed, 1);
  p.close();
});

test('loading, empty and error states', async () => {
  const loading = await invoicePage({ noGrid: true });
  assert.ok(loading.document.querySelector('.ebs-b-skeleton'), 'grey blocks while the list loads');
  assert.equal(loading.document.querySelectorAll('.ebs-b-card.loading').length, 2, 'no zeros in the cards that jump later');
  loading.close();

  const empty = await invoicePage({ rows: [], posts: [] });
  const box = empty.document.querySelector('.ebs-b-message');
  assert.equal(box.querySelector('.ebs-b-message-title').textContent, 'Nog geen facturen');
  assert.match(box.querySelector('button').textContent, /Nieuwe factuur/);
  empty.close();

  const failed = await invoicePage({ noGrid: true, notification: { error: true, message: 'Er is iets misgegaan.' } });
  const alert = failed.document.querySelector('.ebs-b-message.alert');
  assert.equal(alert.getAttribute('role'), 'alert');
  assert.match(alert.textContent, /e-Boekhouden meldt: "Er is iets misgegaan\." Er is niets veranderd aan je facturen\./);
  failed.close();
});

test('a success message of e-Boekhouden shows as a toast, with its own words', async () => {
  const p = await invoicePage({ notification: { error: false, message: 'Factuur is opgeslagen onder nummer VB-F000000234' } });
  const toast = p.document.querySelector('.ebs-b-toast');
  assert.ok(toast, 'a toast');
  assert.equal(toast.getAttribute('role'), 'status');
  assert.equal(toast.textContent, 'Factuur is opgeslagen onder nummer VB-F000000234');
  assert.match(p.document.getElementById('ebs-billing-style').textContent, /app-notification-bar \.notification-bar:not\(\.error\) \{ display: none !important; \}/, 'the native bar steps aside');
  p.close();
});

test('without the open posts the list stays, without status, and asks again only on a click', async () => {
  const p = await invoicePage({ postsStatus: 500 });
  const { document } = p;
  assert.equal(rowsOf(document).length, 5);
  assert.deepEqual(rowsOf(document).map((row) => cell(row, 4)), ['Niet verwerkt', '', '', '', '']);
  assert.equal(document.querySelector('.ebs-b-card .ebs-b-card-value').textContent, 'onbekend');
  const retry = document.querySelector('.ebs-b-card-retry');
  assert.ok(retry.classList.contains('show'));
  assert.equal([...document.querySelectorAll('.ebs-b-chip')][1].disabled, true, 'Open needs the open posts');
  await p.settle(6);
  assert.equal(p.fetches.length, 1, 'never in a loop');
  p.close();
});

test('Klassieke weergave gives e-Boekhouden\'s own list back, Nieuwe weergave returns', async () => {
  const p = await invoicePage();
  const { document } = p;
  [...document.querySelectorAll('.ebs-b-link')].find((node) => node.textContent === 'Klassieke weergave').click();
  await p.settle();
  assert.equal(document.querySelector('.ebs-b-view'), null);
  assert.equal(document.querySelector('app-factuur-list').hasAttribute('data-ebs-billing-list'), false);
  assert.deepEqual(p.store.classicScreens, { invoices: true });
  assert.ok(document.querySelector('#trefwoordRegels').closest('.middle-top-container'), 'the search form is home again');
  const back = document.querySelector('.ebs-b-native-toggle a');
  assert.equal(back.textContent, 'Nieuwe weergave');
  back.click();
  await p.settle();
  assert.ok(document.querySelector('.ebs-b-view'));
  p.close();
});

test('with Better design off nothing changes and nothing is asked', async () => {
  const p = billingPage(invoiceListHtml(ROWS), { url: INVOICES, settings: { betterDesign: false }, posts: POSTS });
  const before = p.document.body.innerHTML;
  await p.settle(4);
  assert.equal(p.document.body.innerHTML, before);
  assert.equal(p.document.getElementById('ebs-billing-style'), null);
  assert.equal(p.fetches.length, 0);
  assert.equal(p.slots(), 0);
  p.close();
});

test('the invoice status and periods', async () => {
  const p = await invoicePage();
  const { invoiceStatus, inPeriod } = p.window.__ebsInvoicesTest;
  const B = p.window.EBS.billing;
  const now = B.dayTime(2026, 10, 29);
  const posts = B.indexPosts({ data: [post('A', 10, '2026-10-24T00:00:00'), post('B', 10, '2026-11-12T00:00:00'), post('C', 0, '2026-10-01')], rowCount: 3 });
  assert.equal(invoiceStatus({ number: 'X', verwerkt: false, due: null }, posts, now), 'draft');
  assert.equal(invoiceStatus({ number: 'A', verwerkt: true, due: B.dayTime(2026, 10, 24) }, posts, now), 'late');
  assert.equal(invoiceStatus({ number: 'B', verwerkt: true, due: B.dayTime(2026, 11, 12) }, posts, now), 'open');
  assert.equal(invoiceStatus({ number: 'C', verwerkt: true, due: null }, posts, now), 'paid', 'nothing left open');
  assert.equal(invoiceStatus({ number: 'D', verwerkt: true, due: null }, posts, now), 'paid');
  assert.equal(invoiceStatus({ number: 'D', verwerkt: true, due: null }, { ...posts, complete: false }, now), null, 'a cut-short list knows nothing');
  const full = Array.from({ length: 2000 }, (_, i) => post(`F${i}`, 10, '2026-11-12'));
  assert.equal(B.indexPosts({ data: full }).complete, false, 'as long as the limit, without a count: maybe cut short');
  assert.equal(B.indexPosts({ data: full, rowCount: 2000 }).complete, true);
  assert.equal(B.indexPosts({ data: full, rowCount: 2400 }).complete, false);
  assert.equal(B.indexPosts({ data: full.slice(0, 10) }).complete, true);
  assert.equal(B.indexPosts(full.slice(0, 10)).complete, true, 'a bare array');
  assert.equal(invoiceStatus({ number: 'D', verwerkt: true, due: null }, { ok: false }, now), null);
  assert.equal(invoiceStatus({ number: 'B', verwerkt: null, due: null }, posts, now), 'open', 'the Verwerkt column hidden');
  assert.equal(invoiceStatus({ number: 'D', verwerkt: null, due: null }, posts, now), null);
  assert.equal(inPeriod(B.dayTime(2026, 9, 30), 'last-month', now), true);
  assert.equal(inPeriod(B.dayTime(2025, 12, 31), 'last-year', now), true);
  assert.equal(inPeriod(B.dayTime(2026, 10, 1), 'month', now), true);
  assert.equal(inPeriod(null, 'year', now), false);
  assert.equal(B.relativeDue(B.dayTime(2026, 10, 17), now), '12 dagen te laat');
  assert.equal(B.relativeDue(B.dayTime(2026, 11, 11), now), 'over 13 dagen');
  p.close();
});

// ---------------------------------------------------------------------------
// The invoice form
// ---------------------------------------------------------------------------

async function editPage(html, url, options = {}) {
  const p = billingPage(html, { url, posts: [], ...options });
  await p.settle(4);
  return p;
}

test('the invoice form: e-Boekhouden\'s own rows in the new layout, and back in order', async () => {
  const p = await editPage(invoiceEditHtml(), 'https://secure20.e-boekhouden.nl/facturen/factuur/toevoegen/0');
  const { document } = p;
  const order = () => [...document.querySelectorAll('app-factuur-form .form-row')].map((row) => row.querySelector('input[id], select[id], textarea[id]').id);
  const view = document.querySelector('.ebs-b-edit');
  assert.ok(view);
  assert.equal(view.querySelector('.ebs-b-edit-title').textContent, 'Factuur toevoegen');
  const details = view.querySelector('[aria-label="Gegevens"]');
  assert.ok(details.querySelector('#relatieId-AutocompletePickerInput'));
  for (const id of ['nummer', 'datum', 'termijn', 'kenmerk']) assert.ok(details.querySelector(`#${id}`), id);
  assert.ok(view.querySelector('[aria-label="Tekst en opties"] #factuurtekst'));
  assert.ok(view.querySelector('.ebs-b-more #factOm1'), 'the rest under Meer velden');
  assert.ok(view.querySelector('.ebs-b-more #uitersteBetaaldatum'));
  assert.ok(view.querySelector('.ebs-b-hidden-slot #inEx'), 'Bedragen is our toggle');
  assert.equal(view.querySelector('.ebs-b-hidden-slot #nummer'), null, 'only the part with inEx is out of sight, not the row of Factuurnummer it sits in');
  assert.equal(view.querySelector('.ebs-b-due-note').textContent, '· vervalt 12-11-2026');
  const emailBlock = [...view.querySelectorAll('.ebs-b-check-row')].find((block) => /Per e-mail/.test(block.textContent));
  assert.equal(emailBlock.tagName, 'LABEL');
  assert.equal(emailBlock.control, document.getElementById('emailen'), 'the block is the label of e-Boekhouden\'s own checkbox');
  assert.equal(view.querySelector('.ebs-b-small-title').textContent, 'Versturen (twee aparte vinkjes, ook samen)');

  // Lines and totals, read from e-Boekhouden's list.
  const lines = [...view.querySelectorAll('.ebs-b-lines .ebs-b-line')];
  assert.equal(lines.length, 2);
  assert.equal(lines[0].querySelector('.ebs-b-line-name').textContent, 'Management fee oktober');
  assert.equal(lines[0].querySelector('.ebs-b-line-note').textContent, 'Tegenrekening: zie het regelvenster');
  assert.deepEqual([...view.querySelectorAll('.ebs-b-total-line')].map((line) => line.textContent), ['Excl. btw€ 2.880,00', 'Btw laag 9%€ 256,50', 'Btw hoog 21%€ 6,30', 'Incl. btw€ 3.142,80']);
  let added = 0;
  document.querySelector('.center-block a').addEventListener('click', () => { added += 1; });
  view.querySelector('.ebs-b-dashed').click();
  assert.equal(added, 1, 'Regel toevoegen is e-Boekhouden\'s own link');

  // Bedragen sets e-Boekhouden's own select, in the user's click.
  const incl = [...view.querySelectorAll('.ebs-b-segment-option')].find((node) => node.dataset.value === 'IN');
  incl.click();
  assert.equal(document.getElementById('inEx').value, 'IN');
  await p.settle();
  assert.equal(incl.getAttribute('aria-checked'), 'true');

  // Opslaan is e-Boekhouden's own submit, and waits for its answer.
  let submitted = 0;
  document.querySelector('[data-ebs-billing-form] form').addEventListener('submit', (event) => {
    event.preventDefault();
    submitted += 1;
  });
  const save = view.querySelector('.ebs-b-save');
  save.click();
  assert.equal(submitted, 1);
  assert.equal(save.textContent, 'Opslaan…');
  assert.equal(save.disabled, true);

  // The classic view: every row back in its own place.
  [...view.querySelectorAll('.ebs-b-link')].find((node) => node.textContent === 'Klassieke weergave').click();
  await p.settle();
  assert.equal(document.querySelector('.ebs-b-edit'), null);
  assert.deepEqual(order(), ['relatieId-AutocompletePickerInput', 'nummer', 'datum', 'kenmerk', 'termijn', 'uitersteBetaaldatum', 'factuurtekst', 'factuursjabloonId', 'emailsjabloonId', 'incasso',
    'machtigingSoort', 'machtigingId', 'machtigingDatum', 'iban', 'tenNameVan', 'plaats', 'factOm1', 'factOm2', 'factOm3', 'directVerwerken', 'mutOmschrijving', 'printen', 'emailen']);
  assert.ok(document.querySelector('.form-row #nummer').closest('.form-row').querySelector('span.float-right #inEx'), 'inEx back in the row of Factuurnummer');
  assert.equal(document.querySelectorAll('.ebs-b-native-icon').length, 0, 'the date pickers have their own icons again');
  assert.ok(document.querySelector('app-factuur-form > div > app-form > form > .form-body'), 'the form is home');
  assert.ok(document.querySelector('app-factuur-form app-form app-factuurregel-list'));
  assert.equal(document.querySelectorAll('[data-ebs-native]').length, 0);
  p.close();
});

test('the moved rows stay inside e-Boekhouden\'s app-form: its focus on a rejected field works, also under Meer velden', async () => {
  const p = await editPage(invoiceEditHtml(), 'https://secure20.e-boekhouden.nl/facturen/factuur/toevoegen/0');
  const { document } = p;
  const view = document.querySelector('.ebs-b-edit');
  const appForm = document.querySelector('app-form[data-ebs-billing-form]');
  assert.equal(view.parentNode, appForm, 'the layout is inside app-form');
  // e-Boekhouden's own form.focusOnField(name), word for word.
  const focusOnField = (name) => {
    const field = document.querySelector(`app-form .form-row .form-component #${name}`);
    field?.focus();
    return field;
  };
  assert.equal(focusOnField('nummer'), document.getElementById('nummer'));
  assert.ok(focusOnField('nummer').closest('[aria-label="Gegevens"]'), 'the row in our layout');
  assert.equal(document.activeElement, document.getElementById('nummer'));

  // Meer velden is closed, its fields still take the focus; that opens it.
  const more = view.querySelector('.ebs-b-more');
  const toggle = more.querySelector('.ebs-b-more-toggle');
  assert.equal(more.classList.contains('open'), false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(focusOnField('factOm1'), document.getElementById('factOm1'));
  assert.equal(document.activeElement, document.getElementById('factOm1'));
  assert.equal(more.classList.contains('open'), true, 'opened by the focus');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  toggle.click();
  assert.equal(more.classList.contains('open'), false, 'the user closes it again');

  // The values are e-Boekhouden's: a field under Meer velden is in the form that Opslaan submits.
  const formNode = view.querySelector('.ebs-b-more-slot > form');
  assert.ok(formNode.contains(document.getElementById('factOm1')));
  assert.equal(document.querySelectorAll('.ebs-b-edit #nummer, .ebs-b-edit #factOm1, .ebs-b-edit #emailen').length, 3, 'nothing doubled');
  p.close();
});

test('Opslaan clicks the form\'s own submit, never the one of an open line window', async () => {
  const p = await editPage(invoiceEditHtml(), 'https://secure20.e-boekhouden.nl/facturen/factuur/toevoegen/0');
  const { document } = p;
  const overlay = openLineWindow(document);
  await p.settle();
  let line = 0;
  let main = 0;
  overlay.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    line += 1;
  });
  document.querySelector('.ebs-b-more-slot > form').addEventListener('submit', (event) => {
    event.preventDefault();
    main += 1;
  });
  document.querySelector('.ebs-b-save').click();
  assert.deepEqual([main, line], [1, 0]);
  p.close();
});

test('e-Boekhouden redrawing parts of the form: nothing doubles, nothing dead comes back', async () => {
  const p = await editPage(invoiceEditHtml(), 'https://secure20.e-boekhouden.nl/facturen/factuur/toevoegen/0');
  const { document } = p;
  const host = document.querySelector('app-factuur-form');
  // An @if closes on a row we moved (Angular removes the node where it is) ...
  const kenmerk = document.getElementById('kenmerk').closest('.form-row');
  kenmerk.remove();
  // ... and opens again: a new row, where Angular puts it, in its form body.
  const body = document.getElementById('factOm1').closest('.form-body');
  body.insertAdjacentHTML('afterbegin', '<div class="form-row"><div class="form-component"><app-form-label><label>Uw kenmerk</label></app-form-label><app-text-input><div class="form-control"><input id="kenmerk" class="displayValue form-input" value="nieuw"></div></app-text-input></div></div>');
  await p.settle();
  assert.equal(document.querySelectorAll('#kenmerk').length, 1);
  assert.ok(document.querySelector('[aria-label="Gegevens"] #kenmerk'), 'the new row in the layout');
  assert.equal(document.getElementById('kenmerk').value, 'nieuw');

  // Classic: every row home, the removed one does not come back.
  [...document.querySelectorAll('.ebs-b-link')].find((node) => node.textContent === 'Klassieke weergave').click();
  await p.settle();
  assert.equal(document.querySelectorAll('#kenmerk').length, 1);
  assert.equal(document.getElementById('kenmerk').value, 'nieuw');
  assert.equal(kenmerk.isConnected, false);
  const comments = [];
  const walker = document.createTreeWalker(host, p.window.NodeFilter.SHOW_COMMENT);
  while (walker.nextNode()) comments.push(walker.currentNode.data);
  assert.deepEqual(comments.filter((data) => data === 'ebs-billing'), [], 'no marks left behind');

  // Better design again, then e-Boekhouden draws its whole form anew.
  document.querySelector('.ebs-b-native-toggle a').click();
  await p.settle();
  assert.ok(document.querySelector('.ebs-b-edit'));
  const wrapper = host.querySelector(':scope > div');
  wrapper.remove();
  host.insertAdjacentHTML('beforeend', invoiceEditHtml().match(/<app-factuur-form>([\s\S]*)<\/app-factuur-form>/)[1]);
  await p.settle(4);
  assert.equal(document.querySelectorAll('.ebs-b-edit').length, 1, 'one layout, for the new form');
  assert.equal(document.querySelector('.ebs-b-edit').parentNode, host.querySelector('app-form'));
  assert.equal(document.querySelectorAll('#nummer').length, 1);
  assert.ok(document.querySelector('[aria-label="Gegevens"] #nummer'));
  assert.equal(p.fetches.length, 0, 'the form asks nothing');
  p.close();
});

test('a route change out of the screen gives everything back, and in again draws anew', async () => {
  const p = await editPage(invoiceEditHtml(), 'https://secure20.e-boekhouden.nl/facturen/factuur/toevoegen/0');
  const { document, window } = p;
  assert.ok(document.querySelector('.ebs-b-edit'));
  // Angular changes the URL first and drops the old screen a moment later.
  window.history.pushState({}, '', '/facturen/factuur');
  await new Promise((resolve) => setTimeout(resolve, 400));
  await p.settle();
  assert.equal(document.querySelector('.ebs-b-edit'), null);
  assert.equal(document.querySelectorAll('[data-ebs-native]').length, 0);
  assert.ok(document.querySelector('app-factuur-form > div > app-form > form > .form-body #nummer'), 'rows home');
  assert.equal(document.documentElement.classList.contains('ebs-billing'), false);
  window.history.pushState({}, '', '/facturen/factuur/toevoegen/0');
  await new Promise((resolve) => setTimeout(resolve, 400));
  await p.settle();
  assert.equal(document.querySelectorAll('.ebs-b-edit').length, 1);
  p.close();

  // The list: its action bar lives on body and goes with the screen.
  const list = await invoicePage();
  rowsOf(list.document)[1].querySelector('.ebs-b-check').click();
  await list.settle();
  assert.ok(list.document.querySelector('.ebs-b-bar.show'));
  list.window.history.pushState({}, '', '/facturen/factuur/toevoegen/0');
  await new Promise((resolve) => setTimeout(resolve, 400));
  await list.settle();
  assert.equal(list.document.querySelector('.ebs-b-bar'), null);
  assert.equal(list.document.querySelector('.ebs-b-view'), null);
  assert.ok(list.document.querySelector('#trefwoordRegels').closest('.middle-top-container'), 'the search form is home');
  list.close();
});

test('the line window warns about preselected values and Overnemen picks the last choice for this relation', async () => {
  const store = { 'store:123/billing/last-line': { v: { 'DEMO Demo Klant B.V.': { vat: 'Btw hoog 21%', ledger: '8000 Omzet dienstverlening', at: 1 } }, at: 1, by: 'local' } };
  const p = await editPage(invoiceEditHtml(), 'https://secure20.e-boekhouden.nl/facturen/factuur/toevoegen/0', { store });
  const { document, window } = p;
  window.localStorage.setItem('EBV2;c=factuurregel-form;i=42;k=btw', '"HOOG"');
  const before = window.localStorage.length;
  const overlay = openLineWindow(document);
  await p.settle();
  assert.equal(overlay.getAttribute('data-ebs-line-window'), '');
  assert.equal(overlay.querySelector('.ebs-b-modal-sub').textContent, 'Het regelvenster van e-Boekhouden, anders opgemaakt');
  const warning = overlay.querySelector('.ebs-b-modal-warning');
  assert.ok(warning.classList.contains('show'));
  assert.equal(warning.getAttribute('role'), 'alert');
  assert.equal(warning.querySelector('.ebs-b-modal-warning-text').textContent, 'Btw laag 9% is voorgeselecteerd, niet in dit venster gekozen. Tegenrekening 0100 Deelneming Voorbeeld is voorgeselecteerd, niet in dit venster gekozen.');
  assert.equal(warning.querySelector('.ebs-b-modal-warning-source').textContent, 'e-Boekhouden zet je laatst gebruikte btw en tegenrekening voor.');
  assert.ok(overlay.querySelector('app-autocomplete[data-ebs-risk]'));
  const suggestion = warning.querySelector('.ebs-b-modal-suggestion');
  assert.ok(suggestion.classList.contains('show'));
  assert.equal(suggestion.querySelector('.ebs-b-modal-suggestion-text').textContent, 'Laatst gekozen bij DEMO Demo Klant B.V. (onthouden in jouw browser): Btw hoog 21%, 8000 Omzet dienstverlening.');

  const take = suggestion.querySelector('.ebs-b-take');
  take.click();
  assert.equal(take.textContent, 'Bezig…');
  await new Promise((resolve) => setTimeout(resolve, 900));
  await p.settle();
  assert.equal(overlay.querySelector('#btw-AutocompletePickerInput').value, 'Btw hoog 21%');
  assert.equal(overlay.querySelector('#grootboekrekeningId-AutocompletePickerInput').value, '8000 Omzet dienstverlening');
  assert.ok(!warning.classList.contains('show'), 'chosen now: no warning');
  assert.equal(overlay.querySelector('[data-ebs-risk]'), null);
  assert.equal(window.localStorage.length, before, 'e-Boekhouden\'s own storage is only read');
  assert.equal(window.localStorage.getItem('EBV2;c=factuurregel-form;i=42;k=btw'), '"HOOG"');
  p.close();
});

test('a line saved without choosing keeps a warning on the line and in the summary', async () => {
  const p = await editPage(invoiceEditHtml(), 'https://secure20.e-boekhouden.nl/facturen/factuur/toevoegen/0');
  const { document, window } = p;
  const overlay = openLineWindow(document);
  await p.settle();
  const B = window.EBS.billing;
  overlay.querySelector('#omschrijving').value = 'Licentie per gebruiker';
  overlay.querySelector('#aantal').value = '3';
  overlay.querySelector('#prijsExcl').value = '10,00';
  // The user's own click on e-Boekhouden's Opslaan in the window.
  B.lineWindow.onUserEvent({ isTrusted: true, type: 'click', target: overlay.querySelector('button.form-submit') });
  overlay.remove();
  await p.settle();
  const line = [...document.querySelectorAll('.ebs-b-lines .ebs-b-line')][1];
  assert.ok(line.querySelector('.ebs-b-line-flag'), 'a mark on the line');
  assert.equal(line.querySelector('.ebs-b-line-note').textContent, 'Tegenrekening 0100 Deelneming Voorbeeld (gezien in het regelvenster)');
  const summary = document.querySelector('.ebs-b-warning-summary');
  assert.ok(summary.classList.contains('show'));
  assert.equal(summary.textContent, '1 regel heeft een btw of tegenrekening die voorgeselecteerd was en niet in het regelvenster is gekozen. Een melding, geen blokkade.');
  const kept = await window.EBS.store.get('123/billing/last-line');
  assert.deepEqual(Object.keys(kept), ['DEMO Demo Klant B.V.']);
  assert.equal(kept['DEMO Demo Klant B.V.'].vat, 'Btw laag 9%');
  p.close();
});

test('an edited line has no preselection warning; a touched field loses it', async () => {
  const p = await editPage(invoiceEditHtml(), 'https://secure20.e-boekhouden.nl/facturen/factuur/toevoegen/7');
  const { document, window } = p;
  assert.equal(document.querySelector('.ebs-b-edit-title').textContent, 'Factuur wijzigen');
  let overlay = openLineWindow(document, { add: false });
  await p.settle();
  assert.ok(!overlay.querySelector('.ebs-b-modal-warning').classList.contains('show'));
  overlay.remove();
  await p.settle();
  overlay = openLineWindow(document);
  await p.settle();
  window.EBS.billing.lineWindow.onUserEvent({ isTrusted: true, type: 'mousedown', target: overlay.querySelector('#btw-AutocompletePickerInput') });
  window.EBS.billing.schedule();
  await p.settle();
  assert.equal(overlay.querySelector('.ebs-b-modal-warning-text').textContent, 'Tegenrekening 0100 Deelneming Voorbeeld is voorgeselecteerd, niet in dit venster gekozen.');
  // An untrusted event (a page script) counts for nothing.
  window.EBS.billing.lineWindow.onUserEvent({ isTrusted: false, type: 'mousedown', target: overlay.querySelector('#grootboekrekeningId-AutocompletePickerInput') });
  window.EBS.billing.schedule();
  await p.settle();
  assert.ok(overlay.querySelector('.ebs-b-modal-warning').classList.contains('show'));
  p.close();
});

test('a line saved without choosing warns again when it is opened to edit, until the field is chosen', async () => {
  const p = await editPage(invoiceEditHtml(), 'https://secure20.e-boekhouden.nl/facturen/factuur/toevoegen/0');
  const { document, window } = p;
  const B = window.EBS.billing;
  let overlay = openLineWindow(document);
  await p.settle();
  overlay.querySelector('#omschrijving').value = 'Licentie per gebruiker';
  overlay.querySelector('#aantal').value = '3';
  overlay.querySelector('#prijsExcl').value = '10,00';
  // Only the btw was chosen in the add window; the tegenrekening was not.
  B.lineWindow.onUserEvent({ isTrusted: true, type: 'mousedown', target: overlay.querySelector('#btw-AutocompletePickerInput') });
  B.lineWindow.onUserEvent({ isTrusted: true, type: 'click', target: overlay.querySelector('button.form-submit') });
  overlay.remove();
  await p.settle();

  // Wijzigen: e-Boekhouden fills the window a moment after it opens.
  overlay = openLineWindow(document, { add: false });
  for (const id of ['omschrijving', 'aantal', 'prijsExcl']) overlay.querySelector(`#${id}`).value = '';
  await p.settle();
  const warning = overlay.querySelector('.ebs-b-modal-warning');
  assert.ok(!warning.classList.contains('show'), 'nothing to judge while empty');
  overlay.querySelector('#omschrijving').value = 'Licentie per gebruiker';
  overlay.querySelector('#aantal').value = '3';
  overlay.querySelector('#prijsExcl').value = '10,00';
  B.schedule();
  await p.settle();
  assert.ok(warning.classList.contains('show'));
  assert.equal(warning.querySelector('.ebs-b-modal-warning-text').textContent, 'Tegenrekening 0100 Deelneming Voorbeeld is voorgeselecteerd, niet in dit venster gekozen.');
  assert.ok(overlay.querySelector('#grootboekrekeningId-AutocompletePickerInput').closest('app-autocomplete').hasAttribute('data-ebs-risk'));
  assert.ok(!overlay.querySelector('#btw-AutocompletePickerInput').closest('app-autocomplete').hasAttribute('data-ebs-risk'));

  // Chosen now and saved: the line loses its mark.
  B.lineWindow.onUserEvent({ isTrusted: true, type: 'mousedown', target: overlay.querySelector('#grootboekrekeningId-AutocompletePickerInput') });
  B.lineWindow.onUserEvent({ isTrusted: true, type: 'click', target: overlay.querySelector('button.form-submit') });
  overlay.remove();
  await p.settle();
  assert.equal(document.querySelector('.ebs-b-line-flag'), null);
  assert.ok(!document.querySelector('.ebs-b-warning-summary').classList.contains('show'));
  p.close();
});

test('Overnemen that finds nothing leaves the field to e-Boekhouden, and never saves', async () => {
  const store = { 'store:123/billing/last-line': { v: { 'DEMO Demo Klant B.V.': { vat: 'Btw onbekend 7%', ledger: '9999 Bestaat niet', at: 1 } }, at: 1, by: 'local' } };
  const p = await editPage(invoiceEditHtml(), 'https://secure20.e-boekhouden.nl/facturen/factuur/toevoegen/0', { store });
  const { document } = p;
  const overlay = openLineWindow(document);
  await p.settle();
  let submitted = 0;
  overlay.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    submitted += 1;
  });
  let saves = 0;
  overlay.querySelector('button.form-submit').addEventListener('click', () => { saves += 1; });
  const blurred = [];
  for (const input of overlay.querySelectorAll('input.displayValue')) input.addEventListener('blur', () => blurred.push(input.id));
  overlay.querySelector('.ebs-b-take').click();
  await new Promise((resolve) => setTimeout(resolve, 4600));
  await p.settle();
  assert.deepEqual(blurred, ['btw-AutocompletePickerInput', 'grootboekrekeningId-AutocompletePickerInput'], 'each field is left, so e-Boekhouden puts its own choice back');
  assert.deepEqual([submitted, saves], [0, 0], 'nothing saved, nothing submitted');
  assert.ok(overlay.querySelector('.ebs-b-modal-warning').classList.contains('show'), 'still preselected');
  assert.equal(overlay.querySelector('.ebs-b-take').getAttribute('aria-busy'), null, 'the button is free again');
  p.close();
});

// ---------------------------------------------------------------------------
// The rules for every billing style
// ---------------------------------------------------------------------------

test('billing styles: hovers fade, nothing hides on hover, motion has a reduced fallback, no dashes', () => {
  for (const file of ['src/features/invoices.js', 'src/features/subscriptions.js']) {
    const source = readFileSync(join(root, file), 'utf8');
    assert.ok(!/[\u2013\u2014]/.test(source), `${file}: no en or em dash`);
    for (const match of source.matchAll(/([^{}\n]*:hover[^{}\n]*)\{([^}]*)\}/g)) {
      assert.ok(!/\b(display|visibility)\s*:/.test(match[2]), `${file}: ${match[1].trim()}`);
    }
  }
  const css = readFileSync(join(root, 'src/features/invoices.js'), 'utf8');
  // Every hovered class has a transition of its own.
  const hovered = new Set([...css.matchAll(/\.(ebs-b-[a-z-]+)(?:\.[a-z-]+)*:hover/g)].map((match) => match[1]));
  for (const name of hovered) {
    const rules = [...css.matchAll(new RegExp(`([^{}\\n]*\\.${name}\\b[^{}\\n]*)\\{([^}]*)\\}`, 'g'))];
    assert.ok(rules.some((rule) => !/:hover/.test(rule[1]) && /transition\s*:/.test(rule[2])), `.${name} fades its hover`);
  }
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  for (const keyframes of css.matchAll(/@keyframes ([a-z-]+) \{([^}]*\}[^}]*)\}/g)) {
    assert.ok(!/\b(width|height|top|left|margin)\s*:/.test(keyframes[2]), `${keyframes[1]} animates transform and opacity only`);
  }
});
