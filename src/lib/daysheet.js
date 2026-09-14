// A day on a site, as one sheet.
//
// The muster roll and the plant log are the two ledgers somebody fills in every
// working day, and they are filled in at the site, on a phone, by a supervisor
// with one hand free. Until now each line was its own form submission: pick the
// site, pick the trade, type a headcount, type a rate, save, and again for the
// next trade, and again for each machine. Five trades and three machines is
// eight round trips through a form for a thing that takes one look at a
// gate register.
//
// So this builds the whole day at once: every trade the site actually uses and
// every machine parked on it, with what is already recorded filled in and the
// rest defaulted from what was booked last time. One save writes the lot.
//
// The rule that matters is idempotence. A supervisor on a site has a bad
// signal and taps Save twice; a day sheet that appends would double a whole
// day's wages. Every line carries the id of the row it came from, so a second
// save updates rather than adds — and a line set back to nothing removes the
// row rather than leaving a zero, because a muster with a line reading "0
// masons" is not what anybody writes on a muster.

import { TRADES, TRADE_IDS, makeMuster } from './labour'
import { makePlantLog } from './plant'

export const today = () => new Date().toISOString().slice(0, 10)

const live = (rows = []) => rows.filter((r) => !r.deleted_at)
const on = (rows, projectId, date) =>
  live(rows).filter((r) => r.project_id === projectId && r.date === date)

// What a trade was last paid on this site, falling back to what it was last
// paid anywhere in the company. `lib/defaults.js` makes the same argument for
// entry forms: a value the person actually used beats a blank box, and beats a
// number the app invented.
export function lastRate(muster = [], { projectId, trade, before = null } = {}) {
  const candidates = live(muster)
    .filter((m) => m.trade === trade && Number(m.rate) > 0)
    .filter((m) => !before || (m.date || '') < before)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  const here = candidates.find((m) => m.project_id === projectId)
  return Number((here || candidates[0])?.rate) || 0
}

// Which trades this site puts on a sheet. Every trade in the book is eleven
// rows of mostly zeroes; the ones this site has actually used are the sheet
// somebody recognises. A site with no history yet gets the two that every site
// starts with, rather than an empty screen.
export function tradesOn(muster = [], projectId) {
  const used = [...new Set(live(muster).filter((m) => m.project_id === projectId).map((m) => m.trade))]
    .filter((t) => TRADES[t])
  if (used.length) return used.sort((a, b) => TRADE_IDS.indexOf(a) - TRADE_IDS.indexOf(b))
  return ['mason', 'helper']
}

// The machines to show. Plant is assigned to a site, and one parked elsewhere
// has no business on this sheet — but a machine that was logged here anyway is
// on the sheet regardless, because the log is what happened and not what the
// register says should have.
export function plantOn(plant = [], logs = [], projectId, date) {
  const assigned = live(plant).filter((p) => p.project_id === projectId && p.status !== 'returned')
  const loggedHere = new Set(on(logs, projectId, date).map((l) => l.plant_id))
  const extra = live(plant).filter((p) => loggedHere.has(p.id) && !assigned.some((a) => a.id === p.id))
  return [...assigned, ...extra]
}

