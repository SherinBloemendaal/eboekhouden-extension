// The toolbar popup (src/popup) in jsdom: its icons are Lucide (EBS.icon).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeAll, page } from './dom.mjs';

after(closeAll);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'src/popup/popup.html'), 'utf8');

test('the popup loads the icons and draws Lucide icons only', async () => {
  const scripts = [...html.matchAll(/<script src="\.\.\/([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(scripts, ['shared.js', 'icons.js'], 'shared.js, then icons.js, before popup.js');
  assert.ok(!/<svg/.test(html), 'no SVG markup in the page');
  const p = page(html.replace(/<script[\s\S]*?<\/script>/g, ''), {
    url: 'chrome-extension://ebs-test/src/popup/popup.html',
    store: { settings: {}, slots: [{ id: 'a', name: 'Voorbeeld B.V.', number: '1' }, { id: 'b', name: 'Studio Noord', number: '2', expired: true }], view: { activeSlotId: 'a', loggedIn: true, ready: [] } },
  });
  p.load('shared.js', 'icons.js', 'popup/popup.js');
  await p.settle();
  const { document } = p;
  assert.ok(document.querySelector('#add .add-icon svg.lucide-plus'));
  const cameras = [...document.querySelectorAll('.row .icon-btn')];
  assert.equal(cameras.length, 2);
  assert.ok(cameras.every((button) => button.querySelector('svg.lucide-camera')));
  assert.ok([...document.querySelectorAll('svg')].every((svg) => svg.classList.contains('ebs-icon')), 'no ad-hoc SVGs');
  p.close();
});
