// The AI writing help on a page (src/features/ai.js), in jsdom with a fake
// CKEditor 4: the bar above every editor, the proposal with its
// differences, the variable check, and that nothing reaches the editor
// without a click of the user. Plus the pure helpers it uses (EBS.ai).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, page } from './dom.mjs';

after(closeAll);

const URL = 'https://secure20.e-boekhouden.nl/beheer/sjabloon/email/12';
const TEXT = '<p>[RELAANHEF],</p><p>Hierbij ontvangt u factuur [FACTNUMMER] van [FACTDATUM] voor een bedrag van [TOTAAL].</p><p>Met vriendelijke groet,<br>[ABBEDRIJF]</p>';
const FORMAL = '<p>[RELAANHEF],</p><p>Bijgaand treft u factuur [FACTNUMMER] van [FACTDATUM] aan voor een bedrag van [TOTAAL].</p><p>Met vriendelijke groet,<br>[ABBEDRIJF]</p>';
const READY = { state: 'ready', provider: 'openrouter', providerLabel: 'OpenRouter', model: 'anthropic/claude-sonnet-5.5' };
const EDITOR = (name = 'body', extra = '') => `<ckeditor><textarea id="${name}" style="display:none"></textarea><div id="cke_${name}" class="cke_1 cke cke_reset cke_chrome cke_editor_${name} cke_ltr" role="application"${extra}><div class="cke_inner"><div class="cke_top"></div><div class="cke_contents"></div></div></div></ckeditor>`;
const HTML = `<!doctype html><html><head></head><body><main><label>Onderwerp <input id="subject" value="Factuur [FACTNUMMER]"></label><div class="form-control">${EDITOR()}</div></main></body></html>`;

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Objects from the page's realm, as plain data for deepEqual.
const plain = (value) => JSON.parse(JSON.stringify(value));

function fakeEditor(data = TEXT) {
  return {
    readOnly: false,
    data,
    selection: '',
    writes: [],
    fired: [],
    getData() { return this.data; },
    setData(value, { callback }) {
      this.data = value;
      this.writes.push(['setData', value]);
      setTimeout(callback, 1);
    },
    insertHtml(html) { this.writes.push(['insertHtml', html]); },
    getSelection() { return { getSelectedText: () => this.selection }; },
    fire(name) { this.fired.push(name); },
  };
}

// answer(message) answers the content script's messages; it may return a promise.
async function aiPage({ html = HTML, url = URL, settings = { aiWriter: true }, aiView = READY, answer = () => ({}), editors = { body: fakeEditor() } } = {}) {
  const store = { settings };
  if (aiView) store.aiView = aiView;
  const p = page(html, { url, store, answer: (message) => answer(message) });
  const { window } = p;
  const roots = [];
  const attach = window.Element.prototype.attachShadow;
  // The feature's roots are closed; the test opens them to look inside.
  window.Element.prototype.attachShadow = function attachShadow(init) {
    const root = attach.call(this, { ...init, mode: 'open' });
    roots.push(root);
    return root;
  };
  const gesture = { active: false };
  class UserActivation {
    get isActive() { return gesture.active; }
    get hasBeenActive() { return gesture.active; }
  }
  Object.defineProperty(window.navigator, 'userActivation', { configurable: true, value: new UserActivation() });
  const fetched = [];
  window.fetch = async (input) => {
    fetched.push(String(input));
    return new Response('{}');
  };
  window.CKEDITOR = { instances: editors };
  p.load('main-world.js', 'shared.js', 'store.js', 'icons.js', 'dialog.js', 'bridge.js', 'request.js', 'features/ai.js');
  await p.settle();
  await wait(80);
  const bars = () => roots.filter((root) => root.host.isConnected && root.querySelector('.bar')).map((root) => root.querySelector('.bar'));
  const panel = () => roots.find((root) => root.host.isConnected && root.querySelector('.anchor'))?.querySelector('.panel') ?? null;
  const chip = (label) => [...bars()[0].querySelectorAll('.chip')].find((node) => node.textContent.trim() === label);
  const buttonIn = (node, label) => [...node.querySelectorAll('button')].find((candidate) => candidate.textContent.trim() === label);
  // A click of the user: the browser's activation is fresh during it.
  const click = async (node) => {
    gesture.active = true;
    node.click();
    await wait(30);
    gesture.active = false;
  };
  const runs = () => p.sent.filter((message) => message.type === 'ai:run');
  return { ...p, roots, bars, panel, chip, buttonIn, click, gesture, fetched, editors, runs };
}

