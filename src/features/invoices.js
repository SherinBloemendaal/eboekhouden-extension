// EB Sessions: the invoice screens (Facturen) in Better design, and the
// billing core that the subscription screens (subscriptions.js) share as
// EBS.billing. Setting: betterDesign.
//
// e-Boekhouden's own Angular screens stay the source of truth. The new view
// is drawn from what the native grid and form show, and every write is a
// native control: our buttons click e-Boekhouden's checkboxes, bulk actions,
// links, pagination and Opslaan in answer to a click of the user, and the
// edit screens move e-Boekhouden's own form rows into a new layout. Nothing
// is filled in, saved or sent by the extension itself.
//
// Screens (secure*, Angular shell):
//   /facturen/factuur                   the invoice list (app-factuur-list)
//   /facturen/factuur/toevoegen/:id     add (0) or edit an invoice (app-factuur-form)
//   /facturen/factuur/:id               a copy of an invoice, as a new one
//
// Own request (read only, approved): ONE bulk GET of the open posts to
// receive per screen load (openpost/gridtable/openpost), through
// EBS.request. The invoice status (Open, Te laat, Betaald) is that list
// joined on the invoice number; Niet verwerkt is the Verwerkt column. Never
// a request per row.
//
// Native markup (from the shell's templates):
//   app-grid > app-grid-header .grid-header-title "Facturen (233 regels)"
//            > app-grid-body table.grid > thead th / tbody tr / tfoot
//              row: .grid-multi-check input, .eb-icon-edit, [title=Verwijderen],
//                   .eb-icon-docs (kopiëren), .eb-icon-print[title="Factuur printen"],
//                   .eb-icon-mail[title="Factuur e-mailen"], .eb-icon-inbox (verwerkt)
//            > app-grid-footer app-pagination (.pagination li, select.pagesizes-select),
//              app-grid-bulk-actions app-grid-bulk-action > li > span
//   form rows: .form-row > .form-component > app-form-label + widget; every
//   widget's input has the control name as id (#nummer, #emailen), an
//   autocomplete has #<name>-AutocompletePickerInput.
//   The line window: app-form-overlay app-factuurregel-form, with the
//   autocompletes #btw-… and #grootboekrekeningId-…

