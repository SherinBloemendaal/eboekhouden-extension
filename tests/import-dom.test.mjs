// The import screen (import.js) in a jsdom page with e-Boekhouden's grid markup.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, page } from './dom.mjs';

after(closeAll);

const lineAmount = (i) => `${i % 2 ? '-' : ''}1${i},00`;
const line = (i, amount = lineAmount(i)) => `<tr>
  <td><div class="grid-multi-check"><input type="checkbox"></div></td>
  <td><span title="Verwijderen">x</span></td><td><a title="Handmatig invoeren">e</a></td>
  <td>29-09-2026</td><td>NL00DEMO0000000001</td><td>${String((i % 28) + 1).padStart(2, '0')}-09-2026</td><td>${amount}</td>
  <td>Naam: Partij ${i} IBAN: NL00DEMO00000000${i} Omschrijving: Factuur ${i}</td><td></td><td></td></tr>`;

// options: amounts (one per line, as the grid shows them), count (the
// number in the grid's title), pages (the pagination has two pages).
const html = (rows = 6, { amounts = null, count = null, pages = false } = {}) => `<!doctype html><html><head></head><body>
<app-header-identity-b><div class="header-identity"><div class="userInfo"><span class="userName">Demo</span><span class="administratieId">123</span></div></div></app-header-identity-b>
<div id="content">
<app-grid id="other"><app-grid-header><div class="grid-header-title">Importbestanden</div></app-grid-header><app-grid-body><table class="grid"><tbody><tr><td>ander grid</td></tr></tbody></table></app-grid-body></app-grid>
<app-grid id="import"><app-grid-header><div class="grid-header-title">Niet verwerkte afschriftregels (${count ?? (amounts ? amounts.length : rows)} regels)</div></app-grid-header>
<app-grid-body><table class="grid"><thead><tr><th></th><th></th><th></th><th>Importdatum</th><th>RekeningNr</th><th>Boekdatum</th><th>Bedrag</th><th>Omschrijving</th><th>Verwerkingsfouten</th><th>Opmerking</th></tr></thead>
<tbody>${(amounts ?? Array.from({ length: rows }, (_, i) => lineAmount(i))).map((amount, i) => line(i, amount)).join('')}</tbody></table></app-grid-body>
<app-grid-footer><app-pagination>${pages ? '<div><ul class="pagination"><li>Vorige</li><li>1</li><li>2</li><li>3</li><li>Volgende</li></ul></div>' : ''}</app-pagination><app-grid-bulk-actions><ul>
<app-grid-bulk-action><li id="weg"><span>Geselecteerde regels wegboeken</span></li></app-grid-bulk-action>
<app-grid-bulk-action><li id="del"><span>Geselecteerde regels verwijderen</span></li></app-grid-bulk-action>
</ul></app-grid-bulk-actions></app-grid-footer></app-grid>
<span id="clock">0</span></div></body></html>`;

// In manifest order: import.js uses the store, the icons, the shared dialog
// and the request layer.
const SCRIPTS = ['shared.js', 'store.js', 'icons.js', 'dialog.js', 'request.js', 'import.js'];

// The request budget of the service worker always has room here.
const answer = (message) => (message.type === 'requests:slot' ? { ok: true, lease: `lease-${Math.random()}` } : {});

// options.fetch answers the page's fetch (the request layer's isolated mode).
async function importPage(options = {}) {
  const p = page(html(options.rows, options), {
    url: 'https://secure20.e-boekhouden.nl/boekhouden/importeren', store: { settings: { betterDesign: true }, ...options.store }, answer,
  });
  p.fetches = [];
  p.window.fetch = async (url) => {
    p.fetches.push(String(url));
    const body = options.fetch ? await options.fetch(String(url)) : { data: [], rowCount: 0 };
    return { status: 200, ok: true, redirected: false, headers: { get: () => null }, text: async () => JSON.stringify(body) };
  };
  p.load(...SCRIPTS);
  await p.settle();
  return p;
}

const cardTexts = (document) => [...document.querySelectorAll('.ebs-card')].map((card) => card.textContent);
const barButton = (document, name) => [...document.querySelectorAll('.ebs-bar-button')].find((button) => (button.getAttribute('aria-label') ?? button.textContent) === name);

test('the new view marks and hides only the import grid', async () => {
  const p = await importPage();
  const { document } = p;
  assert.ok(document.querySelector('.ebs-import'), 'the view is there');
  assert.equal(document.getElementById('import').dataset.ebsImport, '');
  assert.equal(document.getElementById('other').dataset.ebsImport, undefined, 'another grid stays as it is');
  const css = document.getElementById('ebs-import-style').textContent;
  assert.ok(!/html\.ebs-better-import app-grid-body/.test(css), 'no rule hides every grid body');
  assert.equal(document.querySelectorAll('.ebs-body .ebs-row').length, 6);
  p.close();
});

