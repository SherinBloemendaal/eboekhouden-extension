// The subscription screens (subscriptions.js) in jsdom pages with
// e-Boekhouden's markup: the list with its cards and filters, the computed
// next invoice dates and the form. The billing core is invoices.js.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll } from './dom.mjs';
import { billingPage, subscriptionListHtml, subscriptionEditHtml, post } from './billing-fixtures.mjs';

after(closeAll);

const SUBSCRIPTIONS = 'https://secure20.e-boekhouden.nl/facturen/abonnement';

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
const rowsOf = (document) => [...document.querySelectorAll('.ebs-b-body .ebs-b-row')];

async function editPage(html, url, options = {}) {
  const p = billingPage(html, { url, posts: [], ...options });
  await p.settle(4);
  return p;
}

const SUBS = [
  { name: 'Licenties', relation: 'Studio Noord', next: day(26), per: 'M', excl: '10,00', incl: '12,10' },
  { name: 'Management fee', relation: 'Demo Klant B.V.', start: '24-05-2023', next: day(26), per: 'M', excl: '2.850,00', incl: '3.448,50' },
  { name: 'Onderhoud', relation: 'Atelier Zuid', next: day(40), per: 'K', excl: '300,00', incl: '363,00', perMonth: '100,00', paused: true, post: true, mail: false },
  { name: 'Oud contract', relation: 'Atelier Zuid', next: day(-60), end: day(-30), per: 'J', excl: '120,00', incl: '145,20', perMonth: '10,00' },
];

test('the subscription list: active ones, the next invoices and the open posts of these relations', async () => {
  const p = billingPage(subscriptionListHtml(SUBS), { url: SUBSCRIPTIONS, posts: [post('F1', 980.1, iso(-3), 'Demo Klant B.V.'), post('F2', 50, iso(5), 'Elders B.V.')] });
  await p.settle(4);
  const { document } = p;
  assert.equal(document.querySelector('.ebs-b-subtitle').textContent, '2 actief');
  const rows = rowsOf(document);
  assert.deepEqual(rows.map((row) => row.querySelector('.ebs-b-cell-relation').textContent), ['Licenties', 'Management fee'], 'Actief by default');
  assert.equal(rows[0].querySelector('.ebs-b-sub').textContent, 'per e-mail');
  assert.equal(rows[0].children[5].textContent, 'Maand');
  assert.equal(rows[0].children[4].textContent, `${day(26)}over 26 dagen`);
  const cards = [...document.querySelectorAll('.ebs-b-card')].map((node) => [node.querySelector('.ebs-b-card-value').textContent, node.querySelector('.ebs-b-card-sub').textContent]);
  assert.deepEqual(cards[0], ['€ 2.860,00', 'excl. btw (kolom Bedrag ex p/m) · € 3.460,60 incl., berekend']);
  assert.match(cards[1][1], /^2 abonnementen · over 26 dagen$/);
  assert.deepEqual(cards[2], ['€ 980,10', '1 relatie met open posten']);
  assert.equal(document.querySelector('.ebs-b-row.total').textContent, 'Totaal2.860,003.460,60');
  assert.equal(p.fetches.length, 1);
  assert.equal([...document.querySelectorAll('button')].some((node) => /^(pauze|pauzeren|hervatten)/i.test(node.textContent.trim()) || /pauze/i.test(node.getAttribute('aria-label') ?? '')), false, 'no pause button');
  // Verwijderen per row is e-Boekhouden's own (it asks in its own dialog).
  let removed = 0;
  document.querySelectorAll('app-grid-body tbody tr')[1].querySelector('[title="Verwijderen"]').addEventListener('click', () => { removed += 1; });
  rows[1].querySelector('[data-role="remove"]').click();
  assert.equal(removed, 1);
  assert.equal(document.querySelectorAll('.ebs-dialog-backdrop').length, 0, 'no dialog of ours on top of e-Boekhouden\'s');

  const [active, paused] = document.querySelectorAll('.ebs-b-chip');
  paused.click();
  await p.settle();
  assert.deepEqual(rowsOf(document).map((row) => row.querySelector('.ebs-b-cell-relation').textContent), ['Onderhoud']);
  assert.equal(rowsOf(document)[0].querySelector('.ebs-b-stack + span + span + .ebs-b-stack .ebs-b-sub').textContent, 'tijdelijk niet factureren');
  assert.equal(active.getAttribute('aria-pressed'), 'false');

  // Verlopen and Met achterstand are e-Boekhouden's filters: they reload.
  let searched = 0;
  document.querySelector('#achterstand').closest('form').addEventListener('submit', (event) => {
    event.preventDefault();
    searched += 1;
  });
  [...document.querySelectorAll('.ebs-b-chip')].find((node) => node.textContent === 'Verlopen').click();
  await p.settle();
  assert.equal(document.getElementById('verlopenAbonnementen').checked, true);
  assert.equal(searched, 1);
  assert.deepEqual(rowsOf(document).map((row) => row.querySelector('.ebs-b-cell-relation').textContent), ['Oud contract']);

  rowsOf(document)[0].querySelector('.ebs-b-check').click();
  await p.settle();
  const bar = document.querySelector('.ebs-b-bar');
  assert.equal(bar.querySelector('.ebs-b-bar-count').textContent, '1 abonnement geselecteerd');
  assert.equal(bar.querySelector('.ebs-b-bar-total').textContent, '€ 12,10 incl. per maand');
  const clicked = [];
  for (const li of document.querySelectorAll('app-grid-bulk-action li')) li.addEventListener('click', () => clicked.push(li.textContent.trim()));
  [...bar.querySelectorAll('button')].find((node) => node.textContent === 'Wijzigen').click();
  assert.deepEqual(clicked, ['Geselecteerde regels wijzigen']);
  assert.equal(p.fetches.length, 1, 'still one request');
  p.close();
});

