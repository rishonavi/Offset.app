// What a thing normally costs here, and what it cost this time.
//
// `priceList` already answers "what did this last cost, and what is quoted
// now". That is the question before buying. This is the one after: *was that
// purchase in line with the others*, which nobody asks, because answering it
// means reading a column of forty receipts and holding an average in your head.
//
// The norm is the **median** of the few purchases before it, not the mean. One
// emergency lorry at double rate drags a mean up far enough to make the next
// three purchases look like bargains, and the mean is exactly the statistic a
// bad purchase should not be allowed to move.
//
// Three things this deliberately does not claim:
//
//   **Above the norm is not fraud, and often is not even a mistake.** Steel
//   rises. A median over the last five purchases lags a steady climb, though —
//   six per cent a month compounds to fifteen per cent above the middle of the
//   window by the sixth month, and a check built on the median alone calls an
//   ordinary market a scandal four times running. Found by writing the test for
//   a rising market and watching it fail.
//
//   So a purchase has to be out of line with **two** things to be flagged: the
//   median of the window *and* the purchase immediately before it. A steady
//   climb is always in line with the last one. A spike is in line with neither.
//   The lorry after a spike is not flagged either, which is right — by then the
//   rate is not news.
//
//   **A norm needs a history.** Two prior purchases is the floor, and below it
//   nothing is flagged at all — a first purchase compared against itself is a
//   variance of zero, which is not an insight, and compared against nothing is
//   a divide by nothing.
//
//   **Cheaper is reported too.** A rate well below the norm is as likely to be
//   a keying error — a per-kilo rate entered against a tonne — as a good buy,
//   and a check that only looks upward finds the expensive half of the same
//   mistake.
import { round2 } from './inventory'
import { paidHistory } from './quotes'
import { TRADES } from './labour'
import { todayISO } from './today'

// Percent a rate may differ from the norm before it is worth a second look.
export const DEFAULT_TOLERANCE = 7
// How many prior purchases make the norm.
export const DEFAULT_WINDOW = 5
// Below this there is no norm to be out of line with.
export const MIN_HISTORY = 2

export function median(values = []) {
  const xs = values.filter((n) => Number.isFinite(n)).slice().sort((a, b) => a - b)
  if (!xs.length) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid] : round2((xs[mid - 1] + xs[mid]) / 2)
}

const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 1000) / 10 : null)

// One material, purchase by purchase, each against the norm of the ones before
// it. Walking forward rather than comparing everything to one overall average,
// because a purchase can only be judged against what was known at the time.
export function priceVariance(itemId, movements = [], {
  tolerance = DEFAULT_TOLERANCE, window = DEFAULT_WINDOW, minHistory = MIN_HISTORY,
} = {}) {
  const history = paidHistory(itemId, movements)
  const over = 1 + tolerance / 100
  const under = 1 - tolerance / 100
  const points = history.map((h, i) => {
    const prior = history.slice(Math.max(0, i - window), i).map((x) => x.rate)
    const baseline = prior.length >= minHistory ? median(prior) : null
    // The purchase immediately before this one. A market that is moving carries
    // this with it where the median of a window lags behind.
    const previous = i > 0 ? history[i - 1].rate : null
    const variancePercent = baseline === null ? null : pct(h.rate, baseline)
    const judged = baseline !== null && previous !== null
    return {
      ...h,
      baseline,
      previous,
      variancePercent,
      // How far from the last purchase, which is what makes a climb a climb.
      stepPercent: previous === null ? null : pct(h.rate, previous),
      // The rupees the difference came to on this delivery, which is the figure
      // that decides whether it is worth a phone call.
      value: baseline === null ? 0 : round2((h.rate - baseline) * h.qty),
      // Out of line with the window *and* with the lorry before it. Dear and
      // cheap are kept apart rather than folded into one flag, because they are
      // different conversations — one is a purchase to ask about, the other is
      // usually a rate keyed against the wrong unit.
      dear: judged && h.rate > baseline * over && h.rate > previous * over,
      cheap: judged && h.rate < baseline * under && h.rate < previous * under,
      unjudged: !judged,
    }
  })

  const judged = points.filter((p) => !p.unjudged)
  const dear = points.filter((p) => p.dear)
  const last = points[points.length - 1] || null
  return {
    itemId,
    points,
    count: points.length,
    // What the next purchase should cost, on this evidence.
    norm: median(history.slice(-window).map((h) => h.rate)),
    last: last ? last.rate : null,
    lastOn: last ? last.date : null,
    // Only the dear ones: netting a cheap delivery against a dear one reports
    // a company that overpaid twice as one that did nothing.
    overpaid: round2(dear.reduce((t, p) => t + p.value, 0)),
    dear: dear.length,
    cheap: points.filter((p) => p.cheap).length,
    judged: judged.length,
    worst: dear.slice().sort((a, b) => b.value - a.value)[0] || null,
  }
}

