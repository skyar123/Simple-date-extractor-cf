// Run with: npm test
// Plain Node, no test framework — the domain logic here is pure functions and
// deserves a check that survives a fresh clone with nothing installed.

import assert from 'node:assert/strict';
import {
  addDays, addMonths, formatAge, formatDate, getClientSchedule, getIssues, getUpcoming, parseDate, toISODate,
} from '../src/rules.js';
import { findDates, findDeclaredCount, parseCaseload } from '../src/parse.js';
import { buildCaseloadIcs, buildClientIcs, buildRemovalIcs, buildZip, countPastDates, displayName, exportedUids, googleCalendarUrl, slug } from '../src/ics.js';

let passed = 0;
const test = (name, fn) => {
  try { fn(); passed++; }
  catch (err) { console.error(`✗ ${name}\n  ${err.message}`); process.exitCode = 1; }
};

// A date far enough out that "next birthday" answers stay stable.
const client = {
  id: 'c1',
  name: 'Ava R',
  dob: '2024-04-12',
  caregiverName: 'M. R',
  caregiverDob: '1994-05-02',
  intakeDate: '2026-02-03',
  type: 'child',
};

// ---- date helpers ----------------------------------------------------------

test('parseDate reads YYYY-MM-DD as local midnight, not UTC', () => {
  const d = parseDate('2026-02-03');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 1);
  assert.equal(d.getDate(), 3);
});

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-02-03', 60), '2026-04-04');
  assert.equal(addDays('2025-12-20', 30), '2026-01-19');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29'); // leap year
});

test('addMonths clamps to the last day of a short month', () => {
  assert.equal(addMonths('2025-08-31', 6), '2026-02-28');
  assert.equal(addMonths('2024-04-12', 16), '2025-08-12');
});

test('formatAge switches from months to years at 24 months', () => {
  assert.equal(formatAge('2024-04-12', '2025-04-12'), '12 mo');
  assert.equal(formatAge('2024-04-12', '2026-10-12'), '2y 6m');
});

// ---- schedule --------------------------------------------------------------

const schedule = getClientSchedule(client);
const find = (id) => schedule.find((m) => m.id === id);

test('baseline and initial treatment plan both land 60 days after intake', () => {
  assert.equal(find('baseline').date, '2026-04-04');
  assert.equal(find('tx-initial').date, '2026-04-04');
});

test('the 6-month reassessment lands 180 days after intake', () => {
  assert.equal(find('six-month').date, '2026-08-02');
});

test('SNIFF starts at 90 days and is marked as repeating every 90', () => {
  assert.equal(find('sniff').date, '2026-05-04');
  assert.equal(find('sniff').recurrence, 'every90');
});

test('treatment plan reviews step 90 days off the initial plan', () => {
  assert.equal(find('tx-review-1').date, '2026-07-03');
  assert.equal(find('tx-review-2').date, '2026-10-01');
});

test('annual / discharge window lands one year after intake', () => {
  assert.equal(find('annual').date, '2027-02-03');
});

test('reviews stop at the end of service instead of running forever', () => {
  const reviews = schedule.filter((m) => m.id.startsWith('tx-review'));
  assert.equal(reviews.length, 4); // through 2027-03-30, inside annual + a grace quarter
  assert.ok(reviews.every((m) => m.date <= addDays(client.intakeDate, 365 + 90)));
});

test('age windows past the end of service are left off', () => {
  // Born 2024-04-12: ASQ-3 ages out in Oct 2029, long after this family closes.
  assert.equal(find('age-asq-out'), undefined);
  assert.equal(find('age-se-switch'), undefined);
});

test('a recurring birthday never bakes in an age that will go stale', () => {
  const label = find('bday-child').label;
  assert.ok(!/turns|\d/.test(label), `the label must carry no age: ${label}`);
  assert.ok(find('bday-child').turning > 0, 'the age is carried separately for the app');
});

test('birthdays resolve to the next occurrence and repeat yearly', () => {
  const bday = find('bday-child');
  assert.equal(bday.recurrence, 'yearly');
  assert.match(bday.date, /-04-12$/);
  assert.ok(bday.date >= toISODate(new Date()), 'the child birthday should not be in the past');
  const cg = find('bday-caregiver');
  assert.match(cg.date, /-05-02$/);
  assert.ok(cg.date >= toISODate(new Date()));
});

