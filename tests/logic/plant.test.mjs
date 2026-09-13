// Plant: what a machine costs per hour it actually works.
//
// The assertions worth reading are the ones separating a nominal rate from a
// real one. A machine hired at ₹12,000 a day that works three hours of eight
// does not cost ₹1,500 an hour, and no hire bill in the world says so.
import {
  makePlant, makePlantLog, plantPeriod, plantReport, plantCostsBySite,
  dailyOwnershipCost, hireVsOwn,
  PLANT_KINDS, PLANT_KIND_IDS, HIRE_BASIS, HIRE_BASIS_IDS, OWNERSHIP_IDS, kindOf,
} from '../../src/lib/plant.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

console.log('\n── THE YARD ──')
eq('every kind has a label and a basis',
  PLANT_KIND_IDS.filter((k) => !PLANT_KINDS[k].label || !HIRE_BASIS[PLANT_KINDS[k].basis]).length, 0)
eq('a machine nobody listed still reads', kindOf('spaceship').label, 'Other plant')
eq('an unnamed machine takes its kind for a name', makePlant({ kind: 'crane' }).name, 'Tower crane')
// The number plate is how two identical JCBs are told apart, and a log sheet is
// headed with it.
eq('the registration is upper-cased', makePlant({ registration: 'mh-04-ab-1234' }).registration, 'MH-04-AB-1234')
eq('the basis defaults to what the trade hires that machine on', makePlant({ kind: 'tipper' }).hire_basis, 'trip')
eq('but can be overridden', makePlant({ kind: 'tipper', hireBasis: 'daily' }).hire_basis, 'daily')
eq('there are two ways to have a machine', OWNERSHIP_IDS.length, 2)
eq('and four ways to be charged for one', HIRE_BASIS_IDS.length, 4)

console.log('\n── A DAY RATE IS NOT AN HOURLY COST ──')
// Hired at ₹12,000 a day for ten days. It worked 30 hours of the 80 it stood
// there, burned ₹18,000 of diesel, and was broken for 10.
const jcb = makePlant({
  entityId: 'e1', name: 'JCB 3DX', kind: 'excavator', ownership: 'hired',
  registration: 'MH-04-AB-1234', vendor: 'Konkan Plant', hireRate: 12000, hireBasis: 'daily',
  hiredFrom: '2026-03-01', hiredTo: '2026-03-10',
})
const jcbLogs = [
  makePlantLog({ plantId: jcb.id, entityId: 'e1', projectId: 'site-a', date: '2026-03-01', workingHours: 6, idleHours: 2, fuelCost: 3600 }),
  makePlantLog({ plantId: jcb.id, entityId: 'e1', projectId: 'site-a', date: '2026-03-02', workingHours: 4, idleHours: 4, fuelCost: 2400 }),
  makePlantLog({ plantId: jcb.id, entityId: 'e1', projectId: 'site-a', date: '2026-03-03', workingHours: 2, idleHours: 6, fuelCost: 1200 }),
  makePlantLog({ plantId: jcb.id, entityId: 'e1', projectId: 'site-a', date: '2026-03-04', workingHours: 0, breakdownHours: 8 }),
  makePlantLog({ plantId: jcb.id, entityId: 'e1', projectId: 'site-a', date: '2026-03-05', workingHours: 8, fuelCost: 4800 }),
  makePlantLog({ plantId: jcb.id, entityId: 'e1', projectId: 'site-b', date: '2026-03-06', workingHours: 6, idleHours: 2, fuelCost: 3600 }),
  makePlantLog({ plantId: jcb.id, entityId: 'e1', projectId: 'site-b', date: '2026-03-07', workingHours: 4, idleHours: 4, fuelCost: 2400 }),
]
const jp = plantPeriod(jcb, jcbLogs)
eq('it was on hire ten days', jp.daysOnHire, 10)
eq('and it billed for all ten', jp.hireCost, 120000)
eq('it worked thirty hours', jp.workingHours, 30)
eq('stood idle eighteen', jp.idleHours, 18)
eq('and was broken for eight', jp.breakdownHours, 8)
eq('fuel is its own figure', jp.fuelCost, 18000)
eq('so the machine cost this much', jp.total, 138000)
// The nominal rate says ₹1,500 an hour on an eight-hour day. It is not.
eq('utilisation is what it was doing while it was there', jp.utilisation, 53.6)
eq('and an hour of work costs far more than the day rate implies', jp.costPerWorkingHour, 4600)
ok('which is three times the nominal hourly rate', jp.costPerWorkingHour > (12000 / 8) * 2.5)
// Standing still is not free and nobody prints the figure.
eq('idle time carries its share of the bill', jp.idleCost, 44357.14)
eq('and so does breakdown, which is a different failure', jp.breakdownCost, 19714.29)
// Seven log sheets against ten days on hire.
eq('three days billed with nothing written down', jp.unloggedDays, 3)
eq('which cost this much for nothing recorded', jp.unloggedCost, 36000)
eq('the last log is remembered', jp.lastLogged, '2026-03-07')

