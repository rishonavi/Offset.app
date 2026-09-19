// A day on a site, entered once.
//
// The assertions that matter are about saving twice. A supervisor stands at a
// gate with one bar of signal and taps Save again because nothing happened —
// a sheet that appends would double a day's wages, and nobody would notice
// until the month closed. Everything else here is convenience; that one is the
// reason the module exists.
import { daySheet, planSave, lastRate, tradesOn, plantOn } from '../../src/lib/daysheet.js'
import { todayISO } from '../../src/lib/today.js'
import { makeMuster, musterCost } from '../../src/lib/labour.js'
import { makePlant, makePlantLog } from '../../src/lib/plant.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

const E = 'e1', MD = 'md', PG = 'pg'
const D = '2026-09-14', YESTERDAY = '2026-09-13', LAST_WEEK = '2026-09-07'

console.log('\n── AN EMPTY SITE STILL GETS A SHEET ──')
const blank = daySheet({ projectId: MD, date: D })
eq('two trades to start with, not eleven', blank.labour.map((l) => l.trade), ['mason', 'helper'])
ok('nothing is recorded yet', !blank.started)
eq('and nobody is on it', blank.heads, 0)
eq('no machines either', blank.machines.length, 0)
ok('the date defaults to today', daySheet({ projectId: MD }).date === todayISO())

console.log('\n── THE TRADES A SITE ACTUALLY USES ──')
const history = [
  makeMuster({ entityId: E, projectId: MD, date: LAST_WEEK, trade: 'mason', headcount: 12, rate: 850 }),
  makeMuster({ entityId: E, projectId: MD, date: LAST_WEEK, trade: 'carpenter', headcount: 6, rate: 900 }),
  makeMuster({ entityId: E, projectId: MD, date: YESTERDAY, trade: 'mason', headcount: 14, rate: 880 }),
  makeMuster({ entityId: E, projectId: PG, date: YESTERDAY, trade: 'tiler', headcount: 4, rate: 800 }),
]
eq('the sheet shows what this site books', tradesOn(history, MD), ['mason', 'carpenter'])
// The control: another site's trades are another site's business.
eq('and not what the site next door books', tradesOn(history, PG), ['tiler'])
eq('a site with no history falls back to the usual two', tradesOn(history, 'nowhere'), ['mason', 'helper'])

console.log('\n── AND WHAT THEY WERE PAID LAST TIME ──')
eq('the most recent rate at this site', lastRate(history, { projectId: MD, trade: 'mason' }), 880)
eq('not an older one', lastRate(history, { projectId: MD, trade: 'mason', before: YESTERDAY }), 850)
// A trade this site has never used borrows the company's last rate rather than
// leaving the box empty — a blank rate is how a day gets booked at zero.
eq('a trade new to this site takes the company rate', lastRate(history, { projectId: MD, trade: 'tiler' }), 800)
eq('and one nobody has ever booked has no rate to offer',
  lastRate(history, { projectId: MD, trade: 'welder' }), 0)
const filled = daySheet({ projectId: MD, date: D, muster: history })
eq('so the sheet opens with the rate filled in',
  filled.labour.find((l) => l.trade === 'mason').rate, 880)
ok('but with nobody on it, because that is today’s question', filled.heads === 0)
ok('and it knows the day has not been started', !filled.started)

console.log('\n── A DAY ALREADY RECORDED OPENS AS IT WAS LEFT ──')
const todayRows = [
  ...history,
  makeMuster({ entityId: E, id: 'm-today', projectId: MD, date: D, trade: 'mason', headcount: 15, rate: 900, overtimeHours: 3, overtimeRate: 170 }),
]
const reopened = daySheet({ projectId: MD, date: D, muster: todayRows })
const mason = reopened.labour.find((l) => l.trade === 'mason')
eq('the headcount is there', mason.headcount, 15)
eq('the rate is the one agreed that day, not the last one', mason.rate, 900)
eq('the overtime came back too', [mason.overtimeHours, mason.overtimeRate], [3, 170])
eq('and the line knows which row it is', mason.id, 'm-today')
ok('the sheet says the day is under way', reopened.started)
eq('the wages add up', reopened.wages, 15 * 900 + 3 * 170)
// The same arithmetic the labour report does, reached from the other side.
eq('and agree with what the muster itself costs',
  reopened.wages, musterCost(todayRows.find((m) => m.id === 'm-today')).total)

console.log('\n── A TRADE BOOKED TODAY IS ON THE SHEET EVEN IF IT IS NOT USUAL ──')
const oddRows = [...history, makeMuster({ entityId: E, projectId: MD, date: D, trade: 'plumber', headcount: 2, rate: 950 })]
ok('a plumber nobody expected is shown',
  daySheet({ projectId: MD, date: D, muster: oddRows }).labour.some((l) => l.trade === 'plumber'))
// Otherwise opening the sheet would hide work already booked, and saving would
// then delete it.
ok('and not dropped by a list that does not know about them',
  daySheet({ projectId: MD, date: D, muster: oddRows, trades: ['mason'] }).labour.some((l) => l.trade === 'plumber'))

console.log('\n── THE MACHINES ON THIS SITE ──')
const machines = [
  makePlant({ entityId: E, id: 'p-crane', projectId: MD, name: 'Tower crane', kind: 'crane' }),
  makePlant({ entityId: E, id: 'p-jcb', projectId: MD, name: 'JCB 3DX', kind: 'excavator' }),
  makePlant({ entityId: E, id: 'p-mixer', projectId: PG, name: 'Mixer', kind: 'mixer' }),
]
eq('only the ones parked here', plantOn(machines, [], MD, D).map((p) => p.id), ['p-crane', 'p-jcb'])
// A machine logged here is on the sheet whatever the register says, because
// the log is what happened.
const visiting = [makePlantLog({ entityId: E, plantId: 'p-mixer', projectId: MD, date: D, workingHours: 4 })]
eq('and any that were logged here anyway',
  plantOn(machines, visiting, MD, D).map((p) => p.id), ['p-crane', 'p-jcb', 'p-mixer'])

