// How a figure was arrived at, and the one rule that matters.
//
// Payroll already draws this line and it took a bug to learn why: a month that
// has been *run* is a fact — the slips are frozen and a raise in June cannot
// change what March paid — while a month worked out on today's salaries is a
// model that moves under you. The two look identical on screen, and somebody
// acts on the second believing it is the first.
//
// The rule this file is mostly about: **a total is only as certain as its least
// certain part.** Adding a fact to a forecast and presenting the sum as a fact
// is easy to do because the arithmetic is right, and it is the mistake that
// makes a plant cost look like a payment and a subcontract commitment look like
// a bank balance.
import {
  CERTAINTY, CERTAINTY_IDS, certaintyOf, leastCertain, madeOf, describeCertainty,
} from '../../src/lib/certainty.js'
import { commitments } from '../../src/lib/commitments.js'
import { plantReport } from '../../src/lib/plant.js'
import { tdsLedger } from '../../src/lib/tds.js'
import { salesReport } from '../../src/lib/sales.js'
import { buildSample } from '../../src/lib/sampleSite.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, got, want) => ok(n, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

console.log('\n── FOUR LEVELS, IN THE ORDER YOU WOULD TRUST THEM ──')
eq('there are four', CERTAINTY_IDS.join(','), 'recorded,agreed,projected,estimated')
ok('recorded is the most certain', CERTAINTY.recorded.rank === 0)
ok('and a guess the least', CERTAINTY.estimated.rank === 3)
ok('agreed sits above projected, because a contract is not a forecast',
  CERTAINTY.agreed.rank < CERTAINTY.projected.rank)
ok('every level says what it means in words', CERTAINTY_IDS.every((id) => CERTAINTY[id].hint.length > 20))
eq('a name nobody recognises is not treated as a fact', certaintyOf('nonsense').id, 'projected')

console.log('\n── A TOTAL IS ONLY AS CERTAIN AS ITS LEAST CERTAIN PART ──')
eq('two facts make a fact', leastCertain('recorded', 'recorded').id, 'recorded')
eq('a fact and a contract make a contract', leastCertain('recorded', 'agreed').id, 'agreed')
// The one that matters. This is the sum somebody prints and acts on.
eq('a fact and a forecast make a forecast', leastCertain('recorded', 'projected').id, 'projected')
eq('and a guess beats everything', leastCertain('recorded', 'agreed', 'projected', 'estimated').id, 'estimated')
eq('the order they are given in does not matter', leastCertain('projected', 'recorded').id, 'projected')
eq('nothing at all is a fact, because there is nothing to doubt', leastCertain().id, 'recorded')
// A figure whose provenance nobody wrote down is not a fact. Defaulting to the
// confident end is how a vocabulary like this becomes decoration.
eq('and an unlabelled part is not assumed to be one', leastCertain('recorded', 'who knows').id, 'projected')

console.log('\n── WHAT A TOTAL IS MADE OF ──')
const mixed = madeOf({
  'bills unpaid': 'recorded',
  'work orders outstanding': 'agreed',
  'instalments not yet due': 'projected',
})
eq('it takes the least certain', mixed.id, 'projected')
eq('and says the parts disagree', mixed.mixed, true)
eq('naming the soft one', mixed.softest.join(','), 'instalments not yet due')
eq('and listing them all', mixed.parts.length, 3)
ok('with a sentence that names it', /instalments not yet due part is the soft one/.test(describeCertainty(mixed)),
  describeCertainty(mixed))
const plain = madeOf({ a: 'recorded', b: 'recorded' })
eq('parts that agree are not mixed', plain.mixed, false)
eq('and the sentence is just the level', describeCertainty(plain), CERTAINTY.recorded.hint)
eq('nothing at all is nothing to doubt', madeOf({}).id, 'recorded')
eq('and describes as nothing when there is no total', describeCertainty(null), '')

console.log('\n── AND THE REPORTS SAY SO THEMSELVES ──')
// Declared on the report rather than decided by whichever screen prints it: the
// answer is a property of the arithmetic, not of the layout.
const E = 'e1'
const b = buildSample(E)
const c = commitments(b, { entityId: E })
eq('what is committed is agreed, not spent', c.certainty.committed.id, 'agreed')
eq('what is owed now was recorded', c.certainty.dueOut.id, 'recorded')
eq('and so is what is due in', c.certainty.dueIn.id, 'recorded')
// The reason the three are never added into one figure on screen.
eq('the two added together are only as certain as the agreed half',
  c.certainty.committedAndDue.id, 'agreed')
ok('and it says which half that is', c.certainty.committedAndDue.softest.includes('committed'),
  c.certainty.committedAndDue.softest.join(','))

const yard = plantReport(b.plant, b.plantLogs, { entityId: E })
// Hire and fuel were paid; depreciation is a straight line somebody chose.
eq('what a machine cost has an opinion in it', yard.certainty.id, 'projected')
eq('and the opinion is named', yard.certainty.softest.join(','), 'depreciation')
ok('while the rest was recorded',
  yard.certainty.parts.filter((p) => p.id === 'recorded').map((p) => p.name).join(',') === 'hire,fuel')

const tax = tdsLedger(b.workOrders, b.raBills, { entityId: E })
eq('what the year will require is a forecast', tax.certainty.id, 'projected')
ok('because one more bill can make everything liable',
  tax.certainty.softest.join(',') === 'what the year will require')

const book = salesReport(b.units, b.planStages, b.receipts, { entityId: E })
eq('a sales book waits on a building', book.certainty.id, 'projected')
eq('and says which part does', book.certainty.softest.join(','), 'not yet due')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
