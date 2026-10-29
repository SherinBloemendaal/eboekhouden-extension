// EB Sessions: the shared in-app dialog, as EBS.dialog.
//
//   const dialog = EBS.dialog.open({
//     title: 'Mutatie aanmaken', subtitle: 'Demo Klant B.V. · + € 3.500,00',
//     src: 'https://secure20.e-boekhouden.nl/...',   // or content: someNode
//     width: 1040, height: 760,
//   });
//   dialog.setError('Dat lukte niet.', { fallbackUrl: url });
//   dialog.close();
//
// open(options):
//   title, subtitle      the head; label is the accessible name if there is no title
//   content              a node for the body (the content slot), or
//   src, frameTitle      a same-origin e-Boekhouden page in an iframe
//   loading, ready       the text over the body while it loads (default
//                        'Bezig met laden…'); ready: 'load' (default for src)
//                        lifts it when the iframe has loaded, 'manual' leaves
//                        that to setReady(); without src the body shows at once
//                        unless loading is given
//   fallbackUrl          offered as "Openen in een nieuw venster" with an error.
//                        A frame that cannot show its page (it went to another
//                        site, or the browser refused it) gets an error by
//                        itself, with this link or else one to src
//   actions              nodes in the head, before the close button
//   footer               a node, a list of nodes or a text; none: no footer
//   width, height        requested size in px, clamped to the viewport (24 px
//                        margin); without height the panel fits its content
//   returnFocus          an element, or a function that returns one at close;
//                        default: what had focus when the dialog opened
//   closeOnBackdrop      default true
//   motion               default: on with Better design, off without it
//   className, onClose(reason)
//
// While it is open the page behind is inert, Tab stays inside the dialog and
// Escape closes it, also from inside a same-origin iframe (unless something in
// there used the key). Open and close are transitions, so a close during the
// opening turns the same motion around.

