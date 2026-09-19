// Reading a date somebody else wrote.
//
// This lived in `exports.js`, which statically imports `xlsx` and `jspdf` —
// three quarters of a megabyte between them. `papers.js` and `intake.js` want
// nothing from that module but this one function, so every screen that reads a
// document or a spreadsheet was downloading both libraries to normalise a date
// string. It is forty lines of date handling and belongs on its own.
import { format, isValid, parseISO } from 'date-fns'

// Normalise an arbitrary cell value into a yyyy-MM-dd string.
export function normalizeDate(value) {
  if (!value) return ''
  if (value instanceof Date) return isValid(value) ? format(value, 'yyyy-MM-dd') : ''
  const s = String(value).trim()
  // Excel serial number
  if (/^\d{5}$/.test(s)) {
    const d = new Date(Math.round((Number(s) - 25569) * 86400 * 1000))
    return isValid(d) ? format(d, 'yyyy-MM-dd') : ''
  }
  const iso = parseISO(s)
  if (isValid(iso)) return format(iso, 'yyyy-MM-dd')

  // Day first, which is what this app's users write.
  //
  // Handing `12-06-2026` to `new Date` gets the 6th of December, because that
  // is what a browser does with an unqualified numeric date. In an app that is
  // India-first everywhere else, a bill dated 12-06-2026 is the twelfth of
  // June, and every spreadsheet imported into it until now has had those two
  // swapped on any day of the month up to the twelfth — silently, since the
  // result is always a real date.
  //
  // Where one of the two is above twelve it cannot be the month, whichever
  // order it was written in, so that case is read rather than assumed.
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s)
  if (dmy) {
    let [, day, month, year] = dmy
    if (Number(month) > 12 && Number(day) <= 12) [day, month] = [month, day]
    if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
      const y = year.length === 2 ? `20${year}` : year
      const candidate = parseISO(`${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
      if (isValid(candidate)) return format(candidate, 'yyyy-MM-dd')
    }
    return ''
  }

  const fallback = new Date(s)
  return isValid(fallback) ? format(fallback, 'yyyy-MM-dd') : ''
}
