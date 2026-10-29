// The reminder dialog's frame (features/remind.js): e-Boekhouden's own page
// "Selecteer een sjabloon" in a frame of ours, with the invoices per relation
// and an approximation of the e-mail beside the native form.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, framedPage } from './dom.mjs';

after(closeAll);

const ORIGIN = 'https://secure20.e-boekhouden.nl';
const FORM_URL = `${ORIGIN}/boekhouden/openposten/aanmaning?credDeb=D&datumTot=&soort=E&proefAanmaning=false&returnUrl=%2Fboekhouden%2Fopenposten&selected=2026-0371%7C11%2C2026-0398%7C11%2C2026-0390%7C12`;
const SCRIPTS = ['shared.js', 'store.js', 'icons.js', 'dialog.js', 'request.js', 'features/openposts.js', 'features/remind.js'];
const TEMPLATES = ['Herinnering', 'Herinnering 2', 'Aanmaning'];
const plain = (value) => JSON.parse(JSON.stringify(value));

const FORM = `<!doctype html><html><head></head><body>
<app-root><header id="shell">e-Boekhouden menu</header>
<app-notification-bar id="notes"></app-notification-bar>
<app-open-posten-aanmaning-form><div class="middle-top-container"><app-goback></app-goback></div>
<app-form><form><div class="form-header"><div class="form-header-left"><h1><span>Selecteer een sjabloon</span></h1></div></div>
<div class="form-body">
<div class="form-row"><div class="form-component"><app-form-label>Sjabloon</app-form-label><app-autocomplete><div class="form-control"><div id="sjabloon-AutocompleteInput"><input class="displayValue skipinitfocus form-input" id="sjabloon-AutocompletePickerInput" autocomplete="off"></div></div><input type="text" readonly tabindex="-1" class="unfocus"></app-autocomplete></div></div>
<div class="form-row"><div class="form-component"><app-form-label>Facturen als bijlage meesturen</app-form-label><app-checkbox><div class="form-control"><div><input type="checkbox" id="factuurAlsBijlage"><span></span></div></div></app-checkbox></div></div>
<div class="form-row"><div class="form-component"><app-form-label>Kopie sturen naar</app-form-label><app-text-input><div><input id="kopieSturenNaar"></div></app-text-input></div></div>
</div><div class="form-footer"><div class="hr"></div><div class="form-buttons"><div class="form-submit"><button type="submit" class="button form-submit" id="verder"><span apptranslate>Verder</span><span></span></button></div></div></div></form></app-form>
</app-open-posten-aanmaning-form></app-root></body></html>`;

const PAYLOAD = {
  soort: 'E', proef: false, skipped: 1,
  step: { index: 1, label: '2e herinnering' },
  template: { id: 2, name: 'Herinnering 2' },
  rows: [
    { factuur: '2026-0371', relatieId: 11, relation: 'Demo Klant B.V.', email: 'facturen@demo-klant.test', date: '12-08-2026', amount: 3448.5, paid: 0, open: 3448.5, days: 64 },
    { factuur: '2026-0398', relatieId: 11, relation: 'Demo Klant B.V.', email: 'facturen@demo-klant.test', date: '12-09-2026', amount: 3448.5, paid: 0, open: 3448.5, days: 33 },
    { factuur: '2026-0390', relatieId: 12, relation: 'Studio Noord', email: '', date: '01-09-2026', amount: 12.1, paid: 0, open: 12.1, days: 44 },
  ],
};

