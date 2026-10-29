// Service worker part of the AI writing help (setting aiWriter).
//
// Pages never see the key. The flow of one click in an editor:
//   page  --ai:run { id, request }-->  here: switch on? request valid? key,
//         model and host permission there? Then the offscreen document,
//         created on demand, makes the call with the key from storage.
//   page  <--{ result } or { error: { code, status } }--
// ai:abort stops a running call (Stoppen), ai:settings opens the settings
// page. The offscreen document reports ai:idle after a quiet minute and is
// closed then, so the 1.1 MB SDK does not stay in memory.
//
// Storage (chrome.storage.local):
//   aiKeys    { [provider]: key }   read here and on the settings page only
//   aiConfig  { provider, models: { [provider]: id }, status: { [provider]:
//             { ok, code, status, at } }, modelLists: { [provider]: [id] } }
//   aiView    { state, provider, providerLabel, model }, mirrored for pages:
//             state is ready, nokey, nomodel, permission or rejected
// The settings page writes aiKeys and aiConfig; this module keeps aiView in
// step with them and with the host permissions the user granted or revoked.

import '../shared.js';
import { PROVIDERS, RequestError, checkRequest } from '../offscreen/protocol.js';

const OFFSCREEN_PATH = 'src/offscreen/offscreen.html';
const OFFSCREEN_JUSTIFICATION = 'Runs the AI writing help: the bundled AI SDK calls the provider the user chose, and the model\'s HTML answer is cleaned with DOMParser before it reaches a page.';
const READY_TRIES = 20;
const READY_PAUSE_MS = 50;
const { settingsWithDefaults } = globalThis.EBS;

// tab:frame -> { id, offscreenId }: one call at a time per frame.
const running = new Map();
let sequence = 0;
let creating = null;

const fail = (code, status = null) => ({ error: { code, status } });

async function readState() {
  const { aiKeys = {}, aiConfig = {}, settings } = await chrome.storage.local.get(['aiKeys', 'aiConfig', 'settings']);
  const provider = Object.hasOwn(PROVIDERS, aiConfig.provider) ? aiConfig.provider : 'openrouter';
  return {
    provider,
    key: typeof aiKeys[provider] === 'string' ? aiKeys[provider] : '',
    model: typeof aiConfig.models?.[provider] === 'string' ? aiConfig.models[provider].trim() : '',
    status: aiConfig.status?.[provider] ?? null,
    on: settingsWithDefaults(settings).aiWriter,
  };
}

async function hasPermission(provider) {
  try {
    return Boolean(await chrome.permissions?.contains({ origins: [PROVIDERS[provider].origin] }));
  } catch {
    return false;
  }
}

function stateOf({ key, model, status }, permitted) {
  if (!key) return 'nokey';
  if (!permitted) return 'permission';
  if (status && status.ok === false && status.code === 'auth') return 'rejected';
  if (!model) return 'nomodel';
  return 'ready';
}

// What the pages draw from: never the key.
async function publishView() {
  const current = await readState();
  const view = {
    state: stateOf(current, await hasPermission(current.provider)),
    provider: current.provider,
    providerLabel: PROVIDERS[current.provider].label,
    model: current.model,
  };
  const { aiView } = await chrome.storage.local.get('aiView');
  if (JSON.stringify(aiView) !== JSON.stringify(view)) await chrome.storage.local.set({ aiView: view });
  return view;
}

// ---------------------------------------------------------------------------
// The offscreen document
// ---------------------------------------------------------------------------

async function offscreenOpen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

function toOffscreen(message) {
  return chrome.runtime.sendMessage({ target: 'offscreen', ...message });
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function ensureOffscreen() {
  if (!chrome.offscreen?.createDocument || !chrome.runtime.getContexts) throw new Error('offscreen unavailable');
  if (!(await offscreenOpen())) {
    creating ??= chrome.offscreen.createDocument({ url: OFFSCREEN_PATH, reasons: ['DOM_PARSER'], justification: OFFSCREEN_JUSTIFICATION })
      .finally(() => { creating = null; });
    await creating;
  }
  // The document's module (and the SDK in it) may still be loading.
  for (let attempt = 0; attempt < READY_TRIES; attempt += 1) {
    try {
      if ((await toOffscreen({ type: 'ai:offscreen:ping' }))?.ready) return;
    } catch {
      // No listener yet.
    }
    await pause(READY_PAUSE_MS);
  }
  throw new Error('offscreen did not start');
}

async function closeWhenIdle() {
  if (running.size || creating || !chrome.offscreen?.closeDocument) return {};
  try {
    if (await offscreenOpen()) await chrome.offscreen.closeDocument();
  } catch {
    // Already closed.
  }
  return {};
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

function frameKey(sender) {
  return `${sender.tab?.id ?? 'none'}:${sender.frameId ?? 0}`;
}

async function run(message, sender) {
  const pageId = typeof message.id === 'string' && message.id.length <= 64 ? message.id : null;
  if (!pageId) return fail('invalid');
  let request;
  try {
    request = checkRequest(message.request);
  } catch (error) {
    if (error instanceof RequestError) return fail('invalid');
    throw error;
  }
  const slot = frameKey(sender);
  if (running.has(slot)) return fail('busy');

  sequence += 1;
  const call = { id: pageId, offscreenId: `call-${Date.now().toString(36)}-${sequence}`, aborted: false };
  running.set(slot, call);
  try {
    const current = await readState();
    if (!current.on) return fail('off');
    if (!current.key) return fail('nokey');
    if (!(await hasPermission(current.provider))) return fail('permission');
    if (!current.model) return fail('model');
    try {
      await ensureOffscreen();
    } catch {
      return fail('unavailable');
    }
    if (call.aborted) return fail('aborted');
    let answer;
    try {
      answer = await toOffscreen({
        type: 'ai:offscreen:run',
        id: call.offscreenId,
        config: { provider: current.provider, key: current.key, model: current.model },
        request,
      });
    } catch {
      return fail('unavailable');
    }
    if (call.aborted) return fail('aborted');
    if (answer?.error) return fail(String(answer.error.code ?? 'provider'), Number.isInteger(answer.error.status) ? answer.error.status : null);
    if (!answer?.result || typeof answer.result !== 'object') return fail('unavailable');
    return { result: answer.result };
  } finally {
    running.delete(slot);
  }
}

async function abort(message, sender) {
  const call = running.get(frameKey(sender));
  if (!call || call.id !== message.id) return { aborted: false };
  call.aborted = true;
  try {
    await toOffscreen({ type: 'ai:offscreen:abort', id: call.offscreenId });
  } catch {
    // The document is gone: nothing runs there.
  }
  return { aborted: true };
}

export function register(router) {
  router.on('ai:run', run, { serialized: false });
  router.on('ai:abort', abort, { serialized: false });
  router.on('ai:settings', async () => {
    await chrome.runtime.openOptionsPage();
    return {};
  }, { serialized: false });
  router.on('ai:idle', () => closeWhenIdle(), { serialized: false, fromTab: false, fromExtension: true });

  // The mirror follows the settings page, and the permissions the user can
  // also take back in chrome://extensions.
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && (changes.aiKeys || changes.aiConfig)) publishView().catch(() => {});
  });
  chrome.permissions?.onAdded?.addListener(() => publishView().catch(() => {}));
  chrome.permissions?.onRemoved?.addListener(() => publishView().catch(() => {}));
  publishView().catch(() => {});
}

// For the tests.
export { publishView, stateOf };
