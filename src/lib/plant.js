// Plant and equipment: what a machine actually costs per hour it works.
//
// Almost nobody knows that figure, and the reason is that the cost arrives in
// four places. The hire bill comes monthly. The diesel is on a fuel bill. The
// operator is on the muster roll. The repair lands three months later. Each one
// looks small on its own and the machine is never costed at all.
//
// Two numbers are kept apart here, the same way contract and estimate are kept
// apart on a job:
//
//   The **nominal rate** is what the machine is hired at — ₹12,000 a day, say.
//   The **cost per working hour** is what an hour of actual work costs once
//   idle time, breakdowns, fuel and the operator are in it. A machine on an
//   eight-hour day that works three of them costs roughly two and a half times
//   its nominal rate for every hour of work it does, and the hire bill will
//   never say so.
//
// Idle and breakdown are also separate, and deliberately. Idle means there was
// no work for it — the drawings were late, the slab was not ready, the lorry
// did not come. Breakdown means it could not work. Different people are
// answerable for those, and a single "not working" figure protects both.
//
// The last thing this catches is the quietest: a machine on daily hire bills
// every day it is on site whether or not anybody wrote a log sheet. Days on
// hire with nothing recorded against them are money leaving for nothing, and
// they are invisible in every system that starts from the hire bill.

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

const newId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)

const today = () => new Date().toISOString().slice(0, 10)
const DAY = 86400000

// The machines an Indian site actually has, with the basis each is normally
// hired on. The basis is a default for the form, not a rule: a JCB is usually
// daily and sometimes hourly, and refusing the second would be wrong.
export const PLANT_KINDS = {
  excavator: { id: 'excavator', label: 'Excavator / JCB', basis: 'daily' },
  tipper: { id: 'tipper', label: 'Tipper / dumper', basis: 'trip' },
  transitMixer: { id: 'transitMixer', label: 'Transit mixer', basis: 'trip' },
  concretePump: { id: 'concretePump', label: 'Concrete pump', basis: 'hourly' },
  mixer: { id: 'mixer', label: 'Concrete mixer', basis: 'monthly' },
  crane: { id: 'crane', label: 'Tower crane', basis: 'monthly' },
  hoist: { id: 'hoist', label: 'Material hoist', basis: 'monthly' },
  roller: { id: 'roller', label: 'Roller / compactor', basis: 'daily' },
  vibrator: { id: 'vibrator', label: 'Needle vibrator', basis: 'monthly' },
  barBender: { id: 'barBender', label: 'Bar bending machine', basis: 'monthly' },
  generator: { id: 'generator', label: 'Generator', basis: 'monthly' },
  pump: { id: 'pump', label: 'Dewatering pump', basis: 'monthly' },
  scaffolding: { id: 'scaffolding', label: 'Scaffolding / formwork', basis: 'monthly' },
  other: { id: 'other', label: 'Other plant', basis: 'daily' },
}
export const PLANT_KIND_IDS = Object.keys(PLANT_KINDS)
export const kindOf = (id) => PLANT_KINDS[id] || PLANT_KINDS.other

// Hired or owned. The distinction changes where the money comes from and
// nothing else about the arithmetic: an owned machine's daily cost is its
// depreciation, and it is charged to the job exactly like a hire rate.
export const OWNERSHIP = {
  hired: { id: 'hired', label: 'Hired' },
  owned: { id: 'owned', label: 'Owned' },
}
export const OWNERSHIP_IDS = Object.keys(OWNERSHIP)

export const HIRE_BASIS = {
  hourly: { id: 'hourly', label: 'Per hour', perHour: true },
  daily: { id: 'daily', label: 'Per day', perHour: false },
  monthly: { id: 'monthly', label: 'Per month', perHour: false },
  trip: { id: 'trip', label: 'Per trip', perHour: false },
}
export const HIRE_BASIS_IDS = Object.keys(HIRE_BASIS)

