// EB Sessions: the loader shown while e-Boekhouden opens /bh/. Setting: betterDesign.
//
// The problem: refreshing /bh/ with a valid session first shows the login
// screen ("U bent reeds ingelogd" with a form under it), then the app. With
// Better design on, a full-screen loader covers the page from document_start
// until the extension knows what comes: the app, or a real login form.
//
// Where it paints. The top /bh/ document is a <frameset> without a <body>,
// and login-breakout.js may swap that frameset for a body with an iframe at
// DOMContentLoaded. The loader is one element appended to <html> itself, next
// to <head> and the frameset: a fixed element there paints over every frame
// (checked in Chrome 152), and the swap, which only replaces the frameset,
// leaves it alone. Its content sits in a shadow root, out of reach of the
// page's styles.
//
// How it decides. Only frames know what they show, so they report to the top
// frame with postMessage ({ ebsLoader: 1, kind }):
//   inloggen.asp  'login' for a real form (once login-page.js laid it out, at
//                 most LOGIN_LAYOUT_WAIT_MS later), 'already' for "U bent
//                 reeds ingelogd" (e-Boekhouden or the service worker moves on
//                 into the app from there; the loader stays)
//   secure20      'app' once the app's header is rendered in mainframe,
//                 'other' for e-Boekhouden's own session-expired screens
// A message only hides the loader (or keeps it), so one forged by a page
// script can do no more than that. The top URL alone cannot decide: /bh/
// without `v2Url` may still hold a valid session ("reeds ingelogd"), and
// /bh?v2Url= (e-Boekhouden's own entry into the app) shows a login form when
// the session turned out to be gone. So both wait for the frames; the
// loggedIn view state is the hint for the classic cover (below).
//
// Exits, as on the board (Loader.dc.html):
//   app       fade out in 240 ms while the content settles to scale .97
//   login     fade out in 180 ms; the login card rises 8 px over 240 ms
//   3 s       "Bezig met laden…" with "Pagina nu tonen" (shows the page at once)
//   8 s       always shown, whatever happens
// When /bh/ hands over to /bh?v2Url= (a full navigation), the next document
// continues the same loader through sessionStorage: same start time, so the
// 3 and 8 seconds count from the first document, and a mark that is already
// drawn instead of a second entry.
//
// The logo is e-Boekhouden's own (/images/Logo-EB_blauwopwit.svg), fetched
// with one bulk GET of EBS.request per page and split into its parts (disc,
// crescent, e) so the mark can be built up as on the board. Anything that
// does not look like that mark falls back to our own drawn one, the board's.
// The file itself is never stored or shipped.
//
// Classic design: no loader. When the view state says a session is logged
// in, a plain neutral cover in e-Boekhouden's own background colour hides
// the login flash, for at most CLASSIC_CAP_MS.

