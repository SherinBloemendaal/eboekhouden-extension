// The MAIN-world bridge (main-world.js + bridge.js) in jsdom. jsdom has one
// world, so both halves share a window here; the channel is the same DOM
// event traffic Chrome carries between the worlds.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, page } from './dom.mjs';

after(closeAll);

const URL_V2 = 'https://secure20.e-boekhouden.nl/boekhouden/facturen';
const HTML = '<!doctype html><html><head></head><body><form id="f" action="/print/factuur" target="_blank" name="frmPrint"></form><button id="b">Klik</button></body></html>';

// The page's own functions, replaced by recorders before the scripts load.
// jsdom has no navigator.userActivation: `gesture.active` stands in for a
// click of the user that is still fresh.
function pageWithNatives(html = HTML, { order = ['main-world.js', 'shared.js', 'bridge.js', 'request.js'] } = {}) {
  const p = page(html, { url: URL_V2, answer: (message) => (message.type === 'requests:slot' ? { ok: true, lease: 'test' } : {}) });
  const { window } = p;
  const gesture = { active: false };
  class UserActivation {
    get isActive() { return gesture.active; }
    get hasBeenActive() { return gesture.active; }
  }
  Object.defineProperty(window.navigator, 'userActivation', { configurable: true, value: new UserActivation() });
  const log = { opened: [], submitted: [], fetched: [] };
  window.open = function open(...args) {
    log.opened.push(args);
    return 'page-window';
  };
  window.HTMLFormElement.prototype.submit = function submit() {
    log.submitted.push(window.Element.prototype.getAttribute.call(this, 'target'));
  };
  window.fetch = async function fetch(input, init) {
    log.fetched.push({ url: String(input), init });
    return new Response(JSON.stringify({ rows: [{ id: 1 }] }), { headers: { 'content-type': 'application/json' } });
  };
  const natives = {
    open: window.open,
    submit: window.HTMLFormElement.prototype.submit,
    fetch: window.fetch,
    xhrOpen: window.XMLHttpRequest.prototype.open,
    xhrSend: window.XMLHttpRequest.prototype.send,
  };
  p.load(...order);
  return { ...p, log, natives, gesture, bridge: window.EBS.bridge };
}

// The channel name, read the way a same-origin parent frame could.
function sniffChannel(p) {
  const names = [];
  const dispatch = p.document.dispatchEvent.bind(p.document);
  p.document.dispatchEvent = (event) => {
    if (/^ebs:/.test(event.type)) names.push(event.type);
    return dispatch(event);
  };
  return names;
}

function untouched(p) {
  const { window, natives } = p;
  assert.equal(window.open, natives.open);
  assert.equal(window.HTMLFormElement.prototype.submit, natives.submit);
  assert.equal(window.fetch, natives.fetch);
  assert.equal(window.XMLHttpRequest.prototype.open, natives.xhrOpen);
  assert.equal(window.XMLHttpRequest.prototype.send, natives.xhrSend);
}

// Objects from the page's realm, compared as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

test('the halves find each other in either order, and change nothing on their own', async () => {
  for (const order of [['main-world.js', 'shared.js', 'bridge.js'], ['shared.js', 'bridge.js', 'main-world.js']]) {
    const p = pageWithNatives(HTML, { order });
    assert.equal(await p.bridge.ready(), true, order.join(' > '));
    untouched(p);
    assert.equal(p.window.open('/bh/factuur.asp', 'print'), 'page-window');
    p.document.getElementById('f').submit();
    assert.deepEqual(p.log.submitted, ['_blank']);
    p.close();
  }
});

test('no channel once a page script exists: a page cannot open one later', async () => {
  const p = pageWithNatives(`<!doctype html><html><head><script>/* page */</script></head><body></body></html>`);
  assert.equal(await p.bridge.ready(50), false);
  p.bridge.enable('windowOpen');
  untouched(p);
  await assert.rejects(p.bridge.call('ckeditor.list'), /not connected/);
  p.close();
});

test('a late ready event from the page gets no hello with the channel name', async () => {
  const p = pageWithNatives();
  await p.bridge.ready();
  const hellos = [];
  p.document.addEventListener('ebs-bridge:hello', (event) => hellos.push(event.detail));
  p.document.head.append(p.document.createElement('script'));
  p.document.dispatchEvent(new p.window.CustomEvent('ebs-bridge:ready'));
  assert.deepEqual(hellos, []);
  p.close();
});

