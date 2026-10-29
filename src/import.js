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
  const EDIT_HASH = '#ebs-edit=';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function send(message) {
    return chrome.runtime.sendMessage(message).catch(() => ({}));
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // -------------------------------------------------------------------------
  // Inside the mutation dialog: the import page loaded again in an iframe. It
  // opens the row's own "Handmatig invoeren" page, and tells the dialog when
  // e-Boekhouden comes back to the import list (after saving or cancelling).
  // -------------------------------------------------------------------------

  if (window !== window.top && location.hash.startsWith(EDIT_HASH)) {
    runEditFrame(decodeURIComponent(location.hash.slice(EDIT_HASH.length)));
    return;
  }

  let settings = EBS.settingsWithDefaults();
  let settingsLoaded = false;

  function onImportPage() {
    return PAGE.test(location.pathname);
  }

  function useBetter() {
    return settings.betterDesign && onImportPage() && sessionStorage.getItem('ebs-import-classic') !== '1';
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
    return rows;
  }

  function bulkAction(grid, word) {
    return [...grid.querySelectorAll('app-grid-bulk-action li')].find((li) => li.textContent.toLowerCase().includes(word)) ?? null;
  }

  // -------------------------------------------------------------------------
  // Shift-select on the native checkboxes (and on ours, which mirror them)
  // -------------------------------------------------------------------------

  let anchor = null;
  let clickingRange = false;

  // After the native click on `target` has toggled it, give the whole range the
  // anchor's state by clicking the checkboxes that differ. Angular registers
  // each click as a selection, exactly as if they were clicked one by one.
  function applyRange(rows, target) {
    const toggles = EBS.rangeToggles(rows.map((row) => row.checkbox.checked), anchor, target);
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
    if (event.shiftKey && settings.shiftSelect && anchor !== null && anchor < rows.length) {
      // Let the native handler toggle the clicked box first.
      setTimeout(() => {
        applyRange(readRows(grid), index);
        anchor = index;
        schedule();
      });
      return;
    }
    anchor = index;
  }, true);

  // Shift held over a row: show which range a shift-click would touch.
  document.addEventListener('mousemove', (event) => {
    if (!settings.shiftSelect || !onImportPage() || useBetter()) return;
    const grid = findGrid();
    if (!grid) return;
    const tr = event.target instanceof Element ? event.target.closest('app-grid-body table.grid tbody tr') : null;
    const rows = readRows(grid);
    const over = tr ? rows.findIndex((row) => row.tr === tr) : -1;
    for (const row of rows) {
      const inRange = event.shiftKey && anchor !== null && over >= 0 && row.index >= Math.min(anchor, over) && row.index <= Math.max(anchor, over);
      row.tr.classList.toggle('ebs-range', inRange && !row.checkbox.checked);
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
    if (!grid) {
      bar.hide();
      better.unmount();
      return;
    }
    const rows = readRows(grid);
    if (useBetter()) {
      better.mount(grid, rows);
    } else {
      better.unmount();
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
    },

    hide() {
      this.host?.classList.remove('show');
      this.closeGroupMenu();
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
        this.buttons.dataset.mode = mode;
        this.buttons.replaceChildren();
        const button = (label, className, onClick) => {
          const node = el('button', `ebs-bar-button ${className}`, label);
          node.type = 'button';
          node.addEventListener('click', onClick);
          this.buttons.append(node);
          return node;
        };
        button('Wegboeken', 'primary', () => bulkAction(findGrid(), 'wegboeken')?.click());
        if (mode === 'better') {
          const groupButton = button('Aan groep toevoegen ▾', 'ghost', () => this.toggleGroupMenu(groupButton));
          groupButton.setAttribute('aria-haspopup', 'menu');
          button('Verbergen', 'ghost', () => better.hideRows(readRows(findGrid()).filter((row) => row.checkbox.checked)));
        }
        button('Verwijderen', 'ghost', () => bulkAction(findGrid(), 'verwijderen')?.click());
        button('Selectie wissen', 'quiet', () => {
          clickingRange = true;
          try {
            for (const row of readRows(findGrid())) if (row.checkbox.checked) row.checkbox.click();
          } finally {
            clickingRange = false;
          }
          anchor = null;
          schedule();
        });
      }
      // A class change, so a quick select and clear reverses mid-way.
      requestAnimationFrame(() => this.host.classList.add('show'));
    },

    toggleGroupMenu(anchorButton) {
      if (this.groupMenu) {
        this.closeGroupMenu();
        return;
      }
      anchorButton.setAttribute('aria-expanded', 'true');
      const menu = el('div', 'ebs-group-menu');
      menu.setAttribute('role', 'menu');
      const selected = () => readRows(findGrid()).filter((row) => row.checkbox.checked);
      for (const name of better.prefs.groups) {
        const item = el('button', 'ebs-group-item', name);
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.addEventListener('click', () => {
          better.assign(selected(), name);
          this.closeGroupMenu();
        });
        menu.append(item);
      }
      if (selected().some((row) => better.prefs.groupOf[EBS.rowSignature(row)])) {
        const out = el('button', 'ebs-group-item', 'Uit groep halen');
        out.type = 'button';
        out.setAttribute('role', 'menuitem');
        out.addEventListener('click', () => {
          better.assign(selected(), null);
          this.closeGroupMenu();
        });
        menu.append(out);
      }
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
      document.addEventListener('mousedown', this.onOutside, true);
    },

    closeGroupMenu() {
      if (!this.groupMenu) return;
      this.groupMenu.anchorButton.setAttribute('aria-expanded', 'false');
      this.groupMenu.menu.remove();
      this.groupMenu = null;
      document.removeEventListener('mousedown', this.onOutside, true);
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
    prefsKey: null,
    ui: { query: '', direction: 'all', period: 'all', size: 'all', showHidden: false, group: null },
    leaving: new Set(),

    async loadPrefs() {
      const number = document.querySelector('app-header-identity-b .administratieId, app-header-identity #administratieId')?.textContent.trim();
      const key = `import:${/^\d+$/.test(number ?? '') ? number : 'default'}`;
      if (key === this.prefsKey) return;
      this.prefsKey = key;
      const { [key]: stored } = await chrome.storage.local.get(key);
      this.prefs = { hidden: [], groups: [], groupOf: {}, ...(stored ?? {}) };
      schedule();
    },

    savePrefs() {
      if (this.prefsKey) chrome.storage.local.set({ [this.prefsKey]: this.prefs });
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
      classic.addEventListener('click', () => {
        sessionStorage.setItem('ebs-import-classic', '1');
        applyBetterClass();
        schedule();
      });
      head.append(titles, classic);

      this.cards = el('div', 'ebs-cards');

      const panel = el('div', 'ebs-panel');
      this.tabs = el('div', 'ebs-tabs');
      this.tabs.setAttribute('role', 'tablist');
      this.tabs.setAttribute('aria-label', 'Groepen');

      const filters = el('div', 'ebs-filters');
      const search = el('label', 'ebs-search');
      search.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>';
      this.searchInput = el('input');
      this.searchInput.type = 'search';
      this.searchInput.placeholder = 'Zoek in alle kolommen: omschrijving, rekening, datum, bedrag';
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

    draw() {
      if (!this.root) return;
      const all = this.rows;
      const visible = this.visibleRows();
      const summary = EBS.summarize(visible);
      const hiddenCount = all.filter((row) => this.prefs.hidden.includes(EBS.rowSignature(row))).length;
      const total = /\((\d+) regels?\)/.exec(this.grid.querySelector('.grid-header-title')?.textContent ?? '')?.[1];
      const account = [...new Set(all.map((row) => row.account).filter(Boolean))];
      this.subtitle.textContent = `${total ?? all.length} regels uit de import${account.length === 1 ? ` · rekening ${account[0]}` : ''}`;

      this.cards.replaceChildren(
        this.card('Binnengekomen (in beeld)', `€ ${EBS.formatMoney(summary.inTotal)}`, `${summary.inCount} ${summary.inCount === 1 ? 'regel' : 'regels'}`, 'in'),
        this.card('Uitgegaan (in beeld)', `€ ${EBS.formatMoney(summary.outTotal)}`, `${summary.outCount} ${summary.outCount === 1 ? 'regel' : 'regels'}`),
        this.card('Oudste regel', summary.oldest ? `${summary.oldest.day} ${EBS.monthLabel(summary.oldest.key)}` : 'Geen', summary.oldest ? `${Math.max(0, Math.floor((Date.now() - summary.oldest.time) / 86400000))} dagen niet verwerkt` : ''),
      );

      // Group tabs.
      const counts = EBS.groupCounts(this.prefs.groupOf, this.prefs.groups);
      this.tabs.replaceChildren();
      const tab = (label, name) => {
        const button = el('button', `ebs-tab${this.ui.group === name ? ' on' : ''}`, label);
        button.type = 'button';
        button.setAttribute('role', 'tab');
        button.setAttribute('aria-selected', String(this.ui.group === name));
        button.addEventListener('click', () => {
          this.ui.group = name;
          this.draw();
        });
        this.tabs.append(button);
      };
      tab('Alle regels', null);
      for (const name of this.prefs.groups) tab(`${name} · ${counts[name] ?? 0}`, name);
      if (this.ui.group) {
        const remove = el('button', 'ebs-tab-remove', `Groep "${this.ui.group}" verwijderen`);
        remove.type = 'button';
        remove.addEventListener('click', () => this.removeGroup(this.ui.group));
        this.tabs.append(remove);
      }
      const add = el('form', 'ebs-tab-new');
      const input = el('input');
      input.placeholder = '+ Nieuwe groep';
      input.setAttribute('aria-label', 'Nieuwe groep');
      input.maxLength = 40;
      add.append(input);
      add.addEventListener('submit', (event) => {
        event.preventDefault();
        const name = input.value.trim();
        if (name) this.addGroup(name);
      });
      this.tabs.append(add);

      // Filters.
      this.directionChips.replaceChildren();
      for (const [value, label] of [['all', 'Alles'], ['in', 'Bij'], ['out', 'Af']]) {
        const chip = el('button', `ebs-chip${this.ui.direction === value ? ' on' : ''}`, label);
        chip.type = 'button';
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

      this.drawRows(visible);
      this.footer.textContent = `${visible.length} ${visible.length === 1 ? 'regel' : 'regels'} in beeld · ${hiddenCount} verborgen · ${total ?? all.length} in totaal`;
    },

    card(label, value, sub, tone) {
      const card = el('div', 'ebs-card');
      card.append(el('span', 'ebs-card-label', label), el('span', `ebs-card-value${tone ? ` ${tone}` : ''}`, value), el('span', 'ebs-card-sub', sub));
      return card;
    },

    drawRows(visible) {
      // FLIP: remember where rows were, so rows that move after a hide slide
      // into place instead of jumping.
      const before = new Map([...this.body.children].map((node) => [node.dataset.signature, node.getBoundingClientRect().top]));
      this.body.replaceChildren();
      const visibleRows = visible;
      for (const row of visibleRows) this.body.append(this.rowElement(row, visibleRows));
      if (!visibleRows.length) this.body.append(el('div', 'ebs-empty', 'Geen regels die passen bij je zoekopdracht of filters.'));
      if (reducedMotion.matches) return;
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

    rowElement(row, visibleRows) {
      const signature = EBS.rowSignature(row);
      const isHidden = this.prefs.hidden.includes(signature);
      const group = this.prefs.groupOf[signature];
      const node = el('div', `ebs-row${row.checkbox.checked ? ' checked' : ''}${isHidden ? ' is-hidden' : ''}${this.leaving.has(signature) ? ' leaving' : ''}`);
      node.dataset.signature = signature;

      const box = el('button', 'ebs-check');
      box.type = 'button';
      box.setAttribute('role', 'checkbox');
      box.setAttribute('aria-checked', String(row.checkbox.checked));
      box.setAttribute('aria-label', 'Regel selecteren');
      box.textContent = row.checkbox.checked ? '✓' : '';
      box.addEventListener('click', (event) => {
        event.stopPropagation();
        const position = visibleRows.indexOf(row);
        const shiftRange = event.shiftKey && settings.shiftSelect && this.anchor !== undefined && this.anchor !== null && visibleRows[this.anchor];
        row.checkbox.click();
        if (shiftRange) {
          const toggles = EBS.rangeToggles(visibleRows.map((item) => item.checkbox.checked), this.anchor, position);
          clickingRange = true;
          try {
            for (const index of toggles) visibleRows[index].checkbox.click();
          } finally {
            clickingRange = false;
          }
        }
        this.anchor = position;
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

      const amount = el('span', `ebs-amount${row.amount > 0 ? ' in' : ''}`, Number.isFinite(row.amount) ? `${row.amount > 0 ? '+' : '−'} ${EBS.formatMoney(Math.abs(row.amount))}` : row.amountText);

      const actions = el('span', 'ebs-actions');
      const action = (glyph, label, tip, className, onClick, enabled = true) => {
        const wrap = el('span', 'ebs-action-wrap');
        const button = el('button', `ebs-action ${className}`, glyph);
        button.type = 'button';
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
      action('✓', 'Wegboeken', 'Wegboeken: open het mutatiescherm', 'book', () => dialog.open(row), Boolean(row.edit));
      action('⇪', 'Bon uploaden', 'Bon of factuur koppelen aan deze regel', 'attach', () => row.attach?.click(), Boolean(row.attach));
      action(isHidden ? '◉' : '◌', isHidden ? 'Weer tonen' : 'Verbergen', isHidden ? 'Weer tonen in de lijst' : 'Verbergen (alleen in jouw weergave, niet verwijderd)', 'hide', () => (isHidden ? this.unhide(row) : this.hideRows([row])));
      action('✕', 'Verwijderen', 'Verwijderen uit e-Boekhouden (vraagt om bevestiging)', 'delete', () => row.remove?.click(), Boolean(row.remove));

      node.append(box, date, party, description, amount, actions);
      node.addEventListener('click', () => {
        if (row.edit) dialog.open(row);
      });
      return node;
    },

    hideRows(rows) {
      const signatures = rows.map(EBS.rowSignature).filter((signature) => !this.prefs.hidden.includes(signature));
      if (!signatures.length) return;
      const commit = () => {
        for (const signature of signatures) this.leaving.delete(signature);
        this.prefs.hidden = [...this.prefs.hidden, ...signatures];
        this.savePrefs();
        this.draw();
      };
      // Unselect what gets hidden, through the native checkboxes.
      clickingRange = true;
      try {
        for (const row of rows) if (row.checkbox.checked) row.checkbox.click();
      } finally {
        clickingRange = false;
      }
      if (reducedMotion.matches || this.ui.showHidden) {
        commit();
        return;
      }
      for (const signature of signatures) this.leaving.add(signature);
      this.draw();
      setTimeout(commit, 140);
    },

    unhide(row) {
      const signature = EBS.rowSignature(row);
      this.prefs.hidden = this.prefs.hidden.filter((item) => item !== signature);
      this.savePrefs();
      this.draw();
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
      this.prefs.groupOf = EBS.assignGroup(this.prefs.groupOf, rows.map(EBS.rowSignature), name);
      this.savePrefs();
      this.draw();
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

  const dialog = {
    host: null,
    open(row) {
      this.close(true);
      const backdrop = el('div', 'ebs-dialog-backdrop');
      const panel = el('div', 'ebs-dialog');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', 'Mutatie aanmaken');
      const head = el('div', 'ebs-dialog-head');
      const titles = el('span', 'ebs-dialog-titles');
      titles.append(el('span', 'ebs-dialog-title', 'Mutatie aanmaken'));
      titles.append(el('span', 'ebs-dialog-sub', [row.party ?? row.description, row.amountText, row.bookDate].filter(Boolean).join(' · ')));
      const close = el('button', 'ebs-dialog-close', '✕');
      close.type = 'button';
      close.setAttribute('aria-label', 'Sluiten');
      close.addEventListener('click', () => this.close());
      head.append(titles, close);

      const frame = el('iframe', 'ebs-dialog-frame');
      frame.title = 'Mutatie aanmaken';
      frame.src = `${location.origin}${location.pathname}${location.search}${EDIT_HASH}${encodeURIComponent(EBS.rowSignature(row))}`;

      const foot = el('div', 'ebs-dialog-foot', 'Na opslaan sluit dit venster en wordt de lijst ververst.');
      panel.append(head, frame, foot);
      backdrop.append(panel);
      backdrop.addEventListener('mousedown', (event) => {
        if (event.target === backdrop) this.close();
      });
      this.onKey = (event) => {
        if (event.key === 'Escape') this.close();
      };
      document.addEventListener('keydown', this.onKey, true);
      this.onMessage = (event) => {
        if (event.origin !== location.origin || event.source !== frame.contentWindow) return;
        if (event.data?.ebs === 'edit-done') {
          this.close();
          location.reload();
        }
        if (event.data?.ebs === 'edit-missing') {
          foot.textContent = 'Deze regel staat niet meer in de lijst. Sluit het venster en probeer het opnieuw.';
        }
      };
      window.addEventListener('message', this.onMessage);
      document.body.append(backdrop);
      this.host = backdrop;
      close.focus();
    },
    close(immediate = false) {
      if (!this.host) return;
      const host = this.host;
      this.host = null;
      document.removeEventListener('keydown', this.onKey, true);
      window.removeEventListener('message', this.onMessage);
      if (immediate || reducedMotion.matches) {
        host.remove();
        return;
      }
      host.classList.add('closing');
      setTimeout(() => host.remove(), 120);
    },
  };

  // -------------------------------------------------------------------------
  // The page inside the dialog.
  // -------------------------------------------------------------------------

  function runEditFrame(signature) {
    const style = document.createElement('style');
    // Only the page content: the shell's header and menus are already around the dialog.
    style.textContent = 'app-eb-header, app-site-navigation, app-site-navigation-b, app-header-identity, app-header-identity-b, app-notification-bar { display: none !important; }';
    document.documentElement.append(style);

    const started = Date.now();
    let clicked = false;
    const tick = setInterval(() => {
      if (!clicked) {
        const grid = findGridIn(document);
        if (grid) {
          const row = readRowsIn(grid).find((item) => EBS.rowSignature(item) === signature);
          if (row?.edit) {
            clicked = true;
            row.edit.click();
          } else if (row || Date.now() - started > 15000) {
            clearInterval(tick);
            parent.postMessage({ ebs: 'edit-missing' }, location.origin);
          }
        }
        return;
      }
      // Back on the import list: e-Boekhouden saved or cancelled.
      if (PAGE.test(location.pathname)) {
        clearInterval(tick);
        parent.postMessage({ ebs: 'edit-done' }, location.origin);
      }
    }, 250);

    function findGridIn(doc) {
      for (const grid of doc.querySelectorAll('app-grid')) {
        if (grid.querySelector('.grid-header-title')?.textContent.includes(TITLE)) return grid;
      }
      return null;
    }

    function readRowsIn(grid) {
      const headers = [...grid.querySelectorAll('app-grid-body table.grid thead th')].map((th) => th.textContent.trim());
      const at = (label) => headers.findIndex((text) => text.startsWith(label));
      const columns = { importDate: at('Importdatum'), account: at('RekeningNr'), bookDate: at('Boekdatum'), amount: at('Bedrag'), description: at('Omschrijving') };
      return [...grid.querySelectorAll('app-grid-body table.grid tbody tr')].map((tr) => {
        const cells = [...tr.children];
        const text = (key) => (columns[key] >= 0 ? cells[columns[key]]?.textContent.replace(/\s+/g, ' ').trim() ?? '' : '');
        return {
          importDate: text('importDate'),
          account: text('account'),
          bookDate: text('bookDate'),
          amount: EBS.parseAmount(text('amount')),
          description: text('description'),
          edit: tr.querySelector('[title="Handmatig invoeren"]'),
        };
      });
    }
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
    .ebs-group-menu { position: absolute; bottom: calc(100% + 8px); left: 60px; min-width: 220px; padding: 6px; display: flex; flex-direction: column; background: #fff; color: #232c4f; border-radius: 10px; box-shadow: 0 12px 32px rgba(20, 26, 48, .25); }
    .ebs-group-item { height: 36px; padding: 0 10px; border: 0; border-radius: 6px; background: #fff; color: #232c4f; text-align: left; font: 13px Ubuntu, system-ui, sans-serif; cursor: pointer; }
    .ebs-group-item:hover, .ebs-group-item:focus-visible { background: #f3f5fa; }
    .ebs-group-new input { box-sizing: border-box; width: 100%; height: 34px; margin-top: 4px; padding: 0 10px; border: 1px solid #d6dbe8; border-radius: 6px; font: 13px Ubuntu, system-ui, sans-serif; }

    /* Better design: hide the native table, keep pagination and the native machinery. */
    html.ebs-better-import app-grid-header, html.ebs-better-import app-grid-body, html.ebs-better-import app-grid-bulk-actions { display: none !important; }
    /* The page has no content padding of its own (the native grid insets itself), so the view and the
       remaining footer share one gutter. The footer only holds pagination now: without pages
       (app-pagination renders no div) it would be an empty white bar. */
    html.ebs-better-import app-grid { display: block; width: auto !important; margin: 0 32px 16px; }
    html.ebs-better-import app-grid-footer:not(:has(app-pagination > div)) { display: none !important; }
    html.ebs-better-import app-grid-footer .grid-footer { padding: 0 !important; background: transparent !important; overflow: visible !important; }
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
    .ebs-tab-remove { height: 30px; margin-left: 4px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: #8c93ab; font-size: 12px; cursor: pointer; }
    .ebs-tab-new input { height: 30px; width: 150px; padding: 0 10px; border: 1px dashed #c5cbdc; border-radius: 6px; font: 13px Ubuntu, system-ui, sans-serif; }
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
    .ebs-row.is-hidden { opacity: .55; }
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
    .ebs-footer { padding: 12px 14px; font-size: 13px; color: #5d6584; }
    .ebs-dialog-backdrop { position: fixed; inset: 0; z-index: 2147483100; display: flex; align-items: center; justify-content: center; background: rgba(20, 26, 48, .5); animation: ebs-fade 160ms cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-dialog { width: min(1040px, calc(100vw - 48px)); height: min(760px, calc(100vh - 48px)); display: flex; flex-direction: column; overflow: hidden; border-radius: 14px; background: #fff; box-shadow: 0 24px 64px rgba(10, 14, 30, .4); font-family: Ubuntu, system-ui, sans-serif; color: #232c4f; animation: ebs-pop 180ms cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-dialog-backdrop.closing { opacity: 0; transition: opacity 120ms ease-in; }
    .ebs-dialog-backdrop.closing .ebs-dialog { transform: scale(0.98); transition: transform 120ms ease-in; }
    .ebs-dialog-head { display: flex; align-items: center; gap: 16px; padding: 16px 20px; border-bottom: 1px solid #e6e9f1; }
    .ebs-dialog-titles { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
    .ebs-dialog-title { font-size: 17px; font-weight: 700; }
    .ebs-dialog-sub { font-size: 13px; color: #5d6584; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ebs-dialog-close { width: 36px; height: 36px; border: 0; border-radius: 8px; background: #f3f5fa; color: #232c4f; font-size: 18px; cursor: pointer; }
    .ebs-dialog-frame { flex: 1; width: 100%; border: 0; }
    .ebs-dialog-foot { padding: 10px 20px; border-top: 1px solid #e6e9f1; font-size: 12px; color: #5d6584; }

    /* Better design motion (the approved list). */
    .ebs-bar.better { opacity: 0; transform: translate(-50%, 16px); transition: opacity 150ms ease-in, transform 150ms ease-in, visibility 0s linear 150ms; }
    .ebs-bar.better.show { opacity: 1; transform: translate(-50%, 0); transition: opacity 200ms cubic-bezier(0.23, 1, 0.32, 1), transform 200ms cubic-bezier(0.23, 1, 0.32, 1), visibility 0s; }
    .ebs-bar.better .ebs-group-menu { transform-origin: bottom left; animation: ebs-menu 150ms cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-bar.better .ebs-bar-button { transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-bar.better .ebs-bar-button:active { transform: scale(0.97); }
    .ebs-row.leaving { opacity: 0; transform: translateX(8px); transition: opacity 140ms cubic-bezier(0.23, 1, 0.32, 1), transform 140ms cubic-bezier(0.23, 1, 0.32, 1); }
    @keyframes ebs-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes ebs-pop { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: none; } }
    @keyframes ebs-menu { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: none; } }
    @keyframes ebs-tip { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .ebs-bar.better, .ebs-bar.better.show { transform: translate(-50%, 0); }
      .ebs-bar.better.show { transition: opacity 150ms ease-out, visibility 0s; }
      .ebs-dialog, .ebs-bar.better .ebs-group-menu { animation: ebs-fade 120ms ease-out; }
      .ebs-dialog-backdrop.closing .ebs-dialog { transform: none; }
      .ebs-row.leaving { transform: none; }
      .ebs-bar.better .ebs-bar-button:active { transform: none; }
    }
  `;

  // Started last, once every declaration in this file exists.
  function start() {
    injectStyle();
    chrome.storage.local.get('settings').then(({ settings: stored }) => {
      settings = EBS.settingsWithDefaults(stored);
      settingsLoaded = true;
      applyBetterClass();
      schedule();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.settings) return;
      settings = EBS.settingsWithDefaults(changes.settings.newValue);
      applyBetterClass();
      schedule();
    });
    // Our own drawing must not wake the loop, or it would redraw forever.
    const OURS = '.ebs-import, .ebs-bar, .ebs-dialog-backdrop, #ebs-import-style';
    new MutationObserver((records) => {
      const native = records.some((record) => {
        const node = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
        return !node?.closest(OURS);
      });
      if (native) schedule();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    document.addEventListener('change', schedule, true);
    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      anchor = null;
      applyBetterClass();
      schedule();
    }, 300);
  }

  start();
})();