// Every material at once, worst first.
export function materialVariance(items = [], movements = [], { entityId = null, ...opts } = {}) {
  const rows = items
    .filter((i) => !i.deleted_at)
    .filter((i) => !entityId || i.entity_id === entityId)
    .map((item) => ({ item, ...priceVariance(item.id, movements, opts) }))
    .filter((r) => r.count > 0)

  return {
    rows: rows.sort((a, b) => b.overpaid - a.overpaid || b.dear - a.dear),
    count: rows.length,
    overpaid: round2(rows.reduce((t, r) => t + r.overpaid, 0)),
    dear: rows.reduce((t, r) => t + r.dear, 0),
    cheap: rows.reduce((t, r) => t + r.cheap, 0),
    // Materials bought too few times to judge. Reported so the total above
    // reads as "of what could be checked" rather than "of everything".
    unjudged: rows.filter((r) => r.judged === 0).length,
  }
}

// The same trade, the same fortnight, two different rates.
//
// Labour is where this bites hardest and where no report looks: a mason at
// ₹950 on one site and ₹780 on another in the same week is either a shortage
// nobody was told about or a contractor charging what he can get. Both are
// worth knowing and neither shows up in any total, because both sites are
// individually consistent.
export function labourRateSpread(muster = [], {
  entityId = null, days = 14, tolerance = DEFAULT_TOLERANCE, asOf = null, projects = [],
} = {}) {
  const day = asOf || todayISO()
  const from = new Date(`${day}T00:00:00Z`)
  from.setUTCDate(from.getUTCDate() - days)
  const since = from.toISOString().slice(0, 10)
  const nameOf = (id) => projects.find((p) => p.id === id)?.name || (id ? 'Unnamed site' : 'No site')

  const byTrade = new Map()
  for (const m of muster) {
    if (m.deleted_at) continue
    if (entityId && m.entity_id !== entityId) continue
    const rate = Number(m.rate) || 0
    if (rate <= 0) continue
    const date = String(m.date || '')
    if (date < since || date > day) continue
    if (!byTrade.has(m.trade)) byTrade.set(m.trade, [])
    byTrade.get(m.trade).push({ rate, date, projectId: m.project_id ?? null, headcount: Number(m.headcount) || 0 })
  }

  const lines = []
  for (const [trade, rows] of byTrade) {
    // One site cannot disagree with itself about what it pays.
    const sites = [...new Set(rows.map((r) => r.projectId))]
    if (sites.length < 2) continue
    const perSite = sites.map((id) => {
      const mine = rows.filter((r) => r.projectId === id)
      return {
        projectId: id,
        name: nameOf(id),
        rate: median(mine.map((r) => r.rate)),
        days: mine.length,
        headcount: mine.reduce((t, r) => t + r.headcount, 0),
      }
    }).sort((a, b) => b.rate - a.rate)
    const high = perSite[0]
    const low = perSite[perSite.length - 1]
    const spreadPercent = pct(high.rate, low.rate)
    if (spreadPercent === null || spreadPercent <= tolerance) continue
    lines.push({
      trade,
      label: TRADES[trade]?.label || trade,
      sites: perSite,
      high,
      low,
      spread: round2(high.rate - low.rate),
      spreadPercent,
      // What paying the high site at the low rate would have come to over the
      // window. Not a saving anybody can bank — the low rate may not be
      // available there — but it is the size of the question.
      atStake: round2((high.rate - low.rate) * high.headcount),
    })
  }

  return {
    lines: lines.sort((a, b) => b.atStake - a.atStake || b.spreadPercent - a.spreadPercent),
    count: lines.length,
    atStake: round2(lines.reduce((t, l) => t + l.atStake, 0)),
    days,
    since,
  }
}
