// The template screens (features/templates.js) in jsdom, with e-Boekhouden's
// markup of app-email-sjabloon-form, app-factuur-sjabloon-form and
// app-factuur-sjabloon-regel-form as its Angular templates render it.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, framedPage, page } from './dom.mjs';

after(closeAll);

const ORIGIN = 'https://secure20.e-boekhouden.nl';
// Values from the page's realm, as plain data for deepEqual.
const plain = (value) => JSON.parse(JSON.stringify(value));
const SCRIPTS = ['main-world.js', 'shared.js', 'store.js', 'icons.js', 'dialog.js', 'bridge.js', 'request.js', 'features/templates.js'];

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

const textRow = (id, label, value = '') => `<div class="form-row"><div class="form-component"><app-form-label><label for="${id}">${label}</label></app-form-label><app-text-input><div class="form-control"><input id="${id}" class="displayValue form-input" value="${value}"></div></app-text-input></div></div>`;

const goback = '<div class="middle-top-container"><app-goback><div class="go-back-container"><a title="Terug" class="plain-btn eb-icon" id="goback" href="/beheer/sjabloon/email"><span class="eb-icon-left-open"></span></a></div></app-goback></div>';

function emailHtml({ name = 'Factuur', subject = 'Factuur [FACTNUMMER] van [ABBEDRIJF]', uses = [2] } = {}) {
  const use = [[1, 'Versturen van offertes'], [2, 'Versturen van facturen'], [3, 'Versturen van nieuwsbrieven']].map(([value, label]) => `<tr class="checkbox-row"><td class="checkbox-option"><div class="form-check"><input type="checkbox" id="use_${value}" name="use" value="${value}"${uses.includes(value) ? ' checked' : ''}><span></span></div><label for="use_${value}">${label}</label></td></tr>`).join('');
  return `<!doctype html><html><head></head><body><div id="shell"><router-outlet></router-outlet><app-email-sjabloon-form><div>
${goback}
<app-form><form class="form"><div class="form-header"><div class="form-header-left"><h1><span>E-mailsjabloon wijzigen</span></h1></div></div>
<div class="form-body">
${textRow('naam', 'Sjabloon naam', name)}${textRow('vanNaam', 'Van naam')}${textRow('vanEmail', 'Van e-mail')}${textRow('cc', 'CC')}${textRow('bcc', 'BCC')}${textRow('subject', 'Onderwerp', subject)}
<div class="form-row"><div class="form-component"><app-form-label><label>Bericht</label></app-form-label><app-wysiwyg-input><div class="form-control"><ckeditor id="body"><div id="cke_editor1" class="cke"><div class="cke_inner"><span class="cke_top"></span><div class="cke_contents"><iframe class="cke_wysiwyg_frame"></iframe></div></div></div></ckeditor></div></app-wysiwyg-input></div></div>
<div class="form-row"><div class="form-component"><app-form-label><label>Te gebruiken bij</label></app-form-label><app-checkboxlist><div class="form-control"><table><tbody>${use}</tbody></table></div></app-checkboxlist></div></div>
</div>
<div class="form-footer"><div class="hr"></div><div class="form-buttons"><div class="form-submit"><button type="submit" class="button form-submit"><span>Opslaan</span><span></span></button></div></div></div>
</form></app-form>
<div class="middle-bottom-container"><a href="https://cdn.e-boekhouden.nl/handleiding/Handleiding_e-mailsjabloon.pdf">Handleiding</a></div>
</div></app-email-sjabloon-form></div></body></html>`;
}

const BODY = '<p>[RELAANHEF],</p><p>Hierbij ontvangt u factuur [FACTNUMMER] voor een bedrag van [TOTAAL].</p><p>Met vriendelijke groet,<br>[ABBEDRIJF]</p>';

