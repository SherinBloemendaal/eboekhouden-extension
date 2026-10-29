// EB Sessions: the animated e-Boekhouden mark, as EBS.mark.
//
// One mark for every loading state: the full-screen loader (features/loader.js)
// and every dialog that waits for its page (dialog.js, features/popups.js).
// As on the board (Loader.dc.html), one gesture of about 1.2 s:
//   1. the e draws: the crossbar first (it sticks out left over the bowl),
//      then the bowl
//   2. the navy disc grows from behind the e, with a small spring
//   3. the light crescent slides out on the left and settles
//   4. from 1.25 s the mark breathes, with a gleam over the disc
//
//   const { node } = EBS.mark.create({ size: 120, tone: 'light' });
//   const slot = EBS.mark.slot({ size: 120, motion: 'entry' });  // for covers
//   slot.start(); ... slot.stop();
//
// create(options) returns { node, done }:
//   size     the box in px (default 220); the disc is half of it, the rest
//            is room for the glow
//   tone     'dark' on the loader's navy, 'light' on a white panel: there the
//            e draws in navy (a white e on white would not show) and turns
//            white while the disc grows behind it (a fade, opacity only)
//   motion   'entry' (default) the whole gesture; 'settled' complete at once
//            and breathing (a loader that continues); 'still' complete and
//            without any motion (classic design). With prefers-reduced-motion
//            every mark is still: only the covers around it fade
//   logo     e-Boekhouden's own mark as parsed by the loader, or nothing for
//            our drawn one (the board's). Only the loader's top /bh/ frame
//            reads the logo; the dialogs live in the app's frames (another
//            document, another origin), so they show the drawn mark and
//            never request the logo themselves
//   elapsed  how far the entry already ran, in ms (a loader that continues
//            the mark of the previous document). The e's mask only stays
//            for what is left of the drawing; the caller seeks the mark's
//            CSS animations to the same point once it is in the page
// done() lifts the mask that draws e-Boekhouden's e; it runs by itself once
// the e is drawn.
//
// The styles are `css`: the loader puts them in its shadow root,
// injectStyle(document) puts them in a page once (slot does that itself).

