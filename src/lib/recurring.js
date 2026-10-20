import { addMonths, addQuarters, addYears, format, parseISO, isValid, getDaysInMonth, setDate } from 'date-fns'

// A transaction can repeat on a fixed cadence. We don't run a background job;
// instead we follow the latest entry in each recurring "series" and, once its
// next occurrence is due (on/before today), surface it for one-tap logging.

export const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
]

export const RECURRENCE_LABEL = {
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
}

const advance = (date, recurrence) => {
  switch (recurrence) {
    case 'monthly':
      return addMonths(date, 1)
    case 'quarterly':
      return addQuarters(date, 1)
    case 'yearly':
      return addYears(date, 1)
    default:
      return null
  }
}

// A series groups recurring entries that share the books they are in, the place
// they are booked to, their label (category/source) and their cadence, so
// re-logging "rent" each month follows the same stream.
//
// `project_id` and `entity_id` were both missing, and in a construction company
// that is not an edge case but the normal case: `assetOptional` leaves
// `property_id` null for every row, so three sites each with a monthly plant
// hire under one category were **one** series — and a series yields one due
// occurrence, following its most recent entry. Two of the three silently
// stopped recurring, with nothing on the dashboard to say a stream had gone
// quiet. The same collapse happened across companies in the consolidated view,
// where rows from every entity are present at once.
//
// Each part goes through `part()` rather than straight into a template string,
// because interpolation turns `undefined` into "undefined" and `null` into
// "null" — two spellings of "not booked anywhere" that split one stream into
// two, each then generating its own due occurrence for the same bill.
const part = (v) => (v == null ? '' : String(v))
const seriesKey = (e, kind) =>
  [
    kind,
    part(e.entity_id),
    part(e.property_id),
    part(e.project_id),
    part(kind === 'income' ? e.source : e.category),
    part(e.recurrence),
  ].join('|')

// The day of the month a series runs on, and why it has to be remembered.
//
// `addMonths` clamps: 31 January plus a month is 28 February. Each occurrence
// here is computed from the one before it, so that clamp is permanent — the
// series is on the 28th from then on, for good, and a bill on the 30th goes the
// same way after its first February. A yearly bill dated 29 February loses its
// day in the first non-leap year and never gets it back. Measured, all three.
//
// So the day is taken from where the series started and reapplied after each
// step, clamped to the length of the month it lands in. February still shortens
// that one occurrence; March is back on the 31st.
//
// The earliest entry rather than the latest, and that is the whole decision: a
// bill paid late and logged on the 25th must not move a series that runs on the
// 5th. The generated occurrences carry the clamping damage; the first one
// carries the intent.
const onSeriesDay = (date, anchorISO) => {
  const anchor = parseISO(anchorISO)
  if (!isValid(anchor)) return date
  return setDate(date, Math.min(anchor.getDate(), getDaysInMonth(date)))
}

// Recurring occurrences that are due to be logged (next date on/before today),
// one per series (following its most recent entry). `kind` is 'expense' | 'income'.
export function dueRecurring(entries, kind, today = new Date()) {
  // seriesKey -> { latest: the entry to copy forward, first: where it started }
  const series = new Map()
  for (const e of entries) {
    if (!e.recurrence || e.recurrence === 'none' || !e.date) continue
    const k = seriesKey(e, kind)
    const cur = series.get(k)
    if (!cur) {
      series.set(k, { latest: e, first: e })
      continue
    }
    if ((e.date || '') > (cur.latest.date || '')) cur.latest = e
    if ((e.date || '') < (cur.first.date || '')) cur.first = e
  }

  const todayISO = format(today, 'yyyy-MM-dd')
  const due = []
  for (const { latest, first } of series.values()) {
    const base = parseISO(latest.date)
    if (!isValid(base)) continue
    const next = advance(base, latest.recurrence)
    if (!next) continue
    const dueDate = format(onSeriesDay(next, first.date), 'yyyy-MM-dd')
    if (dueDate <= todayISO) due.push({ template: latest, kind, dueDate })
  }
  return due.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

// Build the payload for logging the next occurrence of a recurring entry:
// copy the template forward, date it to the due date, mark it settled, drop
// the old receipt, and keep the recurrence so the series continues.
//
// What is dropped is the point. The template is a row that already happened,
// and every field recording *that* it happened has to go, or the new entry
// arrives wearing last month's history:
//
//   • `receipt_url` — February's rent has no photograph of January's receipt.
//   • `created_at` / `updated_at` — a row created now, stamped with when some
//     other row was written.
//   • `deleted_at` — an occurrence that is in the bin before anyone sees it.
//   • `created_by` — `gate()` in EntityContext fills this in only when it is
//     absent (`row?.created_by || actor?.id`), and its own comment says that
//     person is "the one person who may not sign it". Carried forward, the
//     January entry's author stays the author of every month after — so whoever
//     taps "log it" is not recorded as raising it, and can approve it
//     themselves.
//   • `approval_status` / `approved_by` / `approved_at` — `gate()` recomputes
//     the status from the policy, so an approved template did not re-approve
//     itself, but the approver's name and the date they signed rode along onto a
//     row that is pending again. Cleared here so the new occurrence is created
//     the same way any other new row is.
export function nextOccurrencePayload(template, kind, dueDate) {
  const {
    id, user_id, created_at, updated_at, deleted_at, receipt_url,
    created_by, approval_status, approved_by, approved_at,
    ...rest
  } = template // eslint-disable-line no-unused-vars
  return {
    ...rest,
    date: dueDate,
    status: kind === 'income' ? 'received' : 'paid',
    due_date: null,
  }
}
