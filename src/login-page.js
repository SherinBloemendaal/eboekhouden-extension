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

  // EBS.icon (Lucide).
  function icon(name, options = {}) {
    return EBS.icon(name, options);
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
    const ancestors = location.ancestorOrigins ?? [];
    const origin = ancestors.length ? ancestors[ancestors.length - 1] : location.origin;
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
      #ebs-sessions .row { transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease; }
      #ebs-sessions .row:hover { background: #f5f5f5; }
      #ebs-sessions .row.opening { background: #eff0e2; }
      #ebs-sessions .text { display: flex; flex-direction: column; gap: 1px; flex: 1; min-width: 0; }
      #ebs-sessions .name { font-size: 14px; font-weight: 700; }
      #ebs-sessions .number { font-size: 11px; color: #6b6b6b; }
      #ebs-sessions .open { display: flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 700; color: #3f7f22; }
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
          const open = el('span', 'open', 'Openen');
          open.append(icon('arrow-right', { size: 14 }));
          row.append(text, open);
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
  //
  // The left panel is always one searchable list, for 1 session or 100 (the
  // boards LoginRedesign and LoginRedesign-gh7e): every administration in the
  // order of the switcher, with its status. A row that is still logged in
  // opens straight away; an expired or logged-out one puts its name above the
  // form ("voor ..."), so you know which login 1Password should fill. With no
  // administration at all the panel shows the empty state of LoginRedesign-pxam.
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
    right.append(head, form);
    if (forgot) {
      forgot.classList.add('ebs-forgot');
      forgot.textContent = 'Gebruikersnaam of wachtwoord vergeten?';
      right.append(forgot);
    }
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
    // The row whose switch is on its way: "Bezig…", disabled, aria-busy.
    let busyId = null;
    let confirmFor = null;
    let failed = false;
    let query = '';
    let showAll = false;
    let lastFor = null;
    let current = null;
    let shown = [];
    // The list shows its rows nine at a time, as the board does ("Scroll voor
    // meer · 9 van 100 getoond"); scrolling to the end adds the next nine,
    // and "Alles tonen" shows every row at once.
    const STEP = 9;
    let limit = STEP;
    let rendered = 0;

    // Everything on the left is built once and stays in place across
    // redraws: typing in the search keeps its caret and input method, and
    // the list keeps its scroll position.
    const top = el('div', 'ebs-left-head');
    const heading = el('h2', '', 'Actieve sessies');
    heading.id = 'ebs-active-title';
    const sub = el('span', 'ebs-sub');
    top.append(heading, sub);
    const search = el('label', 'ebs-search');
    const searchInput = el('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'Zoek op naam of nummer';
    searchInput.setAttribute('aria-label', 'Zoek een administratie');
    search.append(icon('search'), searchInput);
    const list = el('div', 'ebs-list');
    // The fade over the last rows while there is more to scroll to; it
    // takes no room of its own (see .ebs-fade).
    const fade = el('div', 'ebs-fade');
    fade.setAttribute('aria-hidden', 'true');
    fade.append(el('span'));
    const more = el('div', 'ebs-more');
    const moreText = el('span', 'ebs-more-text');
    const allButton = el('button', 'ebs-link', 'Alles tonen');
    allButton.type = 'button';
    allButton.addEventListener('click', () => {
      showAll = true;
      view.render(current);
      searchInput.focus();
    });
    more.append(moreText);
    const empty = el('div', 'ebs-empty');
    const lock = el('span', 'ebs-empty-icon');
    lock.setAttribute('aria-hidden', 'true');
    lock.append(icon('lock', { size: 28 }));
    empty.append(lock, el('strong', '', 'Geen actieve sessies'), el('span', '', 'Log rechts in bij e-Boekhouden. Daarna verschijnt je administratie hier en kun je er later direct naar terug.'));

    searchInput.addEventListener('input', () => {
      query = searchInput.value;
      limit = STEP;
      if (current) view.render(current);
    });
    let scrollFrame = 0;
    list.addEventListener('scroll', () => {
      if (scrollFrame) return;
      scrollFrame = requestAnimationFrame(() => {
        scrollFrame = 0;
        updateMore();
      });
    }, { passive: true });

    // The next nine rows, added below the ones there are: the rows above and
    // the scroll position stay as they are.
    function showMore() {
      if (!current || showAll || rendered >= shown.length) return;
      const next = shown.slice(rendered, rendered + STEP);
      limit = rendered + next.length;
      rendered = limit;
      list.append(...next.flatMap((slot) => row(slot, current)));
    }

    function isReady(status) {
      return status === 'ready' || status === 'active';
    }

    function subText(state) {
      if (opening) return `${opening.name} wordt geopend…`;
      if (failed) return 'Openen lukte niet. Probeer het opnieuw.';
      const total = state.slots.length;
      const ready = state.slots.filter((slot) => isReady(EBS.statusOf(slot, state.view))).length;
      if (!total) return 'Er staat nog niets open.';
      if (ready === total) return total === 1 ? '1 administratie is nog ingelogd.' : `${total} administraties zijn nog ingelogd.`;
      if (!ready) return `Geen van de ${total} administraties is nog ingelogd. Kies er een om voor in te loggen.`;
      return `${ready} van ${total} administraties ${ready === 1 ? 'is' : 'zijn'} nog ingelogd. Klik om direct verder te gaan.`;
    }

    // Below the list: how many there are, or, while there is more, how many
    // rows the list holds so far ("Scroll voor meer · 9 van 100 getoond").
    function updateMore() {
      if (!current) return;
      const total = current.slots.length;
      // Near the end (the last row in view) the next rows come in; a list
      // that does not fill its height gets them straight away.
      for (let guard = 0; guard < shown.length && !showAll && rendered < shown.length; guard += 1) {
        const room = list.scrollHeight - (list.scrollTop + list.clientHeight);
        if (room > 60) break;
        showMore();
      }
      const overflow = !showAll && list.scrollHeight > list.clientHeight + 1;
      const atEnd = list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
      const hasMore = !showAll && rendered < shown.length;
      // The scroll styling (room for the thin scrollbar) follows the whole
      // list, not a search, so the rows keep their width while you type.
      if (!query.trim()) list.classList.toggle('scrolls', overflow);
      fade.classList.toggle('on', overflow && !atEnd);
      if ((overflow && !atEnd) || hasMore) {
        const text = `Scroll voor meer · ${rendered} van ${shown.length} getoond`;
        if (moreText.dataset.text !== text) {
          moreText.dataset.text = text;
          moreText.className = 'ebs-more-text scroll';
          moreText.replaceChildren(icon('arrow-down', { size: 14 }), document.createTextNode(text));
        }
        if (allButton.parentElement !== more) more.append(allButton);
        return;
      }
      const text = query.trim()
        ? `${shown.length} van ${total} getoond`
        : `${total} ${total === 1 ? 'administratie' : 'administraties'}`;
      if (moreText.dataset.text !== text) {
        moreText.dataset.text = text;
        moreText.className = 'ebs-more-text';
        moreText.textContent = text;
      }
      allButton.remove();
    }

    function row(slot, state) {
      const status = EBS.statusOf(slot, state.view);
      const ready = isReady(status);
      const isOpening = ready && opening?.id === slot.id;
      const picked = !ready && state.pendingLoginFor === slot.id;
      const button = el('button', `ebs-row${isOpening ? ' opening' : ''}${picked ? ' picked' : ''}`);
      button.type = 'button';
      button.dataset.slot = slot.id;
      button.setAttribute('aria-pressed', String(isOpening || picked));
      button.append(avatar(slot, ready ? 'ready' : status, 32, state), el('span', 'ebs-row-name', slot.name));
      if (slot.number) button.append(el('span', 'ebs-row-number', slot.number));
      if (!ready) button.append(el('span', `ebs-pill ${status}`, status === 'expired' ? 'Verlopen' : 'Niet ingelogd'));
      const action = el('span', 'ebs-row-action', ready ? (isOpening ? 'Bezig…' : 'Openen') : 'Inloggen');
      if (ready && !isOpening) action.append(icon('arrow-right'));
      button.append(action);
      if (busyId === slot.id) {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
      }
      button.addEventListener('click', () => (ready ? open(slot) : chooseForLogin(slot)));
      if (confirmFor?.slot.id !== slot.id) return [button];
      return [button, confirmBox(confirmFor.tabCount, () => requestSwitch(slot, true), () => {
        confirmFor = null;
        opening = null;
        view.render(current);
      })];
    }

    async function requestSwitch(slot, confirmed) {
      busyId = slot.id;
      view.render(current);
      try {
        await openSession(slot, {
          confirmed,
          ask: (tabCount) => { confirmFor = { slot, tabCount }; },
          fail: () => { opening = null; confirmFor = null; failed = true; },
        });
      } finally {
        busyId = null;
        if (current) view.render(current);
      }
    }

    function open(slot) {
      if (busyId) return;
      opening = slot;
      failed = false;
      confirmFor = null;
      requestSwitch(slot, false);
    }

    const view = {
      render(state) {
        current = state;
        sub.textContent = subText(state);

        if (!state.slots.length) {
          if (left.lastElementChild !== empty) left.replaceChildren(top, empty);
        } else {
          if (search.parentElement !== left) left.replaceChildren(top, search, list, fade, more);
          const needle = query.trim().toLowerCase();
          shown = state.slots.filter((slot) => !needle || `${slot.name} ${slot.number ?? ''}`.toLowerCase().includes(needle));
          // Focus stays on the same row across a redraw (a storage change).
          const focused = list.contains(document.activeElement) ? document.activeElement.dataset.slot : null;
          list.classList.toggle('all', showAll);
          // A redraw keeps the rows the list already showed.
          const rows = showAll ? shown : shown.slice(0, Math.max(limit, STEP));
          rendered = rows.length;
          list.replaceChildren(...rows.flatMap((slot) => row(slot, state)));
          if (!shown.length) list.append(el('span', 'ebs-no-match', `Geen administratie gevonden voor "${query.trim()}".`));
          if (focused) list.querySelector(`.ebs-row[data-slot="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
          updateMore();
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
    #ebs-better .ebs-left { position: relative; z-index: 0; width: 460px; max-width: 100%; box-sizing: border-box; padding: 32px; display: flex; flex-direction: column; gap: 14px; background: #f7f8fb; border-radius: 16px 0 0 16px; box-shadow: 0 18px 48px rgba(20, 26, 48, .10); }
    #ebs-better .ebs-right { position: relative; z-index: 1; width: 420px; max-width: 100%; box-sizing: border-box; padding: 32px; display: flex; flex-direction: column; gap: 20px; background: #fff; border-left: 1px solid #e3e6ee; border-radius: 0 16px 16px 0; box-shadow: 0 1px 0 rgba(20, 26, 48, .04), 0 18px 48px rgba(20, 26, 48, .10); }
    /* The page's own h2 rule (19px, #30395f, inline-block, 10px padding
       below) and its "a { font-size: 13px }" must not reach the panels. */
    #ebs-better h1 { margin: 0; font-size: 24px; font-weight: 700; color: #232c4f; }
    #ebs-better h2 { display: block; margin: 0; padding: 0; font-size: 22px; font-weight: 700; color: inherit; }
    #ebs-better .ebs-left-head { display: flex; flex-direction: column; gap: 4px; }
    #ebs-better .ebs-right-head { display: flex; flex-direction: column; gap: 6px; }
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
    #ebs-better #frm input.INPUTBOX { box-sizing: border-box; width: 100% !important; height: 46px; padding: 0 14px; border: 1.5px solid #cfd4e2; border-radius: 10px; font: 15px Ubuntu, system-ui, sans-serif; color: #232c4f; background: #fff; transition: border-color 150ms ease, outline-color 150ms ease; }
    #ebs-better #frm input.INPUTBOX:focus { border-color: #232c4f; outline: 3px solid rgba(35, 44, 79, .12); outline-offset: 0; }
    #ebs-better #frm input.act-btn { box-sizing: border-box; width: 100%; height: 48px; margin-top: 4px; border: 0; border-radius: 10px; background: #232c4f; color: #fff; font: 700 15px Ubuntu, system-ui, sans-serif; cursor: pointer; transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1), background-color 150ms ease, border-color 150ms ease, color 150ms ease; }
    #ebs-better #frm input.act-btn:active { transform: scale(0.98); }
    #ebs-better #frm input.act-btn.ebs-busy { background: #4a5272; cursor: wait; transform: none; }
    #ebs-better #frm input.act-btn:focus-visible { outline: 2px solid #5d9e35; outline-offset: 2px; }
    #ebs-better .ebs-forgot { align-self: center; display: block !important; font-size: 13px; color: #232c4f; transition: color 150ms ease; }

    /* Sessions: one list for any number of them. The board's search field is
       40 px high plus its border (content-box): 42 px in all. */
    #ebs-better button { font-family: inherit; color: inherit; cursor: pointer; }
    #ebs-better .ebs-avatar { border-radius: 50%; box-sizing: border-box; flex: none; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; object-fit: cover; background: #dfe4f1; color: #232c4f; }
    #ebs-better .ebs-avatar.expired { background: #fbe9e9; color: #b42318; }
    #ebs-better .ebs-avatar.login { background: #fff; border: 1.5px dashed #9aa3bf; color: #5d6584; }
    #ebs-better .ebs-search { display: flex; align-items: center; gap: 8px; height: 42px; padding: 0 12px; box-sizing: border-box; border: 1px solid #d6dbe8; border-radius: 10px; background: #fff; font-size: 13px; color: #5d6584; transition: border-color 150ms ease; }
    #ebs-better .ebs-search:focus-within { border-color: #232c4f; }
    #ebs-better .ebs-search svg { flex: none; }
    #ebs-better .ebs-search input { flex: 1; min-width: 0; height: 100%; padding: 1px 2px; border: 0; outline: none; background: transparent; font: 13px Ubuntu, system-ui, sans-serif; color: #232c4f; }
    #ebs-better .ebs-list { position: relative; display: flex; flex-direction: column; gap: 6px; max-height: 400px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: #9aa3bf #e3e6ee; }
    #ebs-better .ebs-list.scrolls { padding-right: 8px; }
    #ebs-better .ebs-list.all { max-height: none; overflow: visible; }
    #ebs-better .ebs-row { flex: none; display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid #e3e6ee; border-radius: 10px; background: #fff; text-align: left; font-family: Ubuntu, system-ui, sans-serif; color: #232c4f; transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1), background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease, color 150ms ease; }
    /* A thicker border without a shift: the extra width is an inset shadow. */
    #ebs-better .ebs-row.opening { border-color: #5d9e35; box-shadow: inset 0 0 0 1px #5d9e35; }
    #ebs-better .ebs-row.picked { border-color: #232c4f; box-shadow: inset 0 0 0 .5px #232c4f; }
    #ebs-better .ebs-row:active { transform: scale(0.98); }
    #ebs-better .ebs-row:disabled { cursor: wait; transform: none; }
    #ebs-better .ebs-row:focus-visible { outline: 2px solid #232c4f; outline-offset: 2px; }
    #ebs-better .ebs-row-name { flex: 1; min-width: 0; font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #ebs-better .ebs-row-number { font-size: 12px; color: #5d6584; }
    #ebs-better .ebs-row-action { display: flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 700; white-space: nowrap; }
    #ebs-better .ebs-row-action svg { flex: none; }
    #ebs-better .ebs-pill { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; white-space: nowrap; }
    #ebs-better .ebs-pill.expired { background: #fbe9e9; color: #b42318; }
    #ebs-better .ebs-pill.login { background: #f1f3f8; color: #4a5272; }
    #ebs-better .ebs-no-match { padding: 12px; font-size: 13px; color: #5d6584; }
    #ebs-better .ebs-fade { position: relative; height: 0; margin-top: -14px; pointer-events: none; }
    #ebs-better .ebs-fade span { position: absolute; left: 0; right: 14px; bottom: 0; height: 48px; border-radius: 0 0 10px 10px; background: linear-gradient(rgba(247, 248, 251, 0), #f7f8fb); opacity: 0; transition: opacity 150ms ease; }
    #ebs-better .ebs-fade.on span { opacity: 1; }
    #ebs-better .ebs-more { display: flex; justify-content: space-between; align-items: center; min-height: 16px; font-size: 12px; color: #5d6584; }
    #ebs-better .ebs-more-text.scroll { display: inline-flex; align-items: center; gap: 4px; font-weight: 700; color: #232c4f; }
    #ebs-better .ebs-link { border: 0; background: none; padding: 0; font: 12px Ubuntu, system-ui, sans-serif; color: #232c4f; text-decoration: underline; transition: color 150ms ease; }
    #ebs-better .ebs-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 40px 24px; border: 1.5px dashed #c5cbdc; border-radius: 12px; background: #fff; text-align: center; }
    #ebs-better .ebs-empty-icon { width: 64px; height: 64px; border-radius: 50%; background: #eef1f8; color: #6b7290; display: flex; align-items: center; justify-content: center; }
    #ebs-better .ebs-empty strong { font-size: 16px; font-weight: 700; }
    #ebs-better .ebs-empty > span:last-child { font-size: 13px; line-height: 19px; color: #5d6584; max-width: 300px; }
    @media (hover: hover) {
      #ebs-better .ebs-row:hover { border-color: #c9cfdf; background: #fafbfd; }
      #ebs-better .ebs-row.opening:hover { border-color: #5d9e35; }
      #ebs-better .ebs-row.picked:hover { border-color: #232c4f; }
      #ebs-better #frm input.act-btn:hover { background: #1b2240; }
      #ebs-better .ebs-link:hover, #ebs-better .ebs-forgot:hover, #ebs-better .ebs-footer a:hover { color: #1b2240; }
    }
    #ebs-better .ebs-confirm { padding: 10px 12px; border-radius: 8px; background: #fff8e6; color: #6b5310; font-size: 12px; }
    #ebs-better .ebs-confirm-buttons { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
    #ebs-better .ebs-confirm button { padding: 6px 12px; border-radius: 6px; font-size: 12px; transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease; }
    #ebs-better .ebs-confirm-no { border: 1px solid #e0d3a8; background: #fff; color: #6b5310; }
    #ebs-better .ebs-confirm-yes { border: 0; background: #232c4f; color: #fff !important; }
    #ebs-better .ebs-footer { padding: 20px 40px; display: flex; justify-content: center; gap: 4px; font-size: 12px; color: #6b7290; }
    #ebs-better .ebs-footer a { font-size: inherit; color: #4a5272; transition: color 150ms ease; }
    @media (max-width: 920px) {
      #ebs-better .ebs-left { border-radius: 16px 16px 0 0; }
      #ebs-better .ebs-right { border-left: 0; border-top: 1px solid #e3e6ee; border-radius: 0 0 16px 16px; }
    }
    @media (prefers-reduced-motion: reduce) {
      #ebs-better .ebs-for.ebs-changed { animation: ebs-for-fade 160ms ease-out; }
      #ebs-better .ebs-row:active, #ebs-better #frm input.act-btn:active { transform: none; }
    }
    @keyframes ebs-for-fade { from { opacity: 0; } to { opacity: 1; } }
  `;
})();
