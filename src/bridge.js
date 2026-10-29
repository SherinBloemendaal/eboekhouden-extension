// EB Sessions: the isolated-world half of the bridge to main-world.js, as
// EBS.bridge. See main-world.js for the channel and what each hook does.
//
//   await EBS.bridge.ready()                 true once main-world.js answered
//   EBS.bridge.enable('ckeditor')            switch a hook on (all are off)
//   EBS.bridge.disable('ckeditor')
//   await EBS.bridge.call('ckeditor.getData', { name: 'editor1' })
//   EBS.bridge.intercept('windowOpen', ({ url, target, features }) => ({ claim: true }))
//   EBS.bridge.on('observed', ({ url, method, status, contentType, body }) => {})
//
// Hooks: windowOpen, formTarget, ckeditor, observe (options: { urls: [regex
// source, ...] }) and request (request.js only). intercept() takes one
// handler per hook ('windowOpen', 'formSubmit'); it runs synchronously while
// the page waits, so it must answer at once: return { claim: true } for
// window.open, { retarget: 'ebs-<frame name>' } or { cancel: true } for a
// form, and anything else to leave the page alone. Until a feature registers
// one, the answer is null and the page goes its own way. A handler is only
// asked during a user gesture (navigator.userActivation.isActive): a page
// script cannot make a feature open a dialog on its own.
//
// Everything from the page world is untrusted: it is the page's own realm,
// and a same-origin parent frame can even read and forge this channel (see
// main-world.js). Messages are checked here before a feature sees them, an
// answer from there (a result, an observed response) is page data and
// nothing more, and nothing goes over the channel that the page may not see.

