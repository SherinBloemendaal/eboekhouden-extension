// Service worker: owns the saved sessions, the cookie swap and the per-tab
// re-login state. Cookie values never leave this context. Pages only see what
// it mirrors into chrome.storage.local: names, numbers, statuses and pictures.

const COOKIE_DOMAIN = 'e-boekhouden.nl';
const EB_TAB_PATTERN = 'https://*.e-boekhouden.nl/*';
const LOGIN_TITLE = /^inloggen\b/i;
const AVATAR_PATTERN = /^data:image\/(webp|jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const AVATAR_MAX_LENGTH = 96 * 1024;

// chrome.storage.session lives in memory only and is wiped when Chrome quits.
// Restrict it to extension pages so content scripts can never read it.
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });

// ---------------------------------------------------------------------------
// Storage
//
// local:   slots          [{ id, name, number, expired }]   (no secrets)
//          avatar:<id>    data URL, 128 px                  (no secrets)
//          view           { activeSlotId, loggedIn, ready: [id] }, mirrored for pages
// session: cookies:<id>   [chrome.cookies.Cookie]           (the session itself)
//          activeSlotId, loggedIn, pendingCheck
//          tab:<tabId>    { mainFrameId, returnUrl, relogin, innerUrl, innerFor, restoreInner }
// ---------------------------------------------------------------------------

async function getSlots() {
  const { slots = [] } = await chrome.storage.local.get('slots');
  // Entries saved by 0.1.0 kept the administration name in `title`.
  for (const slot of slots) {
    if (!slot.name && slot.title) slot.name = slot.title;
  }
  return slots;
}

async function setSlots(slots) {
  await chrome.storage.local.set({ slots });
}

async function updateSlot(slotId, changes) {
  const slots = await getSlots();
  const slot = slots.find((candidate) => candidate.id === slotId);
  if (!slot) return;
  Object.assign(slot, changes);
  await setSlots(slots);
}

async function getSessionState() {
  const { activeSlotId = null, loggedIn = false, pendingCheck = null } = await chrome.storage.session.get(['activeSlotId', 'loggedIn', 'pendingCheck']);
  return { activeSlotId, loggedIn, pendingCheck };
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
  const updates = {};
  for (const key of Object.keys(all).filter((name) => name.startsWith('tab:'))) {
    // Keep the frame registry, drop everything that would trigger a re-login return.
    updates[key] = { mainFrameId: all[key].mainFrameId };
  }
  await chrome.storage.session.set(updates);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`tab:${tabId}`);
});

// The mirror pages render from. Rebuilt after every change and on startup,
// when the in-memory sessions are gone.
async function publishView() {
  const [slots, { activeSlotId, loggedIn }] = await Promise.all([getSlots(), getSessionState()]);
  const stored = await chrome.storage.session.get(slots.map((slot) => `cookies:${slot.id}`));
  const ready = slots.filter((slot) => stored[`cookies:${slot.id}`]?.length).map((slot) => slot.id);
  await chrome.storage.local.set({ view: { activeSlotId, loggedIn, ready } });
}

chrome.runtime.onStartup.addListener(() => { publishView(); });
chrome.runtime.onInstalled.addListener(() => { publishView(); });

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
// Login, logout and expiry
//
// The top-level /bh/ frameset carries the administration name as its title
// once logged in, and "Inloggen | e-Boekhouden.nl" on the login screen. That
// name is the identity slots are matched on.
// ---------------------------------------------------------------------------

async function markExpired(slotId) {
  await updateSlot(slotId, { expired: true });
  await chrome.storage.session.remove(`cookies:${slotId}`);
  await chrome.storage.session.set({ loggedIn: false, pendingCheck: null });
}

async function onTopTitle(title) {
  const name = (title || '').trim();
  if (!name) return;
  const { pendingCheck } = await getSessionState();

  if (LOGIN_TITLE.test(name)) {
    // Plain /bh/ shows this title even while the session is valid, so on its
    // own it proves nothing. Only right after a switch does it mean the
    // restored session had expired.
    if (pendingCheck) {
      await markExpired(pendingCheck);
      await publishView();
    }
    return;
  }

  const slots = await getSlots();
  let slot = slots.find((candidate) => candidate.name === name);
  if (!slot) {
    slot = { id: crypto.randomUUID(), name, number: null, expired: false };
    slots.push(slot);
  }
  slot.expired = false;
  await setSlots(slots);
  await chrome.storage.session.set({ activeSlotId: slot.id, loggedIn: true, pendingCheck: null });
  await snapshotActiveSlot();
  await publishView();
}

// The header shows the administration number; keep it for the dropdown.
async function onHeaderIdentity({ name, number }) {
  const { activeSlotId, loggedIn } = await getSessionState();
  if (!activeSlotId || !loggedIn || !/^\d{1,12}$/.test(String(number ?? ''))) return;
  const slots = await getSlots();
  const slot = slots.find((candidate) => candidate.id === activeSlotId);
  if (!slot || (name && slot.name !== name.trim()) || slot.number === String(number)) return;
  slot.number = String(number);
  await setSlots(slots);
}