test('a milestone list is sorted by date', () => {
  const dates = schedule.map((m) => m.date);
  assert.deepEqual(dates, [...dates].sort());
});

test('age windows appear only while they are still ahead', () => {
  // Born 2024-04-12 → M-CHAT closes at 30 months (2026-10-12).
  const closes = find('age-mchat-close');
  if (toISODate(new Date()) <= '2026-10-12') assert.ok(closes, 'M-CHAT close should be scheduled');
  else assert.equal(closes, undefined, 'a passed age window should be dropped');
});

test('a client with no intake date still gets birthdays', () => {
  const only = getClientSchedule({ id: 'x', name: 'B', dob: '2023-01-05', intakeDate: '' });
  assert.equal(only.length, 1);
  assert.equal(only[0].category, 'birthday');
});

test('a pregnant-AA client waits for the birth date before the 6-month', () => {
  const preg = { id: 'p', name: 'P', intakeDate: '2026-02-03', type: 'pregnant' };
  const s = getClientSchedule(preg);
  assert.equal(s.find((m) => m.id === 'six-month'), undefined);
  assert.ok(s.find((m) => m.id === 'baseline').label.includes('Prenatal'));
  const withBirth = getClientSchedule({ ...preg, birthDate: '2026-05-01' });
  assert.equal(withBirth.find((m) => m.id === 'birth-of-child').date, '2026-06-30');
  assert.equal(withBirth.find((m) => m.id === 'six-month').date, '2026-12-27');
});

test('getUpcoming spans the caseload and stays inside its window', () => {
  const soon = { id: 's', name: 'Soon', dob: toISODate(new Date()), intakeDate: addDays(toISODate(new Date()), -59) };
  const rows = getUpcoming([soon], { days: 30 });
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.date <= addDays(toISODate(new Date()), 30)));
  assert.ok(rows.every((r) => r.client.id === 's'));
});

test('swapped dates are flagged rather than silently scheduled', () => {
  const issues = getIssues({ name: 'X', dob: '2026-02-03', intakeDate: '2024-04-12' });
  assert.ok(issues.some((i) => i.level === 'error' && /before the date of birth/.test(i.message)));
});

// ---- parsing ---------------------------------------------------------------

test('findDates reads slashed, dashed, ISO and written dates', () => {
  const isos = findDates('4/12/2024 and 2026-02-03 and Mar 4, 2023 and 9 August 2022').map((d) => d.iso);
  assert.deepEqual(isos.sort(), ['2022-08-09', '2023-03-04', '2024-04-12', '2026-02-03']);
});

test('findDates rejects impossible dates', () => {
  assert.deepEqual(findDates('2/30/2024 13/5/2024').map((d) => d.iso), []);
});

test('two-digit years resolve to the past for birthdays', () => {
  assert.equal(findDates('8/30/94')[0].iso, '1994-08-30');
});

test('a caseload export row separates the repeated DOB from the timed admission', () => {
  const line = 'Ramirez, Ava (23641)   4/12/2024   F   4/12/2024   999-99-9999   CF-AA   RHA Behavioral Health   2/03/2026 12:00 PM   Medicaid';
  const { clients } = parseCaseload(line);
  assert.equal(clients.length, 1);
  assert.equal(clients[0].dob, '2024-04-12');
  assert.equal(clients[0].intakeDate, '2026-02-03');
  assert.equal(clients[0].name, 'Ava Ramirez');
});

test('social security numbers never survive parsing', () => {
  const { clients } = parseCaseload('Doe, Jane (11) 1/2/2020 F 1/2/2020 123-45-6789 ORG 3/4/2026 9:00 AM');
  const blob = JSON.stringify(clients);
  assert.ok(!blob.includes('123-45-6789'));
  assert.ok(!blob.includes('1989'), 'the SSN tail must not be read as a year');
});

test('labelled text wins over position', () => {
  const { clients } = parseCaseload('Nia B. — DOB 8/30/2022, caregiver DOB 5/2/1994, intake 11/17/2025');
  assert.equal(clients[0].dob, '2022-08-30');
  assert.equal(clients[0].caregiverDob, '1994-05-02');
  assert.equal(clients[0].intakeDate, '2025-11-17');
  assert.equal(clients[0].name, 'Nia B.');
});

test('a bare three-field row reads as name, birthday, intake', () => {
  const { clients } = parseCaseload('Theo W, 2025-01-09, 2026-04-01');
  assert.equal(clients[0].name, 'Theo W');
  assert.equal(clients[0].dob, '2025-01-09');
  assert.equal(clients[0].intakeDate, '2026-04-01');
});