(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const { EBS } = root;
  if (!EBS || EBS.dialog) return;

  const MARGIN = 24;
  const CLOSE_MS = 120;
  const APP_ORIGIN = /^https:\/\/secure\d*\.e-boekhouden\.nl$/;
  const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

  let betterDesign = false;
  EBS.watchSettings((settings) => {
    betterDesign = Boolean(settings.betterDesign);
  });

  const stack = [];
  // Nodes this module made inert, so only those are given back.
  const madeInert = new Set();
  let bodyObserver = null;
  let sequence = 0;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function appUrl(value) {
    try {
      const url = new URL(String(value), location.href);
      return APP_ORIGIN.test(url.origin) ? url.href : null;
    } catch {
      return null;
    }
  }

  function px(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
  }

  // Everything in <body> except the dialog on top is inert. Run after every
  // open and close, and when the page adds something to <body> meanwhile.
  function syncInert() {
    const top = stack.at(-1)?.host ?? null;
    if (!top) {
      for (const node of madeInert) node.inert = false;
      madeInert.clear();
      bodyObserver?.disconnect();
      bodyObserver = null;
      return;
    }
    for (const child of document.body.children) {
      if (child === top) {
        if (madeInert.delete(child)) child.inert = false;
      } else if (!child.inert) {
        child.inert = true;
        madeInert.add(child);
      }
    }
    for (const node of [...madeInert]) {
      if (!node.isConnected) madeInert.delete(node);
    }
    if (!bodyObserver && typeof MutationObserver === 'function') {
      bodyObserver = new MutationObserver(() => syncInert());
      bodyObserver.observe(document.body, { childList: true });
    }
  }

  function tabbables(panel) {
    return [...panel.querySelectorAll(TABBABLE)].filter((node) => !node.classList.contains('ebs-dialog-sentinel')
      && !node.closest('[hidden]') && node.getClientRects().length > 0);
  }

  function injectStyle() {
    if (document.getElementById('ebs-dialog-style')) return;
    const style = document.createElement('style');
    style.id = 'ebs-dialog-style';
    style.textContent = STYLE;
    (document.head ?? document.documentElement).append(style);
  }

  // Escape in the document behind the dialog's own nodes (focus fell back to
  // <body>): the dialog's own key handler does not see that one.
  function onDocumentKey(event) {
    const top = stack.at(-1);
    if (!top || event.key !== 'Escape' || event.isComposing || top.host.contains(event.target)) return;
    top.close({ reason: 'escape' });
  }

  function onFocusIn(event) {
    const top = stack.at(-1);
    if (!top || top.host.contains(event.target)) return;
    (tabbables(top.panel)[0] ?? top.panel).focus({ preventScroll: true });
  }

  function open(options = {}) {
    injectStyle();
    sequence += 1;
    const titleId = `ebs-dialog-title-${sequence}`;
    const opener = document.activeElement;
    const motion = options.motion ?? betterDesign;
    const src = options.src === undefined ? null : appUrl(options.src);
    if (options.src !== undefined && !src) throw new Error('EBS.dialog: src must be an e-Boekhouden page');
    const fallbackDefault = options.fallbackUrl === undefined ? null : appUrl(options.fallbackUrl);

    const host = el('div', `ebs-dialog-backdrop${motion ? ' ebs-motion' : ''}`);
    const panel = el('div', `ebs-dialog${options.className ? ` ${options.className}` : ''}`);
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.tabIndex = -1;
    const width = px(options.width) ?? 560;
    const height = px(options.height);
    panel.style.width = `min(${width}px, calc(100vw - ${MARGIN * 2}px))`;
    if (height) panel.style.height = `min(${height}px, calc(100vh - ${MARGIN * 2}px))`;

    const head = el('div', 'ebs-dialog-head');
    const titles = el('span', 'ebs-dialog-titles');
    const title = el('span', 'ebs-dialog-title', options.title ?? '');
    title.id = titleId;
    const subtitle = el('span', 'ebs-dialog-sub', options.subtitle ?? '');
    subtitle.hidden = !options.subtitle;
    titles.append(title, subtitle);
    if (options.title) panel.setAttribute('aria-labelledby', titleId);
    else if (options.label) panel.setAttribute('aria-label', String(options.label));
    const close = el('button', 'ebs-dialog-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Sluiten');
    close.title = 'Sluiten';
    close.append(EBS.icon ? EBS.icon('x', { size: 18 }) : document.createTextNode('✕'));
    head.append(titles, ...(options.actions ?? []), close);

    const body = el('div', 'ebs-dialog-body');
    let frame = null;
    if (src) {
      frame = el('iframe', 'ebs-dialog-frame');
      frame.title = options.frameTitle ?? options.title ?? '';
      frame.src = src;
      body.append(frame);
    } else if (options.content) {
      body.classList.add('content');
      body.append(options.content);
    }
    const cover = el('div', 'ebs-dialog-cover');
    cover.setAttribute('role', 'status');
    const coverText = el('span', 'ebs-dialog-cover-text');
    cover.append(coverText);
    body.append(cover);

    let foot = null;
    if (options.footer !== undefined && options.footer !== null) {
      foot = el('div', 'ebs-dialog-foot');
      if (typeof options.footer === 'string') foot.append(el('span', '', options.footer));
      else foot.append(...[].concat(options.footer));
    }

    const start = el('span', 'ebs-dialog-sentinel');
    const end = el('span', 'ebs-dialog-sentinel');
    start.tabIndex = 0;
    end.tabIndex = 0;
    start.setAttribute('aria-hidden', 'true');
    end.setAttribute('aria-hidden', 'true');
    panel.append(start, head, body, ...(foot ? [foot] : []), end);
    host.append(panel);

    let state = 'open';
    let frameWindow = null;

    const handle = {
      host, panel, body, frame, footer: foot,
      get isOpen() {
        return state === 'open';
      },
      setTitle(text, sub) {
        title.textContent = text ?? '';
        if (sub !== undefined) {
          subtitle.textContent = sub ?? '';
          subtitle.hidden = !sub;
        }
      },
      setLoading(text = 'Bezig met laden…') {
        cover.classList.remove('error');
        coverText.textContent = text;
        cover.querySelector('.ebs-dialog-fallback')?.remove();
        cover.hidden = false;
      },
      setReady() {
        cover.hidden = true;
      },
      setError(text, { fallbackUrl } = {}) {
        cover.classList.add('error');
        coverText.textContent = text;
        cover.querySelector('.ebs-dialog-fallback')?.remove();
        const url = fallbackUrl === undefined ? fallbackDefault : appUrl(fallbackUrl);
        if (url) {
          const link = el('a', 'ebs-dialog-fallback', 'Openen in een nieuw venster');
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener';
          link.addEventListener('click', () => handle.close({ reason: 'fallback' }));
          cover.append(link);
        }
        cover.hidden = false;
      },
      close({ immediate = false, reason = 'close' } = {}) {
        if (state !== 'open') return;
        state = 'closing';
        const at = stack.indexOf(handle);
        if (at >= 0) stack.splice(at, 1);
        if (!stack.length) {
          document.removeEventListener('keydown', onDocumentKey, true);
          document.removeEventListener('focusin', onFocusIn, true);
        }
        frame?.removeEventListener('load', onFrameLoad);
        detachFrameKeys();
        syncInert();
        try {
          options.onClose?.(reason);
        } catch (error) {
          console.error('EB Sessions: dialog onClose failed', error);
        }
        // Back to where the dialog came from, also after a redraw.
        let target = null;
        try {
          target = typeof options.returnFocus === 'function' ? options.returnFocus() : options.returnFocus ?? opener;
        } catch { /* nowhere to go back to */ }
        if (target?.isConnected && target !== document.body) target.focus?.({ preventScroll: true });
        if (immediate || !motion) {
          host.remove();
          state = 'closed';
          return;
        }
        host.classList.remove('open');
        host.classList.add('closing');
        setTimeout(() => {
          host.remove();
          state = 'closed';
        }, CLOSE_MS);
      },
    };

    // Escape that ends an IME composition or that something inside used (a
    // dropdown) is not for the dialog.
    function onKey(event) {
      if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented && stack.at(-1) === handle) {
        event.stopPropagation();
        handle.close({ reason: 'escape' });
      }
    }

    function onFrameKey(event) {
      if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented && stack.at(-1) === handle) handle.close({ reason: 'escape' });
    }

    function detachFrameKeys() {
      try {
        frameWindow?.removeEventListener('keydown', onFrameKey);
      } catch { /* the frame went cross-origin */ }
      frameWindow = null;
    }

    // Each page in the frame is a new window: listen again after every load.
    function attachFrameKeys() {
      detachFrameKeys();
      try {
        const win = frame.contentWindow;
        if (!win || win.location.origin !== location.origin) return;
        win.addEventListener('keydown', onFrameKey);
        frameWindow = win;
      } catch { /* cross-origin: its own Escape stays inside it */ }
    }

    // Chrome shows its own error page for a frame it refused (or one that
    // went to another site), which this page cannot read: say so instead of
    // lifting the cover over an empty frame.
    function frameReadable() {
      try {
        return frame.contentWindow?.location.origin === location.origin;
      } catch {
        return false;
      }
    }

    function onFrameLoad() {
      attachFrameKeys();
      if (!frameReadable()) {
        handle.setError('Deze pagina kan hier niet worden getoond.', { fallbackUrl: fallbackDefault ?? src });
        return;
      }
      if ((options.ready ?? 'load') === 'load' && !cover.classList.contains('error')) handle.setReady();
    }

    host.addEventListener('keydown', onKey);
    close.addEventListener('click', () => handle.close({ reason: 'close' }));
    host.addEventListener('mousedown', (event) => {
      if (event.target === host && options.closeOnBackdrop !== false) handle.close({ reason: 'backdrop' });
    });
    start.addEventListener('focus', () => {
      const list = tabbables(panel);
      (list.at(-1) ?? panel).focus({ preventScroll: true });
    });
    end.addEventListener('focus', () => {
      (tabbables(panel)[0] ?? panel).focus({ preventScroll: true });
    });
    if (frame) frame.addEventListener('load', onFrameLoad);

    if (frame || options.loading) handle.setLoading(options.loading);
    else handle.setReady();

    if (!stack.length) {
      document.addEventListener('keydown', onDocumentKey, true);
      document.addEventListener('focusin', onFocusIn, true);
    }
    stack.push(handle);
    document.body.append(host);
    syncInert();
    if (frame) attachFrameKeys();
    if (motion) {
      // Start from the closed state in this frame, then open.
      void host.offsetWidth;
    }
    host.classList.add('open');
    (options.initialFocus ?? close).focus({ preventScroll: true });
    return handle;
  }

  const STYLE = `
    .ebs-dialog-backdrop { position: fixed; inset: 0; z-index: 2147483100; display: flex; align-items: center; justify-content: center; background: rgba(20, 26, 48, .5); }
    .ebs-dialog { position: relative; max-height: calc(100vh - ${MARGIN * 2}px); display: flex; flex-direction: column; overflow: hidden; border-radius: 14px; background: #fff; box-shadow: 0 24px 64px rgba(10, 14, 30, .4); font-family: Ubuntu, system-ui, sans-serif; color: #232c4f; outline: none; }
    .ebs-dialog-head { display: flex; align-items: center; gap: 16px; padding: 16px 20px; border-bottom: 1px solid #e6e9f1; }
    .ebs-dialog-titles { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
    .ebs-dialog-title { font-size: 17px; font-weight: 700; }
    .ebs-dialog-sub { font-size: 13px; color: #5d6584; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ebs-dialog-sub[hidden] { display: none; }
    .ebs-dialog-link { font-size: 13px; color: #232c4f; }
    .ebs-dialog-close { flex: none; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border: 0; border-radius: 8px; background: #f3f5fa; color: #232c4f; cursor: pointer; }
    .ebs-dialog-body { position: relative; flex: 1; display: flex; min-height: 0; }
    .ebs-dialog-body.content { display: block; overflow: auto; padding: 20px; }
    .ebs-dialog-frame { flex: 1; width: 100%; border: 0; }
    .ebs-dialog-cover { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 12px; align-items: center; justify-content: center; padding: 24px; background: #fff; font-size: 14px; color: #5d6584; text-align: center; }
    .ebs-dialog-cover[hidden] { display: none; }
    .ebs-dialog-cover.error { color: #232c4f; }
    .ebs-dialog-fallback { font-size: 13px; color: #232c4f; }
    .ebs-dialog-foot { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 20px; border-top: 1px solid #e6e9f1; font-size: 12px; color: #5d6584; }
    .ebs-dialog-button { height: 36px; padding: 0 14px; border: 1px solid #d6dbe8; border-radius: 8px; background: #fff; color: #232c4f; font-size: 13px; cursor: pointer; }
    .ebs-dialog-sentinel { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    .ebs-dialog-close:focus-visible, .ebs-dialog-button:focus-visible, .ebs-dialog-link:focus-visible, .ebs-dialog-fallback:focus-visible { outline: 2px solid #232c4f; outline-offset: 2px; }

    /* Better design motion: transitions only, so a close turns an opening around. */
    .ebs-dialog-backdrop.ebs-motion { opacity: 0; transition: opacity 160ms cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-dialog-backdrop.ebs-motion .ebs-dialog { opacity: 0; transform: scale(0.97); transition: opacity 180ms cubic-bezier(0.23, 1, 0.32, 1), transform 180ms cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-dialog-backdrop.ebs-motion.open, .ebs-dialog-backdrop.ebs-motion.open .ebs-dialog { opacity: 1; transform: none; }
    .ebs-dialog-backdrop.ebs-motion.closing, .ebs-dialog-backdrop.ebs-motion.closing .ebs-dialog { transition-duration: ${CLOSE_MS}ms; transition-timing-function: ease-in; pointer-events: none; }
    @media (prefers-reduced-motion: reduce) {
      .ebs-dialog-backdrop.ebs-motion .ebs-dialog, .ebs-dialog-backdrop.ebs-motion.open .ebs-dialog { transform: none; transition: opacity 120ms ease-out; }
      .ebs-dialog-backdrop.ebs-motion { transition: opacity 120ms ease-out; }
    }
  `;

  EBS.define('dialog', Object.freeze({
    open,
    // The dialog on top, or null.
    top: () => stack.at(-1) ?? null,
    closeAll: () => {
      for (const handle of [...stack].reverse()) handle.close({ immediate: true, reason: 'close' });
    },
  }));
})();