test('the next invoice dates: periods, month ends, the end date and a pause', async () => {
  const p = billingPage(subscriptionListHtml(SUBS), { url: SUBSCRIPTIONS });
  await p.settle();
  const { nextDates, perOf } = p.window.__ebsSubscriptionsTest;
  const B = p.window.EBS.billing;
  const days = (result) => Array.from(result.dates, B.formatDay);
  assert.deepEqual(days(nextDates({ prolongation: B.dayTime(2026, 11, 24), per: 'M' })), ['24-11-2026', '24-12-2026', '24-01-2027']);
  assert.deepEqual(days(nextDates({ prolongation: B.dayTime(2027, 1, 31), per: 'M' })), ['31-01-2027', '28-02-2027', '31-03-2027'], 'a month end, without drift');
  assert.deepEqual(days(nextDates({ prolongation: B.dayTime(2028, 1, 31), per: 'M' })), ['31-01-2028', '29-02-2028', '31-03-2028'], 'a leap year');
  assert.deepEqual(days(nextDates({ prolongation: B.dayTime(2026, 11, 30), per: 'K' })), ['30-11-2026', '28-02-2027', '30-05-2027']);
  assert.deepEqual(days(nextDates({ prolongation: B.dayTime(2026, 11, 2), per: '2W' })), ['02-11-2026', '16-11-2026', '30-11-2026']);
  assert.deepEqual(days(nextDates({ prolongation: B.dayTime(2026, 11, 24), per: 'J', end: B.dayTime(2027, 12, 1) })), ['24-11-2026', '24-11-2027']);
  assert.equal(JSON.stringify(nextDates({ prolongation: B.dayTime(2026, 11, 24), per: 'M', paused: true })), '{"dates":[],"reason":"paused"}');
  assert.equal(nextDates({ prolongation: B.dayTime(2026, 11, 24), per: 'M', end: B.dayTime(2026, 11, 1) }).reason, 'ended');
  // Every period of "Betaling per", over month ends, leap days and year ends.
  const from = (y, m, d, per, extra = {}) => days(nextDates({ prolongation: B.dayTime(y, m, d), per, ...extra }));
  assert.deepEqual(from(2026, 12, 28, 'W'), ['28-12-2026', '04-01-2027', '11-01-2027'], 'a week, over the year end');
  assert.deepEqual(from(2027, 3, 22, '2W'), ['22-03-2027', '05-04-2027', '19-04-2027'], 'two weeks, over the summer time change');
  assert.deepEqual(from(2026, 2, 1, '4W'), ['01-02-2026', '01-03-2026', '29-03-2026'], 'four weeks are 28 days, not a month');
  assert.deepEqual(from(2026, 12, 31, '2M'), ['31-12-2026', '28-02-2027', '30-04-2027']);
  assert.deepEqual(from(2027, 11, 30, 'K'), ['30-11-2027', '29-02-2028', '30-05-2028'], 'a quarter into a leap February');
  assert.deepEqual(from(2027, 8, 31, 'H'), ['31-08-2027', '29-02-2028', '31-08-2028'], 'half a year from a month end');
  assert.deepEqual(from(2028, 2, 29, 'J'), ['29-02-2028', '28-02-2029', '28-02-2030'], 'a leap day, a year on');
  assert.deepEqual(from(2028, 2, 29, '2J'), ['29-02-2028', '28-02-2030', '29-02-2032'], 'two years, back on a leap day');
  assert.deepEqual(from(2026, 11, 24, 'J', { end: B.dayTime(2027, 11, 24) }), ['24-11-2026', '24-11-2027'], 'the end date itself still counts');
  assert.deepEqual(from(2026, 11, 24, 'M', { end: B.dayTime(2026, 11, 24) }), ['24-11-2026']);
  assert.equal(nextDates({ prolongation: B.dayTime(2026, 11, 24), per: 'M', end: B.dayTime(2026, 1, 1), paused: true }).reason, 'paused', 'a pause says so first');
  assert.equal(nextDates({ prolongation: null, per: 'M' }).reason, 'unknown');
  assert.equal(nextDates({ prolongation: B.dayTime(2026, 11, 24), per: '' }).reason, 'unknown');
  assert.equal(nextDates({ prolongation: B.dayTime(2026, 11, 24), per: 'X' }).reason, 'unknown');
  assert.deepEqual(['W', '2W', '4W', 'M', '2M', 'K', 'H', 'J', '2J'].map((code) => perOf(code)), ['W', '2W', '4W', 'M', '2M', 'K', 'H', 'J', '2J']);
  assert.equal(perOf('Kwartaal'), 'K');
  p.close();
});

