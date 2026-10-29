// EB Sessions: the e-mail and invoice templates in Better design. Setting: betterDesign.
//
// Three screens of e-Boekhouden's Angular shell (secure20) get a new view
// around their own fields. e-Boekhouden's controls stay the source of truth:
// every save is e-Boekhouden's own button, clicked by the user (or our button
// that clicks it during the user's click). The extension never fills in,
// saves or sends anything by itself.
//
//   /beheer/sjabloon/email/:id | toevoegen     app-email-sjabloon-form
//     The real fields restyled, a live preview of the editor's text with
//     sample data (or one invoice the user picks), the variables of the
//     template's kind with click to insert, suggestions after typing "[",
//     and soft warnings for unknown, misspelled or missing codes.
//   /beheer/sjabloon/factuur/:id | copy/:id      app-factuur-sjabloon-form
//     Three parts of e-Boekhouden in one screen, each with its own native
//     save: 1 the template form (this page), 2 the columns
//     (/beheer/sjabloonregel/:id in a frame), 3 the server's template editor
//     (/v1/api/factuursjabloon/editor/:id/ in a dialog). A schematic preview
//     with sample data, "Sjabloon bekijken" for e-Boekhouden's own file.
//   /beheer/sjabloonregel/:id                    app-factuur-sjabloon-regel-form
//     The columns restyled: drag or arrow keys on the handle click
//     e-Boekhouden's own up and down arrows, and a width total.
//
// Requests (EBS.request, read-only): none on load. Opening the invoice picker
// is a click and loads the invoice list once (one bulk GET); picking one
// invoice is one item GET for that invoice. Never one per row.
//
// The AI writing help is a separate feature (ai.js); it may add its own bar
// to the same CKEditor.