test('a bar of its own above the editor, outside .cke, and no message before a click', async () => {
  const p = await aiPage();
  const cke = p.document.getElementById('cke_body');
  assert.equal(p.bars().length, 1);
  assert.ok(cke.previousSibling.hasAttribute('data-ebs-ai'), 'the bar sits right before .cke');
  assert.ok(cke.nextSibling.hasAttribute('data-ebs-ai'), 'the panel anchor right after it');
  assert.equal(cke.querySelector('[data-ebs-ai]'), null, 'nothing inside CKEditor');
  const bar = p.bars()[0];
  assert.equal(bar.getAttribute('role'), 'toolbar');
  assert.deepEqual([...bar.querySelectorAll('.chip')].map((node) => node.textContent.trim()),
    ['Herschrijven', 'Schrijven op instructie', 'Vertalen', 'Controleren', 'Herinneringsreeks', 'Onderwerp voorstellen']);
  assert.equal(bar.querySelector('.model').textContent, 'OpenRouter · anthropic/claude-sonnet-5.5');
  assert.ok(bar.querySelector('.lucide-sparkles'));
  assert.deepEqual(p.sent, [], 'no message to the service worker without a click');
  assert.deepEqual(p.fetched, [], 'no request to e-Boekhouden');
  p.close();
});

test('read-only editors get no bar; a second editor gets its own', async () => {
  const html = `<!doctype html><html><head></head><body>${EDITOR('body')}${EDITOR('readonly')}${EDITOR('second')}</body></html>`;
  const p = await aiPage({ html, editors: { body: fakeEditor(), readonly: { ...fakeEditor(), readOnly: true }, second: fakeEditor() } });
  assert.equal(p.bars().length, 2);
  assert.ok(p.document.getElementById('cke_readonly').previousSibling === null || !p.document.getElementById('cke_readonly').previousSibling.hasAttribute?.('data-ebs-ai'));
  p.close();
});

test('without a working key the bar is one line with a link to the settings', async () => {
  const p = await aiPage({ aiView: null });
  const bar = p.bars()[0];
  assert.match(bar.textContent, /AI-schrijfhulp staat aan, maar er is nog geen sleutel ingesteld\. Instellen in de extensie/);
  assert.equal(bar.querySelector('.chip'), null);
  assert.equal(bar.getAttribute('role'), null);
  await p.click(bar.querySelector('.link'));
  assert.deepEqual(plain(p.sent), [{ type: 'ai:settings' }]);
  await p.window.chrome.storage.local.set({ aiView: { ...READY, state: 'rejected' } });
  assert.match(p.bars()[0].textContent, /OpenRouter weigert de sleutel/);
  await p.window.chrome.storage.local.set({ aiView: READY });
  assert.equal(p.bars()[0].querySelectorAll('.chip').length, 6);
  p.close();
});

