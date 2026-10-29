// EB Sessions: the Digitaal archief screen in Better design. Setting: betterDesign.
//
// Overig > Digitaal archief (/overig/digitaal-archief) is e-Boekhouden's own
// Angular screen, and it stays the source of truth. Its components keep
// running under the new view: the folder tree (app-digitaal-archief-folder-
// list), the header (-file-header), the toolbar (-knoppenbalk), the file list
// (-file-list, with -koppelingen per row), the right-click menu (-context-
// menu), the upload window (-upload) and the folder form (-folder-form). This
// script draws a new view from what they render and, in answer to a click of
// the user, clicks their controls: a folder's label, a row's checkbox and its
// "koppelingen" toggle, the toolbar's icons, a double-click on a row (that is
// e-Boekhouden's download) and the items of the right-click menu (reached by
// a contextmenu event on the row). e-Boekhouden asks its own confirmations.
// Nothing is filled in or sent by this script.
//
// Data. Everything comes from the page, without a request of ours:
//   - the rows, as e-Boekhouden renders them (name, date, status, size,
//     whether a file has links, the link details once a row is expanded);
//   - the page's own answers for folder/{id}/filelist (one GET for the whole
//     folder: id and koppelCount per file), folder/{id}/header (the Mail &
//     Herken folder) and folder/directory (folder ids), read through the
//     bridge's observe hook while this screen is open.
// Our own read-only requests (EBS.request):
//   - folder/unprocessed/count, one bulk GET per screen load, for the badge
//     on the inbox;
//   - folder/{id}/preview?inline=true, one item GET per click of the user on
//     one file, for the preview on the right.
// Opening a folder, however many files it has, makes no request of ours.
// "Zoek in alle mappen" is left out on purpose: it would be one request per
// folder.