// e-Boekhouden's autocomplete and form, as far as the frame touches them.
function actLikeAngular(window) {
  const { document } = window;
  const input = document.getElementById('sjabloon-AutocompletePickerInput');
  input.value = TEMPLATES[0];
  const log = { verder: 0, submitted: 0 };
  input.addEventListener('mousedown', () => {
    const picker = document.createElement('div');
    picker.className = 'selector';
    picker.id = 'sjabloon-AutocompletePicker';
    picker.innerHTML = `<div class="scroll-container"><table class="container"><tbody>${TEMPLATES.map((name, i) => `<tr class="row v1" id="sjabloon-AutocompletePickerRow-${i}"><td class="col"> ${name} </td></tr>`).join('')}</tbody></table></div>`;
    picker.addEventListener('click', (event) => {
      const row = event.target.closest('.row');
      if (!row) return;
      // onItemClick: select, hide, and removeFocus() parks the focus on the
      // readonly field inside the form.
      input.value = row.textContent.trim();
      picker.remove();
      input.closest('app-autocomplete').querySelector('input.unfocus').focus();
    });
    input.closest('app-autocomplete').append(picker);
  });
  // Angular's (submit) on the <form>: submitForm() POSTs and sends the e-mails.
  document.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    log.submitted += 1;
  });
  document.getElementById('verder').addEventListener('click', () => {
    log.verder += 1;
    document.getElementById('verder').disabled = true;
  });
  return log;
}

async function framePage({ templates = true } = {}) {
  const p = await framedPage(FORM, {
    url: FORM_URL,
    parentUrl: `${ORIGIN}/boekhouden/openposten?soort=Debiteur&zoeken=true`,
    parentHtml: `<html><body><div class="ebs-dialog-backdrop"><div class="ebs-dialog ebs-rm-dialog"><div class="ebs-dialog-body"><iframe class="ebs-dialog-frame" src="${FORM_URL}"></iframe></div></div></div></body></html>`,
    store: { settings: { betterDesign: true } },
    answer: (message) => (message.type === 'requests:slot' ? { ok: true, lease: 'lease' } : {}),
  });
  const { window } = p;
  const calls = [];
  window.fetch = async (url) => {
    calls.push(String(url));
    const body = templates ? TEMPLATES.map((naam, i) => ({ id: i + 1, naam })) : [];
    return { status: 200, ok: true, redirected: false, headers: { get: () => null }, text: async () => JSON.stringify(body) };
  };
  const sent = [];
  window.parent.postMessage = (message, origin) => sent.push({ message: plain(message), origin });
  const log = actLikeAngular(window);
  p.load(...SCRIPTS);
  const tell = (data) => window.dispatchEvent(new window.MessageEvent('message', { data: { ebs: 'ebs-remind', ...data }, origin: ORIGIN, source: window.parent }));
  return { ...p, calls, sent, log, tell };
}

const text = (node) => node?.textContent.replace(/\s+/g, ' ').trim();

test('in our frame the page becomes the dialog: shell hidden, relations listed, the ladder\'s template picked', async () => {
  const p = await framePage();
  const { document } = p;
  assert.ok(document.documentElement.classList.contains('ebs-rm-frame'));
  assert.ok(document.getElementById('ebs-remind-frame-style').textContent.includes('html.ebs-rm-frame body { visibility: hidden; }'));
  assert.deepEqual(p.sent[0], { message: { ebs: 'ebs-remind', type: 'hello' }, origin: ORIGIN });

  // Data from anywhere but the parent is ignored.
  p.window.dispatchEvent(new p.window.MessageEvent('message', { data: { ebs: 'ebs-remind', type: 'payload', payload: PAYLOAD }, origin: ORIGIN, source: p.window }));
  await p.settle(2);
  assert.equal(document.querySelectorAll('.ebs-rm-relation').length, 0);

  p.tell({ type: 'payload', payload: PAYLOAD });
  await p.settle(4);
  assert.ok(p.sent.some((one) => one.message.type === 'ready'), 'ready once the native form and the payload are there');
  assert.equal(text(document.querySelector('.ebs-rm-list-title')), 'Facturen per relatie (1 van 2 met e-mailadres)');
  assert.equal(text(document.querySelector('.ebs-rm-skip')), '1 post zonder factuurnummer of relatie staat er niet bij.');
  const cards = [...document.querySelectorAll('.ebs-rm-relation')];
  assert.deepEqual(cards.map((card) => text(card.querySelector('.ebs-rm-relation-name'))), ['Demo Klant B.V.', 'Studio Noord']);
  assert.equal(cards[0].querySelectorAll('.ebs-rm-invoice').length, 2);
  assert.deepEqual([...cards[0].querySelector('.ebs-rm-invoice').children].map(text), ['2026-0371', '64 dagen te laat', '€ 3.448,50']);
  assert.ok(cards[1].classList.contains('missing'));
  assert.ok(!cards[1].querySelector('.ebs-rm-badge').classList.contains('ebs-rm-invisible'));
  assert.match(text(document.querySelector('.ebs-rm-foot-note')), /^Studio Noord heeft waarschijnlijk geen e-mailadres/);
  assert.ok(document.getElementById('verder').classList.contains('ebs-rm-send'), 'Verder is styled as the send button, not replaced');

  // The template of the ladder step, picked in the native autocomplete.
  assert.equal(document.getElementById('sjabloon-AutocompletePickerInput').value, 'Herinnering 2');
  assert.equal(document.getElementById('sjabloon-AutocompletePicker'), null);
  // One bulk request for e-Boekhouden's list of templates; no item without a click.
  assert.deepEqual(p.calls.map((url) => new URL(url).pathname), ['/v1/api/aanmaansjabloon/soort/E']);
  assert.equal(p.log.verder, 0, 'Verder is never clicked by the extension');
  assert.equal(p.log.submitted, 0, 'and the form is never submitted');
  assert.ok(!document.activeElement?.closest('form'), 'no focus left inside the form after the pick');
  p.close();
});

