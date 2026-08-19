import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  CalendarDays, Download, Trash2, Plus, Check, X, AlertTriangle, Info,
  ClipboardPaste, Cake, ChevronDown, Settings2, Users, Package,
  ExternalLink, RotateCcw, Save, Printer,
} from 'lucide-react';

import {
  CATEGORY_LABELS, DEFAULT_LEAD_TIMES, formatAge, formatDate, getClientSchedule,
  getIssues, getOverdue, getRelativeDue, getUpcoming, parseDate, todayISO,
} from './rules.js';
import { parseCaseload, uid } from './parse.js';
import {
  buildCaseloadIcs, buildClientIcs, buildZip, downloadBlob, downloadText,
  googleCalendarUrl, slug,
} from './ics.js';

/* ============================================================
   DUE DATES : paste two dates per client, get a calendar back.
   Sole purpose — deadlines and birthday reminders, exported per
   client as .ics. Phone-first. Autosaves. Nothing leaves the browser.
   ============================================================ */

const STORE_KEY = 'cf_duedates_v1';

const CATEGORY_ORDER = [
  'birthday', 'baseline', 'treatmentPlan', 'sniff', 'sixMonth',
  'birthOfChild', 'annual', 'ageWindow',
];

const emptyClient = () => ({
  id: uid(), name: '', dob: '', caregiverName: '', caregiverDob: '',
  intakeDate: '', birthDate: '', type: 'child', notes: '',
});

const SAMPLE = `Ramirez, Ava (23641)   4/12/2024   F   4/12/2024   999-99-9999   CF-AA   RHA Behavioral Health   2/03/2026 12:00 PM   Medicaid
Nia B. — DOB 8/30/2022, caregiver DOB 5/2/1994, intake 11/17/2025
Theo W, 2025-01-09, 2026-04-01`;

// ---------------------------------------------------------------------------

