// How much of the building exists, which is not how much of the money is gone.
//
// Every other number in this app is financial. This one is physical: cubic
// metres of concrete poured, square feet of plaster done, doors hung. It is
// kept apart for one reason, and the reason is the whole module —
//
//   **A site 40% built that has spent 60% of its budget is in trouble, and
//   nothing in a ledger will tell you so.**
//
// The ledger says ₹48 lakh spent against an ₹80 lakh estimate and looks
// healthy. The site says four floors of eight. Putting the two side by side is
// the earliest warning a builder gets, and it arrives months before the money
// runs out.
//
// Progress is measured **by value, not by count**. Half the line items being
// complete means nothing if the remaining half is the expensive half — and on
// a construction schedule it usually is, because finishes cost more than
// foundations and come last.

import { todayISO } from './today'

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

// The trades a schedule of quantities is grouped under, in the order the work
// happens. Ordering by sequence rather than alphabetically is what lets a
// progress list read like a building going up.
export const WORK_STAGES = {
  earthwork: { id: 'earthwork', label: 'Earthwork & foundation', sequence: 1 },
  structure: { id: 'structure', label: 'RCC & structure', sequence: 2 },
  masonry: { id: 'masonry', label: 'Masonry & blockwork', sequence: 3 },
  plaster: { id: 'plaster', label: 'Plaster & waterproofing', sequence: 4 },
  services: { id: 'services', label: 'Plumbing & electrical', sequence: 5 },
  finishes: { id: 'finishes', label: 'Flooring, tiling & paint', sequence: 6 },
  joinery: { id: 'joinery', label: 'Doors, windows & fittings', sequence: 7 },
  external: { id: 'external', label: 'External & site works', sequence: 8 },
}
export const WORK_STAGE_IDS = Object.keys(WORK_STAGES)
export const stageOf = (id) => WORK_STAGES[id] || { id: 'other', label: 'Other', sequence: 99 }

// One line of the schedule of quantities: what is to be built, how much of it,
// and at what rate.
export function makeWorkItem({
  id, entityId, projectId = null, code = '', description = '', stage = 'structure',
  unit = 'cum', plannedQty = 0, rate = 0, note = '', workOrderId = null,
} = {}) {
  return {
    id: id || newId(),
    entity_id: entityId,
    project_id: projectId || null,
    // Which subcontract is doing this item, where one is. It is what turns a
    // certified figure back into the tape measure it came from: without it,
    // what a contractor claims and what the engineer measured are two numbers
    // in two screens that nothing has ever compared. At most one — an item
    // split between two contractors is a second item.
    work_order_id: workOrderId || null,
    code: String(code).trim().toUpperCase().slice(0, 24),
    description: (description || 'Untitled item').trim().slice(0, 200),
    stage: WORK_STAGES[stage] ? stage : 'structure',
    unit: String(unit).trim().slice(0, 16) || 'cum',
    planned_qty: Math.max(0, round2(plannedQty)),
    rate: Math.max(0, round2(rate)),
    note: String(note).trim().slice(0, 200),
    created_at: new Date().toISOString(),
  }
}

// Work measured on a given day. Quantities, not percentages: a site engineer
// measures 42 cubic metres, and a percentage asked for directly is a guess
// dressed up as a measurement.
export function makeMeasurement({
  id, workItemId, entityId, projectId = null, date, qty = 0, note = '', recordedBy = null,
} = {}) {
  return {
    id: id || newId(),
    work_item_id: workItemId,
    entity_id: entityId,
    project_id: projectId || null,
    date: date || todayISO(),
    // May be negative: a re-measurement that found less is a correction, and
    // forcing it positive means the only way to fix an error is to delete it.
    qty: round2(qty),
    note: String(note).trim().slice(0, 200),
    recorded_by: recordedBy,
    created_at: new Date().toISOString(),
  }
}

export function itemProgress(item, measurements = []) {
  const mine = measurements.filter((m) => m.work_item_id === item.id && !m.deleted_at)
  const done = round2(mine.reduce((t, m) => t + (Number(m.qty) || 0), 0))
  const planned = Number(item.planned_qty) || 0
  const rate = Number(item.rate) || 0
  const lastOn = mine.reduce((d, m) => ((m.date || '') > d ? m.date : d), '')

  return {
    item,
    done: Math.max(0, done),
    planned,
    remaining: round2(Math.max(0, planned - done)),
    // The value of the work in the ground. This is the number that gets
    // compared against money spent, and it is the only honest one available:
    // quantity done times the rate it was priced at.
    earned: round2(Math.max(0, done) * rate),
    value: round2(planned * rate),
    percent: planned > 0 ? Math.round((Math.max(0, done) / planned) * 1000) / 10 : null,
    complete: planned > 0 && done >= planned - 0.001,
    started: done > 0.001,
    // More built than was ever scheduled. Either the quantity was wrong or the
    // work was, and both cost money nobody budgeted.
    over: planned > 0 && done > planned + 0.001,
    lastMeasured: lastOn || null,
    measurements: mine.length,
  }
}

