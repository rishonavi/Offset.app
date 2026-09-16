// What each part of the company spent, against what it was given to spend.
//
// Departments have had a monthly budget since the corporate layer was written.
// Nothing ever compared it to anything: you could set a cost centre's budget,
// look at it on the Companies page, and no screen in the app would ever tell
// you that you were over it. And `department_id` sits on expenses and income as
// a column no form ever filled in — so even the spend to compare it against was
// not being collected.
//
// Two rules do most of the work here.
//
// A parent's total includes its children, because a divisional budget covers
// the teams inside the division — that is what makes a divisional report add
// up, and `departmentSubtree` in corporate.js already knows the shape.
//
// And the company total is the sum of what each department spent *itself*,
// never the sum of the rolled-up figures. Adding those would count every cost
// once for its own department and again for each ancestor, and a report whose
// parts exceed the whole is one nobody will trust twice.

import { departmentPath, departmentSubtree } from './corporate'

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const amountOf = (row) => Math.max(0, Number(row?.amount) || 0)
const live = (rows = []) => rows.filter((r) => !r?.deleted_at)
const inMonths = (row, months) => !months || months.includes(String(row?.date || '').slice(0, 7))

// Entries booked to nothing. Kept as a line of its own rather than dropped: a
// cost centre report that quietly omits half the spend is worse than no report,
// and this is the number that says how much of the answer is missing.
export const UNASSIGNED = '__none__'

// Spend and income per department for a set of months, rolled up to ancestors.
//
// `months` is a list of YYYY-MM. The budget is monthly, so a range of six
// months is compared against six times the monthly figure — a quarter's spend
// against one month's budget would flag every department in the company.
export function costCentreReport(
  departments = [], expenses = [], income = [],
  { entityId = null, months = null } = {},
) {
  const mine = live(departments).filter((d) => !entityId || d.entity_id === entityId)
  const scope = (rows) => live(rows)
    .filter((r) => !entityId || r.entity_id === entityId)
    .filter((r) => inMonths(r, months))

  const spentBy = new Map()
  const earnedBy = new Map()
  const countBy = new Map()
  const bump = (map, key, n) => map.set(key, round2((map.get(key) || 0) + n))

  for (const e of scope(expenses)) {
    const key = e.department_id || UNASSIGNED
    bump(spentBy, key, amountOf(e))
    countBy.set(key, (countBy.get(key) || 0) + 1)
  }
  for (const e of scope(income)) {
    const key = e.department_id || UNASSIGNED
    bump(earnedBy, key, amountOf(e))
    countBy.set(key, (countBy.get(key) || 0) + 1)
  }

  const periods = Math.max(1, months?.length || 1)

  const lines = mine.map((d) => {
    const under = departmentSubtree(mine, d.id)
    const own = round2(spentBy.get(d.id) || 0)
    const rolled = round2(under.reduce((t, id) => t + (spentBy.get(id) || 0), 0))
    const budget = round2((Number(d.budget_monthly) || 0) * periods)
    const path = departmentPath(mine, d.id)
    return {
      department: d,
      id: d.id,
      name: d.name,
      path: path.map((p) => p.name).join(' › '),
      depth: Math.max(0, path.length - 1),
      children: under.length - 1,
      own,
      // A division is over when everything beneath it adds up to more than it
      // was given, not when its own directly-booked costs do.
      spent: rolled,
      earned: round2(under.reduce((t, id) => t + (earnedBy.get(id) || 0), 0)),
      entries: under.reduce((t, id) => t + (countBy.get(id) || 0), 0),
      budget,
      // A department with no budget set is not a department that is within
      // budget. Null, so a screen can say "no budget" instead of "0% used".
      usedPercent: budget > 0 ? Math.round((rolled / budget) * 1000) / 10 : null,
      left: budget > 0 ? round2(budget - rolled) : null,
      over: budget > 0 && rolled > budget,
      overBy: budget > 0 && rolled > budget ? round2(rolled - budget) : 0,
    }
  })

  const unassignedSpent = round2(spentBy.get(UNASSIGNED) || 0)
  const unassignedEarned = round2(earnedBy.get(UNASSIGNED) || 0)

  // The whole, from the parts that are actually parts. Every department's own
  // spend plus what nobody booked — not the sum of the rolled figures, which
  // counts a cost once per ancestor.
  const spent = round2(lines.reduce((t, l) => t + l.own, 0) + unassignedSpent)
  const earned = round2(
    lines.reduce((t, l) => t + round2(earnedBy.get(l.id) || 0), 0) + unassignedEarned,
  )
  const budget = round2(lines.reduce((t, l) => t + l.budget, 0))

  return {
    lines: lines.sort((a, b) => b.spent - a.spent || a.name.localeCompare(b.name)),
    // Ordered for a screen that indents: parents before the teams inside them.
    tree: [...lines].sort((a, b) => a.path.localeCompare(b.path)),
    months: months || null,
    periods,
    spent,
    earned,
    budget,
    // How much of the spend nobody assigned. The figure that says whether the
    // rest of this report is worth reading.
    unassigned: unassignedSpent,
    unassignedEarned,
    unassignedEntries: countBy.get(UNASSIGNED) || 0,
    unassignedPercent: spent > 0 ? Math.round((unassignedSpent / spent) * 1000) / 10 : 0,
    overspent: lines.filter((l) => l.over).length,
    overBy: round2(lines.filter((l) => l.over).reduce((t, l) => t + l.overBy, 0)),
    budgeted: lines.filter((l) => l.budget > 0).length,
  }
}

// The departments a picker should offer, in the order a picker should offer
// them: a parent immediately above the teams inside it, each labelled with the
// path so two teams called "Site" in different divisions are told apart.
export function departmentOptions(departments = [], { entityId = null } = {}) {
  return live(departments)
    .filter((d) => !entityId || d.entity_id === entityId)
    .map((d) => {
      const path = departmentPath(departments, d.id)
      return {
        id: d.id,
        name: d.name,
        label: path.map((p) => p.name).join(' › '),
        depth: Math.max(0, path.length - 1),
        code: d.code || '',
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}
