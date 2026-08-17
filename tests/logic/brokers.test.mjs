// Broker holdings: every broker names the same four numbers differently.
import * as B from '../../src/lib/brokers.js'
let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

console.log('\n── NUMBERS AS BROKERS WRITE THEM ──')
eq('a plain number', B.toNumber('1234.5'), 1234.5)
eq('lakh grouping', B.toNumber('1,23,456.78'), 123456.78)
eq('a rupee sign', B.toNumber('₹ 45,000'), 45000)
eq('a bracketed loss is negative', B.toNumber('(1,200)'), -1200)
eq('an empty cell is absent, not zero', B.toNumber(''), null)
eq('a dash is absent', B.toNumber('-'), null)
eq('nonsense is absent', B.toNumber('n/a'), null)
eq('a real zero is zero', B.toNumber('0'), 0)

console.log('\n── ZERODHA ──')
const zerodha = `Instrument,Qty.,Avg. cost,LTP,Cur. val,P&L
INFY,50,"1,420.50","1,610.00","80,500.00","9,475.00"
TCS,10,"3,300.00","3,890.00","38,900.00","5,900.00"`
let out = B.parseHoldingsFile(zerodha)
eq('the broker is recognised from its columns', out.broker?.id, 'zerodha')
eq('both holdings are read', out.holdings.length, 2)
eq('the symbol', out.holdings[0].symbol, 'INFY')
eq('the quantity', out.holdings[0].quantity, 50)
eq('the average cost', out.holdings[0].avgCost, 1420.5)
eq('the current value as stated', out.holdings[0].value, 80500)
eq('and the gain is derived from cost, not copied', out.holdings[0].gain, 9475)

console.log('\n── GROWW ──')
const groww = `Stock Name,Quantity,Average buy price,Current Price
Reliance Industries,25,2450,2810
HDFC Bank,40,1520,1680`
out = B.parseHoldingsFile(groww)
eq('a different broker is recognised', out.broker?.id, 'groww')
eq('with holdings read', out.holdings.length, 2)
eq('value is derived when the file does not state one', out.holdings[0].value, 25 * 2810)
eq('and cost from quantity times average', out.holdings[0].cost, 25 * 2450)

console.log('\n── UPSTOX ──')
out = B.parseHoldingsFile(`Symbol,Quantity,Buy Avg,LTP\nSBIN,100,590,640`)
eq('upstox is recognised', out.broker?.id, 'upstox')
eq('and read', out.holdings[0].value, 64000)

console.log('\n── A MUTUAL FUND STATEMENT ──')
out = B.parseHoldingsFile(`Scheme Name,Units,NAV,Current Value\nParag Parikh Flexi Cap,1250.456,78.90,"98,658.98"`)
eq('units are a quantity too', out.holdings[0].quantity, 1250.456)
eq('and the stated value wins', out.holdings[0].value, 98658.98)

console.log('\n── AN UNREADABLE FILE IS REFUSED, NOT HALF-IMPORTED ──')
out = B.parseHoldingsFile(`Foo,Bar\n1,2`)
eq('nothing is imported', out.holdings.length, 0)
ok('and it says which column is missing', /quantity/i.test(out.error), out.error)
ok('and lists what it did find, so the user can see why', /Foo/.test(out.error), out.error)
out = B.parseHoldingsFile('')
ok('an empty file is refused', out.holdings.length === 0 && Boolean(out.error), out.error)

console.log('\n── ROWS THAT ARE NOT HOLDINGS ──')
out = B.parseHoldingsFile(`Instrument,Qty.,Avg. cost,LTP\nINFY,50,1420,1610\nTotal,,,\nTCS,0,3300,3890`)
eq('a totals row is dropped', out.holdings.length, 1)
eq('and a sold-out position is not a holding', out.holdings[0].symbol, 'INFY')

console.log('\n── TOTALS ──')
out = B.parseHoldingsFile(zerodha)
const t = B.portfolioTotals(out.holdings)
eq('the value is the sum', t.value, 119400)
eq('the cost is the sum', t.cost, 71025 + 33000)
eq('the gain is value less cost', t.gain, 119400 - (71025 + 33000))
eq('and nothing is unpriced here', t.unpriced, 0)
// An unpriced row must not be counted as worthless.
const mixed = B.normaliseHoldings([
  { Symbol: 'A', Quantity: 10, 'Buy Avg': 100, LTP: 150 },
  { Symbol: 'B', Quantity: 5, 'Buy Avg': 200 },
])
eq('a holding with no price has no value', mixed.holdings[1].value, null)
const mt = B.portfolioTotals(mixed.holdings)
eq('it is counted as unpriced', mt.unpriced, 1)
eq('not added in as zero', mt.value, 1500)
eq('and the gain is withheld rather than being wrong', mt.gain, null)

console.log('\n── AS AN ASSET ──')
const asset = B.asAsset(out.holdings, { name: 'Zerodha', broker: out.broker })
eq('one asset, not forty', typeof asset.name, 'string')
eq('valued at the portfolio total', asset.value, 119400)
eq('typed as equity', asset.type, 'Stocks / Equity')
ok('and it says how many holdings it stands for', /2 holdings/.test(asset.notes), asset.notes)
ok('naming the broker', /Zerodha/.test(asset.notes), asset.notes)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
