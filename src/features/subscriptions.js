// EB Sessions: the subscription screens (Abonnementen) in Better design.
// Setting: betterDesign. The billing core (grid reading, the open posts,
// the action bar, the edit layout and the line window) is EBS.billing, from
// invoices.js, which the manifest loads first.
//
// Screens (secure*, Angular shell):
//   /facturen/abonnement          the list (app-abonnement-list)
//   /facturen/abonnement/:id      add (0) or edit a subscription (app-abonnement-form)
//
// Grid columns: nummer (Abonnement), relatie, startDatum, expiratieDatum
// (Prolongatie), eindDatum, per, bedragExcl, bedragIncl, perMonth (Bedrag ex
// p/m), printen, emailen, incasso, and opCount with the filter "Alleen
// weergeven met achterstand". A subscription with "Tijdelijk niet
// factureren" (geenFactuur) has its prolongation date in grey.
//
// Own request: the same ONE bulk GET of the open posts per screen load, for
// the card "Open bij deze relaties" (joined on the relation's name). The
// next three invoice dates are computed in the browser and say so. There is
// no pause button: e-Boekhouden has none in its list.

(() => {
  if (window.__ebsSubscriptionsLoaded) return;
  window.__ebsSubscriptionsLoaded = true;
  const { EBS } = window;
  const B = EBS?.billing;
  if (!B) return;

  const {
    el, own, button, icon, withIcon, text, amount, money, plainMoney, parseDay, formatDay, longDay, today, relativeDay, plural,
    useBetter, setClassic, betterDesign, register, schedule, openPosts,
    headers, columnOf, dataRows, cellText, rowCount, gridLoading, bulkAction, clickable, notification,
    backLink, filterDialog, card, chip, selectField, searchField, checkBox, iconButton, skeletonRows, message, busy, toast, actionBar, toggleNative, clearSelection, pagerView, keepFocus,
    control, section, checkCard, editScreen,
  } = B;

  const LIST_SCREEN = 'subscriptions';
  const EDIT_SCREEN = 'subscription-edit';
  const LIST_PATH = /^\/facturen\/abonnement\/?$/;
  const EDIT_PATH = /^\/facturen\/abonnement\/\d+\/?$/;
  const COLUMNS = '44px minmax(0, 1.2fr) minmax(0, 1fr) 110px 190px 90px 130px 130px 120px';
  const DAY_MS = 86_400_000;

  // e-Boekhouden's periods (the options of "Betaling per").
  const PER = {
    W: { days: 7, label: 'Week', every: 'Elke week', group: 'week' },
    '2W': { days: 14, label: '2 weken', every: 'Elke 2 weken', group: 'week' },
    '4W': { days: 28, label: '4 weken', every: 'Elke 4 weken', group: 'week' },
    M: { months: 1, label: 'Maand', every: 'Elke maand', group: 'month' },
    '2M': { months: 2, label: '2 maanden', every: 'Elke 2 maanden', group: 'month' },
    K: { months: 3, label: 'Kwartaal', every: 'Elk kwartaal', group: 'quarter' },
    H: { months: 6, label: 'Halfjaar', every: 'Elk halfjaar', group: 'half' },
    J: { months: 12, label: 'Jaar', every: 'Elk jaar', group: 'year' },
    '2J': { months: 24, label: '2 jaar', every: 'Elke 2 jaar', group: 'year' },
  };
  const GROUPS = [['all', 'Alle'], ['week', 'Week'], ['month', 'Maand'], ['quarter', 'Kwartaal'], ['half', 'Halfjaar'], ['year', 'Jaar']];
  const BULK = { edit: 'Geselecteerde regels wijzigen', remove: 'Geselecteerde regels verwijderen' };

  // The code ('M') or the label ('Maand') as the grid shows it.
  function perOf(value) {
    const raw = String(value ?? '').trim();
    if (PER[raw.toUpperCase()]) return raw.toUpperCase();
    return Object.keys(PER).find((code) => PER[code].label.toLowerCase() === raw.toLowerCase()) ?? null;
  }

  // The anchor plus k periods. A month that is too short for the day takes
  // its last day (31 januari plus een maand is 28 of 29 februari), counted
  // from the anchor each time, so the day does not drift. Aanname: that is
  // how e-Boekhouden moves a month end; it decides the real date.
  function addPeriod(anchor, code, k) {
    const per = PER[code];
    if (!per || anchor === null) return null;
    if (per.days) return anchor + k * per.days * DAY_MS;
    const date = new Date(anchor);
    const months = date.getUTCMonth() + k * per.months;
    const year = date.getUTCFullYear() + Math.floor(months / 12);
    const month = ((months % 12) + 12) % 12;
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Date.UTC(year, month, Math.min(date.getUTCDate(), last));
  }

  // The next invoice dates from the prolongation date: none while
  // "Tijdelijk niet factureren" is on, none after the end date.
  function nextDates({ prolongation, per, end = null, paused = false, count = 3 }) {
    if (paused) return { dates: [], reason: 'paused' };
    const code = perOf(per);
    if (prolongation === null || prolongation === undefined || !code) return { dates: [], reason: 'unknown' };
    const dates = [];
    for (let k = 0; dates.length < count && k < count + 1; k += 1) {
      const date = addPeriod(prolongation, code, k);
      if (end !== null && end !== undefined && date > end) break;
      dates.push(date);
    }
    return { dates, reason: dates.length ? null : 'ended' };
  }

  // ===========================================================================
  // The list (Abonnementen)
  // ===========================================================================

  function subscriptionGrid() {
    return document.querySelector('app-abonnement-list app-grid');
  }

  function isGrey(node) {
    const color = (node?.getAttribute('style') ?? '').toLowerCase().replace(/\s+/g, '');
    return /color:(#aaa(aaa)?|rgb\(170,170,170\))/.test(color);
  }

  function readSubscriptions(grid, now = today()) {
    const labels = headers(grid);
    const col = {
      name: columnOf(labels, 'Abonnement', 'Lidmaatschap'),
      relation: columnOf(labels, 'Relatie'),
      start: columnOf(labels, 'Startdatum'),
      next: columnOf(labels, 'Prolongatie'),
      end: columnOf(labels, 'Einddatum'),
      per: columnOf(labels, 'Per'),
      excl: columnOf(labels, 'Bedrag excl'),
      incl: columnOf(labels, 'Bedrag incl'),
      month: columnOf(labels, 'Bedrag ex p/m'),
    };
    return dataRows(grid, labels).map((tr, index) => {
      const name = cellText(tr, col.name);
      const end = parseDay(cellText(tr, col.end));
      const nextCell = col.next >= 0 ? tr.cells[col.next] : null;
      const paused = isGrey(nextCell?.querySelector('div') ?? nextCell);
      const excl = amount(cellText(tr, col.excl));
      const incl = amount(cellText(tr, col.incl));
      const perMonth = amount(cellText(tr, col.month));
      const mail = Boolean(tr.querySelector('.eb-icon-mail'));
      const post = Boolean(tr.querySelector('.eb-icon-print'));
      return {
        tr, index,
        key: `${name}|${index}`,
        check: tr.querySelector('.grid-multi-check input[type="checkbox"]'),
        name,
        relation: cellText(tr, col.relation),
        startText: cellText(tr, col.start),
        next: parseDay(cellText(tr, col.next)),
        end,
        per: perOf(cellText(tr, col.per)) ?? cellText(tr, col.per),
        excl, incl, perMonth,
        // incl. btw per month, berekend: the month amount at the row's own rate.
        perMonthIncl: Number.isFinite(perMonth) && Number.isFinite(excl) && Number.isFinite(incl) && excl !== 0 ? perMonth * (incl / excl) : perMonth,
        paused,
        ended: end !== null && end < now,
        send: mail && post ? 'per e-mail en post' : mail ? 'per e-mail' : post ? 'per post' : '',
        edit: clickable(tr.querySelector('.eb-icon-edit')),
        remove: tr.querySelector('[title="Verwijderen"]'),
      };
    });
  }

  function statusOf(row) {
    if (row.ended) return 'expired';
    if (row.paused) return 'paused';
    return 'active';
  }

  const subscriptionList = {
    name: LIST_SCREEN,
    mounted: false,
    broken: false,
    root: null,
    filters: { query: '', status: 'active', group: 'all' },

    match: (path) => LIST_PATH.test(path),

    host() {
      return document.querySelector('app-abonnement-list');
    },

    searchForm() {
      return [...(this.host()?.querySelectorAll('app-form') ?? [])].find((form) => form.querySelector('#verlopenAbonnementen, #achterstand')) ?? null;
    },

    build() {
      const root = own(el('div', 'ebs-b-view'));
      root.style.setProperty('--ebs-cards', '3');
      root.style.setProperty('--ebs-columns', COLUMNS);
      root.style.setProperty('--ebs-row-height', '56px');

      const head = el('div', 'ebs-b-head');
      const titles = el('div', 'ebs-b-titles');
      titles.append(el('h1', '', 'Abonnementen'));
      this.subtitle = el('span', 'ebs-b-subtitle');
      titles.append(this.subtitle);
      const actions = el('div', 'ebs-b-head-actions');
      const make = button('Facturen maken', 'ebs-b-secondary', () => this.makeInvoices(), { title: 'De pagina Abonnementfacturen maken van e-Boekhouden' });
      this.newButton = withIcon(button('Nieuw abonnement', 'ebs-b-primary', () => this.add()), 'plus');
      actions.append(button('Klassieke weergave', 'ebs-b-link', () => setClassic(LIST_SCREEN, true)), make, this.newButton);
      head.append(titles, actions);

      const cards = el('div', 'ebs-b-cards');
      this.cards = { month: card('Per maand'), next: card('Volgende facturen'), open: card('Open bij deze relaties') };
      this.retry = button('Opnieuw proberen', 'ebs-b-card-retry', (event) => {
        busy(event.currentTarget, () => openPosts.result !== null);
        openPosts.load({ again: true });
      });
      this.cards.open.root.append(this.retry);
      cards.append(...Object.values(this.cards).map((one) => one.root));

      const panel = el('div', 'ebs-b-panel');
      const filters = el('div', 'ebs-b-filters');
      this.search = searchField('Zoek op abonnement, relatie, bedrag of regel', (value) => {
        this.filters.query = value;
        schedule();
      });
      this.chips = {
        active: chip('Actief', () => this.setStatus('active')),
        paused: chip('Gepauzeerd', () => this.setStatus('paused')),
        expired: chip('Verlopen', () => this.toggleExpired()),
        late: chip('Met achterstand', () => this.toggleNative('achterstand', this.chips.late), 'late'),
      };
      this.chips.paused.title = 'Tijdelijk niet factureren staat aan';
      this.chips.expired.title = 'Zet het filter Ook zoeken in verlopen abonnementen van e-Boekhouden aan; de lijst laadt opnieuw';
      this.chips.late.title = 'Het filter Alleen weergeven met achterstand van e-Boekhouden; de lijst laadt opnieuw';
      this.groupSelect = selectField('Per', (value) => {
        this.filters.group = value;
        schedule();
      });
      // e-Boekhouden's other search fields (dates, amounts, words in the
      // lines, relation), not on the board but kept within reach.
      this.moreFilters = button('Meer filters', 'ebs-b-more-filters', () => filterDialog(this.searchForm(), this.filterSlot, 'De zoekvelden van e-Boekhouden'), { 'aria-haspopup': 'dialog' });
      filters.append(this.search, ...Object.values(this.chips), this.groupSelect, this.moreFilters);

      const header = el('div', 'ebs-b-row head');
      for (const [label, className] of [['', ''], ['Abonnement', ''], ['Relatie', ''], ['Start', ''], ['Volgende factuur', ''], ['Per', ''], ['Excl. btw', 'right'], ['Incl. btw', 'right'], ['', '']]) {
        header.append(el('span', className, label));
      }
      this.body = el('div', 'ebs-b-body');
      this.totalRow = el('div', 'ebs-b-row total');
      this.footer = pagerView(['abonnement', 'abonnementen']);
      panel.append(filters, header, this.body, this.totalRow, this.footer.root);
      this.filterSlot = own(el('div', 'ebs-b-hidden-slot'));
      root.append(head, cards, panel, el('div', 'ebs-b-spacer'), this.filterSlot);

      this.bar = actionBar('Acties voor geselecteerde abonnementen');
      this.bar.setActions([
        { id: 'edit', label: 'Wijzigen', kind: 'primary', run: (event, node) => this.bulk('edit', node) },
        { id: 'remove', label: 'Verwijderen', run: (event, node) => this.bulk('remove', node) },
        { id: 'clear', label: 'Selectie wissen', kind: 'quiet', run: () => clearSelection(readSubscriptions(subscriptionGrid())) },
      ]);
      return root;
    },

    add() {
      const link = [...(this.host()?.querySelectorAll('app-target-link a') ?? [])].find((node) => text(node) === 'Toevoegen');
      if (link && !link.closest('app-target-link')?.classList.contains('disabled')) link.click();
    },

    // e-Boekhouden's own page "Abonnementfacturen maken".
    makeInvoices() {
      const link = document.querySelector('a[href*="/facturen/abonnementfactuur"], a[href*="facturen/abonnementfactuur"]');
      if (link) link.click();
      else location.assign(`${location.origin}/facturen/abonnementfactuur`);
    },

    setStatus(status) {
      this.filters.status = this.filters.status === status ? 'all' : status;
      schedule();
    },

    // A native filter: its checkbox and its Zoeken; the list loads again.
    toggleNative(id, node, want = null) {
      const form = this.searchForm();
      const box = form?.querySelector(`#${id}`);
      const submit = form?.querySelector('button.form-submit');
      if (!box || !submit) return false;
      if (want === null || box.checked !== want) {
        box.click();
        submit.click();
        busy(node, () => !gridLoading(subscriptionGrid()), { timeout: 15_000 });
      }
      return true;
    },

    toggleExpired() {
      const on = this.filters.status !== 'expired';
      this.filters.status = on ? 'expired' : 'active';
      this.toggleNative('verlopenAbonnementen', this.chips.expired, on);
      schedule();
    },

    bulk(id, node) {
      const grid = subscriptionGrid();
      const target = bulkAction(grid, BULK[id]);
      if (!target) {
        this.bar.fail(`De actie "${BULK[id]}" staat niet op de pagina. Gebruik de klassieke weergave.`);
        return;
      }
      const path = location.href;
      const note = notification()?.message ?? '';
      const before = readSubscriptions(grid).filter((row) => row.check?.checked).length;
      target.click();
      busy(node, () => {
        const now = subscriptionGrid();
        return location.href !== path || now !== grid || gridLoading(now) || (notification()?.message ?? '') !== note
          || readSubscriptions(now).filter((row) => row.check?.checked).length !== before
          || Boolean(document.querySelector('app-abonnement-bulk-update-form'));
      }, { timeout: 8000 });
    },

    rowView(row, selected, now) {
      const node = el('div', `ebs-b-row${selected ? ' on' : ''}`);
      node.dataset.key = row.key;
      const box = checkBox(selected, `Abonnement ${row.name} selecteren`, () => toggleNative(row));
      box.dataset.role = 'check';
      node.append(box);
      const name = el('span', 'ebs-b-stack');
      name.append(el('span', 'ebs-b-cell-relation', row.name));
      if (row.send) {
        const send = el('span', 'ebs-b-sub', row.send);
        send.prepend(icon(row.send === 'per post' ? 'printer' : 'mail', { size: 12 }));
        name.append(send);
      } else {
        name.append(el('span', 'ebs-b-sub', ''));
      }
      node.append(name);
      node.append(el('span', 'ebs-b-cell-name', row.relation));
      node.append(el('span', 'ebs-b-cell-date', row.startText));
      const next = el('span', 'ebs-b-stack');
      next.append(el('span', 'ebs-b-cell-number', row.next !== null ? formatDay(row.next) : ''));
      const when = row.ended ? 'verlopen' : row.paused ? 'tijdelijk niet factureren' : row.next !== null ? relativeDay(row.next, now) : '';
      next.append(el('span', `ebs-b-sub${!row.paused && !row.ended && row.next !== null && row.next < now ? ' late' : ''}`, when));
      node.append(next);
      node.append(el('span', 'ebs-b-cell-date', PER[row.per]?.label ?? row.per));
      node.append(el('span', 'right num ebs-b-cell-excl', plainMoney(row.excl)));
      node.append(el('span', 'right num ebs-b-cell-incl', plainMoney(row.incl)));
      const actions = el('span', 'ebs-b-row-actions');
      const edit = iconButton('pencil', 'Wijzigen', () => row.edit?.click(), { disabled: !row.edit });
      edit.dataset.role = 'edit';
      // e-Boekhouden's own Verwijderen: it asks in its own dialog first.
      const remove = iconButton('trash', 'Verwijderen', () => row.remove?.click(), { title: 'Verwijderen (vraagt om bevestiging)', quiet: true, disabled: !row.remove });
      remove.dataset.role = 'remove';
      actions.append(edit, remove);
      node.append(actions);
      return node;
    },

    render() {
      if (!this.host() || !useBetter(LIST_SCREEN)) {
        this.unmount();
        const host = this.host();
        if (host && betterDesign()) {
          const grid = subscriptionGrid();
          if (grid && (!this.back?.isConnected || this.back.nextElementSibling !== grid)) {
            this.back?.remove();
            this.back = backLink(LIST_SCREEN);
            grid.before(this.back);
          }
        }
        return;
      }
      const host = this.host();
      this.back?.remove();
      if (!this.root?.isConnected) {
        this.root = this.build();
        host.prepend(this.root);
      }
      host.setAttribute('data-ebs-billing-list', '');
      const form = this.searchForm();
      if (form && !form.closest('.ebs-b-hidden-slot') && !form.closest('.ebs-b-filter-dialog')) B.place(this.filterSlot, [form]);
      this.mounted = true;
      openPosts.load();
      this.draw();
      toast.follow();
    },

    draw() {
      const grid = subscriptionGrid();
      const posts = openPosts.result;
      const now = today();
      const note = notification();
      const loading = !grid || gridLoading(grid);

      if (loading) {
        this.cards.month.loading();
        this.cards.next.loading();
        if (!posts) this.cards.open.loading();
        this.subtitle.textContent = '';
        const errorState = !grid && note?.error;
        const signature = errorState ? `error:${note.message}` : 'loading';
        if (this.body.dataset.signature !== signature) {
          this.body.dataset.signature = signature;
          this.body.replaceChildren(errorState ? message({
            title: 'De lijst kon niet worden geladen',
            body: `e-Boekhouden meldt: "${note.message}" Er is niets veranderd aan je abonnementen.`,
            action: 'Opnieuw laden', onAction: () => location.reload(), alert: true,
          }) : skeletonRows(4, COLUMNS));
          if (errorState) {
            this.cards.month.set({ value: 'onbekend' });
            this.cards.next.set({ value: 'onbekend' });
          }
        }
        this.totalRow.replaceChildren();
        this.bar.update({ selected: 0, countText: '', totalText: '' });
        this.footer.update({ grid: null, shown: 0, total: Number.NaN });
        this.retry.classList.remove('show');
        return;
      }

      const rows = readSubscriptions(grid, now);
      const active = rows.filter((row) => statusOf(row) === 'active');
      this.subtitle.textContent = `${active.length} actief`;

      const month = active.reduce((sum, row) => sum + (Number.isFinite(row.perMonth) ? row.perMonth : 0), 0);
      const monthIncl = active.reduce((sum, row) => sum + (Number.isFinite(row.perMonthIncl) ? row.perMonthIncl : 0), 0);
      this.cards.month.set({ value: money(month), sub: `excl. btw (kolom Bedrag ex p/m) · ${money(monthIncl)} incl., berekend` });

      const upcoming = active.map((row) => row.next).filter((time) => time !== null);
      if (upcoming.length) {
        const first = Math.min(...upcoming);
        const same = upcoming.filter((time) => time === first).length;
        this.cards.next.set({ value: longDay(first), sub: `${plural(same, 'abonnement', 'abonnementen')} · ${relativeDay(first, now)}`, subTone: first < now ? 'late' : '' });
      } else {
        this.cards.next.set({ value: 'geen', sub: 'geen actieve abonnementen met een prolongatiedatum' });
      }

      // The open posts of the relations in this list (all their open posts,
      // not only those of a subscription).
      if (!posts) this.cards.open.loading();
      else if (!posts.ok) this.cards.open.set({ value: 'onbekend', sub: posts.error });
      else {
        const names = new Set(rows.map((row) => row.relation).filter(Boolean));
        let total = 0;
        let count = 0;
        for (const name of names) {
          const entry = posts.byRelation.get(name);
          if (entry && Math.abs(entry.total) > 0.004) {
            total += entry.total;
            count += 1;
          }
        }
        this.cards.open.set({ value: money(total), sub: `${plural(count, 'relatie', 'relaties')} met open posten` });
      }
      this.retry.classList.toggle('show', Boolean(posts && !posts.ok));

      const needle = this.filters.query.trim().toLowerCase();
      const base = rows.filter((row) => (this.filters.group === 'all' || PER[row.per]?.group === this.filters.group)
        && (!needle || [row.name, row.relation, plainMoney(row.excl), plainMoney(row.incl), plainMoney(row.perMonth)].join(' ').toLowerCase().includes(needle)));
      const counts = { active: 0, paused: 0, expired: 0 };
      for (const row of base) counts[statusOf(row)] += 1;
      const shown = base.filter((row) => this.filters.status === 'all' || statusOf(row) === this.filters.status);
      this.chips.active.textContent = `Actief · ${counts.active}`;
      this.chips.active.setPressed(this.filters.status === 'active');
      this.chips.paused.setPressed(this.filters.status === 'paused');
      this.chips.expired.setPressed(this.filters.status === 'expired');
      const form = this.searchForm();
      this.chips.expired.disabled = !form?.querySelector('#verlopenAbonnementen');
      const lateBox = form?.querySelector('#achterstand');
      this.chips.late.setPressed(Boolean(lateBox?.checked));
      this.chips.late.disabled = !lateBox;
      this.groupSelect.setOptions(GROUPS, this.filters.group);

      const signature = JSON.stringify([
        shown.map((row) => [row.key, row.relation, row.next, row.per, row.excl, row.incl, row.paused, row.ended, row.send, row.check?.checked]),
        rows.length, needle, this.filters.status,
      ]);
      if (this.body.dataset.signature !== signature) {
        const first = this.body.dataset.signature === 'loading' || !this.body.dataset.signature;
        this.body.dataset.signature = signature;
        keepFocus(this.body, () => {
          if (!rows.length && !needle && !location.search.includes('search')) {
            this.body.replaceChildren(message({
              title: 'Nog geen abonnementen',
              body: 'Maak je eerste abonnement. Het staat hier zodra het is opgeslagen.',
              action: 'Nieuw abonnement', actionIcon: 'plus', onAction: () => this.add(),
            }));
          } else if (!shown.length) {
            this.body.replaceChildren(message({
              title: needle ? `Niets gevonden voor "${this.filters.query.trim()}"` : 'Niets gevonden',
              body: 'Er is gezocht in de geladen regels: abonnement, relatie en bedrag, binnen de gekozen status. Zet de filters terug, zoek anders of laad meer regels per pagina.',
              action: 'Filters wissen', onAction: () => this.clearFilters(),
            }));
          } else {
            this.body.replaceChildren(...shown.map((row) => {
              const node = this.rowView(row, Boolean(row.check?.checked), now);
              if (first) node.classList.add('enter');
              return node;
            }));
          }
        });
      }

      const sum = (key) => shown.reduce((total, row) => total + (Number.isFinite(row[key]) ? row[key] : 0), 0);
      this.totalRow.replaceChildren(el('span'), el('span', '', 'Totaal'), el('span'), el('span'), el('span'), el('span'),
        el('span', 'right num', shown.length ? plainMoney(sum('excl')) : ''), el('span', 'right num', shown.length ? plainMoney(sum('incl')) : ''), el('span'));
      this.footer.update({ grid, shown: rows.length, total: Number.NaN });

      const selected = rows.filter((row) => row.check?.checked);
      const selectedMonth = selected.reduce((total, row) => total + (Number.isFinite(row.perMonthIncl) ? row.perMonthIncl : 0), 0);
      const blocked = (label) => !bulkAction(grid, label) || bulkAction(grid, label).classList.contains('disabled') || bulkAction(grid, label).classList.contains('custom-disabled');
      this.bar.update({
        selected: selected.length,
        countText: `${plural(selected.length, 'abonnement', 'abonnementen')} geselecteerd`,
        totalText: `${money(selectedMonth)} incl. per maand`,
        disabled: { edit: blocked(BULK.edit), remove: blocked(BULK.remove) },
      });
    },

    clearFilters() {
      this.filters = { query: '', status: 'all', group: 'all' };
      this.search.input.value = '';
      schedule();
    },

    unmount() {
      if (this.root) B.restore(this.root);
      for (const content of document.querySelectorAll('.ebs-b-filter-dialog')) B.restore(content);
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
  // Add and edit a subscription
  // ===========================================================================

  const subscriptionEdit = editScreen({
    screen: EDIT_SCREEN,
    match: EDIT_PATH,
    host: 'app-abonnement-form',
    anchor: ['nummer', 'startDatum', 'relatieId'],
    back: 'Abonnementen',
    inExLabel: false,
    linesAt: 2,
    moreLabel: 'Meer velden van e-Boekhouden: omschrijving regels 1 tot 3, t.n.v., plaats, incl. of excl. btw, machtiging, Peppol',
    fields: {
      relation: ['relatieId'],
      name: ['nummer'],
      period: ['startDatum', 'expiratieDatum', 'eindDatum', 'per', 'termijn'],
      kenmerk: ['kenmerk'],
      remarks: ['opmerking'],
      templates: ['factuursjabloonId', 'emailsjabloonId'],
      hidden: ['inEx'],
    },
    title() {
      return /\/abonnement\/0\/?$/.test(location.pathname) ? 'Abonnement toevoegen' : 'Abonnement wijzigen';
    },
    totalsTitle(view) {
      const per = perOf(control(view.host, 'per')?.value);
      return per ? PER[per].every : 'Per periode';
    },
    layout(view) {
      const details = section('Gegevens');
      view.slots.relation = own(el('div', 'ebs-b-slot-wrap ebs-b-span-2'));
      view.slots.name = own(el('div', 'ebs-b-slot'));
      details.append(view.slots.relation, view.slots.name);

      const period = section('Periode');
      period.style.setProperty('--ebs-section-columns', '4');
      period.append(el('span', 'ebs-b-section-title', 'Periode'));
      view.slots.period = own(el('div', 'ebs-b-slot'));
      view.slots.kenmerk = own(el('div', 'ebs-b-slot-wrap ebs-b-span-3'));
      period.append(view.slots.period, view.slots.kenmerk);

      const remarks = section('Opmerkingen');
      remarks.style.setProperty('--ebs-section-columns', '2');
      view.slots.remarks = own(el('div', 'ebs-b-slot-wrap ebs-b-span-all'));
      view.slots.templates = own(el('div', 'ebs-b-slot'));
      view.slots.more = remarks;
      remarks.append(view.slots.remarks, view.slots.templates);
      view.main.append(details, period, remarks);

      const what = el('section', 'ebs-b-aside-card');
      what.append(el('span', 'ebs-b-section-title', 'Wat gebeurt er'));
      view.checks = [];
      for (const [name, options] of [
        ['autoVerwerk', { title: 'Automatisch factureren, verwerken en versturen', sub: 'Op de prolongatiedatum, zonder dat je iets doet.' }],
        ['emailen', { title: 'Per e-mail versturen', iconName: 'mail', indent: true }],
        ['printen', { title: 'Per post versturen', iconName: 'printer', indent: true }],
        ['incasso', { title: 'Factuurbedrag incasseren' }],
        ['geenFactuur', { title: 'Tijdelijk niet factureren' }],
      ]) {
        const node = checkCard(null, options);
        what.append(node);
        view.checks.push({ name, node });
      }
      view.aside.append(what);

      view.next = el('span', 'ebs-b-next');
      view.nextText = el('span');
      view.next.append(view.nextText, el('span', 'ebs-b-note', 'Berekend in je browser: prolongatiedatum plus de periode. Einddatum en Tijdelijk niet factureren tellen mee. e-Boekhouden bepaalt de echte datum.'));
      view.totals.append(view.next);
    },
    drawAside(view, { host }) {
      const result = nextDates({
        prolongation: parseDay(control(host, 'expiratieDatum')?.value),
        per: control(host, 'per')?.value,
        end: parseDay(control(host, 'eindDatum')?.value),
        paused: Boolean(control(host, 'geenFactuur')?.checked),
      });
      let words;
      if (result.reason === 'paused') words = 'Volgende facturen (berekend): geen, Tijdelijk niet factureren staat aan';
      else if (result.reason === 'ended') words = 'Volgende facturen (berekend): geen, de einddatum valt voor de prolongatiedatum';
      else if (result.reason === 'unknown') words = 'Volgende facturen (berekend): vul de prolongatiedatum en de periode in';
      else words = `Volgende facturen (berekend): ${result.dates.map(formatDay).join(', ')}`;
      if (view.nextText.textContent !== words) view.nextText.textContent = words;
    },
  });

  subscriptionEdit.name = EDIT_SCREEN;
  register(subscriptionList);
  register(subscriptionEdit);

  Object.defineProperty(window, '__ebsSubscriptionsTest', { value: Object.freeze({ perOf, addPeriod, nextDates, readSubscriptions, statusOf, PER }) });
})();