test('only a real click of the user on Verder can submit: no script click, requestSubmit or Enter in a field', async () => {
  const p = await framePage();
  const { document, window } = p;
  p.tell({ type: 'payload', payload: PAYLOAD });
  await p.settle(4);
  assert.equal(p.log.submitted, 0);
  const form = document.querySelector('app-open-posten-aanmaning-form form');
  const verder = document.getElementById('verder');

  // A click() of a script (jsdom's clicks are never trusted) still clicks
  // the button, but its submit does not reach e-Boekhouden.
  verder.click();
  assert.equal(p.log.verder, 1);
  assert.equal(p.log.submitted, 0, 'a script click on Verder sends nothing');
  verder.disabled = false;
  form.requestSubmit();
  form.requestSubmit(verder);
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(p.log.submitted, 0, 'requestSubmit and a made-up submit send nothing');

  // Enter in a field would submit the form (implicit submission): blocked.
  for (const field of [document.getElementById('kopieSturenNaar'), document.getElementById('factuurAlsBijlage'), document.querySelector('input.unfocus')]) {
    const enter = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    field.dispatchEvent(enter);
    assert.equal(enter.defaultPrevented, true, `Enter in ${field.id || field.className} does not submit`);
  }
  // The template field keeps its own Enter (it picks the highlighted template).
  const pick = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  document.getElementById('sjabloon-AutocompletePickerInput').dispatchEvent(pick);
  assert.equal(pick.defaultPrevented, false);
  // Enter or Space on Verder itself is the user's click on it: not blocked here.
  const onButton = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  verder.dispatchEvent(onButton);
  assert.equal(onButton.defaultPrevented, false);
  // Outside e-Boekhouden's form nothing is touched.
  const ours = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  document.querySelector('.ebs-rm-cancel').dispatchEvent(ours);
  assert.equal(ours.defaultPrevented, false);
  p.close();
});

test('the posts the form cannot take are named before sending', async () => {
  const p = await framePage();
  const { document } = p;
  p.tell({ type: 'payload', payload: { ...PAYLOAD, skipped: 7, skippedRows: [
    { factuur: '', relation: 'Atelier Zuid' }, { factuur: '2026-0001', relation: '' }, { factuur: 'A', relation: 'B' },
    { factuur: 'C', relation: 'D' }, { factuur: 'E', relation: 'F' }, { factuur: 'G', relation: 'H' },
  ] } });
  await p.settle(4);
  assert.equal(text(document.querySelector('.ebs-rm-skip')), '7 posten zonder factuurnummer of relatie staan er niet bij: zonder nummer (Atelier Zuid), 2026-0001, A (B), C (D), E (F) en 2 meer.');
  p.close();
});