export function makePlant({
  id, entityId, projectId = null, name = '', kind = 'excavator', ownership = 'hired',
  registration = '', vendor = '',
  hireRate = 0, hireBasis = null, minimumHours = 0, hiredFrom = '', hiredTo = '',
  fuelIncluded = false, operatorIncluded = false,
  purchaseValue = 0, purchasedOn = '', usefulLifeYears = 8, salvageValue = 0,
  status = 'active', note = '', createdBy = null,
} = {}) {
  const k = PLANT_KINDS[kind] ? kind : 'other'
  return {
    id: id || newId(),
    entity_id: entityId,
    project_id: projectId || null,
    name: (name || PLANT_KINDS[k].label).trim().slice(0, 120),
    kind: k,
    ownership: OWNERSHIP[ownership] ? ownership : 'hired',
    // The number plate or the machine number. What a log sheet is headed with,
    // and the only way two identical JCBs are told apart.
    registration: String(registration).trim().toUpperCase().slice(0, 24),
    vendor: String(vendor).trim().slice(0, 120),
    hire_rate: Math.max(0, round2(hireRate)),
    hire_basis: HIRE_BASIS[hireBasis] ? hireBasis : PLANT_KINDS[k].basis,
    // "Eight hours minimum" is in most hourly contracts. A machine that worked
    // three hours bills eight, and the five hours of nothing are invisible
    // unless somebody works them out.
    minimum_hours: Math.max(0, round2(minimumHours)),
    hired_from: hiredFrom || null,
    hired_to: hiredTo || null,
    fuel_included: Boolean(fuelIncluded),
    operator_included: Boolean(operatorIncluded),
    purchase_value: Math.max(0, round2(purchaseValue)),
    purchased_on: purchasedOn || null,
    useful_life_years: Math.max(1, Number(usefulLifeYears) || 8),
    salvage_value: Math.max(0, round2(salvageValue)),
    status: ['active', 'idle', 'breakdown', 'returned'].includes(status) ? status : 'active',
    note: String(note).trim().slice(0, 200),
    created_by: createdBy,
    created_at: new Date().toISOString(),
  }
}

// The log sheet. One machine, one day: what it did, what it burned, and which
// job it did it for.
export function makePlantLog({
  id, plantId, entityId, projectId = null, date,
  workingHours = 0, idleHours = 0, breakdownHours = 0, trips = 0,
  fuelLitres = 0, fuelCost = 0, operator = '', note = '', createdBy = null,
} = {}) {
  return {
    id: id || newId(),
    plant_id: plantId,
    entity_id: entityId,
    project_id: projectId || null,
    date: date || today(),
    working_hours: Math.max(0, round2(workingHours)),
    // No work for it: the drawings were late, the slab was not ready.
    idle_hours: Math.max(0, round2(idleHours)),
    // It could not work. A different failure, and a different person's.
    breakdown_hours: Math.max(0, round2(breakdownHours)),
    trips: Math.max(0, Math.round(Number(trips) || 0)),
    fuel_litres: Math.max(0, round2(fuelLitres)),
    fuel_cost: Math.max(0, round2(fuelCost)),
    operator: String(operator).trim().slice(0, 120),
    note: String(note).trim().slice(0, 200),
    created_by: createdBy,
    created_at: new Date().toISOString(),
  }
}

// Straight line, because the alternative is an accountant's schedule nobody on
// a site will maintain and a number nobody will trust.
export function dailyOwnershipCost(plant) {
  if (plant?.ownership !== 'owned') return 0
  const value = Number(plant.purchase_value) || 0
  const salvage = Math.min(Number(plant.salvage_value) || 0, value)
  const years = Math.max(1, Number(plant.useful_life_years) || 8)
  return round2((value - salvage) / (years * 365))
}