(() => {
  if (window.__ebsInvoicesLoaded) return;
  window.__ebsInvoicesLoaded = true;
  const { EBS } = window;
  if (!EBS || EBS.billing) return;
  if (!/^secure\d*\.e-boekhouden\.nl$/.test(location.hostname)) return;

  // ===========================================================================
  // The billing core (EBS.billing)
  // ===========================================================================

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? { matches: false };
  const OWN = 'data-ebs-own';
  const NATIVE = 'data-ebs-native';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // Our own roots carry data-ebs-own: the observer ignores what happens in
  // there, except inside a native node we moved in (data-ebs-native).
  function own(node) {
    node.setAttribute(OWN, '');
    return node;
  }

  function button(label, className, onClick, attributes = {}) {
    const node = el('button', className, label);
    node.type = 'button';
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  // TODO-merge: 'copy' is not in EBS.icon yet. This is its path data from
  // lucide-static 1.63.0 (icons/copy.svg, ISC); it goes once the shared
  // icon set has it (see the shared change in the billing report).
  const PENDING_ICONS = {
    copy: [['rect', { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' }], ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }]],
  };

  function icon(name, options = {}) {
    if (EBS.icon.has(name) || !PENDING_ICONS[name]) return EBS.icon(name, options);
    const svg = EBS.icon('check', options);
    svg.replaceChildren();
    svg.setAttribute('class', `ebs-icon lucide lucide-${name}`);
    for (const [tag, attributes] of PENDING_ICONS[name]) {
      const child = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [attribute, value] of Object.entries(attributes)) child.setAttribute(attribute, value);
      svg.append(child);
    }
    return svg;
  }

  function withIcon(node, name, options) {
    node.prepend(icon(name, options));
    return node;
  }

  function text(node) {
    return node ? node.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  // ---------------------------------------------------------------------------
  // Numbers and dates
  // ---------------------------------------------------------------------------

  function amount(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
    return EBS.parseAmount(String(value ?? '').replace(/€/g, ''));
  }

  function money(value) {
    return Number.isFinite(value) ? `€ ${EBS.formatMoney(value)}` : 'onbekend';
  }

  function plainMoney(value) {
    return Number.isFinite(value) ? EBS.formatMoney(value) : '';
  }

  // Midnight UTC of a calendar day, the unit every date here is kept in.
  function dayTime(year, month, day) {
    return Date.UTC(year, month - 1, day);
  }

  function today() {
    const now = new Date();
    return dayTime(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  // "29-10-2026", or the API's "2026-10-29T00:00:00" -> ms (UTC midnight) or null.
  function parseDay(value) {
    const raw = String(value ?? '').trim();
    const nl = EBS.parseDate(raw);
    if (nl) return nl.time;
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
    return iso ? dayTime(Number(iso[1]), Number(iso[2]), Number(iso[3])) : null;
  }

  function formatDay(time) {
    if (time === null || time === undefined) return '';
    const date = new Date(time);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getUTCDate())}-${pad(date.getUTCMonth() + 1)}-${date.getUTCFullYear()}`;
  }

  const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

  function longDay(time) {
    const date = new Date(time);
    return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  }

  const DAY_MS = 86_400_000;

  function daysBetween(from, to) {
    return Math.round((to - from) / DAY_MS);
  }

  // "over 13 dagen", "vandaag", "12 dagen te laat" for a due date.
  function relativeDue(time, now = today()) {
    const days = daysBetween(now, time);
    if (days === 0) return 'vandaag';
    if (days === 1) return 'morgen';
    if (days > 0) return `over ${days} dagen`;
    return `${-days} ${-days === 1 ? 'dag' : 'dagen'} te laat`;
  }

  function relativeDay(time, now = today()) {
    const days = daysBetween(now, time);
    if (days === 0) return 'vandaag';
    if (days === 1) return 'morgen';
    if (days > 0) return `over ${days} dagen`;
    return `${-days} ${-days === 1 ? 'dag' : 'dagen'} geleden`;
  }

  function plural(count, one, many) {
    return `${count} ${count === 1 ? one : many}`;
  }

  // ---------------------------------------------------------------------------
  // Settings, the classic switch per screen, and the per-administration store
  // ---------------------------------------------------------------------------

  const state = { settings: EBS.settingsWithDefaults(), classic: {}, loaded: false };
  const stateListeners = new Set();

  function notifyState() {
    for (const listener of [...stateListeners]) {
      try {
        listener();
      } catch (error) {
        console.error('EB Sessions: billing listener failed', error);
      }
    }
  }

  try {
    chrome.storage.local.get(['settings', 'classicScreens']).then(({ settings, classicScreens }) => {
      state.settings = EBS.settingsWithDefaults(settings);
      state.classic = classicScreens && typeof classicScreens === 'object' ? classicScreens : {};
      state.loaded = true;
      notifyState();
    }, () => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(changes.settings || changes.classicScreens)) return;
      if (changes.settings) state.settings = EBS.settingsWithDefaults(changes.settings.newValue);
      if (changes.classicScreens) state.classic = changes.classicScreens.newValue ?? {};
      notifyState();
    });
  } catch {
    // An orphaned script after an extension reload: it stays off.
  }

  function betterDesign() {
    return state.loaded && Boolean(state.settings.betterDesign);
  }

  function useBetter(screen) {
    return betterDesign() && !state.classic[screen];
  }

  function setClassic(screen, classic) {
    state.classic = { ...state.classic, [screen]: classic };
    try {
      chrome.storage.local.set({ classicScreens: state.classic });
    } catch { /* orphaned */ }
    notifyState();
  }

  function administration() {
    const number = document.querySelector('app-header-identity-b .administratieId, app-header-identity #administratieId')?.textContent.trim();
    return /^\d{1,12}$/.test(number ?? '') ? number : 'default';
  }

  function featureStore() {
    return EBS.store.feature('billing', { administration: administration() });
  }

  // ---------------------------------------------------------------------------
  // One observer and one route watch for every billing screen
  // ---------------------------------------------------------------------------

  const screens = [];
  let scheduled = false;
  let lastPath = location.pathname;
  // A redraw that keeps waking itself (a native node that is put back where
  // we took it from, again and again) is stopped for a moment.
  const storm = { count: 0, since: 0, pausedUntil: 0 };

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const time = Date.now();
      if (time < storm.pausedUntil) {
        setTimeout(schedule, storm.pausedUntil - time);
        return;
      }
      if (time - storm.since > 2000) {
        storm.since = time;
        storm.count = 0;
      }
      storm.count += 1;
      if (storm.count > 40) {
        storm.pausedUntil = time + 1000;
        console.warn('EB Sessions: billing redraw paused, the page keeps changing');
      }
      renderAll();
    });
  }

  function renderAll() {
    for (const screen of screens) {
      // A screen that broke stays e-Boekhouden's own until the route changes.
      if (screen.broken) continue;
      const active = screen.match(location.pathname);
      try {
        if (active) screen.render();
        else if (screen.mounted) screen.unmount();
      } catch (error) {
        console.error('EB Sessions: billing screen failed', screen.name, error);
        // Never leave the native screen hidden behind a view that broke.
        try {
          screen.unmount();
        } catch { /* nothing more to undo */ }
        screen.broken = true;
      }
    }
    updateRootClass();
  }

  function updateRootClass() {
    const active = screens.some((screen) => screen.mounted && !screen.broken);
    document.documentElement.classList.toggle('ebs-billing', active);
    if (active) injectStyle();
  }

  function register(screen) {
    screens.push(screen);
    schedule();
  }

  function isOwnMutation(record) {
    const node = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
    if (!node?.isConnected) return true;
    const mark = node.closest(`[${OWN}], [${NATIVE}]`);
    return Boolean(mark?.hasAttribute(OWN));
  }

  function startWatching() {
    stateListeners.add(schedule);
    new MutationObserver((records) => {
      if (records.some((record) => !isOwnMutation(record))) schedule();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'class', 'style'] });
    // Typing in a field changes no markup; a due date or a total may follow it.
    document.addEventListener('input', schedule, true);
    document.addEventListener('change', schedule, true);
    const watch = setInterval(() => {
      // The extension was reloaded: this copy of the script is orphaned.
      try {
        if (!chrome.runtime?.id) {
          clearInterval(watch);
          return;
        }
      } catch {
        clearInterval(watch);
        return;
      }
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      for (const screen of screens) screen.broken = false;
      schedule();
    }, 300);
  }

  // ---------------------------------------------------------------------------
  // The open posts: one bulk request per screen load
  // ---------------------------------------------------------------------------

  const OPEN_POSTS_KEY = 'billing:openposts';
  const OPEN_POSTS_LIMIT = 2000;

  function openPostsUrl() {
    return `${location.origin}/v1/api/openpost/gridtable/openpost?offset=0&limit=${OPEN_POSTS_LIMIT}&orderBy=&sortDirection=0&soort=Debiteur&zoeken=true`;
  }

  // The answer's field names, case-insensitive (the grid uses MutFactuur in
  // its columns and mutFactuur in its rows).
  function field(raw, ...names) {
    const keys = Object.keys(raw);
    for (const name of names) {
      const key = keys.find((one) => one.toLowerCase() === name.toLowerCase());
      if (key !== undefined && raw[key] !== null && raw[key] !== undefined && raw[key] !== '') return raw[key];
    }
    return undefined;
  }

  function normalizePost(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const number = String(field(raw, 'mutFactuur', 'factuur', 'factuurNummer') ?? '').trim();
    let outstanding = amount(field(raw, 'teOntvangen'));
    if (!Number.isFinite(outstanding)) {
      const total = amount(field(raw, 'sBedrag'));
      const paid = amount(field(raw, 'sBetaald'));
      outstanding = Number.isFinite(total) ? total - (Number.isFinite(paid) ? paid : 0) : amount(field(raw, 'bedrag'));
    }
    return {
      number,
      outstanding: Number.isFinite(outstanding) ? outstanding : 0,
      due: parseDay(field(raw, 'vervaldatum')),
      relation: String(field(raw, 'bedrijf', 'relatie') ?? '').trim(),
    };
  }

  // { ok, posts, byNumber, byRelation, complete, error }
  function indexPosts(answer) {
    const list = Array.isArray(answer) ? answer : answer?.data ?? answer?.rows;
    if (!Array.isArray(list)) return { ok: false, error: 'De open posten hadden een onbekende vorm.' };
    const posts = list.map(normalizePost).filter(Boolean);
    const byNumber = new Map();
    const byRelation = new Map();
    for (const post of posts) {
      if (post.number) byNumber.set(post.number, post);
      if (post.relation) {
        const entry = byRelation.get(post.relation) ?? { total: 0, count: 0 };
        entry.total += post.outstanding;
        entry.count += 1;
        byRelation.set(post.relation, entry);
      }
    }
    const rowCount = Number(answer?.rowCount);
    return { ok: true, posts, byNumber, byRelation, complete: !(rowCount > posts.length) };
  }

  // Per screen load (the path): one call. A failure stays a failure until
  // the user asks again with a click (EBS.request backs off by itself).
  const openPosts = {
    path: null,
    promise: null,
    result: null,
    load({ again = false } = {}) {
      if (!again && this.path === location.pathname && this.promise) return this.promise;
      this.path = location.pathname;
      this.result = null;
      this.promise = EBS.request.bulk(OPEN_POSTS_KEY, openPostsUrl())
        .then((answer) => indexPosts(answer), (error) => ({ ok: false, error: error?.code === 'rate' ? 'Even te veel verzoeken; probeer het zo opnieuw.' : 'De open posten konden niet worden geladen.' }))
        .then((result) => {
          if (this.path === location.pathname) {
            this.result = result;
            schedule();
          }
          return result;
        });
      return this.promise;
    },
    reset() {
      this.path = null;
      this.promise = null;
      this.result = null;
    },
  };

  // ---------------------------------------------------------------------------
  // Reading a native grid
  // ---------------------------------------------------------------------------

  function gridTable(grid) {
    return grid?.querySelector('app-grid-body table.grid') ?? null;
  }

  // Header labels (a header with only an icon gives its title).
  function headers(grid) {
    const head = gridTable(grid)?.tHead;
    const row = head ? [...head.rows].at(-1) : null;
    if (!row) return [];
    return [...row.cells].map((th) => text(th) || th.querySelector('[title]')?.getAttribute('title')?.trim() || '');
  }

  function columnOf(labels, ...wanted) {
    for (const name of wanted) {
      const at = labels.findIndex((label) => label.toLowerCase() === name.toLowerCase());
      if (at >= 0) return at;
    }
    for (const name of wanted) {
      const at = labels.findIndex((label) => label.toLowerCase().startsWith(name.toLowerCase()));
      if (at >= 0) return at;
    }
    return -1;
  }

  // Data rows of the first tbody: group and total rows have another shape.
  function dataRows(grid, labels) {
    const body = gridTable(grid)?.tBodies[0];
    if (!body) return [];
    return [...body.rows].filter((tr) => tr.cells.length === labels.length && !tr.classList.contains('totalRow'));
  }

  function cellText(tr, index) {
    if (index < 0) return '';
    const cell = tr.cells[index];
    return text(cell?.querySelector('.label') ?? cell);
  }

  // "Facturen (233 regels)" -> 233; null when the header has no count.
  function rowCount(grid) {
    const match = /\((\d[\d.]*)\s+regels?\)/.exec(text(grid?.querySelector('.grid-header-title')));
    return match ? Number(match[1].replace(/\./g, '')) : null;
  }

  function gridLoading(grid) {
    return Boolean(grid?.querySelector('.grid-header-title .animate-spin'));
  }

  // e-Boekhouden's own labels, matched whole.
  function bulkAction(grid, label) {
    return [...(grid?.querySelectorAll('app-grid-bulk-action li') ?? [])].find((li) => text(li) === label) ?? null;
  }

  function clickable(node) {
    return node?.closest('a, button, li') ?? node ?? null;
  }

  // The native pagination: page, size, and its own controls.
  function nativePager(grid) {
    const root = grid?.querySelector('app-pagination > div');
    if (!root) return null;
    const items = [...root.querySelectorAll('.pagination li')];
    const prev = items[0] ?? null;
    const next = items.at(-1) ?? null;
    const active = items.find((li) => li.classList.contains('active'));
    const select = root.querySelector('select.pagesizes-select');
    const size = Number(select?.value) || 100;
    return {
      page: Number(text(active)) || 1,
      size,
      sizes: select ? [...select.options].map((option) => Number(option.value)).filter(Boolean) : [100, 250, 500, 1000, 2000],
      prev, next, select,
      canPrev: Boolean(prev) && !prev.classList.contains('disabled'),
      canNext: Boolean(next) && !next.classList.contains('disabled'),
    };
  }

  function setNativeSelect(select, value) {
    if (!select || select.disabled) return false;
    select.value = String(value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // The success or error text e-Boekhouden shows in its notification bar.
  function notification() {
    const bar = document.querySelector('app-notification-bar .notification-bar');
    if (!bar) return null;
    const message = text(bar.querySelector('.notification-message') ?? bar.querySelector('.notification-container'));
    if (!message) return null;
    return { message, error: bar.classList.contains('error') || Boolean(bar.querySelector('.notification-message.error')) };
  }

  // ---------------------------------------------------------------------------
  // Shared view parts
  // ---------------------------------------------------------------------------

  // The way back on the classic screen, in e-Boekhouden's own link style.
  function backLink(screen) {
    const node = own(el('div', 'ebs-b-native-toggle'));
    const link = el('a', '', 'Nieuwe weergave');
    link.href = '#';
    link.setAttribute('role', 'button');
    link.addEventListener('click', (event) => {
      event.preventDefault();
      setClassic(screen, false);
    });
    node.append(link);
    return node;
  }

  function card(label) {
    const root = el('div', 'ebs-b-card');
    const labelNode = el('span', 'ebs-b-card-label', label);
    const value = el('span', 'ebs-b-card-value');
    const sub = el('span', 'ebs-b-card-sub');
    root.append(labelNode, value, sub);
    return {
      root,
      set({ value: valueText, sub: subText = '', tone = '', subTone = '' }) {
        root.classList.remove('loading');
        value.textContent = valueText;
        value.className = `ebs-b-card-value${tone ? ` ${tone}` : ''}`;
        sub.textContent = subText;
        sub.className = `ebs-b-card-sub${subTone ? ` ${subTone}` : ''}`;
      },
      // Calm grey blocks until the data is there, so no zero jumps to a number.
      loading() {
        root.classList.add('loading');
        value.textContent = '';
        sub.textContent = '';
      },
    };
  }

  function chip(label, onClick, tone = '') {
    const node = button(label, `ebs-b-chip${tone ? ` ${tone}` : ''}`, onClick, { 'aria-pressed': 'false' });
    node.setPressed = (pressed) => {
      node.setAttribute('aria-pressed', String(pressed));
      node.classList.toggle('on', pressed);
    };
    return node;
  }

  function selectField(label, onChange) {
    const wrap = el('label', 'ebs-b-select');
    wrap.append(el('span', '', label));
    const select = el('select');
    select.setAttribute('aria-label', label);
    select.addEventListener('change', () => onChange(select.value));
    wrap.append(select);
    wrap.select = select;
    wrap.setOptions = (options, value) => {
      const signature = JSON.stringify(options);
      if (select.dataset.options !== signature) {
        select.dataset.options = signature;
        select.replaceChildren(...options.map(([optionValue, optionLabel]) => {
          const option = el('option', '', optionLabel);
          option.value = optionValue;
          return option;
        }));
      }
      select.value = options.some(([optionValue]) => optionValue === value) ? value : options[0]?.[0] ?? '';
    };
    return wrap;
  }

  function searchField(placeholder, onInput) {
    const wrap = el('label', 'ebs-b-search');
    wrap.append(icon('search'));
    const input = el('input');
    input.type = 'search';
    input.placeholder = placeholder;
    input.setAttribute('aria-label', 'Zoeken');
    input.addEventListener('input', () => onInput(input.value));
    wrap.append(input);
    wrap.input = input;
    return wrap;
  }

  function checkBox(checked, label, onClick) {
    const node = button('', `ebs-b-check${checked ? ' on' : ''}`, onClick, { role: 'checkbox', 'aria-checked': String(checked), 'aria-label': label });
    // The mark is always there and fades in, so nothing jumps.
    node.append(icon('check', { size: 14 }));
    return node;
  }

  function iconButton(name, label, onClick, { title = label, quiet = false, disabled = false } = {}) {
    const node = button('', `ebs-b-icon-button${quiet ? ' quiet' : ''}`, onClick, { 'aria-label': label, title });
    node.append(icon(name));
    if (disabled) node.disabled = true;
    return node;
  }

  function skeletonRows(count, columns) {
    const box = el('div', 'ebs-b-skeleton');
    box.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < count; i += 1) {
      const line = el('div', 'ebs-b-skeleton-row');
      line.style.gridTemplateColumns = columns;
      for (const width of [18, 70, 90, 140, 60, 70, 70]) {
        const bar = el('span', 'ebs-b-bar');
        bar.style.width = `${width}px`;
        line.append(bar);
      }
      box.append(line);
    }
    return box;
  }

  // The message in the list: empty, no result or an error.
  function message({ title, body, action, actionIcon = '', onAction, alert = false }) {
    const box = el('div', `ebs-b-message${alert ? ' alert' : ''}`);
    box.setAttribute('role', alert ? 'alert' : 'status');
    box.append(el('span', 'ebs-b-message-title', title), el('span', 'ebs-b-message-text', body));
    if (action) {
      const node = button(action, 'ebs-b-primary small', onAction);
      if (actionIcon) withIcon(node, actionIcon);
      box.append(node);
    }
    return box;
  }

  // A button that waits shows it: "Bezig…", disabled and aria-busy, until
  // `done` says the answer is there (or the time is up).
  function busy(node, done, { label = 'Bezig…', timeout = 20_000 } = {}) {
    if (node.getAttribute('aria-busy') === 'true') return;
    const original = node.textContent;
    node.setAttribute('aria-busy', 'true');
    node.disabled = true;
    const iconNode = node.querySelector('svg');
    node.textContent = label;
    if (iconNode) node.prepend(iconNode);
    const started = Date.now();
    const stop = () => {
      clearInterval(timer);
      if (!node.isConnected) return;
      node.removeAttribute('aria-busy');
      node.disabled = false;
      node.textContent = original;
      if (iconNode) node.prepend(iconNode);
    };
    const timer = setInterval(() => {
      let finished = false;
      try {
        finished = !node.isConnected || Date.now() - started > timeout || done();
      } catch {
        finished = true;
      }
      if (finished) stop();
    }, 150);
  }

  // A short message at the bottom, e-Boekhouden's own text.
  const toast = {
    node: null,
    timer: null,
    last: '',
    show(textValue) {
      if (!this.node?.isConnected) {
        this.node = own(el('div', 'ebs-b-toast'));
        this.node.setAttribute('role', 'status');
        const mark = el('span', 'ebs-b-toast-mark');
        mark.append(icon('check', { size: 12 }));
        this.label = el('span');
        this.node.append(mark, this.label);
        document.body.append(this.node);
      }
      this.label.textContent = textValue;
      this.node.classList.remove('show');
      requestAnimationFrame(() => this.node?.classList.add('show'));
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.node?.classList.remove('show'), 6000);
    },
    // A success message of e-Boekhouden, once per text.
    follow() {
      const note = notification();
      if (!note || note.error) {
        if (!note) this.last = '';
        return;
      }
      if (note.message === this.last) return;
      this.last = note.message;
      this.show(note.message);
    },
  };

  // Meer filters: e-Boekhouden's own search form of a list in a dialog; its
  // Zoeken reloads the list and closes the dialog. Closed, the form waits
  // in `slot`, out of sight.
  function filterDialog(form, slot, subtitle) {
    if (!form) return null;
    const content = own(el('div', 'ebs-b-filter-dialog'));
    place(content, [form]);
    const dialog = EBS.dialog.open({
      title: 'Meer filters',
      subtitle,
      content,
      width: 640,
      onClose: () => {
        if (slot?.isConnected) place(slot, [form]);
        else restore(content);
        schedule();
      },
    });
    form.querySelector('button.form-submit')?.addEventListener('click', () => setTimeout(() => dialog.close(), 0), { once: true });
    return dialog;
  }

  // ---------------------------------------------------------------------------
  // The action bar for selected rows
  // ---------------------------------------------------------------------------

  function actionBar(ariaLabel) {
    const host = own(el('div', 'ebs-b-bar'));
    host.setAttribute('role', 'toolbar');
    host.setAttribute('aria-label', ariaLabel);
    const summary = el('span', 'ebs-b-bar-summary');
    const count = el('span', 'ebs-b-bar-count');
    const total = el('span', 'ebs-b-bar-total');
    summary.append(count, total);
    const buttons = el('span', 'ebs-b-bar-buttons');
    const failure = el('span', 'ebs-b-bar-message');
    failure.setAttribute('role', 'alert');
    host.append(summary, el('span', 'ebs-b-bar-divider'), buttons, failure);
    let actions = [];
    return {
      host,
      setActions(list) {
        actions = list;
        buttons.replaceChildren(...list.map((action) => {
          action.node = button(action.label, `ebs-b-bar-button ${action.kind ?? 'ghost'}`, (event) => {
            failure.textContent = '';
            action.run(event, action.node);
          });
          if (action.title) action.node.title = action.title;
          return action.node;
        }));
      },
      fail(textValue) {
        failure.textContent = textValue;
      },
      update({ selected, countText, totalText, disabled = {} }) {
        if (!host.isConnected) document.body.append(host);
        count.textContent = countText;
        total.textContent = totalText;
        for (const action of actions) {
          if (action.node.getAttribute('aria-busy') !== 'true') action.node.disabled = Boolean(disabled[action.id]);
        }
        host.classList.toggle('show', selected > 0);
        if (!selected) failure.textContent = '';
      },
      remove() {
        host.remove();
      },
    };
  }

  // Our checkbox clicks the native one: Angular registers it as a selection.
  function toggleNative(row) {
    row.check?.click();
  }

  function clearSelection(rows) {
    for (const row of rows) if (row.check?.checked) row.check.click();
  }

  // ---------------------------------------------------------------------------
  // The footer: the native pagination, drawn in the new style
  // ---------------------------------------------------------------------------

  function pagerView(noun) {
    const root = el('div', 'ebs-b-footer');
    const info = el('span', 'ebs-b-footer-info');
    const controls = el('span', 'ebs-b-pager');
    const sizeLabel = el('label', 'ebs-b-pager-size');
    const size = el('select');
    size.setAttribute('aria-label', 'Regels per pagina');
    sizeLabel.append(size, document.createTextNode(' per pagina'));
    const prev = iconButton('chevron-left', 'Vorige pagina', null);
    const pageText = el('span', 'ebs-b-pager-page');
    const next = iconButton('chevron-right', 'Volgende pagina', null);
    controls.append(el('span', '', 'De paginering van e-Boekhouden:'), sizeLabel, prev, pageText, next);
    root.append(info, controls);
    let pager = null;
    size.addEventListener('change', () => setNativeSelect(pager?.select, size.value));
    prev.addEventListener('click', () => pager?.canPrev && pager.prev.click());
    next.addEventListener('click', () => pager?.canNext && pager.next.click());
    return {
      root,
      update({ grid, shown, total, totalLabel }) {
        pager = nativePager(grid);
        const count = rowCount(grid) ?? shown;
        if (pager) {
          const first = (pager.page - 1) * pager.size + 1;
          const last = Math.min(pager.page * pager.size, count);
          info.textContent = `${first} tot ${last} van ${count.toLocaleString('nl-NL')}${totalLabel ? ` · ${totalLabel} ${money(total)}` : ''}`;
          const signature = pager.sizes.join(',');
          if (size.dataset.sizes !== signature) {
            size.dataset.sizes = signature;
            size.replaceChildren(...pager.sizes.map((value) => {
              const option = el('option', '', String(value));
              option.value = String(value);
              return option;
            }));
          }
          size.value = String(pager.size);
          prev.disabled = !pager.canPrev;
          next.disabled = !pager.canNext;
          pageText.textContent = `Pagina ${pager.page} van ${Math.max(1, Math.ceil(count / pager.size))}`;
          controls.hidden = false;
        } else {
          info.textContent = `${plural(count, noun[0], noun[1])}${totalLabel ? ` · ${totalLabel} ${money(total)}` : ''}`;
          controls.hidden = true;
        }
      },
    };
  }

  // Focus survives a redraw of the rows: the same control of the same row.
  function keepFocus(container, draw) {
    const active = document.activeElement;
    const rowKey = container.contains(active) ? active.closest('[data-key]')?.dataset.key : null;
    const role = rowKey ? active.dataset.role : null;
    draw();
    if (rowKey && role) {
      const target = [...container.querySelectorAll('[data-key]')].find((node) => node.dataset.key === rowKey)?.querySelector(`[data-role="${role}"]`);
      target?.focus({ preventScroll: true });
    }
  }

  // ===========================================================================
  // Edit screens: e-Boekhouden's own form rows in a new layout
  // ===========================================================================

  // A control of the main form, never one of a dialog on top of it.
  function control(scope, name) {
    if (!scope) return null;
    for (const id of [name, `${name}-AutocompletePickerInput`]) {
      for (const node of scope.querySelectorAll(`[id="${CSS.escape(id)}"]`)) {
        if (!node.closest('app-form-overlay')) return node;
      }
    }
    return null;
  }

  function formRow(scope, name) {
    return control(scope, name)?.closest('.form-row') ?? null;
  }

  // Puts native nodes into a slot in this order; only what is not there
  // already moves, so a second call changes nothing. A comment marks where
  // each one came from, so restore() puts it back in the same spot.
  const homes = new Map();

  function place(slot, nodes) {
    let at = 0;
    for (const node of nodes) {
      if (!node) continue;
      const current = slot.children[at];
      if (current !== node) {
        if (!homes.has(node) && node.parentNode) {
          const home = document.createComment('ebs-billing');
          node.before(home);
          homes.set(node, home);
        }
        node.setAttribute(NATIVE, '');
        slot.insertBefore(node, current ?? null);
      }
      at += 1;
    }
  }

  // Every native node moved out of `scope` (or all) goes home again. A node
  // that e-Boekhouden took away itself (an @if that closed) is forgotten,
  // with its mark, so it never comes back as a copy that nothing drives.
  function restore(scope = null) {
    for (const [node, home] of [...homes]) {
      const inScope = !scope || scope.contains(node);
      if (!inScope) {
        if (!node.isConnected) {
          homes.delete(node);
          home.remove();
        }
        continue;
      }
      homes.delete(node);
      node.removeAttribute(NATIVE);
      if (home.isConnected && node.isConnected) home.replaceWith(node);
      else {
        home.remove();
        node.remove();
      }
    }
  }

  // The native lines (app-factuurregel-list), read from its grid.
  function readLines(list) {
    const grid = list?.querySelector('app-grid');
    const labels = headers(grid);
    const col = {
      qty: columnOf(labels, 'Aantal'),
      text: columnOf(labels, 'Omschrijving'),
      price: columnOf(labels, 'P.p.e.', 'Prijs'),
      vat: columnOf(labels, 'Btw'),
      excl: columnOf(labels, 'Bedrag excl', 'Bedrag'),
      incl: columnOf(labels, 'Bedrag incl'),
    };
    return dataRows(grid, labels).map((tr, index) => {
      const qty = cellText(tr, col.qty);
      const description = cellText(tr, col.text);
      const price = cellText(tr, col.price);
      const excl = amount(cellText(tr, col.excl));
      const incl = amount(cellText(tr, col.incl));
      return {
        tr, index,
        key: `${index}|${description}`,
        qty, text: description, price,
        vat: cellText(tr, col.vat),
        amount: col.incl >= 0 && col.excl < 0 ? incl : excl,
        edit: clickable(tr.querySelector('.eb-icon-edit, [title="Wijzigen"]')),
        remove: clickable(tr.querySelector('[title="Verwijderen"]')),
      };
    });
  }

  // e-Boekhouden's own totals under the lines (app-btw-totals).
  function readTotals(list, lines) {
    const totals = list?.querySelector('app-btw-totals');
    const cells = (row) => [...(row?.cells ?? [])];
    if (totals) {
      const exclRow = totals.querySelector('tr.totaal-excl-btw-line');
      const inclRow = totals.querySelector('tr.totaal-incl-btw-line');
      const vat = [...totals.querySelectorAll('tr.btw-line')].map((row) => ({ label: text(cells(row)[0]), amount: amount(text(cells(row).at(-1))) }))
        .filter((entry) => entry.label && !/^totaal/i.test(entry.label));
      const incl = amount(text(cells(inclRow).at(-1)).replace(/^Totaal\s*/i, ''));
      const excl = exclRow ? amount(text(cells(exclRow).at(-1))) : incl;
      if (Number.isFinite(incl)) return { excl, vat, incl };
    }
    const excl = lines.reduce((sum, line) => sum + (Number.isFinite(line.amount) ? line.amount : 0), 0);
    return { excl, vat: [], incl: Number.NaN };
  }

  function lineSignature(line) {
    return [line.text, line.qty, line.price].map((part) => String(part ?? '').replace(/\s+/g, ' ').trim().toLowerCase()).join('|');
  }

  // What the user did in the line window this session, per line.
  const seenLines = new Map();

  // ---------------------------------------------------------------------------
  // The line window (app-factuurregel-form), restyled in place
  // ---------------------------------------------------------------------------

  // e-Boekhouden remembers the last btw and tegenrekening per user in its own
  // localStorage (createManager('factuurregel-form', userId)). Read only.
  function rememberedByUser() {
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (/^EBV2;c=factuurregel-form;i=\d+;k=(btw|tegenrekening)$/.test(key ?? '')) return true;
      }
    } catch { /* storage blocked */ }
    return false;
  }

  function normalize(value) {
    return String(value ?? '').toLowerCase().replace(/[^0-9a-z%]+/g, ' ').trim();
  }

  function pickerRows(host) {
    return [...host.querySelectorAll('[id*="PickerRow-"]')];
  }

  // A row of the picker as one text: its columns with a space between.
  function rowText(row) {
    const cells = row.cells ? [...row.cells] : [];
    return normalize(cells.length ? cells.map((cellNode) => cellNode.textContent).join(' ') : row.textContent);
  }

  // Types into e-Boekhouden's own search field and picks the matching row,
  // as a user would: only in answer to a click on Overnemen.
  async function chooseInAutocomplete(host, wanted) {
    const input = host?.querySelector('input.displayValue, input[id$="PickerInput"]');
    if (!input || input.disabled) return false;
    const goal = normalize(wanted);
    const find = () => {
      const rows = pickerRows(host);
      return rows.find((row) => rowText(row) === goal)
        ?? rows.find((row) => goal && rowText(row).includes(goal))
        ?? rows.find((row) => {
          const textValue = rowText(row);
          return textValue && goal.includes(textValue);
        });
    };
    const wait = async (ms) => {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        const row = find();
        if (row) return row;
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      return find();
    };
    input.focus();
    input.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    let row = await wait(600);
    if (!row) {
      // Not among the first results: search for its first word.
      input.value = wanted.split(/\s+/)[0] ?? wanted;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      row = await wait(1500);
    }
    if (!row) return false;
    row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    row.click();
    return true;
  }

  const lineWindow = {
    current: null,
    lastUsed: {},
    relationOf: () => '',

    // Per window: add or edit, and which field the user touched.
    attach(relationOf) {
      this.relationOf = relationOf;
      const form = document.querySelector('app-form-overlay app-factuurregel-form');
      if (!form) {
        this.current = null;
        return;
      }
      const overlay = form.closest('app-form-overlay');
      overlay.setAttribute('data-ebs-line-window', '');
      if (this.current?.form !== form) {
        const title = text(form.querySelector('.form-header'));
        this.current = { form, add: /toevoegen/i.test(title), vatTouched: false, ledgerTouched: false };
      }
      this.draw();
    },

    hosts() {
      const form = this.current?.form;
      return {
        vat: form?.querySelector('#btw-AutocompletePickerInput')?.closest('app-autocomplete') ?? null,
        ledger: form?.querySelector('#grootboekrekeningId-AutocompletePickerInput')?.closest('app-autocomplete') ?? null,
      };
    },

    values() {
      const { vat, ledger } = this.hosts();
      const value = (host) => host?.querySelector('input.displayValue, input[id$="PickerInput"]')?.value?.trim() ?? '';
      return { vat: value(vat), ledger: value(ledger) };
    },

    draw() {
      const current = this.current;
      const form = current.form;
      const header = form.querySelector('.form-header');
      if (header && !header.querySelector('.ebs-b-modal-sub')) {
        header.append(own(el('span', 'ebs-b-modal-sub', 'Het regelvenster van e-Boekhouden, anders opgemaakt')));
      }
      const { vat, ledger } = this.hosts();
      const ledgerRow = ledger?.closest('.form-row');
      let help = form.querySelector('.ebs-b-modal-help');
      if (ledgerRow && !help) {
        help = own(el('div', 'ebs-b-modal-help', 'Btw en tegenrekening zijn de zoekvelden van e-Boekhouden. Overnemen typt en kiest daarin voor je; opslaan doe je zelf.'));
        ledgerRow.after(help);
      }
      const values = this.values();
      const vatDefault = current.add && Boolean(vat) && !current.vatTouched;
      const ledgerDefault = current.add && Boolean(ledger) && !current.ledgerTouched;
      if (vat) vat.toggleAttribute('data-ebs-risk', vatDefault);
      if (ledger) ledger.toggleAttribute('data-ebs-risk', ledgerDefault);

      let box = form.querySelector('.ebs-b-modal-warning');
      if (!box) {
        box = own(el('div', 'ebs-b-modal-warning'));
        box.setAttribute('role', 'alert');
        const line = el('span', 'ebs-b-modal-warning-line');
        line.append(icon('triangle-alert'), el('span', 'ebs-b-modal-warning-text'));
        const source = el('span', 'ebs-b-modal-warning-source');
        const suggestion = el('span', 'ebs-b-modal-suggestion');
        const suggestionText = el('span', 'ebs-b-modal-suggestion-text');
        const take = button('Overnemen', 'ebs-b-take', (event) => this.take(event.currentTarget));
        suggestion.append(suggestionText, take);
        box.append(line, source, suggestion);
        const anchor = help ?? ledgerRow ?? form.querySelector('.form-body');
        if (anchor?.classList?.contains('form-body')) anchor.append(box);
        else anchor?.after(box);
      }
      const parts = [];
      if (vatDefault) parts.push(`${values.vat || 'De btw'} is voorgeselecteerd, niet in dit venster gekozen.`);
      if (ledgerDefault) parts.push(`Tegenrekening ${values.ledger || ''} is voorgeselecteerd, niet in dit venster gekozen.`.replace('  ', ' '));
      box.classList.toggle('show', parts.length > 0);
      if (parts.length) box.classList.add('seen');
      box.setAttribute('aria-hidden', String(parts.length === 0));
      box.querySelector('.ebs-b-modal-warning-text').textContent = parts.join(' ');
      box.querySelector('.ebs-b-modal-warning-source').textContent = rememberedByUser()
        ? 'e-Boekhouden zet je laatst gebruikte btw en tegenrekening voor.'
        : 'e-Boekhouden kiest de eerste uit de lijst.';
      const relation = this.relationOf();
      const hint = relation ? this.lastUsed[relation] : null;
      const differs = hint && (normalize(hint.vat) !== normalize(values.vat) || normalize(hint.ledger) !== normalize(values.ledger));
      const suggestion = box.querySelector('.ebs-b-modal-suggestion');
      const show = Boolean(differs) && parts.length > 0;
      suggestion.classList.toggle('show', show);
      if (show) suggestion.classList.add('seen');
      if (show) suggestion.querySelector('.ebs-b-modal-suggestion-text').textContent = `Laatst gekozen bij ${relation} (onthouden in jouw browser): ${[hint.vat, hint.ledger].filter(Boolean).join(', ')}.`;
    },

    async take(node) {
      const current = this.current;
      const relation = this.relationOf();
      const hint = this.lastUsed[relation];
      if (!current || !hint) return;
      let finished = false;
      busy(node, () => finished);
      try {
        const { vat, ledger } = this.hosts();
        if (hint.vat && vat) {
          current.vatTouched = await chooseInAutocomplete(vat, hint.vat) || current.vatTouched;
        }
        if (hint.ledger && ledger) {
          current.ledgerTouched = await chooseInAutocomplete(ledger, hint.ledger) || current.ledgerTouched;
        }
      } finally {
        finished = true;
        schedule();
      }
    },

    // A trusted action inside one of the two fields: the user chose there.
    onUserEvent(event) {
      const current = this.current;
      if (!event.isTrusted || !current?.form.isConnected) return;
      const { vat, ledger } = this.hosts();
      if (vat?.contains(event.target)) current.vatTouched = true;
      if (ledger?.contains(event.target)) current.ledgerTouched = true;
      const save = event.type === 'click' && event.target.closest?.('button.form-submit, .footer-next button');
      if (save && current.form.contains(save)) this.record();
    },

    // On the user's click on the window's own Opslaan: what was chosen, for
    // the warning on the line and as the suggestion for this relation.
    record() {
      const current = this.current;
      const form = current.form;
      const values = this.values();
      const field = (name) => form.querySelector(`[id="${name}"]`)?.value?.trim() ?? '';
      seenLines.set(lineSignature({ text: field('omschrijving'), qty: field('aantal'), price: field('prijsExcl') }), {
        ledger: values.ledger,
        flagged: current.add && (!current.vatTouched || !current.ledgerTouched),
      });
      const relation = this.relationOf();
      if (!relation || (!values.vat && !values.ledger)) return;
      this.lastUsed = { ...this.lastUsed, [relation]: { vat: values.vat, ledger: values.ledger, at: Date.now() } };
      // Kept per administration, at most the 200 most recent relations.
      const entries = Object.entries(this.lastUsed).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0)).slice(0, 200);
      this.lastUsed = Object.fromEntries(entries);
      featureStore().set('last-line', this.lastUsed).catch((error) => console.warn('EB Sessions: billing could not keep the last line', error));
    },

    async load() {
      try {
        const stored = await featureStore().get('last-line');
        if (stored && typeof stored === 'object') this.lastUsed = stored;
      } catch { /* nothing kept yet */ }
      schedule();
    },
  };

  for (const type of ['mousedown', 'keydown', 'input', 'click']) {
    document.addEventListener(type, (event) => lineWindow.onUserEvent(event), true);
  }

  // ---------------------------------------------------------------------------
  // The edit layout, shared by invoice and subscription
  // ---------------------------------------------------------------------------

  function section(label, className = '') {
    const node = el('section', `ebs-b-section${className ? ` ${className}` : ''}`);
    node.setAttribute('aria-label', label);
    return node;
  }

  function checkCard(row, { title, sub = '', iconName = '', indent = false, card: framed = false }) {
    const wrap = el('div', `ebs-b-check-row${framed ? ' framed' : ''}${indent ? ' indent' : ''}`);
    const slot = own(el('span', 'ebs-b-check-slot'));
    const label = el('label', 'ebs-b-check-label');
    const name = row?.querySelector('input[type="checkbox"]')?.id;
    if (name) label.htmlFor = name;
    if (iconName) label.append(icon(iconName));
    const words = el('span');
    words.append(sub ? el('b', '', title) : document.createTextNode(title));
    if (sub) {
      words.append(el('br'));
      words.append(el('span', 'ebs-b-muted', sub));
    }
    label.append(words);
    wrap.append(slot, label);
    wrap.checkSlot = slot;
    return wrap;
  }

  // config: { screen, title(), back, fields: { slotName: [names] }, checks,
  //           layout(view) -> builds the sections, aside(view, data) }
  //
  // The new layout lives inside e-Boekhouden's own app-form, in front of its
  // <form>, which goes under Meer velden. So every moved row is still inside
  // app-form: e-Boekhouden finds a field it rejects there
  // (document.querySelector('app-form .form-row .form-component #name')) and
  // puts the focus on it, and a form it hides (custom-hidden) hides the
  // layout too. The values live in e-Boekhouden's own form model, not in the
  // DOM, so the place of a row changes nothing about what Opslaan sends.
  function editScreen(config) {
    const view = {
      config,
      root: null,
      host: null,
      form: null,
      formNode: null,
      slots: {},
      mounted: false,
      broken: false,
      name: config.screen,
    };

    function hostOf() {
      return document.querySelector(config.host);
    }

    // The form we already took apart, or the one that holds the anchor
    // fields (once its rows are in our layout they are no longer inside it).
    function mainForm(host) {
      const marked = host.querySelector('app-form[data-ebs-billing-form]');
      if (marked) return marked;
      for (const name of config.anchor) {
        const form = control(host, name)?.closest('app-form');
        if (form) return form;
      }
      return null;
    }

    function build(host) {
      const root = own(el('div', 'ebs-b-edit'));
      const head = el('div', 'ebs-b-edit-head');
      const back = el('a', 'ebs-b-back');
      back.href = '#';
      back.append(icon('arrow-left'), document.createTextNode(config.back));
      back.addEventListener('click', (event) => {
        event.preventDefault();
        const native = host.querySelector('app-goback a, app-goback-b a, app-goback [role="button"]');
        if (native) native.click();
        else history.back();
      });
      view.title = el('h1', 'ebs-b-edit-title');
      const classic = button('Klassieke weergave', 'ebs-b-link', () => setClassic(config.screen, true));
      view.inEx = el('span', 'ebs-b-segment');
      view.inEx.setAttribute('role', 'radiogroup');
      view.inEx.setAttribute('aria-label', 'Bedragen');
      view.inExLabel = el('span', 'ebs-b-muted', 'Bedragen');
      for (const [value, label] of [['EX', 'excl. btw'], ['IN', 'incl. btw']]) {
        const option = button(label, 'ebs-b-segment-option', () => {
          const select = control(host, 'inEx');
          if (select && select.value !== value) setNativeSelect(select, value);
        }, { role: 'radio', 'aria-checked': 'false', 'data-value': value });
        view.inEx.append(option);
      }
      head.append(back, view.title, classic, ...(config.inExLabel ? [view.inExLabel] : []), view.inEx);

      const grid = el('div', 'ebs-b-edit-grid');
      const main = el('div', 'ebs-b-edit-main');
      const aside = el('aside', 'ebs-b-edit-aside');
      aside.setAttribute('aria-label', 'Samenvatting');
      grid.append(main, aside);
      root.append(head, grid);
      view.main = main;
      view.aside = aside;
      // Totals first in the aside; the screen's own cards follow.
      view.totals = el('section', 'ebs-b-aside-card ebs-b-totals');
      view.totalsTitle = el('span', 'ebs-b-section-title');
      view.totalsBody = el('div', 'ebs-b-totals-body');
      view.totals.append(view.totalsTitle, view.totalsBody);
      aside.append(view.totals);
      config.layout(view);

      // The lines: our rows over e-Boekhouden's line list.
      view.linesSection = section('Regels', 'flush');
      const linesHead = el('div', 'ebs-b-section-head');
      linesHead.append(el('span', 'ebs-b-section-title', 'Regels'), el('span', 'ebs-b-muted small', 'Klik op een regel: het regelvenster van e-Boekhouden opent, met btw en tegenrekening'));
      const linesHeader = el('div', 'ebs-b-line ebs-b-line-head');
      for (const [label, right] of [['Aantal', true], ['Omschrijving'], ['Prijs', true], ['Btw'], ['Bedrag', true], ['']]) {
        linesHeader.append(el('span', right ? 'right' : '', label));
      }
      view.linesBody = el('div', 'ebs-b-lines');
      const add = el('div', 'ebs-b-lines-add');
      view.addLine = withIcon(button('Regel toevoegen', 'ebs-b-dashed', () => {
        const native = view.list?.querySelector('.center-block a, .center-block button');
        native?.click();
      }), 'plus');
      add.append(view.addLine);
      // e-Boekhouden's list stays here, hidden but for its line window.
      view.listSlot = own(el('div', 'ebs-b-list-slot'));
      view.linesSection.append(linesHead, linesHeader, view.linesBody, add, view.listSlot);
      main.insertBefore(view.linesSection, main.children[config.linesAt] ?? null);

      // Everything else of the native form: "Meer velden". Closed, its fields
      // stay rendered (height 0), so a field in there that gets the focus,
      // by Tab or because e-Boekhouden points at a field it rejected, opens
      // it. A closed <details> would leave such a field unfocusable.
      view.more = el('div', 'ebs-b-more');
      const moreId = `ebs-b-more-${config.screen}`;
      view.moreToggle = button('', 'ebs-b-more-toggle', () => setMore(!view.more.classList.contains('open')), { 'aria-expanded': 'false', 'aria-controls': moreId });
      view.moreToggle.append(icon('chevron-right', { size: 14 }), el('span', '', config.moreLabel));
      view.moreSlot = own(el('div', 'ebs-b-more-slot'));
      view.moreSlot.id = moreId;
      view.moreSlot.setAttribute('role', 'region');
      view.moreSlot.setAttribute('aria-label', 'Meer velden');
      view.moreSlot.addEventListener('focusin', () => setMore(true));
      view.more.append(view.moreToggle, view.moreSlot);
      (view.slots.more ?? main).append(view.more);
      // Native rows that have a control of ours (Bedragen) stay out of sight.
      view.slots.hidden = own(el('div', 'ebs-b-hidden-slot'));
      root.append(view.slots.hidden);

      // The warnings and the save button close the aside.
      view.warning = el('div', 'ebs-b-warning-summary');
      view.warning.setAttribute('role', 'status');
      view.save = button('Opslaan', 'ebs-b-save', (event) => save(event.currentTarget));
      aside.append(view.warning, view.save);
      return root;
    }

    function setMore(open) {
      view.more.classList.toggle('open', open);
      view.moreToggle.setAttribute('aria-expanded', String(open));
    }

    // The <form> of app-form itself (its template's root), never the one of
    // the line window, which sits in the same app-form now.
    function nativeForm(form) {
      if (view.formNode?.isConnected && form.contains(view.formNode)) return view.formNode;
      return form.querySelector(':scope > form');
    }

    function save(node) {
      const submit = view.formNode?.querySelector(':scope > .form-footer button.form-submit') ?? null;
      if (!submit || submit.disabled) {
        view.warning.textContent = 'De knop Opslaan van e-Boekhouden is er nu niet. Gebruik de klassieke weergave.';
        view.warning.classList.add('show');
        return;
      }
      const path = location.pathname;
      const before = notification()?.message ?? '';
      submit.click();
      // Done when e-Boekhouden answered: another screen, a message, or its
      // own button free again after it was blocked.
      let sawBlocked = false;
      busy(node, () => {
        if (location.pathname !== path) return true;
        const note = notification();
        if (note && note.message !== before) return true;
        if (submit.disabled) sawBlocked = true;
        return sawBlocked && !submit.disabled;
      }, { label: 'Opslaan…' });
    }

    function drawInEx(host) {
      const select = control(host, 'inEx');
      const usable = Boolean(select) && !select.disabled && select.options.length > 1;
      view.inEx.hidden = !usable;
      view.inExLabel.hidden = !usable;
      for (const option of view.inEx.children) {
        const on = usable && select.value === option.dataset.value;
        option.setAttribute('aria-checked', String(on));
        option.classList.toggle('on', on);
      }
    }

    function drawLines(lines) {
      const signature = JSON.stringify(lines.map((line) => [line.key, line.qty, line.price, line.vat, line.amount, seenLines.get(lineSignature(line))]));
      if (view.linesBody.dataset.signature === signature) return;
      view.linesBody.dataset.signature = signature;
      keepFocus(view.linesBody, () => {
        view.linesBody.replaceChildren(...lines.map((line) => {
          const seen = seenLines.get(lineSignature(line));
          const row = el('div', 'ebs-b-line');
          row.dataset.key = line.key;
          row.addEventListener('click', (event) => {
            if (event.target.closest('button')) return;
            line.edit?.click();
          });
          row.append(el('span', 'right num', line.qty));
          const what = el('span', 'ebs-b-line-text');
          what.append(el('span', 'ebs-b-line-name', line.text));
          what.append(el('span', `ebs-b-line-note${seen ? ' seen' : ''}`, seen?.ledger ? `Tegenrekening ${seen.ledger} (gezien in het regelvenster)` : 'Tegenrekening: zie het regelvenster'));
          row.append(what, el('span', 'right num', line.price));
          const vat = el('span', 'ebs-b-line-vat', line.vat);
          if (seen?.flagged) {
            const mark = el('span', 'ebs-b-line-flag');
            mark.title = 'Niet zelf gekozen';
            mark.append(icon('triangle-alert', { label: 'Niet zelf gekozen' }));
            vat.append(mark);
          }
          row.append(vat, el('span', 'right num strong', plainMoney(line.amount)));
          const actions = el('span', 'ebs-b-row-actions');
          const editButton = iconButton('pencil', 'Regel wijzigen', () => line.edit?.click(), { disabled: !line.edit });
          editButton.dataset.role = 'edit';
          const removeButton = iconButton('trash', 'Regel verwijderen', () => line.remove?.click(), { quiet: true, disabled: !line.remove });
          removeButton.dataset.role = 'remove';
          actions.append(editButton, removeButton);
          row.append(actions);
          return row;
        }));
        if (!lines.length) view.linesBody.append(el('div', 'ebs-b-lines-empty', 'Nog geen regels.'));
      });
    }

    function drawTotals(lines) {
      const totals = readTotals(view.list, lines);
      const rows = [['Excl. btw', totals.excl], ...totals.vat.map((entry) => [entry.label, entry.amount])];
      const signature = JSON.stringify([config.totalsTitle(view), rows, totals.incl]);
      if (view.totalsBody.dataset.signature === signature) return totals;
      view.totalsBody.dataset.signature = signature;
      view.totalsTitle.textContent = config.totalsTitle(view);
      view.totalsBody.replaceChildren(...rows.map(([label, value]) => {
        const line = el('span', 'ebs-b-total-line');
        line.append(el('span', '', label), el('span', 'num', money(value)));
        return line;
      }));
      const incl = el('span', 'ebs-b-total-line grand');
      incl.append(el('span', '', 'Incl. btw'), el('span', 'num', Number.isFinite(totals.incl) ? money(totals.incl) : 'zie de regels'));
      view.totalsBody.append(incl);
      return totals;
    }

    function drawWarnings(lines) {
      const open = lines.filter((line) => seenLines.get(lineSignature(line))?.flagged).length;
      const textValue = open ? `${open} ${open === 1 ? 'regel heeft' : 'regels hebben'} een btw of tegenrekening die voorgeselecteerd was en niet in het regelvenster is gekozen. Een melding, geen blokkade.` : '';
      if (view.warning.dataset.kind !== 'native') view.warning.textContent = textValue;
      view.warning.classList.toggle('show', Boolean(textValue));
    }

    view.match = (path) => config.match.test(path);

    view.render = () => {
      if (!state.loaded) return;
      const host = hostOf();
      const form = host ? mainForm(host) : null;
      if (!useBetter(config.screen) || !host || !form) {
        view.unmount({ keepBack: Boolean(host && form && betterDesign()) });
        if (host && form && betterDesign()) {
          if (!view.back?.isConnected) {
            view.back = backLink(config.screen);
            host.prepend(view.back);
          }
        }
        return;
      }
      view.back?.remove();
      // Another form (e-Boekhouden drew it again): the old layout goes, with
      // every row it still holds back home, before a new one is built.
      if (view.root && (!view.root.isConnected || view.form !== form || view.root.parentNode !== form)) view.unmount();
      if (!view.root) {
        view.host = host;
        view.form = form;
        view.formNode = nativeForm(form);
        if (!view.formNode) return;
        view.root = build(host);
        form.prepend(view.root);
        lineWindow.load();
      }
      view.mounted = true;
      host.setAttribute('data-ebs-billing-edit', '');

      // Native rows into their slots; the rest of the form under Meer velden.
      for (const [slotName, names] of Object.entries(config.fields)) {
        const slot = view.slots[slotName];
        if (slot) place(slot, names.map((name) => formRow(host, name)));
      }
      for (const check of view.checks ?? []) {
        const row = formRow(host, check.name);
        if (row) place(check.node.checkSlot, [row]);
        check.node.hidden = !row;
        // The label points at e-Boekhouden's own checkbox.
        const input = control(host, check.name);
        const label = check.node.querySelector('.ebs-b-check-label');
        if (input && label.htmlFor !== input.id) label.htmlFor = input.id;
      }
      view.list = host.querySelector('app-factuurregel-list');
      if (view.list) place(view.listSlot, [view.list]);
      view.formNode = nativeForm(form) ?? view.formNode;
      place(view.moreSlot, [view.formNode]);
      form.setAttribute('data-ebs-billing-form', '');

      view.title.textContent = config.title(host, form);
      drawInEx(host);
      const lines = readLines(view.list);
      drawLines(lines);
      const totals = drawTotals(lines);
      drawWarnings(lines);
      config.drawAside?.(view, { host, form, lines, totals });
      lineWindow.attach(() => control(host, 'relatieId')?.value?.trim() ?? '');
      toast.follow();
    };

    view.unmount = ({ keepBack = false } = {}) => {
      if (view.root) {
        // Native nodes go back where they came from: the <form> first, then
        // the rows and the line list into it.
        restore(view.moreSlot);
        restore(view.root);
        view.form?.removeAttribute('data-ebs-billing-form');
        view.host?.removeAttribute('data-ebs-billing-edit');
        view.root.remove();
        // The line window looks like e-Boekhouden's own again.
        for (const node of document.querySelectorAll('[data-ebs-line-window]')) node.removeAttribute('data-ebs-line-window');
        for (const node of document.querySelectorAll('.ebs-b-modal-sub, .ebs-b-modal-help, .ebs-b-modal-warning, .ebs-b-due-note')) node.remove();
        for (const node of document.querySelectorAll('[data-ebs-risk]')) node.removeAttribute('data-ebs-risk');
        lineWindow.current = null;
      }
      view.root = null;
      view.form = null;
      view.formNode = null;
      view.mounted = false;
      if (!keepBack) {
        view.back?.remove();
        view.back = null;
      }
    };

    return view;
  }

  // ---------------------------------------------------------------------------
  // Styles. Hover colours fade over 150 ms; things that appear fade and slide
  // over 150 to 200 ms (opacity and transform only); reduced motion fades.
  // ---------------------------------------------------------------------------

  function injectStyle() {
    if (document.getElementById('ebs-billing-style')) return;
    const style = document.createElement('style');
    style.id = 'ebs-billing-style';
    style.textContent = BILLING_CSS;
    document.documentElement.append(style);
  }

  const BILLING_CSS = `
    /* The native screen under the new view: its machinery stays, out of sight. */
    html.ebs-billing [data-ebs-billing-list] app-grid :is(app-grid-header, app-grid-body, app-grid-footer) { display: none !important; }
    html.ebs-billing [data-ebs-billing-list] app-grid { display: block; height: 0 !important; overflow: hidden !important; margin: 0 !important; }
    html.ebs-billing [data-ebs-billing-list] .middle-bottom-container:has(app-target-link) { display: none !important; }
    /* A success message of e-Boekhouden shows as our toast; errors stay where they are. */
    html.ebs-billing app-notification-bar .notification-bar:not(.error) { display: none !important; }
    /* The native Terug: straight under the host (abonnement) or in its wrapper (factuur). */
    html.ebs-billing [data-ebs-billing-edit] > .middle-top-container:has(app-goback, app-goback-b),
    html.ebs-billing [data-ebs-billing-edit] > div > .middle-top-container:has(app-goback, app-goback-b) { display: none !important; }
    .ebs-b-hidden-slot { display: none !important; }
    .ebs-b-filter-dialog app-form, .ebs-b-filter-dialog form { width: auto !important; }
    .ebs-b-dialog-text { margin: 0; font-size: 14px; line-height: 20px; color: #232c4f; }

    .ebs-b-view, .ebs-b-edit, .ebs-b-bar, .ebs-b-toast { font-family: Ubuntu, system-ui, sans-serif; color: #232c4f; }
    .ebs-b-view button, .ebs-b-edit button, .ebs-b-bar button, .ebs-b-view select, .ebs-b-view input, .ebs-b-edit select { font-family: inherit; }
    .ebs-b-view { box-sizing: border-box; margin: 24px 32px 16px; display: flex; flex-direction: column; gap: 14px; }
    .ebs-b-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
    .ebs-b-titles { display: flex; flex-direction: column; gap: 4px; }
    .ebs-b-titles h1, .ebs-b-edit-title { margin: 0; font-size: 22px; font-weight: 700; line-height: 28px; }
    .ebs-b-subtitle, .ebs-b-muted { font-size: 13px; color: #5d6584; }
    .ebs-b-muted.small { font-size: 12px; }
    .ebs-b-head-actions { display: flex; align-items: center; gap: 8px; }
    .ebs-b-link, .ebs-b-primary, .ebs-b-secondary, .ebs-b-card-retry, .ebs-b-chip, .ebs-b-more-filters, .ebs-b-icon-button { transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease; }
    .ebs-b-link { margin-right: 8px; padding: 0; border: 0; background: none; font-size: 13px; color: #232c4f; text-decoration: underline; cursor: pointer; }
    .ebs-b-link:hover { color: #1b2240; }
    .ebs-b-native-toggle { width: 93%; margin: 0 0 6px; text-align: right; font-size: 13px; }
    .ebs-b-native-toggle a { color: var(--colorPrimary, #30395f); text-decoration: underline; cursor: pointer; }
    .ebs-b-primary { display: flex; align-items: center; gap: 6px; height: 40px; padding: 0 16px; border: 0; border-radius: 9px; background: #232c4f; color: #fff; font-size: 14px; font-weight: 700; cursor: pointer; }
    .ebs-b-primary:hover { background: #1b2240; }
    .ebs-b-primary.small { height: 36px; padding: 0 14px; font-size: 13px; }
    .ebs-b-secondary { height: 40px; padding: 0 16px; border: 1px solid #cfd4e2; border-radius: 9px; background: #fff; color: #232c4f; font-size: 14px; font-weight: 500; cursor: pointer; }
    .ebs-b-secondary:hover { background: #f3f5fa; }
    .ebs-b-primary:disabled, .ebs-b-secondary:disabled { opacity: .5; cursor: default; }

    .ebs-b-cards { display: grid; grid-template-columns: repeat(var(--ebs-cards, 4), minmax(0, 1fr)); gap: 12px; }
    .ebs-b-card { display: flex; flex-direction: column; gap: 4px; min-height: 52px; padding: 14px 16px; border-radius: 12px; background: #fff; }
    .ebs-b-card-label, .ebs-b-card-sub { font-size: 12px; color: #5d6584; min-height: 16px; }
    .ebs-b-card-value { min-height: 26px; font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .ebs-b-card-value.late, .ebs-b-card-sub.late { color: #b42318; }
    .ebs-b-card.loading .ebs-b-card-value, .ebs-b-card.loading .ebs-b-card-sub { border-radius: 6px; background: #e6e9f1; animation: ebs-b-shimmer 1200ms ease-in-out infinite; }
    .ebs-b-card.loading .ebs-b-card-value { width: 60%; }
    .ebs-b-card.loading .ebs-b-card-sub { width: 80%; }
    /* Its room is kept, so a failure makes nothing move. */
    .ebs-b-card-retry:not(.show) { visibility: hidden; opacity: 0; }
    .ebs-b-card-retry { align-self: flex-start; margin-top: 2px; padding: 0; border: 0; background: none; font-size: 12px; color: #3a4677; text-decoration: underline; cursor: pointer; transition: color 150ms ease, opacity 150ms ease; }
    .ebs-b-card-retry:hover { color: #232c4f; }

    .ebs-b-panel { background: #fff; border-radius: 12px; overflow: hidden; }
    .ebs-b-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #e6e9f1; }
    .ebs-b-search { flex: 1 1 280px; display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; border: 1px solid #d6dbe8; border-radius: 9px; color: #5d6584; font-size: 13px; transition: border-color 150ms ease; }
    .ebs-b-search:focus-within { border-color: #596aaf; }
    .ebs-b-search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font-size: 13px; color: #232c4f; }
    .ebs-b-chip { height: 36px; padding: 0 14px; border: 1px solid #d6dbe8; border-radius: 18px; background: #fff; color: #232c4f; font-size: 13px; cursor: pointer; }
    .ebs-b-chip.late { border-color: #f1c7c2; color: #b42318; }
    .ebs-b-chip:hover { background: #f3f5fa; }
    .ebs-b-chip.on, .ebs-b-chip.on:hover { border-color: #232c4f; background: #232c4f; color: #fff; font-weight: 500; }
    .ebs-b-chip:disabled { opacity: .5; cursor: default; }
    .ebs-b-select { display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 12px; border: 1px solid #d6dbe8; border-radius: 18px; font-size: 13px; }
    .ebs-b-select > span { color: #5d6584; }
    .ebs-b-select select { border: 0; background: transparent; font-size: 13px; color: #232c4f; }
    .ebs-b-more-filters { height: 36px; padding: 0 12px; border: 0; background: transparent; color: #3a4677; font-size: 13px; text-decoration: underline; cursor: pointer; }
    .ebs-b-more-filters:hover { color: #232c4f; }

    .ebs-b-row { display: grid; grid-template-columns: var(--ebs-columns); align-items: center; height: var(--ebs-row-height, 46px); padding: 0 14px; border-bottom: 1px solid #eef0f5; background: #fff; }
    .ebs-b-row.head { height: 38px; font-size: 12px; color: #5d6584; background: #f7f8fb; border-bottom-color: #e6e9f1; }
    .ebs-b-row.on { background: #e8eefb; }
    .ebs-b-row.total { height: 44px; border-bottom: 0; font-size: 14px; font-weight: 700; }
    .ebs-b-row > span { min-width: 0; }
    .ebs-b-row .right, .ebs-b-line .right { text-align: right; }
    .num { font-variant-numeric: tabular-nums; }
    .strong { font-weight: 700; }
    .ebs-b-cell-date, .ebs-b-cell-number { font-size: 13px; }
    .ebs-b-cell-number { font-weight: 500; }
    .ebs-b-cell-relation { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ebs-b-cell-name { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ebs-b-cell-excl { font-size: 13px; color: #4a5272; }
    .ebs-b-cell-incl { font-size: 14px; font-weight: 700; }
    .ebs-b-cell-due { padding-left: 16px; font-size: 12px; color: #5d6584; }
    .ebs-b-cell-due.late { color: #b42318; font-weight: 500; }
    .ebs-b-stack { display: flex; flex-direction: column; gap: 2px; }
    .ebs-b-sub { display: flex; align-items: center; gap: 4px; min-height: 14px; font-size: 11px; color: #5d6584; }
    .ebs-b-sub.late { color: #b42318; }
    .ebs-b-status { display: inline-block; padding: 3px 9px; border-radius: 10px; font-size: 12px; font-weight: 500; }
    .ebs-b-status.open { background: #eef1f8; color: #3a4677; }
    .ebs-b-status.late { background: #fbe9e9; color: #b42318; }
    .ebs-b-status.paid { background: #eef6e7; color: #2f6f1a; }
    .ebs-b-status.draft { background: #f1f3f8; color: #4a5272; }
    .ebs-b-status.unknown { padding: 0; color: #8c93ab; font-weight: 400; }
    .ebs-b-status.loading { width: 60px; height: 18px; background: #e6e9f1; animation: ebs-b-shimmer 1200ms ease-in-out infinite; }
    .ebs-b-check { position: relative; width: 18px; height: 18px; padding: 0; border: 1.5px solid #8c93ab; border-radius: 4px; background: #fff; color: #fff; cursor: pointer; transition: background-color 150ms ease, border-color 150ms ease; }
    .ebs-b-check svg { position: absolute; inset: 0; margin: auto; opacity: 0; transition: opacity 150ms ease; }
    .ebs-b-check.on { border-color: #232c4f; background: #232c4f; }
    .ebs-b-check.on svg { opacity: 1; }
    .ebs-b-row-actions { display: flex; justify-content: flex-end; gap: 4px; }
    .ebs-b-icon-button { display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 7px; background: #f3f5fa; color: #232c4f; cursor: pointer; }
    .ebs-b-icon-button:hover { background: #e3e7f0; }
    .ebs-b-icon-button.quiet { background: transparent; color: #8c93ab; }
    .ebs-b-icon-button.quiet:hover { background: #f3f5fa; color: #232c4f; }
    .ebs-b-icon-button:disabled { opacity: .35; cursor: default; }
    .ebs-b-check:focus-visible, .ebs-b-icon-button:focus-visible, .ebs-b-chip:focus-visible, .ebs-b-primary:focus-visible, .ebs-b-secondary:focus-visible, .ebs-b-link:focus-visible, .ebs-b-segment-option:focus-visible, .ebs-b-save:focus-visible, .ebs-b-dashed:focus-visible, .ebs-b-take:focus-visible { outline: 2px solid #232c4f; outline-offset: 2px; }
    .ebs-b-body { min-height: 92px; }
    .ebs-b-row.enter { animation: ebs-b-enter 150ms cubic-bezier(0.23, 1, 0.32, 1) both; }

    .ebs-b-message { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; min-height: 180px; padding: 20px; text-align: center; animation: ebs-b-enter 150ms cubic-bezier(0.23, 1, 0.32, 1) both; }
    .ebs-b-message.alert { background: #fdf0ef; }
    .ebs-b-message-title { font-size: 15px; font-weight: 700; }
    .ebs-b-message-text { max-width: 420px; font-size: 13px; color: #5d6584; }
    .ebs-b-skeleton { display: flex; flex-direction: column; }
    .ebs-b-skeleton-row { display: grid; align-items: center; height: 46px; padding: 0 14px; border-bottom: 1px solid #eef0f5; }
    .ebs-b-bar { height: 12px; border-radius: 6px; background: #e6e9f1; animation: ebs-b-shimmer 1200ms ease-in-out infinite; }

    .ebs-b-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; min-height: 32px; padding: 12px 14px; font-size: 13px; color: #5d6584; }
    .ebs-b-pager { display: flex; align-items: center; gap: 6px; }
    .ebs-b-pager[hidden] { display: none; }
    .ebs-b-pager-size { display: flex; align-items: center; gap: 6px; }
    .ebs-b-pager select { height: 32px; border: 1px solid #d6dbe8; border-radius: 8px; font-size: 13px; color: #232c4f; }
    .ebs-b-pager .ebs-b-icon-button { border: 1px solid #d6dbe8; background: #fff; }
    .ebs-b-pager .ebs-b-icon-button:hover { background: #f3f5fa; }
    .ebs-b-pager .ebs-b-icon-button:disabled { opacity: .5; }
    .ebs-b-spacer { height: 96px; }

    .ebs-b-bar { position: fixed; left: 50%; bottom: 24px; z-index: 2147483000; display: flex; align-items: center; gap: 12px; padding: 10px 10px 10px 20px; border-radius: 14px; background: #232c4f; color: #fff; box-shadow: 0 18px 44px rgba(20, 26, 48, .35); visibility: hidden; opacity: 0; transform: translate(-50%, 16px); transition: opacity 150ms ease-in, transform 150ms ease-in, visibility 0s linear 150ms; }
    .ebs-b-bar.show { visibility: visible; opacity: 1; transform: translate(-50%, 0); transition: opacity 200ms cubic-bezier(0.23, 1, 0.32, 1), transform 200ms cubic-bezier(0.23, 1, 0.32, 1), visibility 0s; }
    .ebs-b-bar-summary { display: flex; flex-direction: column; gap: 2px; min-width: 160px; }
    .ebs-b-bar-count { font-size: 14px; font-weight: 700; }
    .ebs-b-bar-total { font-size: 12px; color: #c4cae0; font-variant-numeric: tabular-nums; }
    .ebs-b-bar-divider { width: 1px; height: 32px; background: rgba(255, 255, 255, .2); }
    .ebs-b-bar-buttons { display: flex; align-items: center; gap: 8px; }
    .ebs-b-bar-button { height: 40px; padding: 0 14px; border-radius: 9px; font-size: 14px; white-space: nowrap; cursor: pointer; transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1), background-color 150ms ease, color 150ms ease, border-color 150ms ease; }
    .ebs-b-bar-button.primary { border: 0; background: #5d9e35; color: #fff; font-weight: 700; }
    .ebs-b-bar-button.primary:hover { background: #4f8a2c; }
    .ebs-b-bar-button.ghost { border: 1px solid rgba(255, 255, 255, .35); background: transparent; color: #fff; }
    .ebs-b-bar-button.ghost:hover { background: rgba(255, 255, 255, .1); }
    .ebs-b-bar-button.quiet { padding: 0 10px; border: 0; background: transparent; color: #c4cae0; }
    .ebs-b-bar-button.quiet:hover { color: #fff; }
    .ebs-b-bar-button:active { transform: scale(0.97); }
    .ebs-b-bar-button:disabled { opacity: .5; cursor: default; }
    .ebs-b-bar-button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .ebs-b-bar-message { max-width: 260px; font-size: 12px; line-height: 16px; color: #ffd8d3; }
    .ebs-b-bar-message { transition: opacity 150ms ease; }
    .ebs-b-bar-message:empty { margin-left: -12px; opacity: 0; }

    .ebs-b-toast { position: fixed; left: 50%; bottom: 26px; z-index: 2147483001; display: flex; align-items: center; gap: 8px; width: 340px; margin-left: -170px; padding: 10px 14px; border-radius: 10px; background: #232c4f; color: #fff; font-size: 13px; pointer-events: none; opacity: 0; transform: translateY(12px); transition: opacity 150ms ease-in, transform 150ms ease-in; }
    .ebs-b-toast.show { opacity: 1; transform: none; transition: opacity 200ms cubic-bezier(0.23, 1, 0.32, 1), transform 200ms cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-b-toast-mark { display: flex; flex: none; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: #5d9e35; }

    /* Edit screens */
    /* e-Boekhouden's app-form holds the layout: its own width and margin step aside. */
    html.ebs-billing app-form[data-ebs-billing-form] { width: auto !important; min-width: 0 !important; max-width: none !important; margin: 0 !important; }
    html.ebs-billing [data-ebs-billing-form] .ebs-b-more-slot > form > :is(.form-header, .form-footer) { display: none !important; }
    /* Fields e-Boekhouden hides in its simple mode ("Meer opties") show in the layout. */
    .ebs-b-edit :is(.ebs-b-slot, .ebs-b-slot-wrap, .ebs-b-check-slot) > .form-row.custom-hidden,
    .ebs-b-edit .ebs-b-more-slot > form > .form-body > .form-row.custom-hidden { display: block !important; }
    .ebs-b-edit { box-sizing: border-box; margin: 24px 32px 16px; }
    .ebs-b-edit-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
    .ebs-b-back { display: flex; align-items: center; gap: 4px; font-size: 13px; color: #232c4f; text-decoration: underline; transition: color 150ms ease; }
    .ebs-b-back:hover { color: #1b2240; }
    .ebs-b-edit-title { flex: 1; }
    .ebs-b-segment { display: flex; padding: 3px; border-radius: 9px; background: #e3e7f0; }
    .ebs-b-segment[hidden], .ebs-b-muted[hidden] { display: none; }
    .ebs-b-segment-option { height: 30px; padding: 0 12px; border: 0; border-radius: 7px; background: transparent; color: #5d6584; font-size: 13px; cursor: pointer; transition: background-color 150ms ease, color 150ms ease; }
    .ebs-b-segment-option.on { background: #fff; color: #232c4f; font-weight: 500; }
    .ebs-b-segment-option:hover { color: #232c4f; }
    .ebs-b-edit-grid { display: flex; align-items: flex-start; gap: 20px; }
    .ebs-b-edit-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 14px; }
    .ebs-b-edit-aside { width: 340px; flex: none; display: flex; flex-direction: column; gap: 14px; }
    .ebs-b-section { display: grid; grid-template-columns: repeat(var(--ebs-section-columns, 3), minmax(0, 1fr)); gap: 16px; padding: 20px; border-radius: 12px; background: #fff; }
    .ebs-b-section.flush { display: block; padding: 0; overflow: visible; }
    .ebs-b-section-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 20px 10px; }
    .ebs-b-section-title { font-size: 15px; font-weight: 700; }
    .ebs-b-section > .ebs-b-section-title { grid-column: 1 / -1; }
    .ebs-b-slot { display: contents; }
    .ebs-b-slot-wrap { display: block; min-width: 0; }
    .ebs-b-span-2 { grid-column: span 2; }
    .ebs-b-span-3 { grid-column: span 3; }
    .ebs-b-span-all { grid-column: 1 / -1; }

    /* e-Boekhouden's rows, moved in: label on top, the field full width. */
    .ebs-b-edit .form-row { display: block; margin: 0; padding: 0 !important; min-width: 0; }
    .ebs-b-edit .form-row > br, .ebs-b-edit .form-row ~ br { display: none; }
    .ebs-b-edit .form-row .form-component { display: flex !important; flex-direction: column; align-items: stretch; gap: 6px; padding: 0 !important; }
    .ebs-b-edit .form-row app-form-label, .ebs-b-edit .form-row app-form-label label { width: auto !important; padding: 0 !important; font-size: 13px; font-weight: 500; color: #232c4f; }
    .ebs-b-edit .form-row .form-control { width: 100% !important; max-width: none !important; }
    .ebs-b-edit .form-row :is(input.form-input, input.displayValue, select.form-input, textarea) { box-sizing: border-box; width: 100% !important; height: 42px; padding: 0 12px; border: 1.5px solid #cfd4e2 !important; border-radius: 9px !important; background: #fff; font: 14px Ubuntu, system-ui, sans-serif; color: #232c4f; transition: border-color 150ms ease; }
    .ebs-b-edit .form-row textarea { height: 64px; padding: 10px 12px; resize: vertical; }
    .ebs-b-edit .form-row :is(input, select, textarea):focus { outline: none; border-color: #596aaf !important; }
    .ebs-b-edit .ebs-b-slot-termijn .form-component, .ebs-b-edit .form-row:has(#termijn) .form-component { flex-direction: row; flex-wrap: wrap; align-items: center; }
    .ebs-b-edit .form-row:has(#termijn) .form-component { font-size: 13px; color: #5d6584; }
    .ebs-b-edit .form-row:has(#termijn) app-form-label { flex-basis: 100%; }
    .ebs-b-edit .form-row:has(#termijn) app-number-input, .ebs-b-edit .form-row:has(#termijn) .form-control { width: 70px !important; }
    .ebs-b-due-note { font-size: 13px; color: #5d6584; }
    .ebs-b-more { grid-column: 1 / -1; padding-top: 12px; border-top: 1px solid #eef0f5; }
    .ebs-b-more-toggle { display: flex; align-items: center; gap: 6px; padding: 0; border: 0; background: none; font: 500 13px Ubuntu, system-ui, sans-serif; color: #3a4677; text-align: left; cursor: pointer; transition: color 150ms ease; }
    .ebs-b-more-toggle:hover { color: #232c4f; }
    .ebs-b-more-toggle:focus-visible { outline: 2px solid #232c4f; outline-offset: 2px; }
    .ebs-b-more-toggle svg { flex: none; transition: transform 150ms ease; }
    .ebs-b-more.open .ebs-b-more-toggle svg { transform: rotate(90deg); }
    .ebs-b-more-slot { margin-top: 12px; transition: opacity 150ms ease, transform 150ms ease; }
    /* Closed it keeps its fields rendered, so they can still take the focus. */
    .ebs-b-more:not(.open) .ebs-b-more-slot { height: 0; margin-top: 0; overflow: hidden; opacity: 0; transform: translateY(-4px); }
    .ebs-b-more-slot > form > .form-body { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .ebs-b-more-slot > form > .form-body > :not(.form-row) { grid-column: 1 / -1; }
    /* Its headings (Verzendwijze, Producten / Diensten) name rows that moved out. */
    .ebs-b-more-slot > form > .form-body > .title-group { display: none; }

    .ebs-b-line { display: grid; grid-template-columns: 70px minmax(0, 1fr) 110px 150px 110px 76px; gap: 10px; align-items: center; padding: 10px 20px; border-top: 1px solid #eef0f5; background: #fff; cursor: pointer; transition: background-color 150ms ease; }
    .ebs-b-line:not(.ebs-b-line-head):hover { background: #f3f6fd; }
    .ebs-b-line-head { padding: 8px 20px; border-top: 0; font-size: 12px; color: #5d6584; background: #f7f8fb; cursor: default; }
    .ebs-b-line > .num { font-size: 13px; }
    .ebs-b-line > .num.strong { font-size: 14px; }
    .ebs-b-line-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .ebs-b-line-name { font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ebs-b-line-note { font-size: 12px; color: #8c93ab; }
    .ebs-b-line-note.seen { color: #4a5272; }
    .ebs-b-line-vat { display: flex; align-items: center; gap: 6px; font-size: 13px; }
    .ebs-b-line-flag { display: flex; color: #c07a00; }
    .ebs-b-lines-empty { padding: 14px 20px; border-top: 1px solid #eef0f5; font-size: 13px; color: #5d6584; }
    .ebs-b-lines-add { padding: 12px 20px; border-top: 1px solid #eef0f5; }
    .ebs-b-dashed { display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px; border: 1.5px dashed #b9c0d4; border-radius: 9px; background: transparent; color: #3a4677; font-size: 13px; font-weight: 500; cursor: pointer; transition: background-color 150ms ease, border-color 150ms ease; }
    .ebs-b-dashed:hover { background: #f3f5fa; border-color: #8c93ab; }
    /* e-Boekhouden's line list stays for its window; its own table is out of sight. */
    .ebs-b-list-slot app-factuurregel-list > :is(app-grid, .center-block) { display: none !important; }

    .ebs-b-aside-card { display: flex; flex-direction: column; gap: 12px; padding: 18px 20px; border-radius: 12px; background: #fff; }
    .ebs-b-totals-body { display: flex; flex-direction: column; gap: 10px; }
    .ebs-b-total-line { display: flex; justify-content: space-between; gap: 12px; font-size: 13px; color: #4a5272; }
    .ebs-b-total-line.grand { padding-top: 10px; border-top: 1px solid #eef0f5; font-size: 18px; font-weight: 700; color: #232c4f; }
    .ebs-b-next { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid #eef0f5; font-size: 12px; color: #4a5272; }
    .ebs-b-note { display: inline-flex; padding: 2px 8px; border: 1px dashed #8c93ab; border-radius: 6px; background: #f7f8fb; color: #4a5272; font-size: 11px; line-height: 16px; }
    .ebs-b-check-row { display: flex; align-items: flex-start; gap: 10px; font-size: 13px; }
    .ebs-b-check-row[hidden] { display: none; }
    .ebs-b-check-row.indent { padding-left: 26px; }
    .ebs-b-check-row.framed { align-items: center; padding: 10px 12px; border: 1.5px solid #d6dbe8; border-radius: 9px; transition: border-color 150ms ease; }
    .ebs-b-check-row.framed:has(input:checked) { border-color: #232c4f; }
    .ebs-b-check-slot .form-row, .ebs-b-check-slot .form-component, .ebs-b-check-slot .form-control { display: block !important; margin: 0 !important; padding: 0 !important; }
    .ebs-b-check-slot app-form-label, .ebs-b-check-slot .form-control label { display: none !important; }
    .ebs-b-check-slot input[type="checkbox"] { width: 16px; height: 16px; margin: 2px 0 0; accent-color: #232c4f; }
    .ebs-b-check-label { display: flex; align-items: center; gap: 10px; cursor: pointer; }
    .ebs-b-check-label b { font-weight: 700; }
    .ebs-b-small-title { font-size: 13px; font-weight: 500; }
    .ebs-b-warning-summary { padding: 12px 14px; border: 1px solid #f5c98b; border-radius: 12px; background: #fff4e5; color: #7a4a00; font-size: 13px; opacity: 0; transform: translateY(6px); transition: opacity 150ms ease, transform 150ms ease; }
    .ebs-b-warning-summary:not(.show) { position: absolute; visibility: hidden; pointer-events: none; }
    .ebs-b-warning-summary.show { opacity: 1; transform: none; }
    .ebs-b-save { height: 48px; border: 0; border-radius: 10px; background: #232c4f; color: #fff; font-size: 15px; font-weight: 700; cursor: pointer; transition: background-color 150ms ease; }
    .ebs-b-save:hover { background: #1b2240; }
    .ebs-b-save:disabled { background: #8c93ab; cursor: default; }

    /* The line window of e-Boekhouden, restyled where it is. */
    app-form-overlay[data-ebs-line-window] .overlay-inner { width: 620px; max-width: calc(100vw - 48px); border-radius: 14px; box-shadow: 0 24px 64px rgba(10, 14, 30, .4); overflow: hidden; font-family: Ubuntu, system-ui, sans-serif; color: #232c4f; animation: ebs-b-pop 200ms cubic-bezier(0.23, 1, 0.32, 1) both; }
    app-form-overlay[data-ebs-line-window] .close-div { top: 12px; right: 16px; z-index: 1; }
    app-form-overlay[data-ebs-line-window] .close-btn { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 8px; background: #f3f5fa; font-size: 22px !important; color: #232c4f !important; text-decoration: none; transition: background-color 150ms ease !important; }
    app-form-overlay[data-ebs-line-window] .close-btn:hover { background: #e3e7f0; }
    app-form-overlay[data-ebs-line-window] .form-header { display: flex; align-items: center; gap: 12px; padding: 16px 64px 16px 20px; border-bottom: 1px solid #e6e9f1; font-size: 17px; font-weight: 700; }
    .ebs-b-modal-sub { margin-left: auto; font-size: 12px; font-weight: 400; color: #5d6584; }
    app-form-overlay[data-ebs-line-window] .form-body { padding: 18px 20px; }
    app-form-overlay[data-ebs-line-window] .form-row { margin-bottom: 12px; }
    app-form-overlay[data-ebs-line-window] :is(input.form-input, input.displayValue, select.form-input, textarea) { box-sizing: border-box; height: 42px; padding: 0 12px; border: 1.5px solid #cfd4e2; border-radius: 9px; font: 14px Ubuntu, system-ui, sans-serif; color: #232c4f; transition: border-color 150ms ease, background-color 150ms ease; }
    app-form-overlay[data-ebs-line-window] textarea { height: auto; padding: 10px 12px; }
    app-form-overlay[data-ebs-line-window] app-autocomplete[data-ebs-risk] input.displayValue { border: 2px solid #e08a00 !important; background: #fff8ec !important; }
    app-form-overlay[data-ebs-line-window] .form-footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 20px; border-top: 1px solid #e6e9f1; background: #f7f8fb; }
    app-form-overlay[data-ebs-line-window] .form-footer button { height: 40px; padding: 0 16px; border-radius: 9px; font: 14px Ubuntu, system-ui, sans-serif; cursor: pointer; transition: background-color 150ms ease; }
    app-form-overlay[data-ebs-line-window] .form-footer button.form-submit { border: 0; background: #232c4f; color: #fff; font-weight: 700; }
    app-form-overlay[data-ebs-line-window] .form-footer button.form-submit:hover { background: #1b2240; }
    .ebs-b-modal-help { margin: 0 0 12px; font-size: 12px; color: #5d6584; }
    .ebs-b-modal-warning { display: flex; flex-direction: column; gap: 10px; margin: 0 0 14px; padding: 12px 14px; border: 1px solid #f5c98b; border-radius: 10px; background: #fff4e5; color: #7a4a00; font-size: 13px; opacity: 0; transform: translateY(6px); transition: opacity 150ms ease, transform 150ms ease; }
    /* Once shown it keeps its room, so the window does not jump when it fades. */
    .ebs-b-modal-warning:not(.show) { visibility: hidden; pointer-events: none; transition: opacity 150ms ease, transform 150ms ease, visibility 0s linear 150ms; }
    .ebs-b-modal-warning:not(.show):not(.seen) { position: absolute; }
    .ebs-b-modal-warning.show { opacity: 1; transform: none; }
    .ebs-b-modal-warning-line { display: flex; align-items: flex-start; gap: 10px; }
    .ebs-b-modal-warning-line span { flex: 1; }
    .ebs-b-modal-warning-source { font-size: 12px; color: #7a4b00; }
    .ebs-b-modal-suggestion { display: flex; align-items: center; gap: 10px; padding-top: 10px; border-top: 1px solid #f5d9ad; }
    .ebs-b-modal-suggestion { transition: opacity 150ms ease; }
    .ebs-b-modal-suggestion:not(.show) { visibility: hidden; opacity: 0; pointer-events: none; }
    .ebs-b-modal-suggestion:not(.show):not(.seen) { position: absolute; }
    .ebs-b-modal-suggestion-text { flex: 1; }
    .ebs-b-take { height: 32px; padding: 0 12px; border: 0; border-radius: 7px; background: #7a4a00; color: #fff; font: 500 12px Ubuntu, system-ui, sans-serif; cursor: pointer; transition: background-color 150ms ease; }
    .ebs-b-take:hover { background: #5f3900; }
    .ebs-b-take:disabled { opacity: .6; cursor: default; }

    @keyframes ebs-b-shimmer { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
    @keyframes ebs-b-enter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @keyframes ebs-b-pop { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: none; } }
    @keyframes ebs-b-fade { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .ebs-b-card.loading .ebs-b-card-value, .ebs-b-card.loading .ebs-b-card-sub, .ebs-b-bar, .ebs-b-status.loading { animation: none; }
      .ebs-b-bar, .ebs-b-bar.show { transform: translate(-50%, 0); }
      .ebs-b-bar.show { transition: opacity 150ms ease-out, visibility 0s; }
      .ebs-b-toast, .ebs-b-toast.show, .ebs-b-warning-summary, .ebs-b-modal-warning, .ebs-b-more-slot { transform: none !important; }
      .ebs-b-more-toggle svg { transition: none; }
      .ebs-b-message, .ebs-b-row.enter { animation: ebs-b-fade 150ms ease-out both; }
      app-form-overlay[data-ebs-line-window] .overlay-inner { animation: ebs-b-fade 150ms ease-out both; }
      .ebs-b-bar-button:active { transform: none; }
    }
  `;

  const billing = Object.freeze({
    el, own, button, icon, withIcon, text,
    amount, money, plainMoney, parseDay, formatDay, longDay, today, daysBetween, relativeDue, relativeDay, plural, dayTime, MONTHS,
    useBetter, setClassic, betterDesign, featureStore, register, schedule,
    openPosts, indexPosts, normalizePost,
    headers, columnOf, dataRows, cellText, rowCount, gridLoading, bulkAction, clickable, nativePager, setNativeSelect, notification,
    backLink, filterDialog, card, chip, selectField, searchField, checkBox, iconButton, skeletonRows, message, busy, toast, actionBar, toggleNative, clearSelection, pagerView, keepFocus,
    control, formRow, place, restore, readLines, readTotals, section, checkCard, editScreen, lineWindow, chooseInAutocomplete, seenLines,
    reducedMotion,
  });
  EBS.define('billing', billing);
  startWatching();

  // ===========================================================================
  // The invoice list (Facturen)
  // ===========================================================================

  const LIST_SCREEN = 'invoices';
  const EDIT_SCREEN = 'invoice-edit';
  const LIST_PATH = /^\/facturen\/factuur\/?$/;
  const EDIT_PATH = /^\/facturen\/factuur\/(toevoegen\/)?\d+\/?$/;
  const COLUMNS = '44px 110px 170px minmax(0, 1fr) 120px 130px 130px 110px 190px';
  const STATUS = {
    open: 'Open', late: 'Te laat', paid: 'Betaald', draft: 'Niet verwerkt',
  };
  const BULK = {
    mail: 'Geselecteerde facturen klaarzetten voor mailen',
    print: 'Geselecteerde facturen afdrukken',
    incasso: 'Geselecteerde facturen klaarzetten voor incasseren',
    remove: 'Geselecteerde regels verwijderen',
  };
  const PERIODS = [['all', 'Alle periodes'], ['month', 'Deze maand'], ['last-month', 'Vorige maand'], ['year', 'Dit jaar'], ['last-year', 'Vorig jaar']];

  // The status from the open posts, joined on the invoice number: null
  // when it cannot be known.
  function invoiceStatus(row, posts, now = today()) {
    if (row.verwerkt === false) return 'draft';
    if (!posts?.ok) return null;
    const post = row.number ? posts.byNumber.get(row.number) : null;
    if (post && Math.abs(post.outstanding) > 0.004) {
      const due = row.due ?? post.due;
      return due !== null && due < now ? 'late' : 'open';
    }
    if (row.verwerkt !== true || !row.number) return null;
    // Not among the open posts: paid, unless the list was cut short.
    return posts.complete ? 'paid' : null;
  }

  function inPeriod(time, period, now = today()) {
    if (period === 'all') return true;
    if (time === null) return false;
    const date = new Date(time);
    const current = new Date(now);
    const year = current.getUTCFullYear();
    const month = current.getUTCMonth();
    if (period === 'year') return date.getUTCFullYear() === year;
    if (period === 'last-year') return date.getUTCFullYear() === year - 1;
    if (period === 'month') return date.getUTCFullYear() === year && date.getUTCMonth() === month;
    if (period === 'last-month') {
      const previous = new Date(Date.UTC(year, month - 1, 1));
      return date.getUTCFullYear() === previous.getUTCFullYear() && date.getUTCMonth() === previous.getUTCMonth();
    }
    return true;
  }

  function periodLabel(period, now = today()) {
    const current = new Date(now);
    const year = current.getUTCFullYear();
    const month = current.getUTCMonth();
    if (period === 'year') return String(year);
    if (period === 'last-year') return String(year - 1);
    if (period === 'month') return `${MONTHS[month]} ${year}`;
    if (period === 'last-month') {
      const previous = new Date(Date.UTC(year, month - 1, 1));
      return `${MONTHS[previous.getUTCMonth()]} ${previous.getUTCFullYear()}`;
    }
    return '';
  }

  function invoiceGrid() {
    return document.querySelector('app-factuur-list app-grid');
  }

  function readInvoices(grid) {
    const labels = headers(grid);
    const col = {
      date: columnOf(labels, 'Datum'),
      number: columnOf(labels, 'Nummer'),
      relation: columnOf(labels, 'Relatie'),
      excl: columnOf(labels, 'Bedrag (excl)'),
      incl: columnOf(labels, 'Bedrag (incl)'),
      kenmerk: columnOf(labels, 'Uw kenmerk'),
      text: columnOf(labels, 'Factuurtekst'),
      due: columnOf(labels, 'Uiterste betaaldatum'),
    };
    // The Verwerkt column has only an icon; hidden in the grid settings, it
    // tells nothing.
    const knowsVerwerkt = Boolean(gridTable(grid)?.tHead?.querySelector('.eb-icon-inbox, [title="Factuur verwerkt"]'));
    return dataRows(grid, labels).map((tr, index) => {
      const number = cellText(tr, col.number);
      return {
        tr, index,
        key: number || `#${index}`,
        check: tr.querySelector('.grid-multi-check input[type="checkbox"]'),
        dateText: cellText(tr, col.date),
        date: parseDay(cellText(tr, col.date)),
        number,
        relation: cellText(tr, col.relation),
        excl: amount(cellText(tr, col.excl)),
        incl: amount(cellText(tr, col.incl)),
        kenmerk: cellText(tr, col.kenmerk),
        text: cellText(tr, col.text),
        due: parseDay(cellText(tr, col.due)),
        verwerkt: knowsVerwerkt ? Boolean(tr.querySelector('.eb-icon-inbox')) : null,
        actions: {
          edit: clickable(tr.querySelector('.eb-icon-edit')),
          copy: clickable(tr.querySelector('.eb-icon-docs')),
          pdf: clickable(tr.querySelector('.eb-icon-print[title="Factuur printen"]')),
          mail: clickable(tr.querySelector('.eb-icon-mail[title="Factuur e-mailen"]')),
          remove: tr.querySelector('[title="Verwijderen"]'),
        },
      };
    });
  }

  // The footer total of e-Boekhouden's grid (Bedrag (incl)).
  function footerTotal(grid) {
    const labels = headers(grid);
    const index = columnOf(labels, 'Bedrag (incl)');
    const foot = gridTable(grid)?.tFoot;
    if (index < 0 || !foot) return Number.NaN;
    for (const row of [...foot.rows].reverse()) {
      if (row.cells.length !== labels.length) continue;
      const value = amount(text(row.cells[index]));
      if (Number.isFinite(value)) return value;
    }
    return Number.NaN;
  }

  const invoiceList = {
    name: LIST_SCREEN,
    mounted: false,
    broken: false,
    root: null,
    filters: { query: '', status: 'all', relation: '', period: 'all' },
    prefsLoaded: false,

    match: (path) => LIST_PATH.test(path),

    host() {
      return document.querySelector('app-factuur-list');
    },

    build(host) {
      const root = own(el('div', 'ebs-b-view'));
      root.style.setProperty('--ebs-cards', '4');
      root.style.setProperty('--ebs-columns', COLUMNS);

      const head = el('div', 'ebs-b-head');
      const titles = el('div', 'ebs-b-titles');
      titles.append(el('h1', '', 'Facturen'));
      this.subtitle = el('span', 'ebs-b-subtitle');
      titles.append(this.subtitle);
      const actions = el('div', 'ebs-b-head-actions');
      this.newButton = withIcon(button('Nieuwe factuur', 'ebs-b-primary', () => this.newInvoice()), 'plus');
      actions.append(button('Klassieke weergave', 'ebs-b-link', () => setClassic(LIST_SCREEN, true)), this.newButton);
      head.append(titles, actions);

      const cards = el('div', 'ebs-b-cards');
      this.cards = { open: card('Openstaand'), late: card('Te laat'), month: card('Gefactureerd deze maand'), draft: card('Niet verwerkt') };
      const retry = button('Opnieuw proberen', 'ebs-b-card-retry', (event) => {
        busy(event.currentTarget, () => openPosts.result !== null);
        openPosts.load({ again: true });
      });
      this.retry = retry;
      // The cards keep one height: the room for Opnieuw proberen is always there.
      cards.append(...Object.values(this.cards).map((one) => one.root));
      this.cards.open.root.append(retry);

      const panel = el('div', 'ebs-b-panel');
      const filters = el('div', 'ebs-b-filters');
      this.search = searchField('Zoek in de geladen regels: nummer, relatie of bedrag', (value) => {
        this.filters.query = value;
        schedule();
      });
      this.chips = {
        all: chip('Alles', () => this.setStatus('all')),
        open: chip('Open', () => this.setStatus('open')),
        late: chip('Te laat', () => this.setStatus('late'), 'late'),
        paid: chip('Betaald', () => this.setStatus('paid')),
        draft: chip('Niet verwerkt', () => this.setStatus('draft')),
        incasso: chip('Klaar voor incasso', () => this.toggleIncasso()),
      };
      this.chips.incasso.title = 'Het filter Klaar voor automatische incasso van e-Boekhouden';
      this.relationSelect = selectField('Relatie', (value) => {
        this.filters.relation = value;
        schedule();
      });
      this.periodSelect = selectField('Periode', (value) => {
        this.filters.period = value;
        featureStore().set('invoice-list', { period: value }).catch(() => {});
        schedule();
      });
      this.moreFilters = button('Meer filters', 'ebs-b-more-filters', () => this.openFilters(), { 'aria-haspopup': 'dialog' });
      filters.append(this.search, ...Object.values(this.chips), this.relationSelect, this.periodSelect, this.moreFilters);
      // e-Boekhouden's own search form waits here, out of sight, for Meer filters.
      this.filterSlot = own(el('div', 'ebs-b-hidden-slot'));

      const header = el('div', 'ebs-b-row head');
      for (const [label, className] of [['', ''], ['Datum', ''], ['Nummer', ''], ['Relatie', ''], ['Status', ''], ['Excl. btw', 'right'], ['Incl. btw', 'right'], ['Vervalt', 'ebs-b-cell-due'], ['', '']]) {
        header.append(el('span', className, label));
      }
      this.body = el('div', 'ebs-b-body');
      this.footer = pagerView(['factuur', 'facturen']);
      panel.append(filters, header, this.body, this.footer.root);
      root.append(head, cards, panel, el('div', 'ebs-b-spacer'), this.filterSlot);

      this.bar = actionBar('Acties voor geselecteerde facturen');
      this.bar.setActions([
        { id: 'mail', label: 'Klaarzetten voor mailen', kind: 'primary', title: 'Geselecteerde facturen klaarzetten voor mailen; versturen doe je daarna op de mailpagina van e-Boekhouden', run: (event, node) => this.bulk('mail', node) },
        { id: 'print', label: 'Afdrukken', run: (event, node) => this.bulk('print', node) },
        { id: 'incasso', label: 'Klaarzetten voor incasso', run: (event, node) => this.bulk('incasso', node) },
        { id: 'remove', label: 'Verwijderen', run: (event, node) => this.bulk('remove', node) },
        { id: 'clear', label: 'Selectie wissen', kind: 'quiet', run: () => clearSelection(readInvoices(invoiceGrid())) },
      ]);
      return root;
    },

    // e-Boekhouden's "Facturen zoeken" form (date, amount, number, words in
    // the lines, relation, its checkboxes).
    searchForm() {
      return [...(this.host()?.querySelectorAll('app-form') ?? [])].find((form) => form.querySelector('#automatischeIncasso, #openstaand, #trefwoordRegels')) ?? null;
    },

    // Meer filters: that form in a dialog; its Zoeken reloads the list.
    openFilters() {
      filterDialog(this.searchForm(), this.filterSlot, 'De zoekvelden van e-Boekhouden');
    },

    newInvoice() {
      const link = [...(this.host()?.querySelectorAll('app-target-link a') ?? [])].find((node) => text(node) === 'Toevoegen');
      if (link && !link.closest('app-target-link')?.classList.contains('disabled')) link.click();
    },

    setStatus(status) {
      this.filters.status = this.filters.status === status ? 'all' : status;
      schedule();
    },

    // e-Boekhouden's own filter: its checkbox and its Zoeken, the list reloads.
    toggleIncasso() {
      const form = this.searchForm();
      const box = form?.querySelector('#automatischeIncasso');
      const submit = form?.querySelector('button.form-submit');
      if (!box || !submit) return;
      box.click();
      submit.click();
      busy(this.chips.incasso, () => !gridLoading(invoiceGrid()), { timeout: 15_000 });
    },

    bulk(id, node) {
      const target = bulkAction(invoiceGrid(), BULK[id]);
      if (!target) {
        this.bar.fail(`De actie "${BULK[id]}" staat niet op de pagina. Gebruik de klassieke weergave.`);
        return;
      }
      const grid = invoiceGrid();
      const before = readInvoices(grid).filter((row) => row.check?.checked).length;
      const path = location.href;
      const note = notification()?.message ?? '';
      target.click();
      // e-Boekhouden answers with a question, a message, another page or a
      // reloaded list.
      busy(node, () => {
        const now = invoiceGrid();
        return location.href !== path || now !== grid || gridLoading(now) || (notification()?.message ?? '') !== note
          || readInvoices(now).filter((row) => row.check?.checked).length !== before;
      }, { timeout: 8000 });
    },

    // e-Boekhouden's own confirmation, shown in our dialog: Doorgaan and
    // Annuleren click its own buttons.
    async remove(row) {
      row.actions.remove?.click();
      let confirm = null;
      for (let i = 0; i < 20 && !confirm; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        confirm = row.tr.querySelector('.inner-content');
      }
      const go = confirm?.querySelector('#confirm');
      const stop = confirm?.querySelector('#cancel');
      if (!go) return;
      const words = text(confirm.querySelector('.confirmMessage') ?? confirm).replace(/\s*Doorgaan\s*Annuleren\s*$/, '');
      let answered = false;
      const body = el('p', 'ebs-b-dialog-text', words);
      const yes = button('Doorgaan', 'ebs-b-primary small', () => {
        answered = true;
        go.click();
        dialog.close();
      });
      const no = button('Annuleren', 'ebs-b-secondary', () => dialog.close());
      const dialog = EBS.dialog.open({
        title: `Factuur ${row.number} verwijderen`,
        content: body,
        footer: [no, yes],
        width: 460,
        onClose: () => {
          if (!answered) stop?.click();
        },
      });
    },

    rowView(row, status, selected) {
      const node = el('div', `ebs-b-row${selected ? ' on' : ''}`);
      node.dataset.key = row.key;
      const box = checkBox(selected, `Factuur ${row.number} selecteren`, () => toggleNative(row));
      box.dataset.role = 'check';
      node.append(box);
      node.append(el('span', 'ebs-b-cell-date', row.dateText));
      node.append(el('span', 'ebs-b-cell-number', row.number));
      node.append(el('span', 'ebs-b-cell-relation', row.relation));
      const statusCell = el('span');
      if (status === undefined) statusCell.append(el('span', 'ebs-b-status loading'));
      else if (status) statusCell.append(el('span', `ebs-b-status ${status}`, STATUS[status]));
      else statusCell.append(el('span', 'ebs-b-status unknown', ''));
      node.append(statusCell);
      node.append(el('span', 'right num ebs-b-cell-excl', plainMoney(row.excl)));
      node.append(el('span', 'right num ebs-b-cell-incl', plainMoney(row.incl)));
      let due = row.due !== null ? formatDay(row.due) : '';
      if (status === 'open' || status === 'late') due = row.due !== null ? relativeDue(row.due) : due;
      else if (status === 'draft' && row.incl < 0) due = 'creditnota';
      node.append(el('span', `ebs-b-cell-due${status === 'late' ? ' late' : ''}`, due));
      const actions = el('span', 'ebs-b-row-actions');
      const add = (role, iconName, label, title, target, onClick, quiet = false) => {
        const action = iconButton(iconName, label, onClick ?? (() => target?.click()), { title, quiet, disabled: !target });
        action.dataset.role = role;
        actions.append(action);
      };
      add('edit', 'pencil', 'Bewerken', 'Bewerken', row.actions.edit);
      add('copy', 'copy', 'Kopiëren', 'Kopiëren als nieuwe factuur', row.actions.copy);
      add('pdf', 'file-text', 'PDF', 'PDF bekijken', row.actions.pdf);
      add('mail', 'mail', 'E-mailen', row.actions.mail ? 'E-mailen' : 'Geen e-mailadres bij deze relatie', row.actions.mail);
      add('remove', 'trash', 'Verwijderen', 'Verwijderen (vraagt om bevestiging)', row.actions.remove, () => this.remove(row), true);
      node.append(actions);
      return node;
    },

    async loadPrefs() {
      this.prefsLoaded = true;
      try {
        const stored = await featureStore().get('invoice-list');
        if (stored?.period && PERIODS.some(([value]) => value === stored.period)) {
          this.filters.period = stored.period;
          schedule();
        }
      } catch { /* defaults */ }
    },

    render() {
      if (!state.loaded) return;
      const host = this.host();
      if (!host || !useBetter(LIST_SCREEN)) {
        this.unmount();
        if (host && betterDesign()) {
          const grid = invoiceGrid();
          if (grid && (!this.back?.isConnected || this.back.nextElementSibling !== grid)) {
            this.back?.remove();
            this.back = backLink(LIST_SCREEN);
            grid.before(this.back);
          }
        }
        return;
      }
      this.back?.remove();
      if (!this.root?.isConnected) {
        this.root = this.build(host);
        host.prepend(this.root);
        if (!this.prefsLoaded) this.loadPrefs();
      }
      host.setAttribute('data-ebs-billing-list', '');
      const form = this.searchForm();
      if (form && !this.filterSlot.closest('.ebs-dialog-backdrop') && !form.closest('.ebs-b-filter-dialog')) place(this.filterSlot, [form]);
      this.mounted = true;
      openPosts.load();
      this.draw(host);
      toast.follow();
    },

    draw(host) {
      const grid = invoiceGrid();
      const posts = openPosts.result;
      const now = today();
      const note = notification();
      const loading = !grid || gridLoading(grid);

      // Cards from the open posts: every open post of the administration.
      if (!posts) {
        this.cards.open.loading();
        this.cards.late.loading();
      } else if (!posts.ok) {
        this.cards.open.set({ value: 'onbekend', sub: posts.error });
        this.cards.late.set({ value: 'onbekend', sub: '' });
      } else {
        const open = posts.posts.filter((post) => Math.abs(post.outstanding) > 0.004);
        const late = open.filter((post) => post.due !== null && post.due < now);
        const sum = (list) => list.reduce((total, post) => total + post.outstanding, 0);
        this.cards.open.set({ value: money(sum(open)), sub: `${plural(open.length, 'factuur', 'facturen')}, alle open posten` });
        const oldest = late.reduce((most, post) => Math.max(most, daysBetween(post.due, now)), 0);
        this.cards.late.set({
          value: money(sum(late)), tone: 'late', subTone: late.length ? 'late' : '',
          sub: late.length ? `${plural(late.length, 'factuur', 'facturen')}, ${late.length === 1 ? '' : 'tot '}${plural(oldest, 'dag', 'dagen')}` : 'geen',
        });
      }
      this.retry.classList.toggle('show', Boolean(posts && !posts.ok));

      if (loading) {
        this.cards.month.loading();
        this.cards.draft.loading();
        this.subtitle.textContent = '';
        const errorState = !grid && note?.error;
        const signature = errorState ? `error:${note.message}` : 'loading';
        if (this.body.dataset.signature !== signature) {
          this.body.dataset.signature = signature;
          this.body.replaceChildren(errorState ? message({
            title: 'De lijst kon niet worden geladen',
            body: `e-Boekhouden meldt: "${note.message}" Er is niets veranderd aan je facturen.`,
            action: 'Opnieuw laden', onAction: () => location.reload(), alert: true,
          }) : skeletonRows(6, COLUMNS));
          if (errorState) {
            this.cards.month.set({ value: 'onbekend' });
            this.cards.draft.set({ value: 'onbekend' });
          }
        }
        this.bar.update({ selected: 0, countText: '', totalText: '' });
        this.footer.update({ grid: null, shown: 0, total: Number.NaN });
        return;
      }

      const rows = readInvoices(grid);
      const statusOf = (row) => (posts ? invoiceStatus(row, posts, now) : (row.verwerkt === false ? 'draft' : undefined));
      const monthRows = rows.filter((row) => inPeriod(row.date, 'month', now));
      const monthTotal = monthRows.reduce((sum, row) => sum + (Number.isFinite(row.excl) ? row.excl : 0), 0);
      this.cards.month.set({ value: money(monthTotal), sub: `excl. btw · ${plural(monthRows.length, 'factuur', 'facturen')} in de geladen regels` });
      const drafts = rows.filter((row) => row.verwerkt === false);
      this.cards.draft.set({ value: rows.length && rows[0].verwerkt === null ? 'onbekend' : plural(drafts.length, 'factuur', 'facturen'), sub: 'nog niet in de boekhouding, dus nog geen open post' });

      const count = rowCount(grid) ?? rows.length;
      const label = periodLabel(this.filters.period, now);
      this.subtitle.textContent = `${plural(count, 'factuur', 'facturen')}${label ? ` · ${label}` : ''}`;

      // Filters: relatie and periode over the loaded rows, then the search,
      // then the status. The chips count within the other filters.
      const relations = [...new Set(rows.map((row) => row.relation).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nl'));
      if (this.filters.relation && !relations.includes(this.filters.relation)) this.filters.relation = '';
      this.relationSelect.setOptions([['', 'Alle relaties'], ...relations.map((name) => [name, name])], this.filters.relation);
      this.periodSelect.setOptions(PERIODS, this.filters.period);
      const needle = this.filters.query.trim().toLowerCase();
      const base = rows.filter((row) => (!this.filters.relation || row.relation === this.filters.relation)
        && inPeriod(row.date, this.filters.period, now)
        && (!needle || [row.number, row.relation, row.text, row.kenmerk, plainMoney(row.excl), plainMoney(row.incl), String(row.incl)].join(' ').toLowerCase().includes(needle)));
      const statuses = new Map(base.map((row) => [row, statusOf(row)]));
      const counts = { all: base.length, open: 0, late: 0, paid: 0, draft: 0 };
      for (const status of statuses.values()) if (status) counts[status] += 1;
      if (this.filters.status !== 'all' && !posts?.ok && this.filters.status !== 'draft') this.filters.status = 'all';
      const shown = base.filter((row) => this.filters.status === 'all' || statuses.get(row) === this.filters.status);

      this.chips.all.textContent = `Alles · ${counts.all}`;
      this.chips.open.textContent = posts?.ok ? `Open · ${counts.open}` : 'Open';
      this.chips.late.textContent = posts?.ok ? `Te laat · ${counts.late}` : 'Te laat';
      for (const [status, node] of Object.entries(this.chips)) {
        if (status === 'incasso') continue;
        node.setPressed(this.filters.status === status);
        node.disabled = status !== 'all' && status !== 'draft' && !posts?.ok;
      }
      const incassoBox = this.searchForm()?.querySelector('#automatischeIncasso');
      this.chips.incasso.setPressed(Boolean(incassoBox?.checked));
      this.chips.incasso.disabled = !incassoBox;

      const signature = JSON.stringify([
        shown.map((row) => [row.key, row.dateText, row.relation, row.excl, row.incl, row.due, row.check?.checked, statuses.get(row), Boolean(row.actions.mail)]),
        rows.length, needle, this.filters.status, Boolean(note?.error),
      ]);
      if (this.body.dataset.signature !== signature) {
        const first = this.body.dataset.signature === 'loading' || !this.body.dataset.signature;
        this.body.dataset.signature = signature;
        keepFocus(this.body, () => {
          if (!rows.length && !needle && !location.search.includes('zoeken')) {
            this.body.replaceChildren(message({
              title: 'Nog geen facturen',
              body: 'Maak je eerste factuur. Hij staat hier zodra hij is opgeslagen.',
              action: 'Nieuwe factuur', actionIcon: 'plus', onAction: () => this.newInvoice(),
            }));
          } else if (!shown.length) {
            const what = needle ? `Niets gevonden voor "${this.filters.query.trim()}"` : 'Niets gevonden';
            this.body.replaceChildren(message({
              title: what,
              body: 'Er is gezocht in de geladen regels: relatie, nummer, factuurtekst en bedrag, binnen de gekozen status. Zet de filters terug, zoek anders of laad meer regels per pagina.',
              action: 'Filters wissen', onAction: () => this.clearFilters(),
            }));
          } else {
            this.body.replaceChildren(...shown.map((row) => {
              const node = this.rowView(row, statuses.get(row), Boolean(row.check?.checked));
              if (first) node.classList.add('enter');
              return node;
            }));
          }
        });
      }

      const total = footerTotal(grid);
      this.footer.update({ grid, shown: rows.length, total: Number.isFinite(total) ? total : rows.reduce((sum, row) => sum + (Number.isFinite(row.incl) ? row.incl : 0), 0), totalLabel: 'totaal incl. btw' });

      const selected = rows.filter((row) => row.check?.checked);
      const selectedTotal = selected.reduce((sum, row) => sum + (Number.isFinite(row.incl) ? row.incl : 0), 0);
      const blocked = (label) => bulkAction(grid, label)?.classList.contains('disabled') || bulkAction(grid, label)?.classList.contains('custom-disabled') || !bulkAction(grid, label);
      this.bar.update({
        selected: selected.length,
        countText: `${plural(selected.length, 'factuur', 'facturen')} geselecteerd`,
        totalText: `Totaal ${money(selectedTotal)} incl.`,
        disabled: { mail: blocked(BULK.mail), print: blocked(BULK.print), incasso: blocked(BULK.incasso), remove: blocked(BULK.remove) },
      });
    },

    clearFilters() {
      this.filters = { ...this.filters, query: '', status: 'all', relation: '', period: 'all' };
      this.search.input.value = '';
      schedule();
    },

    unmount() {
      if (this.root) restore(this.root);
      for (const content of document.querySelectorAll('.ebs-b-filter-dialog')) restore(content);
      this.root?.remove();
      this.root = null;
      this.bar?.remove();
      this.host()?.removeAttribute('data-ebs-billing-list');
      this.back?.remove();
      this.back = null;
      if (this.mounted) openPosts.reset();
      this.mounted = false;
    },
  };

  // ===========================================================================
  // Add and edit an invoice (Factuur toevoegen)
  // ===========================================================================

  const invoiceEdit = editScreen({
    screen: EDIT_SCREEN,
    match: EDIT_PATH,
    host: 'app-factuur-form',
    anchor: ['nummer', 'datum', 'relatieId'],
    back: 'Facturen',
    inExLabel: true,
    linesAt: 1,
    moreLabel: 'Meer velden van e-Boekhouden: omschrijving regels 1 tot 3, plaats, t.n.v., IBAN, uitvoerdatum, standaard factuur, Peppol',
    fields: {
      relation: ['relatieId'],
      details: ['nummer', 'datum', 'termijn', 'kenmerk'],
      textSlot: ['factuurtekst'],
      templates: ['factuursjabloonId', 'emailsjabloonId'],
      mutation: ['mutOmschrijving'],
      hidden: ['inEx'],
    },
    // toevoegen/0 is a new invoice, toevoegen/<id> an existing one, and
    // factuur/<id> a copy (a new invoice too).
    title() {
      const id = /\/toevoegen\/(\d+)/.exec(location.pathname)?.[1];
      return id && id !== '0' ? 'Factuur wijzigen' : 'Factuur toevoegen';
    },
    totalsTitle: () => 'Totaal',
    layout(view) {
      const details = section('Gegevens');
      view.slots.relation = own(el('div', 'ebs-b-slot-wrap ebs-b-span-2'));
      view.slots.details = own(el('div', 'ebs-b-slot'));
      details.append(view.slots.relation, view.slots.details);
      const options = section('Tekst en opties');
      options.style.setProperty('--ebs-section-columns', '2');
      view.slots.textSlot = own(el('div', 'ebs-b-slot-wrap ebs-b-span-all'));
      view.slots.templates = own(el('div', 'ebs-b-slot'));
      view.slots.mutation = own(el('div', 'ebs-b-slot-wrap ebs-b-span-all'));
      view.slots.more = options;
      options.append(view.slots.textSlot, view.slots.templates, view.slots.mutation);
      view.main.append(details, options);

      const onSave = el('section', 'ebs-b-aside-card');
      onSave.append(el('span', 'ebs-b-section-title', 'Bij opslaan'));
      const checks = [
        { name: 'directVerwerken', options: { title: 'Direct verwerken in de boekhouding', sub: 'De factuur wordt meteen geboekt.' } },
        { heading: 'Versturen (twee aparte vinkjes, ook samen)' },
        { name: 'emailen', options: { title: 'Per e-mail versturen', iconName: 'mail', card: true } },
        { name: 'printen', options: { title: 'Per post versturen', iconName: 'printer', card: true } },
        { name: 'incasso', options: { title: 'Factuurbedrag incasseren' } },
      ];
      view.checks = [];
      for (const check of checks) {
        if (check.heading) {
          onSave.append(el('span', 'ebs-b-small-title', check.heading));
          continue;
        }
        const node = checkCard(null, check.options);
        onSave.append(node);
        view.checks.push({ name: check.name, node });
      }
      view.aside.append(onSave);
    },
    drawAside(view, { host }) {
      // "14 dagen · vervalt 12-11-2026", with e-Boekhouden's own due date.
      const termijn = formRow(host, 'termijn');
      const due = control(host, 'uitersteBetaaldatum')?.value?.trim();
      if (termijn) {
        const component = termijn.querySelector('.form-component') ?? termijn;
        let note = component.querySelector('.ebs-b-due-note');
        if (!note) {
          note = own(el('span', 'ebs-b-due-note'));
          component.append(note);
        }
        note.textContent = due ? `· vervalt ${due}` : '';
      }
    },
  });

  invoiceEdit.name = EDIT_SCREEN;
  register(invoiceList);
  register(invoiceEdit);

  // For the tests: the pure parts.
  Object.defineProperty(window, '__ebsInvoicesTest', { value: Object.freeze({ invoiceStatus, inPeriod, periodLabel, readInvoices, footerTotal }) });
})();
