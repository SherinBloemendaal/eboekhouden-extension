// EB Sessions: e-Boekhouden's pop-up windows as a dialog in the page. Setting: popupDialogs.
//
// e-Boekhouden opens about 70 small windows of a fixed size: help, print
// previews, forms that post into a named window, pickers that send their
// choice back with window.opener.postMessage. With the switch on, such a
// popup opens in an EBS.dialog in the page that opened it, in an iframe
// named ebs-popup-<id>. The page gets that frame's window from window.open,
// so window.open(...).focus(), w.closed and w.document.write work; inside,
// window.opener is the page that opened it and window.close() closes the
// dialog (main-world.js, popupFrame).
//
// Which popups (asked by the bridge during a click of the user only):
//   dialog       window.open with a size (width or height in the features) to
//                an https page on secure*.e-boekhouden.nl (relative URLs too),
//                to '_blank' or a name; an empty one without a name, that the
//                page writes into (a print preview); a form posted to a name
//                that is not a frame of the page
//   real window  an empty one with a name (bunqauth..., idealpay...: OAuth and
//                payment, the address follows), and every later popup or form
//                to that name; www, other sites, blob: URLs, a popup without a
//                size ('_blank' links: a new tab); _self, _top and _parent
//
// Roles, per frame (this file runs in every e-Boekhouden frame):
//   opener       any frame: makes the dialogs for its own popups. On a classic
//                page that is the content frame, so the dialog covers that.
//   popup frame  a frame named ebs-popup-*: turns on popupFrame before the
//                page's first script, and tells the opener (postMessage, kind
//                hello/ready/title/escape/close) what goes on inside.
//   top          a secure20 page in a frame thinks it is embedded
//                (hybridModeDetected: window !== top) and sends to top what it
//                would send to window.opener in a popup of its own (POPUP=1).
//                The top frame sends those on to the popup's opener; the rest
//                (jwterror, settings) stays with top, as from any embedded page.
//
// The extension refreshes nothing itself: a page that is reloaded after a
// popup closes is e-Boekhouden's own doing (opener.location.reload(), a
// 'reload' message), as with a popup window.

