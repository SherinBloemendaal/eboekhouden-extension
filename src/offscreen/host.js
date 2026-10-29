// The message side of the offscreen document (src/offscreen/offscreen.js is
// its entry): calls from the service worker in, answers out, Stoppen, and
// the idle report after a quiet minute. Apart from the entry so the tests
// can run it with a fake chrome and a fake engine.
//
// It takes messages from the service worker only ({ target: 'offscreen' },
// no tab). The worker sends the provider and the model, never the key: the
// key is read here, from the extension's IndexedDB (keys.js), right before
// the call. Nothing here talks to an e-Boekhouden page, and an answer never
// carries the key.

import { EngineError } from './engine.js';

const IDLE_MS = 60_000;

export function listen({ chrome, engine, keys, idleMs = IDLE_MS }) {
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
      chrome.runtime.sendMessage({ type: 'ai:idle' })?.catch?.(() => {});
    }, idleMs);
  }

  async function run(message) {
    const id = typeof message.id === 'string' ? message.id : null;
    if (!id || running.has(id)) return { error: { code: 'invalid', status: null } };
    const controller = new AbortController();
    running.set(id, controller);
    clearTimeout(idleTimer);
    try {
      const config = message.config ?? {};
      let key;
      try {
        key = await keys.get(config.provider);
      } catch {
        return { error: { code: 'unavailable', status: null } };
      }
      if (!key) return { error: { code: 'nokey', status: null } };
      // Stoppen while the key was read.
      if (controller.signal.aborted) return { error: { code: 'aborted', status: null } };
      return { result: await engine.run({ provider: config.provider, model: config.model, key }, message.request, { signal: controller.signal }) };
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
    if (message.type === 'ai:offscreen:run') {
      run(message).then(sendResponse);
      return true;
    }
    return false;
  });

  scheduleIdle();
  return { stop: () => clearTimeout(idleTimer), running };
}
