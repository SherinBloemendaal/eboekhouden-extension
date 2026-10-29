// EB Sessions: Boekhouden > Invoeren > Importeren ("Niet verwerkte afschriftregels").
//
// The screen is an Angular grid in the secure20 shell. e-Boekhouden's own grid
// stays the source of truth: its checkboxes, its delete and edit links and its
// bulk actions ("Geselecteerde regels wegboeken / verwijderen") do the work.
// This script only clicks those elements in answer to a click of the user, and
// never submits anything on its own.
//
//   shift-select   (setting shiftSelect)  Gmail-style ranges on the checkboxes
//   action bar     (setting actionBar)    count, total, Wegboeken, Verwijderen
//   Better design  (setting betterDesign) a new view over the same rows: search,
//                  filters, groups, hiding, tooltips, the mutation dialog
//
// Grid markup (from the shell's templates):
//   app-grid > app-grid-header .grid-header-title
//            > app-grid-body table.grid > thead th / tbody tr
//              row: .grid-multi-check input[type=checkbox], [title="Verwijderen"],
//                   [title="Handmatig invoeren"], [title="Bestand koppelen"]
//            > app-grid-footer app-pagination, app-grid-bulk-actions app-grid-bulk-action > li

(() => {
  if (window.__ebsImportLoaded) return;
  window.__ebsImportLoaded = true;
  if (location.hostname !== 'secure20.e-boekhouden.nl') return;

  const PAGE = /^\/boekhouden\/importeren\/?$/;
  const TITLE = 'Niet verwerkte afschriftregels';
  // Key in classicScreens.
  const SCREEN = 'import';
  const EDIT_HASH = '#ebs-edit=';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  // After the extension is reloaded, a script left in an open tab has no
  // context any more: sendMessage then throws instead of rejecting.
  function send(message) {
    try {
      return chrome.runtime.sendMessage(message).catch((error) => ({ error: String(error) }));
    } catch (error) {
      return Promise.resolve({ error: String(error) });
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // "+ 3.500,00", "− 0,05": the sign apart, as the design shows amounts.
  function signedAmount(row) {
    if (!Number.isFinite(row.amount)) return row.amountText;
    return `${row.amount > 0 ? '+' : '−'} ${EBS.formatMoney(Math.abs(row.amount))}`;
  }

  // -------------------------------------------------------------------------
  // Inside the mutation dialog: the import page loaded again in an iframe. It
  // opens the row's own "Handmatig invoeren" page, and tells the dialog when
  // e-Boekhouden comes back to the import list (after saving or cancelling).
  // "Openen in nieuw tabblad" loads the same link in a tab of its own.
  // -------------------------------------------------------------------------

  if (location.hash.startsWith(EDIT_HASH)) {
    const framed = window !== window.top;
    let signature = '';
    try {
      signature = decodeURIComponent(location.hash.slice(EDIT_HASH.length));
    } catch { /* a broken link: nothing to open */ }
    if (signature) runEditFrame(signature, framed);
    // In its own tab the page is an ordinary import page apart from that.
    if (framed) return;
  }

  let settings = EBS.settingsWithDefaults();
  let settingsLoaded = false;
  // Per screen: true once the user picked "Klassieke weergave" there. The
  // popup's Better design switch clears it (see popup.js).
  let classicScreens = {};

  function onImportPage() {
    return PAGE.test(location.pathname);
  }

  function useBetter() {
    return settings.betterDesign && onImportPage() && !classicScreens[SCREEN];
  }

  function setClassic(classic) {
    classicScreens = { ...classicScreens, [SCREEN]: classic };
    chrome.storage.local.set({ classicScreens });
    applyBetterClass();
    schedule();
  }

  // Set before the grid renders, so the native table never flashes up.
  function applyBetterClass() {
    document.documentElement.classList.toggle('ebs-better-import', useBetter());
  }

  // -------------------------------------------------------------------------
  // Reading the native grid
  // -------------------------------------------------------------------------

  function findGrid() {
    for (const grid of document.querySelectorAll('app-grid')) {
      if (grid.querySelector('.grid-header-title')?.textContent.includes(TITLE)) return grid;
    }
    return null;
  }

  function columnIndexes(grid) {
    const names = { importDate: 'Importdatum', account: 'RekeningNr', bookDate: 'Boekdatum', amount: 'Bedrag', description: 'Omschrijving', failure: 'Verwerkingsfouten', note: 'Opmerking' };
    const headers = [...grid.querySelectorAll('app-grid-body table.grid thead th')].map((th) => th.textContent.trim());
    return Object.fromEntries(Object.entries(names).map(([key, label]) => [key, headers.findIndex((text) => text.startsWith(label))]));
  }

  function readRows(grid) {
    const columns = columnIndexes(grid);
    const rows = [];
    for (const tr of grid.querySelectorAll('app-grid-body table.grid tbody tr')) {
      const checkbox = tr.querySelector('.grid-multi-check input[type="checkbox"]');
      if (!checkbox) continue;
      const cells = [...tr.children];
      const text = (key) => (columns[key] >= 0 ? cells[columns[key]]?.textContent.replace(/\s+/g, ' ').trim() ?? '' : '');
      const amountText = text('amount');
      const description = text('description');
      const parsed = EBS.counterparty(description);
      rows.push({
        tr, checkbox,
        index: rows.length,
        importDate: text('importDate'),
        account: text('account'),
        bookDate: text('bookDate'),
        amountText,
        amount: EBS.parseAmount(amountText),
        description,
        failure: text('failure'),
        note: text('note'),
        party: parsed.party,
        partyIban: parsed.iban,
        rest: parsed.rest,
        edit: tr.querySelector('[title="Handmatig invoeren"]'),
        remove: tr.querySelector('[title="Verwijderen"]'),
        attach: tr.querySelector('[title="Bestand koppelen"]'),
      });
    }
    return EBS.signRows(rows);
  }

  // More than one page of lines (e-Boekhouden shows 100 per page by default).
  function paginated(grid) {
    return [...grid.querySelectorAll('app-pagination .pagination li')].filter((li) => /^\s*\d+\s*$/.test(li.textContent)).length > 1;
  }

  // e-Boekhouden's own labels, matched whole: "verwijderen" alone would also
  // match "Geselecteerde importregels verwijderen" on other grids.
  const BULK_LABELS = { wegboeken: 'Geselecteerde regels wegboeken', verwijderen: 'Geselecteerde regels verwijderen' };

  function bulkAction(grid, action) {
    if (!grid) return null;
    return [...grid.querySelectorAll('app-grid-bulk-action li')]
      .find((li) => li.textContent.replace(/\s+/g, ' ').trim() === BULK_LABELS[action]) ?? null;
  }

  // The <li> carries Angular's click handler (app-grid-bulk-action's template).
  function runBulkAction(action) {
    const target = bulkAction(findGrid(), action);
    if (target) target.click();
    else bar.fail(`De actie "${BULK_LABELS[action]}" staat niet meer op de pagina. Gebruik de klassieke weergave.`);
  }

  // -------------------------------------------------------------------------
  // Shift-select on the native checkboxes (and on ours, which mirror them)
  // -------------------------------------------------------------------------

  // The anchor is the checkbox clicked last, with the line it belonged to:
  // after a page change or a reload of the grid it no longer counts.
  let anchor = null;
  let clickingRange = false;

  function anchorIndex(rows) {
    if (!anchor) return -1;
    return rows.findIndex((row) => row.checkbox === anchor.checkbox && EBS.rowSignature(row) === anchor.signature);
  }

  function setAnchor(row) {
    anchor = row ? { checkbox: row.checkbox, signature: EBS.rowSignature(row) } : null;
  }

  // After the native click on `target` has toggled it, give the whole range the
  // anchor's state by clicking the checkboxes that differ. Angular registers
  // each click as a selection, exactly as if they were clicked one by one.
  function applyRange(rows, from, target) {
    const toggles = EBS.rangeToggles(rows.map((row) => row.checkbox.checked), from, target);
    clickingRange = true;
    try {
      for (const index of toggles) rows[index].checkbox.click();
    } finally {
      clickingRange = false;
    }
  }

  document.addEventListener('click', (event) => {
    if (clickingRange || !onImportPage()) return;
    const input = event.target instanceof HTMLInputElement && event.target.closest('.grid-multi-check input[type="checkbox"]');
    if (!input) return;
    const grid = findGrid();
    if (!grid || !grid.contains(input)) return;
    const rows = readRows(grid);
    const index = rows.findIndex((row) => row.checkbox === input);
    if (index < 0) return;
    const from = anchorIndex(rows);
    if (event.shiftKey && settings.shiftSelect && from >= 0) {
      // Let the native handler toggle the clicked box first.
      setTimeout(() => {
        const fresh = readRows(grid);
        applyRange(fresh, from, index);
        setAnchor(fresh[index]);
        schedule();
      });
      return;
    }
    setAnchor(rows[index]);
  }, true);

  // Shift held over a row: show which range a shift-click would touch. Mouse
  // moves without shift only clear an earlier preview, so they cost nothing.
  let rangeShown = false;
  document.addEventListener('mousemove', (event) => {
    if (!event.shiftKey && !rangeShown) return;
    if (!settings.shiftSelect || !onImportPage() || useBetter()) return;
    const grid = findGrid();
    if (!grid) return;
    const tr = event.target instanceof Element ? event.target.closest('app-grid-body table.grid tbody tr') : null;
    const rows = readRows(grid);
    const over = tr ? rows.findIndex((row) => row.tr === tr) : -1;
    const from = anchorIndex(rows);
    rangeShown = false;
    for (const row of rows) {
      const inRange = event.shiftKey && from >= 0 && over >= 0 && row.index >= Math.min(from, over) && row.index <= Math.max(from, over) && !row.checkbox.checked;
      row.tr.classList.toggle('ebs-range', inRange);
      rangeShown ||= inRange;
    }
  }, { passive: true });

  // -------------------------------------------------------------------------
  // Render loop: re-read the grid when Angular changes it.
  // -------------------------------------------------------------------------

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
    if (!settingsLoaded) return;
    const grid = onImportPage() ? findGrid() : null;
    // The Better design CSS only touches the grid marked here, never another
    // grid on the page or a page where the import grid was not found.
    for (const marked of document.querySelectorAll('app-grid[data-ebs-import]')) {
      if (marked !== grid || !useBetter()) delete marked.dataset.ebsImport;
    }
    if (grid && useBetter()) grid.dataset.ebsImport = '';
    if (!grid) {
      bar.hide();
      better.unmount();
      backToBetter.unmount();
      return;
    }
    const rows = readRows(grid);
    if (useBetter()) {
      backToBetter.unmount();
      better.mount(grid, rows);
    } else {
      better.unmount();
      if (settings.betterDesign) backToBetter.mount(grid);
      else backToBetter.unmount();
    }
    bar.update(grid, rows);
  }

  // -------------------------------------------------------------------------
  // Action bar
  // -------------------------------------------------------------------------

  const bar = {
    host: null,
    count: null,
    total: null,
    groupMenu: null,
    native: {},

    ensure() {
      if (this.host?.isConnected) return;
      this.host = el('div', 'ebs-bar');
      this.host.setAttribute('role', 'toolbar');
      this.host.setAttribute('aria-label', 'Acties voor geselecteerde regels');
      const summary = el('span', 'ebs-bar-summary');
      this.count = el('span', 'ebs-bar-count');
      this.total = el('span', 'ebs-bar-total');
      summary.append(this.count, this.total);
      this.host.append(summary, el('span', 'ebs-bar-divider'));
      this.buttons = el('span', 'ebs-bar-buttons');
      this.host.append(this.buttons);
      document.body.append(this.host);
      window.addEventListener('resize', () => this.place(), { passive: true });
    },

    hide() {
      this.host?.classList.remove('show');
      this.closeGroupMenu(true);
      this.spacer?.remove();
      this.message?.remove();
    },

    // Says so in the bar when a native action could not be found.
    fail(text) {
      if (!this.host) return;
      this.message?.remove();
      this.message = el('span', 'ebs-bar-message', text);
      this.message.setAttribute('role', 'alert');
      this.host.append(this.message);
    },

    // Centred under the list, not under the whole window with its sidebar.
    place() {
      if (!this.host) return;
      const target = better.root?.isConnected ? better.root : findGrid();
      const rect = target?.getBoundingClientRect();
      this.host.style.left = rect?.width ? `${Math.round(rect.left + rect.width / 2)}px` : '';
    },

    update(grid, rows) {
      if (!settings.actionBar) {
        this.hide();
        return;
      }
      const selected = rows.filter((row) => row.checkbox.checked);
      if (!selected.length) {
        this.hide();
        return;
      }
      this.ensure();
      this.host.classList.toggle('better', useBetter());
      const total = selected.reduce((sum, row) => sum + (Number.isFinite(row.amount) ? row.amount : 0), 0);
      this.count.textContent = `${selected.length} ${selected.length === 1 ? 'regel' : 'regels'} geselecteerd`;
      this.total.textContent = `Totaal € ${EBS.formatMoney(total)}`;

      // Rebuild the buttons only when the mode changes, so focus survives.
      const mode = useBetter() ? 'better' : 'native';
      if (this.buttons.dataset.mode !== mode) {
        this.closeGroupMenu(true);
        this.buttons.dataset.mode = mode;
        this.buttons.replaceChildren();
        const button = (label, className, onClick, parent = this.buttons) => {
          const node = el('button', `ebs-bar-button ${className}`, label);
          node.type = 'button';
          node.addEventListener('click', onClick);
          parent.append(node);
          return node;
        };
        this.native.wegboeken = button('Wegboeken', 'primary', () => runBulkAction('wegboeken'));
        if (mode === 'better') {
          // The menu opens from the button itself, as in the design.
          const wrap = el('span', 'ebs-group-wrap');
          this.buttons.append(wrap);
          const groupButton = button('Aan groep toevoegen ▾', 'ghost', (event) => this.toggleGroupMenu(groupButton, event.detail === 0), wrap);
          groupButton.setAttribute('aria-haspopup', 'menu');
          groupButton.setAttribute('aria-expanded', 'false');
          button('Verbergen', 'ghost', () => better.hideRows(readRows(findGrid()).filter((row) => row.checkbox.checked)));
        }
        this.native.verwijderen = button('Verwijderen', 'ghost', () => runBulkAction('verwijderen'));
        button('Selectie wissen', 'quiet', () => {
          clickingRange = true;
          try {
            for (const row of readRows(findGrid())) if (row.checkbox.checked) row.checkbox.click();
          } finally {
            clickingRange = false;
          }
          anchor = null;
          better.anchor = null;
          schedule();
        });
      }
      // e-Boekhouden blocks its bulk actions while it is busy: so do these.
      for (const word of ['wegboeken', 'verwijderen']) {
        this.native[word].disabled = Boolean(bulkAction(grid, word)?.classList.contains('disabled'));
      }
      this.place();
      // Room below the list, so the bar never covers the pagination.
      if (!this.spacer) this.spacer = el('div', 'ebs-bar-spacer');
      if (this.spacer.previousElementSibling !== grid) grid.after(this.spacer);
      // A class change, so a quick select and clear reverses mid-way.
      requestAnimationFrame(() => this.host.classList.add('show'));
    },

    toggleGroupMenu(anchorButton, fromKeyboard) {
      if (this.groupMenu) {
        this.closeGroupMenu();
        return;
      }
      anchorButton.setAttribute('aria-expanded', 'true');
      const menu = el('div', 'ebs-group-menu');
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', 'Aan groep toevoegen');
      const selected = () => readRows(findGrid()).filter((row) => row.checkbox.checked);
      const item = (label, onClick) => {
        const node = el('button', 'ebs-group-item', label);
        node.type = 'button';
        node.setAttribute('role', 'menuitem');
        node.addEventListener('click', () => {
          onClick();
          this.closeGroupMenu();
        });
        menu.append(node);
      };
      for (const name of better.prefs.groups) item(name, () => better.assign(selected(), name));
      if (selected().some((row) => better.prefs.groupOf[EBS.rowSignature(row)])) item('Uit groep halen', () => better.assign(selected(), null));
      const create = el('form', 'ebs-group-new');
      const input = el('input');
      input.placeholder = 'Nieuwe groep met deze regels';
      input.setAttribute('aria-label', 'Naam van de nieuwe groep');
      input.maxLength = 40;
      create.append(input);
      create.addEventListener('submit', (event) => {
        event.preventDefault();
        const name = input.value.trim();
        if (!name) return;
        better.addGroup(name);
        better.assign(selected(), name);
        this.closeGroupMenu();
      });
      menu.append(create);
      anchorButton.parentElement.append(menu);
      this.groupMenu = { menu, anchorButton };
      this.onOutside = (event) => {
        if (!menu.contains(event.target) && event.target !== anchorButton) this.closeGroupMenu();
      };
      this.onMenuKey = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          this.closeGroupMenu();
          anchorButton.focus();
          return;
        }
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const items = [...menu.querySelectorAll('.ebs-group-item, input')];
        const at = items.indexOf(document.activeElement);
        event.preventDefault();
        items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      };
      document.addEventListener('mousedown', this.onOutside, true);
      menu.addEventListener('keydown', this.onMenuKey);
      if (fromKeyboard) menu.querySelector('.ebs-group-item, input')?.focus();
    },

    // Closing fades out (100 ms) in Better design; a hide or a mode switch closes at once.
    closeGroupMenu(immediate = false) {
      if (!this.groupMenu) return;
      const { menu, anchorButton } = this.groupMenu;
      this.groupMenu = null;
      anchorButton.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', this.onOutside, true);
      if (immediate || !menu.isConnected || !this.host?.classList.contains('better')) {
        menu.remove();
        return;
      }
      menu.classList.add('closing');
      setTimeout(() => menu.remove(), 100);
    },
  };

  // -------------------------------------------------------------------------
  // Better design view
  // -------------------------------------------------------------------------

  const better = {
    root: null,
    grid: null,
    rows: [],
    prefs: { hidden: [], groups: [], groupOf: {} },
    // EBS.store keys of this administration's import screen; the number comes
    // from the page header ('default' without one).
    prefsStore: null,
    ui: { query: '', direction: 'all', period: 'all', size: 'all', showHidden: false, group: null },
    leaving: new Set(),
    // Signature of the line whose box was clicked last (the shift-select anchor).
    anchor: null,

    async loadPrefs() {
      const number = document.querySelector('app-header-identity-b .administratieId, app-header-identity #administratieId')?.textContent.trim();
      const administration = /^\d{1,12}$/.test(number ?? '') ? number : 'default';
      if (this.prefsStore?.prefix === `${administration}/import/`) return;
      const store = EBS.store.feature('import', { administration });
      this.prefsStore = store;
      const stored = await store.get('prefs').catch(() => null);
      if (this.prefsStore !== store) return;
      this.prefs = { hidden: [], groups: [], groupOf: {}, ...(stored ?? {}) };
      schedule();
    },

    savePrefs() {
      this.prefsStore?.set('prefs', this.prefs).catch((error) => console.warn('EB Sessions: import view not saved', error?.message ?? error));
    },

    mount(grid, rows) {
      this.grid = grid;
      this.rows = rows;
      this.loadPrefs();
      if (!this.root?.isConnected) {
        this.root = el('section', 'ebs-import');
        this.root.setAttribute('aria-label', 'Afschriftregels om te verwerken');
        grid.before(this.root);
        this.build();
      }
      this.draw();
    },

    unmount() {
      this.root?.remove();
      this.root = null;
      dialog.close();
    },

    build() {
      const head = el('div', 'ebs-head');
      const titles = el('div', 'ebs-titles');
      titles.append(el('h1', '', 'Afschriftregels om te verwerken'));
      this.subtitle = el('span', 'ebs-subtitle');
      titles.append(this.subtitle);
      const classic = el('button', 'ebs-link', 'Klassieke weergave');
      classic.type = 'button';
      classic.addEventListener('click', () => setClassic(true));
      head.append(titles, classic);

      this.cards = el('div', 'ebs-cards');

      const panel = el('div', 'ebs-panel');
      this.tabs = el('div', 'ebs-tabs');
      this.tabList = el('span', 'ebs-tab-list');
      this.tabList.setAttribute('role', 'tablist');
      this.tabList.setAttribute('aria-label', 'Groepen');
      // Rename and delete are not tabs, so they sit next to the tablist.
      this.tabActions = el('span', 'ebs-tab-actions');
      this.tabs.append(this.tabList, this.tabActions, this.buildGroupEditor());

      const filters = el('div', 'ebs-filters');
      const search = el('label', 'ebs-search');
      search.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>';
      this.searchInput = el('input');
      this.searchInput.type = 'search';
      this.searchInput.placeholder = 'Zoek in alle kolommen: tegenpartij, rekening, omschrijving, datum, bedrag';
      this.searchInput.setAttribute('aria-label', 'Zoeken in alle kolommen');
      this.searchInput.addEventListener('input', () => {
        this.ui.query = this.searchInput.value;
        this.draw();
      });
      search.append(this.searchInput);
      this.directionChips = el('span', 'ebs-chips');
      this.periodSelect = this.select('Periode', (value) => { this.ui.period = value; });
      this.sizeSelect = this.select('Bedrag', (value) => { this.ui.size = value; }, [['all', 'Alle bedragen'], ['small', 'Onder € 10'], ['large', 'Vanaf € 100']]);
      this.hiddenToggle = el('button', 'ebs-hidden-toggle');
      this.hiddenToggle.type = 'button';
      this.hiddenToggle.addEventListener('click', () => {
        this.ui.showHidden = !this.ui.showHidden;
        this.draw();
      });
      filters.append(search, this.directionChips, this.periodSelect.label, this.sizeSelect.label, this.hiddenToggle);

      const headRow = el('div', 'ebs-row ebs-row-head');
      for (const text of ['', 'Boekdatum', 'Tegenpartij', 'Omschrijving', 'Bedrag', '']) headRow.append(el('span', '', text));
      this.body = el('div', 'ebs-body');
      this.body.addEventListener('mousemove', (event) => this.previewRange(event), { passive: true });
      this.body.addEventListener('mouseleave', () => this.previewRange(null));
      this.footer = el('div', 'ebs-footer');

      panel.append(this.tabs, filters, headRow, this.body, this.footer);
      this.root.append(head, this.cards, panel);
    },

    select(label, onChange, options = []) {
      const wrap = el('label', 'ebs-select');
      wrap.append(el('span', '', label));
      const select = el('select');
      select.setAttribute('aria-label', label);
      for (const [value, text] of options) select.append(new Option(text, value));
      select.addEventListener('change', () => {
        onChange(select.value);
        this.draw();
      });
      wrap.append(select);
      return { label: wrap, select };
    },

    visibleRows() {
      return EBS.filterRows(this.rows, {
        ...this.ui,
        hidden: this.prefs.hidden,
        group: this.ui.group,
        groupOf: this.prefs.groupOf,
      });
    },

    draw({ flip = false } = {}) {
      if (!this.root) return;
      // Tabs and chips are rebuilt below: keep keyboard focus on the same one.
      const focusKey = this.root.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
      const all = this.rows;
      const visible = this.visibleRows();
      const summary = EBS.summarize(visible);
      const hiddenCount = all.filter((row) => this.prefs.hidden.includes(EBS.rowSignature(row))).length;
      const total = /\((\d+) regels?\)/.exec(this.grid.querySelector('.grid-header-title')?.textContent ?? '')?.[1];
      const account = [...new Set(all.map((row) => row.account).filter(Boolean))];
      // With pages, search, filters and totals only see this page: say so.
      const paged = paginated(this.grid);
      const scope = paged ? 'op deze pagina' : 'in beeld';
      this.searchInput.placeholder = paged
        ? 'Zoek op deze pagina: tegenpartij, rekening, omschrijving, datum, bedrag'
        : 'Zoek in alle kolommen: tegenpartij, rekening, omschrijving, datum, bedrag';
      const signatures = all.map((row) => EBS.rowSignature(row));
      if (!paged && all.length && Number(total) === all.length) {
        const pruned = EBS.prunePrefs(this.prefs, signatures);
        if (pruned.changed) {
          this.prefs = pruned.prefs;
          this.savePrefs();
        }
      }
      this.subtitle.textContent = `${total ?? all.length} regels uit de import${account.length === 1 ? ` · rekening ${account[0]}` : ''}`;

      this.cards.replaceChildren(
        this.card(`Binnengekomen (${scope})`, `€ ${EBS.formatMoney(summary.inTotal)}`, `${summary.inCount} ${summary.inCount === 1 ? 'regel' : 'regels'}`, 'in'),
        this.card(`Uitgegaan (${scope})`, `€ ${summary.outTotal < 0 ? '−' : ''}${EBS.formatMoney(Math.abs(summary.outTotal))}`, `${summary.outCount} ${summary.outCount === 1 ? 'regel' : 'regels'}`),
        this.card(paged ? 'Oudste regel (op deze pagina)' : 'Oudste regel', summary.oldest ? `${summary.oldest.day} ${EBS.monthLabel(summary.oldest.key)}` : 'Geen', summary.oldest ? `${Math.max(0, Math.floor((Date.now() - summary.oldest.time) / 86400000))} dagen niet verwerkt` : ''),
      );

      // Group tabs. Rebuilt only when they change: draw() also runs on every
      // native grid update, and a rebuild would take focus from the tabs.
      const counts = EBS.groupCounts(this.prefs.groupOf, this.prefs.groups, signatures);
      const tabsKey = JSON.stringify([this.prefs.groups, counts, this.ui.group, this.editor.mode]);
      if (this.tabList.dataset.key !== tabsKey) {
        this.tabList.dataset.key = tabsKey;
        this.tabList.replaceChildren();
        const tab = (label, name) => {
          const button = el('button', `ebs-tab${this.ui.group === name ? ' on' : ''}`, label);
          button.type = 'button';
          button.dataset.focusKey = `tab:${name ?? ''}`;
          button.setAttribute('role', 'tab');
          button.setAttribute('aria-selected', String(this.ui.group === name));
          button.addEventListener('click', () => {
            this.ui.group = name;
            this.draw();
          });
          this.tabList.append(button);
        };
        tab('Alle regels', null);
        for (const name of this.prefs.groups) tab(`${name} · ${counts[name] ?? 0}`, name);
        this.tabActions.replaceChildren();
        if (this.ui.group && !this.editor.mode) {
          const rename = el('button', 'ebs-tab-action', 'Naam wijzigen');
          rename.type = 'button';
          rename.dataset.focusKey = 'tab-rename';
          rename.addEventListener('click', () => this.openEditor('rename'));
          const remove = el('button', 'ebs-tab-action', `Groep "${this.ui.group}" verwijderen`);
          remove.type = 'button';
          remove.addEventListener('click', () => this.removeGroup(this.ui.group));
          this.tabActions.append(rename, remove);
        }
      }
      this.editor.start.hidden = Boolean(this.editor.mode);
      this.editor.form.hidden = !this.editor.mode;

      // Filters.
      this.directionChips.replaceChildren();
      for (const [value, label] of [['all', 'Alles'], ['in', 'Bij'], ['out', 'Af']]) {
        const chip = el('button', `ebs-chip${this.ui.direction === value ? ' on' : ''}`, label);
        chip.type = 'button';
        chip.dataset.focusKey = `direction:${value}`;
        chip.setAttribute('aria-pressed', String(this.ui.direction === value));
        chip.addEventListener('click', () => {
          this.ui.direction = value;
          this.draw();
        });
        this.directionChips.append(chip);
      }
      const periods = EBS.periodsOf(all);
      const periodOptions = [['all', 'Alles'], ...periods.map((key) => [key, EBS.monthLabel(key)])];
      if (this.periodSelect.select.options.length !== periodOptions.length || [...this.periodSelect.select.options].some((option, i) => option.value !== periodOptions[i][0])) {
        this.periodSelect.select.replaceChildren(...periodOptions.map(([value, text]) => new Option(text, value)));
      }
      if (!periodOptions.some(([value]) => value === this.ui.period)) this.ui.period = 'all';
      this.periodSelect.select.value = this.ui.period;
      this.sizeSelect.select.value = this.ui.size;
      this.hiddenToggle.textContent = `Verborgen (${hiddenCount}) ${this.ui.showHidden ? 'verbergen' : 'tonen'}`;
      this.hiddenToggle.setAttribute('aria-pressed', String(this.ui.showHidden));
      this.hiddenToggle.classList.toggle('on', this.ui.showHidden);

      this.drawRows(visible, all.length, { flip });
      if (focusKey && !this.root.contains(document.activeElement)) {
        this.root.querySelector(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
      }
      this.footer.textContent = `${visible.length} ${visible.length === 1 ? 'regel' : 'regels'} in beeld${paged ? ' op deze pagina' : ''} · ${hiddenCount} verborgen · ${total ?? all.length} in totaal`;
    },

    card(label, value, sub, tone) {
      const card = el('div', 'ebs-card');
      card.append(el('span', 'ebs-card-label', label), el('span', `ebs-card-value${tone ? ` ${tone}` : ''}`, value), el('span', 'ebs-card-sub', sub));
      return card;
    },

    // A redraw rebuilds the rows. Keyboard focus moves to the same control
    // of the same line. Rows only slide (FLIP) after a hide: search and
    // filters redraw at once, by design.
    drawRows(visible, totalRows, { flip = false } = {}) {
      const before = flip ? new Map([...this.body.children].map((node) => [node.dataset.signature, node.getBoundingClientRect().top])) : null;
      const active = this.body.contains(document.activeElement) ? document.activeElement : null;
      const focus = active && { signature: active.closest('.ebs-row')?.dataset.signature, control: active.dataset.control };
      this.body.replaceChildren();
      for (const row of visible) this.body.append(this.rowElement(row, visible));
      if (!visible.length) {
        this.body.append(el('div', 'ebs-empty', totalRows ? 'Geen regels die passen bij je zoekopdracht of filters.' : 'Er staan geen afschriftregels klaar om te verwerken.'));
      }
      if (this.preview) this.paintPreview();
      if (focus?.signature && focus.control) {
        const node = [...this.body.children].find((child) => child.dataset.signature === focus.signature);
        node?.querySelector(`[data-control="${focus.control}"]`)?.focus({ preventScroll: true });
      }
      if (!before || reducedMotion.matches) return;
      for (const node of this.body.children) {
        const old = before.get(node.dataset.signature);
        if (old === undefined) continue;
        const delta = old - node.getBoundingClientRect().top;
        if (!delta) continue;
        node.style.transform = `translateY(${delta}px)`;
        node.style.transition = 'none';
        requestAnimationFrame(() => {
          node.style.transition = 'transform 180ms cubic-bezier(0.23, 1, 0.32, 1)';
          node.style.transform = '';
        });
      }
    },

    // Shift held over a line: show which lines a shift-click would set. The
    // line under the mouse is kept, so a redraw shows the same preview.
    previewRange(event) {
      const over = event?.shiftKey && settings.shiftSelect && event.target instanceof Element ? event.target.closest('.ebs-row') : null;
      this.preview = over?.dataset.signature ?? null;
      this.paintPreview();
    },

    paintPreview() {
      const rows = [...this.body.children].filter((node) => node.classList.contains('ebs-row'));
      const from = this.preview ? rows.findIndex((node) => node.dataset.signature === this.anchor) : -1;
      const to = this.preview ? rows.findIndex((node) => node.dataset.signature === this.preview) : -1;
      rows.forEach((node, i) => {
        const inRange = from >= 0 && to >= 0 && i >= Math.min(from, to) && i <= Math.max(from, to) && !node.classList.contains('checked');
        node.classList.toggle('ebs-range', inRange);
      });
    },

    rowElement(row, visibleRows) {
      const signature = EBS.rowSignature(row);
      const isHidden = this.prefs.hidden.includes(signature);
      const group = this.prefs.groupOf[signature];
      const node = el('div', `ebs-row${row.checkbox.checked ? ' checked' : ''}${isHidden ? ' is-hidden' : ''}${this.leaving.has(signature) ? ' leaving' : ''}${this.anchor === signature ? ' anchor' : ''}`);
      node.dataset.signature = signature;

      const box = el('button', 'ebs-check');
      box.type = 'button';
      box.dataset.control = 'check';
      box.setAttribute('role', 'checkbox');
      box.setAttribute('aria-checked', String(row.checkbox.checked));
      box.setAttribute('aria-label', 'Regel selecteren');
      box.textContent = row.checkbox.checked ? '✓' : '';
      box.addEventListener('click', (event) => {
        event.stopPropagation();
        const position = visibleRows.indexOf(row);
        // Only an anchor that is in view counts, as in Gmail.
        const from = visibleRows.findIndex((item) => EBS.rowSignature(item) === this.anchor);
        const shiftRange = event.shiftKey && settings.shiftSelect && from >= 0;
        row.checkbox.click();
        if (shiftRange) {
          const toggles = EBS.rangeToggles(visibleRows.map((item) => item.checkbox.checked), from, position);
          clickingRange = true;
          try {
            for (const index of toggles) visibleRows[index].checkbox.click();
          } finally {
            clickingRange = false;
          }
        }
        this.anchor = signature;
        schedule();
      });

      const date = el('span', 'ebs-date');
      date.append(el('span', '', row.bookDate), el('span', 'ebs-muted', `geïmporteerd ${row.importDate}`));

      const party = el('span', 'ebs-party');
      const partyLine = el('span', 'ebs-party-line');
      const partyName = el('span', 'ebs-party-name', row.party ?? row.description);
      partyName.title = row.party ?? row.description;
      partyLine.append(partyName);
      if (group) partyLine.append(el('span', 'ebs-group-chip', group));
      party.append(partyLine, el('span', 'ebs-muted', row.partyIban ?? row.account));

      const description = el('span', 'ebs-description', row.party ? row.rest : (row.failure || row.note || ''));
      description.title = row.description;

      const amount = el('span', `ebs-amount${row.amount > 0 ? ' in' : ''}`, signedAmount(row));

      const actions = el('span', 'ebs-actions');
      const action = (glyph, label, tip, className, onClick, enabled = true) => {
        const wrap = el('span', 'ebs-action-wrap');
        const button = el('button', `ebs-action ${className}`, glyph);
        button.type = 'button';
        button.dataset.control = className;
        button.setAttribute('aria-label', label);
        button.disabled = !enabled;
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          onClick();
        });
        button.addEventListener('mouseenter', () => tooltip.show(wrap, tip));
        button.addEventListener('mouseleave', () => tooltip.hide());
        button.addEventListener('focus', () => tooltip.show(wrap, tip));
        button.addEventListener('blur', () => tooltip.hide());
        wrap.append(button);
        actions.append(wrap);
      };
      action('✓', 'Wegboeken', 'Wegboeken: open het mutatiescherm', 'book', () => dialog.open(row, signature), Boolean(row.edit));
      action('⇪', 'Bon uploaden', 'Bon of factuur koppelen aan deze regel', 'attach', () => row.attach?.click(), Boolean(row.attach));
      action(isHidden ? '◉' : '◌', isHidden ? 'Weer tonen' : 'Verbergen', isHidden ? 'Weer tonen in de lijst' : 'Verbergen (alleen in jouw weergave, niet verwijderd)', 'hide', () => (isHidden ? this.unhide(row) : this.hideRows([row])));
      action('✕', 'Verwijderen', 'Verwijderen uit e-Boekhouden (vraagt om bevestiging)', 'delete', () => row.remove?.click(), Boolean(row.remove));

      node.append(box, date, party, description, amount, actions);
      node.addEventListener('click', () => {
        if (row.edit) dialog.open(row, signature);
      });
      return node;
    },

    // The line fades out (140 ms) where it is, then the lines below slide up
    // (FLIP, 180 ms). With reduced motion: the fade only.
    hideRows(rows) {
      const signatures = rows.map((row) => EBS.rowSignature(row)).filter((signature) => !this.prefs.hidden.includes(signature));
      if (!signatures.length) return;
      const commit = () => {
        for (const signature of signatures) this.leaving.delete(signature);
        this.prefs.hidden = [...this.prefs.hidden, ...signatures];
        this.savePrefs();
        this.draw({ flip: true });
      };
      // Unselect what gets hidden, through the native checkboxes.
      clickingRange = true;
      try {
        for (const row of rows) if (row.checkbox.checked) row.checkbox.click();
      } finally {
        clickingRange = false;
      }
      if (this.ui.showHidden || !this.root) {
        commit();
        return;
      }
      // The class goes on the lines already on screen, so the transition runs;
      // a redraw in between keeps them faded through `leaving`.
      for (const signature of signatures) this.leaving.add(signature);
      for (const node of this.body.children) {
        if (signatures.includes(node.dataset.signature)) node.classList.add('leaving');
      }
      setTimeout(commit, 140);
    },

    unhide(row) {
      const signature = EBS.rowSignature(row);
      this.prefs.hidden = this.prefs.hidden.filter((item) => item !== signature);
      this.savePrefs();
      this.draw();
    },

    // "+ Nieuwe groep" and "Naam wijzigen": one field that stays in the page
    // while it is open, so typing in it survives every redraw.
    buildGroupEditor() {
      const wrap = el('span', 'ebs-tab-new');
      const start = el('button', 'ebs-tab-add', '+ Nieuwe groep');
      start.type = 'button';
      start.addEventListener('click', () => this.openEditor('new'));
      const form = el('form', 'ebs-tab-form');
      const input = el('input');
      input.maxLength = 40;
      const save = el('button', 'ebs-tab-save', 'Opslaan');
      save.type = 'submit';
      const cancel = el('button', 'ebs-tab-cancel', 'Annuleren');
      cancel.type = 'button';
      const error = el('span', 'ebs-tab-error');
      error.setAttribute('role', 'alert');
      form.append(input, save, cancel, error);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        this.submitEditor();
      });
      cancel.addEventListener('click', () => this.closeEditor());
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          this.closeEditor();
        }
      });
      input.addEventListener('input', () => { error.textContent = ''; });
      wrap.append(start, form);
      this.editor = { mode: null, start, form, input, error };
      return wrap;
    },

    openEditor(mode) {
      const { input, error } = this.editor;
      this.editor.mode = mode;
      // The group being renamed, fixed now: clicking another tab meanwhile
      // must not rename that one.
      this.editor.target = mode === 'rename' ? this.ui.group : null;
      error.textContent = '';
      input.value = mode === 'rename' ? this.ui.group ?? '' : '';
      input.placeholder = mode === 'rename' ? 'Nieuwe naam' : 'Naam van de groep';
      input.setAttribute('aria-label', mode === 'rename' ? `Nieuwe naam voor groep ${this.ui.group}` : 'Naam van de nieuwe groep');
      this.draw();
      input.focus();
      input.select();
    },

    closeEditor() {
      const wasOpen = Boolean(this.editor.mode);
      this.editor.mode = null;
      this.draw();
      if (wasOpen) this.editor.start.focus();
    },

    submitEditor() {
      const { input, error } = this.editor;
      const name = input.value.trim();
      if (!name) {
        error.textContent = 'Vul een naam in.';
        input.focus();
        return;
      }
      if (this.editor.mode === 'rename') {
        const target = this.editor.target;
        if (name === target || !this.prefs.groups.includes(target)) {
          this.closeEditor();
          return;
        }
        const next = EBS.renameGroup(this.prefs.groups, this.prefs.groupOf, target, name);
        if (!next.renamed) {
          error.textContent = 'Die naam bestaat al.';
          input.focus();
          return;
        }
        this.prefs.groups = next.groups;
        this.prefs.groupOf = next.groupOf;
        if (this.ui.group === target) this.ui.group = name;
        this.savePrefs();
      } else {
        if (this.prefs.groups.includes(name)) {
          error.textContent = 'Die naam bestaat al.';
          input.focus();
          return;
        }
        this.prefs.groups = [...this.prefs.groups, name];
        this.ui.group = name;
        this.savePrefs();
      }
      this.closeEditor();
    },

    addGroup(name) {
      if (!this.prefs.groups.includes(name)) this.prefs.groups = [...this.prefs.groups, name];
      this.savePrefs();
      this.draw();
    },

    removeGroup(name) {
      this.prefs.groups = this.prefs.groups.filter((group) => group !== name);
      this.prefs.groupOf = Object.fromEntries(Object.entries(this.prefs.groupOf).filter(([, group]) => group !== name));
      if (this.ui.group === name) this.ui.group = null;
      this.savePrefs();
      this.draw();
    },

    assign(rows, name) {
      this.prefs.groupOf = EBS.assignGroup(this.prefs.groupOf, rows.map((row) => EBS.rowSignature(row)), name);
      this.savePrefs();
      this.draw();
    },
  };

  // The way back on the classic screen, in e-Boekhouden's own link style, at
  // the spot where the new view has "Klassieke weergave".
  const backToBetter = {
    node: null,
    mount(grid) {
      if (!this.node) {
        this.node = el('div', 'ebs-native-toggle');
        const link = el('a', '', 'Nieuwe weergave');
        link.href = '#';
        link.setAttribute('role', 'button');
        link.addEventListener('click', (event) => {
          event.preventDefault();
          setClassic(false);
        });
        this.node.append(link);
      }
      if (this.node.nextElementSibling !== grid) grid.before(this.node);
    },
    unmount() {
      this.node?.remove();
    },
  };

  // Tooltips: a short fade for the first one, then instant while moving
  // across the buttons.
  const tooltip = {
    node: null,
    lastHidden: 0,
    show(anchorNode, text) {
      this.hide();
      this.node = el('span', 'ebs-tooltip', text);
      this.node.setAttribute('role', 'tooltip');
      if (Date.now() - this.lastHidden < 300) this.node.classList.add('instant');
      anchorNode.append(this.node);
    },
    hide() {
      if (!this.node) return;
      this.node.remove();
      this.node = null;
      this.lastHidden = Date.now();
    },
  };

  // -------------------------------------------------------------------------
  // Mutation dialog: e-Boekhouden's own "Handmatig invoeren" page for one row.
  // -------------------------------------------------------------------------

  // The shared dialog (dialog.js) does the frame, the motion, Escape, the
  // focus trap and the inert page; this part fills it for one row and listens
  // to the import page inside it.
  const dialog = {
    handle: null,
    open(row, signature = EBS.rowSignature(row)) {
      this.close(true);
      const opener = document.activeElement;
      const amount = Number.isFinite(row.amount) ? `${row.amount > 0 ? '+' : '−'} € ${EBS.formatMoney(Math.abs(row.amount))}` : row.amountText;
      const url = `${location.origin}${location.pathname}${location.search}${EDIT_HASH}${encodeURIComponent(signature)}`;
      const newTab = el('a', 'ebs-dialog-link', 'Openen in nieuw tabblad');
      newTab.href = url;
      newTab.target = '_blank';
      newTab.rel = 'noopener';
      newTab.addEventListener('click', () => this.close());
      const note = el('span', '', 'Na opslaan sluit dit venster en wordt de lijst ververst.');
      note.setAttribute('role', 'status');
      const done = el('button', 'ebs-dialog-button', 'Sluiten');
      done.type = 'button';
      done.addEventListener('click', () => this.close());

      let handle = null;
      const onMessage = (event) => {
        if (!handle || event.origin !== location.origin || event.source !== handle.frame.contentWindow) return;
        const kind = event.data?.ebs;
        if (kind === 'edit-done') {
          this.close();
          location.reload();
        }
        if (kind === 'edit-escape') this.close();
        if (kind === 'edit-opened') handle.setReady();
        if (kind === 'edit-missing') handle.setError('Deze regel staat niet meer in de lijst. Sluit het venster en probeer het opnieuw.');
        if (kind === 'edit-failed') handle.setError('Het mutatiescherm van e-Boekhouden opende niet. Sluit het venster en probeer het opnieuw.');
      };
      handle = EBS.dialog.open({
        title: 'Mutatie aanmaken',
        subtitle: [row.party ?? row.description, amount, row.bookDate].filter(Boolean).join(' · '),
        src: url,
        frameTitle: 'Mutatie aanmaken',
        // Covers the frame while it loads the list and opens the line, so the
        // list never shows inside the dialog.
        loading: 'Het mutatiescherm wordt geopend…',
        ready: 'manual',
        width: 1040,
        height: 760,
        actions: [newTab],
        footer: [note, done],
        // Back to the button or line the dialog came from, also after a redraw.
        returnFocus: () => (opener?.isConnected && opener !== document.body ? opener
          : [...(better.body?.children ?? [])].find((node) => node.dataset.signature === signature)?.querySelector('[data-control="book"]')),
        onClose: () => {
          window.removeEventListener('message', onMessage);
          if (this.handle === handle) this.handle = null;
        },
      });
      window.addEventListener('message', onMessage);
      this.handle = handle;
    },
    close(immediate = false) {
      this.handle?.close({ immediate: immediate || !better.root });
    },
  };

  // -------------------------------------------------------------------------
  // The page inside the dialog (or in its own tab, "Openen in nieuw tabblad").
  // -------------------------------------------------------------------------

  function runEditFrame(signature, framed) {
    const tell = (ebs) => {
      if (framed) parent.postMessage({ ebs }, location.origin);
    };
    if (framed) {
      const style = document.createElement('style');
      // Only the page content: the shell's header and menus are already around the dialog.
      // The page itself is projected inside app-site-navigation(-b) (#navBody), so hide the
      // header and sidebar within it and shrink their grid tracks to nothing. The grid has
      // to stay: the page's layout fills #navBody with an absolutely positioned body, and
      // without the grid #navBody has no height, which showed the dialog empty.
      style.textContent = `
        app-eb-header, app-header-identity, app-header-identity-b, app-notification-bar,
        :is(app-site-navigation, app-site-navigation-b) :is(#navHeader, #navSidebar, .sidebar-menu-overlay) { display: none !important; }
        :is(app-site-navigation, app-site-navigation-b) .nav { grid-template-columns: 0 1fr !important; grid-template-rows: 0 1fr !important; }
      `;
      document.documentElement.append(style);
      // Esc in the page closes the dialog too, unless the page used it (a dropdown).
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) tell('edit-escape');
      });
    }

    // find     wait for the grid; the line on this page: click its "Handmatig
    //          invoeren"; not on it: "Volgende" (e-Boekhouden shows 100 per page)
    // paging   wait until the next page has replaced the lines
    // opening  wait until e-Boekhouden has left the list for the mutation page
    // editing  back on the list: saved or cancelled
    let phase = 'find';
    let since = Date.now();
    let seen = null;
    let pages = 0;
    const to = (next) => {
      phase = next;
      since = Date.now();
    };
    const stop = (message) => {
      clearInterval(tick);
      if (message) tell(message);
    };
    const firstLine = (rows) => (rows.length ? EBS.rowSignature(rows[0]) : '');
    const tick = setInterval(() => {
      const waited = Date.now() - since;
      if (phase === 'find' || phase === 'paging') {
        const grid = PAGE.test(location.pathname) ? findGrid() : null;
        const rows = grid ? readRows(grid) : [];
        if (phase === 'paging') {
          if (firstLine(rows) && firstLine(rows) !== seen) to('find');
          else if (waited > 10000) stop('edit-missing');
          return;
        }
        // The same lines twice in a row: the grid has settled.
        const key = `${rows.length}|${firstLine(rows)}`;
        const settled = rows.length > 0 && key === seen;
        seen = key;
        const row = rows.find((item) => EBS.rowSignature(item) === signature);
        if (row?.edit) {
          row.edit.click();
          if (!framed) history.replaceState(history.state, '', location.href.replace(/#.*$/, ''));
          to('opening');
          return;
        }
        if (row && settled) {
          stop('edit-missing');
          return;
        }
        const next = grid && [...grid.querySelectorAll('app-pagination .pagination li')].find((li) => /volgende/i.test(li.textContent));
        if (settled && next && !next.classList.contains('disabled') && pages < 50) {
          pages += 1;
          seen = firstLine(rows);
          next.click();
          to('paging');
          return;
        }
        if ((settled && !rows.length) || (settled && !next) || (settled && next?.classList.contains('disabled')) || waited > 15000) stop('edit-missing');
        return;
      }
      if (phase === 'opening') {
        if (!PAGE.test(location.pathname)) {
          to('editing');
          tell('edit-opened');
        }
        else if (waited > 10000) stop('edit-failed');
        return;
      }
      // editing
      if (PAGE.test(location.pathname)) stop(framed ? 'edit-done' : null);
    }, 250);
  }

  // -------------------------------------------------------------------------
  // Styles. Classic screens get no animation; Better design gets the ones from
  // the approved list, all on transform and opacity, with reduced-motion fallbacks.
  // -------------------------------------------------------------------------

  function injectStyle() {
    const style = document.createElement('style');
    style.id = 'ebs-import-style';
    style.textContent = IMPORT_CSS;
    document.documentElement.append(style);
  }

  const IMPORT_CSS = `
    app-grid-body table.grid tbody tr.ebs-range { background: #f3f6fd !important; }

    .ebs-bar { position: fixed; left: 50%; bottom: 24px; z-index: 2147483000; display: flex; align-items: center; gap: 14px; padding: 10px 10px 10px 20px; border-radius: 14px; background: #232c4f; color: #fff; font-family: Ubuntu, system-ui, sans-serif; box-shadow: 0 18px 44px rgba(20, 26, 48, .35); transform: translateX(-50%); visibility: hidden; }
    .ebs-bar.show { visibility: visible; }
    .ebs-bar-summary { display: flex; flex-direction: column; gap: 2px; min-width: 160px; }
    .ebs-bar-count { font-size: 14px; font-weight: 700; }
    .ebs-bar-total { font-size: 12px; color: #c4cae0; font-variant-numeric: tabular-nums; }
    .ebs-bar-divider { width: 1px; height: 32px; background: rgba(255, 255, 255, .2); }
    .ebs-bar-buttons { display: flex; align-items: center; gap: 8px; position: relative; }
    .ebs-bar-button { height: 40px; padding: 0 14px; border-radius: 9px; font: 500 14px Ubuntu, system-ui, sans-serif; white-space: nowrap; cursor: pointer; }
    .ebs-bar-button.primary { border: 0; background: #5d9e35; color: #fff; font-weight: 700; }
    .ebs-bar-button.ghost { border: 1px solid rgba(255, 255, 255, .35); background: transparent; color: #fff; }
    .ebs-bar-button.quiet { border: 0; background: transparent; color: #c4cae0; }
    .ebs-bar-button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .ebs-group-wrap { position: relative; display: flex; }
    .ebs-bar-button:disabled { opacity: .5; cursor: default; }
    .ebs-bar-message { max-width: 260px; font-size: 12px; line-height: 16px; color: #ffd8d3; }
    .ebs-bar-spacer { height: 96px; }
    .ebs-group-menu { position: absolute; bottom: calc(100% + 8px); left: 0; min-width: 220px; padding: 6px; display: flex; flex-direction: column; background: #fff; color: #232c4f; border-radius: 10px; box-shadow: 0 12px 32px rgba(20, 26, 48, .25); }
    .ebs-group-item { height: 36px; padding: 0 10px; border: 0; border-radius: 6px; background: #fff; color: #232c4f; text-align: left; font: 13px Ubuntu, system-ui, sans-serif; cursor: pointer; }
    .ebs-group-item:hover, .ebs-group-item:focus-visible { background: #f3f5fa; }
    .ebs-group-new input { box-sizing: border-box; width: 100%; height: 34px; margin-top: 4px; padding: 0 10px; border: 1px solid #d6dbe8; border-radius: 6px; font: 13px Ubuntu, system-ui, sans-serif; }

    /* Better design: hide the native table, keep pagination and the native machinery. */
    html.ebs-better-import app-grid[data-ebs-import] :is(app-grid-header, app-grid-body, app-grid-bulk-actions) { display: none !important; }
    /* The page has no content padding of its own (the native grid insets itself), so the view and the
       remaining footer share one gutter. The footer only holds pagination now: without pages
       (app-pagination renders no div) it would be an empty white bar. */
    html.ebs-better-import app-grid[data-ebs-import] { display: block; width: auto !important; margin: 0 32px 16px; }
    html.ebs-better-import app-grid[data-ebs-import] app-grid-footer:not(:has(app-pagination > div)) { display: none !important; }
    html.ebs-better-import app-grid[data-ebs-import] app-grid-footer .grid-footer { padding: 0 !important; background: transparent !important; overflow: visible !important; }
    .ebs-native-toggle { width: 93%; margin: 0 0 6px; text-align: right; font-size: 13px; }
    .ebs-native-toggle a { color: var(--colorPrimary, #30395f); text-decoration: underline; cursor: pointer; }
    .ebs-import { box-sizing: border-box; margin: 24px 32px 16px; font-family: Ubuntu, system-ui, sans-serif; color: #232c4f; display: flex; flex-direction: column; gap: 14px; }
    .ebs-import button { font-family: inherit; }
    .ebs-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
    .ebs-titles { display: flex; flex-direction: column; gap: 4px; }
    .ebs-titles h1 { margin: 0; font-size: 22px; font-weight: 700; }
    .ebs-subtitle, .ebs-muted { font-size: 13px; color: #5d6584; }
    .ebs-link { border: 0; background: none; padding: 0; font-size: 13px; color: #232c4f; text-decoration: underline; cursor: pointer; }
    .ebs-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .ebs-card { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border-radius: 12px; background: #fff; }
    .ebs-card-label, .ebs-card-sub { font-size: 12px; color: #5d6584; }
    .ebs-card-value { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .ebs-card-value.in { color: #2f6f1a; }
    .ebs-panel { background: #fff; border-radius: 12px; }
    .ebs-tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 10px 14px 0; border-bottom: 1px solid #e6e9f1; }
    .ebs-tab { height: 36px; padding: 0 12px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: #5d6584; font-size: 13px; cursor: pointer; }
    .ebs-tab.on { border-bottom-color: #232c4f; color: #232c4f; font-weight: 700; }
    .ebs-tab-list, .ebs-tab-actions { display: contents; }
    .ebs-tab-action { height: 30px; margin-left: 4px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: #8c93ab; font-size: 12px; cursor: pointer; }
    .ebs-tab-action:hover, .ebs-tab-action:focus-visible { color: #232c4f; background: #f3f5fa; }
    .ebs-tab-new { display: inline-flex; align-items: center; }
    .ebs-tab-add { height: 36px; padding: 0 12px; border: 0; background: transparent; color: #5d6584; font-size: 13px; cursor: pointer; }
    .ebs-tab-add:hover, .ebs-tab-add:focus-visible { color: #232c4f; }
    .ebs-tab-form { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 4px 4px; }
    .ebs-tab-form[hidden], .ebs-tab-add[hidden] { display: none; }
    .ebs-tab-form input { height: 30px; width: 170px; padding: 0 10px; border: 1px solid #c5cbdc; border-radius: 6px; font: 13px Ubuntu, system-ui, sans-serif; color: #232c4f; }
    .ebs-tab-form input:focus { outline: 2px solid #596aaf; outline-offset: 0; border-color: #596aaf; }
    .ebs-tab-save { height: 30px; padding: 0 12px; border: 0; border-radius: 6px; background: #232c4f; color: #fff; font-size: 13px; font-weight: 500; cursor: pointer; }
    .ebs-tab-cancel { height: 30px; padding: 0 8px; border: 0; background: transparent; color: #5d6584; font-size: 13px; cursor: pointer; }
    .ebs-tab-error { font-size: 12px; color: #b42318; }
    .ebs-tab-error:empty { display: none; }
    .ebs-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #e6e9f1; }
    .ebs-search { flex: 1 1 260px; display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; border: 1px solid #d6dbe8; border-radius: 9px; color: #5d6584; }
    .ebs-search input { flex: 1; border: 0; outline: none; background: transparent; font: 13px Ubuntu, system-ui, sans-serif; color: #232c4f; }
    .ebs-chips { display: flex; gap: 6px; }
    .ebs-chip { height: 36px; padding: 0 14px; border: 1px solid #d6dbe8; border-radius: 18px; background: #fff; color: #232c4f; font-size: 13px; cursor: pointer; }
    .ebs-chip.on { border-color: #232c4f; background: #232c4f; color: #fff; font-weight: 500; }
    .ebs-select { display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 6px 0 12px; border: 1px solid #d6dbe8; border-radius: 18px; font-size: 13px; }
    .ebs-select > span { color: #5d6584; }
    .ebs-select select { border: 0; background: transparent; font: 13px Ubuntu, system-ui, sans-serif; color: #232c4f; }
    .ebs-hidden-toggle { height: 36px; padding: 0 14px; border: 1px dashed #b9c0d4; border-radius: 18px; background: #fff; color: #3a4677; font-size: 13px; cursor: pointer; }
    .ebs-hidden-toggle.on { background: #eef1f8; }
    .ebs-row { display: grid; grid-template-columns: 44px 150px minmax(0, 1.2fr) minmax(0, 1.6fr) 130px 170px; align-items: center; min-height: 54px; padding: 0 14px; border-bottom: 1px solid #eef0f5; background: #fff; cursor: pointer; }
    .ebs-row:hover { background: #fafbfd; }
    .ebs-row.checked { background: #e8eefb; }
    .ebs-row.is-hidden { opacity: .55; background: #fafafa; }
    .ebs-row.ebs-range { background: #f3f6fd; }
    .ebs-row.anchor { box-shadow: inset 3px 0 0 #232c4f; }
    .ebs-row-head { min-height: 38px; font-size: 12px; color: #5d6584; background: #f7f8fb; cursor: default; }
    .ebs-row-head:hover { background: #f7f8fb; }
    .ebs-row-head span:nth-child(5) { text-align: right; }
    .ebs-check { width: 18px; height: 18px; padding: 0; border: 1.5px solid #8c93ab; border-radius: 4px; background: #fff; color: #fff; font-size: 12px; line-height: 14px; cursor: pointer; }
    .ebs-row.checked .ebs-check { border-color: #232c4f; background: #232c4f; }
    .ebs-check:focus-visible, .ebs-action:focus-visible, .ebs-chip:focus-visible, .ebs-tab:focus-visible { outline: 2px solid #232c4f; outline-offset: 2px; }
    .ebs-date, .ebs-party { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: 13px; }
    .ebs-date .ebs-muted, .ebs-party .ebs-muted { font-size: 11px; color: #6b7290; white-space: nowrap; }
    .ebs-party-line { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .ebs-party-name { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ebs-group-chip { flex: none; padding: 2px 8px; border-radius: 10px; background: #eef1f8; font-size: 11px; color: #3a4677; }
    .ebs-description { padding-right: 16px; font-size: 13px; color: #4a5272; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ebs-amount { text-align: right; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .ebs-amount.in { color: #2f6f1a; }
    .ebs-actions { display: flex; justify-content: flex-end; gap: 4px; }
    .ebs-action-wrap { position: relative; display: flex; }
    .ebs-action { width: 34px; height: 34px; border: 0; border-radius: 7px; background: #f3f5fa; color: #232c4f; font-size: 15px; cursor: pointer; }
    .ebs-action.book { background: #f1f7ec; color: #2f6f1a; }
    .ebs-action.delete { background: transparent; color: #8c93ab; }
    .ebs-action:disabled { opacity: .35; cursor: default; }
    .ebs-tooltip { position: absolute; bottom: calc(100% + 6px); right: 0; z-index: 3; padding: 6px 10px; border-radius: 6px; background: #1b2240; color: #fff; font-size: 12px; white-space: nowrap; box-shadow: 0 4px 12px rgba(20, 26, 48, .25); pointer-events: none; animation: ebs-tip 120ms ease-out; }
    .ebs-tooltip.instant { animation: none; }
    .ebs-empty { padding: 24px 14px; font-size: 13px; color: #5d6584; }
    .ebs-footer { padding: 12px 14px; border-top: 1px solid #e6e9f1; font-size: 13px; color: #5d6584; }

    /* Better design motion (the approved list). */
    .ebs-bar.better { opacity: 0; transform: translate(-50%, 16px); transition: opacity 150ms ease-in, transform 150ms ease-in, visibility 0s linear 150ms; }
    .ebs-bar.better.show { opacity: 1; transform: translate(-50%, 0); transition: opacity 200ms cubic-bezier(0.23, 1, 0.32, 1), transform 200ms cubic-bezier(0.23, 1, 0.32, 1), visibility 0s; }
    .ebs-bar.better .ebs-group-menu { transform-origin: bottom left; animation: ebs-menu 150ms cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-bar.better .ebs-group-menu.closing { opacity: 0; transform: scale(0.96); transition: opacity 100ms ease-in, transform 100ms ease-in; pointer-events: none; }
    .ebs-bar.better .ebs-bar-button { transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-bar.better .ebs-bar-button:active { transform: scale(0.97); }
    .ebs-row.leaving { opacity: 0; transform: translateX(8px); transition: opacity 140ms cubic-bezier(0.23, 1, 0.32, 1), transform 140ms cubic-bezier(0.23, 1, 0.32, 1); }
    @keyframes ebs-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes ebs-menu { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: none; } }
    @keyframes ebs-tip { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .ebs-bar.better, .ebs-bar.better.show { transform: translate(-50%, 0); }
      .ebs-bar.better.show { transition: opacity 150ms ease-out, visibility 0s; }
      .ebs-bar.better .ebs-group-menu { animation: ebs-fade 120ms ease-out; }
      .ebs-bar.better .ebs-group-menu.closing { transform: none; }
      .ebs-row.leaving { transform: none; }
      .ebs-bar.better .ebs-bar-button:active { transform: none; }
    }
  `;

  // Started last, once every declaration in this file exists.
  function start() {
    injectStyle();
    // The old one-way switch of 0.2.0 lived in sessionStorage.
    sessionStorage.removeItem('ebs-import-classic');
    chrome.storage.local.get(['settings', 'classicScreens']).then(({ settings: stored, classicScreens: storedClassic }) => {
      settings = EBS.settingsWithDefaults(stored);
      classicScreens = storedClassic ?? {};
      settingsLoaded = true;
      applyBetterClass();
      schedule();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(changes.settings || changes.classicScreens)) return;
      if (changes.settings) settings = EBS.settingsWithDefaults(changes.settings.newValue);
      if (changes.classicScreens) classicScreens = changes.classicScreens.newValue ?? {};
      applyBetterClass();
      schedule();
    });
    // Our own drawing must not wake the loop, or it would redraw forever.
    // A change inside a subtree that is already gone (a tooltip removed from a
    // row that a redraw replaced) says nothing about the page either.
    const OURS = '.ebs-import, .ebs-native-toggle, .ebs-bar, .ebs-bar-spacer, .ebs-dialog-backdrop, #ebs-import-style, #ebs-dialog-style';
    new MutationObserver((records) => {
      const native = records.some((record) => {
        const node = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
        return Boolean(node?.isConnected) && !node.closest(OURS);
      });
      if (native) schedule();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    document.addEventListener('change', schedule, true);
    // Letting go of shift ends the range preview in the new view.
    document.addEventListener('keyup', (event) => {
      if (event.key === 'Shift' && better.preview && better.root) {
        better.preview = null;
        better.paintPreview();
      }
    });
    let lastPath = location.pathname;
    const watch = setInterval(() => {
      // The extension was reloaded: this copy of the script is orphaned.
      if (!chrome.runtime?.id) {
        clearInterval(watch);
        return;
      }
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      anchor = null;
      better.anchor = null;
      applyBetterClass();
      schedule();
    }, 300);
  }

  start();
})();
