// The open posts screen (features/openposts.js) in a jsdom page with
// e-Boekhouden's markup of app-open-post-list, and the parent half of the
// reminder dialog (features/remind.js).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, page } from './dom.mjs';

after(closeAll);

const URL_PAGE = 'https://secure20.e-boekhouden.nl/boekhouden/openposten?soort=Debiteur&zoeken=true';
const SCRIPTS = ['shared.js', 'store.js', 'icons.js', 'mark.js', 'dialog.js', 'request.js', 'features/openposts.js', 'features/remind.js'];
const LADDER = { steps: [
  { id: 1, name: 'Herinnering', soort: 'E' }, { id: 2, name: 'Herinnering 2', soort: 'E' },
  { id: 3, name: 'Aanmaning', soort: 'E' }, { id: 4, name: 'Ingebrekestelling', soort: 'E' },
] };

// A date `days` from today, as e-Boekhouden's API ("2026-08-12T00:00:00")
// and as the page shows it ("12-08-2026").
function day(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return { iso: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T00:00:00`, nl: `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}` };
}

const POSTS = [
  { mutFactuur: '2026-0371', relatieId: 11, relatieCode: 'DEMO01', bedrijf: 'Demo Klant B.V.', email: 'facturen@demo-klant.test', mutOmschrijving: 'Management fee augustus', sBedrag: 3448.5, sBetaald: 0, teOntvangen: 3448.5, due: -64, last: [-4, 'Herinnering 2'] },
  { mutFactuur: '2026-0398', relatieId: 11, relatieCode: 'DEMO01', bedrijf: 'Demo Klant B.V.', email: 'facturen@demo-klant.test', mutOmschrijving: 'Management fee september', sBedrag: 3448.5, sBetaald: 0, teOntvangen: 3448.5, due: -33, last: [-19, 'Herinnering'] },
  { mutFactuur: '2026-0390', relatieId: 12, relatieCode: 'STUD01', bedrijf: 'Studio Noord', email: '', mutOmschrijving: 'Licenties september', sBedrag: 12.1, sBetaald: 0, teOntvangen: 12.1, due: -44, last: [-4, 'Herinnering (E)'] },
  { mutFactuur: '2026-0402', relatieId: 13, relatieCode: 'WEB01', bedrijf: 'Voorbeeld Webwinkel', email: 'boekhouding@webwinkel.test', mutOmschrijving: 'Hosting Q3', sBedrag: 145.2, sBetaald: 100, teOntvangen: 45.2, due: -25 },
  { mutFactuur: '2026-0405', relatieId: 14, relatieCode: 'ATZ01', bedrijf: 'Atelier Zuid', email: 'info@atelier.test', mutOmschrijving: 'Ontwerp huisstijl', sBedrag: 2420, sBetaald: 0, teOntvangen: 2420, due: -15 },
  { mutFactuur: '2026-0340', relatieId: 15, relatieCode: 'BOUW01', bedrijf: 'Demo Bouw B.V.', email: 'bouw@demo.test', mutOmschrijving: 'Advies juni', sBedrag: 968, sBetaald: 0, teOntvangen: 968, due: -106, last: [-28, 'Ingebrekestelling'] },
  { mutFactuur: '2026-0412', relatieId: 11, relatieCode: 'DEMO01', bedrijf: 'Demo Klant B.V.', email: 'facturen@demo-klant.test', mutOmschrijving: 'Management fee oktober', sBedrag: 3448.5, sBetaald: 0, teOntvangen: 3448.5, due: -3 },
  { mutFactuur: '2026-0418', relatieId: 12, relatieCode: 'STUD01', bedrijf: 'Studio Noord', email: '', mutOmschrijving: 'Licenties oktober', sBedrag: 12.1, sBetaald: 0, teOntvangen: 12.1, due: 5 },
];

const COLUMNS = ['mutDatum', 'relatieCode', 'bedrijf', 'relatieId', 'email', 'mutFactuur', 'mutOmschrijving', 'sBedrag', 'sBetaald', 'teOntvangen', 'vervaldatum', 'lastCorDatum', 'corOmschrijving'];

function record(post) {
  return {
    ...post,
    mutDatum: day(post.due - 14).iso,
    vervaldatum: day(post.due).iso,
    lastCorDatum: post.last ? day(post.last[0]).iso : null,
    corOmschrijving: post.last ? post.last[1] : null,
  };
}

// The grid answer as e-Boekhouden's grid service gets it: columns plus rows of cells.
function gridAnswer(posts) {
  const records = posts.map(record);
  return { colMetadata: COLUMNS.map((name, index) => ({ name, index })), data: records.map((one) => COLUMNS.map((name) => one[name] ?? null)), rowCount: posts.length, limit: 1000 };
}

function nativeRow(post) {
  const one = record(post);
  return `<tr><td><div class="grid-multi-check"><input type="checkbox" data-f="${post.mutFactuur}"><span></span></div></td><td></td><td></td>
<td>${day(post.due - 14).nl}</td>
<td><app-grid-inline-menu><a>${post.relatieCode}</a>${post.email ? `<a href="mailto:${post.email}"> @ </a>` : ''}<app-grid-inline-menu-item itemhref="/facturen/factuur?relatieId=${post.relatieId}&amp;goback=x"></app-grid-inline-menu-item></app-grid-inline-menu></td>
<td>${post.mutFactuur}</td><td><div>${post.mutOmschrijving}</div></td><td>${post.sBedrag.toLocaleString('nl-NL', { minimumFractionDigits: 2 })}</td><td>${post.sBetaald.toLocaleString('nl-NL', { minimumFractionDigits: 2 })}</td><td>${post.teOntvangen.toLocaleString('nl-NL', { minimumFractionDigits: 2 })}</td><td></td><td></td>
<td><div>${day(post.due).nl}</div></td><td>${one.lastCorDatum ? `<a class="history">${day(post.last[0]).nl} ${post.last[1]}</a>` : ''}</td></tr>`;
}

const BULK = ['De geselecteerde facturen met elkaar verrekenen', 'De geselecteerde facturen direct naar tegenrekening afboeken', 'Betaalopdrachten exporteren',
  'Van de geselecteerde posten een proef-aanmaning maken', 'De geselecteerde posten aanmanen per e-mail', 'De geselecteerde posten aanmanen per reguliere post'];

function html({ native = POSTS.slice(0, 6), grid = true } = {}) {
  return `<!doctype html><html><head></head><body>
<app-header-identity-b><div class="userInfo"><span class="userName">Demo</span><span class="administratieId">1000001</span></div></app-header-identity-b>
<main id="app"><app-open-post-list><div>
<app-form id="filter"><form><div class="form-header"><h1><span>Maak hier een selectie</span></h1></div>
<app-selectlist><div><select id="soort" name="soort"><option value="Debiteur">Te ontvangen (debiteuren)</option><option value="Crediteur">Te betalen (crediteuren)</option></select></div></app-selectlist>
<div><button id="volgende"><span>Volgende</span></button></div></form></app-form>
<app-container class="wanbetalers">U heeft wanbetalers</app-container>
<div class="grid-container">${grid ? `<app-grid><app-grid-header><div class="grid-header-title">Open posten debiteuren</div></app-grid-header>
<app-grid-body><table class="grid"><thead><tr><th></th><th></th><th></th><th>Datum</th><th>Relatie</th><th>Factuur</th><th>Omschrijving</th><th>Bedrag</th><th>Ontv.</th><th>Te ont.</th><th></th><th></th><th>Vervaldatum</th><th>Laatste aanmaning</th></tr></thead>
<tbody>${native.map(nativeRow).join('')}</tbody></table></app-grid-body>
<app-grid-footer><app-pagination></app-pagination><app-grid-bulk-actions><div class="grid-bulk-actions"><ul>${BULK.map((label, i) => `<app-grid-bulk-action><li id="bulk-${i}"><span>${label}</span></li></app-grid-bulk-action>`).join('')}</ul></div></app-grid-bulk-actions></app-grid-footer></app-grid>` : ''}</div>
</div></app-open-post-list></main><span id="clock">0</span></body></html>`;
}

const slot = (message) => (message.type === 'requests:slot' ? { ok: true, lease: `lease-${Math.random()}` } : {});

// fetch as the request layer uses it; `reply(url)` gives { status, body } or a promise of it.
function fakeFetch(window, reply) {
  const calls = [];
  window.fetch = async (url) => {
    calls.push(String(url));
    const answer = await reply(String(url));
    const status = answer?.status ?? 200;
    return {
      status, ok: status >= 200 && status < 300, redirected: false,
      headers: { get: () => null },
      text: async () => (typeof answer?.body === 'string' ? answer.body : JSON.stringify(answer?.body ?? null)),
    };
  };
  return calls;
}

async function openPage({ store = {}, reply, native, grid, url = URL_PAGE, before } = {}) {
  const p = page(html({ native, grid }), {
    url, answer: slot, serve: {},
    store: { settings: { betterDesign: true, shiftSelect: true }, ...store },
  });
  const calls = fakeFetch(p.window, reply ?? ((target) => {
    if (target.includes('/openpost/gridtable/openpost')) return { body: gridAnswer(POSTS) };
    if (target.includes('/aanmaansjabloon/gridtable')) return { body: { colMetadata: [{ name: 'id', index: 0 }, { name: 'naam', index: 1 }, { name: 'soort', index: 2 }], data: [[1, 'Herinnering', 'E'], [2, 'Herinnering 2', 'E'], [3, 'Aanmaning', 'E'], [4, 'Ingebrekestelling', 'E'], [5, 'Brief', 'P']] } };
    return { status: 404, body: '' };
  }));
  before?.(p);
  p.load(...SCRIPTS);
  await p.settle(4);
  return { ...p, calls };
}

const plain = (value) => JSON.parse(JSON.stringify(value));
const rows = (document) => [...document.querySelectorAll('.ebs-op-body .ebs-op-item')];
const texts = (nodes) => nodes.map((node) => node.textContent.replace(/\s+/g, ' ').trim());

test('the view loads every open post with one bulk request of e-Boekhouden\'s own grid', async () => {
  const p = await openPage();
  const { document } = p;
  assert.equal(p.calls.length, 1);
  const url = new URL(p.calls[0]);
  assert.equal(url.pathname, '/v1/api/openpost/gridtable/openpost');
  for (const [key, value] of [['offset', '0'], ['limit', '1000'], ['soort', 'Debiteur'], ['zoeken', 'true'], ['groupOnRelation', 'false']]) assert.equal(url.searchParams.get(key), value, key);
  assert.ok(document.querySelector('.ebs-op'), 'the view is there');
  assert.equal(document.querySelector('app-open-post-list').dataset.ebsOpenposts, '', 'the native list is marked for hiding');
  assert.ok(document.documentElement.classList.contains('ebs-better-openposts'));
  const css = document.getElementById('ebs-openposts-style').textContent;
  assert.match(css, /app-container\.wanbetalers/, 'the advert is hidden');
  assert.equal(rows(document).length, 8, 'all posts, also those not on the native page');
  assert.deepEqual(texts([...document.querySelectorAll('.ebs-op-card-value')]), ['€ 13.802,90', '€ 13.790,80', '5']);
  assert.match(document.querySelectorAll('.ebs-op-card-sub')[1].textContent, /^7 posten · oudste 106 dagen$/);
  assert.equal(document.querySelectorAll('.ebs-op-card-sub')[2].textContent, '5 met een vervallen factuur');
  const first = rows(document)[0];
  assert.equal(first.querySelector('.ebs-op-relation-name').textContent, 'Demo Klant B.V.');
  assert.equal(first.querySelector('.ebs-op-badge').textContent, '64 dagen te laat');
  assert.ok(first.querySelector('.ebs-op-badge').classList.contains('late'));
  assert.equal(first.querySelector('.ebs-op-last').textContent, `${day(-4).nl} Herinnering 2`);
  assert.equal(rows(document)[3].querySelector('.ebs-op-last').textContent, 'Nog geen herinnering');
  assert.equal(rows(document)[7].querySelector('.ebs-op-badge').textContent, 'over 5 dagen');

  // Native changes without a click of the user: no new request.
  document.getElementById('clock').textContent = '1';
  document.querySelector('app-grid-body tbody tr td:nth-child(4)').textContent = 'anders';
  await p.settle(3);
  assert.equal(p.calls.length, 1);
  p.close();
});

test('a list of 1000 posts makes exactly one request', async () => {
  const many = Array.from({ length: 1000 }, (_, i) => ({ ...POSTS[i % POSTS.length], mutFactuur: `2026-${String(i).padStart(4, '0')}` }));
  const p = await openPage({ reply: () => ({ body: gridAnswer(many) }) });
  assert.equal(p.calls.length, 1);
  assert.equal(rows(p.document).length, 1000);
  assert.match(p.document.querySelector('.ebs-op-footer').textContent, /De eerste 1000 open posten/);
  for (let i = 0; i < 5; i += 1) {
    p.document.getElementById('clock').textContent = String(i);
    await p.settle(1);
  }
  assert.equal(p.calls.length, 1);
  p.close();
});

test('while loading: quiet grey lines, no numbers yet; empty: one calm line', async () => {
  let release;
  const p = await openPage({ reply: () => new Promise((resolve) => { release = resolve; }) });
  const { document } = p;
  assert.equal(document.querySelectorAll('.ebs-op-skeleton').length, 6);
  assert.equal(document.querySelector('.ebs-op-body').getAttribute('aria-busy'), 'true');
  assert.deepEqual(texts([...document.querySelectorAll('.ebs-op-card-value')]), ['', '', '']);
  assert.ok(!document.querySelector('.ebs-op-ladder').classList.contains('shown'));
  release({ body: gridAnswer([]) });
  await p.settle(3);
  assert.equal(document.querySelectorAll('.ebs-op-skeleton').length, 0);
  assert.match(document.querySelector('.ebs-op-empty').textContent, /Geen open posten.*Alles is betaald of verrekend\. Mooi\./);
  p.close();
});

test('without our own answer the view shows the posts on the page', async () => {
  const p = await openPage({ reply: () => ({ status: 500, body: '' }) });
  const { document } = p;
  assert.equal(p.calls.length, 1);
  assert.equal(rows(document).length, 6);
  assert.match(document.querySelector('.ebs-op-help').textContent, /op deze pagina van e-Boekhouden/);
  assert.equal(rows(document)[0].querySelector('.ebs-op-relation-name').textContent, 'DEMO01');
  assert.ok(document.querySelector('app-grid').classList.contains('ebs-op-paged'), 'the native pagination stays');
  p.close();
});

test('quick select picks the matching posts and dims the rest; the bar sums them', async () => {
  const p = await openPage();
  const { document } = p;
  [...document.querySelectorAll('.ebs-op-chip')].find((chip) => chip.textContent === 'Vervallen zonder herinnering').click();
  await p.settle(1);
  const checked = rows(document).filter((row) => row.classList.contains('checked'));
  assert.deepEqual(checked.map((row) => row.querySelector('.ebs-op-invoice').textContent), ['2026-0402', '2026-0405', '2026-0412']);
  assert.equal(rows(document).filter((row) => row.classList.contains('dim')).length, 5);
  const bar = document.querySelector('.ebs-op-bar');
  assert.ok(bar.classList.contains('show'));
  assert.equal(bar.querySelector('.ebs-op-bar-count').textContent, '3 posten geselecteerd');
  assert.equal(bar.querySelector('.ebs-op-bar-sub').textContent, '€ 5.913,70 · 3 relaties');
  assert.deepEqual(texts([...bar.querySelectorAll('.ebs-op-bar-buttons > button')]), ['Aanmanen per e-mail…', 'Verrekenen', 'Afboeken', 'Selectie wissen']);
  [...bar.querySelectorAll('button')].find((node) => node.textContent === 'Selectie wissen').click();
  await p.settle(2);
  assert.ok(!bar.classList.contains('show'));
  p.close();
});

test('shift-click selects a range; search filters the rows', async () => {
  const p = await openPage();
  const { document, window } = p;
  rows(document)[1].querySelector('.ebs-op-check').click();
  rows(document)[4].querySelector('.ebs-op-check').dispatchEvent(new window.MouseEvent('click', { bubbles: true, shiftKey: true }));
  await p.settle(1);
  assert.deepEqual(rows(document).map((row) => (row.classList.contains('checked') ? 1 : 0)).join(''), '01111000');
  assert.equal(rows(document)[4].querySelector('.ebs-op-check').getAttribute('aria-checked'), 'true');
  const search = document.querySelector('.ebs-op-search input');
  search.value = 'studio';
  search.dispatchEvent(new window.Event('input'));
  await p.settle(1);
  assert.deepEqual(rows(document).map((row) => row.querySelector('.ebs-op-invoice').textContent), ['2026-0390', '2026-0418']);
  p.close();
});

test('a native action ticks e-Boekhouden\'s own checkboxes and clicks its own action', async () => {
  const p = await openPage();
  const { document } = p;
  const log = [];
  for (const li of document.querySelectorAll('app-grid-bulk-action li')) {
    li.addEventListener('click', () => log.push([li.textContent.trim(), [...document.querySelectorAll('.grid-multi-check input')].filter((box) => box.checked).map((box) => box.dataset.f).join(',')]));
  }
  rows(document)[0].click();
  rows(document)[2].click();
  await p.settle(1);
  [...document.querySelectorAll('.ebs-op-bar button')].find((node) => node.textContent === 'Verrekenen').click();
  assert.deepEqual(log, [['De geselecteerde facturen met elkaar verrekenen', '2026-0371,2026-0390']]);

  // A post that is not on this page of e-Boekhouden: no action, a message.
  rows(document)[6].click();
  await p.settle(1);
  [...document.querySelectorAll('.ebs-op-bar button')].find((node) => node.textContent === 'Afboeken').click();
  assert.equal(log.length, 1);
  assert.match(document.querySelector('.ebs-op-bar-note').textContent, /1 geselecteerde post staat niet op deze pagina/);
  assert.ok(document.querySelector('.ebs-op-bar').classList.contains('has-note'));
  p.close();
});

test('the soort switch sets e-Boekhouden\'s own field and clicks Volgende', async () => {
  const p = await openPage();
  const { document } = p;
  const log = [];
  document.querySelector('#soort').addEventListener('change', (event) => log.push(`change ${event.target.value}`));
  document.querySelector('#filter form').addEventListener('submit', (event) => {
    event.preventDefault();
    log.push('submit');
  });
  const tabs = [...document.querySelectorAll('.ebs-op-kind')];
  assert.deepEqual(tabs.map((tab) => tab.getAttribute('aria-selected')), ['true', 'false']);
  tabs[0].click();
  assert.deepEqual(log, [], 'the list shown already: nothing');
  tabs[1].click();
  assert.deepEqual(log, ['change Crediteur', 'submit']);
  p.close();
});

test('Klassieke weergave goes back to the native screen and is remembered; Nieuwe weergave returns', async () => {
  const p = await openPage();
  const { document } = p;
  [...document.querySelectorAll('.ebs-op-link')].find((node) => node.textContent === 'Klassieke weergave').click();
  await p.settle(3);
  assert.equal(p.store.classicScreens.openposts, true);
  assert.equal(document.querySelector('.ebs-op'), null);
  assert.ok(!document.documentElement.classList.contains('ebs-better-openposts'));
  const back = document.querySelector('.ebs-op-native-toggle a');
  assert.equal(back.textContent, 'Nieuwe weergave');
  assert.equal(back.parentElement.nextElementSibling, document.querySelector('app-open-post-list'));
  back.click();
  await p.settle(4);
  assert.equal(p.store.classicScreens.openposts, false);
  assert.ok(document.querySelector('.ebs-op'));
  p.close();
});

test('without Better design the screen stays e-Boekhouden\'s own', async () => {
  const p = await openPage({ store: { settings: { betterDesign: false } } });
  assert.equal(p.document.querySelector('.ebs-op, .ebs-op-native-toggle'), null);
  assert.equal(p.document.getElementById('ebs-openposts-style'), null);
  assert.equal(p.calls.length, 0, 'no request');
  p.close();
});

test('the ladder: set up once with one request, then steps count and pick their posts', async () => {
  const p = await openPage();
  const { document, window } = p;
  const steps = () => [...document.querySelectorAll('.ebs-op-step')];
  assert.ok(document.querySelector('.ebs-op-ladder').classList.contains('shown'));
  assert.deepEqual(steps().map((node) => node.querySelector('.ebs-op-step-count').textContent), ['3', '-', '-', '-'], 'without a mapping only the first step is known');
  steps()[1].click();
  await p.settle(3);
  const dialog = document.querySelector('.ebs-op-map-dialog');
  assert.ok(dialog, 'the mapping opens');
  assert.equal(dialog.querySelector('.ebs-dialog-title').textContent, 'Aanmaanladder instellen');
  assert.equal(p.calls.filter((url) => url.includes('/aanmaansjabloon/gridtable')).length, 1);
  const selects = [...dialog.querySelectorAll('.ebs-op-map-select')];
  assert.deepEqual(selects.map((select) => select.value), ['1', '2', '3', '4'], 'a first guess from the names');
  assert.deepEqual([...selects[0].options].map((option) => option.textContent), ['Geen sjabloon', 'Herinnering (E-mail)', 'Herinnering 2 (E-mail)', 'Aanmaning (E-mail)', 'Ingebrekestelling (E-mail)', 'Brief (Post)']);

  // The same template twice cannot be told apart: no save.
  selects[2].value = '2';
  selects[2].dispatchEvent(new window.Event('change'));
  const save = dialog.querySelector('.ebs-op-btn.dark');
  assert.equal(save.disabled, true);
  assert.match(dialog.querySelector('.ebs-op-map-warning').textContent, /Twee stappen hebben hetzelfde sjabloon/);
  selects[2].value = '3';
  selects[2].dispatchEvent(new window.Event('change'));
  assert.equal(save.disabled, false);
  save.click();
  await p.settle(4);
  const stored = p.store['store:1000001/openposts/ladder'];
  assert.deepEqual(stored.v.steps.map((step) => step?.name), ['Herinnering', 'Herinnering 2', 'Aanmaning', 'Ingebrekestelling']);
  assert.deepEqual(steps().map((node) => node.querySelector('.ebs-op-step-count').textContent), ['3', '2', '1', '0']);
  // Saving went on with the step that was clicked: the posts after the 1e herinnering.
  assert.deepEqual(rows(document).filter((row) => row.classList.contains('checked')).map((row) => row.querySelector('.ebs-op-invoice').textContent), ['2026-0398', '2026-0390']);
  assert.equal(document.querySelector('.ebs-op-bar .primary').textContent, 'Stuur 2e herinnering per e-mail…');
  assert.equal(p.calls.length, 2, 'the list and the templates, nothing else');
  p.close();
});

test('the reminder dialog shows e-Boekhouden\'s own form with the selection in its query', async () => {
  const p = await openPage({ store: { 'store:1000001/openposts/ladder': { v: LADDER, at: 1, by: 'local' } } });
  const { document, window } = p;
  await p.settle(2);
  [...document.querySelectorAll('.ebs-op-step')][1].click();
  await p.settle(1);
  document.querySelector('.ebs-op-bar .primary').click();
  await p.settle(2);
  const panel = document.querySelector('.ebs-rm-dialog');
  assert.ok(panel);
  assert.equal(panel.querySelector('.ebs-dialog-title').textContent, '2e herinnering per e-mail');
  assert.equal(panel.querySelector('.ebs-dialog-sub').textContent, '2 facturen · 2 relaties · € 3.460,60 open');
  const frame = panel.querySelector('iframe');
  const src = new URL(frame.src);
  assert.equal(src.pathname, '/boekhouden/openposten/aanmaning');
  assert.equal(src.searchParams.get('selected'), '2026-0398|11,2026-0390|12');
  assert.equal(src.searchParams.get('soort'), 'E');
  assert.equal(src.searchParams.get('credDeb'), 'D');
  assert.equal(src.searchParams.get('proefAanmaning'), 'false');
  assert.equal(src.searchParams.get('returnUrl'), '/boekhouden/openposten?soort=Debiteur&zoeken=true');
  assert.equal(panel.querySelector('.ebs-dialog-cover').hidden, false, 'loading until the frame says it is ready');
  // The loader's mark over the loading text, animated with Better design.
  assert.ok(panel.querySelector('.ebs-dialog-cover > .ebs-mark-slot > .ebs-mark.ebs-mark-light:not(.is-still)'));
  assert.equal(panel.querySelector('.ebs-dialog-cover-text').textContent, 'Bezig met laden…');
  // The template text is one item for a click of the user; this click was
  // not one (jsdom), so the request layer refused it: no request.
  assert.equal(p.calls.length, 1);

  // The frame says hello: it gets the payload; ready lifts the cover; close closes.
  const got = [];
  frame.contentWindow.postMessage = (message) => got.push(message);
  const say = (data) => window.dispatchEvent(new window.MessageEvent('message', { data: { ebs: 'ebs-remind', ...data }, origin: 'https://secure20.e-boekhouden.nl', source: frame.contentWindow }));
  say({ type: 'hello' });
  assert.equal(got[0].type, 'payload');
  assert.deepEqual(plain(got[0].payload.template), { id: 2, name: 'Herinnering 2' });
  assert.deepEqual(plain(got[0].payload.rows.map((row) => [row.factuur, row.relatieId, row.email])), [['2026-0398', 11, 'facturen@demo-klant.test'], ['2026-0390', 12, '']]);
  // A message from anywhere else is not the frame's.
  window.dispatchEvent(new window.MessageEvent('message', { data: { ebs: 'ebs-remind', type: 'close' }, origin: 'https://secure20.e-boekhouden.nl', source: window }));
  assert.ok(document.querySelector('.ebs-rm-dialog'));
  say({ type: 'ready' });
  assert.equal(panel.querySelector('.ebs-dialog-cover').hidden, true);
  // The cover fades out; the mark (and its loop) goes once it has.
  assert.ok(panel.querySelector('.ebs-dialog-cover .ebs-mark'));
  await new Promise((resolve) => setTimeout(resolve, 260));
  assert.equal(panel.querySelector('.ebs-dialog-cover .ebs-mark'), null);
  say({ type: 'close', reason: 'cancel' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(document.querySelector('.ebs-rm-dialog'), null);
  p.close();
});

test('the template text for the preview is one item request with userAction, on the click', async () => {
  // A stand-in for the request layer, to see what is asked: the real one
  // refuses an item without a trusted click, which jsdom cannot make.
  const asked = [];
  const p = await openPage({
    store: { 'store:1000001/openposts/ladder': { v: LADDER, at: 1, by: 'local' } },
    before(page) {
      page.load('shared.js');
      page.window.EBS.define('request', Object.freeze({
        bulk: async (key, url) => {
          asked.push(['bulk', key, url]);
          return gridAnswer(POSTS);
        },
        item: async (key, url, options) => {
          asked.push(['item', key, url, options]);
          return { tekstEmail: '<p>Beste [AANHEF],</p><p>Factuur [FACTNUMMER]</p><script>bad()</script>', onderwerp: 'Tweede herinnering' };
        },
        clear() {},
      }));
    },
  });
  const { document } = p;
  [...document.querySelectorAll('.ebs-op-step')][1].click();
  await p.settle(1);
  assert.equal(asked.length, 1, 'the list only');
  document.querySelector('.ebs-op-bar .primary').click();
  await p.settle(1);
  assert.deepEqual(plain(asked[1]), ['item', 'openposts:sjabloon:2', '/v1/api/aanmaansjabloon/view/2', { userAction: true }]);
  assert.equal(asked.length, 2);
  p.close();
});

test('pure helpers: dates, due texts, template names and steps', async () => {
  const p = await openPage();
  const api = p.window.__ebsOpenposts;
  assert.deepEqual({ ...api.toDate('2026-08-12T00:00:00') }, { text: '12-08-2026', time: Date.UTC(2026, 7, 12) });
  assert.equal(api.toDate('12-08-2026').text, '12-08-2026');
  assert.equal(api.toDate('morgen'), null);
  assert.equal(api.dueText(1), '1 dag te laat');
  assert.equal(api.dueText(0), 'vandaag');
  assert.equal(api.dueText(-2), 'over 2 dagen');
  const steps = LADDER.steps;
  assert.equal(api.levelOf('Herinnering', steps), 1);
  assert.equal(api.levelOf(' herinnering 2 (E) ', steps), 2);
  assert.equal(api.levelOf('Herinnering 2 per e-mail', steps), 2);
  assert.equal(api.levelOf('Aanmaning P', steps), 3, 'a name with a letter after it is still contained');
  assert.equal(api.levelOf('Ingebrekestelling - post', steps), 4);
  assert.equal(api.levelOf('Laatste Aanmaning', steps), 3, 'one name contained as whole words');
  assert.equal(api.levelOf('Iets anders', steps), null);
  assert.equal(api.levelOf('', steps), null);
  assert.equal(api.levelOf(null, steps), null);
  const twice = [{ name: 'Herinnering' }, { name: 'herinnering' }, null, null];
  assert.equal(api.levelOf('Herinnering', twice), null, 'two steps with one name count for neither');
  assert.deepEqual(api.sharedSteps(twice), [true, true, false, false]);
  assert.equal(api.rowsFromGrid({ data: 'nope' }), null);
  const parsed = api.rowsFromGrid({ data: [{ MutFactuur: 'F1', RelatieId: 7, TeOntvangen: '12.50', Vervaldatum: '01-01-2020', CorOmschrijving: null }] });
  assert.equal(parsed.rows[0].factuur, 'F1');
  assert.equal(parsed.rows[0].open, 12.5);
  assert.ok(parsed.rows[0].days > 1000);
  assert.equal(api.remindable({ factuur: 'A,1', relatieId: 1 }), false);
  assert.equal(api.remindable({ factuur: 'A1', relatieId: null }), false);
  assert.equal(api.remindable({ factuur: 'A1', relatieId: 3 }), true);
  p.close();
});

test('before e-Boekhouden loaded its list, an action clicks Volgende and keeps the selection for the next click', async () => {
  const p = await openPage({ grid: false, url: 'https://secure20.e-boekhouden.nl/boekhouden/openposten' });
  const { document, window } = p;
  const log = [];
  document.querySelector('#filter form').addEventListener('submit', (event) => {
    event.preventDefault();
    log.push('volgende');
  });
  rows(document)[0].click();
  rows(document)[2].click();
  await p.settle(1);
  [...document.querySelectorAll('.ebs-op-bar button')].find((node) => node.textContent === 'Verrekenen').click();
  assert.deepEqual(log, ['volgende']);
  assert.equal(document.querySelector('.ebs-op-bar-note').textContent, 'e-Boekhouden laadt de lijst. Klik daarna nog een keer.');

  // e-Boekhouden navigates to its list (zoeken=true) and shows the grid.
  window.history.pushState({}, '', '/boekhouden/openposten?soort=Debiteur&zoeken=true');
  document.querySelector('.grid-container').innerHTML = html().match(/<div class="grid-container">([\s\S]*)<\/div>\n<\/div><\/app-open-post-list>/)[1];
  await new Promise((resolve) => setTimeout(resolve, 400));
  await p.settle(4);
  assert.ok(p.calls.length <= 2, 'one bulk request per screen, no more');
  assert.deepEqual(rows(document).filter((row) => row.classList.contains('checked')).map((row) => row.querySelector('.ebs-op-invoice').textContent), ['2026-0371', '2026-0390'], 'the same selection, no stale extra');
  assert.ok(document.querySelector('.ebs-op-bar').classList.contains('show'));

  const done = [];
  for (const li of document.querySelectorAll('app-grid-bulk-action li')) {
    li.addEventListener('click', () => done.push([li.textContent.trim(), [...document.querySelectorAll('.grid-multi-check input')].filter((box) => box.checked).map((box) => box.dataset.f).join(',')]));
  }
  [...document.querySelectorAll('.ebs-op-bar button')].find((node) => node.textContent === 'Verrekenen').click();
  assert.deepEqual(done, [['De geselecteerde facturen met elkaar verrekenen', '2026-0371,2026-0390']]);
  assert.ok(!document.querySelector('.ebs-op-bar').classList.contains('has-note'), 'the note is gone once the action ran');
  p.close();
});

test('stale native ticks are cleared, and a tick e-Boekhouden refuses stops the action', async () => {
  const p = await openPage();
  const { document, window } = p;
  const log = [];
  for (const li of document.querySelectorAll('app-grid-bulk-action li')) {
    li.addEventListener('click', () => log.push([...document.querySelectorAll('.grid-multi-check input')].filter((box) => box.checked).map((box) => box.dataset.f).join(',')));
  }
  const boxes = [...document.querySelectorAll('.grid-multi-check input')];
  // Ticked earlier in e-Boekhouden itself: not part of this selection.
  boxes[3].checked = true;
  rows(document)[0].click();
  await p.settle(1);
  [...document.querySelectorAll('.ebs-op-bar button')].find((node) => node.textContent === 'Afboeken').click();
  assert.deepEqual(log, ['2026-0371'], 'only the selected invoice, the stale tick is gone');

  // canUnselectFn: e-Boekhouden keeps a post ticked (preventDefault on its click).
  boxes[0].addEventListener('click', (event) => event.preventDefault());
  rows(document)[0].click();
  rows(document)[1].click();
  await p.settle(1);
  [...document.querySelectorAll('.ebs-op-bar button')].find((node) => node.textContent === 'Afboeken').click();
  assert.equal(log.length, 1, 'no action with a selection that is not the user\'s');
  assert.match(document.querySelector('.ebs-op-bar-note').textContent, /nam de selectie niet over/);
  assert.equal(window.__ebsOpenposts.perIso('2026-10-29'), '2026-10-29');
  p.close();
});

test('after a native action the next change of e-Boekhouden\'s list loads ours once more', async () => {
  // A stand-in for the request layer: the real one answers a repeat on the
  // same screen from its cache until a trusted click, which jsdom cannot make.
  const asked = [];
  const p = await openPage({
    before(page) {
      page.load('shared.js');
      page.window.EBS.define('request', Object.freeze({
        bulk: async (key, url) => {
          asked.push(url);
          return gridAnswer(POSTS);
        },
        item: async () => null,
        clear() {},
      }));
    },
  });
  const { document } = p;
  assert.equal(asked.length, 1);
  rows(document)[0].click();
  await p.settle(1);
  [...document.querySelector('.ebs-op-bar').querySelectorAll('button')].find((node) => node.textContent === 'Selectie wissen').click();
  document.getElementById('clock').textContent = '2';
  document.querySelector('app-grid-body tbody tr td:nth-child(7)').textContent = 'x';
  await p.settle(4);
  assert.equal(asked.length, 1, 'a click on our own bar changes nothing in the list');
  rows(document)[0].click();
  await p.settle(1);
  [...document.querySelectorAll('.ebs-op-bar button')].find((node) => node.textContent === 'Afboeken').click();
  document.querySelector('app-grid-body tbody tr').remove();
  await p.settle(4);
  assert.equal(asked.length, 2, 'the native action changed the list: once more');
  document.querySelector('app-grid-body tbody tr').remove();
  await p.settle(4);
  assert.equal(asked.length, 2, 'not again without a new action');
  p.close();
});

test('the reminder query: the invoice numbers exactly as e-Boekhouden has them, the date as it sends it', async () => {
  const posts = [{ ...POSTS[3], mutFactuur: ' 2026-0402 ' }, { ...POSTS[4], mutFactuur: 'A,1' }, POSTS[5]];
  const p = await openPage({
    url: 'https://secure20.e-boekhouden.nl/boekhouden/openposten?soort=Debiteur&zoeken=true&per=2026-10-29',
    reply: () => ({ body: gridAnswer(posts) }),
  });
  const { document } = p;
  assert.equal(new URL(p.calls[0]).searchParams.get('per'), '2026-10-29', 'yyyy-mm-dd like e-Boekhouden, no time zone shift');
  for (const row of rows(document)) row.click();
  await p.settle(1);
  document.querySelector('.ebs-op-bar .primary').click();
  await p.settle(2);
  const src = new URL(document.querySelector('.ebs-rm-dialog iframe').src);
  assert.equal(src.searchParams.get('selected'), ' 2026-0402 |13,2026-0340|15', 'the raw number; A,1 cannot be in the query');
  assert.equal(src.searchParams.get('datumTot'), '2026-10-29');
  p.close();
});
