// ============================================================================
// CALENDAR EXPORT — builds RFC 5545 .ics files, one per client, plus a
// combined file and a .zip of the individual ones.
//
// Reminders ride along inside each event as VALARMs, so once the file is
// imported the calendar app does the nagging. No backend, no account, nothing
// leaves the browser.
// ============================================================================

import { CATEGORY_LABELS, DEFAULT_LEAD_TIMES, formatDate, getClientSchedule, parseDate, todayISO } from './rules.js';

const pad = (n) => String(n).padStart(2, '0');

const stamp = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
         `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};

// Escape per RFC 5545.
const esc = (s) => String(s ?? '')
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const safeUid = (s) => String(s).replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
const compact = (ymd) => ymd.replace(/-/g, '');
const at = (ymd, hour, min = 0) => `${compact(ymd)}T${pad(hour)}${pad(min)}00`;

// Events land at 8am local so reminders arrive during the work day.
const EVENT_HOUR = 8;

// RFC 5545 line folding: continuation lines start with a single space.
const fold = (line) => {
  if (line.length <= 73) return line;
  const parts = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length > 72) { parts.push(' ' + rest.slice(0, 72)); rest = rest.slice(72); }
  if (rest.length) parts.push(' ' + rest);
  return parts.join('\r\n');
};

const RECURRENCE_RULES = {
  yearly: 'RRULE:FREQ=YEARLY',
  every90: 'RRULE:FREQ=DAILY;INTERVAL=90;COUNT=8',
};

const recurrenceNote = {
  yearly: ' (every year)',
  every90: ' (every 90 days)',
};

function eventLines(client, m, leadTimes) {
  const lines = [];
  const name = client.name || 'Client';
  const leads = leadTimes[m.category] || DEFAULT_LEAD_TIMES[m.category] || [7, 1];
  const overdue = !m.recurrence && m.date < todayISO();
  const isBirthday = m.category === 'birthday';

  const summary = isBirthday
    ? `🎂 ${m.label}`
    : `${overdue ? '⚠ OVERDUE · ' : ''}${name} — ${m.label}`;

  const body = [];
  if (m.detail) body.push(m.detail);
  if (m.items?.length) body.push(`Required: ${m.items.join(', ')}.`);
  if (client.caregiverName) body.push(`Caregiver: ${client.caregiverName}`);
  if (client.intakeDate) body.push(`Intake: ${formatDate(client.intakeDate)}`);
  body.push('(Due Dates — Child First)');

  lines.push('BEGIN:VEVENT');
  lines.push(`UID:${safeUid(client.id)}-${safeUid(m.id)}@duedates`);
  lines.push(`DTSTAMP:${stamp()}`);
  lines.push('SEQUENCE:1');

  if (isBirthday) {
    // All-day, so it sits in the banner row rather than blocking 8am.
    lines.push(`DTSTART;VALUE=DATE:${compact(m.date)}`);
    lines.push(`DTEND;VALUE=DATE:${compact(nextDay(m.date))}`);
  } else {
    lines.push(`DTSTART:${at(m.date, EVENT_HOUR)}`);
    lines.push(`DTEND:${at(m.date, EVENT_HOUR, 30)}`);
  }

  if (m.recurrence && RECURRENCE_RULES[m.recurrence]) lines.push(RECURRENCE_RULES[m.recurrence]);
  lines.push(`SUMMARY:${esc(summary)}`);
  lines.push(`DESCRIPTION:${esc(body.join('\n'))}`);
  lines.push(`CATEGORIES:Child First,${esc(CATEGORY_LABELS[m.category] || 'Due date')}`);
  lines.push('TRANSP:TRANSPARENT');

  leads.forEach((days) => {
    lines.push('BEGIN:VALARM');
    // A 0-day lead on an all-day birthday fires at 9am that morning rather
    // than at midnight.
    if (days === 0) lines.push(isBirthday ? 'TRIGGER;RELATED=START:PT9H' : 'TRIGGER:PT0S');
    else lines.push(`TRIGGER:-P${days}D`);
    lines.push('ACTION:DISPLAY');
    const when = days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`;
    const what = isBirthday ? m.label : `${name}: ${m.label}`;
    lines.push(`DESCRIPTION:${esc(`${what} — ${when}${recurrenceNote[m.recurrence] || ''}`)}`);
    lines.push('END:VALARM');
  });

  lines.push('END:VEVENT');
  return lines;
}