// A whole site's schedule, in the order the building goes up.
export function siteProgress(items = [], measurements = [], { projectId = undefined } = {}) {
  const mine = items
    .filter((i) => !i.deleted_at)
    .filter((i) => projectId === undefined || i.project_id === projectId)

  const lines = mine
    .map((i) => itemProgress(i, measurements))
    .sort((a, b) =>
      stageOf(a.item.stage).sequence - stageOf(b.item.stage).sequence ||
      (a.item.code || '').localeCompare(b.item.code || ''))

  const sum = (pick) => round2(lines.reduce((t, l) => t + (pick(l) || 0), 0))
  const value = sum((l) => l.value)
  const earned = sum((l) => l.earned)

  // Weighted by value, not by how many lines are ticked. Half the items done
  // means nothing when the other half is the expensive half — and on a
  // construction schedule it usually is.
  const percent = value > 0 ? Math.round((Math.min(earned, value) / value) * 1000) / 10 : null

  const byStage = new Map()
  for (const l of lines) {
    const st = stageOf(l.item.stage)
    const cur = byStage.get(st.id) || { stage: st, value: 0, earned: 0, items: 0, complete: 0 }
    cur.value = round2(cur.value + l.value)
    cur.earned = round2(cur.earned + l.earned)
    cur.items += 1
    cur.complete += l.complete ? 1 : 0
    byStage.set(st.id, cur)
  }

  return {
    lines,
    count: lines.length,
    value,
    earned,
    percent,
    remainingValue: round2(Math.max(0, value - earned)),
    itemsComplete: lines.filter((l) => l.complete).length,
    itemsStarted: lines.filter((l) => l.started && !l.complete).length,
    itemsNotStarted: lines.filter((l) => !l.started).length,
    over: lines.filter((l) => l.over).length,
    // Nothing priced means nothing to weigh the lines against, so there is no
    // honest percentage to give. Saying so beats printing one.
    unpriced: lines.filter((l) => l.value === 0).length,
    stages: [...byStage.values()]
      .sort((a, b) => a.stage.sequence - b.stage.sequence)
      .map((s) => ({ ...s, percent: s.value > 0 ? Math.round((Math.min(s.earned, s.value) / s.value) * 1000) / 10 : null })),
    lastMeasured: lines.reduce((d, l) => ((l.lastMeasured || '') > d ? l.lastMeasured : d), '') || null,
  }
}

// The comparison the whole module exists for.
//
// Physical progress against financial progress. They are measured from
// different things — one from what has been built, the other from what has
// been spent — and the gap between them is the earliest warning a builder gets.
export function progressAgainstSpend({ earned = 0, value = 0, spent = 0, estimate = 0 } = {}) {
  const built = value > 0 ? Math.round((Math.min(earned, value) / value) * 1000) / 10 : null
  const burnt = estimate > 0 ? Math.round((spent / estimate) * 1000) / 10 : null
  if (built === null || burnt === null) {
    return {
      built, burnt, gap: null, behind: false, ahead: false, known: false,
      // Without both a priced schedule and an estimate there is no comparison
      // to make. An invented one would be worse than none.
      why: value <= 0 ? 'No priced schedule of work yet.' : 'No estimate to measure spend against.',
    }
  }
  const gap = Math.round((built - burnt) * 10) / 10
  return {
    built,
    burnt,
    gap,
    // Five points of slack, because measurement is not that precise and a site
    // that flags every week is a site nobody looks at.
    behind: gap < -5,
    ahead: gap > 5,
    known: true,
    why: gap < -5
      ? `${Math.abs(gap)}% more of the budget is gone than of the building.`
      : gap > 5
        ? `${gap}% more of the building is done than of the budget.`
        : 'Spending and building are keeping pace.',
    // What finishing at today's rate would cost. A projection, and labelled as
    // one: it assumes the rest costs what the part already built cost, which is
    // optimistic on any job where the finishes are still to come.
    forecast: built > 0 ? round2((spent / built) * 100) : null,
  }
}
