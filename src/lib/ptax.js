// Professional tax, which is twenty-two different taxes wearing one name.
//
// It is a state levy under Article 276 of the Constitution, and the only thing
// every state agrees on is the ceiling that Article puts on it: ₹2,500 a year
// per person, which no state may exceed. Below that ceiling they agree on
// nothing. The slabs differ, the income they are measured against differs, and
// so does how often the money is collected — monthly in Maharashtra, every six
// months in Tamil Nadu and Kerala, once a year in Bihar and Jharkhand. Fourteen
// states and union territories do not levy it at all.
//
// This app had one set of slabs — Maharashtra's — switched on by default, so a
// company in Delhi, which levies no professional tax whatsoever, had ₹200 a
// month taken off every payslip. That is the same defect as deducting provident
// fund from a company that never registered for it, one layer down: an answer
// invented on the user's behalf and then hidden inside a total.
//
// So the state is the question, and the company has already answered it: the
// first two digits of a GSTIN are the state code. Where a company works in more
// than one state — which is most builders — the employee's own work state wins,
// because professional tax follows where the work is done and not where the
// head office keeps its books.
//
// **These slabs are a starting point, not a source of law.** They are stated as
// of the date below; states revise them in their budgets, and a slab that moved
// last April is a wrong payslip every month until somebody notices. Every one
// of them is editable, and where this file does not know a state's slabs it
// says so instead of deducting zero and looking finished.

export const AS_OF = '2026-04-01'

// Article 276(2). The cap is on the total for the year per person, so it is a
// property every state's table has to satisfy rather than a number to subtract
// at the end — a state whose slabs add up past it has been typed in wrong.
export const ANNUAL_CAP = 2500

const round0 = (n) => Math.round(Number(n) || 0)

// `upTo` is inclusive and the last slab carries Infinity, so a lookup always
// lands somewhere.
const slab = (upTo, amount) => ({ upTo, amount })

// ── The states ─────────────────────────────────────────────────────
//
// Keyed by GST state code, because that is the one place a company has already
// written down which state it is in.
//
//   `levies`   whether the state has a professional tax at all
//   `known`    whether the slabs below are this file's, or still to be entered
//   `basis`    what the slab is measured against: a month's pay, six months' or
//              a year's
//   `every`    how often the amount in the slab is collected
//   `extra`    a calendar month that carries a different amount, which is how
//              several states top the year up to the cap
//
// A state's professional-tax year runs April to March whatever a company's own
// books do, so `extra` names a calendar month and not an offset into a
// financial year.
const S = (code, name, rest) => [code, { code, name, levies: false, known: true, basis: 'monthly', every: 'month', slabs: null, exemptions: [], ...rest }]