test('the preview: the template text with the known codes filled in, nothing else of it', async () => {
  const p = await framePage();
  const { document, window } = p;
  p.tell({ type: 'payload', payload: PAYLOAD });
  await p.settle(4);
  assert.equal(text(document.querySelector('.ebs-rm-preview-name')), 'Voorbeeld voor Demo Klant B.V.');
  assert.equal(text(document.querySelector('.ebs-rm-preview-index')), '1 van 2');
  assert.match(text(document.querySelector('.ebs-rm-text-wait')), /nog niet geladen.*Tekst laden/);
  assert.equal(p.calls.filter((url) => url.includes('/view/')).length, 0, 'no text without a click of the user');

  p.tell({ type: 'template', id: 2, subject: 'Tweede herinnering', html: '<p onclick="x()">Beste [AANHEF],</p><p>Factuur [FACTNUMMER] van [FACTDATUM]: € [OPENSTAAND].</p><script>bad()</script><a href="https://evil.test">klik</a><img src="x">' });
  document.getElementById('kopieSturenNaar').value = 'administratie@demo-holding.test';
  document.getElementById('kopieSturenNaar').dispatchEvent(new window.Event('input', { bubbles: true }));
  document.getElementById('factuurAlsBijlage').checked = true;
  document.getElementById('factuurAlsBijlage').dispatchEvent(new window.Event('change', { bubbles: true }));
  await p.settle(3);
  const head = document.querySelector('.ebs-rm-mail-head');
  assert.equal(text(head.children[0]), 'Aan: facturen@demo-klant.test · Kopie: administratie@demo-holding.test');
  assert.equal(text(head.querySelector('.ebs-rm-mail-subject')), 'Tweede herinnering');
  assert.equal(text(head.children[2]), 'Bijlagen: Factuur 2026-0371.pdf, Factuur 2026-0398.pdf');
  const body = document.querySelector('.ebs-rm-mail-body');
  assert.equal(body.querySelector('script, a, img, [onclick]'), null, 'no scripts, links, images or attributes');
  assert.deepEqual([...body.querySelectorAll('.ebs-rm-code')].map(text), ['[AANHEF]', '[FACTNUMMER]', '[FACTDATUM]', '[OPENSTAAND]'], 'two invoices: the per-invoice codes stay codes');
  assert.ok(body.querySelector('.ebs-rm-table'), 'with the invoices beside it');
  assert.match(text(document.querySelector('.ebs-rm-approx')), /^Een benadering, geen echte e-mail/);

  // Studio Noord: one invoice, so its codes are filled in; no address: a warning.
  document.querySelectorAll('.ebs-rm-relation')[1].click();
  await p.settle(3);
  assert.match(text(document.querySelector('.ebs-rm-missing')), /^Studio Noord heeft geen e-mailadres bij de relatie/);
  assert.deepEqual([...document.querySelectorAll('.ebs-rm-mail-body .ebs-rm-filled')].map(text), ['2026-0390', '01-09-2026', '12,10']);
  assert.equal(text(document.querySelector('.ebs-rm-preview-index')), '2 van 2');
  assert.equal(p.log.verder, 0);
  p.close();
});

