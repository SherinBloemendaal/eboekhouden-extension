// The toolbar popup: administrations with their status, switching, logging in
// again, profile pictures and the feature switches. Reads the same mirrored
// state as the pages (chrome.storage.local); actions go to the service worker.

const CAMERA_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';

const SETTINGS = [
  ['betterDesign', 'Better design', 'Nieuwe inlogpagina en importweergave, en straks meer schermen'],
  ['onePassword', 'Inloggen met 1Password', 'Inlogformulier zonder frameset, zodat 1Password werkt'],
  ['switcher', 'Administraties in de navbar', 'Wisselmenu in de balk van e-Boekhouden'],
  ['relogin', 'Opnieuw inloggen in de pagina', 'Venster als je sessie verloopt'],
  ['shiftSelect', 'Shift-selectie bij importeren', 'Shift-klik selecteert alle regels ertussen'],
  ['actionBar', 'Actiebalk bij selectie', 'Wegboeken en verwijderen onderaan in beeld'],
];

let state = { slots: [], view: {}, avatars: {}, settings: EBS.settingsWithDefaults() };
let confirm = null;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function load() {
  const all = await chrome.storage.local.get(null);
  state = {
    slots: Array.isArray(all.slots) ? all.slots : [],
    view: all.view ?? {},
    avatars: Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith('avatar:')).map(([key, value]) => [key.slice(7), value])),
    settings: EBS.settingsWithDefaults(all.settings),
  };
  render();
}

async function act(type, extra = {}) {
  const response = await chrome.runtime.sendMessage({ type, confirmed: Boolean(confirm?.accepted), ...extra }).catch(() => ({}));
  if (response?.needsConfirm) {
    confirm = { type, extra, tabCount: response.tabCount, accepted: false };
    render();
    return;
  }
  confirm = null;
  window.close();
}

function avatarFor(slot, status) {
  const picture = state.avatars[slot.id];
  if (picture) {
    const image = el('img', 'avatar');
    image.src = picture;
    image.alt = '';
    return image;
  }
  return el('span', `avatar ${status}`, EBS.initials(slot.name));
}

function row(slot) {
  const status = EBS.statusOf(slot, state.view);
  const item = el('div', `row ${status}`);
  item.append(avatarFor(slot, status));

  const text = el('span', 'text');
  text.append(el('span', 'name', slot.name));
  const sub = {
    active: slot.number ?? '',
    ready: slot.number ?? '',
    expired: 'Verlopen',
    login: 'Niet ingelogd',
  }[status];
  text.append(el('span', `sub ${status === 'expired' ? 'expired' : ''}`, sub));
  item.append(text);

  if (status === 'active') {
    item.append(el('span', 'state-active', 'Actief'));
  } else {
    const label = { ready: 'Wissel', expired: 'Opnieuw inloggen', login: 'Inloggen' }[status];
    const button = el('button', `btn ${status === 'expired' ? 'primary' : ''}`, label);
    button.type = 'button';
    button.addEventListener('click', () => act('switcher:switch', { slotId: slot.id }));
    item.append(button);
  }

  const camera = el('button', 'icon-btn');
  camera.type = 'button';
  camera.title = state.avatars[slot.id] ? 'Profielfoto wijzigen' : 'Profielfoto kiezen';
  camera.setAttribute('aria-label', camera.title);
  camera.innerHTML = CAMERA_ICON;
  // A file dialog closes the toolbar popup, so the picker opens in its own window.
  camera.addEventListener('click', () => {
    chrome.windows.create({ url: chrome.runtime.getURL(`src/popup/popup.html?pick=${encodeURIComponent(slot.id)}`), type: 'popup', width: 420, height: 320 });
    window.close();
  });
  item.append(camera);
  return item;
}

function renderConfirm() {
  const box = document.getElementById('confirm');
  box.replaceChildren();
  if (!confirm) return;
  const inner = el('div', 'confirm');
  inner.append(el('span', '', `Alle ${confirm.tabCount} e-Boekhouden-tabbladen worden herladen. Niet opgeslagen invoer gaat verloren.`));
  const buttons = el('div', 'confirm-buttons');
  const no = el('button', 'btn', 'Annuleren');
  no.type = 'button';
  no.addEventListener('click', () => {
    confirm = null;
    render();
  });
  const ok = el('button', 'btn primary', 'Doorgaan');
  ok.type = 'button';
  ok.addEventListener('click', () => {
    confirm.accepted = true;
    act(confirm.type, confirm.extra);
  });
  buttons.append(no, ok);
  inner.append(buttons);
  box.append(inner);
}

function renderSettings() {
  const list = document.getElementById('settings');
  list.replaceChildren();
  for (const [key, title, hint] of SETTINGS) {
    const line = el('div', 'setting');
    const text = el('span', 'setting-text');
    const label = el('span', 'setting-title', title);
    label.id = `setting-${key}`;
    text.append(label, el('span', 'setting-hint', hint));
    const toggle = el('button', 'switch');
    toggle.type = 'button';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-checked', String(Boolean(state.settings[key])));
    toggle.setAttribute('aria-labelledby', label.id);
    toggle.append(el('span', 'knob'));
    toggle.addEventListener('click', async () => {
      const settings = { ...state.settings, [key]: !state.settings[key] };
      await chrome.storage.local.set({ settings });
    });
    line.append(text, toggle);
    list.append(line);
  }
}

function render() {
  document.body.classList.toggle('better', Boolean(state.settings.betterDesign));
  document.getElementById('count').textContent = `${state.slots.length} ${state.slots.length === 1 ? 'sessie' : 'sessies'}`;
  const list = document.getElementById('list');
  list.replaceChildren();
  if (!state.slots.length) list.append(el('p', 'empty', 'Nog geen administraties. Log in bij e-Boekhouden, dan verschijnt de administratie hier vanzelf.'));
  for (const slot of state.slots) list.append(row(slot));
  renderConfirm();
  renderSettings();
}

async function runPicker(slotId) {
  document.getElementById('main').hidden = true;
  document.querySelector('.top').hidden = true;
  const picker = document.getElementById('picker');
  picker.hidden = false;
  await load();
  const slot = state.slots.find((candidate) => candidate.id === slotId);
  document.getElementById('picker-title').textContent = slot ? `Profielfoto voor ${slot.name}` : 'Profielfoto';
  const status = document.getElementById('picker-status');
  document.getElementById('picker-input').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    status.textContent = 'Bezig met opslaan…';
    try {
      const response = await chrome.runtime.sendMessage({ type: 'avatar:set', slotId, dataUrl: await EBS.toAvatar(file) });
      if (response?.error) throw new Error(response.error);
      status.textContent = 'Opgeslagen.';
      setTimeout(() => window.close(), 500);
    } catch {
      status.textContent = 'Deze afbeelding kon niet worden gebruikt. Probeer een andere.';
    }
  });
}

document.getElementById('add').addEventListener('click', () => act('switcher:add'));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') load();
});

const pick = new URLSearchParams(location.search).get('pick');
if (pick) runPicker(pick);
else load();
