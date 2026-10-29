// Runs in every frame of secure*.e-boekhouden.nl. The e-Boekhouden app is a
// <frameset> on secure.e-boekhouden.nl/bh/ with these frames that matter here:
//
//   top        /bh/                       frameset, title = administration name
//   topframe   /bh/top.asp                header strip (logo, menu items)
//   mainframe  secure20.../v1page|v1login  Angular shell around an <iframe> with the classic ASP page
//              or /bh/*.asp                classic pages loaded directly
//
// Each frame picks its role below and talks to the service worker. Cookie
// values never reach this script.

(() => {
  if (window.__ebSessionsLoaded) return;
  window.__ebSessionsLoaded = true;

  const SECURE20 = 'secure20.e-boekhouden.nl';
  const ASP_ORIGIN = /^https:\/\/secure\d*\.e-boekhouden\.nl$/;

  const isTop = window === window.top;
  const parentIsTop = !isTop && window.parent === window.top;

  function send(message) {
    return chrome.runtime.sendMessage(message).catch(() => ({}));
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

  // The classic login page on the same origin as the frameset (secure.e-boekhouden.nl).
  function aspLoginUrl(search = '') {
    const origins = location.ancestorOrigins;
    const topOrigin = origins.length ? origins[origins.length - 1] : location.origin;
    if (!ASP_ORIGIN.test(topOrigin) || new URL(topOrigin).hostname === SECURE20) return null;
    return `${topOrigin}/bh/inloggen.asp${search}`;
  }

  function role() {
    const path = location.pathname.toLowerCase();
    if (isTop) return ['/bh/', '/bh/index.asp', '/bh/default.asp'].includes(path) ? 'top' : null;
    if (parentIsTop && window.name === 'topframe') return 'header';
    if (parentIsTop && window.name === 'mainframe') return 'main';
    try {
      if (window.parent.parent === window.top && window.parent === window.top.frames.mainframe) return 'inner';
    } catch { /* not part of the e-Boekhouden frameset */ }
    return null;
  }

  // -------------------------------------------------------------------------
  // 1Password: label the login fields for what they are. The real fix for the
  // closing inline menu is moving the form out of the cross-origin secure20
  // frame (see main and inner roles); these attributes help 1Password match
  // and save the right fields.
  // -------------------------------------------------------------------------

  function labelLoginFields() {
    const user = document.getElementById('txtEmail');
    const password = document.getElementById('txtWachtwoord');
    user?.setAttribute('autocomplete', 'username');
    password?.setAttribute('autocomplete', 'current-password');
  }

  if (location.pathname.toLowerCase() === '/bh/inloggen.asp') onReady(labelLoginFields);

  // -------------------------------------------------------------------------
  // Roles
  // -------------------------------------------------------------------------

  const myRole = role();
  if (myRole === 'top') runTop();
  if (myRole === 'header') runHeader();
  if (myRole === 'main') runMain();
  if (myRole === 'inner') runInner();

  function runTop() {
    const report = () => send({ type: 'top:title', title: document.title });
    onReady(() => {
      report();
      const title = document.querySelector('title');
      if (title) new MutationObserver(report).observe(title, { childList: true, characterData: true, subtree: true });
    });
  }

  function runInner() {
    const kind = classify(location.href);
    const loginUrl = kind === 'app' ? null : aspLoginUrl();
    send({ type: 'inner:page', url: location.href, kind, loginUrl }).then((response) => {
      if (response?.navigate) location.replace(response.navigate);
    });
  }

  function runMain() {
    let lastHref = null;

    const handle = () => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      const kind = classify(location.href);

      // The secure20 login and "session expired" screens wrap the ASP login form
      // in a cross-origin frame. Load the ASP login form directly instead.
      if ((kind === 'login' || kind === 'expired') && location.hostname === SECURE20) {
        const target = aspLoginUrl(kind === 'login' ? location.search : '');
        if (target) {
          location.replace(target);
          return;
        }
      }
      if (kind === 'expired' && location.pathname.toLowerCase() === '/bh/jwterror.asp') {
        const target = aspLoginUrl();
        if (target) {
          location.replace(target);
          return;
        }
      }

      send({ type: 'main:page', url: location.href, kind }).then((response) => {
        if (response?.navigate) {
          location.replace(response.navigate);
          return;
        }
        if (kind === 'login' && response?.relogin) onReady(showReloginDialog);
        scheduleFloatingButton();
      });
    };

    handle();
    // The secure20 shell is a single-page app: routes change without a page load.
    if (location.hostname === SECURE20) setInterval(handle, 500);

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === 'main:navigate' && message.url) location.replace(message.url);
      if (message?.type === 'switcher:toggle') onReady(() => panel.toggle(message.anchorRight, message.view));
      if (message?.type === 'state:changed') {
        panel.update(message.view);
        floating.update(message.view);
      }
    });
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
  // Session switcher: a menu item in the header strip (topframe). The header
  // frame is only as tall as the header, so the dropdown itself renders in
  // mainframe, right under the header.
  // -------------------------------------------------------------------------

  function runHeader() {
    onReady(async () => {
      // The frameset gives topframe zero height in the current e-Boekhouden
      // layout. Only hook in when the classic header strip is actually shown.
      if (window.innerHeight < 20) return;
      const items = [...document.querySelectorAll('td.mnuItem')];
      if (!items.length) return;

      const cell = document.createElement('td');
      cell.className = 'mnuItem';
      cell.id = 'ebs-switcher';
      cell.setAttribute('align', 'right');
      cell.style.cssText = 'cursor:pointer;white-space:nowrap;padding:0 12px;';
      const label = document.createElement('span');
      label.className = 'tdMnu';
      label.style.cssText = 'font-family:Ubuntu,sans-serif;font-size:13px;color:#30395f;';
      cell.append(label);
      items[0].before(cell);

      const render = (view) => {
        label.textContent = `${view?.activeLabel ?? 'Sessies'} ▾`;
        cell.title = 'Wissel van e-Boekhouden-sessie';
      };
      render(await send({ type: 'header:hello' }));

      cell.addEventListener('click', (event) => {
        event.stopPropagation();
        const anchorRight = document.documentElement.clientWidth - cell.getBoundingClientRect().right;
        send({ type: 'switcher:toggle', anchorRight: Math.max(8, anchorRight) });
      });
      chrome.runtime.onMessage.addListener((message) => {
        if (message?.type === 'state:changed') render(message.view);
      });
    });
  }

  // In mainframe the switcher button goes into the Angular header of the
  // secure20 shell when there is one. Classic pages and the login screen have
  // no header of their own, so they get a small floating pill instead.
  let floatingTimer = null;
  let headerWatch = null;
  function scheduleFloatingButton() {
    if (location.hostname === SECURE20 && !headerWatch) {
      onReady(() => {
        const inject = () => {
          if (injectAngularHeader()) floating.hide();
        };
        inject();
        headerWatch = new MutationObserver(inject);
        headerWatch.observe(document.body, { childList: true, subtree: true });
      });
    }
    clearTimeout(floatingTimer);
    floatingTimer = setTimeout(async () => {
      if (document.getElementById('ebs-header-item')) return;
      const info = await send({ type: 'tab:info' });
      if (info?.headerPresent) return;
      onReady(async () => floating.show(await send({ type: 'state:get' })));
    }, 1500);
  }

  function injectAngularHeader() {
    if (document.getElementById('ebs-header-item')) return true;

    const identity = document.querySelector('app-header-identity .container');
    const supportItem = [...document.querySelectorAll('app-main-layout li, app-eb-header li')]
      .find((item) => /\bsupport\b/i.test(item.textContent));
    if (!identity && !supportItem) return false;

    const host = document.createElement(identity ? 'div' : 'li');
    host.id = 'ebs-header-item';
    host.style.cssText = 'display:flex;align-items:center;list-style:none;margin:0 6px;';
    const button = switcherButton(host, 'header');
    if (identity) {
      identity.insertBefore(host, identity.querySelector('.logout'));
    } else {
      supportItem.before(host);
    }
    send({ type: 'state:get' }).then((view) => setButtonLabel(button, view));
    floating.buttons.add(button);
    return true;
  }

  function switcherButton(host, variant) {
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      button { font: 500 12px/1 Ubuntu, system-ui, sans-serif; color: #30395f; background: #fff;
        border: 1px solid #d6d9e3; border-radius: 999px; padding: 7px 12px; cursor: pointer;
        white-space: nowrap; max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
      button:hover { border-color: #68ab32; }
      button.floating { box-shadow: 0 2px 8px rgba(20, 26, 48, .12); }
    `;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = variant;
    button.title = 'Wissel van e-Boekhouden-sessie';
    button.textContent = 'Sessies ▾';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const rect = host.getBoundingClientRect();
      panel.toggle(Math.max(8, document.documentElement.clientWidth - rect.right), null, rect.bottom + 6);
    });
    root.append(style, button);
    return button;
  }

  function setButtonLabel(button, view) {
    if (view && !view.error) button.textContent = `${view.activeLabel ?? 'Sessies'} ▾`;
  }

  const floating = {
    host: null,
    buttons: new Set(),
    show(view) {
      if (this.host || document.getElementById('ebs-header-item')) return;
      if (document.documentElement.classList.contains('ebs-relogin')) return;
      this.host = document.createElement('div');
      this.host.style.cssText = 'position:fixed;top:8px;right:12px;z-index:2147482000;';
      const button = switcherButton(this.host, 'floating');
      this.buttons.add(button);
      document.documentElement.append(this.host);
      setButtonLabel(button, view);
    },
    hide() {
      this.host?.remove();
      this.host = null;
    },
    update(view) {
      for (const button of this.buttons) setButtonLabel(button, view);
    },
  };

  const panel = {
    host: null,
    root: null,
    view: null,
    anchorRight: 12,
    top: 6,
    confirmSlotId: null,
    renamingSlotId: null,

    async toggle(anchorRight, view, top = 6) {
      if (this.host) {
        this.close();
        return;
      }
      this.anchorRight = anchorRight ?? 12;
      this.top = top;
      this.view = view ?? await send({ type: 'state:get' });
      this.open();
    },

    open() {
      this.host = document.createElement('div');
      this.host.style.cssText = `position:fixed;top:${this.top}px;right:${this.anchorRight}px;z-index:2147483600;`;
      this.root = this.host.attachShadow({ mode: 'closed' });
      document.documentElement.append(this.host);
      this.onOutside = (event) => {
        if (!event.composedPath().includes(this.host)) this.close();
      };
      this.onKey = (event) => {
        if (event.key === 'Escape') this.close();
      };
      setTimeout(() => {
        document.addEventListener('mousedown', this.onOutside, true);
        document.addEventListener('keydown', this.onKey, true);
      });
      this.render();
    },

    close() {
      document.removeEventListener('mousedown', this.onOutside, true);
      document.removeEventListener('keydown', this.onKey, true);
      this.host?.remove();
      this.host = null;
      this.confirmSlotId = null;
      this.renamingSlotId = null;
    },

    update(view) {
      this.view = view;
      if (this.host) this.render();
    },

    action(type, extra = {}) {
      return send({ type, origin: aspLoginUrl()?.replace(/\/bh\/inloggen\.asp$/, '') ?? 'https://secure.e-boekhouden.nl', ...extra });
    },

    choose(slot) {
      if (slot.active && this.view.loggedIn) {
        this.close();
        return;
      }
      if (this.view.tabCount > 1 && this.confirmSlotId !== slot.id) {
        this.confirmSlotId = slot.id;
        this.render();
        return;
      }
      this.action('switcher:switch', { slotId: slot.id });
      this.close();
    },

    render() {
      const view = this.view ?? { slots: [], tabCount: 1 };
      const root = this.root;
      root.replaceChildren();

      const style = document.createElement('style');
      style.textContent = PANEL_CSS;
      const card = el('div', 'card');
      const heading = el('div', 'heading', 'Sessies');

      const list = el('div', 'list');
      if (!view.slots.length) {
        list.append(el('p', 'empty', 'Nog geen sessies. Log in, dan verschijnt de administratie hier vanzelf.'));
      }
      for (const slot of view.slots) list.append(this.row(slot, view));

      const add = el('button', 'add', '+ Sessie toevoegen');
      add.type = 'button';
      add.title = 'Bewaart de huidige sessie en opent een leeg inlogscherm';
      add.addEventListener('click', () => {
        if (view.tabCount > 1 && this.confirmSlotId !== 'new') {
          this.confirmSlotId = 'new';
          this.render();
          return;
        }
        this.action('switcher:add');
        this.close();
      });

      card.append(heading, list, add);
      if (this.confirmSlotId === 'new') card.append(this.confirm(view, () => { this.action('switcher:add'); this.close(); }));
      card.append(el('p', 'note', 'Wachtwoorden blijven in 1Password. Sessies staan alleen in het werkgeheugen van Chrome.'));
      root.append(style, card);
    },

    row(slot, view) {
      const wrap = el('div', 'row-wrap');
      const row = el('div', `row${slot.active ? ' active' : ''}`);

      if (this.renamingSlotId === slot.id) {
        const input = document.createElement('input');
        input.className = 'rename';
        input.value = slot.label;
        input.maxLength = 60;
        const commit = () => {
          this.renamingSlotId = null;
          this.action('switcher:rename', { slotId: slot.id, label: input.value });
        };
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            event.stopPropagation();
            this.renamingSlotId = null;
            this.render();
          }
        });
        input.addEventListener('blur', commit);
        row.append(input);
        wrap.append(row);
        setTimeout(() => input.select());
        return wrap;
      }

      const main = el('button', 'pick');
      main.type = 'button';
      const dot = el('span', `dot ${slot.active && view.loggedIn ? 'on' : slot.ready ? 'ready' : 'off'}`);
      const name = el('span', 'name', slot.label);
      const status = el('span', 'status', slot.active && view.loggedIn ? 'actief' : slot.ready ? 'opgeslagen' : 'inloggen');
      main.append(dot, name, status);
      main.addEventListener('click', () => this.choose(slot));

      const rename = iconButton('✎', 'Naam wijzigen', () => {
        this.renamingSlotId = slot.id;
        this.render();
      });
      const remove = iconButton('×', 'Verwijderen', () => this.action('switcher:remove', { slotId: slot.id }));
      row.append(main, rename, remove);
      wrap.append(row);
      if (this.confirmSlotId === slot.id) {
        wrap.append(this.confirm(view, () => {
          this.action('switcher:switch', { slotId: slot.id });
          this.close();
        }));
      }
      return wrap;
    },

    confirm(view, onConfirm) {
      const box = el('div', 'confirm');
      box.append(el('span', '', `Alle ${view.tabCount} e-Boekhouden-tabbladen worden herladen. Niet opgeslagen invoer gaat verloren.`));
      const ok = el('button', 'ok', 'Doorgaan');
      ok.type = 'button';
      ok.addEventListener('click', onConfirm);
      const no = el('button', 'no', 'Annuleren');
      no.type = 'button';
      no.addEventListener('click', () => {
        this.confirmSlotId = null;
        this.render();
      });
      const buttons = el('div', 'confirm-buttons');
      buttons.append(no, ok);
      box.append(buttons);
      return box;
    },
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function iconButton(glyph, label, onClick) {
    const button = el('button', 'icon', glyph);
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', onClick);
    return button;
  }

  const PANEL_CSS = `
    :host { all: initial; }
    .card {
      width: 300px; box-sizing: border-box; padding: 10px;
      font: 13px/1.35 Ubuntu, system-ui, -apple-system, sans-serif; color: #30395f;
      background: #fff; border: 1px solid #dfe2ea; border-radius: 12px;
      box-shadow: 0 18px 48px rgba(20, 26, 48, 0.22);
    }
    .heading { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: #8a90a6; padding: 4px 8px 8px; }
    .list { display: flex; flex-direction: column; gap: 2px; }
    .row { display: flex; align-items: center; border-radius: 8px; }
    .row:hover { background: #f3f5f9; }
    .row.active { background: #eef6e7; }
    .pick { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px; border: 0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
    .name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
    .status { font-size: 11px; color: #8a90a6; }
    .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
    .dot.on { background: #68ab32; box-shadow: 0 0 0 3px rgba(104, 171, 50, .2); }
    .dot.ready { background: #9fb3d9; }
    .dot.off { background: transparent; border: 1.5px solid #b9bfd0; box-sizing: border-box; }
    .icon { border: 0; background: none; color: #9aa0b4; cursor: pointer; font-size: 14px; width: 26px; height: 26px; border-radius: 6px; }
    .icon:hover { color: #30395f; background: #e6e9f1; }
    .rename { flex: 1; margin: 4px; padding: 6px 8px; font: inherit; color: inherit; border: 1px solid #68ab32; border-radius: 6px; outline: none; }
    .add { width: 100%; margin-top: 6px; padding: 9px 8px; border: 1px dashed #c9cede; border-radius: 8px; background: none; font: inherit; font-weight: 500; color: #30395f; cursor: pointer; text-align: left; }
    .add:hover { border-color: #68ab32; background: #f7fbf3; }
    .empty { margin: 4px 8px 8px; color: #6b7187; }
    .note { margin: 10px 8px 2px; font-size: 11px; color: #8a90a6; }
    .confirm { margin: 4px 0 6px; padding: 8px 10px; border-radius: 8px; background: #fff8e6; color: #6b5310; font-size: 12px; }
    .confirm-buttons { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
    .confirm button { font: inherit; font-weight: 500; padding: 5px 10px; border-radius: 6px; cursor: pointer; }
    .confirm .no { border: 1px solid #e0d3a8; background: #fff; color: #6b5310; }
    .confirm .ok { border: 0; background: #30395f; color: #fff; }
  `;
})();
