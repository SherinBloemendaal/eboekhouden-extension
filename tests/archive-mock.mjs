// A stand-in for e-Boekhouden's Digitaal archief (app-digitaal-archief and its
// children), with the markup of its templates and small handlers that act like
// its Angular components: the folder tree, the header, the toolbar, the file
// list with checkboxes and "koppelingen", the right-click menu, the upload
// window. It loads its data with the page's own GETs (fetch or XHR), as the
// real screen does, so the extension can observe them. Every action it is
// asked for lands in window.__archive.log; nothing is really changed.
//
// Used by tests/archive-dom.test.mjs (jsdom) and the headless Chrome check.

export const API = '/v1/api/';

// The page around the component: the header with the administration number.
export function shellHtml({ adminNumber = '1000001' } = {}) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Digitaal archief</title><style>[custom-hidden] { display: none !important; } app-digitaal-archief-upload app-file-upload { display: block; padding: 16px; background: #fff; }</style></head><body>
<app-header-identity-b><div class="header-identity"><div class="userInfo"><span class="userName">Voorbeeld B.V.</span><span class="administratieId">${adminNumber}</span></div></div></app-header-identity-b>
<div id="app" style="height:900px"></div></body></html>`;
}

export function demoData({ many = 0, fail = false } = {}) {
  const folders = [
    { id: 11, parentId: 0, naam: 'Inbox', isDeleted: false },
    { id: 12, parentId: 0, naam: 'Inkoopfacturen 2026', isDeleted: false },
    { id: 13, parentId: 12, naam: 'Oktober', isDeleted: false },
    { id: 14, parentId: 0, naam: 'Leeg', isDeleted: false },
  ];
  const at = (day, hour = 9) => `2026-10-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:15:00`;
  const files = {
    0: [
      { id: 11, naam: 'Inbox', soort: 'D', datum: at(2, 8), size: 0, koppelCount: 0, isDeleted: false },
      { id: 12, naam: 'Inkoopfacturen 2026', soort: 'D', datum: at(3, 10), size: 0, koppelCount: 0, isDeleted: false },
      { id: 14, naam: 'Leeg', soort: 'D', datum: at(1, 7), size: 0, koppelCount: 0, isDeleted: false },
    ],
    11: [
      { id: 201, naam: 'Bonnetje tankstation.jpg', soort: 'F', datum: at(27), size: 1468006, koppelCount: 0, dateDone: at(27), isDeleted: false },
      { id: 202, naam: 'Scan 0043.pdf', soort: 'F', datum: at(22), size: 2202009, koppelCount: 0, dateRequested: at(22), isDeleted: false },
    ],
    12: [
      { id: 13, naam: 'Oktober', soort: 'D', datum: at(1), size: 0, koppelCount: 0, isDeleted: false },
      { id: 101, naam: 'Factuur 2026-0412 Demo Leverancier.pdf', soort: 'F', datum: at(28), size: 186368, koppelCount: 1, menHStatus: 'I', isDeleted: false },
      { id: 102, naam: 'Bonnetje tankstation.jpg', soort: 'F', datum: at(27), size: 1468006, koppelCount: 0, dateDone: at(27), isDeleted: false },
      { id: 103, naam: 'Telefoonabonnement oktober.pdf', soort: 'F', datum: at(25), size: 98304, koppelCount: 1, menHStatus: 'V', isDeleted: false },
      { id: 104, naam: 'Huur kantoor november.pdf', soort: 'F', datum: at(24), size: 215040, koppelCount: 1, menHStatus: 'I', isDeleted: false },
      { id: 105, naam: 'Software licentie.xml', soort: 'F', datum: at(20), size: 12288, koppelCount: 0, menHStatus: 'V', isDeleted: false },
      { id: 106, naam: 'Parkeren Utrecht.png', soort: 'F', datum: at(18), size: 655360, koppelCount: 0, menHStatus: 'NOCREDITS', isDeleted: false },
      { id: 107, naam: 'Factuur 88231 Voorbeeld Hosting.pdf', soort: 'F', datum: at(15), size: 90112, koppelCount: 2, menHStatus: 'I', isDeleted: false },
    ],
    13: [],
    14: [],
  };
  if (many) {
    files[13] = Array.from({ length: many }, (_, n) => ({
      id: 5000 + n, naam: `${String(n + 1).padStart(4, '0')} Bon ${n % 7 ? 'parkeren' : 'lunch'}.pdf`, soort: 'F', datum: at(1 + (n % 28), 8 + (n % 9)),
      size: 50000 + n * 13, koppelCount: n % 3 === 0 ? 1 : 0, ...(n % 5 === 0 ? { dateDone: at(2) } : { menHStatus: 'V' }), isDeleted: false,
    }));
  }
  const koppel = {
    101: { koppelMutatie: [{ id: 1, nummer: 4821, datum: '2026-10-28T00:00:00', bedrag: 1210, soort: 1, factuur: '2026-0412', boekstuk: '' }], koppelRelatie: [], koppelImport: [], koppelOfferte: [] },
    103: { koppelMutatie: [], koppelRelatie: [{ id: 2, relatieCode: 'VTEL', bedrijf: 'Voorbeeld Telecom', plaats: '', email: '' }], koppelImport: [], koppelOfferte: [] },
    104: { koppelMutatie: [{ id: 3, nummer: 4807, datum: '2026-10-24T00:00:00', bedrag: 1850, soort: 1, factuur: 'HUUR-11', boekstuk: '' }], koppelRelatie: [], koppelImport: [], koppelOfferte: [] },
    107: {
      koppelMutatie: [{ id: 4, nummer: 4790, datum: '2026-10-15T00:00:00', bedrag: 24.2, soort: 1, factuur: '88231', boekstuk: '' }],
      koppelRelatie: [{ id: 5, relatieCode: 'VHOST', bedrijf: 'Voorbeeld Hosting', plaats: '', email: '' }], koppelImport: [], koppelOfferte: [],
    },
  };
  return { folders, files, koppel, menhFolderId: 11, start: 12, fail };
}

// Answers for the page's (and the extension's) GETs, by path.
export function answer(data, path) {
  const route = path.replace(/^https:\/\/[^/]+/, '').replace(API, '');
  let match;
  if (route === 'folder/directory') return { status: 200, body: data.folders };
  if ((match = /^folder\/(\d+)\/header/.exec(route))) {
    const id = Number(match[1]);
    const list = data.files[id] ?? [];
    return {
      status: 200,
      body: {
        directoryInfo: { directoryName: id === 0 ? 'Basismap' : data.folders.find((folder) => folder.id === id)?.naam, fileCount: list.filter((item) => item.soort === 'F').length, subDirectoryCount: list.filter((item) => item.soort === 'D').length, deleted: false },
        dataUsed: 2469606195, dataLimit: 5242880000, credits: 12, creditsClient: 0, menhFolderId: data.menhFolderId,
      },
    };
  }
  if ((match = /^folder\/(\d+)\/filelist/.exec(route))) {
    if (data.fail) return { status: 500, body: { message: 'Er is iets misgegaan.' } };
    return { status: 200, body: data.files[Number(match[1])] ?? [] };
  }
  if ((match = /^folder\/(\d+)\/koppel$/.exec(route))) return { status: 200, body: data.koppel[Number(match[1])] ?? { koppelMutatie: [], koppelRelatie: [], koppelImport: [], koppelOfferte: [] } };
  if (route === 'folder/unprocessed/count') return { status: 200, body: 4 };
  if ((match = /^folder\/(\d+)\/preview/.exec(route))) {
    const name = Object.values(data.files).flat().find((item) => item.id === Number(match[1]))?.naam ?? '';
    return { status: 200, preview: /\.png$/i.test(name) ? 'image/png' : /\.jpe?g$/i.test(name) ? 'image/jpeg' : 'application/pdf' };
  }
  return { status: 404, body: { message: 'Niet gevonden' } };
}

// The component itself, as page script source: (data, { transport }) => void.
export const nativeScript = String.raw`
(function (data, options) {
  const transport = options.transport || 'fetch';
  const api = ${JSON.stringify(API)};
  const state = { folder: data.start, list: [], selected: new Set(), rightClick: null, knip: null, opened: new Map(), koppel: {}, menu: null, upload: false, ready: false, header: null, headerFor: null, headerLoading: false, openDirs: new Set([12]) };
  const log = [];
  window.__archive = { log, state };
  const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function get(path) {
    if (transport === 'xhr') {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', api + path);
        xhr.addEventListener('load', () => (xhr.status < 400 ? resolve(JSON.parse(xhr.responseText)) : reject(xhr.status)));
        xhr.addEventListener('error', () => reject(0));
        xhr.send();
      });
    }
    return window.fetch(api + path).then((response) => (response.ok ? response.json() : Promise.reject(response.status)));
  }
  const two = (n) => String(n).padStart(2, '0');
  function date(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
    return m ? m[3] + '-' + m[2] + '-' + m[1] + ' ' + m[4] + ':' + m[5] : '';
  }
  function size(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1).replace('.', ',') + ' mb';
    return Math.round(bytes / 1024) + ' kb';
  }
  function status(item) {
    const s = item.menHStatus === 'I' || item.menHStatus === 'V' ? item.menHStatus : item.dateDone ? 'done' : item.dateRequested ? 'inProgress' : item.menHStatus === 'NOCREDITS' ? 'NOCREDITS' : null;
    return { done: '<i class="eb-icon-ok alignRight"></i> Is herkend ', I: '<i class="eb-icon-ok alignRight"></i> Ingevoerd ', inProgress: '<i class="eb-icon-spinner-1 spinner"></i> Wordt herkend ', NOCREDITS: '<i class="eb-icon-triangle-exclamation-light"></i> Onvoldoende credits ', V: '<i class="eb-icon-triangle-exclamation-light"></i> Niet ingevoerd ' }[s] || '';
  }

  const app = document.getElementById('app');
  app.innerHTML = '<app-digitaal-archief><div class="container-da"><div class="main"><div class="left"><app-digitaal-archief-folder-list></app-digitaal-archief-folder-list></div><div class="separator"></div><div class="right"><app-digitaal-archief-file-header></app-digitaal-archief-file-header><app-digitaal-archief-knoppenbalk></app-digitaal-archief-knoppenbalk><app-digitaal-archief-file-list><div></div></app-digitaal-archief-file-list></div></div><app-digitaal-archief-context-menu><div class="contextMenu" custom-hidden=""></div></app-digitaal-archief-context-menu><app-digitaal-archief-folder-form></app-digitaal-archief-folder-form></div></app-digitaal-archief>';
  const host = app.querySelector('app-digitaal-archief');
  const container = host.querySelector('.container-da');
  const folderList = host.querySelector('app-digitaal-archief-folder-list');
  const header = host.querySelector('app-digitaal-archief-file-header');
  const toolbar = host.querySelector('app-digitaal-archief-knoppenbalk');
  const fileList = host.querySelector('app-digitaal-archief-file-list > div');
  const menu = host.querySelector('.contextMenu');

  function renderFolders() {
    const children = (id) => data.folders.filter((folder) => folder.parentId === id && folder.id !== 0).sort((a, b) => a.naam.localeCompare(b.naam));
    const node = (folder, root) => {
      const kids = children(folder.id);
      const open = root || state.openDirs.has(folder.id);
      return '<div class="dir' + (root ? ' root' : '') + '"><div class="dirItem' + (folder.id === state.folder ? ' selected' : '') + '" data-id="' + folder.id + '"><div class="dirToggle">' + (kids.length ? '<i class="' + (open ? 'eb-icon-down-dir' : 'eb-icon-right-dir') + '"></i>' : '') + '</div><div class="dirLabel"><i class="eb-icon-folder-open-regular"></i><span>' + esc(folder.naam) + '</span></div></div>' + (open ? kids.map((kid) => node(kid, false)).join('') : '') + '</div>';
    };
    folderList.innerHTML = '<div class="eb-scroll main">' + node({ id: 0, naam: 'Basismap' }, true) + '</div>';
  }

  function renderHeader() {
    const h = state.header;
    if (!h) { header.innerHTML = ''; return; }
    const inbox = h.menhFolderId === state.headerFor;
    header.innerHTML = '<div><div class="grid"><div class="grid-wrap"><div class="dirLabel" title="' + esc(h.directoryInfo.directoryName) + '"><i class="eb-icon-folder-open-regular folder"></i><span>' + esc(h.directoryInfo.directoryName) + '</span></div></div><div><div class="dirLabel"><span>Automatisch herkennen</span></div></div><div class="data-usage-align datagebruik"><div class="datalimit-align"> Opslag: (2,3 gb / 5 gb) &nbsp; <a>wijzig</a></div></div><div class="align-text"> ' + h.directoryInfo.subDirectoryCount + ' submappen </div><div> Credits: 12 </div><div class="data-usage-align"><div class="datalimit-align datalimit"><div id="datagebruik"></div></div></div><div class="align-text"> ' + h.directoryInfo.fileCount + ' bestanden </div><div class="herken">' + (inbox ? '<div class="grid-herken"> Inbox voor \'Mail & Herken\' ( <a>meer informatie</a> ) </div>' : '<div class="grid-herken"><a>Maak</a> deze map uw inbox voor \'Mail & Herken\' ( <a>meer informatie</a> ) </div>') + '</div><div class="align-right download-button"><a>Downloaden</a></div></div></div>';
  }

  function renderToolbar() {
    const sel = state.selected.size + (state.rightClick && !state.selected.has(state.rightClick) ? 1 : 0);
    const item = (title, disabled, icon) => '<div class="flex' + (disabled ? ' disabled' : '') + '" title="' + title + '"><div class="icon-pad"><i class="' + icon + '"></i></div></div>';
    toolbar.innerHTML = '<div class="seperator"></div><div class="flexbox">' + item('Nieuwe map', false, 'eb-icon-folder-plus-light') + item('Geselecteerde items knippen', !sel, 'eb-icon-cut-light') + item('Geselecteerde items plakken', !state.knip, 'eb-icon-paste-regular') + item('Bestanden uploaden', false, 'eb-icon-up-from-bracket-light') + item('Lijst vernieuwen', false, 'eb-icon-spinner') + item('Geselecteerde items verwijderen', !sel, 'eb-icon-trash-alt-light') + item('Verwijderen ongedaan maken bij de geselecteerde items', true, 'eb-icon-trash-can-undo-light') + '<div class="delete"><app-checkbox class="daCheckbox"></app-checkbox></div></div>';
  }

  function koppelHtml(id) {
    const k = state.koppel[id];
    if (!k) return '<app-digitaal-archief-koppelingen></app-digitaal-archief-koppelingen>';
    if (!state.opened.get(id)) return '<app-digitaal-archief-koppelingen></app-digitaal-archief-koppelingen>';
    const cell = (value) => '<div class="flex-nested"> ' + esc(value) + ' </div>';
    const mut = k.koppelMutatie.map((m) => '<div class="flexbox nested"><div class="row-nested"><div class="flex-nested delete"><i class="eb-icon-xmark-solid"></i></div><div class="flex-nested first"><a title="Mutatie" class="open"><i class="eb-icon-shuffle-light inline-icon"></i> ' + m.nummer + ' </a></div>' + cell(date(m.datum).slice(0, 10)) + '<div class="flex-nested">€ ' + m.bedrag.toLocaleString('nl-NL', { minimumFractionDigits: 2 }) + '</div>' + cell(['', 'Factuur ontvangen', 'Factuur verstuurd'][m.soort] || '') + cell(m.factuur) + cell(m.boekstuk) + '</div></div>').join('');
    const rel = k.koppelRelatie.map((r) => '<div class="flexbox nested"><div class="row-nested"><div class="flex-nested delete"><i class="eb-icon-xmark-solid"></i></div><div class="flex-nested first"><a title="Relatie" class="open"><i class="eb-icon-user-light inline-icon"></i> ' + esc(r.relatieCode) + ' </a></div>' + cell(r.bedrijf) + cell(r.plaats) + cell(r.email) + '</div></div>').join('');
    return '<app-digitaal-archief-koppelingen><div>' + (rel ? '<app-digitaal-archief-koppel-relatie>' + rel + '</app-digitaal-archief-koppel-relatie>' : '') + (mut ? '<app-digitaal-archief-koppel-mutatie>' + mut + '</app-digitaal-archief-koppel-mutatie>' : '') + '</div></app-digitaal-archief-koppelingen>';
  }

  function renderList() {
    if (!state.ready) { fileList.innerHTML = ''; return; }
    const rows = state.list.map((item) => {
      const checked = state.selected.has(item.id) || state.rightClick === item.id;
      const icon = item.soort === 'D' ? 'eb-icon-folder-open-regular folder' : 'eb-icon-file-pdf-light fa-lg pdf';
      const toggle = item.koppelCount > 0 ? '<span class="spanKoppel"><i class="' + (state.opened.get(item.id) ? 'eb-icon-down-dir' : 'eb-icon-right-dir') + ' koppel"></i></span>' : '<span></span>';
      return '<div class="row" data-id="' + item.id + '"><div class="flexMulti g-check"><app-condition-container><div class="select"><input type="checkbox" class="checkbox"' + (checked ? ' checked' : '') + '><span class="chk"></span></div></app-condition-container></div><div class="koppel g-link">' + toggle + '</div><div class="flex name g-name"><i class="' + icon + '"></i><span title="' + esc(item.naam) + '">' + esc(item.naam) + '</span></div><div class="flex alignPipe g-date"> ' + date(item.datum) + ' </div><div class="flex alignPipe g-status"><div class="nested-align">' + (item.soort === 'F' ? status(item) : '') + '</div></div><div class="flex alignSize g-size"><div class="flex-inner-container">' + (item.soort === 'F' ? '<span class="size"> ' + size(item.size) + ' </span>' : '') + '</div></div></div>' + (state.opened.has(item.id) ? koppelHtml(item.id) : '');
    }).join('');
    fileList.innerHTML = '<div class="eb-scroll eb-scroll-x eb-scroll-y noWrap"><div class="heading"><div class="selectth select selectAll"><input type="checkbox" class="checkbox"><span class="chk"></span></div><div class="koppelth"><span></span></div><div class="head firstChild"><span>Naam</span></div><div class="head"><span>Datum</span></div><div class="head status"><span>Status</span></div><div class="head lastChild"><span>Grootte</span></div></div><div class="body">' + rows + '</div></div>';
    for (const row of fileList.querySelectorAll('.row')) {
      const id = Number(row.dataset.id);
      row.querySelector('.g-check input').checked = state.selected.has(id) || state.rightClick === id;
    }
  }

  function render() { renderFolders(); renderHeader(); renderToolbar(); renderList(); }

  function sortList(list) {
    return list.filter((item) => item.soort === 'D').sort((a, b) => a.naam.localeCompare(b.naam)).concat(list.filter((item) => item.soort === 'F').sort((a, b) => a.naam.localeCompare(b.naam)));
  }

  // e-Boekhouden's file header (its loadDirectory): while its own GET runs it
  // skips the next folder, so after a quick second click it keeps showing the
  // folder before.
  function loadHeader() {
    if (state.headerLoading) return;
    state.headerLoading = true;
    const id = state.folder;
    get('folder/' + id + '/header').then((h) => { state.header = h; state.headerFor = id; renderHeader(); }, () => {}).finally(() => { state.headerLoading = false; });
  }

  // e-Boekhouden's loadDirectory: the tree shows the folder at once and asks
  // its folder list again, the header loads, and the file list asks its files
  // without dropping an older request (the answer that comes last is shown),
  // empty for a moment before the rows.
  function loadDirectory(id) {
    state.folder = id;
    state.selected.clear();
    state.rightClick = null;
    state.opened.clear();
    renderFolders();
    renderToolbar();
    get('folder/directory').then((list) => { data.folders = list; renderFolders(); }, () => {});
    loadHeader();
    get('folder/' + id + '/filelist').then((list) => {
      state.ready = true;
      state.list = [];
      renderList();
      setTimeout(() => { state.list = sortList(list); renderList(); }, 20);
    }, (code) => log.push('filelist failed ' + code));
  }

  function selection() {
    const ids = [...state.selected];
    if (state.rightClick && !ids.includes(state.rightClick)) ids.push(state.rightClick);
    return ids;
  }

  function openMenu(item, x, y) {
    state.rightClick = item.id;
    state.menu = { item, selected: selection() };
    menu.removeAttribute('custom-hidden');
    menu.classList.add('calc');
    const valid = /\.(pdf|jpg|jpeg|png)$/i.test(item.naam);
    const entry = (label, disabled) => '<div class="contextMenuItem' + (disabled ? ' disabled' : '') + '"><i></i><span>' + label + '</span></div>';
    menu.innerHTML = entry('Naam wijzigen') + entry('Verwijderen') + entry('Invoeren als mutatie', item.isDeleted) + entry('Herkennen', !valid) + entry('Koppelen aan relatie') + entry('Koppelen aan mutatie');
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    renderList();
    renderToolbar();
    setTimeout(() => menu.classList.remove('calc'));
  }

  function closeMenu() {
    state.menu = null;
    menu.setAttribute('custom-hidden', '');
  }

  host.addEventListener('change', (event) => {
    const input = event.target.closest('.row .g-check input');
    if (!input) return;
    const id = Number(input.closest('.row').dataset.id);
    if (state.rightClick === id) { state.rightClick = null; state.selected.delete(id); }
    else if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    // Angular only updates this box and the toolbar, not the whole list.
    input.checked = state.selected.has(id);
    renderToolbar();
  });
  host.addEventListener('click', (event) => {
    const target = event.target;
    const label = target.closest('.dirLabel');
    if (label && label.closest('app-digitaal-archief-folder-list')) { loadDirectory(Number(label.closest('.dirItem').dataset.id)); return; }
    const dirToggle = target.closest('.dirToggle i');
    if (dirToggle) {
      const id = Number(dirToggle.closest('.dirItem').dataset.id);
      if (state.openDirs.has(id)) state.openDirs.delete(id); else state.openDirs.add(id);
      renderFolders();
      return;
    }
    const koppel = target.closest('.spanKoppel');
    if (koppel) {
      const id = Number(koppel.closest('.row').dataset.id);
      const opened = !state.opened.get(id);
      state.opened.set(id, opened);
      renderList();
      if (opened && !state.koppel[id]) get('folder/' + id + '/koppel').then((k) => { state.koppel[id] = k; renderList(); });
      return;
    }
    const item = target.closest('.contextMenuItem');
    if (item) {
      if (item.classList.contains('disabled')) return;
      const what = item.textContent.trim();
      log.push(what + ' ' + state.menu.selected.join(','));
      closeMenu();
      return;
    }
    const tool = target.closest('app-digitaal-archief-knoppenbalk .flex');
    if (tool) {
      if (tool.classList.contains('disabled')) return;
      const title = tool.getAttribute('title');
      log.push(title + (title.startsWith('Geselecteerde') ? ' ' + (title.includes('plakken') ? state.knip.join(',') + ' naar ' + state.folder : selection().join(',')) : ''));
      if (title === 'Geselecteerde items knippen') state.knip = selection();
      if (title === 'Lijst vernieuwen' || title === 'Geselecteerde items plakken') loadDirectory(state.folder);
      if (title === 'Bestanden uploaden') openUpload();
      renderToolbar();
    }
  });
  host.addEventListener('dblclick', (event) => {
    const row = event.target.closest('.row');
    if (!row) return;
    const id = Number(row.dataset.id);
    const item = state.list.find((one) => one.id === id);
    if (item.soort === 'D') loadDirectory(id);
    else log.push('download ' + id);
  });
  host.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('.row');
    if (!row) return;
    event.preventDefault();
    openMenu(state.list.find((one) => one.id === Number(row.dataset.id)), event.clientX, event.clientY);
  });
  window.addEventListener('pointerup', (event) => {
    if (state.menu && !menu.contains(event.target)) closeMenu();
  });

  function openUpload() {
    if (state.upload) return;
    state.upload = true;
    const node = document.createElement('app-digitaal-archief-upload');
    node.innerHTML = '<app-file-upload><app-file-upload-header><span>Bestanden uploaden</span><a class="close">x</a></app-file-upload-header><app-file-upload-list><div class="file-container"><div class="file-drop"></div><div class="file-list"></div></div></app-file-upload-list><div class="hr"></div><app-file-upload-actions><button class="upload">Start upload</button><div class="progress"><span>0%</span></div><span>0/3 bestanden geüpload</span></app-file-upload-actions></app-file-upload>';
    node.querySelector('.file-container').addEventListener('drop', (event) => { event.preventDefault(); log.push('dropped ' + event.dataTransfer.files.length); });
    node.querySelector('.close').addEventListener('click', () => { state.upload = false; node.remove(); });
    node.querySelector('.upload').addEventListener('click', () => log.push('Start upload'));
    container.insertBefore(node, container.querySelector('app-digitaal-archief-folder-form'));
  }

  // For the tests: a folder change e-Boekhouden starts itself (a new
  // folder, Naam wijzigen on a folder, a deleted folder, its upload menu).
  window.__archive.loadDirectory = loadDirectory;

  render();
  loadDirectory(data.start);
})`;
