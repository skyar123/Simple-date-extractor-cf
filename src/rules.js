// ============================================================================
// DUE-DATE RULES — pure functions, no React, no dependencies.
//
// Everything this app does grows out of two dates per client: the child's
// date of birth and the intake (admission) date. This file turns those two
// dates into every deadline that follows.
//
// The scheduling rules mirror the CF Assessment Tracker's `src/protocols.js`
// and `src/clientUtils.js` (a separate app, in the `tracker` repo). Keep the
// two in step: if a milestone moves there, move it here too.
// ============================================================================

// ---- Date helpers ----------------------------------------------------------

// Parse as LOCAL time. A bare 'YYYY-MM-DD' goes through `new Date()` as UTC
// midnight, which renders a day early anywhere west of UTC — so date-only
// strings are expanded to local midnight by hand.
export const parseDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const pad = (n) => String(n).padStart(2, '0');

// Format a Date as 'YYYY-MM-DD' from LOCAL fields (toISOString would shift the
// day east of UTC).
export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const todayISO = () => toISODate(new Date());

export const addDays = (dateStr, days) => {
  const d = parseDate(dateStr);
  if (!d || !Number.isFinite(days)) return '';
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return toISODate(r);
};

export const addMonths = (dateStr, months) => {
  const d = parseDate(dateStr);
  if (!d || !Number.isFinite(months)) return '';
  const r = new Date(d.getFullYear(), d.getMonth() + months, 1);
  // Clamp to the last day of the target month (e.g. Aug 31 + 6mo → Feb 28).
  const lastDay = new Date(r.getFullYear(), r.getMonth() + 1, 0).getDate();
  r.setDate(Math.min(d.getDate(), lastDay));
  return toISODate(r);
};

export const daysBetween = (fromStr, toStr) => {
  const a = parseDate(fromStr);
  const b = parseDate(toStr);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
};

export const daysUntil = (dateStr) => daysBetween(todayISO(), dateStr);

export const formatDate = (dateStr, style = 'medium') => {
  const d = parseDate(dateStr);
  if (!d) return '';
  if (style === 'short') return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
  if (style === 'medium') return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (style === 'full') return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (style === 'day') return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return d.toLocaleDateString();
};

export const getAgeInMonths = (dob, refDate = new Date()) => {
  const birth = parseDate(dob);
  const ref = parseDate(refDate);
  if (!birth || !ref) return null;
  let months = (ref.getFullYear() - birth.getFullYear()) * 12;
  months -= birth.getMonth();
  months += ref.getMonth();
  if (ref.getDate() < birth.getDate()) months--;
  return Math.max(0, months);
};

export const formatAge = (dob, refDate = new Date()) => {
  const m = getAgeInMonths(dob, refDate);
  if (m == null) return '';
  if (m < 24) return `${m} mo`;
  const y = Math.floor(m / 12);
  const rem = m % 12;
  return rem ? `${y}y ${rem}m` : `${y}y`;
};

// Human, colour-coded "how far away". tone: 'red' (overdue / today),
// 'amber' (within two weeks), 'green' (further out).
export const getRelativeDue = (dateStr) => {
  const days = daysUntil(dateStr);
  if (days == null) return null;
  const abs = Math.abs(days);
  const human = (n) => {
    if (n < 14) return `${n} day${n === 1 ? '' : 's'}`;
    if (n < 60) { const w = Math.round(n / 7); return `${w} week${w === 1 ? '' : 's'}`; }
    const mo = Math.round(n / 30);
    return `${mo} month${mo === 1 ? '' : 's'}`;
  };
  let label;
  if (days < 0) label = `${human(abs)} overdue`;
  else if (days === 0) label = 'due today';
  else label = `due in ${human(days)}`;
  return { days, label, tone: days <= 0 ? 'red' : days <= 14 ? 'amber' : 'green' };
};

// ---- Protocol intervals ----------------------------------------------------
// Every interval is in days from the intake (admission) date unless noted.

export const INTERVALS = {
  BASELINE_DAYS: 60,        // all baseline assessments complete within 60 days
  INITIAL_TX_DAYS: 60,      // initial treatment plan / plan of care
  TX_REVIEW_DAYS: 90,       // treatment plan reviewed every 90 days after that
  SNIFF_DAYS: 90,           // SNIFF redone every 90 days, start to finish
  SIX_MONTH_DAYS: 180,      // 6-month reassessment
  ANNUAL_DAYS: 365,         // annual review / discharge window
  BIRTH_OF_CHILD_DAYS: 60,  // Pregnant AA: infant 1–2 months old
  PREG_SIX_MONTH_DAYS: 240, // Pregnant AA: 6-month anchors to the birth date
};

