// A jsdom page with a fake chrome API, for the content scripts. The scripts
// run as Chrome would run them: their source evaluated in the page's window.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, requestInterceptor } from 'jsdom';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const open = new Set();

// Close every page, also after a failed test: a page's timers would keep
// the test process alive.
export function closeAll() {
  for (const window of open) window.close();
  open.clear();
}

// jsdom does no layout: an element that is in the document counts as shown.
function shimLayout(window) {
  Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() { return this.isConnected ? this.parentElement : null; },
  });
  window.Element.prototype.getClientRects = function getClientRects() {
    return this.isConnected && !this.closest('[hidden]') ? [{ width: 1, height: 1 }] : [];
  };
}

function fakeChrome(window, { store, answer, answerDelay, sent }) {
  const listeners = [];
  window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.CSS ??= {};
  window.CSS.escape ??= (value) => String(value).replace(/["\\]/g, '\\$&');
  shimLayout(window);
  window.chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = keys == null ? Object.keys(store) : [].concat(keys);
          return Object.fromEntries(list.filter((key) => key in store).map((key) => [key, structuredClone(store[key])]));
        },
        async set(values) {
          const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { oldValue: store[key], newValue: structuredClone(value) }]));
          Object.assign(store, structuredClone(values));
          for (const listener of [...listeners]) listener(changes, 'local');
        },
      },
      onChanged: { addListener: (listener) => listeners.push(listener) },
    },
    runtime: {
      id: 'ebs-test',
      sendMessage: (message) => {
        sent.push(message);
        return new Promise((resolve) => setTimeout(() => resolve(answer(message)), answerDelay));
      },
      onMessage: { addListener() {} },
    },
  };
}

function helpers(window, store, sent) {
  const load = (...files) => {
    for (const file of files) window.eval(readFileSync(join(root, 'src', file), 'utf8'));
  };
  const frame = () => new Promise((resolve) => window.requestAnimationFrame(() => setTimeout(resolve, 5)));
  const settle = async (frames = 3) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (let i = 0; i < frames; i += 1) await frame();
  };
  return { window, document: window.document, store, sent, load, settle, close: () => window.close() };
}

// `serve` maps URLs to the HTML a frame of the page gets for them (no network).
export function page(html, { url, store = {}, answer = () => ({}), answerDelay = 0, serve = null } = {}) {
  const resources = serve ? {
    resources: {
      interceptors: [requestInterceptor((request) => new Response(serve[request.url] ?? '<html><body></body></html>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }))],
    },
  } : {};
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true, ...resources });
  const { window } = dom;
  open.add(window);
  const sent = [];
  fakeChrome(window, { store, answer, answerDelay, sent });
  return helpers(window, store, sent);
}

// A page inside a frame of a parent page, as e-Boekhouden's login form is.
// The frame's document is served for `url` by a request interceptor: no network.
export async function framedPage(html, { url, parentHtml, parentUrl, frameName = 'mainframe', store = {}, answer = () => ({}), answerDelay = 0 } = {}) {
  const serve = requestInterceptor((request) => new Response(request.url === url ? html : '<html><body></body></html>', {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  }));
  const parentDocument = parentHtml ?? `<html><body id="ebs-login-host"><iframe name="${frameName}" id="${frameName}" src="${url}"></iframe></body></html>`;
  const dom = new JSDOM(parentDocument, { url: parentUrl, runScripts: 'outside-only', pretendToBeVisual: true, resources: { interceptors: [serve] } });
  open.add(dom.window);
  const iframe = dom.window.document.querySelector('iframe');
  await new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));
  const window = iframe.contentWindow;
  const sent = [];
  fakeChrome(window, { store, answer, answerDelay, sent });
  return helpers(window, store, sent);
}
