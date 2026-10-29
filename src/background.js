// Service worker: owns the saved sessions, the cookie swap and the per-tab
// re-login state. Cookie values never leave this context: content scripts only
// ever receive labels and flags.

const COOKIE_DOMAIN = 'e-boekhouden.nl';
const EB_TAB_PATTERN = 'https://*.e-boekhouden.nl/*';
const LOGIN_TITLE = /^inloggen\b/i;

// chrome.storage.session lives in memory only and is wiped when Chrome quits.
// Restrict it to extension pages so content scripts can never read it.
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

// ---------------------------------------------------------------------------
// Storage helpers
//
// local:   slots         [{ id, title, label }]   (names only, no secrets)
// session: cookies:<id>  [chrome.cookies.Cookie]  (the session itself)
//          activeSlotId, loggedIn
//          tab:<tabId>   { mainFrameId, returnUrl, relogin, innerUrl, innerFor, restoreInner, header }
// ---------------------------------------------------------------------------

async function getSlots() {
  const { slots = [] } = await chrome.storage.local.get('slots');
  return slots;
}

async function setSlots(slots) {
  await chrome.storage.local.set({ slots });
}

async function getSessionState() {
  const { activeSlotId = null, loggedIn = false } = await chrome.storage.session.get(['activeSlotId', 'loggedIn']);
  return { activeSlotId, loggedIn };
}

async function getTab(tabId) {
  const key = `tab:${tabId}`;
  const { [key]: tab = {} } = await chrome.storage.session.get(key);
  return tab;
}

async function setTab(tabId, tab) {
  await chrome.storage.session.set({ [`tab:${tabId}`]: tab });
}

async function clearAllTabStates() {
  const all = await chrome.storage.session.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith('tab:'));
  // Keep the frame registry, drop everything that would trigger a re-login return.
  const updates = {};
  for (const key of keys) {
    const { mainFrameId, header } = all[key];
    updates[key] = { mainFrameId, header };
  }
  await chrome.storage.session.set(updates);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`tab:${tabId}`);
});

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

async function readCookies() {
  return chrome.cookies.getAll({ domain: COOKIE_DOMAIN });
}

function cookieUrl(cookie) {
  const host = cookie.domain.replace(/^\./, '');
  return `https://${host}${cookie.path}`;
}

async function removeAllCookies() {
  const cookies = await readCookies();
  await Promise.all(cookies.map((cookie) => chrome.cookies.remove({
    url: cookieUrl(cookie),
    name: cookie.name,
    storeId: cookie.storeId,
  })));
}

async function restoreCookies(cookies) {
  const now = Date.now() / 1000;
  await Promise.all(cookies
    .filter((cookie) => cookie.session || !cookie.expirationDate || cookie.expirationDate > now)
    .map((cookie) => {
      const details = {
        url: cookieUrl(cookie),
        name: cookie.name,
        value: cookie.value,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        storeId: cookie.storeId,
      };
      // Host-only cookies must be set without a domain, or Chrome turns them into domain cookies.
      if (!cookie.hostOnly) details.domain = cookie.domain;
      if (!cookie.session && cookie.expirationDate) details.expirationDate = cookie.expirationDate;
      return chrome.cookies.set(details).catch((error) => {
        console.warn('EB Sessions: could not restore cookie', cookie.name, error);
      });
    }));
}

async function snapshotActiveSlot() {
  const { activeSlotId, loggedIn } = await getSessionState();
  if (!activeSlotId || !loggedIn) return;
  await chrome.storage.session.set({ [`cookies:${activeSlotId}`]: await readCookies() });
}

// ---------------------------------------------------------------------------
// Login detection
//
// The top-level /bh/ frameset carries the administration name as its title
// once logged in, and "Inloggen | e-Boekhouden.nl" on the login screen. That
// title is the identity we match slots on.
// ---------------------------------------------------------------------------