(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const { EBS } = root;
  if (!EBS || EBS.mark) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const STYLE_ID = 'ebs-mark-style';
  // The e is drawn after 150 + 580 ms; the mask goes a moment later.
  const E_DRAWN_MS = 760;
  // The covers around a mark fade in this time; a stopped mark goes after it.
  const FADE_MS = 150;
  const NAVY = '#232c4f';

  // The board's e: crossbar (sticking out left over the bowl) and bowl.
  const E_BAR = 'M19 48H71';
  const E_BOWL = 'M67 48A18 18 0 1 0 62.79 59.57';
  // Its bounds with the stroke: x 19..71, y 48 - 22.25 .. 48 + 22.25.
  const E_BOX = { x: 19, y: 25.75, w: 52, h: 44.5 };
  const E_STROKE = 8.5;

  const round = (value) => Math.round(value * 1000) / 1000;
  let serial = 0;

  function reducedMotion() {
    try {
      return Boolean(root.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  }

  function svg(tag, attributes = {}, children = []) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    node.append(...children);
    return node;
  }

  // The disc layer: halo, crescent, disc, rim and gleam. As on the board,
  // with e-Boekhouden's own crescent and disc when `logo` has them.
  function badgeSvg(logo, ids, size) {
    const defs = svg('defs', {}, [
      svg('radialGradient', { id: ids.halo, cx: '50%', cy: '50%', r: '50%' }, [
        svg('stop', { offset: 0, 'stop-color': '#8ea0d0', 'stop-opacity': 0.22 }),
        svg('stop', { offset: 0.55, 'stop-color': '#8ea0d0', 'stop-opacity': 0.06 }),
        svg('stop', { offset: 1, 'stop-color': '#8ea0d0', 'stop-opacity': 0 }),
      ]),
      svg('linearGradient', { id: ids.crescent, x1: 0, y1: 0, x2: 0, y2: 1 }, [
        svg('stop', { offset: 0, 'stop-color': '#a9b6e0' }),
        svg('stop', { offset: 1, 'stop-color': '#8ea0d0' }),
      ]),
      svg('linearGradient', { id: ids.disc, x1: 0.15, y1: 0.1, x2: 0.85, y2: 0.95 }, [
        svg('stop', { offset: 0, 'stop-color': '#30395f' }),
        svg('stop', { offset: 1, 'stop-color': NAVY }),
      ]),
      svg('linearGradient', { id: ids.sheen, x1: 0, y1: 0, x2: 1, y2: 0 }, [
        svg('stop', { offset: 0, 'stop-color': '#ffffff', 'stop-opacity': 0 }),
        svg('stop', { offset: 0.5, 'stop-color': '#ffffff', 'stop-opacity': 0.16 }),
        svg('stop', { offset: 1, 'stop-color': '#ffffff', 'stop-opacity': 0 }),
      ]),
      svg('clipPath', { id: ids.clip }, [svg('circle', { cx: 48, cy: 48, r: 44 })]),
    ]);
    const shape = (part) => svg('path', { d: part.d, transform: part.transform, fill: part.fill, 'fill-rule': part.fillRule });
    const layers = [svg('circle', { class: 'ebs-mark-halo', cx: 48, cy: 48, r: 86, fill: `url(#${ids.halo})` })];
    if (!logo) {
      layers.push(
        svg('circle', { class: 'ebs-mark-cres', cx: 40, cy: 48, r: 43, fill: `url(#${ids.crescent})` }),
        svg('circle', { cx: 48, cy: 48, r: 44, fill: `url(#${ids.disc})`, stroke: '#ffffff', 'stroke-opacity': 0.1, 'stroke-width': 1 }),
      );
    } else {
      if (logo.crescent) layers.push(svg('g', { class: 'ebs-mark-cres' }, [shape(logo.crescent)]));
      layers.push(shape(logo.disc), svg('circle', { cx: 48, cy: 48, r: 44, fill: 'none', stroke: '#ffffff', 'stroke-opacity': 0.1, 'stroke-width': 1 }));
    }
    layers.push(svg('g', { 'clip-path': `url(#${ids.clip})` }, [
      svg('g', { transform: 'rotate(20 48 48)' }, [svg('rect', { class: 'ebs-mark-sheen', x: -34, y: -30, width: 30, height: 156, fill: `url(#${ids.sheen})` })]),
    ]));
    return svg('svg', { class: 'ebs-mark-svg', width: size, height: size, viewBox: '-40 -40 176 176', 'aria-hidden': 'true', focusable: 'false' }, [defs, ...layers]);
  }

  // The e layer. Ours is drawn as two strokes. e-Boekhouden's is a filled
  // glyph: the same two strokes, wide and fitted to its bounds, draw a mask
  // that uncovers it, and the mask goes once the e is complete, so the end
  // result is exactly their glyph. On a light panel a navy copy draws first
  // and gives way to the white one as the disc comes up behind it.
  function eSvg(logo, ids, { size, light, masked }) {
    const strokes = (width, color) => [
      svg('path', { class: 'ebs-mark-bowl', d: E_BOWL, pathLength: 100, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'butt' }),
      svg('path', { class: 'ebs-mark-bar', d: E_BAR, pathLength: 100, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'butt' }),
    ];
    const glyph = (fill) => (logo.e.map((part) => svg('path', { d: part.d, transform: part.transform, fill: fill ?? part.fill, 'fill-rule': part.fillRule })));
    const node = svg('svg', { class: 'ebs-mark-svg ebs-mark-e', width: size, height: size, viewBox: '-40 -40 176 176', 'aria-hidden': 'true', focusable: 'false' });
    const layers = [];
    if (light) layers.push(svg('g', { class: 'ebs-mark-ink' }, logo ? glyph(NAVY) : strokes(E_STROKE, NAVY)));
    layers.push(svg('g', { class: 'ebs-mark-white' }, logo ? glyph() : strokes(E_STROKE, '#ffffff')));
    node.append(...layers);
    if (!logo || !masked) return { node, done: () => {} };
    const sx = logo.eBox.w / E_BOX.w;
    const sy = logo.eBox.h / E_BOX.h;
    const fit = `matrix(${round(sx)} 0 0 ${round(sy)} ${round(logo.eBox.x - E_BOX.x * sx)} ${round(logo.eBox.y - E_BOX.y * sy)})`;
    const mask = svg('mask', { id: ids.mask, maskUnits: 'userSpaceOnUse', x: -40, y: -40, width: 176, height: 176 }, [
      svg('g', { transform: fit }, strokes(E_STROKE * 2.2, '#ffffff')),
    ]);
    node.prepend(svg('defs', {}, [mask]));
    for (const layer of layers) layer.setAttribute('mask', `url(#${ids.mask})`);
    return { node, done: () => layers.forEach((layer) => layer.removeAttribute('mask')) };
  }

  function create({ size = 220, tone = 'dark', motion = 'entry', logo, elapsed = 0 } = {}) {
    serial += 1;
    const id = (name) => `ebs-mark-${serial}-${name}`;
    const ids = { halo: id('halo'), crescent: id('crescent'), disc: id('disc'), sheen: id('sheen'), clip: id('clip'), mask: id('e') };
    const parts = logo ?? null;
    const box = Math.max(16, Math.round(Number(size) || 220));
    const light = tone === 'light';
    const state = ['entry', 'settled', 'still'].includes(motion) ? motion : 'entry';

    const node = document.createElement('div');
    node.className = `ebs-mark ebs-mark-${light ? 'light' : 'dark'}${state === 'entry' ? '' : ` is-${state}`}`;
    node.setAttribute('aria-hidden', 'true');
    node.style.width = `${box}px`;
    node.style.height = `${box}px`;
    const badge = document.createElement('div');
    badge.className = 'ebs-mark-badge';
    badge.append(badgeSvg(parts, ids, box));
    const ran = Math.max(0, Number(elapsed) || 0);
    const drawing = state === 'entry' && ran < E_DRAWN_MS;
    const e = eSvg(parts, ids, { size: box, light, masked: drawing && !reducedMotion() });
    node.append(badge, e.node);
    if (parts && drawing) setTimeout(e.done, E_DRAWN_MS - ran);
    return { node, done: e.done };
  }

  // A place for a mark in a loading cover. It keeps its size, so the text
  // under it never moves. start() puts a new mark in (its entry plays from
  // the start) unless one is there; stop() takes it out once the cover has
  // faded, so no loop keeps running behind a page. motion may be a function:
  // it is asked at every start() (a setting that changed meanwhile).
  function slot({ size = 120, tone = 'light', motion = 'entry' } = {}) {
    injectStyle(document);
    const node = document.createElement('div');
    node.className = 'ebs-mark-slot';
    node.setAttribute('aria-hidden', 'true');
    const box = Math.max(16, Math.round(Number(size) || 120));
    node.style.width = `${box}px`;
    node.style.height = `${box}px`;
    let current = null;
    let leaving = null;
    let timer = null;
    const drop = () => {
      clearTimeout(timer);
      timer = null;
      leaving?.remove();
      leaving = null;
    };
    return {
      node,
      get running() {
        return Boolean(current);
      },
      start() {
        if (current) return;
        drop();
        current = create({ size: box, tone, motion: typeof motion === 'function' ? motion() : motion }).node;
        node.append(current);
      },
      stop({ immediate = false } = {}) {
        if (!current) return;
        drop();
        leaving = current;
        current = null;
        if (immediate) drop();
        else timer = setTimeout(drop, FADE_MS + 60);
      },
    };
  }

  const css = `
    .ebs-mark { position: relative; display: block; flex: none; box-sizing: content-box; padding: 0; margin: 0; }
    .ebs-mark .ebs-mark-badge { position: absolute; inset: 0; }
    .ebs-mark .ebs-mark-svg { position: absolute; inset: 0; display: block; width: 100%; height: 100%; overflow: visible; }
    .ebs-mark-slot { position: relative; display: block; flex: none; }

    @keyframes ebsMarkDraw { to { stroke-dashoffset: 0; } }
    @keyframes ebsMarkBadgeIn { 0% { transform: scale(.2); animation-timing-function: cubic-bezier(0.23,1,0.32,1); } 72% { transform: scale(1.035); animation-timing-function: ease-in-out; } 100% { transform: scale(1); } }
    @keyframes ebsMarkCresOut { 0% { transform: translateX(8px) scale(.96); animation-timing-function: cubic-bezier(0.23,1,0.32,1); } 65% { transform: translateX(-1.2px) scale(1.01); animation-timing-function: ease-in-out; } 100% { transform: none; } }
    @keyframes ebsMarkBreathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(.98); } }
    @keyframes ebsMarkHalo { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
    @keyframes ebsMarkSheen { 0% { opacity: 0; transform: translateX(0); } 6% { opacity: 1; } 32% { opacity: 0; transform: translateX(150px); } 100% { opacity: 0; transform: translateX(150px); } }
    @keyframes ebsMarkInkIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes ebsMarkInkOut { from { opacity: 1; } to { opacity: 0; } }

    /* Entry, one gesture of about 1.2 s: the e (crossbar, then bowl), the disc, the crescent. */
    .ebs-mark .ebs-mark-bar { stroke-dasharray: 100 110; stroke-dashoffset: 80; animation: ebsMarkDraw 320ms cubic-bezier(0.23,1,0.32,1) both; }
    .ebs-mark .ebs-mark-bowl { stroke-dasharray: 100 110; stroke-dashoffset: 101; animation: ebsMarkDraw 580ms cubic-bezier(0.23,1,0.32,1) 150ms both; }
    .ebs-mark .ebs-mark-badge { transform: scale(0); animation: ebsMarkBadgeIn 520ms linear 340ms forwards; }
    .ebs-mark .ebs-mark-cres { transform-box: fill-box; transform-origin: center; animation: ebsMarkCresOut 560ms linear 640ms both; }
    /* On a light panel: the navy e gives way to the white one while the disc grows behind it. */
    .ebs-mark .ebs-mark-ink { animation: ebsMarkInkOut 200ms ease-out 380ms both; }
    .ebs-mark-light .ebs-mark-white { animation: ebsMarkInkIn 200ms ease-out 380ms both; }
    /* Idle loop from 1250 ms: breathing, glow and a gleam over the disc, one 2.8 s rhythm. */
    .ebs-mark { animation: ebsMarkBreathe 2800ms ease-in-out 1250ms infinite; }
    .ebs-mark .ebs-mark-halo { animation: ebsMarkHalo 2800ms ease-in-out 1250ms infinite; }
    .ebs-mark .ebs-mark-sheen { opacity: 0; animation: ebsMarkSheen 2800ms ease-in-out 1250ms infinite both; }

    /* Settled (a loader that continues): complete at once, and it breathes on. */
    .ebs-mark.is-settled .ebs-mark-bar, .ebs-mark.is-settled .ebs-mark-bowl { animation: none; stroke-dashoffset: 0; }
    .ebs-mark.is-settled .ebs-mark-badge { animation: none; transform: none; }
    .ebs-mark.is-settled .ebs-mark-cres { animation: none; }
    .ebs-mark.is-settled .ebs-mark-ink { animation: none; opacity: 0; }
    .ebs-mark.is-settled .ebs-mark-white { animation: none; opacity: 1; }
    .ebs-mark.is-settled, .ebs-mark.is-settled .ebs-mark-halo { animation-delay: 0ms; }
    .ebs-mark.is-settled .ebs-mark-sheen { animation-delay: 400ms; }

    /* Still (classic design), and less motion for every mark: complete, nothing moves. */
    .ebs-mark.is-still, .ebs-mark.is-still .ebs-mark-halo, .ebs-mark.is-still .ebs-mark-cres { animation: none; }
    .ebs-mark.is-still .ebs-mark-bar, .ebs-mark.is-still .ebs-mark-bowl { animation: none; stroke-dashoffset: 0; }
    .ebs-mark.is-still .ebs-mark-badge { animation: none; transform: none; }
    .ebs-mark.is-still .ebs-mark-ink { animation: none; opacity: 0; }
    .ebs-mark.is-still .ebs-mark-white { animation: none; opacity: 1; }
    .ebs-mark.is-still .ebs-mark-sheen { animation: none; opacity: 0; }
    @media (prefers-reduced-motion: reduce) {
      .ebs-mark, .ebs-mark .ebs-mark-halo, .ebs-mark .ebs-mark-cres { animation: none; }
      .ebs-mark .ebs-mark-bar, .ebs-mark .ebs-mark-bowl { animation: none; stroke-dashoffset: 0; }
      .ebs-mark .ebs-mark-badge { animation: none; transform: none; }
      .ebs-mark .ebs-mark-ink { animation: none; opacity: 0; }
      .ebs-mark .ebs-mark-white { animation: none; opacity: 1; }
      .ebs-mark .ebs-mark-sheen { animation: none; opacity: 0; }
    }
  `;

  function injectStyle(doc = document) {
    if (!doc || doc.getElementById?.(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = css;
    (doc.head ?? doc.documentElement).append(style);
  }

  EBS.define('mark', Object.freeze({
    create,
    slot,
    css,
    injectStyle,
    reducedMotion,
  }));
})();
