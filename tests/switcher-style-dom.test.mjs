// The "Wissel" menu of the new e-Boekhouden header looks like e-Boekhouden's
// own user menu (app-header-identity-b .dropdown-menu): it copies that menu's
// computed colours, radius, shadow, font and padding, hangs right under the
// header, and fades in and out. The legacy menu stays as it was.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, page } from './dom.mjs';

after(closeAll);

const slots = [
  { id: 'a', name: 'Voorbeeld B.V.', number: '1000001' },
  { id: 'b', name: 'Studio Noord', number: '1000002' },
  { id: 'c', name: 'Demo Holding B.V.', number: '1000003', expired: true },
  { id: 'd', name: 'Atelier Zuid', number: '1000004' },
];
const view = { activeSlotId: 'a', loggedIn: true, ready: ['b'] };
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// The native menu as the bundle renders it: closed (no .show), its styles as
// the bundle's component CSS gives them.
const NATIVE = `
  <style>
    :root { --pageBackground: #f5f6fa; --textColor: #4b4b4b; --colorWarning: #f09900; }
    .dropdown-menu { display: none; background-color: #30395f; border-bottom-left-radius: 14px; box-shadow: 0 0 24px #0003; }
    .dropdown-menu a { color: #ffffff; font-family: Ubuntu; font-size: 16px; font-weight: 700; padding: 12px 16px; }
  </style>`;
const NEW_HEADER = `<app-header-identity-b><div class="header-identity">
  <div class="userInfo"><span class="userName">Voorbeeld B.V.</span><span class="administratieId">1000001</span></div>
  <div class="identity"><div class="userCircle">VB</div>
    <div class="dropdown-menu"><div class="dropdown-group"><app-target-link><a>Wachtwoord wijzigen</a></app-target-link></div><div class="dropdown-group"><a>Uitloggen</a></div></div>
  </div></div></app-header-identity-b>`;
const LEGACY_HEADER = '<app-header-identity><div class="container"><div class="identity"><span class="username">Voorbeeld B.V.</span><span id="administratieId">1000001</span></div><div class="logout"></div></div></app-header-identity>';

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

async function open(header, { native = true, store = {} } = {}) {
  const p = page(`<!doctype html><html><head>${native ? NATIVE : ''}</head><body>${header}</body></html>`, {
    url: 'https://secure20.e-boekhouden.nl/boekhouden', store: { settings: {}, slots, view, 'avatar:b': PIXEL, ...store },
  });
  const shadow = withShadowRoots(p);
  p.load('shared.js', 'icons.js', 'content.js');
  await p.settle();
  shadow('ebs-nav').querySelector('button').click();
  await p.settle(1);
  const host = p.document.getElementById('ebs-menu');
  return { p, shadow, host, menu: shadow('ebs-menu') };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the new menu copies the native menu\'s computed values', async () => {
  const { p, host } = await open(NEW_HEADER);
  const value = (name) => host.style.getPropertyValue(name);
  assert.equal(value('--ebs-native-bg'), 'rgb(48, 57, 95)');
  assert.equal(value('--ebs-native-fg'), 'rgb(255, 255, 255)');
  assert.equal(value('--ebs-native-radius'), '14px');
  assert.match(value('--ebs-native-shadow'), /24px/);
  assert.equal(value('--ebs-native-size'), '16px');
  assert.equal(value('--ebs-native-weight'), '700');
  assert.equal(value('--ebs-native-pad'), '12px 16px');
  assert.equal(value('--ebs-native-hover-bg'), '#f5f6fa');
  assert.equal(value('--ebs-native-hover-fg'), '#4b4b4b');
  assert.equal(value('--ebs-native-warning'), '#f09900');
  p.close();
});

test('without a native menu the fallbacks of the bundle apply', async () => {
  const { p, host, menu } = await open(NEW_HEADER.replace(/<div class="dropdown-menu">[\s\S]*?<\/a><\/div><\/div>/, ''), { native: false });
  assert.equal([...host.style].filter((name) => name.startsWith('--ebs-native')).length, 0);
  const css = menu.querySelector('style').textContent;
  for (const fallback of ['var(--ebs-native-bg, #30395f)', 'var(--ebs-native-fg, #fff)', 'var(--ebs-native-hover-bg, #f5f6fa)', 'var(--ebs-native-hover-fg, #4b4b4b)', 'var(--ebs-native-pad, 12px 16px)', 'inset 0 24px 24px -10px #0003']) {
    assert.ok(css.includes(fallback), fallback);
  }
  p.close();
});

