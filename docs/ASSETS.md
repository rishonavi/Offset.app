# Assets that are a quantity, not a price

Most assets in Offset are one thing with a value: a flat, a car, a boat. Two
kinds aren't. **Gold and silver** are a weight at a purity, and a **broker
account** is forty holdings you do not want as forty rows.

## Precious metals and jewellery

Three facts cause every valuation mistake people make with metal, and all three
are handled rather than assumed:

1. **The quote is not per gram.** MCX prices gold per **10 grams** and silver
   per **kilogram**. Multiply a gram count by the headline rate and you are out
   by a factor of ten.
2. **The rate buys fine metal.** A 22K chain is 91.6% gold, so it is worth
   91.6% of the rate. Purity is stored as millesimal fineness — 916, the number
   stamped on the piece — because karat is a display convenience.
3. **916/1000 is not 0.916 in floating point.** It is 0.9159999999999999, and
   that error rides all the way into the rupee figure unless it is rounded at
   source.

Grams, kilograms, tola and troy ounces all convert. Tola and troy ounce are
exact definitions, not approximations: one tola is three-eighths of a troy
ounce.

**With no rate, the value is `null`, not zero.** "We don't know" and "it's worth
nothing" are different answers, and a zero would quietly drag a portfolio total
down. Unpriced holdings are counted and named separately.

Jewellery is told plainly that **making charges and the GST on them are not
recovered on resale**. A valuation that ignores them flatters the asset.

### Dating a price

A rate read at 2am on a Sunday is Friday's close. Valuations are dated to the
**session close** they came from, so a stale number is visibly stale rather than
looking live. Market hours are computed in IST regardless of the browser's
timezone. Exchange holidays have no derivable rule, so the code takes a list
rather than pretending to know them — the answer is still right on weekends and
outside hours without one.

## Broker holdings

Every Indian broker exports holdings and none of them agree on column names.
Zerodha writes "Avg. cost", Groww "Average buy price", Upstox "Buy Avg", ICICI
Direct "Average Cost Price" — all meaning the price you paid. Files are matched
on aliases, and the broker is recognised by the columns it exports rather than
the filename, because people rename downloads.

A file that can't be read is **refused**, with the missing column named and the
columns that were found listed. A partial holdings import is worse than none:
the rows that didn't make it don't announce themselves, they just make the
portfolio quietly too small. Totals rows are dropped and a position sold down to
zero is not a holding.

As with metal, a holding with no price is reported as unpriced rather than
valued at nothing — and the portfolio's gain is **withheld entirely** if any row
is missing a price, because a gain computed over an incomplete cost is wrong in
a way that looks right.

The account imports as **one asset**. Forty rows in a portfolio that also
contains three flats is not a portfolio anyone can read.