test('a header row switches on column mapping', () => {
  const text = 'Child Name\tDate of Birth\tAdmission Date\nAva R\t4/12/2024\t2/3/2026\nTheo W\t1/9/2025\t4/1/2026';
  const { clients } = parseCaseload(text);
  assert.equal(clients.length, 2);
  assert.equal(clients[0].dob, '2024-04-12');
  assert.equal(clients[1].intakeDate, '2026-04-01');
});

test('pregnant enrolment is detected from the row', () => {
  const { clients } = parseCaseload('Jordan K — pregnant AA — intake 3/2/2026');
  assert.equal(clients[0].type, 'pregnant');
});

test('lines with no date are reported instead of becoming empty clients', () => {
  const { clients, skipped } = parseCaseload('Caseload report — printed Monday\nAva R, 4/12/2024, 2/3/2026');
  assert.equal(clients.length, 1);
  assert.equal(skipped.length, 1);
});

// ---- calendar output -------------------------------------------------------

const { ics, count } = buildClientIcs(client);

test('the per-client calendar is a well-formed VCALENDAR', () => {
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
  assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, count);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, (ics.match(/END:VEVENT/g) || []).length);
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, (ics.match(/END:VALARM/g) || []).length);
  assert.ok(ics.includes('X-WR-CALNAME:A.R. — Due Dates'));
});

test('every line is CRLF-terminated and folded under the 75-octet limit', () => {
  assert.ok(!/[^\r]\n/.test(ics), 'a bare LF slipped through');
  ics.split('\r\n').forEach((line) => assert.ok(line.length <= 75, `line too long: ${line.slice(0, 40)}…`));
});

test('birthdays repeat yearly and are all-day', () => {
  const events = ics.split('BEGIN:VEVENT').filter((b) => b.includes('— birthday'));
  // Child and caregiver birthdays, each with its heads-up entry and the day itself.
  assert.equal(events.length, 4);
  events.forEach((e) => {
    assert.ok(e.includes('RRULE:FREQ=YEARLY'));
    assert.ok(e.includes('DTSTART;VALUE=DATE:'), 'a birthday should be an all-day event');
  });
});

test('without heads-up entries the lead times ride as 9am notifications', () => {
  const quiet = buildClientIcs(client, { headsUp: false }).ics;
  const event = quiet.split('BEGIN:VEVENT').find((b) => b.includes('6-month reassessment'));
  assert.ok(event.includes('TRIGGER:-PT711H'), '30 days ahead at 9am');
  assert.ok(event.includes('TRIGGER:-PT159H'), '7 days ahead at 9am');
  assert.ok(event.includes('TRIGGER:-PT15H'), '1 day ahead at 9am');
  assert.equal(quiet.split('BEGIN:VEVENT').length - 1, buildClientIcs(client).dueCount,
    'notification-only means one entry per deadline');
});

// Reverse the RFC 5545 folding so a whole property can be inspected.
const unfold = (text) => text.replace(/\r\n /g, '');

test('commas and newlines in descriptions are escaped', () => {
  const event = unfold(ics).split('BEGIN:VEVENT').find((b) => b.includes('Baseline assessments'));
  const desc = event.split('\r\n').find((l) => l.startsWith('DESCRIPTION:'));
  assert.ok(desc.includes('\\,'), 'commas must be escaped');
  assert.ok(!/[^\\],/.test(desc), 'an unescaped comma survived');
  assert.ok(desc.includes('\\n'), 'newlines must be escaped into the single line');
  assert.equal(desc.split('\r\n').length, 1, 'a description must be one logical line');
});

test('reminder lead times drive both the entries and the notifications', () => {
  const custom = buildClientIcs(client, { leadTimes: { birthday: [3], sixMonth: [45] } });
  assert.ok(custom.ics.includes('⏳ 45 days'), 'a 45-day heads-up entry');
  assert.ok(custom.ics.includes('🎂 In 3 days'), 'a 3-day birthday heads-up entry');
  const quiet = buildClientIcs(client, { headsUp: false, leadTimes: { sixMonth: [45] } });
  assert.ok(quiet.ics.includes('TRIGGER:-PT1071H'), '45 days ahead at 9am');
});

