// The import screen (import.js) in a jsdom page with e-Boekhouden's grid markup.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, page } from './dom.mjs';

after(closeAll);

const line = (i) => `<tr>
  <td><div class="grid-multi-check"><input type="checkbox"></div></td>
  <td><span title="Verwijderen">x</span></td><td><a title="Handmatig invoeren">e</a></td>
  <td>29-09-2026</td><td>NL00DEMO0000000001</td><td>${String(i + 1).padStart(2, '0')}-09-2026</td><td>${i % 2 ? '-' : ''}1${i},00</td>
  <td>Naam: Partij ${i} IBAN: NL00DEMO00000000${i} Omschrijving: Factuur ${i}</td><td></td><td></td></tr>`;

const html = (rows = 6) => `<!doctype html><html><head></head><body>
<app-header-identity-b><div class="header-identity"><div class="userInfo"><span class="userName">Demo</span><span class="administratieId">123</span></div></div></app-header-identity-b>
<div id="content">
<app-grid id="other"><app-grid-header><div class="grid-header-title">Importbestanden</div></app-grid-header><app-grid-body><table class="grid"><tbody><tr><td>ander grid</td></tr></tbody></table></app-grid-body></app-grid>
<app-grid id="import"><app-grid-header><div class="grid-header-title">Niet verwerkte afschriftregels (${rows} regels)</div></app-grid-header>
<app-grid-body><table class="grid"><thead><tr><th></th><th></th><th></th><th>Importdatum</th><th>RekeningNr</th><th>Boekdatum</th><th>Bedrag</th><th>Omschrijving</th><th>Verwerkingsfouten</th><th>Opmerking</th></tr></thead>
<tbody>${Array.from({ length: rows }, (_, i) => line(i)).join('')}</tbody></table></app-grid-body>
<app-grid-footer><app-pagination></app-pagination><app-grid-bulk-actions><ul>
<app-grid-bulk-action><li id="weg"><span>Geselecteerde regels wegboeken</span></li></app-grid-bulk-action>
<app-grid-bulk-action><li id="del"><span>Geselecteerde regels verwijderen</span></li></app-grid-bulk-action>
</ul></app-grid-bulk-actions></app-grid-footer></app-grid>
<span id="clock">0</span></div></body></html>`;

async function importPage(options = {}) {
  const p = page(html(options.rows), { url: 'https://secure20.e-boekhouden.nl/boekhouden/importeren', store: { settings: { betterDesign: true } } });
  p.load('shared.js', 'import.js');
  await p.settle();
  return p;
}

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
  assert.deepEqual(p.store['import:123'].groups, ['Groep A', 'B hernoemd']);
  p.close();
});

test('bulk actions click e-Boekhouden\'s own action with the exact label', async () => {
  const p = page(html().replace('<app-grid-bulk-action><li id="del">', '<app-grid-bulk-action><li id="other-del"><span>Geselecteerde importregels verwijderen</span></li></app-grid-bulk-action><app-grid-bulk-action><li id="del">'), {
    url: 'https://secure20.e-boekhouden.nl/boekhouden/importeren', store: { settings: { betterDesign: true } },
  });
  p.load('shared.js', 'import.js');
  await p.settle();
  const { document } = p;
  const clicked = [];
  for (const id of ['other-del', 'del', 'weg']) document.getElementById(id).addEventListener('click', () => clicked.push(id));
  document.querySelectorAll('.ebs-body .ebs-check')[0].click();
  await p.settle();
  [...document.querySelectorAll('.ebs-bar-button')].find((button) => button.textContent === 'Verwijderen').click();
  [...document.querySelectorAll('.ebs-bar-button')].find((button) => button.textContent === 'Wegboeken').click();
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
  assert.equal(p.store['import:123'].hidden.length, 1);
  p.close();
});

test('an empty import says so instead of blaming the filters', async () => {
  const p = await importPage({ rows: 0 });
  assert.equal(p.document.querySelector('.ebs-empty').textContent, 'Er staan geen afschriftregels klaar om te verwerken.');
  p.close();
});
