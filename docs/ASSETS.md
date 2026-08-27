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

### Reading the purchase bill

The weight, the purity and the rate are all printed on the bill you were handed,
so **Fill from a purchase bill** on a metal asset reads them off it. Three of
the conversions are the ones that go wrong when they are done by hand, and they
are the reason this is not just an OCR pass:

- **What the rate is per.** A jeweller quotes per gram; the app stores gold per
  10 grams and silver per kilogram. Carried across unchanged, the valuation is
  out by ten, or by a thousand. If the bill does not say what the rate is per,
  the rate is **left blank** rather than guessed — the two readings differ by an
  order of magnitude and there is no safe default.
- **Which weight.** A jewellery bill carries a gross weight and a net weight,
  and only the net is metal. Reading the larger number values a diamond ring as
  though the diamond were gold. Where only a gross is given and stones are
  itemised, the difference is used and said to have been used.
- **Karat is not fineness.** 22/24 is 0.91666…, and the number stamped on the
  piece is 916 — which is what the purity picker has to match.

What the bill states is used; what it does not state stays null rather than
becoming zero. Making charges and the tax on them are recorded as their own
lines beside the metal value rather than folded into it, because the asset's
value is what was paid while its worth is computed from weight, purity and rate.
The gap between those two is the making charges, and that is the honest picture
rather than a flattering one.

The reader is the same Gemini call as receipt scanning, pointed at a different
prompt. There is no on-device fallback: the OCR path looks for a total and a
vendor and has no notion of a net weight, so a confident-looking half answer
from it would be worse than saying the reader is unavailable.

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