test('categories can be filtered out of the export', () => {
  const only = buildClientIcs(client, { categories: ['birthday'] });
  assert.equal(only.dueCount, 2, 'two birthdays');
  assert.equal(only.count, 4, 'each birthday brings its one-week heads-up');
  assert.ok(!only.ics.includes('SNIFF'));
});

test('the combined calendar holds every client', () => {
  const two = buildCaseloadIcs([client, { ...client, id: 'c2', name: 'Theo W' }]);
  assert.ok(two.ics.includes('A.R.'));
  assert.ok(two.ics.includes('T.W.'));
  assert.equal(two.count, count * 2);
});

test('UIDs are unique inside a calendar so re-import updates rather than duplicates', () => {
  const uids = ics.split('\r\n').filter((l) => l.startsWith('UID:'));
  assert.equal(new Set(uids).size, uids.length);
});

test('the Google Calendar link is well-formed', () => {
  const url = new URL(googleCalendarUrl(client, find('six-month')));
  assert.equal(url.searchParams.get('action'), 'TEMPLATE');
  assert.match(url.searchParams.get('dates'), /^20260802T080000\/20260802T083000$/);
});

test('slug makes a safe filename', () => {
  assert.equal(slug('Ramirez, Ava (23641)'), 'ramirez-ava-23641');
  assert.equal(slug(''), 'client');
});

// ---- zip -------------------------------------------------------------------

test('the zip carries the right signatures, sizes and entry count', async () => {
  const blob = buildZip([{ name: 'a.ics', text: 'ONE' }, { name: 'b.ics', text: 'TWO' }]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50, 'local file header');
  const eocd = bytes.length - 22;
  assert.equal(view.getUint32(eocd, true), 0x06054b50, 'end of central directory');
  assert.equal(view.getUint16(eocd + 10, true), 2, 'entry count');
  const centralOffset = view.getUint32(eocd + 16, true);
  assert.equal(view.getUint32(centralOffset, true), 0x02014b50, 'central directory header');
  assert.equal(view.getUint32(eocd + 12, true), eocd - centralOffset, 'central directory size');
});


// ---- real-world caseload paste -------------------------------------------
// The shape a CFCR caseload export actually arrives in: a title line, a count
// line, then tab-separated rows whose DOB sits flush against the client id.

const CASELOAD = [
  'Caseload for Reed, Jamie (10000)',
  '16 client(s) on caseload',
  '\t\t\tSmith, Aaron (10101) 5/14/2021\tM\t5/14/2021\t999-99-9999\tNC-CFCR RHA Behavioral Health\t1/20/2026 12:00 PM\t',
  '\t\t\tDelacroix Vance, Rowan (10102) 9/06/2023\tF\t9/06/2023\t999-99-9999\tNC-CFCR RHA Behavioral Health\t4/15/2026 09:00 AM\t',
].join('\n');

test('a caseload export parses past its title and count lines', () => {
  const { clients, skipped, declaredCount } = parseCaseload(CASELOAD);
  assert.equal(clients.length, 2);
  assert.equal(skipped.length, 2, 'the title and count lines are not clients');
  assert.equal(declaredCount, 16);
});

test('a DOB flush against the client id is still read correctly', () => {
  const { clients } = parseCaseload(CASELOAD);
  assert.equal(clients[0].dob, '2021-05-14');
  assert.equal(clients[0].intakeDate, '2026-01-20');
  assert.equal(clients[0].name, 'Aaron Smith');
});

test('a multi-word surname survives the Last, First flip', () => {
  const { clients } = parseCaseload(CASELOAD);
  assert.equal(clients[1].name, 'Rowan Delacroix Vance');
  assert.equal(clients[1].dob, '2023-09-06');
  assert.equal(clients[1].intakeDate, '2026-04-15');
});

test('the declared caseload size is picked up across phrasings', () => {
  assert.equal(findDeclaredCount('16 client(s) on caseload'), 16);
  assert.equal(findDeclaredCount('7 clients'), 7);
  assert.equal(findDeclaredCount('1 client'), 1);
  assert.equal(findDeclaredCount('Caseload for Reed, Jamie (10000)'), null);
});

test('no social security number survives a full caseload paste', () => {
  const { clients } = parseCaseload(CASELOAD);
  assert.ok(!/\d{3}-\d{2}-\d{4}/.test(JSON.stringify(clients)));
});

// ---- initials mode ---------------------------------------------------------

