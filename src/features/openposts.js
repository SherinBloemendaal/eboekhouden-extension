// EB Sessions: the Openstaande posten screen in Better design. Setting: betterDesign.
//
// Boekhouden > Open posten (/boekhouden/openposten) is e-Boekhouden's
// app-open-post-list: a filter form ("Maak hier een selectie", Volgende), the
// advert "U heeft wanbetalers" and a grid with bulk actions. e-Boekhouden's
// own controls do all the work: the soort select and Volgende load the list,
// its checkboxes and bulk actions (verrekenen, afboeken, betaalopdrachten,
// incasso) act on it. This view only clicks those controls in answer to a
// click of the user, and never submits anything on its own.
//
//   data       one bulk GET of e-Boekhouden's own grid request
//              (/v1/api/openpost/gridtable/openpost), so the cards count every
//              open post, also when the grid shows them in pages; when that
//              fails, the rows on the page itself
//   ladder     1e, 2e, 3e herinnering and ingebrekestelling, mapped once to
//              the user's own aanmaansjablonen (EBS.store); the step of a post
//              is read from "Laatste aanmaning" (date plus corOmschrijving)
//   reminders  the dialog in remind.js (window.__ebsRemind): e-Boekhouden's
//              own /boekhouden/openposten/aanmaning page in a frame
//
// Grid row fields (the grid's colMetadata names, from its cell templates):
// mutDatum, bedrijf, relatieCode, relatieId, email, mutFactuur,
// mutOmschrijving, sBedrag, sBetaald, teOntvangen, vervaldatum, lastCorDatum,
// corOmschrijving. Native markup: app-grid > app-grid-body table.grid with
// .grid-multi-check input per row, app-grid-bulk-action > li per action.

