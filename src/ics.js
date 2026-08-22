// ============================================================================
// CALENDAR EXPORT — builds RFC 5545 .ics files, one per client, plus a
// combined file and a .zip of the individual ones.
//
// Reminders ride along inside each event as VALARMs, so once the file is
// imported the calendar app does the nagging. No backend, no account, nothing
// leaves the browser.
// ============================================================================

import { addDays, CATEGORY_LABELS, DEFAULT_LEAD_TIMES, formatDate, getClientSchedule, parseDate, todayISO } from './rules.js';

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

// A short stable hash, used only when a client has no usable id.
const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
};

/**
 * The identity every one of a client's UIDs is built on.
 *
 * This is load-bearing: two clients sharing it would have their entries merged
 * into one by any calendar app, since a UID *is* the event's identity — one
 * family's deadlines would silently overwrite another's. A record with no id
 * (a hand-edited backup, an import from elsewhere) therefore falls back to a
 * hash of the fields that define the client rather than to the string
 * "undefined", which every id-less client would otherwise share.
 */
const clientKey = (client) => {
  const id = safeUid(client?.id || '');
  if (id) return id;
  return `x${hash([client?.name, client?.dob, client?.intakeDate].join('|'))}`;
};
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

const initialsOf = (full) => {
  const letters = String(full || '')
    .split(/[\s,]+/).filter(Boolean)
    .map((part) => part[0])
    .filter((ch) => /[A-Za-z]/.test(ch))
    .join('.')
    .toUpperCase();
  return letters ? `${letters}.` : '';
};

/**
 * How a client is named inside the calendar.
 *
 * A calendar file travels: onto a phone, into a synced account, onto a lock
 * screen, in front of every colleague the calendar is shared with. So a child's
 * full name is NEVER written into one. There are two modes — initials, and a
 * nickname the team already uses — and no third.
 *
 * This is deliberately a floor rather than a preference. An unrecognised mode,
 * an old saved setting, a restored backup from before this rule: all of them
 * land on initials. Nothing routes to the full name, so nothing can regress
 * into leaking one. The full name stays in the browser, where it is needed to
 * tell clients apart, and goes no further.
 */
export function displayName(client, nameStyle = 'initials') {
  const full = (client?.name || '').trim();
  const nickname = (client?.nickname || '').trim();

  if (nameStyle === 'nickname' && nickname) return nickname;
  return initialsOf(full) || nickname || 'Client';
}

// One VEVENT, assembled from parts. Everything here is all-day: a deadline is a
// day you must act by, not a half-hour appointment, and all-day entries sit in
// the banner row where a whole week's warnings can be read at a glance.
function vevent({ uid, date, summary, body, rrule, alarms = [], category, color }) {
  const lines = ['BEGIN:VEVENT'];
  lines.push(`UID:${uid}`);
  lines.push(`DTSTAMP:${stamp()}`);
  lines.push('SEQUENCE:1');
  lines.push(`DTSTART;VALUE=DATE:${compact(date)}`);
  lines.push(`DTEND;VALUE=DATE:${compact(nextDay(date))}`);
  if (rrule) lines.push(rrule);
  lines.push(`SUMMARY:${esc(summary)}`);
  lines.push(`DESCRIPTION:${esc(body)}`);
  lines.push(`CATEGORIES:Child First,${esc(category)}`);
  // RFC 7986. Honoured by some clients and ignored by others (Google keeps its
  // own per-calendar colour), so the wording carries the urgency regardless.
  if (color) lines.push(`COLOR:${color}`);
  lines.push('TRANSP:TRANSPARENT');
  alarms.forEach(({ daysBefore = 0, text }) => {
    lines.push('BEGIN:VALARM');
    // These are all-day events, so a bare -P7D would fire at midnight. Offsetting
    // in hours puts every alarm at 9am on its day instead.
    lines.push(daysBefore > 0
      ? `TRIGGER:-PT${daysBefore * 24 - 9}H`
      : 'TRIGGER;RELATED=START:PT9H');
    lines.push('ACTION:DISPLAY');
    lines.push(`DESCRIPTION:${esc(text)}`);
    lines.push('END:VALARM');
  });
  lines.push('END:VEVENT');
  return lines;
}

/**
 * Every calendar entry for one milestone.
 *
 * With `headsUp` on, each reminder lead time becomes a visible entry of its own
 * sitting that many days earlier — "⏳ 30 days · M.B. — 6-month reassessment
 * due" — so the warning is on the calendar where it can be seen while planning,
 * not only in a notification that fires once and is gone. The due date itself
 * then reads "🔴 DUE TODAY".
 *
 * With `headsUp` off, it is one entry on the due date carrying the lead times as
 * plain VALARM notifications.
 */