(() => {
  if (window.__ebsPopupsLoaded) return;
  window.__ebsPopupsLoaded = true;

  const { EBS } = window;
  if (!EBS?.bridge || !EBS.dialog) return;

  const APP_ORIGIN = /^https:\/\/secure\d*\.e-boekhouden\.nl$/;
  const POPUP_FRAME = /^ebs-popup-[a-z0-9]{1,24}$/;
  // Not given by e-Boekhouden for a form posted into a named window.
  const FORM_SIZE = { width: 960, height: 720 };
  const LOAD_TIMEOUT_MS = 10_000;
  // A frame that loaded without a word from its page shows Chrome's error
  // page (refused, or not e-Boekhouden): wait this long for the word.
  const NO_PAGE_MS = 500;
  const TOAST_MS = 5000;
  const PRINT_PAGE = /print|afdruk/i;
  const SESSION_PAGE = /^\/(bh\/inloggen\.asp|bh\/jwterror\.asp|v1login|sessie-verlopen)$/i;

  const TEXT = {
    loading: 'Bezig met laden…',
    print: 'Afdrukken',
    newWindow: 'Nieuw venster',
    newWindowTitle: 'Openen in een nieuw venster',
    refusedTitle: 'Deze pagina wil niet in een venster',
    refused: 'e-Boekhouden laat deze pagina alleen als los venster zien. Open hem zoals gewoonlijk; er is niets verloren.',
    refusedForm: 'e-Boekhouden laat deze pagina alleen als los venster zien. Sluit dit venster en probeer het opnieuw; er is niets verloren.',
    sessionTitle: 'Je sessie is verlopen',
    session: 'Sluit dit venster en log opnieuw in. Daarna kun je het weer openen.',
    preview: 'Afdrukvoorbeeld',
    closedByPage: 'Venster gesloten door e-Boekhouden.',
    external: 'Betalen en koppelen met een bank of webshop openen als echt venster: daar log je in bij een andere partij.',
  };

  const isTop = window === window.top;
  const inPopupFrame = !isTop && POPUP_FRAME.test(window.name);

  let enabled = false;
  let betterDesign = false;
  // "Nieuw venster" opens a real popup with the browser's own window.open;
  // that one is not asked about again.
  let openingForReal = false;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function appUrl(value) {
    if (typeof value !== 'string' || !value) return null;
    try {
      const url = new URL(String(value), location.href);
      return url.protocol === 'https:' && APP_ORIGIN.test(url.origin) ? url : null;
    } catch {
      return null;
    }
  }

  // "secure.e-boekhouden.nl/bh/herinnering.asp?ID=12", as the board shows it.
  function shortUrl(url) {
    return `${url.host}${url.pathname}${url.search}`;
  }

  function randomId() {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  // "width=800,height=600,scrollbars=yes" or "height=1000, width=1200":
  // { width, height }, or null without a size (a new tab, not a popup).
  function sizeOf(features) {
    const read = (name) => {
      const match = new RegExp(`(?:^|[,\\s])(?:inner)?${name}\\s*=\\s*(\\d+)`, 'i').exec(features);
      const number = match ? Number(match[1]) : 0;
      return number > 0 ? number : null;
    };
    const width = read('width');
    const height = read('height');
    if (!width && !height) return null;
    return { width: width ?? 800, height: height ?? 600 };
  }

  // A frame of the page by that name (a frameset's hiddenframe, an iframe):
  // a form posted there stays the page's own business. Every window up to
  // top: its frame elements where its document is readable, and its child
  // frames by name (also across origins).
  function frameExists(name) {
    let win = window;
    for (let depth = 0; depth < 12; depth += 1) {
      try {
        if ([...win.document.getElementsByName(name)].some((node) => /^i?frame$/i.test(node.tagName))) return true;
      } catch { /* another origin */ }
      try {
        const candidate = win[name];
        if (candidate) {
          for (let i = 0; i < win.frames.length; i += 1) {
            if (win.frames[i] === candidate) return true;
          }
        }
      } catch { /* not readable from here */ }
      if (win === win.parent) break;
      win = win.parent;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Opener: the dialogs for this frame's popups.
  // -------------------------------------------------------------------------

  const sessions = new Set();
  const byFrame = new Map();
  const byTarget = new Map();
  // Names the page opened as a real window: popups and forms to them follow.
  const realNames = new Set();

  function sessionOf(source) {
    if (!source) return null;
    for (const session of sessions) {
      if (session.iframe.contentWindow === source) return session;
    }
    return null;
  }

  function onWindowOpen({ url, target, features }) {
    if (!enabled || openingForReal) return null;
    const name = target.trim();
    const lower = name.toLowerCase();
    if (lower === '_self' || lower === '_top' || lower === '_parent') return null;
    const named = name !== '' && lower !== '_blank';
    const blank = url === 'about:blank';
    const existing = named ? byTarget.get(name) : null;
    if (existing) {
      // The same name again: that window, sent to the new page.
      const next = blank ? null : appUrl(url);
      if (next) existing.navigate(next);
      return { claim: true, frame: existing.frame };
    }
    if (named && realNames.has(name)) return null;
    if (blank && named) {
      // OAuth and payment: e-Boekhouden opens them empty with a name and
      // sets the address afterwards, at a bank or webshop.
      realNames.add(name);
      explainOnce();
      return null;
    }
    const size = sizeOf(features);
    if (!size) return null;
    const page = blank ? null : appUrl(url);
    if (!blank && !page) return null;
    const session = openSession({ kind: blank ? 'write' : 'page', url: page, target: named ? name : '', features, size });
    return { claim: true, frame: session.frame };
  }

  function onFormSubmit({ action, target }) {
    if (!enabled) return null;
    const name = target.trim();
    if (!name || name.startsWith('_')) return null;
    const existing = byTarget.get(name);
    if (existing) {
      existing.expectPage();
      return { retarget: existing.frame };
    }
    if (realNames.has(name) || frameExists(name)) return null;
    const url = appUrl(action);
    if (!url) return null;
    const session = openSession({ kind: 'form', url, target: name, features: '', size: FORM_SIZE });
    return { retarget: session.frame };
  }

  function onPopupClose({ frame }) {
    if (frame) byFrame.get(frame)?.closeByPage();
    else if (inPopupFrame) tellOpener('close');
  }

  function titleFor(kind, url, target) {
    if (kind === 'write') return TEXT.preview;
    if (url && PRINT_PAGE.test(url.pathname)) return TEXT.print;
    if (/^[A-Za-z][A-Za-z ]{2,40}$/.test(target)) return target;
    return 'e-Boekhouden';
  }

  // kind: 'page' (window.open with an address), 'write' (an empty popup the
  // page writes into) or 'form' (a form posted to a name).
  function openSession({ kind, url, target, features, size }) {
    injectStyle();
    const frame = `ebs-popup-${randomId()}`;
    const iframe = el('iframe', 'ebs-popup-frame');
    iframe.name = frame;
    iframe.title = titleFor(kind, url, target);
    // Before the frame is in the page, so it never shows an empty page first.
    // The form's own submit fills a frame without an address.
    if (kind === 'page') iframe.src = url.href;
    const stage = el('div', 'ebs-popup-stage');
    const skeleton = el('div', 'ebs-popup-skeleton');
    skeleton.setAttribute('role', 'status');
    skeleton.setAttribute('aria-label', TEXT.loading);
    for (const className of ['a', 'b', 'c', 'd']) skeleton.append(el('span', `ebs-popup-skel-${className}`));
    const problem = el('div', 'ebs-popup-problem');
    problem.setAttribute('role', 'alert');
    const problemTitle = el('span', 'ebs-popup-problem-title');
    const problemText = el('span', 'ebs-popup-problem-text');
    const reopen = el('button', 'ebs-popup-primary', TEXT.newWindowTitle);
    reopen.type = 'button';
    problem.append(problemTitle, problemText, reopen);
    stage.append(iframe, skeleton, problem);

    const print = kind === 'write' || Boolean(url && PRINT_PAGE.test(url.pathname));
    const actions = [];
    const printButton = el('button', 'ebs-popup-print');
    printButton.type = 'button';
    printButton.append(EBS.icon('printer'), document.createTextNode(TEXT.print));
    if (print) actions.push(printButton);
    // Only a page with an address can open again on its own: not a preview
    // the page wrote, not the answer to a form.
    const newWindow = el('button', 'ebs-popup-secondary');
    newWindow.type = 'button';
    newWindow.title = TEXT.newWindowTitle;
    newWindow.append(document.createTextNode(TEXT.newWindow), EBS.icon('external-link'));
    if (kind === 'page') actions.push(newWindow);

    const session = {
      frame, kind, target, features, iframe,
      url: kind === 'write' ? null : url,
      open: true,
      heard: false,
      timers: new Set(),
      handle: null,
      later(ms, fn) {
        const timer = setTimeout(() => {
          session.timers.delete(timer);
          if (session.open) fn();
        }, ms);
        session.timers.add(timer);
      },
      clearTimers() {
        for (const timer of session.timers) clearTimeout(timer);
        session.timers.clear();
      },
      showLoading() {
        stage.classList.remove('ready', 'problem');
        stage.classList.add('loading');
      },
      showReady() {
        stage.classList.remove('loading', 'problem');
        stage.classList.add('ready');
      },
      showProblem(kindOfProblem) {
        const form = kindOfProblem === 'refused' && session.kind !== 'page';
        problemTitle.textContent = kindOfProblem === 'session' ? TEXT.sessionTitle : TEXT.refusedTitle;
        problemText.textContent = kindOfProblem === 'session' ? TEXT.session : form ? TEXT.refusedForm : TEXT.refused;
        reopen.hidden = kindOfProblem === 'session' || form;
        stage.classList.remove('loading', 'ready');
        stage.classList.add('problem');
      },
      // A new page is on its way into the frame (a navigation, a form).
      expectPage() {
        session.heard = false;
        session.clearTimers();
        session.showLoading();
        session.later(LOAD_TIMEOUT_MS, () => session.showProblem('refused'));
      },
      navigate(next) {
        // A preview window that gets an address is a page from now on.
        session.kind = 'page';
        session.url = next;
        session.expectPage();
        iframe.src = next.href;
      },
      setPage({ title, href }) {
        const page = appUrl(href);
        if (page) {
          session.url = page;
          session.handle.setTitle(title || titleFor(session.kind, page, session.target), shortUrl(page));
        } else if (title) {
          session.handle.setTitle(title);
        }
        if (title) iframe.title = title;
      },
      closeByPage() {
        session.handle.close({ reason: 'page' });
      },
    };

    printButton.addEventListener('click', () => {
      if (session.kind === 'write') {
        try {
          iframe.contentWindow?.print();
        } catch { /* gone */ }
      } else {
        tellFrame(session, 'print');
      }
    });
    const openForReal = () => {
      const href = session.url?.href;
      if (!href) return;
      // The browser's own window.open during this click, with the size
      // e-Boekhouden asked for; the page becomes its opener, as before.
      openingForReal = true;
      let opened = null;
      try {
        opened = window.open(href, session.target || '_blank', session.features);
      } finally {
        openingForReal = false;
      }
      if (opened && session.target) realNames.add(session.target);
      session.handle.close({ reason: 'fallback' });
    };
    newWindow.addEventListener('click', openForReal);
    reopen.addEventListener('click', openForReal);

    // The empty document a frame starts with (same origin, so readable).
    const stillBlank = () => {
      try {
        return iframe.contentWindow.location.href === 'about:blank';
      } catch {
        return false;
      }
    };
    iframe.addEventListener('load', () => {
      if (!session.open || session.kind === 'write' || session.heard || stillBlank()) return;
      // Chrome's own error page, or a page without this extension in it.
      session.later(NO_PAGE_MS, () => {
        if (!session.heard) session.showProblem('refused');
      });
    });

    const source = session.url ? shortUrl(session.url) : `${TEXT.preview} van ${location.host}${location.pathname}`;
    session.handle = EBS.dialog.open({
      title: titleFor(kind, url, target),
      subtitle: source,
      content: stage,
      width: size.width,
      height: size.height,
      actions,
      className: 'ebs-popup',
      onClose: (reason) => finish(session, reason),
    });
    session.handle.body.classList.add('ebs-popup-body');
    underNavbar(session.handle.host);

    sessions.add(session);
    byFrame.set(frame, session);
    if (target) byTarget.set(target, session);

    if (kind === 'write') {
      session.showReady();
      watchWrittenTitle(session);
    } else {
      session.expectPage();
    }
    return session;
  }

  function finish(session, reason) {
    session.open = false;
    session.clearTimers();
    session.titleObserver?.disconnect();
    sessions.delete(session);
    byFrame.delete(session.frame);
    if (byTarget.get(session.target) === session) byTarget.delete(session.target);
    if (reason === 'page') toast(TEXT.closedByPage, 'done');
  }

  // The preview the page writes into the empty frame: its <title> is the
  // dialog's title.
  function watchWrittenTitle(session) {
    const read = () => {
      try {
        const title = session.iframe.contentDocument?.title?.trim();
        if (title) session.handle.setTitle(title);
      } catch { /* gone */ }
    };
    try {
      const target = session.iframe.contentDocument;
      if (!target || typeof MutationObserver !== 'function') return;
      session.titleObserver = new MutationObserver(read);
      session.titleObserver.observe(target, { childList: true, subtree: true, characterData: true });
    } catch { /* no document to watch */ }
  }

  // The dialog starts under e-Boekhouden's navbar, as on the board: on a
  // classic page the frame of the page is already below it.
  function underNavbar(host) {
    const header = document.querySelector('#navHeader, app-eb-header');
    if (!header) return;
    const rect = header.getBoundingClientRect();
    if (rect.top <= 0 && rect.bottom > 0 && rect.bottom < window.innerHeight / 3) host.style.top = `${Math.round(rect.bottom)}px`;
  }

  function tellFrame(session, kind) {
    try {
      const origin = session.url?.origin;
      if (origin) session.iframe.contentWindow?.postMessage({ ebs: 'popup', kind }, origin);
    } catch { /* gone */ }
  }

  function onSessionMessage(session, data) {
    switch (data.kind) {
      case 'hello':
        session.heard = true;
        break;
      case 'ready':
        session.heard = true;
        session.clearTimers();
        session.setPage({ title: typeof data.title === 'string' ? data.title.slice(0, 200).trim() : '', href: data.url });
        if (data.session === true) {
          session.showProblem('session');
        } else {
          session.showReady();
          try {
            if (session.iframe.ownerDocument.activeElement === session.handle.panel.querySelector('.ebs-dialog-close')) session.iframe.focus();
          } catch { /* fine where it is */ }
        }
        break;
      case 'title':
        if (typeof data.title === 'string' && data.title.trim()) session.setPage({ title: data.title.slice(0, 200).trim(), href: null });
        break;
      case 'escape':
        session.handle.close({ reason: 'escape' });
        break;
      case 'close':
        session.closeByPage();
        break;
      default:
    }
  }

  // -------------------------------------------------------------------------
  // Top: what a secure20 popup of a classic page sends to top goes to its
  // opener, as it would from a popup window.
  // -------------------------------------------------------------------------

  // A popup frame's window (WindowProxy, also across origins) -> { v1 }.
  const popupFrames = new WeakMap();

  function forwardToOpener(event) {
    const known = popupFrames.get(event.source);
    if (!known?.v1) return false;
    let opener = null;
    try {
      opener = event.source.parent;
    } catch {
      return false;
    }
    if (!opener || opener === window) return false;
    try {
      opener.postMessage(event.data, '*');
    } catch {
      return false;
    }
    return true;
  }

  // Before the page's own listeners (this one is there from document_start):
  // the page never sees the extension's own messages.
  window.addEventListener('message', (event) => {
    const { data, source } = event;
    if (!source) return;
    if (data && typeof data === 'object' && data.ebs === 'popup' && APP_ORIGIN.test(event.origin)) {
      if (isTop && data.kind === 'frame') {
        popupFrames.set(source, { v1: data.v1 === true });
        event.stopImmediatePropagation();
        return;
      }
      const session = sessionOf(source);
      if (session) {
        event.stopImmediatePropagation();
        onSessionMessage(session, data);
      }
      return;
    }
    if (isTop && forwardToOpener(event)) event.stopImmediatePropagation();
  }, true);

  // -------------------------------------------------------------------------
  // Popup frame: the page inside a dialog.
  // -------------------------------------------------------------------------

  function tellOpener(kind, extra = {}) {
    try {
      const origin = location.ancestorOrigins?.[0] ?? '*';
      window.parent.postMessage({ ebs: 'popup', kind, ...extra }, origin);
    } catch { /* the opener is gone */ }
  }

  function runPopupFrame() {
    // Before the page's first script: window.opener and window.close().
    EBS.bridge.enable('popupFrame');
    tellOpener('hello');
    if (window.parent !== window.top) {
      const v1 = new URLSearchParams(location.search).get('POPUP') === '1';
      try {
        window.top.postMessage({ ebs: 'popup', kind: 'frame', v1 }, '*');
      } catch { /* no top to tell */ }
    }
    const pageTitle = () => (document.title ?? '').trim();
    const ready = () => tellOpener('ready', { title: pageTitle(), url: location.href, session: SESSION_PAGE.test(location.pathname) });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
    else ready();
    // Angular sets the title once the page is drawn.
    let last = null;
    const sendTitle = () => {
      const title = pageTitle();
      if (title && title !== last) {
        last = title;
        tellOpener('title', { title });
      }
    };
    window.addEventListener('load', () => {
      sendTitle();
      const head = document.head;
      if (head && typeof MutationObserver === 'function') new MutationObserver(sendTitle).observe(head, { childList: true, subtree: true, characterData: true });
    }, { once: true });
    // Escape that the page did not use closes the dialog, as in the parent.
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented) tellOpener('escape');
    });
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent || event.data?.ebs !== 'popup') return;
      event.stopImmediatePropagation();
      if (event.data.kind === 'print') window.print();
    }, true);
  }

  // -------------------------------------------------------------------------
  // Toasts.
  // -------------------------------------------------------------------------

  let currentToast = null;

  function toast(text, kind) {
    injectStyle();
    currentToast?.remove();
    const node = el('div', `ebs-popup-toast ebs-popup-toast-${kind}${betterDesign ? ' ebs-motion' : ''}`);
    node.setAttribute('role', 'status');
    if (kind === 'done') {
      const mark = el('span', 'ebs-popup-toast-mark');
      mark.append(EBS.icon('check', { size: 14 }));
      node.append(mark);
    }
    node.append(el('span', '', text));
    document.body.append(node);
    currentToast = node;
    void node.offsetWidth;
    node.classList.add('show');
    setTimeout(() => {
      node.classList.remove('show');
      setTimeout(() => {
        node.remove();
        if (currentToast === node) currentToast = null;
      }, 200);
    }, TOAST_MS);
  }

  // Once: why a payment or a link with a bank stays a real window.
  async function explainOnce() {
    try {
      const administration = (await EBS.store.currentAdministration()) ?? 'default';
      const store = EBS.store.feature('popups', { administration });
      if (await store.get('explained')) return;
      await store.set('explained', true);
      toast(TEXT.external, 'external');
    } catch (error) {
      console.warn('EB Sessions: pop-up note not saved', error?.message ?? error);
    }
  }

  function injectStyle() {
    if (document.getElementById('ebs-popups-style')) return;
    const style = document.createElement('style');
    style.id = 'ebs-popups-style';
    style.textContent = STYLE;
    (document.head ?? document.documentElement).append(style);
  }

  const STYLE = `
    .ebs-dialog.ebs-popup .ebs-dialog-head { gap: 12px; padding: 14px 18px; }
    .ebs-dialog.ebs-popup .ebs-dialog-titles { gap: 2px; }
    .ebs-dialog.ebs-popup .ebs-dialog-title { font-size: 16px; }
    .ebs-dialog.ebs-popup .ebs-dialog-sub { font-size: 12px; }
    .ebs-dialog.ebs-popup .ebs-dialog-close { width: 34px; height: 34px; transition: background-color 150ms ease, color 150ms ease; }
    .ebs-dialog.ebs-popup .ebs-dialog-close:hover { background: #e6e9f1; }
    .ebs-dialog.ebs-popup .ebs-dialog-body.ebs-popup-body { display: flex; padding: 0; overflow: hidden; background: #fff; }
    .ebs-popup-print, .ebs-popup-secondary, .ebs-popup-primary { flex: none; display: flex; align-items: center; gap: 6px; font-family: Ubuntu, system-ui, sans-serif; cursor: pointer; transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease; }
    .ebs-popup-print { height: 34px; padding: 0 12px; border: 0; border-radius: 8px; background: #232c4f; color: #fff; font-size: 13px; font-weight: 700; }
    .ebs-popup-print:hover { background: #30395f; }
    .ebs-popup-secondary { height: 34px; padding: 0 10px; border: 1px solid #cfd4e2; border-radius: 8px; background: #fff; color: #232c4f; font-size: 13px; }
    .ebs-popup-secondary:hover { background: #f3f5fa; border-color: #b9c0d3; }
    .ebs-popup-print svg, .ebs-popup-secondary svg { flex: none; }
    .ebs-popup-stage { position: relative; flex: 1; display: flex; min-width: 0; min-height: 0; }
    .ebs-popup-frame { flex: 1; width: 100%; height: 100%; border: 0; background: #fff; }
    .ebs-popup-skeleton, .ebs-popup-problem { position: absolute; inset: 0; background: #fff; transition: opacity 150ms ease-out, transform 150ms ease-out, visibility 0s linear 150ms; }
    .ebs-popup-skeleton { display: flex; flex-direction: column; gap: 12px; padding: 20px; opacity: 0; visibility: hidden; }
    .ebs-popup-skeleton span { display: block; animation: ebs-popup-shimmer 1200ms ease-in-out infinite; }
    .ebs-popup-skel-a { height: 16px; width: 220px; max-width: 100%; border-radius: 8px; background: #e6e9f1; }
    .ebs-popup-skel-b { height: 10px; border-radius: 5px; background: #eef0f5; }
    .ebs-popup-skel-c { height: 10px; width: 80%; border-radius: 5px; background: #eef0f5; }
    .ebs-popup-skel-d { height: 120px; border-radius: 10px; background: #f3f5fa; }
    .ebs-popup-stage.loading .ebs-popup-skeleton { opacity: 1; visibility: visible; transition: opacity 150ms ease-out, visibility 0s; }
    .ebs-popup-problem { display: flex; align-items: center; justify-content: center; padding: 20px; opacity: 0; visibility: hidden; transform: translateY(4px); }
    .ebs-popup-problem > * { max-width: 420px; }
    .ebs-popup-problem { flex-direction: column; gap: 10px; text-align: center; }
    .ebs-popup-stage.problem .ebs-popup-problem { opacity: 1; visibility: visible; transform: none; transition: opacity 150ms ease-out, transform 150ms ease-out, visibility 0s; }
    .ebs-popup-problem-title { font-size: 15px; font-weight: 700; color: #232c4f; }
    .ebs-popup-problem-text { font-size: 13px; color: #5d6584; }
    .ebs-popup-primary { height: 38px; padding: 0 16px; border: 0; border-radius: 9px; background: #232c4f; color: #fff; font-size: 14px; font-weight: 700; }
    .ebs-popup-primary:hover { background: #30395f; }
    .ebs-popup-primary[hidden] { display: none; }
    .ebs-popup-print:focus-visible, .ebs-popup-secondary:focus-visible, .ebs-popup-primary:focus-visible { outline: 2px solid #232c4f; outline-offset: 2px; }
    @keyframes ebs-popup-shimmer { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }

    .ebs-popup-toast { position: fixed; bottom: 28px; z-index: 2147483200; display: flex; align-items: center; gap: 10px; box-sizing: border-box; padding: 12px 16px; border-radius: 12px; background: #232c4f; color: #fff; font: 13px/1.4 Ubuntu, system-ui, sans-serif; box-shadow: 0 12px 32px rgba(20, 26, 48, .3); opacity: 0; transform: translateY(8px); transition: opacity 150ms ease-out, transform 150ms ease-out; pointer-events: none; }
    .ebs-popup-toast.ebs-motion { transform: translateY(12px); transition-duration: 200ms; transition-timing-function: cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-popup-toast.show { opacity: 1; transform: none; }
    .ebs-popup-toast-done { left: 50%; width: 380px; max-width: calc(100vw - 32px); margin-left: -190px; }
    .ebs-popup-toast-external { left: 32px; max-width: min(520px, calc(100vw - 64px)); }
    .ebs-popup-toast-mark { flex: none; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: #5d9e35; }
    @media (max-width: 420px) { .ebs-popup-toast-done { left: 16px; margin-left: 0; } }
    @media (prefers-reduced-motion: reduce) {
      .ebs-popup-skeleton span { animation: none; }
      .ebs-popup-problem, .ebs-popup-stage.problem .ebs-popup-problem { transform: none; }
      .ebs-popup-toast, .ebs-popup-toast.ebs-motion { transform: none; transition: opacity 150ms ease-out; }
    }
  `;

  // -------------------------------------------------------------------------
  // Start.
  // -------------------------------------------------------------------------

  EBS.bridge.on('popupClose', onPopupClose);
  if (inPopupFrame) runPopupFrame();

  EBS.bridge.intercept('windowOpen', onWindowOpen);
  EBS.bridge.intercept('formSubmit', onFormSubmit);
  EBS.watchSettings((settings) => {
    betterDesign = Boolean(settings.betterDesign);
    const next = Boolean(settings.popupDialogs);
    if (next === enabled) return;
    enabled = next;
    for (const hook of ['windowOpen', 'formTarget']) {
      if (enabled) EBS.bridge.enable(hook);
      else EBS.bridge.disable(hook);
    }
  });
})();