test('the new menu keeps every part, in the navy structure', async () => {
  const { p, menu } = await open(NEW_HEADER);
  const sheet = menu.querySelector('.sheet');
  assert.ok(sheet.classList.contains('new') && sheet.classList.contains('shown'), 'the sheet fades in');
  const card = sheet.querySelector('.card.new[role="menu"]');
  assert.ok(card);
  assert.equal(card.querySelector('.head .title').textContent, 'Wissel van administratie');
  assert.equal(card.querySelector('.head .count').textContent, '4 sessies');

  const rows = [...card.querySelectorAll('.list > .row')];
  assert.deepEqual(rows.map((row) => row.className), ['row active', 'row ready', 'row expired', 'row login']);
  // Logged in: a solid initials circle (or the picture); not logged in: outlined.
  assert.deepEqual(rows.map((row) => row.querySelector('.avatar').className), ['avatar active', 'avatar photo', 'avatar expired', 'avatar login']);
  assert.deepEqual(rows.map((row) => row.querySelector('.status').textContent), ['Actief', 'Klaar', 'Verlopen', 'Inloggen']);
  assert.equal(rows[0].querySelector('.pick').getAttribute('aria-checked'), 'true');
  assert.equal(rows[0].querySelector('.status svg').getAttribute('class').includes('lucide-check'), true);
  assert.deepEqual([...rows[1].querySelectorAll('.action')].map((button) => button.getAttribute('aria-label')), ['Profielfoto wijzigen', 'Profielfoto verwijderen', 'Sessie verwijderen']);
  assert.deepEqual([...rows[3].querySelectorAll('.action')].map((button) => button.getAttribute('aria-label')), ['Profielfoto kiezen', 'Sessie verwijderen']);
  assert.equal(card.querySelector('.foot .add').textContent, 'Administratie toevoegen');
  p.close();
});

