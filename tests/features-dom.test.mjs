// Every content script of the manifest, in manifest order, on a page: with
// all switches off nothing new may appear and the page's own functions stay
// the page's own. The feature stubs read their switch and do nothing yet.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeAll, page } from './dom.mjs';

after(closeAll);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const scripts = manifest.content_scripts.flatMap((entry) => entry.js).map((file) => file.replace(/^src\//, ''));
const FEATURES = scripts.filter((file) => file.startsWith('features/'));
const OFF = { betterDesign: false, onePassword: false, switcher: false, relogin: false, shiftSelect: false, actionBar: false, popupDialogs: false, aiWriter: false };
const HTML = '<!doctype html><html><head></head><body><main id="app"><p>Facturen</p></main></body></html>';

for (const [label, settings] of [['all switches off', OFF], ['every switch on', Object.fromEntries(Object.keys(OFF).map((key) => [key, true]))]]) {
  test(`the feature stubs change nothing, ${label}`, async () => {
    const p = page(HTML, { url: 'https://secure20.e-boekhouden.nl/boekhouden/facturen', store: { settings } });
    const natives = { open: p.window.open, fetch: p.window.fetch, submit: p.window.HTMLFormElement.prototype.submit };
    p.load('main-world.js', 'shared.js', 'store.js', 'icons.js', 'dialog.js', 'bridge.js', 'request.js', ...FEATURES);
    await p.settle();
    assert.equal(p.document.body.innerHTML, '<main id="app"><p>Facturen</p></main>');
    assert.equal(p.document.head.innerHTML, '');
    assert.equal(p.window.open, natives.open);
    assert.equal(p.window.fetch, natives.fetch);
    assert.equal(p.window.HTMLFormElement.prototype.submit, natives.submit);
    assert.equal(await p.window.EBS.bridge.ready(), true);
    assert.deepEqual(p.sent, [], 'no messages to the service worker');
    p.close();
  });
}

test('every manifest script loads in order on an app page with all switches off', async () => {
  const p = page(HTML, { url: 'https://secure20.e-boekhouden.nl/boekhouden/facturen', store: { settings: OFF } });
  const errors = [];
  p.window.addEventListener('error', (event) => errors.push(event.message));
  p.load(...scripts);
  await p.settle();
  assert.deepEqual(errors, []);
  for (const name of ['store', 'icon', 'dialog', 'bridge', 'request']) assert.ok(p.window.EBS[name], name);
  assert.throws(() => p.window.EBS.define('request', {}), /already defined/, 'a later script cannot swap a module');
  p.close();
});