const clampDays = (fromISO, toISO, windowFrom, windowTo) => {
  const start = [fromISO, windowFrom].filter(Boolean).sort().pop()
  const ends = [toISO, windowTo].filter(Boolean).sort()
  const end = ends.length ? ends[0] : null
  if (!start || !end) return null
  const a = Date.parse(`${start}T00:00:00Z`)
  const b = Date.parse(`${end}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return 0
  return Math.floor((b - a) / DAY) + 1
}

// What one machine did and cost over a window.
export function plantPeriod(plant, logs = [], { from = null, to = null } = {}) {
  const rows = logs
    .filter((l) => l.plant_id === plant.id && !l.deleted_at)
    .filter((l) => (!from || (l.date || '') >= from) && (!to || (l.date || '') <= to))
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))

  let working = 0
  let idle = 0
  let breakdown = 0
  let trips = 0
  let fuel = 0
  let litres = 0
  let billableHours = 0

  const basis = HIRE_BASIS[plant.hire_basis] ? plant.hire_basis : 'daily'
  const minimum = Number(plant.minimum_hours) || 0

  for (const l of rows) {
    working += Number(l.working_hours) || 0
    idle += Number(l.idle_hours) || 0
    breakdown += Number(l.breakdown_hours) || 0
    trips += Number(l.trips) || 0
    fuel += Number(l.fuel_cost) || 0
    litres += Number(l.fuel_litres) || 0
    // A machine on site bills for the hours it stood there as well as the ones
    // it worked; a broken one generally does not, because a machine that
    // cannot work is not hired. The daily minimum applies to each day on its
    // own, which is the whole point of a minimum.
    const chargeable = (Number(l.working_hours) || 0) + (Number(l.idle_hours) || 0)
    billableHours += Math.max(chargeable, minimum)
  }

  const days = clampDays(plant.hired_from, plant.hired_to, from, to)
  // A machine with no hire dates is costed from the days somebody logged. It
  // is the honest fallback: without dates there is nothing else to go on, and
  // it means unlogged days simply cannot be found for that machine.
  const daysOnHire = plant.ownership === 'hired'
    ? (days === null ? rows.length : days)
    : (days === null ? rows.length : days)

  const rate = Number(plant.hire_rate) || 0
  let hire = 0
  if (plant.ownership === 'hired') {
    if (basis === 'hourly') hire = billableHours * rate
    else if (basis === 'daily') hire = daysOnHire * rate
    else if (basis === 'trip') hire = trips * rate
    else hire = (daysOnHire / 30) * rate
  }

  // An owned machine still costs something every day it exists, and charging a
  // job nothing for it is how owned plant looks free and hire looks expensive.
  const depreciation = plant.ownership === 'owned' ? round2(dailyOwnershipCost(plant) * daysOnHire) : 0

  // Diesel is only a cost on top of the hire when the hire does not include it.
  // Most tower-crane and transit-mixer contracts are quoted with fuel and an
  // operator in the rate; a site that logs what went into the tank anyway —
  // which is the right thing to do, because consumption is how you notice a
  // leak or a siphon — was having it charged twice, once inside the rate and
  // once again here. The litres and the cost are still reported either way;
  // they simply stop being added to the machine's total.
  const fuelIsExtra = !(plant.ownership === 'hired' && plant.fuel_included)
  const total = round2(hire + (fuelIsExtra ? fuel : 0) + depreciation)
  const availableHours = round2(working + idle + breakdown)
  const unlogged = Math.max(0, daysOnHire - rows.length)

  return {
    plant,
    logs: rows.length,
    workingHours: round2(working),
    idleHours: round2(idle),
    breakdownHours: round2(breakdown),
    availableHours,
    trips,
    fuelCost: round2(fuel),
    fuelLitres: round2(litres),
    // Whether the figure above is part of what this machine cost, or is simply
    // what it drank on somebody else's bill.
    fuelCharged: fuelIsExtra,
    hireCost: round2(hire),
    depreciation,
    total,
    daysOnHire,
    billableHours: round2(billableHours),
    // Hours paid for and not worked. On an hourly contract with a minimum this
    // is where the money goes, and no hire bill breaks it out.
    paidNotWorked: basis === 'hourly' ? round2(Math.max(0, billableHours - working)) : null,
    // The share of the time it was there that it was actually working.
    utilisation: availableHours > 0 ? Math.round((working / availableHours) * 1000) / 10 : null,
    // The figure the whole module is for. A machine at 40% utilisation costs
    // two and a half times its nominal rate for every hour of work it does.
    costPerWorkingHour: working > 0 ? round2(total / working) : null,
    // What standing still cost. Idle and breakdown share the bill in proportion
    // to the time they took, which is rough and is the only division available.
    idleCost: availableHours > 0 ? round2(total * (idle / availableHours)) : 0,
    breakdownCost: availableHours > 0 ? round2(total * (breakdown / availableHours)) : 0,
    // Days on hire with no log sheet. The quietest cost there is: the machine
    // billed and nobody wrote down whether it turned a wheel.
    unloggedDays: unlogged,
    unloggedCost: plant.ownership === 'hired' && basis === 'daily' ? round2(unlogged * rate) : 0,
    lastLogged: rows.length ? rows[rows.length - 1].date : null,
  }
}

// Every machine at once, the worst-used first — which is what the report is
// opened to find.
export function plantReport(plants = [], logs = [], { entityId = null, projectId = undefined, from = null, to = null } = {}) {
  const mine = plants
    .filter((p) => !p.deleted_at)
    .filter((p) => !entityId || p.entity_id === entityId)

  const scoped = projectId === undefined
    ? logs
    : logs.filter((l) => (projectId === null ? !l.project_id : l.project_id === projectId))

  const lines = mine
    .map((p) => plantPeriod(p, scoped, { from, to }))
    // With a site asked for, machines that never worked on it are not the
    // answer to anything.
    .filter((l) => projectId === undefined || l.logs > 0)

  const sum = (pick) => round2(lines.reduce((t, l) => t + (pick(l) || 0), 0))
  const working = sum((l) => l.workingHours)
  const available = sum((l) => l.availableHours)
  const total = sum((l) => l.total)

  return {
    lines: lines.sort((a, b) => {
      // Never-used machines first, then the least used. A machine with no logs
      // at all has no utilisation to sort on and is the most urgent case there
      // is, so it cannot be left at the bottom by a null.
      if ((a.utilisation === null) !== (b.utilisation === null)) return a.utilisation === null ? -1 : 1
      return (a.utilisation ?? 0) - (b.utilisation ?? 0)
    }),
    count: lines.length,
    hireCost: sum((l) => l.hireCost),
    fuelCost: sum((l) => l.fuelCost),
    depreciation: sum((l) => l.depreciation),
    total,
    workingHours: working,
    idleHours: sum((l) => l.idleHours),
    breakdownHours: sum((l) => l.breakdownHours),
    availableHours: available,
    utilisation: available > 0 ? Math.round((working / available) * 1000) / 10 : null,
    costPerWorkingHour: working > 0 ? round2(total / working) : null,
    idleCost: sum((l) => l.idleCost),
    breakdownCost: sum((l) => l.breakdownCost),
    unloggedDays: lines.reduce((t, l) => t + l.unloggedDays, 0),
    unloggedCost: sum((l) => l.unloggedCost),
    idleMachines: lines.filter((l) => l.utilisation !== null && l.utilisation < 50).length,
    neverLogged: lines.filter((l) => l.logs === 0).length,
  }
}

// What each site's plant cost, for the project report to add alongside its
// bills, its material, its labour and its subcontractors.
//
// Charged by where the machine worked, not where it is parked: a log sheet
// carries the site, and a machine that moved between two jobs in a month
// belongs to both.
export function plantCostsBySite(plants = [], logs = [], { entityId = null, from = null, to = null } = {}) {
  const mine = plants.filter((p) => !p.deleted_at && (!entityId || p.entity_id === entityId))
  const out = {}

  for (const plant of mine) {
    const whole = plantPeriod(plant, logs, { from, to })
    if (whole.availableHours <= 0 || whole.total <= 0) continue
    // Split by the hours each site had it. Apportioning by hours is rough and
    // is the only division the log sheets support.
    const bySite = new Map()
    for (const l of logs) {
      if (l.plant_id !== plant.id || l.deleted_at) continue
      if (from && (l.date || '') < from) continue
      if (to && (l.date || '') > to) continue
      const hours = (Number(l.working_hours) || 0) + (Number(l.idle_hours) || 0) + (Number(l.breakdown_hours) || 0)
      if (!l.project_id || hours <= 0) continue
      bySite.set(l.project_id, (bySite.get(l.project_id) || 0) + hours)
    }
    for (const [siteId, hours] of bySite) {
      out[siteId] = round2((out[siteId] || 0) + whole.total * (hours / whole.availableHours))
    }
  }
  return out
}

// Is owning this machine cheaper than hiring one like it?
//
// Answered per working hour rather than per day, because a machine that sits
// idle half the time is not cheap at any daily rate, and comparing daily rates
// is exactly how a company ends up owning plant it cannot keep busy.
export function hireVsOwn(period, marketDayRate) {
  const market = Number(marketDayRate) || 0
  if (!market || !period || period.workingHours <= 0) {
    return { known: false, why: 'A market day rate and some logged hours are needed to compare.' }
  }
  // Eight hours is the shift a day rate is quoted against.
  const marketPerHour = round2(market / 8)
  const ours = period.costPerWorkingHour
  const diff = round2(ours - marketPerHour)
  return {
    known: true,
    ours,
    market: marketPerHour,
    difference: diff,
    cheaperToHire: diff > 0.001,
    percent: marketPerHour > 0 ? Math.round((diff / marketPerHour) * 1000) / 10 : 0,
    why: diff > 0
      ? `An hour of work off this machine costs ${Math.abs(diff)} more than hiring one.`
      : `An hour of work off this machine costs ${Math.abs(diff)} less than hiring one.`,
  }
}