test('keyboard focus survives the redraws after a click and after a native change', async () => {
  const p = await importPage();
  const { document } = p;
  const checks = () => [...document.querySelectorAll('.ebs-body .ebs-check')];
  checks()[1].focus();
  checks()[1].click();
  await p.settle();
  assert.equal(document.activeElement, checks()[1], 'focus is on the same line\'s box');
  assert.equal(document.activeElement.getAttribute('aria-checked'), 'true');

  document.querySelectorAll('.ebs-body .ebs-action.hide')[2].focus();
  document.getElementById('clock').textContent = '1';
  await p.settle();
  assert.equal(document.activeElement, document.querySelectorAll('.ebs-body .ebs-action.hide')[2]);

  const chip = [...document.querySelectorAll('.ebs-chip')][1];
  chip.focus();
  chip.click();
  await p.settle();
  assert.equal(document.activeElement.textContent, 'Bij');
  p.close();
});

test('Naam wijzigen renames the group it was opened for', async () => {
  const p = await importPage();
  const { document } = p;
  const submit = async (name) => {
    document.querySelector('.ebs-tab-form input').value = name;
    document.querySelector('.ebs-tab-form').dispatchEvent(new p.window.Event('submit', { cancelable: true }));
    await p.settle(1);
  };
  document.querySelector('.ebs-tab-add').click();
  await submit('Groep A');
  document.querySelector('.ebs-tab-add').click();
  await submit('Groep B');
  [...document.querySelectorAll('.ebs-tab-action')].find((button) => button.textContent === 'Naam wijzigen').click();
  await p.settle(1);
  [...document.querySelectorAll('.ebs-tab')].find((tab) => tab.textContent.startsWith('Groep A')).click();
  await submit('B hernoemd');
  assert.deepEqual(p.store['store:123/import/prefs'].v.groups, ['Groep A', 'B hernoemd']);
  p.close();
});

test('bulk actions click e-Boekhouden\'s own action with the exact label', async () => {
  const p = page(html().replace('<app-grid-bulk-action><li id="del">', '<app-grid-bulk-action><li id="other-del"><span>Geselecteerde importregels verwijderen</span></li></app-grid-bulk-action><app-grid-bulk-action><li id="del">'), {
    url: 'https://secure20.e-boekhouden.nl/boekhouden/importeren', store: { settings: { betterDesign: true } }, answer,
  });
  p.load(...SCRIPTS);
  await p.settle();
  const { document } = p;
  const clicked = [];
  for (const id of ['other-del', 'del', 'weg']) document.getElementById(id).addEventListener('click', () => clicked.push(id));
  document.querySelectorAll('.ebs-body .ebs-check')[0].click();
  await p.settle();
  barButton(document, 'Verwijderen').click();
  barButton(document, 'Wegboeken').click();
  assert.deepEqual(clicked, ['del', 'weg']);
  p.close();
});

test('hiding a line fades the row that is on screen, then drops it', async () => {
  const p = await importPage();
  const { document } = p;
  const first = document.querySelector('.ebs-body .ebs-row');
  first.querySelector('.ebs-action.hide').click();
  assert.ok(first.isConnected && first.classList.contains('leaving'), 'the class goes on the existing row, so its transition runs');
  await new Promise((resolve) => setTimeout(resolve, 200));
  await p.settle();
  assert.equal(document.querySelectorAll('.ebs-body .ebs-row').length, 5);
  assert.equal(p.store['store:123/import/prefs'].v.hidden.length, 1);
  p.close();
});

test('an empty import says so instead of blaming the filters', async () => {
  const p = await importPage({ rows: 0 });
  assert.equal(p.document.querySelector('.ebs-empty').textContent, 'Er staan geen afschriftregels klaar om te verwerken.');
  p.close();
});

test('the groups and hidden lines of 0.2.x come along, and the old copy stays', async () => {
  const old = { hidden: [], groups: ['Bank'], groupOf: {} };
  const p = await importPage({ store: { 'import:123': old } });
  await p.settle();
  assert.ok([...p.document.querySelectorAll('.ebs-tab')].some((tab) => tab.textContent.startsWith('Bank')), 'the group is back as a tab');
  assert.deepEqual(p.store['import:123'], old, 'the old key is untouched');
  assert.deepEqual(p.store['store:123/import/prefs'].v, old);
  p.close();
});