test('sending is e-Boekhouden\'s Verder: busy until its answer, then its own words', async () => {
  const p = await framePage();
  const { document } = p;
  p.tell({ type: 'payload', payload: PAYLOAD });
  await p.settle(4);
  const result = document.querySelector('.ebs-rm-result');
  assert.ok(!result.classList.contains('shown'));

  // The user clicks Verder; e-Boekhouden disables it while it sends. (A
  // jsdom click is not trusted, so the guard keeps its submit from the form:
  // the send itself is in the headless run; this is what the view does.)
  document.getElementById('verder').click();
  await p.settle(2);
  assert.ok(result.classList.contains('shown'));
  assert.equal(text(result.querySelector('.ebs-rm-result-title')), 'e-Boekhouden verstuurt de e-mails');
  const wait = result.querySelector('.ebs-rm-result-button');
  assert.equal(text(wait), 'Bezig…');
  assert.equal(wait.disabled, true);
  assert.equal(wait.getAttribute('aria-busy'), 'true');

  // e-Boekhouden's answer replaces its form with an info box.
  const host = document.querySelector('app-open-posten-aanmaning-form');
  host.querySelector(':scope > app-form').remove();
  host.insertAdjacentHTML('beforeend', '<app-info-box><app-form><form><h1><span>Aanmaningen zijn verzonden</span></h1><div><p>Er zijn 2 aanmaningen verstuurd. Er is 1 aanmaning niet verstuurd omdat er bij de betreffende relatie geen emailadres bekend is.</p></div></form></app-form></app-info-box>');
  await p.settle(3);
  assert.equal(text(result.querySelector('.ebs-rm-result-title')), 'Aanmaningen zijn verzonden');
  assert.equal(text(result.querySelector('.ebs-rm-result-text')), 'Er zijn 2 aanmaningen verstuurd. Er is 1 aanmaning niet verstuurd omdat er bij de betreffende relatie geen emailadres bekend is.');
  assert.ok(result.querySelector('.ebs-rm-result-icon').classList.contains('warn'), 'partly sent');
  const back = result.querySelector('.ebs-rm-result-button');
  assert.equal(text(back), 'Terug naar het overzicht');
  assert.equal(back.disabled, false);
  back.click();
  assert.deepEqual(p.sent.at(-1).message, { ebs: 'ebs-remind', type: 'close', reason: 'sent' });
  assert.equal(p.log.verder, 1, 'only the user\'s own click');
  assert.deepEqual(p.sent.filter((one) => one.message.type === 'stage').map((one) => one.message.stage), ['sending', 'done'], 'the parent hears of the send, to reload the list after it');
  p.close();
});

test('an error of e-Boekhouden after Verder shows in its own words, and the form is back', async () => {
  const p = await framePage();
  const { document } = p;
  p.tell({ type: 'payload', payload: PAYLOAD });
  await p.settle(4);
  document.getElementById('verder').click();
  await p.settle(2);
  document.getElementById('notes').innerHTML = '<div class="notification-bar error"><div class="notification-message error">Uw smtp-server rapporteert een fout.</div></div>';
  document.getElementById('verder').disabled = false;
  await p.settle(3);
  assert.ok(!document.querySelector('.ebs-rm-result').classList.contains('shown'));
  assert.equal(text(document.querySelector('.ebs-rm-foot-error')), 'Uw smtp-server rapporteert een fout.');
  document.querySelector('.ebs-rm-cancel').click();
  assert.deepEqual(p.sent.at(-1).message, { ebs: 'ebs-remind', type: 'close', reason: 'cancel' });
  p.close();
});

test('e-Boekhouden refusing the page (no permission) is a result of its own, not a form', async () => {
  const p = await framePage();
  const { document } = p;
  document.querySelector('app-open-posten-aanmaning-form > app-form').remove();
  document.querySelector('app-open-posten-aanmaning-form').insertAdjacentHTML('beforeend', '<app-info-box><div class="middle-top-container"><div class="info"><p>U heeft geen rechten om deze pagina te bekijken.</p></div></div></app-info-box>');
  p.tell({ type: 'payload', payload: PAYLOAD });
  await p.settle(4);
  const result = document.querySelector('.ebs-rm-result');
  assert.ok(result.classList.contains('shown'));
  assert.equal(text(result.querySelector('.ebs-rm-result-text')), 'U heeft geen rechten om deze pagina te bekijken.');
  assert.equal(text(result.querySelector('.ebs-rm-result-button')), 'Sluiten');
  assert.ok(p.sent.some((one) => one.message.type === 'ready'), 'the cover lifts to show it');
  p.close();
});

test('outside our dialog the form page is left alone', async () => {
  const p = await framedPage(FORM, {
    url: FORM_URL,
    parentUrl: `${ORIGIN}/boekhouden/openposten`,
    store: { settings: { betterDesign: true } },
  });
  p.load(...SCRIPTS);
  await p.settle(2);
  assert.ok(!p.document.documentElement.classList.contains('ebs-rm-frame'));
  assert.equal(p.document.querySelector('.ebs-rm'), null);
  assert.equal(p.document.getElementById('ebs-remind-frame-style'), null);
  p.close();
});
