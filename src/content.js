// Runs in every frame of secure*.e-boekhouden.nl. The e-Boekhouden app is a
// <frameset> on secure.e-boekhouden.nl/bh/ with these frames that matter here:
//
//   top        /bh/                       frameset, title = administration name
//   mainframe  secure20.../v1page|v1login  Angular shell (with the navbar) around an <iframe> with the classic ASP page
//              or /bh/*.asp                classic pages loaded directly
//   inner      iframe inside mainframe     the classic ASP page, including the login form /bh/inloggen.asp
//
// Each frame picks its role below and talks to the service worker. Cookie
// values never reach this script: the switcher renders from the names,
// statuses and pictures the service worker mirrors into chrome.storage.local.

(() => {
  if (window.__ebSessionsLoaded) return;
  window.__ebSessionsLoaded = true;

  const SECURE20 = 'secure20.e-boekhouden.nl';
  const SECURE20_LOGIN = `https://${SECURE20}/v1login`;
  const ASP_ORIGIN = /^https:\/\/secure\d*\.e-boekhouden\.nl$/;

  const isTop = window === window.top;
  const parentIsTop = !isTop && window.parent === window.top;

  // After the extension is reloaded, a script left in an open tab has no
  // context any more: sendMessage then throws instead of rejecting.
  function send(message) {
    try {
      return chrome.runtime.sendMessage(message).catch((error) => ({ error: String(error) }));
    } catch (error) {
      return Promise.resolve({ error: String(error) });
    }
  }

  function onReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  function classify(href) {
    const url = new URL(href);
    const path = url.pathname.toLowerCase();
    if (path === '/bh/uitloggen.asp') return 'logout';
    if (path === '/bh/inloggen.asp') return 'login';
    if (url.hostname === SECURE20 && path === '/v1login') return 'login';
    if (url.hostname === SECURE20 && path === '/sessie-verlopen') return 'expired';
    if (path === '/bh/jwterror.asp') {
      let data = url.search;
      try { data = decodeURIComponent(data); } catch { /* keep raw */ }
      if (/sessionexpired/i.test(data)) return 'expired';
    }
    return 'app';
  }

  // The origin of the classic app and its frameset (secure.e-boekhouden.nl).
  function aspOrigin() {
    const origins = location.ancestorOrigins;
    const topOrigin = origins.length ? origins[origins.length - 1] : location.origin;
    if (!ASP_ORIGIN.test(topOrigin) || new URL(topOrigin).hostname === SECURE20) return 'https://secure.e-boekhouden.nl';
    return topOrigin;
  }

  function role() {
    const path = location.pathname.toLowerCase();
    // The import page inside the mutation dialog (import.js) is not part of the frameset flow.
    // In a tab of its own ("Openen in nieuw tabblad") it is an ordinary shell page.
    if (!isTop && location.hash.startsWith('#ebs-edit=')) return null;
    if (isTop && location.hostname === SECURE20) return 'shell';
    if (isTop) return ['/bh', '/bh/', '/bh/index.asp', '/bh/default.asp'].includes(path) ? 'top' : null;
    if (parentIsTop && window.name === 'mainframe') return 'main';
    try {
      if (window.parent.parent === window.top && window.parent === window.top.frames.mainframe) return 'inner';
    } catch { /* not part of the e-Boekhouden frameset */ }
    return null;
  }

  // The login fields themselves are handled by password-fields.js.

  // -------------------------------------------------------------------------
  // Roles
  // -------------------------------------------------------------------------

  // Started at the end of this file, once every declaration below exists.
  function boot() {
    const myRole = role();
    if (myRole === 'top') runTop();
    if (myRole === 'main') runMain();
    if (myRole === 'inner') runInner();
    // The navbar lives in the secure20 shell: in mainframe, or opened on its own.
    if ((myRole === 'main' && location.hostname === SECURE20) || myRole === 'shell') startSwitcher();
  }

  async function reloginEnabled() {
    const { settings } = await chrome.storage.local.get('settings');
    return EBS.settingsWithDefaults(settings).relogin;
  }

  async function maybeReloginDialog() {
    if (await reloginEnabled()) onReady(showReloginDialog);
  }

  function runTop() {
    const report = () => send({ type: 'top:title', title: document.title });
    onReady(() => {
      // The login frameset swapped for one iframe (login-breakout.js): the
      // header that login-page.js adds there carries the switcher.
      if (document.getElementById('ebs-login-host')) startSwitcher();
      else document.addEventListener('ebs-login-host', startSwitcher, { once: true });
      report();
      const title = document.querySelector('title');
      if (title) new MutationObserver(report).observe(title, { childList: true, characterData: true, subtree: true });
    });
  }

  // /bh/inloggen.asp is also what e-Boekhouden shows, with "U bent reeds
  // ingelogd", when /bh/ is opened while the session is still valid. Only the
  // plain form means the session is gone.
  function loginFormKind(callback) {
    onReady(() => callback(/reeds ingelogd/i.test(document.body?.innerText ?? '') ? 'already' : 'login'));
  }

  // What the service worker answers to a page report: go back to the page
  // the user was on, offer a link to it, or show the re-login dialog.
  function answer(kind, response) {
    if (response?.navigate) {
      location.replace(response.navigate);
      return;
    }
    if (response?.offerBack) onReady(() => showBackLink(response.offerBack));
    if (kind === 'login' && response?.relogin) maybeReloginDialog();
  }

  function runInner() {
    const kind = classify(location.href);
    const report = (pageKind) => send({ type: 'inner:page', url: location.href, kind: pageKind }).then((response) => {
      // A classic "session expired" page in the shell only links to the
      // login: open e-Boekhouden's login form here, where the dialog shows.
      if (pageKind === 'expired') {
        location.replace('/bh/inloggen.asp');
        return;
      }
      answer(pageKind, response);
    });
    if (kind === 'login') loginFormKind(report);
    else report(kind);
  }

  // The answer to a login in the 1Password login iframe, landed on secure20:
  // reported at document_start, before e-Boekhouden's own scripts have set
  // up the session. Wait for the page to load and settle, then let the
  // service worker open the app.
  const LOGIN_SETTLE_MS = 3000;
  function settleLogin() {
    const done = () => window.setTimeout(() => send({ type: 'login:done', url: location.href }), LOGIN_SETTLE_MS);
    if (document.readyState === 'complete') done();
    else window.addEventListener('load', done, { once: true });
  }

  function runMain() {
    let lastHref = null;

    const handle = () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      const kind = classify(location.href);

      // "Session expired" screens only offer a link to the login page. Go
      // straight to e-Boekhouden's own login screen, where the dialog shows.
      if (kind === 'expired') {
        send({ type: 'main:page', url: location.href, kind }).then(() => location.replace(SECURE20_LOGIN));
        return;
      }

      const report = (pageKind) => send({ type: 'main:page', url: location.href, kind: pageKind }).then((response) => {
        if (response?.settleLogin) {
          settleLogin();
          return;
        }
        answer(pageKind, response);
      });
      // The classic login form loaded straight into mainframe: check it like the inner one.
      if (kind === 'login' && location.hostname !== SECURE20) loginFormKind(report);
      else report(kind);
    };

    handle();
    // The secure20 shell is a single-page app: routes change without a page load.
    if (location.hostname === SECURE20) {
      const watch = setInterval(() => {
        // The extension was reloaded: this copy of the script is orphaned.
        if (!chrome.runtime?.id) {
          clearInterval(watch);
          return;
        }
        handle();
      }, 500);
    }
  }

  // -------------------------------------------------------------------------
  // Re-login dialog: the real login form, centered over a dimmed backdrop.
  // After login the service worker sends the frame back to the page it was on.
  // -------------------------------------------------------------------------

  function showReloginDialog() {
    const form = document.getElementById('frm');
    if (!form || document.documentElement.classList.contains('ebs-relogin')) return;

    const style = document.createElement('style');
    style.id = 'ebs-relogin-style';
    style.textContent = `
      html.ebs-relogin, html.ebs-relogin body { overflow: hidden !important; }
      .ebs-backdrop {
        position: fixed; inset: 0; z-index: 2147483000;
        background: rgba(20, 26, 48, 0.55);
        backdrop-filter: blur(4px);
      }
      html.ebs-relogin #frm {
        position: fixed; top: 50%; left: 50%; z-index: 2147483001;
        transform: translate(-50%, -50%);
        width: 440px; max-width: calc(100vw - 32px); box-sizing: border-box;
        padding: 22px 20px 10px; margin: 0;
        background: #fff; border-radius: 12px;
        box-shadow: 0 24px 64px rgba(10, 14, 30, 0.35);
      }
      html.ebs-relogin #frm #formWrapper { width: 100%; }
      html.ebs-relogin .ebs-hidden { display: none !important; }
      .ebs-relogin-head { font-family: 'Ubuntu', sans-serif; color: #30395f; margin: 0 0 12px; }
      .ebs-relogin-head strong { display: block; font-size: 17px; margin-bottom: 4px; }
      .ebs-relogin-head span { font-size: 13px; color: #4b4b4b; line-height: 19px; }
      .ebs-relogin-foot { font-family: 'Ubuntu', sans-serif; font-size: 12px; text-align: center; margin: 6px 0 4px; }
      .ebs-relogin-foot a { color: #30395f; cursor: pointer; }
    `;
    document.head.append(style);

    const backdrop = document.createElement('div');
    backdrop.className = 'ebs-backdrop';

    const head = document.createElement('div');
    head.className = 'ebs-relogin-head';
    const title = document.createElement('strong');
    title.textContent = 'Je sessie is verlopen';
    const text = document.createElement('span');
    text.textContent = 'Log opnieuw in. Daarna ga je terug naar de pagina waar je was.';
    head.append(title, text);

    const foot = document.createElement('div');
    foot.className = 'ebs-relogin-foot';
    const cancel = document.createElement('a');
    cancel.textContent = 'Gewoon inloggen, niet terug naar de vorige pagina';
    // The page's markup is malformed: the parser pulls the whole login page into
    // #frm. Show only the table that holds the login fields; hidden inputs still
    // submit even when an ancestor is hidden.
    const hidden = [];
    let node = document.getElementById('txtEmail')?.closest('#formWrapper');
    while (node && node !== form && node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling === node || sibling.matches('input[type="hidden"], script, style')) continue;
        sibling.classList.add('ebs-hidden');
        hidden.push(sibling);
      }
      node = node.parentElement;
    }

    cancel.addEventListener('click', () => {
      send({ type: 'relogin:cancel' });
      for (const element of hidden) element.classList.remove('ebs-hidden');
      document.documentElement.classList.remove('ebs-relogin');
      backdrop.remove();
      head.remove();
      foot.remove();
    });
    foot.append(cancel);

    form.prepend(head);
    form.append(foot);
    document.body.append(backdrop);
    document.documentElement.classList.add('ebs-relogin');
    document.getElementById('txtEmail')?.focus();
  }

  // -------------------------------------------------------------------------
  // After a re-login whose last page was not a plain page view (its URL could
  // repeat an action): a link back to it, for the user to click or not.
  // -------------------------------------------------------------------------

  function showBackLink(url) {
    if (document.getElementById('ebs-back')) return;
    const host = el('div');
    host.id = 'ebs-back';
    host.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483000;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = el('style');
    style.textContent = `
      :host { all: initial; }
      .box { display: flex; align-items: center; gap: 12px; padding: 10px 10px 10px 16px; border-radius: 10px; background: #fff; color: #30395f; font: 13px Ubuntu, system-ui, sans-serif; box-shadow: 0 8px 24px rgba(20, 26, 48, .18), 0 0 0 1px rgba(20, 26, 48, .08); }
      a { color: #30395f; font-weight: 700; }
      button { width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: #5d6584; font: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; }
      button { transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease; }
      button:hover { background: #f3f5fa; }
      a:focus-visible, button:focus-visible { outline: 2px solid #30395f; outline-offset: 2px; }
    `;
    const box = el('div', 'box');
    box.setAttribute('role', 'status');
    const link = el('a', '', 'Terug naar vorige pagina');
    link.href = url;
    link.target = '_self';
    const close = el('button');
    close.append(lucide('x', 16));
    close.type = 'button';
    close.setAttribute('aria-label', 'Sluiten');
    close.addEventListener('click', () => host.remove());
    box.append(el('span', '', 'Je bent weer ingelogd.'), link, close);
    root.append(style, box);
    document.documentElement.append(host);
  }

  // -------------------------------------------------------------------------
  // Session switcher: a navbar item in e-Boekhouden's own header, in the style
  // of whichever design is active.
  //
  //   new design     app-header-identity-b > .header-identity: the item goes
  //                  before .userInfo (name and number); .userCircle is the avatar
  //   legacy design  app-header-identity > .container: the item goes before
  //                  .identity (name and number), next to the power button
  //
  // It mounts from a MutationObserver started at document_start, in the same
  // task that renders the header, so it is there in the first frame.
  // -------------------------------------------------------------------------

  const state = { loaded: false, slots: [], view: { activeSlotId: null, loggedIn: false, ready: [] }, avatars: {}, settings: EBS.settingsWithDefaults() };
  const renderers = new Set();

  async function loadState() {
    const all = await chrome.storage.local.get(null);
    state.slots = Array.isArray(all.slots) ? all.slots : [];
    state.view = all.view ?? { activeSlotId: null, loggedIn: false, ready: [] };
    state.settings = EBS.settingsWithDefaults(all.settings);
    state.avatars = {};
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith('avatar:')) state.avatars[key.slice(7)] = value;
    }
    state.loaded = true;
    for (const render of renderers) render();
  }

  function statusOf(slot) {
    return EBS.statusOf(slot, state.view);
  }

  const STATUS_LABEL = {
    new: { active: 'Actief', ready: 'Klaar', expired: 'Verlopen', login: 'Inloggen' },
    legacy: { active: 'actief', ready: 'klaar', expired: 'verlopen', login: 'inloggen' },
  };

  function startSwitcher() {
    // The avatar picture replaces the initials circle of the new design. The
    // data URL was validated by the service worker, so it is safe inside url().
    const avatarStyle = document.createElement('style');
    avatarStyle.id = 'ebs-avatar-style';
    document.documentElement.append(avatarStyle);
    renderers.add(() => {
      const url = state.view.loggedIn ? state.avatars[state.view.activeSlotId] : null;
      avatarStyle.textContent = url
        ? `app-header-identity-b .header-identity .identity .userCircle { background: #fff center / cover no-repeat url("${url}") !important; color: transparent !important; font-size: 0 !important; }`
        : '';
      nav.render();
      menu.render();
      mountNav();
    });
    loadState();
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') loadState();
    });

    const observer = new MutationObserver(mountNav);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    mountNav();
  }

  let lastIdentity = '';
  function mountNav() {
    // Wait for the stored settings, so a switched-off item never flashes up.
    // They are read long before Angular renders the header.
    if (!state.loaded) return;
    if (!state.settings.switcher) {
      nav.host?.remove();
      nav.host = null;
      if (menu.open) menu.close();
      return;
    }
    const fresh = document.querySelector('app-header-identity-b .header-identity');
    // The login page header (login-page.js) takes the legacy item too.
    const legacy = !fresh && (document.querySelector('app-header-identity .container') ?? document.getElementById('ebs-login-nav'));
    const container = fresh || legacy;
    if (!container) return;
    const variant = fresh ? 'new' : 'legacy';

    if (!nav.host || nav.variant !== variant || nav.host.parentElement !== container) {
      nav.create(variant);
      const anchor = fresh
        ? container.querySelector(':scope > .userInfo')
        : container.querySelector(':scope > .identity') ?? container.querySelector(':scope > .logout') ?? container.firstElementChild;
      container.insertBefore(nav.host, anchor);
    }

    const name = container.querySelector(fresh ? '.userName' : '.username')?.textContent.trim();
    const number = container.querySelector(fresh ? '.administratieId' : '#administratieId')?.textContent.trim();
    const identity = `${name}|${number}`;
    if (name && number && identity !== lastIdentity) {
      lastIdentity = identity;
      send({ type: 'header:identity', name, number });
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // A Lucide icon (EBS.icon) in a span, so the shadow styles can place it.
  // 'image-off' is not in icons.js yet. Shared change requested: add it
  // (lucide-static 1.63.0) to src/icons.js; EXTRA_ICONS then goes. It takes
  // the frame and attributes of an EBS.icon.
  const EXTRA_ICONS = {
    'image-off': [
      ['line', { x1: '2', x2: '22', y1: '2', y2: '22' }],
      ['path', { d: 'M10.41 10.41a2 2 0 1 1-2.83-2.83' }],
      ['line', { x1: '13.5', x2: '6', y1: '13.5', y2: '21' }],
      ['line', { x1: '18', x2: '21', y1: '12', y2: '15' }],
      ['path', { d: 'M3.59 3.59A1.99 1.99 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.052-.22 1.41-.59' }],
      ['path', { d: 'M21 15V5a2 2 0 0 0-2-2H9' }],
    ],
  };
  function lucide(name, size) {
    if (EBS.icon.has(name) || !EXTRA_ICONS[name]) return EBS.icon(name, { size });
    const svg = EBS.icon('minus', { size });
    svg.replaceChildren(...EXTRA_ICONS[name].map(([tag, attributes]) => {
      const child = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [attribute, value] of Object.entries(attributes)) child.setAttribute(attribute, value);
      return child;
    }));
    svg.setAttribute('class', svg.getAttribute('class').replace('lucide-minus', `lucide-${name}`));
    return svg;
  }

  function icon(name, size = 16) {
    const wrap = el('span', 'icon');
    wrap.append(lucide(name, size));
    return wrap;
  }

  const nav = {
    host: null,
    variant: null,
    button: null,

    create(variant) {
      this.host?.remove();
      this.variant = variant;
      this.host = el('span');
      this.host.id = 'ebs-nav';
      this.host.style.cssText = variant === 'new'
        ? 'display:flex;align-items:center;flex:none;'
        : 'display:flex;align-self:stretch;flex:none;height:100%;margin-right:16px;';
      const root = this.host.attachShadow({ mode: 'closed' });
      const style = el('style');
      style.textContent = NAV_CSS;
      this.button = el('button', variant);
      this.button.type = 'button';
      this.button.setAttribute('aria-haspopup', 'menu');
      this.button.setAttribute('aria-expanded', 'false');
      this.button.title = 'Wissel van administratie';
      this.button.addEventListener('click', (event) => {
        event.stopPropagation();
        // detail is 0 for a click from the keyboard (Enter or Space).
        menu.toggle(variant, this.host, event.detail === 0);
      });
      root.append(style, this.button);
      if (variant === 'new') root.append(el('span', 'divider'));
      this.render();
    },

    render() {
      if (!this.button) return;
      this.button.replaceChildren();
      this.button.setAttribute('aria-expanded', String(menu.open));
      this.button.classList.toggle('open', menu.open);
      if (this.variant === 'new') {
        this.button.append(icon('arrow-left-right', 18), el('span', 'label', 'Wissel'));
        if (state.slots.length) this.button.append(el('span', 'badge', String(state.slots.length)));
      } else {
        this.button.append(icon('arrow-left-right', 16), el('span', 'label', 'Administraties'), icon('chevron-down', 14));
      }
    },
  };

  const menu = {
    open: false,
    host: null,
    root: null,
    anchor: null,
    variant: null,
    confirm: null,
    avatarTarget: null,

    toggle(variant, anchor, fromKeyboard = false) {
      if (this.open) {
        this.close();
        return;
      }
      this.variant = variant;
      this.anchor = anchor;
      this.open = true;
      this.host = el('div');
      this.host.id = 'ebs-menu';
      this.root = this.host.attachShadow({ mode: 'closed' });
      const style = el('style');
      style.textContent = MENU_CSS;
      // One file input for the life of the menu: a redraw while the file
      // dialog is open must not drop the picture the user is choosing.
      this.fileInput = el('input');
      this.fileInput.type = 'file';
      this.fileInput.accept = 'image/*';
      this.fileInput.hidden = true;
      this.fileInput.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        const slotId = this.avatarTarget;
        if (!file || !slotId) return;
        try {
          await send({ type: 'avatar:set', slotId, dataUrl: await EBS.toAvatar(file) });
        } catch (error) {
          console.warn('EB Sessions: could not read the picture', error);
        }
      });
      this.body = el('div');
      this.root.append(style, this.fileInput, this.body);
      document.documentElement.append(this.host);
      this.onOutside = (event) => {
        if (!event.composedPath().some((node) => node === this.host || node === nav.host)) this.close();
      };
      this.onKey = (event) => this.key(event);
      this.onResize = () => this.place();
      document.addEventListener('mousedown', this.onOutside, true);
      document.addEventListener('keydown', this.onKey, true);
      window.addEventListener('resize', this.onResize);
      this.render();
      nav.render();
      if (fromKeyboard) this.items()[0]?.focus();
    },

    // The menu items in order: the rows, then "toevoegen".
    items() {
      return this.root ? [...this.root.querySelectorAll('[role^="menuitem"]')] : [];
    },

    key(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.close();
        nav.button?.focus();
        return;
      }
      const items = this.items();
      const current = items.indexOf(this.root.activeElement);
      if (event.key === 'Tab') {
        this.close();
        return;
      }
      if (current < 0 && this.root.activeElement) return; // a photo, bin or confirm button
      const next = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: items.length - 1 }[event.key];
      if (next === undefined || !items.length) return;
      event.preventDefault();
      items[(next + items.length) % items.length].focus();
    },

    close() {
      document.removeEventListener('mousedown', this.onOutside, true);
      document.removeEventListener('keydown', this.onKey, true);
      window.removeEventListener('resize', this.onResize);
      this.host?.remove();
      this.host = null;
      this.root = null;
      this.open = false;
      this.confirm = null;
      this.error = null;
      this.removing = null;
      nav.render();
    },

    // Under the navbar, right edge on the item's right edge.
    place() {
      if (!this.host || !this.anchor?.isConnected) return;
      const rect = this.anchor.getBoundingClientRect();
      let bar = this.anchor;
      while (bar.parentElement && bar.getBoundingClientRect().height < 48) bar = bar.parentElement;
      const top = Math.max(rect.bottom, bar.getBoundingClientRect().bottom) + (this.variant === 'new' ? 6 : 0);
      const right = Math.max(8, document.documentElement.clientWidth - rect.right);
      this.host.style.cssText = `position:fixed;top:${top}px;right:${right}px;z-index:2147483600;`;
    },

    origin() {
      return aspOrigin();
    },

    // One switch at a time: further clicks wait for the answer.
    async act(type, extra) {
      if (this.busy) return;
      this.busy = true;
      this.pendingId = extra?.slotId ?? null;
      this.error = null;
      this.render();
      let response;
      try {
        response = await send({ type, origin: this.origin(), confirmed: Boolean(this.confirm?.accepted), ...extra });
      } finally {
        this.busy = false;
        this.pendingId = null;
      }
      if (response?.needsConfirm) {
        this.confirm = { type, extra, tabCount: response.tabCount, accepted: false };
        this.render();
        return;
      }
      if (response?.error || !response) {
        this.confirm = null;
        this.error = 'Dat lukte niet. Probeer het opnieuw of herlaad de pagina.';
        this.render();
        return;
      }
      this.close();
    },

    choose(slot) {
      if (statusOf(slot) === 'active') {
        this.close();
        return;
      }
      this.confirm = null;
      this.act('switcher:switch', { slotId: slot.id });
    },

    pickAvatar(slot) {
      this.avatarTarget = slot.id;
      this.fileInput.value = '';
      this.fileInput.click();
    },

    render() {
      if (!this.open || !this.root) return;
      const variant = this.variant;
      // Redraws come from storage changes; keep keyboard focus where it was.
      const focused = this.root.activeElement?.dataset?.key ?? null;

      const card = el('div', `card ${variant}`);
      card.setAttribute('role', 'menu');
      card.setAttribute('aria-label', 'Wissel van administratie');

      const head = el('div', 'head');
      head.append(el('span', 'title', variant === 'new' ? 'Wissel van administratie' : 'Administraties'));
      if (variant === 'new') head.append(el('span', 'count', `${state.slots.length} ${state.slots.length === 1 ? 'sessie' : 'sessies'}`));
      card.append(head);

      const list = el('div', 'list');
      if (!state.slots.length) list.append(el('p', 'empty', 'Nog geen sessies. Log in, dan verschijnt de administratie hier vanzelf.'));
      for (const slot of state.slots) list.append(this.row(slot));
      card.append(list);

      if (this.confirm) card.append(this.confirmBox());
      if (this.error) {
        const error = el('p', 'error', this.error);
        error.setAttribute('role', 'alert');
        card.append(error);
      }

      const foot = el('div', 'foot');
      const add = el('button', 'add');
      add.type = 'button';
      add.dataset.key = 'add';
      add.setAttribute('role', 'menuitem');
      if (variant === 'new') {
        add.append(icon('plus', 18), el('span', '', 'Administratie toevoegen'));
      } else {
        add.append(icon('plus', 14), el('span', '', 'Sessie toevoegen'));
      }
      add.addEventListener('click', () => {
        this.confirm = null;
        this.act('switcher:add', {});
      });
      foot.append(add);
      card.append(foot);

      this.body.replaceChildren(card);
      if (focused) this.root.querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus();
      this.place();
    },

    row(slot) {
      const variant = this.variant;
      const status = statusOf(slot);
      const row = el('div', `row ${status}`);
      const pick = el('button', 'pick');
      pick.type = 'button';
      pick.dataset.key = `pick:${slot.id}`;
      pick.setAttribute('role', 'menuitemradio');
      pick.setAttribute('aria-checked', String(status === 'active'));
      pick.addEventListener('click', () => this.choose(slot));

      if (variant === 'new') {
        const picture = state.avatars[slot.id];
        if (picture) {
          const image = el('img', 'avatar photo');
          image.src = picture;
          image.alt = '';
          pick.append(image);
        } else {
          pick.append(el('span', `avatar ${status}`, EBS.initials(slot.name)));
        }
      } else {
        pick.append(el('span', `dot ${status}`));
      }

      const text = el('span', 'text');
      text.append(el('span', 'name', slot.name));
      if (slot.number) text.append(el('span', 'number', slot.number));
      pick.append(text);

      const label = el('span', `status ${status}`);
      if (variant === 'new' && status === 'active') label.append(icon('check', 16));
      if (variant === 'new' && status === 'expired') label.append(icon('clock', 14));
      const pending = this.busy && this.pendingId === slot.id;
      label.append(document.createTextNode(pending ? 'Bezig…' : STATUS_LABEL[variant][status]));
      pick.append(label);
      // While a switch is on its way the menu waits: no second click.
      if (this.busy) {
        pick.disabled = true;
        pick.setAttribute('aria-busy', String(pending));
      }
      row.append(pick);

      const actions = el('span', 'actions');
      if (variant === 'new') {
        const hasPicture = Boolean(state.avatars[slot.id]);
        actions.append(actionButton('camera', hasPicture ? 'Profielfoto wijzigen' : 'Profielfoto kiezen', () => this.pickAvatar(slot), `photo:${slot.id}`));
        if (hasPicture) actions.append(actionButton('image-off', 'Profielfoto verwijderen', () => send({ type: 'avatar:remove', slotId: slot.id }), `photo-off:${slot.id}`));
      }
      actions.append(actionButton('trash-2', 'Sessie verwijderen', () => {
        this.removing = slot.id;
        this.render();
        this.root.querySelector('[data-key="remove-no"]')?.focus();
      }, `remove:${slot.id}`));
      row.append(actions);
      if (this.removing !== slot.id) return row;
      // The bin removes the entry for good (name, number, picture and the
      // stored session): ask once.
      const wrap = el('div', 'removing');
      const box = el('div', 'confirm');
      box.setAttribute('role', 'alert');
      box.append(el('span', '', `${slot.name} verwijderen? De naam, het nummer, de profielfoto en de bewaarde sessie gaan weg.`));
      const buttons = el('div', 'confirm-buttons');
      const no = el('button', 'no', 'Annuleren');
      no.type = 'button';
      no.dataset.key = 'remove-no';
      no.addEventListener('click', () => {
        this.removing = null;
        this.render();
        this.root.querySelector(`[data-key="remove:${CSS.escape(slot.id)}"]`)?.focus();
      });
      const ok = el('button', 'ok', 'Verwijderen');
      ok.type = 'button';
      ok.dataset.key = 'remove-ok';
      ok.addEventListener('click', () => {
        this.removing = null;
        send({ type: 'switcher:remove', slotId: slot.id });
      });
      buttons.append(no, ok);
      box.append(buttons);
      wrap.append(row, box);
      return wrap;
    },

    confirmBox() {
      const box = el('div', 'confirm');
      box.setAttribute('role', 'alert');
      box.append(el('span', '', EBS.reloadWarning(this.confirm.tabCount)));
      const buttons = el('div', 'confirm-buttons');
      const no = el('button', 'no', 'Annuleren');
      no.type = 'button';
      no.dataset.key = 'confirm-no';
      no.addEventListener('click', () => {
        this.confirm = null;
        this.render();
      });
      const ok = el('button', 'ok', 'Doorgaan');
      ok.type = 'button';
      ok.dataset.key = 'confirm-ok';
      ok.addEventListener('click', () => {
        this.confirm.accepted = true;
        this.act(this.confirm.type, this.confirm.extra);
      });
      buttons.append(no, ok);
      box.append(buttons);
      return box;
    },
  };

  function actionButton(iconName, label, onClick, key) {
    const button = el('button', 'action');
    button.type = 'button';
    button.dataset.key = key;
    button.title = label;
    button.setAttribute('aria-label', label);
    button.append(icon(iconName));
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  const NAV_CSS = `
    :host { all: initial; }
    button { display: flex; align-items: center; cursor: pointer; font-family: Ubuntu, system-ui, sans-serif; }
    .icon { display: flex; }
    button.new {
      height: 44px; gap: 8px; padding: 0 12px; border: 0; border-radius: 8px;
      background: rgba(255, 255, 255, 0.12); color: #fff; font-size: 13px; font-weight: 500;
    }
    button.new:hover, button.new.open { background: rgba(255, 255, 255, 0.22); }
    button.new:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .badge {
      min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 9px;
      background: #5d9e35; color: #fff; font-size: 11px; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }
    .divider { width: 1px; height: 28px; background: rgba(255, 255, 255, 0.18); margin: 0 10px 0 12px; }
    button.legacy {
      height: 100%; gap: 6px; padding: 0 14px; border: 0; border-bottom: 2px solid transparent;
      background: transparent; color: #30395f; font-size: 14px; box-sizing: border-box;
    }
    button.legacy:hover, button.legacy.open { background: #f3f4f8; border-bottom-color: #68ab32; }
    button.legacy:focus-visible { outline: 2px solid #30395f; outline-offset: -2px; }
  `;

  const MENU_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    button { font-family: inherit; cursor: pointer; }
    .icon { display: flex; }
    .card { font-family: Ubuntu, system-ui, sans-serif; background: #fff; overflow: hidden; }
    .row { display: flex; align-items: center; }
    .pick { flex: 1; min-width: 0; display: flex; align-items: center; border: 0; background: transparent; text-align: left; }
    .text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    /* The row actions are always in place, so nothing shifts; they fade and slide in on hover. */
    .actions { display: flex; align-items: center; gap: 2px; opacity: 0; transform: translateX(4px); pointer-events: none; transition: opacity 150ms ease, transform 150ms cubic-bezier(0.23, 1, 0.32, 1); }
    .row:hover .actions, .row:focus-within .actions { opacity: 1; transform: none; pointer-events: auto; }
    .row, .pick, .action, .add, button.new, button.legacy, .confirm button { transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease; }
    @media (prefers-reduced-motion: reduce) { .actions { transform: none; } }
    .action { width: 32px; height: 32px; border: 0; border-radius: 6px; background: transparent; display: flex; align-items: center; justify-content: center; }
    .confirm { margin: 6px 8px; padding: 10px 12px; background: #fff8e6; color: #6b5310; font-size: 12px; line-height: 17px; }
    .confirm-buttons { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
    .confirm button { font-size: 12px; font-weight: 500; padding: 6px 12px; }
    .confirm .no { border: 1px solid #e0d3a8; background: #fff; color: #6b5310; }
    .confirm .ok { border: 0; color: #fff; }
    .empty { margin: 4px 16px 12px; font-size: 12px; color: #5d6584; }
    .error { margin: 6px 16px; font-size: 12px; line-height: 17px; color: #b42318; }
    .pick:focus-visible, .add:focus-visible, .action:focus-visible, .confirm button:focus-visible { outline: 2px solid #232c4f; outline-offset: -2px; }
    .pick:disabled { cursor: wait; opacity: .6; }
    .pick[aria-busy="true"] { opacity: 1; }

    /* New design */
    .new.card { width: 340px; border-radius: 10px; box-shadow: 0 16px 40px rgba(20, 26, 48, 0.22), 0 0 0 1px rgba(20, 26, 48, 0.06); color: #232c4f; }
    .new .head { padding: 14px 16px 10px; display: flex; align-items: baseline; justify-content: space-between; }
    .new .title { font-size: 14px; font-weight: 700; }
    .new .count { font-size: 11px; color: #5d6584; }
    .new .list { display: flex; flex-direction: column; gap: 2px; padding: 0 8px 8px; }
    .new .row { border-radius: 8px; }
    .new .row:hover { background: #f5f6fa; }
    .new .row.active { background: #eef1f8; }
    .new .pick { gap: 12px; padding: 10px; border-radius: 8px; color: #232c4f; }
    .new .avatar { width: 34px; height: 34px; border-radius: 50%; flex: none; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; }
    .new .avatar.photo { object-fit: cover; }
    .new .avatar.active { background: #232c4f; color: #fff; }
    .new .avatar.ready { background: #dfe4f1; color: #232c4f; }
    .new .avatar.expired { background: #fbe9e9; color: #b42318; }
    .new .avatar.login { background: #fff; border: 1.5px dashed #9aa3bf; color: #5d6584; }
    .new .text { gap: 2px; }
    .new .name { font-size: 14px; font-weight: 700; }
    .new .number { font-size: 11px; color: #5d6584; }
    .new .status { display: flex; align-items: center; gap: 4px; font-size: 12px; color: #5d6584; white-space: nowrap; }
    .new .status.active { color: #3f7f22; font-weight: 500; }
    .new .status.expired { color: #b42318; font-weight: 500; }
    .new .actions { padding-right: 6px; }
    .new .action { color: #5d6584; }
    .new .action:hover { background: #e6e9f1; color: #232c4f; }
    .new .foot { border-top: 1px solid #e6e9f1; padding: 8px; }
    .new .add { width: 100%; display: flex; align-items: center; gap: 12px; padding: 10px; border: 0; border-radius: 8px; background: #fff; font-size: 14px; font-weight: 500; color: #232c4f; text-align: left; }
    .new .add:hover { background: #f5f6fa; }
    .new .add .icon { width: 34px; height: 34px; border-radius: 50%; background: #f1f7ec; color: #3f7f22; align-items: center; justify-content: center; }
    .new .note { background: #f6f7fb; padding: 10px 16px; font-size: 11px; line-height: 16px; color: #5d6584; }
    .new .confirm { border-radius: 8px; }
    .new .confirm button { border-radius: 6px; }
    .new .confirm .ok { background: #232c4f; }

    /* Legacy design */
    .legacy.card { width: 300px; border: 1px solid #d3d3d3; box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12); color: #30395f; }
    .legacy .head { padding: 10px 14px 8px; border-bottom: 2px solid #68ab32; }
    .legacy .title { font-size: 15px; font-weight: 700; }
    .legacy .row { border-bottom: 1px solid #ececec; }
    .legacy .row:hover { background: #f5f5f5; }
    .legacy .row.active { background: #eff0e2; }
    .legacy .pick { gap: 10px; padding: 10px 14px; color: #30395f; }
    .legacy .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .legacy .dot.active { background: #68ab32; }
    .legacy .dot.ready { background: #9aa3bf; }
    .legacy .dot.expired { background: #c0392b; }
    .legacy .dot.login { border: 1.5px solid #9aa3bf; }
    .legacy .text { gap: 1px; }
    .legacy .name { font-size: 13px; }
    .legacy .row.active .name { font-weight: 700; }
    .legacy .number { font-size: 11px; color: #7a7a7a; }
    .legacy .status { font-size: 11px; color: #7a7a7a; }
    .legacy .status.active { color: #3f7f22; font-weight: 700; }
    .legacy .status.expired { color: #c0392b; font-weight: 700; }
    .legacy .actions { padding-right: 8px; }
    .legacy .action { color: #7a7a7a; border-radius: 3px; }
    .legacy .action:hover { background: #e3e3e3; color: #30395f; }
    .legacy .foot { padding: 10px 14px; }
    .legacy .add { display: flex; align-items: center; gap: 4px; border: 0; background: none; padding: 0; font-size: 13px; color: #30395f; }
    .legacy .add span:last-child { text-decoration: underline; }
    .legacy .add:hover { color: #1b2240; }
    .legacy .note { padding: 8px 14px 10px; border-top: 1px solid #ececec; font-size: 11px; line-height: 16px; color: #7a7a7a; }
    .legacy .confirm button { border-radius: 3px; }
    .legacy .confirm .ok { background: #30395f; }
  `;

  boot();
})();
