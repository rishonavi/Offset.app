// What counts as an amount of money.
//
// Every form checked only that a number was above zero, which lets 1e308
// through — and 1e308 is not a large amount, it is a number the app cannot add
// up. Past 2^53 JavaScript stops representing integers exactly, so a total
// containing one is quietly wrong rather than loudly wrong, and a running
// balance that is quietly wrong is the worst thing a ledger can contain.
//
// The cap is far above any real entry and far below where the arithmetic goes.
// It is there to catch a pasted phone number or a stuck zero key, which is what
// actually produces these — nobody types 1e308 on purpose.
export const MAX_AMOUNT = 1e15

// Nothing typed at all: an optional field left blank is not an error.
export const isBlank = (v) => v === '' || v == null

// `null` when the value is fine, otherwise the sentence to show. Returning the
// message rather than a boolean keeps the reason with the rule — a caller
// cannot show "too big" for a value that was actually negative.
export function amountError(value, { required = false, allowZero = false } = {}) {
  if (isBlank(value)) return required ? 'Enter an amount.' : null
  const n = Number(value)
  if (!Number.isFinite(n)) return 'That is not an amount.'
  if (n < 0) return 'An amount cannot be negative.'
  if (!allowZero && n === 0 && required) return 'Enter an amount greater than zero.'
  if (n > MAX_AMOUNT) return 'That is larger than this app can add up accurately. Check the figure.'
  return null
}

export const isSaneAmount = (value, opts) => amountError(value, opts) === null

// For the values that are already stored: a row written before this existed, or
// edited by hand in devtools, should not be able to poison a total.
export const safeAmount = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > MAX_AMOUNT) return 0
  return n
}

// The same, for a value on its way into storage — but blank is left exactly as
// it arrived. A missing budget and a budget of zero are different facts, and
// turning one into the other would be its own quiet corruption.
export function cleanAmount(value) {
  if (isBlank(value)) return value
  return safeAmount(value)
}

// Which fields on each kind of row are money. Rows arrive from forms, from a
// backup file, from a bank statement, from Tally, from a spreadsheet and from
// an inbox — six front doors, and validating each of them separately is how the
// seventh gets forgotten. Applied once where every write already passes.
export const MONEY_FIELDS = {
  property: ['value', 'monthly_budget', 'loan_principal', 'deposit', 'metal_rate'],
  expense: ['amount', 'tax'],
  income: ['amount', 'tax'],
}

export function cleanMoney(row, kind) {
  const fields = MONEY_FIELDS[kind]
  if (!row || !fields) return row
  const out = { ...row }
  for (const f of fields) if (f in out) out[f] = cleanAmount(out[f])
  return out
}
