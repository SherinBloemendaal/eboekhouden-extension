// EB Sessions: the AI writing help in every CKEditor 4 of e-Boekhouden.
// Setting: aiWriter. Design: AISettings.dc.html and EmailTemplate.dc.html.
//
// A bar of its own sits above each editor (outside CKEditor's .cke, which is
// never moved or changed): Herschrijven, Schrijven op instructie, Vertalen,
// Controleren, Herinneringsreeks and, where the page has a subject field,
// Onderwerp voorstellen. The answer always comes back as a proposal with the
// differences, in a panel over the bottom of the editor; nothing reaches the
// text without a click on Overnemen, and nothing is ever saved or sent.
//
// The editor is read through EBS.bridge (ckeditor.getData and
// ckeditor.getSelectionText) and written only through it (setData or
// insertHtml) inside the user's click, which the bridge itself enforces.
// The model call runs in the service worker's offscreen document (ai:run);
// this script never sees the API key. What it sends: the editor's text or
// the selection, the variables of the template type, the instruction and,
// for a subject, the current subject. Before a proposal is shown, the
// variables in the answer are checked against those in the text.
//
// The bar's state (ready, no key, ...) comes from aiView in
// chrome.storage.local, which the service worker keeps (src/bg/ai.js).

(() => {
  if (window.__ebsAiLoaded) return;
  window.__ebsAiLoaded = true;
  const { EBS } = window;
  if (!EBS?.bridge || !EBS?.icon) return;

  // -------------------------------------------------------------------------
  // Variables per template type, from e-Boekhouden's own explanation pages
  // (the feasibility dump vars.json). Offertes use the invoice list: an
  // assumption, e-Boekhouden has no list of its own for them.
  // -------------------------------------------------------------------------

  const VARIABLES = {
    mail: [
      ['[RELBEDRIJF]', 'De bedrijfsnaam van uw relatie'], ['[RELCONTACTPERSOON]', 'De contactpersoon van uw relatie'], ['[RELCODE]', 'De code van uw relatie'],
      ['[RELAANHEF]', 'De aanhef van uw relatie'], ['[RELADRES]', 'Het adres van uw relatie'], ['[RELPOSTCODE]', 'De postcode van uw relatie'],
      ['[RELPLAATS]', 'De plaats van uw relatie'], ['[RELLAND]', 'Het land van uw relatie'], ['[RELADRES2]', 'Het vestigingsadres van uw relatie'],
      ['[RELPOSTCODE2]', 'De vestigingspostcode van uw relatie'], ['[RELPLAATS2]', 'De vestigingsplaats van uw relatie'], ['[RELLAND2]', 'Het land van uw relatie'],
      ['[RELEMAIL]', 'E-mailadres relatie'], ['[RELEMAILFACTUUR]', 'E-mailadres tbv facturen van relatie'], ['[RELIBAN]', 'De iban uit de machtiging'],
      ['[RELSEPAMACHTIGINGID]', 'Het machtigingskenmerk uit de machtiging'], ['[RELBTWNR]', 'Het btw-nummer van uw relatie'], ['[FACTDATUM]', 'De factuurdatum'],
      ['[VERVALDATUM]', 'De vervaldatum van uw factuur'], ['[FACTNUMMER]', 'Factuurnummer'], ['[FACTKENMERK]', 'Het kenmerk van uw factuur'],
      ['[FACTTERMIJN]', 'Betalingstermijn'], ['[TOTAAL]', 'Het totaalbedrag van uw factuur, inclusief btw'], ['[ABBEDRIJF]', 'Uw bedrijfsnaam'],
      ['[ABADRES]', 'Uw adres'], ['[ABPOSTCODE]', 'Uw postcode'], ['[ABPLAATS]', 'Uw plaats'], ['[ABTELEFOON]', 'Uw telefoonnummer'],
      ['[ABEMAIL]', 'Uw e-mailadres'], ['[ABWEBSITE]', 'Het adres van uw website'], ['[ABOBNUMMER]', 'Uw btw-id (indien gevuld) of OB-nummer'],
    ],
    factuur: [
      ['[BEDRIJF]', 'De bedrijfsnaam van uw relatie'], ['[CP]', 'De contactpersoon van uw relatie'], ['[CODE]', 'De code van uw relatie'],
      ['[KVK]', 'Het KVK-nummer van uw relatie'], ['[AANHEF]', 'De aanhef van uw relatie'], ['[ADRES]', 'Het adres van uw relatie'],
      ['[POSTCODE]', 'De postcode van uw relatie'], ['[PLAATS]', 'De plaats van uw relatie'], ['[LAND]', 'Het land van uw relatie'],
      ['[ADRES1]', 'Het vestigingsadres van uw relatie'], ['[POSTCODE1]', 'De postcode van uw relatie'], ['[PLAATS1]', 'De plaats van uw relatie'],
      ['[LAND1]', 'Het land van uw relatie'], ['[ADRES2]', 'Het postadres van uw relatie'], ['[POSTCODE2]', 'De postcode van uw relatie'],
      ['[PLAATS2]', 'De plaats van uw relatie'], ['[LAND2]', 'Het land van uw relatie'], ['[EMAIL]', 'Het e-mailadres van uw relatie'],
      ['[EMAILFACTUUR]', 'Het e-mailadres van uw relatie tbv facturen'], ['[VRIJ1]', 'Vrij relatieveld #1'], ['[VRIJ2]', 'Vrij relatieveld #2'],
      ['[VRIJ3]', 'Vrij relatieveld #3'], ['[VRIJ4]', 'Vrij relatieveld #4'], ['[VRIJ5]', 'Vrij relatieveld #5'], ['[VRIJ6]', 'Vrij relatieveld #6'],
      ['[VRIJ7]', 'Vrij relatieveld #7'], ['[VRIJ8]', 'Vrij relatieveld #8'], ['[VRIJ9]', 'Vrij relatieveld #9'], ['[VRIJ10]', 'Vrij relatieveld #10'],
      ['[IBAN]', 'De iban uit de machtiging'], ['[MACHTIGINGID]', 'Het machtigingskenmerk uit de machtiging'], ['[BTWNR]', 'Het btw-nummer van uw relatie'],
      ['[DATUM]', 'De factuurdatum'], ['[NUMMER]', 'Factuurnummer'], ['[KENMERK]', 'Het kenmerk van uw factuur'], ['[TERMIJN]', 'Betalingstermijn'],
      ['[NOTITIE]', 'Opmerkingen'], ['[VARTEKST]', 'Variabele factuurtekst'], ['[VDATUM]', 'Vervaldatum'],
      ['[LAAN]', 'Lijst met aantallen van de producten/diensten'], ['[LEEN]', 'Lijst met eenheden van de producten/diensten'],
      ['[LCODE]', 'Lijst met codes van de producten/diensten'], ['[LOM]', 'Lijst met omschrijvingen van de producten/diensten'],
      ['[LE]', 'Lijst met eurotekens van de producten/diensten'], ['[LPPE]', 'Lijst met prijs per eenheid van de producten/diensten'],
      ['[LKORT]', 'Lijst met kortingen van de producten/diensten'], ['[LOPSL]', 'Lijst met opslagen van de producten/diensten'],
      ['[LKO]', 'Lijst met kortingen en/of opslagen van de producten/diensten'], ['[LTOT]', 'Lijst met totaalprijzen van de producten/diensten'],
      ['[LBTW]', 'Lijst met BTW-percentages van de producten/diensten'], ['[TOT_EX]', 'Totaalbedrag excl BTW van de factuur'],
      ['[LST_BTW_OM]', 'Lijst met BTW-omschrijvingen'], ['[LEB]', "Lijst met eurotekens van BTW's"], ['[LST_BTW]', 'Lijst met BTW-bedragen'],
      ['[TOTAAL]', 'Totaal bedrag incl BTW van de factuur'], ['[FACTUURREGELS]', 'Tabel met alle factuurregels'], ['[ABBEDRIJF]', 'Uw bedrijfsnaam'],
      ['[ABADRES]', 'Uw adres'], ['[ABPOSTCODE]', 'Uw postcode'], ['[ABPLAATS]', 'Uw plaats'], ['[ABTELEFOON]', 'Uw telefoonnummer'],
      ['[ABEMAIL]', 'Uw e-mailadres'], ['[ABWEBSITE]', 'Het adres van uw website'], ['[ABOBNUMMER]', 'Uw btw-id (indien gevuld) of OB-nummer'],
      ['[ABIBAN]', 'Uw iban'],
    ],
    aanmaan: [
      ['[CP]', 'Contactpersoon'], ['[AANHEF]', 'Aanhef'], ['[ADRES]', 'Het adres van uw relatie (postadres indien aanwezig, anders vestigingsadres)'],
      ['[POSTCODE]', 'De postcode van uw relatie'], ['[PLAATS]', 'De plaats van uw relatie'], ['[LAND]', 'Land van uw relatie'],
      ['[ADRES2]', 'Adres van uw relatie (altijd postadres, ook als dat niet ingevuld is)'], ['[POSTCODE2]', 'De postcode van uw relatie'],
      ['[PLAATS2]', 'De plaats van uw relatie'], ['[LAND2]', 'Land van uw relatie'], ['[BANK]', 'Bankrekeningnummer'], ['[IBAN]', 'IBAN'],
      ['[DATUM]', 'De datum waarop de aanmaning gemaakt wordt'], ['[FACTDATUM]', 'De datum van de factuur waar de aanmaning betrekking op heeft'],
      ['[FACTNUMMER]', 'Het factuurnummer van de factuur waar de aanmaning betrekking op heeft'], ['[TOTAAL]', 'Totaalbedrag inclusief btw van de factuur'],
      ['[VOLDAAN]', 'Het bedrag dat reeds voldaan is'], ['[OPENSTAAND]', 'Het bedrag wat uw relatie nog moet voldoen'],
      ['[VRIJ1]', 'Zelf definieerbaar relatieveld 1'], ['[VRIJ2]', 'Zelf definieerbaar relatieveld 2'], ['[VRIJ3]', 'Zelf definieerbaar relatieveld 3'],
      ['[VRIJ4]', 'Zelf definieerbaar relatieveld 4'], ['[VRIJ5]', 'Zelf definieerbaar relatieveld 5'], ['[VRIJ6]', 'Zelf definieerbaar relatieveld 6'],
      ['[VRIJ7]', 'Zelf definieerbaar relatieveld 7'], ['[VRIJ8]', 'Zelf definieerbaar relatieveld 8'], ['[VRIJ9]', 'Zelf definieerbaar relatieveld 9'],
      ['[VRIJ10]', 'Zelf definieerbaar relatieveld 10'], ['[ABOBNUMMER]', 'Uw btw-id (indien gevuld) of OB-nummer'], ['[ABKVKNUMMER]', 'Uw KVK-nummer'],
      ['[ABONDERNEMINGSNR]', 'Uw ondernemingsnummer'],
    ],
  };

  // Angular routes of e-Boekhouden (sjabloon/email/:id and so on).
  function templateTypeOf(pathname) {
    if (/\/sjabloon\/email(?:\/|$)/i.test(pathname)) return 'mail';
    if (/\/sjabloon\/aanmaan(?:\/|$)/i.test(pathname)) return 'aanmaan';
    if (/\/sjabloon\/(?:factuur|offerte)(?:\/|$)/i.test(pathname)) return 'factuur';
    return null;
  }

  // The subject field next to the editor: `subject` on an e-mail template,
  // `onderwerp` (Onderwerp e-mail) on reminder, invoice and quote templates.
  function subjectFieldOf(doc) {
    for (const id of ['subject', 'onderwerp']) {
      const field = doc.getElementById(id);
      if (field instanceof HTMLInputElement && !field.disabled && !field.readOnly && ['text', 'search', ''].includes(field.type)) return field;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Pure helpers (also EBS.ai, for the tests)
  // -------------------------------------------------------------------------

  const VARIABLE = /\[[A-Z][A-Z0-9_]*\]/g;

  function variableCounts(text) {
    const counts = new Map();
    for (const match of String(text ?? '').matchAll(VARIABLE)) counts.set(match[0], (counts.get(match[0]) ?? 0) + 1);
    return counts;
  }

  // strict: the answer carries exactly the variables of the text (rewrite,
  // translate). Otherwise it may drop one, but never use one that is neither
  // in the text nor in the list of the template type.
  function compareVariables(before, after, { strict, known = [] }) {
    const was = variableCounts(before);
    const now = variableCounts(after);
    const missing = [...was.keys()].filter((code) => (now.get(code) ?? 0) < was.get(code));
    const added = [...now.keys()].filter((code) => (now.get(code) ?? 0) > (was.get(code) ?? 0));
    const allowed = new Set([...known.map(([code]) => code), ...was.keys()]);
    const unknown = [...now.keys()].filter((code) => !allowed.has(code));
    const ok = strict ? !missing.length && !added.length : !unknown.length;
    return { ok, missing, added: strict ? added : unknown, dropped: strict ? [] : missing.filter((code) => !now.has(code)) };
  }

  const BLOCKS = new Set(['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'tr', 'table', 'pre', 'hr']);

  // HTML to plain lines, for the differences and for previews. Text only:
  // what the user reads, not the markup.
  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(`<!doctype html><html><body>${String(html ?? '')}</body></html>`, 'text/html');
    const lines = [];
    let line = '';
    const flush = () => {
      const clean = line.replace(/[ \t ]+/g, ' ').trim();
      if (clean) lines.push(clean);
      line = '';
    };
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          line += child.nodeValue.replace(/\s+/g, ' ');
        } else if (child.nodeType === 1) {
          const tag = child.localName;
          if (['script', 'style', 'template', 'head'].includes(tag)) continue;
          if (tag === 'br') {
            flush();
            continue;
          }
          if (tag === 'td' || tag === 'th') line += ' ';
          const block = BLOCKS.has(tag);
          if (block) flush();
          walk(child);
          if (block) flush();
        }
      }
    };
    walk(doc.body);
    flush();
    return lines.join('\n');
  }

  function escapeHtml(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Plain text for insertHtml over a selection: escaped, line breaks kept.
  function textToHtml(text) {
    return escapeHtml(String(text ?? '').replace(/\r\n?/g, '\n')).replace(/\n/g, '<br>');
  }

  // Tokens for the differences: a variable is one token, a line break is
  // one, and so is a word, a run of spaces or a single sign.
  const TOKEN = /\[[A-Z][A-Z0-9_]*\]|\n|[^\S\n]+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu;
  const MAX_CELLS = 4_000_000;

  function tokens(text) {
    return String(text ?? '').match(TOKEN) ?? [];
  }

  // Word differences as [{ type: 'same' | 'del' | 'ins', text }]: the common
  // start and end first, then a longest common subsequence over the middle.
  // A very long middle falls back to "all of it removed, all of it new".
  function diffWords(before, after) {
    const a = tokens(before);
    const b = tokens(after);
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
      endA -= 1;
      endB -= 1;
    }
    const ops = [];
    const push = (type, text) => {
      if (!text) return;
      const last = ops.at(-1);
      if (last?.type === type) last.text += text;
      else ops.push({ type, text });
    };
    push('same', a.slice(0, start).join(''));
    const midA = a.slice(start, endA);
    const midB = b.slice(start, endB);
    const n = midA.length;
    const m = midB.length;
    if (n * m > MAX_CELLS) {
      push('del', midA.join(''));
      push('ins', midB.join(''));
    } else if (n || m) {
      const width = m + 1;
      const table = new Uint32Array((n + 1) * width);
      for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
          table[i * width + j] = midA[i] === midB[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
        }
      }
      let i = 0;
      let j = 0;
      while (i < n && j < m) {
        if (midA[i] === midB[j]) {
          push('same', midA[i]);
          i += 1;
          j += 1;
        } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
          push('del', midA[i]);
          i += 1;
        } else {
          push('ins', midB[j]);
          j += 1;
        }
      }
      while (i < n) push('del', midA[i++]);
      while (j < m) push('ins', midB[j++]);
    }
    push('same', a.slice(endA).join(''));
    return joinChanges(ops);
  }

  // "del Hierbij, ins Bijgaand, same ' ', del ontvangt, ins treft" reads
  // badly: a space between two changes joins them, so the proposal shows
  // "Hierbij ontvangt" against "Bijgaand treft", as a person would mark it.
  function joinChanges(ops) {
    const out = [];
    let removed = '';
    let added = '';
    const same = (text) => {
      if (!text) return;
      if (out.at(-1)?.type === 'same') out.at(-1).text += text;
      else out.push({ type: 'same', text });
    };
    const flush = () => {
      // Spaces both sides share at the edges are not part of the change.
      let lead = '';
      let tail = '';
      if (removed && added) {
        lead = /^[^\S\n]*/.exec(removed)[0];
        if (!added.startsWith(lead)) lead = '';
        tail = /[^\S\n]*$/.exec(removed)[0];
        if (!added.endsWith(tail) || tail.length >= removed.length - lead.length) tail = '';
      }
      same(lead);
      if (removed) out.push({ type: 'del', text: removed.slice(lead.length, removed.length - tail.length) });
      if (added) out.push({ type: 'ins', text: added.slice(lead.length, added.length - tail.length) });
      same(tail);
      removed = '';
      added = '';
    };
    ops.forEach((op, index) => {
      if (op.type === 'del') removed += op.text;
      else if (op.type === 'ins') added += op.text;
      else if ((removed || added) && index + 1 < ops.length && /^[^\S\n]+$/.test(op.text)) {
        removed += op.text;
        added += op.text;
      } else {
        flush();
        same(op.text);
      }
    });
    flush();
    return out.filter((op) => op.text);
  }

  // Lines of the proposal that hold a change.
  function changedParagraphs(ops) {
    let changed = 0;
    let current = false;
    for (const op of ops) {
      const parts = op.text.split('\n');
      parts.forEach((part, index) => {
        if (index > 0) {
          if (current) changed += 1;
          current = false;
        }
        if (op.type !== 'same' && (part.trim() || (op.type === 'ins' && index > 0))) current = true;
      });
    }
    if (current) changed += 1;
    return changed;
  }

  // The same allow-list as src/offscreen/sanitize.js (kept in step by
  // tests/ai-sanitize.test.mjs): the answer is cleaned there and again here,
  // right before it can reach the editor.
  const SAFE_TAGS = new Set([
    'p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup',
    'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'hr',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'font', 'img',
  ]);
  const DROP_TAGS = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'option', 'svg', 'math', 'template', 'noscript', 'video', 'audio', 'source', 'canvas', 'title', 'head']);
  const SAFE_ATTRIBUTES = {
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
  function sourceParts(original) {
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
    if (!(SAFE_ATTRIBUTES['*'].includes(name) || (SAFE_ATTRIBUTES[tag] ?? []).includes(name))) return false;
    if (name === 'style') return parts.styles.has(value) || (!UNSAFE_STYLE.test(value) && !HIDING_STYLE.test(value));
    if (name === 'src') return parts.images.has(value);
    return true;
  }

  function sanitizeHtml(html, { original = '', instruction = '' } = {}) {
    const parser = new DOMParser();
    const source = parser.parseFromString(`<!doctype html><html><body>${String(html ?? '')}</body></html>`, 'text/html');
    const out = parser.parseFromString('<!doctype html><html><body></body></html>', 'text/html');
    const parts = sourceParts(original);

    function copy(node, into) {
      for (const child of [...node.childNodes]) {
        if (child.nodeType === 3) {
          into.appendChild(out.createTextNode(child.nodeValue));
          continue;
        }
        if (child.nodeType !== 1) continue;
        const tag = child.localName;
        if (DROP_TAGS.has(tag)) continue;
        if (!SAFE_TAGS.has(tag)) {
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

  // Checks the extension does itself, next to the model's: an IBAN with a
  // wrong check digit, a KvK number that is not 8 digits, a btw number that
  // is not NL + 9 digits + B + 2 digits.
  function ibanValid(iban) {
    const clean = iban.replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(clean)) return false;
    const moved = clean.slice(4) + clean.slice(0, 4);
    let rest = 0;
    for (const char of moved) {
      const value = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
      for (const digit of value) rest = (rest * 10 + Number(digit)) % 97;
    }
    return rest === 1;
  }

  function localFindings(text) {
    const plain = String(text ?? '');
    const findings = [];
    for (const match of plain.matchAll(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g)) {
      if (!ibanValid(match[0])) findings.push({ topic: 'iban', ok: false, text: `${match[0]} lijkt geen geldig IBAN: het controlegetal klopt niet.` });
    }
    for (const match of plain.matchAll(/\bkvk(?:[- ]?(?:nummer|nr\.?))?\s*:?\s*([\d][\d .]{3,14}\d)/gi)) {
      const digits = match[1].replace(/\D/g, '');
      if (digits.length !== 8) findings.push({ topic: 'kvk', ok: false, text: `Het KvK-nummer ${match[1].trim()} heeft ${digits.length} cijfers; een KvK-nummer heeft er 8.` });
    }
    for (const match of plain.matchAll(/\b(?:btw|omzetbelasting|ob)(?:[- ]?(?:nummer|nr\.?|id))?\s*:?\s*(NL[0-9 .B]{6,20})/gi)) {
      const value = match[1].replace(/[\s.]/g, '').toUpperCase();
      if (!/^NL\d{9}B\d{2}$/.test(value)) findings.push({ topic: 'btw', ok: false, text: `Het btw-nummer ${match[1].trim()} heeft niet de vorm NL + 9 cijfers + B + 2 cijfers.` });
    }
    return findings;
  }

  const TOPICS = { aanspreekvorm: 'Aanspreekvorm', toon: 'Toon', kvk: 'KvK-nummer', btw: 'Btw-nummer', iban: 'IBAN', betaaltermijn: 'Betaaltermijn' };

  function mergeFindings(model, local) {
    const byTopic = new Map(model.map((finding) => [finding.topic, { ...finding, texts: [finding.text] }]));
    for (const finding of local) {
      const known = byTopic.get(finding.topic);
      if (known) {
        known.ok = known.ok && finding.ok;
        known.texts.push(finding.text);
      } else {
        byTopic.set(finding.topic, { topic: finding.topic, ok: finding.ok, texts: [finding.text] });
      }
    }
    return Object.keys(TOPICS).filter((topic) => byTopic.has(topic)).map((topic) => byTopic.get(topic));
  }

  EBS.define('ai', Object.freeze({
    VARIABLES, templateTypeOf, variableCounts, compareVariables, htmlToText, textToHtml, diffWords, changedParagraphs, sanitizeHtml, ibanValid, localFindings, mergeFindings,
  }));

  // -------------------------------------------------------------------------
  // Copy
  // -------------------------------------------------------------------------

  const REWRITE = [['formal', 'Formeler (u)'], ['friendly', 'Vriendelijker'], ['shorter', 'Korter'], ['clearer', 'Duidelijker'], ['spelling', 'Spelling en grammatica']];
  const TRANSLATE = [['nl', 'Naar het Nederlands'], ['en', 'Naar het Engels'], ['de', 'Naar het Duits']];
  const TITLE = {
    rewrite: { formal: 'formeler', friendly: 'vriendelijker', shorter: 'korter', clearer: 'duidelijker', spelling: 'spelling' },
    translate: { nl: 'Nederlands', en: 'Engels', de: 'Duits' },
    instruction: 'op instructie',
    subject: 'onderwerp',
    reminders: 'herinneringsreeks',
    check: 'controle',
  };
  const WORKING = {
    rewrite: 'Bezig met herschrijven…', translate: 'Bezig met vertalen…', instruction: 'Bezig met schrijven…',
    subject: 'Bezig met een onderwerp…', reminders: 'Bezig met de herinneringsreeks…', check: 'Bezig met controleren…',
  };
  const NEEDS_TEXT = {
    rewrite: 'Er is nog geen tekst om te herschrijven. Typ eerst iets, of gebruik Schrijven op instructie.',
    translate: 'Er is nog geen tekst om te vertalen.',
    check: 'Er is nog geen tekst om te controleren.',
    subject: 'Er is nog geen tekst om een onderwerp bij te bedenken.',
  };
  const MAX_CONTENT = 60_000;
  const DONE_MS = 4_000;

  function bannerText(view) {
    const label = view?.providerLabel ?? 'De aanbieder';
    switch (view?.state) {
      case 'permission': return [`AI-schrijfhulp staat aan, maar Chrome heeft nog geen toestemming gegeven voor ${label}.`, 'Toestemming geven in de extensie'];
      case 'rejected': return [`AI-schrijfhulp staat aan, maar ${label} weigert de sleutel.`, 'Sleutel controleren in de extensie'];
      case 'nomodel': return ['AI-schrijfhulp staat aan, maar er is nog geen model gekozen.', 'Model kiezen in de extensie'];
      default: return ['AI-schrijfhulp staat aan, maar er is nog geen sleutel ingesteld.', 'Instellen in de extensie'];
    }
  }

  // [text, button label, what the button does]
  function errorText(error, view) {
    const label = view?.providerLabel ?? 'De aanbieder';
    const status = error.status ? ` (${error.status})` : '';
    const unchanged = 'Je tekst is niet veranderd.';
    switch (error.code) {
      case 'auth': return [`${label} gaf een fout: de sleutel werkt niet${status}. ${unchanged}`, 'Sleutel controleren', 'settings'];
      case 'credits': return [`${label} gaf een fout: het tegoed is op${status}. ${unchanged}`, 'Instellingen openen', 'settings'];
      case 'model': return error.status
        ? [`${label} kent het model ${view?.model || ''} niet${status}. ${unchanged}`, 'Model kiezen', 'settings']
        : [`Er is nog geen model gekozen. ${unchanged}`, 'Model kiezen', 'settings'];
      case 'permission': return [`Chrome heeft de extensie geen toestemming gegeven voor ${label}. ${unchanged}`, 'Toestemming geven', 'settings'];
      case 'nokey': return [`Er is nog geen sleutel ingesteld. ${unchanged}`, 'Instellen', 'settings'];
      case 'off': return [`AI-schrijfhulp staat uit. ${unchanged}`, 'Instellingen openen', 'settings'];
      case 'rate': return [`${label} krijgt nu te veel verzoeken${status}. Probeer het zo opnieuw. ${unchanged}`, 'Opnieuw', 'retry'];
      case 'network': return [`Geen verbinding met ${label}. ${unchanged}`, 'Opnieuw', 'retry'];
      case 'timeout': return [`${label} gaf geen antwoord binnen twee minuten. ${unchanged}`, 'Opnieuw', 'retry'];
      case 'length': return [`Het antwoord was te lang en is afgebroken. Probeer een kortere tekst of een selectie. ${unchanged}`, 'Opnieuw', 'retry'];
      case 'format': return [`De AI gaf een antwoord dat de extensie niet kan lezen. ${unchanged}`, 'Opnieuw', 'retry'];
      case 'variables': return [`De AI veranderde de variabelen (${error.detail}). Daarom is er geen voorstel. ${unchanged}`, 'Opnieuw', 'retry'];
      case 'busy': return [`De AI is in dit tabblad nog met een ander verzoek bezig. ${unchanged}`, 'Opnieuw', 'retry'];
      case 'toolong': return [`De tekst is langer dan ${MAX_CONTENT.toLocaleString('nl-NL')} tekens. Selecteer een deel. ${unchanged}`, null, null];
      case 'empty': return [error.detail, null, null];
      case 'stale': return ['De tekst is veranderd sinds dit voorstel. Vraag een nieuw voorstel aan; er is niets overgenomen.', 'Opnieuw', 'retry'];
      case 'write': return ['Overnemen lukte niet: de editor nam de tekst niet aan. Er is niets veranderd.', 'Opnieuw', 'retry'];
      case 'unavailable': return ['De AI-schrijfhulp kan nu niet starten. Herlaad de pagina, of de extensie in chrome://extensions.', null, null];
      case 'provider': return [`${label} gaf een fout${status}. ${unchanged}`, 'Opnieuw', 'retry'];
      default: return [`Er ging iets mis. ${unchanged}`, 'Opnieuw', 'retry'];
    }
  }

  function variableDetail(check) {
    const parts = [];
    if (check.missing.length) parts.push(`${check.missing.join(', ')} ontbreekt`);
    if (check.added.length) parts.push(`${check.added.join(', ')} is nieuw`);
    return parts.join('; ');
  }

  // -------------------------------------------------------------------------
  // Styles (inside closed shadow roots: the page's CSS cannot reach them)
  // -------------------------------------------------------------------------

  const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const FADE = 'background-color 150ms ease, color 150ms ease, border-color 150ms ease, opacity 150ms ease';
  const STYLE = `
    :host { all: initial; display: block; }
    * { box-sizing: border-box; }
    button { font: inherit; margin: 0; }
    .ebs-icon { flex: none; }
    .bar { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 40px; padding: 6px 8px; background: #f3f1fb; border: 1px solid #e3def5; border-bottom: 0; border-radius: 8px 8px 0 0; font: 12px/1.3 Ubuntu, system-ui, -apple-system, sans-serif; color: #4b3a8f; }
    .brand { display: flex; align-items: center; gap: 6px; margin-right: 2px; font-size: 12px; font-weight: 700; color: #4b3a8f; }
    .chip { display: flex; align-items: center; gap: 4px; height: 28px; padding: 0 10px; border: 1px solid #d9d2f3; border-radius: 14px; background: #ffffff; color: #4b3a8f; font-size: 12px; cursor: pointer; transition: ${FADE}; }
    .chip:hover { background: #ebe7f8; }
    .chip.active, .chip[aria-expanded="true"] { background: #4b3a8f; border-color: #4b3a8f; color: #ffffff; }
    .chip:disabled { cursor: default; opacity: .55; }
    .chip.active:disabled { opacity: 1; cursor: progress; }
    .chip.new { animation: ebs-ai-in 150ms ${EASE} both; }
    .spacer { flex: 1; }
    .model { max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0; border: 0; background: transparent; font-size: 11px; color: #6b5fa8; cursor: pointer; transition: ${FADE}; }
    .model:hover { color: #4b3a8f; }
    .notice { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #4b3a8f; }
    .link { padding: 0; border: 0; background: transparent; color: #4b3a8f; font-size: 12px; text-decoration: underline; cursor: pointer; transition: ${FADE}; }
    .link:hover { color: #2f2363; }
    .chip:focus-visible, .model:focus-visible, .link:focus-visible, .item:focus-visible, .btn:focus-visible, .tab:focus-visible, textarea:focus-visible, .choice input:focus-visible { outline: 2px solid #4b3a8f; outline-offset: 2px; }

    .menu { position: absolute; top: calc(100% + 4px); z-index: 3; min-width: 210px; padding: 6px; background: #ffffff; border-radius: 10px; box-shadow: 0 12px 32px rgba(20, 26, 48, .22); font: 13px/1.4 Ubuntu, system-ui, -apple-system, sans-serif; color: #232c4f;
      opacity: 0; transform: scale(.97); transform-origin: top left; visibility: hidden; pointer-events: none;
      transition: opacity 150ms ${EASE}, transform 150ms ${EASE}, visibility 0s linear 150ms; }
    .menu.open { opacity: 1; transform: none; visibility: visible; pointer-events: auto; transition: opacity 150ms ${EASE}, transform 150ms ${EASE}, visibility 0s; }
    .item { display: block; width: 100%; padding: 8px 10px; border: 0; border-radius: 6px; background: transparent; color: #232c4f; font-size: 13px; text-align: left; cursor: pointer; transition: ${FADE}; }
    .item:hover, .item:focus { background: #eef1f8; outline: none; }
    .ask { width: 340px; display: flex; flex-direction: column; gap: 8px; padding: 12px; }
    .ask label { font-size: 13px; font-weight: 500; color: #232c4f; }
    .ask textarea { width: 100%; min-height: 76px; resize: vertical; padding: 8px 10px; border: 1.5px solid #cfd4e2; border-radius: 9px; font: 13px/1.5 Ubuntu, system-ui, -apple-system, sans-serif; color: #232c4f; transition: ${FADE}; }
    .ask textarea:focus { border-color: #4b3a8f; outline: none; }
    .ask .hint { font-size: 11px; color: #5d6584; }

    .anchor { position: relative; height: 0; }
    .panel { position: absolute; left: 12px; right: 12px; bottom: 12px; display: flex; flex-direction: column; gap: 10px; max-height: min(70vh, 560px); padding: 14px 16px; background: #ffffff; border: 1px solid #d9d2f3; border-radius: 12px; box-shadow: 0 16px 40px rgba(40, 30, 90, .22); font: 14px/1.6 Ubuntu, system-ui, -apple-system, sans-serif; color: #232c4f;
      opacity: 0; transform: translateY(6px); transition: opacity 150ms ${EASE}, transform 150ms ${EASE}; }
    .panel.in { opacity: 1; transform: none; }
    .panel.working { box-shadow: 0 16px 40px rgba(40, 30, 90, .18); }
    .panel.failed { flex-direction: row; align-items: center; gap: 12px; padding: 12px 16px; background: #fdf0ef; border-color: #f1c7c2; box-shadow: 0 8px 24px rgba(143, 29, 20, .12); }
    .head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .title { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: #4b3a8f; }
    .meta { font-size: 12px; color: #6b5fa8; }
    .grow { flex: 1; }
    .body { min-height: 0; overflow: auto; font-size: 14px; line-height: 1.6; }
    .body p { margin: 0 0 6px; }
    .body p:last-child { margin-bottom: 0; }
    del { background: #fde7e5; color: #8f1d14; text-decoration: line-through; }
    ins { background: #e2f2d6; color: #245c12; text-decoration: none; }
    del + ins { margin-left: 4px; }
    .quiet { font-size: 13px; color: #5d6584; }
    .actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
    .btn { height: 36px; padding: 0 14px; border: 1px solid #cfd4e2; border-radius: 9px; background: #ffffff; color: #232c4f; font-size: 13px; cursor: pointer; transition: ${FADE}; }
    .btn:hover { background: #f7f8fb; }
    .btn.plain { padding: 0 12px; border-color: transparent; background: transparent; color: #5d6584; }
    .btn.plain:hover { background: #f3f4f8; color: #232c4f; }
    .btn.primary { border-color: #4b3a8f; background: #4b3a8f; color: #ffffff; font-weight: 700; }
    .btn.primary:hover { background: #3f3079; border-color: #3f3079; }
    .btn.small { height: 30px; padding: 0 10px; }
    .btn.danger { height: 34px; padding: 0 12px; border-color: #f1c7c2; border-radius: 8px; color: #8f1d14; }
    .btn.danger:hover { background: #fff7f6; }
    .btn:disabled { cursor: default; opacity: .55; }
    .btn[aria-busy="true"] { cursor: progress; opacity: 1; }
    .error-text { flex: 1; font-size: 13px; line-height: 1.5; color: #8f1d14; }
    .close { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 7px; background: transparent; color: #8f1d14; cursor: pointer; transition: ${FADE}; }
    .close:hover { background: #fbe2df; }
    .skel { height: 10px; border-radius: 5px; background: #ebe7f8; animation: ebs-ai-shimmer 1100ms ease-in-out infinite; }
    .skel.short { width: 82%; }
    .tabs { display: flex; flex-wrap: wrap; gap: 6px; }
    .tab { height: 28px; padding: 0 10px; border: 1px solid #d9d2f3; border-radius: 14px; background: #ffffff; color: #4b3a8f; font-size: 12px; cursor: pointer; transition: ${FADE}; }
    .tab:hover { background: #ebe7f8; }
    .tab[aria-selected="true"] { background: #4b3a8f; border-color: #4b3a8f; color: #ffffff; }
    .subject-line { font-size: 13px; color: #4a5272; }
    .subject-line b { color: #232c4f; }
    .choices { display: flex; flex-direction: column; gap: 2px; }
    .choice { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 7px; font-size: 14px; cursor: pointer; transition: ${FADE}; }
    .choice:hover { background: #f3f1fb; }
    .choice input { accent-color: #4b3a8f; margin: 0; }
    .findings { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .finding { display: flex; align-items: flex-start; gap: 8px; font-size: 13px; line-height: 1.5; }
    .finding .ebs-icon { margin-top: 2px; }
    .finding.ok { color: #2f6f1a; }
    .finding.warn { color: #8a5300; }
    .finding b { color: #232c4f; font-weight: 700; }
    .finding span { color: #4a5272; }
    .done { flex-direction: row; align-items: center; gap: 8px; font-size: 13px; color: #2f6f1a; }
    @keyframes ebs-ai-shimmer { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }
    @keyframes ebs-ai-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
    @keyframes ebs-ai-fade { from { opacity: 0; } to { opacity: 1; } }
    /* Only a start: they end on the element's own opacity (a disabled button stays dimmed). */
    @keyframes ebs-ai-appear { from { opacity: 0; transform: translateY(4px); } }
    @keyframes ebs-ai-appear-fade { from { opacity: 0; } }
    /* New content in the bar (another state) and in an open panel (the
       answer after the wait) fades in instead of popping. */
    .bar > :not(.menu) { animation: ebs-ai-appear-fade 150ms ease-out; }
    .panel.swap > :not(.skel) { animation: ebs-ai-appear 150ms ${EASE}; }
    @media (prefers-reduced-motion: reduce) {
      .menu, .menu.open, .panel, .panel.in { transform: none; }
      .chip.new { animation: ebs-ai-fade 150ms ease-out both; }
      .panel.swap > :not(.skel) { animation-name: ebs-ai-appear-fade; }
      .skel { animation: none; }
    }
  `;

  // -------------------------------------------------------------------------
  // DOM helpers
  // -------------------------------------------------------------------------

  function el(tag, attributes = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
      if (value === null || value === undefined || value === false) continue;
      if (name === 'class') node.className = value;
      else if (name === 'text') node.textContent = value;
      else node.setAttribute(name, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
      if (child !== null && child !== undefined && child !== false) node.append(child);
    }
    return node;
  }

  function button(label, className, onClick, attributes = {}) {
    const node = el('button', { type: 'button', class: className, ...attributes }, label);
    node.addEventListener('click', onClick);
    return node;
  }

  function busy(node, on) {
    node.disabled = on;
    if (on) node.setAttribute('aria-busy', 'true');
    else node.removeAttribute('aria-busy');
  }

  function shadowHost(styleText, hostStyle) {
    const host = document.createElement('div');
    host.setAttribute('data-ebs-ai', '');
    host.style.cssText = hostStyle;
    const root = host.attachShadow({ mode: 'closed' });
    root.append(el('style', { text: styleText }));
    return { host, root };
  }

  // Paragraphs with <del> and <ins>, from text only (never the model's markup).
  function renderDiff(ops) {
    const body = el('div', { class: 'body' });
    let paragraph = el('p');
    body.append(paragraph);
    for (const op of ops) {
      op.text.split('\n').forEach((part, index) => {
        if (index > 0) {
          paragraph = el('p');
          body.append(paragraph);
        }
        if (!part) return;
        if (op.type === 'same') paragraph.append(part);
        else paragraph.append(el(op.type, { text: part }));
      });
    }
    for (const node of [...body.children]) {
      if (!node.textContent.trim()) node.remove();
    }
    return body;
  }

  function renderText(text) {
    const body = el('div', { class: 'body' });
    for (const line of String(text ?? '').split('\n')) {
      if (line.trim()) body.append(el('p', { text: line }));
    }
    return body;
  }

  function paragraphs(count) {
    return count === 1 ? '1 alinea' : `${count} alinea's`;
  }

  // Writes into e-Boekhouden's own input during the user's click, as typing
  // would: Angular's form listens to input and change.
  function fillInput(field, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(field, value);
    else field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  let sequence = 0;
  function callId() {
    sequence += 1;
    return `ai-${Date.now().toString(36)}-${sequence}`;
  }

  async function send(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch {
      return { error: { code: 'unavailable', status: null } };
    }
  }

  function openSettings() {
    send({ type: 'ai:settings' });
  }

  // -------------------------------------------------------------------------
  // One editor: its bar above .cke, its panel over the bottom of .cke
  // -------------------------------------------------------------------------

  let view = null;
  let viewLoaded;
  // Bars wait for the first read of aiView, so none flashes the wrong state.
  const viewReady = new Promise((resolve) => { viewLoaded = resolve; });
  const editors = new Map();

  class Editor {
    constructor(name, cke) {
      this.name = name;
      this.cke = cke;
      this.call = null;
      this.menu = null;
      this.panel = null;
      this.instruction = '';
      this.doneTimer = null;

      const top = shadowHost(STYLE, 'display:block;position:relative;z-index:20;margin:0;padding:0;');
      this.barHost = top.host;
      this.barRoot = top.root;
      this.bar = el('div', { class: 'bar' });
      this.barRoot.append(this.bar);

      const bottom = shadowHost(STYLE, 'display:block;position:relative;z-index:20;height:0;margin:0;padding:0;');
      this.anchorHost = bottom.host;
      this.anchor = el('div', { class: 'anchor' });
      bottom.root.append(this.anchor);

      cke.parentNode.insertBefore(this.barHost, cke);
      cke.parentNode.insertBefore(this.anchorHost, cke.nextSibling);
      this.syncWidth();
      if (typeof ResizeObserver === 'function') {
        this.resize = new ResizeObserver(() => this.syncWidth());
        this.resize.observe(cke);
      }
      this.onOutside = (event) => {
        if (this.menu && !event.composedPath().includes(this.barHost)) this.closeMenu();
      };
      document.addEventListener('pointerdown', this.onOutside, true);
      this.renderBar();
    }

    get connected() {
      return this.cke.isConnected;
    }

    syncWidth() {
      const width = this.cke.offsetWidth;
      for (const host of [this.barHost, this.anchorHost]) host.style.width = width ? `${width}px` : '';
      for (const host of [this.barHost, this.anchorHost]) host.style.maxWidth = '100%';
    }

    destroy() {
      this.stop({ silent: true });
      clearTimeout(this.doneTimer);
      this.resize?.disconnect();
      document.removeEventListener('pointerdown', this.onOutside, true);
      this.barHost.remove();
      this.anchorHost.remove();
    }

    // The bar, for the current aiView: the actions, or one line with a link.
    renderBar() {
      this.closeMenu();
      const subjectField = subjectFieldOf(document);
      this.bar.replaceChildren();
      this.bar.removeAttribute('role');
      this.bar.removeAttribute('aria-label');
      if (view?.state !== 'ready') {
        const [text, link] = bannerText(view);
        this.bar.append(el('span', { class: 'notice' }, EBS.icon('sparkles', { size: 14 }), el('span', {}, `${text} `, button(link, 'link', openSettings))));
        this.chips = null;
        return;
      }
      this.bar.setAttribute('role', 'toolbar');
      this.bar.setAttribute('aria-label', 'AI-schrijfhulp');
      const chip = (label, onClick, { menu = false, key } = {}) => {
        const node = button([label, menu ? EBS.icon('chevron-down', { size: 14 }) : null], 'chip', onClick, menu ? { 'aria-haspopup': 'menu', 'aria-expanded': 'false' } : {});
        node.dataset.action = key;
        return node;
      };
      this.chips = {
        rewrite: chip('Herschrijven', (event) => this.toggleMenu('rewrite', event.currentTarget), { menu: true, key: 'rewrite' }),
        instruction: chip('Schrijven op instructie', (event) => this.toggleMenu('instruction', event.currentTarget), { key: 'instruction' }),
        translate: chip('Vertalen', (event) => this.toggleMenu('translate', event.currentTarget), { menu: true, key: 'translate' }),
        check: chip('Controleren', () => this.start('check'), { key: 'check' }),
        reminders: chip('Herinneringsreeks', () => this.start('reminders'), { key: 'reminders' }),
      };
      if (subjectField) this.chips.subject = chip('Onderwerp voorstellen', () => this.start('subject'), { key: 'subject' });
      this.chips.instruction.setAttribute('aria-haspopup', 'dialog');
      this.chips.instruction.setAttribute('aria-expanded', 'false');
      const model = button(`${view.providerLabel} · ${view.model}`, 'model', openSettings, { title: 'Instellingen van de AI-schrijfhulp' });
      this.bar.append(el('span', { class: 'brand' }, EBS.icon('sparkles', { size: 14 }), 'AI-schrijfhulp'), ...Object.values(this.chips), el('span', { class: 'spacer' }), model);
      this.syncChips();
    }

    // A subject field that turns up later gets its chip, fading in.
    refreshSubject() {
      if (!this.chips || this.chips.subject || !subjectFieldOf(document)) return;
      const node = button('Onderwerp voorstellen', 'chip new', () => this.start('subject'));
      node.dataset.action = 'subject';
      this.chips.subject = node;
      this.chips.reminders.after(node);
      this.syncChips();
    }

    syncChips() {
      if (!this.chips) return;
      for (const [key, node] of Object.entries(this.chips)) {
        const active = this.call?.request.action === key;
        node.classList.toggle('active', active && Boolean(this.panel));
        node.disabled = Boolean(this.call?.running);
        if (active && this.call?.running) node.setAttribute('aria-busy', 'true');
        else node.removeAttribute('aria-busy');
      }
    }

    // ---- menus ------------------------------------------------------------

    toggleMenu(kind, chipNode) {
      if (this.menu?.kind === kind) {
        this.closeMenu({ focus: true });
        return;
      }
      this.closeMenu();
      let menu;
      if (kind === 'instruction') {
        const textarea = el('textarea', { id: 'ebs-ai-ask', placeholder: 'Bijvoorbeeld: een korte mail bij de factuur, met dank voor de opdracht', maxlength: 2000 });
        textarea.value = this.instruction;
        const go = button('Schrijven', 'btn primary small', () => submit());
        const submit = () => {
          const instruction = textarea.value.trim();
          if (!instruction) {
            textarea.focus();
            return;
          }
          this.instruction = instruction;
          this.closeMenu();
          this.start('instruction', null, { instruction });
        };
        textarea.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        });
        textarea.addEventListener('input', () => { this.instruction = textarea.value; });
        menu = el('div', { class: 'menu ask', role: 'dialog', 'aria-label': 'Schrijven op instructie' },
          el('label', { for: 'ebs-ai-ask', text: 'Wat moet de AI schrijven?' }),
          textarea,
          el('span', { class: 'hint', text: 'Met een selectie past de AI alleen dat deel aan. Ctrl+Enter schrijft.' }),
          el('span', { class: 'actions' }, button('Annuleren', 'btn plain small', () => this.closeMenu({ focus: true })), go));
      } else {
        const items = (kind === 'rewrite' ? REWRITE : TRANSLATE).map(([option, label]) => button(label, 'item', () => {
          this.closeMenu();
          this.start(kind, option);
        }, { role: 'menuitem', tabindex: '-1' }));
        menu = el('div', { class: 'menu', role: 'menu', 'aria-label': kind === 'rewrite' ? 'Herschrijven' : 'Vertalen' }, items);
      }
      menu.addEventListener('keydown', (event) => this.menuKey(event));
      this.bar.append(menu);
      // Under its chip, but inside the bar when the chip is far right.
      const room = this.bar.clientWidth - menu.offsetWidth;
      menu.style.left = `${Math.max(0, room > 0 ? Math.min(chipNode.offsetLeft, room) : 0)}px`;
      this.menu = { kind, node: menu, chip: chipNode };
      chipNode.setAttribute('aria-expanded', 'true');
      // Next frame: the transition needs the closed state painted first.
      requestAnimationFrame(() => {
        menu.classList.add('open');
        (menu.querySelector('textarea') ?? menu.querySelector('.item'))?.focus({ preventScroll: true });
      });
    }

    menuKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.closeMenu({ focus: true });
        return;
      }
      if (event.key === 'Tab' && this.menu?.kind !== 'instruction') {
        this.closeMenu();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || this.menu?.kind === 'instruction') return;
      event.preventDefault();
      const items = [...this.menu.node.querySelectorAll('.item')];
      const at = items.indexOf(this.barRoot.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }

    closeMenu({ focus = false } = {}) {
      if (!this.menu) return;
      const { node, chip } = this.menu;
      this.menu = null;
      chip.setAttribute('aria-expanded', 'false');
      node.classList.remove('open');
      setTimeout(() => node.remove(), 160);
      if (focus) chip.focus();
    }

    // ---- the panel --------------------------------------------------------

    showPanel(className, children, { role, label } = {}) {
      clearTimeout(this.doneTimer);
      let panel = this.panel;
      const swap = Boolean(panel);
      if (!panel) {
        panel = el('div', { class: 'panel' });
        panel.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            this.discard();
          }
        });
        this.anchor.append(panel);
        this.panel = panel;
        requestAnimationFrame(() => panel.classList.add('in'));
      }
      panel.className = `panel ${className}${panel.classList.contains('in') ? ' in' : ''}${swap ? ' swap' : ''}`;
      for (const name of ['role', 'aria-label', 'aria-live']) panel.removeAttribute(name);
      if (role) panel.setAttribute('role', role);
      if (label) panel.setAttribute('aria-label', label);
      panel.replaceChildren(...children);
      this.syncChips();
      return panel;
    }

    hidePanel() {
      clearTimeout(this.doneTimer);
      const panel = this.panel;
      this.panel = null;
      this.syncChips();
      if (!panel) return;
      panel.classList.remove('in');
      panel.style.pointerEvents = 'none';
      setTimeout(() => panel.remove(), 160);
    }

    discard() {
      this.stop({ silent: true });
      this.call = null;
      this.hidePanel();
    }

    // ---- one action -------------------------------------------------------

    async start(action, option = null, extra = {}) {
      if (this.call?.running) return;
      this.closeMenu();
      const call = { id: callId(), running: true, request: { action, option } };
      this.call = call;
      this.syncChips();
      const subjectField = subjectFieldOf(document);
      let html;
      let selection;
      try {
        [html, selection] = await Promise.all([
          EBS.bridge.call('ckeditor.getData', { name: this.name }),
          EBS.bridge.call('ckeditor.getSelectionText', { name: this.name }),
        ]);
      } catch {
        this.fail(call, { code: 'unavailable' });
        return;
      }
      if (this.call !== call) return;
      const useSelection = ['rewrite', 'translate', 'instruction'].includes(action) && selection.trim().length > 0;
      const content = useSelection ? selection : html;
      if (NEEDS_TEXT[action] && !htmlToText(content).trim()) {
        this.fail(call, { code: 'empty', detail: NEEDS_TEXT[action] });
        return;
      }
      if (content.length > MAX_CONTENT) {
        this.fail(call, { code: 'toolong' });
        return;
      }
      const templateType = templateTypeOf(location.pathname);
      call.request = {
        action,
        option,
        format: useSelection ? 'text' : 'html',
        scope: useSelection ? 'selection' : 'all',
        content,
        instruction: extra.instruction ?? '',
        subject: action === 'subject' && subjectField ? subjectField.value.slice(0, 500) : '',
        templateType,
        variables: templateType ? VARIABLES[templateType] : [],
      };
      call.original = { html, selection };
      this.showWorking(call);
      const answer = await send({ type: 'ai:run', id: call.id, request: call.request });
      if (this.call !== call || !call.running) return;
      call.running = false;
      if (answer?.error) {
        if (answer.error.code === 'aborted') return;
        this.fail(call, answer.error);
        return;
      }
      if (!answer?.result) {
        this.fail(call, { code: 'unavailable' });
        return;
      }
      this.propose(call, answer.result);
    }

    showWorking(call) {
      const stop = button('Stoppen', 'btn plain small', () => this.stop());
      this.showPanel('working', [
        el('span', { class: 'head' }, el('span', { class: 'title' }, EBS.icon('sparkles', { size: 14 }), WORKING[call.request.action]), el('span', { class: 'grow' }), stop),
        el('span', { class: 'skel' }),
        el('span', { class: 'skel short' }),
      ], { role: 'status' });
    }

    stop({ silent = false } = {}) {
      const call = this.call;
      if (!call?.running) return;
      call.running = false;
      send({ type: 'ai:abort', id: call.id });
      this.call = null;
      if (!silent) this.hidePanel();
      this.syncChips();
    }

    retry() {
      const request = this.call?.request;
      if (!request) return;
      this.call = null;
      this.start(request.action, request.option, { instruction: request.instruction });
    }

    fail(call, error) {
      if (this.call !== call) return;
      call.running = false;
      const [text, label, kind] = errorText(error, view);
      const close = el('button', { type: 'button', class: 'close', 'aria-label': 'Sluiten' }, EBS.icon('x', { size: 16 }));
      close.addEventListener('click', () => this.discard());
      const act = label ? button(label, 'btn danger', () => (kind === 'settings' ? openSettings() : this.retry())) : null;
      this.showPanel('failed', [el('span', { class: 'error-text', text }), act, close], { role: 'alert' });
    }

    title(call) {
      const { action, option } = call.request;
      const name = typeof TITLE[action] === 'string' ? TITLE[action] : TITLE[action][option];
      return action === 'translate' ? `Voorstel: vertaling naar het ${name}` : action === 'check' ? 'Controle' : `Voorstel: ${name}`;
    }

    head(call, meta) {
      return el('span', { class: 'head' }, el('span', { class: 'title' }, EBS.icon('sparkles', { size: 14 }), this.title(call)), meta ? el('span', { class: 'meta', text: meta }) : null);
    }

    propose(call, result) {
      const { action } = call.request;
      const known = call.request.variables;
      if (action === 'check') {
        this.showCheck(call, result);
        return;
      }
      if (action === 'subject') {
        const before = call.request.content;
        const subjects = (result.subjects ?? []).filter((subject) => compareVariables(before, subject, { strict: false, known }).ok);
        if (!subjects.length) {
          const first = compareVariables(before, result.subjects?.[0] ?? '', { strict: false, known });
          this.fail(call, { code: 'variables', detail: variableDetail(first) });
          return;
        }
        this.showSubjects(call, subjects);
        return;
      }
      if (action === 'reminders') {
        const steps = [];
        for (const step of result.steps ?? []) {
          const content = sanitizeHtml(step.content, { original: call.original.html });
          const check = compareVariables(call.original.html, `${step.subject} ${content}`, { strict: false, known });
          if (!check.ok) {
            this.fail(call, { code: 'variables', detail: `${step.title}: ${variableDetail(check)}` });
            return;
          }
          steps.push({ ...step, content });
        }
        this.showReminders(call, steps);
        return;
      }
      const html = call.request.format === 'html';
      const content = html ? sanitizeHtml(result.content, { original: call.request.content, instruction: call.request.instruction }) : String(result.content ?? '');
      const strict = action === 'rewrite' || action === 'translate';
      const check = compareVariables(call.request.content, content, { strict, known });
      if (!check.ok) {
        this.fail(call, { code: 'variables', detail: variableDetail(check) });
        return;
      }
      call.proposal = content;
      const before = html ? htmlToText(call.request.content) : call.request.content;
      const after = html ? htmlToText(content) : content;
      const ops = diffWords(before, after);
      const changed = changedParagraphs(ops);
      const meta = [
        strict ? 'variabelen ongewijzigd' : check.dropped.length ? `${check.dropped.join(', ')} weggelaten` : 'variabelen gecontroleerd',
        changed ? paragraphs(changed) : null,
        call.request.scope === 'selection' ? 'selectie' : null,
      ].filter(Boolean).join(' · ');
      const take = button('Overnemen in de tekst', 'btn primary', (event) => this.apply(call, event.currentTarget));
      if (!changed) take.disabled = true;
      this.showPanel('proposal', [
        this.head(call, meta),
        changed ? renderDiff(ops) : el('p', { class: 'quiet', text: 'De AI vond niets om te veranderen.' }),
        el('span', { class: 'actions' }, button('Opnieuw', 'btn plain', () => this.retry()), button('Weggooien', 'btn', () => this.discard()), take),
      ], { role: 'dialog', label: 'Voorstel van de AI-schrijfhulp' });
    }

    // The text must be what the proposal was made from: anything typed since
    // would be lost. Reading and writing both happen inside this click.
    async apply(call, node, html = call.proposal) {
      if (this.call !== call) return;
      busy(node, true);
      const selection = call.request.scope === 'selection';
      try {
        const now = selection
          ? await EBS.bridge.call('ckeditor.getSelectionText', { name: this.name })
          : await EBS.bridge.call('ckeditor.getData', { name: this.name });
        if (now !== (selection ? call.original.selection : call.original.html)) {
          this.fail(call, { code: 'stale' });
          return;
        }
        if (selection) await EBS.bridge.call('ckeditor.insertHtml', { name: this.name, html: textToHtml(html) });
        else await EBS.bridge.call('ckeditor.setData', { name: this.name, html });
      } catch {
        if (this.call === call) this.fail(call, { code: 'write' });
        return;
      }
      this.done('Overgenomen in de tekst. Opslaan doe je zelf, met de knop van e-Boekhouden.');
    }

    done(text) {
      this.call = null;
      this.showPanel('done', [EBS.icon('circle-check', { size: 16 }), el('span', { text })], { role: 'status' });
      this.doneTimer = setTimeout(() => this.hidePanel(), DONE_MS);
    }

    showSubjects(call, subjects) {
      const field = subjectFieldOf(document);
      const group = `ebs-ai-subject-${call.id}`;
      const choices = el('div', { class: 'choices', role: 'radiogroup', 'aria-label': 'Onderwerpen' }, subjects.map((subject, index) => {
        const input = el('input', { type: 'radio', name: group, value: String(index) });
        input.checked = index === 0;
        return el('label', { class: 'choice' }, input, el('span', { text: subject }));
      }));
      const picked = () => subjects[Number(choices.querySelector('input:checked')?.value ?? 0)];
      const take = field
        ? button('Overnemen als onderwerp', 'btn primary', () => {
          fillInput(field, picked());
          this.done('Overgenomen als onderwerp. Opslaan doe je zelf, met de knop van e-Boekhouden.');
        })
        : button('Kopiëren', 'btn primary', async (event) => {
          const node = event.currentTarget;
          if (await copyText(picked())) node.textContent = 'Gekopieerd';
        });
      this.showPanel('proposal', [
        this.head(call, 'variabelen gecontroleerd'),
        choices,
        el('span', { class: 'actions' }, button('Opnieuw', 'btn plain', () => this.retry()), button('Weggooien', 'btn', () => this.discard()), take),
      ], { role: 'dialog', label: 'Voorstel van de AI-schrijfhulp' });
    }

    showReminders(call, steps) {
      const field = subjectFieldOf(document);
      let current = 0;
      const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Herinneringsreeks' });
      const area = el('div', { role: 'tabpanel' });
      const tabNodes = steps.map((step, index) => {
        const tab = el('button', { type: 'button', class: 'tab', role: 'tab', text: step.title });
        tab.addEventListener('click', () => select(index));
        tab.addEventListener('keydown', (event) => {
          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
          event.preventDefault();
          select((index + (event.key === 'ArrowRight' ? 1 : -1) + steps.length) % steps.length, true);
        });
        return tab;
      });
      tabs.append(...tabNodes);
      const select = (index, focus = false) => {
        current = index;
        tabNodes.forEach((tab, at) => {
          tab.setAttribute('aria-selected', String(at === index));
          tab.tabIndex = at === index ? 0 : -1;
        });
        if (focus) tabNodes[index].focus();
        const step = steps[index];
        area.replaceChildren(
          step.subject ? el('p', { class: 'subject-line' }, 'Onderwerp: ', el('b', { text: step.subject })) : null,
          renderText(htmlToText(step.content)),
        );
        subjectButton?.toggleAttribute('disabled', !step.subject);
      };
      call.proposal = null;
      const take = button('Overnemen in de tekst', 'btn primary', (event) => {
        call.request.scope = 'all';
        this.apply(call, event.currentTarget, steps[current].content);
      });
      const copy = button('Kopiëren', 'btn', async (event) => {
        const node = event.currentTarget;
        const step = steps[current];
        if (await copyText([step.subject, htmlToText(step.content)].filter(Boolean).join('\n\n'))) node.textContent = 'Gekopieerd';
        setTimeout(() => { node.textContent = 'Kopiëren'; }, 2000);
      });
      const subjectButton = field ? button('Onderwerp overnemen', 'btn', () => {
        fillInput(field, steps[current].subject);
        this.done('Onderwerp overgenomen. Opslaan doe je zelf, met de knop van e-Boekhouden.');
      }) : null;
      select(0);
      this.showPanel('proposal', [
        this.head(call, `${steps.length} e-mails · variabelen gecontroleerd · elk sjabloon sla je zelf op`),
        tabs,
        area,
        el('span', { class: 'actions' }, button('Opnieuw', 'btn plain', () => this.retry()), button('Weggooien', 'btn', () => this.discard()), copy, subjectButton, take),
      ], { role: 'dialog', label: 'Voorstel van de AI-schrijfhulp' });
    }

    showCheck(call, result) {
      const findings = mergeFindings(result.findings ?? [], localFindings(htmlToText(call.request.content)));
      const warnings = findings.filter((finding) => !finding.ok).length;
      const list = el('ul', { class: 'findings' }, findings.map((finding) => el('li', { class: `finding ${finding.ok ? 'ok' : 'warn'}` },
        EBS.icon(finding.ok ? 'circle-check' : 'triangle-alert', { size: 14 }),
        el('span', {}, el('b', { text: `${TOPICS[finding.topic]}: ` }), finding.texts.join(' ')))));
      this.showPanel('proposal', [
        this.head(call, warnings ? `${warnings} ${warnings === 1 ? 'punt' : 'punten'} om naar te kijken` : 'alles in orde'),
        el('div', { class: 'body' }, list),
        el('span', { class: 'actions' }, button('Opnieuw', 'btn plain', () => this.retry()), button('Sluiten', 'btn', () => this.discard())),
      ], { role: 'dialog', label: 'Controle van de AI-schrijfhulp' });
    }
  }

  // -------------------------------------------------------------------------
  // Finding editors: CKEditor 4 puts its UI in <div id="cke_<name>"
  // class="cke ... cke_chrome"> next to the textarea it replaces.
  // -------------------------------------------------------------------------

  let enabled = false;
  let observer = null;
  let scanQueued = false;
  let scanning = null;
  const containers = document.getElementsByClassName('cke_chrome');

  function candidates() {
    return [...containers].filter((node) => node.id.startsWith('cke_') && node.classList.contains('cke') && node.parentNode);
  }

  async function scan() {
    scanQueued = false;
    for (const [name, editor] of [...editors]) {
      if (!editor.connected || !enabled) {
        editor.destroy();
        editors.delete(name);
      }
    }
    if (!enabled) return;
    for (const editor of editors.values()) editor.refreshSubject();
    const fresh = candidates().filter((node) => !editors.has(node.id.slice(4)) || editors.get(node.id.slice(4)).cke !== node);
    if (!fresh.length) return;
    await viewReady;
    if (!(await EBS.bridge.ready())) return;
    if (!EBS.bridge.isEnabled('ckeditor')) EBS.bridge.enable('ckeditor');
    let instances;
    try {
      instances = await EBS.bridge.call('ckeditor.list');
    } catch {
      return;
    }
    if (!enabled || !Array.isArray(instances)) return;
    const writable = new Set(instances.filter((entry) => entry && typeof entry.name === 'string' && !entry.readOnly).map((entry) => entry.name));
    for (const node of fresh) {
      const name = node.id.slice(4);
      if (!writable.has(name) || !node.isConnected) continue;
      editors.get(name)?.destroy();
      editors.set(name, new Editor(name, node));
    }
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    // One scan at a time; a change during a scan queues the next.
    const run = () => {
      scanning = scan().finally(() => { scanning = null; });
    };
    setTimeout(() => (scanning ? scanning.then(run) : run()), 50);
  }

  function start() {
    if (enabled) return;
    enabled = true;
    observer = new MutationObserver((records) => {
      // Our own hosts change nothing that matters.
      if (records.every((record) => [...record.addedNodes, ...record.removedNodes].every((node) => node.nodeType === 1 && node.hasAttribute?.('data-ebs-ai')))) return;
      if (containers.length || editors.size) queueScan();
    });
    observer.observe(document.documentElement ?? document, { childList: true, subtree: true });
    if (containers.length) queueScan();
  }

  // Off: every bar and panel goes, a running call is stopped. The bridge's
  // ckeditor hook stays on: other features may use it too.
  function stop() {
    if (!enabled) return;
    enabled = false;
    observer?.disconnect();
    observer = null;
    for (const editor of editors.values()) editor.destroy();
    editors.clear();
  }

  function setView(next) {
    const changed = JSON.stringify(next ?? null) !== JSON.stringify(view);
    view = next && typeof next === 'object' ? next : null;
    if (changed) for (const editor of editors.values()) editor.renderBar();
  }

  try {
    chrome.storage.local.get('aiView').then(({ aiView }) => {
      setView(aiView);
      viewLoaded();
    }, () => viewLoaded());
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.aiView) setView(changes.aiView.newValue);
    });
  } catch {
    // An orphaned script after an extension reload: it stays off.
    viewLoaded();
  }

  EBS.watchSettings((settings) => {
    if (settings.aiWriter) start();
    else stop();
  });
})();
