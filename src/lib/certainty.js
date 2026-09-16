// How a figure was arrived at.
//
// Payroll already draws this line, and it took a bug to learn why: a month that
// has been *run* is a fact — the slips are frozen and a raise in June cannot
// change what March paid — while a month worked out on today's salaries is a
// model that moves under you. The two look identical on screen, and somebody
// acts on the second believing it is the first.
//
// The same line runs through most of this app and is drawn nowhere else. A work
// order's unspent value is agreed, not spent. Depreciation is a rule, not a
// payment. An instalment that has not fallen due is a forecast about a building.
// Every one of those sits in a column next to figures that really did happen.
//
// Four levels, in the order you would trust them:
//
//   `recorded`   somebody wrote it down. It happened.
//   `agreed`     it is in a contract. It will happen unless somebody changes it.
//   `projected`  worked out from a rule. It moves when the inputs move.
//   `estimated`  somebody's guess, kept so the real figure can be compared to it.
//
// And one rule, which is the whole reason for having the vocabulary: **a total
// is only as certain as its least certain part.** Adding a fact to a forecast
// and presenting the sum as a fact is the mistake, and it is easy to make
// because the arithmetic is right.
export const CERTAINTY = {
  recorded: {
    id: 'recorded', label: 'Recorded', rank: 0,
    hint: 'Somebody wrote this down. It is what happened.',
  },
  agreed: {
    id: 'agreed', label: 'Agreed', rank: 1,
    hint: 'A figure in a contract. It will happen unless somebody changes it.',
  },
  projected: {
    id: 'projected', label: 'Projected', rank: 2,
    hint: 'Worked out from a rule rather than recorded. It moves when the inputs move.',
  },
  estimated: {
    id: 'estimated', label: 'Estimated', rank: 3,
    hint: 'A guess, kept so the real figure can be compared against it.',
  },
}
export const CERTAINTY_IDS = Object.keys(CERTAINTY)
export const certaintyOf = (id) => CERTAINTY[id] || CERTAINTY.projected

// A total is only as certain as its least certain part.
//
// Unknown names are treated as `projected` rather than ignored: a figure whose
// provenance nobody wrote down is not a fact, and defaulting to the confident
// end is how the whole vocabulary becomes decoration.
export function leastCertain(...ids) {
  const parts = ids.flat().filter(Boolean)
  if (!parts.length) return CERTAINTY.recorded
  return parts.reduce((worst, id) => {
    const here = certaintyOf(id)
    return here.rank > worst.rank ? here : worst
  }, CERTAINTY.recorded)
}

// What a total is made of, for a screen that wants to say so rather than print
// one badge and leave the reader to wonder which part is the soft one.
export function madeOf(parts = {}) {
  const entries = Object.entries(parts).filter(([, id]) => id)
  const worst = leastCertain(entries.map(([, id]) => id))
  return {
    ...worst,
    // True when the parts do not agree, which is exactly when saying "projected"
    // alone would understate a total that is mostly fact.
    mixed: new Set(entries.map(([, id]) => id)).size > 1,
    parts: entries.map(([name, id]) => ({ name, ...certaintyOf(id) })),
    // The soft ones, named. "₹6,70,800 of this is agreed rather than spent" is
    // the sentence somebody can act on.
    softest: entries.filter(([, id]) => certaintyOf(id).rank === worst.rank).map(([name]) => name),
  }
}

// One sentence for a card.
export function describeCertainty(made) {
  if (!made) return ''
  if (!made.mixed) return made.hint
  return `${made.hint} The ${made.softest.join(' and ')} ${made.softest.length === 1 ? 'part is' : 'parts are'} the soft one${made.softest.length === 1 ? '' : 's'}.`
}