test('window.open: unclaimed popups open as always, a claimed one returns null', async () => {
  const p = pageWithNatives();
  await p.bridge.ready();
  p.gesture.active = true;
  p.bridge.enable('windowOpen');
  assert.notEqual(p.window.open, p.natives.open, 'the hook is in place now');
  assert.equal(p.window.open('/bh/factuur.asp?id=1', 'print', 'width=800'), 'page-window', 'no feature registered: the page decides');

  const asked = [];
  const stop = p.bridge.intercept('windowOpen', (popup) => {
    asked.push(popup);
    return popup.url.includes('factuur') ? { claim: true } : null;
  });
  assert.throws(() => p.bridge.intercept('windowOpen', () => null), /already has a handler/);
  assert.equal(p.window.open('/bh/factuur.asp?id=2', 'print', 'width=800'), null);
  assert.equal(p.window.open('/bh/relatie.asp'), 'page-window');
  assert.equal(p.window.open('https://www.example.com/'), 'page-window', 'other sites are never asked about');
  assert.equal(p.window.open(''), 'page-window', 'an empty popup (to write into) is left alone');
  assert.deepEqual(asked.map((popup) => [popup.url, popup.target, popup.features]), [
    ['https://secure20.e-boekhouden.nl/bh/factuur.asp?id=2', 'print', 'width=800'],
    ['https://secure20.e-boekhouden.nl/bh/relatie.asp', '', ''],
  ]);
  stop();
  p.bridge.intercept('windowOpen', () => {
    throw new Error('feature bug');
  });
  const errors = console.error;
  console.error = () => {};
  assert.equal(p.window.open('/bh/factuur.asp?id=3'), 'page-window', 'a failing feature never blocks the page');
  console.error = errors;
  p.bridge.disable('windowOpen');
  assert.equal(p.window.open, p.natives.open, 'off again: the page\'s own window.open');
  p.close();
});

