// e-Boekhouden's own controls in the Better design edit screens, in jsdom
// pages with the markup its templates render: the checkbox blocks of the
// aside, Meer velden, the date pickers and the line window. The style rules
// are checked through getComputedStyle (jsdom cascades the sheet, :has()
// included); sizes on screen are checked in the headless harness.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll } from './dom.mjs';
import { billingPage, invoiceEditHtml, subscriptionEditHtml, openLineWindow } from './billing-fixtures.mjs';

after(closeAll);

const INVOICE = 'https://secure20.e-boekhouden.nl/facturen/factuur/toevoegen/0';
const SUBSCRIPTION = 'https://secure20.e-boekhouden.nl/facturen/abonnement/5';

async function editPage(html, url) {
  const p = billingPage(html, { url, posts: [] });
  await p.settle(4);
  return p;
}

// Counts what e-Boekhouden's checkbox would see: its clicks and changes.
function countToggles(p, id) {
  const input = p.document.getElementById(id);
  const seen = { clicks: 0, changes: 0 };
  input.addEventListener('click', () => { seen.clicks += 1; });
  input.addEventListener('change', () => { seen.changes += 1; });
  return { input, seen };
}

const style = (p, node) => p.window.getComputedStyle(node);

// ---------------------------------------------------------------------------
// The checkbox blocks
// ---------------------------------------------------------------------------

test('a checkbox block is the hit target: a click anywhere toggles e-Boekhouden\'s own checkbox exactly once', async () => {
  const p = await editPage(invoiceEditHtml(), INVOICE);
  const { document } = p;
  const view = document.querySelector('.ebs-b-edit');
  const blocks = [...view.querySelectorAll('.ebs-b-check-row')];
  const block = (words) => blocks.find((node) => node.textContent.includes(words));

  for (const [words, id] of [['Per e-mail versturen', 'emailen'], ['Per post versturen', 'printen'], ['Factuurbedrag incasseren', 'incasso'], ['Direct verwerken', 'directVerwerken']]) {
    const node = block(words);
    assert.equal(node.tagName, 'LABEL', words);
    assert.equal(node.control, document.getElementById(id), `${words}: tied to the native checkbox`);
    assert.equal(node.hasAttribute('for'), false, 'no id needed: the checkbox is inside the label');
    const { input, seen } = countToggles(p, id);
    const was = input.checked;
    // The words, the icon, the block itself and the checkbox: once each.
    for (const target of [node.querySelector('.ebs-b-check-words'), node.querySelector('.ebs-b-check-label svg') ?? node.querySelector('.ebs-b-check-label'), node, input]) {
      const before = input.checked;
      target.dispatchEvent(new p.window.MouseEvent('click', { bubbles: true, cancelable: true }));
      assert.equal(input.checked, !before, `${words}: one toggle from ${target.className || target.tagName}`);
    }
    assert.equal(seen.clicks, 4, `${words}: e-Boekhouden saw one click per click of the user`);
    assert.equal(seen.changes, 4);
    assert.equal(input.checked, was, 'four toggles: back where it was');
  }

  // Factuurbedrag incasseren is a block like the two above it.
  for (const words of ['Per e-mail versturen', 'Per post versturen', 'Factuurbedrag incasseren']) {
    assert.ok(block(words).classList.contains('framed'), words);
    assert.ok(block(words).querySelector('.ebs-b-check-label svg'), `${words}: an icon`);
  }
  // Hover, focus and checked fade; nothing toggles display.
  const transition = style(p, block('Per e-mail versturen')).transition;
  for (const property of ['background-color 150ms', 'border-color 150ms', 'box-shadow 150ms']) assert.ok(transition.includes(property), property);
  assert.equal(style(p, block('Per e-mail versturen')).cursor, 'pointer');
  const email = document.getElementById('emailen');
  email.checked = true;
  assert.equal(style(p, block('Per e-mail versturen')).borderColor, 'rgb(35, 44, 79)', 'checked: the dark border');
  email.checked = false;
  assert.equal(style(p, block('Per e-mail versturen')).borderColor, 'rgb(214, 219, 232)');
  assert.equal(style(p, block('Per e-mail versturen')).display, 'flex');
  p.close();
});

