// EB Sessions: the page-world half of the bridge (manifest: "world": "MAIN").
//
// The content scripts run in Chrome's isolated world: they share the DOM with
// e-Boekhouden but not its JavaScript. A few features need the page's own
// objects: its window.open and form submits (and window.opener and close()
// in a popup shown as a dialog), its CKEditor 4 instances, the
// responses of its own fetch and XMLHttpRequest calls, and its fetch for a
// request that must carry the page's own auth. This file runs in the page's
// world for exactly those hooks and nothing else.
//
// Every hook is off until the isolated side (bridge.js) enables it, and is
// only installed then: until a feature asks, window.open, fetch,
// XMLHttpRequest and form submits are the page's own, untouched.
//
// Channel. Both halves run at document_start, before any page script. The
// isolated side picks a random channel id and announces it once with a
// CustomEvent on document; from then on each side talks on its own event
// name under that id. Only JSON text travels, never objects, credentials or
// keys. A handshake is only accepted while the document has no <script>
// yet, so a script of this document cannot open or join a channel later.
//
// This world is the page's own, so nothing here is secret from the page. A
// same-origin parent can even reach a frame's window before this script
// runs (Chrome keeps the window of a frame's first about:blank) and replace
// the built-ins captured below, and so learn the channel. That is why the
// isolated side treats every message from here as untrusted data, gives a
// popup or a form to a feature only during a real user gesture, and never
// sends anything over this channel that the page may not see.

