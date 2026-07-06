import { addMonths, addQuarters, addYears, format, parseISO, isValid } from 'date-fns'

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

// A series groups recurring entries that share asset + label (category/source)
// + cadence, so re-logging "rent" each month follows the same stream.
const seriesKey = (e, kind) =>
  `${kind}|${e.property_id}|${(kind === 'income' ? e.source : e.category) || ''}|${e.recurrence}`

// Recurring occurrences that are due to be logged (next date on/before today),
// one per series (following its most recent entry). `kind` is 'expense' | 'income'.
export function dueRecurring(entries, kind, today = new Date()) {
  const latest = new Map() // seriesKey -> entry with the max date
  for (const e of entries) {
    if (!e.recurrence || e.recurrence === 'none' || !e.date) continue
    const k = seriesKey(e, kind)
    const cur = latest.get(k)
    if (!cur || (e.date || '') > (cur.date || '')) latest.set(k, e)
  }

  const todayISO = format(today, 'yyyy-MM-dd')
  const due = []
  for (const template of latest.values()) {
    const base = parseISO(template.date)
    if (!isValid(base)) continue
    const next = advance(base, template.recurrence)
    if (!next) continue
    const dueDate = format(next, 'yyyy-MM-dd')
    if (dueDate <= todayISO) due.push({ template, kind, dueDate })
  }
  return due.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
}

// Build the payload for logging the next occurrence of a recurring entry:
// copy the template forward, date it to the due date, mark it settled, drop
// the old receipt, and keep the recurrence so the series continues.
export function nextOccurrencePayload(template, kind, dueDate) {
  const { id, user_id, created_at, receipt_url, ...rest } = template // eslint-disable-line no-unused-vars
  return {
    ...rest,
    date: dueDate,
    status: kind === 'income' ? 'received' : 'paid',
    due_date: null,
  }
}
