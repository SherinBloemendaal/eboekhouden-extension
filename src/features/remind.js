// EB Sessions: the reminder dialog from the open posts, in Better design. Setting: betterDesign.
//
// "Aanmanen per e-mail" in e-Boekhouden goes to its page "Selecteer een
// sjabloon" (/boekhouden/openposten/aanmaning, app-open-posten-aanmaning-form):
// a template (an autocomplete), "Facturen als bijlage meesturen", "Kopie
// sturen naar" and Verder. Verder POSTs at once and sends the e-mails. So
// this dialog shows that very page in a frame, with the selection in the
// page's own `selected` query (factuur|relatieId), restyled: next to the
// native fields the invoices per relation and an approximation of the
// e-mail. Sending is e-Boekhouden's own Verder, clicked by the user; the
// result texts are e-Boekhouden's own.
//
//   parent  window.__ebsRemind.open(options), called by openposts.js
//   frame   this file again, inside the dialog's frame (all_frames), when
//           the frame element is ours
//
// The two halves talk with postMessage, checked on source and origin. What
// crosses is page data (invoices, names, a template's text), nothing secret.
//
// The preview is an approximation: e-Boekhouden has no preview of the
// e-mail. The text is the template's own (aanmaansjabloon/view/{id}, what
// e-Boekhouden's "Sjabloon bekijken" shows), fetched once per template on a
// click of the user; the codes the extension knows from the list are filled
// in, the rest stay as codes.