test('displayName reduces a name to initials on request', () => {
  assert.equal(displayName({ name: 'Rowan Delacroix Vance' }, 'initials'), 'R.D.V.');
  assert.equal(displayName({ name: 'Ava R' }, 'initials'), 'A.R.');
  assert.equal(displayName({ name: 'Ava R' }, 'full'), 'A.R.', 'there is no full-name mode');
  assert.equal(displayName({ name: '' }, 'initials'), 'Client');
});

test('initials mode keeps full names out of the calendar entirely', () => {
  const named = { ...client, name: 'Rowan Delacroix Vance', caregiverName: 'Dana Delacroix Vance' };
  const { ics: masked } = buildClientIcs(named, { nameStyle: 'initials' });
  assert.ok(!masked.includes('Rowan'), 'the child first name leaked');
  assert.ok(!masked.includes('Delacroix'), 'the surname leaked');
  assert.ok(!masked.includes('Dana'), 'the caregiver name leaked');
  assert.ok(masked.includes('R.D.V.'));
  // The birthday summary is composed upstream in rules.js, so check it too.
  const bday = masked.split('BEGIN:VEVENT').find((b) => b.includes('birthday'));
  assert.ok(!bday.includes('Rowan'), 'the birthday label leaked the full name');
});

test('a full name cannot be written into a calendar, whatever is asked for', () => {
  const named = { ...client, name: 'Rowan Delacroix Vance', caregiverName: 'Dana Delacroix Vance' };
  // Every mode, including ones that no longer exist and ones that never did.
  ['initials', 'nickname', 'full', 'FULL', '', null, undefined, 'anything'].forEach((mode) => {
    const out = buildClientIcs(named, { nameStyle: mode }).ics;
    assert.ok(!out.includes('Rowan'), `first name leaked under ${JSON.stringify(mode)}`);
    assert.ok(!out.includes('Delacroix'), `surname leaked under ${JSON.stringify(mode)}`);
    assert.ok(!out.includes('Dana'), `caregiver leaked under ${JSON.stringify(mode)}`);
    assert.ok(out.includes('R.D.V.'), `no usable name under ${JSON.stringify(mode)}`);
  });
});

test('a stale "full" setting falls back to initials rather than honouring itself', () => {
  const named = { ...client, name: 'Rowan Delacroix Vance', nickname: 'Sunflower' };
  assert.equal(displayName(named, 'full'), 'R.D.V.');
  assert.equal(displayName(named, 'nickname'), 'Sunflower');
});

test('a nickname is used when there is one, initials when there is not', () => {
  const named = { ...client, name: 'Rowan Delacroix Vance', nickname: 'Sunflower' };
  const nick = buildClientIcs(named, { nameStyle: 'nickname' }).ics;
  assert.ok(nick.includes('Sunflower'));
  assert.ok(!nick.includes('Rowan'), 'the real name stays out');
  assert.ok(!nick.includes('Delacroix'));
  // No nickname set: fall back to initials, never to the full name.
  const bare = { ...client, name: 'Rowan Delacroix Vance' };
  const fallback = buildClientIcs(bare, { nameStyle: 'nickname' }).ics;
  assert.ok(fallback.includes('R.D.V.'));
  assert.ok(!fallback.includes('Rowan'), 'a missing nickname must not reveal the full name');
});

test('a nickname reaches the birthday label and the filename too', () => {
  const named = { ...client, name: 'Rowan Delacroix Vance', nickname: 'Sunflower' };
  const nick = buildClientIcs(named, { nameStyle: 'nickname' }).ics.replace(/\r\n /g, '');
  const bday = nick.split('BEGIN:VEVENT').find((b) => b.includes('birthday'));
  assert.ok(bday.includes('Sunflower'), 'the label composed upstream is rewritten too');
  assert.ok(!bday.includes('Rowan'));
  assert.equal(slug(displayName(named, 'nickname')), 'sunflower');
});

test('displayName covers both modes', () => {
  const c = { name: 'Rowan Delacroix Vance', nickname: 'Sunflower' };
  assert.equal(displayName(c, 'nickname'), 'Sunflower');
  assert.equal(displayName(c, 'initials'), 'R.D.V.');
  assert.equal(displayName(c), 'R.D.V.', 'initials is the default');
  assert.equal(displayName({ name: 'Ann Lee' }, 'nickname'), 'A.L.', 'falls back to initials');
  assert.equal(displayName({ nickname: 'Bluebird' }, 'initials'), 'Bluebird', 'nickname beats nothing');
  assert.equal(displayName({}, 'full'), 'Client');
});


