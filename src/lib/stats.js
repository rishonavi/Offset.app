import { startOfMonth, subMonths, format, parseISO, isValid } from 'date-fns'

export function totalsByCategory(expenses) {
  const map = new Map()
  for (const e of expenses) {
    const k = e.category || 'Other'
    map.set(k, (map.get(k) || 0) + (Number(e.amount) || 0))
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value)
}

// What was spent against each thing it was spent on — an asset the company
// owns, or a job it is building. Keyed on the id rather than on the label,
// because two assets called "Shop" are two assets and merging them because
// they share a name is a chart that lies.
//
// Rows booked to neither share one bucket and are named out loud. They used to
// be named "Unknown", which reads as a lookup that failed; a builder's office
// rent is not unknown, it is simply nobody's job to carry, and a slice on this
// chart is how that gets noticed.
export function totalsByPlace(rows, place) {
  // Named from the first row in each bucket, which is any row in it: they all
  // carry the same booking. Three cases, and they must stay three.
  //
  //  - No booking at all: an overhead. Named, not shrugged at.
  //  - A booking that resolves: the asset or the job.
  //  - A booking that does not: an asset deleted out from under its costs. It
  //    is still booked to something, so it is not an overhead — and it must not
  //    borrow the name of the job on the same row, or a site ends up drawn as
  //    two slices with one name, which is the lie this keying exists to avoid.
  const named = (row, key) => {
    if (!key) return 'Not booked'
    const at = place(row)
    return at?.id === key ? at.name : 'Unknown'
  }
  const map = new Map()
  for (const r of rows) {
    const key = r.property_id || r.project_id || ''
    const at = map.get(key)
    const amount = Number(r.amount) || 0
    if (at) at.value += amount
    else map.set(key, { id: key, name: named(r, key), value: amount })
  }
  return [...map.values()].filter((d) => d.value > 0).sort((a, b) => b.value - a.value)
}

export function monthlySeries(expenses, months = 12) {
  const buckets = new Map()
  const order = []
  const now = startOfMonth(new Date())
  for (let i = months - 1; i >= 0; i--) {
    const d = subMonths(now, i)
    const key = format(d, 'yyyy-MM')
    buckets.set(key, 0)
    order.push({ key, label: format(d, 'MMM yy') })
  }
  for (const e of expenses) {
    if (!e.date) continue
    const d = parseISO(e.date)
    if (!isValid(d)) continue
    const key = format(d, 'yyyy-MM')
    if (buckets.has(key)) buckets.set(key, buckets.get(key) + (Number(e.amount) || 0))
  }
  return order.map(({ key, label }) => ({ month: label, total: buckets.get(key) || 0 }))
}

// Combined per-month income / expense / net over the last `months`.
export function monthlyIncomeExpense(expenses, income, months = 12) {
  const exp = new Map()
  const inc = new Map()
  const order = []
  const now = startOfMonth(new Date())
  for (let i = months - 1; i >= 0; i--) {
    const d = subMonths(now, i)
    const key = format(d, 'yyyy-MM')
    exp.set(key, 0)
    inc.set(key, 0)
    order.push({ key, label: format(d, 'MMM yy') })
  }
  const add = (bucket, rows) => {
    for (const r of rows) {
      if (!r.date) continue
      const d = parseISO(r.date)
      if (!isValid(d)) continue
      const k = format(d, 'yyyy-MM')
      if (bucket.has(k)) bucket.set(k, bucket.get(k) + (Number(r.amount) || 0))
    }
  }
  add(exp, expenses)
  add(inc, income)
  return order.map(({ key, label }) => ({
    month: label,
    income: inc.get(key) || 0,
    expense: exp.get(key) || 0,
    net: (inc.get(key) || 0) - (exp.get(key) || 0),
  }))
}
