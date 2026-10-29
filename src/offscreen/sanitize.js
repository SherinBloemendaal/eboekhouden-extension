// The model's HTML is untrusted: only an allow-list of tags and attributes
// survives, rebuilt element by element in an inert document (DOMParser runs
// no scripts and loads nothing). An image survives only when its address
// was already in the text the user sent, so an answer cannot add a tracking
// pixel to an e-mail. The content script (src/features/ai.js) runs the same
// rules again before anything reaches the editor; tests/ai-sanitize.test.mjs
// keeps the two in step.

const TAGS = new Set([
  'p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup',
  'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'hr',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'font', 'img',
]);
// Dropped with everything inside them; any other unknown tag is unwrapped.
const DROP = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'option', 'svg', 'math', 'template', 'noscript', 'video', 'audio', 'source', 'canvas', 'title', 'head']);
const ATTRIBUTES = {
  '*': ['style', 'align', 'dir'],
  a: ['href', 'title'],
  font: ['color', 'face', 'size'],
  td: ['colspan', 'rowspan', 'width', 'valign'],
  th: ['colspan', 'rowspan', 'width', 'valign'],
  table: ['border', 'cellpadding', 'cellspacing', 'width'],
  img: ['src', 'alt', 'width', 'height'],
};
const UNSAFE_STYLE = /url\s*\(|expression|@import|javascript:|behavior|-moz-binding|[<>]/i;
const SAFE_HREF = /^(?:https?:|mailto:|tel:|\[[A-Z][A-Z0-9_]*\]$|#)/i;

function imageSources(original, DOMParser) {
  const sources = new Set();
  if (!original || !/<img/i.test(original)) return sources;
  const doc = new DOMParser().parseFromString(original, 'text/html');
  for (const image of doc.querySelectorAll('img[src]')) sources.add(image.getAttribute('src'));
  return sources;
}

function allowedAttribute(tag, name, value, images) {
  if (!(ATTRIBUTES['*'].includes(name) || (ATTRIBUTES[tag] ?? []).includes(name))) return false;
  if (name === 'style') return !UNSAFE_STYLE.test(value);
  if (name === 'href') return SAFE_HREF.test(value.trim());
  if (name === 'src') return images.has(value);
  return true;
}

export function sanitizeHtml(html, { DOMParser = globalThis.DOMParser, original = '' } = {}) {
  const parser = new DOMParser();
  const source = parser.parseFromString(`<!doctype html><html><body>${String(html ?? '')}</body></html>`, 'text/html');
  const out = parser.parseFromString('<!doctype html><html><body></body></html>', 'text/html');
  const images = imageSources(original, DOMParser);

  function copy(node, into) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        into.appendChild(out.createTextNode(child.nodeValue));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const tag = child.localName;
      if (DROP.has(tag)) continue;
      if (!TAGS.has(tag)) {
        copy(child, into);
        continue;
      }
      if (tag === 'img' && !images.has(child.getAttribute('src') ?? '')) continue;
      const clean = out.createElement(tag);
      for (const { name, value } of [...child.attributes]) {
        if (allowedAttribute(tag, name.toLowerCase(), value, images)) clean.setAttribute(name.toLowerCase(), value);
      }
      into.appendChild(clean);
      copy(child, clean);
    }
  }

  copy(source.body, out.body);
  return out.body.innerHTML;
}