(() => {
  'use strict';

  const HELLO = 'ebs-bridge:hello';
  const READY = 'ebs-bridge:ready';
  const VERSION = 1;
  const MAX_MESSAGE = 8 * 1024 * 1024;
  const MAX_OBSERVED_BODY = 4 * 1024 * 1024;
  const APP_ORIGIN = /^https:\/\/secure\d*\.e-boekhouden\.nl$/;
  const FRAME_NAME = /^ebs-[a-z0-9-]{1,48}$/;
  // The frame of a popup dialog (see windowOpen and popupFrame).
  const POPUP_FRAME = /^ebs-popup-[a-z0-9]{1,24}$/;

  // The page's scripts run after this one and could replace these later:
  // keep the originals.
  const { apply } = Reflect;
  const doc = document;
  const addListener = EventTarget.prototype.addEventListener;
  const removeListener = EventTarget.prototype.removeEventListener;
  const dispatch = EventTarget.prototype.dispatchEvent;
  const PageCustomEvent = CustomEvent;
  const detailOf = Object.getOwnPropertyDescriptor(CustomEvent.prototype, 'detail').get;
  const scriptsOf = Object.getOwnPropertyDescriptor(Document.prototype, 'scripts')?.get;
  const byTag = Document.prototype.getElementsByTagName;
  const parse = JSON.parse;
  const stringify = JSON.stringify;
  const PageURL = URL;
  const hasOwn = Object.prototype.hasOwnProperty;
  const create = Object.create;
  const isArray = Array.isArray;
  const ElementProto = Element.prototype;
  const getAttribute = ElementProto.getAttribute;
  const setAttribute = ElementProto.setAttribute;
  const removeAttribute = ElementProto.removeAttribute;
  const hasAttribute = ElementProto.hasAttribute;
  const FormProto = HTMLFormElement.prototype;
  const FormElement = HTMLFormElement;
  // A form's own properties lose to its fields: <input name="action"> is
  // form.action. Read the real ones from the prototype.
  const formGetter = (name) => Object.getOwnPropertyDescriptor(FormProto, name)?.get;
  const formAction = formGetter('action');
  const formMethod = formGetter('method');
  const elementId = Object.getOwnPropertyDescriptor(ElementProto, 'id')?.get;
  const byName = Document.prototype.getElementsByName;
  const IFrameElement = HTMLIFrameElement;
  const frameWindowOf = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'contentWindow')?.get;
  const activationOf = typeof navigator !== 'undefined' && navigator.userActivation
    ? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator.userActivation), 'isActive')?.get
    : null;
  const userActivation = activationOf ? navigator.userActivation : null;

  // Objects without Object.prototype: a getter the page puts there (say on
  // "bubbles", read while a CustomEvent is made) never sees our messages.
  function bare(source) {
    const object = create(null);
    for (const key in source) {
      if (apply(hasOwn, source, [key])) object[key] = source[key];
    }
    return object;
  }

  // JSON from the isolated side, every object without a prototype.
  function parseBare(textValue) {
    return parse(textValue, (key, value) => (value !== null && typeof value === 'object' && !isArray(value) ? bare(value) : value));
  }

  function own(object, key) {
    return object !== null && typeof object === 'object' && apply(hasOwn, object, [key]) ? object[key] : undefined;
  }

  // The browser's own popup blocker asks the same: is a click or key of the
  // user still fresh? Without one the page's call goes its own way.
  function userGesture() {
    try {
      return Boolean(userActivation && apply(activationOf, userActivation, []));
    } catch {
      return false;
    }
  }

  let channel = null;
  let sequence = 0;
  const answers = new Map();

  function noPageScriptYet() {
    return (scriptsOf ? apply(scriptsOf, doc, []) : apply(byTag, doc, ['script'])).length === 0;
  }

  function emit(message) {
    if (!channel) return false;
    let text;
    try {
      text = stringify(message);
    } catch {
      return false;
    }
    if (text.length > MAX_MESSAGE) return false;
    const init = create(null);
    init.detail = text;
    apply(dispatch, doc, [new PageCustomEvent(channel.toIsolated, init)]);
    return true;
  }

  // A question the isolated side answers before dispatchEvent returns:
  // listeners of a DOM event run synchronously, in both worlds. Used where
  // the page needs an answer right away (window.open returns a window).
  function ask(hook, data) {
    sequence += 1;
    const id = sequence;
    answers.set(id, null);
    emit({ v: VERSION, type: 'query', id, hook, data });
    const answer = answers.get(id);
    answers.delete(id);
    return answer && typeof answer === 'object' ? answer : null;
  }

  function notify(name, data) {
    emit({ v: VERSION, type: 'event', name, data });
  }

  function text(value, max = 2048) {
    return typeof value === 'string' ? value.slice(0, max) : '';
  }

  // An absolute URL of an e-Boekhouden app page, or null.
  function appUrl(value) {
    try {
      const url = new PageURL(String(value), location.href);
      return APP_ORIGIN.test(url.origin) ? url.href : null;
    } catch {
      return null;
    }
  }

  function sameOriginUrl(value) {
    try {
      const url = new PageURL(String(value), location.href);
      return url.origin === location.origin ? url.href : null;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // window.open: a feature may claim a popup to an e-Boekhouden page (and show
  // it in a dialog). Unclaimed, the page's own window.open runs as always.
  // An empty popup (no URL, '' or about:blank: one to write into, or one that
  // gets its address later) is offered as about:blank. A claimed call returns
  // the window of the feature's frame when the answer names one ({ claim,
  // frame: 'ebs-popup-...' }, an iframe in this document), as a popup would
  // return its window, and null otherwise, as a blocked popup does. Only a
  // call during a user gesture is offered: one without could not have opened
  // a popup either, so a script cannot make a dialog appear on its own.
  // -------------------------------------------------------------------------

  // The window of the popup frame named in an answer. An empty frame runs no
  // script of its own (no content script in about:blank), so its opener and
  // close() are set from here; a frame with a page does that itself
  // (popupFrame below).
  function popupWindow(name, blank) {
    if (typeof name !== 'string' || !POPUP_FRAME.test(name)) return null;
    const nodes = apply(byName, doc, [name]);
    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      if (!(node instanceof IFrameElement)) continue;
      const win = frameWindowOf ? apply(frameWindowOf, node, []) : null;
      if (!win) return null;
      if (blank) {
        try {
          win.opener = window;
          win.close = function close() {
            notify('popupClose', { frame: name });
          };
        } catch { /* a frame with a page of another origin: it does this itself */ }
      }
      return win;
    }
    return null;
  }

  const windowOpen = {
    on: false,
    original: null,
    wrapper: null,
    enable() {
      this.on = true;
      if (this.wrapper) return;
      const hook = this;
      const original = window.open;
      this.original = original;
      this.wrapper = function open(url, target, features) {
        let claimed = false;
        let popup = null;
        try {
          if (hook.on && userGesture()) {
            // Read the page's value once: an object's toString() could say
            // something else the next time.
            const href = url === undefined ? '' : String(url);
            const blank = href === '' || href === 'about:blank';
            const absolute = blank ? 'about:blank' : appUrl(href);
            if (absolute) {
              const answer = ask('windowOpen', { url: absolute, target: text(target, 200), features: text(features, 500) });
              claimed = own(answer, 'claim') === true;
              if (claimed) popup = popupWindow(own(answer, 'frame'), blank);
            }
          }
        } catch { /* never in the page's way */ }
        if (popup) return popup;
        return claimed ? null : apply(original, this, arguments);
      };
      window.open = this.wrapper;
    },
    disable() {
      this.on = false;
      // Put the original back unless the page wrapped ours meanwhile; then
      // ours stays as a plain pass-through.
      if (this.wrapper && window.open === this.wrapper) {
        window.open = this.original;
        this.wrapper = null;
      }
    },
  };

  // -------------------------------------------------------------------------
  // Form submits into another window (target="_blank" or a named popup). A
  // feature may send the submit into a frame of its own (retarget, a name
  // starting with "ebs-") or cancel it, during a user gesture only. Field
  // values never cross: only the action, method and target. The form's own
  // fields can shadow its properties (<input name="getAttribute">), so every
  // read goes through the prototypes captured above.
  // -------------------------------------------------------------------------

  const SELF_TARGETS = new Set(['', '_self', '_top', '_parent']);

  function attribute(node, name) {
    return apply(getAttribute, node, [name]);
  }

  function restoreAttribute(node, name, value) {
    if (value === null) apply(removeAttribute, node, [name]);
    else apply(setAttribute, node, [name, value]);
  }

  const formTarget = {
    on: false,
    installed: false,
    originalSubmit: null,
    wrapper: null,
    // null (the page's own way), { cancel: true } or { retarget }. Never throws.
    decide(form, submitter) {
      try {
        if (!userGesture()) return null;
        const button = submitter instanceof Element ? submitter : null;
        const target = String((button ? attribute(button, 'formtarget') : null) ?? attribute(form, 'target') ?? '').trim();
        if (SELF_TARGETS.has(target.toLowerCase())) return null;
        const action = appUrl((button ? attribute(button, 'formaction') : null) || (formAction ? apply(formAction, form, []) : '') || location.href);
        if (!action) return null;
        const answer = ask('formSubmit', {
          action,
          method: text(String((formMethod ? apply(formMethod, form, []) : '') || 'get').toLowerCase(), 10),
          target: text(target, 200),
          name: text(attribute(form, 'name') ?? '', 200),
          id: text(elementId ? apply(elementId, form, []) : '', 200),
        });
        if (own(answer, 'cancel') === true) return { cancel: true };
        const retarget = own(answer, 'retarget');
        if (typeof retarget === 'string' && FRAME_NAME.test(retarget)) return { retarget };
      } catch { /* never in the page's way */ }
      return null;
    },
    // A submit event (a button, Enter, requestSubmit) after the page's own
    // handlers: one that the page cancelled is left alone.
    onSubmit(event) {
      if (!formTarget.on || event.defaultPrevented || !(event.target instanceof FormElement)) return;
      const form = event.target;
      const decision = formTarget.decide(form, event.submitter);
      if (!decision) return;
      if (decision.cancel) {
        event.preventDefault();
        return;
      }
      const submitter = event.submitter instanceof Element ? event.submitter : null;
      const node = submitter && apply(hasAttribute, submitter, ['formtarget']) ? submitter : form;
      const name = node === form ? 'target' : 'formtarget';
      const before = attribute(node, name);
      apply(setAttribute, node, [name, decision.retarget]);
      // The browser reads the target right after this event; then the form
      // gets its own attribute back.
      setTimeout(() => restoreAttribute(node, name, before), 0);
    },
    enable() {
      this.on = true;
      if (this.installed) return;
      this.installed = true;
      apply(addListener, window, ['submit', this.onSubmit, false]);
      // Still in the chain from before (the page wrapped it): it works again.
      if (this.wrapper) return;
      const hook = this;
      const original = FormProto.submit;
      this.originalSubmit = original;
      // form.submit() fires no submit event.
      this.wrapper = function submit() {
        const decision = hook.on && this instanceof FormElement ? hook.decide(this, null) : null;
        if (decision?.cancel) return undefined;
        if (!decision) return apply(original, this, arguments);
        const before = attribute(this, 'target');
        apply(setAttribute, this, ['target', decision.retarget]);
        try {
          return apply(original, this, arguments);
        } finally {
          restoreAttribute(this, 'target', before);
        }
      };
      FormProto.submit = this.wrapper;
    },
    disable() {
      this.on = false;
      if (!this.installed) return;
      apply(removeListener, window, ['submit', this.onSubmit, false]);
      this.installed = false;
      // Put the original back unless the page wrapped ours meanwhile; then
      // ours stays as a plain pass-through, and is used again on enable.
      if (FormProto.submit === this.wrapper) {
        FormProto.submit = this.originalSubmit;
        this.wrapper = null;
      }
    },
  };

  // -------------------------------------------------------------------------
  // The page inside a popup dialog (a frame named ebs-popup-*, made by a
  // feature for a claimed window.open or form): window.opener is the page
  // that opened it, and window.close() (self.close()) asks the feature to
  // close the dialog ('popupClose'), as both would work in a popup window.
  // Enabled by the frame's own isolated side at document_start, before the
  // page's first script reads either.
  // -------------------------------------------------------------------------

  const popupFrame = {
    on: false,
    installed: false,
    enable() {
      this.on = true;
      if (this.installed || window.parent === window || !POPUP_FRAME.test(String(window.name))) return;
      this.installed = true;
      const nativeClose = window.close;
      try {
        window.opener = window.parent;
      } catch { /* the page decides */ }
      window.close = function close() {
        if (popupFrame.on) notify('popupClose', { frame: '' });
        else apply(nativeClose, window, []);
      };
    },
    disable() { this.on = false; },
  };

  // -------------------------------------------------------------------------
  // CKEditor 4 (CKEDITOR.instances): read and write the text of an editor.
  // -------------------------------------------------------------------------

  const MAX_HTML = 1024 * 1024;
  const ckeditor = {
    on: false,
    enable() { this.on = true; },
    disable() { this.on = false; },
    editor(name) {
      const instances = window.CKEDITOR?.instances;
      if (typeof name !== 'string' || !instances || !apply(hasOwn, instances, [name])) throw new Error('unknown editor');
      return instances[name];
    },
    html(value) {
      if (typeof value !== 'string' || value.length > MAX_HTML) throw new Error('html must be a string under 1 MB');
      return value;
    },
    methods: {
      list() {
        const instances = window.CKEDITOR?.instances ?? {};
        return Object.keys(instances).map((name) => ({ name, readOnly: Boolean(instances[name]?.readOnly) }));
      },
      getData({ name }) {
        return String(ckeditor.editor(name).getData() ?? '');
      },
      getSelectionText({ name }) {
        return String(ckeditor.editor(name).getSelection()?.getSelectedText() ?? '');
      },
      insertHtml({ name, html }) {
        ckeditor.editor(name).insertHtml(ckeditor.html(html));
        return true;
      },
      // setData is asynchronous in CKEditor 4; the page's own listeners (a
      // dirty flag, Angular's model) learn about the new text from 'change'.
      setData({ name, html }) {
        const editor = ckeditor.editor(name);
        const value = ckeditor.html(html);
        return new Promise((resolve) => {
          editor.setData(value, {
            callback() {
              editor.fire('change');
              resolve(true);
            },
          });
        });
      },
    },
  };

  // -------------------------------------------------------------------------
  // Responses of the page's own fetch and XMLHttpRequest calls, for URLs on
  // an allow-list (same origin only). The page gets the very same promise and
  // response as without the hook; the body is read from a clone. Request
  // headers are never read.
  // -------------------------------------------------------------------------

  const observe = {
    on: false,
    patterns: [],
    fetchOriginal: null,
    fetchWrapper: null,
    xhrOpen: null,
    xhrSend: null,
    openWrapper: null,
    sendWrapper: null,
    meta: new WeakMap(),
    matches(url) {
      return Boolean(url) && this.patterns.some((pattern) => pattern.test(url));
    },
    report(data) {
      notify('observed', data);
    },
    readable(contentType) {
      return /json|text|javascript|xml/i.test(contentType);
    },
    enable(options) {
      const patterns = [];
      const urls = own(options, 'urls');
      for (let i = 0; isArray(urls) && i < urls.length && i < 50; i += 1) {
        const source = urls[i];
        try {
          if (typeof source === 'string' && source.length <= 500) patterns.push(new RegExp(source));
        } catch { /* an invalid pattern matches nothing */ }
      }
      this.patterns = patterns;
      this.on = true;
      this.install();
    },
    disable() {
      this.on = false;
      this.patterns = [];
      if (this.fetchWrapper && window.fetch === this.fetchWrapper) {
        window.fetch = this.fetchOriginal;
        this.fetchWrapper = null;
      }
      const proto = XMLHttpRequest.prototype;
      if (this.openWrapper && proto.open === this.openWrapper && proto.send === this.sendWrapper) {
        proto.open = this.xhrOpen;
        proto.send = this.xhrSend;
        this.openWrapper = null;
        this.sendWrapper = null;
      }
    },
    install() {
      const hook = this;
      if (!this.fetchWrapper && typeof window.fetch === 'function') {
        const original = window.fetch;
        this.fetchOriginal = original;
        this.fetchWrapper = function fetch(input, init) {
          const promise = apply(original, this, arguments);
          try {
            const url = hook.on ? sameOriginUrl(typeof input === 'string' ? input : input?.url ?? String(input)) : null;
            if (url && hook.matches(url)) {
              const method = text(String(init?.method ?? input?.method ?? 'GET').toUpperCase(), 10);
              // Registered before the page's own .then, so the clone is
              // taken before the page reads the body.
              promise.then((response) => hook.fromFetch(url, method, response), () => {});
            }
          } catch { /* never in the page's way */ }
          return promise;
        };
        window.fetch = this.fetchWrapper;
      }
      if (!this.openWrapper) {
        const proto = XMLHttpRequest.prototype;
        const open = proto.open;
        const send = proto.send;
        this.xhrOpen = open;
        this.xhrSend = send;
        this.openWrapper = function open(method, url) {
          try {
            hook.meta.set(this, { method: text(String(method).toUpperCase(), 10), url: sameOriginUrl(url) });
          } catch { /* never in the page's way */ }
          return apply(open, this, arguments);
        };
        this.sendWrapper = function send() {
          const meta = hook.meta.get(this);
          if (hook.on && meta?.url && hook.matches(meta.url)) apply(addListener, this, ['loadend', onXhrEnd, { once: true }]);
          return apply(send, this, arguments);
        };
        proto.open = this.openWrapper;
        proto.send = this.sendWrapper;
      }
    },
    fromFetch(url, method, response) {
      try {
        const contentType = response.headers.get('content-type') ?? '';
        if (!this.readable(contentType)) {
          this.report({ url, method, status: response.status, contentType, body: null, skipped: 'type' });
          return;
        }
        response.clone().text().then((body) => this.reportBody(url, method, response.status, contentType, body), () => {});
      } catch { /* a body the page already used: nothing to report */ }
    },
    reportBody(url, method, status, contentType, body) {
      const tooLarge = body.length > MAX_OBSERVED_BODY;
      this.report({ url, method, status, contentType, body: tooLarge ? null : body, skipped: tooLarge ? 'size' : null });
    },
  };

  function onXhrEnd() {
    try {
      const meta = observe.meta.get(this);
      if (!observe.on || !meta) return;
      const url = sameOriginUrl(this.responseURL || meta.url) ?? meta.url;
      const contentType = this.getResponseHeader('content-type') ?? '';
      if (!observe.readable(contentType)) {
        observe.report({ url, method: meta.method, status: this.status, contentType, body: null, skipped: 'type' });
        return;
      }
      let body = null;
      if (this.responseType === '' || this.responseType === 'text') body = this.responseText;
      else if (this.responseType === 'json') body = stringify(this.response);
      if (typeof body !== 'string') {
        observe.report({ url, method: meta.method, status: this.status, contentType, body: null, skipped: 'type' });
        return;
      }
      observe.reportBody(url, meta.method, this.status, contentType, body);
    } catch { /* never in the page's way */ }
  }

  // -------------------------------------------------------------------------
  // A GET with the page's own fetch, for request.js (mode 'main'): whatever
  // the page's fetch adds applies, and nothing here reads or keeps it. The
  // isolated side does the scheduling (2 at a time, 20 a minute); this is a
  // second line: GET, same origin, at most 2 at a time and 30 a minute, a
  // little looser so the two clocks never disagree about the 20th.
  // -------------------------------------------------------------------------

  const MAX_REQUEST_BODY = 8 * 1024 * 1024;
  const request = {
    on: false,
    active: 0,
    started: [],
    controllers: new Map(),
    enable() { this.on = true; },
    disable() {
      this.on = false;
      for (const controller of this.controllers.values()) controller.abort();
      this.controllers.clear();
    },
    pageFetch() {
      // The page's fetch as it is now, but not our observer around it.
      return observe.fetchWrapper && window.fetch === observe.fetchWrapper ? observe.fetchOriginal : window.fetch;
    },
    async get(args) {
      const id = own(args, 'id');
      const absolute = sameOriginUrl(own(args, 'url'));
      if (!absolute || !/^https:/.test(absolute)) throw new Error('only same-origin https URLs');
      const now = Date.now();
      this.started = this.started.filter((time) => now - time < 60_000);
      if (this.active >= 2 || this.started.length >= 30) throw new Error('rate');
      this.active += 1;
      this.started.push(now);
      const controller = new AbortController();
      if (id !== undefined) this.controllers.set(String(id), controller);
      try {
        const init = bare({ method: 'GET', credentials: 'include', signal: controller.signal });
        init.headers = bare({ Accept: text(own(args, 'accept'), 100) || '*/*' });
        const response = await apply(this.pageFetch(), window, [absolute, init]);
        const body = await response.text();
        if (body.length > MAX_REQUEST_BODY) throw new Error('too-large');
        return {
          status: response.status,
          ok: response.ok,
          redirected: response.redirected,
          url: text(response.url, 4096),
          contentType: response.headers.get('content-type') ?? '',
          retryAfter: response.headers.get('retry-after') ?? '',
          text: body,
        };
      } catch (error) {
        if (error?.name === 'AbortError') throw new Error('abort');
        throw error;
      } finally {
        this.active -= 1;
        if (id !== undefined) this.controllers.delete(String(id));
      }
    },
  };

  const CAPABILITIES = { windowOpen, formTarget, popupFrame, ckeditor, observe, request };

  const METHODS = {
    'ckeditor.list': { capability: ckeditor, run: () => ckeditor.methods.list() },
    'ckeditor.getData': { capability: ckeditor, run: (args) => ckeditor.methods.getData(args) },
    'ckeditor.getSelectionText': { capability: ckeditor, run: (args) => ckeditor.methods.getSelectionText(args) },
    'ckeditor.insertHtml': { capability: ckeditor, run: (args) => ckeditor.methods.insertHtml(args) },
    'ckeditor.setData': { capability: ckeditor, run: (args) => ckeditor.methods.setData(args) },
    'request.get': { capability: request, run: (args) => request.get(args) },
    'request.abort': {
      capability: request,
      run: (args) => {
        request.controllers.get(String(own(args, 'id')))?.abort();
        return true;
      },
    },
  };

  async function call(message) {
    const method = apply(hasOwn, METHODS, [message.method]) ? METHODS[message.method] : null;
    try {
      if (!method) throw new Error('unknown method');
      if (!method.capability.on) throw new Error('capability is off');
      const given = own(message, 'args');
      const args = given !== null && typeof given === 'object' && !isArray(given) ? given : create(null);
      const value = await method.run(args);
      emit({ v: VERSION, type: 'result', id: message.id, ok: true, value });
    } catch (error) {
      emit({ v: VERSION, type: 'result', id: message.id, ok: false, error: text(String(error?.message ?? error), 500) });
    }
  }

  function onMessage(event) {
    let message;
    try {
      const detail = apply(detailOf, event, []);
      if (typeof detail !== 'string' || detail.length > MAX_MESSAGE) return;
      message = parseBare(detail);
    } catch {
      return;
    }
    if (own(message, 'v') !== VERSION) return;
    if (message.type === 'answer') {
      if (answers.has(message.id)) answers.set(message.id, own(message, 'value') ?? null);
      return;
    }
    if (message.type === 'enable' || message.type === 'disable') {
      const capability = apply(hasOwn, CAPABILITIES, [message.capability]) ? CAPABILITIES[message.capability] : null;
      if (!capability) return;
      if (message.type === 'enable') capability.enable(own(message, 'options') ?? null);
      else capability.disable();
      return;
    }
    if (message.type === 'call' && Number.isSafeInteger(message.id)) call(message);
  }

  function onHello(event) {
    if (channel || !noPageScriptYet()) return;
    let hello;
    try {
      hello = parseBare(apply(detailOf, event, []));
    } catch {
      return;
    }
    if (own(hello, 'v') !== VERSION || typeof hello.channel !== 'string' || !/^[0-9a-f-]{36}$/.test(hello.channel)) return;
    channel = { toMain: `ebs:${hello.channel}:main`, toIsolated: `ebs:${hello.channel}:isolated` };
    apply(removeListener, doc, [HELLO, onHello]);
    apply(addListener, doc, [channel.toMain, onMessage]);
    emit({ v: VERSION, type: 'welcome', capabilities: Object.keys(CAPABILITIES) });
  }

  apply(addListener, doc, [HELLO, onHello]);
  // For an isolated side that started first: it answers this with its hello.
  apply(dispatch, doc, [new PageCustomEvent(READY)]);
})();