export default function App() {
  const [clients, setClients] = useState([]);
  const [leadTimes, setLeadTimes] = useState(DEFAULT_LEAD_TIMES);
  const [categories, setCategories] = useState(CATEGORY_ORDER);
  const [tab, setTab] = useState('clients');
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState('');

  // ---- load / autosave ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (Array.isArray(saved.clients)) setClients(saved.clients);
        if (saved.leadTimes) setLeadTimes({ ...DEFAULT_LEAD_TIMES, ...saved.leadTimes });
        if (Array.isArray(saved.categories) && saved.categories.length) setCategories(saved.categories);
      }
    } catch {
      /* corrupt or unavailable storage — start clean rather than blocking the app */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ clients, leadTimes, categories }));
    } catch {
      /* private mode / quota — the export buttons still work */
    }
  }, [clients, leadTimes, categories, loaded]);

  const say = (message) => {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? '' : t)), 3200);
  };

  const exportOpts = { leadTimes, categories };

  // ---- exports ----
  const exportClient = (client) => {
    const { ics, count } = buildClientIcs(client, exportOpts);
    if (!count) return say('Nothing to export for this client yet — add an intake date or a birthday.');
    downloadText(ics, `${slug(client.name)}-due-dates.ics`);
    say(`${count} date${count === 1 ? '' : 's'} exported for ${client.name}.`);
  };

  const exportAllCombined = () => {
    const { ics, count } = buildCaseloadIcs(clients, exportOpts);
    if (!count) return say('No dates to export yet.');
    downloadText(ics, `child-first-due-dates-${todayISO()}.ics`);
    say(`${count} dates exported in one calendar.`);
  };

  const exportAllZipped = () => {
    const files = clients
      .map((c) => ({ client: c, built: buildClientIcs(c, exportOpts) }))
      .filter(({ built }) => built.count > 0)
      .map(({ client, built }) => ({ name: `${slug(client.name)}-due-dates.ics`, text: built.ics }));
    if (!files.length) return say('No dates to export yet.');
    downloadBlob(buildZip(files), `child-first-calendars-${todayISO()}.zip`);
    say(`${files.length} client calendar${files.length === 1 ? '' : 's'} zipped.`);
  };

  const backup = () => {
    downloadText(JSON.stringify({ version: 1, savedAt: new Date().toISOString(), clients, leadTimes, categories }, null, 2),
      `due-dates-backup-${todayISO()}.json`, 'application/json');
    say('Backup saved.');
  };

  const restore = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.clients)) throw new Error('no clients');
        setClients(data.clients);
        if (data.leadTimes) setLeadTimes({ ...DEFAULT_LEAD_TIMES, ...data.leadTimes });
        if (Array.isArray(data.categories) && data.categories.length) setCategories(data.categories);
        say(`Restored ${data.clients.length} client${data.clients.length === 1 ? '' : 's'}.`);
      } catch {
        say('That file did not look like a Due Dates backup.');
      }
    };
    reader.readAsText(file);
  };

  const upcoming = useMemo(
    () => getUpcoming(clients, { days: 60 }).filter((m) => categories.includes(m.category)),
    [clients, categories]
  );
  const overdue = useMemo(
    () => getOverdue(clients).filter((m) => categories.includes(m.category)),
    [clients, categories]
  );

  return (
    <div className="app">
      <Styles />
      <div className="shell">
        <header className="pt-8 pb-6">
          <div className="eyebrow">Child First · deadlines only</div>
          <h1 className="brand">Due&nbsp;Dates</h1>
          <p className="tagline">
            Paste a birthday and an intake date. Get every deadline that follows — plus
            birthday reminders a week ahead and the 6-month a month ahead — as a calendar
            you can import per client.
          </p>
          <div className="privacy mt-4">
            Everything stays in this browser. Nothing is uploaded, and no account is
            involved. Use initials or a nickname if you would rather not type full names.
          </div>
        </header>

        <nav className="tabs" role="tablist">
          <TabButton id="clients" tab={tab} setTab={setTab} icon={Users}>
            Clients{clients.length ? ` (${clients.length})` : ''}
          </TabButton>
          <TabButton id="calendar" tab={tab} setTab={setTab} icon={CalendarDays}>
            What&apos;s coming
          </TabButton>
          <TabButton id="export" tab={tab} setTab={setTab} icon={Download}>Export</TabButton>
        </nav>

        {tab === 'clients' && (
          <ClientsTab
            clients={clients} setClients={setClients}
            exportClient={exportClient} say={say} categories={categories}
          />
        )}

        {tab === 'calendar' && (
          <CalendarTab clients={clients} upcoming={upcoming} overdue={overdue} />
        )}

        {tab === 'export' && (
          <ExportTab
            clients={clients} leadTimes={leadTimes} setLeadTimes={setLeadTimes}
            categories={categories} setCategories={setCategories}
            exportClient={exportClient} exportAllCombined={exportAllCombined}
            exportAllZipped={exportAllZipped} backup={backup} restore={restore}
          />
        )}

        <footer className="foot">
          Deadlines are computed from the intake date using the Child First protocol
          intervals — baseline and initial plan at 60 days, SNIFF every 90, plan reviews
          every 90, the 6-month at 180, the annual window at 365. They are a planning aid,
          not the record. Check anything that matters against CFCR.
        </footer>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function TabButton({ id, tab, setTab, icon: Icon, children }) {
  return (
    <button
      className={'tab ' + (tab === id ? 'tab-on' : '')}
      role="tab" aria-selected={tab === id}
      onClick={() => setTab(id)}
    >
      <Icon size={15} /> {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// CLIENTS
// ---------------------------------------------------------------------------

function ClientsTab({ clients, setClients, exportClient, say, categories }) {
  const [paste, setPaste] = useState('');
  const [review, setReview] = useState(null);
  const [skipped, setSkipped] = useState([]);

  const read = () => {
    const { clients: parsed, skipped: missed } = parseCaseload(paste);
    if (!parsed.length) {
      say(missed.length ? 'No dates found in that paste — check the review tips below.' : 'Nothing to read yet.');
      setSkipped(missed);
      return;
    }
    setReview(parsed);
    setSkipped(missed);
  };

  const commit = () => {
    setClients((prev) => [...prev, ...review]);
    say(`Added ${review.length} client${review.length === 1 ? '' : 's'}.`);
    setReview(null);
    setPaste('');
    setSkipped([]);
  };

  const update = (id, patch) =>
    setClients((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const remove = (id) => setClients((prev) => prev.filter((c) => c.id !== id));

  return (
    <section>
      {!review && (
        <div className="card mt-5">
          <div className="card-title"><ClipboardPaste size={16} /> Paste your caseload</div>
          <p className="hint">
            One client per line. It reads caseload exports, spreadsheet rows, and plain
            notes like <code>Ava R — DOB 4/12/2024, intake 2/3/2026</code>. Social security
            numbers are stripped before anything is read.
          </p>
          <textarea
            className="ta paste"
            rows={6}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={SAMPLE}
            spellCheck={false}
          />
          <div className="flex gap-2 flex-wrap mt-3">
            <button className="btn-primary" onClick={read} disabled={!paste.trim()}>
              <Check size={16} /> Read these
            </button>
            <button className="btn-quiet" onClick={() => setPaste(SAMPLE)}>Try an example</button>
            <button
              className="btn-ghost"
              onClick={() => setClients((prev) => [...prev, emptyClient()])}
            >
              <Plus size={15} /> Add one by hand
            </button>
          </div>
          {skipped.length > 0 && (
            <div className="note mt-3">
              {skipped.length} line{skipped.length === 1 ? '' : 's'} had no date and
              {skipped.length === 1 ? ' was' : ' were'} skipped.
            </div>
          )}
        </div>
      )}

      {review && (
        <ReviewTable
          rows={review}
          setRows={setReview}
          onConfirm={commit}
          onCancel={() => setReview(null)}
        />
      )}

      {clients.length === 0 && !review && (
        <div className="empty mt-5">No clients yet. Paste a few lines above.</div>
      )}

      {clients.map((c) => (
        <ClientCard
          key={c.id} client={c} categories={categories}
          onChange={(patch) => update(c.id, patch)}
          onRemove={() => remove(c.id)}
          onExport={() => exportClient(c)}
        />
      ))}

      {clients.length > 1 && (
        <button
          className="btn-ghost mt-4"
          onClick={() => { if (confirm2(clients.length)) setClients([]); }}
        >
          <Trash2 size={15} /> Clear all clients
        </button>
      )}
    </section>
  );
}

const confirm2 = (n) =>
  window.confirm(`Remove all ${n} clients from this browser? Export or back up first if you want to keep them.`);

function ReviewTable({ rows, setRows, onConfirm, onCancel }) {
  const set = (id, patch) => setRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const drop = (id) => setRows(rows.filter((r) => r.id !== id));

  return (
    <div className="card mt-5 review">
      <div className="card-title"><Check size={16} /> Check these before they go in</div>
      <p className="hint">
        Fix anything that landed in the wrong column — the birthday and the intake date are
        the two that drive every deadline.
      </p>
      {rows.map((r) => (
        <div className="review-row" key={r.id}>
          <div className="review-grid">
            <Field label="Name">
              <input className="in" value={r.name} onChange={(e) => set(r.id, { name: e.target.value })} />
            </Field>
            <Field label="Child DOB">
              <input className="in" type="date" value={r.dob} onChange={(e) => set(r.id, { dob: e.target.value })} />
            </Field>
            <Field label="Intake date">
              <input className="in" type="date" value={r.intakeDate} onChange={(e) => set(r.id, { intakeDate: e.target.value })} />
            </Field>
            <Field label="Caregiver DOB (optional)">
              <input className="in" type="date" value={r.caregiverDob} onChange={(e) => set(r.id, { caregiverDob: e.target.value })} />
            </Field>
          </div>
          <IssueList issues={getIssues(r)} />
          <button className="icon-btn review-drop" onClick={() => drop(r.id)} aria-label="Drop this row">
            <X size={16} />
          </button>
        </div>
      ))}
      <div className="flex gap-2 mt-4 flex-wrap">
        <button className="btn-primary" onClick={onConfirm} disabled={!rows.length}>
          <Plus size={16} /> Add {rows.length} client{rows.length === 1 ? '' : 's'}
        </button>
        <button className="btn-quiet" onClick={onCancel}>Back to the paste box</button>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function IssueList({ issues }) {
  if (!issues.length) return null;
  return (
    <div className="issues">
      {issues.map((i, n) => (
        <div key={n} className={'issue issue-' + i.level}>
          {i.level === 'info' ? <Info size={13} /> : <AlertTriangle size={13} />} {i.message}
        </div>
      ))}
    </div>
  );
}

function ClientCard({ client, categories, onChange, onRemove, onExport }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(!client.name || client.name === 'Unnamed client');

  const schedule = useMemo(
    () => getClientSchedule(client).filter((m) => categories.includes(m.category)),
    [client, categories]
  );
  // What the collapsed card leads with: the oldest thing already past due, or
  // failing that the next date ahead. Overdue work should never hide behind a
  // deadline that is still comfortably in the future.
  const next = useMemo(() => {
    const today = todayISO();
    return schedule.find((m) => m.date < today && m.category !== 'birthday')
      || schedule.find((m) => m.date >= today)
      || null;
  }, [schedule]);
  const overdueCount = useMemo(
    () => schedule.filter((m) => m.date < todayISO() && m.category !== 'birthday').length,
    [schedule]
  );
  const issues = getIssues(client);
  const rel = next ? getRelativeDue(next.date) : null;

  return (
    <div className={'card client-card mt-3 ' + (open ? 'card-open' : '')}>
      <div className="case-row">
        <button className="case-open" onClick={() => setOpen(!open)} aria-expanded={open}>
          <div className="min-w-0">
            <div className="case-name">
              {client.name || 'Unnamed client'}
              {client.dob && <span className="case-age"> · {formatAge(client.dob)}</span>}
            </div>
            <div className="case-meta">
              {client.intakeDate ? `Intake ${formatDate(client.intakeDate)}` : 'No intake date'}
              {client.dob ? ` · Born ${formatDate(client.dob)}` : ''}
              {` · ${schedule.length} date${schedule.length === 1 ? '' : 's'}`}
            </div>
            {next && rel && (
              <div className={'due-chip tone-' + rel.tone}>
                {next.category === 'birthday' ? <Cake size={12} /> : <CalendarDays size={12} />}
                {next.label} · {rel.label}
                {overdueCount > 1 && ` · +${overdueCount - 1} more past due`}
              </div>
            )}
          </div>
          <ChevronDown size={18} className={'chev ' + (open ? 'chev-open' : '')} />
        </button>
        <button className="icon-btn" onClick={onExport} title="Download this client's calendar">
          <Download size={17} />
        </button>
      </div>

      {open && (
        <div className="card-body">
          <IssueList issues={issues} />

          {editing ? (
            <div className="review-grid mt-3">
              <Field label="Name">
                <input className="in" value={client.name} onChange={(e) => onChange({ name: e.target.value })} />
              </Field>
              <Field label="Child DOB">
                <input className="in" type="date" value={client.dob} onChange={(e) => onChange({ dob: e.target.value })} />
              </Field>
              <Field label="Intake date">
                <input className="in" type="date" value={client.intakeDate} onChange={(e) => onChange({ intakeDate: e.target.value })} />
              </Field>
              <Field label="Caregiver name">
                <input className="in" value={client.caregiverName} onChange={(e) => onChange({ caregiverName: e.target.value })} />
              </Field>
              <Field label="Caregiver DOB">
                <input className="in" type="date" value={client.caregiverDob} onChange={(e) => onChange({ caregiverDob: e.target.value })} />
              </Field>
              <Field label="Enrolled as">
                <select className="in" value={client.type} onChange={(e) => onChange({ type: e.target.value })}>
                  <option value="child">Child at admission</option>
                  <option value="pregnant">Pregnant caregiver at admission</option>
                </select>
              </Field>
              {client.type === 'pregnant' && (
                <Field label="Birth date (once baby arrives)">
                  <input className="in" type="date" value={client.birthDate} onChange={(e) => onChange({ birthDate: e.target.value })} />
                </Field>
              )}
            </div>
          ) : null}

          <div className="flex gap-2 flex-wrap mt-3">
            <button className="btn-ghost" onClick={() => setEditing(!editing)}>
              {editing ? 'Done editing' : 'Edit dates'}
            </button>
            <button className="btn-ghost danger" onClick={onRemove}>
              <Trash2 size={15} /> Remove
            </button>
          </div>

          <div className="sched">
            {schedule.length === 0 && <div className="hint mt-3">Add an intake date or a birthday to build a schedule.</div>}
            {schedule.map((m) => (
              <MilestoneRow key={m.id} client={client} m={m} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MilestoneRow({ client, m }) {
  const rel = getRelativeDue(m.date);
  const [showItems, setShowItems] = useState(false);
  return (
    <div className="sched-row">
      <div className="sched-date">
        <div className="sched-day">{formatDate(m.date, 'day')}</div>
        <div className="sched-year">{parseDate(m.date)?.getFullYear()}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="sched-label">
          {m.category === 'birthday' && <Cake size={13} />} {m.label}
        </div>
        <div className="sched-meta">
          <span className={'pill pill-' + m.category}>{CATEGORY_LABELS[m.category]}</span>
          {rel && <span className={'tone-text tone-' + rel.tone}>{rel.label}</span>}
          {m.recurrence === 'yearly' && <span className="muted">repeats yearly</span>}
          {m.recurrence === 'every90' && <span className="muted">repeats every 90 days</span>}
        </div>
        {m.items?.length > 0 && (
          <button className="link-btn" onClick={() => setShowItems(!showItems)}>
            {showItems ? 'Hide' : `What's due (${m.items.length})`}
          </button>
        )}
        {showItems && <div className="items">{m.items.join(' · ')}</div>}
      </div>
      <a
        className="icon-btn" title="Add just this one to Google Calendar"
        href={googleCalendarUrl(client, m)} target="_blank" rel="noreferrer"
      >
        <ExternalLink size={15} />
      </a>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WHAT'S COMING
// ---------------------------------------------------------------------------

function CalendarTab({ clients, upcoming, overdue }) {
  if (!clients.length) {
    return <div className="empty mt-5">Add clients first and the next two months will show up here.</div>;
  }

  const byWeek = groupByWeek(upcoming);

  return (
    <section className="mt-5">
      {overdue.length > 0 && (
        <div className="card overdue-card">
          <div className="card-title"><AlertTriangle size={16} /> Past due ({overdue.length})</div>
          {overdue.map((m) => <UpcomingRow key={m.client.id + m.id} m={m} />)}
        </div>
      )}

      <div className="card mt-3">
        <div className="card-title"><CalendarDays size={16} /> Next 60 days</div>
        {upcoming.length === 0 && <div className="hint">Nothing due in the next 60 days.</div>}
        {byWeek.map(([label, rows]) => (
          <div key={label} className="week">
            <div className="week-label">{label}</div>
            {rows.map((m) => <UpcomingRow key={m.client.id + m.id} m={m} />)}
          </div>
        ))}
      </div>

      <button className="btn-quiet mt-4" onClick={() => window.print()}>
        <Printer size={15} /> Print this list
      </button>
    </section>
  );
}

function groupByWeek(rows) {
  const groups = new Map();
  rows.forEach((m) => {
    const days = getRelativeDue(m.date)?.days ?? 0;
    const label =
      days <= 0 ? 'Today'
      : days <= 7 ? 'This week'
      : days <= 14 ? 'Next week'
      : days <= 30 ? 'Later this month'
      : 'Next month and beyond';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(m);
  });
  return [...groups.entries()];
}

function UpcomingRow({ m }) {
  const rel = getRelativeDue(m.date);
  return (
    <div className="up-row">
      <div className="up-date">{formatDate(m.date, 'day')}</div>
      <div className="min-w-0 flex-1">
        <div className="up-label">
          {m.category === 'birthday' && <Cake size={13} />}
          <strong>{m.client.name}</strong> — {m.label}
        </div>
        <div className="sched-meta">
          <span className={'pill pill-' + m.category}>{CATEGORY_LABELS[m.category]}</span>
          {rel && <span className={'tone-text tone-' + rel.tone}>{rel.label}</span>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EXPORT
// ---------------------------------------------------------------------------

function ExportTab({
  clients, leadTimes, setLeadTimes, categories, setCategories,
  exportClient, exportAllCombined, exportAllZipped, backup, restore,
}) {
  const fileRef = useRef(null);
  const total = useMemo(
    () => clients.reduce((n, c) => n + getClientSchedule(c).filter((m) => categories.includes(m.category)).length, 0),
    [clients, categories]
  );

  return (
    <section className="mt-5">
      <div className="card">
        <div className="card-title"><Download size={16} /> Download calendars</div>
        <p className="hint">
          {clients.length
            ? `${total} date${total === 1 ? '' : 's'} across ${clients.length} client${clients.length === 1 ? '' : 's'}, with reminders built in.`
            : 'Add clients first.'}
        </p>
        <div className="flex gap-2 flex-wrap mt-3">
          <button className="btn-primary" onClick={exportAllZipped} disabled={!clients.length}>
            <Package size={16} /> One file per client (.zip)
          </button>
          <button className="btn-ghost-solid" onClick={exportAllCombined} disabled={!clients.length}>
            <CalendarDays size={16} /> Everything in one .ics
          </button>
        </div>

        {clients.length > 0 && (
          <div className="per-client mt-4">
            <div className="field-label">Or one at a time</div>
            {clients.map((c) => (
              <button key={c.id} className="chip-btn" onClick={() => exportClient(c)}>
                <Download size={13} /> {c.name || 'Unnamed client'}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="card mt-3">
        <div className="card-title"><Settings2 size={16} /> Reminders</div>
        <p className="hint">Days ahead of the due date. Comma-separated; 0 means the day itself.</p>
        {CATEGORY_ORDER.map((key) => (
          <div className="lead-row" key={key}>
            <label className="lead-check">
              <input
                type="checkbox"
                checked={categories.includes(key)}
                onChange={(e) =>
                  setCategories(e.target.checked
                    ? CATEGORY_ORDER.filter((k) => k === key || categories.includes(k))
                    : categories.filter((k) => k !== key))
                }
              />
              <span>{CATEGORY_LABELS[key]}</span>
            </label>
            <input
              className="in lead-in"
              value={(leadTimes[key] || []).join(', ')}
              onChange={(e) => {
                const days = e.target.value
                  .split(',')
                  .map((s) => parseInt(s.trim(), 10))
                  .filter((n) => Number.isFinite(n) && n >= 0 && n <= 365);
                setLeadTimes({ ...leadTimes, [key]: days });
              }}
              inputMode="numeric"
              aria-label={`${CATEGORY_LABELS[key]} reminder days`}
            />
          </div>
        ))}
        <button className="btn-ghost mt-2" onClick={() => { setLeadTimes(DEFAULT_LEAD_TIMES); setCategories(CATEGORY_ORDER); }}>
          <RotateCcw size={15} /> Back to defaults
        </button>
      </div>

      <div className="card mt-3">
        <div className="card-title"><ExternalLink size={16} /> Getting these into your calendar</div>
        <ol className="steps">
          <li>
            <strong>Google Calendar.</strong> Open{' '}
            <a href="https://calendar.google.com/calendar/u/0/r/settings/export" target="_blank" rel="noreferrer">
              Settings → Import &amp; export
            </a>, choose the downloaded <code>.ics</code>, pick which calendar it goes into,
            and press Import. Do it once per client file and each family lands in its own
            calendar you can toggle on and off.
          </li>
          <li>
            <strong>Apple Calendar / iPhone.</strong> Open the <code>.ics</code> file — it
            offers to add the events. On a Mac, File → Import lets you send them to a new
            calendar named for the client.
          </li>
          <li>
            <strong>Outlook.</strong> File → Open &amp; Export → Import an iCalendar (.ics),
            then choose <em>Open as New Calendar</em>.
          </li>
          <li>
            The reminders travel inside the file, so once it is imported your calendar app
            does the alerting — a week before every birthday, a month before every 6-month.
          </li>
          <li>
            Re-import after you change a date and the matching events update in place
            rather than doubling up.
          </li>
        </ol>
      </div>

      <div className="card mt-3">
        <div className="card-title"><Save size={16} /> Backup</div>
        <p className="hint">
          Clients live in this browser only. A backup file moves them to another device or
          brings them back after clearing site data.
        </p>
        <div className="flex gap-2 flex-wrap mt-3">
          <button className="btn-quiet" onClick={backup} disabled={!clients.length}>
            <Download size={15} /> Save backup
          </button>
          <button className="btn-quiet" onClick={() => fileRef.current?.click()}>
            <RotateCcw size={15} /> Restore
          </button>
          <input
            ref={fileRef} type="file" accept="application/json,.json" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ''; }}
          />
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Styles() {
  return (
    <style>{`
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700;12..96,800&family=Albert+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap');

:root {
  --paper:#FBFAF6; --card:#FFFFFF; --ink:#22333B; --ink-soft:#5D6B70; --line:#E3DFD3;
  --pine:#2E5D4E; --pine-deep:#234A3E; --marigold:#E8A33D; --marigold-soft:#FBF0DC;
  --clay:#A9603F; --frp:#EAF2EC;
  --over:#7C2D2D; --soon:#B57A17; --ok:#5D6B70;
}
* { box-sizing:border-box; -webkit-tap-highlight-color:transparent; }
button, a, select, input, textarea { touch-action:manipulation; }
.app { min-height:100vh; background:var(--paper); color:var(--ink); font-family:'Albert Sans',system-ui,sans-serif; font-size:15px; line-height:1.55; -webkit-font-smoothing:antialiased; }
.shell { max-width:44rem; margin:0 auto; padding:0 1.1rem 4rem; }

.flex { display:flex; } .flex-wrap { flex-wrap:wrap; } .flex-1 { flex:1 1 0%; }
.items-center { align-items:center; } .min-w-0 { min-width:0; }
.gap-2 { gap:8px; } .gap-3 { gap:12px; }
.mt-2 { margin-top:8px; } .mt-3 { margin-top:12px; } .mt-4 { margin-top:16px; } .mt-5 { margin-top:20px; }
.pt-8 { padding-top:32px; } .pb-6 { padding-bottom:24px; }

.eyebrow { font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:var(--pine); font-weight:700; margin-bottom:6px; }
.brand { font-family:'Bricolage Grotesque',sans-serif; font-weight:800; font-size:2.35rem; line-height:1.02; letter-spacing:-0.02em; margin:0 0 10px; }
.tagline { color:var(--ink-soft); font-size:15px; max-width:34rem; margin:0; }
.privacy { background:var(--marigold-soft); border:1px solid #EFD9B4; border-radius:14px; padding:12px 14px; font-size:13.5px; color:#6E5424; }

.tabs { display:flex; gap:6px; flex-wrap:wrap; border-bottom:1px solid var(--line); padding-bottom:10px; }
.tab { display:inline-flex; align-items:center; gap:6px; background:none; border:1px solid transparent; color:var(--ink-soft); font-family:inherit; font-size:14px; font-weight:600; padding:8px 14px; border-radius:999px; cursor:pointer; }
.tab:hover { background:#F0EDE3; color:var(--ink); }
.tab-on { background:var(--pine); color:#fff; }
.tab-on:hover { background:var(--pine-deep); color:#fff; }

.card { background:var(--card); border:1px solid var(--line); border-radius:18px; padding:16px 18px; }
.card-title { display:flex; align-items:center; gap:7px; font-family:'Bricolage Grotesque',sans-serif; font-weight:700; font-size:16px; color:var(--ink); margin-bottom:6px; }
.card-body { padding-top:6px; }
.hint { color:var(--ink-soft); font-size:13.5px; margin:0; }
.note { background:#F1EFE6; border-radius:12px; padding:9px 12px; font-size:13px; color:var(--ink-soft); }
.muted { color:var(--ink-soft); }
code { background:#F1EFE6; border-radius:5px; padding:1px 5px; font-size:12.5px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }

.ta, .in { width:100%; font-family:inherit; font-size:15px; color:var(--ink); background:var(--paper); border:1px solid var(--line); border-radius:12px; padding:10px 12px; }
.ta:focus, .in:focus { outline:2px solid #CBDDCE; outline-offset:1px; border-color:#CBDDCE; }
.paste { margin-top:10px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; line-height:1.6; resize:vertical; }

.btn-primary { display:inline-flex; align-items:center; justify-content:center; gap:7px; background:var(--pine); color:#fff; border:none; cursor:pointer; padding:12px 18px; border-radius:999px; font-weight:600; font-size:14.5px; font-family:inherit; transition:background .15s,transform .1s; }
.btn-primary:hover { background:var(--pine-deep); }
.btn-primary:active { transform:scale(.985); }
.btn-primary:disabled { opacity:.4; cursor:default; }
.btn-quiet { display:inline-flex; align-items:center; justify-content:center; gap:7px; background:transparent; color:var(--pine); border:1px solid var(--line); cursor:pointer; padding:11px 18px; border-radius:999px; font-weight:600; font-size:14px; font-family:inherit; }
.btn-quiet:hover { background:var(--frp); border-color:#CBDDCE; }
.btn-quiet:disabled { opacity:.4; cursor:default; }
.btn-ghost-solid { display:inline-flex; align-items:center; justify-content:center; gap:7px; background:var(--card); color:var(--ink); border:1px solid var(--line); cursor:pointer; padding:12px 18px; border-radius:999px; font-weight:600; font-size:14.5px; font-family:inherit; }
.btn-ghost-solid:hover { border-color:#CFC9B8; }
.btn-ghost-solid:disabled { opacity:.4; cursor:default; }
.btn-ghost { display:inline-flex; align-items:center; gap:6px; background:none; border:none; color:var(--ink-soft); cursor:pointer; font-family:inherit; font-size:14px; font-weight:600; padding:8px 10px; border-radius:10px; }
.btn-ghost:hover { background:#F0EDE3; color:var(--ink); }
.btn-ghost.danger:hover { background:#FDECEC; color:var(--over); }
.icon-btn { display:inline-flex; align-items:center; justify-content:center; background:none; border:none; color:var(--ink-soft); cursor:pointer; padding:8px; border-radius:10px; text-decoration:none; }
.icon-btn:hover { background:#F0EDE3; color:var(--ink); }
.link-btn { background:none; border:none; padding:2px 0; margin-top:3px; color:var(--pine); font-family:inherit; font-size:12.5px; font-weight:600; cursor:pointer; text-decoration:underline; }
.chip-btn { display:inline-flex; align-items:center; gap:5px; background:var(--paper); border:1px solid var(--line); border-radius:999px; padding:6px 12px; margin:4px 6px 0 0; font-family:inherit; font-size:13px; font-weight:600; color:var(--ink); cursor:pointer; }
.chip-btn:hover { border-color:#CBDDCE; background:var(--frp); }

.empty { border:1.5px dashed var(--line); border-radius:16px; padding:26px 18px; text-align:center; color:var(--ink-soft); font-size:14px; }
.foot { margin-top:40px; padding-top:16px; border-top:1px solid var(--line); color:var(--ink-soft); font-size:13px; }

.case-row { display:flex; align-items:stretch; gap:4px; }
.case-open { flex:1; display:flex; align-items:center; justify-content:space-between; gap:10px; background:none; border:none; padding:0; cursor:pointer; text-align:left; font-family:inherit; min-width:0; color:inherit; }
.case-name { font-weight:700; font-size:15.5px; }
.case-age { font-weight:500; color:var(--ink-soft); }
.case-meta { font-size:12.5px; color:var(--ink-soft); margin-top:2px; }
.chev { color:var(--ink-soft); transition:transform .15s; flex-shrink:0; }
.chev-open { transform:rotate(180deg); }
.client-card { padding:14px 16px; }

.due-chip { display:inline-flex; align-items:center; gap:4px; margin-top:7px; font-size:11.5px; font-weight:600; border-radius:999px; padding:3px 9px; background:#F1EFE6; color:var(--ok); }
.tone-red { color:var(--over); } .tone-amber { color:var(--soon); } .tone-green { color:var(--ok); }
.due-chip.tone-red { background:#FDECEC; } .due-chip.tone-amber { background:var(--marigold-soft); }
.tone-text { font-weight:600; }

.field { display:block; }
.field-label { display:block; font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--ink-soft); font-weight:700; margin-bottom:4px; }
.review-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; }
.review-row { position:relative; border-top:1px solid var(--line); padding:14px 34px 4px 0; margin-top:12px; }
.review-row:first-of-type { border-top:none; }
.review-drop { position:absolute; top:10px; right:0; }

.issues { margin-top:8px; display:flex; flex-direction:column; gap:4px; }
.issue { display:flex; align-items:center; gap:5px; font-size:12.5px; border-radius:9px; padding:5px 9px; }
.issue-error { background:#FDECEC; color:var(--over); }
.issue-warn { background:var(--marigold-soft); color:#6E5424; }
.issue-info { background:#F1EFE6; color:var(--ink-soft); }

.sched { margin-top:10px; border-top:1px solid var(--line); }
.sched-row { display:flex; align-items:flex-start; gap:12px; padding:11px 0; border-bottom:1px solid #F0EDE3; }
.sched-row:last-child { border-bottom:none; }
.sched-date { width:74px; flex-shrink:0; }
.sched-day { font-weight:700; font-size:13px; }
.sched-year { font-size:11.5px; color:var(--ink-soft); }
/* Not a flex row: the name and label must wrap as one sentence rather than
   breaking into columns on a narrow phone. */
.sched-label { font-weight:600; font-size:14.5px; }
.sched-label svg, .up-label svg { vertical-align:-2px; margin-right:3px; }
.sched-meta { display:flex; align-items:center; gap:8px; flex-wrap:wrap; font-size:12px; margin-top:3px; }
.items { margin-top:6px; font-size:12.5px; color:var(--ink-soft); background:#F7F5EE; border-radius:10px; padding:8px 10px; }

.pill { font-size:10.5px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; border-radius:999px; padding:2px 8px; background:#F1EFE6; color:var(--ink-soft); }
.pill-birthday { background:#FBE9EF; color:#8C3A56; }
.pill-sixMonth { background:#E7EEF8; color:#2C4A73; }
.pill-baseline { background:#EFEAF7; color:#4A3A73; }
.pill-treatmentPlan { background:var(--frp); color:var(--pine); }
.pill-sniff { background:var(--marigold-soft); color:#6E5424; }
.pill-annual { background:#F1EFE6; color:#5D5140; }
.pill-ageWindow { background:#EAF3F4; color:#2C5B60; }
.pill-birthOfChild { background:#EDE9F6; color:#463C73; }

.overdue-card { border-color:#F2C9C9; background:#FFFCFC; }
.week { margin-top:12px; }
.week-label { font-size:11px; letter-spacing:.12em; text-transform:uppercase; color:var(--pine); font-weight:700; margin-bottom:2px; }
.up-row { display:flex; align-items:flex-start; gap:12px; padding:9px 0; border-bottom:1px solid #F0EDE3; }
.up-row:last-child { border-bottom:none; }
.up-date { width:74px; flex-shrink:0; font-weight:700; font-size:13px; }
.up-label { font-size:14.5px; }

.lead-row { display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid #F5F3EB; }
.lead-row:last-of-type { border-bottom:none; }
.lead-check { display:flex; align-items:center; gap:8px; flex:1; font-size:14px; font-weight:600; cursor:pointer; }
.lead-check input { width:16px; height:16px; accent-color:var(--pine); }
.lead-in { width:110px; flex-shrink:0; font-size:13.5px; padding:7px 10px; text-align:center; }

.steps { margin:6px 0 0; padding-left:20px; font-size:13.5px; color:var(--ink-soft); }
.steps li { margin-bottom:8px; }
.steps strong { color:var(--ink); }
.steps a { color:var(--pine); }
.per-client { border-top:1px solid var(--line); padding-top:12px; }

.toast { position:fixed; left:50%; bottom:20px; transform:translateX(-50%); background:var(--ink); color:#fff; font-size:13.5px; font-weight:600; padding:11px 18px; border-radius:999px; box-shadow:0 6px 20px rgba(34,51,59,.22); max-width:calc(100vw - 2rem); text-align:center; z-index:50; }

@media print {
  .tabs, .toast, .btn-primary, .btn-quiet, .btn-ghost, .btn-ghost-solid, .icon-btn, .privacy { display:none !important; }
  .app { background:#fff; }
  .card { border-color:#ccc; break-inside:avoid; }
}
@media (max-width:420px) {
  .brand { font-size:2rem; }
  .sched-date, .up-date { width:62px; }
}
    `}</style>
  );
}