(() => {
  if (window.__ebsArchiveLoaded) return;
  window.__ebsArchiveLoaded = true;

  const PAGE = /^\/overig\/digitaal-archief\/?$/;
  // Key in classicScreens (see import.js; the popup's Better design switch clears it).
  const SCREEN = 'archive';
  // The page's own answers this screen reads (bridge observe hook).
  const OBSERVE = [
    '^https://secure\\d*\\.e-boekhouden\\.(nl|be)/.*/folder/\\d+/filelist(\\?|$)',
    '^https://secure\\d*\\.e-boekhouden\\.(nl|be)/.*/folder/\\d+/header(\\?|$)',
    '^https://secure\\d*\\.e-boekhouden\\.(nl|be)/.*/folder/directory(\\?|$)',
  ];
  const FILELIST = /\/folder\/(\d+)\/filelist(?:\?|$)/;
  const HEADER = /\/folder\/(\d+)\/header(?:\?|$)/;
  const DIRECTORY = /\/folder\/directory(?:\?|$)/;
  // e-Boekhouden's own labels and titles (archive templates in its bundle).
  const TOOLBAR = {
    newFolder: 'Nieuwe map',
    cut: 'Geselecteerde items knippen',
    paste: 'Geselecteerde items plakken',
    upload: 'Bestanden uploaden',
    refresh: 'Lijst vernieuwen',
    remove: 'Geselecteerde items verwijderen',
  };
  const MENU = {
    recognize: 'Herkennen',
    linkRelation: 'Koppelen aan relatie',
    enter: 'Invoeren als mutatie',
    rename: 'Naam wijzigen',
  };
  // The context menu only offers Herkennen for these (validHerkennenExtentions).
  const RECOGNIZABLE = /\.(pdf|jpe?g|png)$/i;
  const PREVIEW_IMAGE = /\.(jpe?g|png|gif)$/i;
  const PREVIEW_PDF = /\.pdf$/i;
  // What the preview shows, by the type e-Boekhouden answers: a PDF (Chrome's
  // own viewer) or a bitmap image. Anything else, an SVG or HTML for example,
  // could run script and is not shown.
  const PREVIEW_TYPES = {
    'application/pdf': 'pdf',
    'image/png': 'image',
    'image/jpeg': 'image',
    'image/gif': 'image',
  };
  // A folder this size or larger gets the "in één keer geladen" wording.
  const MANY = 100;
  // Downloads go one by one through e-Boekhouden's own double-click.
  const MAX_DOWNLOADS = 20;
  // A folder load ends in rows, an empty folder or an error within this time,
  // also when e-Boekhouden's answer never comes; a late answer still shows.
  const LOAD_TIMEOUT = 6000;
  // e-Boekhouden draws its rows 20 ms after its answer. Longer than this and
  // the files of the answer did not come on screen.
  const ROWS_GRACE = 1500;
  const STATUS_TONE = {
    'Ingevoerd': 'done',
    'Niet ingevoerd': 'todo',
    'Is herkend': 'recognized',
    'Wordt herkend': 'busy',
    'Onvoldoende credits': 'credits',
  };
  const KOPPEL_KIND = {
    'APP-DIGITAAL-ARCHIEF-KOPPEL-MUTATIE': 'Mutatie',
    'APP-DIGITAAL-ARCHIEF-KOPPEL-RELATIE': 'Relatie',
    'APP-DIGITAAL-ARCHIEF-KOPPEL-IMPORT': 'Afschriftregel',
    'APP-DIGITAAL-ARCHIEF-KOPPEL-OFFERTE': 'Offerte',
  };
  const KOPPEL_SELECTOR = Object.keys(KOPPEL_KIND).join(', ').toLowerCase();
  const OURS = '.ebs-ar, .ebs-ar-bar, .ebs-ar-native-toggle, #ebs-archive-style';

  let settings = EBS.settingsWithDefaults();
  let settingsLoaded = false;
  let classicScreens = {};

  function onArchivePage() {
    return PAGE.test(location.pathname);
  }

  function useBetter() {
    return Boolean(settings.betterDesign) && onArchivePage() && !classicScreens[SCREEN];
  }

  // After the extension is reloaded, an orphaned script has no storage.
  function setClassic(classic) {
    classicScreens = { ...classicScreens, [SCREEN]: classic };
    try {
      chrome.storage.local.set({ classicScreens }).catch(() => {});
    } catch { /* orphaned: the choice holds for this page only */ }
    update();
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, label, onClick, iconName) {
    const node = el('button', className);
    node.type = 'button';
    if (iconName) node.append(EBS.icon(iconName));
    node.append(el('span', 'ebs-ar-label', label));
    node.addEventListener('click', onClick);
    return node;
  }

  function setLabel(node, text) {
    const label = node.querySelector('.ebs-ar-label');
    if (label && label.textContent !== text) label.textContent = text;
  }

  // A tooltip of ours: one line, or two when it is long.
  function tip(node, text) {
    if (node.textContent !== text) node.textContent = text;
    node.classList.toggle('two', text.length > 34);
  }

  const text = (node) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const plural = (count, one, more) => `${count} ${count === 1 ? one : more}`;

  // Resolves with fn()'s first truthy value, or null after `timeout` ms.
  function waitFor(fn, timeout = 1200) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        let value = null;
        try {
          value = fn();
        } catch { /* not there yet */ }
        if (value) resolve(value);
        else if (Date.now() - started >= timeout) resolve(null);
        else setTimeout(tick, 16);
      };
      tick();
    });
  }

  // The rest of the user's click first: e-Boekhouden closes its context menu
  // on a click or pointerup that reaches the window from outside the menu.
  const afterThisEvent = () => new Promise((resolve) => setTimeout(resolve, 0));

  // -------------------------------------------------------------------------
  // The page's own answers (observe hook), checked before use: page data.
  // -------------------------------------------------------------------------

  const observed = {
    on: false,
    unsubscribe: null,
    apiBase: null,
    // Newest first, at most a few: { folderId, items, at }.
    lists: [],
    // The folder of the newest filelist answer, also when it could not be
    // read: the folder e-Boekhouden shows now.
    folderId: null,
    // The newest filelist answer failed: { folderId, message, at } or null.
    error: null,
    // When the newest filelist answer for each folder came in, also a failed
    // or unreadable one: folderId -> time.
    answered: new Map(),
    menhFolderId: null,
    directories: null,
    // When the newest filelist answer came in (0: none yet on this visit).
    lastAt: 0,
  };

  function parseJson(body) {
    if (typeof body !== 'string' || body.length > 4 * 1024 * 1024) return undefined;
    try {
      return JSON.parse(body);
    } catch {
      return undefined;
    }
  }

  const str = (value, max = 500) => (typeof value === 'string' ? value.slice(0, max) : '');
  const int = (value) => (Number.isSafeInteger(value) ? value : null);

  function cleanItem(item) {
    if (!item || typeof item !== 'object') return null;
    const id = int(item.id);
    const naam = str(item.naam);
    if (id === null || !naam) return null;
    return {
      id,
      naam,
      soort: item.soort === 'D' ? 'D' : 'F',
      datum: str(item.datum, 40),
      koppelCount: Number.isSafeInteger(item.koppelCount) && item.koppelCount >= 0 ? item.koppelCount : null,
      isDeleted: item.isDeleted === true,
    };
  }

  function onObserved(data) {
    if (!data || typeof data.url !== 'string') return;
    const base = /^(https:\/\/[^/]+\/.*?\/)folder\//.exec(data.url)?.[1];
    if (base && base.startsWith(`${location.origin}/`)) observed.apiBase = base;
    const list = FILELIST.exec(data.url);
    if (list && data.method === 'GET') {
      const folderId = Number(list[1]);
      const now = Date.now();
      observed.folderId = folderId;
      if (data.status >= 400 || data.status === 0) {
        const answer = parseJson(data.body);
        observed.error = { folderId, message: str(answer?.message, 300) || 'Er is iets misgegaan.', at: now };
      } else {
        const answer = parseJson(data.body);
        if (Array.isArray(answer)) {
          observed.error = null;
          observed.lists = [{ folderId, items: answer.map(cleanItem).filter(Boolean), at: now }, ...observed.lists.filter((one) => one.folderId !== folderId)].slice(0, 4);
        }
      }
      observed.answered.set(folderId, now);
      observed.lastAt = now;
      schedule();
      return;
    }
    if (HEADER.test(data.url) && data.status === 200) {
      const answer = parseJson(data.body);
      const id = int(answer?.menhFolderId);
      if (id !== null) observed.menhFolderId = id;
      schedule();
      return;
    }
    if (DIRECTORY.test(data.url) && data.status === 200) {
      const answer = parseJson(data.body);
      if (Array.isArray(answer)) {
        observed.directories = answer
          .map((item) => (item && int(item.id) !== null ? { id: item.id, parentId: int(item.parentId) ?? 0, naam: str(item.naam) } : null))
          .filter(Boolean);
        schedule();
      }
    }
  }

  // Only on this screen and only in Better design: elsewhere the page's
  // fetch and XMLHttpRequest stay its own.
  function observe(on) {
    if (!EBS.bridge) return;
    if (on && !observed.on) {
      observed.on = true;
      observed.unsubscribe ??= EBS.bridge.on('observed', onObserved);
      // Named (owner), so a bridge that keeps one list per feature can tell
      // this one apart; the current bridge ignores it.
      EBS.bridge.enable('observe', { urls: OBSERVE, owner: SCREEN });
    } else if (!on && observed.on) {
      observed.on = false;
      EBS.bridge.disable('observe', SCREEN);
      observed.lists = [];
      observed.folderId = null;
      observed.error = null;
      observed.answered.clear();
      observed.lastAt = 0;
    }
  }

  // Whether this visit reads the page's filelist answers at all (the first
  // one of a page load can go out before the hook is on).
  function observing() {
    return observed.on && observed.lastAt > 0;
  }

  // The page's own answer for the folder it shows now, if it could be read.
  function currentList() {
    return observed.lists.find((one) => one.folderId === observed.folderId) ?? null;
  }

  function apiBase() {
    return observed.apiBase ?? `${location.origin}/v1/api/`;
  }

  const two = (number) => String(number).padStart(2, '0');
  const ZONED = /(Z|[+-]\d{2}:?\d{2})$/;

  // "2026-10-28T14:03:12" -> "28-10-2026 14:03", as e-Boekhouden shows it.
  function nativeDate(value) {
    const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
    if (local && !ZONED.test(value)) return `${local[3]}-${local[2]}-${local[1]} ${local[4]}:${local[5]}`;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${two(date.getDate())}-${two(date.getMonth() + 1)}-${date.getFullYear()} ${two(date.getHours())}:${two(date.getMinutes())}`;
  }

  // A moment in local time, { y, mo, d, h, mi, s, time }, from the datum of
  // e-Boekhouden's filelist answer ("2026-10-28T14:32:05"). `time` is false
  // when the value has no time: no time part, or midnight to the second,
  // which is how a date without a time is stored.
  function datumMoment(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value ?? '');
    if (!match) return null;
    if (match[4] !== undefined && ZONED.test(value)) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return null;
      const midnight = date.getUTCHours() + date.getUTCMinutes() + date.getUTCSeconds() === 0;
      return { y: date.getFullYear(), mo: date.getMonth() + 1, d: date.getDate(), h: date.getHours(), mi: date.getMinutes(), s: date.getSeconds(), time: !midnight };
    }
    const [y, mo, d, h, mi, s] = match.slice(1).map((part) => (part === undefined ? 0 : Number(part)));
    return { y, mo, d, h, mi, s, time: h + mi + s > 0 };
  }

  // The same from e-Boekhouden's own text ("28-10-2026 14:32"). Its list
  // always prints a time; 00:00 is a date without one.
  function shownMoment(value) {
    const match = /^(\d{2})-(\d{2})-(\d{4})(?: (\d{2}):(\d{2}))?$/.exec(value ?? '');
    if (!match) return null;
    const [d, mo, y, h, mi] = match.slice(1).map((part) => (part === undefined ? 0 : Number(part)));
    return { y, mo, d, h, mi, s: 0, time: h + mi > 0 };
  }

  // "28-10-2026 14:32", or "28-10-2026" without a time: never a made-up one.
  function showMoment(moment) {
    if (!moment) return '';
    const date = `${two(moment.d)}-${two(moment.mo)}-${moment.y}`;
    return moment.time ? `${date} ${two(moment.h)}:${two(moment.mi)}` : date;
  }

  const stampOf = (moment) => (moment ? ((((moment.y * 100 + moment.mo) * 100 + moment.d) * 100 + moment.h) * 100 + moment.mi) * 100 + moment.s : null);

  const norm = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

  // A folder's id by its path in the tree, from the page's own folder/directory
  // answer; Basismap is 0. Null while that answer is not in, or when two
  // folders have the same path.
  let pathIds = { from: null, ids: null };
  function folderIdOf(folder) {
    if (!folder) return null;
    if (folder.root) return 0;
    const directories = observed.directories;
    if (!directories) return null;
    if (pathIds.from !== directories) {
      const byId = new Map(directories.map((item) => [item.id, item]));
      const ids = new Map();
      for (const item of directories) {
        const path = [];
        for (let at = item; at && path.length < 30; at = at.parentId ? byId.get(at.parentId) : null) path.unshift(norm(at.naam));
        const key = JSON.stringify(path);
        ids.set(key, ids.has(key) ? null : item.id);
      }
      pathIds = { from: directories, ids };
    }
    return pathIds.ids.get(JSON.stringify(folder.path)) ?? null;
  }

  // Id and koppelCount per rendered row, from the page's own filelist answer
  // for this folder (never another folder's: a file of the same name there
  // would get the wrong id): by name, kind and date (minute), then by name and
  // kind, in order.
  function enrich(rows) {
    const list = currentList();
    if (!list) return;
    const exact = new Map();
    const loose = new Map();
    for (const item of list.items) {
      const key = `${item.soort}|${item.naam}|${nativeDate(item.datum)}`;
      (exact.get(key) ?? exact.set(key, []).get(key)).push(item);
      const name = `${item.soort}|${item.naam}`;
      (loose.get(name) ?? loose.set(name, []).get(name)).push(item);
    }
    const used = new Set();
    const take = (candidates) => candidates?.find((item) => !used.has(item.id)) ?? null;
    for (const row of rows) {
      const item = take(exact.get(`${row.soort}|${row.name}|${row.dateText}`)) ?? take(loose.get(`${row.soort}|${row.name}`));
      if (!item) continue;
      used.add(item.id);
      row.id = item.id;
      row.koppelCount = item.koppelCount;
      // The answer's own datum: to the second, and it tells a date without a time.
      row.moment = datumMoment(item.datum) ?? row.moment;
    }
  }

  // -------------------------------------------------------------------------
  // Reading e-Boekhouden's archive components
  // -------------------------------------------------------------------------

  function findNative() {
    const host = document.querySelector('app-digitaal-archief');
    const container = host?.querySelector(':scope > .container-da');
    if (!container) return null;
    return { host, container, main: container.querySelector(':scope > .main') };
  }

  // e-Boekhouden rebuilds its whole folder tree (new elements) each time its
  // folder/directory answer comes in, which is after every folder change.
  // So a click finds the folder in the tree as it is now, by its path, and
  // never uses an element read for an earlier draw: that one may be gone
  // from the page, and a click on it does nothing.
  function liveFolder(path) {
    const host = findNative()?.host;
    if (!host) return null;
    const key = JSON.stringify(path);
    return readFolders(host).find((folder) => JSON.stringify(folder.path) === key) ?? null;
  }

  function readFolders(host) {
    const list = host.querySelector('app-digitaal-archief-folder-list');
    if (!list) return [];
    const folders = [];
    for (const item of list.querySelectorAll('.dir > .dirItem')) {
      const dir = item.parentElement;
      const path = [];
      for (let node = dir; node && node !== list; node = node.parentElement) {
        if (node.classList?.contains('dir') && !node.classList.contains('root')) {
          path.unshift(text(node.querySelector(':scope > .dirItem .dirLabel span')));
        }
      }
      const toggle = item.querySelector('.dirToggle i');
      folders.push({
        item,
        label: item.querySelector('.dirLabel'),
        toggle,
        name: text(item.querySelector('.dirLabel span')),
        path,
        root: dir.classList.contains('root'),
        depth: path.length,
        selected: item.classList.contains('selected'),
        deleted: item.classList.contains('deleted'),
        open: Boolean(toggle?.classList.contains('eb-icon-down-dir')),
      });
    }
    return folders;
  }

  function readHeader(host) {
    const header = host.querySelector('app-digitaal-archief-file-header');
    if (!header) return { name: '', storage: null, isInbox: false };
    const usage = text(header.querySelector('.datagebruik .datalimit-align') ?? header.querySelector('.datagebruik'));
    const match = /\(\s*([^/()]+?)\s*\/\s*([^()]+?)\s*\)/.exec(usage);
    const unit = (value) => value.replace(/\s*(kb|mb|gb|tb|bytes?)$/i, (all, name) => ` ${name.toUpperCase().replace('BYTES', 'bytes').replace('BYTE', 'byte')}`);
    return {
      name: text(header.querySelector('.dirLabel span')),
      storage: match ? { used: unit(match[1]), limit: unit(match[2]) } : null,
      // "Inbox voor 'Mail & Herken'" shows only on the inbox itself; the
      // other folders say "Maak deze map uw inbox voor ...".
      isInbox: /(^|[^a-z])Inbox voor\s+'Mail & Herken'/.test(text(header)),
    };
  }

  function readToolbar(host) {
    const bar = host.querySelector('app-digitaal-archief-knoppenbalk');
    const toolbar = {};
    for (const [key, title] of Object.entries(TOOLBAR)) {
      const node = bar ? [...bar.querySelectorAll('.flexbox > .flex')].find((item) => item.getAttribute('title') === title) : null;
      toolbar[key] = { node, disabled: !node || node.classList.contains('disabled') };
    }
    return toolbar;
  }

  function readDetails(element) {
    if (!element || element.tagName !== 'APP-DIGITAAL-ARCHIEF-KOPPELINGEN') return null;
    // The component renders its content once e-Boekhouden has the details.
    if (!element.firstElementChild) return { loading: true, lines: [] };
    const lines = [];
    for (const line of element.querySelectorAll('.row-nested')) {
      const kind = KOPPEL_KIND[line.closest(KOPPEL_SELECTOR)?.tagName] ?? '';
      const cells = [...line.querySelectorAll('.flex-nested')].filter((cell) => !cell.classList.contains('delete')).map(text).filter(Boolean);
      const parts = kind ? [`${kind} ${cells[0] ?? ''}`.trim(), ...cells.slice(1)] : cells;
      // Relatie: code and name read as one ("Relatie VTEL Voorbeeld Telecom").
      lines.push(kind === 'Relatie' && parts.length > 1 ? `${parts[0]} ${parts[1]}${parts.length > 2 ? ` · ${parts.slice(2).join(' · ')}` : ''}` : parts.join(' · '));
    }
    return { loading: false, lines };
  }

  function readRows(host) {
    const list = host.querySelector('app-digitaal-archief-file-list');
    const body = list?.querySelector('.body');
    if (!body) return { ready: false, rows: [] };
    const rows = [];
    const seen = new Map();
    for (const native of body.children) {
      if (!native.classList.contains('row')) continue;
      const nameNode = native.querySelector('.g-name span[title]') ?? native.querySelector('.g-name span');
      const name = (nameNode?.getAttribute('title') ?? text(nameNode)).trim();
      const soort = native.querySelector('.g-name i')?.className.includes('folder') ? 'D' : 'F';
      const dateText = text(native.querySelector('.g-date'));
      const base = `${soort}|${name}|${dateText}`;
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      const next = native.nextElementSibling;
      const link = native.querySelector('.g-link .spanKoppel');
      const status = text(native.querySelector('.g-status'));
      rows.push({
        key: count === 1 ? base : `${base}|#${count}`,
        native,
        check: native.querySelector('.g-check input[type="checkbox"]'),
        link,
        expanded: Boolean(link?.querySelector('.eb-icon-down-dir')),
        details: readDetails(next),
        name,
        soort,
        dateText,
        moment: shownMoment(dateText),
        date: '',
        stamp: null,
        status: STATUS_TONE[status] ? status : '',
        size: text(native.querySelector('.g-size .size')),
        deleted: native.classList.contains('deleted'),
        hasLinks: Boolean(link),
        id: null,
        koppelCount: null,
        ext: (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? '').toUpperCase(),
      });
    }
    enrich(rows);
    for (const row of rows) {
      // Once expanded, e-Boekhouden's own details are the most current count.
      if (row.details && !row.details.loading) row.koppelCount = row.details.lines.length;
      row.date = showMoment(row.moment) || row.dateText;
      row.stamp = stampOf(row.moment);
    }
    return { ready: true, rows };
  }

  function readUpload(container) {
    const upload = container.querySelector('app-digitaal-archief-upload');
    if (!upload) return null;
    const progress = text(upload.querySelector('app-file-upload-actions'));
    const files = /(\d+)\s*\/\s*(\d+)\s+bestanden/.exec(progress);
    const percent = /(\d{1,3})\s*%/.exec(progress);
    return {
      node: upload,
      total: files ? Number(files[2]) : null,
      percent: percent ? Math.min(100, Number(percent[1])) : 0,
    };
  }

  function readNative() {
    const found = findNative();
    if (!found) return null;
    const { host, container } = found;
    return {
      ...found,
      folders: readFolders(host),
      header: readHeader(host),
      toolbar: readToolbar(host),
      ...readRows(host),
      upload: readUpload(container),
    };
  }

  // -------------------------------------------------------------------------
  // Driving e-Boekhouden's own controls, only in answer to a click of the user
  // -------------------------------------------------------------------------

  // The native context menu stays invisible while this script uses it.
  function menuNode() {
    return document.querySelector('app-digitaal-archief-context-menu .contextMenu');
  }

  function menuOpen() {
    const menu = menuNode();
    return menu && !menu.hasAttribute('custom-hidden') && !menu.classList.contains('calc') ? menu : null;
  }

  function closeMenu() {
    if (!menuOpen()) return;
    // e-Boekhouden closes it on a pointerup or a click outside the menu.
    document.body.dispatchEvent(new (window.PointerEvent ?? MouseEvent)('pointerup', { bubbles: true, cancelable: true }));
    if (menuOpen()) document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  // Right-click the row (e-Boekhouden's own handler builds the menu for it and
  // the selection), then click the item. Returns '' or what went wrong.
  async function runMenuItem(row, label) {
    await afterThisEvent();
    if (!row.native.isConnected) return 'Dit bestand staat niet meer in de lijst.';
    document.documentElement.classList.add('ebs-archive-driving');
    try {
      closeMenu();
      nativeMenu.close();
      const rect = row.native.getBoundingClientRect();
      row.native.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, button: 2, buttons: 2,
        clientX: Math.round(rect.left + 4), clientY: Math.round(rect.top + 4),
      }));
      const item = await waitFor(() => {
        const menu = menuOpen();
        return menu && [...menu.querySelectorAll('.contextMenuItem')].find((node) => text(node) === label);
      });
      if (!item) {
        closeMenu();
        return `"${label}" staat niet in het menu van e-Boekhouden.`;
      }
      if (item.classList.contains('disabled')) {
        closeMenu();
        return `e-Boekhouden staat "${label}" nu niet toe voor dit bestand.`;
      }
      item.click();
      return '';
    } finally {
      // Until the menu has closed, so it never shows up.
      waitFor(() => !menuOpen(), 1500).then(() => document.documentElement.classList.remove('ebs-archive-driving'));
    }
  }

  function clickToolbar(key) {
    const tool = readNative()?.toolbar[key];
    if (!tool?.node) return `De knop "${TOOLBAR[key]}" staat niet meer op de pagina.`;
    if (tool.disabled) return `e-Boekhouden staat "${TOOLBAR[key]}" nu niet toe.`;
    tool.node.click();
    return '';
  }

  // e-Boekhouden's own right-click menu for a row of ours, on the user's
  // right-click: its handler builds the menu for that row (file or folder)
  // and the selection, as on its own list, and the user clicks its items.
  // It places the menu against its .main, which is hidden here, so our
  // stylesheet puts it at the mouse, inside the window.
  const nativeMenu = {
    open(row, event, line) {
      let x = event.clientX;
      let y = event.clientY;
      // From the keyboard (the menu key, Shift+F10): under the row.
      if (!x && !y) {
        const rect = line.getBoundingClientRect();
        x = rect.left + 24;
        y = rect.bottom;
      }
      const html = document.documentElement;
      html.classList.remove('ebs-archive-driving');
      html.classList.add('ebs-archive-menu');
      this.place(x, y);
      row.native.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: Math.round(x), clientY: Math.round(y) }));
      // Angular draws the menu during that event: keep it inside the window.
      const box = menuNode()?.getBoundingClientRect();
      if (box?.width) this.place(Math.min(x, window.innerWidth - box.width - 8), Math.min(y, window.innerHeight - box.height - 8));
    },
    place(x, y) {
      const html = document.documentElement;
      html.style.setProperty('--ebs-ar-menu-x', `${Math.max(8, Math.round(x))}px`);
      html.style.setProperty('--ebs-ar-menu-y', `${Math.max(8, Math.round(y))}px`);
    },
    // Once e-Boekhouden closed it, its menu is its own again.
    update() {
      const html = document.documentElement;
      if (!html.classList.contains('ebs-archive-menu')) return;
      const menu = menuNode();
      if (!menu || menu.hasAttribute('custom-hidden')) this.close();
    },
    close() {
      const html = document.documentElement;
      html.classList.remove('ebs-archive-menu');
      html.style.removeProperty('--ebs-ar-menu-x');
      html.style.removeProperty('--ebs-ar-menu-y');
    },
  };

  const hasFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes('Files');

  // The dropped files, as e-Boekhouden's upload window takes them.
  function transferOf(fileList) {
    if (typeof DataTransfer !== 'function') return null;
    const transfer = new DataTransfer();
    for (const file of fileList ?? []) transfer.items.add(file);
    return transfer.files.length ? transfer : null;
  }

  // e-Boekhouden downloads a file on a double-click of its row.
  function download(row) {
    if (!row.native.isConnected) return;
    row.native.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  }

  // The native checkboxes carry the selection; ours only mirror them.
  function setChecked(rows, checked) {
    for (const row of rows) {
      if (row.check && row.check.checked !== checked) row.check.click();
    }
  }

  // Waiting buttons: "Bezig…", disabled and aria-busy until the answer.
  async function busy(node, work) {
    if (node.getAttribute('aria-busy') === 'true') return;
    const label = node.querySelector('.ebs-ar-label');
    const before = label?.textContent ?? '';
    node.setAttribute('aria-busy', 'true');
    node.disabled = true;
    if (label) label.textContent = 'Bezig…';
    try {
      return await work();
    } finally {
      node.removeAttribute('aria-busy');
      if (label) label.textContent = before;
      node.disabled = false;
      schedule();
    }
  }

  // -------------------------------------------------------------------------
  // View state
  // -------------------------------------------------------------------------

  const ui = {
    query: '',
    quick: 'all',
    // Datum, newest first; a click on the column turns it round.
    sortDir: 'desc',
    // Key of the row in the preview, and of the shift-select anchor.
    previewKey: null,
    anchorKey: null,
    // The row that has the cursor after Terug: the folder you came from. Its
    // name until the parent's rows are in, then its key.
    cursorName: null,
    cursorKey: null,
    // A folder load the user started (see startLoad), until its answer is in.
    pending: null,
    // A load that got no answer in time: { at, signature }, until the answer
    // comes after all or e-Boekhouden draws other rows.
    failure: null,
    // Since when the view waits for e-Boekhouden's first list on this visit.
    bootSince: 0,
    // The id of the folder the tree showed at the last draw (null: unknown).
    selectedId: null,
    emptySince: 0,
    rowsWaitSince: 0,
    shownState: '',
    inboxCount: null,
    inboxAsked: null,
    // Path of the inbox folder, learned from e-Boekhouden's header.
    inboxPath: null,
    messages: { bar: '', preview: '' },
  };

  const collator = new Intl.Collator('nl', { numeric: true, sensitivity: 'base' });

  // Folders first, then files; each newest first (or oldest first with the
  // column turned round), then by name. Without a date: last.
  function sortRows(rows) {
    const sign = ui.sortDir === 'asc' ? 1 : -1;
    return rows.sort((a, b) => {
      if (a.soort !== b.soort) return a.soort === 'D' ? -1 : 1;
      if (a.stamp !== b.stamp) {
        if (a.stamp === null) return 1;
        if (b.stamp === null) return -1;
        return sign * (a.stamp - b.stamp);
      }
      return collator.compare(a.name, b.name);
    });
  }

  function visibleRows(rows) {
    const needle = ui.query.trim().toLowerCase();
    return sortRows(rows.filter((row) => {
      if (ui.quick !== 'all' && row.soort !== 'F') return false;
      if (ui.quick === 'without' && row.hasLinks) return false;
      if (ui.quick === 'with' && !row.hasLinks) return false;
      if (ui.quick === 'recognized' && row.status !== 'Is herkend') return false;
      if (needle && ![row.name, row.date, row.status].join(' ').toLowerCase().includes(needle)) return false;
      return true;
    }));
  }

  function rowsSignature(rows) {
    return rows.map((row) => row.key).join('\n');
  }

  // One render when `time` comes, for a wait that no change of the page ends.
  let wake = { timer: null, at: 0 };
  function wakeAt(time) {
    if (wake.timer && wake.at <= time) return;
    clearTimeout(wake.timer);
    wake = {
      at: time,
      timer: setTimeout(() => {
        wake = { timer: null, at: 0 };
        schedule();
      }, Math.max(0, time - Date.now()) + 20),
    };
  }

  // A folder load starts with the user's click on a folder, a folder row,
  // Terug, a drop on a folder or the refresh: { since, folderId (null when
  // the view cannot tell it yet), name, headerBefore, signature, refresh,
  // dim }. It ends when e-Boekhouden's answer for that folder is in, when its
  // rows are on screen, or after LOAD_TIMEOUT with "Kon de map niet laden".
  // It never waits for e-Boekhouden's header: that skips a folder change
  // while its own GET still runs (its loadDirectory has a `loading` guard),
  // so after a quick second click, or a click during the first load of the
  // screen, the header keeps the folder before.
  function startLoad({ folderId = null, name = '', refresh = false, dim = false } = {}) {
    const native = view.native;
    ui.pending = {
      since: Date.now(), folderId, name, headerBefore: native?.header.name ?? '',
      signature: rowsSignature(native?.rows ?? []), refresh, dim,
    };
    ui.failure = null;
    ui.emptySince = 0;
    ui.rowsWaitSince = 0;
    wakeAt(ui.pending.since + LOAD_TIMEOUT);
  }

  function answeredSince(folderId, since) {
    return (folderId === null ? observed.lastAt : observed.answered.get(folderId) ?? 0) > since;
  }

  // The state of the list, and whether to hold what is on screen meanwhile
  // (e-Boekhouden empties its list for a moment before it draws the new
  // rows; a refresh keeps the rows, dimmed). Every wait has an end: a
  // timer wakes the view when no change of the page does.
  function listState(native, visible) {
    const now = Date.now();
    const signature = rowsSignature(native.rows);
    const selected = native.folders.find((folder) => folder.selected) ?? null;
    const selectedId = folderIdOf(selected);
    // The folder the tree shows changed. A load of ours that could not tell
    // its folder at the click now waits for this one's answer, not for any
    // answer. A change e-Boekhouden made itself (a new folder, Naam wijzigen
    // on a folder, a deleted folder, its upload item on a folder) is a load
    // too: its answer is on its way, so the rows still on screen are no error.
    if (selectedId !== null && selectedId !== ui.selectedId) {
      const before = ui.selectedId;
      ui.selectedId = selectedId;
      if (ui.pending?.folderId === null) ui.pending.folderId = selectedId;
      else if (!ui.pending && before !== null && observing() && observed.folderId !== selectedId) startLoad({ folderId: selectedId, name: folderLabel(selected) });
    }
    const pending = ui.pending;
    if (pending) {
      const changed = signature !== pending.signature;
      // Without the page's answers on this visit, the rows (or, from one empty
      // folder to another, the header) tell that the folder is in.
      const blind = !observing();
      const headerMoved = blind && !signature && !pending.signature && pending.name && native.header.name === pending.name && native.header.name !== pending.headerBefore;
      if (answeredSince(pending.folderId, pending.since) || (changed && (blind || pending.folderId === null)) || headerMoved) {
        ui.pending = null;
      } else if (now - pending.since >= LOAD_TIMEOUT) {
        ui.pending = null;
        // No answer and nothing new on screen. A refresh that cannot be
        // watched (no answer read on this visit) ends quietly.
        if (!changed && !(pending.refresh && blind)) ui.failure = { at: now, signature };
      } else {
        wakeAt(pending.since + LOAD_TIMEOUT);
        return pending.dim && ui.shownState ? { state: ui.shownState, hold: true } : { state: 'loading', hold: false };
      }
    }
    if (ui.failure) {
      if (answeredSince(selectedId, ui.failure.at) || signature !== ui.failure.signature) ui.failure = null;
      else return { state: 'failed', hold: false };
    }
    // e-Boekhouden shows its newest answer, also one for a folder clicked
    // earlier that came in last: then these rows are not the chosen folder's.
    if (observing() && selectedId !== null && observed.folderId !== null && observed.folderId !== selectedId) {
      // The chosen folder was asked before the first answer of this visit
      // came in: its answer is still to come.
      if (!observed.answered.has(selectedId)) {
        startLoad({ folderId: selectedId, name: folderLabel(selected) });
        return { state: 'loading', hold: false };
      }
      return { state: 'mismatch', hold: false };
    }
    if (observed.error && observed.error.folderId === observed.folderId && observed.error.at >= (currentList()?.at ?? 0)) return { state: 'error', hold: false };
    if (!native.ready) {
      ui.bootSince ||= now;
      if (now - ui.bootSince < LOAD_TIMEOUT) {
        wakeAt(ui.bootSince + LOAD_TIMEOUT);
        return { state: 'loading', hold: false };
      }
      ui.failure = { at: now, signature };
      return { state: 'failed', hold: false };
    }
    ui.bootSince = 0;
    const hold = (until) => {
      wakeAt(until);
      return ui.shownState ? { state: ui.shownState, hold: true } : { state: 'loading', hold: false };
    };
    if (!native.rows.length) {
      const list = currentList();
      const expected = list ? list.items.length : null;
      if (expected) {
        // The answer has files: e-Boekhouden draws them in a moment.
        ui.rowsWaitSince ||= now;
        if (now - ui.rowsWaitSince < ROWS_GRACE) return hold(ui.rowsWaitSince + ROWS_GRACE);
        ui.rowsWaitSince = 0;
        ui.failure = { at: now, signature };
        return { state: 'failed', hold: false };
      }
      ui.rowsWaitSince = 0;
      // Without its answer an empty folder counts after 300 ms without rows.
      if (expected !== 0) {
        ui.emptySince ||= now;
        if (now - ui.emptySince < 300) return hold(ui.emptySince + 300);
      }
      return { state: 'empty', hold: false };
    }
    ui.emptySince = 0;
    ui.rowsWaitSince = 0;
    return { state: visible.length ? 'rows' : 'nomatch', hold: false };
  }

  // The folder that has the selected folder in it, as the tree shows them.
  function parentOf(folders) {
    const current = folders.find((folder) => folder.selected) ?? null;
    if (!current || current.root) return { current, parent: null };
    const path = JSON.stringify(current.path.slice(0, -1));
    return { current, parent: folders.find((folder) => JSON.stringify(folder.path) === path) ?? null };
  }

  const folderLabel = (folder) => (folder.root ? 'Basismap' : folder.name);

  function adminNumber() {
    const number = document.querySelector('app-header-identity-b .administratieId, app-header-identity #administratieId, app-header-identity .administratieId')?.textContent.trim();
    return /^\d{1,12}$/.test(number ?? '') ? number : null;
  }

  // e-Boekhouden's own Mail & Herken page builds the address this way.
  function menhAddress() {
    const number = adminNumber();
    if (!number) return null;
    const domain = location.hostname.endsWith('.be') ? 'e-Boekhouden.be' : 'e-Boekhouden.nl';
    return `1${number}herken@${domain}`;
  }

  function inboxFolder(folders) {
    const directories = observed.directories;
    if (observed.menhFolderId !== null && directories) {
      const byId = new Map(directories.map((item) => [item.id, item]));
      const path = [];
      for (let item = byId.get(observed.menhFolderId); item && path.length < 30; item = byId.get(item.parentId)) {
        path.unshift(item.naam);
        if (!item.parentId) break;
      }
      const found = folders.find((folder) => !folder.root && folder.path.join('/') === path.join('/'));
      if (found) return found;
    }
    if (ui.inboxPath) return folders.find((folder) => !folder.root && folder.path.join('/') === ui.inboxPath) ?? null;
    return null;
  }

  // One bulk GET per screen load, for the badge on the inbox.
  function askInboxCount() {
    if (ui.inboxAsked === location.href || !EBS.request) return;
    ui.inboxAsked = location.href;
    EBS.request.bulk('archive:inbox-count', `${apiBase()}folder/unprocessed/count`).then((answer) => {
      const value = typeof answer === 'number' ? answer : [answer?.count, answer?.value, answer?.aantal, answer?.data].find((one) => typeof one === 'number');
      ui.inboxCount = Number.isSafeInteger(value) && value >= 0 ? value : null;
      schedule();
    }, (error) => {
      console.warn('EB Sessions: inbox count not loaded', error?.code ?? error?.message ?? error);
    });
  }

  // -------------------------------------------------------------------------
  // The preview: one GET per click of the user on one file
  // -------------------------------------------------------------------------

  const preview = {
    key: null,
    state: 'none',
    url: null,
    kind: null,
    message: '',
    controller: null,

    reset() {
      this.controller?.abort();
      this.controller = null;
      if (this.url) URL.revokeObjectURL?.(this.url);
      this.url = null;
      this.kind = null;
      this.key = null;
      this.state = 'none';
      this.message = '';
    },

    // Only from a click or key of the user on this one row.
    open(row) {
      if (this.key === row.key && this.state !== 'error') return;
      this.reset();
      this.key = row.key;
      ui.previewKey = row.key;
      if (!PREVIEW_PDF.test(row.name) && !PREVIEW_IMAGE.test(row.name)) {
        this.state = 'unsupported';
        schedule();
        return;
      }
      if (row.id === null) {
        this.state = 'error';
        this.message = 'Het voorbeeld is er nog niet: e-Boekhouden gaf de lijst van deze map niet door. Kies de map opnieuw.';
        schedule();
        return;
      }
      this.state = 'loading';
      const controller = new AbortController();
      this.controller = controller;
      const key = row.key;
      let request;
      try {
        request = EBS.request.item(`archive:preview:${row.id}`, `${apiBase()}folder/${row.id}/preview?inline=true`, { userAction: true, as: 'blob', signal: controller.signal });
      } catch (error) {
        request = Promise.reject(error);
      }
      request.then((blob) => {
        if (this.key !== key) return;
        const type = String(blob?.type ?? '').split(';')[0].trim().toLowerCase();
        const kind = Object.hasOwn(PREVIEW_TYPES, type) ? PREVIEW_TYPES[type] : null;
        if (!kind || typeof URL.createObjectURL !== 'function') {
          this.state = 'error';
          this.message = 'e-Boekhouden gaf geen voorbeeld van dit bestand terug.';
        } else {
          // The URL carries exactly the checked type, so the frame shows a PDF
          // (or the img an image) and never a page with script.
          this.url = URL.createObjectURL(blob.type === type ? blob : new Blob([blob], { type }));
          this.kind = kind;
          this.state = 'ready';
        }
        schedule();
      }, (error) => {
        if (this.key !== key || error?.code === 'abort') return;
        this.state = 'error';
        // A request layer without 'blob' rejects the option itself.
        this.message = error instanceof TypeError
          ? 'Het voorbeeld vraagt een nieuwere versie van de extensie. Downloaden werkt wel.'
          : error?.code === 'rate' || error?.code === 'user-action'
            ? 'Even geduld: klik over een paar seconden opnieuw op het bestand.'
            : 'Het voorbeeld kon niet worden geladen. Downloaden werkt wel.';
        schedule();
      });
      schedule();
    },
  };

  // -------------------------------------------------------------------------
  // The view
  // -------------------------------------------------------------------------

  const view = {
    root: null,
    native: null,
    rows: [],
    rowNodes: new Map(),
    // A row to give the focus once it is drawn (after Terug).
    focusKey: null,

    mount(native) {
      if (this.root?.isConnected && this.root.parentElement === native.container) return;
      this.unmount();
      this.root = el('div', 'ebs-ar');
      this.build();
      native.container.prepend(this.root);
      this.bar.build();
    },

    unmount() {
      this.root?.remove();
      this.root = null;
      this.rowNodes.clear();
      this.bar.remove();
      preview.reset();
      ui.previewKey = null;
      ui.cursorKey = null;
      ui.cursorName = null;
      ui.pending = null;
      ui.failure = null;
      ui.bootSince = 0;
      ui.selectedId = null;
      ui.shownState = '';
      nativeMenu.close();
    },

    build() {
      const head = el('div', 'ebs-ar-head');
      const titles = el('div', 'ebs-ar-titles');
      titles.append(el('h1', '', 'Digitaal archief'));
      this.subtitle = el('span', 'ebs-ar-subtitle');
      titles.append(this.subtitle);
      const actions = el('div', 'ebs-ar-head-actions');
      const classic = el('a', 'ebs-ar-classic', 'Klassieke weergave');
      classic.href = '#';
      classic.setAttribute('role', 'button');
      classic.addEventListener('click', (event) => {
        event.preventDefault();
        setClassic(true);
      });
      this.newFolder = button('ebs-ar-button', 'Nieuwe map', () => this.toolbarAction(this.newFolder, 'newFolder'), 'folder-plus');
      this.paste = button('ebs-ar-button', 'Plakken hier', () => this.toolbarAction(this.paste, 'paste'), 'clipboard-paste');
      this.uploadButton = button('ebs-ar-button primary', 'Bestanden uploaden', () => this.toolbarAction(this.uploadButton, 'upload'), 'upload');
      actions.append(classic, this.newFolder, this.paste, this.uploadButton);
      // Over the space under the buttons, so nothing moves when it shows.
      this.headMessage = el('span', 'ebs-ar-head-message');
      this.headMessage.setAttribute('role', 'alert');
      head.append(titles, actions, this.headMessage);

      const grid = el('div', 'ebs-ar-grid');

      this.nav = el('nav', 'ebs-ar-nav');
      this.nav.setAttribute('aria-label', 'Mappen');
      this.folderList = el('div', 'ebs-ar-folders');
      this.menh = el('span', 'ebs-ar-menh');
      this.nav.append(this.folderList, this.menh);

      const files = el('section', 'ebs-ar-files');
      files.setAttribute('aria-label', 'Bestanden');
      this.files = files;
      // Backspace and Alt+pijl omhoog go up one folder, as Terug does, but
      // not while typing in the search field.
      files.addEventListener('keydown', (event) => {
        if (!event.isTrusted || event.defaultPrevented) return;
        const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
        const up = (event.key === 'Backspace' && plain) || (event.key === 'ArrowUp' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey);
        if (!up || event.target.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
        event.preventDefault();
        this.goUp();
      });
      const tools = el('div', 'ebs-ar-tools');
      // Terug: always in its place, off in Basismap (as Finder and Verkenner),
      // so the toolbar never shifts.
      this.back = el('button', 'ebs-ar-iconbutton ebs-ar-back');
      this.back.type = 'button';
      this.back.setAttribute('aria-keyshortcuts', 'Backspace Alt+ArrowUp');
      this.backTip = el('span', 'ebs-ar-tip l');
      this.backTip.setAttribute('role', 'tooltip');
      this.backTip.setAttribute('aria-hidden', 'true');
      this.back.append(EBS.icon('arrow-left'), this.backTip);
      this.back.addEventListener('click', (event) => {
        if (event.isTrusted) this.goUp();
      });
      // Vernieuwen: e-Boekhouden's own Lijst vernieuwen, in the user's click.
      this.refreshButton = el('button', 'ebs-ar-iconbutton ebs-ar-refresh');
      this.refreshButton.type = 'button';
      const spin = el('span', 'ebs-ar-spin');
      spin.append(EBS.icon('rotate-cw'));
      this.refreshTip = el('span', 'ebs-ar-tip r');
      this.refreshTip.setAttribute('role', 'tooltip');
      this.refreshTip.setAttribute('aria-hidden', 'true');
      this.refreshButton.append(spin, this.refreshTip);
      this.refreshButton.addEventListener('click', (event) => {
        if (!event.isTrusted || this.refreshButton.getAttribute('aria-disabled') === 'true' || ui.pending?.refresh) return;
        this.reloadFolder();
      });
      const search = el('label', 'ebs-ar-search');
      search.append(EBS.icon('search'));
      this.searchInput = el('input');
      this.searchInput.type = 'search';
      this.searchInput.placeholder = 'Zoek op naam, datum of status in deze map';
      this.searchInput.setAttribute('aria-label', 'Zoeken in deze map');
      this.searchInput.addEventListener('input', () => {
        ui.query = this.searchInput.value;
        this.draw();
      });
      search.append(this.searchInput);
      this.chips = el('span', 'ebs-ar-chips');
      // Search and quick-selects wrap between Terug and Vernieuwen, which
      // keep their corners.
      const toolsMain = el('div', 'ebs-ar-tools-main');
      toolsMain.append(search, this.chips);
      tools.append(this.back, toolsMain, this.refreshButton);

      const headRow = el('div', 'ebs-ar-row ebs-ar-row-head');
      this.allCheck = el('button', 'ebs-ar-check');
      this.allCheck.type = 'button';
      this.allCheck.setAttribute('role', 'checkbox');
      this.allCheck.setAttribute('aria-label', 'Alles in beeld selecteren');
      this.allCheck.append(EBS.icon('check', { size: 14 }));
      this.allCheck.addEventListener('click', () => this.toggleAll());
      this.sortButton = el('button', 'ebs-ar-sort');
      this.sortButton.type = 'button';
      this.sortButton.addEventListener('click', () => {
        ui.sortDir = ui.sortDir === 'desc' ? 'asc' : 'desc';
        this.draw();
      });
      headRow.append(this.allCheck, el('span', '', 'Bestand'), this.sortButton, el('span', '', 'Status'), el('span', '', 'Koppelingen'));

      this.scroll = el('div', 'ebs-ar-scroll');
      // Holds the focus when the focused row goes (a folder opened from the
      // keyboard), so Backspace and Alt+pijl omhoog keep working.
      this.scroll.tabIndex = -1;
      this.skeleton = el('div', 'ebs-ar-skeleton');
      this.skeleton.setAttribute('aria-busy', 'true');
      this.skeleton.setAttribute('aria-label', 'De bestanden worden geladen');
      for (const width of [180, 240, 150, 210, 170, 230]) {
        const line = el('div', 'ebs-ar-row ebs-ar-skel');
        const name = el('span', 'ebs-ar-skel-name');
        name.style.width = `${width}px`;
        line.append(el('span', 'ebs-ar-skel-box'), name, el('span', 'ebs-ar-skel-date'), el('span', 'ebs-ar-skel-pill'), el('span', 'ebs-ar-skel-link'));
        this.skeleton.append(line);
      }
      this.body = el('div', 'ebs-ar-body');
      this.body.addEventListener('mousemove', (event) => this.previewRange(event), { passive: true });
      this.body.addEventListener('mouseleave', () => this.previewRange(null));
      this.more = el('div', 'ebs-ar-more');
      this.empty = el('div', 'ebs-ar-empty');
      this.emptyTitle = el('span', 'ebs-ar-empty-title');
      this.emptyText = el('span', 'ebs-ar-empty-text');
      this.emptyAction = button('ebs-ar-button primary small', '', () => this.emptyClick());
      this.empty.append(this.emptyTitle, this.emptyText, this.emptyAction);
      this.error = el('div', 'ebs-ar-error');
      this.error.setAttribute('role', 'alert');
      const errorCopy = el('span', 'ebs-ar-error-copy');
      this.errorTitle = el('strong', 'ebs-ar-error-title');
      this.errorText = el('span', 'ebs-ar-error-text');
      errorCopy.append(this.errorTitle, this.errorText);
      this.reload = button('ebs-ar-button small', 'Opnieuw laden', (event) => {
        if (event.isTrusted) this.reloadFolder();
      }, 'rotate-cw');
      this.reload.title = 'Lijst vernieuwen van e-Boekhouden, zoals de knop rechtsboven';
      this.error.append(errorCopy, this.reload);
      this.uploadStatus = el('div', 'ebs-ar-upload');
      this.uploadStatus.setAttribute('role', 'status');
      this.uploadTitle = el('span', 'ebs-ar-upload-title');
      const track = el('span', 'ebs-ar-progress');
      this.uploadBar = el('span', 'ebs-ar-progress-bar');
      track.append(this.uploadBar);
      this.uploadStatus.append(this.uploadTitle, track, el('span', 'ebs-ar-upload-note', 'Dit is het uploadvenster van e-Boekhouden zelf. Je kunt intussen verder werken.'));
      this.scroll.append(this.skeleton, this.body, this.more, this.empty, this.error, this.uploadStatus);
      files.append(tools, headRow, this.scroll);
      this.dropTarget(files);

      this.aside = el('aside', 'ebs-ar-preview');
      this.aside.setAttribute('aria-label', 'Voorbeeld');
      this.buildPreview();

      grid.append(this.nav, files, this.aside);
      this.root.append(head, grid);
    },

    buildPreview() {
      const top = el('div', 'ebs-ar-preview-head');
      this.previewName = el('span', 'ebs-ar-preview-name');
      this.previewMeta = el('span', 'ebs-ar-preview-meta');
      top.append(this.previewName, this.previewMeta);
      this.previewStage = el('div', 'ebs-ar-preview-stage');
      const foot = el('div', 'ebs-ar-preview-foot');
      this.previewLinks = el('span', 'ebs-ar-preview-links');
      this.previewAlso = el('span', 'ebs-ar-preview-note');
      const note = el('span', 'ebs-ar-preview-note', 'Deze knoppen zijn de items uit het rechtermuismenu van e-Boekhouden.');
      const buttons = el('div', 'ebs-ar-preview-buttons');
      this.previewPrimary = button('ebs-ar-pbutton green', 'Invoeren als mutatie', () => this.previewAction('primary'));
      this.previewRelation = button('ebs-ar-pbutton', 'Koppelen aan relatie', () => this.previewAction('relation'));
      this.previewDownload = button('ebs-ar-pbutton', 'Downloaden', () => this.previewAction('download'), 'download');
      this.previewRename = button('ebs-ar-pbutton', 'Naam wijzigen', () => this.previewAction('rename'));
      buttons.append(this.previewPrimary, this.previewRelation, this.previewDownload, this.previewRename);
      this.previewMessage = el('span', 'ebs-ar-message');
      this.previewMessage.setAttribute('role', 'alert');
      foot.append(this.previewLinks, this.previewAlso, note, buttons, this.previewMessage);
      this.previewFile = el('div', 'ebs-ar-preview-file');
      this.previewFile.append(top, this.previewStage, foot);
      this.previewNone = el('div', 'ebs-ar-preview-none');
      this.aside.append(this.previewFile, this.previewNone);
    },

    // Files dropped on the list go to e-Boekhouden's own upload window, as if
    // dropped there; uploading still takes its "Start upload". On a folder
    // row they go to that folder (see makeRow).
    dropTarget(files) {
      files.addEventListener('dragover', (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        files.classList.add('dragging');
      });
      files.addEventListener('dragleave', (event) => {
        if (!files.contains(event.relatedTarget)) files.classList.remove('dragging');
      });
      files.addEventListener('drop', (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        files.classList.remove('dragging');
        const transfer = transferOf(event.dataTransfer.files);
        if (transfer) this.uploadFiles(transfer);
      });
    },

    // Into e-Boekhouden's own upload window, for the folder that is open.
    async uploadFiles(transfer) {
      const problem = readNative()?.upload ? '' : clickToolbar('upload');
      if (problem) {
        this.headMessage.textContent = problem;
        return;
      }
      const zone = await waitFor(() => document.querySelector('app-digitaal-archief-upload app-file-upload-list .file-container'));
      zone?.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    },

    // Dropped on a folder row: that folder opens (e-Boekhouden uploads to the
    // folder that is open), then its upload window gets the files.
    async uploadToFolder(row, fileList) {
      const transfer = transferOf(fileList);
      if (!transfer) return;
      this.headMessage.textContent = '';
      this.activate(row);
      // Until the folder is in: its answer can come before e-Boekhouden has
      // drawn its rows, and the view still says loading then.
      const settled = () => {
        const state = ui.pending ? null : this.root?.dataset.state;
        return state && state !== 'loading' ? state : null;
      };
      const state = await waitFor(settled, LOAD_TIMEOUT + ROWS_GRACE + 1000);
      const open = this.native?.folders.find((folder) => folder.selected);
      if (!['rows', 'empty', 'nomatch'].includes(state) || open?.name !== row.name) {
        this.headMessage.textContent = `De map "${row.name}" ging niet open, dus er is niets geüpload. Probeer het opnieuw.`;
        return;
      }
      await this.uploadFiles(transfer);
    },

    async toolbarAction(node, key) {
      ui.messages.bar = '';
      this.headMessage.textContent = '';
      await busy(node, async () => {
        await afterThisEvent();
        const problem = clickToolbar(key);
        if (problem) this.headMessage.textContent = problem;
      });
    },

    // e-Boekhouden's own Lijst vernieuwen, only from a trusted click (the
    // refresh button, or Opnieuw proberen). Rows on screen stay, dimmed,
    // until the answer is in: no skeleton.
    reloadFolder() {
      const native = this.native;
      if (!native) return;
      this.headMessage.textContent = '';
      const selected = native.folders.find((folder) => folder.selected) ?? null;
      startLoad({
        folderId: folderIdOf(selected),
        name: selected ? folderLabel(selected) : '',
        refresh: true,
        dim: ['rows', 'empty', 'nomatch'].includes(ui.shownState),
      });
      const problem = clickToolbar('refresh');
      if (problem) {
        ui.pending = null;
        this.headMessage.textContent = problem;
      }
      this.draw();
    },

    // One folder up, as Terug, Backspace and Alt+pijl omhoog. Once the
    // parent's rows are in, the folder you came from has the cursor, so
    // Enter goes back in.
    goUp() {
      const host = findNative()?.host;
      if (!host || !this.native) return;
      const { current, parent } = parentOf(readFolders(host));
      if (!parent) return;
      this.openFolder(parent);
      ui.cursorName = current.name;
    },

    emptyClick() {
      if (ui.query || ui.quick !== 'all') {
        ui.query = '';
        ui.quick = 'all';
        this.searchInput.value = '';
        this.draw();
        this.searchInput.focus();
        return;
      }
      this.toolbarAction(this.emptyAction, 'upload');
    },

    openFolder(folder) {
      if (!folder?.label?.isConnected) {
        this.headMessage.textContent = 'Deze map staat niet meer in de lijst van e-Boekhouden.';
        return;
      }
      this.headMessage.textContent = '';
      preview.reset();
      ui.previewKey = null;
      ui.anchorKey = null;
      ui.cursorKey = null;
      ui.cursorName = null;
      startLoad({ folderId: folderIdOf(folder), name: folderLabel(folder) });
      folder.label?.click();
      this.draw();
    },

    toggleFolder(folder) {
      if (folder?.toggle?.isConnected) folder.toggle.click();
      schedule();
    },

    // What e-Boekhouden shows now, for an action of the user.
    fresh() {
      const native = readNative();
      if (native) this.native = native;
      return this.native;
    },

    toggleAll() {
      const visible = visibleRows(this.fresh()?.rows ?? []);
      const every = visible.length > 0 && visible.every((row) => row.check?.checked);
      setChecked(visible, !every);
      ui.anchorKey = null;
      schedule();
    },

    toggleRow(row, shift) {
      const visible = visibleRows(this.fresh().rows);
      const at = visible.findIndex((one) => one.key === row.key);
      const from = ui.anchorKey ? visible.findIndex((one) => one.key === ui.anchorKey) : -1;
      if (shift && from >= 0 && at >= 0 && from !== at) {
        // Every row from the anchor to this one takes the anchor's state.
        const want = Boolean(visible[from].check?.checked);
        const flips = EBS.rangeToggles(visible.map((one) => Boolean(one.check?.checked)), from, at);
        setChecked(flips.map((index) => visible[index]), want);
      } else {
        setChecked([row], !row.check?.checked);
      }
      ui.anchorKey = row.key;
      schedule();
    },

    // Shift held over a row: the range a shift-click would touch.
    previewRange(event) {
      const target = event?.shiftKey ? event.target.closest?.('.ebs-ar-item') : null;
      const visible = visibleRows(this.native?.rows ?? []);
      const from = ui.anchorKey ? visible.findIndex((one) => one.key === ui.anchorKey) : -1;
      const over = target ? visible.findIndex((one) => one.key === target.dataset.key) : -1;
      const range = new Set();
      if (from >= 0 && over >= 0) {
        for (let i = Math.min(from, over); i <= Math.max(from, over); i += 1) range.add(visible[i].key);
      }
      for (const [key, node] of this.rowNodes) node.firstElementChild.classList.toggle('ebs-ar-range', range.has(key));
    },

    // The row as e-Boekhouden has it now: its list too renders new elements
    // with each answer.
    rowByKey(key) {
      const row = this.native?.rows.find((one) => one.key === key) ?? null;
      if (!row || row.native.isConnected) return row;
      const fresh = readNative();
      if (fresh) this.native = fresh;
      return fresh?.rows.find((one) => one.key === key) ?? null;
    },

    activate(row) {
      ui.cursorKey = null;
      ui.cursorName = null;
      if (row.soort === 'D') {
        // A folder in the list opens, as with e-Boekhouden's double-click.
        startLoad({ folderId: row.id, name: row.name });
        preview.reset();
        ui.previewKey = null;
        ui.anchorKey = null;
        download(row);
        this.draw();
        return;
      }
      ui.messages.preview = '';
      preview.open(row);
      this.draw();
    },

    async toggleLinks(row) {
      row.link?.click();
      schedule();
    },

    async previewAction(kind) {
      const row = this.rowByKey(ui.previewKey);
      if (!row) return;
      ui.messages.preview = '';
      const node = { primary: this.previewPrimary, relation: this.previewRelation, download: this.previewDownload, rename: this.previewRename }[kind];
      await busy(node, async () => {
        let problem = '';
        if (kind === 'primary' && row.hasLinks) {
          await afterThisEvent();
          if (!row.expanded) row.link?.click();
          this.rowNodes.get(row.key)?.scrollIntoView?.({ block: 'nearest' });
        } else if (kind === 'primary') {
          problem = await runMenuItem(row, MENU.enter);
        } else if (kind === 'relation') {
          problem = await runMenuItem(row, MENU.linkRelation);
        } else if (kind === 'rename') {
          problem = await runMenuItem(row, MENU.rename);
        } else {
          await afterThisEvent();
          download(row);
        }
        ui.messages.preview = problem;
      });
    },

    draw() {
      if (!this.root || !this.native) return;
      const native = this.native;
      const rows = native.rows;
      const visible = visibleRows(rows);
      const { state, hold } = listState(native, visible);
      const files = rows.filter((row) => row.soort === 'F');
      // The tree shows the chosen folder at once; e-Boekhouden's header can
      // lag a folder behind (see startLoad).
      const selected = native.folders.find((folder) => folder.selected) ?? null;
      const folderName = selected ? folderLabel(selected) : native.header.name;
      if (native.header.isInbox && selected && !selected.root && native.header.name === selected.name) ui.inboxPath = selected.path.join('/');

      this.drawFolders(native);
      this.drawTools(native, state);
      // Until e-Boekhouden's rows are in, what is on screen stays as it is.
      if (hold) return;

      // Header.
      const storage = native.header.storage ? ` · ${native.header.storage.used} van ${native.header.storage.limit} gebruikt` : '';
      const loaded = state === 'loading' ? 'Bestanden laden…'
        : files.length >= MANY ? `${files.length} bestanden in ${folderName}, in één keer geladen`
          : `${plural(files.length, 'bestand', 'bestanden')} in ${folderName}`;
      this.subtitle.textContent = `${loaded}${storage}`;
      for (const [node, key] of [[this.newFolder, 'newFolder'], [this.paste, 'paste'], [this.uploadButton, 'upload']]) {
        if (node.getAttribute('aria-busy') !== 'true') node.disabled = native.toolbar[key].disabled;
      }
      this.paste.title = native.toolbar.paste.disabled ? 'Eerst knippen in een andere map; daarna plak je hier' : 'Plak de geknipte bestanden in deze map';

      this.drawChips(files);

      // The list and its states.
      const failed = state === 'error' || state === 'failed' || state === 'mismatch';
      this.root.dataset.state = state;
      if (state !== ui.shownState) {
        for (const node of [this.empty, this.error, this.uploadStatus, this.more]) node.classList.remove('ebs-ar-in');
        const shown = failed ? this.error : { empty: this.empty, nomatch: this.empty }[state];
        if (shown && ui.shownState) shown.classList.add('ebs-ar-in');
        ui.shownState = state;
      }
      const focusHere = this.body.contains(document.activeElement) && state !== 'rows';
      this.skeleton.hidden = state !== 'loading';
      this.body.hidden = state !== 'rows';
      if (focusHere) this.scroll.focus({ preventScroll: true });
      this.empty.hidden = state !== 'empty' && state !== 'nomatch';
      this.error.hidden = !failed;
      if (state === 'empty') {
        this.emptyTitle.textContent = 'Deze map is leeg';
        this.emptyText.textContent = 'Sleep bestanden hierheen of upload ze. Pdf, jpg en png krijgen een voorbeeld; e-Boekhouden kan ze ook herkennen.';
        setLabel(this.emptyAction, 'Bestanden uploaden');
        this.emptyAction.disabled = native.toolbar.upload.disabled;
      } else if (state === 'nomatch') {
        const quickLabel = { without: 'Zonder koppeling', with: 'Met koppeling', recognized: 'Herkend, nog invoeren' }[ui.quick];
        if (ui.query.trim()) {
          this.emptyTitle.textContent = `Niets gevonden voor "${ui.query.trim()}"`;
          this.emptyText.textContent = 'Er is gezocht in naam, datum en status van alle bestanden in deze map. Relatie en bedrag staan niet in de lijst van e-Boekhouden.';
          setLabel(this.emptyAction, 'Zoekterm wissen');
        } else {
          this.emptyTitle.textContent = `Geen bestanden voor "${quickLabel}"`;
          this.emptyText.textContent = 'Kies Alles om weer alle bestanden in deze map te zien.';
          setLabel(this.emptyAction, 'Alles tonen');
        }
        this.emptyAction.disabled = false;
      }
      if (state === 'error') {
        this.errorTitle.textContent = 'Deze map kon niet worden geladen';
        this.errorText.textContent = `e-Boekhouden meldt: "${observed.error?.message || 'Er is iets misgegaan.'}" Je bestanden zijn niet weg.`;
        setLabel(this.reload, 'Opnieuw laden');
      } else if (state === 'failed' || state === 'mismatch') {
        this.errorTitle.textContent = 'Kon de map niet laden';
        this.errorText.textContent = state === 'failed'
          ? 'e-Boekhouden gaf de lijst van deze map niet door. Je bestanden zijn niet weg.'
          : 'e-Boekhouden toont de lijst van een andere map dan die je koos. Je bestanden zijn niet weg.';
        setLabel(this.reload, 'Opnieuw proberen');
      }
      this.more.hidden = state !== 'rows' || files.length < MANY;
      this.more.textContent = `Alle ${files.length} bestanden staan in beeld: e-Boekhouden laadt een map in één keer. Zoeken en snelselectie gelden voor de hele map.`;
      const upload = native.upload;
      if (Boolean(upload) !== !this.uploadStatus.hidden && upload) this.uploadStatus.classList.add('ebs-ar-in');
      this.uploadStatus.hidden = !upload;
      if (upload) {
        this.uploadTitle.textContent = upload.total ? `${plural(upload.total, 'bestand', 'bestanden')} uploaden naar ${folderName}` : `Bestanden uploaden naar ${folderName}`;
        this.uploadBar.style.transform = `scaleX(${upload.percent / 100})`;
      }

      if (state === 'rows') {
        // After Terug: the folder you came from gets the cursor.
        if (ui.cursorName) {
          ui.cursorKey = visible.find((row) => row.soort === 'D' && row.name === ui.cursorName)?.key ?? null;
          ui.cursorName = null;
          this.focusKey = ui.cursorKey;
        }
        this.drawRows(visible);
        if (this.focusKey) {
          const line = this.rowNodes.get(this.focusKey)?.firstElementChild;
          this.focusKey = null;
          line?.focus({ preventScroll: true });
          line?.scrollIntoView?.({ block: 'nearest' });
        }
      } else if (!ui.pending) {
        ui.cursorName = null;
      }
      const allOn = state === 'rows' && visible.length > 0 && visible.every((row) => row.check?.checked);
      this.allCheck.setAttribute('aria-checked', String(allOn));
      this.allCheck.classList.toggle('on', allOn);
      this.allCheck.disabled = state !== 'rows';

      this.drawPreview(native, state, visible);
      this.bar.update(rows.filter((row) => row.check?.checked));
    },

    drawTools(native, state) {
      const { parent } = parentOf(native.folders);
      const backTip = parent ? `Terug naar ${folderLabel(parent)} · Backspace` : 'Je bent al in de bovenste map';
      this.back.setAttribute('aria-disabled', String(!parent));
      this.back.setAttribute('aria-label', parent ? `Terug naar ${folderLabel(parent)}` : 'Terug: je bent al in Basismap, de bovenste map');
      tip(this.backTip, backTip);

      const refreshing = Boolean(ui.pending?.refresh);
      const waiting = state === 'loading' && !refreshing;
      this.refreshButton.setAttribute('aria-busy', String(refreshing));
      this.refreshButton.setAttribute('aria-disabled', String(waiting));
      this.refreshButton.setAttribute('aria-label', refreshing ? 'Bezig met vernieuwen' : 'Vernieuwen');
      tip(this.refreshTip, refreshing ? 'Bezig met vernieuwen' : waiting ? 'Vernieuwen kan als de map er is' : 'Vernieuwen');
      this.root.classList.toggle('ebs-ar-refreshing', Boolean(ui.pending?.dim));

      const desc = ui.sortDir === 'desc';
      const sortKey = ui.sortDir;
      if (this.sortButton.dataset.dir !== sortKey) {
        this.sortButton.dataset.dir = sortKey;
        this.sortButton.replaceChildren('Datum', EBS.icon(desc ? 'arrow-down' : 'arrow-up', { size: 14 }));
        this.sortButton.title = desc ? 'Gesorteerd op datum, nieuwste eerst. Klik: oudste eerst' : 'Gesorteerd op datum, oudste eerst. Klik: nieuwste eerst';
        this.sortButton.setAttribute('aria-label', `Sorteren: Datum, ${desc ? 'nieuwste' : 'oudste'} eerst`);
      }
    },

    drawFolders(native) {
      const folders = [...native.folders];
      const inbox = inboxFolder(folders);
      // The inbox of Mail & Herken first, with its own folders under it.
      if (inbox && inbox.depth === 1) {
        const at = folders.indexOf(inbox);
        let end = at + 1;
        while (end < folders.length && folders[end].depth > inbox.depth) end += 1;
        const moved = folders.splice(at, end - at);
        const after = folders.findIndex((folder) => folder.root) + 1;
        folders.splice(after, 0, ...moved);
      }
      const key = JSON.stringify([folders.map((folder) => [folder.path, folder.selected, folder.open, Boolean(folder.toggle), folder.deleted]), inbox?.path, ui.inboxCount]);
      if (this.folderList.dataset.key === key) return;
      const focused = this.folderList.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
      this.folderList.dataset.key = key;
      this.folderList.replaceChildren();
      for (const folder of folders) {
        const isInbox = folder === inbox;
        const line = el('div', 'ebs-ar-folder-line');
        const pick = el('button', `ebs-ar-folder${folder.selected ? ' current' : ''}${folder.deleted ? ' deleted' : ''}`);
        pick.type = 'button';
        pick.dataset.focusKey = `folder:${folder.path.join('/')}`;
        if (folder.selected) pick.setAttribute('aria-current', 'true');
        const name = el('span', 'ebs-ar-folder-name', isInbox ? `${folder.name} (Mail & Herken)` : (folder.root ? 'Basismap' : folder.name));
        name.style.paddingLeft = `${Math.max(0, folder.depth - 1) * 16}px`;
        pick.append(name);
        if (isInbox) {
          const badge = el('span', `ebs-ar-badge${ui.inboxCount ? ' new' : ''}`, ui.inboxCount === null ? '' : String(ui.inboxCount));
          badge.classList.toggle('known', ui.inboxCount !== null);
          if (ui.inboxCount !== null) badge.setAttribute('aria-label', `${plural(ui.inboxCount, 'nieuw bestand', 'nieuwe bestanden')}`);
          pick.append(badge);
        }
        pick.addEventListener('click', () => this.openFolder(liveFolder(folder.path)));
        line.append(pick);
        if (folder.toggle) {
          const toggle = el('button', 'ebs-ar-folder-toggle');
          toggle.type = 'button';
          toggle.dataset.focusKey = `toggle:${folder.path.join('/')}`;
          toggle.setAttribute('aria-expanded', String(folder.open));
          toggle.setAttribute('aria-label', `${folder.open ? 'Submappen verbergen' : 'Submappen tonen'}: ${folder.root ? 'Basismap' : folder.name}`);
          toggle.append(EBS.icon(folder.open ? 'chevron-down' : 'chevron-right', { size: 14 }));
          toggle.addEventListener('click', () => this.toggleFolder(liveFolder(folder.path)));
          line.append(toggle);
        }
        this.folderList.append(line);
      }
      if (focused) this.folderList.querySelector(`[data-focus-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
      const address = menhAddress();
      this.menh.textContent = address ? `Mail & Herken: mail bonnetjes naar ${address}` : '';
    },

    drawChips(files) {
      const without = files.filter((row) => !row.hasLinks).length;
      const chips = [
        ['all', `Alles · ${files.length}`],
        ['without', `Zonder koppeling · ${without}`],
        ['with', `Met koppeling · ${files.length - without}`],
        ['recognized', `Herkend, nog invoeren · ${files.filter((row) => row.status === 'Is herkend').length}`],
      ];
      const key = JSON.stringify([chips, ui.quick]);
      if (this.chips.dataset.key === key) return;
      const focused = this.chips.contains(document.activeElement) ? document.activeElement.dataset.focusKey : null;
      this.chips.dataset.key = key;
      this.chips.replaceChildren(...chips.map(([value, label]) => {
        const chip = el('button', `ebs-ar-chip${ui.quick === value ? ' on' : ''}`, label);
        chip.type = 'button';
        chip.dataset.focusKey = `quick:${value}`;
        chip.setAttribute('aria-pressed', String(ui.quick === value));
        chip.addEventListener('click', () => {
          ui.quick = value;
          this.draw();
        });
        return chip;
      }));
      if (focused) this.chips.querySelector(`[data-focus-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    },

    // Rows are kept per key: a redraw after a change in e-Boekhouden's list
    // updates them in place, so focus and hover stay where they are.
    drawRows(visible) {
      const keep = new Set(visible.map((row) => row.key));
      let lostFocus = false;
      for (const [key, node] of this.rowNodes) {
        if (!keep.has(key)) {
          lostFocus ||= node.contains(document.activeElement);
          node.remove();
          this.rowNodes.delete(key);
        }
      }
      if (lostFocus) this.scroll.focus({ preventScroll: true });
      let previous = null;
      for (const row of visible) {
        let node = this.rowNodes.get(row.key);
        if (!node) {
          node = this.makeRow(row);
          this.rowNodes.set(row.key, node);
        }
        this.fillRow(node, row);
        const expected = previous ? previous.nextSibling : this.body.firstChild;
        if (expected !== node) {
          if (previous) previous.after(node);
          else this.body.prepend(node);
        }
        previous = node;
      }
    },

    makeRow(row) {
      const wrap = el('div', 'ebs-ar-item');
      wrap.dataset.key = row.key;
      const line = el('div', 'ebs-ar-row ebs-ar-file');
      line.tabIndex = 0;
      const check = el('button', 'ebs-ar-check');
      check.type = 'button';
      check.setAttribute('role', 'checkbox');
      check.append(EBS.icon('check', { size: 14 }));
      check.addEventListener('click', (event) => {
        event.stopPropagation();
        const current = this.rowByKey(row.key);
        if (current) this.toggleRow(current, event.shiftKey);
      });
      const fileCell = el('span', 'ebs-ar-filecell');
      const type = el('span', 'ebs-ar-type');
      const nameCol = el('span', 'ebs-ar-namecol');
      nameCol.append(el('span', 'ebs-ar-name'), el('span', 'ebs-ar-meta'));
      fileCell.append(type, nameCol);
      const date = el('span', 'ebs-ar-date');
      const status = el('span', 'ebs-ar-statuscell');
      const links = el('span', 'ebs-ar-links');
      line.append(check, fileCell, date, status, links);
      line.addEventListener('click', () => {
        const current = this.rowByKey(row.key);
        if (current) this.activate(current);
      });
      line.addEventListener('keydown', (event) => {
        if (event.target !== line || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        const current = this.rowByKey(row.key);
        if (current) this.activate(current);
      });
      // Right-click: e-Boekhouden's own menu for this file or folder.
      line.addEventListener('contextmenu', (event) => {
        const current = this.rowByKey(row.key);
        if (!event.isTrusted || !current?.native.isConnected) return;
        event.preventDefault();
        nativeMenu.open(current, event, line);
      });
      // Files from the computer dropped on a folder row go to that folder.
      const overFolder = (event) => this.rowByKey(row.key)?.soort === 'D' && hasFiles(event);
      for (const type of ['dragenter', 'dragover']) {
        line.addEventListener(type, (event) => {
          if (!overFolder(event)) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
          const count = [...(event.dataTransfer?.items ?? [])].filter((item) => item.kind === 'file').length;
          const label = line.querySelector('.ebs-ar-droplabel');
          if (label) label.textContent = count ? `Hierheen · ${count}` : 'Hierheen';
          line.classList.add('ebs-ar-drop');
        });
      }
      line.addEventListener('dragleave', (event) => {
        if (!line.contains(event.relatedTarget)) line.classList.remove('ebs-ar-drop');
      });
      line.addEventListener('drop', (event) => {
        if (!overFolder(event)) return;
        event.preventDefault();
        event.stopPropagation();
        line.classList.remove('ebs-ar-drop');
        this.files.classList.remove('dragging');
        const current = this.rowByKey(row.key);
        if (event.isTrusted && current) this.uploadToFolder(current, event.dataTransfer?.files);
      });
      const details = el('div', 'ebs-ar-details');
      wrap.append(line, details);
      return wrap;
    },

    fillRow(node, row) {
      const [line, details] = node.children;
      const checked = Boolean(row.check?.checked);
      const current = (ui.previewKey ?? ui.cursorKey) === row.key;
      const key = JSON.stringify([row.name, row.date, row.size, row.status, row.hasLinks, row.koppelCount, row.expanded, row.details, checked, row.deleted, current, row.soort]);
      if (node.dataset.fill === key) return;
      node.dataset.fill = key;
      line.classList.toggle('checked', checked);
      line.classList.toggle('current', current);
      line.classList.toggle('deleted', row.deleted);
      const [check, fileCell, date, status, links] = line.children;
      check.setAttribute('aria-checked', String(checked));
      check.setAttribute('aria-label', `${row.name} selecteren`);
      check.disabled = !row.check;
      const [type, nameCol] = fileCell.children;
      type.replaceChildren(EBS.icon(row.soort === 'D' ? 'folder' : 'file', { size: 18 }), row.soort === 'D' ? '' : row.ext);
      nameCol.children[0].textContent = row.name;
      nameCol.children[0].title = row.name;
      nameCol.children[1].textContent = row.soort === 'D' ? 'Map' : row.size;
      date.textContent = row.date;
      status.replaceChildren();
      if (row.status) status.append(el('span', `ebs-ar-status ${STATUS_TONE[row.status]}`, row.status));
      if (row.soort === 'D') {
        // A folder has no status and no links: a dash, and room for
        // "Hierheen" while files are dragged over it.
        const none = el('span', 'ebs-ar-none', '-');
        none.setAttribute('aria-label', 'Geen status');
        const drop = el('span', 'ebs-ar-droplabel', 'Hierheen');
        drop.setAttribute('aria-hidden', 'true');
        status.append(none, drop);
      }
      links.replaceChildren();
      if (row.soort === 'D') {
        const none = el('span', 'ebs-ar-none', '-');
        none.setAttribute('aria-label', 'Geen koppelingen');
        links.append(none);
      } else if (row.hasLinks) {
        const toggle = el('button', 'ebs-ar-linkbutton');
        toggle.type = 'button';
        toggle.setAttribute('aria-expanded', String(row.expanded));
        toggle.append(EBS.icon(row.expanded ? 'chevron-down' : 'chevron-right', { size: 14 }), row.koppelCount === null ? 'Gekoppeld' : `Gekoppeld (${row.koppelCount})`);
        toggle.addEventListener('click', (event) => {
          event.stopPropagation();
          const current = this.rowByKey(row.key);
          if (current) this.toggleLinks(current);
        });
        links.append(toggle);
      } else if (row.soort === 'F') {
        links.append(el('span', 'ebs-ar-none', 'Geen'));
      }
      const open = row.expanded && row.hasLinks;
      if (open && !details.classList.contains('open')) details.classList.add('ebs-ar-in');
      details.classList.toggle('open', open);
      details.replaceChildren();
      if (open) {
        if (!row.details || row.details.loading) details.append(el('span', 'ebs-ar-detail-muted', 'De koppelingen worden geladen…'));
        else if (!row.details.lines.length) details.append(el('span', 'ebs-ar-detail', 'Geen koppelingen meer.'));
        for (const textLine of row.details?.lines ?? []) details.append(el('span', 'ebs-ar-detail', textLine));
        details.append(el('span', 'ebs-ar-detail-muted', 'Uit e-Boekhouden: het laadt deze details zelf zodra je de regel uitklapt.'));
      }
    },

    drawPreview(native, state, visible) {
      const row = ui.previewKey ? native.rows.find((one) => one.key === ui.previewKey) : null;
      if (ui.previewKey && !row && state !== 'loading') {
        preview.reset();
        ui.previewKey = null;
      }
      const show = Boolean(row) && (state === 'rows');
      this.previewFile.hidden = !show;
      this.previewNone.hidden = show;
      if (!show) {
        this.previewNone.textContent = state === 'loading' ? 'Voorbeeld volgt zodra de map geladen is.' : 'Kies een bestand om het hier te bekijken.';
        return;
      }
      this.previewName.textContent = row.name;
      this.previewName.title = row.name;
      this.previewMeta.textContent = [row.date, row.size, row.status].filter(Boolean).join(' · ');
      const stageKey = JSON.stringify([preview.key, preview.state, preview.url, preview.message]);
      if (this.previewStage.dataset.key !== stageKey) {
        this.previewStage.dataset.key = stageKey;
        this.previewStage.replaceChildren();
        this.previewStage.removeAttribute('aria-busy');
        if (preview.state === 'loading') {
          this.previewStage.setAttribute('aria-busy', 'true');
          const page = el('div', 'ebs-ar-page ebs-ar-page-loading');
          for (const name of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) page.append(el('span', `ebs-ar-page-${name}`));
          this.previewStage.append(page);
        } else if (preview.state === 'ready' && preview.kind === 'image') {
          const image = el('img', 'ebs-ar-image ebs-ar-in');
          image.alt = `Voorbeeld van ${row.name}`;
          image.src = preview.url;
          this.previewStage.append(image);
        } else if (preview.state === 'ready') {
          // No sandbox: Chrome does not show a PDF in a sandboxed frame. The
          // blob only ever has the type application/pdf (PREVIEW_TYPES).
          const frame = el('iframe', 'ebs-ar-frame ebs-ar-in');
          frame.title = `Voorbeeld van ${row.name}`;
          frame.src = preview.url;
          this.previewStage.append(frame);
        } else if (preview.state === 'unsupported') {
          const none = el('div', 'ebs-ar-noshow ebs-ar-in');
          none.append(el('strong', '', 'Geen voorbeeld voor dit bestandstype'), el('span', '', 'Download het bestand om het te bekijken.'));
          this.previewStage.append(none);
        } else if (preview.state === 'error') {
          const none = el('div', 'ebs-ar-noshow ebs-ar-in');
          none.setAttribute('role', 'alert');
          none.append(el('strong', '', 'Geen voorbeeld'), el('span', '', preview.message));
          this.previewStage.append(none);
        }
      }
      const count = row.koppelCount;
      this.previewLinks.textContent = row.hasLinks
        ? (count === null ? 'Gekoppeld; klap de regel uit voor de details.' : `${count} ${count === 1 ? 'koppeling' : 'koppelingen'}; klap de regel uit voor de details.`)
        : 'Nog niet gekoppeld aan een mutatie, relatie of offerte.';
      // Like e-Boekhouden's right-click: an item counts for the selection too.
      const others = native.rows.filter((one) => one.check?.checked && one.key !== row.key && one.soort === 'F').length;
      this.previewAlso.textContent = others && !row.check?.checked ? `Koppelen en invoeren gelden ook voor de ${plural(others, 'geselecteerde bestand', 'geselecteerde bestanden')}, net als bij rechtsklikken.` : '';
      if (this.previewPrimary.getAttribute('aria-busy') !== 'true') setLabel(this.previewPrimary, row.hasLinks ? 'Koppeling bekijken' : 'Invoeren als mutatie');
      for (const node of [this.previewPrimary, this.previewRelation, this.previewRename]) {
        if (node.getAttribute('aria-busy') !== 'true') node.disabled = row.deleted;
      }
      this.previewMessage.textContent = ui.messages.preview;
    },

    // -----------------------------------------------------------------------
    // Action bar for the selection
    // -----------------------------------------------------------------------

    bar: {
      host: null,
      build() {
        if (this.host) return;
        const host = el('div', 'ebs-ar-bar');
        host.setAttribute('role', 'toolbar');
        host.setAttribute('aria-label', 'Acties voor geselecteerde bestanden');
        const summary = el('span', 'ebs-ar-bar-summary');
        this.count = el('span', 'ebs-ar-bar-count');
        this.sub = el('span', 'ebs-ar-bar-sub');
        summary.append(this.count, this.sub);
        const selected = () => view.fresh()?.rows.filter((row) => row.check?.checked) ?? [];
        this.recognize = button('ebs-ar-bar-button green', 'Herkennen', () => this.menu(this.recognize, MENU.recognize, (row) => RECOGNIZABLE.test(row.name)));
        this.relation = button('ebs-ar-bar-button ghost', 'Koppelen aan relatie', () => this.menu(this.relation, MENU.linkRelation, () => true));
        this.cut = button('ebs-ar-bar-button ghost', 'Knippen', () => view.toolbarAction(this.cut, 'cut'), 'scissors');
        this.cut.title = 'Knippen; open daarna de doelmap en kies Plakken hier';
        this.download = button('ebs-ar-bar-button ghost', 'Downloaden', () => busy(this.download, async () => {
          await afterThisEvent();
          const files = selected().filter((row) => row.soort === 'F');
          this.say(files.length > MAX_DOWNLOADS ? `Downloaden gaat per keer voor ten hoogste ${MAX_DOWNLOADS} bestanden; de eerste ${MAX_DOWNLOADS} komen nu.` : '');
          for (const row of files.slice(0, MAX_DOWNLOADS)) {
            download(row);
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
        }));
        this.removeButton = button('ebs-ar-bar-button ghost', 'Verwijderen', () => view.toolbarAction(this.removeButton, 'remove'));
        const clear = button('ebs-ar-bar-button quiet', 'Selectie wissen', () => {
          setChecked(selected(), false);
          ui.anchorKey = null;
          schedule();
        });
        this.message = el('span', 'ebs-ar-bar-message');
        this.message.setAttribute('role', 'alert');
        host.append(summary, el('span', 'ebs-ar-bar-divider'), this.recognize, this.relation, this.cut, this.download, this.removeButton, clear, this.message);
        document.body.append(host);
        this.host = host;
      },

      remove() {
        this.host?.remove();
        this.host = null;
      },

      say(message) {
        if (this.message) this.message.textContent = message;
      },

      // Through e-Boekhouden's right-click menu on a selected file it accepts.
      menu(node, label, accepts) {
        return busy(node, async () => {
          this.say('');
          const rows = view.fresh()?.rows.filter((row) => row.check?.checked && row.soort === 'F' && !row.deleted) ?? [];
          const row = rows.find(accepts);
          if (!row) {
            this.say(label === MENU.recognize ? 'Alleen pdf, jpg en png kunnen worden herkend.' : 'Kies eerst een bestand.');
            return;
          }
          this.say(await runMenuItem(row, label));
        });
      },

      place() {
        if (!this.host) return;
        const rect = view.files?.getBoundingClientRect();
        this.host.style.left = rect?.width ? `${Math.round(rect.left + rect.width / 2)}px` : '';
      },

      update(selected) {
        if (!this.host) return;
        const show = selected.length > 0 && view.root?.dataset.state === 'rows';
        if (view.root) view.root.dataset.bar = show ? 'on' : 'off';
        if (!show) {
          this.host.classList.remove('show');
          this.say('');
          return;
        }
        const files = selected.filter((row) => row.soort === 'F' && !row.deleted);
        const folders = selected.filter((row) => row.soort === 'D').length;
        const others = selected.length - folders;
        this.count.textContent = folders
          ? `${plural(folders, 'map', 'mappen')}${others ? ` en ${plural(others, 'bestand', 'bestanden')}` : ''} geselecteerd`
          : `${plural(selected.length, 'bestand', 'bestanden')} geselecteerd`;
        this.sub.textContent = `${files.filter((row) => !row.hasLinks).length} zonder koppeling`;
        const toolbar = view.native.toolbar;
        const idle = (node) => node.getAttribute('aria-busy') !== 'true';
        if (idle(this.recognize)) this.recognize.disabled = !files.some((row) => RECOGNIZABLE.test(row.name));
        if (idle(this.relation)) this.relation.disabled = !files.length;
        if (idle(this.download)) this.download.disabled = !files.length;
        if (idle(this.cut)) this.cut.disabled = toolbar.cut.disabled;
        if (idle(this.removeButton)) this.removeButton.disabled = toolbar.remove.disabled;
        this.place();
        this.host.classList.add('show');
      },
    },
  };

  // The way back on e-Boekhouden's own screen, in its own link style.
  const backToBetter = {
    node: null,
    mount(container) {
      if (!this.node) {
        this.node = el('div', 'ebs-ar-native-toggle');
        const link = el('a', '', 'Nieuwe weergave');
        link.href = '#';
        link.setAttribute('role', 'button');
        link.addEventListener('click', (event) => {
          event.preventDefault();
          setClassic(false);
        });
        this.node.append(link);
      }
      if (this.node.parentElement !== container) container.append(this.node);
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

  function update() {
    document.documentElement.classList.toggle('ebs-better-archive', settingsLoaded && useBetter());
    if (settingsLoaded) observe(useBetter());
    schedule();
  }

  function render() {
    if (!settingsLoaded) return;
    const better = useBetter();
    const native = onArchivePage() ? readNative() : null;
    if (!native || !better) {
      view.unmount();
      view.native = null;
      if (native && settings.betterDesign && onArchivePage()) {
        injectStyle();
        backToBetter.mount(native.container);
      } else {
        backToBetter.unmount();
      }
      return;
    }
    backToBetter.unmount();
    injectStyle();
    view.mount(native);
    view.native = native;
    askInboxCount();
    nativeMenu.update();
    view.draw();
  }

  // -------------------------------------------------------------------------
  // Styles: the board's measures; hovers fade, what appears fades and slides,
  // all on opacity and transform, with a reduced-motion fallback.
  // -------------------------------------------------------------------------

  function injectStyle() {
    if (document.getElementById('ebs-archive-style')) return;
    const style = document.createElement('style');
    style.id = 'ebs-archive-style';
    style.textContent = ARCHIVE_CSS;
    document.documentElement.append(style);
  }

  const ARCHIVE_CSS = `
    html.ebs-better-archive app-digitaal-archief .container-da > .main { display: none !important; }
    html.ebs-better-archive app-digitaal-archief .container-da { position: relative; height: 100%; }
    html.ebs-archive-driving app-digitaal-archief-context-menu .contextMenu { opacity: 0 !important; pointer-events: none !important; }
    /* e-Boekhouden's own right-click menu, opened from a row of ours: at the mouse. */
    html.ebs-better-archive.ebs-archive-menu app-digitaal-archief-context-menu .contextMenu { position: fixed !important; left: var(--ebs-ar-menu-x, 0) !important; top: var(--ebs-ar-menu-y, 0) !important; z-index: 2147482500 !important; border-radius: 8px; overflow: hidden; box-shadow: 0 8px 24px rgba(20, 26, 48, .18); animation: ebs-ar-in 150ms cubic-bezier(0.23, 1, 0.32, 1) both; }
    /* e-Boekhouden's upload window, as a panel you can work beside. */
    html.ebs-better-archive app-digitaal-archief-upload { position: fixed !important; inset: auto 24px 24px auto !important; width: 640px; max-width: calc(100vw - 48px); background: transparent !important; z-index: 2147482000; animation: ebs-ar-in 150ms cubic-bezier(0.23, 1, 0.32, 1) both; }
    html.ebs-better-archive app-digitaal-archief-upload app-file-upload { position: static !important; left: auto !important; top: auto !important; transform: none !important; width: 100% !important; display: block; border-radius: 12px; overflow: hidden; box-shadow: 0 18px 44px rgba(20, 26, 48, .25); }

    .ebs-ar-native-toggle { position: absolute; top: 4px; right: 52px; z-index: 1; font-size: 13px; }
    .ebs-ar-native-toggle a { color: var(--colorPrimary, #30395f); text-decoration: underline; cursor: pointer; }

    .ebs-ar { box-sizing: border-box; height: 100%; min-height: 560px; padding: 20px 32px 0; display: flex; flex-direction: column; gap: 14px; background: #eef0f5; color: #232c4f; font-family: Ubuntu, system-ui, sans-serif; font-size: 16px; }
    .ebs-ar *, .ebs-ar-bar * { box-sizing: border-box; }
    .ebs-ar button, .ebs-ar input, .ebs-ar-bar button { font-family: Ubuntu, system-ui, sans-serif; }
    .ebs-ar [hidden], .ebs-ar-bar [hidden] { display: none !important; }
    .ebs-ar svg { flex: none; }
    .ebs-ar-head { position: relative; display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; }
    .ebs-ar-titles { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .ebs-ar-titles h1 { margin: 0; font-size: 22px; font-weight: 700; line-height: 1.2; color: #232c4f; }
    .ebs-ar-subtitle { font-size: 13px; color: #5d6584; }
    .ebs-ar-head-actions { display: flex; gap: 8px; align-items: center; flex: none; }
    .ebs-ar-classic { font-size: 13px; margin-right: 8px; color: #232c4f; text-decoration: underline; cursor: pointer; transition: color 150ms ease; }
    .ebs-ar-classic:hover { color: #3a4677; }
    .ebs-ar-head-message { position: absolute; top: calc(100% + 4px); right: 0; z-index: 2; max-width: 520px; padding: 6px 10px; border-radius: 8px; background: #fdf0ef; box-shadow: 0 4px 14px rgba(20, 26, 48, .12); font-size: 13px; color: #b42318; transition: opacity 150ms ease, transform 150ms cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-ar-head-message:empty { opacity: 0; transform: translateY(-4px); pointer-events: none; }
    .ebs-ar-button { height: 40px; padding: 0 14px; border: 1px solid #cfd4e2; border-radius: 9px; background: #ffffff; color: #232c4f; font-size: 14px; display: flex; align-items: center; gap: 6px; cursor: pointer; white-space: nowrap; transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease, transform 120ms cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-ar-button:hover { background: #f3f5fa; border-color: #b9c0d4; }
    .ebs-ar-button:disabled { color: #8c93ab; background: #ffffff; border-color: #cfd4e2; cursor: default; }
    .ebs-ar-button.primary { padding: 0 16px; border: 0; background: #232c4f; color: #ffffff; font-weight: 700; }
    .ebs-ar-button.primary:hover { background: #313c66; }
    .ebs-ar-button.primary:disabled { background: #8c93ab; color: #ffffff; }
    .ebs-ar-button.small { height: 38px; }
    .ebs-ar-error .ebs-ar-button.small { height: 36px; padding: 0 14px; font-size: 13px; }
    .ebs-ar-button:active:not(:disabled) { transform: scale(0.97); }
    .ebs-ar-iconbutton { position: relative; flex: none; width: 36px; height: 36px; padding: 0; border: 1px solid #cfd4e2; border-radius: 999px; background: #ffffff; color: #232c4f; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease; }
    .ebs-ar-iconbutton:not([aria-disabled="true"]):hover { background: #f3f5fa; border-color: #b9c0d4; }
    .ebs-ar-iconbutton[aria-disabled="true"] { color: #b9c0d4; border-color: #e6e9f1; cursor: default; }
    .ebs-ar-iconbutton[aria-busy="true"] { cursor: progress; }
    .ebs-ar-spin { display: flex; }
    .ebs-ar-refresh[aria-busy="true"] .ebs-ar-spin { animation: ebs-ar-spin 800ms linear infinite; }
    .ebs-ar-tip { position: absolute; z-index: 30; left: 50%; top: calc(100% + 8px); box-sizing: border-box; width: max-content; max-width: 240px; padding: 5px 10px; border-radius: 999px; background: #232c4f; color: #ffffff; font-size: 12px; line-height: 16px; font-weight: 400; text-align: left; white-space: nowrap; box-shadow: 0 8px 20px rgba(20, 26, 48, .22); pointer-events: none; opacity: 0; transform: translate(-50%, -4px); transition: opacity 150ms ease, transform 150ms cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-ar-tip.two { white-space: normal; width: 240px; padding: 6px 10px; border-radius: 10px; }
    .ebs-ar-tip.l { left: 0; transform: translate(0, -4px); }
    .ebs-ar-tip.r { left: auto; right: 0; transform: translate(0, -4px); }
    .ebs-ar-iconbutton:hover > .ebs-ar-tip, .ebs-ar-iconbutton:focus-visible > .ebs-ar-tip { opacity: 1; transform: translate(-50%, 0); transition-delay: 300ms; }
    .ebs-ar-iconbutton:hover > .ebs-ar-tip.l, .ebs-ar-iconbutton:focus-visible > .ebs-ar-tip.l, .ebs-ar-iconbutton:hover > .ebs-ar-tip.r, .ebs-ar-iconbutton:focus-visible > .ebs-ar-tip.r { transform: none; }
    .ebs-ar-sort { padding: 0; border: 0; background: transparent; color: #232c4f; font-family: Ubuntu, system-ui, sans-serif; font-size: 12px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px; justify-self: start; cursor: pointer; transition: color 150ms ease; }
    .ebs-ar-sort:hover { color: #3a4677; }
    .ebs-ar-button:focus-visible, .ebs-ar-chip:focus-visible, .ebs-ar-iconbutton:focus-visible, .ebs-ar-sort:focus-visible, .ebs-ar-folder:focus-visible, .ebs-ar-folder-toggle:focus-visible, .ebs-ar-check:focus-visible, .ebs-ar-linkbutton:focus-visible, .ebs-ar-pbutton:focus-visible, .ebs-ar-file:focus-visible, .ebs-ar-classic:focus-visible { outline: 2px solid #232c4f; outline-offset: 2px; }

    .ebs-ar-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: 230px minmax(0, 1fr) 380px; gap: 14px; }
    .ebs-ar-nav { background: #ffffff; border-radius: 12px; padding: 10px; display: flex; flex-direction: column; gap: 2px; overflow: auto; }
    .ebs-ar-folders { display: flex; flex-direction: column; gap: 2px; }
    .ebs-ar-folder-line { position: relative; display: flex; }
    .ebs-ar-folder { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 36px; padding: 0 10px; border: 0; border-radius: 8px; background: transparent; color: #232c4f; font-size: 13px; font-weight: 400; text-align: left; cursor: pointer; transition: background-color 150ms ease, color 150ms ease; }
    .ebs-ar-folder:hover { background: #f3f5fa; }
    .ebs-ar-folder.current { background: #e8eefb; font-weight: 700; }
    .ebs-ar-folder.deleted { font-style: italic; opacity: .6; }
    .ebs-ar-folder-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ebs-ar-folder-line:has(.ebs-ar-folder-toggle) .ebs-ar-folder { padding-right: 32px; }
    .ebs-ar-folder-toggle { position: absolute; right: 4px; top: 6px; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: #5d6584; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background-color 150ms ease, color 150ms ease; }
    .ebs-ar-folder-line:has(.ebs-ar-badge) .ebs-ar-folder-toggle { right: 36px; }
    .ebs-ar-folder-toggle:hover { background: #e6e9f1; color: #232c4f; }
    .ebs-ar-badge { flex: none; min-width: 22px; padding: 1px 6px; border-radius: 10px; background: #eef0f5; color: #4a5272; font-size: 11px; font-weight: 400; text-align: center; opacity: 0; transition: opacity 150ms ease, background-color 150ms ease, color 150ms ease; }
    .ebs-ar-badge.known { opacity: 1; }
    .ebs-ar-badge.new { background: #5d9e35; color: #ffffff; }
    .ebs-ar-menh { margin: 10px 8px 0; padding-top: 10px; border-top: 1px solid #eef0f5; font-size: 11px; color: #5d6584; overflow-wrap: anywhere; }
    .ebs-ar-menh:empty { visibility: hidden; }

    .ebs-ar-files { position: relative; background: #ffffff; border-radius: 12px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; transition: background-color 150ms ease; }
    .ebs-ar-files.dragging { background: #f3f6fd; }
    .ebs-ar-tools { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: start; gap: 8px; padding: 12px 14px; border-bottom: 1px solid #e6e9f1; }
    .ebs-ar-tools-main { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-width: 0; }
    .ebs-ar-search { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 12px; border: 1px solid #d6dbe8; border-radius: 9px; flex: 1 1 240px; color: #5d6584; font-size: 13px; transition: border-color 150ms ease; }
    .ebs-ar-search:focus-within { border-color: #596aaf; }
    .ebs-ar-search input { border: 0; outline: none; flex: 1; min-width: 0; font-size: 13px; background: transparent; color: #232c4f; }
    .ebs-ar-chips { display: contents; }
    .ebs-ar-chip { height: 32px; padding: 0 12px; border: 1px solid #d6dbe8; border-radius: 16px; background: #ffffff; color: #232c4f; font-size: 13px; cursor: pointer; white-space: nowrap; transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease; }
    .ebs-ar-chip:hover { background: #f3f5fa; }
    .ebs-ar-chip.on { border-color: #232c4f; background: #232c4f; color: #ffffff; }
    .ebs-ar-row { display: grid; grid-template-columns: 44px minmax(0, 1fr) 124px 150px 160px; align-items: center; padding: 0 14px; }
    .ebs-ar-row-head { height: 36px; font-size: 12px; color: #5d6584; background: #f7f8fb; border-bottom: 1px solid #e6e9f1; }
    .ebs-ar-check { width: 18px; height: 18px; padding: 0; border: 1.5px solid #8c93ab; border-radius: 4px; background: #ffffff; color: #ffffff; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease; }
    .ebs-ar-check svg { opacity: 0; transition: opacity 150ms ease; }
    .ebs-ar-check:hover { border-color: #232c4f; }
    .ebs-ar-check[aria-checked="true"] svg { opacity: 1; }
    .ebs-ar-row-head .ebs-ar-check { color: #232c4f; }
    .ebs-ar-file .ebs-ar-check[aria-checked="true"] { border-color: #232c4f; background: #232c4f; }
    .ebs-ar-check:disabled { opacity: .45; cursor: default; }
    .ebs-ar-scroll { flex: 1; min-height: 0; overflow: auto; outline: none; }
    /* Room after the last row while the action bar floats over the list. */
    .ebs-ar[data-bar="on"] .ebs-ar-scroll::after { content: ''; display: block; height: 96px; }
    .ebs-ar-item { border-bottom: 1px solid #eef0f5; }
    .ebs-ar-file { min-height: 56px; cursor: pointer; background: #ffffff; transition: background-color 150ms ease; }
    .ebs-ar-file:hover { background: #f7f8fb; }
    .ebs-ar-file.ebs-ar-range { background: #f3f6fd; }
    .ebs-ar-file.current { background: #f3f6fd; box-shadow: inset 3px 0 0 #232c4f; }
    .ebs-ar-file.checked { background: #e8eefb; }
    .ebs-ar-file.deleted { font-style: italic; opacity: .7; }
    /* A folder row with files dragged over it: a dashed ring and "Hierheen". */
    .ebs-ar-file::after { content: ''; position: absolute; inset: 2px; border: 2px dashed #4a6fb5; border-radius: 8px; pointer-events: none; opacity: 0; transition: opacity 150ms ease; }
    .ebs-ar-file { position: relative; }
    .ebs-ar-file.ebs-ar-drop { background: #e3ebfb; }
    .ebs-ar-file.ebs-ar-drop::after { opacity: 1; }
    .ebs-ar-statuscell { position: relative; display: flex; align-items: center; min-height: 22px; }
    .ebs-ar-droplabel { position: absolute; left: 0; top: 50%; height: 22px; padding: 0 8px; border-radius: 999px; background: #232c4f; color: #ffffff; font-size: 12px; font-weight: 500; display: inline-flex; align-items: center; white-space: nowrap; opacity: 0; transform: translateY(calc(-50% + 4px)); transition: opacity 150ms ease, transform 150ms cubic-bezier(0.23, 1, 0.32, 1); pointer-events: none; }
    .ebs-ar-drop .ebs-ar-droplabel { opacity: 1; transform: translateY(-50%); }
    .ebs-ar-drop .ebs-ar-statuscell .ebs-ar-none { opacity: 0; }
    .ebs-ar-statuscell .ebs-ar-none { transition: opacity 150ms ease; }
    .ebs-ar-filecell { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .ebs-ar-type { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; line-height: 1; }
    .ebs-ar-namecol { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .ebs-ar-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ebs-ar-meta { font-size: 11px; color: #5d6584; }
    .ebs-ar-date { font-size: 13px; }
    .ebs-ar-status { display: inline-block; padding: 3px 9px; border-radius: 11px; font-size: 12px; white-space: nowrap; }
    .ebs-ar-status.done { background: #e6f2dc; color: #2f6f1a; }
    .ebs-ar-status.todo { background: #fff1dc; color: #8a5300; }
    .ebs-ar-status.recognized { background: #e5ecfb; color: #2a4a9a; }
    .ebs-ar-status.busy { background: #eef0f5; color: #4a5272; }
    .ebs-ar-status.credits { background: #fdf0ef; color: #b42318; }
    .ebs-ar-links { font-size: 12px; color: #3a4677; }
    .ebs-ar-linkbutton { display: flex; align-items: center; gap: 4px; height: 28px; padding: 0 8px; border: 1px solid #d6dbe8; border-radius: 8px; background: #ffffff; color: #3a4677; font-size: 12px; cursor: pointer; transition: background-color 150ms ease, border-color 150ms ease; }
    .ebs-ar-linkbutton:hover { background: #f3f5fa; border-color: #b9c0d4; }
    .ebs-ar-none { color: #8c93ab; }
    .ebs-ar-details { display: flex; flex-direction: column; gap: 4px; background: #f7f8fb; }
    .ebs-ar-details.open { padding: 4px 14px 12px 102px; }
    .ebs-ar-detail { font-size: 12px; color: #232c4f; }
    .ebs-ar-detail-muted { font-size: 11px; color: #5d6584; }
    .ebs-ar-more { padding: 14px; font-size: 13px; color: #5d6584; text-align: center; }
    .ebs-ar-skel { height: 52px; border-bottom: 1px solid #eef0f5; animation: ebs-ar-shimmer 1200ms ease-in-out infinite; }
    .ebs-ar-skel span { display: block; background: #e6e9f1; }
    .ebs-ar-skel-box { width: 18px; height: 18px; border-radius: 4px; }
    .ebs-ar-skel-name { height: 12px; border-radius: 6px; }
    .ebs-ar-skel-date { width: 64px; height: 10px; border-radius: 5px; }
    .ebs-ar-skel-pill { width: 90px; height: 20px; border-radius: 10px; }
    .ebs-ar-skel-link { width: 110px; height: 10px; border-radius: 5px; }
    .ebs-ar-empty { margin: 28px; padding: 36px 20px; border: 2px dashed #c5cbdc; border-radius: 14px; display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
    .ebs-ar-empty-title { font-size: 16px; font-weight: 700; }
    .ebs-ar-empty-text { font-size: 13px; color: #5d6584; max-width: 380px; }
    .ebs-ar-error { margin: 28px; padding: 18px 20px; border-radius: 12px; background: #fdf0ef; border: 1px solid #f1c7c2; display: flex; align-items: center; gap: 14px; }
    .ebs-ar-error-copy { flex: 1; display: flex; flex-direction: column; gap: 3px; }
    .ebs-ar-error-title { font-size: 14px; font-weight: 700; color: #b42318; }
    .ebs-ar-error-text { font-size: 13px; color: #232c4f; }
    /* Vernieuwen: the list stays, dimmed and not clickable, until it is back. */
    .ebs-ar-body, .ebs-ar-empty { transition: opacity 150ms ease; }
    .ebs-ar.ebs-ar-refreshing .ebs-ar-body, .ebs-ar.ebs-ar-refreshing .ebs-ar-empty { opacity: .6; pointer-events: none; }
    .ebs-ar-upload { margin: 14px; padding: 14px; border-radius: 10px; background: #eef4ff; display: flex; flex-direction: column; gap: 8px; }
    .ebs-ar-upload-title { font-size: 13px; font-weight: 500; }
    .ebs-ar-progress { display: block; height: 6px; border-radius: 3px; background: #d6deef; overflow: hidden; }
    .ebs-ar-progress-bar { display: block; height: 100%; width: 100%; background: #232c4f; transform-origin: left center; transform: scaleX(0); transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-ar-upload-note { font-size: 12px; color: #5d6584; }

    .ebs-ar-preview { background: #ffffff; border-radius: 12px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    .ebs-ar-preview-file { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .ebs-ar-preview-head { padding: 14px 16px 10px; display: flex; flex-direction: column; gap: 4px; border-bottom: 1px solid #eef0f5; }
    .ebs-ar-preview-name { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ebs-ar-preview-meta { font-size: 12px; color: #5d6584; }
    .ebs-ar-preview-stage { flex: 1; min-height: 0; padding: 14px; background: #f3f5fa; display: flex; align-items: flex-start; justify-content: center; overflow: hidden; }
    .ebs-ar-page { width: 250px; aspect-ratio: 1 / 1.414; background: #ffffff; box-shadow: 0 4px 14px rgba(20, 26, 48, .12); padding: 20px; display: flex; flex-direction: column; gap: 8px; }
    .ebs-ar-page span { display: block; height: 8px; background: #e2e6ef; border-radius: 3px; }
    .ebs-ar-page-loading { animation: ebs-ar-shimmer 1200ms ease-in-out infinite; }
    .ebs-ar-page .ebs-ar-page-a { width: 70px; height: 12px; background: #c9cfdf; }
    .ebs-ar-page .ebs-ar-page-b { width: 120px; margin-top: 14px; }
    .ebs-ar-page .ebs-ar-page-c { width: 100px; }
    .ebs-ar-page .ebs-ar-page-d { margin-top: 18px; }
    .ebs-ar-page .ebs-ar-page-f { width: 80%; }
    .ebs-ar-page .ebs-ar-page-g { align-self: flex-end; width: 64px; height: 12px; background: #c9cfdf; margin-top: 18px; }
    .ebs-ar-image { max-width: 100%; max-height: 100%; object-fit: contain; background: #ffffff; box-shadow: 0 4px 14px rgba(20, 26, 48, .12); }
    .ebs-ar-frame { width: 100%; height: 100%; border: 0; background: #ffffff; box-shadow: 0 4px 14px rgba(20, 26, 48, .12); }
    .ebs-ar-noshow { margin-top: 60px; display: flex; flex-direction: column; align-items: center; gap: 8px; text-align: center; font-size: 13px; color: #5d6584; }
    .ebs-ar-noshow strong { font-weight: 700; color: #232c4f; }
    .ebs-ar-preview-foot { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid #eef0f5; }
    .ebs-ar-preview-links { font-size: 12px; color: #5d6584; }
    .ebs-ar-preview-note { font-size: 11px; color: #5d6584; }
    .ebs-ar-preview-note:empty { display: none; }
    /* Room kept for a message, so the buttons do not move when one shows. */
    .ebs-ar-message { min-height: 16px; font-size: 12px; line-height: 16px; color: #b42318; transition: opacity 150ms ease; }
    .ebs-ar-message:empty { opacity: 0; }
    .ebs-ar-preview-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
    .ebs-ar-pbutton { height: 34px; padding: 0 12px; border: 1px solid #cfd4e2; border-radius: 8px; background: #ffffff; color: #232c4f; font-size: 13px; display: flex; align-items: center; gap: 6px; cursor: pointer; transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, transform 120ms cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-ar-pbutton:hover { background: #f3f5fa; }
    .ebs-ar-pbutton.green { border: 0; background: #5d9e35; color: #ffffff; font-weight: 700; }
    .ebs-ar-pbutton.green:hover { background: #4f8a2c; }
    .ebs-ar-pbutton:disabled { opacity: .5; cursor: default; }
    .ebs-ar-pbutton:active:not(:disabled) { transform: scale(0.97); }
    .ebs-ar-preview-none { margin: auto; padding: 24px; text-align: center; font-size: 13px; color: #5d6584; }

    .ebs-ar-bar { position: fixed; left: 50%; bottom: 24px; z-index: 2147481000; width: max-content; max-width: calc(100vw - 32px); display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 20px; background: #232c4f; color: #ffffff; border-radius: 14px; box-shadow: 0 18px 44px rgba(20, 26, 48, .35); font-family: Ubuntu, system-ui, sans-serif; opacity: 0; transform: translate(-50%, 16px); visibility: hidden; pointer-events: none; transition: opacity 150ms ease-in, transform 150ms ease-in, visibility 0s linear 150ms; }
    .ebs-ar-bar.show { opacity: 1; transform: translate(-50%, 0); visibility: visible; pointer-events: auto; transition: opacity 200ms cubic-bezier(0.23, 1, 0.32, 1), transform 200ms cubic-bezier(0.23, 1, 0.32, 1), visibility 0s; }
    .ebs-ar-bar-summary { display: flex; flex-direction: column; gap: 2px; min-width: 150px; }
    .ebs-ar-bar-count { font-size: 14px; font-weight: 700; white-space: nowrap; }
    .ebs-ar-bar-sub { font-size: 12px; color: #c4cae0; }
    .ebs-ar-bar-divider { width: 1px; height: 32px; background: rgba(255, 255, 255, .2); }
    .ebs-ar-bar-button { height: 40px; padding: 0 14px; border-radius: 9px; font-size: 14px; display: flex; align-items: center; gap: 6px; white-space: nowrap; cursor: pointer; transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease, transform 120ms cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-ar-bar-button.green { border: 0; background: #5d9e35; color: #ffffff; font-weight: 700; }
    .ebs-ar-bar-button.green:hover { background: #4f8a2c; }
    .ebs-ar-bar-button.ghost { border: 1px solid rgba(255, 255, 255, .35); background: transparent; color: #ffffff; }
    .ebs-ar-bar-button.ghost:hover { background: rgba(255, 255, 255, .1); }
    .ebs-ar-bar-button.quiet { padding: 0 10px; border: 0; background: transparent; color: #c4cae0; }
    .ebs-ar-bar-button.quiet:hover { color: #ffffff; }
    .ebs-ar-bar-button:disabled { opacity: .5; cursor: default; }
    .ebs-ar-bar-button:active:not(:disabled) { transform: scale(0.97); }
    .ebs-ar-bar-button:focus-visible { outline: 2px solid #ffffff; outline-offset: 2px; }
    /* Above the bar, so the bar keeps its width and place when one shows. */
    .ebs-ar-bar-message { position: absolute; right: 10px; bottom: calc(100% + 8px); max-width: 360px; padding: 8px 12px; border-radius: 10px; background: #232c4f; box-shadow: 0 8px 24px rgba(20, 26, 48, .3); font-size: 12px; line-height: 16px; color: #ffd8d3; transition: opacity 150ms ease, transform 150ms cubic-bezier(0.23, 1, 0.32, 1); }
    .ebs-ar-bar-message:empty { opacity: 0; transform: translateY(4px); pointer-events: none; }

    .ebs-ar-in { animation: ebs-ar-in 150ms cubic-bezier(0.23, 1, 0.32, 1) both; }
    @keyframes ebs-ar-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @keyframes ebs-ar-fade { from { opacity: 0; } to { opacity: 1; } }
    @keyframes ebs-ar-shimmer { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
    @keyframes ebs-ar-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .ebs-ar-in, html.ebs-better-archive app-digitaal-archief-upload, html.ebs-better-archive.ebs-archive-menu app-digitaal-archief-context-menu .contextMenu { animation: ebs-ar-fade 150ms ease-out both; }
      .ebs-ar-skel, .ebs-ar-page-loading { animation: none; }
      .ebs-ar-refresh[aria-busy="true"] .ebs-ar-spin { animation: none; }
      .ebs-ar-tip { transform: translate(-50%, 0); }
      .ebs-ar-tip.l, .ebs-ar-tip.r { transform: none; }
      .ebs-ar-droplabel { transform: translateY(-50%); }
      .ebs-ar-bar, .ebs-ar-bar.show { transform: translate(-50%, 0); }
      .ebs-ar-bar.show { transition: opacity 150ms ease-out, visibility 0s; }
      .ebs-ar-progress-bar { transition: none; }
      .ebs-ar-head-message:empty, .ebs-ar-bar-message:empty { transform: none; }
      .ebs-ar-button:active:not(:disabled), .ebs-ar-pbutton:active:not(:disabled), .ebs-ar-bar-button:active:not(:disabled) { transform: none; }
    }
  `;

  // -------------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------------

  function start() {
    try {
      chrome.storage.local.get('classicScreens').then(({ classicScreens: stored }) => {
        classicScreens = stored ?? {};
        EBS.watchSettings((next) => {
          settings = next;
          settingsLoaded = true;
          update();
        });
      }, () => {});
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes.classicScreens) return;
        classicScreens = changes.classicScreens.newValue ?? {};
        update();
      });
    } catch {
      // Orphaned after an extension reload: the screen stays e-Boekhouden's own.
      return;
    }

    // A link to the archive: observe before Angular loads its first folder.
    document.addEventListener('click', (event) => {
      if (!event.isTrusted || !settingsLoaded || !settings.betterDesign || classicScreens[SCREEN]) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!link) return;
      let target;
      try {
        target = new URL(link.href, location.href);
      } catch {
        return;
      }
      if (target.origin !== location.origin || !PAGE.test(target.pathname)) return;
      observe(true);
      // The page did not go to the archive after all: stop observing.
      setTimeout(update, 5000);
    }, true);

    // Our own drawing must not wake the loop.
    new MutationObserver((records) => {
      const native = records.some((record) => {
        const node = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
        return Boolean(node?.isConnected) && !node.closest(OURS);
      });
      if (native) schedule();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'custom-hidden', 'title'] });
    // A native checkbox changes its property, not the DOM.
    document.addEventListener('change', schedule, true);
    document.addEventListener('keyup', (event) => {
      if (event.key === 'Shift') view.previewRange(null);
    });
    window.addEventListener('resize', () => view.bar.place(), { passive: true });
    let lastPath = location.pathname;
    const watch = setInterval(() => {
      if (!chrome.runtime?.id) {
        clearInterval(watch);
        return;
      }
      if (location.pathname === lastPath) return;
      lastPath = location.pathname;
      // A next visit to the archive is a new screen load: one new count.
      ui.inboxAsked = null;
      ui.anchorKey = null;
      ui.query = '';
      ui.quick = 'all';
      ui.sortDir = 'desc';
      update();
    }, 300);
  }

  start();
})();
