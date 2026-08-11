// A portfolio to look at before you have one of your own.
//
// An empty app is a fair thing to show someone who has decided to use it, and
// a terrible thing to show someone deciding whether to. Charts with no bars and
// tables with no rows say nothing about what the thing does. So there is a
// small, plausible portfolio available on request — two properties, a car,
// eleven months of rent and the running costs that go with them.
//
// Two rules make it safe. Every row it writes is tagged, so removing it takes
// out exactly what it put in and nothing the user has typed since. And it
// refuses to run when there is already real data, because merging demo rows
// into someone's books is the one outcome nobody would forgive.

import { subMonths, format, startOfMonth } from 'date-fns'

export const SAMPLE_TAG = '__sample__'

const iso = (d) => format(d, 'yyyy-MM-dd')
const monthsBack = (n) => startOfMonth(subMonths(new Date(), n))

// Marked on every row it creates. `is_sample` rather than a magic string in a
// notes field, so it can never be mistaken for something the user wrote.
const tag = (row) => ({ ...row, is_sample: true, notes: row.notes || SAMPLE_TAG })

export const isSampleRow = (row) => Boolean(row?.is_sample) || row?.notes === SAMPLE_TAG

const ASSETS = [
  {
    name: 'Sea View Apartment',
    type: 'Real Estate — Apartment / Flat',
    address: 'Carter Road, Bandra West, Mumbai',
    value: 42000000,
    monthly_budget: 25000,
    tenant_name: 'Rahul Mehta',
    deposit: 300000,
    loan_principal: 18000000,
    loan_rate: 8.6,
    loan_tenure_months: 240,
  },
  {
    name: 'Koregaon Park Shop',
    type: 'Real Estate — Commercial',
    address: 'Lane 5, Koregaon Park, Pune',
    value: 16500000,
    monthly_budget: 12000,
    tenant_name: 'Bloom Coffee LLP',
    deposit: 450000,
  },
  {
    name: 'Fortuner',
    type: 'Vehicle / Car',
    address: '',
    value: 3800000,
    monthly_budget: 9000,
  },
]

// Rent, monthly, with the shop's escalation partway through — a flat line for
// eleven months would not show what the charts are for.
function incomeRows(assetIds) {
  const rows = []
  for (let m = 11; m >= 0; m--) {
    const date = iso(monthsBack(m))
    rows.push({ property_id: assetIds[0], source: 'Monthly rent', amount: 185000, date })
    rows.push({ property_id: assetIds[1], source: 'Shop rent', amount: m > 5 ? 95000 : 102000, date })
  }
  rows.push({ property_id: assetIds[0], source: 'Parking rent', amount: 4000, date: iso(monthsBack(2)) })
  return rows
}

// The costs a portfolio actually generates: recurring utilities, an annual
// insurance premium, property tax, and one repair big enough to be visible.
function expenseRows(assetIds) {
  const rows = []
  for (let m = 11; m >= 0; m--) {
    const date = iso(monthsBack(m))
    rows.push({ property_id: assetIds[0], category: 'Utilities', vendor: 'Adani Electricity', amount: 3200 + (m % 4) * 700, date, status: 'paid', payment_method: 'UPI' })
    rows.push({ property_id: assetIds[0], category: 'Maintenance & Repairs', vendor: 'Sea Breeze CHS', amount: 8500, date, status: 'paid', payment_method: 'Bank Transfer' })
    rows.push({ property_id: assetIds[1], category: 'Utilities', vendor: 'MSEDCL', amount: 2400 + (m % 3) * 400, date, status: 'paid', payment_method: 'UPI' })
    rows.push({ property_id: assetIds[2], category: 'Maintenance & Repairs', vendor: 'Toyota Service', amount: m % 6 === 0 ? 14500 : 0, date, status: 'paid', payment_method: 'Cheque' })
  }
  rows.push({ property_id: assetIds[0], category: 'Property Tax', vendor: 'BMC', amount: 48000, date: iso(monthsBack(7)), status: 'paid', payment_method: 'Bank Transfer' })
  rows.push({ property_id: assetIds[0], category: 'Insurance', vendor: 'HDFC Ergo', amount: 22000, date: iso(monthsBack(4)), status: 'paid', payment_method: 'Bank Transfer' })
  rows.push({ property_id: assetIds[1], category: 'Permits & Legal', vendor: 'Shah & Associates', amount: 18000, date: iso(monthsBack(3)), status: 'paid', payment_method: 'Bank Transfer' })
  rows.push({ property_id: assetIds[0], category: 'Maintenance & Repairs', vendor: 'Kohler Plumbing', amount: 64000, date: iso(monthsBack(1)), status: 'paid', payment_method: 'Cash' })
  // One unpaid bill, so the "due" state is visible rather than theoretical.
  rows.push({ property_id: assetIds[1], category: 'Materials', vendor: 'Asian Paints', amount: 31000, date: iso(monthsBack(0)), status: 'unpaid', payment_method: 'Bank Transfer' })
  return rows.filter((r) => r.amount > 0)
}

// Whether there is anything here that the user typed themselves.
export function hasRealData({ properties = [], expenses = [], income = [] } = {}) {
  return [...properties, ...expenses, ...income].some((r) => !isSampleRow(r))
}

export function hasSampleData({ properties = [], expenses = [], income = [] } = {}) {
  return [...properties, ...expenses, ...income].some(isSampleRow)
}

// Writes the portfolio through the same functions the app uses, so sample rows
// go through exactly the same validation and stamping as real ones.
export async function installSampleData({ addProperty, addExpense, addIncome, properties, expenses, income }) {
  if (hasRealData({ properties, expenses, income })) {
    throw new Error('There are already entries here. Sample data is only for an empty set of books.')
  }
  if (hasSampleData({ properties, expenses, income })) {
    throw new Error('The sample portfolio is already loaded.')
  }

  const created = []
  for (const a of ASSETS) created.push(await addProperty(tag(a)))
  const ids = created.map((a) => a.id)

  for (const r of incomeRows(ids)) await addIncome(tag(r))
  for (const r of expenseRows(ids)) await addExpense(tag(r))

  return { assets: created.length, income: incomeRows(ids).length, expenses: expenseRows(ids).length }
}

// Takes out exactly what was put in. Deleting the sample assets cascades to
// their entries, but entries are swept explicitly too — a user who moved a
// sample expense onto their own asset should not have it silently kept.
export async function removeSampleData({ properties = [], expenses = [], income = [], deleteProperty, deleteExpense, deleteIncome }) {
  let removed = 0
  for (const e of expenses.filter(isSampleRow)) { await deleteExpense(e.id); removed++ }
  for (const i of income.filter(isSampleRow)) { await deleteIncome(i.id); removed++ }
  for (const p of properties.filter(isSampleRow)) { await deleteProperty(p.id); removed++ }
  return removed
}
