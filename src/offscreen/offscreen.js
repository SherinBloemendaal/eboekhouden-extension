// Offscreen document of the AI writing help (setting aiWriter). The service
// worker (src/bg/ai.js) creates it for the first model call and closes it
// when it has been idle for a minute: the 1.1 MB AI SDK is parsed here, not
// on every wake of the service worker, which also cannot load it (no
// top-level await, no dynamic import there).
//
// It takes messages from the service worker only ({ target: 'offscreen' },
// no tab), and an offscreen document has no chrome.storage: the worker hands
// over the provider, key and model with each call. Nothing here talks to an
// e-Boekhouden page, and an answer never carries the key.

import * as sdk from '../../vendor/ai-sdk.mjs';
import { createEngine, EngineError } from './engine.js';

// The SDK logs a warning per unknown model or ignored setting; the user
// cannot act on those.
globalThis.AI_SDK_LOG_WARNINGS = false;

const IDLE_MS = 60_000;
const engine = createEngine({ sdk });
const running = new Map();
let idleTimer = null;

function fromWorker(sender) {
  return !sender.tab && sender.id === chrome.runtime.id;
}

function failure(error) {
  const known = error instanceof EngineError ? error : new EngineError('provider');
  return { error: { code: known.code, status: known.status } };
}

function scheduleIdle() {
  clearTimeout(idleTimer);
  if (running.size) return;
  idleTimer = setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'ai:idle' }).catch(() => {});
  }, IDLE_MS);
}

async function handle(message) {
  const id = typeof message.id === 'string' ? message.id : null;
  if (!id || running.has(id)) return { error: { code: 'invalid', status: null } };
  const controller = new AbortController();
  running.set(id, controller);
  clearTimeout(idleTimer);
  try {
    if (message.type === 'ai:offscreen:test') return { result: await engine.test(message.config, { signal: controller.signal }) };
    return { result: await engine.run(message.config, message.request, { signal: controller.signal }) };
  } catch (error) {
    return failure(error);
  } finally {
    running.delete(id);
    scheduleIdle();
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen' || !fromWorker(sender)) return false;
  if (message.type === 'ai:offscreen:ping') {
    sendResponse({ ready: true, running: running.size });
    return false;
  }
  if (message.type === 'ai:offscreen:abort') {
    running.get(message.id)?.abort();
    sendResponse({});
    return false;
  }
  if (message.type === 'ai:offscreen:run' || message.type === 'ai:offscreen:test') {
    handle(message).then(sendResponse);
    return true;
  }
  return false;
});

scheduleIdle();