test('Herschrijven, Formeler: one call with the text and the variables, then a proposal with the differences', async () => {
  const reply = deferred();
  const p = await aiPage({ answer: (message) => (message.type === 'ai:run' ? reply.promise : {}) });
  await p.click(p.chip('Herschrijven'));
  const menu = p.bars()[0].querySelector('.menu');
  assert.equal(menu.getAttribute('role'), 'menu');
  assert.deepEqual([...menu.querySelectorAll('.item')].map((node) => node.textContent), ['Formeler (u)', 'Vriendelijker', 'Korter', 'Duidelijker', 'Spelling en grammatica']);
  await p.click(p.buttonIn(menu, 'Formeler (u)'));

  assert.equal(p.runs().length, 1);
  const { request } = p.runs()[0];
  assert.deepEqual(Object.keys(request).sort(), ['action', 'content', 'format', 'instruction', 'option', 'scope', 'subject', 'templateType', 'variables']);
  assert.equal(request.action, 'rewrite');
  assert.equal(request.option, 'formal');
  assert.equal(request.content, TEXT);
  assert.equal(request.format, 'html');
  assert.equal(request.templateType, 'mail');
  assert.ok(request.variables.some(([code]) => code === '[FACTNUMMER]'));
  assert.equal(request.subject, '', 'the subject only goes with Onderwerp voorstellen');

  const working = p.panel();
  assert.equal(working.getAttribute('role'), 'status');
  assert.match(working.textContent, /Bezig met herschrijven…/);
  assert.ok(p.buttonIn(working, 'Stoppen'));
  assert.equal(p.chip('Herschrijven').getAttribute('aria-busy'), 'true');
  assert.ok([...p.bars()[0].querySelectorAll('.chip')].every((node) => node.disabled), 'one action at a time');

  reply.resolve({ result: { content: FORMAL } });
  await wait(30);
  const proposal = p.panel();
  assert.equal(proposal.getAttribute('role'), 'dialog');
  assert.equal(proposal, working, 'the same panel: it does not close and open again');
  assert.ok(proposal.classList.contains('swap'), 'the answer fades in over the wait instead of popping');
  assert.match(proposal.querySelector('.title').textContent, /Voorstel: formeler/);
  assert.equal(proposal.querySelector('.meta').textContent, 'variabelen ongewijzigd · 1 alinea');
  assert.deepEqual([...proposal.querySelectorAll('del')].map((node) => node.textContent), ['Hierbij ontvangt']);
  assert.deepEqual([...proposal.querySelectorAll('ins')].map((node) => node.textContent), ['Bijgaand treft', ' aan']);
  assert.deepEqual(p.editors.body.writes, [], 'nothing reaches the text without a click');

  await p.click(p.buttonIn(proposal, 'Overnemen in de tekst'));
  assert.deepEqual(p.editors.body.writes, [['setData', FORMAL]]);
  assert.deepEqual(p.editors.body.fired, ['change'], 'the page hears about the new text');
  assert.match(p.panel().textContent, /Overgenomen in de tekst\. Opslaan doe je zelf/);
  assert.equal(p.runs().length, 1, 'one model call for one click');
  assert.deepEqual(p.fetched, [], 'no request to e-Boekhouden');
  p.close();
});

test('an answer with changed variables is never shown as a proposal', async () => {
  const p = await aiPage({ answer: () => ({ result: { content: FORMAL.replace('[TOTAAL]', 'het bedrag').replace('[ABBEDRIJF]', '[BEDRIJFSNAAM]') } }) });
  await p.click(p.chip('Herschrijven'));
  await p.click(p.buttonIn(p.bars()[0].querySelector('.menu'), 'Korter'));
  await wait(20);
  const panel = p.panel();
  assert.equal(panel.getAttribute('role'), 'alert');
  assert.match(panel.textContent, /De AI veranderde de variabelen \(\[TOTAAL\], \[ABBEDRIJF\] ontbreekt; \[BEDRIJFSNAAM\] is nieuw\)\. Daarom is er geen voorstel\. Je tekst is niet veranderd\./);
  assert.equal(panel.querySelector('del, ins'), null);
  assert.equal(p.buttonIn(panel, 'Overnemen in de tekst'), undefined);
  assert.deepEqual(p.editors.body.writes, []);
  p.close();
});