async function onTopTitle(title) {
  const trimmed = (title || '').trim();
  if (!trimmed) return;

  if (LOGIN_TITLE.test(trimmed)) {
    await chrome.storage.session.set({ loggedIn: false });
    await broadcastState();
    return;
  }

  const slots = await getSlots();
  let slot = slots.find((candidate) => candidate.title === trimmed);
  if (!slot) {
    slot = { id: crypto.randomUUID(), title: trimmed, label: trimmed };
    slots.push(slot);
    await setSlots(slots);
  }
  await chrome.storage.session.set({ activeSlotId: slot.id, loggedIn: true });
  await snapshotActiveSlot();
  await broadcastState();
}

// ---------------------------------------------------------------------------
// Switching
// ---------------------------------------------------------------------------

async function ebTabs() {
  return chrome.tabs.query({ url: EB_TAB_PATTERN });
}

// Plain /bh/ always serves the login frameset, also with a valid session.
// e-Boekhouden itself enters the app through /bh?v2Url=<secure20 page> (its
// "hybrid route"), so a switch to a stored session goes there.
const APP_START = 'https://secure20.e-boekhouden.nl/';

function ebUrl(origin, loggedIn) {
  return loggedIn ? `${origin}/bh?v2Url=${encodeURIComponent(APP_START)}` : `${origin}/bh/`;
}

async function reloadEbTabs(originHint, loggedIn) {
  const tabs = await ebTabs();
  await Promise.all(tabs.map((tab) => {
    const origin = tab.url ? new URL(tab.url).origin : originHint;
    const aspOrigin = /^https:\/\/secure\d*\.e-boekhouden\.nl$/.test(origin) && !origin.includes('secure20') ? origin : originHint;
    return chrome.tabs.update(tab.id, { url: ebUrl(aspOrigin, loggedIn) });
  }));
}

async function switchTo(slotId, originHint) {
  await snapshotActiveSlot();
  const { [`cookies:${slotId}`]: cookies } = await chrome.storage.session.get(`cookies:${slotId}`);

  await removeAllCookies();
  if (cookies?.length) await restoreCookies(cookies);

  // loggedIn is confirmed again by the title of the reloaded page.
  await chrome.storage.session.set({ activeSlotId: slotId, loggedIn: false });
  await clearAllTabStates();
  await reloadEbTabs(originHint, Boolean(cookies?.length));
}

async function addSession(originHint) {
  await snapshotActiveSlot();
  await removeAllCookies();
  await chrome.storage.session.set({ activeSlotId: null, loggedIn: false });
  await clearAllTabStates();
  await reloadEbTabs(originHint, false);
}

async function renameSlot(slotId, label) {
  const clean = String(label || '').trim().slice(0, 60);
  if (!clean) return;
  const slots = await getSlots();
  const slot = slots.find((candidate) => candidate.id === slotId);
  if (!slot) return;
  slot.label = clean;
  await setSlots(slots);
}

async function removeSlot(slotId) {
  const slots = (await getSlots()).filter((slot) => slot.id !== slotId);
  await setSlots(slots);
  await chrome.storage.session.remove(`cookies:${slotId}`);
  const { activeSlotId } = await getSessionState();
  if (activeSlotId === slotId) await chrome.storage.session.set({ activeSlotId: null });
}

// ---------------------------------------------------------------------------
// View model for the switcher UI (labels and flags only)
// ---------------------------------------------------------------------------

async function viewModel() {
  const [slots, { activeSlotId, loggedIn }, tabs] = await Promise.all([getSlots(), getSessionState(), ebTabs()]);
  const stored = await chrome.storage.session.get(slots.map((slot) => `cookies:${slot.id}`));
  return {
    loggedIn,
    tabCount: tabs.length,
    activeLabel: slots.find((slot) => slot.id === activeSlotId)?.label ?? null,
    slots: slots.map((slot) => ({
      id: slot.id,
      label: slot.label,
      active: slot.id === activeSlotId,
      ready: Boolean(stored[`cookies:${slot.id}`]?.length),
    })),
  };
}

async function broadcastState() {
  const view = await viewModel();
  const tabs = await ebTabs();
  await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'state:changed', view }).catch(() => {})));
}