test('the subscription blocks: the whole row toggles once, a disabled checkbox stays as it is', async () => {
  const p = await editPage(subscriptionEditHtml(), SUBSCRIPTION);
  const { document } = p;
  const view = document.querySelector('.ebs-b-edit');
  const blocks = [...view.querySelectorAll('.ebs-b-check-row')];
  assert.equal(blocks.length, 5);
  assert.ok(blocks.every((node) => node.tagName === 'LABEL' && node.control?.type === 'checkbox'));
  const pause = blocks.find((node) => node.textContent.includes('Tijdelijk niet factureren'));
  const { input, seen } = countToggles(p, 'geenFactuur');
  pause.querySelector('.ebs-b-check-words').click();
  assert.equal(input.checked, true);
  assert.equal(seen.changes, 1);
  input.click();
  assert.equal(input.checked, false);
  assert.equal(seen.changes, 2, 'a click on the checkbox itself is not repeated by the label');

  const post = document.getElementById('printen');
  post.disabled = true;
  blocks.find((node) => node.textContent.includes('Per post versturen')).querySelector('.ebs-b-check-words').click();
  assert.equal(post.checked, false, 'disabled by e-Boekhouden: no toggle');
  p.close();
});

// ---------------------------------------------------------------------------
// Meer velden
// ---------------------------------------------------------------------------

const moreText = (view) => view.querySelector('.ebs-b-more-toggle').textContent;

test('Meer velden holds the real fields of e-Boekhouden and names them', async () => {
  const p = await editPage(invoiceEditHtml(), INVOICE);
  const { document } = p;
  const view = document.querySelector('.ebs-b-edit');
  const slot = view.querySelector('.ebs-b-more-slot');
  const fields = ['uitersteBetaaldatum', 'machtigingSoort', 'machtigingId', 'machtigingDatum', 'iban', 'tenNameVan', 'plaats', 'factOm1', 'factOm2', 'factOm3'];
  for (const id of fields) {
    const field = slot.querySelector(`#${id}`);
    assert.ok(field, id);
    assert.notEqual(style(p, field.closest('.form-row')).display, 'none', `${id} shows`);
  }
  assert.equal(moreText(view), 'Meer velden van e-Boekhouden: uiterste betaaldatum, soort machtiging, kenmerk machtiging(ID), datum ondertekening, IBAN, t.n.v., plaats, omschrijving regel 1, omschrijving regel 2, omschrijving regel 3');
  // Moved rows are not in there, and its own headings stay out of sight.
  for (const id of ['nummer', 'emailen', 'incasso', 'mutOmschrijving']) assert.equal(slot.querySelector(`#${id}`), null, id);
  for (const heading of slot.querySelectorAll('.title-group')) assert.equal(style(p, heading).display, 'none');
  // Its wrappers hand the rows to the grid.
  assert.equal(style(p, slot.querySelector('#iban').closest('.form-body > div:not(.form-row)')).display, 'contents');
  p.close();
});

// Moved rows: the attribute stays on the row, or on the wrapper they came from.
const SIMPLE_WRAPPED = new Set(['mutOmschrijving']);
const homeHidden = (id) => SIMPLE_WRAPPED.has(id);