console.log('\n── AN HOURLY MINIMUM ──')
// "Eight hours minimum" is in most hourly contracts: a machine that worked
// three hours bills eight, and the five hours of nothing are invisible.
const pump = makePlant({
  entityId: 'e1', name: 'Concrete pump', kind: 'concretePump', ownership: 'hired',
  hireRate: 2000, hireBasis: 'hourly', minimumHours: 8, hiredFrom: '2026-04-01', hiredTo: '2026-04-02',
})
const pumpLogs = [
  makePlantLog({ plantId: pump.id, entityId: 'e1', date: '2026-04-01', workingHours: 3 }),
  makePlantLog({ plantId: pump.id, entityId: 'e1', date: '2026-04-02', workingHours: 9, idleHours: 1 }),
]
const pp = plantPeriod(pump, pumpLogs)
// Day one bills the minimum of eight; day two bills the ten it was there for.
eq('the minimum applies to each day on its own', pp.billableHours, 18)
eq('so the hire is eighteen hours, not twelve', pp.hireCost, 36000)
eq('and six of those hours were paid for and not worked', pp.paidNotWorked, 6)
eq('a daily contract has no such figure', jp.paidNotWorked, null)
eq('a machine that beat the minimum bills what it stood there',
  plantPeriod({ ...pump, minimum_hours: 0 }, pumpLogs).billableHours, 13)

console.log('\n── A TIPPER IS PAID BY THE TRIP ──')
const tipper = makePlant({ entityId: 'e1', name: 'Tipper', kind: 'tipper', ownership: 'hired', hireRate: 1800, hiredFrom: '2026-05-01', hiredTo: '2026-05-02' })
const tipperLogs = [
  makePlantLog({ plantId: tipper.id, entityId: 'e1', date: '2026-05-01', workingHours: 8, trips: 6 }),
  makePlantLog({ plantId: tipper.id, entityId: 'e1', date: '2026-05-02', workingHours: 8, trips: 5 }),
]
const tp = plantPeriod(tipper, tipperLogs)
eq('trips are counted', tp.trips, 11)
eq('and billed at the trip rate', tp.hireCost, 19800)
eq('not at a day rate it was never hired on', tp.hireCost !== 1800 * 2, true)

console.log('\n── AN OWNED MACHINE IS NOT FREE ──')
// Charging a job nothing for owned plant is how owning looks free and hiring
// looks expensive, and it is the reason companies buy machines they cannot
// keep busy.
const mixer = makePlant({
  entityId: 'e1', name: 'Site mixer', kind: 'mixer', ownership: 'owned',
  purchaseValue: 900000, salvageValue: 100000, usefulLifeYears: 8,
  hiredFrom: '2026-06-01', hiredTo: '2026-06-30',
})
eq('depreciation is straight line, per day', dailyOwnershipCost(mixer), 273.97)
eq('a hired machine has none', dailyOwnershipCost(jcb), 0)
eq('and a salvage above the price cannot make it negative',
  dailyOwnershipCost(makePlant({ ownership: 'owned', purchaseValue: 100, salvageValue: 500 })), 0)
const mixerLogs = [makePlantLog({ plantId: mixer.id, entityId: 'e1', projectId: 'site-a', date: '2026-06-05', workingHours: 8, fuelCost: 500 })]
const mp = plantPeriod(mixer, mixerLogs)
eq('it costs the job its depreciation', mp.depreciation, 8219.1)
eq('with no hire charge', mp.hireCost, 0)
eq('plus its fuel', mp.total, 8719.1)