test('form submits into another window can go into a frame of ours, or stay as they are', async () => {
  const p = pageWithNatives();
  await p.bridge.ready();
  const form = p.document.getElementById('f');
  p.gesture.active = true;
  p.bridge.enable('formTarget');
  form.submit();
  assert.deepEqual(p.log.submitted, ['_blank'], 'nobody claims it: as before');

  let answer = { retarget: 'ebs-popup-frame' };
  const seen = [];
  p.bridge.intercept('formSubmit', (submit) => {
    seen.push(submit);
    return answer;
  });
  form.submit();
  assert.equal(p.log.submitted.at(-1), 'ebs-popup-frame');
  assert.equal(form.getAttribute('target'), '_blank', 'the form gets its own target back');
  assert.deepEqual(plain(seen[0]), { action: 'https://secure20.e-boekhouden.nl/print/factuur', method: 'get', target: '_blank', name: 'frmPrint', id: 'f' });

  answer = { retarget: 'somewhere-else' };
  form.submit();
  assert.equal(p.log.submitted.at(-1), '_blank', 'only frames named ebs-… can be a target');
  answer = { cancel: true };
  const count = p.log.submitted.length;
  form.submit();
  assert.equal(p.log.submitted.length, count);

  // A submit event (a button, Enter): retargeted until the browser has read it.
  answer = { retarget: 'ebs-popup-frame' };
  form.dispatchEvent(new p.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(form.getAttribute('target'), 'ebs-popup-frame');
  await tick();
  assert.equal(form.getAttribute('target'), '_blank');
  // One the page cancelled itself stays cancelled and untouched.
  form.addEventListener('submit', (event) => event.preventDefault(), { once: true });
  seen.length = 0;
  form.dispatchEvent(new p.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.deepEqual(seen, []);

  // A form that submits into its own window is never asked about.
  const self = p.document.createElement('form');
  self.action = '/opslaan';
  p.document.body.append(self);
  self.submit();
  assert.deepEqual(seen, []);
  p.bridge.disable('formTarget');
  untouched(p);
  p.close();
});

test('CKEditor 4: read and write an editor once the hook is on', async () => {
  const p = pageWithNatives();
  await p.bridge.ready();
  const fired = [];
  p.window.CKEDITOR = {
    instances: {
      txtBody: {
        readOnly: false,
        data: '<p>Beste klant,</p>',
        getData() { return this.data; },
        setData(value, { callback }) {
          this.data = value;
          setTimeout(callback, 1);
        },
        insertHtml(html) { this.data += html; },
        getSelection() { return { getSelectedText: () => 'klant' }; },
        fire(name) { fired.push(name); },
      },
    },
  };
  await assert.rejects(p.bridge.call('ckeditor.list'), /capability is off/);
  p.bridge.enable('ckeditor');
  assert.deepEqual(plain(await p.bridge.call('ckeditor.list')), [{ name: 'txtBody', readOnly: false }]);
  assert.equal(await p.bridge.call('ckeditor.getData', { name: 'txtBody' }), '<p>Beste klant,</p>');
  assert.equal(await p.bridge.call('ckeditor.getSelectionText', { name: 'txtBody' }), 'klant');
  // Writing waits for a click of the user: the extension never fills in by itself.
  await assert.rejects(p.bridge.call('ckeditor.insertHtml', { name: 'txtBody', html: '<p>Groet</p>' }), /only during a click/);
  await assert.rejects(p.bridge.call('ckeditor.setData', { name: 'txtBody', html: '<p>Nieuw</p>' }), /only during a click/);
  assert.equal(p.window.CKEDITOR.instances.txtBody.data, '<p>Beste klant,</p>');
  p.gesture.active = true;
  await p.bridge.call('ckeditor.insertHtml', { name: 'txtBody', html: '<p>Groet</p>' });
  assert.equal(p.window.CKEDITOR.instances.txtBody.data, '<p>Beste klant,</p><p>Groet</p>');
  await p.bridge.call('ckeditor.setData', { name: 'txtBody', html: '<p>Nieuw</p>' });
  assert.equal(p.window.CKEDITOR.instances.txtBody.data, '<p>Nieuw</p>');
  assert.deepEqual(fired, ['change'], 'setData tells the page with a change event');
  await assert.rejects(p.bridge.call('ckeditor.getData', { name: 'toString' }), /unknown editor/);
  await assert.rejects(p.bridge.call('ckeditor.setData', { name: 'txtBody', html: 42 }), /html must be a string/);
  await assert.rejects(p.bridge.call('request.get', { url: '/x' }), /unknown method/, 'request.* is not public');
  p.close();
});

test('fetch observation: the page gets its own response, a feature a copy of allowed ones', async () => {
  const p = pageWithNatives();
  await p.bridge.ready();
  const observed = [];
  p.bridge.on('observed', (response) => observed.push(response));
  p.bridge.enable('observe', { urls: ['/api/factuur/grid'] });
  const pending = p.window.fetch('/api/factuur/grid?page=1');
  const response = await pending;
  assert.deepEqual(plain(await response.json()), { rows: [{ id: 1 }] }, 'the page can still read the body');
  await p.window.fetch('/api/relatie/1');
  await tick();
  assert.equal(observed.length, 1);
  assert.equal(observed[0].url, 'https://secure20.e-boekhouden.nl/api/factuur/grid?page=1');
  assert.equal(observed[0].status, 200);
  assert.deepEqual(plain(JSON.parse(observed[0].body)), { rows: [{ id: 1 }] });
  assert.equal(p.log.fetched.length, 2);
  p.bridge.disable('observe');
  untouched(p);
  p.close();
});

test('XMLHttpRequest observation: the page\'s request still goes out, a feature gets a copy', async () => {
  const p = pageWithNatives();
  const { window } = p;
  const sent = [];
  // A page XHR without network: open and send record, load ends at once.
  window.XMLHttpRequest.prototype.open = function open(method, url) {
    this.ebsTestUrl = url;
  };
  window.XMLHttpRequest.prototype.send = function send() {
    sent.push(this.ebsTestUrl);
    const answer = { status: 200, responseURL: new URL(this.ebsTestUrl, window.location.href).href, responseType: '', responseText: JSON.stringify({ rows: [{ id: 2 }] }) };
    for (const [name, value] of Object.entries(answer)) Object.defineProperty(this, name, { value, configurable: true });
    this.getResponseHeader = () => 'application/json';
    setTimeout(() => this.dispatchEvent(new window.Event('loadend')));
  };
  await p.bridge.ready();
  const observed = [];
  p.bridge.on('observed', (response) => observed.push(response));
  p.bridge.enable('observe', { urls: ['/api/factuur/grid'] });
  const xhr = new window.XMLHttpRequest();
  xhr.open('GET', '/api/factuur/grid?page=2');
  xhr.send();
  await tick();
  await tick();
  assert.deepEqual(sent, ['/api/factuur/grid?page=2'], 'the page\'s own open and send ran');
  assert.equal(observed.length, 1);
  assert.equal(observed[0].url, 'https://secure20.e-boekhouden.nl/api/factuur/grid?page=2');
  assert.deepEqual(plain(JSON.parse(observed[0].body)), { rows: [{ id: 2 }] });
  p.bridge.disable('observe');
  p.close();
});

test('request.js in main mode runs a GET with the page\'s own fetch', async () => {
  const p = pageWithNatives();
  await p.bridge.ready();
  const posted = [];
  const dispatch = p.document.dispatchEvent.bind(p.document);
  p.document.dispatchEvent = (event) => {
    if (/^ebs:.*:main$/.test(event.type)) posted.push(JSON.parse(event.detail));
    return dispatch(event);
  };
  const data = await p.window.EBS.request.bulk('facturen', '/api/factuur/grid', { mode: 'main' });
  assert.deepEqual(plain(data), { rows: [{ id: 1 }] });
  assert.equal(p.log.fetched.length, 1);
  assert.equal(p.log.fetched[0].init.method, 'GET');
  assert.equal(p.log.fetched[0].init.credentials, 'include');
  assert.ok(posted.some((message) => message.type === 'call' && message.method === 'request.get'), 'it went through the bridge');
  assert.throws(() => p.bridge.claimRequest(), /already claimed/, 'only request.js has the page-world GET');
  assert.throws(() => p.bridge.enable('request'), /belongs to request.js/);
  p.close();
});

test('without a user gesture no feature is asked: a page script cannot open a dialog on its own', async () => {
  const p = pageWithNatives();
  await p.bridge.ready();
  const asked = [];
  p.bridge.enable('windowOpen');
  p.bridge.enable('formTarget');
  p.bridge.intercept('windowOpen', (popup) => {
    asked.push(popup.url);
    return { claim: true };
  });
  p.bridge.intercept('formSubmit', (submit) => {
    asked.push(submit.action);
    return { cancel: true };
  });
  assert.equal(p.window.open('/bh/factuur.asp?id=1'), 'page-window', 'the page\'s own window.open (and so its popup blocker)');
  p.document.getElementById('f').submit();
  assert.deepEqual(p.log.submitted, ['_blank']);
  assert.deepEqual(asked, []);
  p.gesture.active = true;
  assert.equal(p.window.open('/bh/factuur.asp?id=2'), null);
  assert.deepEqual(asked, ['https://secure20.e-boekhouden.nl/bh/factuur.asp?id=2']);
  p.close();
});

test('a forged message on the channel gets no feature to act without a gesture', async () => {
  const p = pageWithNatives();
  const names = sniffChannel(p);
  await p.bridge.ready();
  const asked = [];
  p.bridge.intercept('windowOpen', (popup) => {
    asked.push(popup.url);
    return { claim: true };
  });
  p.bridge.enable('windowOpen');
  const toIsolated = names.find((name) => name.endsWith(':main')).replace(/:main$/, ':isolated');
  const answers = [];
  p.document.addEventListener(names.find((name) => name.endsWith(':main')), (event) => answers.push(JSON.parse(event.detail)));
  const forge = (id) => p.document.dispatchEvent(new p.window.CustomEvent(toIsolated, {
    detail: JSON.stringify({ v: 1, type: 'query', id, hook: 'windowOpen', data: { url: 'https://secure20.e-boekhouden.nl/bh/x.asp', target: '', features: '' } }),
  }));
  forge(9001);
  assert.deepEqual(asked, []);
  assert.deepEqual(answers.filter((message) => message.id === 9001).map((message) => message.value), [null]);
  // During a real gesture it is no more than the page calling window.open itself.
  p.gesture.active = true;
  forge(9002);
  assert.deepEqual(asked, ['https://secure20.e-boekhouden.nl/bh/x.asp']);
  p.close();
});

test('form fields that shadow the form\'s own properties cannot break or fool the hook', async () => {
  const p = pageWithNatives('<!doctype html><html><head></head><body><form id="f" action="/print/factuur" method="post" target="_blank"><input name="action" value="/elders"><input name="method" value="x"><input name="id" value="y"><input name="getAttribute" value="z"><input name="target" value="w"></form></body></html>');
  await p.bridge.ready();
  const seen = [];
  p.gesture.active = true;
  p.bridge.enable('formTarget');
  p.bridge.intercept('formSubmit', (submit) => {
    seen.push(submit);
    return { retarget: 'ebs-popup' };
  });
  const form = p.document.getElementById('f');
  // What Chrome does for a form (jsdom does not): a field named like a
  // property of the form hides that property.
  for (const field of form.elements) Object.defineProperty(form, field.name, { configurable: true, value: field });
  assert.equal(typeof form.getAttribute, 'object');
  form.submit();
  assert.deepEqual(p.log.submitted, ['ebs-popup'], 'the page\'s submit ran');
  assert.deepEqual(plain(seen), [{ action: 'https://secure20.e-boekhouden.nl/print/factuur', method: 'post', target: '_blank', name: '', id: 'f' }]);
  assert.equal(p.window.Element.prototype.getAttribute.call(form, 'target'), '_blank');
  p.close();
});

test('getters the page puts on Object.prototype never see what the extension sends', async () => {
  const p = pageWithNatives();
  await p.bridge.ready();
  const seen = [];
  const names = ['bubbles', 'cancelable', 'composed', 'claim', 'retarget', 'cancel', 'accept', 'options', 'args'];
  // jsdom runs both halves in one realm. In Chrome the extension's side has
  // its own Object.prototype, so a hit on an object of that side (a message
  // it sends: call, answer, enable, disable) is not a hit the page gets.
  const ofIsolated = (object) => {
    try {
      return ['call', 'answer', 'enable', 'disable'].includes(JSON.parse(Object.getOwnPropertyDescriptor(object, 'detail')?.value).type);
    } catch {
      return false;
    }
  };
  for (const name of names) {
    Object.defineProperty(p.window.Object.prototype, name, {
      configurable: true,
      get() {
        if (!ofIsolated(this)) seen.push(name);
        return undefined;
      },
    });
  }
  p.gesture.active = true;
  p.bridge.enable('windowOpen');
  p.bridge.enable('ckeditor');
  p.bridge.intercept('windowOpen', () => ({ claim: true }));
  p.window.CKEDITOR = { instances: { txt: { getData: () => '<p>x</p>' } } };
  assert.equal(p.window.open('/bh/factuur.asp?id=1'), null);
  assert.equal(await p.bridge.call('ckeditor.getData', { name: 'txt' }), '<p>x</p>');
  await p.window.EBS.request.bulk('k', '/api/k', { mode: 'main' });
  for (const name of names) delete p.window.Object.prototype[name];
  assert.deepEqual(seen, [], 'the page saw these being read');
  p.close();
});

test('off and on again after the page wrapped submit: one question per submit', async () => {
  const p = pageWithNatives();
  await p.bridge.ready();
  p.gesture.active = true;
  const seen = [];
  p.bridge.intercept('formSubmit', (submit) => {
    seen.push(submit.action);
    return null;
  });
  p.bridge.enable('formTarget');
  const ours = p.window.HTMLFormElement.prototype.submit;
  p.window.HTMLFormElement.prototype.submit = function pageSubmit() {
    return ours.call(this);
  };
  p.bridge.disable('formTarget');
  p.document.getElementById('f').submit();
  assert.deepEqual(seen, [], 'off: ours passes through');
  p.bridge.enable('formTarget');
  p.document.getElementById('f').submit();
  assert.equal(seen.length, 1);
  assert.deepEqual(p.log.submitted, ['_blank', '_blank']);
  p.close();
});
