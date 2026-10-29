// EB Sessions: the login page.
//
//   top /bh/ with the login iframe (login-breakout.js)
//       a header with the e-Boekhouden logo; content.js puts the
//       "Administraties" menu in it.
//   /bh/inloggen.asp with the bare login form
//       "Actieve sessies" (saved sessions open straight away) and "Eerder
//       gebruikt" (log in for that administration). With Better design on, the
//       page is laid out anew around the same form.
//
// The form fields, the hidden fields and the Inloggen button are always
// e-Boekhouden's own elements: they are restyled or moved, never replaced, and
// the form posts to e-Boekhouden as before. Nothing here fills in or submits
// anything. On submit only the username is read, as a key to match the
// session to its saved entry; the password field is never read.

(() => {
  if (window.__ebsLoginPageLoaded) return;
  window.__ebsLoginPageLoaded = true;

  const LOGO = '/images/Logo-EB_blauwopwit.svg';
  const path = location.pathname.toLowerCase();
  let refresh = () => {};

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
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  async function loadState() {
    const all = await chrome.storage.local.get(null);
    const context = await send({ type: 'login:context' });
    return {
      slots: Array.isArray(all.slots) ? all.slots : [],
      view: all.view ?? {},
      avatars: Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith('avatar:')).map(([key, value]) => [key.slice(7), value])),
      settings: EBS.settingsWithDefaults(all.settings),
      pendingLoginFor: context?.pendingLoginFor ?? null,
      relogin: Boolean(context?.relogin),
    };
  }

  // -------------------------------------------------------------------------
  // Top: header above the login iframe.
  // -------------------------------------------------------------------------

  if (window === window.top) {
    // The swap can happen before or after DOMContentLoaded (it waits for the
    // settings), so react to whichever comes last.
    // Both the swap event and DOMContentLoaded can call this while the first
    // call still waits for the settings: the flag is set before that wait.
    let started = false;
    const addHeader = async () => {
      const host = document.getElementById('ebs-login-host');
      if (!host || started || document.getElementById('ebs-login-header')) return;
      started = true;
      const { settings } = await loadState();
      const header = el('div');
      header.id = 'ebs-login-header';
      header.className = settings.betterDesign ? 'better' : 'classic';
      const logo = el('img');
      logo.src = LOGO;
      logo.alt = 'e-Boekhouden.nl';
      const nav = el('div');
      nav.id = 'ebs-login-nav';
      header.append(logo, nav);
      const style = el('style');
      style.textContent = `
        #ebs-login-header { position: fixed; top: 0; left: 0; right: 0; height: 60px; z-index: 2; display: flex; align-items: stretch; justify-content: space-between; box-sizing: border-box; padding-left: 24px; background: #fff; border-bottom: 2px solid #f0f0f0; font-family: Ubuntu, system-ui, sans-serif; }
        #ebs-login-header.better { height: 64px; padding: 0 40px; border-bottom: 1px solid #e3e6ee; }
        #ebs-login-header img { align-self: center; height: 30px; }
        #ebs-login-nav { display: flex; align-items: stretch; }
        #ebs-login-host > iframe#mainframe { top: 60px !important; height: calc(100% - 60px) !important; }
        #ebs-login-header.better ~ iframe#mainframe { top: 64px !important; height: calc(100% - 64px) !important; }
        html.ebs-login-app #ebs-login-header { display: none !important; }
        html.ebs-login-app #ebs-login-host > iframe#mainframe { top: 0 !important; height: 100% !important; }
      `;
      host.prepend(style, header);
    };
    document.addEventListener('ebs-login-host', addHeader);
    onReady(addHeader);
    return;
  }

  if (path !== '/bh/inloggen.asp') return;

  onReady(async () => {
    const form = document.getElementById('frm');
    const user = document.getElementById('txtEmail');
    if (!form || !user) return;
    if (/reeds ingelogd/i.test(document.body?.innerText ?? '')) return;

    // The username, as a matching key; never the password. Read when the form
    // is sent, and also on the Inloggen button and on leaving the page: a
    // form sent from script (form.submit()) fires no submit event.
    let sentUsername = null;
    const sendUsername = () => {
      if (user.value === sentUsername) return;
      sentUsername = user.value;
      send({ type: 'login:username', username: user.value });
    };
    form.addEventListener('submit', sendUsername, true);
    // The Inloggen button waits visibly once the form is really on its way,
    // so it cannot be pressed twice. e-Boekhouden's own script only blocks it
    // for 2 seconds. Set after this tick: a disabled submit button would drop
    // its own name and value from the form that is being sent.
    form.addEventListener('submit', (event) => {
      if (event.defaultPrevented) return;
      const button = form.querySelector('input[type="submit"], button[type="submit"]');
      if (!button) return;
      setTimeout(() => setLoginBusy(button, true), 0);
      // A page that stays (an error shown by script, a lost connection) gets
      // the button back.
      setTimeout(() => setLoginBusy(button, false), 20000);
    });
    form.querySelector('input[type="submit"], button[type="submit"]')?.addEventListener('click', sendUsername, true);
    window.addEventListener('pagehide', () => {
      if (user.value) sendUsername();
    });

    let state = await loadState();
    // The re-login dialog (content.js) shows this same form on its own:
    // leave the page as it is then.
    if (state.relogin && state.settings.relogin) return;
    const page = state.settings.betterDesign && inLoginHost() ? betterLayout(form, user) : classicLayout(form);
    page.render(state);
    refresh = async () => {
      state = await loadState();
      page.render(state);
    };
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') refresh();
    });
  });

  // The full-page layout only fits the login iframe of the 1Password fix
  // (login-breakout.js). Inside e-Boekhouden's own small v1login frame the
  // classic block is used.
  function inLoginHost() {
    try {
      return window.parent === window.top && Boolean(window.top.document.getElementById('ebs-login-host'));
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Shared: who is who, and what a click does.
  // -------------------------------------------------------------------------

  function split(state) {
    const active = [];
    const other = [];
    for (const slot of state.slots) {
      const status = EBS.statusOf(slot, state.view);
      if (status === 'ready' || status === 'active') active.push(slot);
      else other.push({ slot, status });
    }
    return { active, other };
  }

  function setLoginBusy(button, busy) {
    if (busy && !button.dataset.ebsLabel) button.dataset.ebsLabel = button.value || button.textContent;
    const label = busy ? 'Bezig met inloggen…' : button.dataset.ebsLabel;
    if (button.tagName === 'INPUT') button.value = label;
    else button.textContent = label;
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
    button.classList.toggle('ebs-busy', busy);
  }

  // One switch at a time: further clicks wait for the answer.
  let switching = false;
  async function openSession(slot, onConfirm) {
    if (switching) return;
    switching = true;
    const origin = location.ancestorOrigins.length ? location.ancestorOrigins[location.ancestorOrigins.length - 1] : location.origin;
    const response = await send({ type: 'switcher:switch', slotId: slot.id, origin, confirmed: onConfirm?.confirmed });
    switching = false;
    if (response?.needsConfirm) onConfirm?.ask(response.tabCount);
    else if (response?.error) onConfirm?.fail?.();
  }

  // The choice lives in session storage, which pages cannot watch: redraw here.
  async function chooseForLogin(slot) {
    await send({ type: 'login:for', slotId: slot.id });
    await refresh();
    document.getElementById('txtEmail')?.focus();
  }

  function avatar(slot, status, size, state) {
    const picture = state.avatars[slot.id];
    if (picture) {
      const image = el('img', 'ebs-avatar');
      image.src = picture;
      image.alt = '';
      image.style.width = image.style.height = `${size}px`;
      return image;
    }
    const circle = el('span', `ebs-avatar ${status}`, EBS.initials(slot.name));
    circle.style.width = circle.style.height = `${size}px`;
    return circle;
  }

  function confirmBox(tabCount, onYes, onNo) {
    const box = el('div', 'ebs-confirm');
    box.append(el('span', '', EBS.reloadWarning(tabCount)));
    const buttons = el('div', 'ebs-confirm-buttons');
    const no = el('button', 'ebs-confirm-no', 'Annuleren');
    no.type = 'button';
    no.addEventListener('click', onNo);
    const yes = el('button', 'ebs-confirm-yes', 'Doorgaan');
    yes.type = 'button';
    yes.addEventListener('click', onYes);
    buttons.append(no, yes);
    box.append(buttons);
    return box;
  }

  // The real login table, and everything else the malformed page puts in #frm.
  function loginTable(form) {
    return document.getElementById('txtEmail')?.closest('#formWrapper') ?? form;
  }

  // -------------------------------------------------------------------------
  // Classic: a block in e-Boekhouden's style above the login form.
  // -------------------------------------------------------------------------

  function classicLayout(form) {
    const style = el('style');
    style.textContent = `
      #ebs-sessions { width: 400px; margin: 0 auto 14px; background: #fff; font-family: 'Ubuntu', sans-serif; color: #30395f; text-align: left; }
      #ebs-sessions .head { display: flex; align-items: baseline; justify-content: space-between; padding: 6px 2px 8px; border-bottom: 2px solid #68ab32; background: #f5f5f5; }
      #ebs-sessions .title { font-size: 16px; font-weight: 700; }
      #ebs-sessions .hint { font-size: 11px; color: #6b6b6b; }
      #ebs-sessions .row { width: 100%; display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 0; border-top: 1px solid #ececec; background: #fff; text-align: left; font-family: inherit; color: inherit; cursor: pointer; }
      #ebs-sessions .row:hover { background: #f5f5f5; }
      #ebs-sessions .row.opening { background: #eff0e2; }
      #ebs-sessions .text { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
      #ebs-sessions .name { font-size: 14px; font-weight: 700; }
      #ebs-sessions .number { font-size: 11px; color: #6b6b6b; }
      #ebs-sessions .open { font-size: 13px; font-weight: 700; color: #3f7f22; }
      #ebs-sessions .none { padding: 10px 12px; font-size: 13px; color: #6b6b6b; border-top: 1px solid #ececec; }
      #ebs-sessions .others { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 10px 12px 12px; border-top: 1px solid #ececec; }
      #ebs-sessions .others-label { font-size: 11px; color: #6b6b6b; margin-right: 2px; }
      #ebs-sessions .chip { height: 26px; padding: 0 10px; border: 1px solid #d3d3d3; border-radius: 13px; background: #fff; font-family: inherit; font-size: 12px; color: #4b4b4b; cursor: pointer; }
      #ebs-sessions .chip.expired { color: #c0392b; }
      #ebs-sessions .chip.picked { border-color: #30395f; }
      #ebs-notice { width: 400px; box-sizing: border-box; margin: 0 auto 14px; display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #fff; border: 1px solid #d9e7cc; border-left: 0; border-top: 2px solid #68ab32; font-family: 'Ubuntu', sans-serif; font-size: 13px; color: #30395f; text-align: left; }
      .ebs-avatar { border-radius: 50%; box-sizing: border-box; flex: none; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; object-fit: cover; background: #dfe4f1; color: #30395f; }
      .ebs-avatar.expired { background: #fbe9e9; color: #b42318; }
      .ebs-avatar.login { background: #fff; border: 1.5px dashed #9aa3bf; color: #5d6584; }
      .ebs-confirm { margin: 0 12px 12px; padding: 10px 12px; background: #fff8e6; color: #6b5310; font-size: 12px; }
      .ebs-confirm-buttons { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
      .ebs-confirm button { font: inherit; padding: 5px 10px; border-radius: 3px; cursor: pointer; }
      .ebs-confirm-no { border: 1px solid #e0d3a8; background: #fff; color: #6b5310; }
      .ebs-confirm-yes { border: 0; background: #30395f; color: #fff; }
    `;
    document.head.append(style);

    const table = loginTable(form);
    const block = el('section');
    block.id = 'ebs-sessions';
    const notice = el('div');
    notice.id = 'ebs-notice';
    notice.setAttribute('role', 'status');
    let opening = null;
    let confirmFor = null;
    let failed = false;

    return {
      render(state) {
        const { active, other } = split(state);
        block.replaceChildren();
        notice.replaceChildren();
        if (!state.slots.length) {
          block.remove();
          notice.remove();
          return;
        }
        if (!block.isConnected) table.before(block);

        const head = el('div', 'head');
        head.append(el('span', 'title', 'Actieve sessies'));
        head.append(el('span', 'hint', opening ? `${opening.name} wordt geopend…` : failed ? 'Openen lukte niet. Probeer het opnieuw.' : 'Klik om direct verder te gaan'));
        block.append(head);
        if (!active.length) block.append(el('div', 'none', 'Geen actieve sessies. Log hieronder in.'));
        for (const slot of active) {
          const row = el('button', `row${opening?.id === slot.id ? ' opening' : ''}`);
          row.type = 'button';
          row.append(avatar(slot, 'ready', 32, state));
          const text = el('span', 'text');
          text.append(el('span', 'name', slot.name));
          if (slot.number) text.append(el('span', 'number', slot.number));
          row.append(text, el('span', 'open', 'Openen →'));
          row.addEventListener('click', () => {
            opening = slot;
            failed = false;
            this.render(state);
            openSession(slot, { ask: (tabCount) => { confirmFor = { slot, tabCount }; this.render(state); }, fail: () => { opening = null; failed = true; this.render(state); } });
          });
          block.append(row);
          if (confirmFor?.slot.id === slot.id) {
            block.append(confirmBox(confirmFor.tabCount, () => openSession(slot, { confirmed: true }), () => { confirmFor = null; opening = null; this.render(state); }));
          }
        }
        if (other.length) {
          const others = el('div', 'others');
          others.append(el('span', 'others-label', 'Eerder gebruikt:'));
          for (const { slot, status } of other) {
            const chip = el('button', `chip ${status}${state.pendingLoginFor === slot.id ? ' picked' : ''}`, `${slot.name} · ${status === 'expired' ? 'verlopen' : 'inloggen'}`);
            chip.type = 'button';
            chip.addEventListener('click', () => chooseForLogin(slot));
            others.append(chip);
          }
          block.append(others);
        }

        const target = state.slots.find((slot) => slot.id === state.pendingLoginFor);
        if (target) {
          notice.append(avatar(target, EBS.statusOf(target, state.view), 28, state));
          notice.append(el('span', '', `Log in voor ${target.name}${target.number ? ` (${target.number})` : ''}. Daarna komt de sessie weer onder deze naam, met profielfoto.`));
          if (!notice.isConnected) table.before(notice);
        } else {
          notice.remove();
        }
      },
    };
  }

  // -------------------------------------------------------------------------
  // Better design: two joined panels, sessions on the left, the form on the right.
  // -------------------------------------------------------------------------

  function betterLayout(form, user) {
    const style = el('style');
    style.textContent = BETTER_CSS;
    document.head.append(style);
    document.documentElement.classList.add('ebs-better-login');

    const page = el('div');
    page.id = 'ebs-better';
    const main = el('main', 'ebs-main');
    const left = el('section', 'ebs-left');
    left.setAttribute('aria-labelledby', 'ebs-active-title');
    const right = el('section', 'ebs-right');
    right.setAttribute('aria-labelledby', 'ebs-login-title');
    const title = el('h1', '', 'Inloggen');
    title.id = 'ebs-login-title';
    const forText = el('span', 'ebs-for');
    const head = el('div', 'ebs-right-head');
    head.append(title, forText);

    // The real form, with only the login table showing (the parser pulls the
    // whole page into #frm). Hidden inputs still submit.
    const table = loginTable(form);
    let node = table;
    while (node && node !== form && node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling === node || sibling.matches('input[type="hidden"], script, style')) continue;
        sibling.classList.add('ebs-better-hidden');
      }
      node = node.parentElement;
    }
    const forgot = document.getElementById('resetPassword');
    const note = el('div', 'ebs-lock');
    note.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
    note.append(document.createTextNode('Wachtwoorden blijven in 1Password. Je logt rechtstreeks in bij e-Boekhouden.'));
    right.append(head, form);
    if (forgot) {
      forgot.classList.add('ebs-forgot');
      forgot.textContent = 'Gebruikersnaam of wachtwoord vergeten?';
      right.append(forgot);
    }
    right.append(note);
    main.append(left, right);

    const footer = el('footer', 'ebs-footer');
    footer.append(document.createTextNode('Nog geen account? '));
    const trial = el('a', '', 'Gratis proefaccount op e-boekhouden.nl');
    trial.href = 'https://www.e-boekhouden.nl';
    trial.target = '_top';
    trial.rel = 'noopener noreferrer';
    footer.append(trial);
    page.append(main, footer);
    document.body.append(page);
    user.focus();

    let opening = null;
    let confirmFor = null;
    let failed = false;
    let query = '';
    let showAll = false;
    let lastFor = null;
    const LIST_AFTER = 4;
    const LIST_PAGE = 9;

    // The heading and the search field stay in place across redraws, so
    // typing in the search keeps its caret and its input method.
    const top = el('div', 'ebs-left-head');
    const heading = el('h2', '', 'Actieve sessies');
    heading.id = 'ebs-active-title';
    const sub = el('span', 'ebs-sub');
    top.append(heading, sub);
    const search = el('input', 'ebs-search');
    search.type = 'search';
    search.placeholder = 'Zoek op naam of nummer, bijvoorbeeld "Studio"';
    search.setAttribute('aria-label', 'Zoek in actieve sessies');
    const content = el('div', 'ebs-left-content');
    left.append(top, search, content);
    let current = null;
    // The listener is a plain function, not a method: it reaches the view
    // through this variable.
    let view = null;
    search.addEventListener('input', () => {
      query = search.value;
      if (current) view.render(current);
    });

    view = {
      render(state) {
        current = state;
        const { active, other } = split(state);
        content.replaceChildren();
        sub.textContent = opening
          ? `${opening.name} wordt geopend…`
          : failed ? 'Openen lukte niet. Probeer het opnieuw.'
          : active.length === 0 ? 'Er staat nog niets open.'
          : active.length > LIST_AFTER ? `${active.length} administraties zijn nog ingelogd.`
          : 'Deze administraties zijn nog ingelogd. Klik om direct verder te gaan.';
        search.hidden = active.length <= LIST_AFTER;

        if (!active.length) {
          const empty = el('div', 'ebs-empty');
          empty.innerHTML = '<svg width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="30" fill="#eef1f8"/><rect x="20" y="30" width="24" height="16" rx="4" stroke="#6b7290" stroke-width="3"/><path d="M25 30v-5a7 7 0 0 1 14 0v5" stroke="#6b7290" stroke-width="3" stroke-linecap="round"/></svg>';
          empty.append(el('strong', '', 'Geen actieve sessies'));
          empty.append(el('span', '', 'Log rechts in bij e-Boekhouden. Daarna verschijnt je administratie hier en kun je er later direct naar terug.'));
          content.append(empty);
        } else if (active.length <= LIST_AFTER) {
          const grid = el('div', 'ebs-cards');
          for (const slot of active) grid.append(this.card(slot, state));
          content.append(grid);
        } else {
          // Many sessions: a searchable list instead of cards.
          const needle = query.trim().toLowerCase();
          const matches = active.filter((slot) => !needle || `${slot.name} ${slot.number ?? ''}`.toLowerCase().includes(needle));
          const shown = showAll ? matches : matches.slice(0, LIST_PAGE);
          const list = el('div', 'ebs-list');
          for (const slot of shown) list.append(this.listRow(slot, state));
          const more = el('div', 'ebs-more');
          more.append(el('span', '', `${shown.length} van ${matches.length} getoond`));
          if (!showAll && matches.length > shown.length) {
            const all = el('button', 'ebs-link', 'Alles tonen');
            all.type = 'button';
            all.addEventListener('click', () => { showAll = true; this.render(state); });
            more.append(all);
          }
          content.append(list, more);
        }

        if (other.length) {
          const block = el('div', 'ebs-others');
          block.append(el('span', 'ebs-others-title', 'Eerder gebruikt'));
          for (const { slot, status } of other) {
            const row = el('button', `ebs-other${state.pendingLoginFor === slot.id ? ' picked' : ''}`);
            row.type = 'button';
            row.setAttribute('aria-pressed', String(state.pendingLoginFor === slot.id));
            row.append(avatar(slot, status, 30, state));
            const name = el('span', 'ebs-other-name', slot.name);
            if (slot.number) name.append(el('span', 'ebs-other-number', ` · ${slot.number}`));
            row.append(name, el('span', `ebs-pill ${status}`, status === 'expired' ? 'Verlopen' : 'Niet ingelogd'), el('span', 'ebs-other-action', 'Inloggen'));
            row.addEventListener('click', () => chooseForLogin(slot));
            block.append(row);
          }
          content.append(block);
        }

        const target = state.slots.find((slot) => slot.id === state.pendingLoginFor);
        const text = target ? `voor ${target.name}${target.number ? ` · ${target.number}` : ''}` : 'Kies links een administratie of log direct in.';
        if (text !== lastFor) {
          forText.textContent = text;
          forText.classList.toggle('picked', Boolean(target));
          // Fade in only on a change after the first render: no animation on load.
          if (lastFor !== null) {
            forText.classList.remove('ebs-changed');
            void forText.offsetWidth;
            forText.classList.add('ebs-changed');
          }
          lastFor = text;
        }
      },

      card(slot, state) {
        const card = el('button', `ebs-card${opening?.id === slot.id ? ' opening' : ''}`);
        card.type = 'button';
        const top = el('span', 'ebs-card-top');
        top.append(avatar(slot, 'ready', 48, state));
        const text = el('span', 'ebs-card-text');
        text.append(el('span', 'ebs-card-name', slot.name));
        if (slot.number) text.append(el('span', 'ebs-card-number', slot.number));
        top.append(text);
        const bottom = el('span', 'ebs-card-bottom');
        bottom.append(el('span', 'ebs-pill ready', 'Ingelogd'), el('span', 'ebs-card-action', opening?.id === slot.id ? 'Bezig…' : 'Openen →'));
        card.append(top, bottom);
        card.addEventListener('click', () => this.open(slot, state));
        if (confirmFor?.slot.id === slot.id) {
          const wrap = el('div', 'ebs-card-wrap');
          wrap.append(card, confirmBox(confirmFor.tabCount, () => openSession(slot, { confirmed: true }), () => { confirmFor = null; opening = null; this.render(state); }));
          return wrap;
        }
        return card;
      },

      listRow(slot, state) {
        const row = el('button', `ebs-list-row${opening?.id === slot.id ? ' opening' : ''}`);
        row.type = 'button';
        row.append(avatar(slot, 'ready', 32, state), el('span', 'ebs-list-name', slot.name), el('span', 'ebs-list-number', slot.number ?? ''), el('span', 'ebs-list-action', opening?.id === slot.id ? 'Bezig…' : 'Openen →'));
        row.addEventListener('click', () => this.open(slot, state));
        return row;
      },

      open(slot, state) {
        opening = slot;
        failed = false;
        this.render(state);
        openSession(slot, { ask: (tabCount) => { confirmFor = { slot, tabCount }; this.render(state); }, fail: () => { opening = null; failed = true; this.render(state); } });
      },
    };
    return view;
  }

  const BETTER_CSS = `
    html.ebs-better-login, html.ebs-better-login body { background: #eef0f5 !important; }
    html.ebs-better-login body { margin: 0 !important; }
    html.ebs-better-login body > *:not(#ebs-better):not(script):not(style) { display: none !important; }
    html.ebs-better-login .ebs-better-hidden { display: none !important; }
    #ebs-better { font-family: Ubuntu, system-ui, sans-serif; color: #232c4f; min-height: 100vh; display: flex; flex-direction: column; }
    #ebs-better .ebs-main { flex: 1; display: flex; justify-content: center; align-items: flex-start; flex-wrap: wrap; padding: 64px 40px 0; }
    #ebs-better .ebs-left { width: 460px; max-width: 100%; box-sizing: border-box; padding: 32px; display: flex; flex-direction: column; gap: 14px; background: #f7f8fb; border-radius: 16px 0 0 16px; box-shadow: 0 18px 48px rgba(20, 26, 48, .10); }
    #ebs-better .ebs-right { width: 420px; max-width: 100%; box-sizing: border-box; padding: 32px; display: flex; flex-direction: column; gap: 20px; background: #fff; border-left: 1px solid #e3e6ee; border-radius: 0 16px 16px 0; box-shadow: 0 1px 0 rgba(20, 26, 48, .04), 0 18px 48px rgba(20, 26, 48, .10); }
    #ebs-better h1 { margin: 0; font-size: 24px; font-weight: 700; color: #232c4f; }
    #ebs-better h2 { margin: 0; font-size: 22px; font-weight: 700; }
    #ebs-better .ebs-left-head { display: flex; flex-direction: column; gap: 4px; }
    #ebs-better .ebs-right-head { display: flex; flex-direction: column; gap: 6px; }
    #ebs-better .ebs-left-content { display: flex; flex-direction: column; gap: 14px; }
    #ebs-better .ebs-search[hidden] { display: none; }
    #ebs-better .ebs-sub { font-size: 13px; color: #5d6584; }
    #ebs-better .ebs-for { font-size: 14px; color: #5d6584; }
    #ebs-better .ebs-for.picked { color: #232c4f; font-weight: 500; }
    #ebs-better .ebs-for.ebs-changed { animation: ebs-for-in 160ms cubic-bezier(0.23, 1, 0.32, 1); }
    @keyframes ebs-for-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }

    /* The real form, restyled. */
    #ebs-better #frm, #ebs-better #frm table, #ebs-better #frm tbody, #ebs-better #frm tr, #ebs-better #frm td, #ebs-better #frm center { display: block; width: auto !important; height: auto !important; margin: 0; padding: 0 !important; border: 0 !important; background: none !important; text-align: left; }
    #ebs-better #frm hr { display: none; }
    #frm .ebs-busy { cursor: wait !important; opacity: .75; }
    #ebs-better #formWrapper > tbody > tr:first-child { display: none; }
    #ebs-better #frm tr.TRNORM { margin-bottom: 16px !important; }
    #ebs-better #frm tr.TRNORM > td:first-child, #ebs-better #frm tr.TRNORM > td:first-child font { display: block; margin-bottom: 6px; font-size: 13px; font-weight: 500; color: #232c4f !important; }
    #ebs-better #frm input.INPUTBOX { box-sizing: border-box; width: 100% !important; height: 46px; padding: 0 14px; border: 1.5px solid #cfd4e2; border-radius: 10px; font: 15px Ubuntu, system-ui, sans-serif; color: #232c4f; background: #fff; }
    #ebs-better #frm input.INPUTBOX:focus { border-color: #232c4f; outline: 3px solid rgba(35, 44, 79, .12); }
    #ebs-better #frm input.act-btn { box-sizing: border-box; width: 100%; height: 48px; margin-top: 4px; border: 0; border-radius: 10px; background: #232c4f; color: #fff; font: 700 15px Ubuntu, system-ui, sans-serif; cursor: pointer; transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1); }
    #ebs-better #frm input.act-btn:active { transform: scale(0.98); }
    #ebs-better #frm input.act-btn.ebs-busy { background: #4a5272; cursor: wait; transform: none; }
    #ebs-better #frm input.act-btn:focus-visible { outline: 2px solid #5d9e35; outline-offset: 2px; }
    #ebs-better .ebs-forgot { align-self: center; display: block !important; font-size: 13px; color: #232c4f; }
    #ebs-better .ebs-lock { display: flex; align-items: center; gap: 8px; padding-top: 16px; border-top: 1px solid #eef0f5; font-size: 12px; color: #5d6584; }

    /* Sessions. */
    #ebs-better button { font-family: inherit; color: inherit; cursor: pointer; }
    #ebs-better .ebs-avatar { border-radius: 50%; box-sizing: border-box; flex: none; display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; object-fit: cover; background: #dfe4f1; color: #232c4f; }
    #ebs-better .ebs-avatar.expired { background: #fbe9e9; color: #b42318; }
    #ebs-better .ebs-avatar.login { background: #fff; border: 1.5px dashed #9aa3bf; color: #5d6584; }
    #ebs-better .ebs-cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    #ebs-better .ebs-card { display: flex; flex-direction: column; gap: 16px; padding: 18px; border: 1px solid #dfe3ec; border-radius: 14px; background: #fff; text-align: left; box-shadow: 0 8px 22px rgba(20, 26, 48, .08); transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1); }
    #ebs-better .ebs-card:active, #ebs-better .ebs-list-row:active, #ebs-better .ebs-other:active { transform: scale(0.98); }
    #ebs-better .ebs-card.opening { border: 2px solid #5d9e35; }
    #ebs-better .ebs-card:focus-visible, #ebs-better .ebs-list-row:focus-visible, #ebs-better .ebs-other:focus-visible { outline: 2px solid #232c4f; outline-offset: 2px; }
    #ebs-better .ebs-card-top { display: flex; align-items: center; gap: 12px; min-width: 0; }
    #ebs-better .ebs-card-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    #ebs-better .ebs-card-name { font-size: 15px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    #ebs-better .ebs-card-number, #ebs-better .ebs-list-number { font-size: 12px; color: #5d6584; }
    #ebs-better .ebs-card-bottom { display: flex; align-items: center; justify-content: space-between; }
    #ebs-better .ebs-card-action { font-size: 14px; font-weight: 700; }
    #ebs-better .ebs-list-action { font-size: 13px; font-weight: 700; }
    #ebs-better .ebs-pill { padding: 3px 9px; border-radius: 10px; font-size: 12px; font-weight: 500; }
    #ebs-better .ebs-pill.ready { background: #eef6e7; color: #2f6f1a; }
    #ebs-better .ebs-pill.expired { background: #fbe9e9; color: #b42318; }
    #ebs-better .ebs-pill.login { background: #f1f3f8; color: #4a5272; }
    #ebs-better .ebs-search { box-sizing: border-box; height: 40px; padding: 0 12px; border: 1px solid #d6dbe8; border-radius: 10px; background: #fff; font: 13px Ubuntu, system-ui, sans-serif; color: #232c4f; }
    #ebs-better .ebs-list { display: flex; flex-direction: column; gap: 6px; max-height: 400px; overflow: auto; padding-right: 4px; }
    #ebs-better .ebs-list-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid #e3e6ee; border-radius: 10px; background: #fff; text-align: left; transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1); }
    #ebs-better .ebs-list-row.opening { border-color: #5d9e35; }
    #ebs-better .ebs-list-name { flex: 1; min-width: 0; font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #ebs-better .ebs-more { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #5d6584; }
    #ebs-better .ebs-link { border: 0; background: none; padding: 0; text-decoration: underline; font-size: 12px; }
    #ebs-better .ebs-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px 24px; border: 1.5px dashed #c5cbdc; border-radius: 12px; background: #fff; text-align: center; }
    #ebs-better .ebs-empty strong { font-size: 16px; }
    #ebs-better .ebs-empty span { font-size: 13px; line-height: 19px; color: #5d6584; max-width: 300px; }
    #ebs-better .ebs-others { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
    #ebs-better .ebs-others-title { font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: #6b7290; }
    #ebs-better .ebs-other { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border: 1px solid transparent; border-radius: 10px; background: transparent; text-align: left; transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1); }
    #ebs-better .ebs-other.picked { border: 1.5px solid #232c4f; background: #fff; }
    #ebs-better .ebs-other-name { flex: 1; min-width: 0; font-size: 14px; }
    #ebs-better .ebs-other-number { font-size: 12px; color: #6b7290; }
    #ebs-better .ebs-other-action { font-size: 13px; color: #3a4677; }
    #ebs-better .ebs-confirm { margin-top: 8px; padding: 10px 12px; border-radius: 8px; background: #fff8e6; color: #6b5310; font-size: 12px; }
    #ebs-better .ebs-confirm-buttons { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
    #ebs-better .ebs-confirm button { padding: 6px 12px; border-radius: 6px; font-size: 12px; }
    #ebs-better .ebs-confirm-no { border: 1px solid #e0d3a8; background: #fff; color: #6b5310; }
    #ebs-better .ebs-confirm-yes { border: 0; background: #232c4f; color: #fff !important; }
    #ebs-better .ebs-footer { padding: 20px 40px; display: flex; justify-content: center; gap: 4px; font-size: 12px; color: #6b7290; }
    #ebs-better .ebs-footer a { color: #4a5272; }
    @media (max-width: 920px) {
      #ebs-better .ebs-left { border-radius: 16px 16px 0 0; }
      #ebs-better .ebs-right { border-left: 0; border-top: 1px solid #e3e6ee; border-radius: 0 0 16px 16px; }
    }
    @media (prefers-reduced-motion: reduce) {
      #ebs-better .ebs-for.ebs-changed { animation: ebs-for-fade 160ms ease-out; }
      #ebs-better .ebs-card:active, #ebs-better .ebs-list-row:active, #ebs-better .ebs-other:active, #ebs-better #frm input.act-btn:active { transform: none; }
    }
    @keyframes ebs-for-fade { from { opacity: 0; } to { opacity: 1; } }
  `;
})();
