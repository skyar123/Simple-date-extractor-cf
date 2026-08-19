// Run with: npm test
// Plain Node, no test framework — the domain logic here is pure functions and
// deserves a check that survives a fresh clone with nothing installed.

import assert from 'node:assert/strict';
import {
  addDays, addMonths, formatAge, getClientSchedule, getIssues, getUpcoming, parseDate, toISODate,
} from '../src/rules.js';
import { findDates, parseCaseload } from '../src/parse.js';
import { buildCaseloadIcs, buildClientIcs, buildZip, googleCalendarUrl, slug } from '../src/ics.js';

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
  assert.ok(ics.includes('X-WR-CALNAME:Ava R — Due Dates'));
});

test('every line is CRLF-terminated and folded under the 75-octet limit', () => {
  assert.ok(!/[^\r]\n/.test(ics), 'a bare LF slipped through');
  ics.split('\r\n').forEach((line) => assert.ok(line.length <= 75, `line too long: ${line.slice(0, 40)}…`));
});

test('birthdays carry a one-week reminder and repeat yearly', () => {
  const event = ics.split('BEGIN:VEVENT').find((b) => b.includes('turns'));
  assert.ok(event.includes('RRULE:FREQ=YEARLY'));
  assert.ok(event.includes('TRIGGER:-P7D'));
  assert.ok(event.includes('DTSTART;VALUE=DATE:'), 'a birthday should be an all-day event');
});

test('the 6-month reassessment carries a one-month reminder', () => {
  const event = ics.split('BEGIN:VEVENT').find((b) => b.includes('6-month reassessment'));
  assert.ok(event.includes('TRIGGER:-P30D'));
  assert.ok(event.includes('TRIGGER:-P7D'));
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

test('reminder lead times can be overridden', () => {
  const custom = buildClientIcs(client, { leadTimes: { birthday: [3], sixMonth: [45] } });
  assert.ok(custom.ics.includes('TRIGGER:-P3D'));
  assert.ok(custom.ics.includes('TRIGGER:-P45D'));
});

test('categories can be filtered out of the export', () => {
  const only = buildClientIcs(client, { categories: ['birthday'] });
  assert.equal(only.count, 2);
  assert.ok(!only.ics.includes('SNIFF'));
});

test('the combined calendar holds every client', () => {
  const two = buildCaseloadIcs([client, { ...client, id: 'c2', name: 'Theo W' }]);
  assert.ok(two.ics.includes('Ava R'));
  assert.ok(two.ics.includes('Theo W'));
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

if (!process.exitCode) console.log(`✓ ${passed} tests passed`);