// ---- skipping dates that already passed -------------------------------------

test('skipPast drops one-time dates behind us but keeps recurring ones', () => {
  // A year in service: baseline, initial plan and the 6-month are all history.
  const old = { id: 'o', name: 'Old Case', dob: '2021-05-04', intakeDate: addDays(toISODate(new Date()), -365) };
  const all = buildClientIcs(old);
  const ahead = buildClientIcs(old, { skipPast: true });
  assert.ok(ahead.count < all.count, 'skipPast should remove something');
  assert.ok(ahead.ics.includes('RRULE:FREQ=YEARLY'), 'the birthday must survive');
  assert.ok(ahead.ics.includes('RRULE:FREQ=DAILY;INTERVAL=90'), 'the SNIFF must survive');
  assert.ok(!ahead.ics.includes('OVERDUE'), 'nothing left should be overdue');
  assert.equal(countPastDates([old]), all.dueCount - ahead.dueCount);
});

test('skipPast leaves a brand-new client untouched', () => {
  const fresh = { id: 'f', name: 'New Case', dob: '2024-02-02', intakeDate: toISODate(new Date()) };
  assert.equal(buildClientIcs(fresh, { skipPast: true }).count, buildClientIcs(fresh).count);
  assert.equal(buildClientIcs(fresh, { skipPast: true }).dueCount, buildClientIcs(fresh).dueCount);
  assert.equal(countPastDates([fresh]), 0);
});

test('skipPast is off unless asked for', () => {
  const old = { id: 'o2', name: 'Old', dob: '2021-05-04', intakeDate: addDays(toISODate(new Date()), -365) };
  assert.equal(buildClientIcs(old).count, buildClientIcs(old, { skipPast: false }).count);
});


// ---- advance warnings you can actually see ---------------------------------

test('each lead time becomes its own entry, that many days earlier', () => {
  // Intake far enough out that nothing is past and nothing gets skipped.
  const soon = { id: 'w', name: 'Wren F', dob: '2023-03-03', intakeDate: addDays(toISODate(new Date()), 30) };
  const { ics: out } = buildClientIcs(soon);
  const due = addDays(soon.intakeDate, 180);            // the 6-month
  const blocks = out.split('BEGIN:VEVENT').filter((b) => b.includes('6-month reassessment'));
  assert.equal(blocks.length, 4, '30/7/1-day warnings plus the due date');

  const startOf = (b) => (b.match(/DTSTART;VALUE=DATE:(\d{8})/) || [])[1];
  const dates = blocks.map(startOf).sort();
  assert.deepEqual(dates, [
    addDays(due, -30), addDays(due, -7), addDays(due, -1), due,
  ].map((d) => d.replace(/-/g, '')).sort());
});

test('a warning entry says how many days are left, and the due day says today', () => {
  const soon = { id: 'w2', name: 'Wren F', dob: '2023-03-03', intakeDate: addDays(toISODate(new Date()), 30) };
  const out = buildClientIcs(soon).ics.replace(/\r\n /g, '');
  assert.ok(out.includes('SUMMARY:⏳ 30 days · W.F. — 6-month reassessment due'));
  assert.ok(out.includes('SUMMARY:⏳ 7 days · W.F. — 6-month reassessment due'));
  assert.ok(out.includes('SUMMARY:⏳ 1 day · W.F. — 6-month reassessment due'), 'singular for one day');
  assert.ok(out.includes('SUMMARY:🔴 W.F. — 6-month reassessment due'));
});

const escComma = (s) => s.replace(/,/g, '\\,');

test('a warning entry names the date it is warning about', () => {
  const soon = { id: 'w3', name: 'Wren F', dob: '2023-03-03', intakeDate: addDays(toISODate(new Date()), 30) };
  const out = buildClientIcs(soon).ics.replace(/\r\n /g, '');
  const lead = out.split('BEGIN:VEVENT').find((b) => b.includes('⏳ 30 days') && b.includes('6-month'));
  const due = addDays(soon.intakeDate, 180);
  assert.ok(lead.includes(escComma(formatDate(due, 'full'))), 'the description carries the real due date');
  assert.ok(lead.includes('30 days from this entry'));
});

