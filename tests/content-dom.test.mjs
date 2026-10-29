// The navbar switcher and the back link of content.js in jsdom: their icons
// are Lucide (EBS.icon), never markup strings or text glyphs.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, page } from './dom.mjs';

after(closeAll);

const slots = [
  { id: 'a', name: 'Voorbeeld B.V.', number: '1000001' },
  { id: 'b', name: 'Studio Noord', number: '1000002' },
  { id: 'c', name: 'Demo Holding B.V.', number: '1000003', expired: true },
];
const view = { activeSlotId: 'a', loggedIn: true, ready: ['b'] };
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// The switcher draws in closed shadow roots: keep a handle on them.
function withShadowRoots(p) {
  const roots = [];
  const attach = p.window.Element.prototype.attachShadow;
  p.window.Element.prototype.attachShadow = function attachShadow(init) {
    const root = attach.call(this, init);
    roots.push({ host: this, root });
    return root;
  };
  return (id) => roots.find(({ host }) => host.id === id && host.isConnected)?.root ?? null;
}

const iconNames = (root) => [...root.querySelectorAll('svg')].map((svg) => svg.getAttribute('class').split(' ').find((name) => name.startsWith('lucide-')));

for (const [variant, header] of [
  ['new', '<app-header-identity-b><div class="header-identity"><div class="userInfo"><span class="userName">Voorbeeld B.V.</span><span class="administratieId">1000001</span></div></div></app-header-identity-b>'],
  ['legacy', '<app-header-identity><div class="container"><div class="identity"><span class="username">Voorbeeld B.V.</span><span id="administratieId">1000001</span></div><div class="logout"></div></div></app-header-identity>'],
]) {
  test(`the ${variant} navbar item and its menu use Lucide icons`, async () => {
    const p = page(`<!doctype html><html><head></head><body>${header}</body></html>`, {
      url: 'https://secure20.e-boekhouden.nl/boekhouden', store: { settings: {}, slots, view, 'avatar:b': PIXEL },
    });
    const shadow = withShadowRoots(p);
    p.load('shared.js', 'icons.js', 'content.js');
    await p.settle();
    const nav = shadow('ebs-nav');
    assert.ok(nav, 'the item is in the header');
    assert.deepEqual(iconNames(nav), variant === 'new' ? ['lucide-arrow-left-right'] : ['lucide-arrow-left-right', 'lucide-chevron-down']);
    nav.querySelector('button').click();
    await p.settle(1);
    const menu = shadow('ebs-menu');
    assert.ok(menu, 'the menu is open');
    const names = iconNames(menu);
    assert.ok(names.every(Boolean), 'every icon is a Lucide icon');
    if (variant === 'new') {
      assert.deepEqual(iconNames(menu.querySelector('.row.active .status')), ['lucide-check']);
      assert.deepEqual(iconNames(menu.querySelector('.row.expired .status')), ['lucide-clock']);
      assert.deepEqual(iconNames(menu.querySelector('.row.ready .actions')), ['lucide-camera', 'lucide-image-off', 'lucide-trash']);
      assert.deepEqual(iconNames(menu.querySelector('.add')), ['lucide-plus']);
      assert.equal(menu.querySelector('.add').textContent, 'Administratie toevoegen');
    } else {
      assert.deepEqual(iconNames(menu.querySelector('.row.ready .actions')), ['lucide-trash']);
      assert.deepEqual(iconNames(menu.querySelector('.add')), ['lucide-plus']);
      assert.equal(menu.querySelector('.add').textContent, 'Sessie toevoegen', 'no "+" glyph in the text');
    }
    const lucideFree = [...menu.querySelectorAll('svg')].filter((svg) => !svg.classList.contains('ebs-icon'));
    assert.deepEqual(lucideFree, [], 'no ad-hoc SVGs');
    p.close();
  });
}
