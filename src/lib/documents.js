import { differenceInCalendarDays, parseISO, isValid } from 'date-fns'

export const DOC_TYPES = ['Lease', 'Insurance', 'Warranty', 'Registration', 'Tax', 'Other']

// Expiry status for a document, or null when it has no expiry date.
// state: valid | expiring (<= 30 days) | expired.
export function docExpiry(doc, today = new Date()) {
  if (!doc?.expiry_date) return null
  const d = parseISO(doc.expiry_date)
  if (!isValid(d)) return null
  const daysLeft = differenceInCalendarDays(d, today)
  return { daysLeft, state: daysLeft < 0 ? 'expired' : daysLeft <= 30 ? 'expiring' : 'valid' }
}

// Documents expiring within 30 days or already expired — for the dashboard nudge.
export function expiringDocuments(documents, today = new Date()) {
  return documents
    .map((doc) => ({ doc, exp: docExpiry(doc, today) }))
    .filter((x) => x.exp && (x.exp.state === 'expired' || x.exp.state === 'expiring'))
    .sort((a, b) => (a.exp.daysLeft ?? 0) - (b.exp.daysLeft ?? 0))
}
