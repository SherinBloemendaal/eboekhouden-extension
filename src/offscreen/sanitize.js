// The model's HTML is untrusted: only an allow-list of tags and attributes
// survives, rebuilt element by element in an inert document (DOMParser runs
// no scripts and loads nothing). An image survives only when its address
// was already in the text the user sent, so an answer cannot add a tracking
// pixel to an e-mail; a link only when the user can see where it goes (see
// linkAllowed), and a style that hides text only when the text had it.
// That holds when the text itself tells the model to add them (prompt
// injection): the model's answer is never trusted. The content script (src/features/ai.js) runs the same
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
// Styles that hide what they style: text the user does not see in the editor
// could still go out in every e-mail. A style the text already had stays
// (a hidden preheader, say); a new one that hides is dropped.
const ZERO = '(?:0+(?:\\.0*)?|\\.0+)(?:px|pt|em|rem|%)?\\s*(?:[;!]|$)';
const HIDING_STYLE = new RegExp([
  'display\\s*:\\s*none', 'visibility\\s*:', 'opacity\\s*:', 'color\\s*:\\s*transparent', 'position\\s*:\\s*(?:absolute|fixed)',
  'text-indent\\s*:\\s*-', 'clip(?:-path)?\\s*:', 'transform\\s*:', `font-size\\s*:\\s*${ZERO}`, `line-height\\s*:\\s*${ZERO}`,
  `(?:^|[;\\s])(?:max-)?(?:height|width)\\s*:\\s*${ZERO}`,
].join('|'), 'i');
const SCHEME = /^(?:https?:|mailto:|tel:)/i;
const VARIABLE_HREF = /^(?:mailto:|tel:)?\[[A-Z][A-Z0-9_]*\]$/;
const HAS_VARIABLE = /\[[A-Z][A-Z0-9_]*\]/;

// An address as a person reads it: no scheme, no www., no closing slash.
function readable(address) {
  return String(address ?? '').trim().toLowerCase().replace(/^(?:https?:\/\/|mailto:|tel:)/, '').replace(/^www\./, '').replace(/\/+$/, '');
}

// What the text the user sent already had: image sources, link addresses
// and style values.
function sourceParts(original, DOMParser) {
  const parts = { images: new Set(), links: new Set(), styles: new Set() };
  if (!original || !/<(?:img|a|[a-z][^>]*\sstyle)/i.test(original)) return parts;
  const doc = new DOMParser().parseFromString(original, 'text/html');
  for (const image of doc.querySelectorAll('img[src]')) parts.images.add(image.getAttribute('src'));
  for (const link of doc.querySelectorAll('a[href]')) parts.links.add(link.getAttribute('href').trim());
  for (const node of doc.querySelectorAll('[style]')) parts.styles.add(node.getAttribute('style'));
  return parts;
}

// A link survives when its address is a variable, was in the text already,
// is in the user's own instruction, or is what the link shows: a model told
// by the text to add a link cannot add one the user would not see. A new
// address never carries a variable (no customer data in a URL).
function linkAllowed(href, element, parts, instruction) {
  const value = href.trim();
  if (/^#[\w-]*$/.test(value) || VARIABLE_HREF.test(value)) return true;
  if (!SCHEME.test(value)) return false;
  if (parts.links.has(value)) return true;
  if (HAS_VARIABLE.test(value)) return false;
  const address = readable(value);
  if (!address) return false;
  if (instruction && instruction.toLowerCase().includes(address)) return true;
  return readable(element.textContent) === address;
}

function allowedAttribute(tag, name, value, parts) {
  if (!(ATTRIBUTES['*'].includes(name) || (ATTRIBUTES[tag] ?? []).includes(name))) return false;
  if (name === 'style') return parts.styles.has(value) || (!UNSAFE_STYLE.test(value) && !HIDING_STYLE.test(value));
  if (name === 'src') return parts.images.has(value);
  return true;
}

export function sanitizeHtml(html, { DOMParser = globalThis.DOMParser, original = '', instruction = '' } = {}) {
  const parser = new DOMParser();
  const source = parser.parseFromString(`<!doctype html><html><body>${String(html ?? '')}</body></html>`, 'text/html');
  const out = parser.parseFromString('<!doctype html><html><body></body></html>', 'text/html');
  const parts = sourceParts(original, DOMParser);

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
      if (tag === 'img' && !parts.images.has(child.getAttribute('src') ?? '')) continue;
      const clean = out.createElement(tag);
      for (const { name, value } of [...child.attributes]) {
        const lower = name.toLowerCase();
        const allowed = lower === 'href'
          ? tag === 'a' && linkAllowed(value, child, parts, instruction)
          : allowedAttribute(tag, lower, value, parts);
        if (allowed) clean.setAttribute(lower, value);
      }
      into.appendChild(clean);
      copy(child, clean);
    }
  }

  copy(source.body, out.body);
  return out.body.innerHTML;
}