// A user gesture as the browser reports it (jsdom has no userActivation),
// a fetch that counts, and the request budget answering at once.
function withPage(html, url, { store = {}, invoices = 3, mail = null } = {}) {
  const p = page(html, {
    url,
    store: { settings: { betterDesign: true }, ...store },
    answer: (message) => (message.type === 'requests:slot' ? { ok: true, lease: 'test' } : {}),
  });
  const gesture = { active: false };
  Object.defineProperty(p.window.navigator, 'userActivation', { configurable: true, value: { get isActive() { return gesture.active; }, get hasBeenActive() { return gesture.active; } } });
  const fetched = [];
  p.window.fetch = async (input) => {
    const href = String(input);
    fetched.push(href);
    let body = {};
    if (href.includes('gridtable')) {
      body = { data: Array.from({ length: invoices }, (_, i) => ({ id: 100 + i, nummer: `2026-${String(400 + i).padStart(4, '0')}`, relatie: `Demo Klant ${i} B.V.`, datum: '2026-10-12T00:00:00', uitersteBetaaldatum: '2026-10-26T00:00:00', bedragIncl: 3448.5, bedragExcl: 2850, kenmerk: '' })) };
    } else if (href.includes('maildata')) {
      body = mail ?? {};
    } else if (/factuur\/\d+$/.test(href)) {
      body = { id: 100, regels: [{ aantal: 1, omschrijving: 'Management fee oktober', prijsPerEenheid: 2850, btwPercentage: '21%', totaal: 2850 }] };
    }
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  // jsdom cannot make a trusted event: the user-action listeners of
  // request.js (window, capture) are kept, so a test click can be one.
  const userListeners = [];
  const add = p.window.addEventListener.bind(p.window);
  p.window.addEventListener = (type, listener, options) => {
    if ((type === 'click' || type === 'keydown') && (options === true || options?.capture)) userListeners.push(listener);
    return add(type, listener, options);
  };
  p.load(...SCRIPTS);
  p.window.addEventListener = add;
  return { ...p, gesture, fetched, userListeners, slots: () => p.sent.filter((message) => message.type === 'requests:slot').length };
}

// A click of the user: a trusted click for request.js and an active user
// gesture for the bridge, around the element's own click.
function userClick(p, node) {
  for (const listener of p.userListeners) {
    try {
      listener({ type: 'click', isTrusted: true, target: node });
    } catch { /* a listener that wants a real event */ }
  }
  p.gesture.active = true;
  node.click();
  p.gesture.active = false;
}

async function emailPage(options = {}) {
  const p = withPage(emailHtml(options), `${ORIGIN}/beheer/sjabloon/email/7`, options);
  const frame = p.document.querySelector('iframe.cke_wysiwyg_frame');
  frame.contentDocument.body.innerHTML = options.body ?? BODY;
  const inserted = [];
  p.window.CKEDITOR = {
    instances: {
      editor1: {
        readOnly: false,
        getData: () => frame.contentDocument.body.innerHTML,
        insertHtml(html) {
          inserted.push(html);
          const doc = frame.contentDocument;
          const selection = doc.getSelection();
          if (selection.rangeCount) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(doc.createTextNode(html));
          } else {
            doc.body.lastChild.append(html);
          }
        },
      },
    },
  };
  await p.settle();
  return { ...p, frame, inserted };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('the variable lists are e-Boekhouden\'s own: 31 for invoice mails, 15 for newsletters, 66 for invoice templates', async () => {
  const p = page('<!doctype html><html><head></head><body></body></html>', { url: `${ORIGIN}/boekhouden/facturen` });
  p.load('shared.js', 'icons.js', 'features/templates.js');
  const T = p.window.EBS.templates;
  assert.equal(T.variablesOf('mail').length, 31);
  assert.equal(T.variablesOf('nieuwsbrief').length, 15);
  assert.equal(T.variablesOf('factuur').length, 66, '[KVK] is listed twice by e-Boekhouden, once here');
  assert.deepEqual([...T.variablesOf('factuur').find((one) => one.name === 'TELEFOON').aliases], ['RELTELEFOONNUMMER']);
  assert.ok(T.variablesOf('mail').every((one) => /^\[[A-Z0-9_]+\]$/.test(one.code)));
  assert.deepEqual([...T.grouped(T.variablesOf('mail')).map((group) => group.title)], ['Factuur', 'Relatie', 'Uw bedrijf']);
  assert.equal(T.variablesFor(['mail', 'nieuwsbrief']).length, 31, 'the newsletter codes are all in the mail list');
  p.close();
});

test('checks: unknown and misspelled codes, missing important ones, plain text in brackets left alone', async () => {
  const p = page('<!doctype html><html><head></head><body></body></html>', { url: `${ORIGIN}/boekhouden/facturen` });
  p.load('shared.js', 'icons.js', 'features/templates.js');
  const T = p.window.EBS.templates;
  const bad = T.checkTemplate(['mail'], ['Factuur [FACTNUMMER]', 'Hallo, bedrag [TOTAAL]. Uw referentie: [FACTNUMER] [zie bijlage] [NUMMER] [XYZ]']);
  assert.deepEqual(plain(bad.unknown.map((one) => [one.code, one.suggestion])), [['[FACTNUMER]', '[FACTNUMMER]'], ['[NUMMER]', '[FACTNUMMER]'], ['[XYZ]', null]]);
  assert.deepEqual(plain(bad.missing.map((one) => one.code)), ['[RELAANHEF]']);
  const lines = T.checkMessages(bad, ['mail']).map((line) => line.text);
  assert.equal(lines[0], '[FACTNUMER] staat niet in de lijst van e-Boekhouden. Bedoel je [FACTNUMMER]?');
  assert.ok(lines.includes('De aanhef ontbreekt: e-mails bij een factuur beginnen meestal met [RELAANHEF].'));
  const good = T.checkTemplate(['mail'], ['Factuur [FACTNUMMER]', '[RELAANHEF], u betaalt [TOTAAL].']);
  assert.equal(good.ok, true);
  assert.deepEqual([...T.checkMessages(good, ['mail'])].map((line) => line.text), ['Alle variabelen bestaan. Het factuurnummer en het bedrag staan erin.']);
  const invoice = T.checkTemplate(['factuur'], ['Gelieve te betalen binnen [TERMIJN] dagen onder vermelding van [FACTNR].']);
  assert.deepEqual(plain(invoice.unknown.map((one) => [one.code, one.suggestion])), [['[FACTNR]', '[NUMMER]']]);
  assert.equal(invoice.missing.length, 0);
  assert.deepEqual([...T.suggestionsFor('RELP', T.variablesOf('mail'))].map((one) => one.code).slice(0, 4), ['[RELPOSTCODE]', '[RELPLAATS]', '[RELPOSTCODE2]', '[RELPLAATS2]']);
  p.close();
});

test('values of an invoice are read from e-Boekhouden\'s filled-in copy of the saved text', async () => {
  const p = page('<!doctype html><html><head></head><body></body></html>', { url: `${ORIGIN}/boekhouden/facturen` });
  p.load('shared.js', 'icons.js', 'features/templates.js');
  const T = p.window.EBS.templates;
  const values = T.alignValues('[RELAANHEF], factuur [FACTNUMMER] van [FACTDATUM] voor [TOTAAL]. Groet, [ABBEDRIJF][ABEMAIL]', 'Geachte heer Jansen, factuur 2026-0412 van 12-10-2026 voor € 3.448,50. Groet, Demo Holding B.V.info@demo.test');
  assert.equal(values.RELAANHEF, 'Geachte heer Jansen');
  assert.equal(values.FACTNUMMER, '2026-0412');
  assert.equal(values.TOTAAL, '€ 3.448,50');
  assert.equal(values.ABBEDRIJF, undefined, 'two codes without text between them are ambiguous');
  assert.deepEqual({ ...T.alignValues('[A] x', 'iets anders') }, {}, 'a text that does not match gives nothing');
  const invoice = T.invoiceFromRow({ id: 9, nummer: '2026-0412', relatie: 'Demo Klant B.V.', datum: '2026-10-12T00:00:00', bedragIncl: 3448.5 });
  assert.equal(invoice.date, '12-10-2026');
  assert.equal(T.valuesFromInvoice(invoice).TOTAAL, '€ 3.448,50');
  assert.equal(T.invoiceFromRow({ nummer: 'x' }), null, 'no id, no invoice');
  p.close();
});

test('widths, steps and the cleaned preview', async () => {
  const p = page('<!doctype html><html><head></head><body></body></html>', { url: `${ORIGIN}/boekhouden/facturen` });
  p.load('shared.js', 'icons.js', 'features/templates.js');
  const T = p.window.EBS.templates;
  assert.deepEqual({ ...T.widthSummary([{ id: 'OMSCHRIJVING', width: '*' }, { id: 'AANTAL', width: '10' }, { id: 'PPE', width: '15' }, { id: 'BTWPERC', width: '12' }, { id: 'REGELTOTAAL', width: '15' }]) }, { fixed: 52, rest: 48, over: false, text: '52% vast · Omschrijving 48%' });
  assert.equal(T.widthSummary([{ id: 'PPE', width: '45' }, { id: 'BTWPERC', width: '40' }, { id: 'AANTAL', width: '10' }, { id: 'REGELTOTAAL', width: '15' }]).over, true);
  assert.deepEqual(JSON.parse(JSON.stringify(T.moveSteps(3, 1))), [{ index: 3, dir: 'up' }, { index: 2, dir: 'up' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(T.moveSteps(0, 2))), [{ index: 0, dir: 'down' }, { index: 1, dir: 'down' }]);
  const box = p.document.createElement('div');
  box.append(T.sanitize('<p onclick="x()">Hoi <script>alert(1)</script><img src="https://x.test/a.png" onerror="y()"><a href="javascript:z()">link</a> [FACT<b>NUMMER</b>]</p>'));
  assert.equal(box.querySelector('script'), null);
  assert.equal(box.querySelector('img'), null);
  assert.equal(box.querySelector('[onclick], [onerror]'), null);
  assert.equal(box.querySelector('a').hasAttribute('href'), false, 'no javascript: link');
  T.fillCodes(box, { values: { FACTNUMMER: '2026-0412' }, known: T.variablesOf('mail'), missingTitle: '' });
  assert.match(box.textContent, /2026-0412/, 'a code split over two elements is still filled in');
  p.close();
});

// ---------------------------------------------------------------------------
// E-mail template
// ---------------------------------------------------------------------------

test('e-mail: the view goes around e-Boekhouden\'s own form, without a request', async () => {
  const p = await emailPage();
  const { document } = p;
  const root = document.querySelector('app-email-sjabloon-form > div');
  assert.ok(root.classList.contains('ebs-tpl-email'));
  assert.equal(document.querySelector('.ebs-tpl-h1').textContent, 'E-mailsjabloon: Factuur');
  assert.ok(document.querySelector('#naam').closest('app-form'), 'the native fields stay where Angular put them');
  assert.ok(document.querySelector('.ebs-tpl-preview .ebs-tpl-badge.request').textContent.startsWith('Eigen verzoek'));
  const preview = document.querySelector('.ebs-tpl-mail-body').textContent;
  assert.match(preview, /Geachte heer De Vries,/);
  assert.match(preview, /factuur VB-0001 voor een bedrag van € 242,00/);
  assert.equal(document.querySelector('.ebs-tpl-mail-subject').textContent, 'Factuur VB-0001 van Demo Holding B.V.');
  assert.match(document.querySelector('.ebs-tpl-vars .ebs-tpl-muted').textContent, /\(31 codes\)/);
  assert.deepEqual([...document.querySelectorAll('.ebs-tpl-check')].map((node) => node.textContent), ['Alle variabelen bestaan. Het factuurnummer en het bedrag staan erin.']);
  const used = [...document.querySelectorAll('.ebs-tpl-var')].filter((node) => node.querySelector('.ebs-tpl-var-badge.used')).map((node) => node.querySelector('.ebs-tpl-var-code').textContent);
  assert.deepEqual(used.sort(), ['[ABBEDRIJF]', '[FACTNUMMER]', '[RELAANHEF]', '[TOTAAL]']);
  assert.equal(p.slots(), 0, 'no request on load');
  assert.deepEqual(p.fetched, []);
  p.close();
});

test('e-mail: an unknown code warns under the editor and in the preview; the title follows the name', async () => {
  const p = await emailPage({ body: '<p>Hallo,</p><p>Uw referentie: [FACTNUMER]</p>' });
  const { document, window } = p;
  const checks = [...document.querySelectorAll('.ebs-tpl-check.warn')].map((node) => node.textContent);
  assert.ok(checks.includes('[FACTNUMER] staat niet in de lijst van e-Boekhouden. Bedoel je [FACTNUMMER]?'));
  assert.ok(checks.includes('De aanhef ontbreekt: e-mails bij een factuur beginnen meestal met [RELAANHEF].'));
  assert.equal(document.querySelector('.ebs-tpl-mail-body .ebs-tpl-unknown').textContent, '[FACTNUMER]');
  const missing = [...document.querySelectorAll('.ebs-tpl-var')].filter((node) => node.querySelector('.ebs-tpl-var-badge.missing')).map((node) => node.querySelector('.ebs-tpl-var-code').textContent);
  assert.deepEqual(missing.sort(), ['[RELAANHEF]', '[TOTAAL]'], 'the subject has [FACTNUMMER]; the text misses the amount and the greeting');
  const name = document.querySelector('#naam');
  name.value = 'Herinnering';
  name.dispatchEvent(new window.Event('input', { bubbles: true }));
  await p.settle();
  assert.equal(document.querySelector('.ebs-tpl-h1').textContent, 'E-mailsjabloon: Herinnering');
  p.close();
});

test('e-mail: the list follows Te gebruiken bij (newsletter codes, the quote assumption)', async () => {
  const p = await emailPage({ uses: [3] });
  const { document, window } = p;
  assert.match(document.querySelector('.ebs-tpl-vars .ebs-tpl-muted').textContent, /^Voor nieuwsbrieven.*\(15 codes\)/);
  assert.ok([...document.querySelectorAll('.ebs-tpl-check.warn')].some((node) => node.textContent.startsWith('[FACTNUMMER] staat niet in de lijst')), 'invoice codes do not belong in a newsletter');
  const offerte = document.querySelector('#use_1');
  offerte.checked = true;
  offerte.dispatchEvent(new window.Event('change', { bubbles: true }));
  await p.settle();
  assert.ok(document.querySelector('.ebs-tpl-vars .ebs-tpl-badge.assume').textContent.startsWith('Aanname: voor offertes'));
  p.close();
});

test('e-mail: a variable click inserts through the page bridge during the click, and only then', async () => {
  const p = await emailPage();
  const { document } = p;
  const item = [...document.querySelectorAll('.ebs-tpl-var')].find((node) => node.querySelector('.ebs-tpl-var-code').textContent === '[VERVALDATUM]');
  item.click();
  await p.settle();
  assert.deepEqual(p.inserted, [], 'without a user gesture the bridge refuses');
  userClick(p, item);
  await p.settle();
  assert.deepEqual(p.inserted, ['[VERVALDATUM]']);
  assert.match(p.frame.contentDocument.body.textContent, /\[VERVALDATUM\]/);
  assert.match(document.querySelector('.ebs-tpl-mail-body').textContent, /26-10-2026/, 'the preview follows');
  p.close();
});

test('e-mail: typing [ in the editor suggests codes; Enter replaces what was typed', async () => {
  const p = await emailPage({ body: '<p>Postcode: [RELP</p>' });
  const { document, frame } = p;
  const doc = frame.contentDocument;
  const text = doc.body.querySelector('p').firstChild;
  const range = doc.createRange();
  range.setStart(text, text.data.length);
  range.collapse(true);
  doc.getSelection().removeAllRanges();
  doc.getSelection().addRange(range);
  frame.contentWindow.dispatchEvent(new frame.contentWindow.KeyboardEvent('keyup', { key: 'P', bubbles: true }));
  const pop = document.querySelector('.ebs-tpl-pop.floating');
  assert.equal(pop.hidden, false);
  assert.deepEqual([...pop.querySelectorAll('.ebs-tpl-option-main')].map((node) => node.textContent).slice(0, 2), ['[RELPOSTCODE]', '[RELPLAATS]']);
  assert.equal(pop.querySelector('[aria-selected="true"] .ebs-tpl-option-sub').textContent, 'De postcode van uw relatie');
  assert.ok(pop.classList.contains('ebs-tpl-pop-in'), 'it fades in');
  const enter = new frame.contentWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  let reachedEditor = false;
  doc.body.addEventListener('keydown', () => { reachedEditor = true; });
  p.gesture.active = true;
  doc.body.dispatchEvent(enter);
  p.gesture.active = false;
  await p.settle();
  assert.equal(enter.defaultPrevented, true);
  assert.equal(reachedEditor, false, 'CKEditor never sees the Enter: no new paragraph');
  assert.deepEqual(p.inserted, ['[RELPOSTCODE]']);
  assert.equal(doc.body.textContent, 'Postcode: [RELPOSTCODE]');
  assert.equal(pop.hidden, true);
  p.close();
});

test('e-mail: [ in the subject suggests too, and Escape closes the list', async () => {
  const p = await emailPage();
  const { document, window } = p;
  const subject = document.querySelector('#subject');
  subject.value = 'Factuur [FACTN';
  subject.setSelectionRange(subject.value.length, subject.value.length);
  subject.dispatchEvent(new window.Event('input', { bubbles: true }));
  const pop = document.querySelector('.ebs-tpl-pop.floating');
  assert.equal(pop.hidden, false);
  assert.equal(subject.getAttribute('aria-controls'), pop.id);
  subject.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(subject.value, 'Factuur [FACTNUMMER]');
  subject.value += ' [AB';
  subject.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(pop.hidden, false);
  subject.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(pop.hidden, true);
  p.close();
});

test('e-mail: Opslaan clicks e-Boekhouden\'s own button and waits for its answer', async () => {
  const p = await emailPage();
  const { document, window } = p;
  const native = document.querySelector('button.form-submit');
  let submitted = 0;
  document.querySelector('form.form').addEventListener('submit', (event) => {
    event.preventDefault();
    submitted += 1;
    native.disabled = true;
  });
  const save = document.querySelector('.ebs-tpl-head .ebs-tpl-button.primary');
  save.click();
  await p.settle();
  assert.equal(submitted, 1);
  assert.equal(save.textContent, 'Bezig…');
  assert.equal(save.disabled, true);
  assert.equal(save.getAttribute('aria-busy'), 'true');
  native.disabled = false;
  await new Promise((resolve) => setTimeout(resolve, 450));
  await p.settle();
  assert.equal(save.textContent, 'Opslaan', 'e-Boekhouden answered (an error): the button is back');
  assert.equal(save.disabled, false);
  window.close();
});

test('e-mail: the picker loads the invoice list once on its click, and one invoice per pick (1000 invoices: still two requests)', async () => {
  const p = await emailPage({
    invoices: 1000,
    mail: { subject: 'Factuur 2026-1399 van Demo Holding B.V.', body: '<p>Geachte heer Jansen,</p><p>Hierbij ontvangt u factuur 2026-1399 voor een bedrag van € 3.448,50.</p><p>Met vriendelijke groet,<br>Demo Holding B.V.</p>' },
  });
  const { document } = p;
  const toggle = document.querySelector('.ebs-tpl-picker-button');
  userClick(p, toggle);
  await p.settle();
  const options = document.querySelectorAll('.ebs-tpl-picker-panel .ebs-tpl-option');
  assert.equal(options.length, 1001, 'Voorbeeldgegevens and every invoice of the list');
  assert.equal(p.slots(), 1, 'one bulk request for the list');
  // Closing and opening again: the list is there, no new request.
  userClick(p, toggle);
  userClick(p, toggle);
  await p.settle();
  assert.equal(p.slots(), 1);
  // The newest first: on one date, the highest id.
  const first = document.querySelectorAll('.ebs-tpl-picker-panel .ebs-tpl-option')[1];
  userClick(p, first);
  await p.settle();
  assert.equal(p.slots(), 2, 'one item request for the picked invoice');
  assert.ok(p.fetched[1].endsWith('/v1/api/factuur/maildata/7/1099'), p.fetched[1]);
  const body = document.querySelector('.ebs-tpl-mail-body').textContent;
  assert.match(body, /Geachte heer Jansen,/, 'from e-Boekhouden\'s own filled-in copy');
  assert.match(body, /factuur 2026-1399/);
  assert.equal(document.querySelector('.ebs-tpl-picker-text').textContent, 'Factuur 2026-1399 · Demo Klant 999 B.V.');
  assert.equal(p.fetched.length, 2);
  p.close();
});

test('e-mail: a list that fails to load says so in the picker, and the preview keeps the sample data', async () => {
  const p = await emailPage();
  p.window.fetch = async (input) => {
    p.fetched.push(String(input));
    return new Response('nee', { status: 500 });
  };
  userClick(p, p.document.querySelector('.ebs-tpl-picker-button'));
  await p.settle();
  assert.equal(p.document.querySelector('.ebs-tpl-picker-note').textContent, 'De facturen konden niet worden geladen. Probeer het later opnieuw.');
  assert.equal(p.document.querySelectorAll('.ebs-tpl-picker-panel .ebs-tpl-option').length, 1);
  assert.match(p.document.querySelector('.ebs-tpl-mail-body').textContent, /VB-0001/);
  assert.equal(p.slots(), 1, 'one try, no retry on its own');
  p.close();
});

test('e-mail: Klassieke weergave gives e-Boekhouden\'s page back, with Nieuwe weergave at the same spot', async () => {
  const p = await emailPage();
  const { document } = p;
  document.querySelector('.ebs-tpl-head .ebs-tpl-link').click();
  await p.settle();
  assert.equal(p.store.classicScreens['templates-email'], true);
  assert.equal(document.querySelector('.ebs-tpl-head'), null);
  assert.equal(document.querySelector('.ebs-tpl-email'), null);
  const back = document.querySelector('.ebs-tpl-native-toggle a');
  assert.equal(back.textContent, 'Nieuwe weergave');
  assert.equal(back.parentElement.nextElementSibling.tagName, 'APP-FORM');
  back.click();
  await p.settle();
  assert.equal(p.store.classicScreens['templates-email'], false);
  assert.ok(document.querySelector('.ebs-tpl-email'));
  p.close();
});

test('e-mail: with Better design off nothing changes', async () => {
  const p = page(emailHtml(), { url: `${ORIGIN}/beheer/sjabloon/email/7`, store: { settings: { betterDesign: false } } });
  const before = p.document.body.innerHTML;
  p.load(...SCRIPTS);
  await p.settle();
  assert.equal(p.document.body.innerHTML, before);
  assert.equal(p.document.getElementById('ebs-templates-style'), null);
  p.close();
});

// ---------------------------------------------------------------------------
// Invoice template
// ---------------------------------------------------------------------------

function invoiceHtml({ type = 'E' } = {}) {
  return `<!doctype html><html><head></head><body><router-outlet></router-outlet><app-factuur-sjabloon-form><div>
${goback.replace('/beheer/sjabloon/email', '/beheer/sjabloon/factuur')}
<div><app-form><form class="form"><div class="form-header"><div class="form-header-left"><h1><span>Factuursjabloon wijzigen</span></h1></div></div>
<div class="form-body">
${textRow('naam', 'Naam', 'Standaard')}
<div class="form-row"><div class="form-component"><app-form-label><label for="type">Type</label></app-form-label><app-selectlist><div class="form-control"><select id="type" name="type" class="form-input"><option value="E"${type === 'E' ? ' selected' : ''}>Eenvoudig</option><option value="A"${type === 'A' ? ' selected' : ''}>Geavanceerd</option></select></div></app-selectlist></div></div>
<div class="form-row"><div class="form-component"><div class="p-relative d-inline-block"><app-form-label><label for="taal">Taal</label></app-form-label><app-selectlist><div class="form-control"><select id="taal" name="taal" class="form-input"><option value="NL" selected>Nederlands</option><option value="EN">Engels</option></select></div></app-selectlist></div></div></div>
</div>
<div class="form-footer"><div class="hr"></div><div class="form-buttons"><div class="form-submit"><button type="submit" class="button form-submit"><span>${type === 'A' ? 'Opslaan' : 'Volgende'}</span></button></div></div></div>
</form></app-form></div>
<div class="middle-bottom-container"><a>Handleiding</a></div>
</div></app-factuur-sjabloon-form></body></html>`;
}

test('invoice: three parts of e-Boekhouden, each with its own save, a sketch and the variables', async () => {
  const p = withPage(invoiceHtml(), `${ORIGIN}/beheer/sjabloon/factuur/5`);
  await p.settle();
  const { document, window } = p;
  assert.equal(document.querySelector('.ebs-tpl-h1').textContent, 'Factuursjabloon: Standaard');
  assert.deepEqual([...document.querySelectorAll('.ebs-tpl-invoice .ebs-tpl-part-head .ebs-tpl-title')].map((node) => node.textContent), ['1. Sjabloon', '2. Kolommen', '3. Opmaak en teksten']);
  assert.equal(document.querySelectorAll('.ebs-tpl-invoice button.form-submit').length, 1, 'part 1 keeps e-Boekhouden\'s own button; nothing combines the saves');
  const frame = document.querySelector('iframe.ebs-tpl-columns-frame');
  assert.equal(frame.name, 'ebs-tpl-columns');
  assert.equal(frame.getAttribute('src'), `${ORIGIN}/beheer/sjabloonregel/5`);
  assert.equal(document.querySelector('.ebs-tpl-sheet-title').textContent, 'Factuur VB-0001');
  assert.equal(document.querySelector('.ebs-tpl-card-notes a').getAttribute('href'), `${ORIGIN}/v1/api/factuursjabloon/download/5`);
  assert.match(document.querySelector('.ebs-tpl-vars .ebs-tpl-muted').textContent, /\(66 codes\)/);
  assert.equal(document.querySelector('.ebs-tpl-vars .ebs-tpl-var-code').textContent, '[NUMMER]', 'the invoice codes first, as on the board');

  // The language buttons pick e-Boekhouden's own option; the sketch follows.
  const en = [...document.querySelectorAll('.ebs-tpl-lang-option')].find((node) => node.textContent === 'EN');
  let changed = 0;
  document.querySelector('select#taal').addEventListener('change', () => { changed += 1; });
  en.click();
  await p.settle();
  assert.equal(document.querySelector('select#taal').value, 'EN');
  assert.equal(changed, 1);
  assert.equal(en.getAttribute('aria-checked'), 'true');
  assert.equal(document.querySelector('.ebs-tpl-sheet-title').textContent, 'Invoice VB-0001');

  // The columns frame reports its columns: the sketch and the total follow.
  window.dispatchEvent(new window.MessageEvent('message', {
    origin: ORIGIN, source: frame.contentWindow,
    data: { type: 'ebs-tpl-columns', height: 260, columns: [{ id: 'OMSCHRIJVING', title: 'Omschrijving', width: '*' }, { id: 'PPE', title: 'P.p.e.', width: '45' }, { id: 'BTWPERC', title: 'BTW', width: '40' }, { id: 'AANTAL', title: 'Aantal', width: '10' }, { id: 'REGELTOTAAL', title: 'Regeltotaal', width: '15' }] },
  }));
  await p.settle();
  assert.equal(frame.style.height, '260px');
  const width = document.querySelector('.ebs-tpl-part2 .ebs-tpl-width');
  assert.equal(width.textContent, '110% vast · Omschrijving 0%');
  assert.ok(width.classList.contains('over'));
  assert.ok(document.querySelector('.ebs-tpl-sheet-table').classList.contains('over'), 'the sketch shows the table running off the page');
  assert.deepEqual([...document.querySelectorAll('.ebs-tpl-sheet-row.head span')].map((node) => node.textContent), ['Omschrijving', 'P.p.e.', 'BTW', 'Aantal', 'Regeltotaal']);

  // A message from anywhere else is ignored.
  window.dispatchEvent(new window.MessageEvent('message', { origin: ORIGIN, source: window, data: { type: 'ebs-tpl-columns', columns: [] } }));
  await p.settle();
  assert.equal(document.querySelectorAll('.ebs-tpl-sheet-row.head span').length, 5);

  // Saved inside the frame: a message, and the frame back on the columns.
  window.dispatchEvent(new window.MessageEvent('message', { origin: ORIGIN, source: frame.contentWindow, data: { type: 'ebs-tpl-columns', saved: true, height: 0 } }));
  await p.settle();
  assert.equal(document.querySelector('.ebs-tpl-part2 .ebs-tpl-status').textContent, 'De kolommen zijn opgeslagen.');
  assert.equal(p.slots(), 0, 'no request on load');
  p.close();
});

test('invoice: the template editor opens in a dialog and closes when it says it saved', async () => {
  const p = withPage(invoiceHtml(), `${ORIGIN}/beheer/sjabloon/factuur/5`);
  await p.settle();
  const { document, window } = p;
  document.querySelector('.ebs-tpl-part3 .ebs-tpl-button').click();
  await p.settle();
  const frame = document.querySelector('.ebs-tpl-editor-dialog iframe.ebs-dialog-frame');
  assert.equal(frame.getAttribute('src'), `${ORIGIN}/v1/api/factuursjabloon/editor/5/`);
  assert.ok(document.querySelector('.ebs-tpl-editor-dialog .ebs-tpl-editor-aside .ebs-tpl-var'));
  window.dispatchEvent(new window.MessageEvent('message', { origin: ORIGIN, source: frame.contentWindow, data: 'sjabeditor-saved' }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(document.querySelector('.ebs-tpl-editor-dialog'), null);
  assert.equal(document.querySelector('.ebs-tpl-part3 .ebs-tpl-status').textContent, 'De sjablooneditor heeft opgeslagen.');
  p.close();
});

test('invoice: picking an invoice is one item request; until it is there the sketch is greyed', async () => {
  const p = withPage(invoiceHtml(), `${ORIGIN}/beheer/sjabloon/factuur/5`, { invoices: 1000 });
  await p.settle();
  const { document } = p;
  userClick(p, document.querySelector('.ebs-tpl-picker-button'));
  await p.settle();
  assert.equal(p.slots(), 1);
  userClick(p, document.querySelectorAll('.ebs-tpl-picker-panel .ebs-tpl-option')[1]);
  assert.ok(document.querySelector('.ebs-tpl-sheet').classList.contains('loading'), 'a quiet grey page while it loads');
  await p.settle();
  assert.equal(p.slots(), 2);
  assert.ok(p.fetched[1].endsWith('/v1/api/factuur/1099'), p.fetched[1]);
  assert.equal(document.querySelector('.ebs-tpl-sheet-title').textContent, 'Factuur 2026-1399');
  assert.ok([...document.querySelectorAll('.ebs-tpl-sheet-row:not(.head) span')].some((node) => node.textContent === 'Management fee oktober'));
  assert.equal(document.querySelector('.ebs-tpl-sheet-total').textContent, 'Totaal € 3.448,50');
  p.close();
});

test('invoice: an RTF template and a new one say why the columns and the editor are not there', async () => {
  const rtf = withPage(invoiceHtml({ type: 'A' }), `${ORIGIN}/beheer/sjabloon/factuur/5`);
  await rtf.settle();
  assert.equal(rtf.document.querySelector('iframe.ebs-tpl-columns-frame'), null);
  assert.match(rtf.document.querySelector('.ebs-tpl-columns-body').textContent, /RTF-sjabloon/);
  assert.equal(rtf.document.querySelector('.ebs-tpl-part3 .ebs-tpl-button').disabled, true);
  rtf.close();
  const fresh = withPage(invoiceHtml(), `${ORIGIN}/beheer/sjabloon/factuur/0`);
  await fresh.settle();
  assert.match(fresh.document.querySelector('.ebs-tpl-columns-body').textContent, /eerst op/);
  assert.equal(fresh.document.querySelector('.ebs-tpl-card-notes a').getAttribute('aria-disabled'), 'true');
  fresh.close();
});

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

const COLUMNS = [['OMSCHRIJVING', 'Omschrijving', '*'], ['AANTAL', 'Aantal', '10'], ['PPE', 'P.p.e.', '15'], ['BTWPERC', 'BTW', '12'], ['REGELTOTAAL', 'Regeltotaal', '15']];

function columnsHtml() {
  return `<!doctype html><html><head></head><body><div id="shell-header">Menu</div><router-outlet></router-outlet><app-factuur-sjabloon-regel-form><div>
<div class="middle-top-container"><app-goback><div class="go-back-container"><a title="Terug" class="plain-btn eb-icon"><span class="eb-icon-left-open"></span></a></div></app-goback></div>
<app-form><form class="form"><div class="form-header"><div class="form-header-left"><h1><span>Factuurregel details bewerken</span></h1></div></div><div class="form-body">
<table><tbody><tr><th></th><th>Kolom</th><th>Titel</th><th>Breedte</th><th></th><th></th></tr></tbody></table>
<div class="middle-bottom-container"><button type="button" class="plain-btn"> Kolom toevoegen </button><br><br><a href="https://cdn.e-boekhouden.nl/handleiding/Handleiding_sjabloonwijzigen.pdf">Handleiding</a></div>
</div><div class="form-footer"><div class="form-buttons"><div class="form-submit"><button type="submit" class="button form-submit"><span>Opslaan</span></button></div></div></div></form></app-form>
</div></app-factuur-sjabloon-regel-form></body></html>`;
}

// e-Boekhouden's table: rows tracked by position, as its @for with $index
// does. A click on an arrow moves the data and redraws the rows in place.
function nativeColumns(window, { async = false } = {}) {
  const { document } = window;
  const data = COLUMNS.map((one) => [...one]);
  const tbody = document.querySelector('app-factuur-sjabloon-regel-form tbody');
  const clicks = [];
  const ensureImg = (cell, on, src, onClick) => {
    let img = cell.querySelector('img');
    if (on && !img) {
      img = document.createElement('img');
      img.className = 'c-pointer';
      img.setAttribute('src', src);
      img.addEventListener('click', () => onClick(Number(cell.parentElement.dataset.index)));
      cell.prepend(img);
    } else if (!on && img) img.remove();
  };
  const move = (from, to) => {
    clicks.push([from, to]);
    const [item] = data.splice(from, 1);
    data.splice(to, 0, item);
    if (async) setTimeout(render, 5);
    else render();
  };
  function render() {
    data.forEach(([id, title, width], index) => {
      let row = tbody.querySelectorAll('tr[data-index]')[index];
      if (!row) {
        row = document.createElement('tr');
        row.dataset.index = String(index);
        row.innerHTML = '<td></td><td class="ws-nw"></td><td><input type="text" maxlength="100" class="eb-input" style="width: 156px;"></td><td></td><td></td><td></td>';
        tbody.append(row);
      }
      const cells = [...row.children].filter((cell) => cell.tagName === 'TD' && !cell.classList.contains('ebs-tpl-col-ours'));
      ensureImg(cells[0], id !== 'REGELTOTAAL', '/assets/images/delete.gif', (at) => { data.splice(at, 1); render(); });
      cells[1].textContent = id;
      cells[2].querySelector('input').value = title;
      let widthInput = cells[3].querySelector('input');
      if (id !== 'OMSCHRIJVING' && !widthInput) {
        widthInput = document.createElement('input');
        widthInput.setAttribute('maxlength', '3');
        widthInput.className = 'eb-input';
        cells[3].prepend(widthInput);
      } else if (id === 'OMSCHRIJVING' && widthInput) {
        widthInput.remove();
        widthInput = null;
      }
      if (widthInput) widthInput.value = width;
      ensureImg(cells[4], index !== 0, '/assets/images/arrow_up.gif', (at) => move(at, at - 1));
      ensureImg(cells[5], index !== data.length - 1, '/assets/images/arrow_down.gif', (at) => move(at, at + 1));
    });
  }
  render();
  return { data, clicks, ids: () => data.map((one) => one[0]) };
}

test('columns: e-Boekhouden\'s rows restyled, the arrow keys on the handle click its own arrows', async () => {
  const p = withPage(columnsHtml(), `${ORIGIN}/beheer/sjabloonregel/5`);
  const native = nativeColumns(p.window);
  await p.settle();
  const { document, window } = p;
  const rows = () => [...document.querySelectorAll('tr.ebs-tpl-col-row')];
  assert.equal(rows().length, 5);
  assert.equal(document.querySelector('.ebs-tpl-width').textContent, '52% vast · Omschrijving 48%');
  assert.ok(rows()[0].querySelector('.ebs-tpl-col-rest'), 'Omschrijving shows * for the rest');
  assert.ok(rows()[4].querySelector('.ebs-tpl-col-icon.lock'), 'Regeltotaal has the lock');
  assert.equal(rows()[1].querySelector('.ebs-tpl-col-handle').getAttribute('aria-label'), 'Kolom Aantal verplaatsen, plek 2 van 5');
  rows()[1].querySelector('.ebs-tpl-col-handle').focus();
  rows()[1].querySelector('.ebs-tpl-col-handle').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
  await p.settle();
  assert.deepEqual(native.ids(), ['OMSCHRIJVING', 'PPE', 'AANTAL', 'BTWPERC', 'REGELTOTAAL']);
  assert.deepEqual(native.clicks, [[1, 2]], 'one click on e-Boekhouden\'s down arrow');
  assert.equal(document.activeElement, rows()[2].querySelector('.ebs-tpl-col-handle'), 'focus moves with the column');
  assert.equal(document.querySelector('.ebs-tpl-cols .ebs-tpl-sr[aria-live]').textContent, 'Kolom Aantal staat nu op plek 3 van 5.');
  // The total follows the width fields.
  const ppe = rows()[1].querySelector('input[maxlength="3"]');
  ppe.value = '75';
  ppe.dispatchEvent(new window.Event('input', { bubbles: true }));
  await p.settle();
  assert.equal(document.querySelector('.ebs-tpl-width').textContent, '112% vast · Omschrijving 0%');
  assert.ok(document.querySelector('.ebs-tpl-width').classList.contains('over'));
  p.close();
});

test('columns: a drag over three rows is three clicks on the moving row\'s arrow, also when e-Boekhouden redraws later', async () => {
  const p = withPage(columnsHtml(), `${ORIGIN}/beheer/sjabloonregel/5`);
  const native = nativeColumns(p.window, { async: true });
  await p.settle();
  const { document, window } = p;
  const rows = [...document.querySelectorAll('tr.ebs-tpl-col-row')];
  rows.forEach((row, index) => {
    row.getBoundingClientRect = () => ({ top: index * 40, height: 36, bottom: index * 40 + 36, left: 0, right: 300, width: 300 });
  });
  const handle = rows[4].querySelector('.ebs-tpl-col-handle');
  const pointer = (type, y) => handle.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, button: 0, clientY: y, pointerId: 1 }));
  pointer('pointerdown', 178);
  assert.ok(rows[4].classList.contains('ebs-tpl-col-lifted'));
  pointer('pointermove', 98);
  assert.equal(rows[4].style.transform, 'translateY(-80px)');
  assert.ok(rows[2].classList.contains('ebs-tpl-col-target'));
  pointer('pointerup', 98);
  assert.equal(rows[4].style.transform, '');
  await new Promise((resolve) => setTimeout(resolve, 120));
  await p.settle();
  assert.deepEqual(native.clicks, [[4, 3], [3, 2]], 'each click waits for the table, so it is always the same column that moves');
  assert.deepEqual(native.ids(), ['OMSCHRIJVING', 'AANTAL', 'REGELTOTAAL', 'PPE', 'BTWPERC']);
  p.close();
});

test('columns in the frame of the invoice screen: only the editor, and its state goes to the parent', async () => {
  const p = await framedPage(columnsHtml(), {
    url: `${ORIGIN}/beheer/sjabloonregel/5`,
    parentUrl: `${ORIGIN}/beheer/sjabloon/factuur/5`,
    parentHtml: `<html><body><iframe name="ebs-tpl-columns" src="${ORIGIN}/beheer/sjabloonregel/5"></iframe></body></html>`,
    frameName: 'ebs-tpl-columns',
    store: { settings: { betterDesign: true } },
    answer: () => ({}),
  });
  const got = [];
  p.window.parent.addEventListener('message', (event) => got.push(event.data));
  // Chrome gives the frame's window its iframe name; jsdom does not.
  p.window.name = 'ebs-tpl-columns';
  nativeColumns(p.window);
  p.load(...SCRIPTS);
  await p.settle();
  assert.ok(p.document.documentElement.classList.contains('ebs-tpl-framed'));
  assert.equal(p.document.querySelector('.ebs-tpl-head'), null, 'no head of its own inside the frame');
  const last = got.filter((one) => one?.type === 'ebs-tpl-columns').pop();
  assert.deepEqual(plain(last.columns.map((one) => one.id)), ['OMSCHRIJVING', 'AANTAL', 'PPE', 'BTWPERC', 'REGELTOTAAL']);
  assert.equal(last.columns[0].width, '*');
  p.close();
});
