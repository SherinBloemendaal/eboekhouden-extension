import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/shared.js');
const { EBS } = globalThis;

const rows = [
  { importDate: '29-09-2026', account: 'NL00DEMO0000000001', bookDate: '28-09-2026', amount: 3500, description: 'Naam: Demo Klant B.V. IBAN: NL00DEMO0000000011 Omschrijving: Factuur 2026-0412' },
  { importDate: '02-07-2026', account: 'NL00DEMO0000000001', bookDate: '01-07-2026', amount: 455.7, description: 'Webwinkel Noord retour order 5521' },
  { importDate: '21-10-2026', account: 'NL00DEMO0000000001', bookDate: '20-10-2026', amount: -0.05, description: 'Kosten betaalverkeer oktober' },
  { importDate: '27-10-2026', account: 'NL00DEMO0000000001', bookDate: '26-10-2026', amount: -3.2, description: 'Koffie Demo Bar', failure: 'Geen regel gevonden' },
];

test('a shift-click gives the whole range the anchor state, both ways', () => {
  // Anchor 1 checked; shift-click on 4 (native click already checked it).
  assert.deepEqual(EBS.rangeToggles([false, true, false, false, true, false], 1, 4), [2, 3]);
  // Anchor 4 unchecked; shift-click upwards on 1 deselects the range, including the target.
  assert.deepEqual(EBS.rangeToggles([false, true, true, true, false, false], 4, 1), [1, 2, 3]);
  // The target flipped away from the anchor state is flipped back.
  assert.deepEqual(EBS.rangeToggles([true, true, false], 0, 2), [2]);
  assert.deepEqual(EBS.rangeToggles([true, false], null, 1), [], 'no anchor, no range');
  assert.deepEqual(EBS.rangeToggles([true, false], 5, 1), [], 'stale anchor, no range');
});

test('search looks in every column, amounts in Dutch notation too', () => {
  assert.equal(EBS.filterRows(rows, { query: 'webwinkel' }).length, 1);
  assert.equal(EBS.filterRows(rows, { query: '3.500,00' }).length, 1);
  assert.equal(EBS.filterRows(rows, { query: '20-10-2026' }).length, 1);
  assert.equal(EBS.filterRows(rows, { query: 'geen regel' }).length, 1, 'processing errors count');
  assert.equal(EBS.filterRows(rows, { query: 'NL00DEMO0000000001' }).length, 4);
});

test('filters on direction, booking month and amount combine', () => {
  assert.deepEqual(EBS.filterRows(rows, { direction: 'in' }).map((row) => row.amount), [3500, 455.7]);
  assert.deepEqual(EBS.filterRows(rows, { direction: 'out' }).map((row) => row.amount), [-0.05, -3.2]);
  assert.deepEqual(EBS.filterRows(rows, { period: '2026-10' }).map((row) => row.amount), [-0.05, -3.2]);
  assert.deepEqual(EBS.filterRows(rows, { size: 'large' }).map((row) => row.amount), [3500, 455.7]);
  assert.deepEqual(EBS.filterRows(rows, { size: 'small', direction: 'out', period: '2026-10' }).map((row) => row.amount), [-0.05, -3.2]);
  assert.deepEqual(EBS.periodsOf(rows), ['2026-10', '2026-09', '2026-07']);
});

test('hidden rows leave the list until shown again; nothing else is touched', () => {
  const hidden = [EBS.rowSignature(rows[2])];
  assert.equal(EBS.filterRows(rows, { hidden }).length, 3);
  assert.equal(EBS.filterRows(rows, { hidden, showHidden: true }).length, 4);
});

test('groups are local labels that filter the list', () => {
  let groupOf = EBS.assignGroup({}, [EBS.rowSignature(rows[2]), EBS.rowSignature(rows[3])], 'Bankkosten');
  groupOf = EBS.assignGroup(groupOf, [EBS.rowSignature(rows[0])], 'Klanten');
  assert.deepEqual(EBS.groupCounts(groupOf, ['Bankkosten', 'Klanten', 'Leeg']), { Bankkosten: 2, Klanten: 1, Leeg: 0 });
  assert.deepEqual(EBS.filterRows(rows, { group: 'Bankkosten', groupOf }).map((row) => row.amount), [-0.05, -3.2]);
  groupOf = EBS.assignGroup(groupOf, [EBS.rowSignature(rows[3])], null);
  assert.equal(EBS.groupCounts(groupOf, ['Bankkosten']).Bankkosten, 1, 'removed from its group');
});

test('totals for the summary cards follow what is in view', () => {
  const summary = EBS.summarize(rows);
  assert.equal(summary.inCount, 2);
  assert.equal(Math.round(summary.inTotal * 100), 395570);
  assert.equal(Math.round(summary.outTotal * 100), -325);
  assert.equal(summary.oldest.key, '2026-07');
});

test('amounts and dates in e-Boekhouden notation', () => {
  assert.equal(EBS.parseAmount('3.500,00'), 3500);
  assert.equal(EBS.parseAmount('-0,05'), -0.05);
  assert.equal(EBS.parseAmount('1.234.567,89'), 1234567.89);
  assert.ok(Number.isNaN(EBS.parseAmount('')));
  assert.equal(EBS.parseDate('28-09-2026').key, '2026-09');
  assert.equal(EBS.parseDate('2026-09-28'), null);
  assert.equal(EBS.formatMoney(-1284.6), '-1.284,60');
});

test('counterparty and IBAN come out of both description formats', () => {
  assert.deepEqual(EBS.counterparty(rows[0].description), { party: 'Demo Klant B.V.', iban: 'NL00DEMO0000000011', rest: 'Factuur 2026-0412' });
  assert.deepEqual(EBS.counterparty('/TRTP/SEPA OVERBOEKING/IBAN/NL00DEMO0000000012/BIC/DEMONL2A/NAME/Voorbeeld Studio/REMI/Offerte 118/EREF/X'), { party: 'Voorbeeld Studio', iban: 'NL00DEMO0000000012', rest: 'Offerte 118' });
  assert.deepEqual(EBS.counterparty('Kosten betaalverkeer'), { party: null, iban: null, rest: 'Kosten betaalverkeer' });
});

test('status and initials as the shell shows them', () => {
  const view = { activeSlotId: 'a', loggedIn: true, ready: ['a', 'b'] };
  assert.equal(EBS.statusOf({ id: 'a' }, view), 'active');
  assert.equal(EBS.statusOf({ id: 'b' }, view), 'ready');
  assert.equal(EBS.statusOf({ id: 'c', expired: true }, view), 'expired');
  assert.equal(EBS.statusOf({ id: 'd' }, view), 'login');
  assert.equal(EBS.initials('Demo Holding B.V.'), 'DH');
  assert.equal(EBS.initials('Studio Noord'), 'SN');
});

test('settings default to Better design off and every feature on', () => {
  assert.deepEqual(EBS.settingsWithDefaults(), { betterDesign: false, onePassword: true, switcher: true, relogin: true, shiftSelect: true, actionBar: true });
  assert.equal(EBS.settingsWithDefaults({ betterDesign: true }).betterDesign, true);
});