test('warnings and the due date stay separate events, never merged on re-import', () => {
  const soon = { id: 'w4', name: 'Wren F', dob: '2023-03-03', intakeDate: addDays(toISODate(new Date()), 30) };
  const uids = buildClientIcs(soon).ics.replace(/\r\n /g, '').split('\r\n')
    .filter((l) => l.startsWith('UID:'));
  assert.equal(new Set(uids).size, uids.length, 'every entry needs its own UID');
  assert.ok(uids.some((u) => /-lead30@/.test(u)));
  assert.ok(uids.some((u) => /-lead7@/.test(u)));
});

test('a recurring deadline carries its warning forward too', () => {
  const soon = { id: 'w5', name: 'Wren F', dob: '2023-03-03', intakeDate: addDays(toISODate(new Date()), 30) };
  const blocks = buildClientIcs(soon).ics.replace(/\r\n /g, '').split('BEGIN:VEVENT')
    .filter((b) => /SUMMARY:[^\r\n]*SNIFF update due/.test(b));
  assert.ok(blocks.length >= 2);
  blocks.forEach((b) => assert.ok(b.includes('INTERVAL=90'), 'the warning recurs with the deadline'));
});

test('a warning whose own day has already passed is dropped with skipPast', () => {
  // Due in 3 days: the 30- and 7-day warnings are behind us, the 1-day is not.
  const c3 = { id: 'w6', name: 'Wren F', dob: '2023-03-03', intakeDate: addDays(toISODate(new Date()), 3 - 180) };
  const kept = buildClientIcs(c3, { skipPast: true }).ics;
  const six = kept.split('BEGIN:VEVENT').filter((b) => b.includes('6-month reassessment'));
  assert.equal(six.length, 2, 'only the 1-day warning and the due date remain');
  assert.ok(six.some((b) => b.includes('⏳ 1 day')));
  assert.ok(!six.some((b) => b.includes('⏳ 30 days')), 'the 30-day warning is behind us');
  assert.ok(!six.some((b) => b.includes('⏳ 7 days')), 'so is the 7-day one');
});

test('headsUp can be switched off entirely', () => {
  const quiet = buildClientIcs(client, { headsUp: false });
  assert.ok(!quiet.ics.includes('⏳'), 'no countdown entries');
  assert.ok(quiet.ics.includes('🔴'), 'the due date is still marked');
  assert.equal(quiet.count, quiet.dueCount, 'one entry per deadline');
});

test('every entry is all-day so a week of warnings reads at a glance', () => {
  const out = buildClientIcs(client).ics;
  assert.ok(!out.includes('DTSTART:'), 'no timed events remain');
  assert.equal((out.match(/DTSTART;VALUE=DATE:/g) || []).length, buildClientIcs(client).count);
});


// ---- switching entries and clients off -------------------------------------

test('an unticked deadline is left out of the export', () => {
  const off = { ...client, excluded: { 'six-month': true } };
  const all = buildClientIcs(client);
  const less = buildClientIcs(off);
  assert.ok(!less.ics.includes('6-month reassessment'), 'the deadline is gone');
  assert.ok(less.dueCount < all.dueCount);
  assert.ok(less.ics.includes('SNIFF'), 'everything else stays');
});

test('unticking removes the deadline and its warnings together', () => {
  const soon = { id: 'x1', name: 'Wren F', dob: '2023-03-03', intakeDate: addDays(toISODate(new Date()), 30) };
  const off = { ...soon, excluded: { 'six-month': true } };
  assert.ok(!buildClientIcs(off).ics.includes('6-month reassessment'),
    'no orphan ⏳ warning is left pointing at a deadline that is not there');
});

test('a client switched off drops out of the combined file only', () => {
  const a = { ...client, id: 'a', name: 'Client A' };
  const b = { ...client, id: 'b', name: 'Client B', skip: true };
  const both = buildCaseloadIcs([a, b]);
  assert.ok(both.ics.includes('C.A.'));
  assert.ok(!both.ics.includes('C.B.'));
  // Asking for that client directly still works — skip is about the batch.
  assert.ok(buildClientIcs(b).ics.includes('C.B.'));
});

test('the combined calendar names itself for the caseload', () => {
  const two = buildCaseloadIcs([{ ...client, id: 'a' }, { ...client, id: 'b' }]).ics.replace(/\r\n /g, '');
  assert.ok(two.includes('X-WR-CALNAME:Child First — Caseload Due Dates (2 clients)'));
  assert.ok(two.includes('X-WR-CALDESC:'));
});