console.log('\n── SAVING IT ──')
const sheet = daySheet({ projectId: MD, date: D, muster: history, plant: machines })
sheet.labour.find((l) => l.trade === 'mason').headcount = 14
sheet.labour.find((l) => l.trade === 'carpenter').headcount = 5
sheet.machines.find((m) => m.plantId === 'p-crane').workingHours = 7.5
sheet.machines.find((m) => m.plantId === 'p-crane').idleHours = 0.5
const first = planSave(sheet, { entityId: E })
eq('three lines were filled in, so three rows are written', first.add.length, 3)
eq('nothing to update on a day that had none', first.update.length, 0)
eq('and nothing to remove', first.remove.length, 0)
eq('the muster rows carry the site and the date',
  first.add.filter((a) => a.kind === 'muster').map((a) => [a.row.project_id, a.row.date]),
  [[MD, D], [MD, D]])
eq('and the log carries the machine',
  first.add.find((a) => a.kind === 'plantLogs').row.plant_id, 'p-crane')
// A machine nobody touched is not a log sheet of zeroes: the plant report
// counts a day with no sheet, and writing zeroes would hide it.
ok('the untouched machine is not written at all',
  !first.add.some((a) => a.kind === 'plantLogs' && a.row.plant_id === 'p-jcb'))

console.log('\n── AND SAVING IT AGAIN, WHICH IS THE POINT ──')
// The rows the first save wrote, now in the ledger.
const saved = [...history, ...first.add.filter((a) => a.kind === 'muster').map((a) => a.row)]
const savedLogs = first.add.filter((a) => a.kind === 'plantLogs').map((a) => a.row)
const again = daySheet({ projectId: MD, date: D, muster: saved, plant: machines, plantLogs: savedLogs })
eq('the day reads back exactly as it was entered',
  [again.labour.find((l) => l.trade === 'mason').headcount,
   again.labour.find((l) => l.trade === 'carpenter').headcount], [14, 5])
eq('and the crane with it', again.machines.find((m) => m.plantId === 'p-crane').workingHours, 7.5)
const second = planSave(again, { entityId: E })
eq('a second save adds nothing', second.add.length, 0)
eq('it updates what is there', second.update.length, 3)
eq('and still removes nothing', second.remove.length, 0)
// The failure this module exists to prevent, stated as a number.
eq('so the day is still one line per trade',
  saved.filter((m) => m.date === D && m.project_id === MD).length, 2)

console.log('\n── A LINE SET BACK TO NOTHING GOES AWAY ──')
const emptied = daySheet({ projectId: MD, date: D, muster: saved, plant: machines, plantLogs: savedLogs })
emptied.labour.find((l) => l.trade === 'carpenter').headcount = 0
emptied.machines.find((m) => m.plantId === 'p-crane').workingHours = 0
emptied.machines.find((m) => m.plantId === 'p-crane').idleHours = 0
const third = planSave(emptied, { entityId: E })
eq('the carpenters and the crane are removed', third.remove.length, 2)
eq('the masons are kept', third.update.length, 1)
ok('and nothing new is written', third.add.length === 0)
// Zero is not a line anybody writes on a muster. Keeping it would put "0
// carpenters" in the day's report and a zero-hour sheet on a machine that was
// simply never touched.
eq('a line that was never there and is still empty does nothing at all',
  planSave(daySheet({ projectId: MD, date: D, plant: machines }), { entityId: E }).touched, 0)

console.log('\n── WHAT GOES IN IS CLEANED ON THE WAY ──')
const messy = daySheet({ projectId: MD, date: D, muster: history, plant: machines })
messy.labour[0].headcount = '  7  '
messy.labour[0].rate = -50
messy.labour[0].contractor = '   Deepak Labour Contractor   '
messy.machines[0].workingHours = -3
messy.machines[0].idleHours = 2
const clean = planSave(messy, { entityId: E }).add
eq('a headcount typed with spaces is a number', clean[0].row.headcount, 7)
eq('a negative rate is floored, not stored', clean[0].row.rate, 0)
eq('the contractor is trimmed', clean[0].row.contractor, 'Deepak Labour Contractor')
eq('and negative hours are floored',
  clean.find((a) => a.kind === 'plantLogs').row.working_hours, 0)
ok('while the idle hours it did have are kept',
  clean.find((a) => a.kind === 'plantLogs').row.idle_hours === 2)
eq('half a person is not half a day', (() => {
  const s = daySheet({ projectId: MD, date: D, muster: history, plant: machines })
  s.labour[0].headcount = 7.6
  return planSave(s, { entityId: E }).add[0].row.headcount
})(), 8)

console.log('\n── DELETED ROWS ARE NOT THE DAY ──')
const tombstoned = [
  ...history,
  makeMuster({ entityId: E, id: 'gone', projectId: MD, date: D, trade: 'mason', headcount: 99, rate: 900 }),
].map((m) => (m.id === 'gone' ? { ...m, deleted_at: '2026-09-14T10:00:00Z' } : m))
const afterDelete = daySheet({ projectId: MD, date: D, muster: tombstoned })
eq('a removed line is not filled back in', afterDelete.labour.find((l) => l.trade === 'mason').headcount, 0)
ok('and the sheet does not claim the day was started', !afterDelete.started)
ok('nor does a deleted row set the rate',
  afterDelete.labour.find((l) => l.trade === 'mason').rate === 880)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
