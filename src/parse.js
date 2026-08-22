// ============================================================================
// PASTE PARSER — turns whatever you copied into a list of clients.
//
// Runs entirely in the browser: no API key, no network call, nothing leaves the
// page. It is deliberately forgiving, because the review table downstream lets
// you fix anything it guessed wrong.
//
// It understands, in rough order of how much it trusts them:
//   1. Labelled text     — "Ava R. — DOB 3/4/2023, intake 5/10/2026"
//   2. CSV / TSV         — with or without a header row
//   3. Caseload exports  — "Last, First (12345)  3/4/2023  F  3/4/2023
//                           999-99-9999  CODE  RHA Behavioral Health
//                           5/10/2026 12:00 PM  Medicaid"
//   4. Anything else with two dates on a line — earlier is the birthday,
//      later is the intake.
// ============================================================================

import { toISODate } from './rules.js';

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

// Social security numbers are stripped before anything else looks at the text —
// they must never end up in a client record or a calendar event.
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;

// Dates we recognise: 3/4/2023, 03-04-23, 2023-03-04, Mar 4 2023, 4 March 2023.
const NUMERIC_DATE = /\b(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/g;
const MONTH_NAMES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const TEXT_DATE = new RegExp(
  `\\b(${Object.keys(MONTH_NAMES).join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b|` +
  `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${Object.keys(MONTH_NAMES).join('|')})[a-z]*\\.?,?\\s+(\\d{4})\\b`,
  'gi'
);

// A two-digit year is read as 19xx once it is more than a year in the future,
// which is what you want for birthdays and never wrong for intake dates.
const expandYear = (y) => {
  if (y >= 1000) return y;
  const century = Math.floor(new Date().getFullYear() / 100) * 100;
  const guess = century + y;
  return guess > new Date().getFullYear() + 1 ? guess - 100 : guess;
};

const makeISO = (y, m, d) => {
  const year = expandYear(y);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(year, m - 1, d);
  // Rejects 2/30 and friends, which JS would silently roll forward.
  if (dt.getFullYear() !== year || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return toISODate(dt);
};

/**
 * Every date in a string, with where it sat and whether a clock time followed
 * it (an admission timestamp in a caseload export looks like "5/10/2026 12:00 PM").
 */
export function findDates(text) {
  const found = [];
  const s = String(text);

  NUMERIC_DATE.lastIndex = 0;
  let m;
  while ((m = NUMERIC_DATE.exec(s)) !== null) {
    const [raw, a, b, c] = m;
    let iso = null;
    if (a.length === 4) iso = makeISO(Number(a), Number(b), Number(c)); // YYYY-MM-DD
    else iso = makeISO(Number(c), Number(a), Number(b));                // M/D/YYYY (US)
    if (iso) found.push({ iso, index: m.index, raw, hasTime: /^\s*\d{1,2}:\d{2}/.test(s.slice(m.index + raw.length)) });
  }

  TEXT_DATE.lastIndex = 0;
  while ((m = TEXT_DATE.exec(s)) !== null) {
    const [raw, mon1, day1, yr1, day2, mon2, yr2] = m;
    const mon = (mon1 || mon2 || '').toLowerCase().slice(0, 4).replace('.', '');
    const monthNum = MONTH_NAMES[mon] || MONTH_NAMES[mon.slice(0, 3)];
    const iso = monthNum ? makeISO(Number(yr1 || yr2), monthNum, Number(day1 || day2)) : null;
    if (iso) found.push({ iso, index: m.index, raw, hasTime: false });
  }

  return found.sort((a, b) => a.index - b.index);
}

// Label matching for "DOB: ...", "Intake — ...", "Admission Date ..." etc.
const LABELS = {
  dob: /\b(d\.?o\.?b\.?|date of birth|birth\s*date|birthday|b-?day|born)\b/i,
  caregiverDob: /\b(caregiver|parent|mom|mother|dad|father|cg)[^.\n]{0,14}\b(d\.?o\.?b\.?|birth\s*date|birthday|b-?day)\b/i,
  intake: /\b(intake|admission|admit(?:ted)?|enroll(?:ment|ed)?|start(?:\s*of\s*service)?|soc)\b/i,
  birth: /\b(birth of child|baby born|delivery|delivered|birth date of (?:the )?(?:baby|infant))\b/i,
};

// Pull "<label> <date>" pairs out of one line. The date has to sit within ~28
// characters of its label so a stray word later in the row cannot claim it.
function labelledDates(line, dates) {
  const out = {};
  const claim = (key, re) => {
    const m = line.match(re);
    if (!m) return;
    const at = m.index + m[0].length;
    const hit = dates.find((d) => d.index >= at - 2 && d.index - at <= 28);
    if (hit && !out[key]) out[key] = hit;
  };
  // Caregiver DOB first: its pattern is a superset of the plain DOB pattern.
  claim('caregiverDob', LABELS.caregiverDob);
  claim('birth', LABELS.birth);
  claim('intake', LABELS.intake);
  claim('dob', LABELS.dob);
  return out;
}

// The name is whatever readable text sits before the first date, minus the
// trailing "(12345)" client ID that caseload exports append.
function extractName(line, firstDateIndex) {
  let head = firstDateIndex > 0 ? line.slice(0, firstDateIndex) : line;
  head = head
    .replace(/\(\s*\d{3,}\s*\)/g, ' ')            // client id
    .replace(/^[\s\-–—•*>#|,;]+/, '')             // bullets / separators
    .replace(new RegExp(`\\b(${[LABELS.dob.source, LABELS.intake.source].join('|')})\\b`, 'gi'), ' ')
    .replace(/[\s,;:|\-–—]+$/, '')       // trailing separator left behind by a label
    .replace(/\s{2,}/g, ' ')
    .trim();
  // "Last, First" reads better as "First Last" on a calendar entry. The surname
  // side may itself hold spaces ("Delacroix Vance, Rowan"); neither side may hold
  // a comma, so a name with more than one comma is left exactly as pasted.
  const swap = head.match(/^([A-Za-z'’\-.][A-Za-z'’\-.\s]*),\s*([A-Za-z][A-Za-z'’\-.\s]*)$/);
  if (swap) head = `${swap[2].trim()} ${swap[1].trim()}`;
  return head.replace(/[\s,]+$/, '').trim();
}

const HEADER_HINTS = /\b(name|client|child|dob|birth|intake|admission|admit|caregiver|parent)\b/i;

const splitCells = (line) => {
  if (line.includes('\t')) return line.split('\t').map((c) => c.trim());
  if ((line.match(/,/g) || []).length >= 2) return line.split(',').map((c) => c.trim());
  return null;
};

const HEADER_MAP = [
  ['caregiverDob', /\b(caregiver|parent|mom|mother|dad|father|cg)\b.*\b(dob|birth)\b/i],
  ['caregiverName', /\b(caregiver|parent|mom|mother|guardian)\b.*\b(name)?\b/i],
  ['intakeDate', /\b(intake|admission|admit|enroll|start|soc)\b/i],
  ['birthDate', /\bbirth of child|baby born|delivery\b/i],
  ['dob', /\b(dob|date of birth|birth\s*date|birthday|born)\b/i],
  ['name', /\b(name|client|child|patient|family)\b/i],
];

function mapHeader(cells) {
  const map = {};
  cells.forEach((cell, i) => {
    for (const [field, re] of HEADER_MAP) {
      if (re.test(cell) && !Object.values(map).includes(field)) { map[i] = field; return; }
    }
  });
  return Object.keys(map).length >= 2 ? map : null;
}

const blank = () => ({
  id: uid(), name: '', nickname: '', dob: '', caregiverName: '', caregiverDob: '',
  intakeDate: '', birthDate: '', type: 'child', notes: '',
});

function rowFromCells(cells, headerMap) {
  const c = blank();
  Object.entries(headerMap).forEach(([i, field]) => {
    const value = (cells[i] || '').trim();
    if (!value) return;
    if (field === 'name' || field === 'caregiverName') {
      c[field] = extractName(value, value.length);
    } else {
      const d = findDates(value)[0];
      if (d) c[field] = d.iso;
    }
  });
  return c;
}

// A caseload export usually announces its own size ("16 client(s) on caseload").
// When it does, that number is worth keeping: comparing it against how many rows
// actually parsed catches a silently dropped client, which is the one failure
// here that would otherwise pass unnoticed.
const DECLARED_COUNT = /\b(\d{1,4})\s+client\(?s?\)?\b/i;

export function findDeclaredCount(text) {
  const m = String(text || '').match(DECLARED_COUNT);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n < 2000 ? n : null;
}

/**
 * Parse a block of pasted text into client rows.
 * Returns `{ clients, skipped, declaredCount }` — `skipped` holds lines that held
 * no usable date, `declaredCount` is the caseload size the paste claims (or null).
 */
export function parseCaseload(text) {
  const clients = [];
  const skipped = [];
  const declaredCount = findDeclaredCount(text);
  if (!text || !text.trim()) return { clients, skipped, declaredCount };

  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');

  // A header row up top switches on column mapping for the whole paste.
  let headerMap = null;
  let startIndex = 0;
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    const line = lines[i];
    if (!line.trim() || findDates(line).length) continue;
    const cells = splitCells(line);
    if (cells && HEADER_HINTS.test(line)) {
      const map = mapHeader(cells);
      if (map) { headerMap = map; startIndex = i + 1; break; }
    }
  }

  for (let i = startIndex; i < lines.length; i++) {
    const rawLine = lines[i];
    if (!rawLine.trim()) continue;

    // Strip SSNs before any date scanning, so 999-99-9999 can never be read as
    // a date and never lands in a record.
    const line = rawLine.replace(SSN_RE, ' ');

    if (headerMap) {
      const cells = splitCells(line);
      if (cells) {
        const c = rowFromCells(cells, headerMap);
        if (c.name || c.dob || c.intakeDate) { finish(c, line); clients.push(c); continue; }
      }
    }

    const dates = findDates(line);
    if (!dates.length) { skipped.push(rawLine.trim()); continue; }

    const c = blank();
    c.name = extractName(line, dates[0].index);

    const labelled = labelledDates(line, dates);
    if (labelled.dob) c.dob = labelled.dob.iso;
    if (labelled.caregiverDob) c.caregiverDob = labelled.caregiverDob.iso;
    if (labelled.intake) c.intakeDate = labelled.intake.iso;
    if (labelled.birth) c.birthDate = labelled.birth.iso;

    // Whatever the labels did not claim gets worked out from the layout.
    const claimed = new Set(Object.values(labelled).map((d) => d.index));
    const rest = dates.filter((d) => !claimed.has(d.index));

    if (!c.dob || !c.intakeDate) {
      // A caseload export prints the birth date twice; the repeat is the DOB.
      const counts = rest.reduce((acc, d) => ({ ...acc, [d.iso]: (acc[d.iso] || 0) + 1 }), {});
      const repeated = Object.keys(counts).find((iso) => counts[iso] > 1);
      // The admission date is the one carrying a clock time.
      const timed = rest.find((d) => d.hasTime);

      if (!c.dob && repeated) c.dob = repeated;
      if (!c.intakeDate && timed && timed.iso !== c.dob) c.intakeDate = timed.iso;

      const leftovers = rest.filter((d) => d.iso !== c.dob && d.iso !== c.intakeDate);
      const unique = [...new Set(leftovers.map((d) => d.iso))].sort();
      if (!c.dob && !c.intakeDate && unique.length >= 2) {
        // Two bare dates: the earlier one is the birthday, the later the intake.
        c.dob = unique[0];
        c.intakeDate = unique[unique.length - 1];
      } else if (!c.dob && unique.length) {
        c.dob = unique[0];
      } else if (!c.intakeDate && unique.length) {
        c.intakeDate = unique[unique.length - 1];
      }
    }

    finish(c, line);
    clients.push(c);
  }

  return { clients, skipped, declaredCount };
}

function finish(c, line) {
  if (/\bpregnan|\bpaa\b|prenatal|expecting/i.test(line)) c.type = 'pregnant';
  if (!c.name) c.name = 'Unnamed client';
}

export { uid };