(() => {
  if (window.__ebsTemplatesLoaded) return;
  window.__ebsTemplatesLoaded = true;
  const { EBS } = window;
  if (!EBS) return;

  // ---------------------------------------------------------------------------
  // The variables, copied from e-Boekhouden's own help screens in its bundle:
  // app-factuur-mailen-uitleg-popup (e-mails with an invoice, 31 codes),
  // app-mailinglijst-uitleg-popup ("Sjablooncodes nieuwsbrief", 15) and
  // app-factuur-sjabloon-uitleg-popup (invoice templates, 66 rows; one row
  // has two spellings, and [KVK] is listed twice there). For quotes
  // e-Boekhouden has no list of its own.
  // ---------------------------------------------------------------------------

  const VARIABLES = {
    mail: [
      [['RELBEDRIJF'], 'De bedrijfsnaam van uw relatie'],
      [['RELCONTACTPERSOON'], 'De contactpersoon van uw relatie'],
      [['RELCODE'], 'De code van uw relatie'],
      [['RELAANHEF'], 'De aanhef van uw relatie'],
      [['RELADRES'], 'Het adres van uw relatie'],
      [['RELPOSTCODE'], 'De postcode van uw relatie'],
      [['RELPLAATS'], 'De plaats van uw relatie'],
      [['RELLAND'], 'Het land van uw relatie'],
      [['RELADRES2'], 'Het vestigingsadres van uw relatie'],
      [['RELPOSTCODE2'], 'De vestigingspostcode van uw relatie'],
      [['RELPLAATS2'], 'De vestigingsplaats van uw relatie'],
      [['RELLAND2'], 'Het land van uw relatie'],
      [['RELEMAIL'], 'E-mailadres relatie'],
      [['RELEMAILFACTUUR'], 'E-mailadres tbv facturen van relatie'],
      [['RELIBAN'], 'De iban uit de machtiging'],
      [['RELSEPAMACHTIGINGID'], 'Het machtigingskenmerk uit de machtiging'],
      [['RELBTWNR'], 'Het btw-nummer van uw relatie'],
      [['FACTDATUM'], 'De factuurdatum'],
      [['VERVALDATUM'], 'De vervaldatum van uw factuur'],
      [['FACTNUMMER'], 'Factuurnummer'],
      [['FACTKENMERK'], 'Het kenmerk van uw factuur'],
      [['FACTTERMIJN'], 'Betalingstermijn'],
      [['TOTAAL'], 'Het totaalbedrag van uw factuur, inclusief btw'],
      [['ABBEDRIJF'], 'Uw bedrijfsnaam'],
      [['ABADRES'], 'Uw adres'],
      [['ABPOSTCODE'], 'Uw postcode'],
      [['ABPLAATS'], 'Uw plaats'],
      [['ABTELEFOON'], 'Uw telefoonnummer'],
      [['ABEMAIL'], 'Uw e-mailadres'],
      [['ABWEBSITE'], 'Het adres van uw website'],
      [['ABOBNUMMER'], 'Uw btw-id (indien gevuld) of OB-nummer'],
    ],
    nieuwsbrief: [
      [['RELBEDRIJF'], 'De bedrijfsnaam van uw relatie'],
      [['RELCONTACTPERSOON'], 'De contactpersoon van uw relatie'],
      [['RELCODE'], 'De code van uw relatie'],
      [['RELAANHEF'], 'De aanhef van uw relatie'],
      [['RELADRES'], 'Het adres van uw relatie'],
      [['RELPOSTCODE'], 'De postcode van uw relatie'],
      [['RELPLAATS'], 'De plaats van uw relatie'],
      [['RELLAND'], 'Het land van uw relatie'],
      [['RELADRES2'], 'Het vestigingsadres van uw relatie'],
      [['RELPOSTCODE2'], 'De vestigingspostcode van uw relatie'],
      [['RELPLAATS2'], 'De vestigingsplaats van uw relatie'],
      [['RELLAND2'], 'Het land van uw relatie'],
      [['RELIBAN'], 'De iban uit de machtiging'],
      [['RELSEPAMACHTIGINGID'], 'Het machtigingskenmerk uit de machtiging'],
      [['RELBTWNR'], 'Het btw-nummer van uw relatie'],
    ],
    factuur: [
      [['BEDRIJF'], 'De bedrijfsnaam van uw relatie'],
      [['CP'], 'De contactpersoon van uw relatie'],
      [['CODE'], 'De code van uw relatie'],
      [['KVK'], 'Het KVK-nr van uw relatie'],
      [['AANHEF'], 'De aanhef van uw relatie'],
      [['ADRES'], 'Het adres van uw relatie'],
      [['POSTCODE'], 'De postcode van uw relatie'],
      [['PLAATS'], 'De plaats van uw relatie'],
      [['LAND'], 'Het land van uw relatie'],
      [['TELEFOON', 'RELTELEFOONNUMMER'], 'Telefoonnummer van uw relatie'],
      [['ADRES1'], 'Het vestigingsadres van uw relatie'],
      [['POSTCODE1'], 'De postcode van uw relatie'],
      [['PLAATS1'], 'De plaats van uw relatie'],
      [['LAND1'], 'Het land van uw relatie'],
      [['ADRES2'], 'Het postadres van uw relatie'],
      [['POSTCODE2'], 'De postcode van uw relatie'],
      [['PLAATS2'], 'De plaats van uw relatie'],
      [['LAND2'], 'Het land van uw relatie'],
      [['EMAIL'], 'Het e-mailadres van uw relatie'],
      [['EMAILFACTUUR'], 'Het e-mailadres van uw relatie tbv facturen'],
      [['VRIJ1'], 'Vrij relatieveld #1'],
      [['VRIJ2'], 'Vrij relatieveld #2'],
      [['VRIJ3'], 'Vrij relatieveld #3'],
      [['VRIJ4'], 'Vrij relatieveld #4'],
      [['VRIJ5'], 'Vrij relatieveld #5'],
      [['VRIJ6'], 'Vrij relatieveld #6'],
      [['VRIJ7'], 'Vrij relatieveld #7'],
      [['VRIJ8'], 'Vrij relatieveld #8'],
      [['VRIJ9'], 'Vrij relatieveld #9'],
      [['VRIJ10'], 'Vrij relatieveld #10'],
      [['IBAN'], 'De iban uit de machtiging'],
      [['MACHTIGINGID'], 'Het machtigingskenmerk uit de machtiging'],
      [['BTWNR'], 'Het btw-nummer van uw relatie'],
      [['DATUM'], 'De factuurdatum'],
      [['NUMMER'], 'Factuurnummer'],
      [['KENMERK'], 'Het kenmerk van uw factuur'],
      [['TERMIJN'], 'Betalingstermijn'],
      [['NOTITIE'], 'Opmerkingen'],
      [['VARTEKST'], 'Variabele factuurtekst'],
      [['VDATUM'], 'Vervaldatum'],
      [['LAAN'], 'Lijst met aantallen van de producten/diensten'],
      [['LEEN'], 'Lijst met eenheden van de producten/diensten'],
      [['LCODE'], 'Lijst met codes van de producten/diensten'],
      [['LOM'], 'Lijst met omschrijvingen van de producten/diensten'],
      [['LE'], 'Lijst met eurotekens van de producten/diensten'],
      [['LPPE'], 'Lijst met prijs per eenheid van de producten/diensten'],
      [['LKORT'], 'Lijst met kortingen van de producten/diensten'],
      [['LOPSL'], 'Lijst met opslagen van de producten/diensten'],
      [['LKO'], 'Lijst met kortingen en/of opslagen van de producten/diensten'],
      [['LTOT'], 'Lijst met totaalprijzen van de producten/diensten'],
      [['LBTW'], 'Lijst met BTW-percentages van de producten/diensten'],
      [['TOT_EX'], 'Totaalbedrag excl BTW van de factuur'],
      [['LST_BTW_OM'], 'Lijst met BTW-omschrijvingen'],
      [['LEB'], 'Lijst met eurotekens van BTW\'s'],
      [['LST_BTW'], 'Lijst met BTW-bedragen'],
      [['TOTAAL'], 'Totaal bedrag incl BTW van de factuur'],
      [['FACTUURREGELS'], 'Tabel met alle factuurregels'],
      [['ABBEDRIJF'], 'Uw bedrijfsnaam'],
      [['ABADRES'], 'Uw adres'],
      [['ABPOSTCODE'], 'Uw postcode'],
      [['ABPLAATS'], 'Uw plaats'],
      [['ABTELEFOON'], 'Uw telefoonnummer'],
      [['ABEMAIL'], 'Uw e-mailadres'],
      [['ABWEBSITE'], 'Het adres van uw website'],
      [['ABOBNUMMER'], 'Uw btw-id (indien gevuld) of OB-nummer'],
      [['ABIBAN'], 'Uw iban'],
    ],
  };

  const INVOICE_CODES = new Set(['DATUM', 'NUMMER', 'KENMERK', 'TERMIJN', 'NOTITIE', 'VARTEKST', 'VDATUM']);
  const LINE_CODES = new Set(['LAAN', 'LEEN', 'LCODE', 'LOM', 'LE', 'LPPE', 'LKORT', 'LOPSL', 'LKO', 'LTOT', 'LBTW']);
  const TOTAL_CODES = new Set(['TOT_EX', 'LST_BTW_OM', 'LEB', 'LST_BTW', 'TOTAAL', 'FACTUURREGELS']);

  function groupOf(kind, code) {
    if (code.startsWith('AB')) return 'Uw bedrijf';
    if (kind === 'factuur') {
      if (INVOICE_CODES.has(code)) return 'Factuur';
      if (LINE_CODES.has(code)) return 'Regels';
      if (TOTAL_CODES.has(code)) return 'Totalen';
      return 'Relatie';
    }
    if (code.startsWith('REL')) return 'Relatie';
    return 'Factuur';
  }

  const GROUP_ORDER = ['Factuur', 'Totalen', 'Regels', 'Relatie', 'Uw bedrijf'];

  // [{ code: '[FACTNUMMER]', name: 'FACTNUMMER', aliases: [], label, group }]
  // in e-Boekhouden's order; one entry per row of its list.
  function variablesOf(kind) {
    const seen = new Set();
    const list = [];
    for (const [names, label] of VARIABLES[kind] ?? []) {
      if (seen.has(names[0])) continue;
      seen.add(names[0]);
      list.push({ code: `[${names[0]}]`, name: names[0], aliases: names.slice(1), label, group: groupOf(kind, names[0]) });
    }
    return list;
  }

  // Codes of several kinds together (an e-mail template can be for invoices
  // and newsletters at once), each once, in the order of the first kind.
  function variablesFor(kinds) {
    const byName = new Map();
    for (const kind of kinds) {
      for (const entry of variablesOf(kind)) if (!byName.has(entry.name)) byName.set(entry.name, entry);
    }
    return [...byName.values()];
  }

  function grouped(list) {
    const groups = new Map();
    for (const entry of list) {
      if (!groups.has(entry.group)) groups.set(entry.group, []);
      groups.get(entry.group).push(entry);
    }
    return GROUP_ORDER.filter((title) => groups.has(title)).map((title) => ({ title, items: groups.get(title) }));
  }

  // The codes that belong in a template of that kind, with the warning when
  // they are missing (subject and text together).
  const IMPORTANT = {
    mail: [
      ['FACTNUMMER', 'Het factuurnummer ontbreekt: e-mails bij een factuur noemen meestal [FACTNUMMER].'],
      ['TOTAAL', 'Het bedrag ontbreekt: e-mails bij een factuur noemen meestal [TOTAAL].'],
      ['RELAANHEF', 'De aanhef ontbreekt: e-mails bij een factuur beginnen meestal met [RELAANHEF].'],
    ],
    nieuwsbrief: [
      ['RELAANHEF', 'De aanhef ontbreekt: een nieuwsbrief begint meestal met [RELAANHEF].'],
    ],
    factuur: [],
  };

  // The same thing under another name in the other list: a code from an
  // invoice template in a mail, or the other way round.
  const CROSS = {
    mail: { FACTNR: 'FACTNUMMER', FACTUURNUMMER: 'FACTNUMMER', NUMMER: 'FACTNUMMER', DATUM: 'FACTDATUM', VDATUM: 'VERVALDATUM', TERMIJN: 'FACTTERMIJN', KENMERK: 'FACTKENMERK', BEDRIJF: 'RELBEDRIJF', AANHEF: 'RELAANHEF', CP: 'RELCONTACTPERSOON', CODE: 'RELCODE', BTWNR: 'RELBTWNR', EMAIL: 'RELEMAIL', EMAILFACTUUR: 'RELEMAILFACTUUR' },
    factuur: { FACTNR: 'NUMMER', FACTUURNUMMER: 'NUMMER', FACTNUMMER: 'NUMMER', FACTDATUM: 'DATUM', VERVALDATUM: 'VDATUM', FACTTERMIJN: 'TERMIJN', FACTKENMERK: 'KENMERK', RELBEDRIJF: 'BEDRIJF', RELAANHEF: 'AANHEF', RELCONTACTPERSOON: 'CP', RELCODE: 'CODE', RELBTWNR: 'BTWNR', RELEMAIL: 'EMAIL', RELEMAILFACTUUR: 'EMAILFACTUUR' },
  };

  // ---------------------------------------------------------------------------
  // Sample data for the preview. Made-up names only.
  // ---------------------------------------------------------------------------

  const SAMPLE = {
    RELBEDRIJF: 'Demo Klant B.V.', RELCONTACTPERSOON: 'dhr. De Vries', RELCODE: 'DEMO01', RELAANHEF: 'Geachte heer De Vries',
    RELADRES: 'Klantweg 8', RELPOSTCODE: '4321 CD', RELPLAATS: 'Klantdorp', RELLAND: 'Nederland',
    RELADRES2: 'Klantweg 8', RELPOSTCODE2: '4321 CD', RELPLAATS2: 'Klantdorp', RELLAND2: 'Nederland',
    RELEMAIL: 'info@demo-klant.test', RELEMAILFACTUUR: 'facturen@demo-klant.test', RELIBAN: 'NL00DEMO0000000011',
    RELSEPAMACHTIGINGID: 'MACHT-0001', RELBTWNR: 'NL000000000B01',
    FACTDATUM: '12-10-2026', VERVALDATUM: '26-10-2026', FACTNUMMER: 'VB-0001', FACTKENMERK: 'Project Demo', FACTTERMIJN: '14',
    TOTAAL: '€ 242,00',
    ABBEDRIJF: 'Demo Holding B.V.', ABADRES: 'Voorbeeldstraat 1', ABPOSTCODE: '1234 AB', ABPLAATS: 'Demostad',
    ABTELEFOON: '010 000 00 00', ABEMAIL: 'info@demo-holding.test', ABWEBSITE: 'www.demo-holding.test', ABOBNUMMER: 'NL000000000B02',
    ABIBAN: 'NL00DEMO0000000022',
    BEDRIJF: 'Demo Klant B.V.', CP: 'dhr. De Vries', CODE: 'DEMO01', KVK: '00000000', AANHEF: 'Geachte heer De Vries',
    ADRES: 'Klantweg 8', POSTCODE: '4321 CD', PLAATS: 'Klantdorp', LAND: 'Nederland', TELEFOON: '020 000 00 00', RELTELEFOONNUMMER: '020 000 00 00',
    ADRES1: 'Klantweg 8', POSTCODE1: '4321 CD', PLAATS1: 'Klantdorp', LAND1: 'Nederland',
    ADRES2: 'Postbus 1', POSTCODE2: '4320 AA', PLAATS2: 'Klantdorp', LAND2: 'Nederland',
    EMAIL: 'info@demo-klant.test', EMAILFACTUUR: 'facturen@demo-klant.test', IBAN: 'NL00DEMO0000000011', MACHTIGINGID: 'MACHT-0001',
    BTWNR: 'NL000000000B01', DATUM: '12-10-2026', NUMMER: 'VB-0001', KENMERK: 'Project Demo', TERMIJN: '14', NOTITIE: 'Voorbeeldopmerking',
    VARTEKST: 'Voorbeeldtekst', VDATUM: '26-10-2026', TOT_EX: '€ 200,00',
  };
  for (let i = 1; i <= 10; i += 1) SAMPLE[`VRIJ${i}`] = `Vrij veld ${i}`;

  // The invoice of the schematic preview, as sample.
  const SAMPLE_INVOICE = {
    number: 'VB-0001', date: '12-10-2026', due: '26-10-2026', relation: 'Demo Klant B.V.', total: 242, totalEx: 200,
    lines: [{ AANTAL: '2', CODE: 'VB01', OMSCHRIJVING: 'Voorbeeldregel', REGELTOTAAL: '200,00', BTWPERC: '21%', PPE: '100,00', EENHEID: 'stuk', EURO: '€', KORTING: '' }],
  };

  // The columns e-Boekhouden offers (fieldOptions of the regel form).
  const COLUMN_OPTIONS = {
    AANTAL: { title: 'Aantal', width: '10' },
    CODE: { title: 'Code', width: '15' },
    OMSCHRIJVING: { title: 'Omschrijving', width: '*' },
    REGELTOTAAL: { title: 'Regeltotaal', width: '15' },
    BTWPERC: { title: 'BTW', width: '12' },
    PPE: { title: 'P.p.e.', width: '15' },
    EENHEID: { title: 'Eenheid', width: '15' },
    EURO: { title: 'Euro-teken', width: '5' },
    KORTING: { title: 'Korting', width: '10' },
  };

  const LABELS = {
    NL: { invoice: 'Factuur', date: 'Factuurdatum', due: 'Vervaldatum', total: 'Totaal' },
    EN: { invoice: 'Invoice', date: 'Invoice date', due: 'Due date', total: 'Total' },
  };

  // ---------------------------------------------------------------------------
  // Pure helpers (also used by the tests through EBS.templates)
  // ---------------------------------------------------------------------------

  const CODE_PATTERN = /\[([A-Za-z][A-Za-z0-9_]*)\]/g;

  // Every [CODE] in a text: [{ code: '[X]', name: 'X', index }].
  function findCodes(text) {
    const found = [];
    for (const match of String(text ?? '').matchAll(CODE_PATTERN)) found.push({ code: match[0], name: match[1], index: match.index });
    return found;
  }

  function distance(a, b) {
    if (a === b) return 0;
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const current = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
        previous = current;
      }
    }
    return row[b.length];
  }

  // The known code a misspelled one most likely means, or null.
  function suggest(name, kind, known) {
    const upper = name.toUpperCase();
    const names = known.flatMap((entry) => [entry.name, ...entry.aliases]);
    if (names.includes(upper)) return upper;
    const cross = CROSS[kind]?.[upper];
    if (cross && names.includes(cross)) return cross;
    let best = null;
    let bestDistance = Infinity;
    const limit = upper.length <= 4 ? 1 : 2;
    for (const candidate of names) {
      const d = distance(upper, candidate);
      if (d < bestDistance) {
        best = candidate;
        bestDistance = d;
      }
    }
    return bestDistance <= limit ? best : null;
  }

  // Soft checks of a template's texts: unknown or misspelled codes and the
  // important codes that are missing. A message, never a block: the lists
  // may be incomplete. kinds: ['mail'], ['mail', 'nieuwsbrief'], ...
  function checkTemplate(kinds, texts) {
    const known = variablesFor(kinds);
    const names = new Set(known.flatMap((entry) => [entry.name, ...entry.aliases]));
    const kind = kinds.includes('factuur') ? 'factuur' : 'mail';
    const all = texts.join('\n');
    const used = new Set();
    const unknown = [];
    for (const { code, name } of findCodes(all)) {
      if (names.has(name)) {
        used.add(name);
        continue;
      }
      const suggestion = suggest(name, kind, known);
      // "[zie bijlage]" or "[x]" is just text; a code is in capitals or close to one.
      if (!suggestion && !/^[A-Z0-9_]+$/.test(name)) continue;
      if (!unknown.some((one) => one.code === code)) unknown.push({ code, suggestion: suggestion ? `[${suggestion}]` : null });
    }
    const missing = [];
    for (const kindName of kinds) {
      for (const [name, text] of IMPORTANT[kindName] ?? []) {
        if (!used.has(name) && names.has(name) && !missing.some((one) => one.code === `[${name}]`)) missing.push({ code: `[${name}]`, text });
      }
    }
    return { used, unknown, missing, ok: !unknown.length && !missing.length };
  }

  // The lines under the editor, in the board's words.
  function checkMessages(result, kinds) {
    const lines = [];
    for (const { code, suggestion } of result.unknown) {
      lines.push({ tone: 'warn', text: suggestion ? `${code} staat niet in de lijst van e-Boekhouden. Bedoel je ${suggestion}?` : `${code} staat niet in de lijst van e-Boekhouden.` });
    }
    for (const { text } of result.missing) lines.push({ tone: 'warn', text });
    if (!lines.length) {
      const invoiceMail = kinds.includes('mail') && result.used.has('FACTNUMMER') && result.used.has('TOTAAL');
      lines.push({ tone: 'ok', text: invoiceMail ? 'Alle variabelen bestaan. Het factuurnummer en het bedrag staan erin.' : 'Alle variabelen staan in de lijst van e-Boekhouden.' });
    }
    return lines;
  }

  // Codes that start with what was typed after "[" (case does not matter).
  function suggestionsFor(prefix, list, max = 8) {
    const needle = String(prefix ?? '').toUpperCase();
    const starts = list.filter((entry) => entry.name.startsWith(needle));
    const contains = list.filter((entry) => !entry.name.startsWith(needle) && entry.name.includes(needle));
    return [...starts, ...contains].slice(0, max);
  }

  function normalizeSpace(text) {
    return String(text ?? '').replace(/[\s\u00a0\u200b]+/g, ' ').trim();
  }

  // Values of codes, read from e-Boekhouden's own filled-in copy of the saved
  // template: the saved text with codes against the filled text. A code with
  // no text between it and the next one is ambiguous and stays unknown.
  function alignValues(source, filled) {
    const src = normalizeSpace(source);
    const out = normalizeSpace(filled);
    const codes = findCodes(src);
    if (!codes.length || codes.length > 60 || src.length > 20_000 || out.length > 40_000) return {};
    const literals = [];
    let at = 0;
    for (const { code, index } of codes) {
      literals.push(src.slice(at, index));
      at = index + code.length;
    }
    literals.push(src.slice(at));
    const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*');
    const pattern = literals.map(escape).join('(.*?)');
    let match;
    try {
      match = new RegExp(`^${pattern}$`, 's').exec(out);
    } catch {
      return {};
    }
    if (!match) return {};
    const values = {};
    codes.forEach(({ name }, i) => {
      const ambiguous = literals[i + 1] === '' && i + 1 < codes.length;
      const value = match[i + 1]?.trim();
      if (!ambiguous && value !== undefined && !(name in values)) values[name] = value;
    });
    return values;
  }

  // "2026-10-12T00:00:00" or "12-10-2026" -> "12-10-2026"; anything else as it is.
  function formatDate(value) {
    const text = String(value ?? '').trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    if (iso) return `${iso[3]}-${iso[2]}-${iso[1]}`;
    return text;
  }

  function money(value) {
    const number = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(number) ? `€ ${EBS.formatMoney(number)}` : '';
  }

  function pick(object, keys) {
    for (const key of keys) {
      const value = object?.[key];
      if (value !== undefined && value !== null && value !== '') return value;
    }
    return null;
  }

  // One row of e-Boekhouden's invoice list (factuur/normaal/gridtable).
  function invoiceFromRow(row) {
    if (!row || typeof row !== 'object') return null;
    const id = Number(pick(row, ['id', 'factuurId', 'Id']));
    if (!Number.isInteger(id) || id <= 0) return null;
    const number = String(pick(row, ['nummer', 'factuurnummer', 'factuurNummer', 'Nummer']) ?? '');
    const relation = String(pick(row, ['relatie', 'bedrijf', 'relatieBedrijf', 'relatieNaam']) ?? '');
    return {
      id,
      number,
      relation,
      date: formatDate(pick(row, ['datum', 'factuurDatum'])),
      due: formatDate(pick(row, ['uitersteBetaaldatum', 'vervaldatum'])),
      total: Number(pick(row, ['bedragIncl', 'totaalIncl', 'totaal'])),
      totalEx: Number(pick(row, ['bedragExcl', 'totaalExcl'])),
      reference: String(pick(row, ['kenmerk']) ?? ''),
      text: String(pick(row, ['factuurTekst', 'factuurtekst']) ?? ''),
    };
  }

  function invoicesFromGrid(answer) {
    const rows = Array.isArray(answer) ? answer : Array.isArray(answer?.data) ? answer.data : Array.isArray(answer?.rows) ? answer.rows : [];
    const list = rows.map(invoiceFromRow).filter(Boolean);
    const key = (one) => one.date.split('-').reverse().join('');
    return list.sort((a, b) => key(b).localeCompare(key(a)) || b.id - a.id);
  }

  // What the list row says about the codes of a mail and an invoice template.
  function valuesFromInvoice(invoice) {
    if (!invoice) return {};
    const values = {};
    const put = (names, value) => {
      if (value === '' || value === null || value === undefined || Number.isNaN(value)) return;
      for (const name of names) values[name] = String(value);
    };
    put(['FACTNUMMER', 'NUMMER'], invoice.number);
    put(['FACTDATUM', 'DATUM'], invoice.date);
    put(['VERVALDATUM', 'VDATUM'], invoice.due);
    put(['RELBEDRIJF', 'BEDRIJF'], invoice.relation);
    put(['FACTKENMERK', 'KENMERK'], invoice.reference);
    if (Number.isFinite(invoice.total)) put(['TOTAAL'], money(invoice.total));
    if (Number.isFinite(invoice.totalEx)) put(['TOT_EX'], money(invoice.totalEx));
    return values;
  }

  // Lines of one invoice (factuur/:id), as far as their shape is known.
  // The names are e-Boekhouden's model names where the bundle shows them;
  // the rest is a guess that falls back to nothing.
  function linesFromInvoice(answer) {
    const list = pick(answer, ['regels', 'factuurRegels', 'factuurregels', 'items', 'lines']);
    if (!Array.isArray(list)) return null;
    const text = (value) => (value === null || value === undefined ? '' : String(value));
    const amount = (value) => (Number.isFinite(Number(value)) && value !== '' && value !== null ? EBS.formatMoney(Number(value)) : text(value));
    const lines = list.slice(0, 20).map((line) => ({
      AANTAL: text(pick(line, ['aantal'])),
      CODE: text(pick(line, ['code', 'artikelCode'])),
      OMSCHRIJVING: text(pick(line, ['omschrijving'])),
      PPE: amount(pick(line, ['prijsPerEenheid', 'ppe', 'prijs'])),
      BTWPERC: text(pick(line, ['btwPercentage', 'btwPerc', 'btw'])),
      REGELTOTAAL: amount(pick(line, ['totaal', 'regelTotaal', 'bedrag'])),
      EENHEID: text(pick(line, ['eenheid'])),
      EURO: '€',
      KORTING: text(pick(line, ['korting'])),
    }));
    return lines.length ? lines : null;
  }

  // Widths of the columns: '*' is Omschrijving, which gets the rest.
  function widthSummary(columns) {
    let fixed = 0;
    for (const column of columns) {
      if (column.width === '*' || column.id === 'OMSCHRIJVING') continue;
      const number = Number(String(column.width ?? '').replace(',', '.'));
      if (Number.isFinite(number)) fixed += number;
    }
    fixed = Math.round(fixed * 10) / 10;
    const rest = Math.max(0, Math.round((100 - fixed) * 10) / 10);
    return { fixed, rest, over: fixed > 100, text: `${String(fixed).replace('.', ',')}% vast · Omschrijving ${String(rest).replace('.', ',')}%` };
  }

  // The native clicks for moving a column from one place to another: one
  // click on the moving row's own arrow per step, as the user would.
  function moveSteps(from, to) {
    const steps = [];
    const dir = to < from ? 'up' : 'down';
    for (let at = from; at !== to; at += dir === 'up' ? -1 : 1) steps.push({ index: at, dir });
    return steps;
  }

  // ---------------------------------------------------------------------------
  // The preview: the editor's HTML, cleaned, with the codes filled in.
  // ---------------------------------------------------------------------------

  const KEEP = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'A', 'UL', 'OL', 'LI', 'SPAN', 'DIV', 'FONT', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'HR', 'SMALL', 'SUB', 'SUP', 'PRE', 'CODE']);
  const DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'NOSCRIPT', 'SVG', 'MATH', 'LINK', 'META', 'BASE', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA']);

  // Page text into our DOM: parsed in an inert document, only plain text
  // markup kept, no attributes but a safe href, no images (they would load).
  function sanitize(html, doc = document) {
    const parsed = new DOMParser().parseFromString(`<!doctype html><body>${String(html ?? '')}</body>`, 'text/html');
    const fragment = doc.createDocumentFragment();
    const copy = (node, into) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          into.append(doc.createTextNode(child.data));
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          const tag = child.tagName;
          if (DROP.has(tag)) continue;
          if (tag === 'IMG') {
            const alt = child.getAttribute('alt');
            into.append(doc.createTextNode(alt ? `[afbeelding: ${alt}]` : '[afbeelding]'));
            continue;
          }
          if (!KEEP.has(tag)) {
            copy(child, into);
            continue;
          }
          const clean = doc.createElement(tag === 'FONT' ? 'span' : tag.toLowerCase());
          if (tag === 'A') {
            const href = child.getAttribute('href') ?? '';
            if (/^(https?:|mailto:)/i.test(href.trim())) clean.setAttribute('href', href.trim());
            clean.setAttribute('target', '_blank');
            clean.setAttribute('rel', 'noopener noreferrer');
          }
          if ((tag === 'TD' || tag === 'TH') && /^\d{1,2}$/.test(child.getAttribute('colspan') ?? '')) clean.setAttribute('colspan', child.getAttribute('colspan'));
          copy(child, clean);
          into.append(clean);
        }
      }
    };
    copy(parsed.body, fragment);
    return fragment;
  }

  function htmlText(html) {
    return new DOMParser().parseFromString(`<!doctype html><body>${String(html ?? '')}</body>`, 'text/html').body.textContent ?? '';
  }

  // Text nodes of a subtree with their offsets in the joined text, so a code
  // split over several nodes ("[FACT<b>NUMMER</b>]") is still found.
  function textMap(rootNode) {
    const nodes = [];
    let text = '';
    const walker = rootNode.ownerDocument.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      nodes.push({ node, start: text.length });
      text += node.data;
    }
    const locate = (offset) => {
      for (let i = nodes.length - 1; i >= 0; i -= 1) {
        if (offset >= nodes[i].start) return { node: nodes[i].node, offset: Math.min(offset - nodes[i].start, nodes[i].node.data.length) };
      }
      return null;
    };
    return { text, locate };
  }

  function rangeFor(map, start, end) {
    const from = map.locate(start);
    const to = map.locate(end);
    if (!from || !to) return null;
    const range = from.node.ownerDocument.createRange();
    try {
      range.setStart(from.node, from.offset);
      range.setEnd(to.node, to.offset);
    } catch {
      return null;
    }
    return range;
  }

  // The codes in a subtree replaced by their value (bold), unknown codes kept
  // and marked, codes without a value marked as such.
  function fillCodes(container, { values, known, missingTitle }) {
    const map = textMap(container);
    const names = new Set(known.flatMap((entry) => [entry.name, ...entry.aliases]));
    const doc = container.ownerDocument;
    for (const found of findCodes(map.text).reverse()) {
      const range = rangeFor(map, found.index, found.index + found.code.length);
      if (!range) continue;
      let node;
      if (!names.has(found.name)) {
        node = doc.createElement('span');
        node.className = 'ebs-tpl-unknown';
        node.textContent = found.code;
      } else if (values[found.name] === undefined || values[found.name] === '') {
        node = doc.createElement('span');
        node.className = 'ebs-tpl-novalue';
        node.title = missingTitle;
        node.textContent = found.code;
      } else {
        node = doc.createElement('b');
        node.textContent = values[found.name];
      }
      range.deleteContents();
      range.insertNode(node);
    }
  }

  EBS.define('templates', Object.freeze({
    variablesOf, variablesFor, grouped, findCodes, suggest, checkTemplate, checkMessages, suggestionsFor,
    alignValues, formatDate, invoiceFromRow, invoicesFromGrid, valuesFromInvoice, linesFromInvoice,
    widthSummary, moveSteps, sanitize, fillCodes, SAMPLE,
  }));

  // ---------------------------------------------------------------------------
  // From here on: the page.
  // ---------------------------------------------------------------------------

  if (!/^secure\d*\.e-boekhouden\.nl$/.test(location.hostname)) return;

  const EMAIL_PAGE = /^\/beheer\/sjabloon\/email\/(?:toevoegen|\d+)\/?$/;
  const INVOICE_PAGE = /^\/beheer\/sjabloon\/factuur\/(?:(copy)\/)?(\d+)\/?$/;
  const COLUMNS_PAGE = /^\/beheer\/sjabloonregel\/(\d+)\/?$/;
  const INVOICE_LIST = /^\/beheer\/sjabloon\/factuur\/?$/;
  const COLUMNS_FRAME = 'ebs-tpl-columns';
  const API = `${location.origin}/v1/api/`;
  const SCREENS = { email: 'templates-email', invoice: 'templates-invoice', columns: 'templates-columns' };

  let settings = EBS.settingsWithDefaults();
  let settingsLoaded = false;
  let classicScreens = {};

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, text, onClick) {
    const node = el('button', className, text);
    node.type = 'button';
    if (onClick) node.addEventListener('click', onClick);
    return node;
  }

  // TODO-merge: arrow-up and arrow-down are not in src/icons.js yet (see the
  // report, "Shared changes requested"). Until then the same Lucide paths
  // (lucide-static 1.63.0, ISC) are built here the way icons.js builds them.
  const LOCAL_ICONS = {
    'arrow-up': ['m5 12 7-7 7 7', 'M12 19V5'],
    'arrow-down': ['M12 5v14', 'm19 12-7 7-7-7'],
  };

  function icon(name, options = {}) {
    if (EBS.icon.has(name)) return EBS.icon(name, options);
    const paths = LOCAL_ICONS[name];
    if (!paths) return EBS.icon(name, options);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    const size = String(options.size ?? 16);
    for (const [key, value] of [['width', size], ['height', size], ['viewBox', '0 0 24 24'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['focusable', 'false'], ['aria-hidden', 'true']]) svg.setAttribute(key, value);
    svg.setAttribute('class', `ebs-icon lucide lucide-${name}`);
    for (const d of paths) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      svg.append(path);
    }
    return svg;
  }

  function screenOf() {
    const path = location.pathname;
    if (window.name === COLUMNS_FRAME && window !== window.top) return (COLUMNS_PAGE.test(path) || INVOICE_LIST.test(path)) ? 'frame' : null;
    if (EMAIL_PAGE.test(path)) return 'email';
    if (INVOICE_PAGE.test(path)) return 'invoice';
    if (COLUMNS_PAGE.test(path)) return 'columns';
    return null;
  }

  function useBetter(screen) {
    if (!settings.betterDesign || !screen) return false;
    if (screen === 'frame') return true;
    return !classicScreens[SCREENS[screen]];
  }

  function setClassic(screen, classic) {
    classicScreens = { ...classicScreens, [SCREENS[screen]]: classic };
    try {
      chrome.storage.local.set({ classicScreens });
    } catch { /* an orphaned script after a reload: nothing to store into */ }
    schedule();
  }

  // e-Boekhouden's own back link ("Terug").
  function nativeBack(scope) {
    return scope?.querySelector('app-goback a') ?? null;
  }

  function clickNative(node) {
    if (!node) return false;
    node.click();
    return true;
  }

  // A small "Opgeslagen" style status that fades in place (space reserved).
  function status(node, text, tone = 'ok') {
    node.textContent = text;
    node.dataset.tone = tone;
    node.classList.remove('show');
    // Restart the fade for a repeated message.
    void node.offsetWidth;
    node.classList.add('show');
  }

  // The way back on the classic screen, in e-Boekhouden's own link style.
  const backLink = {
    node: null,
    mount(before, screen) {
      if (!this.node) {
        this.node = el('div', 'ebs-tpl-native-toggle');
        const link = el('a', '', 'Nieuwe weergave');
        link.href = '#';
        link.setAttribute('role', 'button');
        link.addEventListener('click', (event) => {
          event.preventDefault();
          setClassic(this.node.dataset.screen, false);
        });
        this.node.append(link);
      }
      this.node.dataset.screen = screen;
      if (this.node.nextElementSibling !== before) before.before(this.node);
    },
    unmount() {
      this.node?.remove();
    },
  };

  // ---------------------------------------------------------------------------
  // A listbox popover: the "[" suggestions and the invoice picker.
  // ---------------------------------------------------------------------------

  function listbox({ label, className = '' }) {
    const node = el('div', `ebs-tpl-pop ${className}`.trim());
    node.setAttribute('role', 'listbox');
    node.setAttribute('aria-label', label);
    node.id = `ebs-tpl-list-${Math.random().toString(36).slice(2, 9)}`;
    const box = {
      node,
      items: [],
      active: 0,
      onPick: null,
      set(items, { footer = null, emptyText = '' } = {}) {
        this.items = items;
        this.active = Math.min(this.active, Math.max(0, items.length - 1));
        node.replaceChildren();
        items.forEach((item, index) => {
          const option = el('div', 'ebs-tpl-option');
          option.setAttribute('role', 'option');
          option.id = `${node.id}-${index}`;
          option.append(el('span', 'ebs-tpl-option-main', item.main));
          if (item.sub) option.append(el('span', 'ebs-tpl-option-sub', item.sub));
          option.addEventListener('mousedown', (event) => event.preventDefault());
          option.addEventListener('click', () => this.onPick?.(item, index));
          option.addEventListener('mousemove', () => this.highlight(index));
          node.append(option);
        });
        if (!items.length && emptyText) node.append(el('div', 'ebs-tpl-pop-empty', emptyText));
        if (footer) node.append(footer);
        this.highlight(this.active);
      },
      highlight(index, scroll = false) {
        this.active = index;
        node.querySelectorAll('.ebs-tpl-option').forEach((option, at) => option.setAttribute('aria-selected', String(at === index)));
        if (scroll) node.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' });
      },
      move(delta) {
        if (!this.items.length) return;
        this.highlight((this.active + delta + this.items.length) % this.items.length, true);
      },
      activeId() {
        return this.items.length ? `${node.id}-${this.active}` : '';
      },
    };
    return box;
  }

  function popIn(node) {
    node.classList.remove('ebs-tpl-pop-in');
    void node.offsetWidth;
    node.classList.add('ebs-tpl-pop-in');
  }

  // ---------------------------------------------------------------------------
  // The invoice picker: "Voorbeeldgegevens" or one invoice of the user's.
  // The list is one bulk GET, loaded on the click that opens the picker; an
  // invoice's data is one item GET on the click that picks it.
  // ---------------------------------------------------------------------------

  function invoicePicker({ onChange, canPick }) {
    const wrap = el('span', 'ebs-tpl-picker');
    const toggle = button('ebs-tpl-picker-button');
    const toggleText = el('span', 'ebs-tpl-picker-text', 'Voorbeeldgegevens');
    toggle.append(toggleText, icon('chevron-down', { size: 14 }));
    toggle.setAttribute('aria-haspopup', 'listbox');
    toggle.setAttribute('aria-expanded', 'false');
    const panel = el('div', 'ebs-tpl-picker-panel');
    panel.hidden = true;
    const search = el('input', 'ebs-tpl-picker-search');
    search.type = 'search';
    search.placeholder = 'Zoek factuur of relatie';
    search.setAttribute('aria-label', 'Zoek factuur of relatie');
    const box = listbox({ label: 'Gegevens voor het voorbeeld', className: 'inline' });
    const note = el('div', 'ebs-tpl-picker-note');
    note.setAttribute('role', 'status');
    panel.append(search, box.node, note);
    wrap.append(toggle, panel);

    const state = { invoices: null, loading: false, error: '', open: false, choice: null };

    function items() {
      const needle = search.value.trim().toLowerCase();
      const list = [{ main: 'Voorbeeldgegevens', sub: 'Zonder keuze vult het voorbeeld deze in', invoice: null }];
      for (const invoice of state.invoices ?? []) {
        const label = `Factuur ${invoice.number}${invoice.relation ? ` · ${invoice.relation}` : ''}`;
        if (needle && !label.toLowerCase().includes(needle)) continue;
        list.push({ main: label, sub: [invoice.date, Number.isFinite(invoice.total) ? money(invoice.total) : ''].filter(Boolean).join(' · '), invoice });
      }
      return list;
    }

    function draw() {
      const reason = canPick();
      note.textContent = reason || (state.loading ? 'Bezig met laden…' : state.error);
      box.set(reason ? items().slice(0, 1) : items(), { emptyText: '' });
    }

    function close() {
      if (!state.open) return;
      state.open = false;
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onOutside, true);
    }

    function onOutside(event) {
      if (!wrap.contains(event.target)) close();
    }

    async function load() {
      if (state.invoices || state.loading || canPick()) return;
      state.loading = true;
      state.error = '';
      draw();
      try {
        const answer = await EBS.request.bulk('templates:invoices', `${API}factuur/normaal/gridtable?offset=0&limit=50&orderBy=&sortDirection=`);
        state.invoices = invoicesFromGrid(answer);
        if (!state.invoices.length) state.error = 'Geen facturen gevonden.';
      } catch (error) {
        state.error = error?.code === 'rate' ? 'Even wachten: er lopen al verzoeken. Probeer het zo opnieuw.' : 'De facturen konden niet worden geladen. Probeer het later opnieuw.';
      } finally {
        state.loading = false;
        draw();
      }
    }

    function open() {
      state.open = true;
      panel.hidden = false;
      popIn(panel);
      toggle.setAttribute('aria-expanded', 'true');
      document.addEventListener('pointerdown', onOutside, true);
      draw();
      search.focus();
      load();
    }

    toggle.addEventListener('click', () => (state.open ? close() : open()));
    search.addEventListener('input', () => {
      box.active = 0;
      draw();
    });
    search.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        box.move(event.key === 'ArrowDown' ? 1 : -1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const item = box.items[box.active];
        if (item) choose(item);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
        toggle.focus();
      }
    });
    box.onPick = (item) => choose(item);

    function choose(item) {
      state.choice = item.invoice;
      toggleText.textContent = item.invoice ? item.main : 'Voorbeeldgegevens';
      close();
      toggle.focus();
      onChange(item.invoice);
    }

    return {
      node: wrap,
      reset() {
        state.choice = null;
        toggleText.textContent = 'Voorbeeldgegevens';
      },
      refresh: draw,
    };
  }

  function requestNote(text) {
    const node = el('span', 'ebs-tpl-badge request', text);
    return node;
  }

  function assumption(text) {
    return el('span', 'ebs-tpl-badge assume', text);
  }

  // ---------------------------------------------------------------------------
  // The CKEditor of the e-mail template: read through the DOM of its frame
  // (same origin), written only through EBS.bridge during the user's click
  // or key (ckeditor.insertHtml).
  // ---------------------------------------------------------------------------

  const ckeditor = {
    container(scope) {
      return scope.querySelector('app-wysiwyg-input .cke') ?? null;
    },
    name(scope) {
      const box = this.container(scope);
      return box?.id?.startsWith('cke_') ? box.id.slice(4) : null;
    },
    frame(scope) {
      return this.container(scope)?.querySelector('iframe.cke_wysiwyg_frame, .cke_contents iframe') ?? null;
    },
    document(scope) {
      try {
        return this.frame(scope)?.contentDocument ?? null;
      } catch {
        return null;
      }
    },
    source(scope) {
      return this.container(scope)?.querySelector('textarea.cke_source') ?? null;
    },
    // The editor's text as HTML, from what the user sees.
    html(scope) {
      const source = this.source(scope);
      if (source) return source.value;
      const body = this.document(scope)?.body;
      if (body) return body.innerHTML;
      // Before CKEditor is there: the textarea it replaces.
      return scope.querySelector('app-wysiwyg-input textarea')?.value ?? '';
    },
    async insert(scope, text) {
      const name = this.name(scope);
      if (!name || !EBS.bridge) return false;
      if (!EBS.bridge.isEnabled('ckeditor')) EBS.bridge.enable('ckeditor');
      try {
        await EBS.bridge.call('ckeditor.insertHtml', { name, html: text });
        return true;
      } catch (error) {
        console.warn('EB Sessions: inserting into the editor failed', error?.message ?? error);
        return false;
      }
    },
  };

  // Highlights in the editor without touching its text (CSS Custom
  // Highlight API inside the editor's frame): known codes as chips, unknown
  // ones with an orange line. Nothing is added to what CKEditor saves.
  function paintHighlights(doc, known) {
    const view = doc?.defaultView;
    const registry = view?.CSS?.highlights;
    if (!registry || typeof view.Highlight !== 'function' || !doc.body) return;
    if (!doc.getElementById('ebs-tpl-highlight-style')) {
      const style = doc.createElement('style');
      style.id = 'ebs-tpl-highlight-style';
      style.textContent = '::highlight(ebs-tpl-var){background-color:#eef1f8;color:#2a4a9a}::highlight(ebs-tpl-unknown){background-color:#fff1dc;text-decoration:underline 2px #e08a00}';
      (doc.head ?? doc.documentElement).append(style);
    }
    const names = new Set(known.flatMap((entry) => [entry.name, ...entry.aliases]));
    const map = textMap(doc.body);
    const good = [];
    const bad = [];
    for (const found of findCodes(map.text)) {
      const range = rangeFor(map, found.index, found.index + found.code.length);
      if (!range) continue;
      if (names.has(found.name)) good.push(range);
      else if (/^[A-Z0-9_]+$/.test(found.name) || suggest(found.name, 'mail', known)) bad.push(range);
    }
    registry.set('ebs-tpl-var', new view.Highlight(...good));
    registry.set('ebs-tpl-unknown', new view.Highlight(...bad));
  }

  // ---------------------------------------------------------------------------
  // "[" suggestions, in the editor and in the subject field.
  // ---------------------------------------------------------------------------

  const suggest$ = {
    box: null,
    target: null, // { kind: 'editor' | 'input', doc, input, start, prefix }
    list: [],
    owner: null,

    ensure() {
      if (this.box) return;
      this.box = listbox({ label: 'Variabelen', className: 'floating' });
      const hint = el('div', 'ebs-tpl-pop-hint');
      hint.append(icon('arrow-up', { size: 14 }), icon('arrow-down', { size: 14 }), el('span', '', 'kiezen · Enter invoegen · Esc sluiten'));
      this.hint = hint;
      this.box.node.hidden = true;
      this.box.onPick = (item) => this.insert(item.entry);
      document.body.append(this.box.node);
    },

    // What was typed after the last "[" before the caret, if that is a code in the making.
    tokenBefore(text) {
      const match = /\[([A-Za-z0-9_]{0,24})$/.exec(text);
      return match ? { prefix: match[1], length: match[0].length } : null;
    },

    update(target, rect) {
      this.ensure();
      const items = suggestionsFor(target.prefix, this.list).map((entry) => ({ main: entry.code, sub: entry.label, entry }));
      if (!items.length) {
        this.close();
        return;
      }
      const wasOpen = !this.box.node.hidden;
      this.target = target;
      if (!wasOpen) this.box.active = 0;
      this.box.set(items, { footer: this.hint });
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - 336));
      const below = rect.bottom + 6;
      const top = below + 260 > window.innerHeight ? Math.max(8, rect.top - 266) : below;
      this.box.node.style.left = `${left}px`;
      this.box.node.style.top = `${top}px`;
      if (!wasOpen) {
        this.box.node.hidden = false;
        popIn(this.box.node);
      }
      if (target.input) {
        target.input.setAttribute('aria-activedescendant', this.box.activeId());
        target.input.setAttribute('aria-controls', this.box.node.id);
      }
    },

    open() {
      return Boolean(this.box && !this.box.node.hidden);
    },

    close() {
      if (!this.box || this.box.node.hidden) return;
      this.box.node.hidden = true;
      this.target?.input?.removeAttribute('aria-activedescendant');
      this.target = null;
    },

    // Keys while the list is open; true when the key was ours.
    key(event) {
      if (!this.open()) return false;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        this.box.move(event.key === 'ArrowDown' ? 1 : -1);
        this.target?.input?.setAttribute('aria-activedescendant', this.box.activeId());
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const item = this.box.items[this.box.active];
        if (item) this.insert(item.entry);
        return true;
      }
      if (event.key === 'Escape') {
        this.close();
        return true;
      }
      return false;
    },

    // Runs inside the user's key or click: e-Boekhouden's field gets the code.
    insert(entry) {
      const target = this.target;
      this.close();
      if (!target) return;
      if (target.kind === 'input') {
        const input = target.input;
        input.focus();
        input.setRangeText(entry.code, target.start, input.selectionStart ?? target.start, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        // Select what was typed ("[RELP"), and let CKEditor replace it.
        const selection = target.doc.getSelection();
        const range = target.range;
        if (selection && range) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
        ckeditor.insert(this.owner, entry.code).then(() => this.onInserted?.());
      }
      this.onInserted?.();
    },

    // From the editor's frame: the text before the caret in the caret's node.
    fromEditor(doc, frame) {
      const selection = doc.getSelection();
      if (!selection?.rangeCount || !selection.isCollapsed) return this.close();
      const { focusNode, focusOffset } = selection;
      if (!focusNode || focusNode.nodeType !== Node.TEXT_NODE) return this.close();
      const token = this.tokenBefore(focusNode.data.slice(0, focusOffset));
      if (!token) return this.close();
      const range = doc.createRange();
      range.setStart(focusNode, focusOffset - token.length);
      range.setEnd(focusNode, focusOffset);
      const caret = range.getBoundingClientRect?.() ?? { left: 0, top: 0, bottom: 0 };
      const outer = frame.getBoundingClientRect();
      const rect = { left: outer.left + caret.left, top: outer.top + caret.top, bottom: outer.top + (caret.bottom || caret.top + 18) };
      this.update({ kind: 'editor', doc, range, prefix: token.prefix }, rect);
    },

    fromInput(input) {
      const at = input.selectionStart ?? input.value.length;
      const token = this.tokenBefore(input.value.slice(0, at));
      if (!token) return this.close();
      const box = input.getBoundingClientRect();
      this.update({ kind: 'input', input, start: at - token.length, prefix: token.prefix }, { left: box.left + 8, top: box.top, bottom: box.bottom });
    },
  };

  // ---------------------------------------------------------------------------
  // The variables panel (both screens).
  // ---------------------------------------------------------------------------

  function variablesPanel({ title, onPick }) {
    const aside = el('aside', 'ebs-tpl-vars');
    aside.setAttribute('aria-label', 'Variabelen');
    const head = el('div', 'ebs-tpl-vars-head');
    const intro = el('span', 'ebs-tpl-muted');
    const badges = el('span', 'ebs-tpl-badges');
    const search = el('input', 'ebs-tpl-vars-search');
    search.type = 'search';
    search.placeholder = 'Zoek variabele';
    search.setAttribute('aria-label', 'Zoek variabele');
    head.append(el('span', 'ebs-tpl-title', title), intro, badges, search);
    const list = el('div', 'ebs-tpl-vars-list');
    const live = el('span', 'ebs-tpl-sr');
    live.setAttribute('aria-live', 'polite');
    aside.append(head, list, live);
    const state = { entries: [], badges: {}, flat: false };

    function draw() {
      const needle = search.value.trim().toUpperCase();
      const shown = state.entries.filter((entry) => !needle || entry.name.includes(needle) || entry.label.toUpperCase().includes(needle));
      const groups = state.flat ? [{ title: '', items: shown }] : grouped(shown);
      list.replaceChildren();
      for (const group of groups) {
        if (group.title) list.append(el('div', 'ebs-tpl-vars-group', group.title));
        for (const entry of group.items) {
          const item = button('ebs-tpl-var');
          const line = el('span', 'ebs-tpl-var-line');
          line.append(el('span', 'ebs-tpl-var-code', entry.code));
          const badge = state.badges[entry.name];
          if (badge) line.append(el('span', `ebs-tpl-var-badge ${badge === 'ontbreekt' ? 'missing' : 'used'}`, badge));
          item.append(line, el('span', 'ebs-tpl-var-label', entry.aliases.length ? `${entry.label} (ook ${entry.aliases.map((alias) => `[${alias}]`).join(', ')})` : entry.label));
          // Keep the caret in the editor: the click inserts there.
          item.addEventListener('mousedown', (event) => event.preventDefault());
          item.addEventListener('click', () => onPick(entry, (text) => {
            live.textContent = text;
          }));
          list.append(item);
        }
      }
      if (!shown.length) list.append(el('div', 'ebs-tpl-pop-empty', 'Geen variabele gevonden.'));
    }

    search.addEventListener('input', draw);
    return {
      node: aside,
      set({ entries, introText, badgeNodes = [], badges: marks = {}, flat = false }) {
        const same = entries.length === state.entries.length && entries.every((entry, i) => entry.name === state.entries[i].name)
          && JSON.stringify(marks) === JSON.stringify(state.badges) && flat === state.flat;
        intro.textContent = introText;
        badges.replaceChildren(...badgeNodes);
        badges.hidden = !badgeNodes.length;
        if (same) return;
        const focusName = document.activeElement?.closest?.('.ebs-tpl-var')?.querySelector('.ebs-tpl-var-code')?.textContent;
        state.entries = entries;
        state.badges = marks;
        state.flat = flat;
        draw();
        if (focusName) [...list.querySelectorAll('.ebs-tpl-var')].find((node) => node.querySelector('.ebs-tpl-var-code').textContent === focusName)?.focus();
      },
    };
  }

  function checksNode() {
    const node = el('div', 'ebs-tpl-checks');
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    let last = '';
    return {
      node,
      set(lines) {
        const key = JSON.stringify(lines);
        if (key === last) return;
        last = key;
        node.replaceChildren(...lines.map(({ tone, text }) => {
          const line = el('span', `ebs-tpl-check ${tone}`);
          line.append(icon(tone === 'ok' ? 'circle-check' : 'triangle-alert', { size: 14 }), el('span', '', text));
          return line;
        }));
      },
    };
  }

  // ---------------------------------------------------------------------------
  // E-mail template
  // ---------------------------------------------------------------------------

  const KIND_OF_USE = { 1: 'offerte', 2: 'mail', 3: 'nieuwsbrief' };

  const email = {
    host: null,
    rootDiv: null,
    nodes: null,
    editorDoc: null,
    saved: null,
    invoice: null,
    values: null,
    loadingInvoice: false,
    invoiceError: '',
    busySince: 0,
    drawQueued: false,

    mount(host) {
      const rootDiv = host.querySelector(':scope > div');
      const form = rootDiv?.querySelector(':scope > app-form');
      if (!rootDiv || !form) return;
      if (this.rootDiv === rootDiv && this.nodes?.head.isConnected) {
        this.sync();
        return;
      }
      this.unmount();
      this.host = host;
      this.rootDiv = rootDiv;
      rootDiv.classList.add('ebs-tpl-email');
      form.classList.add('ebs-tpl-form');
      if (EBS.bridge && !EBS.bridge.isEnabled('ckeditor')) EBS.bridge.enable('ckeditor');
      this.build(rootDiv, form);
      this.sync();
    },

    unmount() {
      if (!this.nodes) return;
      for (const node of Object.values(this.nodes)) if (node instanceof Node) node.remove();
      this.nodes.picker?.node.remove();
      this.rootDiv?.classList.remove('ebs-tpl-email');
      this.rootDiv?.querySelector('.ebs-tpl-form')?.classList.remove('ebs-tpl-form');
      this.detachEditor();
      suggest$.close();
      this.nodes = null;
      this.rootDiv = null;
      this.host = null;
      this.saved = null;
      this.invoice = null;
      this.values = null;
    },

    build(rootDiv, form) {
      const nodes = {};
      // Head: back, title, classic link, Annuleren and Opslaan (e-Boekhouden's own, clicked for you).
      const head = el('div', 'ebs-tpl-head');
      const back = el('a', 'ebs-tpl-back');
      back.href = '/beheer/sjabloon/email';
      back.append(icon('arrow-left'), document.createTextNode('E-mailsjablonen'));
      back.addEventListener('click', (event) => {
        if (clickNative(nativeBack(rootDiv))) event.preventDefault();
      });
      nodes.title = el('h1', 'ebs-tpl-h1');
      const classic = button('ebs-tpl-link', 'Klassieke weergave', () => setClassic('email', true));
      const cancel = button('ebs-tpl-button ghost', 'Annuleren', () => clickNative(nativeBack(rootDiv)));
      nodes.save = button('ebs-tpl-button primary', 'Opslaan', () => this.save());
      head.append(back, nodes.title, classic, cancel, nodes.save);
      nodes.head = head;

      // "Meer velden": Van naam, Van e-mail, CC and BCC, e-Boekhouden's own rows.
      const body = form.querySelector('.form-body');
      const more = button('ebs-tpl-more', 'Meer velden van e-Boekhouden: van naam, van e-mail, CC, BCC');
      more.setAttribute('aria-expanded', 'false');
      more.prepend(icon('chevron-right', { size: 14 }));
      more.addEventListener('click', () => {
        const open = !rootDiv.classList.contains('ebs-tpl-more-open');
        rootDiv.classList.toggle('ebs-tpl-more-open', open);
        more.setAttribute('aria-expanded', String(open));
      });
      nodes.more = more;
      nodes.checks = checksNode();
      body?.append(more, nodes.checks.node);
      nodes.checksNode = nodes.checks.node;

      // Preview
      const preview = el('section', 'ebs-tpl-card ebs-tpl-preview');
      preview.setAttribute('aria-label', 'Voorbeeld');
      const previewHead = el('div', 'ebs-tpl-card-head');
      const withLabel = el('span', 'ebs-tpl-with', 'met');
      nodes.picker = invoicePicker({
        canPick: () => this.pickBlocked(),
        onChange: (invoice) => this.pickInvoice(invoice),
      });
      withLabel.append(nodes.picker.node);
      previewHead.append(el('span', 'ebs-tpl-title', 'Voorbeeld'), withLabel);
      const notes = el('div', 'ebs-tpl-card-notes');
      notes.append(requestNote('Eigen verzoek (alleen lezen, goedgekeurd, alleen bij jouw klik): de gegevens van deze ene factuur, pas als je hem kiest. Zonder keuze vult het voorbeeld voorbeeldgegevens in'));
      const stage = el('div', 'ebs-tpl-stage');
      const mail = el('div', 'ebs-tpl-mail');
      const mailHead = el('div', 'ebs-tpl-mail-head');
      nodes.to = el('span', '');
      nodes.subject = el('span', 'ebs-tpl-mail-subject');
      nodes.attachment = el('span', '');
      mailHead.append(nodes.to, nodes.subject, nodes.attachment);
      nodes.mailBody = el('div', 'ebs-tpl-mail-body');
      mail.append(mailHead, nodes.mailBody);
      nodes.previewStatus = el('span', 'ebs-tpl-preview-status');
      nodes.previewStatus.setAttribute('role', 'status');
      stage.append(mail, el('span', 'ebs-tpl-footnote', 'Een benadering: de extensie vult de variabelen zelf in met de gekozen factuur. e-Boekhouden maakt de echte e-mail. Er wordt niets verstuurd.'), nodes.previewStatus);
      nodes.mail = mail;
      preview.append(previewHead, notes, stage);
      nodes.preview = preview;

      nodes.vars = variablesPanel({ title: 'Variabelen', onPick: (entry, say) => this.insertVariable(entry, say) });
      nodes.varsNode = nodes.vars.node;

      rootDiv.prepend(head);
      rootDiv.append(preview, nodes.varsNode);
      this.nodes = nodes;

      // The subject field: "[" suggestions and live preview.
      const subject = form.querySelector('input#subject');
      if (subject) {
        subject.addEventListener('input', () => {
          suggest$.list = this.entries();
          suggest$.owner = rootDiv;
          suggest$.fromInput(subject);
          this.queue();
        });
        subject.addEventListener('keydown', (event) => {
          if (suggest$.target?.input === subject && suggest$.key(event)) {
            event.preventDefault();
            event.stopPropagation();
          }
        });
        subject.addEventListener('blur', () => setTimeout(() => {
          if (suggest$.target?.input === subject) suggest$.close();
        }, 150));
      }
      form.addEventListener('change', () => this.queue());
      form.addEventListener('input', () => this.queue());
      suggest$.onInserted = () => this.queue();
    },

    // Which lists apply: by "Te gebruiken bij" (1 offertes, 2 facturen, 3 nieuwsbrieven).
    uses() {
      const scope = this.rootDiv;
      const checked = [1, 2, 3].filter((value) => scope?.querySelector(`input#use_${value}`)?.checked);
      return checked.map((value) => KIND_OF_USE[value]);
    },

    kinds() {
      const uses = this.uses();
      const kinds = uses.filter((use) => use !== 'offerte');
      // Quotes have no list of their own: the invoice mail list is the nearest.
      if (!kinds.length) kinds.push('mail');
      return [...new Set(kinds)];
    },

    entries() {
      return variablesFor(this.kinds());
    },

    pickBlocked() {
      if (!this.kinds().includes('mail')) return 'Een factuur kiezen kan bij sjablonen voor facturen.';
      return '';
    },

    savedId() {
      const match = /\/(\d+)\/?$/.exec(location.pathname);
      return match ? Number(match[1]) : null;
    },

    queue() {
      if (this.drawQueued) return;
      this.drawQueued = true;
      requestAnimationFrame(() => {
        this.drawQueued = false;
        if (this.nodes) this.sync();
      });
    },

    // Called on every native change and our own: title, busy state, editor
    // hooks, preview, checks and the variables.
    sync() {
      const nodes = this.nodes;
      if (!nodes) return;
      const scope = this.rootDiv;
      const name = scope.querySelector('input#naam')?.value.trim();
      const titleText = name ? `E-mailsjabloon: ${name}` : (this.savedId() ? 'E-mailsjabloon' : 'Nieuw e-mailsjabloon');
      if (nodes.title.textContent !== titleText) nodes.title.textContent = titleText;
      this.syncBusy();
      this.attachEditor();

      const kinds = this.kinds();
      const entries = variablesFor(kinds);
      const subject = scope.querySelector('input#subject')?.value ?? '';
      const html = ckeditor.html(scope);
      const result = checkTemplate(kinds, [subject, htmlText(html)]);
      nodes.checks.set(checkMessages(result, kinds));

      const marks = {};
      for (const code of result.used) marks[code] = 'gebruikt';
      for (const { code } of result.missing) marks[code.slice(1, -1)] = 'ontbreekt';
      const uses = this.uses();
      const what = kinds.includes('mail') && kinds.includes('nieuwsbrief') ? 'Voor e-mails bij een factuur en nieuwsbrieven'
        : kinds.includes('nieuwsbrief') ? 'Voor nieuwsbrieven' : 'Voor e-mails bij een factuur';
      const badgeNodes = [];
      if (uses.includes('offerte')) badgeNodes.push(assumption('Aanname: voor offertes heeft e-Boekhouden geen eigen lijst in zijn uitleg; deze lijst is die voor facturen'));
      if (!uses.length) badgeNodes.push(assumption('Kies bij Te gebruiken bij waarvoor dit sjabloon is; tot dan staat hier de lijst voor facturen'));
      nodes.vars.set({ entries, introText: `${what}, uit de uitleg van e-Boekhouden (${entries.length} codes). Klik om in te voegen, of typ [ in de tekst.`, badgeNodes, badges: marks });
      if (this.editorDoc) paintHighlights(this.editorDoc, entries);
      this.drawPreview(subject, html, entries);
      nodes.picker.refresh();
    },

    drawPreview(subject, html, entries) {
      const nodes = this.nodes;
      const invoice = this.invoice;
      const values = invoice ? { ...(this.values ?? {}) } : SAMPLE;
      const missingTitle = 'Geen waarde uit deze factuur: deze code staat niet in de opgeslagen versie van het sjabloon';
      nodes.mail.classList.toggle('loading', this.loadingInvoice);
      const to = values.RELEMAILFACTUUR || values.RELEMAIL;
      nodes.to.textContent = `Aan: ${to || 'het e-mailadres voor facturen van de relatie'} ([RELEMAILFACTUUR])`;
      const subjectNode = el('span');
      subjectNode.textContent = subject;
      fillCodes(subjectNode, { values, known: entries, missingTitle });
      nodes.subject.replaceChildren(...subjectNode.childNodes);
      if (!subject.trim()) nodes.subject.textContent = '(geen onderwerp)';
      const number = values.FACTNUMMER;
      nodes.attachment.textContent = this.kinds().includes('mail') ? `Bijlage: Factuur ${number || '[FACTNUMMER]'}.pdf` : '';
      const body = el('div');
      body.append(sanitize(html));
      fillCodes(body, { values, known: entries, missingTitle });
      nodes.mailBody.replaceChildren(...body.childNodes);
      const text = this.loadingInvoice ? 'Bezig met laden van de factuur…' : this.invoiceError;
      if (nodes.previewStatus.textContent !== text) nodes.previewStatus.textContent = text;
      nodes.previewStatus.dataset.tone = this.invoiceError ? 'error' : '';
    },

    // The editor's frame changes when CKEditor switches mode: hook the new one.
    attachEditor() {
      const doc = ckeditor.document(this.rootDiv);
      if (doc === this.editorDoc) return;
      this.detachEditor();
      if (!doc?.body) return;
      this.editorDoc = doc;
      const frame = ckeditor.frame(this.rootDiv);
      const scope = this.rootDiv;
      this.editorHandlers = {
        keydown: (event) => {
          // The saved text, for reading an invoice's values later: taken
          // before the user's first change.
          this.snapshot();
          if (suggest$.target?.doc === doc && suggest$.key(event)) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        },
        keyup: (event) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key) && suggest$.open()) return;
          suggest$.list = this.entries();
          suggest$.owner = scope;
          suggest$.fromEditor(doc, frame);
          this.queue();
        },
        input: () => this.queue(),
        mousedown: () => suggest$.close(),
        paste: () => this.snapshot(),
        scroll: () => suggest$.close(),
      };
      const view = doc.defaultView;
      // Capture on the frame's window: before CKEditor's own key handling.
      view.addEventListener('keydown', this.editorHandlers.keydown, true);
      view.addEventListener('keyup', this.editorHandlers.keyup, true);
      doc.addEventListener('input', this.editorHandlers.input, true);
      doc.addEventListener('mousedown', this.editorHandlers.mousedown, true);
      doc.addEventListener('paste', this.editorHandlers.paste, true);
      view.addEventListener('scroll', this.editorHandlers.scroll, true);
      if (doc.body.textContent.trim()) this.snapshot();
    },

    detachEditor() {
      const doc = this.editorDoc;
      if (doc && this.editorHandlers) {
        try {
          const view = doc.defaultView;
          view?.removeEventListener('keydown', this.editorHandlers.keydown, true);
          view?.removeEventListener('keyup', this.editorHandlers.keyup, true);
          doc.removeEventListener('input', this.editorHandlers.input, true);
          doc.removeEventListener('mousedown', this.editorHandlers.mousedown, true);
          doc.removeEventListener('paste', this.editorHandlers.paste, true);
          view?.removeEventListener('scroll', this.editorHandlers.scroll, true);
        } catch { /* the frame is gone */ }
      }
      this.editorDoc = null;
      this.editorHandlers = null;
    },

    snapshot() {
      if (this.saved || !this.rootDiv) return;
      this.saved = { subject: this.rootDiv.querySelector('input#subject')?.value ?? '', body: ckeditor.html(this.rootDiv) };
    },

    // A click on a variable: into the editor at the caret (e-Boekhouden's
    // CKEditor, through the page bridge, during this click).
    insertVariable(entry, say) {
      this.snapshot();
      const scope = this.rootDiv;
      if (!ckeditor.name(scope)) {
        say('De editor is nog niet geladen.');
        return;
      }
      ckeditor.insert(scope, entry.code).then((ok) => {
        say(ok ? `${entry.code} ingevoegd.` : 'Invoegen lukte niet. Klik eerst in de tekst.');
        this.queue();
      });
    },

    async pickInvoice(invoice) {
      this.invoice = invoice;
      this.invoiceError = '';
      this.values = invoice ? valuesFromInvoice(invoice) : null;
      if (!invoice) {
        this.sync();
        return;
      }
      const id = this.savedId();
      this.snapshot();
      if (!id || !this.saved) {
        // A new template is not on the server yet: only the list's values.
        if (!id) this.invoiceError = 'Sla het sjabloon eerst op: dan vult e-Boekhouden ook de overige variabelen voor deze factuur.';
        this.sync();
        return;
      }
      this.loadingInvoice = true;
      this.sync();
      try {
        const answer = await EBS.request.item(`templates:maildata:${id}:${invoice.id}`, `${API}factuur/maildata/${id}/${invoice.id}`, { userAction: true });
        if (this.invoice !== invoice) return;
        this.values = {
          ...alignValues(this.saved.subject, answer?.subject ?? ''),
          ...alignValues(htmlText(this.saved.body), htmlText(answer?.body ?? '')),
          ...valuesFromInvoice(invoice),
        };
        if (answer?.vanEmail === undefined && answer?.subject === undefined) this.invoiceError = 'e-Boekhouden gaf voor deze factuur geen e-mail terug.';
      } catch (error) {
        if (this.invoice !== invoice) return;
        this.invoiceError = error?.code === 'user-action' ? 'Kies de factuur opnieuw om hem te laden.' : 'De gegevens van deze factuur konden niet worden geladen. Het voorbeeld toont wat de factuurlijst weet.';
      } finally {
        if (this.invoice === invoice) {
          this.loadingInvoice = false;
          this.sync();
        }
      }
    },

    // Opslaan is e-Boekhouden's own button, clicked during this click. It
    // shows "Bezig…" until e-Boekhouden answers (its button is enabled
    // again) or leaves the page.
    save() {
      const native = this.rootDiv?.querySelector('.form-footer button.form-submit, button[type="submit"].form-submit');
      if (!native || native.disabled) return;
      native.click();
      this.busySince = Date.now();
      this.syncBusy();
      setTimeout(() => this.syncBusy(), 400);
    },

    syncBusy() {
      const nodes = this.nodes;
      const native = this.rootDiv?.querySelector('.form-footer button.form-submit, button[type="submit"].form-submit');
      const waiting = Boolean(this.busySince) && Boolean(native?.disabled);
      // Not disabled after a moment: e-Boekhouden refused (a field is wrong).
      if (this.busySince && !native?.disabled && Date.now() - this.busySince > 300) this.busySince = 0;
      const busy = waiting || (Boolean(this.busySince) && Date.now() - this.busySince <= 300);
      const disabled = busy || Boolean(native?.disabled && !this.busySince);
      if (nodes.save.disabled !== disabled) nodes.save.disabled = disabled;
      if (nodes.save.getAttribute('aria-busy') !== String(busy)) nodes.save.setAttribute('aria-busy', String(busy));
      const text = busy ? 'Bezig…' : 'Opslaan';
      if (nodes.save.textContent !== text) nodes.save.textContent = text;
    },
  };

  // ---------------------------------------------------------------------------
  // Invoice template: three parts of e-Boekhouden in one screen.
  // ---------------------------------------------------------------------------

  const invoiceScreen = {
    host: null,
    rootDiv: null,
    nodes: null,
    columns: null,
    columnsFrame: null,
    invoice: null,
    lines: null,
    loadingInvoice: false,
    invoiceError: '',
    editorDialog: null,
    drawQueued: false,

    mount(host) {
      const rootDiv = host.querySelector(':scope > div');
      const form = rootDiv?.querySelector('app-form');
      // e-Boekhouden opened its own editor in place of the form: step aside.
      if (host.querySelector(':scope > iframe.editorframe')) {
        this.unmount();
        return;
      }
      if (!rootDiv || !form) return;
      if (this.rootDiv === rootDiv && this.nodes?.head.isConnected) {
        this.sync();
        return;
      }
      this.unmount();
      this.host = host;
      this.rootDiv = rootDiv;
      rootDiv.classList.add('ebs-tpl-invoice');
      form.parentElement.classList.add('ebs-tpl-part1');
      this.build(rootDiv, form.parentElement);
      this.sync();
    },

    unmount() {
      if (!this.nodes) return;
      for (const node of Object.values(this.nodes)) if (node instanceof Node) node.remove();
      this.nodes.picker?.node.remove();
      this.rootDiv?.classList.remove('ebs-tpl-invoice');
      this.rootDiv?.querySelector('.ebs-tpl-part1')?.classList.remove('ebs-tpl-part1');
      window.removeEventListener('message', this.onMessage);
      this.nodes = null;
      this.rootDiv = null;
      this.host = null;
      this.columns = null;
      this.columnsFrame = null;
      this.invoice = null;
      this.lines = null;
    },

    info() {
      const match = INVOICE_PAGE.exec(location.pathname);
      const copy = Boolean(match?.[1]);
      const id = match && !copy ? Number(match[2]) : 0;
      const scope = this.rootDiv;
      const type = scope?.querySelector('select#type')?.value || (scope?.querySelector('input#file[type="file"]') ? 'A' : 'E');
      return { id, copy, saved: id > 0, type, simple: type !== 'A' };
    },

    language() {
      const select = this.rootDiv?.querySelector('select#taal');
      const current = [...(this.rootDiv?.querySelectorAll('.form-span') ?? [])].map((node) => node.textContent.trim()).find(Boolean) ?? '';
      if (/engels/i.test(current)) return 'EN';
      if (/nederlands/i.test(current)) return 'NL';
      return select?.value === 'EN' ? 'EN' : 'NL';
    },

    build(rootDiv, part1) {
      const nodes = {};
      const head = el('div', 'ebs-tpl-head');
      const back = el('a', 'ebs-tpl-back');
      back.href = '/beheer/sjabloon/factuur';
      back.append(icon('arrow-left'), document.createTextNode('Factuursjablonen'));
      back.addEventListener('click', (event) => {
        if (clickNative(nativeBack(rootDiv))) event.preventDefault();
      });
      nodes.title = el('h1', 'ebs-tpl-h1');
      const classic = button('ebs-tpl-link', 'Klassieke weergave', () => setClassic('invoice', true));
      head.append(back, nodes.title, classic, el('span', 'ebs-tpl-head-note', 'Drie onderdelen van e-Boekhouden, elk met een eigen Opslaan'));
      nodes.head = head;

      // Part 1: the head above e-Boekhouden's own form, a note below it.
      nodes.part1Head = el('div', 'ebs-tpl-part-head');
      nodes.part1Head.append(el('span', 'ebs-tpl-title', '1. Sjabloon'), el('span', 'ebs-tpl-part-sub', 'De pagina Factuursjabloon van e-Boekhouden'));
      nodes.langNote = el('span', 'ebs-tpl-muted small', 'Nederlands of Engels: meer talen kent e-Boekhouden niet.');
      nodes.lang = this.buildLanguage();
      nodes.part1Note = el('span', 'ebs-tpl-muted small ebs-tpl-part1-note');
      part1.before(nodes.part1Head);
      const form = part1.querySelector('.form-body');
      form?.append(nodes.lang, nodes.langNote);
      part1.after(nodes.part1Note);

      // Part 2: the columns, e-Boekhouden's own page in a frame.
      const part2 = el('section', 'ebs-tpl-part ebs-tpl-part2');
      const part2Head = el('div', 'ebs-tpl-part-head row');
      const part2Titles = el('span', 'ebs-tpl-part-titles');
      part2Titles.append(el('span', 'ebs-tpl-title', '2. Kolommen'), el('span', 'ebs-tpl-part-sub', 'De pagina Factuurregel configuratie aanpassen'));
      nodes.width = el('span', 'ebs-tpl-width');
      part2Head.append(part2Titles, nodes.width);
      nodes.columnsBody = el('div', 'ebs-tpl-columns-body');
      nodes.columnsStatus = el('span', 'ebs-tpl-status');
      nodes.columnsStatus.setAttribute('role', 'status');
      part2.append(part2Head, nodes.columnsBody, nodes.columnsStatus);
      nodes.part2 = part2;

      // Part 3: the server's template editor, in a dialog.
      const part3 = el('section', 'ebs-tpl-part ebs-tpl-part3');
      const part3Head = el('div', 'ebs-tpl-part-head');
      part3Head.append(el('span', 'ebs-tpl-title', '3. Opmaak en teksten'), el('span', 'ebs-tpl-part-sub', 'De sjablooneditor van e-Boekhouden, een eigen venster met eigen Opslaan'));
      nodes.part3Text = el('span', 'ebs-tpl-muted small');
      const part3Badges = el('span', 'ebs-tpl-badges');
      part3Badges.append(assumption('Aanname: briefpapier en de teksten zitten in de sjablooneditor van e-Boekhouden; welke velden die precies heeft, controleer ik met een ingelogde sessie'));
      nodes.openEditor = button('ebs-tpl-button ghost small', 'Sjablooneditor openen', () => this.openEditor());
      nodes.openEditor.append(icon('external-link', { size: 14 }));
      nodes.editorStatus = el('span', 'ebs-tpl-status');
      nodes.editorStatus.setAttribute('role', 'status');
      part3.append(part3Head, nodes.part3Text, part3Badges, nodes.openEditor, nodes.editorStatus);
      nodes.part3 = part3;

      // Preview
      const preview = el('section', 'ebs-tpl-card ebs-tpl-preview ebs-tpl-sketch-card');
      preview.setAttribute('aria-label', 'Voorbeeld');
      const previewHead = el('div', 'ebs-tpl-card-head');
      const withLabel = el('span', 'ebs-tpl-with', 'met');
      nodes.picker = invoicePicker({ canPick: () => '', onChange: (invoice) => this.pickInvoice(invoice) });
      withLabel.append(nodes.picker.node);
      previewHead.append(el('span', 'ebs-tpl-title', 'Schematisch voorbeeld'), withLabel);
      const notes = el('div', 'ebs-tpl-card-notes');
      nodes.view = el('a', 'ebs-tpl-button ghost small');
      nodes.view.append(icon('file-text', { size: 14 }), document.createTextNode('Sjabloon bekijken'));
      nodes.view.title = 'De pdf van e-Boekhouden, van de opgeslagen versie';
      nodes.view.target = '_blank';
      nodes.view.rel = 'noopener';
      notes.append(el('span', 'ebs-tpl-badge plain', 'Een schets: kolommen, breedtes en teksten zoals je ze instelt. e-Boekhouden maakt de echte pdf.'),
        requestNote('Eigen verzoek (alleen lezen, goedgekeurd, alleen bij jouw klik): de gegevens van één factuur, pas als je die kiest'),
        el('span', 'ebs-tpl-grow'), nodes.view);
      const stage = el('div', 'ebs-tpl-stage sheet');
      nodes.sheet = el('div', 'ebs-tpl-sheet');
      nodes.previewStatus = el('span', 'ebs-tpl-preview-status');
      nodes.previewStatus.setAttribute('role', 'status');
      stage.append(nodes.sheet);
      preview.append(previewHead, notes, stage, nodes.previewStatus);
      nodes.preview = preview;

      nodes.vars = variablesPanel({ title: 'Variabelen', onPick: (entry, say) => this.copyVariable(entry, say) });
      nodes.varsNode = nodes.vars.node;

      rootDiv.prepend(head);
      nodes.part1Note.after(part2, part3);
      rootDiv.append(preview, nodes.varsNode);
      this.nodes = nodes;

      this.onMessage = (event) => this.message(event);
      window.addEventListener('message', this.onMessage);
      rootDiv.addEventListener('change', () => this.queue());
      rootDiv.addEventListener('input', () => this.queue());
    },

    // Taal as two buttons over e-Boekhouden's own select (it stays the one
    // that counts; a click picks its option for you).
    buildLanguage() {
      const wrap = el('span', 'ebs-tpl-lang');
      wrap.setAttribute('role', 'radiogroup');
      wrap.setAttribute('aria-label', 'Taal');
      for (const [value, label] of [['NL', 'NL'], ['EN', 'EN']]) {
        const option = button('ebs-tpl-lang-option', label, () => {
          const select = this.rootDiv?.querySelector('select#taal');
          if (!select || ![...select.options].some((one) => one.value === value)) return;
          select.value = value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          this.queue();
        });
        option.setAttribute('role', 'radio');
        option.dataset.value = value;
        wrap.append(option);
      }
      return wrap;
    },

    queue() {
      if (this.drawQueued) return;
      this.drawQueued = true;
      requestAnimationFrame(() => {
        this.drawQueued = false;
        if (this.nodes) this.sync();
      });
    },

    sync() {
      const nodes = this.nodes;
      if (!nodes) return;
      const info = this.info();
      const name = this.rootDiv.querySelector('input#naam')?.value.trim();
      const titleText = name ? `Factuursjabloon: ${name}` : 'Nieuw factuursjabloon';
      if (nodes.title.textContent !== titleText) nodes.title.textContent = titleText;

      // Taal: the buttons only where the select is the plain NL/EN choice.
      const select = this.rootDiv.querySelector('select#taal');
      const plain = Boolean(select) && [...select.options].map((one) => one.value).join(',') === 'NL,EN';
      this.rootDiv.classList.toggle('ebs-tpl-lang-buttons', plain);
      for (const option of nodes.lang.children) {
        const on = plain && select.value === option.dataset.value;
        option.setAttribute('aria-checked', String(on));
        option.classList.toggle('on', on);
      }
      const submit = this.rootDiv.querySelector('.form-footer button.form-submit');
      const submitText = submit?.textContent.trim() ?? '';
      nodes.part1Note.textContent = info.simple
        ? (submitText === 'Volgende' ? 'Volgende slaat dit onderdeel op en opent daarna de sjablooneditor van e-Boekhouden (onderdeel 3).' : 'Bij Eenvoudig opent e-Boekhouden na het opslaan de sjablooneditor (onderdeel 3).')
        : 'Geavanceerd: de opmaak staat in het RTF-bestand. Opslaan bewaart het sjabloon en het bestand.';

      this.syncColumns(info);
      this.syncEditor(info);

      const view = nodes.view;
      if (info.saved) {
        view.href = `${API}factuursjabloon/download/${info.id}`;
        view.removeAttribute('aria-disabled');
        view.classList.remove('disabled');
      } else {
        view.removeAttribute('href');
        view.setAttribute('aria-disabled', 'true');
        view.classList.add('disabled');
        view.title = 'Na het opslaan te bekijken';
      }

      const entries = variablesOf('factuur');
      // The invoice codes first, as the board lists them; e-Boekhouden's order after that.
      const first = ['NUMMER', 'DATUM', 'VDATUM', 'TERMIJN', 'TOTAAL', 'TOT_EX', 'FACTUURREGELS', 'BEDRIJF', 'AANHEF', 'BTWNR', 'KENMERK', 'NOTITIE', 'ABBEDRIJF', 'ABIBAN', 'ABOBNUMMER'];
      const ordered = [...first.map((code) => entries.find((entry) => entry.name === code)), ...entries.filter((entry) => !first.includes(entry.name))];
      nodes.vars.set({ entries: ordered, flat: true, introText: `Voor factuursjablonen, uit de uitleg van e-Boekhouden (${entries.length} codes). Klik om te kopiëren; in de sjablooneditor voeg je ze in.` });
      this.drawSheet(info);
      nodes.picker.refresh();
    },

    syncColumns(info) {
      const nodes = this.nodes;
      if (!info.saved || !info.simple) {
        this.columnsFrame?.remove();
        this.columnsFrame = null;
        const text = !info.simple
          ? 'Bij een RTF-sjabloon staan de kolommen in het bestand zelf.'
          : 'Sla het sjabloon eerst op: daarna zijn de kolommen hier te bewerken.';
        if (nodes.columnsBody.textContent !== text) nodes.columnsBody.replaceChildren(el('span', 'ebs-tpl-muted small', text));
        nodes.width.hidden = true;
        return;
      }
      if (!this.columnsFrame) {
        const frame = el('iframe', 'ebs-tpl-columns-frame');
        frame.name = COLUMNS_FRAME;
        frame.title = 'Kolommen van de factuurregels';
        frame.src = `${location.origin}/beheer/sjabloonregel/${info.id}`;
        nodes.columnsBody.replaceChildren(frame);
        this.columnsFrame = frame;
      }
      const summary = widthSummary(this.columns ?? []);
      nodes.width.hidden = !this.columns;
      nodes.width.textContent = summary.text;
      nodes.width.classList.toggle('over', summary.over);
    },

    syncEditor(info) {
      const nodes = this.nodes;
      const text = !info.simple ? 'Bij een RTF-sjabloon is er geen sjablooneditor: de opmaak staat in het bestand.'
        : info.saved ? 'Briefpapier, logo en de teksten rond de regels bewerk je in de sjablooneditor van e-Boekhouden. Die heeft een eigen Opslaan.'
          : 'Na het opslaan van onderdeel 1 opent e-Boekhouden de sjablooneditor zelf.';
      if (nodes.part3Text.textContent !== text) nodes.part3Text.textContent = text;
      nodes.openEditor.disabled = !(info.saved && info.simple);
    },

    // From the columns frame (our own script there): the columns, the
    // height, and that e-Boekhouden saved them. Page data, nothing more.
    message(event) {
      const frame = this.columnsFrame;
      if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin) return;
      const data = event.data;
      if (!data || data.type !== 'ebs-tpl-columns') return;
      if (Number.isFinite(data.height) && data.height > 0) frame.style.height = `${Math.min(Math.ceil(data.height), 2000)}px`;
      if (Array.isArray(data.columns)) {
        this.columns = data.columns.filter((one) => one && typeof one.id === 'string').slice(0, 30).map((one) => ({
          id: String(one.id).slice(0, 30), title: String(one.title ?? '').slice(0, 100), width: String(one.width ?? '').slice(0, 5),
        }));
      }
      if (data.saved) {
        status(this.nodes.columnsStatus, 'De kolommen zijn opgeslagen.');
        // e-Boekhouden went on to its list: back to the columns, a fresh load.
        frame.src = `${location.origin}/beheer/sjabloonregel/${this.info().id}`;
      }
      this.queue();
    },

    openEditor() {
      const info = this.info();
      if (!info.saved || !info.simple || this.editorDialog?.isOpen) return;
      const src = `${API}factuursjabloon/editor/${info.id}/`;
      const dialog = EBS.dialog.open({
        title: 'Sjablooneditor',
        subtitle: 'Van e-Boekhouden, met een eigen Opslaan',
        src,
        frameTitle: 'Sjablooneditor van e-Boekhouden',
        width: 1320,
        height: 900,
        className: 'ebs-tpl-editor-dialog',
        fallbackUrl: src,
        onClose: () => {
          window.removeEventListener('message', onMessage);
          clearInterval(watch);
          this.editorDialog = null;
        },
      });
      this.editorDialog = dialog;
      const aside = editorAside(dialog);
      dialog.body.append(aside.node);
      const watch = setInterval(() => aside.scan(), 700);
      // The editor tells its parent when it saved or was cancelled, as it
      // does inside e-Boekhouden's own page.
      const onMessage = (event) => {
        if (event.source !== dialog.frame?.contentWindow || event.origin !== location.origin) return;
        if (event.data === 'sjabeditor-saved') {
          dialog.close({ reason: 'saved' });
          status(this.nodes.editorStatus, 'De sjablooneditor heeft opgeslagen.');
        } else if (event.data === 'sjabeditor-canceled') {
          dialog.close({ reason: 'canceled' });
        }
      };
      window.addEventListener('message', onMessage);
    },

    // Variables on this screen are typed in the editor: a click copies one.
    copyVariable(entry, say) {
      const done = () => say(`${entry.code} gekopieerd. Plak het in de sjablooneditor.`);
      try {
        navigator.clipboard.writeText(entry.code).then(done, () => say('Kopiëren lukte niet.'));
      } catch {
        say('Kopiëren lukte niet.');
      }
    },

    async pickInvoice(invoice) {
      this.invoice = invoice;
      this.lines = null;
      this.invoiceError = '';
      if (!invoice) {
        this.sync();
        return;
      }
      this.loadingInvoice = true;
      this.sync();
      try {
        const answer = await EBS.request.item(`templates:invoice:${invoice.id}`, `${API}factuur/${invoice.id}`, { userAction: true });
        if (this.invoice !== invoice) return;
        this.lines = linesFromInvoice(answer);
        if (!this.lines) this.invoiceError = 'De regels van deze factuur zijn niet te lezen; de schets toont een voorbeeldregel.';
      } catch (error) {
        if (this.invoice !== invoice) return;
        this.invoiceError = error?.code === 'user-action' ? 'Kies de factuur opnieuw om hem te laden.' : 'De regels van deze factuur konden niet worden geladen; de schets toont een voorbeeldregel.';
      } finally {
        if (this.invoice === invoice) {
          this.loadingInvoice = false;
          this.sync();
        }
      }
    },

    columnList() {
      if (this.columns?.length) return this.columns;
      return ['OMSCHRIJVING', 'AANTAL', 'PPE', 'BTWPERC', 'REGELTOTAAL'].map((id) => ({ id, title: COLUMN_OPTIONS[id].title, width: COLUMN_OPTIONS[id].width }));
    },

    drawSheet() {
      const nodes = this.nodes;
      const lang = this.language();
      const t = LABELS[lang];
      const invoice = this.invoice ?? SAMPLE_INVOICE;
      const columns = this.columnList();
      const summary = widthSummary(columns);
      const sheet = el('div', 'ebs-tpl-sheet');
      const top = el('span', 'ebs-tpl-sheet-top');
      const paper = el('span', 'ebs-tpl-sheet-paper', '[briefpapier]');
      const own = el('span', 'ebs-tpl-sheet-own');
      own.append('Demo Holding B.V.', el('br'), 'Voorbeeldstraat 1', el('br'), '1234 AB Demostad');
      top.append(paper, own);
      const to = el('span', 'ebs-tpl-sheet-to');
      if (this.invoice) to.append(invoice.relation || '[BEDRIJF]');
      else to.append('Demo Klant B.V.', el('br'), 't.a.v. dhr. De Vries', el('br'), 'Klantweg 8, 4321 CD Klantdorp');
      const title = el('span', 'ebs-tpl-sheet-title', `${t.invoice} ${invoice.number}`);
      const dates = el('span', 'ebs-tpl-sheet-dates');
      dates.append(el('span', '', `${t.date} ${invoice.date}`), el('span', '', `${t.due} ${invoice.due}`));
      const table = el('div', `ebs-tpl-sheet-table${summary.over ? ' over' : ''}${this.loadingInvoice ? ' loading' : ''}`);
      const headRow = el('div', 'ebs-tpl-sheet-row head');
      const width = (column) => (column.width === '*' || column.id === 'OMSCHRIJVING' ? summary.rest : Number(String(column.width).replace(',', '.')) || 0);
      for (const column of columns) {
        const cell = el('span', column.id === 'OMSCHRIJVING' ? '' : 'num', column.title || (column.id === 'EURO' ? '' : COLUMN_OPTIONS[column.id]?.title ?? column.id));
        cell.style.width = `${width(column)}%`;
        headRow.append(cell);
      }
      table.append(headRow);
      const lines = this.invoice ? (this.lines ?? [{ ...SAMPLE_INVOICE.lines[0], OMSCHRIJVING: invoice.text || SAMPLE_INVOICE.lines[0].OMSCHRIJVING, REGELTOTAAL: Number.isFinite(invoice.totalEx) ? EBS.formatMoney(invoice.totalEx) : '' }]) : SAMPLE_INVOICE.lines;
      for (const line of lines) {
        const row = el('div', 'ebs-tpl-sheet-row');
        for (const column of columns) {
          const cell = el('span', column.id === 'OMSCHRIJVING' ? '' : 'num', this.loadingInvoice ? '' : line[column.id] ?? '');
          cell.style.width = `${width(column)}%`;
          row.append(cell);
        }
        table.append(row);
      }
      const total = el('span', 'ebs-tpl-sheet-total', `${t.total} ${Number.isFinite(invoice.total) ? money(invoice.total) : ''}`);
      const foot = el('span', 'ebs-tpl-sheet-foot', 'De teksten onder de regels komen uit de sjablooneditor.');
      sheet.append(top, to, title, dates, table, total, foot);
      sheet.classList.toggle('loading', this.loadingInvoice);
      nodes.sheet.replaceWith(sheet);
      nodes.sheet = sheet;
      const text = this.loadingInvoice ? 'Bezig met laden van de factuur…' : this.invoiceError;
      if (nodes.previewStatus.textContent !== text) nodes.previewStatus.textContent = text;
    },
  };

  // Beside the server's editor in the dialog: its variables, a click inserts
  // into the field that had focus in the editor (or copies), and checks of
  // the codes typed in its fields. The editor is a page of e-Boekhouden's
  // whose fields are not known yet: this reads any plain text field in it.
  function editorAside(dialog) {
    const entries = variablesOf('factuur');
    const node = el('aside', 'ebs-tpl-editor-aside');
    const checks = checksNode();
    const panel = variablesPanel({
      title: 'Variabelen',
      onPick: (entry, say) => {
        const field = state.focused;
        if (field?.isConnected && insertIntoField(field, entry.code)) {
          say(`${entry.code} ingevoegd.`);
          scan();
          return;
        }
        try {
          navigator.clipboard.writeText(entry.code).then(() => say(`${entry.code} gekopieerd: klik in een veld van de editor om in te voegen, of plak het.`), () => say('Kopiëren lukte niet.'));
        } catch {
          say('Kopiëren lukte niet.');
        }
      },
    });
    panel.set({ entries, flat: false, introText: 'Klik in een tekstveld van de editor en daarna op een variabele om hem in te voegen.' });
    node.append(panel.node, checks.node);
    const state = { focused: null, doc: null };

    function editorDocument() {
      try {
        return dialog.frame?.contentDocument ?? null;
      } catch {
        return null;
      }
    }

    function fields(doc) {
      return [...doc.querySelectorAll('textarea, input[type="text"], input:not([type]), [contenteditable="true"], [contenteditable=""]')];
    }

    function scan() {
      const doc = editorDocument();
      if (!doc?.body) return;
      if (doc !== state.doc) {
        state.doc = doc;
        doc.addEventListener('focusin', (event) => {
          const target = event.target;
          if (target.matches?.('textarea, input, [contenteditable="true"], [contenteditable=""]')) state.focused = target;
        }, true);
        doc.addEventListener('input', () => scan(), true);
      }
      const texts = fields(doc).map((field) => ('value' in field && field.tagName !== 'DIV' ? field.value : field.textContent));
      const result = checkTemplate(['factuur'], texts);
      checks.set(result.unknown.length ? checkMessages({ ...result, missing: [] }, ['factuur']) : [{ tone: 'ok', text: texts.length ? 'Alle variabelen in de editor staan in de lijst van e-Boekhouden.' : 'Nog geen tekstvelden gevonden in de editor.' }]);
    }

    return { node, scan };
  }

  // Into a plain field of the editor's page, at its caret, during the click.
  function insertIntoField(field, text) {
    try {
      if (field.isContentEditable) {
        field.focus();
        return field.ownerDocument.execCommand('insertText', false, text);
      }
      if (typeof field.setRangeText === 'function') {
        const start = field.selectionStart ?? field.value.length;
        const end = field.selectionEnd ?? start;
        field.focus();
        field.setRangeText(text, start, end, 'end');
        field.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    } catch { /* a field that takes no text */ }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Columns (app-factuur-sjabloon-regel-form): standalone, or in the frame of
  // the invoice screen. e-Boekhouden's table restyled in place; its inputs,
  // arrows, delete images and buttons stay the ones that work.
  // ---------------------------------------------------------------------------

  const columns = {
    form: null,
    nodes: null,
    framed: false,
    dragging: null,
    lastPost: '',
    queued: false,

    mount(formHost, framed) {
      const table = formHost.querySelector('table');
      if (!table) return;
      if (this.form !== formHost) {
        this.unmount();
        this.form = formHost;
        this.framed = framed;
        formHost.classList.add('ebs-tpl-cols');
        this.build(formHost, framed);
      }
      this.decorate(table);
      this.sync();
    },

    unmount() {
      if (!this.form) return;
      for (const node of Object.values(this.nodes ?? {})) if (node instanceof Node) node.remove();
      this.form.classList.remove('ebs-tpl-cols');
      for (const node of this.form.querySelectorAll('.ebs-tpl-col-ours')) node.remove();
      for (const row of this.form.querySelectorAll('.ebs-tpl-col-row')) row.classList.remove('ebs-tpl-col-row');
      this.form = null;
      this.nodes = null;
    },

    build(formHost, framed) {
      const nodes = {};
      nodes.live = el('span', 'ebs-tpl-sr');
      nodes.live.setAttribute('aria-live', 'polite');
      nodes.help = el('span', 'ebs-tpl-sr', 'Pijl omhoog of omlaag verplaatst de kolom.');
      nodes.help.id = 'ebs-tpl-col-help';
      if (!framed) {
        const head = el('div', 'ebs-tpl-head');
        const back = el('a', 'ebs-tpl-back');
        back.href = '/beheer/sjabloon/factuur';
        back.append(icon('arrow-left'), document.createTextNode('Factuursjablonen'));
        back.addEventListener('click', (event) => {
          if (clickNative(nativeBack(formHost))) event.preventDefault();
        });
        nodes.width = el('span', 'ebs-tpl-width');
        head.append(back, el('h1', 'ebs-tpl-h1', 'Kolommen van de factuurregels'), nodes.width, button('ebs-tpl-link', 'Klassieke weergave', () => setClassic('columns', true)));
        nodes.head = head;
        formHost.prepend(head);
      }
      nodes.note = el('span', 'ebs-tpl-muted small ebs-tpl-cols-note', 'Omschrijving krijgt de rest van de breedte (*). Regeltotaal kan niet weg.');
      formHost.querySelector('table')?.after(nodes.note);
      formHost.append(nodes.live, nodes.help);
      this.nodes = nodes;
      formHost.addEventListener('input', () => this.queue());
      formHost.addEventListener('change', () => this.queue());
    },

    rows(table = this.form?.querySelector('table')) {
      return [...(table?.querySelectorAll('tr') ?? [])].filter((row) => row.querySelector('td.ws-nw'));
    },

    read() {
      return this.rows().map((row) => {
        const id = row.querySelector('td.ws-nw')?.textContent.trim() ?? '';
        const inputs = row.querySelectorAll('input');
        const title = row.querySelector('td.ws-nw + td input')?.value ?? '';
        const widthInput = [...inputs].find((input) => input.getAttribute('maxlength') === '3');
        return { id, title, width: widthInput ? widthInput.value : '*' };
      });
    },

    // Our handle, % and icons in each of e-Boekhouden's rows. The rows are
    // tracked by position, so what we add stays with the position.
    decorate(table) {
      const rows = this.rows(table);
      rows.forEach((row, index) => {
        row.classList.add('ebs-tpl-col-row');
        const cells = [...row.children].filter((cell) => cell.tagName === 'TD' && !cell.classList.contains('ebs-tpl-col-ours'));
        // [delete] [id] [title] [width] [up] [down]
        const [del, idCell, titleCell, widthCell, up, down] = cells;
        if (!row.querySelector(':scope > .ebs-tpl-col-grip')) {
          const grip = el('td', 'ebs-tpl-col-ours ebs-tpl-col-grip');
          const handle = el('span', 'ebs-tpl-col-handle');
          handle.tabIndex = 0;
          handle.setAttribute('role', 'button');
          handle.setAttribute('aria-describedby', 'ebs-tpl-col-help');
          handle.title = 'Slepen klikt de pijltjes van e-Boekhouden';
          handle.append(EBS.icon('grip-vertical'));
          handle.addEventListener('keydown', (event) => this.onKey(event, row));
          handle.addEventListener('pointerdown', (event) => this.onPointerDown(event, row));
          grip.append(handle);
          row.prepend(grip);
        }
        const handle = row.querySelector('.ebs-tpl-col-handle');
        const id = idCell?.textContent.trim() ?? '';
        const titleInput = titleCell?.querySelector('input');
        const label = titleInput?.value || COLUMN_OPTIONS[id]?.title || id;
        handle.setAttribute('aria-label', `Kolom ${label} verplaatsen, plek ${index + 1} van ${rows.length}`);
        if (titleInput) {
          titleInput.setAttribute('aria-label', `Kolomkop ${COLUMN_OPTIONS[id]?.title ?? id}`);
          if (!titleInput.placeholder) titleInput.placeholder = COLUMN_OPTIONS[id]?.title ?? id;
        }
        widthCell?.querySelector('input')?.setAttribute('aria-label', 'Breedte in procenten');
        if (widthCell && !widthCell.querySelector('.ebs-tpl-col-ours')) {
          widthCell.append(el('span', 'ebs-tpl-col-ours ebs-tpl-col-rest', '*'), el('span', 'ebs-tpl-col-ours ebs-tpl-col-pct', '%'));
        }
        for (const [cell, name, text] of [[up, 'arrow-up', 'Omhoog'], [down, 'arrow-down', 'Omlaag']]) {
          if (cell && !cell.querySelector('.ebs-tpl-col-ours')) {
            cell.classList.add('ebs-tpl-col-arrow');
            const mark = el('span', 'ebs-tpl-col-ours ebs-tpl-col-icon');
            mark.append(icon(name));
            cell.append(mark);
            cell.title = text;
          }
        }
        if (del && !del.querySelector('.ebs-tpl-col-ours')) {
          del.classList.add('ebs-tpl-col-del');
          const remove = el('span', 'ebs-tpl-col-ours ebs-tpl-col-icon remove');
          remove.append(EBS.icon('x'));
          const lock = el('span', 'ebs-tpl-col-ours ebs-tpl-col-icon lock');
          lock.title = 'Regeltotaal kan niet weg';
          lock.append(EBS.icon('lock'));
          del.append(remove, lock);
        }
        for (const image of row.querySelectorAll('img')) {
          const src = image.getAttribute('src') ?? '';
          image.setAttribute('alt', /arrow_up/.test(src) ? 'Omhoog' : /arrow_down/.test(src) ? 'Omlaag' : /delete/.test(src) ? 'Kolom verwijderen' : '');
        }
      });
      const add = this.form.querySelector('.middle-bottom-container button.plain-btn');
      if (add && !add.querySelector('.ebs-tpl-col-ours')) {
        const plus = el('span', 'ebs-tpl-col-ours ebs-tpl-col-plus');
        plus.append(EBS.icon('plus'));
        add.prepend(plus);
      }
    },

    queue() {
      if (this.queued) return;
      this.queued = true;
      requestAnimationFrame(() => {
        this.queued = false;
        if (this.form) this.sync();
      });
    },

    sync() {
      const list = this.read();
      const summary = widthSummary(list);
      if (this.nodes?.width) {
        this.nodes.width.textContent = summary.text;
        this.nodes.width.classList.toggle('over', summary.over);
      }
      if (this.framed) this.post({ columns: list });
    },

    post(extra = {}) {
      const height = Math.ceil(this.form?.getBoundingClientRect().height ?? 0) + 8;
      const message = { type: 'ebs-tpl-columns', height, ...extra };
      const key = JSON.stringify(message);
      if (key === this.lastPost && !extra.saved) return;
      this.lastPost = key;
      window.parent.postMessage(message, location.origin);
    },

    nativeArrow(index, dir) {
      const row = this.rows()[index];
      return row?.querySelector(`img[src*="arrow_${dir}"]`) ?? null;
    },

    // One step on e-Boekhouden's own arrow; true when the table followed at once.
    step(index, dir) {
      const arrow = this.nativeArrow(index, dir);
      if (!arrow) return false;
      const before = this.order();
      arrow.click();
      return this.order() !== before;
    },

    order() {
      return this.read().map((one) => one.id).join(',');
    },

    // Until e-Boekhouden redrew its table after a click (or gave up).
    async redrawn(before) {
      for (let i = 0; i < 20 && this.order() === before; i += 1) {
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      }
      return this.order() !== before;
    },

    async move(from, to) {
      for (const { index, dir } of moveSteps(from, to)) {
        const before = this.order();
        if (!this.nativeArrow(index, dir)) break;
        // Each step waits for e-Boekhouden's table, so the next click is on
        // the row that moved and never on another one.
        if (!this.step(index, dir) && !(await this.redrawn(before))) break;
      }
      this.decorate(this.form.querySelector('table'));
      this.sync();
      const list = this.read();
      const moved = list[to];
      if (moved) this.nodes.live.textContent = `Kolom ${moved.title || COLUMN_OPTIONS[moved.id]?.title || moved.id} staat nu op plek ${to + 1} van ${list.length}.`;
    },

    onKey(event, row) {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      event.preventDefault();
      const rows = this.rows();
      const from = rows.indexOf(row);
      const to = from + (event.key === 'ArrowUp' ? -1 : 1);
      if (from < 0 || to < 0 || to >= rows.length) return;
      this.move(from, to).then(() => this.rows()[to]?.querySelector('.ebs-tpl-col-handle')?.focus());
    },

    onPointerDown(event, row) {
      if (event.button !== 0) return;
      event.preventDefault();
      const rows = this.rows();
      const from = rows.indexOf(row);
      if (from < 0) return;
      const tops = rows.map((one) => one.getBoundingClientRect());
      const startY = event.clientY;
      row.classList.add('ebs-tpl-col-lifted');
      const pointerId = event.pointerId;
      let to = from;
      const onMove = (move) => {
        if (move.pointerId !== pointerId) return;
        const dy = move.clientY - startY;
        row.style.transform = `translateY(${dy}px)`;
        const center = tops[from].top + tops[from].height / 2 + dy;
        to = tops.reduce((best, rect, index) => (Math.abs(rect.top + rect.height / 2 - center) < Math.abs(tops[best].top + tops[best].height / 2 - center) ? index : best), from);
        rows.forEach((one, index) => one.classList.toggle('ebs-tpl-col-target', index === to && to !== from));
      };
      const onUp = (up) => {
        if (up.pointerId !== pointerId) return;
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('pointerup', onUp, true);
        document.removeEventListener('pointercancel', onUp, true);
        row.classList.remove('ebs-tpl-col-lifted');
        row.style.transform = '';
        rows.forEach((one) => one.classList.remove('ebs-tpl-col-target'));
        if (to !== from) this.move(from, to);
      };
      // On the document: the pointer leaves the handle while it drags.
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('pointerup', onUp, true);
      document.addEventListener('pointercancel', onUp, true);
    },
  };

  // ---------------------------------------------------------------------------
  // The loop: one sync after any change of the page.
  // ---------------------------------------------------------------------------

  let queued = false;
  let current = null;

  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      sync();
    });
  }

  function hostFor(screen) {
    if (screen === 'email') return document.querySelector('app-email-sjabloon-form');
    if (screen === 'invoice') return document.querySelector('app-factuur-sjabloon-form');
    if (screen === 'columns' || screen === 'frame') return document.querySelector('app-factuur-sjabloon-regel-form');
    return null;
  }

  function sync() {
    if (!settingsLoaded) return;
    const screen = screenOf();
    const better = useBetter(screen);
    document.documentElement.classList.toggle('ebs-tpl-better', better && screen !== 'frame');
    document.documentElement.classList.toggle('ebs-tpl-framed', better && screen === 'frame');
    if (screen !== current) {
      email.unmount();
      invoiceScreen.unmount();
      columns.unmount();
      backLink.unmount();
      current = screen;
    }
    if (!screen) return;
    if (screen === 'frame' && INVOICE_LIST.test(location.pathname)) {
      // e-Boekhouden saved the columns and went to its list, inside our frame.
      if (better && /MSG=/.test(location.search)) columns.post({ saved: true, height: 0 });
      return;
    }
    if (better || settings.betterDesign) injectStyle();
    const host = hostFor(screen);
    if (!host) return;
    if (!better) {
      email.unmount();
      invoiceScreen.unmount();
      columns.unmount();
      if (settings.betterDesign && screen !== 'frame') {
        const form = host.querySelector('app-form');
        if (form) backLink.mount(form, screen);
      } else {
        backLink.unmount();
      }
      return;
    }
    backLink.unmount();
    if (screen === 'email') email.mount(host);
    else if (screen === 'invoice') invoiceScreen.mount(host);
    else columns.mount(host, screen === 'frame');
  }

  // ---------------------------------------------------------------------------
  // Styles. Hover changes fade (150 ms); what appears fades and slides in
  // (transform and opacity), with a plain fade for reduced motion.
  // ---------------------------------------------------------------------------

  function injectStyle() {
    if (document.getElementById('ebs-templates-style')) return;
    const style = document.createElement('style');
    style.id = 'ebs-templates-style';
    style.textContent = CSS;
    document.documentElement.append(style);
  }

  const FIELD = 'height: 40px; box-sizing: border-box; padding: 0 12px; border: 1.5px solid #cfd4e2; border-radius: 9px; background: #fff; color: #232c4f; font: 14px Ubuntu, system-ui, sans-serif;';

  const CSS = `
    .ebs-tpl-native-toggle { margin: 0 0 6px; text-align: right; font-size: 13px; }
    .ebs-tpl-native-toggle a { color: var(--colorPrimary, #30395f); text-decoration: underline; cursor: pointer; transition: color 150ms ease; }

    .ebs-tpl-email, .ebs-tpl-invoice { box-sizing: border-box; margin: 20px 32px; display: grid; gap: 14px; font-family: Ubuntu, system-ui, sans-serif; color: #232c4f; }
    .ebs-tpl-email { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 280px; grid-template-rows: auto auto 1fr; align-items: start; }
    .ebs-tpl-email > .ebs-tpl-head, .ebs-tpl-invoice > .ebs-tpl-head { grid-column: 1 / -1; }
    .ebs-tpl-email > .middle-top-container, .ebs-tpl-invoice > .middle-top-container,
    .ebs-tpl-email > app-form .form-header, .ebs-tpl-invoice app-form .form-header { display: none !important; }
    .ebs-tpl-email > app-form { grid-column: 1; grid-row: 2; width: auto !important; min-width: 0; background: #fff; border-radius: 12px; }
    .ebs-tpl-email > .middle-bottom-container { grid-column: 1; grid-row: 3; font-size: 12px; }
    .ebs-tpl-email > .ebs-tpl-preview { grid-column: 2; grid-row: 2 / span 2; }
    .ebs-tpl-email > .ebs-tpl-vars { grid-column: 3; grid-row: 2 / span 2; }
    .ebs-tpl-email button, .ebs-tpl-invoice button, .ebs-tpl-cols button { font-family: inherit; }

    .ebs-tpl-head { display: flex; align-items: center; gap: 12px; }
    .ebs-tpl-back { display: flex; align-items: center; gap: 4px; font-size: 13px; color: #232c4f; text-decoration: none; transition: color 150ms ease; }
    .ebs-tpl-back:hover { color: #596aaf; }
    .ebs-tpl-h1 { margin: 0; flex: 1; min-width: 0; font-size: 22px; font-weight: 700; color: #232c4f; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ebs-tpl-head-note { max-width: 360px; font-size: 12px; color: #5d6584; }
    .ebs-tpl-link { margin-right: 6px; padding: 0; border: 0; background: none; font-size: 13px; color: #232c4f; text-decoration: underline; cursor: pointer; transition: color 150ms ease; }
    .ebs-tpl-link:hover { color: #596aaf; }
    .ebs-tpl-button { height: 40px; padding: 0 16px; border-radius: 9px; font-size: 14px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; text-decoration: none; box-sizing: border-box; transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease, opacity 150ms ease; }
    .ebs-tpl-button.small { height: 30px; padding: 0 10px; border-radius: 8px; font-size: 12px; }
    .ebs-tpl-button.primary { border: 0; background: #232c4f; color: #fff; font-weight: 700; padding: 0 18px; }
    .ebs-tpl-button.primary:hover { background: #3a4677; }
    .ebs-tpl-button.ghost { border: 1px solid #cfd4e2; background: #fff; color: #232c4f; }
    .ebs-tpl-button.ghost:hover { background: #f3f5fa; border-color: #b9c0d4; }
    .ebs-tpl-button:disabled, .ebs-tpl-button.disabled { opacity: .5; cursor: default; pointer-events: none; }
    .ebs-tpl-button[aria-busy="true"] { cursor: progress; }
    .ebs-tpl-button:focus-visible, .ebs-tpl-link:focus-visible, .ebs-tpl-var:focus-visible, .ebs-tpl-more:focus-visible, .ebs-tpl-picker-button:focus-visible, .ebs-tpl-lang-option:focus-visible, .ebs-tpl-col-handle:focus-visible { outline: 2px solid #232c4f; outline-offset: 2px; }

    /* The e-mail form: e-Boekhouden's own fields, restyled and placed as the board has them. */
    .ebs-tpl-email .ebs-tpl-form form.form { margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important; box-shadow: none !important; }
    .ebs-tpl-email .ebs-tpl-form .form-body { display: grid; grid-template-columns: minmax(0, 1fr) 250px; grid-template-areas: "naam use" "subject subject" "more more" "from email" "cc bcc" "body body" "checks checks"; gap: 12px; padding: 16px 18px; }
    .ebs-tpl-email .form-row { margin: 0 !important; padding: 0 !important; min-width: 0; }
    .ebs-tpl-email .form-row:has(#naam) { grid-area: naam; }
    .ebs-tpl-email .form-row:has(#use_1, #use_2, #use_3) { grid-area: use; }
    .ebs-tpl-email .form-row:has(#subject) { grid-area: subject; }
    .ebs-tpl-email .form-row:has(#vanNaam) { grid-area: from; }
    .ebs-tpl-email .form-row:has(#vanEmail) { grid-area: email; }
    .ebs-tpl-email .form-row:has(#cc) { grid-area: cc; }
    .ebs-tpl-email .form-row:has(#bcc) { grid-area: bcc; }
    .ebs-tpl-email .form-row:has(app-wysiwyg-input) { grid-area: body; }
    .ebs-tpl-email .form-row:is(:has(#vanNaam), :has(#vanEmail), :has(#cc), :has(#bcc)) { display: none !important; }
    .ebs-tpl-email.ebs-tpl-more-open .form-row:is(:has(#vanNaam), :has(#vanEmail), :has(#cc), :has(#bcc)) { display: block !important; animation: ebs-tpl-in 150ms cubic-bezier(0.23, 1, 0.32, 1) both; }
    .ebs-tpl-more { grid-area: more; justify-self: start; display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: none; font-size: 12px; font-weight: 500; color: #3a4677; cursor: pointer; transition: color 150ms ease; }
    .ebs-tpl-more:hover { color: #232c4f; }
    .ebs-tpl-more svg { transition: transform 150ms ease; }
    .ebs-tpl-more-open .ebs-tpl-more svg { transform: rotate(90deg); }
    .ebs-tpl-email .form-component, .ebs-tpl-invoice .form-component { display: flex !important; flex-direction: column; align-items: stretch; gap: 6px; width: auto !important; margin: 0 !important; }
    .ebs-tpl-email app-form-label, .ebs-tpl-invoice app-form-label { width: auto !important; padding: 0 !important; font-size: 13px; font-weight: 500; color: #232c4f; text-align: left !important; }
    .ebs-tpl-email app-form-label label, .ebs-tpl-invoice app-form-label label { font: inherit; color: inherit; }
    .ebs-tpl-email :is(app-text-input, app-wysiwyg-input, app-checkboxlist), .ebs-tpl-invoice :is(app-text-input, app-selectlist, app-file-input, app-checkbox) { display: block !important; width: 100% !important; }
    .ebs-tpl-email app-text-input .form-control, .ebs-tpl-invoice app-text-input .form-control, .ebs-tpl-invoice app-selectlist .form-control { width: 100% !important; }
    .ebs-tpl-email app-text-input input, .ebs-tpl-invoice app-text-input input, .ebs-tpl-invoice app-selectlist select { ${FIELD} width: 100% !important; transition: border-color 150ms ease; }
    .ebs-tpl-invoice app-text-input input, .ebs-tpl-invoice app-selectlist select { height: 36px; padding: 0 10px; }
    .ebs-tpl-email.ebs-tpl-more-open :is(#vanNaam, #vanEmail, #cc, #bcc) { height: 34px; padding: 0 8px; border-radius: 8px; font-size: 13px; }
    .ebs-tpl-email app-text-input input:hover, .ebs-tpl-invoice app-text-input input:hover, .ebs-tpl-invoice app-selectlist select:hover { border-color: #b9c0d4; }
    .ebs-tpl-email app-text-input input:focus, .ebs-tpl-invoice app-text-input input:focus, .ebs-tpl-invoice app-selectlist select:focus { outline: none; border-color: #596aaf; }
    .ebs-tpl-email app-checkboxlist table, .ebs-tpl-email app-checkboxlist tbody { display: flex; flex-direction: column; gap: 6px; }
    .ebs-tpl-email app-checkboxlist tr { display: contents; }
    .ebs-tpl-email app-checkboxlist .checkbox-option { display: flex; align-items: center; gap: 6px; padding: 0 !important; font-size: 13px; }
    .ebs-tpl-email app-checkboxlist .form-check { display: flex; }
    .ebs-tpl-email app-checkboxlist label { margin: 0 !important; font-weight: 400; }
    .ebs-tpl-email .form-row:has(app-wysiwyg-input) app-form-label { display: none !important; }
    .ebs-tpl-email app-wysiwyg-input .form-control { width: 100% !important; min-height: 344px; }
    .ebs-tpl-email app-wysiwyg-input .cke { width: 100% !important; box-sizing: border-box; border: 1.5px solid #cfd4e2 !important; border-radius: 10px; overflow: hidden; box-shadow: none !important; }
    .ebs-tpl-email app-wysiwyg-input .cke_top { background: #f7f8fb !important; border-bottom: 1px solid #e6e9f1 !important; box-shadow: none !important; }
    .ebs-tpl-email app-wysiwyg-input .cke_bottom { background: #f7f8fb !important; border-top: 1px solid #e6e9f1 !important; }
    .ebs-tpl-email .form-footer { display: none !important; }
    .ebs-tpl-checks { grid-area: checks; display: flex; flex-direction: column; gap: 6px; min-height: 18px; }
    .ebs-tpl-check { display: flex; align-items: center; gap: 6px; font-size: 12px; animation: ebs-tpl-fade 150ms ease-out both; }
    .ebs-tpl-check.ok { color: #2f6f1a; }
    .ebs-tpl-check.warn { color: #8a5300; }
    .ebs-tpl-check svg { flex: none; }

    .ebs-tpl-card { background: #fff; border-radius: 12px; display: flex; flex-direction: column; min-width: 0; overflow: hidden; position: sticky; top: 16px; max-height: calc(100vh - 32px); }
    .ebs-tpl-card-head { padding: 14px 18px; border-bottom: 1px solid #eef0f5; display: flex; align-items: center; gap: 10px; }
    .ebs-tpl-card-head .ebs-tpl-title { flex: 1; }
    .ebs-tpl-title { font-size: 15px; font-weight: 700; }
    .ebs-tpl-with { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #5d6584; }
    .ebs-tpl-card-notes { padding: 8px 18px; border-bottom: 1px solid #eef0f5; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .ebs-tpl-grow { flex: 1; }
    .ebs-tpl-badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .ebs-tpl-badges[hidden] { display: none; }
    .ebs-tpl-badge { display: inline-flex; align-items: center; padding: 2px 8px; border: 1px dashed; border-radius: 6px; font-size: 11px; line-height: 16px; font-weight: 400; white-space: normal; }
    .ebs-tpl-badge.request { border-color: #4a6fb5; background: #f2f6ff; color: #2a4a9a; }
    .ebs-tpl-badge.assume { border-color: #c08a1e; background: #fffaf0; color: #7a4b00; }
    .ebs-tpl-badge.plain { border-color: #8c93ab; background: #f7f8fb; color: #4a5272; }
    .ebs-tpl-stage { flex: 1; min-height: 0; overflow: auto; padding: 18px; background: #f3f5fa; }
    .ebs-tpl-mail { background: #fff; border-radius: 10px; box-shadow: 0 2px 8px rgba(20, 26, 48, .08); overflow: hidden; transition: opacity 150ms ease; }
    .ebs-tpl-mail.loading { opacity: .35; }
    .ebs-tpl-mail-head { padding: 12px 16px; border-bottom: 1px solid #eef0f5; display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #5d6584; }
    .ebs-tpl-mail-subject { font-size: 14px; color: #232c4f; font-weight: 700; }
    .ebs-tpl-mail-body { padding: 16px; font-size: 14px; line-height: 1.6; color: #232c4f; overflow-wrap: anywhere; }
    .ebs-tpl-mail-body p { margin: 0 0 10px; }
    .ebs-tpl-unknown { background: #fff1dc; color: #8a5300; padding: 0 3px; border-radius: 3px; }
    .ebs-tpl-novalue { background: #eef0f5; color: #5d6584; padding: 0 3px; border-radius: 3px; font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
    .ebs-tpl-footnote { display: block; margin-top: 10px; font-size: 12px; color: #5d6584; }
    .ebs-tpl-preview-status { display: block; min-height: 16px; padding: 0 18px 10px; font-size: 12px; color: #5d6584; background: #f3f5fa; }
    .ebs-tpl-stage .ebs-tpl-preview-status { padding: 6px 0 0; }
    .ebs-tpl-preview-status[data-tone="error"] { color: #8f1d14; }

    .ebs-tpl-picker { position: relative; display: inline-flex; }
    .ebs-tpl-picker-button { display: inline-flex; align-items: center; gap: 6px; height: 34px; max-width: 280px; padding: 0 8px 0 10px; border: 1px solid #d6dbe8; border-radius: 8px; background: #fff; color: #232c4f; font-size: 13px; cursor: pointer; transition: border-color 150ms ease, background-color 150ms ease; }
    .ebs-tpl-picker-button:hover { border-color: #b9c0d4; background: #f7f8fb; }
    .ebs-tpl-picker-text { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ebs-tpl-picker-panel { position: absolute; right: 0; top: calc(100% + 6px); z-index: 30; width: 320px; padding: 8px; display: flex; flex-direction: column; gap: 6px; background: #fff; border-radius: 10px; box-shadow: 0 12px 32px rgba(20, 26, 48, .22); transform-origin: top right; }
    .ebs-tpl-picker-panel[hidden] { display: none; }
    .ebs-tpl-picker-search, .ebs-tpl-vars-search { height: 34px; box-sizing: border-box; padding: 0 10px; border: 1px solid #d6dbe8; border-radius: 8px; font: 13px Ubuntu, system-ui, sans-serif; color: #232c4f; transition: border-color 150ms ease; }
    .ebs-tpl-picker-search:focus, .ebs-tpl-vars-search:focus { outline: none; border-color: #596aaf; }
    .ebs-tpl-picker-note { min-height: 16px; font-size: 12px; color: #5d6584; }
    .ebs-tpl-pop { display: flex; flex-direction: column; font-family: Ubuntu, system-ui, sans-serif; color: #232c4f; }
    .ebs-tpl-pop.inline { max-height: 280px; overflow: auto; }
    .ebs-tpl-pop.floating { position: fixed; z-index: 2147483000; width: 320px; max-height: 260px; overflow: auto; padding: 6px; box-sizing: border-box; background: #fff; border-radius: 10px; box-shadow: 0 12px 32px rgba(20, 26, 48, .22); transform-origin: top left; }
    .ebs-tpl-pop[hidden] { display: none; }
    .ebs-tpl-option { padding: 8px 10px; border-radius: 6px; display: flex; flex-direction: column; gap: 2px; cursor: pointer; transition: background-color 150ms ease; }
    .ebs-tpl-option[aria-selected="true"] { background: #eef1f8; }
    .ebs-tpl-option-main { font-size: 13px; font-weight: 700; }
    .ebs-tpl-option-sub { font-size: 12px; color: #5d6584; }
    .ebs-tpl-pop-hint { padding: 6px 10px 2px; font-size: 11px; color: #8c93ab; display: flex; align-items: center; gap: 2px; }
    .ebs-tpl-pop-hint span { margin-left: 2px; }
    .ebs-tpl-pop-empty { padding: 8px 10px; font-size: 12px; color: #5d6584; }

    .ebs-tpl-vars { background: #fff; border-radius: 12px; display: flex; flex-direction: column; min-height: 0; overflow: hidden; position: sticky; top: 16px; max-height: calc(100vh - 32px); }
    .ebs-tpl-vars-head { padding: 14px 16px 10px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid #eef0f5; }
    .ebs-tpl-muted { font-size: 12px; color: #5d6584; }
    .ebs-tpl-muted.small { font-size: 11px; }
    .ebs-tpl-vars-list { flex: 1; min-height: 0; overflow: auto; padding: 6px 8px 10px; }
    .ebs-tpl-vars-group { padding: 10px 8px 4px; font-size: 11px; font-weight: 700; color: #8c93ab; text-transform: uppercase; letter-spacing: .04em; }
    .ebs-tpl-var { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; padding: 7px 8px; border: 0; border-radius: 7px; background: transparent; color: #232c4f; text-align: left; cursor: pointer; transition: background-color 150ms ease; }
    .ebs-tpl-var:hover { background: #f3f5fa; }
    .ebs-tpl-var-line { display: flex; align-items: center; gap: 6px; }
    .ebs-tpl-var-code { font-size: 13px; font-weight: 700; font-family: ui-monospace, Menlo, monospace; }
    .ebs-tpl-var-label { font-size: 12px; color: #5d6584; }
    .ebs-tpl-var-badge { padding: 1px 6px; border-radius: 8px; font-size: 10px; }
    .ebs-tpl-var-badge.used { background: #e6f2dc; color: #2f6f1a; }
    .ebs-tpl-var-badge.missing { background: #fff1dc; color: #8a5300; }
    .ebs-tpl-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

    /* The invoice template: column 1 holds the three parts, 2 the sketch, 3 the variables. */
    /* Rows for the parts in column 1, and a last flexible row that takes the
       height of the sketch and the variables, so the parts stay together. */
    .ebs-tpl-invoice { grid-template-columns: 400px minmax(0, 1fr) 260px; grid-template-rows: repeat(11, auto) 1fr; align-items: start; row-gap: 0; }
    .ebs-tpl-invoice > :not(.ebs-tpl-head):not(.ebs-tpl-preview):not(.ebs-tpl-vars) { grid-column: 1; background: #fff; }
    .ebs-tpl-invoice > .ebs-tpl-head { margin-bottom: 14px; }
    .ebs-tpl-invoice > .ebs-tpl-part-head:first-of-type { border-radius: 12px 12px 0 0; }
    .ebs-tpl-invoice > .middle-bottom-container { padding: 0 18px 14px; font-size: 12px; border-radius: 0 0 12px 12px; }
    .ebs-tpl-invoice > .voorbeelden { padding: 0 18px 14px; }
    .ebs-tpl-invoice > .ebs-tpl-preview { grid-column: 2; grid-row: 2 / -1; }
    .ebs-tpl-invoice > .ebs-tpl-vars { grid-column: 3; grid-row: 2 / -1; padding: 0; }
    .ebs-tpl-part-head { display: flex; flex-direction: column; gap: 2px; padding: 14px 18px 4px; }
    .ebs-tpl-part-head.row { flex-direction: row; align-items: flex-start; gap: 8px; padding: 0 0 4px; }
    .ebs-tpl-part-titles { display: flex; flex-direction: column; gap: 2px; flex: 1; }
    .ebs-tpl-part-sub { font-size: 11px; color: #5d6584; }
    .ebs-tpl-invoice .ebs-tpl-part1 { width: auto !important; padding: 0 18px; }
    .ebs-tpl-invoice .ebs-tpl-part1 app-form { width: auto !important; }
    .ebs-tpl-invoice .ebs-tpl-part1 form.form { margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important; box-shadow: none !important; }
    .ebs-tpl-invoice .ebs-tpl-part1 .form-body { display: flex; flex-direction: column; gap: 10px; padding: 6px 0 0; }
    .ebs-tpl-invoice .ebs-tpl-part1 .form-row { margin: 0 !important; padding: 0 !important; }
    .ebs-tpl-invoice .form-component.right-align { margin: 0 !important; }
    .ebs-tpl-invoice.ebs-tpl-lang-buttons .form-row:has(select#taal) { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .ebs-tpl-lang { display: none; align-self: flex-start; padding: 3px; border-radius: 9px; background: #e3e7f0; }
    .ebs-tpl-invoice.ebs-tpl-lang-buttons .ebs-tpl-lang { display: flex; }
    .ebs-tpl-invoice:not(.ebs-tpl-lang-buttons) .ebs-tpl-lang + .ebs-tpl-muted { display: none; }
    .ebs-tpl-lang::before { content: "Taal"; align-self: center; margin: 0 8px 0 4px; font-size: 13px; font-weight: 500; }
    .ebs-tpl-lang-option { height: 30px; padding: 0 12px; border: 0; border-radius: 7px; background: transparent; color: #232c4f; font-size: 13px; cursor: pointer; transition: background-color 150ms ease; }
    .ebs-tpl-lang-option.on { background: #fff; font-weight: 700; }
    .ebs-tpl-lang-option:hover { background: rgba(255, 255, 255, .6); }
    .ebs-tpl-invoice .ebs-tpl-part1 .form-footer { padding: 10px 0 0 !important; margin: 0 !important; border: 0 !important; background: transparent !important; }
    .ebs-tpl-invoice .ebs-tpl-part1 .form-footer .hr { display: none; }
    .ebs-tpl-invoice .ebs-tpl-part1 button.form-submit { height: 34px; padding: 0 14px; border: 0; border-radius: 8px; background: #232c4f; color: #fff; font: 700 13px Ubuntu, system-ui, sans-serif; cursor: pointer; transition: background-color 150ms ease, opacity 150ms ease; }
    .ebs-tpl-invoice .ebs-tpl-part1 button.form-submit:hover { background: #3a4677; }
    .ebs-tpl-invoice .ebs-tpl-part1 button.form-submit:disabled { opacity: .5; cursor: default; }
    .ebs-tpl-part1-note { display: block; padding: 4px 18px 14px; border-bottom: 6px solid #eef0f5; }
    .ebs-tpl-part { display: flex; flex-direction: column; gap: 8px; padding: 14px 18px; }
    .ebs-tpl-part > .ebs-tpl-part-head:not(.row) { padding: 0; }
    .ebs-tpl-part2 { border-bottom: 6px solid #eef0f5; }
    .ebs-tpl-width { font-size: 12px; padding: 2px 8px; border-radius: 10px; white-space: nowrap; background: #eef0f5; color: #4a5272; transition: background-color 150ms ease, color 150ms ease; }
    .ebs-tpl-width.over { background: #fdf0ef; color: #b42318; }
    .ebs-tpl-width[hidden] { visibility: hidden; }
    .ebs-tpl-columns-body { display: flex; flex-direction: column; gap: 8px; }
    .ebs-tpl-columns-frame { width: 100%; height: 320px; border: 0; display: block; }
    .ebs-tpl-status { min-height: 16px; font-size: 12px; color: #2f6f1a; opacity: 0; }
    .ebs-tpl-status.show { animation: ebs-tpl-in 150ms cubic-bezier(0.23, 1, 0.32, 1) both; }
    .ebs-tpl-part3 { border-radius: 0 0 12px 12px; }
    .ebs-tpl-part3 .ebs-tpl-button { align-self: flex-start; }

    .ebs-tpl-stage.sheet { display: flex; justify-content: center; background: #e6e9f1; padding: 20px; }
    .ebs-tpl-sheet { width: 440px; aspect-ratio: 1 / 1.414; flex: none; background: #fff; box-shadow: 0 6px 20px rgba(20, 26, 48, .15); padding: 28px; box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; font-size: 10px; color: #232c4f; overflow: hidden; }
    .ebs-tpl-sheet-top { display: flex; justify-content: space-between; }
    .ebs-tpl-sheet-paper { width: 90px; height: 26px; border: 1px dashed #c5cbdc; color: #8c93ab; display: flex; align-items: center; justify-content: center; }
    .ebs-tpl-sheet-own { text-align: right; line-height: 1.5; }
    .ebs-tpl-sheet-to { margin-top: 14px; line-height: 1.5; }
    .ebs-tpl-sheet-title { margin-top: 10px; font-size: 14px; font-weight: 700; }
    .ebs-tpl-sheet-dates { display: flex; gap: 18px; color: #4a5272; }
    .ebs-tpl-sheet-table { margin-top: 10px; width: 100%; transition: opacity 150ms ease; }
    .ebs-tpl-sheet-table.over { width: 116%; outline: 2px dashed #e5484d; outline-offset: 2px; }
    .ebs-tpl-sheet-table.loading { opacity: .25; }
    .ebs-tpl-sheet-row { display: flex; padding: 5px 0; border-bottom: 1px solid #e6e9f1; }
    .ebs-tpl-sheet-row.head { border-bottom-color: #232c4f; font-weight: 700; }
    .ebs-tpl-sheet-row span { box-sizing: border-box; padding-right: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ebs-tpl-sheet-row span.num { text-align: right; }
    .ebs-tpl-sheet-total { align-self: flex-end; font-size: 12px; font-weight: 700; }
    .ebs-tpl-sheet-foot { margin-top: auto; line-height: 1.5; color: #8c93ab; font-style: italic; }
    .ebs-tpl-sheet.loading .ebs-tpl-sheet-to, .ebs-tpl-sheet.loading .ebs-tpl-sheet-title, .ebs-tpl-sheet.loading .ebs-tpl-sheet-total { opacity: .25; transition: opacity 150ms ease; }

    .ebs-tpl-editor-dialog .ebs-dialog-body { display: grid; grid-template-columns: minmax(0, 1fr) 280px; }
    .ebs-tpl-editor-dialog .ebs-dialog-frame { grid-column: 1; width: 100%; height: 100%; }
    .ebs-tpl-editor-aside { grid-column: 2; display: flex; flex-direction: column; min-height: 0; border-left: 1px solid #eef0f5; }
    .ebs-tpl-editor-aside .ebs-tpl-vars { position: static; max-height: none; flex: 1; border-radius: 0; }
    .ebs-tpl-editor-aside .ebs-tpl-checks { padding: 10px 16px 14px; border-top: 1px solid #eef0f5; }

    /* The columns: e-Boekhouden's table as rows of the board. */
    .ebs-tpl-cols { font-family: Ubuntu, system-ui, sans-serif; color: #232c4f; }
    html.ebs-tpl-better .ebs-tpl-cols { display: block; box-sizing: border-box; max-width: 720px; margin: 20px 32px; padding: 18px; background: #fff; border-radius: 12px; }
    html.ebs-tpl-better .ebs-tpl-cols > .ebs-tpl-head { margin-bottom: 12px; }
    html.ebs-tpl-better .ebs-tpl-cols > div > .middle-top-container, html.ebs-tpl-framed .ebs-tpl-cols .middle-top-container, .ebs-tpl-cols app-form .form-header { display: none !important; }
    .ebs-tpl-cols app-form { width: auto !important; }
    .ebs-tpl-cols form.form { margin: 0 !important; padding: 0 !important; border: 0 !important; background: transparent !important; box-shadow: none !important; }
    .ebs-tpl-cols table { display: block; margin: 0 0 8px !important; border-collapse: separate !important; }
    .ebs-tpl-cols table tbody { display: flex; flex-direction: column; gap: 8px; }
    .ebs-tpl-cols table tr:not(.ebs-tpl-col-row) { display: none; }
    .ebs-tpl-cols tr.ebs-tpl-col-row { display: flex; align-items: center; gap: 6px; padding: 5px 6px; border: 1px solid #e6e9f1; border-radius: 8px; background: #fff; transition: background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease; }
    .ebs-tpl-cols tr.ebs-tpl-col-row > td { display: flex; align-items: center; padding: 0 !important; border: 0 !important; }
    .ebs-tpl-cols tr.ebs-tpl-col-row > td.ebs-tpl-col-grip { order: 0; }
    .ebs-tpl-cols tr.ebs-tpl-col-row > td.ws-nw { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
    .ebs-tpl-cols tr.ebs-tpl-col-row > td.ws-nw + td { order: 1; flex: 1; min-width: 0; }
    .ebs-tpl-cols tr.ebs-tpl-col-row > td.ws-nw + td + td { order: 2; gap: 4px; }
    .ebs-tpl-cols tr.ebs-tpl-col-row > td.ebs-tpl-col-arrow { order: 3; }
    .ebs-tpl-cols tr.ebs-tpl-col-row > td.ebs-tpl-col-del { order: 5; }
    .ebs-tpl-cols tr.ebs-tpl-col-row td.ws-nw + td input { box-sizing: border-box; width: 100% !important; height: 30px; padding: 0 8px; border: 1px solid #d6dbe8; border-radius: 6px; font: 13px Ubuntu, system-ui, sans-serif; color: #232c4f; transition: border-color 150ms ease; }
    .ebs-tpl-cols tr.ebs-tpl-col-row td.ws-nw + td + td input { box-sizing: border-box; width: 46px !important; height: 30px; padding: 0 6px; border: 1px solid #d6dbe8; border-radius: 6px; font: 13px Ubuntu, system-ui, sans-serif; text-align: right; color: #232c4f; transition: border-color 150ms ease; }
    .ebs-tpl-cols tr.ebs-tpl-col-row input:hover { border-color: #b9c0d4; }
    .ebs-tpl-cols tr.ebs-tpl-col-row input:focus { outline: none; border-color: #596aaf; }
    .ebs-tpl-col-rest { display: none; box-sizing: border-box; width: 46px; height: 30px; align-items: center; justify-content: flex-end; padding: 0 6px; border: 1px dashed #d6dbe8; border-radius: 6px; font-size: 13px; color: #8c93ab; }
    .ebs-tpl-cols td:not(:has(input)) > .ebs-tpl-col-rest { display: flex; }
    .ebs-tpl-col-pct { font-size: 12px; color: #5d6584; }
    .ebs-tpl-col-handle { display: flex; color: #8c93ab; cursor: grab; border-radius: 4px; touch-action: none; transition: color 150ms ease; }
    .ebs-tpl-col-handle:hover { color: #232c4f; }
    .ebs-tpl-cols td.ebs-tpl-col-arrow, .ebs-tpl-cols td.ebs-tpl-col-del { position: relative; width: 26px; height: 26px; justify-content: center; color: #4a5272; border-radius: 6px; transition: background-color 150ms ease, color 150ms ease; }
    .ebs-tpl-cols td.ebs-tpl-col-arrow:has(img):hover, .ebs-tpl-cols td.ebs-tpl-col-del:has(img):hover { background: #f3f5fa; color: #232c4f; }
    /* e-Boekhouden's own arrow and delete images stay the click target, invisible over our icon. */
    .ebs-tpl-cols td.ebs-tpl-col-arrow img, .ebs-tpl-cols td.ebs-tpl-col-del img { position: absolute; inset: 0; width: 100% !important; height: 100% !important; opacity: 0; cursor: pointer; }
    .ebs-tpl-col-icon { display: flex; pointer-events: none; }
    .ebs-tpl-cols td.ebs-tpl-col-arrow:not(:has(img)) .ebs-tpl-col-icon { opacity: .3; }
    .ebs-tpl-cols td.ebs-tpl-col-del .ebs-tpl-col-icon.remove { color: #8c93ab; }
    .ebs-tpl-cols td.ebs-tpl-col-del:not(:has(img)) .ebs-tpl-col-icon.remove, .ebs-tpl-cols td.ebs-tpl-col-del:has(img) .ebs-tpl-col-icon.lock { display: none; }
    .ebs-tpl-cols td.ebs-tpl-col-del .ebs-tpl-col-icon.lock { color: #c5cbdc; pointer-events: auto; }
    .ebs-tpl-cols tr.ebs-tpl-col-lifted { position: relative; z-index: 2; border-color: #596aaf; background: #eef1f8; box-shadow: 0 6px 16px rgba(20, 26, 48, .15); transition: box-shadow 150ms ease; }
    .ebs-tpl-cols tr.ebs-tpl-col-target { border-color: #596aaf; border-style: dashed; }
    .ebs-tpl-cols-note { display: block; margin: 0 0 10px; }
    .ebs-tpl-cols .middle-bottom-container { margin: 0 !important; padding: 0 !important; font-size: 13px; }
    .ebs-tpl-cols .middle-bottom-container button.plain-btn { display: inline-flex; align-items: center; gap: 8px; padding: 0; border: 0; background: none; color: #232c4f; font: 13px Ubuntu, system-ui, sans-serif; cursor: pointer; transition: color 150ms ease; }
    .ebs-tpl-cols .middle-bottom-container button.plain-btn:hover { color: #596aaf; }
    .ebs-tpl-col-plus { display: flex; color: #3a4677; }
    .ebs-tpl-cols .addColumnBox { width: auto !important; animation: ebs-tpl-in 150ms cubic-bezier(0.23, 1, 0.32, 1) both; }
    .ebs-tpl-cols .addColumnBox select { height: 32px; border: 1.5px solid #cfd4e2; border-radius: 8px; font: 13px Ubuntu, system-ui, sans-serif; background: #fff; }
    .ebs-tpl-cols .form-footer { padding: 10px 0 0 !important; margin: 0 !important; border: 0 !important; background: transparent !important; }
    .ebs-tpl-cols .form-footer .hr { display: none; }
    .ebs-tpl-cols button.form-submit { height: 34px; padding: 0 14px; border: 0; border-radius: 8px; background: #232c4f; color: #fff; font: 700 13px Ubuntu, system-ui, sans-serif; cursor: pointer; transition: background-color 150ms ease, opacity 150ms ease; }
    .ebs-tpl-cols button.form-submit:hover { background: #3a4677; }
    .ebs-tpl-cols button.form-submit:disabled { opacity: .5; cursor: default; }
    .ebs-tpl-cols .middle-bottom-container a[href*="Handleiding"], .ebs-tpl-cols .middle-bottom-container a[href*="handleiding"] { font-size: 12px; }

    /* In the frame of the invoice screen: only the columns, on white. */
    html.ebs-tpl-framed, html.ebs-tpl-framed body { background: #fff !important; overflow: hidden !important; }
    html.ebs-tpl-framed body * { visibility: hidden; }
    html.ebs-tpl-framed app-factuur-sjabloon-regel-form, html.ebs-tpl-framed app-factuur-sjabloon-regel-form * { visibility: visible; }
    html.ebs-tpl-framed app-factuur-sjabloon-regel-form { position: fixed; inset: 0 0 auto 0; z-index: 2147483000; display: block; padding: 2px; background: #fff; }
    html.ebs-tpl-framed app-factuur-sjabloon-regel-form .middle-top-container, html.ebs-tpl-framed app-factuur-sjabloon-regel-form .middle-bottom-container > a { display: none !important; }

    .ebs-tpl-pop-in { animation: ebs-tpl-pop 150ms cubic-bezier(0.23, 1, 0.32, 1) both; }
    @keyframes ebs-tpl-pop { from { opacity: 0; transform: scale(0.97); } to { opacity: 1; transform: none; } }
    @keyframes ebs-tpl-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
    @keyframes ebs-tpl-fade { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .ebs-tpl-pop-in { animation: ebs-tpl-fade 120ms ease-out both; }
      .ebs-tpl-status.show, .ebs-tpl-cols .addColumnBox, .ebs-tpl-email.ebs-tpl-more-open .form-row:is(:has(#vanNaam), :has(#vanEmail), :has(#cc), :has(#bcc)) { animation: ebs-tpl-fade 120ms ease-out both; }
      .ebs-tpl-more svg { transition: none; }
      .ebs-tpl-cols tr.ebs-tpl-col-lifted { transform: none !important; }
    }
  `;

  // Started last, once every declaration in this file exists.
  function start() {
    EBS.watchSettings((next) => {
      settings = next;
      settingsLoaded = true;
      schedule();
    });
    try {
      chrome.storage.local.get('classicScreens').then(({ classicScreens: stored }) => {
        classicScreens = stored ?? {};
        schedule();
      }, () => {});
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.classicScreens) {
          classicScreens = changes.classicScreens.newValue ?? {};
          schedule();
        }
      });
    } catch { /* orphaned after a reload: the settings watch keeps it off */ }
    // Our own drawing must not wake the loop: only changes outside our nodes.
    const OURS = '.ebs-tpl-head, .ebs-tpl-card, .ebs-tpl-vars, .ebs-tpl-checks, .ebs-tpl-more, .ebs-tpl-pop, .ebs-tpl-part, .ebs-tpl-part-head, .ebs-tpl-part1-note, .ebs-tpl-native-toggle, .ebs-tpl-col-ours, .ebs-tpl-lang, #ebs-templates-style';
    new MutationObserver((records) => {
      const native = records.some((record) => {
        const node = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
        return Boolean(node?.isConnected) && !node.closest(OURS);
      });
      if (native) schedule();
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
    document.addEventListener('change', schedule, true);
    window.addEventListener('pagehide', () => suggest$.close());
    let lastPath = location.pathname + location.search;
    const watch = setInterval(() => {
      // The extension was reloaded: this copy of the script is orphaned.
      if (!chrome.runtime?.id) {
        clearInterval(watch);
        return;
      }
      if (email.nodes) email.syncBusy();
      const path = location.pathname + location.search;
      if (path === lastPath) return;
      lastPath = path;
      schedule();
    }, 300);
  }

  start();
})();