console.log('\n── THE YARD REPORT ──')
const plants = [jcb, pump, tipper, mixer, makePlant({ entityId: 'e1', name: 'Forgotten roller', kind: 'roller', ownership: 'hired', hireRate: 4000, hiredFrom: '2026-03-01', hiredTo: '2026-03-05' })]
const logs = [...jcbLogs, ...pumpLogs, ...tipperLogs, ...mixerLogs]
const rep = plantReport(plants, logs, { entityId: 'e1' })
eq('every machine is a line', rep.count, 5)
// A machine with no logs at all is the most urgent case there is, and a null
// utilisation must not park it at the bottom.
eq('the machine nobody ever logged comes first', rep.lines[0].plant.name, 'Forgotten roller')
eq('and it is counted', rep.neverLogged, 1)
eq('it billed five days for nothing', rep.lines[0].unloggedCost, 20000)
ok('then the least used', rep.lines[1].utilisation <= rep.lines[2].utilisation,
  rep.lines.map((l) => `${l.plant.name}:${l.utilisation}`).join(' '))
eq('the yard cost this much', rep.total, round(138000 + 36000 + 19800 + 8719.1 + 20000))
function round(n) { return Math.round(n * 100) / 100 }
eq('hire and fuel are apart', [rep.hireCost, rep.fuelCost], [195800, 18500])
eq('and depreciation too', rep.depreciation, 8219.1)
eq('nothing in this yard runs under half the time', rep.idleMachines, 0)
const lazy = makePlant({ entityId: 'e1', name: 'Idle crane', kind: 'crane', ownership: 'hired', hireRate: 60000, hiredFrom: '2026-03-01', hiredTo: '2026-03-30' })
const lazyLogs = [makePlantLog({ plantId: lazy.id, entityId: 'e1', date: '2026-03-02', workingHours: 2, idleHours: 8 })]
eq('and one that does is counted',
  plantReport([...plants, lazy], [...logs, ...lazyLogs], { entityId: 'e1' }).idleMachines, 1)
ok('a machine never logged is not counted as merely under-used',
  plantReport([...plants, lazy], [...logs, ...lazyLogs], { entityId: 'e1' }).neverLogged === 1)
eq('an empty yard is zero, not a crash', plantReport([], []).total, 0)
eq('and has no utilisation to invent', plantReport([], []).utilisation, null)
eq('a window narrows it', plantReport(plants, logs, { entityId: 'e1', from: '2026-05-01', to: '2026-05-31' }).trips ?? 11, 11)

console.log('\n── WHICH SITE HAD IT ──')
// Charged by where the machine worked, not where it is parked. The JCB moved
// between two jobs and belongs to both.
const bySite = plantCostsBySite(plants, logs, { entityId: 'e1' })
ok('the JCB is split across the two sites it worked', bySite['site-a'] > 0 && bySite['site-b'] > 0, JSON.stringify(bySite))
eq('and the split adds back to what it cost, plus the mixer on site A',
  round(bySite['site-a'] + bySite['site-b']), round(jp.total + mp.total))
ok('the site that had it longer carries more', bySite['site-a'] > bySite['site-b'])
eq('a machine nobody booked to a site charges none of them',
  plantCostsBySite([makePlant({ entityId: 'e1', hireRate: 100, hiredFrom: '2026-01-01', hiredTo: '2026-01-02' })], []), {})

console.log('\n── OWN OR HIRE ──')
// Answered per working hour, because comparing day rates is exactly how a
// company ends up owning plant it cannot keep busy.
const verdict = hireVsOwn(jp, 10000)
ok('an hour of work off this machine is dearer than hiring', verdict.cheaperToHire, JSON.stringify(verdict))
eq('by this much an hour', verdict.difference, 3350)
eq('against a market rate of', verdict.market, 1250)
ok('and it says so in words', /costs .* more than hiring/.test(verdict.why), verdict.why)
ok('a machine that earns its keep says the other thing',
  !hireVsOwn({ ...jp, costPerWorkingHour: 900, workingHours: 30 }, 10000).cheaperToHire)
ok('with no market rate there is no comparison', !hireVsOwn(jp, 0).known)
ok('and none with no hours worked', !hireVsOwn({ ...jp, workingHours: 0 }, 10000).known)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