// Reminder lead times, in days before the due date. These are the defaults the
// app ships with; Settings can override any of them.
export const DEFAULT_LEAD_TIMES = {
  birthday: [7],        // one week ahead, as requested
  sixMonth: [30, 7, 1], // one month ahead for the 6-month reassessment
  baseline: [7, 1],
  treatmentPlan: [14, 7, 1],
  sniff: [7, 1],
  annual: [30, 7],
  ageWindow: [14],
  birthOfChild: [7, 1],
};

export const CATEGORY_LABELS = {
  birthday: 'Birthday',
  sixMonth: '6-Month',
  baseline: 'Baseline',
  treatmentPlan: 'Treatment Plan',
  sniff: 'SNIFF',
  annual: 'Annual / Discharge',
  ageWindow: 'Age Window',
  birthOfChild: 'Birth of Child',
};

// ---- Age-specific tool rules (mirrors clientUtils.getSETool) ---------------

// The social-emotional instrument is fixed by the child's age AT ADMISSION and
// repeated at follow-up so pre/post scores stay comparable. The one exception:
// a BITSEA baseline moves to PKBS-2 once the child passes 48 months.
export const getSETool = (ageAtAdmitMonths, type) => {
  if (type === 'pregnant') return 'ASQ:SE-2';
  if (ageAtAdmitMonths == null) return 'ASQ:SE-2 / BITSEA / PKBS-2 (set DOB)';
  if (ageAtAdmitMonths < 12) return 'ASQ:SE-2';
  if (ageAtAdmitMonths < 36) return 'BITSEA';
  return 'PKBS-2';
};

export const isMCHATRequired = (ageMonths) => ageMonths != null && ageMonths >= 16 && ageMonths <= 30;

// ---- Assessment lists carried in each event's notes -------------------------

const BASELINE_ITEMS = [
  'Intake / CCA', 'SNIFF', 'PQ', 'ASQ-3', 'PSI-4-SF', 'CESD-R', 'HOPE',
  'TESI-PRR', 'LSC-R', 'PCL-5', 'CCIS',
];

const PREGNANT_BASELINE_ITEMS = [
  'Intake / CCA', 'SNIFF (Family Services)', 'PQ', 'HOPE', 'EPDS',
  'LSC-R', 'CESD-R', 'PCL-5',
];

const BIRTH_OF_CHILD_ITEMS = [
  'Postnatal Assessment', 'SNIFF (Child Services)', 'ASQ-3', 'ASQ:SE-2',
  'CCIS', 'PSI-4-SF', 'TESI-PRR', 'EPDS (within 6 weeks postpartum)',
];

const SIX_MONTH_ITEMS = ['ASQ-3 (Communication + baseline concern areas)', 'CCIS', 'PSI-4-SF', 'CESD-R', 'PCL-5'];

const TX_ITEMS = ['Treatment plan — signatures: Parent/Legal Guardian, Child First Team, Clinical Supervisor'];

const SNIFF_ITEMS = ['SNIFF (Service Needs Inventory for Families)'];

const DISCHARGE_ITEMS = ['YSSF', 'SNIFF (final)', 'Termination data (health)'];

// ---- The schedule ----------------------------------------------------------

/**
 * Every dated milestone for one client, sorted by date.
 *
 * A client is `{ id, name, dob, caregiverName, caregiverDob, intakeDate,
 * type: 'child'|'pregnant', birthDate?, notes? }`.
 *
 * Each milestone is `{ id, label, date, category, items, detail, recurrence }`
 * where `recurrence` is 'yearly' (birthdays), 'every90' (SNIFF), or null.
 */