function milestoneEvents(client, m, leadTimes, nameStyle, headsUp, skipPast) {
  const out = [];
  const name = displayName(client, nameStyle);
  const leads = [...(leadTimes[m.category] || DEFAULT_LEAD_TIMES[m.category] || [7, 1])]
    .filter((d) => Number.isFinite(d) && d >= 0)
    .sort((a, b) => b - a);
  const today = todayISO();
  const overdue = !m.recurrence && m.date < today;
  const isBirthday = m.category === 'birthday';
  const rrule = m.recurrence ? RECURRENCE_RULES[m.recurrence] : null;
  const category = CATEGORY_LABELS[m.category] || 'Due date';
  const baseUid = `${clientKey(client)}-${safeUid(m.id)}`;

  // Birthday labels are composed in rules.js and already carry the person's
  // name ("Ava Ramirez turns 3"), so initials mode has to reach inside them too.
  const caregiver = displayName({ name: client.caregiverName }, nameStyle);
  // Labels composed upstream (a birthday reads "<name> — birthday") carry the
  // real name, so every one of them is rewritten. No mode skips this.
  const mask = (text) => {
    let out2 = String(text ?? '');
    const full = (client.name || '').trim();
    if (full) out2 = out2.split(full).join(name);
    const cg = (client.caregiverName || '').trim();
    if (cg) out2 = out2.split(cg).join(caregiver);
    return out2;
  };

  const what = isBirthday ? mask(m.label) : `${name} — ${m.label}`;
  const detailLines = [];
  if (m.detail) detailLines.push(mask(m.detail));
  if (m.items?.length) detailLines.push(`Required: ${m.items.join(', ')}.`);
  if (client.caregiverName) detailLines.push(`Caregiver: ${caregiver}`);
  if (client.intakeDate) detailLines.push(`Intake: ${formatDate(client.intakeDate)}`);
  detailLines.push('(Due Dates — Child First)');

  // ---- the advance warnings ----
  if (headsUp) {
    leads.filter((d) => d > 0).forEach((d) => {
      const when = addDays(m.date, -d);
      // A warning whose own day has passed is not a warning any more.
      if (!when || (skipPast && !m.recurrence && when < today)) return;
      const countdown = `${d} day${d === 1 ? '' : 's'}`;
      out.push(...vevent({
        uid: `${baseUid}-lead${d}@duedates`,
        date: when,
        summary: isBirthday
          ? `🎂 In ${countdown} · ${what}`
          : `⏳ ${countdown} · ${what}`,
        body: [
          `Due ${formatDate(m.date, 'full')} — ${countdown} from this entry.`,
          ...detailLines,
        ].join('\n'),
        rrule,
        alarms: [{ text: `${what} — due in ${countdown}${recurrenceNote[m.recurrence] || ''}` }],
        category,
        color: d <= 7 ? 'orange' : 'gold',
      }));
    });
  }

  // ---- the due date ----
  const dueSummary = isBirthday
    ? `🎂 ${what}`
    : overdue
      ? `⚠ OVERDUE · ${what}`
      : `🔴 ${what}`;

  out.push(...vevent({
    uid: `${baseUid}@duedates`,
    date: m.date,
    summary: dueSummary,
    body: detailLines.join('\n'),
    rrule,
    // When the heads-up entries are carrying the advance warnings, the due date
    // only needs to speak for itself; otherwise it carries every lead time as a
    // notification, which is the behaviour without visible warnings.
    alarms: headsUp
      ? [{ text: `${what} — due today${recurrenceNote[m.recurrence] || ''}` }]
      : leads.map((d) => ({
          daysBefore: d,
          text: `${what} — ${d === 0 ? 'due today' : `due in ${d} day${d === 1 ? '' : 's'}`}${recurrenceNote[m.recurrence] || ''}`,
        })),
    category,
    color: isBirthday ? undefined : 'red',
  }));

  return out;
}

