# Due Dates

Paste a birthday and an intake date. Get every Child First deadline that follows
back as a calendar file — one per client — with the reminders already inside it.

That is the whole app. It does not track completion, hold notes, or store
records. If you want any of that, it lives in the separate CF Assessment
Tracker app.

## What it works out for you

From the **intake date**:

| Deadline | When |
| --- | --- |
| Baseline assessments | intake + 60 days |
| Initial treatment plan | intake + 60 days |
| Treatment plan reviews | every 90 days after that, through the end of service |
| SNIFF update | intake + 90 days, repeating every 90 |
| 6-month reassessment | intake + 180 days |
| Annual review / discharge window | intake + 365 days |

From the **child's date of birth** (and the caregiver's, if you paste it):

- The birthday itself, repeating every year.
- The age windows that change which tools are required: the M-CHAT-R/F opens at
  16 months and closes at 30, a BITSEA baseline moves to PKBS-2 past 48 months,
  and the ASQ-3 ages out at 66 months. Only the ones that fall while the family
  is still in service are scheduled.

**Pregnant caregiver at admission** follows the prenatal path instead: a prenatal
baseline at 60 days, then Birth of Child 60 days after the birth date you add,
and the 6-month 240 days after that.

## Reminders

Every event carries its own alarms, so once the file is imported your calendar
app does the reminding — no backend, no subscription, nothing to keep running.

| | Default lead time |
| --- | --- |
| Birthdays | **1 week ahead** |
| 6-month reassessment | **1 month ahead**, then 1 week, then 1 day |
| Treatment plan | 2 weeks, 1 week, 1 day |
| Baseline · SNIFF · Birth of Child | 1 week, 1 day |
| Annual / discharge | 1 month, 1 week |
| Age windows | 2 weeks |

All of them are editable under **Export → Reminders**, and any category you do
not want can be switched off entirely.

## Pasting your caseload

One client per line. The parser runs in the browser — no API key, nothing sent
anywhere — and understands:

```
Ramirez, Ava (23641)  4/12/2024  F  4/12/2024  999-99-9999  CF-AA  RHA Behavioral Health  2/03/2026 12:00 PM  Medicaid
Nia B. — DOB 8/30/2022, caregiver DOB 5/2/1994, intake 11/17/2025
Theo W, 2025-01-09, 2026-04-01
```

- **Caseload exports** print the birth date twice and the admission date with a
  clock time — that is how the two are told apart. Title lines and the
  `16 client(s) on caseload` line are skipped, and that declared count is checked
  against how many rows actually parsed, so a client that failed to copy is
  reported rather than silently missing.
- **`Last, First` flips to `First Last`**, including multi-word surnames
  (`Delacroix Vance, Rowan` → `Rowan Delacroix Vance`).
- **Labels win** over position, so `DOB …` and `intake …` are always believed.
- **Two bare dates** on a line read as birthday first, intake second.
- **A header row** (`Child Name`, `Date of Birth`, `Admission Date` …) switches on
  column mapping for the whole paste.
- **Social security numbers are stripped before anything is read**, so they can
  never land in a record or a calendar event.

Whatever it works out lands in a review table first. Fix anything that went into
the wrong column before it becomes a calendar.

**Re-pasting is the way to stay current.** Paste the whole caseload again
whenever it changes: rows matching someone already on your list update them in
place rather than adding a second copy, and the button says exactly what will
happen (`Add 2, update 14`). A match needs a shared date of birth plus either the
same name or the same intake date — date of birth alone is not enough, since
siblings share one.

## Two switches worth knowing about

Both live under **Export**, and both are remembered.

**Leave out dates that already passed** (on by default). A family eight months
into service has its baseline and early plan reviews behind it; importing those
scatters stale entries back through your calendar. This keeps the export
forward-looking. Birthdays and the 90-day SNIFF are never dropped — their next
occurrence is still ahead — and everything stays visible under *What's coming*.

**Initials only.** A calendar file travels: onto a phone, into a synced account,
onto a lock screen. This renders every event as `R.D.V. — 6-month reassessment
due` instead of the child's full name, filenames included, while keeping every
date intact. Your full list stays in this browser either way.

## Getting the calendars into Google

1. **Export → One file per client (.zip)**, or download a single client at a time.
2. In Google Calendar, open **Settings → Import & export**.
3. Choose one `.ics`, pick which calendar it goes into, press **Import**.

Doing it once per client file gives each family its own calendar you can toggle
on and off. Apple Calendar takes the same file through File → Import; Outlook
through File → Open & Export → Import an iCalendar (.ics).

Re-importing after you fix a date updates the matching events in place rather
than doubling them up, because each event keeps a stable UID.

## Where the data lives

In your browser, and nowhere else. There is no account and no server. **Export →
Backup** writes a JSON file you can restore here or on another device — worth
doing before you clear site data.

## Running it

```bash
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
npm test         # 51 checks over the date math, the parser, and the .ics output
```

Deploy on Netlify by connecting this repository directly — `netlify.toml` at
the repo root has the build command and publish directory already set, no
base directory needed.

## A caveat worth keeping

These dates are computed from the intake date. They are a planning aid, not the
record: a treatment plan signed on a different day than it was due shifts every
review after it, and the app has no way to know that. Check anything that matters
against CFCR.