export const STATES = Object.fromEntries([
  // ── Levying, slabs known ──────────────────────────────────────────
  S('27', 'Maharashtra', {
    levies: true, basis: 'monthly', every: 'month',
    slabs: [slab(7500, 0), slab(10000, 175), slab(Infinity, 200)],
    // ₹200 eleven times and ₹300 in February is exactly ₹2,500 — the state
    // collects the constitutional maximum and the odd month is how it gets
    // there without exceeding it in any other.
    extra: { month: 2, amount: 300 },
    women: { upTo: 25000 },
    exemptions: ['Women drawing up to ₹25,000 a month', 'Parents of a child with a disability', 'Persons with a permanent physical disability'],
    note: 'Slabs on monthly gross. ₹300 in February rather than ₹200.',
  }),
  S('29', 'Karnataka', {
    levies: true,
    slabs: [slab(24999, 0), slab(Infinity, 200)],
    exemptions: ['Persons aged 60 and above', 'Persons with a disability of 40% or more'],
    note: 'One threshold, raised to ₹25,000 a month in April 2023.',
  }),
  S('19', 'West Bengal', {
    levies: true,
    slabs: [slab(10000, 0), slab(15000, 110), slab(25000, 130), slab(40000, 150), slab(Infinity, 200)],
    note: 'Five slabs on monthly gross.',
  }),
  S('37', 'Andhra Pradesh', {
    levies: true,
    slabs: [slab(15000, 0), slab(20000, 150), slab(Infinity, 200)],
    note: 'Slabs on monthly gross.',
  }),
  S('36', 'Telangana', {
    levies: true,
    slabs: [slab(15000, 0), slab(20000, 150), slab(Infinity, 200)],
    note: 'Slabs on monthly gross, the same as Andhra Pradesh.',
  }),
  S('24', 'Gujarat', {
    levies: true,
    slabs: [slab(12000, 0), slab(Infinity, 200)],
    note: 'One threshold, raised to ₹12,000 a month in April 2022.',
  }),
  S('18', 'Assam', {
    levies: true,
    slabs: [slab(10000, 0), slab(15000, 150), slab(25000, 180), slab(Infinity, 208)],
    note: 'Slabs on monthly gross. The top slab is ₹208 so that twelve months stay inside the cap.',
  }),
  S('03', 'Punjab', {
    levies: true, basis: 'annual', every: 'month',
    // Punjab charges everyone assessable to income tax, which is a fact about
    // the person's whole income and not about this payslip. A flat ₹200 took
    // it off a labourer on ₹8,000 a month who owes no income tax at all, so the
    // threshold here stands in for the basic exemption limit. It is an
    // approximation of the real test and the caveat below says so.
    slabs: [slab(250000, 0), slab(Infinity, 200)],
    // The Punjab State Development Tax is charged on everyone assessable to
    // income tax, which is not a figure a payslip holds. Anybody below the
    // income-tax threshold is not liable and this cannot tell which.
    caveat: 'Punjab charges everyone assessable to income tax, which depends on the person’s whole income and not on this payslip alone. The threshold here stands in for the basic exemption limit — check anybody near it before deducting.',
    note: 'A flat ₹200 a month above the income-tax threshold, called the State Development Tax.',
  }),
  S('23', 'Madhya Pradesh', {
    levies: true, basis: 'annual', every: 'month',
    slabs: [slab(225000, 0), slab(300000, 125), slab(400000, 166), slab(Infinity, 208)],
    extra: { month: 3, amounts: { 166: 174, 208: 212 } },
    note: 'Slabs on annual gross, deducted monthly, with a few rupees more in March.',
  }),
  S('21', 'Odisha', {
    levies: true, basis: 'annual', every: 'month',
    slabs: [slab(160000, 0), slab(300000, 125), slab(Infinity, 200)],
    extra: { month: 3, amounts: { 200: 300 } },
    note: 'Slabs on annual gross, deducted monthly, with ₹300 in March.',
  }),
  S('33', 'Tamil Nadu', {
    levies: true, basis: 'half-yearly', every: 'half-year',
    slabs: [slab(21000, 0), slab(30000, 135), slab(45000, 315), slab(60000, 690), slab(75000, 1025), slab(Infinity, 1250)],
    caveat: 'Levied by the local body rather than the state, so the slabs differ between corporations. These are Greater Chennai’s.',
    note: 'Slabs on six months’ gross, collected twice a year.',
  }),
  S('32', 'Kerala', {
    levies: true, basis: 'half-yearly', every: 'half-year',
    slabs: [slab(11999, 0), slab(17999, 120), slab(29999, 180), slab(44999, 300), slab(59999, 450),
      slab(74999, 600), slab(99999, 750), slab(124999, 1000), slab(Infinity, 1250)],
    caveat: 'Levied by the panchayat or municipality, so the slabs vary a little between local bodies.',
    note: 'Slabs on six months’ gross, collected twice a year.',
  }),
  S('10', 'Bihar', {
    levies: true, basis: 'annual', every: 'year',
    slabs: [slab(300000, 0), slab(500000, 1000), slab(1000000, 2000), slab(Infinity, 2500)],
    note: 'Slabs on annual gross, collected once a year.',
  }),
  S('20', 'Jharkhand', {
    levies: true, basis: 'annual', every: 'year',
    slabs: [slab(300000, 0), slab(500000, 1200), slab(800000, 1800), slab(1000000, 2100), slab(Infinity, 2500)],
    note: 'Slabs on annual gross, collected once a year.',
  }),

  // ── Levying, slabs not entered ────────────────────────────────────
  //
  // These states do charge professional tax. This file does not carry slabs it
  // is not sure of, because a wrong slab is a wrong payslip every month and
  // nothing on screen would say so. A guess here would be indistinguishable
  // from knowledge, which is the worst of the three states to be in.
  ...[
    ['22', 'Chhattisgarh'], ['17', 'Meghalaya'], ['16', 'Tripura'], ['14', 'Manipur'],
    ['15', 'Mizoram'], ['13', 'Nagaland'], ['11', 'Sikkim'], ['34', 'Puducherry'],
  ].map(([code, name]) => S(code, name, {
    levies: true, known: false,
    note: 'This state levies professional tax. Its slabs are not built in — enter them from the state’s own notification.',
  })),

  // ── Not levying ───────────────────────────────────────────────────
  //
  // Not a zero slab. These states have no professional tax at all, which is a
  // different sentence from "nobody has entered the slabs" and has to read
  // differently on screen.
  ...[
    ['07', 'Delhi'], ['06', 'Haryana'], ['09', 'Uttar Pradesh'], ['05', 'Uttarakhand'],
    ['08', 'Rajasthan'], ['02', 'Himachal Pradesh'], ['01', 'Jammu and Kashmir'],
    ['38', 'Ladakh'], ['30', 'Goa'], ['12', 'Arunachal Pradesh'], ['04', 'Chandigarh'],
    ['35', 'Andaman and Nicobar Islands'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'],
    ['31', 'Lakshadweep'],
  ].map(([code, name]) => S(code, name, {
    levies: false,
    note: 'No professional tax is levied here.',
  })),
])

export const STATE_CODES = Object.keys(STATES).sort()
// For a picker: levying states first, because that is who needs to find
// themselves on the list.
export const STATES_BY_NAME = STATE_CODES
  .map((c) => STATES[c])
  .sort((a, b) => (a.levies === b.levies ? a.name.localeCompare(b.name) : a.levies ? -1 : 1))

// A GSTIN opens with its state code, so a company that has entered one has
// already said which state it is in.
export const stateFromGstin = (gstin) => {
  const m = String(gstin || '').trim().match(/^(\d{2})/)
  return m && STATES[m[1]] ? m[1] : ''
}

// Where an employee's professional tax is owed. It follows the work, not the
// head office — a Mumbai company with a site in Bengaluru owes Karnataka for
// the men on that site.
export const workStateOf = (employee, entity) =>
  String(employee?.work_state || '').trim()
  || String(entity?.pt_state || '').trim()
  || stateFromGstin(entity?.gstin)
  || ''

// ── The arithmetic ─────────────────────────────────────────────────

// Which month of the tax year a period falls in, counting from April. States
// run April to March whatever the company's own books do.
const PT_YEAR_START = 4
export function taxYearMonth(period) {
  const m = Number(String(period || '').slice(5, 7)) || 1
  return (m - PT_YEAR_START + 12) % 12
}

// A liability collected less often than monthly, spread over the months it
// covers so that take-home stays level — and so that the months add up to the
// liability exactly rather than to something near it. The remainder goes in the
// last month rather than being scattered a rupee at a time.
export function spread(total, months, index) {
  const t = round0(total)
  if (months <= 1) return t
  const each = Math.floor(t / months)
  return index >= months - 1 ? t - each * (months - 1) : each
}

const pick = (slabs, income) => slabs.find((s) => income <= s.upTo) || slabs[slabs.length - 1]

// What one person owes for one month.
//
// Returns the amount and, as importantly, why — a zero has four different
// meanings here (no such state, the state levies nothing, the slabs are not
// entered, the person is under the threshold) and a payslip that cannot tell
// them apart is not telling the truth about any of them.
export function ptaxFor({
  state = '', monthlyGross = 0, period = '', female = null, override = null,
} = {}) {
  const gross = Math.max(0, Number(monthlyGross) || 0)
  const month = Number(String(period || '').slice(5, 7)) || 0
  const code = String(state || '').trim()
  const st = STATES[code]

  const out = (amount, why, rest = {}) => ({
    amount: round0(amount), code, name: st?.name || '', state: st || null,
    levies: Boolean(st?.levies), known: Boolean(st?.known), why, ...rest,
  })

  // The company has entered its own slabs, which beats anything built in. A
  // state that revised its slabs last April is why this exists.
  const table = override?.slabs?.length ? { ...(st || {}), levies: true, known: true, slabs: override.slabs,
    basis: override.basis || st?.basis || 'monthly', every: override.every || st?.every || 'month',
    extra: override.extra ?? st?.extra, women: override.women ?? st?.women, name: st?.name || 'this company’s own slabs' }
    : st

  if (!code) return out(0, 'Nobody has said which state the work is in, so no professional tax is worked out.', { unanswered: true })
  if (!st) return out(0, `${code} is not a state code this knows.`, { unknownState: true })
  if (!table.levies) return out(0, `${st.name} levies no professional tax.`, { none: true })
  if (!table.known || !table.slabs?.length) {
    return out(0, `${st.name} levies professional tax, but its slabs are not built in — enter them and this will deduct.`, { needsSlabs: true })
  }

  // Maharashtra exempts women up to ₹25,000 a month. `female` is three-valued
  // for the same reason registration is: nobody having recorded who is a woman
  // is not the same as everybody being a man, and an exemption going unclaimed
  // because a field was never filled in costs somebody ₹2,400 a year.
  if (table.women && gross <= table.women.upTo) {
    if (female === true) return out(0, `${table.name} exempts women drawing up to ₹${table.women.upTo.toLocaleString('en-IN')} a month.`, { exempt: true })
    if (female === null || female === undefined) {
      // Deducted, and said. Not deducting would leave the company short with
      // the state if this is a man; deducting silently takes ₹2,400 a year off
      // somebody who owes nothing if it is a woman. The only answer that is not
      // a guess is to charge it and say the field is empty, which is why the
      // sentence carries both halves.
      return out(pickAmount(table, gross, month, period),
        `${describeWhy(table, gross, month)} ${table.name} exempts women drawing up to ₹${table.women.upTo.toLocaleString('en-IN')} a month and this person’s sex is not recorded, so it is being deducted meanwhile.`,
        { mayBeExempt: true, ...spreadInfo(table, gross, period) })
    }
  }

  return out(pickAmount(table, gross, month, period), describeWhy(table, gross, month), spreadInfo(table, gross, period))
}

// The income the slab is read against, which is not always a month's pay.
const incomeFor = (table, gross) =>
  table.basis === 'annual' ? gross * 12 : table.basis === 'half-yearly' ? gross * 6 : gross

function pickAmount(table, gross, month, period = '') {
  const found = pick(table.slabs, incomeFor(table, gross))
  let amount = found.amount
  if (amount <= 0) return 0

  // A month that carries a different figure. Several states use one to top the
  // year up to the cap without going over it in any other month.
  if (table.extra && Number(month) === Number(table.extra.month)) {
    if (table.extra.amounts && table.extra.amounts[amount] != null) amount = table.extra.amounts[amount]
    else if (table.extra.amount != null) amount = table.extra.amount
  }
  if (table.every === 'month') return amount

  // Collected twice a year or once a year, so the payslip carries a share.
  const months = table.every === 'year' ? 12 : 6
  const idx = table.every === 'year' ? taxYearMonth(period) : taxYearMonth(period) % 6
  return spread(amount, months, idx)
}

const spreadInfo = (table, gross, period) => {
  if (table.every === 'month') return { collected: 'month' }
  const months = table.every === 'year' ? 12 : 6
  const total = pick(table.slabs, incomeFor(table, gross)).amount
  return {
    collected: table.every, periodTotal: total, monthsInPeriod: months,
    monthOfPeriod: (table.every === 'year' ? taxYearMonth(period) : taxYearMonth(period) % 6) + 1,
  }
}

function describeWhy(table, gross, month) {
  const income = incomeFor(table, gross)
  const found = pick(table.slabs, income)
  const rupees = (n) => `₹${round0(n).toLocaleString('en-IN')}`
  const on = table.basis === 'annual' ? `${rupees(income)} a year`
    : table.basis === 'half-yearly' ? `${rupees(income)} over six months`
      : `${rupees(income)} a month`
  if (found.amount <= 0) return `${table.name}: ${on} is under the threshold, so nothing is due.`
  const per = table.every === 'month' ? ' a month' : ''
  const collected = table.every === 'year' ? ' It is collected once a year and spread over the twelve months.'
    : table.every === 'half-year' ? ' It is collected twice a year and spread over the six months.' : ''
  const feb = table.extra && Number(month) === Number(table.extra.month) ? ' This month carries the state’s higher figure.' : ''
  return `${table.name}: ${on} falls in the ${rupees(found.amount)}${per} slab.${collected}${feb}`
}

// A whole tax year for one person, which is the only way to see whether the
// months add up to what the state actually charges.
export function ptaxYear({ state = '', monthlyGross = 0, female = null, override = null, year = 2026 } = {}) {
  const months = Array.from({ length: 12 }, (_, i) => {
    const m = ((PT_YEAR_START - 1 + i) % 12) + 1
    const y = m >= PT_YEAR_START ? year : year + 1
    const period = `${y}-${String(m).padStart(2, '0')}`
    return { period, month: m, ...ptaxFor({ state, monthlyGross, period, female, override }) }
  })
  return {
    months,
    total: months.reduce((t, r) => t + r.amount, 0),
    state: STATES[String(state || '').trim()] || null,
  }
}

// What a state charges somebody at the top of its slabs, over a year. Used to
// check the table against Article 276 rather than to bill anyone.
export const annualMaximum = (code) => ptaxYear({ state: code, monthlyGross: 10000000, female: false }).total

// ── Saying it in a sentence ────────────────────────────────────────
export function describeState(code) {
  const st = STATES[String(code || '').trim()]
  if (!st) return 'No state chosen, so no professional tax is worked out.'
  // Whole sentences rather than "Delhi — no professional tax", which is also
  // what the state appears as in a picker: the same string in two places means
  // a test cannot tell whether the description updated, and neither can a
  // reader glancing at the screen.
  if (!st.levies) return `${st.name} levies no professional tax, so nothing is deducted.`
  if (!st.known) return `${st.name} levies professional tax and its slabs are not built in, so nothing is being deducted and something is owed.`
  return `${st.name}: ${st.note}`
}