test('excluding everything yields an empty but still valid calendar', () => {
  const none = { ...client, excluded: Object.fromEntries(getClientSchedule(client).map((m) => [m.id, true])) };
  const built = buildClientIcs(none);
  assert.equal(built.count, 0);
  assert.ok(built.ics.startsWith('BEGIN:VCALENDAR'));
  assert.ok(built.ics.trimEnd().endsWith('END:VCALENDAR'));
  assert.ok(!built.ics.includes('BEGIN:VEVENT'));
});

test('countPastDates ignores deadlines already switched off', () => {
  const old = { id: 'p1', name: 'Old', dob: '2021-05-04', intakeDate: addDays(toISODate(new Date()), -365) };
  const before = countPastDates([old]);
  const after = countPastDates([{ ...old, excluded: { baseline: true } }]);
  assert.equal(after, before - 1);
});


// ---- discharging a client from a calendar ----------------------------------

test('every exported entry gets a UID that can be cancelled later', () => {
  const c = { id: 'z', name: 'Ann Lee', dob: '2023-02-02', intakeDate: '2026-01-01' };
  const marks = exportedUids(c);
  const live = buildClientIcs(c, { skipPast: false }).ics.replace(/\r\n /g, '')
    .split('\r\n').filter((l) => l.startsWith('UID:')).map((l) => l.slice(4));
  // Everything the calendar received must be cancellable.
  live.forEach((uid) => assert.ok(marks.some((m) => m.uid === uid), `no tombstone for ${uid}`));
});

test('the removal file cancels by UID with a higher sequence', () => {
  const c = { id: 'z2', name: 'Ann Lee', dob: '2023-02-02', intakeDate: '2026-01-01' };
  const { ics: out, count } = buildRemovalIcs(exportedUids(c));
  assert.ok(count > 0);
  assert.equal((out.match(/STATUS:CANCELLED/g) || []).length, count);
  assert.equal((out.match(/SEQUENCE:2/g) || []).length, count, 'must outrank the live SEQUENCE:1');
  assert.ok(out.includes('METHOD:CANCEL'));
  assert.ok(out.startsWith('BEGIN:VCALENDAR') && out.trimEnd().endsWith('END:VCALENDAR'));
});

test('a cancellation carries no name or detail', () => {
  const c = { id: 'z3', name: 'Ann Lee', nickname: 'Bluebird', dob: '2023-02-02', intakeDate: '2026-01-01' };
  const { ics: out } = buildRemovalIcs(exportedUids(c).map((t) => ({ ...t, label: 'Bluebird' })));
  assert.ok(!out.includes('Ann'));
  assert.ok(!out.includes('Bluebird'), 'the label is for the app, not the file');
  assert.ok(!out.includes('DESCRIPTION'));
});

test('removals are de-duplicated and bad rows ignored', () => {
  const one = { uid: 'a@duedates', date: '2026-05-05' };
  const { count } = buildRemovalIcs([one, one, { uid: '', date: '2026-01-01' }, { uid: 'b@duedates' }]);
  assert.equal(count, 1);
});

test('cancelling twice over is harmless', () => {
  const c = { id: 'z4', name: 'Ann Lee', dob: '2023-02-02', intakeDate: '2026-01-01' };
  const marks = exportedUids(c);
  assert.equal(buildRemovalIcs([...marks, ...marks]).count, buildRemovalIcs(marks).count);
});


// ---- UID identity ----------------------------------------------------------

test('a client with no id still gets UIDs of their own', () => {
  const a = buildClientIcs({ name: 'X Y', dob: '2023-01-01', intakeDate: '2026-01-01' }).ics;
  const b = buildClientIcs({ name: 'Q Z', dob: '2024-02-02', intakeDate: '2026-03-03' }).ics;
  assert.ok(!a.includes('UID:undefined'), 'never the literal string "undefined"');
  assert.ok(!a.includes('UID:-'), 'never an empty client key');
  const first = (t) => t.match(/UID:(.*)/)[1];
  assert.notEqual(first(a), first(b), 'two id-less clients must not share an identity');
});

test('the same id-less client is stable across exports', () => {
  const c = { name: 'X Y', dob: '2023-01-01', intakeDate: '2026-01-01' };
  assert.equal(buildClientIcs(c).ics.match(/UID:(.*)/)[1], buildClientIcs({ ...c }).ics.match(/UID:(.*)/)[1],
    'a re-export must still update in place, not duplicate');
});

if (!process.exitCode) console.log(`✓ ${passed} tests passed`);