(() => {
  if (window.__ebsOpenpostsLoaded) return;
  window.__ebsOpenpostsLoaded = true;

  const PAGE = /^\/boekhouden\/openposten\/?$/;
  const SCREEN = 'openposts';
  const LIST_KEY = 'openposts:list';
  const LIMIT = 1000;
  const DAY_MS = 86_400_000;
  // The four steps of the ladder, in order.
  const STEPS = [
    { label: '1e herinnering', hint: 'Vriendelijk, na de vervaldatum' },
    { label: '2e herinnering', hint: 'Duidelijker, met het totaal' },
    { label: '3e herinnering', hint: 'Laatste herinnering' },
    { label: 'Ingebrekestelling', hint: 'Formeel, met termijn en kosten' },
  ];
  // e-Boekhouden's bulk actions, by their exact labels.
  const NATIVE = {
    email: 'De geselecteerde posten aanmanen per e-mail',
    post: 'De geselecteerde posten aanmanen per reguliere post',
    proef: 'Van de geselecteerde posten een proef-aanmaning maken',
    verrekenen: 'De geselecteerde facturen met elkaar verrekenen',
    afboeken: 'De geselecteerde facturen direct naar tegenrekening afboeken',
    export: 'Betaalopdrachten exporteren',
    exportCredit: 'Betaalopdrachten voor creditfacturen exporteren',
    incasso: 'Geselecteerde facturen klaarzetten voor incasseren',
    incassobureau: 'Geselecteerde facturen aanbieden bij incassobureau',
  };

  // -------------------------------------------------------------------------
  // Pure helpers, shared with remind.js (also in the reminder frame).
  // -------------------------------------------------------------------------

  // "2026-08-12T00:00:00", "2026-08-12" or "12-08-2026" -> { text, time } (UTC midnight) or null.
  function toDate(value) {
    const text = String(value ?? '').trim();
    let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    let year;
    let month;
    let day;
    if (match) [, year, month, day] = match.map(Number);
    else {
      match = /^(\d{2})-(\d{2})-(\d{4})/.exec(text);
      if (!match) return null;
      [, day, month, year] = match.map(Number);
    }
    if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
    return { text: `${String(day).padStart(2, '0')}-${String(month).padStart(2, '0')}-${year}`, time: Date.UTC(year, month - 1, day) };
  }

  function today() {
    const now = new Date();
    return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function toNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
    if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value);
    return EBS.parseAmount(value);
  }

  function money(value) {
    return `€ ${EBS.formatMoney(Number.isFinite(value) ? value : 0)}`;
  }

  const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

  function dueText(days) {
    if (days === null) return '';
    if (days > 0) return `${plural(days, 'dag', 'dagen')} te laat`;
    if (days === 0) return 'vandaag';
    return `over ${plural(-days, 'dag', 'dagen')}`;
  }

  // A template name as "Laatste aanmaning" may show it: without case, extra
  // spaces or a trailing "(E)", "(P)", "per e-mail" or "per post".
  function normalizeName(text) {
    let clean = String(text ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    for (let i = 0; i < 2; i += 1) {
      clean = clean
        .replace(/\s*[([]\s*(e|p|e-?mail|post)\s*[)\]]$/, '')
        .replace(/\s*[-:]?\s*(per\s+)?(e-?mail|reguliere post|post)$/, '')
        .trim();
    }
    return clean;
  }

  function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // The step (1 to 4) of a corOmschrijving, or null when it is not one of
  // the mapped templates or when two steps share a name (then a step cannot
  // be told apart). The text of e-Boekhouden is not verified: only an exact
  // name, or one name that is contained as whole words, counts.
  function levelOf(text, steps) {
    const clean = normalizeName(text);
    if (!clean || !Array.isArray(steps)) return null;
    const names = steps.map((step) => (step?.name ? normalizeName(step.name) : null));
    const shared = new Set(names.filter((name, i) => name && names.indexOf(name) !== i));
    const exact = names.map((name, i) => (name && name === clean ? i : -1)).filter((i) => i >= 0);
    if (exact.length) return exact.length === 1 && !shared.has(names[exact[0]]) ? exact[0] + 1 : null;
    const contained = names
      .map((name, i) => (name && new RegExp(`(^|[\\s,.;:()-])${escapeRegExp(name)}($|[\\s,.;:()-])`).test(clean) ? i : -1))
      .filter((i) => i >= 0);
    if (!contained.length) return null;
    const longest = Math.max(...contained.map((i) => names[i].length));
    const best = contained.filter((i) => names[i].length === longest);
    return best.length === 1 && !shared.has(names[best[0]]) ? best[0] + 1 : null;
  }

  // Two steps mapped to one template: those steps do not count.
  function sharedSteps(steps) {
    const names = (steps ?? []).map((step) => (step?.name ? normalizeName(step.name) : null));
    return names.map((name) => Boolean(name) && names.filter((other) => other === name).length > 1);
  }

  function finishRow(row, now) {
    row.days = row.dueTime === null ? null : Math.round((now - row.dueTime) / DAY_MS);
    row.key = `${row.factuur}|${row.relatieId ?? row.relatieCode}`;
    return row;
  }

  function lowerKeys(record) {
    return Object.fromEntries(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]));
  }

  const string = (value) => (value === null || value === undefined ? '' : String(value).replace(/\s+/g, ' ').trim());

  // e-Boekhouden's grid answer: { colMetadata: [{ name, index }], data: [[...]] }
  // (or data as objects). Returns { rows, truncated } or null for another shape.
  function rowsFromGrid(answer, now = today()) {
    if (!answer || typeof answer !== 'object' || !Array.isArray(answer.data)) return null;
    const meta = Array.isArray(answer.colMetadata) ? answer.colMetadata.filter((column) => column && typeof column.name === 'string' && Number.isInteger(column.index)) : null;
    const records = answer.data.map((cells) => {
      if (Array.isArray(cells)) return meta ? Object.fromEntries(meta.map((column) => [column.name, cells[column.index]])) : null;
      return cells && typeof cells === 'object' ? cells : null;
    }).filter(Boolean).map(lowerKeys);
    const rows = records.map((record) => {
      const date = toDate(record.mutdatum);
      const due = toDate(record.vervaldatum);
      const last = toDate(record.lastcordatum);
      const amount = toNumber(record.sbedrag);
      const paid = toNumber(record.sbetaald);
      let open = toNumber(record.teontvangen);
      if (!Number.isFinite(open) && Number.isFinite(amount)) open = amount - (Number.isFinite(paid) ? paid : 0);
      const relatieId = /^\d{1,12}$/.test(string(record.relatieid)) ? Number(record.relatieid) : null;
      return finishRow({
        factuur: string(record.mutfactuur),
        relatieId,
        relatieCode: string(record.relatiecode),
        relation: string(record.bedrijf) || string(record.relatiecode),
        email: string(record.email),
        date: date?.text ?? '',
        text: string(record.mutomschrijving),
        amount, paid, open,
        due: due?.text ?? '',
        dueTime: due?.time ?? null,
        lastDate: last?.text ?? '',
        lastText: record.coromschrijving === null || record.coromschrijving === undefined ? '' : string(record.coromschrijving),
      }, now);
    }).filter((row) => row.factuur || row.relation);
    const count = Number(answer.rowCount);
    const truncated = records.length >= LIMIT || (Number.isFinite(count) && count > records.length);
    return { rows, truncated };
  }

  // The relation in a native cell: the code in the inline menu (the default
  // view) or the company name before the address (Uitgebreid overzicht).
  function relationText(cell) {
    if (!cell) return '';
    const code = cell.querySelector('app-grid-inline-menu a:not([href^="mailto:"])');
    if (code) return string(code.textContent);
    for (const node of cell.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) return string(node.textContent);
      if (node.nodeType === Node.ELEMENT_NODE && !node.matches('a[href^="mailto:"], br') && node.textContent.trim()) return string(node.textContent);
    }
    return '';
  }

  // The grid as the page shows it: one page of rows. Its columns are found
  // by their header labels; the relation's id is in its inline menu's links.
  function nativeColumns(grid) {
    const labels = {
      date: /^Datum(\s|$)/, relation: /^Relatie(\s|$)/, factuur: /^Factuur(\s|$)/, text: /^Omschrijving(\s|$)/, amount: /^Bedrag(\s|$)/,
      paid: /^(Ontv|Bet)\./, open: /^Te (ont|bet)\./, due: /^Vervaldatum/, last: /^Laatste aanmaning/,
    };
    const headers = [...grid.querySelectorAll('app-grid-body table.grid thead th')].map((th) => th.textContent.replace(/\s+/g, ' ').trim());
    return Object.fromEntries(Object.entries(labels).map(([key, pattern]) => [key, headers.findIndex((text) => pattern.test(text))]));
  }

  function rowsFromDom(grid, now = today()) {
    const columns = nativeColumns(grid);
    const rows = [];
    for (const tr of grid.querySelectorAll('app-grid-body table.grid tbody tr')) {
      const checkbox = tr.querySelector('.grid-multi-check input[type="checkbox"]');
      if (!checkbox) continue;
      const cells = [...tr.children];
      const cell = (key) => (columns[key] >= 0 ? cells[columns[key]] ?? null : null);
      const text = (key) => string(cell(key)?.textContent);
      const code = relationText(cell('relation'));
      const idLink = tr.querySelector('a[href*="relatieId="], [itemhref*="relatieId="]');
      const idMatch = /relatieId=(\d{1,12})/.exec(idLink?.getAttribute('href') ?? idLink?.getAttribute('itemhref') ?? '');
      const mail = tr.querySelector('a[href^="mailto:"]')?.getAttribute('href')?.slice(7) ?? '';
      const lastCell = cell('last');
      const lastLink = lastCell?.querySelector('a') ?? null;
      const lastFull = string((lastLink ?? lastCell)?.textContent);
      const last = toDate(lastFull);
      const due = toDate(text('due'));
      const amount = toNumber(text('amount'));
      const paid = toNumber(text('paid'));
      let open = toNumber(text('open'));
      if (!Number.isFinite(open) && Number.isFinite(amount)) open = amount - (Number.isFinite(paid) ? paid : 0);
      rows.push(finishRow({
        factuur: text('factuur'),
        relatieId: idMatch ? Number(idMatch[1]) : null,
        relatieCode: code,
        relation: code,
        email: mail,
        date: toDate(text('date'))?.text ?? text('date'),
        text: text('text'),
        amount, paid, open,
        due: due?.text ?? '',
        dueTime: due?.time ?? null,
        lastDate: last?.text ?? '',
        lastText: last ? lastFull.slice(10).trim() : '',
      }, now));
    }
    return rows;
  }

  // The native rows of this page, with their checkbox and the link to the
  // reminder history. find(row) matches on invoice number and relation (its
  // code or name, whichever the grid shows), or on a number that is unique.
  function nativeRows(grid) {
    const list = [];
    if (grid) {
      const columns = nativeColumns(grid);
      for (const tr of grid.querySelectorAll('app-grid-body table.grid tbody tr')) {
        const checkbox = tr.querySelector('.grid-multi-check input[type="checkbox"]');
        if (!checkbox) continue;
        const cells = [...tr.children];
        list.push({
          checkbox,
          factuur: string(cells[columns.factuur]?.textContent),
          relation: relationText(cells[columns.relation]),
          history: columns.last >= 0 ? cells[columns.last]?.querySelector('a') ?? null : null,
        });
      }
    }
    return {
      list,
      find(row) {
        if (!row.factuur) return null;
        const same = list.filter((one) => one.factuur === row.factuur);
        return same.find((one) => one.relation && (one.relation === row.relatieCode || one.relation === row.relation))
          ?? (same.length === 1 && state.rows.filter((one) => one.factuur === row.factuur).length <= 1 ? same[0] : null);
      },
    };
  }

  // The rows that are ready for a step: step 0 is the first reminder (due and
  // none sent yet), step i follows step i (a post whose last reminder was step i).
  function readyFor(row, step) {
    return step === 0 ? row.days > 0 && !row.lastDate : row.level === step;
  }

  function quickMatch(row, quick) {
    if (quick === 'overdue') return row.days > 0;
    if (quick === 'noReminder') return row.days > 0 && !row.lastDate;
    if (quick === 'level1') return row.level === 1;
    if (quick === 'level2') return row.level === 2;
    return true;
  }

  // The URL of e-Boekhouden's own reminder form for these rows, as its bulk
  // action opens it, with the selection in its own `selected` query
  // (factuur|relatieId, comma separated). The invoice number may not hold
  // the separators.
  function aanmaningUrl({ rows, soort = 'E', proef = false, credDeb = 'D', per = '', returnUrl = '' }) {
    const query = new URLSearchParams();
    query.set('credDeb', credDeb);
    query.set('datumTot', per);
    query.set('soort', soort);
    query.set('proefAanmaning', String(Boolean(proef)));
    query.set('returnUrl', returnUrl);
    query.set('selected', rows.map((row) => `${row.factuur}|${row.relatieId}`).join(','));
    return `/boekhouden/openposten/aanmaning?${query}`;
  }

  // A row e-Boekhouden's form can take: a number and a relation, and no "," or "|".
  function remindable(row) {
    return Boolean(row.factuur) && Number.isInteger(row.relatieId) && !/[|,]/.test(row.factuur);
  }

  // The page's own "per" (dd-mm-yyyy) as the ISO time e-Boekhouden sends.
  function perIso(value) {
    const date = toDate(value);
    if (!date) return '';
    const [day, month, year] = date.text.split('-').map(Number);
    return new Date(year, month - 1, day).toISOString();
  }

  window.__ebsOpenposts = Object.freeze({
    STEPS, NATIVE, LIMIT,
    toDate, today, toNumber, money, plural, dueText, normalizeName, levelOf, sharedSteps,
    rowsFromGrid, rowsFromDom, readyFor, quickMatch, aanmaningUrl, remindable, perIso,
  });

  if (window !== window.top && !PAGE.test(location.pathname)) return;

  // -------------------------------------------------------------------------
  // Settings, the classic switch and the page
  // -------------------------------------------------------------------------

  let settings = EBS.settingsWithDefaults();
  let settingsLoaded = false;
  let classicScreens = {};

  function onPage() {
    return PAGE.test(location.pathname);
  }

  function useBetter() {
    return settingsLoaded && settings.betterDesign && onPage() && !classicScreens[SCREEN];
  }

  async function setClassic(classic) {
    const { classicScreens: stored } = await chrome.storage.local.get('classicScreens');
    classicScreens = { ...(stored ?? {}), [SCREEN]: classic };
    await chrome.storage.local.set({ classicScreens });
    applyBetterClass();
    schedule();
  }

  function applyBetterClass() {
    document.documentElement.classList.toggle('ebs-better-openposts', useBetter());
  }

  function host() {
    return document.querySelector('app-open-post-list');
  }

  function findGrid(list = host()) {
    return list?.querySelector('app-grid') ?? null;
  }

  function filterForm(list = host()) {
    for (const form of list?.querySelectorAll('app-form') ?? []) {
      if (form.closest('app-form-overlay')) continue;
      if (form.querySelector('select#soort') || /Maak hier een selectie/.test(form.textContent)) return form;
    }
    return null;
  }

  function currentSoort() {
    const fromUrl = new URLSearchParams(location.search).get('soort');
    if (fromUrl === 'Debiteur' || fromUrl === 'Crediteur') return fromUrl;
    const select = filterForm()?.querySelector('select#soort');
    if (select && ['Debiteur', 'Crediteur'].includes(select.value)) return select.value;
    return 'Debiteur';
  }

  function bulkAction(label) {
    return [...(host()?.querySelectorAll('app-grid-bulk-action li') ?? [])]
      .find((li) => li.textContent.replace(/\s+/g, ' ').trim() === label) ?? null;
  }

  // The same grid request as e-Boekhouden's own, for every open post at once.
  function listUrl(soort) {
    const page = new URLSearchParams(location.search);
    const query = new URLSearchParams({ offset: '0', limit: String(LIMIT), orderBy: '', sortDirection: '1', soort });
    const truthy = (value) => value === 'true' || value === '1';
    if (/^\d{1,12}$/.test(page.get('relatieId') ?? '')) query.set('relatieId', page.get('relatieId'));
    for (const key of ['includePaid', 'expiredOnly', 'checkFollowUp', 'isCreditOnly', 'incassoOnly']) {
      if (truthy(page.get(key))) query.set(key, 'true');
    }
    for (const key of ['per', 'vanaf', 'laatsteIncassoDatum']) {
      const iso = perIso(page.get(key));
      if (iso) query.set(key, iso);
    }
    for (const key of ['bedragVan', 'bedragTm']) {
      if (/^-?\d+([.,]\d+)?$/.test(page.get(key) ?? '')) query.set(key, page.get(key));
    }
    if (page.get('afkeurCode')) query.set('afkeurCode', page.get('afkeurCode').slice(0, 20));
    query.set('groupOnRelation', 'false');
    query.set('extendedGridView', 'true');
    query.set('zoeken', 'true');
    return `/v1/api/openpost/gridtable/openpost?${query}`;
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  const state = {
    screen: null,
    status: 'idle', // loading | ready | page | error
    rows: [],
    truncated: false,
    selected: new Set(),
    anchor: null,
    quick: 'all',
    query: '',
    relation: '',
    step: null, // the ladder step whose rows were picked
    message: '',
    ladder: null, // { steps: [ { id, name, soort } | null ] } or null
    store: null,
    userActed: false,
    nativeSignature: '',
  };

  function rowLevels() {
    for (const row of state.rows) row.level = state.ladder ? levelOf(row.lastText, state.ladder.steps) : null;
  }

  function visibleRows() {
    const needle = state.query.trim().toLowerCase();
    return state.rows.filter((row) => {
      if (state.relation && row.relation !== state.relation) return false;
      if (!needle) return true;
      const haystack = [row.relation, row.relatieCode, row.factuur, row.text, row.date, row.due, row.lastText,
        Number.isFinite(row.open) ? EBS.formatMoney(row.open) : '', Number.isFinite(row.amount) ? EBS.formatMoney(row.amount) : '',
        String(row.open), String(row.amount)].join(' ').toLowerCase();
      return haystack.includes(needle);
    });
  }

  function selectedRows() {
    return state.rows.filter((row) => state.selected.has(row.key));
  }

  async function administration() {
    const number = document.querySelector('app-header-identity-b .administratieId, app-header-identity #administratieId')?.textContent.trim();
    if (/^\d{1,12}$/.test(number ?? '')) return number;
    return (await EBS.store.currentAdministration().catch(() => null)) ?? 'default';
  }

  async function loadLadder() {
    const number = await administration();
    if (state.store?.prefix === `${number}/openposts/`) return;
    const store = EBS.store.feature('openposts', { administration: number });
    state.store = store;
    const stored = await store.get('ladder').catch(() => null);
    if (state.store !== store) return;
    state.ladder = stored && Array.isArray(stored.steps) && stored.steps.length === STEPS.length ? stored : null;
    rowLevels();
    view.draw();
  }

  // One bulk request per screen; after a native change that followed a click
  // of the user (an action, a filter), one more.
  async function load({ again = false } = {}) {
    const screen = location.href;
    state.screen = screen;
    if (again) EBS.request.clear(LIST_KEY);
    if (!again) {
      state.status = 'loading';
      state.rows = [];
      state.selected.clear();
      state.anchor = null;
      state.step = null;
      view.draw();
    }
    state.userActed = false;
    let answer;
    try {
      answer = await EBS.request.bulk(LIST_KEY, listUrl(currentSoort()));
    } catch (error) {
      if (state.screen !== screen) return;
      if (error?.code === 'repeat' && again) return;
      fromPage();
      return;
    }
    if (state.screen !== screen) return;
    const parsed = rowsFromGrid(answer);
    if (!parsed) {
      fromPage();
      return;
    }
    state.rows = parsed.rows;
    state.truncated = parsed.truncated;
    state.status = 'ready';
    keepSelection();
    rowLevels();
    view.draw();
  }

  // Without our own answer, the rows e-Boekhouden shows on this page.
  function fromPage() {
    const grid = findGrid();
    if (!grid) {
      state.status = state.status === 'page' ? 'page' : 'error';
      state.rows = state.status === 'page' ? state.rows : [];
      view.draw();
      return;
    }
    state.rows = rowsFromDom(grid);
    state.truncated = false;
    state.status = 'page';
    keepSelection();
    rowLevels();
    view.draw();
  }

  function keepSelection() {
    const keys = new Set(state.rows.map((row) => row.key));
    for (const key of [...state.selected]) if (!keys.has(key)) state.selected.delete(key);
    if (state.anchor && !keys.has(state.anchor)) state.anchor = null;
  }

  function setSelection(keys, { step = null } = {}) {
    state.selected = new Set(keys);
    state.step = step;
    state.message = '';
    view.paintSelection();
  }

  // -------------------------------------------------------------------------
  // Native controls, clicked during a click of the user
  // -------------------------------------------------------------------------

  // The native soort select and Volgende load the other list.
  function switchSoort(soort) {
    if (soort === currentSoort() && findGrid()) return;
    const form = filterForm();
    const select = form?.querySelector('select#soort');
    const submit = form ? [...form.querySelectorAll('button')].find((button) => /Volgende/.test(button.textContent)) : null;
    if (!select || !submit) {
      view.notice('De wissel van e-Boekhouden staat niet op de pagina. Gebruik de klassieke weergave.');
      return;
    }
    select.value = soort;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    submit.click();
  }

  // e-Boekhouden's bulk actions act on its own checkboxes: those get the
  // selection first (only rows on this page of e-Boekhouden can), then the
  // action's own <li> is clicked.
  function runNative(label) {
    const grid = findGrid();
    if (!grid) {
      // The list is not loaded yet: Volgende loads it, the action comes after.
      const submit = [...(filterForm()?.querySelectorAll('button') ?? [])].find((button) => /Volgende/.test(button.textContent));
      if (submit) {
        submit.click();
        view.notice('e-Boekhouden laadt de lijst. Klik daarna nog een keer.');
      } else view.notice('Deze actie staat niet op de pagina. Gebruik de klassieke weergave.');
      return;
    }
    const target = bulkAction(label);
    if (!target) {
      view.notice(`De actie "${label}" staat niet op de pagina. Gebruik de klassieke weergave.`);
      return;
    }
    const native = nativeRows(grid);
    const chosen = selectedRows();
    const missing = chosen.filter((row) => !native.find(row));
    if (missing.length) {
      view.notice(`${plural(missing.length, 'geselecteerde post staat', 'geselecteerde posten staan')} niet op deze pagina van e-Boekhouden. Deze actie werkt alleen met de posten op de pagina.`);
      return;
    }
    const want = new Set(chosen.map((row) => native.find(row)));
    for (const one of native.list) {
      if (one.checkbox.checked !== want.has(one)) one.checkbox.click();
    }
    target.click();
  }

  function openHistory(row) {
    nativeRows(findGrid()).find(row)?.history?.click();
  }

  // -------------------------------------------------------------------------
  // Reminders: the ladder and the dialog
  // -------------------------------------------------------------------------

  function remindOptions(rows, { soort, proef = false, step = null }) {
    return {
      rows, soort, proef, credDeb: currentSoort() === 'Crediteur' ? 'C' : 'D',
      per: perIso(new URLSearchParams(location.search).get('per')),
      returnUrl: location.pathname + location.search,
      step: step === null ? null : { index: step, label: STEPS[step].label, template: state.ladder?.steps[step] ?? null },
    };
  }

  // The reminder dialog for the selection. On the click of a ladder step the
  // text of its template is fetched (one item for this click) for the preview.
  function remind({ soort = 'E', proef = false, useStep = false } = {}) {
    const rows = selectedRows();
    if (!rows.length) return;
    if (rows.length > 1000) {
      view.notice('Je kunt maximaal 1000 open posten selecteren.');
      return;
    }
    const api = window.__ebsRemind;
    if (!api) {
      runNative(soort === 'P' ? (proef ? NATIVE.proef : NATIVE.post) : NATIVE.email);
      return;
    }
    const step = useStep ? state.step : null;
    const template = step === null ? null : state.ladder?.steps[step] ?? null;
    const options = remindOptions(rows, { soort: template?.soort ?? soort, proef, step });
    if (template?.id && (template.soort ?? 'E') === 'E') {
      options.templateText = EBS.request.item(`openposts:sjabloon:${template.id}`, `/v1/api/aanmaansjabloon/view/${template.id}`, { userAction: true })
        .then((answer) => ({ id: template.id, answer }));
      options.templateText.catch(() => {});
    }
    if (!api.open(options)) view.notice('Deze posten hebben geen factuurnummer of relatie die e-Boekhouden hier kan gebruiken. Gebruik de klassieke weergave.');
  }

  function pickStep(index) {
    if (!state.ladder) {
      mapping.open({ then: () => pickStep(index) });
      return;
    }
    const shared = sharedSteps(state.ladder.steps);
    if (!state.ladder.steps[index] || shared[index]) return;
    const keys = visibleRows().filter((row) => readyFor(row, index)).map((row) => row.key);
    state.quick = 'all';
    setSelection(keys, { step: index });
    view.draw();
  }

  // The one-time mapping of the steps to the user's own templates.
  const mapping = {
    dialog: null,
    async open({ then = null } = {}) {
      if (this.dialog?.isOpen) return;
      const box = document.createElement('div');
      box.className = 'ebs-op-map';
      const intro = el('p', 'ebs-op-map-intro', 'Eenmalig: welk aanmaansjabloon hoort bij welke stap? De namen en Post of E-mail komen uit de lijst Aanmaansjablonen van e-Boekhouden. De extensie leest daarna uit "Laatste aanmaning" welke stap een factuur al heeft gehad. Bewaard in jouw browser, per administratie.');
      const status = el('p', 'ebs-op-map-status', 'Bezig met laden…');
      status.setAttribute('role', 'status');
      const rows = el('div', 'ebs-op-map-rows');
      const selects = STEPS.map((step, index) => {
        const label = el('label', 'ebs-op-map-row');
        const select = el('select', 'ebs-op-map-select');
        select.disabled = true;
        select.setAttribute('aria-label', `Aanmaansjabloon voor ${step.label}`);
        select.dataset.step = String(index);
        label.append(el('span', 'ebs-op-map-step', step.label), select, el('span', 'ebs-op-map-hint', step.hint));
        rows.append(label);
        return select;
      });
      const warning = el('p', 'ebs-op-map-warning', '');
      warning.setAttribute('role', 'alert');
      const note = el('p', 'ebs-op-map-note', 'Geen sjabloon voor een stap? Maak hem in e-Boekhouden onder Beheer, Sjablonen, Aanmaningen. De stap blijft dan grijs.');
      const actions = el('div', 'ebs-op-map-actions');
      const retry = button('Opnieuw laden', 'ebs-op-btn ghost-dark');
      retry.classList.add('ebs-op-hidden');
      const save = button('Opslaan en verder', 'ebs-op-btn dark');
      save.disabled = true;
      actions.append(retry, save);
      box.append(intro, status, rows, warning, note, actions);

      let templates = [];
      const check = () => {
        const chosen = selects.map((select) => select.value);
        const names = chosen.filter(Boolean);
        const twice = names.some((id, i) => names.indexOf(id) !== i);
        warning.textContent = twice ? 'Twee stappen hebben hetzelfde sjabloon. Geef elke stap een eigen sjabloon, anders zijn ze in "Laatste aanmaning" niet uit elkaar te houden.' : '';
        save.disabled = !templates.length || twice || !names.length;
      };
      const fill = (list) => {
        templates = list;
        const current = state.ladder?.steps ?? [];
        selects.forEach((select, index) => {
          select.replaceChildren(new Option('Geen sjabloon', ''));
          for (const template of list) select.append(new Option(`${template.name} (${template.soort === 'P' ? 'Post' : 'E-mail'})`, String(template.id)));
          const stored = current[index]?.id;
          const guess = stored && list.some((template) => String(template.id) === String(stored)) ? String(stored) : guessTemplate(list, index);
          select.value = guess ?? '';
          select.disabled = false;
          select.addEventListener('change', check);
        });
        status.textContent = list.length ? '' : 'Er zijn nog geen aanmaansjablonen in e-Boekhouden.';
        check();
      };
      const fetchList = async () => {
        status.textContent = 'Bezig met laden…';
        retry.classList.add('ebs-op-hidden');
        try {
          const answer = await EBS.request.bulk('openposts:sjablonen', '/v1/api/aanmaansjabloon/gridtable?offset=0&limit=500&orderBy=&sortDirection=1');
          const list = templatesFrom(answer);
          if (!list) throw new Error('shape');
          fill(list);
        } catch {
          status.textContent = 'De aanmaansjablonen konden niet worden geladen.';
          retry.classList.remove('ebs-op-hidden');
        }
      };
      retry.addEventListener('click', fetchList);
      save.addEventListener('click', async () => {
        const steps = selects.map((select) => {
          const template = templates.find((one) => String(one.id) === select.value);
          return template ? { id: template.id, name: template.name, soort: template.soort } : null;
        });
        busy(save, true);
        try {
          await state.store?.set('ladder', { steps, savedAt: Date.now() });
          state.ladder = { steps };
          rowLevels();
          this.dialog?.close();
          view.draw();
          then?.();
        } catch {
          busy(save, false);
          warning.textContent = 'Opslaan lukte niet. Probeer het nog een keer.';
        }
      });
      this.dialog = EBS.dialog.open({
        title: 'Aanmaanladder instellen', subtitle: 'Eén keer per administratie', content: box, width: 1240, className: 'ebs-op-map-dialog',
      });
      fetchList();
    },
  };

  function templatesFrom(answer) {
    const parsed = Array.isArray(answer) ? { data: answer } : answer;
    if (!parsed || !Array.isArray(parsed.data)) return null;
    const meta = Array.isArray(parsed.colMetadata) ? parsed.colMetadata : null;
    return parsed.data.map((cells) => {
      const record = Array.isArray(cells) && meta ? Object.fromEntries(meta.map((column) => [column.name, cells[column.index]])) : cells;
      if (!record || typeof record !== 'object') return null;
      const lower = lowerKeys(record);
      const id = Number(lower.id);
      const name = string(lower.naam);
      if (!Number.isInteger(id) || !name) return null;
      return { id, name, soort: /^p/i.test(string(lower.soort)) ? 'P' : 'E' };
    }).filter(Boolean);
  }

  // A first guess from the names; the user confirms it.
  function guessTemplate(list, index) {
    const names = list.map((template) => ({ id: String(template.id), name: template.name.toLowerCase() }));
    const tests = [
      (name) => /herinnering/.test(name) && !/[23]|twee|derde/.test(name),
      (name) => /2|tweede/.test(name),
      (name) => /3|derde|laatste|aanmaning/.test(name),
      (name) => /ingebreke/.test(name),
    ];
    return names.find((template) => tests[index](template.name))?.id ?? null;
  }

  // -------------------------------------------------------------------------
  // DOM helpers
  // -------------------------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(text, className, onClick) {
    const node = el('button', className, text);
    node.type = 'button';
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  function busy(node, on) {
    if (on) {
      node.dataset.label = node.textContent;
      node.textContent = 'Bezig…';
    } else if (node.dataset.label) node.textContent = node.dataset.label;
    node.disabled = on;
    node.setAttribute('aria-busy', String(on));
  }

  // -------------------------------------------------------------------------
  // The view
  // -------------------------------------------------------------------------

  const COLUMNS = '44px 96px minmax(0, 1.1fr) 120px minmax(0, 1fr) 120px 120px 150px 170px';

  const view = {
    root: null,
    rowNodes: new Map(),
    drawnRows: null,

    mount(list) {
      if (!this.root?.isConnected) {
        this.root = el('section', 'ebs-op');
        this.root.setAttribute('aria-label', 'Open posten');
        this.build();
        list.before(this.root);
      } else if (this.root.nextElementSibling !== list) list.before(this.root);
      list.dataset.ebsOpenposts = '';
      bar.ensure();
    },

    unmount() {
      this.root?.remove();
      this.root = null;
      this.drawnRows = null;
      this.rowNodes.clear();
      bar.hide(true);
      for (const marked of document.querySelectorAll('[data-ebs-openposts]')) delete marked.dataset.ebsOpenposts;
    },

    build() {
      const head = el('div', 'ebs-op-head');
      const titles = el('div', 'ebs-op-titles');
      titles.append(el('h1', '', 'Open posten'));
      this.subtitle = el('span', 'ebs-op-sub');
      titles.append(this.subtitle);
      this.kinds = el('span', 'ebs-op-kinds');
      this.kinds.setAttribute('role', 'tablist');
      this.kinds.setAttribute('aria-label', 'Soort');
      this.kindButtons = [['Debiteur', 'Te ontvangen'], ['Crediteur', 'Te betalen']].map(([value, label]) => {
        const tab = button(label, 'ebs-op-kind', () => switchSoort(value));
        tab.setAttribute('role', 'tab');
        tab.dataset.soort = value;
        this.kinds.append(tab);
        return tab;
      });
      const classic = button('Klassieke weergave', 'ebs-op-link', () => setClassic(true));
      head.append(titles, this.kinds, classic);

      const help = el('div', 'ebs-op-help');
      this.helpText = el('span', 'ebs-op-help-text', 'De wissel zet het veld Soort van e-Boekhouden om; de lijst laadt dan opnieuw.');
      help.append(this.helpText);

      this.cards = el('div', 'ebs-op-cards');
      this.cardNodes = [0, 1, 2].map(() => {
        const card = el('div', 'ebs-op-card');
        const label = el('span', 'ebs-op-card-label');
        const value = el('span', 'ebs-op-card-value');
        const sub = el('span', 'ebs-op-card-sub');
        card.append(label, value, sub);
        this.cards.append(card);
        return { card, label, value, sub };
      });

      this.ladder = el('div', 'ebs-op-ladder');
      this.ladder.append(el('span', 'ebs-op-ladder-title', 'Aanmanen'));
      this.stepButtons = STEPS.map((step, index) => {
        const node = button('', `ebs-op-step${index === 3 ? ' danger' : ''}`, () => pickStep(index));
        const label = el('span', 'ebs-op-step-label', step.label);
        const count = el('span', 'ebs-op-step-count', '0');
        node.append(label, count);
        node.dataset.step = String(index);
        this.ladder.append(node);
        return { node, count };
      });
      this.ladder.append(el('span', 'ebs-op-grow'));
      this.ladder.append(el('span', 'ebs-op-ladder-note', 'Kiest de facturen en het gekoppelde aanmaansjabloon; versturen doe je zelf.'));
      this.ladder.append(button('Ladder instellen', 'ebs-op-link small', () => mapping.open()));

      const panel = el('div', 'ebs-op-panel');
      const filters = el('div', 'ebs-op-filters');
      const search = el('label', 'ebs-op-search');
      search.append(EBS.icon('search'));
      this.searchInput = el('input');
      this.searchInput.type = 'search';
      this.searchInput.placeholder = 'Zoek op relatie, factuur, omschrijving of bedrag';
      this.searchInput.setAttribute('aria-label', 'Zoeken');
      this.searchInput.addEventListener('input', () => {
        state.query = this.searchInput.value;
        this.drawRows();
      });
      search.append(this.searchInput);
      this.chips = el('span', 'ebs-op-chips');
      const relation = el('label', 'ebs-op-relation');
      relation.append(el('span', '', 'Relatie'));
      this.relationSelect = el('select');
      this.relationSelect.setAttribute('aria-label', 'Relatie');
      this.relationSelect.addEventListener('change', () => {
        state.relation = this.relationSelect.value;
        this.drawRows();
      });
      relation.append(this.relationSelect);
      filters.append(search, this.chips, relation);

      this.columns = el('div', 'ebs-op-row ebs-op-columns');
      this.columns.setAttribute('aria-hidden', 'true');
      this.lastHeader = el('span');
      for (const [text, right] of [['', false], ['Datum', false], ['Relatie', false], ['Factuur', false], ['Omschrijving', false], ['Bedrag', true], ['Nog open', true], ['Vervaldatum', false]]) {
        const span = el('span', right ? 'right' : '', text);
        this.columns.append(span);
      }
      this.columns.append(this.lastHeader);

      this.body = el('div', 'ebs-op-body');
      this.body.setAttribute('role', 'list');
      this.body.addEventListener('click', (event) => this.onBodyClick(event));
      this.footer = el('div', 'ebs-op-footer');
      this.footer.setAttribute('role', 'status');
      panel.append(filters, this.columns, this.body, this.footer);

      this.root.append(head, help, this.cards, this.ladder, panel);
    },

    notice(text) {
      bar.message(text);
    },

    draw() {
      if (!this.root) return;
      const deb = currentSoort() === 'Debiteur';
      this.root.classList.toggle('cred', !deb);
      this.subtitle.textContent = deb ? 'Debiteuren · facturen die je nog moet ontvangen' : 'Crediteuren · facturen die je nog moet betalen';
      for (const tab of this.kindButtons) {
        const on = tab.dataset.soort === currentSoort();
        tab.setAttribute('aria-selected', String(on));
        tab.classList.toggle('on', on);
      }
      this.lastHeader.textContent = deb ? 'Laatste aanmaning' : 'Status';
      const loading = state.status === 'loading' || state.status === 'idle';
      this.helpText.textContent = state.status === 'page'
        ? 'De wissel zet het veld Soort van e-Boekhouden om; de lijst laadt dan opnieuw. De kaarten tellen de posten op deze pagina van e-Boekhouden.'
        : `De wissel zet het veld Soort van e-Boekhouden om; de lijst laadt dan opnieuw. De kaarten tellen ${state.truncated ? `de eerste ${LIMIT}` : 'alle'} open posten.`;
      this.drawCards(deb, loading);
      this.drawLadder(deb, loading);
      this.drawChips(deb);
      this.drawRelations();
      this.drawRows();
    },

    drawCards(deb, loading) {
      const rows = state.rows;
      const overdue = rows.filter((row) => row.days > 0);
      const relations = new Set(rows.map((row) => row.relation));
      const sum = (list) => list.reduce((total, row) => total + (Number.isFinite(row.open) ? row.open : 0), 0);
      const values = [
        [deb ? 'Nog te ontvangen' : 'Nog te betalen', money(sum(rows)), plural(rows.length, 'post', 'posten'), false],
        ['Vervallen', money(sum(overdue)), `${plural(overdue.length, 'post', 'posten')} · oudste ${Math.max(0, ...overdue.map((row) => row.days))} dagen`, overdue.length > 0],
        [deb ? 'Debiteuren' : 'Crediteuren', String(relations.size), deb ? `${new Set(overdue.map((row) => row.relation)).size} met een vervallen factuur` : 'relaties met open posten', false],
      ];
      values.forEach(([label, value, sub, warn], index) => {
        const card = this.cardNodes[index];
        card.label.textContent = label;
        card.value.textContent = loading ? '' : value;
        card.sub.textContent = loading ? '' : sub;
        card.card.classList.toggle('loading', loading);
        card.value.classList.toggle('warn', warn && !loading);
      });
    },

    drawLadder(deb, loading) {
      const shown = deb && !loading && state.rows.length > 0;
      this.ladder.classList.toggle('shown', shown);
      this.ladder.classList.toggle('gone', !deb || (!loading && !state.rows.length));
      this.ladder.inert = !shown;
      const shared = state.ladder ? sharedSteps(state.ladder.steps) : [false, false, false, false];
      this.stepButtons.forEach(({ node, count }, index) => {
        const mapped = Boolean(state.ladder?.steps[index]) && !shared[index];
        const known = index === 0 || mapped;
        const n = known ? state.rows.filter((row) => readyFor(row, index)).length : null;
        count.textContent = n === null ? '-' : String(n);
        count.classList.toggle('some', Boolean(n));
        const grey = Boolean(state.ladder) && !mapped;
        node.classList.toggle('grey', grey);
        node.disabled = grey;
        node.classList.toggle('on', state.step === index);
        node.setAttribute('aria-pressed', String(state.step === index));
        node.title = grey ? 'Geen eigen aanmaansjabloon voor deze stap (Ladder instellen)' : `${STEPS[index].label}: kies de facturen die klaar zijn voor deze stap`;
      });
    },

    drawChips(deb) {
      const chips = deb
        ? [['all', 'Alles'], ['overdue', 'Alle vervallen'], ['noReminder', 'Vervallen zonder herinnering'], ['level1', 'Na 1e herinnering'], ['level2', 'Na 2e herinnering']]
        : [['all', 'Alles'], ['overdue', 'Alle vervallen']];
      if (!chips.some(([value]) => value === state.quick)) state.quick = 'all';
      const signature = chips.map(([value]) => value).join();
      if (this.chips.dataset.set !== signature) {
        this.chips.dataset.set = signature;
        this.chips.replaceChildren(...chips.map(([value, label]) => {
          const chip = button(label, 'ebs-op-chip', () => this.pickQuick(value));
          chip.dataset.quick = value;
          return chip;
        }));
      }
      for (const chip of this.chips.children) {
        const on = chip.dataset.quick === state.quick;
        chip.classList.toggle('on', on);
        chip.setAttribute('aria-pressed', String(on));
      }
    },

    pickQuick(value) {
      if ((value === 'level1' || value === 'level2') && !state.ladder) {
        mapping.open({ then: () => this.pickQuick(value) });
        return;
      }
      state.quick = value;
      const keys = value === 'all' ? [] : visibleRows().filter((row) => quickMatch(row, value)).map((row) => row.key);
      setSelection(keys);
      this.draw();
    },

    drawRelations() {
      const names = [...new Set(state.rows.map((row) => row.relation).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nl'));
      if (state.relation && !names.includes(state.relation)) state.relation = '';
      const signature = names.join('\u0001');
      if (this.relationSelect.dataset.set !== signature) {
        this.relationSelect.dataset.set = signature;
        this.relationSelect.replaceChildren(new Option('Alle', ''), ...names.map((name) => new Option(name, name)));
      }
      this.relationSelect.value = state.relation;
    },

    drawRows() {
      const deb = currentSoort() === 'Debiteur';
      const loading = state.status === 'loading' || state.status === 'idle';
      const rows = loading ? [] : visibleRows();
      const focusKey = document.activeElement?.closest?.('.ebs-op-item')?.dataset.key ?? null;
      const focusPart = document.activeElement?.dataset?.part ?? null;
      const nodes = [];
      const native = nativeRows(findGrid());
      this.rowNodes.clear();
      if (loading) {
        for (const width of [160, 220, 140, 200, 180, 210]) {
          const skeleton = el('div', 'ebs-op-skeleton');
          skeleton.setAttribute('aria-hidden', 'true');
          const bar1 = el('span', 'box');
          const bar2 = el('span', 'line');
          bar2.style.width = `${width}px`;
          skeleton.append(bar1, bar2, el('span', 'line short'));
          nodes.push(skeleton);
        }
      }
      for (const row of rows) {
        const node = this.rowNode(row, deb, Boolean(native.find(row)?.history));
        this.rowNodes.set(row.key, node);
        nodes.push(node);
      }
      if (!loading && !state.rows.length) {
        const empty = el('div', 'ebs-op-empty');
        if (state.status === 'error') {
          empty.append(el('strong', '', 'De open posten konden niet worden geladen'), el('span', '', 'Kies Te ontvangen of Te betalen om de lijst van e-Boekhouden te laden, of gebruik de klassieke weergave.'));
        } else {
          empty.append(el('strong', '', 'Geen open posten'), el('span', '', 'Alles is betaald of verrekend. Mooi.'));
        }
        nodes.push(empty);
        this.columns.classList.add('ebs-op-hidden');
      } else this.columns.classList.remove('ebs-op-hidden');
      if (!loading && state.rows.length && !rows.length) nodes.push(el('div', 'ebs-op-none', 'Geen posten die passen bij de zoekopdracht.'));
      this.body.replaceChildren(...nodes);
      this.body.setAttribute('aria-busy', String(loading));
      this.footer.textContent = loading ? 'Bezig met laden…'
        : state.status === 'page' ? 'De posten op deze pagina van e-Boekhouden. Blader met de paginering eronder.'
          : state.truncated ? `De eerste ${LIMIT} open posten. Verfijn de selectie in de klassieke weergave voor de rest.` : '';
      this.paintSelection();
      if (focusKey) {
        const again = this.rowNodes.get(focusKey);
        (again?.querySelector(`[data-part="${focusPart}"]`) ?? again?.querySelector('.ebs-op-check'))?.focus({ preventScroll: true });
      }
      this.drawnRows = rows;
    },

    rowNode(row, deb, history) {
      const node = el('div', 'ebs-op-row ebs-op-item');
      node.setAttribute('role', 'listitem');
      node.dataset.key = row.key;
      const check = button('', 'ebs-op-check');
      check.setAttribute('role', 'checkbox');
      check.setAttribute('aria-label', `${row.factuur} ${row.relation} selecteren`);
      check.dataset.part = 'check';
      check.append(EBS.icon('check', { size: 14 }));
      const due = el('span', 'ebs-op-due');
      due.append(el('span', '', row.due));
      const badge = el('span', `ebs-op-badge ${row.days > 30 ? 'late' : row.days > 0 ? 'due' : 'calm'}`, dueText(row.days));
      if (row.days === null) badge.classList.add('ebs-op-hidden');
      due.append(badge);
      let lastText;
      if (row.lastDate) lastText = `${row.lastDate} ${row.lastText}`.trim();
      else lastText = deb ? (row.days > 0 ? 'Nog geen herinnering' : '') : (row.days > 0 ? 'Te betalen' : '');
      const last = history ? button(lastText, 'ebs-op-last link') : el('span', 'ebs-op-last', lastText);
      if (history) {
        last.dataset.part = 'history';
        last.title = 'Geschiedenis van de aanmaningen';
      }
      last.classList.toggle('strong', row.level >= 3);
      last.classList.toggle('muted', !row.lastDate);
      node.append(
        check,
        el('span', 'ebs-op-date', row.date),
        el('span', 'ebs-op-relation-name', row.relation),
        el('span', 'ebs-op-invoice', row.factuur),
        el('span', 'ebs-op-text', row.text),
        el('span', 'ebs-op-amount', Number.isFinite(row.amount) ? EBS.formatMoney(row.amount) : ''),
        el('span', 'ebs-op-open', Number.isFinite(row.open) ? EBS.formatMoney(row.open) : ''),
        due,
        last,
      );
      node.querySelector('.ebs-op-relation-name').title = row.relation;
      node.querySelector('.ebs-op-text').title = row.text;
      return node;
    },

    onBodyClick(event) {
      const item = event.target.closest?.('.ebs-op-item');
      if (!item) return;
      const row = state.rows.find((one) => one.key === item.dataset.key);
      if (!row) return;
      if (event.target.closest('.ebs-op-last.link')) {
        openHistory(row);
        return;
      }
      this.toggle(row, event.shiftKey);
    },

    // A click toggles one row; shift-click gives the range from the anchor
    // the anchor's state (EBS.rangeToggles, as on the import screen).
    toggle(row, shift) {
      const rows = this.drawnRows ?? [];
      const target = rows.indexOf(row);
      const from = rows.findIndex((one) => one.key === state.anchor);
      if (shift && settings.shiftSelect && from >= 0 && target >= 0) {
        const checked = rows.map((one) => state.selected.has(one.key));
        for (const index of EBS.rangeToggles(checked, from, target)) {
          if (checked[from]) state.selected.add(rows[index].key);
          else state.selected.delete(rows[index].key);
        }
      } else if (state.selected.has(row.key)) state.selected.delete(row.key);
      else state.selected.add(row.key);
      state.anchor = row.key;
      state.message = '';
      this.paintSelection();
    },

    paintSelection() {
      if (!this.root) return;
      const quick = state.quick !== 'all';
      for (const [key, node] of this.rowNodes) {
        const on = state.selected.has(key);
        node.classList.toggle('checked', on);
        node.classList.toggle('anchor', key === state.anchor);
        const row = state.rows.find((one) => one.key === key);
        node.classList.toggle('dim', quick && row && !quickMatch(row, state.quick));
        node.querySelector('.ebs-op-check')?.setAttribute('aria-checked', String(on));
      }
      for (const { node } of this.stepButtons ?? []) node.classList.toggle('on', state.step === Number(node.dataset.step));
      bar.update();
    },
  };

  // -------------------------------------------------------------------------
  // The action bar
  // -------------------------------------------------------------------------

  const bar = {
    host: null,

    ensure() {
      if (this.host?.isConnected) return;
      this.host = el('div', 'ebs-op-bar');
      this.host.setAttribute('role', 'toolbar');
      this.host.setAttribute('aria-label', 'Acties voor geselecteerde posten');
      const summary = el('span', 'ebs-op-bar-summary');
      this.count = el('span', 'ebs-op-bar-count');
      this.sub = el('span', 'ebs-op-bar-sub');
      summary.append(this.count, this.sub);
      this.buttons = el('span', 'ebs-op-bar-buttons');
      this.note = el('span', 'ebs-op-bar-note');
      this.note.setAttribute('role', 'alert');
      this.host.append(summary, el('span', 'ebs-op-bar-divider'), this.buttons, this.note);
      document.body.append(this.host);
      window.addEventListener('resize', () => this.place(), { passive: true });
    },

    hide(remove = false) {
      this.closeMenu();
      this.host?.classList.remove('show');
      this.host?.setAttribute('aria-hidden', 'true');
      if (this.host) this.host.inert = true;
      if (remove) {
        this.host?.remove();
        this.host = null;
      }
    },

    message(text) {
      state.message = text;
      if (!this.note) return;
      if (text) this.note.textContent = text;
      this.host.classList.toggle('has-note', Boolean(text));
    },

    place() {
      const rect = view.root?.getBoundingClientRect();
      if (this.host) this.host.style.left = rect?.width ? `${Math.round(rect.left + rect.width / 2)}px` : '';
    },

    update() {
      const rows = selectedRows();
      if (!rows.length || !view.root) {
        this.hide();
        return;
      }
      this.ensure();
      const deb = currentSoort() === 'Debiteur';
      const relations = new Set(rows.map((row) => row.relation)).size;
      this.count.textContent = `${plural(rows.length, 'post', 'posten')} geselecteerd`;
      this.sub.textContent = `${money(rows.reduce((sum, row) => sum + (Number.isFinite(row.open) ? row.open : 0), 0))} · ${plural(relations, 'relatie', 'relaties')}`;
      const step = state.step === null ? null : STEPS[state.step];
      const template = state.step === null ? null : state.ladder?.steps[state.step];
      const primary = deb
        ? [step ? `Stuur ${step.label.replace(/^I/, 'i')} per ${template?.soort === 'P' ? 'post' : 'e-mail'}…` : 'Aanmanen per e-mail…', () => remind({ soort: template?.soort === 'P' ? 'P' : 'E', useStep: true })]
        : ['Betaalopdracht exporteren', () => runNative(NATIVE.export)];
      const signature = `${deb}|${primary[0]}`;
      if (this.buttons.dataset.set !== signature) {
        this.closeMenu();
        this.buttons.dataset.set = signature;
        const more = deb
          ? [['Aanmanen per post…', () => remind({ soort: 'P' })], ['Proef-aanmaning…', () => remind({ soort: 'P', proef: true })],
            ['Klaarzetten voor incasso', () => runNative(NATIVE.incasso)], ['Aanbieden bij incassobureau', () => runNative(NATIVE.incassobureau)]]
          : [['Betaalopdrachten voor creditfacturen exporteren', () => runNative(NATIVE.exportCredit)]];
        const moreButton = button('', 'ebs-op-bar-button ghost icon', () => this.toggleMenu(moreButton, more));
        moreButton.append(EBS.icon('ellipsis', { size: 18 }));
        moreButton.setAttribute('aria-label', 'Meer acties');
        moreButton.title = 'Meer acties';
        moreButton.setAttribute('aria-haspopup', 'menu');
        moreButton.setAttribute('aria-expanded', 'false');
        const wrap = el('span', 'ebs-op-more');
        wrap.append(moreButton);
        this.buttons.replaceChildren(
          button(primary[0], 'ebs-op-bar-button primary', primary[1]),
          button('Verrekenen', 'ebs-op-bar-button ghost', () => runNative(NATIVE.verrekenen)),
          button('Afboeken', 'ebs-op-bar-button ghost', () => runNative(NATIVE.afboeken)),
          wrap,
          button('Selectie wissen', 'ebs-op-bar-button quiet', () => {
            state.anchor = null;
            state.quick = 'all';
            setSelection([]);
            view.draw();
          }),
        );
      }
      // e-Boekhouden blocks an action while it is busy: so does this bar.
      for (const node of this.buttons.querySelectorAll('.ebs-op-bar-button.ghost:not(.icon)')) {
        const label = node.textContent === 'Verrekenen' ? NATIVE.verrekenen : NATIVE.afboeken;
        node.disabled = Boolean(bulkAction(label)?.classList.contains('disabled'));
      }
      this.message(state.message);
      this.place();
      this.host.removeAttribute('aria-hidden');
      this.host.inert = false;
      requestAnimationFrame(() => this.host?.classList.add('show'));
    },

    toggleMenu(anchor, items) {
      if (this.menu) {
        this.closeMenu();
        return;
      }
      const menu = el('div', 'ebs-op-menu');
      menu.setAttribute('role', 'menu');
      for (const [label, run] of items) {
        const item = button(label, 'ebs-op-menu-item', () => {
          this.closeMenu();
          run();
        });
        item.setAttribute('role', 'menuitem');
        menu.append(item);
      }
      anchor.setAttribute('aria-expanded', 'true');
      anchor.parentElement.append(menu);
      this.menu = { menu, anchor };
      this.onOutside = (event) => {
        if (!menu.contains(event.target) && !anchor.contains(event.target)) this.closeMenu();
      };
      this.onKey = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          this.closeMenu();
          anchor.focus();
        }
      };
      document.addEventListener('mousedown', this.onOutside, true);
      menu.addEventListener('keydown', this.onKey);
      menu.querySelector('button')?.focus({ preventScroll: true });
    },

    closeMenu() {
      if (!this.menu) return;
      const { menu, anchor } = this.menu;
      this.menu = null;
      anchor.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', this.onOutside, true);
      menu.classList.add('closing');
      setTimeout(() => menu.remove(), 100);
    },
  };

  // The way back on the classic screen, in e-Boekhouden's own link style.
  const backToBetter = {
    node: null,
    mount(list) {
      if (!this.node) {
        this.node = el('div', 'ebs-op-native-toggle');
        const link = el('a', '', 'Nieuwe weergave');
        link.href = '#';
        link.setAttribute('role', 'button');
        link.addEventListener('click', (event) => {
          event.preventDefault();
          setClassic(false);
        });
        this.node.append(link);
      }
      if (this.node.nextElementSibling !== list) list.before(this.node);
    },
    unmount() {
      this.node?.remove();
    },
  };

  // -------------------------------------------------------------------------
  // Render loop
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

  function nativeSignature(grid) {
    if (!grid) return '';
    const body = grid.querySelector('app-grid-body tbody');
    return `${body?.children.length ?? 0}|${body?.textContent.replace(/\s+/g, ' ').slice(0, 4000) ?? ''}`;
  }

  function render() {
    applyBetterClass();
    const list = onPage() ? host() : null;
    if (!list || !useBetter()) {
      view.unmount();
      state.screen = null;
      if (list && settings.betterDesign && settingsLoaded) backToBetter.mount(list);
      else backToBetter.unmount();
      return;
    }
    backToBetter.unmount();
    injectStyle();
    view.mount(list);
    if (state.screen !== location.href) {
      loadLadder();
      load();
      state.nativeSignature = nativeSignature(findGrid(list));
      return;
    }
    const signature = nativeSignature(findGrid(list));
    if (signature !== state.nativeSignature) {
      state.nativeSignature = signature;
      if (state.status === 'page' || state.status === 'error') fromPage();
      else if (state.userActed && state.status === 'ready') load({ again: true });
    }
    findGrid(list)?.classList.toggle('ebs-op-paged', state.status === 'page');
    bar.update();
  }

  // -------------------------------------------------------------------------
  // Styles: hover fades of 150 ms; Better design motion on transform and
  // opacity, with reduced-motion fallbacks.
  // -------------------------------------------------------------------------

  function injectStyle() {
    if (document.getElementById('ebs-openposts-style')) return;
    const style = document.createElement('style');
    style.id = 'ebs-openposts-style';
    style.textContent = CSS;
    document.documentElement.append(style);
  }

  const CSS = `
    html.ebs-better-openposts app-open-post-list[data-ebs-openposts] > div > app-form,
    html.ebs-better-openposts app-open-post-list[data-ebs-openposts] app-container.wanbetalers,
    html.ebs-better-openposts app-open-post-list[data-ebs-openposts] .wanbetalers,
    html.ebs-better-openposts app-open-post-list[data-ebs-openposts] app-grid :is(app-grid-header, app-grid-body, app-grid-bulk-actions) { display: none !important; }
    html.ebs-better-openposts app-open-post-list[data-ebs-openposts] app-grid:not(.ebs-op-paged) { display: none !important; }
    html.ebs-better-openposts app-open-post-list[data-ebs-openposts] app-grid.ebs-op-paged { display: block; width: auto !important; margin: 0 32px 16px; }
    .ebs-op-native-toggle { width: 93%; margin: 6px 0; text-align: right; font-size: 13px; }
    .ebs-op-native-toggle a { color: var(--colorPrimary, #30395f); text-decoration: underline; cursor: pointer; }

    .ebs-op { box-sizing: border-box; margin: 20px 32px 16px; display: flex; flex-direction: column; gap: 14px; font-family: Ubuntu, system-ui, sans-serif; color: #232c4f; }
    .ebs-op button, .ebs-op-bar button, .ebs-op-map button, .ebs-op-map select { font-family: inherit; }
    .ebs-op-hidden { visibility: hidden; opacity: 0; }
    .ebs-op-head { display: flex; align-items: flex-end; gap: 16px; }
    .ebs-op-titles { display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0; }
    .ebs-op-titles h1 { margin: 0; font-size: 22px; font-weight: 700; color: #232c4f; }
    .ebs-op-sub { font-size: 13px; color: #5d6584; }
    .ebs-op-kinds { display: flex; padding: 3px; border-radius: 10px; background: #e3e7f0; }
    .ebs-op-kind { height: 34px; padding: 0 14px; border: 0; border-radius: 8px; background: transparent; color: #232c4f; font-size: 13px; font-weight: 400; cursor: pointer; }
    .ebs-op-kind.on { background: #fff; font-weight: 700; }
    .ebs-op-link { padding: 0; border: 0; background: none; color: #232c4f; font-size: 13px; text-decoration: underline; cursor: pointer; }
    .ebs-op-link.small { font-size: 12px; color: #5d6584; }
    .ebs-op-help { margin-top: -6px; font-size: 12px; color: #5d6584; }
    .ebs-op-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .ebs-op-card { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; border-radius: 12px; background: #fff; }
    .ebs-op-card-label, .ebs-op-card-sub { min-height: 16px; font-size: 12px; color: #5d6584; }
    .ebs-op-card-value { min-height: 26px; font-size: 20px; font-weight: 700; color: #232c4f; font-variant-numeric: tabular-nums; }
    .ebs-op-card-value.warn { color: #b42318; }
    .ebs-op-card.loading .ebs-op-card-value { width: 120px; border-radius: 6px; background: #e6e9f1; }
    .ebs-op-ladder { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 12px 14px; border-radius: 12px; background: #fff; opacity: 0; }
    .ebs-op-ladder.shown { opacity: 1; }
    .ebs-op-ladder.gone { display: none; }
    .ebs-op-ladder-title { margin-right: 4px; font-size: 13px; font-weight: 700; }
    .ebs-op-step { display: flex; align-items: center; height: 36px; padding: 0 12px; border: 1px solid #d6dbe8; border-radius: 9px; background: #fff; color: #232c4f; font-size: 13px; cursor: pointer; }
    .ebs-op-step-label { font-weight: 700; }
    .ebs-op-step.danger { border-color: #f1c7c2; color: #b42318; }
    .ebs-op-step.on { border-color: #232c4f; background: #f3f6fd; }
    .ebs-op-step.grey { opacity: .5; cursor: default; }
    .ebs-op-step-count { margin-left: 8px; padding: 1px 7px; border-radius: 9px; background: #eef0f5; color: #8c93ab; font-size: 11px; }
    .ebs-op-step-count.some { background: #232c4f; color: #fff; }
    .ebs-op-grow { flex: 1; }
    .ebs-op-ladder-note { font-size: 12px; color: #5d6584; }
    .ebs-op-panel { display: flex; flex-direction: column; overflow: hidden; border-radius: 12px; background: #fff; }
    .ebs-op-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #e6e9f1; }
    .ebs-op-search { flex: 1 1 240px; display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; border: 1px solid #d6dbe8; border-radius: 9px; color: #5d6584; font-size: 13px; }
    .ebs-op-search svg { flex: none; }
    .ebs-op-search input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font: 13px Ubuntu, system-ui, sans-serif; color: #232c4f; }
    .ebs-op-chips { display: contents; }
    .ebs-op-chip { height: 32px; padding: 0 12px; border: 1px solid #d6dbe8; border-radius: 16px; background: #fff; color: #232c4f; font-size: 13px; white-space: nowrap; cursor: pointer; }
    .ebs-op-chip.on { border-color: #232c4f; background: #232c4f; color: #fff; }
    .ebs-op-relation { display: flex; align-items: center; gap: 6px; height: 34px; padding: 0 12px; border: 1px solid #d6dbe8; border-radius: 17px; font-size: 13px; }
    .ebs-op-relation > span { color: #5d6584; }
    .ebs-op-relation select { max-width: 220px; border: 0; background: transparent; font: 13px Ubuntu, system-ui, sans-serif; color: #232c4f; }
    .ebs-op-row { display: grid; grid-template-columns: ${COLUMNS}; align-items: center; min-height: 52px; padding: 0 14px; border-bottom: 1px solid #eef0f5; background: #fff; }
    .ebs-op-columns { min-height: 36px; height: 36px; font-size: 12px; color: #5d6584; background: #f7f8fb; border-bottom-color: #e6e9f1; }
    .ebs-op-columns .right, .ebs-op-amount, .ebs-op-open { text-align: right; padding-right: 12px; }
    .ebs-op-body { max-height: max(320px, calc(100vh - 420px)); overflow: auto; overscroll-behavior: contain; }
    .ebs-op-item { cursor: pointer; }
    .ebs-op-item:hover { background: #fafbfd; }
    .ebs-op-item.checked { background: #e8eefb; }
    .ebs-op-item.anchor { box-shadow: inset 3px 0 0 #232c4f; }
    .ebs-op-item.dim { opacity: .45; }
    .ebs-op-check { display: flex; align-items: center; justify-content: center; width: 18px; height: 18px; padding: 0; border: 1.5px solid #8c93ab; border-radius: 4px; background: #fff; color: transparent; cursor: pointer; }
    .ebs-op-item.checked .ebs-op-check { border-color: #232c4f; background: #232c4f; color: #fff; }
    .ebs-op-date { font-size: 13px; }
    .ebs-op-relation-name { padding-right: 12px; font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ebs-op-invoice { font-size: 13px; color: #3a4677; }
    .ebs-op-text { padding-right: 12px; font-size: 13px; color: #4a5272; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ebs-op-amount { font-size: 13px; color: #4a5272; font-variant-numeric: tabular-nums; }
    .ebs-op-open { font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .ebs-op-due { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; padding: 4px 8px 4px 0; font-size: 13px; }
    .ebs-op-due > span:first-child { white-space: nowrap; }
    .ebs-op-badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; white-space: nowrap; background: #eef0f5; color: #4a5272; }
    .ebs-op-badge.due { background: #fff1dc; color: #8a5300; }
    .ebs-op-badge.late { background: #fdf0ef; color: #b42318; }
    .ebs-op-last { min-width: 0; padding: 0; border: 0; background: none; text-align: left; font-size: 12px; color: #3a4677; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ebs-op-last.link { text-decoration: underline; text-decoration-color: #c4cae0; cursor: pointer; }
    .ebs-op-last.muted { color: #8c93ab; }
    .ebs-op-last.strong { color: #b42318; }
    .ebs-op-skeleton { display: flex; align-items: center; gap: 24px; height: 52px; padding: 0 14px; border-bottom: 1px solid #eef0f5; animation: ebs-op-shimmer 1200ms ease-in-out infinite; }
    .ebs-op-skeleton .box { width: 18px; height: 18px; border-radius: 4px; background: #e6e9f1; }
    .ebs-op-skeleton .line { height: 12px; border-radius: 6px; background: #e6e9f1; }
    .ebs-op-skeleton .line.short { width: 120px; height: 10px; }
    .ebs-op-empty { display: flex; flex-direction: column; gap: 8px; max-width: 420px; margin: 40px auto; text-align: center; }
    .ebs-op-empty strong { font-size: 16px; }
    .ebs-op-empty span, .ebs-op-none { font-size: 13px; color: #5d6584; }
    .ebs-op-none { padding: 24px 14px; }
    .ebs-op-footer { min-height: 16px; padding: 10px 14px; font-size: 12px; color: #5d6584; }
    .ebs-op-check:focus-visible, .ebs-op-chip:focus-visible, .ebs-op-kind:focus-visible, .ebs-op-step:focus-visible, .ebs-op-link:focus-visible, .ebs-op-last.link:focus-visible { outline: 2px solid #232c4f; outline-offset: 2px; }

    .ebs-op-bar { position: fixed; left: 50%; bottom: 24px; z-index: 2147483000; display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 20px; border-radius: 14px; background: #232c4f; color: #fff; font-family: Ubuntu, system-ui, sans-serif; box-shadow: 0 18px 44px rgba(20, 26, 48, .35); opacity: 0; transform: translate(-50%, 16px); visibility: hidden; transition: opacity 150ms ease-in, transform 150ms ease-in, visibility 0s linear 150ms; }
    .ebs-op-bar.show { opacity: 1; transform: translate(-50%, 0); visibility: visible; transition: opacity 200ms cubic-bezier(0.23, 1, 0.32, 1), transform 200ms cubic-bezier(0.23, 1, 0.32, 1), visibility 0s; }
    .ebs-op-bar-summary { display: flex; flex-direction: column; gap: 2px; min-width: 170px; }
    .ebs-op-bar-count { font-size: 14px; font-weight: 700; }
    .ebs-op-bar-sub { font-size: 12px; color: #c4cae0; font-variant-numeric: tabular-nums; }
    .ebs-op-bar-divider { width: 1px; height: 32px; background: rgba(255, 255, 255, .2); }
    .ebs-op-bar-buttons { display: flex; align-items: center; gap: 10px; }
    .ebs-op-bar-button { display: flex; align-items: center; height: 40px; padding: 0 14px; border-radius: 9px; font-size: 14px; white-space: nowrap; cursor: pointer; }
    .ebs-op-bar-button.primary { border: 0; background: #5d9e35; color: #fff; font-weight: 700; }
    .ebs-op-bar-button.ghost { border: 1px solid rgba(255, 255, 255, .35); background: transparent; color: #fff; }
    .ebs-op-bar-button.icon { padding: 0 10px; }
    .ebs-op-bar-button.quiet { padding: 0 10px; border: 0; background: transparent; color: #c4cae0; }
    .ebs-op-bar-button:disabled { opacity: .5; cursor: default; }
    .ebs-op-bar-button:focus-visible, .ebs-op-menu-item:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .ebs-op-bar-note { position: absolute; left: 20px; right: 20px; bottom: calc(100% + 8px); padding: 8px 12px; border-radius: 10px; background: #fdf0ef; color: #b42318; font-size: 12px; line-height: 16px; box-shadow: 0 8px 24px rgba(20, 26, 48, .18); opacity: 0; transform: translateY(4px); pointer-events: none; transition: opacity 150ms ease-out, transform 150ms ease-out; }
    .ebs-op-bar.has-note .ebs-op-bar-note { opacity: 1; transform: none; }
    .ebs-op-more { position: relative; display: flex; }
    .ebs-op-menu { position: absolute; bottom: calc(100% + 8px); left: 0; min-width: 260px; padding: 6px; display: flex; flex-direction: column; border-radius: 10px; background: #fff; color: #232c4f; box-shadow: 0 12px 32px rgba(20, 26, 48, .25); transform-origin: bottom left; animation: ebs-op-menu 150ms cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-op-menu.closing { opacity: 0; transform: scale(0.96); transition: opacity 100ms ease-in, transform 100ms ease-in; pointer-events: none; }
    .ebs-op-menu-item { height: 36px; padding: 0 10px; border: 0; border-radius: 6px; background: #fff; color: #232c4f; text-align: left; font-size: 13px; cursor: pointer; }
    .ebs-op-menu-item:hover { background: #f3f5fa; }
    .ebs-op-menu-item:focus-visible { outline-color: #232c4f; }

    .ebs-op-map { display: flex; flex-direction: column; gap: 14px; padding: 4px 8px 4px; font-family: Ubuntu, system-ui, sans-serif; color: #232c4f; }
    .ebs-op-map p { margin: 0; }
    .ebs-op-map-intro { max-width: 760px; font-size: 14px; color: #4a5272; line-height: 1.5; }
    .ebs-op-map-status { min-height: 18px; font-size: 13px; color: #5d6584; }
    .ebs-op-map-rows { display: flex; flex-direction: column; gap: 14px; }
    .ebs-op-map-row { display: grid; grid-template-columns: 200px 360px 1fr; align-items: center; gap: 14px; font-size: 14px; }
    .ebs-op-map-step { font-weight: 700; }
    .ebs-op-map-select { height: 40px; padding: 0 10px; border: 1.5px solid #cfd4e2; border-radius: 9px; background: #fff; color: #232c4f; font-size: 14px; }
    .ebs-op-map-hint { font-size: 12px; color: #5d6584; }
    .ebs-op-map-warning { min-height: 18px; font-size: 13px; color: #b42318; }
    .ebs-op-map-note { margin-top: 8px !important; font-size: 12px; color: #5d6584; }
    .ebs-op-map-actions { display: flex; justify-content: flex-end; gap: 10px; }
    .ebs-op-btn { height: 44px; padding: 0 18px; border-radius: 10px; font-size: 14px; font-weight: 700; cursor: pointer; }
    .ebs-op-btn.dark { border: 0; background: #232c4f; color: #fff; }
    .ebs-op-btn.ghost-dark { border: 1px solid #cfd4e2; background: #fff; color: #232c4f; font-weight: 400; }
    .ebs-op-btn:disabled { opacity: .5; cursor: default; }
    .ebs-op-btn:focus-visible, .ebs-op-map-select:focus-visible { outline: 2px solid #232c4f; outline-offset: 2px; }

    .ebs-op-kind, .ebs-op-link, .ebs-op-step, .ebs-op-chip, .ebs-op-item, .ebs-op-check, .ebs-op-last, .ebs-op-bar-button, .ebs-op-menu-item, .ebs-op-btn, .ebs-op-map-select {
      transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease, opacity 150ms ease;
    }
    .ebs-op-bar-button { transition: transform 120ms cubic-bezier(0.23, 1, 0.32, 1), background-color 150ms ease, color 150ms ease, border-color 150ms ease, opacity 150ms ease; }
    .ebs-op-bar-button:active { transform: scale(0.97); }
    .ebs-op-step:hover:not(:disabled), .ebs-op-chip:hover:not(.on) { border-color: #8c93ab; }
    .ebs-op-kind:hover:not(.on) { background: rgba(255, 255, 255, .55); }
    .ebs-op-bar-button.ghost:hover:not(:disabled) { background: rgba(255, 255, 255, .1); }
    .ebs-op-bar-button.quiet:hover { color: #fff; }
    .ebs-op-ladder { transition: opacity 150ms ease-out; }
    .ebs-op-card-value, .ebs-op-card-sub { transition: opacity 150ms ease-out; }
    .ebs-op-card.loading .ebs-op-card-sub { opacity: 0; }
    @keyframes ebs-op-shimmer { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
    @keyframes ebs-op-menu { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: none; } }
    @keyframes ebs-op-fade { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .ebs-op-bar, .ebs-op-bar.show { transform: translate(-50%, 0); }
      .ebs-op-bar.show { transition: opacity 150ms ease-out, visibility 0s; }
      .ebs-op-skeleton { animation: none; }
      .ebs-op-menu { animation: ebs-op-fade 120ms ease-out; }
      .ebs-op-menu.closing { transform: none; }
      .ebs-op-bar-button:active { transform: none; }
      .ebs-op-bar-note { transform: none; }
    }
  `;

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------

  function start() {
    chrome.storage.local.get(['settings', 'classicScreens']).then(({ settings: stored, classicScreens: storedClassic }) => {
      settings = EBS.settingsWithDefaults(stored);
      classicScreens = storedClassic ?? {};
      settingsLoaded = true;
      schedule();
    }, () => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(changes.settings || changes.classicScreens)) return;
      if (changes.settings) settings = EBS.settingsWithDefaults(changes.settings.newValue);
      if (changes.classicScreens) classicScreens = changes.classicScreens.newValue ?? {};
      schedule();
    });
    // Our own drawing must not wake the loop.
    const OURS = '.ebs-op, .ebs-op-bar, .ebs-op-native-toggle, .ebs-dialog-backdrop, #ebs-openposts-style, #ebs-dialog-style';
    new MutationObserver((records) => {
      const native = records.some((record) => {
        const node = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
        return Boolean(node?.isConnected) && !node.closest(OURS);
      });
      if (native) schedule();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    // A click of the user on the page may change the list (an action, a
    // filter): the next native change loads our list again, once.
    document.addEventListener('click', (event) => {
      if (event.isTrusted && !event.target.closest?.('.ebs-op')) state.userActed = true;
    }, true);
    let lastHref = location.href;
    const watch = setInterval(() => {
      if (!chrome.runtime?.id) {
        clearInterval(watch);
        return;
      }
      if (location.href === lastHref) return;
      lastHref = location.href;
      schedule();
    }, 300);
  }

  start();
})();