test('the subscription form: period, the computed next invoices and what happens', async () => {
  const p = await editPage(subscriptionEditHtml(), 'https://secure20.e-boekhouden.nl/facturen/abonnement/5');
  const { document } = p;
  const view = document.querySelector('.ebs-b-edit');
  assert.equal(view.querySelector('.ebs-b-edit-title').textContent, 'Abonnement wijzigen');
  const period = view.querySelector('[aria-label="Periode"]');
  for (const id of ['startDatum', 'expiratieDatum', 'eindDatum', 'per', 'termijn', 'kenmerk']) assert.ok(period.querySelector(`#${id}`), id);
  assert.equal(view.querySelector('.ebs-b-totals .ebs-b-section-title').textContent, 'Elke maand');
  assert.equal(view.querySelector('.ebs-b-next > span').textContent, 'Volgende facturen (berekend): 31-01-2027, 28-02-2027, 31-03-2027');
  const what = [...view.querySelectorAll('.ebs-b-check-label')].map((label) => label.textContent);
  assert.deepEqual(what, ['Automatisch factureren, verwerken en versturenOp de prolongatiedatum, zonder dat je iets doet.', 'Per e-mail versturen', 'Per post versturen', 'Factuurbedrag incasseren', 'Tijdelijk niet factureren']);
  // e-Boekhouden's own checkbox, through our label: a click of the user.
  view.querySelector('.ebs-b-check-label[for="geenFactuur"]').click();
  await p.settle();
  assert.equal(document.getElementById('geenFactuur').checked, true);
  assert.equal(view.querySelector('.ebs-b-next > span').textContent, 'Volgende facturen (berekend): geen, Tijdelijk niet factureren staat aan');
  document.getElementById('geenFactuur').click();
  const per = document.getElementById('per');
  per.value = 'K';
  per.dispatchEvent(new p.window.Event('change', { bubbles: true }));
  await p.settle();
  assert.equal(view.querySelector('.ebs-b-totals .ebs-b-section-title').textContent, 'Elk kwartaal');
  assert.equal(view.querySelector('.ebs-b-next > span').textContent, 'Volgende facturen (berekend): 31-01-2027, 30-04-2027, 31-07-2027');
  // An end date before the prolongation date: no invoice comes.
  const end = document.getElementById('eindDatum');
  end.value = '01-01-2027';
  end.dispatchEvent(new p.window.Event('input', { bubbles: true }));
  await p.settle();
  assert.equal(view.querySelector('.ebs-b-next > span').textContent, 'Volgende facturen (berekend): geen, de einddatum valt voor de prolongatiedatum');
  end.value = '30-04-2027';
  end.dispatchEvent(new p.window.Event('input', { bubbles: true }));
  await p.settle();
  assert.equal(view.querySelector('.ebs-b-next > span').textContent, 'Volgende facturen (berekend): 31-01-2027, 30-04-2027');
  assert.equal(p.fetches.length, 0, 'the form asks nothing');
  p.close();
});
