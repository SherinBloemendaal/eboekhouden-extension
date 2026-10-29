// The loader on refresh of /bh/ (src/features/loader.js): the logo parser,
// the top frame's overlay and its exits, and the frames that report to it.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeAll, framedPage, page } from './dom.mjs';

after(closeAll);

const TOP = 'https://secure.e-boekhouden.nl/bh/';
const APP_ENTRY = 'https://secure.e-boekhouden.nl/bh?v2Url=%2Fboekhouden';
const SECURE20 = 'https://secure20.e-boekhouden.nl';
const FRAMESET = '<html><head><title>e-Boekhouden.nl</title></head><frameset rows="0,*"><frame name="topframe" src="about:blank"><frame name="mainframe" id="mainframe" src="about:blank"></frameset></html>';
const SCRIPTS = ['shared.js', 'store.js', 'icons.js', 'mark.js', 'dialog.js', 'bridge.js', 'request.js', 'features/loader.js'];
const SLOT = { id: 's1', name: 'Demo Holding B.V.', number: '100001' };
const BETTER = { settings: { betterDesign: true, onePassword: false }, view: { activeSlotId: 's1', loggedIn: true, ready: [] }, slots: [SLOT] };
// Values from a page's realm, as plain data for deepEqual.
const plain = (value) => JSON.parse(JSON.stringify(value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Our own stand-in for a logo in the shape the parser looks for (an
// Illustrator-style file: class rules, a group transform, a crescent behind
// a navy disc, a white e on it and a wordmark beside it). Not e-Boekhouden's file.
const LOGO = `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 400 100">
  <style>.st0{fill:#8EA0D0;} .st1{fill:#30395F;} .st2{fill:#FFFFFF;}</style>
  <script>alert(1)</script>
  <g transform="translate(10 5)">
    <path class="st0" d="M40 0a45 45 0 1 0 0 90a45 45 0 1 0 0-90z"/>
    <circle class="st1" cx="50" cy="45" r="45" onclick="alert(2)"/>
    <path class="st2" d="M28 40H74V48H28Z M50 22C38 22 28 32 28 44H36C36 36 42 30 50 30S64 36 64 44H72C72 32 62 22 50 22Z M30 52C32 62 40 68 50 68C58 68 64 64 68 58L62 54C59 58 55 60 50 60C44 60 39 57 38 52Z"/>
  </g>
  <a xlink:href="javascript:alert(3)"><rect x="0" y="0" width="5" height="5" fill="#30395f"/></a>
  <g fill="#30395F"><path d="M130 30h20v40h-20z"/><circle cx="200" cy="50" r="10"/><path d="M230 30h60v40h-60z"/></g>
  <text x="300" y="60">e-Boekhouden.nl</text>
</svg>`;

// The e cut out of the disc (one compound path, even-odd).
const LOGO_HOLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">
  <path fill="#30395f" fill-rule="evenodd" d="M50 5A45 45 0 1 1 49.9 5Z M28 46H72V54H28Z M30 60H70V72H30Z"/>
  <path fill="#68ab32" d="M42 5A45 45 0 1 0 42 95A45 45 0 1 0 42 5Z" transform="translate(0 0)"/>
</svg>`;

function bh(options = {}) {
  const { store = BETTER, url = TOP, logo = LOGO, logoStatus = 200, html = FRAMESET } = options;
  const fetched = [];
  const p = page(html, {
    url,
    store: structuredClone(store),
    answer: (message) => (message.type === 'requests:slot' ? { ok: true, lease: `l${fetched.length}` } : {}),
  });
  p.window.fetch = async (input) => {
    fetched.push(String(input));
    if (logo instanceof Error) throw logo;
    return { status: logoStatus, ok: logoStatus < 400, redirected: false, headers: new Map(), text: async () => logo };
  };
  p.fetched = fetched;
  p.host = () => p.document.querySelector('ebs-loader');
  p.shadow = () => p.host()?.shadowRoot ?? null;
  p.box = () => p.shadow()?.querySelector('.ebs-loader') ?? null;
  return p;
}

function message(p, kind, { origin = SECURE20, source } = {}) {
  const from = source ?? p.document.querySelector('frame[name="mainframe"], iframe')?.contentWindow;
  p.window.dispatchEvent(new p.window.MessageEvent('message', { data: { ebsLoader: 1, kind }, origin, source: from }));
}

// ---------------------------------------------------------------------------
// The logo parser
// ---------------------------------------------------------------------------

test('the logo parser takes the disc, the crescent and the e, in the board\'s coordinates', () => {
  const p = page('<html><body></body></html>', { url: TOP });
  p.load('shared.js', 'features/loader.js');
  const mark = p.window.EBS.loader.markFromSvg(LOGO);
  assert.ok(mark, 'a usable mark');
  assert.equal(mark.disc.fill, '#30395f');
  assert.equal(mark.crescent.fill, '#8ea0d0');
  assert.equal(mark.e.length, 3, 'the three subpaths of the white e');
  assert.ok(mark.e.every((part) => part.fill === '#ffffff'));
  // The disc lands at 48,48 with radius 44: its transform maps the circle's
  // own bounds (5..95 inside the group) to 4..92.
  const m = /^matrix\(([^)]+)\)$/.exec(mark.disc.transform)[1].split(' ').map(Number);
  const map = ([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  assert.deepEqual(map([5, 0]).map(Math.round), [4, 4]);
  assert.deepEqual(map([95, 90]).map(Math.round), [92, 92]);
  assert.ok(mark.eBox.x > 4 && mark.eBox.x + mark.eBox.w < 92 && mark.eBox.y > 4 && mark.eBox.y + mark.eBox.h < 92, 'the e sits on the disc');
  // Only path data, matrices and plain colours come out.
  const text = JSON.stringify(mark);
  for (const bad of ['alert', 'href', 'url(', '<', 'script', 'onclick']) assert.ok(!text.includes(bad), bad);
  p.close();
});

test('an e cut out of the disc becomes a white e on a full disc', () => {
  const p = page('<html><body></body></html>', { url: TOP });
  p.load('shared.js', 'features/loader.js');
  const mark = p.window.EBS.loader.markFromSvg(LOGO_HOLE);
  assert.ok(mark);
  assert.equal(mark.disc.d.split('M').length - 1, 1, 'the disc is its outline only');
  assert.equal(mark.e.length, 2);
  assert.ok(mark.e.every((part) => part.fill === '#ffffff' && part.fillRule === 'evenodd'));
  assert.equal(mark.crescent.fill, '#68ab32');
  p.close();
});

test('anything that is not that mark is not used', () => {
  const p = page('<html><body></body></html>', { url: TOP });
  p.load('shared.js', 'features/loader.js');
  const { markFromSvg } = p.window.EBS.loader;
  for (const text of [
    '',
    '<html><body>Inloggen</body></html>',
    '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="100" height="40" fill="#30395f"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="#30395f"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="#30395f"/><circle cx="50" cy="50" r="2" fill="#fff"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="50" cy="50" r="40" fill="#30395f"',
    null,
    'x'.repeat(300_001),
  ]) {
    assert.equal(markFromSvg(text), null, String(text).slice(0, 60));
  }
  p.close();
});

test('a hostile file cannot freeze the page: long styles, open comments, endless parts', () => {
  const p = page('<html><body></body></html>', { url: TOP });
  p.load('shared.js', 'features/loader.js');
  const { markFromSvg } = p.window.EBS.loader;
  const svgWith = (inner) => `<svg xmlns="http://www.w3.org/2000/svg">${inner}<circle cx="50" cy="50" r="40" fill="#30395f"/></svg>`;
  for (const [label, text] of [
    ['a style without braces', svgWith(`<style>${'a'.repeat(290_000)}</style>`)],
    ['a style with one open brace', svgWith(`<style>.x{${'b'.repeat(290_000)}</style>`)],
    ['comments that never close', svgWith(`<style>${'/*'.repeat(140_000)}</style>`)],
    ['a path of 50,000 parts', svgWith(`<path fill="#ffffff" d="${'M50 50h1v1z'.repeat(25_000)}"/>`)],
    ['a long fill', svgWith(`<path fill="url(#${' '.repeat(250_000)}x" d="M0 0h1v1z"/>`)],
  ]) {
    const started = Date.now();
    assert.equal(markFromSvg(text), null, label);
    assert.ok(Date.now() - started < 1500, `${label}: ${Date.now() - started} ms`);
  }
  // Comments are still skipped in a normal style.
  assert.ok(markFromSvg(LOGO.replace('<style>', '<style>/* Illustrator */ ')));
  p.close();
});

test('path data is read the way SVG reads it', () => {
  const p = page('<html><body></body></html>', { url: TOP });
  p.load('shared.js', 'features/loader.js');
  const { subpathsOf, parseTransform } = p.window.EBS.loader;
  // Compact numbers, packed arc flags, an implicit lineto and a new subpath after Z.
  const subpaths = subpathsOf('M10 10l5.5.5a1 1 0 01 2 2zl1 1M0 0 5 5');
  assert.equal(subpaths.length, 3);
  assert.equal(subpaths[0].d, 'M10 10L15.5 10.5A1 1 0 0 1 17.5 12.5Z');
  assert.equal(subpaths[1].d, 'M10 10L11 11');
  assert.equal(subpaths[2].d, 'M0 0L5 5');
  assert.equal(subpathsOf('M0 0 L10'), null);
  assert.equal(subpathsOf('M0 0 X5 5'), null);
  assert.deepEqual(plain(parseTransform('translate(10 5) scale(2)')), [2, 0, 0, 2, 10, 5]);
  assert.deepEqual(plain(parseTransform('rotate(90 10 10)').map((value) => Math.round(value) + 0)), [0, 1, -1, 0, 20, 0]);
  assert.equal(parseTransform('translate(10 5) bogus(1)'), null);
  p.close();
});

// ---------------------------------------------------------------------------
// The top frame
// ---------------------------------------------------------------------------

test('Better design: the loader covers /bh/ with the logo, the administration and one logo request', async () => {
  const p = bh();
  p.load(...SCRIPTS);
  const host = p.host();
  assert.equal(host, null, 'nothing before the settings are read');
  await p.settle();
  assert.equal(p.host()?.parentElement, p.document.documentElement, 'on <html> itself, next to the frameset');
  assert.ok(p.document.querySelector('frameset'), 'the frameset stays');
  const shadow = p.shadow();
  assert.equal(p.box().getAttribute('role'), 'status');
  assert.equal(p.box().getAttribute('aria-label'), 'Administratie Demo Holding B.V. wordt geopend');
  assert.equal(shadow.querySelector('.ebs-name').textContent, 'Demo Holding B.V.');
  assert.equal(shadow.querySelector('.ebs-avatar').textContent, 'DH');
  assert.equal(shadow.querySelector('.ebs-brand').textContent, 'EB Sessions');
  // e-Boekhouden's own mark: paths, no drawn circles for disc and crescent.
  assert.equal(shadow.querySelector('circle.ebs-mark-cres'), null);
  assert.ok(shadow.querySelector('g.ebs-mark-cres > path'));
  // The shared mark (EBS.mark) at the board's size, on the loader's navy: no navy e first.
  const mark = shadow.querySelector('.ebs-content > .ebs-mark.ebs-mark-dark');
  assert.equal(mark.style.width, '220px');
  assert.equal(mark.querySelector('.ebs-mark-ink'), null);
  assert.equal(shadow.querySelectorAll('.ebs-mark-e > g.ebs-mark-white > path').length, 3);
  const maskId = shadow.querySelector('.ebs-mark-e mask').id;
  assert.equal(shadow.querySelector('.ebs-mark-e > g').getAttribute('mask'), `url(#${maskId})`, 'the mask draws the e');
  assert.equal(shadow.querySelectorAll('mask .ebs-mark-bar, mask .ebs-mark-bowl').length, 2);
  // The mark's styles are in the shadow root, next to the loader's own.
  assert.match(shadow.querySelector('style').textContent, /@keyframes ebsMarkBadgeIn/);
  // The parsed logo stays in this page's memory for its dialogs.
  assert.equal(p.window.EBS.mark.logo().e.length, 3);
  // The slow state is there, but hidden and out of the tab order.
  assert.equal(shadow.querySelector('.ebs-slow').getAttribute('aria-hidden'), 'true');
  assert.equal(shadow.querySelector('.ebs-link').tabIndex, -1);
  // One request: the logo, through the request layer's budget.
  assert.deepEqual(p.fetched, ['https://secure.e-boekhouden.nl/images/Logo-EB_blauwopwit.svg']);
  assert.equal(p.sent.filter((sent) => sent.type === 'requests:slot').length, 1);
  await sleep(800);
  assert.equal(shadow.querySelector('.ebs-mark-e > g').getAttribute('mask'), null, 'the mask goes once the e is drawn');
  p.close();
});

test('the avatar comes from the active slot', async () => {
  const p = bh({ store: { ...BETTER, 'avatar:s1': 'data:image/webp;base64,UklGRg==' } });
  p.load(...SCRIPTS);
  await p.settle();
  const img = p.shadow().querySelector('.ebs-avatar img');
  assert.equal(img?.getAttribute('src'), 'data:image/webp;base64,UklGRg==');
  p.close();
});

test('without an active slot the row stays reserved but empty', async () => {
  const p = bh({ store: { settings: { betterDesign: true }, view: { activeSlotId: null, loggedIn: false } } });
  p.load(...SCRIPTS);
  await p.settle();
  assert.ok(p.shadow().querySelector('.ebs-who').classList.contains('empty'));
  assert.equal(p.box().getAttribute('aria-label'), 'e-Boekhouden wordt geopend');
  p.close();
});

for (const [label, options] of [['a failed request', { logo: new Error('offline') }], ['an HTTP error', { logoStatus: 404 }], ['a file that is not the mark', { logo: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="9" height="9"/></svg>' }]]) {
  test(`after ${label} the loader draws its own mark`, async () => {
    const p = bh(options);
    p.load(...SCRIPTS);
    await p.settle();
    const shadow = p.shadow();
    assert.ok(shadow.querySelector('circle.ebs-mark-cres'), 'the board\'s crescent');
    assert.ok(shadow.querySelector('.ebs-mark-white > path.ebs-mark-bar') && shadow.querySelector('.ebs-mark-white > path.ebs-mark-bowl'), 'the board\'s e');
    assert.equal(p.window.EBS.mark.logo(), null, 'nothing kept for the dialogs');
    assert.equal(shadow.querySelector('mask'), null);
    assert.equal(p.fetched.length, 1, 'never asked twice');
    p.close();
  });
}

test('the app frame being ready fades the loader out (240 ms) and removes it', async () => {
  const p = bh();
  p.load(...SCRIPTS);
  await p.settle();
  message(p, 'already');
  await p.settle();
  assert.ok(p.host(), '"reeds ingelogd" keeps the loader: the app is coming');
  message(p, 'app');
  assert.ok(p.box().classList.contains('ebs-out-app'));
  assert.ok(p.box().classList.contains('leaving'));
  assert.equal(p.host().style.getPropertyValue('pointer-events'), 'none', 'clicks reach the page while it fades');
  await sleep(320);
  assert.equal(p.host(), null);
  p.close();
});

test('a message from another site, or of another shape, is ignored', async () => {
  const p = bh();
  p.load(...SCRIPTS);
  await p.settle();
  message(p, 'app', { origin: 'https://evil.example' });
  message(p, 'whatever');
  p.window.dispatchEvent(new p.window.MessageEvent('message', { data: { action: 'v2Loaded' }, origin: SECURE20, source: p.document.querySelector('frame').contentWindow }));
  await p.settle();
  assert.ok(p.host());
  assert.ok(!p.box().classList.contains('leaving'));
  p.close();
});

test('a real login form: the loader fades out in 180 ms and the login frame is told to raise its card', async () => {
  const p = bh();
  p.load(...SCRIPTS);
  await p.settle();
  const frame = p.document.querySelector('frame[name="mainframe"]').contentWindow;
  const replies = [];
  frame.postMessage = (data, origin) => replies.push({ data, origin });
  message(p, 'login', { origin: 'https://secure.e-boekhouden.nl', source: frame });
  assert.ok(p.box().classList.contains('ebs-out-login'));
  assert.deepEqual(plain(replies), [{ data: { ebsLoader: 1, kind: 'rise' }, origin: 'https://secure.e-boekhouden.nl' }]);
  await sleep(260);
  assert.equal(p.host(), null);
  p.close();
});

test('with the 1Password swap on, a form inside e-Boekhouden\'s frameset waits for the swapped login iframe', async () => {
  const p = bh({ store: { ...BETTER, settings: { betterDesign: true, onePassword: true } } });
  p.load(...SCRIPTS);
  await p.settle();
  message(p, 'login', { origin: 'https://secure.e-boekhouden.nl' });
  await p.settle();
  assert.ok(p.host() && !p.box().classList.contains('leaving'), 'not yet: login-breakout.js swaps the frameset');
  // login-breakout.js swaps the frameset for its body with the login iframe.
  const body = p.document.createElement('body');
  body.id = 'ebs-login-host';
  const iframe = p.document.createElement('iframe');
  iframe.id = 'mainframe';
  iframe.name = 'mainframe';
  body.append(iframe);
  p.document.querySelector('frameset').replaceWith(body);
  assert.ok(p.host()?.isConnected, 'the swap leaves the loader alone');
  message(p, 'login', { origin: 'https://secure.e-boekhouden.nl', source: iframe.contentWindow });
  assert.ok(p.box().classList.contains('ebs-out-login'));
  p.close();
});

test('with the swap on but no swap coming, the form is shown after 1.5 s at most', async () => {
  const p = bh({ store: { ...BETTER, settings: { betterDesign: true, onePassword: true } } });
  p.load(...SCRIPTS);
  await p.settle();
  message(p, 'login', { origin: 'https://secure.e-boekhouden.nl' });
  await sleep(1600);
  assert.ok(!p.host() || p.box().classList.contains('ebs-out-login'));
  p.close();
});

test('a navigation while the loader shows hands over: the next /bh/ continues at once, already drawn', async () => {
  const first = bh();
  first.load(...SCRIPTS);
  await first.settle();
  message(first, 'already');
  first.window.dispatchEvent(new first.window.Event('pagehide'));
  const stored = JSON.parse(first.window.sessionStorage.getItem('ebs-loader'));
  assert.equal(stored.mode, 'better');
  assert.ok(Date.now() - stored.at < 2000);
  first.close();

  const next = bh({ url: APP_ENTRY });
  next.window.sessionStorage.setItem('ebs-loader', JSON.stringify(stored));
  next.load(...SCRIPTS);
  assert.ok(next.host(), 'covered before the settings are read');
  assert.equal(next.window.sessionStorage.getItem('ebs-loader'), null, 'used once');
  await next.settle();
  assert.ok(next.box().classList.contains('is-settled'), 'no second entry');
  assert.ok(next.shadow().querySelector('.ebs-mark').classList.contains('is-settled'), 'the mark is complete and breathes on');
  assert.equal(next.shadow().querySelector('mask'), null);
  assert.equal(next.fetched.length, 1);
  next.close();
});

test('a continued loader that a frame ends before the settings are read stays gone, also when the design changed', async () => {
  const p = bh();
  p.window.chrome.storage.local.get = ((get) => async (keys) => {
    await sleep(40);
    return get(keys);
  })(p.window.chrome.storage.local.get);
  p.window.sessionStorage.setItem('ebs-loader', JSON.stringify({ at: Date.now() - 500, mode: 'classic' }));
  p.load(...SCRIPTS);
  assert.ok(p.host(), 'the classic cover continues at once');
  message(p, 'app');
  await sleep(400);
  await p.settle();
  assert.equal(p.host(), null, 'no second cover that nothing takes away');
  assert.deepEqual(p.fetched, [], 'and no logo request for it');
  p.close();
});

test('back from the back/forward cache: the loader goes and its hand-over with it', async () => {
  const p = bh();
  p.load(...SCRIPTS);
  await p.settle();
  p.window.dispatchEvent(new p.window.Event('pagehide'));
  assert.ok(p.window.sessionStorage.getItem('ebs-loader'));
  p.window.dispatchEvent(Object.assign(new p.window.Event('pageshow'), { persisted: true }));
  assert.equal(p.window.sessionStorage.getItem('ebs-loader'), null);
  assert.ok(p.box().classList.contains('leaving'));
  await sleep(320);
  assert.equal(p.host(), null);
  p.close();
});

test('a stale or broken hand-over is not used', async () => {
  for (const value of [JSON.stringify({ at: Date.now() - 9000, mode: 'better' }), JSON.stringify({ at: Date.now(), mode: 'party' }), '{nope']) {
    const p = bh({ store: { settings: { betterDesign: false }, view: { loggedIn: false } } });
    p.window.sessionStorage.setItem('ebs-loader', value);
    p.load(...SCRIPTS);
    assert.equal(p.host(), null, value);
    p.close();
  }
});

test('after 3 seconds: "Bezig met laden…" and "Pagina nu tonen", which shows the page at once', async () => {
  const p = bh();
  p.window.sessionStorage.setItem('ebs-loader', JSON.stringify({ at: Date.now() - 3100, mode: 'better' }));
  p.load(...SCRIPTS);
  await p.settle();
  const shadow = p.shadow();
  assert.ok(p.box().classList.contains('is-slow'));
  assert.equal(p.box().getAttribute('aria-label'), 'Bezig met laden');
  assert.equal(shadow.querySelector('.ebs-slow-text').textContent, 'Bezig met laden…');
  const button = shadow.querySelector('.ebs-link');
  assert.equal(button.textContent, 'Pagina nu tonen');
  assert.equal(button.tabIndex, 0);
  assert.equal(shadow.querySelector('.ebs-slow').getAttribute('aria-hidden'), null);
  button.click();
  assert.ok(p.box().classList.contains('ebs-out-app'));
  await sleep(320);
  assert.equal(p.host(), null);
  p.close();
});

test('the slow state comes on its own at 3 seconds', async () => {
  const p = bh();
  p.window.sessionStorage.setItem('ebs-loader', JSON.stringify({ at: Date.now() - 2850, mode: 'better' }));
  p.load(...SCRIPTS);
  await p.settle();
  assert.ok(!p.box().classList.contains('is-slow'));
  await sleep(250);
  assert.ok(p.box().classList.contains('is-slow'));
  p.close();
});

test('after 8 seconds the page is always shown', async () => {
  const p = bh();
  p.window.sessionStorage.setItem('ebs-loader', JSON.stringify({ at: Date.now() - 7900, mode: 'better' }));
  p.load(...SCRIPTS);
  await sleep(500);
  assert.equal(p.host(), null);
  p.close();
});

test('switching Better design off while the loader shows shows the page', async () => {
  const p = bh();
  p.load(...SCRIPTS);
  await p.settle();
  await p.window.chrome.storage.local.set({ settings: { betterDesign: false } });
  assert.ok(p.box().classList.contains('leaving'));
  p.close();
});

test('classic design, logged out: nothing changes and nothing is requested', async () => {
  const p = bh({ store: { settings: { betterDesign: false }, view: { activeSlotId: 's1', loggedIn: false }, slots: [SLOT] } });
  p.load(...SCRIPTS);
  await p.settle();
  assert.equal(p.host(), null);
  assert.deepEqual(p.fetched, []);
  assert.deepEqual(p.sent, []);
  p.close();
});

test('classic design, logged in: only a neutral cover, gone with the app or after 3 seconds', async () => {
  const p = bh({ store: { settings: { betterDesign: false }, view: { activeSlotId: 's1', loggedIn: true }, slots: [SLOT] } });
  p.load(...SCRIPTS);
  await p.settle();
  assert.ok(p.box().classList.contains('classic'));
  assert.equal(p.shadow().querySelector('svg, .ebs-content, .ebs-brand'), null, 'no loader content');
  assert.deepEqual(p.fetched, [], 'no logo request');
  message(p, 'app');
  assert.ok(p.box().classList.contains('ebs-out-plain'));
  await sleep(230);
  assert.equal(p.host(), null);
  p.close();

  const slow = bh({ store: { settings: { betterDesign: false }, view: { loggedIn: true } } });
  slow.window.sessionStorage.setItem('ebs-loader', JSON.stringify({ at: Date.now() - 2900, mode: 'classic' }));
  slow.load(...SCRIPTS);
  await sleep(400);
  assert.equal(slow.host(), null);
  slow.close();
});

test('a frame that already reported before the settings were read keeps the loader away', async () => {
  const p = bh({ store: BETTER });
  p.window.chrome.storage.local.get = ((get) => async (keys) => {
    await sleep(30);
    return get(keys);
  })(p.window.chrome.storage.local.get);
  p.load(...SCRIPTS);
  message(p, 'login', { origin: 'https://secure.e-boekhouden.nl' });
  await sleep(80);
  await p.settle();
  assert.equal(p.host(), null);
  assert.deepEqual(p.fetched, []);
  p.close();
});

for (const url of ['https://secure.e-boekhouden.nl/bh/overzicht.asp', `${SECURE20}/v1login`, 'https://secure20.e-boekhouden.nl/bh/']) {
  test(`no loader on ${url}`, async () => {
    const p = bh({ url, html: '<html><head></head><body><p>x</p></body></html>' });
    p.load(...SCRIPTS);
    await p.settle();
    assert.equal(p.host(), null);
    assert.deepEqual(p.fetched, []);
    p.close();
  });
}

// ---------------------------------------------------------------------------
// The frames
// ---------------------------------------------------------------------------

const FORM = '<html><head></head><body><form id="frm"><input id="txtEmail"><input type="password" id="txtWachtwoord"><input type="submit" value="Inloggen"></form></body></html>';
const ALREADY = '<html><head></head><body><p>U bent reeds ingelogd.</p><form id="frm"><input id="txtEmail"></form></body></html>';

async function loginFrame(html, { better = false } = {}) {
  const p = await framedPage(html, { url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', parentUrl: TOP });
  const top = p.window.parent;
  const received = [];
  top.addEventListener('message', (event) => received.push(event.data));
  if (better) {
    // login-page.js lays the form out a moment later.
    setTimeout(() => {
      const page = p.document.createElement('div');
      page.id = 'ebs-better';
      page.innerHTML = '<main class="ebs-main"></main>';
      p.document.body.append(page);
    }, 40);
  }
  p.load('shared.js', 'features/loader.js');
  return { p, top, received };
}

test('the login frame reports a real form once login-page.js laid it out', async () => {
  const { p, received } = await loginFrame(FORM, { better: true });
  await sleep(20);
  assert.deepEqual(received, [], 'not before the layout');
  await sleep(80);
  await p.settle();
  assert.deepEqual(plain(received), [{ ebsLoader: 1, kind: 'login' }]);
  p.close();
});

test('the login frame does not hold a form back longer than 500 ms', async () => {
  const { p, received } = await loginFrame(FORM);
  await sleep(300);
  assert.deepEqual(received, []);
  await sleep(300);
  assert.deepEqual(plain(received), [{ ebsLoader: 1, kind: 'login' }]);
  p.close();
});

test('"U bent reeds ingelogd" is reported as such', async () => {
  const { p, received } = await loginFrame(ALREADY);
  await p.settle();
  assert.deepEqual(plain(received), [{ ebsLoader: 1, kind: 'already' }]);
  p.close();
});

test('the top frame\'s answer raises the card of the Better login page', async () => {
  const { p, top } = await loginFrame(FORM, { better: true });
  await sleep(100);
  p.window.dispatchEvent(new p.window.MessageEvent('message', { data: { ebsLoader: 1, kind: 'rise' }, origin: 'https://secure.e-boekhouden.nl', source: top }));
  assert.ok(p.document.documentElement.classList.contains('ebs-loader-rise'));
  assert.match(p.document.head.lastElementChild.textContent, /translateY\(8px\)[\s\S]*240ms/);
  assert.match(p.document.head.lastElementChild.textContent, /prefers-reduced-motion[\s\S]*150ms/);
  await sleep(340);
  assert.ok(!p.document.documentElement.classList.contains('ebs-loader-rise'), 'no animation stays on the form');
  assert.equal([...p.document.querySelectorAll('style')].some((style) => style.textContent.includes('ebsLoaderCardIn')), false);
  p.close();
});

test('a "rise" from anywhere but the top frame on our origin is ignored', async () => {
  const { p } = await loginFrame(FORM, { better: true });
  await sleep(100);
  p.window.dispatchEvent(new p.window.MessageEvent('message', { data: { ebsLoader: 1, kind: 'rise' }, origin: 'https://secure.e-boekhouden.nl', source: p.window }));
  assert.ok(!p.document.documentElement.classList.contains('ebs-loader-rise'));
  p.window.dispatchEvent(new p.window.MessageEvent('message', { data: { ebsLoader: 1, kind: 'rise' }, origin: 'https://evil.example', source: p.window.parent }));
  assert.ok(!p.document.documentElement.classList.contains('ebs-loader-rise'), 'nor from another origin');
  p.close();
});

test('the login frame stays silent outside the /bh/ frameset', async () => {
  const p = await framedPage(FORM, { url: 'https://secure.e-boekhouden.nl/bh/inloggen.asp', parentUrl: 'https://secure.e-boekhouden.nl/bh/overzicht.asp' });
  const received = [];
  p.window.parent.addEventListener('message', (event) => received.push(event.data));
  p.load('shared.js', 'features/loader.js');
  await sleep(600);
  assert.deepEqual(received, []);
  p.close();
});