(() => {
  if (window.__ebsLoaderLoaded) return;
  window.__ebsLoaderLoaded = true;

  const ASP_ORIGIN = /^https:\/\/secure\d*\.e-boekhouden\.nl$/;
  const SECURE20 = 'secure20.e-boekhouden.nl';
  const TOP_PATHS = ['/bh', '/bh/', '/bh/index.asp', '/bh/default.asp'];
  const LOGO_URL = '/images/Logo-EB_blauwopwit.svg';
  const HOST_TAG = 'ebs-loader';
  const LOGIN_HOST_ID = 'ebs-login-host';
  const HANDOFF_KEY = 'ebs-loader';
  const SLOW_MS = 3000;
  const CAP_MS = 8000;
  const CLASSIC_CAP_MS = 3000;
  // The mark waits this long for e-Boekhouden's logo before it uses its own.
  const LOGO_WAIT_MS = 300;
  // A login form reported from inside the secure20 shell while the 1Password
  // swap is on: login-breakout.js swaps it for its own iframe; wait for that
  // one instead of showing the form twice.
  const SWAP_WAIT_MS = 1500;
  // How long a login form may wait for login-page.js to lay it out.
  const LOGIN_LAYOUT_WAIT_MS = 500;
  // How long the app frame watches for the header.
  const APP_WATCH_MS = 10_000;
  const EXIT_MS = { app: 240, login: 180, plain: 150, reduced: 150 };
  const KINDS = new Set(['login', 'already', 'app', 'other']);
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const isTop = window === window.top;

  function onReady(callback) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', callback, { once: true });
    else callback();
  }

  function reducedMotion() {
    try {
      return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // e-Boekhouden's logo, taken apart.
  //
  // markFromSvg(text) reads the SVG as data (DOMParser, nothing of it is put
  // in the page) and returns the mark's parts as path data in the board's
  // coordinates (the disc at 48,48 with radius 44), or null when it cannot
  // find a round dark disc with a white e on it:
  //   { disc: Part, crescent: Part | null, e: [Part], eBox: { x, y, w, h } }
  //   Part = { d, transform, fill, fillRule }
  // Only path data, numbers and plain colours come out: no ids, hrefs,
  // styles, scripts or events. The wordmark and anything else are left out.
  // ===========================================================================

  const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };

  // "M10 10l5.5.5a1 1 0 01 2 2z" -> [{ c: 'M', args }, ...] or null.
  function tokenizePath(d) {
    const text = String(d ?? '');
    const commands = [];
    let at = 0;
    const skip = () => {
      while (at < text.length && /[\s,]/.test(text[at])) at += 1;
    };
    const number = () => {
      skip();
      NUMBER.lastIndex = at;
      const match = NUMBER.exec(text);
      if (!match) return null;
      at = NUMBER.lastIndex;
      return Number(match[0]);
    };
    const flag = () => {
      skip();
      if (text[at] === '0' || text[at] === '1') return Number(text[at++]);
      return null;
    };
    while (true) {
      skip();
      if (at >= text.length) break;
      const letter = text[at];
      if (!/[MmLlHhVvCcSsQqTtAaZz]/.test(letter)) return null;
      at += 1;
      if (letter === 'Z' || letter === 'z') {
        commands.push({ c: 'Z', args: [] });
        continue;
      }
      const arity = ARITY[letter.toUpperCase()];
      let command = letter;
      let groups = 0;
      while (true) {
        const args = [];
        for (let i = 0; i < arity; i += 1) {
          const value = letter.toUpperCase() === 'A' && (i === 3 || i === 4) ? flag() : number();
          if (value === null || !Number.isFinite(value)) break;
          args.push(value);
        }
        if (args.length === 0) break;
        if (args.length < arity) return null;
        commands.push({ c: command, args });
        groups += 1;
        // Extra pairs after a moveto are linetos.
        if (command === 'M') command = 'L';
        if (command === 'm') command = 'l';
      }
      if (groups === 0) return null;
    }
    return commands;
  }

  const round = (value) => Math.round(value * 1000) / 1000;

  // Points along an elliptical arc, from the endpoint form (SVG 1.1, F.6.5).
  function arcPoints(x1, y1, rx, ry, angle, large, sweep, x2, y2) {
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (!rx || !ry) return [[x2, y2]];
    const phi = (angle * Math.PI) / 180;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const dx = (x1 - x2) / 2;
    const dy = (y1 - y2) / 2;
    const x1p = cos * dx + sin * dy;
    const y1p = -sin * dx + cos * dy;
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
      rx *= Math.sqrt(lambda);
      ry *= Math.sqrt(lambda);
    }
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    let factor = den ? Math.sqrt(Math.max(0, num / den)) : 0;
    if (large === sweep) factor = -factor;
    const cxp = (factor * rx * y1p) / ry;
    const cyp = (-factor * ry * x1p) / rx;
    const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
    const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
    const vectorAngle = (ux, uy, vx, vy) => {
      const sign = ux * vy - uy * vx < 0 ? -1 : 1;
      const dot = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
      return sign * Math.acos(Math.min(1, Math.max(-1, dot)));
    };
    const theta = vectorAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let delta = vectorAngle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sweep && delta > 0) delta -= 2 * Math.PI;
    if (sweep && delta < 0) delta += 2 * Math.PI;
    const points = [];
    const steps = 16;
    for (let i = 1; i <= steps; i += 1) {
      const t = theta + (delta * i) / steps;
      points.push([cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos]);
    }
    return points;
  }

  // A path as its subpaths, each with absolute path data (M L C Q A Z only)
  // and points along it for its bounds. Null for path data that is not valid.
  function subpathsOf(d) {
    const commands = tokenizePath(d);
    if (!commands || !commands.length) return null;
    const subpaths = [];
    let current = null;
    let x = 0;
    let y = 0;
    let startX = 0;
    let startY = 0;
    let lastCubic = null;
    let lastQuad = null;
    const begin = () => {
      current = { parts: [`M${round(x)} ${round(y)}`], points: [[x, y]] };
      subpaths.push(current);
      startX = x;
      startY = y;
    };
    const cubicPoints = (x0, y0, ax, ay, bx, by, ex, ey) => {
      for (let i = 1; i <= 8; i += 1) {
        const t = i / 8;
        const u = 1 - t;
        current.points.push([
          u * u * u * x0 + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * ex,
          u * u * u * y0 + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * ey,
        ]);
      }
    };
    const quadPoints = (x0, y0, ax, ay, ex, ey) => {
      for (let i = 1; i <= 8; i += 1) {
        const t = i / 8;
        const u = 1 - t;
        current.points.push([u * u * x0 + 2 * u * t * ax + t * t * ex, u * u * y0 + 2 * u * t * ay + t * t * ey]);
      }
    };
    for (const { c, args } of commands) {
      const relative = c !== c.toUpperCase();
      const command = c.toUpperCase();
      const ox = relative ? x : 0;
      const oy = relative ? y : 0;
      if (command === 'M') {
        x = ox + args[0];
        y = oy + args[1];
        begin();
        lastCubic = null;
        lastQuad = null;
        continue;
      }
      if (command === 'Z') {
        if (current) current.parts.push('Z');
        x = startX;
        y = startY;
        current = null;
        lastCubic = null;
        lastQuad = null;
        continue;
      }
      // A drawing command right after Z starts a new subpath at the old start.
      if (!current) begin();
      const x0 = x;
      const y0 = y;
      if (command === 'L' || command === 'H' || command === 'V') {
        if (command === 'L') {
          x = ox + args[0];
          y = oy + args[1];
        } else if (command === 'H') {
          x = (relative ? x : 0) + args[0];
        } else {
          y = (relative ? y : 0) + args[0];
        }
        current.parts.push(`L${round(x)} ${round(y)}`);
        current.points.push([x, y]);
        lastCubic = null;
        lastQuad = null;
      } else if (command === 'C' || command === 'S') {
        let ax;
        let ay;
        let rest;
        if (command === 'C') {
          ax = ox + args[0];
          ay = oy + args[1];
          rest = args.slice(2);
        } else {
          ax = lastCubic ? 2 * x0 - lastCubic[0] : x0;
          ay = lastCubic ? 2 * y0 - lastCubic[1] : y0;
          rest = args;
        }
        const bx = ox + rest[0];
        const by = oy + rest[1];
        x = ox + rest[2];
        y = oy + rest[3];
        current.parts.push(`C${round(ax)} ${round(ay)} ${round(bx)} ${round(by)} ${round(x)} ${round(y)}`);
        cubicPoints(x0, y0, ax, ay, bx, by, x, y);
        lastCubic = [bx, by];
        lastQuad = null;
      } else if (command === 'Q' || command === 'T') {
        let ax;
        let ay;
        if (command === 'Q') {
          ax = ox + args[0];
          ay = oy + args[1];
          x = ox + args[2];
          y = oy + args[3];
        } else {
          ax = lastQuad ? 2 * x0 - lastQuad[0] : x0;
          ay = lastQuad ? 2 * y0 - lastQuad[1] : y0;
          x = ox + args[0];
          y = oy + args[1];
        }
        current.parts.push(`Q${round(ax)} ${round(ay)} ${round(x)} ${round(y)}`);
        quadPoints(x0, y0, ax, ay, x, y);
        lastQuad = [ax, ay];
        lastCubic = null;
      } else if (command === 'A') {
        const [rx, ry, angle, large, sweep] = args;
        x = ox + args[5];
        y = oy + args[6];
        current.parts.push(`A${round(rx)} ${round(ry)} ${round(angle)} ${large} ${sweep} ${round(x)} ${round(y)}`);
        current.points.push(...arcPoints(x0, y0, rx, ry, angle, large, sweep, x, y));
        lastCubic = null;
        lastQuad = null;
      }
    }
    return subpaths.map((subpath) => ({ d: subpath.parts.join(''), points: subpath.points }));
  }

  // Affine matrices as [a, b, c, d, e, f], as in SVG.
  const IDENTITY = [1, 0, 0, 1, 0, 0];

  function multiply(m, n) {
    return [
      m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
      m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
      m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
    ];
  }

  function applyMatrix(m, [x, y]) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  // The transform attribute as one matrix; null when it cannot be read.
  function parseTransform(text) {
    let matrix = IDENTITY;
    const source = String(text ?? '').trim();
    if (!source) return matrix;
    const pattern = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?\s*/gy;
    let match;
    let consumed = 0;
    while ((match = pattern.exec(source))) {
      consumed = pattern.lastIndex;
      const values = (match[2].match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
      const [a = 0, b, c, d, e, f] = values;
      let step;
      if (match[1] === 'matrix') {
        if (values.length !== 6) return null;
        step = [a, b, c, d, e, f];
      } else if (match[1] === 'translate') {
        step = [1, 0, 0, 1, a, b ?? 0];
      } else if (match[1] === 'scale') {
        step = [a, 0, 0, b ?? a, 0, 0];
      } else if (match[1] === 'rotate') {
        const r = (a * Math.PI) / 180;
        step = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
        if (b !== undefined) step = multiply(multiply([1, 0, 0, 1, b, c ?? 0], step), [1, 0, 0, 1, -b, -(c ?? 0)]);
      } else if (match[1] === 'skewX') {
        step = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
      } else {
        step = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
      }
      matrix = multiply(matrix, step);
    }
    return consumed === source.length ? matrix : null;
  }

  const NAMED = { white: [255, 255, 255], black: [0, 0, 0], navy: [0, 0, 128], blue: [0, 0, 255] };

  function parseColor(text) {
    const value = String(text ?? '').trim().toLowerCase();
    if (NAMED[value]) return NAMED[value];
    let match = /^#([0-9a-f]{3})$/.exec(value);
    if (match) return [...match[1]].map((digit) => parseInt(digit + digit, 16));
    match = /^#([0-9a-f]{6})$/.exec(value);
    if (match) return [0, 2, 4].map((at) => parseInt(match[1].slice(at, at + 2), 16));
    match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
    if (match) return match.slice(1, 4).map((part) => Math.min(255, Number(part)));
    return null;
  }

  const luminance = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const hex = (rgb) => `#${rgb.map((part) => Math.round(part).toString(16).padStart(2, '0')).join('')}`;

  // "fill: #fff; display: none" -> { fill: '#fff', display: 'none' }
  function declarations(text) {
    const out = {};
    for (const part of String(text ?? '').split(';')) {
      const at = part.indexOf(':');
      if (at < 0) continue;
      out[part.slice(0, at).trim().toLowerCase()] = part.slice(at + 1).replace(/!important/i, '').trim();
    }
    return out;
  }

  // Class rules from <style> (Illustrator writes `.st0{fill:#30395F;}`).
  // Read with indexOf and split, in one pass: a regular expression over the
  // whole text backtracks from every position of a long text without braces
  // (or with an unclosed comment), which froze the page for a minute on
  // 300 kB.
  function withoutComments(text) {
    let out = '';
    let at = 0;
    while (at < text.length) {
      const open = text.indexOf('/*', at);
      if (open < 0) return out + text.slice(at);
      out += text.slice(at, open);
      const close = text.indexOf('*/', open + 2);
      if (close < 0) return out;
      at = close + 2;
    }
    return out;
  }

  function classRules(doc) {
    const rules = new Map();
    for (const style of doc.getElementsByTagName('style')) {
      const text = withoutComments(style.textContent ?? '');
      for (const block of text.split('}')) {
        const open = block.indexOf('{');
        if (open < 0) continue;
        const found = declarations(block.slice(open + 1));
        for (const selector of block.slice(0, open).split(',')) {
          const name = /^\s*\.([\w-]+)\s*$/.exec(selector)?.[1];
          if (name) rules.set(name, { ...(rules.get(name) ?? {}), ...found });
        }
      }
    }
    return rules;
  }

  // Gradient id -> the average of its stop colours (stops may come through href).
  function gradientColors(doc) {
    const byId = new Map();
    for (const tag of ['linearGradient', 'radialGradient']) {
      for (const gradient of doc.getElementsByTagName(tag)) if (gradient.id) byId.set(gradient.id, gradient);
    }
    const colors = new Map();
    const resolve = (gradient, depth = 0) => {
      const stops = [...gradient.getElementsByTagName('stop')];
      if (!stops.length && depth < 4) {
        const ref = (gradient.getAttribute('href') ?? gradient.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '').replace(/^#/, '');
        return byId.has(ref) ? resolve(byId.get(ref), depth + 1) : null;
      }
      const rgbs = stops.map((stop) => parseColor(stop.getAttribute('stop-color') ?? declarations(stop.getAttribute('style'))['stop-color'])).filter(Boolean);
      if (!rgbs.length) return null;
      return [0, 1, 2].map((channel) => rgbs.reduce((sum, rgb) => sum + rgb[channel], 0) / rgbs.length);
    };
    for (const [id, gradient] of byId) {
      const color = resolve(gradient);
      if (color) colors.set(id, color);
    }
    return colors;
  }

  function shapePath(node) {
    const num = (name) => Number(node.getAttribute(name) ?? 0);
    switch (node.localName) {
      case 'path':
        return node.getAttribute('d');
      case 'circle': {
        const [cx, cy, r] = [num('cx'), num('cy'), num('r')];
        return r > 0 ? `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z` : null;
      }
      case 'ellipse': {
        const [cx, cy, rx, ry] = [num('cx'), num('cy'), num('rx'), num('ry')];
        return rx > 0 && ry > 0 ? `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z` : null;
      }
      case 'rect': {
        const [x, y, w, h] = [num('x'), num('y'), num('width'), num('height')];
        return w > 0 && h > 0 ? `M${x} ${y}H${x + w}V${y + h}H${x}Z` : null;
      }
      case 'polygon':
      case 'polyline': {
        const values = (node.getAttribute('points') ?? '').match(/[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g)?.map(Number) ?? [];
        if (values.length < 4) return null;
        const pairs = [];
        for (let i = 0; i + 1 < values.length; i += 2) pairs.push(`${values[i]} ${values[i + 1]}`);
        return `M${pairs.join('L')}${node.localName === 'polygon' ? 'Z' : ''}`;
      }
      default:
        return null;
    }
  }

  // e-Boekhouden's logo has a few dozen parts.
  const MAX_PARTS = 400;
  const SHAPES = new Set(['path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline']);
  const SKIP = new Set(['defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker', 'style', 'script', 'title', 'desc', 'metadata', 'foreignObject', 'image', 'text', 'use', 'linearGradient', 'radialGradient', 'filter', 'switch']);

  function boundsOf(points) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }

  const inside = (inner, outer, slack = 0) => inner.x >= outer.x - slack && inner.y >= outer.y - slack
    && inner.x + inner.w <= outer.x + outer.w + slack && inner.y + inner.h <= outer.y + outer.h + slack;

  // Every visible filled shape of the logo, split into subpaths with their
  // bounds in the root's user space.
  function shapesOf(doc) {
    const rules = classRules(doc);
    const gradients = gradientColors(doc);
    const shapes = [];
    let tooMany = false;
    const styleOf = (node) => {
      const own = {};
      for (const name of ['fill', 'fill-rule', 'display', 'visibility', 'opacity', 'fill-opacity']) {
        const value = node.getAttribute(name);
        if (value !== null) own[name] = value;
      }
      for (const name of (node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) Object.assign(own, rules.get(name) ?? {});
      return { ...own, ...declarations(node.getAttribute('style')) };
    };
    const walk = (node, matrix, inherited, depth) => {
      if (depth > 32 || tooMany) return;
      const style = styleOf(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || Number(style['fill-opacity']) === 0) return;
      const own = parseTransform(node.getAttribute('transform'));
      if (!own) return;
      let next = multiply(matrix, own);
      if (node.localName === 'svg' && depth > 0) next = multiply(next, [1, 0, 0, 1, Number(node.getAttribute('x') ?? 0), Number(node.getAttribute('y') ?? 0)]);
      const fill = style.fill ?? inherited.fill;
      const fillRule = style['fill-rule'] ?? inherited.fillRule;
      if (SHAPES.has(node.localName)) {
        const d = shapePath(node);
        const subpaths = d ? subpathsOf(d) : null;
        if (!subpaths) return;
        let rgb = null;
        const fillText = String(fill ?? '').trim();
        if (fillText.length > 200) return;
        const ref = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)$/.exec(fillText);
        if (ref) rgb = gradients.get(ref[1]) ?? null;
        else if (fill !== 'none') rgb = parseColor(fill ?? 'black');
        if (!rgb) return;
        const leaf = shapes.length;
        for (const subpath of subpaths) {
          if (subpath.points.length < 2) continue;
          // The holes test below compares every pair: a file with more parts
          // than a logo has is not the logo.
          if (shapes.length >= MAX_PARTS) {
            tooMany = true;
            return;
          }
          shapes.push({ leaf, d: subpath.d, matrix: next, rgb, fillRule: fillRule === 'evenodd' ? 'evenodd' : 'nonzero', box: boundsOf(subpath.points.map((point) => applyMatrix(next, point))) });
        }
        return;
      }
      if (SKIP.has(node.localName)) return;
      for (const child of node.children) walk(child, next, { fill, fillRule }, depth + 1);
    };
    walk(doc.documentElement, IDENTITY, { fill: undefined, fillRule: undefined }, 0);
    return tooMany ? [] : shapes;
  }

  function matrixString(m) {
    return `matrix(${m.map((value) => round(value)).join(' ')})`;
  }

  function markFromSvg(text) {
    try {
      if (typeof text !== 'string' || !text.trim() || text.length > 300_000) return null;
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      if (doc.documentElement?.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
      const shapes = shapesOf(doc);
      if (!shapes.length) return null;

      // Subpaths that lie inside another subpath of the same shape are its
      // holes (or islands in them); the rest are outlines.
      for (const shape of shapes) {
        shape.nested = shapes.some((other) => other !== shape && other.leaf === shape.leaf
          && other.box.w * other.box.h > shape.box.w * shape.box.h && inside(shape.box, other.box));
      }
      const outlines = shapes.filter((shape) => !shape.nested);

      // The disc: the largest round, dark, blue-ish outline.
      const disc = outlines
        .filter(({ box, rgb }) => box.w > 0 && Math.abs(box.w / box.h - 1) < 0.08 && luminance(rgb) < 0.35 && rgb[2] >= rgb[0])
        .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0];
      if (!disc) return null;
      const size = (disc.box.w + disc.box.h) / 2;

      // The crescent: a lighter outline of about the disc's height that comes
      // out on the disc's left.
      const crescent = outlines
        .filter((shape) => shape !== disc && luminance(shape.rgb) < 0.9 && luminance(shape.rgb) > luminance(disc.rgb)
          && shape.box.h > disc.box.h * 0.8 && shape.box.h < disc.box.h * 1.2
          && shape.box.cx < disc.box.cx && shape.box.x < disc.box.x - size * 0.02 && shape.box.x + shape.box.w > disc.box.x)
        .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)[0] ?? null;

      // The e: white shapes on the disc, or the disc's own holes (the logo is
      // blue on white, so a hole shows white).
      const onDisc = (shape) => inside(shape.box, disc.box, size * 0.05) && shape.box.w < size;
      let e = shapes.filter((shape) => shape.leaf === disc.leaf && shape !== disc && shape.nested && onDisc(shape))
        .map((shape) => ({ ...shape, rgb: [255, 255, 255] }));
      if (!e.length) {
        const whiteLeaves = new Set(outlines.filter((shape) => shape.leaf !== disc.leaf && luminance(shape.rgb) >= 0.85 && onDisc(shape)).map((shape) => shape.leaf));
        e = shapes.filter((shape) => whiteLeaves.has(shape.leaf) && onDisc(shape));
      }
      if (!e.length) return null;
      const eBounds = boundsOf(e.flatMap(({ box }) => [[box.x, box.y], [box.x + box.w, box.y + box.h]]));
      if (eBounds.w < size * 0.25 || eBounds.h < size * 0.25) return null;

      // Into the board's coordinates: disc centre at 48,48, radius 44.
      const k = 44 / (size / 2);
      const normal = [k, 0, 0, k, 48 - k * disc.box.cx, 48 - k * disc.box.cy];
      const part = (shape) => ({ d: shape.d, transform: matrixString(multiply(normal, shape.matrix)), fill: hex(shape.rgb), fillRule: shape.fillRule });
      const [ex, ey] = applyMatrix(normal, [eBounds.x, eBounds.y]);
      return {
        disc: part(disc),
        crescent: crescent ? part(crescent) : null,
        e: e.map(part),
        eBox: { x: round(ex), y: round(ey), w: round(eBounds.w * k), h: round(eBounds.h * k) },
      };
    } catch {
      return null;
    }
  }

  // ===========================================================================
  // The loader itself (top frame).
  // ===========================================================================

  const CSS = `
    :host { all: initial; }
    .ebs-loader { position: fixed; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: Ubuntu, system-ui, sans-serif; color: #ffffff; background: radial-gradient(120% 90% at 50% 42%, #1f2747 0%, #1b2240 55%, #161c35 100%); -webkit-font-smoothing: antialiased; }
    .ebs-loader.classic { background: #f5f5f5; }
    .ebs-loader.leaving { pointer-events: none; }
    .ebs-content { display: flex; flex-direction: column; align-items: center; padding-bottom: 36px; }
    .ebs-mark-wrap { position: relative; width: 220px; height: 220px; }
    .ebs-badge { position: absolute; inset: 0; }
    .ebs-mark-wrap svg { display: block; overflow: visible; }
    .ebs-mark-wrap .ebs-e { position: absolute; inset: 0; }
    .ebs-who { margin-top: -14px; display: flex; align-items: center; gap: 10px; height: 32px; }
    .ebs-who.empty { visibility: hidden; }
    .ebs-avatar { width: 30px; height: 30px; box-sizing: border-box; border-radius: 50%; border: 1px solid rgba(255,255,255,0.16); background: rgba(142,160,208,0.2); color: #ffffff; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .ebs-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .ebs-name { font-size: 15px; font-weight: 500; color: #ffffff; max-width: 60vw; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ebs-slow-slot { height: 64px; margin-top: 14px; display: flex; flex-direction: column; align-items: center; }
    .ebs-slow { display: flex; flex-direction: column; align-items: center; gap: 4px; opacity: 0; transform: translateY(4px); }
    .ebs-slow-text { font-size: 13px; color: #a9b1cd; }
    .ebs-link { background: none; border: 0; padding: 4px 6px; font: inherit; font-size: 13px; font-weight: 500; color: #ffffff; text-decoration: underline; text-decoration-color: rgba(255,255,255,0.4); text-underline-offset: 3px; cursor: pointer; border-radius: 6px; transition: text-decoration-color 150ms ease, color 150ms ease, background-color 150ms ease; }
    .ebs-link:hover { text-decoration-color: rgba(255,255,255,0.85); }
    .ebs-link:focus-visible { outline: 2px solid #8ea0d0; outline-offset: 2px; }
    .ebs-brand { position: absolute; bottom: 24px; left: 0; right: 0; text-align: center; font-size: 12px; letter-spacing: 0.04em; color: rgba(255,255,255,0.36); }

    @keyframes ebsDraw { to { stroke-dashoffset: 0; } }
    @keyframes ebsBadgeIn { 0% { transform: scale(.2); animation-timing-function: cubic-bezier(0.23,1,0.32,1); } 72% { transform: scale(1.035); animation-timing-function: ease-in-out; } 100% { transform: scale(1); } }
    @keyframes ebsCresOut { 0% { transform: translateX(8px) scale(.96); animation-timing-function: cubic-bezier(0.23,1,0.32,1); } 65% { transform: translateX(-1.2px) scale(1.01); animation-timing-function: ease-in-out; } 100% { transform: none; } }
    @keyframes ebsBreathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(.98); } }
    @keyframes ebsHaloBreathe { 0%, 100% { opacity: 1; } 50% { opacity: .55; } }
    @keyframes ebsSheen { 0% { opacity: 0; transform: translateX(0); } 6% { opacity: 1; } 32% { opacity: 0; transform: translateX(150px); } 100% { opacity: 0; transform: translateX(150px); } }
    @keyframes ebsRise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @keyframes ebsRiseSmall { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @keyframes ebsFadeIn { from { opacity: 0; } to { opacity: 1; } }
    @keyframes ebsFadeOut { from { opacity: 1; } to { opacity: 0; } }
    @keyframes ebsSettle { from { transform: scale(1); } to { transform: scale(.97); } }

    /* Entry, one gesture of about 1.2 s: the e (crossbar, then bowl), the disc, the crescent. */
    .ebs-bar { stroke-dasharray: 100 110; stroke-dashoffset: 80; animation: ebsDraw 320ms cubic-bezier(0.23,1,0.32,1) both; }
    .ebs-bowl { stroke-dasharray: 100 110; stroke-dashoffset: 101; animation: ebsDraw 580ms cubic-bezier(0.23,1,0.32,1) 150ms both; }
    .ebs-badge { transform: scale(0); animation: ebsBadgeIn 520ms linear 340ms forwards; }
    .ebs-cres { transform-box: fill-box; transform-origin: center; animation: ebsCresOut 560ms linear 640ms both; }
    .ebs-who { animation: ebsRise 480ms cubic-bezier(0.23,1,0.32,1) 300ms both; }
    /* Idle loop from 1250 ms: breathing, glow and a gleam over the disc, one 2.8 s rhythm. */
    .ebs-mark-wrap { animation: ebsBreathe 2800ms ease-in-out 1250ms infinite; }
    .ebs-halo { animation: ebsHaloBreathe 2800ms ease-in-out 1250ms infinite; }
    .ebs-sheen { opacity: 0; animation: ebsSheen 2800ms ease-in-out 1250ms infinite both; }

    /* A loader that continues from the previous document: the mark is complete and breathes on. */
    .is-settled .ebs-bar, .is-settled .ebs-bowl { animation: none; stroke-dashoffset: 0; }
    .is-settled .ebs-badge { animation: none; transform: none; }
    .is-settled .ebs-cres, .is-settled .ebs-who { animation: none; }
    .is-settled .ebs-mark-wrap, .is-settled .ebs-halo { animation-delay: 0ms; }
    .is-settled .ebs-sheen { animation-delay: 400ms; }

    /* Slow: after 3 s. */
    .is-slow .ebs-slow { animation: ebsRiseSmall 240ms cubic-bezier(0.23,1,0.32,1) 120ms both; }
    .is-slow.is-settled-slow .ebs-slow { animation: none; opacity: 1; transform: none; }

    /* Exits. */
    .ebs-out-app { animation: ebsFadeOut 240ms ease-out both; }
    .ebs-out-app .ebs-content { animation: ebsSettle 240ms ease-out both; }
    .ebs-out-login { animation: ebsFadeOut 180ms ease-out both; }
    .ebs-out-plain { animation: ebsFadeOut 150ms ease-out both; }

    /* Less motion: the mark stands still and complete; only fades of 150 ms. */
    @media (prefers-reduced-motion: reduce) {
      .ebs-bar, .ebs-bowl { animation: none; stroke-dashoffset: 0; }
      .ebs-badge { animation: none; transform: none; }
      .ebs-cres, .ebs-halo, .ebs-mark-wrap { animation: none; }
      .ebs-sheen { animation: none; opacity: 0; }
      .ebs-who { animation: ebsFadeIn 150ms ease-out both; }
      .is-settled .ebs-who { animation: none; }
      .is-slow .ebs-slow { animation: ebsFadeIn 150ms ease-out 120ms both; transform: none; }
      .ebs-out-app, .ebs-out-login { animation: ebsFadeOut 150ms ease-out both; }
      .ebs-out-app .ebs-content { animation: none; }
    }
  `;

  function svg(tag, attributes = {}, children = []) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
    node.append(...children);
    return node;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // The disc layer: halo, crescent, disc, rim and gleam. As on the board,
  // with e-Boekhouden's own crescent and disc when `mark` has them.
  function badgeSvg(mark) {
    const defs = svg('defs', {}, [
      svg('radialGradient', { id: 'ebsHaloGrad', cx: '50%', cy: '50%', r: '50%' }, [
        svg('stop', { offset: 0, 'stop-color': '#8ea0d0', 'stop-opacity': 0.22 }),
        svg('stop', { offset: 0.55, 'stop-color': '#8ea0d0', 'stop-opacity': 0.06 }),
        svg('stop', { offset: 1, 'stop-color': '#8ea0d0', 'stop-opacity': 0 }),
      ]),
      svg('linearGradient', { id: 'ebsCrescentGrad', x1: 0, y1: 0, x2: 0, y2: 1 }, [
        svg('stop', { offset: 0, 'stop-color': '#a9b6e0' }),
        svg('stop', { offset: 1, 'stop-color': '#8ea0d0' }),
      ]),
      svg('linearGradient', { id: 'ebsDiscGrad', x1: 0.15, y1: 0.1, x2: 0.85, y2: 0.95 }, [
        svg('stop', { offset: 0, 'stop-color': '#30395f' }),
        svg('stop', { offset: 1, 'stop-color': '#232c4f' }),
      ]),
      svg('linearGradient', { id: 'ebsSheenGrad', x1: 0, y1: 0, x2: 1, y2: 0 }, [
        svg('stop', { offset: 0, 'stop-color': '#ffffff', 'stop-opacity': 0 }),
        svg('stop', { offset: 0.5, 'stop-color': '#ffffff', 'stop-opacity': 0.16 }),
        svg('stop', { offset: 1, 'stop-color': '#ffffff', 'stop-opacity': 0 }),
      ]),
      svg('clipPath', { id: 'ebsDiscClip' }, [svg('circle', { cx: 48, cy: 48, r: 44 })]),
    ]);
    const shape = (part, extra = {}) => svg('path', { d: part.d, transform: part.transform, fill: part.fill, 'fill-rule': part.fillRule, ...extra });
    const layers = [svg('circle', { class: 'ebs-halo', cx: 48, cy: 48, r: 86, fill: 'url(#ebsHaloGrad)' })];
    if (!mark) {
      layers.push(
        svg('circle', { class: 'ebs-cres', cx: 40, cy: 48, r: 43, fill: 'url(#ebsCrescentGrad)' }),
        svg('circle', { cx: 48, cy: 48, r: 44, fill: 'url(#ebsDiscGrad)', stroke: '#ffffff', 'stroke-opacity': 0.1, 'stroke-width': 1 }),
      );
    } else {
      if (mark.crescent) layers.push(svg('g', { class: 'ebs-cres' }, [shape(mark.crescent)]));
      layers.push(shape(mark.disc), svg('circle', { cx: 48, cy: 48, r: 44, fill: 'none', stroke: '#ffffff', 'stroke-opacity': 0.1, 'stroke-width': 1 }));
    }
    layers.push(svg('g', { 'clip-path': 'url(#ebsDiscClip)' }, [
      svg('g', { transform: 'rotate(20 48 48)' }, [svg('rect', { class: 'ebs-sheen', x: -34, y: -30, width: 30, height: 156, fill: 'url(#ebsSheenGrad)' })]),
    ]));
    return svg('svg', { width: 220, height: 220, viewBox: '-40 -40 176 176', 'aria-hidden': 'true', focusable: 'false' }, [defs, ...layers]);
  }

  // The board's e: crossbar (sticking out left over the bowl) and bowl.
  const E_BAR = 'M19 48H71';
  const E_BOWL = 'M67 48A18 18 0 1 0 62.79 59.57';
  // Its bounds with the stroke: x 19..71, y 48 - 22.25 .. 48 + 22.25.
  const E_BOX = { x: 19, y: 25.75, w: 52, h: 44.5 };

  // The e layer. Ours is drawn as two strokes. e-Boekhouden's is a filled
  // glyph: the same two strokes, wide and fitted to its bounds, draw a mask
  // that uncovers it, and the mask goes once the e is complete, so the end
  // result is exactly their glyph.
  function eSvg(mark, { animate }) {
    const strokes = (width, extra = {}) => [
      svg('path', { class: 'ebs-bowl', d: E_BOWL, pathLength: 100, fill: 'none', stroke: '#ffffff', 'stroke-width': width, 'stroke-linecap': 'butt', ...extra }),
      svg('path', { class: 'ebs-bar', d: E_BAR, pathLength: 100, fill: 'none', stroke: '#ffffff', 'stroke-width': width, 'stroke-linecap': 'butt', ...extra }),
    ];
    const root = svg('svg', { class: 'ebs-e', width: 220, height: 220, viewBox: '-40 -40 176 176', 'aria-hidden': 'true', focusable: 'false' });
    if (!mark) {
      root.append(...strokes(8.5));
      return { root, done: () => {} };
    }
    const glyph = svg('g', {}, mark.e.map((part) => svg('path', { d: part.d, transform: part.transform, fill: part.fill, 'fill-rule': part.fillRule })));
    root.append(glyph);
    if (!animate) return { root, done: () => {} };
    const sx = mark.eBox.w / E_BOX.w;
    const sy = mark.eBox.h / E_BOX.h;
    const fit = `matrix(${round(sx)} 0 0 ${round(sy)} ${round(mark.eBox.x - E_BOX.x * sx)} ${round(mark.eBox.y - E_BOX.y * sy)})`;
    const mask = svg('mask', { id: 'ebsEMask', maskUnits: 'userSpaceOnUse', x: -40, y: -40, width: 176, height: 176 }, [
      svg('g', { transform: fit }, strokes(8.5 * 2.2)),
    ]);
    root.prepend(svg('defs', {}, [mask]));
    glyph.setAttribute('mask', 'url(#ebsEMask)');
    return { root, done: () => glyph.removeAttribute('mask') };
  }

  // e-Boekhouden's logo through the request layer: one bulk GET per page,
  // answered from the browser's cache after the first time. Resolves to the
  // mark's parts or null (then our own mark is used).
  function fetchMark() {
    try {
      if (!window.EBS?.request?.bulk) return Promise.resolve(null);
      return EBS.request.bulk('loader:logo', LOGO_URL, { as: 'text' }).then(markFromSvg, () => null);
    } catch {
      return Promise.resolve(null);
    }
  }

  // The hand-over from /bh/ to /bh?v2Url= (see the top comment).
  function takeHandoff() {
    try {
      const raw = window.sessionStorage.getItem(HANDOFF_KEY);
      if (raw === null) return null;
      window.sessionStorage.removeItem(HANDOFF_KEY);
      const value = JSON.parse(raw);
      const age = Date.now() - Number(value?.at);
      if (!(age >= 0 && age < CAP_MS) || !['better', 'classic'].includes(value?.mode)) return null;
      return { at: Number(value.at), mode: value.mode };
    } catch {
      return null;
    }
  }

  function giveHandoff(at, mode) {
    try {
      window.sessionStorage.setItem(HANDOFF_KEY, JSON.stringify({ at, mode }));
    } catch { /* storage blocked: the next page starts its own loader */ }
  }

  function runTop() {
    if (!ASP_ORIGIN.test(location.origin) || location.hostname === SECURE20) return;
    if (!TOP_PATHS.includes(location.pathname.toLowerCase())) return;

    const handoff = takeHandoff();
    const startedAt = handoff?.at ?? Date.now();
    const continuing = Boolean(handoff);
    const elapsed = () => Date.now() - startedAt;

    const state = {
      mode: null, // 'better' | 'classic' once mounted
      host: null,
      box: null,
      content: null,
      leaving: false,
      gone: false,
      outcome: null, // what a frame reported before the loader was decided
      onePassword: true,
      timers: [],
      mark: undefined,
      identity: null,
    };

    // ---- messages from the frames -------------------------------------------

    let swapWait = null;
    function loginHostWindow() {
      return document.getElementById(LOGIN_HOST_ID)?.querySelector('iframe#mainframe')?.contentWindow ?? null;
    }

    // Reports that come in before the settings are read wait for them.
    let settingsKnown = false;
    const early = [];

    function onFrameMessage(event) {
      const data = event.data;
      if (!data || typeof data !== 'object' || data.ebsLoader !== 1 || !KINDS.has(data.kind)) return;
      if (!ASP_ORIGIN.test(event.origin) || !event.source || event.source === window) return;
      const report = { kind: data.kind, source: event.source, origin: event.origin, fromHost: event.source === loginHostWindow() };
      if (settingsKnown) handle(report);
      else early.push(report);
    }
    window.addEventListener('message', onFrameMessage);

    function handle({ kind, source, origin, fromHost }) {
      if (kind === 'already') return; // the app is coming: keep waiting
      if (kind === 'login') {
        // A form in e-Boekhouden's own frameset that the 1Password swap is
        // about to replace: wait for the swapped one (or SWAP_WAIT_MS).
        if (state.onePassword && !fromHost && !document.getElementById(LOGIN_HOST_ID)) {
          if (!swapWait) swapWait = window.setTimeout(() => settle('login', null), SWAP_WAIT_MS);
          return;
        }
        settle('login', { source, origin });
        return;
      }
      settle(kind === 'app' ? 'app' : 'other', null);
    }

    function settle(kind, from) {
      window.clearTimeout(swapWait);
      if (state.gone || state.leaving) return;
      if (!state.mode) {
        // Known before the loader was even decided: it never shows.
        state.outcome = kind;
        return;
      }
      if (kind === 'login' && state.mode === 'better' && from?.source) {
        // The card rises while the loader fades (login frame side, below).
        try {
          from.source.postMessage({ ebsLoader: 1, kind: 'rise' }, from.origin);
        } catch { /* the frame went away */ }
      }
      leave(kind === 'login' ? 'login' : 'app');
    }

    // ---- mounting -------------------------------------------------------------

    function mount(mode) {
      if (state.host || state.gone) return;
      const parent = document.documentElement;
      if (!parent) return;
      state.mode = mode;
      const host = document.createElement(HOST_TAG);
      host.style.cssText = 'all: initial !important; position: fixed !important; inset: 0 !important; z-index: 2147483647 !important; display: block !important;';
      const root = host.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = CSS;
      const box = el('div', `ebs-loader${mode === 'classic' ? ' classic' : ''}`);
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      box.setAttribute('aria-busy', 'true');
      box.setAttribute('aria-label', mode === 'classic' ? 'Bezig met laden' : 'e-Boekhouden wordt geopend');
      root.append(style, box);
      parent.append(host);
      state.host = host;
      state.box = box;

      const cap = mode === 'classic' ? CLASSIC_CAP_MS : CAP_MS;
      state.timers.push(window.setTimeout(() => leave('app'), Math.max(0, cap - elapsed())));
      if (mode === 'better') state.timers.push(window.setTimeout(slow, Math.max(0, SLOW_MS - elapsed())));
      window.addEventListener('pagehide', onPageHide);
    }

    // The content of the Better design loader: once the mark is known (or
    // LOGO_WAIT_MS passed) and the identity is read.
    function fill() {
      if (!state.box || state.mode !== 'better' || state.content || state.mark === undefined || !state.identity || state.leaving) return;
      const { name, avatar } = state.identity;
      const settled = continuing || elapsed() >= SLOW_MS;
      if (settled) state.box.classList.add('is-settled');
      if (name) state.box.setAttribute('aria-label', `Administratie ${name} wordt geopend`);

      const content = el('div', 'ebs-content');
      const wrap = el('div', 'ebs-mark-wrap');
      const badge = el('div', 'ebs-badge');
      badge.append(badgeSvg(state.mark));
      const e = eSvg(state.mark, { animate: !settled && !reducedMotion() });
      wrap.append(badge, e.root);
      // The mask goes once the bowl is drawn (150 + 580 ms).
      state.timers.push(window.setTimeout(e.done, 760));

      const who = el('div', `ebs-who${name ? '' : ' empty'}`);
      const avatarBox = el('span', 'ebs-avatar');
      avatarBox.setAttribute('aria-hidden', 'true');
      if (avatar) {
        const img = el('img');
        img.alt = '';
        img.src = avatar;
        avatarBox.append(img);
      } else {
        avatarBox.textContent = EBS.initials(name);
      }
      who.append(avatarBox, el('span', 'ebs-name', name ?? ''));

      const slot = el('div', 'ebs-slow-slot');
      const slowBox = el('div', 'ebs-slow');
      slowBox.setAttribute('aria-hidden', 'true');
      const button = el('button', 'ebs-link', 'Pagina nu tonen');
      button.type = 'button';
      button.tabIndex = -1;
      button.addEventListener('click', () => leave('app'));
      slowBox.append(el('span', 'ebs-slow-text', 'Bezig met laden…'), button);
      slot.append(slowBox);

      content.append(wrap, who, slot);
      state.box.append(content, el('span', 'ebs-brand', 'EB Sessions'));
      state.content = content;
      state.slowButton = button;
      state.slowBox = slowBox;
      if (elapsed() >= SLOW_MS) slow(true);
    }

    function slow(immediate = false) {
      if (!state.box || state.leaving || state.mode !== 'better') return;
      state.slowShown = true;
      if (!state.content) return; // fill() calls back in
      if (state.box.classList.contains('is-slow')) return;
      if (immediate === true && continuing) state.box.classList.add('is-settled-slow');
      state.box.classList.add('is-slow');
      state.box.setAttribute('aria-label', 'Bezig met laden');
      state.slowButton.tabIndex = 0;
      state.slowBox.removeAttribute('aria-hidden');
    }

    function leave(kind) {
      if (state.leaving || state.gone) return;
      if (!state.host) {
        state.outcome = kind;
        return;
      }
      state.leaving = true;
      for (const timer of state.timers) window.clearTimeout(timer);
      const box = state.box;
      box.classList.add('leaving');
      box.setAttribute('aria-busy', 'false');
      const reduced = reducedMotion();
      let exitClass = 'ebs-out-plain';
      let duration = EXIT_MS.plain;
      if (state.mode === 'better') {
        exitClass = kind === 'login' ? 'ebs-out-login' : 'ebs-out-app';
        duration = reduced ? EXIT_MS.reduced : EXIT_MS[kind === 'login' ? 'login' : 'app'];
      }
      box.classList.add(exitClass);
      let removed = false;
      const remove = () => {
        if (removed) return;
        removed = true;
        finish();
      };
      box.addEventListener('animationend', (event) => {
        if (event.target === box) remove();
      });
      window.setTimeout(remove, duration + 60);
    }

    function finish() {
      state.gone = true;
      state.host?.remove();
      window.removeEventListener('message', onFrameMessage);
      window.removeEventListener('pagehide', onPageHide);
    }

    function onPageHide() {
      // Still covering the page while the tab moves on (the app entry after
      // "U bent reeds ingelogd"): the next /bh/ document carries on.
      if (state.host && !state.leaving && !state.gone) giveHandoff(startedAt, state.mode);
    }

    // ---- deciding -------------------------------------------------------------

    // Continuing a loader: cover at once, before the settings are read.
    if (handoff) mount(handoff.mode);

    EBS.watchSettings((settings, previous) => {
      state.onePassword = Boolean(settings.onePassword);
      if (!settingsKnown || !previous) return;
      // Better design switched off while the loader shows: show the page.
      if (state.mode === 'better' && !settings.betterDesign) leave('app');
    });

    const read = (() => {
      try {
        return chrome.storage.local.get(['settings', 'view', 'slots']);
      } catch {
        return Promise.reject(new Error('no extension context'));
      }
    })();
    read.then(async ({ settings, view, slots }) => {
      settingsKnown = true;
      const all = EBS.settingsWithDefaults(settings);
      state.onePassword = Boolean(all.onePassword);
      let mode = null;
      if (all.betterDesign) mode = 'better';
      else if (view?.loggedIn || handoff?.mode === 'classic') mode = 'classic';

      for (const report of early.splice(0)) handle(report);

      if (state.host && state.mode !== mode) {
        // The setting changed between two documents.
        state.host.remove();
        state.host = null;
        state.box = null;
        state.mode = null;
        for (const timer of state.timers) window.clearTimeout(timer);
        state.timers = [];
      }
      if (!mode || state.outcome) {
        finish();
        return;
      }
      mount(mode);
      if (mode !== 'better') return;

      const marked = fetchMark().then((mark) => {
        if (state.mark === undefined) state.mark = mark;
        fill();
      });
      state.timers.push(window.setTimeout(() => {
        if (state.mark === undefined) state.mark = null;
        fill();
      }, LOGO_WAIT_MS));

      const slot = Array.isArray(slots) ? slots.find((entry) => entry?.id === view?.activeSlotId) : null;
      let avatar = null;
      if (slot) {
        try {
          const key = `avatar:${slot.id}`;
          const value = (await chrome.storage.local.get(key))[key];
          if (typeof value === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) avatar = value;
        } catch { /* no picture: initials */ }
      }
      state.identity = { name: typeof slot?.name === 'string' && slot.name.trim() ? slot.name.trim() : null, avatar };
      fill();
      await marked;
    }, () => finish());
  }

  // ===========================================================================
  // Frames: report what they show to the top frame.
  // ===========================================================================

  const RISE_CSS = `
    @keyframes ebsLoaderCardIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @keyframes ebsLoaderFadeIn { from { opacity: 0; } to { opacity: 1; } }
    html.ebs-loader-rise #ebs-better .ebs-main { animation: ebsLoaderCardIn 240ms cubic-bezier(0.23,1,0.32,1) both; }
    @media (prefers-reduced-motion: reduce) {
      html.ebs-loader-rise #ebs-better .ebs-main { animation: ebsLoaderFadeIn 150ms ease-out both; }
    }
  `;

  function topIsBh() {
    try {
      return TOP_PATHS.includes(window.top.location.pathname.toLowerCase()) && window.top.location.origin === location.origin;
    } catch {
      return false;
    }
  }

  // /bh/inloggen.asp, in login-breakout's iframe or inside the secure20 shell.
  function runLoginFrame() {
    if (!topIsBh()) return;
    const post = (kind) => {
      try {
        window.top.postMessage({ ebsLoader: 1, kind }, location.origin);
      } catch { /* the top went away */ }
    };

    window.addEventListener('message', (event) => {
      if (event.source !== window.top || event.data?.ebsLoader !== 1 || event.data.kind !== 'rise') return;
      if (!document.getElementById('ebs-better')) return;
      const style = document.createElement('style');
      style.textContent = RISE_CSS;
      (document.head ?? document.documentElement).append(style);
      document.documentElement.classList.add('ebs-loader-rise');
    });

    onReady(() => {
      if (/reeds ingelogd/i.test(document.body?.innerText ?? document.body?.textContent ?? '')) {
        post('already');
        return;
      }
      if (!document.getElementById('frm') || !document.getElementById('txtEmail')) return;
      // A real form: as soon as login-page.js has laid it out, or after
      // LOGIN_LAYOUT_WAIT_MS, whichever comes first.
      const laidOut = () => Boolean(document.getElementById('ebs-better') || document.getElementById('ebs-sessions') || document.getElementById('ebs-notice'));
      let sent = false;
      let observer = null;
      const send = () => {
        if (sent) return;
        sent = true;
        observer?.disconnect();
        window.clearTimeout(timer);
        // One frame later: the new layout is painted before the loader goes.
        window.requestAnimationFrame(() => post('login'));
      };
      const timer = window.setTimeout(send, LOGIN_LAYOUT_WAIT_MS);
      if (laidOut()) {
        send();
        return;
      }
      observer = new MutationObserver(() => {
        if (laidOut()) send();
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  // mainframe on secure20: the app (or e-Boekhouden's own session-expired screen).
  function runAppFrame() {
    const origins = location.ancestorOrigins;
    const topOrigin = origins?.length ? origins[origins.length - 1] : '';
    if (!ASP_ORIGIN.test(topOrigin) || new URL(topOrigin).hostname === SECURE20) return;
    const post = (kind) => {
      try {
        window.top.postMessage({ ebsLoader: 1, kind }, topOrigin);
      } catch { /* the top went away */ }
    };
    const EXPIRED = new Set(['/sessie-verlopen', '/login/verlopen']);
    let observer = null;
    let timer = null;
    const stop = () => {
      observer?.disconnect();
      window.clearTimeout(timer);
    };
    const check = () => {
      const path = location.pathname.toLowerCase();
      if (EXPIRED.has(path)) {
        stop();
        post('other');
        return;
      }
      // The header with the administration is the app's own sign that it runs.
      if (path !== '/v1login' && document.querySelector('app-header-identity-b .header-identity, app-header-identity .container')) {
        stop();
        window.requestAnimationFrame(() => post('app'));
      }
    };
    observer = new MutationObserver(check);
    observer.observe(document, { childList: true, subtree: true });
    timer = window.setTimeout(stop, APP_WATCH_MS);
    check();
  }

  function runFrame() {
    if (!ASP_ORIGIN.test(location.origin)) return;
    if (location.hash.startsWith('#ebs-edit=')) return; // import.js's dialog page
    const path = location.pathname.toLowerCase();
    if (location.hostname !== SECURE20 && path === '/bh/inloggen.asp') runLoginFrame();
    else if (location.hostname === SECURE20 && window.name === 'mainframe' && window.parent === window.top) runAppFrame();
  }

  EBS.define('loader', Object.freeze({ markFromSvg, subpathsOf, parseTransform }));

  if (isTop) runTop();
  else runFrame();
})();
