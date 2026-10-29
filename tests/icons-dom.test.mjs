// The inline Lucide icons (icons.js) in jsdom.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeAll, page } from './dom.mjs';

after(closeAll);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const REQUESTED = 'pencil x check chevron-down chevron-right chevron-left search upload download trash-2 eye eye-off folder folder-plus folder-open file file-text file-image printer external-link mail send refresh-cw rotate-ccw users user camera log-in log-out arrow-left-right arrow-left plus minus sparkles languages wand-2 alert-triangle info circle-check circle-x clock calendar euro receipt repeat pause play link unlink scissors clipboard-paste filter sliders-horizontal more-horizontal grip-vertical lock key-round settings loader-circle bell list-checks'.split(' ');

test('every icon the screens need is there, as an SVG built from data', async () => {
  const p = page('<!doctype html><html><body></body></html>', { url: 'https://secure20.e-boekhouden.nl/boekhouden/archief' });
  p.load('shared.js', 'icons.js');
  const { icon } = p.window.EBS;
  for (const name of REQUESTED) {
    assert.ok(icon.has(name), name);
    const svg = icon(name);
    assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg', name);
    assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(svg.getAttribute('aria-hidden'), 'true');
    assert.ok(svg.children.length > 0, `${name} has shapes`);
  }
  assert.deepEqual([...icon('x').children].map((path) => path.getAttribute('d')), ['M18 6 6 18', 'm6 6 12 12']);
  // Lucide 1.x keeps these names as aliases of the current ones.
  assert.ok(icon('trash-2').classList.contains('lucide-trash'));
  assert.ok(icon('alert-triangle').classList.contains('lucide-triangle-alert'));
  const big = icon('pencil', { size: 20, label: 'Bewerken', className: 'edit' });
  assert.equal(big.getAttribute('width'), '20');
  assert.equal(big.getAttribute('role'), 'img');
  assert.equal(big.getAttribute('aria-label'), 'Bewerken');
  assert.ok(big.classList.contains('edit'));
  assert.throws(() => icon('not-an-icon'), /no icon named/);
  assert.throws(() => icon('constructor'), /no icon named/);
  const source = readFileSync(join(root, 'src/icons.js'), 'utf8');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(source), 'no markup strings');
  assert.match(source, /lucide-static 1\.63\.0/);
  p.close();
});