test('a line opens the mutation screen in the shared dialog, and Escape brings focus back', async () => {
  const p = await importPage();
  const { document, window } = p;
  const book = document.querySelectorAll('.ebs-body .ebs-action.book')[1];
  book.focus();
  book.click();
  const panel = document.querySelector('.ebs-dialog-backdrop .ebs-dialog');
  assert.ok(panel, 'the dialog is open');
  assert.equal(panel.getAttribute('role'), 'dialog');
  assert.equal(document.querySelector('.ebs-dialog-title').textContent, 'Mutatie aanmaken');
  assert.match(document.querySelector('.ebs-dialog-frame').src, /\/boekhouden\/importeren#ebs-edit=/);
  assert.equal(document.querySelector('.ebs-dialog-cover').textContent, 'Het mutatiescherm wordt geopend…');
  assert.equal(document.querySelector('.ebs-dialog-link').textContent, 'Openen in nieuw tabblad');
  assert.equal(document.getElementById('content').inert, true, 'the page behind is inert');
  assert.ok(document.querySelector('.ebs-dialog-backdrop').classList.contains('ebs-motion'), 'Better design moves');
  document.activeElement.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(document.getElementById('content').inert, false);
  assert.equal(document.activeElement.dataset.control, 'book', 'focus is back on a book button');
  await new Promise((resolve) => setTimeout(resolve, 160));
  assert.equal(document.querySelector('.ebs-dialog-backdrop'), null, 'gone after the close transition');
  p.close();
});

test('the cards count every line, and search, filters, groups and hidden lines leave them as they are', async () => {
  const p = await importPage({ rows: 6 });
  const { document, window } = p;
  const before = cardTexts(document);
  // 10 + 12 + 14 in, 11 + 13 + 15 out; the oldest booking date is 1 sep.
  assert.deepEqual(before.map((text) => text.replace(/(\d{4})\d+ dagen niet verwerkt$/, '$1N dagen')), [
    'Binnengekomen€ 36,003 regels', 'Uitgegaan€ −39,003 regels', 'Oudste regel1 sep 2026N dagen',
  ]);
  assert.ok(!document.querySelector('.ebs-cards').textContent.includes('in beeld'), 'no "(in beeld)" in the labels');
  assert.equal(document.querySelector('.ebs-cards-note').textContent, 'De kaarten tellen alle regels van de import, los van zoeken, filters, groepen en verborgen regels.');
  const filtered = () => document.querySelector('.ebs-footer-filtered');
  assert.equal(document.querySelector('.ebs-footer-total').textContent, '6 regels in totaal · 0 verborgen');
  assert.equal(filtered().textContent, '', 'no filter, no line in view');
  assert.ok(!filtered().classList.contains('on'));

  [...document.querySelectorAll('.ebs-chip')].find((chip) => chip.textContent === 'Bij').click();
  await p.settle(1);
  assert.deepEqual(cardTexts(document), before, 'Bij');
  assert.ok(filtered().classList.contains('on'));
  assert.equal(filtered().textContent, '3 regels in beeld · € 36,00');

  const search = document.querySelector('.ebs-search input');
  search.value = 'Factuur 2';
  search.dispatchEvent(new window.Event('input'));
  await p.settle(1);
  assert.deepEqual(cardTexts(document), before, 'search');
  assert.equal(filtered().textContent, '1 regel in beeld · € 12,00');
  search.value = '';
  search.dispatchEvent(new window.Event('input'));

  const size = document.querySelectorAll('.ebs-select select')[1];
  size.value = 'large';
  size.dispatchEvent(new window.Event('change'));
  await p.settle(1);
  assert.deepEqual(cardTexts(document), before, 'Bedrag');

  const period = document.querySelectorAll('.ebs-select select')[0];
  period.value = '2026-09';
  period.dispatchEvent(new window.Event('change'));
  await p.settle(1);
  assert.deepEqual(cardTexts(document), before, 'Periode');
  size.value = 'all';
  size.dispatchEvent(new window.Event('change'));
  period.value = 'all';
  period.dispatchEvent(new window.Event('change'));
  [...document.querySelectorAll('.ebs-chip')].find((chip) => chip.textContent === 'Alles').click();
  await p.settle(1);
  assert.ok(!filtered().classList.contains('on'), 'no filter left');

  document.querySelector('.ebs-body .ebs-action.hide').click();
  await new Promise((resolve) => setTimeout(resolve, 200));
  await p.settle();
  assert.deepEqual(cardTexts(document), before, 'a hidden line still counts');
  assert.equal(document.querySelector('.ebs-footer-total').textContent, '6 regels in totaal · 1 verborgen');

  document.querySelector('.ebs-tab-add').click();
  document.querySelector('.ebs-tab-form input').value = 'Bank';
  document.querySelector('.ebs-tab-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await p.settle(1);
  assert.equal(document.querySelector('.ebs-tab.on').textContent, 'Bank · 0');
  assert.deepEqual(cardTexts(document), before, 'a group tab');
  assert.equal(filtered().textContent, '0 regels in beeld · € 0,00', 'a group counts as a filter');
  assert.deepEqual(p.fetches, [], 'without pages the grid holds every line: no request');
  p.close();
});

test('Bedragen onder € 0,10 shows the tiny lines, Bij and Af alike', async () => {
  const p = await importPage({ amounts: ['-0,05', '0,09', '0,10', '-0,10', '5,00', '-0,01', '1.234,56'] });
  const { document, window } = p;
  const size = document.querySelectorAll('.ebs-select select')[1];
  assert.deepEqual([...size.options].map((option) => option.textContent), ['Alle bedragen', 'Onder € 10', 'Vanaf € 100', 'Bedragen onder € 0,10']);
  const before = cardTexts(document);
  size.value = 'tiny';
  size.dispatchEvent(new window.Event('change'));
  await p.settle(1);
  assert.deepEqual([...document.querySelectorAll('.ebs-body .ebs-amount')].map((cell) => cell.textContent), ['− 0,05', '+ 0,09', '− 0,01']);
  assert.equal(document.querySelector('.ebs-footer-filtered').textContent, '3 regels in beeld · € 0,03');
  assert.deepEqual(cardTexts(document), before);
  p.close();
});

// e-Boekhouden's import grid endpoint, answering every line.
function gridAnswer(count, { limit = Infinity } = {}) {
  const data = Array.from({ length: Math.min(count, limit) }, (_, i) => ({
    id: i + 1, datum: '2026-09-29T00:00:00', rekening: 'NL00DEMO0000000001', mutDatum: `2026-${i % 2 ? '08' : '07'}-${String((i % 28) + 1).padStart(2, '0')}T00:00:00`,
    mutBedrag: i % 2 ? -1 : 2, mutOmschrijving: `Regel ${i}`, verwerkFailureReason: null, opmerking: null,
  }));
  return { data, rowCount: count };
}

test('with pages, one bulk request reads every line for the cards, and filters never ask again', async () => {
  const p = await importPage({ rows: 6, count: 250, pages: true, fetch: () => gridAnswer(250) });
  const { document, window } = p;
  await p.settle();
  assert.equal(p.fetches.length, 1, 'one request for 250 lines');
  const url = new URL(p.fetches[0]);
  assert.equal(url.origin + url.pathname, 'https://secure20.e-boekhouden.nl/v1/api/import/gridtable');
  assert.equal(url.searchParams.get('offset'), '0');
  assert.ok(Number(url.searchParams.get('limit')) >= 250, 'a limit large enough for every line');
  // 125 lines of + 2,00 and 125 of − 1,00; the oldest is 1 jul.
  assert.deepEqual(cardTexts(document).map((text) => text.replace(/(\d{4})\d+ dagen niet verwerkt$/, '$1N dagen')), [
    'Binnengekomen€ 250,00125 regels', 'Uitgegaan€ −125,00125 regels', 'Oudste regel1 jul 2026N dagen',
  ]);
  assert.equal(document.querySelector('.ebs-cards-note').textContent, 'De kaarten tellen alle regels van de import, los van zoeken, filters, groepen en verborgen regels.');
  assert.equal(document.querySelector('.ebs-footer-total').textContent, '250 regels in totaal · 0 verborgen');
  const before = cardTexts(document);
  [...document.querySelectorAll('.ebs-chip')].find((chip) => chip.textContent === 'Af').click();
  const search = document.querySelector('.ebs-search input');
  search.value = 'Factuur';
  search.dispatchEvent(new window.Event('input'));
  document.getElementById('clock').textContent = '2';
  await p.settle();
  assert.deepEqual(cardTexts(document), before);
  assert.equal(document.querySelector('.ebs-footer-filtered').textContent, '3 regels in beeld op deze pagina · € −39,00');
  assert.equal(p.fetches.length, 1, 'still one request');
  p.close();
});

test('with pages and an answer that is not every line, the cards count this page and say so', async () => {
  const p = await importPage({ rows: 6, count: 250, pages: true, fetch: () => gridAnswer(250, { limit: 100 }) });
  const { document } = p;
  await p.settle();
  assert.equal(p.fetches.length, 1);
  assert.deepEqual([...document.querySelectorAll('.ebs-card-label')].map((label) => label.textContent), [
    'Binnengekomen (deze pagina)', 'Uitgegaan (deze pagina)', 'Oudste regel (deze pagina)',
  ]);
  assert.equal(document.querySelector('.ebs-card-value.in').textContent, '€ 36,00', 'the six lines of this page');
  assert.equal(document.querySelector('.ebs-cards-note').textContent, 'De kaarten tellen alle regels op deze pagina, los van zoeken, filters, groepen en verborgen regels.');
  p.close();
});

test('while the lines load the cards wait visibly, in the same space', async () => {
  let release;
  const p = await importPage({ rows: 6, count: 250, pages: true, fetch: () => new Promise((resolve) => { release = () => resolve(gridAnswer(250)); }) });
  const { document } = p;
  const value = document.querySelector('.ebs-card-value.in');
  assert.equal(value.textContent, 'Bezig…');
  assert.ok(value.classList.contains('loading'));
  assert.equal(document.querySelector('.ebs-card').getAttribute('aria-busy'), 'true');
  release();
  await p.settle();
  assert.equal(document.querySelector('.ebs-card-value.in').textContent, '€ 250,00');
  assert.equal(document.querySelector('.ebs-card').getAttribute('aria-busy'), 'false');
  p.close();
});

test('one Omschrijving column with e-Boekhouden\'s own text, the account below it, and Lucide icons', async () => {
  const p = await importPage({ rows: 3 });
  const { document } = p;
  assert.deepEqual([...document.querySelectorAll('.ebs-row-head span')].map((cell) => cell.textContent), ['', 'Boekdatum', 'Omschrijving', 'Bedrag', '']);
  assert.equal(document.querySelector('.ebs-party, .ebs-party-name'), null, 'no counterparty column');
  const first = document.querySelector('.ebs-body .ebs-row');
  const description = first.querySelector('.ebs-description');
  assert.equal(description.textContent, 'Naam: Partij 0 IBAN: NL00DEMO000000000 Omschrijving: Factuur 0', 'the description in full');
  assert.equal(description.title, description.textContent, 'the full text in the tooltip');
  assert.equal(first.querySelector('.ebs-account').textContent, 'NL00DEMO0000000001');
  assert.deepEqual([...first.querySelectorAll('.ebs-action svg')].map((svg) => svg.getAttribute('class').split(' ')[2]), ['lucide-check', 'lucide-upload', 'lucide-eye-off', 'lucide-trash']);
  assert.equal([...first.querySelectorAll('.ebs-action')].map((button) => button.textContent).join(''), '', 'no text glyphs');
  assert.ok(document.querySelector('.ebs-search svg.lucide-search'));
  assert.ok(document.querySelector('.ebs-tab-add svg.lucide-plus'));
  first.querySelector('.ebs-check').click();
  await p.settle();
  assert.ok(document.querySelector('.ebs-body .ebs-check svg.lucide-check'), 'a ticked box shows a Lucide check');
  assert.deepEqual([...document.querySelectorAll('.ebs-bar-button')].map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ['Selectie wissen', 'Wegboeken', 'Aan groep toevoegen', 'Verbergen', 'Verwijderen']);
  assert.ok(barButton(document, 'Aan groep toevoegen').querySelector('svg.lucide-folder-plus') && barButton(document, 'Aan groep toevoegen').querySelector('svg.lucide-chevron-down'));
  assert.equal(barButton(document, 'Aan groep toevoegen').textContent, 'Groep');
  barButton(document, 'Selectie wissen').click();
  await p.settle();
  assert.equal(document.querySelector('.ebs-body .ebs-check').getAttribute('aria-checked'), 'false');
  p.close();
});

test('1000 lines make one request, however often the grid redraws; a changed import without a click falls back to this page', async () => {
  const p = await importPage({ rows: 6, count: 1000, pages: true, fetch: () => gridAnswer(1000) });
  const { document } = p;
  await p.settle();
  for (let i = 0; i < 10; i += 1) {
    document.getElementById('clock').textContent = String(10 + i);
    await p.settle(1);
  }
  assert.equal(p.fetches.length, 1);
  assert.equal(document.querySelector('.ebs-card-sub').textContent, '500 regels');
  // The title count changes (a line booked elsewhere): the old answer is not
  // this import any more, and without a click of the user there is no new request.
  document.querySelector('#import .grid-header-title').textContent = 'Niet verwerkte afschriftregels (999 regels)';
  await p.settle();
  assert.equal(p.fetches.length, 1, 'no request without a click');
  assert.equal(document.querySelector('.ebs-card-label').textContent, 'Binnengekomen (deze pagina)');
  p.close();
});