test('a selection is sent as plain text and goes back with insertHtml, escaped', async () => {
  const editor = fakeEditor();
  editor.selection = 'Met vriendelijke groet';
  const p = await aiPage({ editors: { body: editor }, answer: () => ({ result: { content: 'With kind regards <b>&' } }) });
  await p.click(p.chip('Vertalen'));
  await p.click(p.buttonIn(p.bars()[0].querySelector('.menu'), 'Naar het Engels'));
  await wait(20);
  const { request } = p.runs()[0];
  assert.deepEqual([request.format, request.scope, request.content], ['text', 'selection', 'Met vriendelijke groet']);
  assert.match(p.panel().querySelector('.title').textContent, /vertaling naar het Engels/);
  assert.match(p.panel().querySelector('.meta').textContent, /selectie/);
  await p.click(p.buttonIn(p.panel(), 'Overnemen in de tekst'));
  assert.deepEqual(editor.writes, [['insertHtml', 'With kind regards &lt;b&gt;&amp;']]);
  p.close();
});

test('Overnemen refuses when the text changed since the proposal, or outside a click', async () => {
  const editor = fakeEditor();
  const p = await aiPage({ editors: { body: editor }, answer: () => ({ result: { content: FORMAL } }) });
  await p.click(p.chip('Herschrijven'));
  await p.click(p.buttonIn(p.bars()[0].querySelector('.menu'), 'Duidelijker'));
  await wait(20);
  // No click of the user: the bridge refuses the write.
  p.buttonIn(p.panel(), 'Overnemen in de tekst').click();
  await wait(30);
  assert.match(p.panel().textContent, /Overnemen lukte niet/);
  assert.deepEqual(editor.writes, []);

  await p.click(p.buttonIn(p.panel(), 'Opnieuw'));
  await wait(20);
  assert.equal(p.runs().length, 2);
  editor.data = `${TEXT}<p>Nog een zin die de gebruiker net typte.</p>`;
  await p.click(p.buttonIn(p.panel(), 'Overnemen in de tekst'));
  assert.match(p.panel().textContent, /De tekst is veranderd sinds dit voorstel/);
  assert.deepEqual(editor.writes, []);
  p.close();
});

test('Stoppen aborts the call; a late answer changes nothing', async () => {
  const reply = deferred();
  const p = await aiPage({ answer: (message) => (message.type === 'ai:run' ? reply.promise : {}) });
  await p.click(p.chip('Controleren'));
  assert.match(p.panel().textContent, /Bezig met controleren…/);
  await p.click(p.buttonIn(p.panel(), 'Stoppen'));
  const abort = p.sent.find((message) => message.type === 'ai:abort');
  assert.equal(abort.id, p.runs()[0].id);
  reply.resolve({ result: { findings: [{ topic: 'toon', ok: true, text: 'Prima.' }] } });
  await wait(200);
  assert.equal(p.panel(), null, 'the panel faded out and stays gone');
  assert.ok([...p.bars()[0].querySelectorAll('.chip')].every((node) => !node.disabled));
  p.close();
});

test('a provider error says what happened in plain words, with a way to the key', async () => {
  const p = await aiPage({ answer: (message) => (message.type === 'ai:run' ? { error: { code: 'auth', status: 401 } } : {}) });
  await p.click(p.chip('Herschrijven'));
  await p.click(p.buttonIn(p.bars()[0].querySelector('.menu'), 'Vriendelijker'));
  await wait(20);
  const panel = p.panel();
  assert.equal(panel.querySelector('.error-text').textContent, 'OpenRouter gaf een fout: de sleutel werkt niet (401). Je tekst is niet veranderd.');
  await p.click(p.buttonIn(panel, 'Sleutel controleren'));
  assert.ok(p.sent.some((message) => message.type === 'ai:settings'));
  await p.click(panel.querySelector('.close'));
  await wait(200);
  assert.equal(p.panel(), null);
  p.close();
});

