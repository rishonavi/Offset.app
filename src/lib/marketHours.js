// When a metal price is actually from.
//
// A rate you read at 2am on a Sunday is Friday's closing price. Stamping it
// "today" makes a stale number look live, and a portfolio that says it was
// valued this morning when it was valued two days ago is worse than one that
// admits the gap. So valuations are dated to the **session close** they came
// from, and every answer here is computed in IST no matter where the browser
// thinks it is.

const IST_OFFSET_MIN = 330 // UTC+05:30, no daylight saving, ever.
const MIN = 60_000
const DAY_MIN = 1440

// MCX metals: one continuous session, 09:00 to 23:30 IST, Monday to Friday.
export const SESSION = { openMin: 9 * 60, closeMin: 23 * 60 + 30 }

export const sessionLabel = '9:00 am – 11:30 pm IST, Mon–Fri'

// Read a Date as IST wall-clock. Shifting the instant and then reading it back
// in UTC is the whole trick — it avoids depending on the host timezone.
function ist(date) {
  const d = new Date(date.getTime() + IST_OFFSET_MIN * MIN)
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth(),
    d: d.getUTCDate(),
    weekday: d.getUTCDay(), // 0 Sun … 6 Sat
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  }
}

const pad = (n) => String(n).padStart(2, '0')

const isoOf = ({ y, m, d }) => `${y}-${pad(m + 1)}-${pad(d)}`

// An instant, from an IST wall-clock date and minute-of-day.
function instant({ y, m, d }, minuteOfDay) {
  return new Date(Date.UTC(y, m, d, 0, minuteOfDay) - IST_OFFSET_MIN * MIN)
}

function shiftDays(parts, n) {
  const d = new Date(Date.UTC(parts.y, parts.m, parts.d))
  d.setUTCDate(d.getUTCDate() + n)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(), weekday: d.getUTCDay() }
}

// Exchange holidays move every year and there is no rule to derive them from,
// so this does not pretend to know them. Pass the list you have; the answer is
// still right on weekends and hours without it.
export function isTradingDay(date, holidays = []) {
  const p = ist(date instanceof Date ? date : new Date(date))
  if (p.weekday === 0 || p.weekday === 6) return false
  return !holidays.includes(isoOf(p))
}

export function isOpen(date = new Date(), holidays = []) {
  const at = date instanceof Date ? date : new Date(date)
  if (!isTradingDay(at, holidays)) return false
  const { minutes } = ist(at)
  return minutes >= SESSION.openMin && minutes < SESSION.closeMin
}

// The most recent close on or before `date`. Never returns a future instant,
// which is the property that makes it safe to date a valuation with.
export function lastClose(date = new Date(), holidays = []) {
  const at = date instanceof Date ? date : new Date(date)
  const now = ist(at)
  let day = { y: now.y, m: now.m, d: now.d, weekday: now.weekday }

  // Today only counts once it has actually closed.
  const closedToday = isTradingDay(at, holidays) && now.minutes >= SESSION.closeMin
  if (!closedToday) day = shiftDays(day, -1)

  // Walk back to the last day that traded. Bounded so a bad holiday list can
  // never spin here.
  for (let i = 0; i < 30; i++) {
    const candidate = instant(day, SESSION.closeMin)
    if (isTradingDay(candidate, holidays)) return candidate
    day = shiftDays(day, -1)
  }
  return instant(day, SESSION.closeMin)
}

// The next open, for "prices update again at…".
export function nextOpen(date = new Date(), holidays = []) {
  const at = date instanceof Date ? date : new Date(date)
  const now = ist(at)
  let day = { y: now.y, m: now.m, d: now.d, weekday: now.weekday }
  if (now.minutes >= SESSION.openMin) day = shiftDays(day, 1)
  for (let i = 0; i < 30; i++) {
    const candidate = instant(day, SESSION.openMin)
    if (isTradingDay(candidate, holidays)) return candidate
    day = shiftDays(day, 1)
  }
  return instant(day, SESSION.openMin)
}

// The IST calendar date of a valuation — what to store alongside the rate.
export function valuationDate(date = new Date(), holidays = []) {
  return isoOf(ist(lastClose(date, holidays)))
}

const istTime = (d) => {
  const p = ist(d)
  const h24 = Math.floor(p.minutes / 60)
  const mm = p.minutes % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${pad(mm)} ${h24 < 12 ? 'am' : 'pm'}`
}

// How stale is this price, in plain words.
export function describeMarket(date = new Date(), holidays = []) {
  const at = date instanceof Date ? date : new Date(date)
  if (isOpen(at, holidays)) return { open: true, text: `Market open · closes ${istTime(instant(ist(at), SESSION.closeMin))} IST` }

  const close = lastClose(at, holidays)
  const today = ist(at)
  const closeDay = ist(close)
  // Whole IST calendar days between the two, not elapsed hours — "yesterday's
  // close" is about the date on it, not 24 hours having passed.
  const days = Math.round(
    (Date.UTC(today.y, today.m, today.d) - Date.UTC(closeDay.y, closeDay.m, closeDay.d)) / (DAY_MIN * MIN),
  )
  const when = days <= 0 ? "today's" : days === 1 ? "yesterday's" : `${days} days ago, at that`
  return {
    open: false,
    text: days <= 1 ? `Market closed · last priced at ${when} close` : `Market closed · last priced ${days} days ago`,
    lastClose: close,
    daysStale: Math.max(0, days),
  }
}