const nextDay = (ymd) => {
  const d = parseDate(ymd);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// A milestone that has already come and gone is history, not a reminder. Its
// place is the app's own past-due list, not 46 stale entries scattered back
// through a real calendar. Recurring dates (birthdays, the 90-day SNIFF) always
// stay: their next occurrence is still ahead.
const keepMilestone = (m, skipPast) => !skipPast || !!m.recurrence || m.date >= todayISO();

/**
 * Has this particular deadline been switched off for this client? Ticking a row
 * off in the app — "the baseline is done, don't put it in my calendar" — is
 * recorded as `client.excluded[milestoneId]`, and nothing here second-guesses
 * that: an unticked deadline is left out of every export.
 */
export const isExcluded = (client, m) => !!(client?.excluded && client.excluded[m.id]);

/** A client switched off wholesale is left out of the combined export. */
export const isClientOff = (client) => !!client?.skip;

/** The deadlines that will actually be written for one client. */
export function includedSchedule(client, { categories = null, skipPast = false } = {}) {
  return getClientSchedule(client)
    .filter((m) => !categories || categories.includes(m.category))
    .filter((m) => keepMilestone(m, skipPast))
    .filter((m) => !isExcluded(client, m));
}

/**
 * How many one-time dates a client has already passed — what `skipPast` drops.
 */
export function countPastDates(clients, { categories = null } = {}) {
  return clients.reduce((n, c) => n + getClientSchedule(c)
    .filter((m) => (!categories || categories.includes(m.category)))
    .filter((m) => !keepMilestone(m, true) && !isExcluded(c, m))
    .length, 0);
}

/**
 * A tombstone: the same event, marked cancelled.
 *
 * Importing adds and updates, but it never removes — so a discharged family's
 * deadlines sit in a shared calendar for the rest of the year, and colleagues
 * keep seeing work for a closed case. Re-importing an event under its original
 * UID with STATUS:CANCELLED and a bumped SEQUENCE is how iCalendar says "this
 * one is off"; calendar apps then drop or grey it.
 *
 * It only works for entries that were exported before, since the UID is what
 * matches them up. That is exactly the case here: you cannot discharge a client
 * whose dates you never sent out.
 */
function cancellation(uid, date) {
  return [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp()}`,
    // Must outrank the SEQUENCE:1 the live entries carry, or the cancellation
    // is treated as stale and ignored.
    'SEQUENCE:2',
    'STATUS:CANCELLED',
    'METHOD:CANCEL',
    `DTSTART;VALUE=DATE:${compact(date)}`,
    `DTEND;VALUE=DATE:${compact(nextDay(date))}`,
    'SUMMARY:(removed)',
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ];
}

/**
 * Every UID a client's export would currently produce, so it can be recorded
 * and later cancelled. Ignores the switches: a deadline that was exported under
 * one set of settings still needs cancelling under another.
 */
export function exportedUids(client, { leadTimes = DEFAULT_LEAD_TIMES } = {}) {
  const uids = [];
  getClientSchedule(client).forEach((m) => {
    const baseUid = `${clientKey(client)}-${safeUid(m.id)}`;
    uids.push({ uid: `${baseUid}@duedates`, date: m.date });
    (leadTimes[m.category] || DEFAULT_LEAD_TIMES[m.category] || [7, 1])
      .filter((d) => Number.isFinite(d) && d > 0)
      .forEach((d) => uids.push({ uid: `${baseUid}-lead${d}@duedates`, date: addDays(m.date, -d) }));
  });
  return uids;
}

/**
 * A calendar of nothing but cancellations. Import it into the calendar the
 * originals went to and the discharged clients' entries disappear.
 *
 * `tombstones` is `[{ uid, date }]` — what the app recorded at export time.
 */
export function buildRemovalIcs(tombstones) {
  const seen = new Set();
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Child First//Due Dates//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:CANCEL',
    'X-WR-CALNAME:Child First — Remove Discharged Clients',
  ];
  let count = 0;
  tombstones.forEach(({ uid, date }) => {
    if (!uid || !date || seen.has(uid)) return;
    seen.add(uid);
    count++;
    lines.push(...cancellation(uid, date));
  });
  lines.push('END:VCALENDAR');
  return { ics: lines.map(fold).join('\r\n') + '\r\n', count };
}

/**
 * One .ics for one client — this is the per-client calendar.
 * `options.categories` limits which milestone categories are included.
 */
export function buildClientIcs(client, { leadTimes = DEFAULT_LEAD_TIMES, categories = null, nameStyle = 'initials', skipPast = false, headsUp = true } = {}) {
  const name = displayName(client, nameStyle);
  const schedule = includedSchedule(client, { categories, skipPast });

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Child First//Due Dates//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`${name} — Due Dates`)}`,
    `X-WR-CALDESC:${esc(`Child First due dates and reminders for ${name}.`)}`,
  ];
  let count = 0;
  schedule.forEach((m) => {
    const events = milestoneEvents(client, m, leadTimes, nameStyle, headsUp, skipPast);
    count += events.filter((l) => l === 'BEGIN:VEVENT').length;
    lines.push(...events);
  });
  lines.push('END:VCALENDAR');

  return { ics: lines.map(fold).join('\r\n') + '\r\n', count, dueCount: schedule.length };
}

/** One .ics holding every client — handy for a single "everything" calendar. */
export function buildCaseloadIcs(clients, { leadTimes = DEFAULT_LEAD_TIMES, categories = null, nameStyle = 'initials', skipPast = false, headsUp = true } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Child First//Due Dates//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`Child First — Caseload Due Dates (${clients.filter((c) => !isClientOff(c)).length} clients)`)}`,
    `X-WR-CALDESC:${esc(`Every Child First deadline and birthday reminder for the caseload, exported ${formatDate(todayISO(), 'full')}. Re-import after a change and matching entries update in place.`)}`,
  ];
  let count = 0;
  clients.filter((client) => !isClientOff(client)).forEach((client) => {
    includedSchedule(client, { categories, skipPast })
      .forEach((m) => {
        const events = milestoneEvents(client, m, leadTimes, nameStyle, headsUp, skipPast);
        count += events.filter((l) => l === 'BEGIN:VEVENT').length;
        lines.push(...events);
      });
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