(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const { EBS } = root;
  if (!EBS || EBS.bridge) return;

  const HELLO = 'ebs-bridge:hello';
  const READY = 'ebs-bridge:ready';
  const VERSION = 1;
  const MAX_MESSAGE = 8 * 1024 * 1024;
  const CALL_TIMEOUT_MS = 30_000;
  const APP_ORIGIN = /^https:\/\/secure\d*\.e-boekhouden\.nl$/;
  const CAPABILITIES = new Set(['windowOpen', 'formTarget', 'ckeditor', 'observe', 'request']);
  const HOOKS = new Set(['windowOpen', 'formSubmit']);
  const EVENTS = new Set(['observed']);
  // Public methods; request.* only through claimRequest().
  const PUBLIC_METHODS = new Set(['ckeditor.list', 'ckeditor.getData', 'ckeditor.getSelectionText', 'ckeditor.insertHtml', 'ckeditor.setData']);

  function uuid() {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  const id = uuid();
  const toMain = `ebs:${id}:main`;
  const toIsolated = `ebs:${id}:isolated`;
  let connected = false;
  let helloSent = false;
  let sequence = 0;
  const outbox = [];
  const pending = new Map();
  const interceptors = new Map();
  const listeners = new Map([...EVENTS].map((name) => [name, new Set()]));
  const enabled = new Map();
  let requestClaimed = false;
  let readyWaiters = [];

  function noPageScriptYet() {
    return document.getElementsByTagName('script').length === 0;
  }

  function post(message) {
    const text = JSON.stringify({ v: VERSION, ...message });
    if (text.length > MAX_MESSAGE) throw new Error('message too large');
    if (!connected) {
      outbox.push(text);
      return;
    }
    document.dispatchEvent(new CustomEvent(toMain, { detail: text }));
  }

  function sendHello() {
    if (helloSent || connected || !noPageScriptYet()) return;
    helloSent = true;
    document.dispatchEvent(new CustomEvent(HELLO, { detail: JSON.stringify({ v: VERSION, channel: id }) }));
  }

  // main-world.js started after us: it says so, and we answer once. Later
  // ready events (a page script) are ignored: by then a script exists.
  function onReady() {
    helloSent = false;
    sendHello();
    if (connected || !noPageScriptYet()) document.removeEventListener(READY, onReady);
  }

  function settleReady(value) {
    const waiters = readyWaiters;
    readyWaiters = [];
    for (const resolve of waiters) resolve(value);
  }

  function onWelcome() {
    if (connected) return;
    connected = true;
    document.removeEventListener(READY, onReady);
    for (const text of outbox.splice(0)) document.dispatchEvent(new CustomEvent(toMain, { detail: text }));
    settleReady(true);
  }

  // A popup or a form only reaches a feature during a user gesture. This is
  // the check that counts: the page's world can say anything, but the
  // browser's own activation state is the same in both worlds and only the
  // user sets it. Without one the browser would have blocked the popup.
  function userGesture() {
    return root.navigator?.userActivation?.isActive === true;
  }

  function answerQuery(message) {
    let value = null;
    const handler = interceptors.get(message.hook);
    const data = checkQuery(message.hook, message.data);
    if (handler && data && userGesture()) {
      try {
        const answer = handler(data);
        value = answer && typeof answer === 'object' ? answer : null;
      } catch (error) {
        // A failing feature never blocks the page: the page goes its own way.
        console.error('EB Sessions: bridge hook failed', message.hook, error);
        value = null;
      }
    }
    post({ type: 'answer', id: message.id, value });
  }

  function appUrl(value) {
    try {
      const url = new URL(String(value));
      return APP_ORIGIN.test(url.origin) ? url.href : null;
    } catch {
      return null;
    }
  }

  const string = (value, max) => (typeof value === 'string' && value.length <= max ? value : null);

  function checkQuery(hook, data) {
    if (!data || typeof data !== 'object') return null;
    if (hook === 'windowOpen') {
      const url = appUrl(data.url);
      const target = string(data.target, 200);
      const features = string(data.features, 500);
      return url && target !== null && features !== null ? { url, target, features } : null;
    }
    if (hook === 'formSubmit') {
      const action = appUrl(data.action);
      const fields = ['method', 'target', 'name', 'id'].map((key) => string(data[key], 200));
      if (!action || fields.includes(null)) return null;
      const [method, target, name, formId] = fields;
      return { action, method, target, name, id: formId };
    }
    return null;
  }

  function checkObserved(data) {
    if (!data || typeof data !== 'object') return null;
    let url;
    try {
      url = new URL(String(data.url));
    } catch {
      return null;
    }
    if (url.origin !== location.origin) return null;
    if (!Number.isInteger(data.status) || typeof data.method !== 'string' || typeof data.contentType !== 'string') return null;
    if (data.body !== null && typeof data.body !== 'string') return null;
    return {
      url: url.href,
      method: data.method.slice(0, 10),
      status: data.status,
      contentType: data.contentType.slice(0, 200),
      body: data.body,
      skipped: typeof data.skipped === 'string' ? data.skipped : null,
    };
  }

  function onMessage(event) {
    const text = event.detail;
    if (typeof text !== 'string' || text.length > MAX_MESSAGE) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!message || message.v !== VERSION) return;
    if (message.type === 'welcome') {
      onWelcome();
      return;
    }
    if (!connected) return;
    if (message.type === 'query' && Number.isSafeInteger(message.id) && HOOKS.has(message.hook)) {
      answerQuery(message);
      return;
    }
    if (message.type === 'result' && pending.has(message.id)) {
      const call = pending.get(message.id);
      pending.delete(message.id);
      call.finish();
      if (message.ok) call.resolve(message.value);
      else call.reject(new Error(typeof message.error === 'string' ? message.error : 'bridge call failed'));
      return;
    }
    if (message.type === 'event' && EVENTS.has(message.name)) {
      const data = message.name === 'observed' ? checkObserved(message.data) : null;
      if (!data) return;
      for (const listener of [...listeners.get(message.name)]) {
        try {
          listener(data);
        } catch (error) {
          console.error('EB Sessions: bridge listener failed', message.name, error);
        }
      }
    }
  }

  // Once a page script exists, a main world that has not answered yet never
  // will (Chrome injects both halves before the page's first script).
  function unreachable() {
    return !connected && !noPageScriptYet();
  }

  function send(method, args = {}, { signal, timeout = CALL_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      if (unreachable()) {
        reject(new Error('bridge not connected'));
        return;
      }
      sequence += 1;
      const callId = sequence;
      const timer = setTimeout(() => {
        pending.delete(callId);
        finish();
        reject(new Error(connected ? 'bridge call timed out' : 'bridge not connected'));
      }, timeout);
      const onAbort = () => {
        pending.delete(callId);
        finish();
        reject(new DOMException('Aborted', 'AbortError'));
      };
      function finish() {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      pending.set(callId, { resolve, reject, finish, method });
      try {
        post({ type: 'call', id: callId, method, args });
      } catch (error) {
        pending.delete(callId);
        finish();
        reject(error);
      }
    });
  }

  function setCapability(capability, on, options = {}) {
    if (on) enabled.set(capability, options);
    else enabled.delete(capability);
    post(on ? { type: 'enable', capability, options } : { type: 'disable', capability });
  }

  function publicCapability(capability) {
    if (!CAPABILITIES.has(capability)) throw new Error(`EBS.bridge: unknown capability "${capability}"`);
    if (capability === 'request') throw new Error('EBS.bridge: the request hook belongs to request.js');
  }

  document.addEventListener(toIsolated, onMessage);
  document.addEventListener(READY, onReady);
  sendHello();

  const bridge = {
    get connected() {
      return connected;
    },
    // Resolves true once main-world.js answered, false after `timeout` ms.
    ready(timeout = 2000) {
      if (connected) return Promise.resolve(true);
      if (unreachable()) return Promise.resolve(false);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          readyWaiters = readyWaiters.filter((waiter) => waiter !== done);
          resolve(false);
        }, timeout);
        function done(value) {
          clearTimeout(timer);
          resolve(value);
        }
        readyWaiters.push(done);
      });
    },
    enable(capability, options = {}) {
      publicCapability(capability);
      setCapability(capability, true, options);
    },
    disable(capability) {
      publicCapability(capability);
      setCapability(capability, false);
    },
    isEnabled(capability) {
      return enabled.has(capability);
    },
    call(method, args = {}, options = {}) {
      if (!PUBLIC_METHODS.has(method)) return Promise.reject(new Error(`EBS.bridge: unknown method "${method}"`));
      return send(method, args, options);
    },
    intercept(hook, handler) {
      if (!HOOKS.has(hook)) throw new Error(`EBS.bridge: unknown hook "${hook}"`);
      if (typeof handler !== 'function') throw new TypeError('EBS.bridge.intercept needs a function');
      if (interceptors.has(hook)) throw new Error(`EBS.bridge: "${hook}" already has a handler`);
      interceptors.set(hook, handler);
      return () => {
        if (interceptors.get(hook) === handler) interceptors.delete(hook);
      };
    },
    on(name, listener) {
      if (!EVENTS.has(name)) throw new Error(`EBS.bridge: unknown event "${name}"`);
      listeners.get(name).add(listener);
      return () => listeners.get(name).delete(listener);
    },
    // The page-world GET, for request.js alone: the first caller gets it,
    // so no feature can go around the request rules.
    claimRequest() {
      if (requestClaimed) throw new Error('EBS.bridge: the request hook is already claimed');
      requestClaimed = true;
      return Object.freeze({
        enable: () => setCapability('request', true),
        get: (args, options) => send('request.get', args, options),
        abort: (requestId) => send('request.abort', { id: requestId }).catch(() => false),
      });
    },
  };

  EBS.define('bridge', Object.freeze(bridge));
})();
