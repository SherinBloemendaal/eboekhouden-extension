// Shared, side-effect free helpers for the content scripts (and the tests).
// Loaded first in every e-Boekhouden frame; the other content scripts in the
// same isolated world use them as EBS.*.

(() => {
  const root = typeof window !== 'undefined' ? window : globalThis;
  if (root.EBS) return;

  const SETTINGS_DEFAULTS = Object.freeze({
    betterDesign: false,
    onePassword: true,
    switcher: true,
    relogin: true,
    shiftSelect: true,
    actionBar: true,
  });

  function settingsWithDefaults(stored) {
    return { ...SETTINGS_DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) };
  }

  function statusOf(slot, view) {
    if (slot.id === view?.activeSlotId && view?.loggedIn) return 'active';
    if (slot.expired) return 'expired';
    if (view?.ready?.includes(slot.id)) return 'ready';
    return 'login';
  }

  // The question before a switch reloads the open e-Boekhouden tabs.
  function reloadWarning(tabCount) {
    const what = tabCount === 1 ? 'Het e-Boekhouden-tabblad wordt' : `Alle ${tabCount} e-Boekhouden-tabbladen worden`;
    return `${what} herladen. Niet opgeslagen invoer gaat verloren.`;
  }

  // Same initials as e-Boekhouden's own avatar (getAbbreviation in the shell).
  function initials(name) {
    try {
      if (typeof name !== 'string' || !name) return 'EB';
      let clean = name.replace(/[^0-9a-zA-Z ]+/g, '');
      for (const form of ['BV', 'NV', 'CV', 'VOF']) clean = clean.replace(new RegExp(form, 'gi'), '');
      clean = clean.trim();
      if (!clean) return 'EB';
      const capitals = [...clean].filter((char) => char >= 'A' && char <= 'Z');
      let result = (capitals.length > 1 ? capitals[0] + capitals[1] : clean[0] + (capitals[0] || '')).toUpperCase();
      if (!['SD', 'SS'].includes(result)) return result;
      const words = clean.split(' ').map((word) => word[0]).filter(Boolean);
      result = (words.length >= 2 ? words[0] + words[1] : clean.substring(0, 2)).toUpperCase();
      return ['SD', 'SS'].includes(result) ? clean[0].toUpperCase() : result;
    } catch {
      return 'EB';
    }
  }

  // "3.500,00", "-0,05", "1.234.567,89" -> number. Anything else -> NaN.
  function parseAmount(text) {
    const clean = String(text ?? '').replace(/[\s €]/g, '').replace(/−/g, '-');
    if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(clean)) return Number.NaN;
    return Number(clean.replace(/\./g, '').replace(',', '.'));
  }

  function formatMoney(value) {
    return value.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // "29-09-2026" -> { year: 2026, month: 9, day: 29, key: '2026-09', time } or null.
  function parseDate(text) {
    const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(text ?? '').trim());
    if (!match) return null;
    const [, day, month, year] = match.map(Number);
    return { year, month, day, key: `${year}-${String(month).padStart(2, '0')}`, time: Date.UTC(year, month - 1, day) };
  }

  const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'];

  function monthLabel(key) {
    const [year, month] = key.split('-').map(Number);
    return `${MONTHS[month - 1]} ${year}`;
  }

  // Gmail-style range: after a shift-click on `target`, every row from the
  // anchor up to and including the target takes the anchor's state. Returns
  // the indexes whose checkbox must flip to get there.
  function rangeToggles(checked, anchor, target) {
    if (anchor === null || anchor === undefined || anchor < 0 || anchor >= checked.length) return [];
    const want = checked[anchor];
    const toggles = [];
    for (let i = Math.min(anchor, target); i <= Math.max(anchor, target); i++) {
      if (i !== anchor && checked[i] !== want) toggles.push(i);
    }
    return toggles;
  }

  // A stable key for an imported bank line, used for hiding and grouping.
  function rowSignature(row) {
    return [row.importDate, row.account, row.bookDate, row.amount, row.description].join('|');
  }

  function filterRows(rows, options = {}) {
    const {
      query = '', direction = 'all', period = 'all', size = 'all',
      hidden = [], showHidden = false, group = null, groupOf = {},
    } = options;
    const hiddenSet = new Set(hidden);
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      const signature = rowSignature(row);
      if (!showHidden && hiddenSet.has(signature)) return false;
      if (group && groupOf[signature] !== group) return false;
      if (direction === 'in' && !(row.amount > 0)) return false;
      if (direction === 'out' && !(row.amount < 0)) return false;
      if (period !== 'all' && parseDate(row.bookDate)?.key !== period) return false;
      if (size === 'small' && !(Math.abs(row.amount) < 10)) return false;
      if (size === 'large' && !(Math.abs(row.amount) >= 100)) return false;
      if (needle) {
        const haystack = [
          row.importDate, row.account, row.bookDate, row.description, row.failure, row.note,
          Number.isFinite(row.amount) ? formatMoney(row.amount) : '', String(row.amount),
        ].join(' ').toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }

  function summarize(rows) {
    const summary = { inTotal: 0, inCount: 0, outTotal: 0, outCount: 0, oldest: null };
    for (const row of rows) {
      if (row.amount > 0) {
        summary.inTotal += row.amount;
        summary.inCount += 1;
      } else if (row.amount < 0) {
        summary.outTotal += row.amount;
        summary.outCount += 1;
      }
      const date = parseDate(row.bookDate);
      if (date && (!summary.oldest || date.time < summary.oldest.time)) summary.oldest = date;
    }
    return summary;
  }

  function periodsOf(rows) {
    return [...new Set(rows.map((row) => parseDate(row.bookDate)?.key).filter(Boolean))].sort().reverse();
  }

  function assignGroup(groupOf, signatures, name) {
    const next = { ...groupOf };
    for (const signature of signatures) {
      if (name) next[signature] = name;
      else delete next[signature];
    }
    return next;
  }

  // Rename a group in place: same position in the tabs, same lines. A name
  // that is empty or already taken leaves everything as it is.
  function renameGroup(groups, groupOf, from, to) {
    const name = String(to ?? '').trim();
    if (!name || name === from || !groups.includes(from) || groups.includes(name)) return { groups, groupOf, renamed: false };
    return {
      groups: groups.map((group) => (group === from ? name : group)),
      groupOf: Object.fromEntries(Object.entries(groupOf).map(([signature, group]) => [signature, group === from ? name : group])),
      renamed: true,
    };
  }

  function groupCounts(groupOf, groups) {
    const counts = Object.fromEntries(groups.map((name) => [name, 0]));
    for (const name of Object.values(groupOf)) {
      if (name in counts) counts[name] += 1;
    }
    return counts;
  }

  // Bank descriptions come in a few shapes. Pull out the counterparty and its
  // IBAN where the text says so; otherwise the description stays as it is.
  //   "Naam: Demo Klant B.V. IBAN: NL00DEMO0000000011 Omschrijving: Factuur 12"
  //   "/TRTP/SEPA OVERBOEKING/IBAN/NL00DEMO0000000011/BIC/DEMONL2A/NAME/Demo Klant B.V./REMI/Factuur 12"
  function counterparty(description) {
    const text = String(description ?? '').replace(/\s+/g, ' ').trim();
    let party = null;
    let iban = null;
    let rest = text;
    const sepa = /\/NAME\/([^/]+)/i.exec(text);
    if (sepa) {
      party = sepa[1].trim();
      iban = /\/IBAN\/([^/]+)/i.exec(text)?.[1]?.trim() ?? null;
      rest = /\/REMI\/(?:USTD\/\/)?([^/]+)/i.exec(text)?.[1]?.trim() ?? text;
    } else {
      const named = /Naam:\s*(.+?)(?=\s+(?:IBAN|BIC|Omschrijving|Kenmerk|Machtiging|Incassant|Referentie):|$)/i.exec(text);
      if (named) {
        party = named[1].trim();
        iban = /IBAN:\s*([A-Z]{2}\d{2}[A-Z0-9]{8,30})/i.exec(text)?.[1] ?? null;
        rest = /Omschrijving:\s*(.+?)(?=\s+(?:IBAN|BIC|Kenmerk|Machtiging|Incassant|Referentie):|$)/i.exec(text)?.[1]?.trim() ?? text;
      }
    }
    return { party, iban, rest };
  }

  // A square 128 px crop, compressed; the original file never leaves the browser.
  async function toAvatar(file) {
    const bitmap = await createImageBitmap(file);
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const side = Math.min(bitmap.width, bitmap.height);
    canvas.getContext('2d').drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
    bitmap.close();
    const webp = canvas.toDataURL('image/webp', 0.82);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85);
  }

  root.EBS = Object.freeze({
    toAvatar, counterparty,
    SETTINGS_DEFAULTS, settingsWithDefaults, statusOf, initials, reloadWarning,
    parseAmount, formatMoney, parseDate, monthLabel,
    rangeToggles, rowSignature, filterRows, summarize, periodsOf, assignGroup, renameGroup, groupCounts,
  });
})();