(() => {
  if (window.__ebsRemindLoaded) return;
  window.__ebsRemindLoaded = true;

  const FORM_PAGE = /^\/boekhouden\/openposten\/aanmaning\/?$/;
  const CHANNEL = 'ebs-remind';
  const DIALOG_CLASS = 'ebs-rm-dialog';
  const MAX = 1000;
  const READY_TIMEOUT_MS = 30_000;
  const op = () => window.__ebsOpenposts;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(text, className, onClick) {
    const node = el('button', className, text);
    node.type = 'button';
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
  const money = (value) => `€ ${EBS.formatMoney(Number.isFinite(value) ? value : 0)}`;

  // The template's answer: { tekstEmail, onderwerp? } with any casing.
  function templateFrom(answer) {
    if (!answer || typeof answer !== 'object') return null;
    const lower = Object.fromEntries(Object.entries(answer).map(([key, value]) => [key.toLowerCase(), value]));
    const html = typeof lower.tekstemail === 'string' ? lower.tekstemail : typeof lower.tekst === 'string' ? lower.tekst : null;
    if (html === null) return null;
    return { html, subject: typeof lower.onderwerp === 'string' ? lower.onderwerp.trim() : '' };
  }

  function titleFor({ soort, proef, step }) {
    if (proef) return 'Proef-aanmaning';
    const how = soort === 'P' ? 'per post' : 'per e-mail';
    return step ? `${step.label} ${how}` : `Aanmanen ${how}`;
  }

  // The frame's styles: e-Boekhouden's shell hidden, its form restyled in
  // the left column, Verder as the send button.
  const FORM = 'html.ebs-rm-frame app-open-posten-aanmaning-form > app-form';
  const FRAME_CSS = `
    html.ebs-rm-frame, html.ebs-rm-frame body { overflow: hidden !important; background: #fff !important; }
    html.ebs-rm-frame body { visibility: hidden; }
    html.ebs-rm-frame .ebs-rm, ${FORM} { visibility: visible; }
    html.ebs-rm-frame.ebs-rm-done app-open-posten-aanmaning-form > app-form { visibility: hidden; }
    ${FORM} { position: fixed !important; top: 0; left: 0; z-index: 2147483001; box-sizing: border-box; width: 420px !important; min-width: 0 !important; margin: 0 !important; padding: 16px 20px 4px; background: #fff; font-family: Ubuntu, system-ui, sans-serif; color: #232c4f; }
    ${FORM} :is(.form-header, .form-header-left, .form-header-right, .form-nc) { display: none !important; }
    ${FORM} form > div:first-of-type, ${FORM} .form-body { padding: 0 !important; border: 0 !important; background: transparent !important; }
    ${FORM} .form-row { display: block !important; margin: 0 0 12px !important; padding: 0 !important; }
    ${FORM} .form-component { display: flex !important; flex-direction: column; align-items: stretch; gap: 6px; padding: 0 !important; }
    ${FORM} .form-component:has(app-checkbox) { flex-direction: row-reverse; justify-content: flex-end; align-items: center; gap: 10px; }
    ${FORM} app-form-label { width: auto !important; padding: 0 !important; font-size: 13px !important; font-weight: 500; color: #232c4f; }
    ${FORM} .form-component:has(app-checkbox) app-form-label { font-weight: 400; }
    ${FORM} :is(app-autocomplete, app-text-input) { display: block !important; width: 100% !important; }
    ${FORM} :is(app-autocomplete, app-text-input) > div, ${FORM} app-autocomplete .form-control { width: 100% !important; }
    ${FORM} app-autocomplete input.displayValue { box-sizing: border-box; width: 100% !important; height: 40px !important; padding: 0 30px 0 10px !important; border: 1.5px solid #cfd4e2 !important; border-radius: 9px !important; background-color: #fff !important; font: 14px Ubuntu, system-ui, sans-serif !important; color: #232c4f !important; }
    ${FORM} app-text-input input { box-sizing: border-box; width: 100% !important; height: 38px !important; padding: 0 12px !important; border: 1.5px solid #cfd4e2 !important; border-radius: 9px !important; font: 13px Ubuntu, system-ui, sans-serif !important; color: #232c4f !important; }
    ${FORM} app-checkbox input[type="checkbox"] { width: 16px !important; height: 16px !important; }
    ${FORM} :is(input, button):focus-visible { outline: 2px solid #232c4f !important; outline-offset: 2px; }
    html.ebs-rm-frame .ebs-rm-send { position: fixed !important; right: 20px; bottom: 14px; z-index: 2147483002; height: 44px; padding: 0 20px !important; border: 0 !important; border-radius: 10px !important; background: #5d9e35 !important; color: #fff !important; font: 700 0px Ubuntu, system-ui, sans-serif !important; cursor: pointer; transition: background-color 150ms ease, opacity 150ms ease; }
    html.ebs-rm-frame .ebs-rm-send > * { display: none !important; }
    html.ebs-rm-frame .ebs-rm-send::after { content: var(--ebs-rm-send, "Versturen"); font-size: 15px; }
    html.ebs-rm-frame .ebs-rm-send:hover:not(:disabled) { background: #4f8a2c !important; }
    html.ebs-rm-frame .ebs-rm-send:disabled { opacity: .6; cursor: default; }

    .ebs-rm { position: fixed; inset: 0; z-index: 2147483000; display: grid; grid-template-rows: minmax(0, 1fr) auto; background: #fff; font-family: Ubuntu, system-ui, sans-serif; color: #232c4f; }
    .ebs-rm button { font-family: inherit; }
    .ebs-rm-invisible { visibility: hidden; }
    .ebs-rm-main { display: grid; grid-template-columns: 420px minmax(0, 1fr); min-height: 0; }
    .ebs-rm-left { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid #eef0f5; }
    .ebs-rm-slot { flex: none; height: 210px; border-bottom: 1px solid #eef0f5; }
    .ebs-rm-pick-note { margin: 0; padding: 0 20px; font-size: 12px; color: #8a5300; }
    .ebs-rm-pick-note:not(:empty) { padding: 8px 20px 0; }
    .ebs-rm-list-head { display: flex; flex-direction: column; gap: 6px; padding: 12px 20px 6px; }
    .ebs-rm-list-title { font-size: 13px; font-weight: 700; }
    .ebs-rm-skip { font-size: 12px; color: #5d6584; }
    .ebs-rm-list { flex: 1; min-height: 0; overflow: auto; padding: 0 12px 12px; }
    .ebs-rm-relation { display: flex; flex-direction: column; gap: 4px; width: 100%; margin-bottom: 6px; padding: 10px 12px; border: 1px solid #e6e9f1; border-radius: 10px; background: #fff; color: #232c4f; text-align: left; cursor: pointer; }
    .ebs-rm-relation.on { border-color: #232c4f; box-shadow: inset 0 0 0 1px #232c4f; background: #f3f6fd; }
    .ebs-rm-relation.missing { opacity: .7; }
    .ebs-rm-relation-top { display: flex; align-items: center; gap: 8px; }
    .ebs-rm-relation-name { flex: 1; font-size: 14px; font-weight: 700; }
    .ebs-rm-badge { padding: 2px 8px; border-radius: 10px; background: #fff1dc; color: #8a5300; font-size: 11px; }
    .ebs-rm-relation-mail { font-size: 12px; color: #5d6584; }
    .ebs-rm-invoice { display: flex; gap: 8px; font-size: 12px; color: #4a5272; }
    .ebs-rm-invoice .number { width: 74px; }
    .ebs-rm-invoice .days { flex: 1; }
    .ebs-rm-invoice .amount { font-weight: 700; color: #232c4f; }
    .ebs-rm-right { display: flex; flex-direction: column; min-height: 0; background: #f3f5fa; }
    .ebs-rm-preview-head { display: flex; align-items: center; gap: 10px; padding: 12px 20px; border-bottom: 1px solid #eef0f5; background: #fff; }
    .ebs-rm-preview-name { flex: 1; font-size: 15px; font-weight: 700; }
    .ebs-rm-preview-index { font-size: 12px; color: #5d6584; }
    .ebs-rm-preview { flex: 1; min-height: 0; overflow: auto; padding: 20px; }
    .ebs-rm-missing { margin-bottom: 12px; padding: 14px 16px; border-radius: 10px; background: #fff1dc; color: #8a5300; font-size: 13px; line-height: 1.5; }
    .ebs-rm-mail, .ebs-rm-paper { overflow: hidden; border-radius: 10px; background: #fff; box-shadow: 0 2px 8px rgba(20, 26, 48, .08); }
    .ebs-rm-paper { padding: 16px; font-size: 14px; line-height: 1.6; }
    .ebs-rm-paper p { margin: 0 0 10px; }
    .ebs-rm-mail-head { display: flex; flex-direction: column; gap: 4px; padding: 12px 16px; border-bottom: 1px solid #eef0f5; font-size: 12px; color: #5d6584; }
    .ebs-rm-mail-subject { font-size: 14px; font-weight: 700; color: #232c4f; }
    .ebs-rm-mail-body { padding: 16px; font-size: 14px; line-height: 1.6; color: #232c4f; overflow-wrap: anywhere; }
    .ebs-rm-mail-body p { margin: 0 0 10px; }
    .ebs-rm-code { padding: 0 3px; border-radius: 3px; background: #eef1f8; color: #2a4a9a; font: 13px ui-monospace, Menlo, monospace; }
    .ebs-rm-filled { border-bottom: 1px dotted #8c93ab; }
    .ebs-rm-text-wait { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; font-size: 13px; color: #5d6584; }
    .ebs-rm-load { height: 34px; padding: 0 12px; border: 1px solid #cfd4e2; border-radius: 8px; background: #fff; color: #232c4f; font-size: 13px; cursor: pointer; }
    .ebs-rm-load:disabled { opacity: .6; cursor: default; }
    .ebs-rm-table { border-collapse: collapse; margin: 0 0 10px; font-size: 13px; }
    .ebs-rm-table td { padding: 3px 18px 3px 0; }
    .ebs-rm-table td.right { padding-right: 0; text-align: right; }
    .ebs-rm-table tr.total td { padding-top: 6px; border-top: 1px solid #e6e9f1; font-weight: 700; }
    .ebs-rm-notes { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
    .ebs-rm-approx { padding: 2px 8px; border: 1px dashed #8c93ab; border-radius: 6px; background: #f7f8fb; color: #4a5272; font-size: 11px; line-height: 16px; }
    .ebs-rm-unchanged { font-size: 12px; color: #5d6584; }
    .ebs-rm-foot { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 14px 20px; border-top: 1px solid #e6e9f1; }
    .ebs-rm-foot-note { flex: 1; font-size: 13px; color: #4a5272; }
    .ebs-rm-foot-error { max-width: 360px; font-size: 13px; color: #b42318; opacity: 0; transition: opacity 150ms ease-out; }
    .ebs-rm-foot-error.shown { opacity: 1; }
    .ebs-rm-cancel { height: 44px; padding: 0 16px; border: 1px solid #cfd4e2; border-radius: 10px; background: #fff; color: #232c4f; font-size: 14px; cursor: pointer; }
    .ebs-rm-send-room { flex: none; width: 130px; }
    .ebs-rm-result { position: absolute; inset: 0; z-index: 3; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; background: #fff; text-align: center; opacity: 0; transform: translateY(8px); visibility: hidden; transition: opacity 180ms cubic-bezier(0.23, 1, 0.32, 1), transform 180ms cubic-bezier(0.23, 1, 0.32, 1), visibility 0s linear 180ms; }
    .ebs-rm-result.shown { opacity: 1; transform: none; visibility: visible; transition: opacity 180ms cubic-bezier(0.23, 1, 0.32, 1), transform 180ms cubic-bezier(0.23, 1, 0.32, 1), visibility 0s; }
    .ebs-rm-result-icon { display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 50%; background: #eef0f5; color: #232c4f; }
    .ebs-rm-result-icon.ok { background: #5d9e35; color: #fff; }
    .ebs-rm-result-icon.warn { background: #fdf0ef; color: #b42318; }
    .ebs-rm-result-icon.busy svg { animation: ebs-rm-spin 900ms linear infinite; }
    .ebs-rm-result-title { font-size: 18px; font-weight: 700; }
    .ebs-rm-result-text { max-width: 520px; font-size: 14px; color: #5d6584; }
    .ebs-rm-result-button { margin-top: 8px; height: 42px; padding: 0 16px; border: 0; border-radius: 10px; background: #232c4f; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; }
    .ebs-rm-result-button:disabled { opacity: .7; cursor: default; }
    .ebs-rm-relation, .ebs-rm-cancel, .ebs-rm-load, .ebs-rm-result-button { transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease, opacity 150ms ease; }
    .ebs-rm-relation:hover:not(.on) { border-color: #c4cae0; }
    .ebs-rm-cancel:hover, .ebs-rm-load:hover:not(:disabled) { background: #f3f5fa; }
    .ebs-rm-result-button:hover:not(:disabled) { background: #1b2240; }
    .ebs-rm-relation:focus-visible, .ebs-rm-cancel:focus-visible, .ebs-rm-load:focus-visible, .ebs-rm-result-button:focus-visible { outline: 2px solid #232c4f; outline-offset: 2px; }
    @keyframes ebs-rm-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .ebs-rm-result, .ebs-rm-result.shown { transform: none; }
      .ebs-rm-result-icon.busy svg { animation: none; }
    }
  `;

  // =========================================================================
  // Inside the dialog's frame: e-Boekhouden's own form, restyled.
  // =========================================================================

  function ourFrame() {
    if (window === window.top || !FORM_PAGE.test(location.pathname)) return false;
    try {
      return Boolean(window.frameElement?.closest?.(`.${DIALOG_CLASS}`));
    } catch {
      return false;
    }
  }

  if (ourFrame()) {
    runFrame();
    return;
  }

  // =========================================================================
  // The parent page: the dialog itself.
  // =========================================================================

  let settings = EBS.settingsWithDefaults();
  EBS.watchSettings((next) => {
    settings = next;
  });

  function open(options) {
    const helpers = op();
    const all = Array.isArray(options?.rows) ? options.rows : [];
    const rows = all.filter((row) => helpers.remindable(row));
    // The selected posts e-Boekhouden's form cannot take: named in the
    // dialog, before anything is sent.
    const left = all.filter((row) => !helpers.remindable(row));
    const skipped = left.length;
    if (!rows.length) return null;
    if (rows.length > MAX) return null;
    const soort = options.soort === 'P' ? 'P' : 'E';
    const proef = Boolean(options.proef);
    const step = options.step ?? null;
    const url = helpers.aanmaningUrl({ rows, soort, proef, credDeb: options.credDeb ?? 'D', per: options.per ?? '', returnUrl: options.returnUrl ?? '' });
    const relations = new Set(rows.map((row) => row.relatieId)).size;
    const open = rows.reduce((sum, row) => sum + (Number.isFinite(row.open) ? row.open : 0), 0);
    injectParentStyle();

    const payload = {
      soort, proef, skipped,
      skippedRows: left.slice(0, 50).map((row) => ({ factuur: String(row.factuur ?? ''), relation: String(row.relation ?? '') })),
      step: step ? { index: step.index, label: step.label } : null,
      template: step?.template ? { id: step.template.id, name: step.template.name } : null,
      rows: rows.map((row) => ({
        factuur: row.factuur, relatieId: row.relatieId, relation: row.relation, email: row.email ?? '',
        date: row.date, amount: row.amount, paid: row.paid, open: row.open, days: row.days,
      })),
    };
    let templateMessage = null;
    let readyTimer = null;
    let dialog = null;
    // What the frame last said of e-Boekhouden's work: main, sending, done or failed.
    let stage = 'main';

    const post = (message) => {
      try {
        dialog?.frame?.contentWindow?.postMessage({ ebs: CHANNEL, ...message }, location.origin);
      } catch { /* the frame went elsewhere */ }
    };

    function onMessage(event) {
      if (!dialog?.isOpen || event.source !== dialog.frame?.contentWindow || event.origin !== location.origin) return;
      const data = event.data;
      if (!data || data.ebs !== CHANNEL) return;
      if (data.type === 'hello') {
        post({ type: 'payload', payload });
        if (templateMessage) post(templateMessage);
      } else if (data.type === 'ready') {
        clearTimeout(readyTimer);
        dialog.setReady();
      } else if (data.type === 'stage' && ['main', 'sending', 'done', 'failed'].includes(data.stage)) {
        stage = data.stage;
      } else if (data.type === 'close') {
        dialog.close({ reason: data.reason === 'sent' ? 'sent' : 'cancel' });
      }
    }

    window.addEventListener('message', onMessage);
    dialog = EBS.dialog.open({
      title: titleFor({ soort, proef, step }),
      subtitle: `${plural(rows.length, 'factuur', 'facturen')} · ${plural(relations, 'relatie', 'relaties')} · ${money(open)} open`,
      src: url,
      frameTitle: 'Selecteer een sjabloon (e-Boekhouden)',
      fallbackUrl: url,
      width: 1240,
      height: 820,
      className: DIALOG_CLASS,
      ready: 'manual',
      loading: 'Bezig met laden…',
      motion: settings.betterDesign,
      // A stray click beside the dialog does not throw the form away.
      closeOnBackdrop: false,
      onClose(reason) {
        clearTimeout(readyTimer);
        window.removeEventListener('message', onMessage);
        // After a send (also one the user closed the dialog on while
        // e-Boekhouden was still busy) the list shows the new "Laatste
        // aanmaning" after a fresh load.
        if (reason === 'sent' || stage === 'sending' || stage === 'done') location.reload();
      },
    });
    dialog.frame.addEventListener('load', () => {
      let path = null;
      try {
        path = dialog.frame.contentWindow.location.pathname;
      } catch { /* not readable: dialog.js says so */ }
      if (path !== null && !FORM_PAGE.test(path)) dialog.setError('e-Boekhouden opende een andere pagina. Is de sessie verlopen?', { fallbackUrl: url });
    });
    readyTimer = setTimeout(() => {
      if (dialog.isOpen) dialog.setError('Het venster van e-Boekhouden reageert niet.', { fallbackUrl: url });
    }, READY_TIMEOUT_MS);

    // The template text fetched on the user's click in the list.
    Promise.resolve(options.templateText ?? null).then((result) => {
      const template = result ? templateFrom(result.answer) : null;
      if (!template) return;
      templateMessage = { type: 'template', id: result.id, html: template.html, subject: template.subject };
      post(templateMessage);
    }, () => {});
    return dialog;
  }

  function injectParentStyle() {
    if (document.getElementById('ebs-remind-style')) return;
    const style = document.createElement('style');
    style.id = 'ebs-remind-style';
    style.textContent = `.${DIALOG_CLASS} .ebs-dialog-frame { background: #fff; }`;
    document.documentElement.append(style);
  }

  window.__ebsRemind = Object.freeze({ open, templateFrom });

  // =========================================================================
  // The frame
  // =========================================================================

  function runFrame() {
    const helpers = op();
    const html = document.documentElement;
    html.classList.add('ebs-rm-frame');
    injectFrameStyle();

    const state = {
      payload: null,
      current: 0,
      stage: 'main', // main | sending | done | failed
      templates: null, // [{ id, name }] from e-Boekhouden's own list
      texts: new Map(), // id -> { html, subject } | { error: true }
      loading: null, // id while its text loads
      picked: false,
      sendClickedAt: 0,
      error: '',
      ready: false,
      postedStage: 'main',
    };

    const post = (message) => window.parent.postMessage({ ebs: CHANNEL, ...message }, location.origin);

    window.addEventListener('message', (event) => {
      if (event.source !== window.parent || event.origin !== location.origin) return;
      const data = event.data;
      if (!data || data.ebs !== CHANNEL) return;
      if (data.type === 'payload' && data.payload && Array.isArray(data.payload.rows)) {
        state.payload = data.payload;
        html.style.setProperty('--ebs-rm-send', data.payload.proef ? '"Proef maken"' : data.payload.soort === 'P' ? '"Pdf maken"' : '"Versturen"');
        schedule();
      } else if (data.type === 'template' && Number.isInteger(data.id) && typeof data.html === 'string') {
        state.texts.set(data.id, { html: data.html, subject: typeof data.subject === 'string' ? data.subject : '' });
        schedule();
      }
    });
    post({ type: 'hello' });

    // -- the native page ---------------------------------------------------

    const component = () => document.querySelector('app-open-posten-aanmaning-form');
    const form = () => component()?.querySelector(':scope > app-form') ?? null;
    const templateInput = () => form()?.querySelector('#sjabloon-AutocompletePickerInput, app-autocomplete input.displayValue') ?? null;
    const attachBox = () => form()?.querySelector('input#factuurAlsBijlage, app-checkbox input[type="checkbox"]') ?? null;
    const copyInput = () => form()?.querySelector('input#kopieSturenNaar, app-text-input input') ?? null;
    function sendButton() {
      const list = [...(form()?.querySelectorAll('button') ?? [])];
      return list.find((node) => /Verder/.test(node.textContent)) ?? null;
    }
    function infoBox() {
      const box = component()?.querySelector('app-info-box');
      if (!box) return null;
      const title = box.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim() ?? '';
      const message = [...box.querySelectorAll('p')].map((p) => p.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
      return { title, message };
    }
    function nativeError() {
      const node = document.querySelector('app-notification-bar .error, app-notification-bar .notification-message.error');
      return node?.textContent.replace(/\s+/g, ' ').trim() ?? '';
    }

    // Verder sends at once, so the native form may only submit from a real
    // click of the user on Verder itself: the mouse, or Enter or Space while
    // Verder has focus (the browser makes that a trusted click on it). Every
    // other way is stopped before e-Boekhouden's own submit handler on the
    // <form> sees it: a script's click() or requestSubmit(), and Enter in a
    // field (the browser's implicit submission, which also clicks Verder,
    // but with the focus in that field). form.submit() fires no event and
    // sends nothing through Angular. Nothing in this file submits.
    let sendIntent = false;
    const inNativeForm = (node) => Boolean(node?.closest?.('app-open-posten-aanmaning-form'));
    document.addEventListener('click', (event) => {
      const send = sendButton();
      sendIntent = Boolean(event.isTrusted && send && !send.disabled && send.contains(event.target)
        && (event.detail > 0 || document.activeElement === send));
    }, true);
    document.addEventListener('submit', (event) => {
      if (!inNativeForm(event.target)) return;
      const send = sendButton();
      const allowed = sendIntent && Boolean(send) && (!event.submitter || event.submitter === send);
      sendIntent = false;
      if (allowed) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    document.addEventListener('keydown', (event) => {
      // While e-Boekhouden sends, Escape does not close the dialog on it.
      if (event.key === 'Escape' && state.stage === 'sending') {
        event.preventDefault();
        return;
      }
      if (event.key !== 'Enter' || !inNativeForm(event.target)) return;
      // The template field handles Enter itself (it picks the highlighted
      // template and already blocks the submit); every other field may not
      // submit with it.
      if (event.target.matches?.('input:not([type="button"]):not([type="submit"]):not(.displayValue), select')) event.preventDefault();
    }, true);

    // The user picked a template in the native list: its text loads on that
    // click. The same for a click on a relation or on "Tekst laden".
    document.addEventListener('click', (event) => {
      const target = event.target;
      // Only what the view shows depends on this: "Bezig…" once e-Boekhouden
      // disabled its button after the click.
      if (target.closest?.('.ebs-rm-send')) state.sendClickedAt = Date.now();
      if (!event.isTrusted) return;
      if (target.closest?.('app-autocomplete .row, .ebs-rm-relation, .ebs-rm-load')) {
        requestAnimationFrame(() => loadText());
      }
    }, true);
    document.addEventListener('input', (event) => {
      if (event.target === copyInput()) drawPreview();
    }, true);
    document.addEventListener('change', (event) => {
      if (event.target === attachBox()) drawPreview();
    }, true);

    function currentTemplate() {
      const name = templateInput()?.value?.trim() ?? '';
      if (!name) return null;
      const known = state.templates?.find((template) => template.name === name)
        ?? (state.payload?.template?.name === name ? state.payload.template : null);
      return { name, id: known?.id ?? null };
    }

    async function loadTemplates() {
      if (state.templates) return;
      state.templates = [];
      try {
        const answer = await EBS.request.bulk('remind:sjablonen', `/v1/api/aanmaansjabloon/soort/${state.payload?.soort === 'P' ? 'P' : 'E'}`);
        state.templates = Array.isArray(answer)
          ? answer.map((item) => ({ id: Number(item?.id), name: String(item?.naam ?? '').trim() })).filter((item) => Number.isInteger(item.id) && item.name)
          : [];
      } catch {
        state.templates = [];
      }
      schedule();
    }

    // One item per click of the user, for a template not loaded yet.
    function loadText() {
      const template = currentTemplate();
      if (!template?.id || state.payload?.soort === 'P') return;
      const cached = state.texts.get(template.id);
      if (cached && !cached.error) return;
      if (state.loading === template.id) return;
      state.loading = template.id;
      drawPreview();
      EBS.request.item(`remind:sjabloon:${template.id}`, `/v1/api/aanmaansjabloon/view/${template.id}`, { userAction: true }).then((answer) => {
        state.texts.set(template.id, templateFrom(answer) ?? { error: true });
      }, () => {
        state.texts.set(template.id, { error: true });
      }).finally(() => {
        state.loading = null;
        drawPreview();
      });
    }

    // The template the ladder chose, picked in e-Boekhouden's own
    // autocomplete as a user would: open it, click the item. Once.
    function pickTemplate() {
      const wanted = state.payload?.template?.name;
      const input = templateInput();
      if (state.picked || !wanted || !input) return;
      state.picked = true;
      if (input.value.trim() === wanted) return;
      input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      requestAnimationFrame(() => setTimeout(() => {
        const rows = [...(form()?.querySelectorAll('app-autocomplete [id^="sjabloon-AutocompletePickerRow-"], app-autocomplete .row') ?? [])];
        const row = rows.find((one) => one.textContent.replace(/\s+/g, ' ').trim() === wanted);
        if (row) {
          // A row is a <tr>: its click only selects (onItemClick), it submits
          // nothing. The autocomplete then parks the focus on a field in the
          // form; that focus is given up, so no key of the user lands there.
          row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          row.click();
          const focused = document.activeElement;
          if (focused && focused !== document.body && inNativeForm(focused)) focused.blur();
        } else {
          input.dispatchEvent(new FocusEvent('blur'));
          view.pickNote.textContent = `Het sjabloon "${wanted}" staat niet in de lijst. Kies zelf een sjabloon.`;
        }
        schedule();
      }, 0));
    }

    // -- our view around it --------------------------------------------------

    const view = {
      root: null,
      build() {
        this.root = el('div', 'ebs-rm');
        this.root.setAttribute('role', 'region');
        this.root.setAttribute('aria-label', 'Aanmanen');
        const main = el('div', 'ebs-rm-main');
        const left = el('div', 'ebs-rm-left');
        this.slot = el('div', 'ebs-rm-slot');
        this.pickNote = el('p', 'ebs-rm-pick-note');
        this.pickNote.setAttribute('role', 'status');
        const listHead = el('div', 'ebs-rm-list-head');
        this.listTitle = el('span', 'ebs-rm-list-title');
        this.skipNote = el('span', 'ebs-rm-skip');
        listHead.append(this.listTitle, this.skipNote);
        this.list = el('div', 'ebs-rm-list');
        left.append(this.slot, this.pickNote, listHead, this.list);
        const right = el('div', 'ebs-rm-right');
        const previewHead = el('div', 'ebs-rm-preview-head');
        this.previewName = el('span', 'ebs-rm-preview-name');
        this.previewIndex = el('span', 'ebs-rm-preview-index');
        previewHead.append(this.previewName, this.previewIndex);
        this.preview = el('div', 'ebs-rm-preview');
        right.append(previewHead, this.preview);
        main.append(left, right);
        const foot = el('div', 'ebs-rm-foot');
        this.footNote = el('span', 'ebs-rm-foot-note');
        this.footError = el('span', 'ebs-rm-foot-error');
        this.footError.setAttribute('role', 'alert');
        const cancel = button('Annuleren', 'ebs-rm-cancel', () => post({ type: 'close', reason: 'cancel' }));
        foot.append(this.footNote, this.footError, cancel, el('span', 'ebs-rm-send-room'));
        this.result = el('div', 'ebs-rm-result');
        this.result.setAttribute('role', 'status');
        this.resultIcon = el('span', 'ebs-rm-result-icon');
        this.resultTitle = el('span', 'ebs-rm-result-title');
        this.resultText = el('span', 'ebs-rm-result-text');
        this.resultButton = button('', 'ebs-rm-result-button', () => {
          if (state.stage === 'done') post({ type: 'close', reason: 'sent' });
          else post({ type: 'close', reason: 'cancel' });
        });
        this.result.append(this.resultIcon, this.resultTitle, this.resultText, this.resultButton);
        this.root.append(main, foot, this.result);
        document.body.append(this.root);
      },
    };

    function groups() {
      const map = new Map();
      for (const row of state.payload?.rows ?? []) {
        if (!map.has(row.relatieId)) map.set(row.relatieId, { relatieId: row.relatieId, name: row.relation || String(row.relatieId), email: '', rows: [] });
        const group = map.get(row.relatieId);
        if (!group.email && row.email) group.email = row.email;
        group.rows.push(row);
      }
      return [...map.values()];
    }

    // Redrawn only when something it shows changed, so focus and scroll stay.
    let drawn = '';
    function draw() {
      if (!view.root || !state.payload) return;
      const template = currentTemplate();
      const signature = JSON.stringify([state.current, state.stage, state.error, template, state.loading, state.texts.size,
        [...state.texts.values()].filter((text) => text.error).length, attachBox()?.checked ?? null, copyInput()?.value ?? '', state.templates?.length ?? -1, infoBox()]);
      if (signature === drawn && state.payloadDrawn === state.payload) return;
      drawn = signature;
      state.payloadDrawn = state.payload;
      const email = state.payload.soort === 'E';
      const list = groups();
      if (state.current >= list.length) state.current = 0;
      const missing = email ? list.filter((group) => !group.email) : [];
      view.listTitle.textContent = email
        ? `Facturen per relatie (${list.length - missing.length} van ${list.length} met e-mailadres)`
        : `Facturen per relatie (${list.length})`;
      view.skipNote.textContent = skipText(state.payload);
      const focused = document.activeElement?.closest?.('.ebs-rm-relation')?.dataset.index ?? null;
      view.list.replaceChildren(...list.map((group, index) => {
        const card = button('', 'ebs-rm-relation');
        card.dataset.index = String(index);
        card.classList.toggle('on', index === state.current);
        card.classList.toggle('missing', email && !group.email);
        card.setAttribute('aria-pressed', String(index === state.current));
        const top = el('span', 'ebs-rm-relation-top');
        top.append(el('span', 'ebs-rm-relation-name', group.name));
        const badge = el('span', 'ebs-rm-badge', 'geen e-mail');
        if (!(email && !group.email)) badge.classList.add('ebs-rm-invisible');
        top.append(badge);
        card.append(top, el('span', 'ebs-rm-relation-mail', email ? group.email || 'geen e-mailadres bekend bij de relatie' : ''));
        for (const row of group.rows) {
          const line = el('span', 'ebs-rm-invoice');
          line.append(el('span', 'number', row.factuur), el('span', 'days', helpers.dueText(row.days)), el('span', 'amount', money(row.open)));
          card.append(line);
        }
        card.addEventListener('click', () => {
          state.current = index;
          schedule();
        });
        return card;
      }));
      if (focused !== null) view.list.querySelector(`[data-index="${focused}"]`)?.focus({ preventScroll: true });
      if (missing.length === 1) view.footNote.textContent = `${missing[0].name} heeft waarschijnlijk geen e-mailadres; e-Boekhouden meldt na het versturen wat niet is gelukt. Versturen is de knop Verder van e-Boekhouden en verstuurt direct.`;
      else if (missing.length > 1) view.footNote.textContent = `${missing.length} relaties hebben waarschijnlijk geen e-mailadres; e-Boekhouden meldt na het versturen wat niet is gelukt. Versturen is de knop Verder van e-Boekhouden en verstuurt direct.`;
      else if (email) view.footNote.textContent = 'Versturen is de knop Verder van e-Boekhouden en verstuurt direct, pas als jij klikt. De extensie verstuurt nooit iets.';
      else view.footNote.textContent = 'Verder is de knop van e-Boekhouden: hij maakt direct de pdf om te downloaden, pas als jij klikt. De extensie verstuurt nooit iets.';
      view.footError.textContent = state.error;
      view.footError.classList.toggle('shown', Boolean(state.error));
      drawPreview();
      drawResult();
    }

    // "2 posten zonder factuurnummer of relatie staan er niet bij: 2026-0001
    // (Studio Noord), zonder nummer (Atelier Zuid)."
    function skipText(payload) {
      const count = Number.isInteger(payload.skipped) ? payload.skipped : 0;
      if (!count) return '';
      const named = (Array.isArray(payload.skippedRows) ? payload.skippedRows : []).slice(0, 5)
        .map((row) => `${row.factuur || 'zonder nummer'}${row.relation ? ` (${row.relation})` : ''}`);
      const more = count - named.length;
      const list = named.length ? `: ${named.join(', ')}${more > 0 ? ` en ${more} meer` : ''}` : '';
      return `${plural(count, 'post zonder factuurnummer of relatie staat', 'posten zonder factuurnummer of relatie staan')} er niet bij${list}.`;
    }

    function drawPreview() {
      if (!view.root || !state.payload) return;
      const list = groups();
      const group = list[state.current];
      if (!group) return;
      view.previewName.textContent = `Voorbeeld voor ${group.name}`;
      view.previewIndex.textContent = `${state.current + 1} van ${list.length}`;
      const parts = [];
      if (state.payload.soort === 'P') {
        const box = el('div', 'ebs-rm-paper');
        box.append(el('p', '', state.payload.proef
          ? 'Een proef-aanmaning is een pdf om te bekijken. e-Boekhouden maakt hem met het gekozen sjabloon.'
          : 'Per post maakt e-Boekhouden een pdf om te downloaden, te printen en te versturen. Er gaat geen e-mail uit.'));
        box.append(invoiceTable(group.rows));
        parts.push(box);
      } else {
        if (!group.email) {
          const alert = el('div', 'ebs-rm-missing', `${group.name} heeft geen e-mailadres bij de relatie. Waarschijnlijk krijgt deze relatie geen e-mail; e-Boekhouden meldt het na het versturen. Vul het adres in bij de relatie of stuur de aanmaning per post.`);
          alert.setAttribute('role', 'alert');
          parts.push(alert);
        }
        parts.push(mail(group));
        const notes = el('div', 'ebs-rm-notes');
        notes.append(
          el('span', 'ebs-rm-approx', 'Een benadering, geen echte e-mail: e-Boekhouden heeft geen voorbeeld. Ingevuld is wat de extensie weet (facturen, bedragen, relatie). Codes als [AANHEF], [ADRES] en [IBAN] vult e-Boekhouden pas bij het versturen; hoe hij meerdere facturen opsomt, bepaalt hij zelf.'),
          el('span', 'ebs-rm-unchanged', 'De extensie verandert de tekst niet.'),
        );
        parts.push(notes);
      }
      view.preview.replaceChildren(...parts);
    }

    function mail(group) {
      const card = el('div', 'ebs-rm-mail');
      const head = el('div', 'ebs-rm-mail-head');
      const copy = copyInput()?.value?.trim() ?? '';
      head.append(el('span', '', `Aan: ${group.email || 'geen e-mailadres bekend'}${copy ? ` · Kopie: ${copy}` : ''}`));
      const template = currentTemplate();
      const text = template?.id ? state.texts.get(template.id) : null;
      const subject = el('span', 'ebs-rm-mail-subject', text?.subject || (template ? `Onderwerp uit het sjabloon ${template.name}` : 'Kies een sjabloon'));
      head.append(subject);
      if (attachBox()?.checked) head.append(el('span', '', `Bijlagen: ${group.rows.map((row) => `Factuur ${row.factuur}.pdf`).join(', ')}`));
      const body = el('div', 'ebs-rm-mail-body');
      if (text && !text.error) {
        body.append(fillTemplate(text.html, group.rows));
        if (group.rows.length > 1) body.append(invoiceTable(group.rows));
      } else {
        const wait = el('div', 'ebs-rm-text-wait');
        if (!template) wait.append(el('span', '', 'Kies hiernaast een sjabloon.'));
        else if (!template.id) wait.append(el('span', '', 'De tekst van dit sjabloon is niet te vinden in de lijst van e-Boekhouden.'));
        else {
          const loading = state.loading === template.id;
          wait.append(el('span', '', text?.error ? 'De tekst van het sjabloon kon niet worden geladen.' : 'De tekst van het sjabloon is nog niet geladen.'));
          const load = button(loading ? 'Bezig…' : text?.error ? 'Opnieuw laden' : 'Tekst laden', 'ebs-rm-load');
          load.disabled = loading;
          load.setAttribute('aria-busy', String(loading));
          wait.append(load);
        }
        body.append(wait, invoiceTable(group.rows));
      }
      card.append(head, body);
      return card;
    }

    function invoiceTable(rows) {
      const table = el('table', 'ebs-rm-table');
      const tbody = el('tbody');
      for (const row of rows) {
        const tr = el('tr');
        tr.append(el('td', '', row.factuur), el('td', '', row.date), el('td', 'right', money(row.open)));
        tbody.append(tr);
      }
      const total = el('tr', 'total');
      const label = el('td', '', 'Totaal open');
      label.colSpan = 2;
      total.append(label, el('td', 'right', money(rows.reduce((sum, row) => sum + (Number.isFinite(row.open) ? row.open : 0), 0))));
      tbody.append(total);
      table.append(tbody);
      return table;
    }

    // The template's HTML, rebuilt from plain elements and text only (no
    // attributes, no scripts, no links), with the known codes filled in.
    const ALLOWED = new Set(['P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'SPAN', 'DIV', 'H1', 'H2', 'H3', 'H4', 'BLOCKQUOTE']);
    const CODE = /\[[A-Z][A-Z0-9_]*\]/g;

    function codesFor(rows) {
      const now = new Date();
      const codes = { '[DATUM]': `${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${now.getFullYear()}` };
      if (rows.length === 1) {
        const [row] = rows;
        const format = (value) => (Number.isFinite(value) ? EBS.formatMoney(value) : null);
        Object.assign(codes, {
          '[FACTNUMMER]': row.factuur || null,
          '[FACTDATUM]': row.date || null,
          '[TOTAAL]': format(row.amount),
          '[OPENSTAAND]': format(row.open),
          '[VOLDAAN]': Number.isFinite(row.amount) && Number.isFinite(row.open) ? EBS.formatMoney(row.amount - row.open) : null,
        });
      }
      return codes;
    }

    function fillTemplate(source, rows) {
      const codes = codesFor(rows);
      const parsed = new DOMParser().parseFromString(`<body>${source}</body>`, 'text/html');
      const out = document.createDocumentFragment();
      const copy = (from, into) => {
        for (const node of from.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            into.append(...fillText(node.textContent, codes));
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (['SCRIPT', 'STYLE', 'TEMPLATE', 'IFRAME', 'OBJECT', 'NOSCRIPT'].includes(node.tagName)) continue;
            if (ALLOWED.has(node.tagName)) {
              const next = document.createElement(node.tagName.toLowerCase());
              copy(node, next);
              into.append(next);
            } else copy(node, into);
          }
        }
      };
      copy(parsed.body, out);
      return out;
    }

    function fillText(text, codes) {
      const parts = [];
      let at = 0;
      for (const match of text.matchAll(CODE)) {
        if (match.index > at) parts.push(document.createTextNode(text.slice(at, match.index)));
        const value = codes[match[0]];
        if (value) parts.push(el('span', 'ebs-rm-filled', value));
        else parts.push(el('span', 'ebs-rm-code', match[0]));
        at = match.index + match[0].length;
      }
      if (at < text.length) parts.push(document.createTextNode(text.slice(at)));
      return parts;
    }

    function drawResult() {
      const stage = state.stage;
      html.classList.toggle('ebs-rm-done', stage !== 'main');
      view.result.classList.toggle('shown', stage !== 'main');
      view.result.inert = stage === 'main';
      if (stage === 'main') return;
      const email = state.payload?.soort !== 'P';
      const info = infoBox();
      let icon = 'loader-circle';
      let tone = 'busy';
      let title = email ? 'e-Boekhouden verstuurt de e-mails' : 'e-Boekhouden maakt de aanmaningen';
      let text = 'Dit venster sluit niet vanzelf; je ziet zo de bevestiging van e-Boekhouden.';
      let label = 'Bezig…';
      if (stage === 'done') {
        const partly = /niet verstuurd/i.test(info?.message ?? '');
        icon = partly ? 'triangle-alert' : 'check';
        tone = partly ? 'warn' : 'ok';
        title = info?.title || 'Klaar';
        text = info?.message ?? '';
        label = partly ? 'Terug naar het overzicht' : 'Terug naar open posten';
      } else if (stage === 'failed') {
        icon = 'triangle-alert';
        tone = 'warn';
        title = 'Dit venster kan niet verder';
        text = state.error || info?.message || 'e-Boekhouden gaf een melding.';
        label = 'Sluiten';
      }
      if (view.result.dataset.icon !== icon) {
        view.result.dataset.icon = icon;
        view.resultIcon.replaceChildren(EBS.icon(icon, { size: 28 }));
      }
      view.resultIcon.className = `ebs-rm-result-icon ${tone}`;
      view.resultTitle.textContent = title;
      view.resultText.textContent = text;
      view.resultButton.textContent = label;
      view.resultButton.disabled = stage === 'sending';
      view.resultButton.setAttribute('aria-busy', String(stage === 'sending'));
      view.resultButton.className = `ebs-rm-result-button ${tone}`;
    }

    // -- the loop -------------------------------------------------------------

    let scheduled = false;
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        render();
      });
    }

    function render() {
      if (!document.body) return;
      if (!view.root?.isConnected) view.build();
      const info = infoBox();
      const send = sendButton();
      send?.classList.add('ebs-rm-send');
      if (send && !send.hasAttribute('aria-label')) send.setAttribute('aria-label', state.payload?.soort === 'P' ? 'Pdf maken (Verder)' : 'Versturen (Verder)');
      const error = nativeError();
      // e-Boekhouden's own outcome, in its own words.
      if (info?.title) state.stage = 'done';
      else if (info?.message && !form()) {
        state.stage = 'failed';
        state.error = info.message;
      } else if (!form() && error && !state.ready) {
        state.stage = 'failed';
        state.error = error;
      } else if (state.stage !== 'done' && state.stage !== 'failed') {
        const clicked = state.sendClickedAt && Date.now() - state.sendClickedAt < 120_000;
        if (clicked && send?.disabled) state.stage = 'sending';
        else if (state.stage === 'sending' && send && !send.disabled) {
          state.stage = 'main';
          state.sendClickedAt = 0;
        }
        state.error = state.stage === 'main' && error ? error : '';
      }
      const native = form();
      if (native) {
        const height = Math.ceil(native.getBoundingClientRect().height);
        if (height > 0) view.slot.style.height = `${height}px`;
      }
      if (state.payload && (native || state.stage !== 'main') && !state.ready) {
        state.ready = true;
        loadTemplates();
        post({ type: 'ready' });
      }
      if (state.payload && templateInput()) pickTemplate();
      if (state.stage !== state.postedStage) {
        state.postedStage = state.stage;
        post({ type: 'stage', stage: state.stage });
      }
      draw();
    }

    function start() {
      const OURS = '.ebs-rm, #ebs-remind-frame-style';
      new MutationObserver((records) => {
        if (records.some((record) => {
          const node = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
          return Boolean(node?.isConnected) && !node.closest(OURS);
        })) schedule();
      }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'value'] });
      if (typeof ResizeObserver === 'function') new ResizeObserver(() => schedule()).observe(document.documentElement);
      schedule();
    }

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  function injectFrameStyle() {
    if (document.getElementById('ebs-remind-frame-style')) return;
    const style = document.createElement('style');
    style.id = 'ebs-remind-frame-style';
    style.textContent = FRAME_CSS;
    document.documentElement.append(style);
  }
})();