test('Schrijven op instructie asks first, and an empty editor is fine', async () => {
  const p = await aiPage({ editors: { body: fakeEditor('') }, answer: () => ({ result: { content: '<p>[RELAANHEF],</p><p>Dank voor uw opdracht. Bijgaand factuur [FACTNUMMER].</p>' } }) });
  await p.click(p.chip('Schrijven op instructie'));
  const ask = p.bars()[0].querySelector('.menu.ask');
  assert.equal(ask.getAttribute('role'), 'dialog');
  await p.click(p.buttonIn(ask, 'Schrijven'));
  assert.equal(p.runs().length, 0, 'no call without an instruction');
  ask.querySelector('textarea').value = 'Een korte mail bij de factuur met dank voor de opdracht';
  await p.click(p.buttonIn(ask, 'Schrijven'));
  await wait(20);
  assert.equal(p.runs()[0].request.instruction, 'Een korte mail bij de factuur met dank voor de opdracht');
  assert.equal(p.panel().querySelector('.meta').textContent, 'variabelen gecontroleerd · 2 alinea\'s');
  assert.equal(p.panel().querySelectorAll('ins').length > 0, true);
  p.close();
});

test('an action that needs text says so without a call', async () => {
  const p = await aiPage({ editors: { body: fakeEditor('<p>&nbsp;</p>') } });
  await p.click(p.chip('Controleren'));
  assert.match(p.panel().textContent, /Er is nog geen tekst om te controleren/);
  assert.equal(p.runs().length, 0);
  p.close();
});

test('Herinneringsreeks: four steps with rising tone, one goes into this editor, its subject into the field', async () => {
  const steps = ['1e herinnering', '2e herinnering', '3e herinnering', 'Ingebrekestelling'].map((title, index) => ({
    title, subject: `${title}: factuur [FACTNUMMER]`, content: `<p>[RELAANHEF],</p><p>Stap ${index + 1} over factuur [FACTNUMMER] van [TOTAAL].</p>`,
  }));
  const p = await aiPage({ answer: () => ({ result: { steps } }) });
  await p.click(p.chip('Herinneringsreeks'));
  await wait(20);
  const panel = p.panel();
  const tabs = [...panel.querySelectorAll('.tab')];
  assert.deepEqual(tabs.map((tab) => tab.textContent), ['1e herinnering', '2e herinnering', '3e herinnering', 'Ingebrekestelling']);
  assert.equal(tabs[0].getAttribute('aria-selected'), 'true');
  await p.click(tabs[3]);
  assert.match(panel.textContent, /Stap 4 over factuur/);
  assert.match(panel.querySelector('.meta').textContent, /4 e-mails · variabelen gecontroleerd · elk sjabloon sla je zelf op/);
  const subject = p.document.getElementById('subject');
  const heard = [];
  subject.addEventListener('input', () => heard.push(subject.value));
  await p.click(p.buttonIn(panel, 'Onderwerp overnemen'));
  assert.equal(subject.value, 'Ingebrekestelling: factuur [FACTNUMMER]');
  assert.deepEqual(heard, ['Ingebrekestelling: factuur [FACTNUMMER]'], 'Angular hears the change');

  await p.click(p.chip('Herinneringsreeks'));
  await wait(20);
  await p.click([...p.panel().querySelectorAll('.tab')][2]);
  await p.click(p.buttonIn(p.panel(), 'Overnemen in de tekst'));
  assert.deepEqual(p.editors.body.writes, [['setData', steps[2].content]]);
  p.close();
});

test('Onderwerp voorstellen sends the subject, drops suggestions with invented variables', async () => {
  const p = await aiPage({ answer: () => ({ result: { subjects: ['Factuur [FACTNUMMER] van [ABBEDRIJF]', 'Uw factuur [FACTUURNR]', 'Factuur [FACTNUMMER]'] } }) });
  await p.click(p.chip('Onderwerp voorstellen'));
  await wait(20);
  assert.equal(p.runs()[0].request.subject, 'Factuur [FACTNUMMER]');
  const choices = [...p.panel().querySelectorAll('.choice')].map((node) => node.textContent);
  assert.deepEqual(choices, ['Factuur [FACTNUMMER] van [ABBEDRIJF]', 'Factuur [FACTNUMMER]']);
  p.panel().querySelectorAll('.choice input')[1].click();
  await p.click(p.buttonIn(p.panel(), 'Overnemen als onderwerp'));
  assert.equal(p.document.getElementById('subject').value, 'Factuur [FACTNUMMER]');
  p.close();
});