export function getClientSchedule(client) {
  const out = [];
  const intake = client.intakeDate;
  const pregnant = client.type === 'pregnant';

  const push = (id, label, date, category, { items = [], detail = '', recurrence = null, turning = null } = {}) => {
    if (!date) return;
    out.push({ id, label, date, category, items, detail, recurrence, turning });
  };

  // --- Birthdays: yearly, anchored on the next occurrence ---
  const nextBirthday = (dobStr) => {
    const dob = parseDate(dobStr);
    if (!dob) return null;
    const now = new Date();
    let year = now.getFullYear();
    let next = new Date(year, dob.getMonth(), dob.getDate());
    // Compare on date only, so today's birthday still counts as today.
    if (toISODate(next) < todayISO()) next = new Date(++year, dob.getMonth(), dob.getDate());
    return toISODate(next);
  };

  if (client.dob) {
    const d = nextBirthday(client.dob);
    const turning = d ? parseDate(d).getFullYear() - parseDate(client.dob).getFullYear() : null;
    // The age stays out of the label: this event recurs yearly in the exported
    // calendar, so a baked-in "turns 6" would still read "turns 6" the year they
    // turn 7. `turning` is carried alongside for the in-app view, which is
    // recomputed on every render and so is always current.
    push('bday-child', `${client.name || 'Child'} — birthday`, d, 'birthday', {
      detail: `Birthday. Born ${formatDate(client.dob)}${turning ? ` — turning ${turning} this year` : ''}.`,
      recurrence: 'yearly',
      turning,
    });
  }
  if (client.caregiverDob) {
    const d = nextBirthday(client.caregiverDob);
    push('bday-caregiver', `${client.caregiverName || 'Caregiver'} — birthday`, d, 'birthday', {
      detail: `Caregiver birthday. Born ${formatDate(client.caregiverDob)}.`,
      recurrence: 'yearly',
    });
  }

  if (!intake) return sortByDate(out); // no intake date → birthdays only

  const ageAtAdmit = getAgeInMonths(client.dob, intake);
  const seTool = getSETool(ageAtAdmit, client.type);

  // --- Baseline (60 days) ---
  const baselineItems = pregnant
    ? PREGNANT_BASELINE_ITEMS
    : [...BASELINE_ITEMS, seTool, ...(isMCHATRequired(ageAtAdmit) ? ['M-CHAT-R/F'] : [])];
  push('baseline', pregnant ? 'Prenatal baseline due' : 'Baseline assessments due',
    addDays(intake, INTERVALS.BASELINE_DAYS), 'baseline', {
      items: baselineItems,
      detail: `All baseline assessments complete within ${INTERVALS.BASELINE_DAYS} days of intake (${formatDate(intake)}).`,
    });

  // --- Treatment plan: initial at 60 days, reviewed every 90 after ---
  const initialTx = addDays(intake, INTERVALS.INITIAL_TX_DAYS);
  push('tx-initial', 'Initial treatment plan due', initialTx, 'treatmentPlan', {
    items: TX_ITEMS,
    detail: 'Child and Family Plan of Care — signed by parent/legal guardian, Child First team, and clinical supervisor.',
  });
  // Reviews run for as long as the family is in service — the annual window,
  // plus a grace quarter. Past that they are noise, not a to-do.
  const serviceEnd = addDays(intake, INTERVALS.ANNUAL_DAYS + 90);
  let review = addDays(initialTx, INTERVALS.TX_REVIEW_DAYS);
  let n = 1;
  while (review && review <= serviceEnd && n <= 8) {
    push(`tx-review-${n}`, `Treatment plan review #${n}`, review, 'treatmentPlan', {
      items: TX_ITEMS,
      detail: `90-day review. Anchored to the initial plan due ${formatDate(initialTx)}; move it if the plan was signed on a different date.`,
    });
    review = addDays(review, INTERVALS.TX_REVIEW_DAYS);
    n++;
  }

  // --- SNIFF every 90 days ---
  push('sniff', 'SNIFF update due', addDays(intake, INTERVALS.SNIFF_DAYS), 'sniff', {
    items: SNIFF_ITEMS,
    detail: 'Service Needs Inventory for Families — redone every 90 days for the length of service.',
    recurrence: 'every90',
  });

  // --- Birth of Child (Pregnant AA) ---
  if (pregnant) {
    if (client.birthDate) {
      push('birth-of-child', 'Birth of Child assessments due',
        addDays(client.birthDate, INTERVALS.BIRTH_OF_CHILD_DAYS), 'birthOfChild', {
          items: BIRTH_OF_CHILD_ITEMS,
          detail: `Completed while the infant is 1–2 months old. Birth logged ${formatDate(client.birthDate)}.`,
        });
    }
  }

  // --- 6-month reassessment ---
  const sixMonthDue = pregnant
    ? (client.birthDate ? addDays(client.birthDate, INTERVALS.PREG_SIX_MONTH_DAYS) : null)
    : addDays(intake, INTERVALS.SIX_MONTH_DAYS);
  push('six-month', '6-month reassessment due', sixMonthDue, 'sixMonth', {
    items: [...SIX_MONTH_ITEMS, seTool],
    detail: pregnant
      ? 'Six months after the Birth of Child assessments.'
      : `Six months (${INTERVALS.SIX_MONTH_DAYS} days) after intake.`,
  });

  // --- Annual / discharge window ---
  push('annual', 'Annual review / discharge window', addDays(intake, INTERVALS.ANNUAL_DAYS), 'annual', {
    items: DISCHARGE_ITEMS,
    detail: 'One year in service. Plan the discharge assessments and the closing SNIFF.',
  });

  // --- Age windows that change which tools are required ---
  // Only while the family is plausibly still in service: an ASQ-3 that ages
  // out two years after discharge is not a deadline.
  if (client.dob && !pregnant) {
    const mchatOpen = addMonths(client.dob, 16);
    const mchatClose = addMonths(client.dob, 30);
    const today = todayISO();
    const inWindow = (d) => d >= today && d <= serviceEnd;
    if (inWindow(mchatOpen)) {
      push('age-mchat-open', 'M-CHAT-R/F window opens (16 mo)', mchatOpen, 'ageWindow', {
        detail: 'Autism screening is required between 16 and 30 months of age.',
      });
    }
    if (inWindow(mchatClose)) {
      push('age-mchat-close', 'M-CHAT-R/F window closes (30 mo)', mchatClose, 'ageWindow', {
        detail: 'Last chance to screen — the M-CHAT-R/F is not used after 30 months.',
      });
    }
    // A BITSEA baseline (12–35 mo at admission) ages out at 48 months.
    if (ageAtAdmit != null && ageAtAdmit >= 12 && ageAtAdmit < 36) {
      const switchDate = addMonths(client.dob, 48);
      if (inWindow(switchDate)) {
        push('age-se-switch', 'BITSEA ages out — switch to PKBS-2 (48 mo)', switchDate, 'ageWindow', {
          detail: 'Continuity rule: repeat the baseline instrument, except that a BITSEA baseline moves to PKBS-2 past 48 months.',
        });
      }
    }
    const asqOut = addMonths(client.dob, 66);
    if (inWindow(asqOut)) {
      push('age-asq-out', 'ASQ-3 ages out (66 mo)', asqOut, 'ageWindow', {
        detail: 'The ASQ-3 applies from 1 to 66 months of age.',
      });
    }
  }

  return sortByDate(out);
}