test('Meer velden in e-Boekhouden\'s simple mode: the rows it hides with custom-hidden show in the layout', async () => {
  const p = await editPage(invoiceEditHtml(undefined, { advanced: false }), INVOICE);
  const { document } = p;
  const view = document.querySelector('.ebs-b-edit');
  for (const id of ['nummer', 'kenmerk', 'termijn', 'uitersteBetaaldatum', 'mutOmschrijving', 'emailen', 'printen']) {
    const field = document.getElementById(id);
    assert.ok(field.closest('[custom-hidden="true"]') || homeHidden(id), `${id}: hidden by e-Boekhouden`);
    for (let node = field; node; node = node.parentElement) assert.notEqual(style(p, node).display, 'none', `${id}: shown in the layout`);
  }
  assert.match(moreText(view), /^Meer velden van e-Boekhouden: uiterste betaaldatum,/);
  p.close();
});

test('Meer velden in simple mode: rows in a hidden wrapper or hidden themselves show, and every named field can be seen', async () => {
  // Debiteurenrekening sits in the verwerken wrapper (custom-hidden="true" in
  // simple mode), Peppol carries custom-hidden="true" on its own row.
  const p = await editPage(invoiceEditHtml(undefined, { advanced: false, incassoModule: false, peppol: true, debiteurenRekeningen: true, klaargezet: '12-10-2026' }), INVOICE);
  const { document } = p;
  const view = document.querySelector('.ebs-b-edit');
  const slot = view.querySelector('.ebs-b-more-slot');
  for (const id of ['grootboekrekeningId-AutocompletePickerInput', 'versturenViaPeppol']) {
    const field = slot.querySelector(`#${id}`);
    assert.ok(field?.closest('[custom-hidden="true"]'), `${id}: hidden by e-Boekhouden`);
    for (let node = field; node !== slot; node = node.parentElement) assert.notEqual(style(p, node).display, 'none', `${id}: shown in Meer velden`);
  }
  assert.equal(moreText(view), 'Meer velden van e-Boekhouden: uiterste betaaldatum, debiteurenrekening, factuur via Peppol versturen, deze factuur is op 12-10-2026 klaargezet voor incasso');
  // Every row it names is one the user sees once it is open.
  for (const row of slot.querySelectorAll('.form-body .form-row')) {
    for (let node = row; node !== slot; node = node.parentElement) assert.notEqual(style(p, node).display, 'none', row.textContent.trim());
  }
  p.close();
});

test('Meer velden without factuur-incasso or Peppol: it says what is there, or that there is nothing', async () => {
  let p = await editPage(invoiceEditHtml(undefined, { incassoModule: false }), INVOICE);
  let view = p.document.querySelector('.ebs-b-edit');
  assert.equal(moreText(view), 'Meer velden van e-Boekhouden: uiterste betaaldatum');
  assert.equal(view.querySelector('.ebs-b-more-toggle').disabled, false);
  p.close();

  p = await editPage(invoiceEditHtml(undefined, { incassoModule: false, peppol: true }), INVOICE);
  view = p.document.querySelector('.ebs-b-edit');
  assert.equal(moreText(view), 'Meer velden van e-Boekhouden: uiterste betaaldatum, factuur via Peppol versturen');
  assert.ok(view.querySelector('.ebs-b-more-slot #versturenViaPeppol'));
  p.close();

  p = await editPage(subscriptionEditHtml(), SUBSCRIPTION);
  view = p.document.querySelector('.ebs-b-edit');
  const toggle = view.querySelector('.ebs-b-more-toggle');
  assert.equal(moreText(view), 'Meer velden van e-Boekhouden: geen bij dit abonnement');
  assert.equal(toggle.disabled, true, 'nothing to open');
  toggle.click();
  assert.equal(view.querySelector('.ebs-b-more').classList.contains('open'), false);
  p.close();

  p = await editPage(subscriptionEditHtml(undefined, { incassoModule: true, peppol: true }), SUBSCRIPTION);
  view = p.document.querySelector('.ebs-b-edit');
  assert.equal(moreText(view), 'Meer velden van e-Boekhouden: soort machtiging, kenmerk machtiging(ID), datum ondertekening, IBAN, t.n.v., plaats, omschrijving regel 1, omschrijving regel 2, omschrijving regel 3, factuur via Peppol versturen');
  for (const id of ['iban', 'tenNameVan', 'plaats', 'factOm1', 'factOm2', 'factOm3', 'machtigingDatum', 'versturenViaPeppol']) assert.ok(view.querySelector(`.ebs-b-more-slot #${id}`), id);
  for (const line of view.querySelectorAll('.ebs-b-more-slot hr')) assert.equal(style(p, line).display, 'none');
  p.close();
});