async function onLogout(tabId, frameId) {
  const { activeSlotId } = await getSessionState();
  await setTab(tabId, { mainFrameId: frameId });
  // The stored cookies belong to a session the server just ended.
  if (activeSlotId) await chrome.storage.session.remove(`cookies:${activeSlotId}`);
  await chrome.storage.session.set({ loggedIn: false, pendingCheck: null });
  await publishView();
}

// The bare login form, or a "session expired" page, while the active session
// was logged in means the server dropped it. The secure20 /v1login shell is
// not proof on its own: it wraps the "U bent reeds ingelogd" page too.
async function onLoginPage() {
  const { activeSlotId, loggedIn } = await getSessionState();
  if (!activeSlotId || !loggedIn) return;
  await markExpired(activeSlotId);
  await publishView();
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

// With other e-Boekhouden tabs open, a switch reloads them too: ask first.
async function needsConfirm(confirmed) {
  if (confirmed) return null;
  const tabs = await ebTabs();
  return tabs.length > 1 ? { needsConfirm: true, tabCount: tabs.length } : null;
}

async function switchTo(slotId, originHint, confirmed) {
  const ask = await needsConfirm(confirmed);
  if (ask) return ask;

  await snapshotActiveSlot();
  const { [`cookies:${slotId}`]: cookies } = await chrome.storage.session.get(`cookies:${slotId}`);

  await removeAllCookies();
  if (cookies?.length) await restoreCookies(cookies);

  // loggedIn is confirmed again by the title of the reloaded page; until then
  // a login screen means the restored session had expired.
  await chrome.storage.session.set({ activeSlotId: slotId, loggedIn: false, pendingCheck: cookies?.length ? slotId : null });
  await clearAllTabStates();
  await publishView();
  await reloadEbTabs(originHint, Boolean(cookies?.length));
  return {};
}

async function addSession(originHint, confirmed) {
  const ask = await needsConfirm(confirmed);
  if (ask) return ask;

  await snapshotActiveSlot();
  await removeAllCookies();
  await chrome.storage.session.set({ activeSlotId: null, loggedIn: false, pendingCheck: null });
  await clearAllTabStates();
  await publishView();
  await reloadEbTabs(originHint, false);
  return {};
}

async function removeSlot(slotId) {
  await setSlots((await getSlots()).filter((slot) => slot.id !== slotId));
  await chrome.storage.session.remove(`cookies:${slotId}`);
  await chrome.storage.local.remove(`avatar:${slotId}`);
  const { activeSlotId } = await getSessionState();
  if (activeSlotId === slotId) await chrome.storage.session.set({ activeSlotId: null });
  await publishView();
}

async function setAvatar(slotId, dataUrl) {
  const slots = await getSlots();
  if (!slots.some((slot) => slot.id === slotId)) return { error: 'unknown slot' };
  if (typeof dataUrl !== 'string' || dataUrl.length > AVATAR_MAX_LENGTH || !AVATAR_PATTERN.test(dataUrl)) {
    return { error: 'invalid image' };
  }
  await chrome.storage.local.set({ [`avatar:${slotId}`]: dataUrl });
  return {};
}

// ---------------------------------------------------------------------------
// Re-login: per tab we remember the last page shown in mainframe. When the
// mainframe lands on a login or session-expired page while a page was known,
// the login form switches to dialog mode, and the first app page after login
// is sent back to that page.
// ---------------------------------------------------------------------------

async function onMainPage(tabId, frameId, { url, kind }, topUrl) {
  const tab = await getTab(tabId);
  tab.mainFrameId = frameId;

  if (kind === 'logout') {
    await onLogout(tabId, frameId);
    return {};
  }

  // Login breakout (login-breakout.js). In breakout mode the first app page
  // in the login iframe is the answer to a login: open the real app instead
  // of showing it inside the bare iframe. Outside breakout mode a secure20
  // login screen in mainframe (after logout or an expired session) asks the
  // top frame to swap the frameset for the breakout layout.
  if (tab.loginHost && kind === 'app' && !PUBLIC_V2.test(url)) {
    return openAppAfterLogin(tabId, tab, topUrl);
  }
  if (!tab.loginHost && kind === 'login' && SECURE20_LOGIN.test(url)) {
    chrome.tabs.sendMessage(tabId, { type: 'login:swap' }, { frameId: 0 }).catch(() => {});
  }

  if (kind === 'already') return {};

  if (kind === 'login' || kind === 'expired') {
    if (tab.returnUrl) tab.relogin = true;
    await setTab(tabId, tab);
    const shell = new URL(url).hostname === 'secure20.e-boekhouden.nl' && kind === 'login';
    if (!shell) await onLoginPage();
    return { relogin: Boolean(tab.relogin) };
  }

  // kind === 'app'
  const response = {};
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
  await setTab(tabId, tab);
  await snapshotActiveSlot();
  return response;
}

async function onInnerPage(tabId, { url, kind }) {
  const tab = await getTab(tabId);

  if (kind === 'logout') {
    // Logging out from the new design loads uitloggen.asp inside the shell.
    await onLogout(tabId, tab.mainFrameId);
    return {};
  }

  if (kind === 'already') return {};

  if (kind === 'login' || kind === 'expired') {
    // The login form of secure20/v1login lives in this inner frame.
    if (tab.returnUrl) tab.relogin = true;
    await setTab(tabId, tab);
    await onLoginPage();
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
  await setTab(tabId, { mainFrameId: tab.mainFrameId });
}

// ---------------------------------------------------------------------------
// Login breakout
//
// login-breakout.js swaps the login <frameset> for <body><iframe> so that
// 1Password's inline menu works. The top frame reports whether a tab is in
// that layout (login:host). Once the login iframe leaves the login form, the
// tab enters the app the way e-Boekhouden itself does: /bh?v2Url=<secure20
// page>. The re-login return (tab.returnUrl / tab.relogin) is left untouched,
// so the first app page in the restored frameset still goes back to the page
// the user was on, including classic pages, through onMainPage.
// ---------------------------------------------------------------------------

const SECURE20_LOGIN = /^https:\/\/secure20\.e-boekhouden\.nl\/v1login(?:[?#]|$)/i;
// secure20 pages reachable from the login form without a session.
const PUBLIC_V2 = /^https:\/\/secure20\.e-boekhouden\.nl\/(?:v1login|overig\/vergeten|sessie-verlopen)(?:[?#/]|$)/i;
const SECURE20_ORIGIN = 'https://secure20.e-boekhouden.nl';
const LOGIN_DONE_WINDOW_MS = 30_000;
const LOGIN_DONE_MAX = 2;

function topOriginOf(topUrl) {
  try {
    const origin = new URL(topUrl).origin;
    if (/^https:\/\/secure\d*\.e-boekhouden\.nl$/.test(origin) && !origin.includes('secure20')) return origin;
  } catch { /* fall through */ }
  return 'https://secure.e-boekhouden.nl';
}

async function setLoginHost(tabId, active) {
  const tab = await getTab(tabId);
  tab.loginHost = Boolean(active);
  if (!tab.loginHost) tab.loginDone = [];
  await setTab(tabId, tab);
  return {};
}

// Open the app after a login in breakout mode. A classic (secure.*) return
// page cannot be a v2Url, so those enter through the app start page; the
// re-login state then sends mainframe on to the classic page.
async function openAppAfterLogin(tabId, tab, topUrl) {
  if (!tab.loginHost) return {};
  const now = Date.now();
  tab.loginDone = (tab.loginDone ?? []).filter((time) => now - time < LOGIN_DONE_WINDOW_MS);
  tab.loginHost = false;
  if (tab.loginDone.length >= LOGIN_DONE_MAX) {
    // Bouncing between the login iframe and the app entry: stop and leave
    // the tab to e-Boekhouden's own flow.
    await setTab(tabId, tab);
    return {};
  }
  tab.loginDone.push(now);
  await setTab(tabId, tab);

  const wanted = tab.relogin && tab.returnUrl ? tab.returnUrl : APP_START;
  const v2 = wanted.startsWith(`${SECURE20_ORIGIN}/`) ? wanted : APP_START;
  await chrome.tabs.update(tabId, { url: `${topOriginOf(topUrl)}/bh?v2Url=${encodeURIComponent(v2)}` });
  return { navigating: true };
}

async function onLoginDone(tabId, topUrl) {
  return openAppAfterLogin(tabId, await getTab(tabId), topUrl);
}

// ---------------------------------------------------------------------------
// Messages from content scripts
// ---------------------------------------------------------------------------

const handlers = {
  'top:title': (message) => onTopTitle(message.title),
  'header:identity': (message) => onHeaderIdentity(message),
  'main:page': (message, sender) => onMainPage(sender.tab.id, sender.frameId, message, sender.tab.url),
  'login:host': (message, sender) => (sender.frameId === 0 ? setLoginHost(sender.tab.id, message.active) : {}),
  'login:done': (message, sender) => onLoginDone(sender.tab.id, sender.tab.url),
  'inner:page': (message, sender) => onInnerPage(sender.tab.id, message),
  'relogin:cancel': (message, sender) => cancelRelogin(sender.tab.id),
  'switcher:switch': (message) => switchTo(message.slotId, message.origin, message.confirmed),
  'switcher:add': (message) => addSession(message.origin, message.confirmed),
  'switcher:remove': (message) => removeSlot(message.slotId),
  'avatar:set': (message) => setAvatar(message.slotId, message.dataUrl),
  'avatar:remove': (message) => chrome.storage.local.remove(`avatar:${message.slotId}`),
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