test('the new menu CSS: native shape, ink that flips on the light hover, fades, readable focus rings', async () => {
  const { p, menu } = await open(NEW_HEADER);
  const css = menu.querySelector('style').textContent.replace(/\s+/g, ' ');
  const rule = (selector) => css.match(new RegExp(`(?:^|[}/] )${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[1] ?? '';
  assert.match(rule('.new.card'), /border-radius: 0 0 var\(--radius\) var\(--radius\)/, 'square top corners under the header, round bottom ones');
  assert.match(rule('.new.card'), /background: var\(--bg\)/);
  assert.match(rule('.new .row:hover, .new .add:hover'), /--ink: var\(--hover-fg\); --paper: var\(--hover-bg\)/);
  assert.match(rule('.new .row:hover'), /background: var\(--hover-bg\)/);
  assert.match(rule('.new .row.active'), /color-mix\(in srgb, var\(--fg\) 10%, var\(--bg\)\)/, 'the active row is a lighter navy');
  assert.ok(css.indexOf('.new .row.active {') < css.indexOf('.new .row:hover {'), 'the hover wins over the active highlight');
  assert.match(rule('.new .avatar.active, .new .avatar.ready'), /background: var\(--ink\)/);
  assert.match(rule('.new .avatar.expired, .new .avatar.login'), /border: 1.5px solid color-mix\(in srgb, var\(--ink\) 55%, transparent\)/);
  assert.match(rule('.new .avatar.login'), /border-style: dashed/);
  assert.match(rule('.new .status'), /background: color-mix\(in srgb, var\(--ink\) 14%, transparent\)/);
  assert.match(rule('.new .pick:focus-visible, .new .add:focus-visible, .new .action:focus-visible'), /outline: 2px solid var\(--ink\)/);
  assert.match(rule('.new.sheet'), /opacity: 0; transform: translateY\(-4px\); transition: opacity 150ms ease, transform 150ms/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.new\.sheet \{ transform: none; \} \}/);
  assert.match(rule('.new .avatar, .new .status, .new .number, .new .add .icon'), /transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease/);
  assert.match(rule('.new .number'), /color: color-mix\(in srgb, var\(--ink\) 85%, transparent\)/, '4.5:1 on navy and on the light hover');
  assert.match(rule('.new .actions'), /min-width: 108px; justify-content: flex-end/, 'the status labels line up');
  assert.match(rule('.new.card'), /min-width: min\(340px, calc\(100vw - 16px\)\)/, 'never wider than a narrow window');
  assert.match(rule('.new.card'), /max-height: var\(--ebs-menu-max-height, none\); overflow-y: auto/, 'scrolls in a short window');
  assert.doesNotMatch(css, /display: none/, 'nothing toggles display');
  p.close();
});

test('the new menu fades out before it leaves, and fades back in when opened again', async () => {
  const { p, shadow, host, menu } = await open(NEW_HEADER);
  const button = shadow('ebs-nav').querySelector('button');
  button.click(); // close
  await p.settle(1);
  assert.ok(host.isConnected, 'still there while it fades out');
  assert.equal(host.style.pointerEvents, 'none', 'clicks go through meanwhile');
  assert.equal(host.inert, true, 'Tab and a focused row cannot reach it meanwhile');
  assert.equal(menu.querySelector('.sheet').classList.contains('shown'), false);
  assert.equal(button.getAttribute('aria-expanded'), 'false');

  button.click(); // open again within the fade
  await p.settle(1);
  assert.equal(p.document.querySelectorAll('#ebs-menu').length, 1, 'the same menu, no second one');
  assert.equal(p.document.getElementById('ebs-menu'), host);
  assert.ok(menu.querySelector('.sheet').classList.contains('shown'));
  assert.equal(host.style.pointerEvents, '');
  assert.equal(host.inert, false);
  await wait(200);
  assert.ok(host.isConnected, 'the cancelled fade-out does not remove it');

  button.click();
  await wait(200);
  assert.equal(host.isConnected, false, 'gone after the fade');
  p.close();
});

test('the new menu hangs flush under the header, like the native one', async () => {
  const { p, host } = await open(NEW_HEADER);
  // jsdom has no layout: every rect is 0, so the top is the header bottom with no gap.
  assert.equal(host.style.top, '0px');
  assert.equal(host.style.position, 'fixed');
  p.close();
});

test('the new menu lines up with the Wissel button, and stays inside a narrow or short window', async () => {
  const { p, shadow, host, menu } = await open(NEW_HEADER);
  const rect = (values) => () => ({ top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0, ...values });
  const root = p.document.documentElement;
  const size = (width, height) => {
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: width });
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: height });
  };
  // The item is the button plus a divider of 23px; the header is 72px high.
  p.document.getElementById('ebs-nav').getBoundingClientRect = rect({ right: 923, bottom: 58, height: 44 });
  shadow('ebs-nav').querySelector('button').getBoundingClientRect = rect({ right: 900, bottom: 58, height: 44 });
  p.document.querySelector('.header-identity').getBoundingClientRect = rect({ bottom: 72, height: 72 });
  Object.defineProperty(host, 'offsetWidth', { configurable: true, value: 1280 }); // not fixed yet: page wide
  Object.defineProperty(menu.querySelector('.card'), 'offsetWidth', { configurable: true, value: 400 });

  size(1280, 800);
  p.window.dispatchEvent(new p.window.Event('resize'));
  assert.equal(host.style.top, '72px', 'flush under the header');
  assert.equal(host.style.right, '380px', 'right edge on the button, not on the divider');
  assert.equal(host.style.getPropertyValue('--ebs-menu-max-height'), '720px');

  // Narrow: the button's right edge at 300 of 420 would push a 400px menu
  // off the left edge.
  shadow('ebs-nav').querySelector('button').getBoundingClientRect = rect({ right: 300, bottom: 58, height: 44 });
  size(420, 300);
  p.window.dispatchEvent(new p.window.Event('resize'));
  assert.equal(host.style.right, '12px', '8px from the left edge');
  assert.equal(host.style.getPropertyValue('--ebs-menu-max-height'), '220px');
  p.close();
});

test('a switch in progress still shows its busy state on navy', async () => {
  const p = page(`<!doctype html><html><head>${NATIVE}</head><body>${NEW_HEADER}</body></html>`, {
    url: 'https://secure20.e-boekhouden.nl/boekhouden', store: { settings: {}, slots, view }, answerDelay: 100,
  });
  const shadow = withShadowRoots(p);
  // jsdom has no location.ancestorOrigins (Chrome has): the top page has no ancestors.
  Object.defineProperty(p.window.location, 'ancestorOrigins', { value: { length: 0 } });
  p.load('shared.js', 'icons.js', 'content.js');
  await p.settle();
  shadow('ebs-nav').querySelector('button').click();
  await p.settle(1);
  shadow('ebs-menu').querySelector('.row.ready .pick').click();
  await p.settle(1);
  const pick = shadow('ebs-menu').querySelector('.row.ready .pick');
  assert.equal(pick.disabled, true);
  assert.equal(pick.getAttribute('aria-busy'), 'true');
  assert.equal(pick.querySelector('.status').textContent, 'Bezig…');
  p.close();
});

test('the legacy menu is unchanged: no native tokens, no fade, gone at once', async () => {
  const { p, shadow, host, menu } = await open(LEGACY_HEADER);
  assert.equal([...host.style].filter((name) => name.startsWith('--ebs-native')).length, 0);
  assert.ok(menu.querySelector('.sheet.legacy'));
  assert.equal(menu.querySelector('.sheet').classList.contains('shown'), false);
  assert.ok(menu.querySelector('.card.legacy'));
  shadow('ebs-nav').querySelector('button').click();
  assert.equal(host.isConnected, false);
  p.close();
});