test('Meer velden opens and closes with its height and opacity, never display, and a soft focus ring', async () => {
  const p = await editPage(invoiceEditHtml(), INVOICE);
  const { document } = p;
  const view = document.querySelector('.ebs-b-edit');
  const more = view.querySelector('.ebs-b-more');
  const slot = view.querySelector('.ebs-b-more-slot');
  const toggle = view.querySelector('.ebs-b-more-toggle');
  assert.equal(style(p, slot).display, 'grid');
  assert.match(style(p, slot).transition, /grid-template-rows 200ms/);
  assert.match(style(p, slot).transition, /opacity 150ms/);
  assert.equal(style(p, slot).gridTemplateRows, '0fr');
  assert.equal(style(p, slot).opacity, '0');
  assert.equal(style(p, slot.firstElementChild).overflow, 'hidden');
  toggle.click();
  assert.equal(more.classList.contains('open'), true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(style(p, slot).gridTemplateRows, '1fr');
  assert.equal(style(p, slot).opacity, '1');
  assert.equal(style(p, slot).display, 'grid');
  toggle.click();
  assert.equal(style(p, slot).gridTemplateRows, '0fr');
  // The focus ring: no hard outline, a soft ring that fades.
  const rule = [...document.getElementById('ebs-billing-style').sheet.cssRules].find((entry) => entry.selectorText === '.ebs-b-more-toggle:focus-visible');
  assert.equal(rule.style.outline, 'none');
  assert.match(rule.style.boxShadow, /rgba\(89, 106, 175, \.?0?\.3\)/);
  assert.match(style(p, toggle).transition, /box-shadow 150ms/);
  p.close();
});

// ---------------------------------------------------------------------------
// The date pickers
// ---------------------------------------------------------------------------

test('a date field is one tidy control: Lucide icons in e-Boekhouden\'s own buttons, which keep their own clicks', async () => {
  for (const [html, url, ids] of [
    [invoiceEditHtml(), INVOICE, ['datum', 'uitersteBetaaldatum', 'machtigingDatum']],
    [subscriptionEditHtml(), SUBSCRIPTION, ['startDatum', 'expiratieDatum', 'eindDatum']],
  ]) {
    const p = await editPage(html, url);
    const { document } = p;
    for (const id of ids) {
      const picker = document.getElementById(id).closest('app-date-picker');
      assert.ok(picker.closest('.ebs-b-edit'), `${id} in the layout`);
      const group = picker.querySelector('.selection-group');
      assert.equal(style(p, group).display, 'flex');
      assert.equal(style(p, group).height, '42px');
      assert.equal(style(p, document.getElementById(id)).borderTopWidth, '0px', `${id}: the border is the group's`);
      for (const [selector, name] of [['.btn-decrease', 'chevron-left'], ['.btn-increase', 'chevron-right'], ['.btn-picker', 'calendar']]) {
        const native = picker.querySelector(selector);
        const mark = native.querySelector(':scope > .ebs-b-native-icon');
        assert.ok(mark?.querySelector(`svg.lucide-${name}`) ?? mark?.querySelector('svg'), `${id} ${selector}: a Lucide icon`);
        for (const glyph of native.querySelectorAll(':scope > :not(.ebs-b-native-icon)')) assert.equal(style(p, glyph).display, 'none', `${id} ${selector}: the native glyph steps aside`);
        let clicks = 0;
        native.addEventListener('click', () => { clicks += 1; });
        mark.querySelector('svg').dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
        assert.equal(clicks, 1, `${id} ${selector}: a click on the icon is a click on e-Boekhouden's button`);
        assert.equal(style(p, native).height, 'auto');
        assert.match(style(p, native).transition, /background-color 150ms/);
      }
      assert.equal(picker.querySelectorAll('.ebs-b-native-icon').length, 3, 'once, not per render');
    }
    await p.settle(2);
    assert.equal(document.querySelectorAll('app-date-picker .ebs-b-native-icon').length, ids.length * 3);
    p.close();
  }
});

test('a search field with its "+": the button attached to the field', async () => {
  const p = await editPage(invoiceEditHtml(), INVOICE);
  const { document } = p;
  const input = document.getElementById('relatieId-AutocompletePickerInput');
  const add = input.parentElement.querySelector('app-icon.add-button');
  assert.equal(style(p, input.parentElement).display, 'flex');
  assert.equal(style(p, input).width, 'auto');
  assert.equal(style(p, input).borderTopRightRadius, '0px');
  assert.equal(style(p, add).width, '42px');
  assert.equal(style(p, add).height, '42px');
  assert.equal(style(p, add).borderRadius, '0 9px 9px 0');
  assert.match(style(p, add).transition, /background-color 150ms/);
  p.close();
});

// ---------------------------------------------------------------------------
// The line window
// ---------------------------------------------------------------------------

async function lineWindow(options = {}, html = invoiceEditHtml(), url = INVOICE) {
  const p = await editPage(html, url);
  const overlay = openLineWindow(p.document, options);
  await p.settle();
  return { p, overlay, body: overlay.querySelector('app-factuurregel-form form > .form-body') };
}

const rowOf = (overlay, id) => overlay.querySelector(`[id="${id}"]`).closest('.form-row');

test('the line window: one white modal, no inner frame, the actions on its bottom edge', async () => {
  const { p, overlay } = await lineWindow({ uitleg: true });
  const inner = overlay.querySelector('.overlay-inner');
  const chain = overlay.querySelector('app-factuurregel-form > div');
  const appForm = chain.querySelector(':scope > app-form');
  const form = appForm.querySelector(':scope > form');
  const header = form.querySelector(':scope > .form-header');
  const body = form.querySelector(':scope > .form-body');
  const footer = form.querySelector(':scope > .form-footer');
  const uitleg = chain.querySelector(':scope > .uitleg');

  // No second card: the modal has no padding, app-form and its form no box.
  assert.equal(style(p, inner).padding, '0px');
  assert.equal(style(p, inner).backgroundColor, 'rgb(255, 255, 255)');
  assert.equal(style(p, overlay.querySelector('.no-top-margin')).margin, '0px');
  assert.equal(style(p, appForm).display, 'contents');
  assert.equal(style(p, form).display, 'contents');
  assert.equal(style(p, body).borderTopWidth, '0px');
  assert.equal(style(p, body).boxShadow, 'none');
  assert.equal(style(p, header.querySelector('h1')).borderBottomWidth, '0px', 'the heading has no line of its own; the header has one');
  assert.equal(style(p, header).borderBottom, '1px solid rgb(230, 233, 241)');

  // The footer is the last part of the modal, after the explanation.
  assert.equal(style(p, chain).display, 'flex');
  assert.equal(style(p, chain).flexDirection, 'column');
  const order = (node) => Number(style(p, node).order);
  assert.ok(order(header) < order(body) && order(body) < order(uitleg) && order(uitleg) < order(footer), 'header, fields, explanation, actions');
  assert.equal(style(p, footer).margin, '0px');
  assert.equal(style(p, footer).backgroundColor, 'rgb(247, 248, 251)');
  assert.equal(style(p, footer.querySelector('.hr')).display, 'none');
  const buttons = footer.querySelector('.form-buttons');
  assert.equal(style(p, buttons).display, 'flex');
  assert.equal(style(p, buttons).justifyContent, 'flex-end');
  const at = (selector) => Number(style(p, buttons.querySelector(`:scope > ${selector}`)).order);
  assert.ok(at('.form-cancel') < at('.footer-next') && at('.footer-next') < at('.form-submit'), 'Annuleren, Opslaan en nieuw, Opslaan');

  // The header: title, our subtitle, e-Boekhouden's close with a Lucide x.
  assert.equal(header.querySelector('.ebs-b-modal-sub').textContent, 'Het regelvenster van e-Boekhouden, anders opgemaakt');
  const close = inner.querySelector('.close-btn');
  assert.ok(close.querySelector('.ebs-b-native-icon svg'));
  assert.equal(style(p, close).fontSize, '0px', 'the text glyph steps aside');
  let closed = 0;
  close.addEventListener('click', () => { closed += 1; });
  close.querySelector('svg').dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
  assert.equal(closed, 1, 'e-Boekhouden\'s own close');
  p.close();
});

test('the line window: a compact grid, every field with its own label', async () => {
  const { p, overlay, body } = await lineWindow();
  assert.equal(style(p, body).display, 'grid');
  assert.match(style(p, body).gridTemplateColumns, /^repeat\(12,/);
  assert.equal(style(p, body).gap, '14px');
  const span = (id) => style(p, rowOf(overlay, id)).gridColumn;
  assert.equal(span('aantal'), 'span 3');
  assert.equal(span('eenheidId-AutocompletePickerInput'), 'span 4');
  assert.equal(span('code'), 'span 5');
  assert.equal(span('omschrijving'), '1 / -1');
  assert.equal(span('prijsExcl'), '1 / -1');
  assert.equal(span('btw-AutocompletePickerInput'), 'span 7');
  assert.equal(span('korting'), 'span 5');
  assert.equal(span('grootboekrekeningId-AutocompletePickerInput'), '1 / -1');
  for (const br of body.querySelectorAll('br')) assert.equal(style(p, br).display, 'none', 'no loose line breaks');

  // Labels: each field is named by a label for it, in its own row.
  for (const id of ['aantal', 'code', 'omschrijving', 'prijsExcl', 'prijsIncl', 'korting']) {
    const field = overlay.querySelector(`[id="${id}"]`);
    const labels = [...rowOf(overlay, id).querySelectorAll('label')].filter((label) => label.htmlFor === id);
    assert.ok(labels.length, `${id}: labelled`);
    assert.equal(labels[0].control, field, `${id}: the label is for this field`);
  }
  // Prijs: excl and incl side by side, each with its label inside the field.
  const price = rowOf(overlay, 'prijsExcl').querySelector('.form-component');
  assert.equal(style(p, price).display, 'grid');
  const [title, excl, incl] = [...price.querySelectorAll(':scope > app-form-label')];
  assert.equal(style(p, title).gridColumn, '1 / -1');
  const inputExcl = overlay.querySelector('#prijsExcl').closest('app-number-input');
  const inputIncl = overlay.querySelector('#prijsIncl').closest('app-number-input');
  assert.deepEqual([style(p, excl).gridColumn, style(p, excl).gridRow], [style(p, inputExcl).gridColumn, style(p, inputExcl).gridRow], '(excl btw) sits in its field');
  assert.deepEqual([style(p, incl).gridColumn, style(p, incl).gridRow], [style(p, inputIncl).gridColumn, style(p, inputIncl).gridRow], '(incl btw) sits in its field');
  assert.notEqual(style(p, inputExcl).gridColumn, style(p, inputIncl).gridColumn);
  assert.equal(style(p, excl).justifySelf, 'end');
  assert.equal(style(p, excl).pointerEvents, 'none', 'a click there reaches the field');
  // Korting: amount and its kind on one line; the empty label of the kind is out of sight.
  const discount = rowOf(overlay, 'korting').querySelector('.form-component');
  assert.equal(style(p, discount).display, 'grid');
  assert.equal(style(p, discount.querySelector('app-number-input')).gridRow, '2');
  assert.equal(style(p, discount.querySelector('app-selectlist')).gridRow, '2');
  assert.equal(style(p, discount.querySelector('app-form-label#kortingSoort')).display, 'none');
  // Aantal: a narrow field, its number on the right.
  assert.equal(style(p, overlay.querySelector('#aantal')).textAlign, 'right');
  assert.equal(style(p, overlay.querySelector('#aantal')).height, '42px');
  // The "+" of Eenheid and Tegenrekening: attached to its field.
  for (const id of ['eenheidId', 'grootboekrekeningId']) {
    const add = overlay.querySelector(`#${id}-AutocompleteInput app-icon.add-button`);
    assert.equal(style(p, add).width, '42px', id);
    assert.equal(style(p, add).borderRadius, '0 9px 9px 0', id);
    assert.equal(style(p, overlay.querySelector(`#${id}-AutocompletePickerInput`)).width, 'auto', id);
  }
  // The explanation: a note with an icon, in the grid.
  const help = body.querySelector(':scope > .ebs-b-modal-help');
  assert.ok(help.querySelector('svg'));
  assert.equal(style(p, help).fontSize, '13px');
  assert.equal(style(p, body.querySelector(':scope > div:not(.form-row) > .form-component > span')).fontSize, '13px');
  p.close();
});

test('the line window grid without eenheid or korting, and on the subscription screen', async () => {
  let { p, overlay } = await lineWindow({ eenheid: false, korting: false });
  assert.equal(style(p, rowOf(overlay, 'code')).gridColumn, 'span 9', 'code takes the room of eenheid');
  assert.equal(style(p, rowOf(overlay, 'btw-AutocompletePickerInput')).gridColumn, '1 / -1', 'btw takes the room of korting');
  p.close();

  ({ p, overlay } = await lineWindow({ uitleg: true }, subscriptionEditHtml(), SUBSCRIPTION));
  assert.equal(overlay.getAttribute('data-ebs-line-window'), '');
  assert.equal(style(p, overlay.querySelector('.overlay-inner')).padding, '0px');
  assert.equal(style(p, overlay.querySelector('app-factuurregel-form form > .form-body')).display, 'grid');
  assert.ok(Number(style(p, overlay.querySelector('.uitleg')).order) < Number(style(p, overlay.querySelector('.form-footer')).order));
  // Classic view: e-Boekhouden's own look and icons back.
  [...p.document.querySelectorAll('.ebs-b-link')].find((node) => node.textContent === 'Klassieke weergave').click();
  await p.settle();
  assert.equal(overlay.hasAttribute('data-ebs-line-window'), false);
  assert.equal(p.document.querySelectorAll('.ebs-b-native-icon, .ebs-b-modal-help').length, 0);
  assert.notEqual(style(p, overlay.querySelector('.overlay-inner')).borderRadius, '14px');
  p.close();
});

test('the line window leaves the windows e-Boekhouden opens on top of it alone', async () => {
  const { p, overlay } = await lineWindow();
  // A new eenheid: e-Boekhouden's own overlay inside the line form.
  const nested = p.document.createElement('app-form-overlay');
  nested.innerHTML = '<div class="overlay"><div class="overlay-outer"><div class="overlay-center"><div class="overlay-inner pad-top"><div class="no-top-margin"><app-eenheid-form><app-form><form class="form"><div class="form-body"><div class="form-row"><div class="form-component"><input class="form-input" id="enkelvoud"></div></div></div></form></app-form></app-eenheid-form></div></div></div></div></div>';
  overlay.querySelector('app-factuurregel-form').prepend(nested);
  await p.settle();
  assert.notEqual(style(p, nested.querySelector('.overlay-inner')).borderRadius, '14px');
  assert.notEqual(style(p, nested.querySelector('.form-body')).display, 'grid');
  assert.notEqual(style(p, nested.querySelector('#enkelvoud')).height, '42px');
  p.close();
});