// The sheet itself: one line per trade and one per machine, each carrying the
// id of the row it came from so that saving twice cannot double a day.
export function daySheet({ projectId, date = today(), muster = [], plant = [], plantLogs = [], trades = null } = {}) {
  const mine = on(muster, projectId, date)
  const list = trades || tradesOn(muster, projectId)
  // A trade recorded today but not in the default list still appears, or
  // opening the sheet would hide work already booked.
  const shown = [...new Set([...list, ...mine.map((m) => m.trade)])].filter((t) => TRADES[t])

  const labour = shown
    .sort((a, b) => TRADE_IDS.indexOf(a) - TRADE_IDS.indexOf(b))
    .map((trade) => {
      const row = mine.find((m) => m.trade === trade) || null
      return {
        trade,
        label: TRADES[trade].label,
        id: row?.id || null,
        headcount: row ? Number(row.headcount) || 0 : 0,
        // An existing line keeps its rate even if it is lower than the last one
        // used: it is what was agreed that day.
        rate: row ? Number(row.rate) || 0 : lastRate(muster, { projectId, trade, before: date }),
        overtimeHours: row ? Number(row.overtime_hours) || 0 : 0,
        overtimeRate: row ? Number(row.overtime_rate) || 0 : 0,
        contractor: row?.contractor || '',
        recorded: Boolean(row),
      }
    })

  const machines = plantOn(plant, plantLogs, projectId, date).map((p) => {
    const row = on(plantLogs, projectId, date).find((l) => l.plant_id === p.id) || null
    return {
      plantId: p.id,
      label: p.name,
      registration: p.registration || '',
      id: row?.id || null,
      workingHours: row ? Number(row.working_hours) || 0 : 0,
      idleHours: row ? Number(row.idle_hours) || 0 : 0,
      breakdownHours: row ? Number(row.breakdown_hours) || 0 : 0,
      operator: row?.operator || '',
      note: row?.note || '',
      recorded: Boolean(row),
    }
  })

  return {
    projectId,
    date,
    labour,
    machines,
    // What a fresh sheet shows as already done, which is what tells somebody
    // they are editing today rather than starting it.
    started: labour.some((l) => l.recorded) || machines.some((m) => m.recorded),
    heads: labour.reduce((t, l) => t + (Number(l.headcount) || 0), 0),
    wages: labour.reduce(
      (t, l) => t + (Number(l.headcount) || 0) * (Number(l.rate) || 0)
        + (Number(l.overtimeHours) || 0) * (Number(l.overtimeRate) || 0), 0),
    hours: machines.reduce((t, m) => t + (Number(m.workingHours) || 0), 0),
  }
}

// What saving the sheet does, decided here rather than in the screen: three
// lists the caller applies in order. A line with nothing on it is not a line —
// it is either removed or never written — which is what keeps a sheet opened
// and closed again from filling the ledger with zeroes.
export function planSave(sheet, { entityId, actor = null } = {}) {
  const add = []
  const update = []
  const remove = []

  for (const line of sheet.labour) {
    const heads = Math.max(0, Math.round(Number(line.headcount) || 0))
    if (heads <= 0) {
      if (line.id) remove.push({ kind: 'muster', id: line.id })
      continue
    }
    const patch = {
      headcount: heads,
      rate: Math.max(0, Number(line.rate) || 0),
      overtime_hours: Math.max(0, Number(line.overtimeHours) || 0),
      overtime_rate: Math.max(0, Number(line.overtimeRate) || 0),
      contractor: String(line.contractor || '').trim().slice(0, 120),
    }
    if (line.id) update.push({ kind: 'muster', id: line.id, patch })
    else {
      add.push({
        kind: 'muster',
        row: makeMuster({
          entityId, projectId: sheet.projectId, date: sheet.date, trade: line.trade,
          headcount: heads, rate: patch.rate,
          overtimeHours: patch.overtime_hours, overtimeRate: patch.overtime_rate,
          contractor: patch.contractor, createdBy: actor?.id || null,
        }),
      })
    }
  }

  for (const m of sheet.machines) {
    const working = Math.max(0, Number(m.workingHours) || 0)
    const idle = Math.max(0, Number(m.idleHours) || 0)
    const broken = Math.max(0, Number(m.breakdownHours) || 0)
    // No hours at all is no sheet, which is a state the plant report already
    // reports on: days billed with nothing written down.
    if (working + idle + broken <= 0) {
      if (m.id) remove.push({ kind: 'plantLogs', id: m.id })
      continue
    }
    const patch = {
      working_hours: working,
      idle_hours: idle,
      breakdown_hours: broken,
      operator: String(m.operator || '').trim().slice(0, 120),
      note: String(m.note || '').trim().slice(0, 200),
    }
    if (m.id) update.push({ kind: 'plantLogs', id: m.id, patch })
    else {
      add.push({
        kind: 'plantLogs',
        row: makePlantLog({
          entityId, plantId: m.plantId, projectId: sheet.projectId, date: sheet.date,
          workingHours: working, idleHours: idle, breakdownHours: broken,
          operator: patch.operator, note: patch.note, createdBy: actor?.id || null,
        }),
      })
    }
  }

  return { add, update, remove, touched: add.length + update.length + remove.length }
}