const sortByDate = (list) => [...list].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

/** Every milestone across the caseload inside a window, sorted by date. */
export function getUpcoming(clients, { days = 60 } = {}) {
  const today = todayISO();
  const end = addDays(today, days);
  return clients
    .flatMap((c) => getClientSchedule(c).map((m) => ({ ...m, client: c })))
    .filter((m) => m.date >= today && m.date <= end)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Anything already past its date, most overdue first. */
export function getOverdue(clients) {
  const today = todayISO();
  const floor = addDays(today, -120); // beyond ~4 months back it is noise, not a to-do
  return clients
    .flatMap((c) => getClientSchedule(c).map((m) => ({ ...m, client: c })))
    .filter((m) => m.date < today && m.date >= floor && m.category !== 'birthday')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Data sanity checks, so a mis-pasted row gets caught before it becomes a
 * calendar full of wrong dates.
 */
export function getIssues(client) {
  const issues = [];
  if (!client.name) issues.push({ level: 'warn', message: 'No name — the calendar events will be hard to tell apart' });
  if (!client.intakeDate) {
    issues.push({ level: 'warn', message: 'No intake date — only birthdays will be scheduled' });
  } else if (!parseDate(client.intakeDate)) {
    issues.push({ level: 'error', message: 'Intake date is not a real date' });
  }
  if (client.dob && !parseDate(client.dob)) {
    issues.push({ level: 'error', message: 'Date of birth is not a real date' });
  }
  if (client.dob && client.intakeDate) {
    const dob = parseDate(client.dob);
    const intake = parseDate(client.intakeDate);
    if (dob && intake) {
      if (intake < dob) issues.push({ level: 'error', message: 'Intake is before the date of birth — the two dates are probably swapped' });
      if (intake.getTime() === dob.getTime()) issues.push({ level: 'error', message: 'Intake and date of birth are the same day — check the paste' });
    }
  }
  if (client.intakeDate) {
    const inService = daysBetween(client.intakeDate, todayISO());
    if (inService != null && inService > 730) {
      issues.push({ level: 'warn', message: `Intake was ~${Math.round(inService / 365 * 10) / 10}y ago — verify the date` });
    }
  }
  if (client.type === 'pregnant' && !client.birthDate) {
    issues.push({ level: 'info', message: 'Pregnant AA — add the birth date once the baby arrives to schedule Birth of Child and the 6-month' });
  }
  return issues;
}