const nextDay = (ymd) => {
  const d = parseDate(ymd);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * One .ics for one client — this is the per-client calendar.
 * `options.categories` limits which milestone categories are included.
 */
export function buildClientIcs(client, { leadTimes = DEFAULT_LEAD_TIMES, categories = null } = {}) {
  const name = client.name || 'Client';
  const schedule = getClientSchedule(client)
    .filter((m) => !categories || categories.includes(m.category));

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Child First//Due Dates//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`${name} — Due Dates`)}`,
    `X-WR-CALDESC:${esc(`Child First due dates and reminders for ${name}.`)}`,
  ];
  schedule.forEach((m) => lines.push(...eventLines(client, m, leadTimes)));
  lines.push('END:VCALENDAR');

  return { ics: lines.map(fold).join('\r\n') + '\r\n', count: schedule.length };
}

/** One .ics holding every client — handy for a single "everything" calendar. */
export function buildCaseloadIcs(clients, { leadTimes = DEFAULT_LEAD_TIMES, categories = null } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Child First//Due Dates//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Child First — All Due Dates',
  ];
  let count = 0;
  clients.forEach((client) => {
    getClientSchedule(client)
      .filter((m) => !categories || categories.includes(m.category))
      .forEach((m) => { count++; lines.push(...eventLines(client, m, leadTimes)); });
  });
  lines.push('END:VCALENDAR');
  return { ics: lines.map(fold).join('\r\n') + '\r\n', count };
}

// ---- Google Calendar --------------------------------------------------------

/**
 * A "create this event" link for Google Calendar. Google has no URL that adds a
 * whole calendar at once, so the .ics import is still the way to move a full
 * client across; this is for grabbing one date on the fly.
 */
export function googleCalendarUrl(client, m) {
  const start = m.category === 'birthday' ? compact(m.date) : `${at(m.date, EVENT_HOUR)}`;
  const end = m.category === 'birthday' ? compact(nextDay(m.date)) : `${at(m.date, EVENT_HOUR, 30)}`;
  const details = [m.detail, m.items?.length ? `Required: ${m.items.join(', ')}.` : '']
    .filter(Boolean).join('\n\n');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: m.category === 'birthday' ? m.label : `${client.name || 'Client'} — ${m.label}`,
    dates: `${start}/${end}`,
    details,
  });
  if (m.recurrence === 'yearly') params.set('recur', 'RRULE:FREQ=YEARLY');
  if (m.recurrence === 'every90') params.set('recur', 'RRULE:FREQ=DAILY;INTERVAL=90;COUNT=8');
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// ---- Downloads --------------------------------------------------------------

export const slug = (s) => String(s || 'client').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'client';

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text, filename, mime = 'text/calendar;charset=utf-8') {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

// ---- Minimal ZIP writer (stored, no compression) ---------------------------
// A handful of .ics files compress to nothing worth the bytes, so entries are
// stored verbatim. That keeps this to one small, dependency-free function.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// MS-DOS date/time, which is what the zip format still stores.
const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;

/** Build a .zip Blob from `[{ name, text }]`. */
export function buildZip(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const time = dosTime(now);
  const date = dosDate(now);

  const chunks = [];
  const central = [];
  let offset = 0;

  files.forEach(({ name, text }) => {
    const nameBytes = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);   // local file header signature
    local.setUint16(4, 20, true);           // version needed
    local.setUint16(6, 0x0800, true);       // UTF-8 filename flag
    local.setUint16(8, 0, true);            // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); // compressed size
    local.setUint32(22, data.length, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);           // extra field length

    chunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);     // central directory signature
    dir.setUint16(4, 20, true);             // version made by
    dir.setUint16(6, 20, true);             // version needed
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint16(30, 0, true);             // extra
    dir.setUint16(32, 0, true);             // comment
    dir.setUint16(34, 0, true);             // disk number
    dir.setUint16(36, 0, true);             // internal attrs
    dir.setUint32(38, 0, true);             // external attrs
    dir.setUint32(42, offset, true);        // local header offset
    central.push(new Uint8Array(dir.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  });

  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);       // end of central directory
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