test('Controleren: the model\'s findings and the extension\'s own IBAN and KvK checks', async () => {
  const editor = fakeEditor('<p>Geachte heer,</p><p>Betaal binnen 14 dagen op NL00DEMO0000000011. KvK 1234567. Je kunt bellen.</p>');
  const p = await aiPage({ editors: { body: editor }, answer: () => ({ result: { findings: [
    { topic: 'aanspreekvorm', ok: false, text: 'De tekst wisselt tussen u en je ("Je kunt bellen").' },
    { topic: 'iban', ok: true, text: 'Er staat een IBAN in.' },
    { topic: 'betaaltermijn', ok: true, text: 'Binnen 14 dagen.' },
  ] } }) });
  await p.click(p.chip('Controleren'));
  await wait(20);
  const items = [...p.panel().querySelectorAll('.finding')];
  assert.deepEqual(items.map((item) => [item.querySelector('b').textContent, item.classList.contains('ok')]), [
    ['Aanspreekvorm: ', false], ['KvK-nummer: ', false], ['IBAN: ', false], ['Betaaltermijn: ', true],
  ]);
  assert.match(items[2].textContent, /NL00DEMO0000000011 lijkt geen geldig IBAN/);
  assert.match(items[1].textContent, /heeft 7 cijfers/);
  assert.equal(p.panel().querySelector('.meta').textContent, '3 punten om naar te kijken');
  assert.equal(p.buttonIn(p.panel(), 'Overnemen in de tekst'), undefined, 'a check changes no text');
  p.close();
});

test('switching aiWriter off removes every bar; an editor that goes away takes its bar along', async () => {
  const p = await aiPage();
  await p.window.chrome.storage.local.set({ settings: { aiWriter: false } });
  await wait(20);
  assert.equal(p.document.querySelectorAll('[data-ebs-ai]').length, 0);
  await p.window.chrome.storage.local.set({ settings: { aiWriter: true } });
  await wait(120);
  assert.equal(p.document.querySelectorAll('[data-ebs-ai]').length, 2);
  p.document.querySelector('ckeditor').remove();
  await wait(120);
  assert.equal(p.document.querySelectorAll('[data-ebs-ai]').length, 0);
  assert.deepEqual(p.fetched, []);
  p.close();
});

test('an editor that appears later gets its bar, with one bridge list per scan', async () => {
  const p = await aiPage({ html: '<!doctype html><html><head></head><body><main id="app"></main></body></html>', editors: {} });
  assert.equal(p.bars().length, 0);
  p.window.CKEDITOR.instances.later = fakeEditor();
  p.document.getElementById('app').insertAdjacentHTML('beforeend', EDITOR('later'));
  await wait(120);
  assert.equal(p.bars().length, 1);
  // A busy page (many rows) changes nothing and asks nothing more.
  for (let i = 0; i < 1000; i += 1) p.document.getElementById('app').append(p.document.createElement('div'));
  await wait(120);
  assert.equal(p.bars().length, 1);
  assert.deepEqual(p.sent, []);
  assert.deepEqual(p.fetched, []);
  p.close();
});

// ---------------------------------------------------------------------------
// The helpers
// ---------------------------------------------------------------------------