// ---------------------------------------------------------------------------
// Re-login: per tab we remember the last page shown in mainframe. When the
// mainframe lands on a login or session-expired page while a page was known,
// the login page switches to dialog mode, and the first app page after login
// is sent back to that page.
// ---------------------------------------------------------------------------

async function onMainPage(tabId, frameId, { url, kind }) {
  const tab = await getTab(tabId);
  tab.mainFrameId = frameId;
  let response = {};

  if (kind === 'logout') {
    await setTab(tabId, { mainFrameId: frameId, header: tab.header });
    await chrome.storage.session.set({ loggedIn: false });
    await broadcastState();
    return response;
  }

  if (kind === 'login' || kind === 'expired') {
    if (tab.returnUrl) tab.relogin = true;
    response = { relogin: Boolean(tab.relogin), headerPresent: Boolean(tab.header) };
    await setTab(tabId, tab);
    return response;
  }

  // kind === 'app'
  if (tab.relogin && tab.returnUrl) {
    const target = tab.returnUrl;
    tab.relogin = false;
    tab.restoreInner = tab.innerFor === target ? tab.innerUrl : null;
    if (url !== target) response.navigate = target;
  } else {
    if (tab.returnUrl !== url) {
      tab.innerUrl = null;
      tab.innerFor = null;
    }
    tab.returnUrl = url;
  }
  response.headerPresent = Boolean(tab.header);
  await setTab(tabId, tab);
  await snapshotActiveSlot();
  return response;
}

async function onInnerPage(tabId, { url, kind }) {
  const tab = await getTab(tabId);

  if (kind === 'login' || kind === 'expired') {
    // The login form of secure20/v1login lives in this inner frame.
    if (tab.returnUrl) tab.relogin = true;
    await setTab(tabId, tab);
    return { relogin: Boolean(tab.relogin) };
  }

  if (tab.restoreInner) {
    const target = tab.restoreInner;
    tab.restoreInner = null;
    await setTab(tabId, tab);
    return url === target ? {} : { navigate: target };
  }

  tab.innerUrl = url;
  tab.innerFor = tab.returnUrl ?? null;
  await setTab(tabId, tab);
  return {};
}

async function cancelRelogin(tabId) {
  const tab = await getTab(tabId);
  await setTab(tabId, { mainFrameId: tab.mainFrameId, header: tab.header });
}

// ---------------------------------------------------------------------------
// Messages from content scripts
// ---------------------------------------------------------------------------

const handlers = {
  'top:title': (message) => onTopTitle(message.title),
  'main:page': (message, sender) => onMainPage(sender.tab.id, sender.frameId, message),
  'inner:page': (message, sender) => onInnerPage(sender.tab.id, message),
  'relogin:cancel': (message, sender) => cancelRelogin(sender.tab.id),
  'header:hello': async (message, sender) => {
    const tab = await getTab(sender.tab.id);
    tab.header = true;
    await setTab(sender.tab.id, tab);
    return viewModel();
  },
  'state:get': () => viewModel(),
  'tab:info': async (message, sender) => ({ headerPresent: Boolean((await getTab(sender.tab.id)).header) }),
  'switcher:toggle': async (message, sender) => {
    const tab = await getTab(sender.tab.id);
    if (tab.mainFrameId === undefined) return {};
    const view = await viewModel();
    await chrome.tabs.sendMessage(sender.tab.id, { type: 'switcher:toggle', anchorRight: message.anchorRight, view }, { frameId: tab.mainFrameId }).catch(() => {});
    return {};
  },
  'switcher:switch': (message) => switchTo(message.slotId, message.origin),
  'switcher:add': (message) => addSession(message.origin),
  'switcher:rename': async (message) => {
    await renameSlot(message.slotId, message.label);
    await broadcastState();
  },
  'switcher:remove': async (message) => {
    await removeSlot(message.slotId);
    await broadcastState();
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = handlers[message?.type];
  if (!handler || !sender.tab) return false;
  Promise.resolve(handler(message, sender))
    .then((result) => sendResponse(result ?? {}))
    .catch((error) => {
      console.error('EB Sessions:', message.type, error);
      sendResponse({ error: String(error) });
    });
  return true;
});
