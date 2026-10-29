// The Digitaal archief page for the jsdom tests: the stand-in for
// e-Boekhouden's archive (archive-mock.mjs) with the extension loaded over it.
// The page loads its data with its own GETs (fetch); the extension reads them
// through the bridge, and every request is counted.
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { page } from './dom.mjs';
import { answer, demoData, nativeScript, shellHtml } from './archive-mock.mjs';

export const URL_ARCHIVE = 'https://secure20.e-boekhouden.nl/overig/digitaal-archief';
const FOUNDATION = ['shared.js', 'store.js', 'icons.js', 'dialog.js', 'bridge.js'];
// e-Boekhouden's own GETs; anything else that goes out is ours.
const NATIVE = /\/folder\/(directory|\d+\/(header|filelist|koppel))(\?|$)/;

// previewTypes: { id: content type } for a preview answer; unreadable: folder
// ids whose filelist answer the observe hook cannot read (not JSON or text);
// gate(path): a promise the answer to that GET waits for (one that never
// settles is an answer that never comes), or nothing for an answer at once.
export async function archivePage({ slow = 0, data = demoData(), settings = { betterDesign: true }, store = {}, fakeRequest = false, nativeFirst = false, url = URL_ARCHIVE, previewTypes = {}, unreadable = [], gate = null } = {}) {
  const p = page(shellHtml(), {
    url,
    store: { settings, ...store },
    answer: (message) => (message.type === 'requests:slot' ? { ok: true, lease: 'test' } : {}),
  });
  const { window } = p;
  window.Response ??= Response;
  window.Blob ??= Blob;
  const calls = [];
  const fetchAnswer = async (input) => {
    const href = new URL(String(input?.url ?? input), window.location.href).href;
    calls.push(href);
    const path = new URL(href).pathname;
    if (slow && /\/filelist/.test(href)) await new Promise((resolve) => setTimeout(resolve, slow));
    const wait = gate?.(path);
    if (wait) await wait;
    const reply = answer(data, path);
    if (reply.preview) {
      const type = previewTypes[/\/folder\/(\d+)\//.exec(path)[1]] ?? reply.preview;
      return new Response(new Blob(['%PDF-1.7'], { type }), { status: 200, headers: { 'content-type': type } });
    }
    const hidden = unreadable.some((id) => path.endsWith(`/folder/${id}/filelist`));
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': hidden ? 'application/octet-stream' : 'application/json' } });
  };
  window.fetch = fetchAnswer;
  const pageXhr = { open: window.XMLHttpRequest.prototype.open, send: window.XMLHttpRequest.prototype.send };
  const blobs = { made: [], revoked: [] };
  const items = [];
  const boot = () => window.eval(`(${nativeScript})(${JSON.stringify(data)}, { transport: 'fetch' })`);
  p.load('main-world.js', 'shared.js');
  if (fakeRequest) {
    // A request layer that answers a blob, for the preview (jsdom has no
    // trusted clicks for the real one); it keeps the rules that matter here.
    window.EBS.define('request', Object.freeze({
      bulk: (key, href) => fetchAnswer(href).then((response) => response.json()),
      item: (key, href, options = {}) => {
        if (options.userAction !== true) return Promise.reject(new Error('user-action'));
        items.push({ key, href, as: options.as });
        return fetchAnswer(href).then((response) => response.blob());
      },
      abort() {},
    }));
    window.URL.createObjectURL = (blob) => {
      const href = `blob:${URL_ARCHIVE}#${blobs.made.length}`;
      blobs.made.push({ href, type: blob.type });
      return href;
    };
    window.URL.revokeObjectURL = (href) => blobs.revoked.push(href);
  }
  if (nativeFirst) {
    boot();
    await p.settle();
  }
  p.load(...FOUNDATION.slice(1), 'request.js', 'features/archive.js');
  await p.settle();
  if (!nativeFirst) boot();
  await settleAll(p);
  const ours = () => calls.filter((href) => !NATIVE.test(href));
  return { ...p, calls, ours, items, data, blobs, fetchAnswer, pageXhr, $: (selector) => p.document.querySelector(selector), $$: (selector) => [...p.document.querySelectorAll(selector)] };
}

export async function settleAll(p, rounds = 4) {
  for (let i = 0; i < rounds; i += 1) await p.settle();
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A gate for one answer: `held` until open() is called.
export function hold() {
  let open;
  const held = new Promise((resolve) => { open = resolve; });
  return { held, open: () => open() };
}

export const rowNames = (p) => p.$$('.ebs-ar-body .ebs-ar-item').map((node) => node.querySelector('.ebs-ar-name').textContent);
export const rowNode = (p, name) => p.$$('.ebs-ar-body .ebs-ar-item').find((node) => node.querySelector('.ebs-ar-name').textContent === name);
export const nativeLog = (p) => [...p.window.__archive.log];
export const folderButton = (p, label) => p.$$('.ebs-ar-folder').find((node) => node.textContent === label || node.textContent.startsWith(`${label} (`));
// A click of the user (trusted, see below); scriptClick is one a page script
// makes, which the view's controls ignore.
export const click = (p, node, init = {}) => trusted(p, node, 'click', init);
export const scriptClick = (p, node, init = {}) => node.dispatchEvent(new p.window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));

// An event as the browser sends it for the user (event.isTrusted). jsdom only
// makes untrusted events, and dispatchEvent() clears the flag, so this goes
// through jsdom's own dispatch with the flag set, as Chrome does for a real
// click or key.
const require = createRequire(import.meta.url);
const { implForWrapper } = require(join(dirname(require.resolve('jsdom')), 'generated/idl/utils.js'));
export function trusted(p, node, type = 'click', init = {}, Event = /^key/.test(type) ? p.window.KeyboardEvent : p.window.MouseEvent) {
  const event = new Event(type, { bubbles: true, cancelable: true, ...init });
  const impl = implForWrapper(event);
  impl.isTrusted = true;
  implForWrapper(node)._dispatch(impl);
  return event;
}
