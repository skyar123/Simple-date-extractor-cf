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

## Reminders — you see them coming

Each lead time becomes **its own all-day entry on the calendar**, that many days
before the deadline, so a warning is something you can see while planning the
week rather than a notification that fires once and is gone:

```
Sat Aug 29   ⏳ 7 days · Rowan Delacroix — 6-month reassessment due
Fri Sep 04   ⏳ 1 day  · Rowan Delacroix — 6-month reassessment due
Sat Sep 05   🔴          Rowan Delacroix — 6-month reassessment due
```

The 🔴 entry is the deadline itself. Anything already past reads
`⚠ OVERDUE`. Every entry also carries a 9am pop-up for the day it sits on, so
you get both the visible countdown and the notification.

Turn **advance warnings** off under Export and it reverts to one entry per
deadline with the lead times as plain pop-ups.

Entries are marked `COLOR:red` for the due date and orange/gold for the
warnings. Some calendar apps honour that; Google keeps its own per-calendar
colour and ignores it, which is why the wording carries the urgency on its own.

| | Default lead time |
| --- | --- |
| Birthdays | **1 week ahead** |
| 6-month reassessment | **1 month ahead**, then 1 week, then 1 day |
| Treatment plan | 2 weeks, 1 week, 1 day |
| Baseline · SNIFF · Birth of Child | 1 week, 1 day |
| Annual / discharge | 1 month, 1 week |
| Age windows | 2 weeks |

All of them are editable under **Export → Reminders**, and any category you do
not want can be switched off entirely. Each lead time you list produces one
warning entry, so trimming `30, 7, 1` to `30, 7` halves the entries for that
category.

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

## Three switches worth knowing about

All live under **Export**, and all are remembered.

**Advance warnings on the calendar** (on by default) — described above.

**Leave out dates that already passed** (on by default). A family eight months
into service has its baseline and early plan reviews behind it; importing those
scatters stale entries back through your calendar. This keeps the export
forward-looking. Birthdays and the 90-day SNIFF are never dropped — their next
occurrence is still ahead — and everything stays visible under *What's coming*.

**How clients are named** — three choices, and **initials is the default**.

| Mode | An event reads | When |
| --- | --- | --- |
| **Initials** (default) | `R.D.V. — 6-month reassessment due` | Anything shared, anything on a phone |
| **Nicknames** | `Sunflower — 6-month reassessment due` | A shared team calendar — far easier to read than initials |
| **Full names** | `Rowan Delacroix Vance — 6-month…` | A private calendar only you see |

A calendar file travels: onto a phone, into a synced account, onto a lock
screen, in front of everyone the calendar is shared with. So the reduced modes
are the starting point and full names are the deliberate exception.

Nicknames are typed straight into the export list — one box per client, all in
one place. **A client with no nickname falls back to initials, never to their
full name**, so a blank box can't quietly reveal more than you asked for. The
naming applies everywhere the name appears: event titles, the birthday labels,
the caregiver line, and the downloaded filenames.

Your full list stays in this browser regardless — the naming only affects what
leaves in a calendar file.

## Choosing what goes in

Nothing has to go into the calendar just because it was worked out.

**Per deadline.** Every row in a client's schedule has a tick box. Untick the
ones that are handled — a baseline you already completed — and they drop out of
every export, along with their advance warnings, so no orphan countdown is left
pointing at a deadline that is not there. Unticked rows stay visible, greyed and
struck through, so they can be switched back on.

**"Caught up".** One button per client unticks everything already past, for when
a family is current and only what is ahead matters. It says how many it will
drop before you press it.

**Per client.** The export screen lists everyone with a tick box and their entry
count. Unticking leaves that client out of the batch downloads while still
letting you grab them individually.

All of it is remembered between visits.

## Getting the calendars into Google

Two ways, both one import each:

**One file, all clients** — a single `.ics` named
`child-first-caseload-15-clients-2026-08-20.ics`, arriving as
*Child First — Caseload Due Dates (15 clients)*. One import into your work
calendar and everything is there. Start here.

**Separate file per client** — a `.zip` with one `.ics` each. More imports, but
each family lands in its own Google calendar, which you can toggle and
colour-code individually. This is also the only way to get per-family colours,
since Google colours by calendar and ignores per-event colour on import.

**Sharing with colleagues:** make a dedicated calendar ("CF Caseload — Due
Dates"), share it with named people from its settings, and import into that one.
Re-importing after a caseload change updates it for everyone at once — they are
subscribed to the calendar, not to a file, so they do nothing. Use nicknames or
initials for anything shared.

Either way: Google Calendar → **Settings → Import & export** → choose the file →
pick the destination calendar → **Import**. Apple Calendar takes the same file
through File → Import; Outlook through File → Open & Export → Import an
iCalendar (.ics).

Re-importing after you fix a date updates the matching events in place rather
than doubling them up, because each event keeps a stable UID.

## Do I need a Google API key?

No. Importing an `.ics` needs no account, no API, no setup — which is why the app
works this way.

An API would buy one thing: the app writing to your Google Calendar directly, so
a change here updates there without re-importing. It costs a Google Cloud
project, an OAuth consent screen, a client ID, and re-consent every so often for
an unverified app. It also means caseload deadlines leaving this browser and
travelling to Google under your work account — worth a conversation with whoever
owns data handling at RHA before doing it, not a switch to flip quietly.

A subscribed calendar (a `webcal:` feed Google re-reads on its own) is the other
option and has the same trade: it needs the data hosted somewhere Google can
reach it, and Google only refreshes external feeds every 8–24 hours.

Re-importing takes about ten seconds and updates entries in place, so the file
route is genuinely the better deal until re-importing becomes the annoying part.

## Where the data lives

In your browser, and nowhere else. There is no account and no server. **Export →
Backup** writes a JSON file you can restore here or on another device — worth
doing before you clear site data.

## Running it

```bash
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
npm test         # 69 checks over the date math, the parser, and the .ics output
```

Deploy on Netlify by connecting this repository directly — `netlify.toml` at
the repo root has the build command and publish directory already set, no
base directory needed.

## A caveat worth keeping

These dates are computed from the intake date. They are a planning aid, not the
record: a treatment plan signed on a different day than it was due shifts every
review after it, and the app has no way to know that. Check anything that matters
against CFCR.