test('helpers: variables, differences, text, IBAN, template types', async () => {
  const p = await aiPage({ settings: { aiWriter: false } });
  const ai = p.window.EBS.ai;
  assert.deepEqual(plain([...ai.variableCounts('[A] en [A] en [B_2] en [kleine] en [1]').entries()]), [['[A]', 2], ['[B_2]', 1]]);
  assert.deepEqual(plain(ai.compareVariables('[A] [B]', '[B] [A]', { strict: true })), { ok: true, missing: [], added: [], dropped: [] });
  assert.equal(ai.compareVariables('[A] [A]', '[A]', { strict: true }).ok, false, 'a count matters when strict');
  assert.deepEqual(plain(ai.compareVariables('[A]', '[B]', { strict: false, known: [['[B]', 'b']] })), { ok: true, missing: ['[A]'], added: [], dropped: ['[A]'] });
  assert.deepEqual(plain(ai.compareVariables('', '[X]', { strict: false, known: [['[B]', 'b']] }).added), ['[X]']);

  assert.equal(ai.htmlToText('<p>Een  <b>twee</b></p><p>drie<br>vier</p><ul><li>vijf</li></ul><script>x</script>'), 'Een twee\ndrie\nvier\nvijf');
  assert.equal(ai.textToHtml('a <b>\nc & "d"'), 'a &lt;b&gt;<br>c &amp; &quot;d&quot;');

  const ops = ai.diffWords('Wij verzoeken u dit bedrag te betalen.', 'Wij verzoeken u vriendelijk het bedrag te voldoen.');
  assert.deepEqual(plain(ops.filter((op) => op.type !== 'same').map((op) => [op.type, op.text])), [['del', 'dit'], ['ins', 'vriendelijk het'], ['del', 'betalen'], ['ins', 'voldoen']]);
  assert.equal(ops.filter((op) => op.type !== 'del').map((op) => op.text).join(''), 'Wij verzoeken u vriendelijk het bedrag te voldoen.');
  assert.equal(ops.filter((op) => op.type !== 'ins').map((op) => op.text).join(''), 'Wij verzoeken u dit bedrag te betalen.');
  assert.deepEqual(plain(ai.diffWords('[FACTNUMMER] x', '[FACTNUMER] x').filter((op) => op.type !== 'same').map((op) => op.text)), ['[FACTNUMMER]', '[FACTNUMER]'], 'a variable is one token');
  assert.equal(ai.changedParagraphs(ai.diffWords('a\nb\nc', 'a\nB\nc')), 1);
  assert.equal(ai.changedParagraphs(ai.diffWords('a\nb', 'a\nb')), 0);
  const long = Array.from({ length: 3000 }, (_, i) => `woord${i}`).join(' ');
  const big = ai.diffWords(long, long.split(' ').reverse().join(' '));
  assert.equal(big.filter((op) => op.type !== 'del').map((op) => op.text).join(''), long.split(' ').reverse().join(' '), 'a very long middle still adds up');

  assert.equal(ai.ibanValid('NL91 ABNA 0417 1643 00'), true);
  assert.equal(ai.ibanValid('NL91ABNA0417164301'), false);
  assert.deepEqual(plain(ai.localFindings('IBAN NL91ABNA0417164300, btw-nummer NL123456789B01, KvK 12345678.')), []);
  assert.deepEqual(plain(ai.localFindings('Ons btw-nummer NL123456789B01 en KvK 12345678 staan onderaan.')), []);
  assert.deepEqual(plain(ai.localFindings('btw-nummer NL12345B01 en meer').map((finding) => finding.topic)), ['btw']);

  assert.equal(ai.templateTypeOf('/beheer/sjabloon/email/12'), 'mail');
  assert.equal(ai.templateTypeOf('/beheer/sjabloon/aanmaan/3'), 'aanmaan');
  assert.equal(ai.templateTypeOf('/beheer/sjabloon/offerte/copy/4'), 'factuur');
  assert.equal(ai.templateTypeOf('/boekhouden/facturen'), null);
  assert.equal(ai.VARIABLES.mail.length, 31);
  assert.equal(new Set(ai.VARIABLES.factuur.map(([code]) => code)).size, ai.VARIABLES.factuur.length, 'no code twice');
  p.close();
});

test('on a page without a template type, only the text\'s own variables count', async () => {
  const p = await aiPage({ url: 'https://secure20.e-boekhouden.nl/factureren/mail', answer: () => ({ result: { content: FORMAL } }) });
  await p.click(p.chip('Herschrijven'));
  await p.click(p.buttonIn(p.bars()[0].querySelector('.menu'), 'Formeler (u)'));
  await wait(20);
  assert.equal(p.runs()[0].request.templateType, null);
  assert.deepEqual(plain(p.runs()[0].request.variables), []);
  assert.ok(p.buttonIn(p.panel(), 'Overnemen in de tekst'));
  p.close();
});
