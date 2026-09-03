// Whether an entry is already in the books.
//
// Re-importing a file is the ordinary mistake, not the exotic one: you download
// last month's statement again, or send yourself the same spreadsheet twice. In
// a ledger that silently doubles every row, and nothing on screen says so — the
// totals are simply wrong from then on.
//
// The Tally importer had this and the spreadsheet importer did not, so the same
// action was safe through one door and destructive through the other. Both now
// ask the same question in the same way.

// Asset, day, amount, and what it was for. Deliberately not the description: a
// bill that arrives once from a bank statement and once from a spreadsheet
// rarely carries the same wording, and a key that includes it would call those
// two things different when a person would not.
//
// The cost of that is real and worth naming: two genuinely separate entries on
// one asset, on one day, for the same amount and the same category, look
// identical here. That is why importing reports what it skipped rather than
// quietly dropping it — the count is the thing that lets someone notice.
export const entryKey = (row, kind = 'expense') => {
  const what = kind === 'income' ? row?.source : row?.category
  return [
    row?.property_id ?? '',
    row?.date ?? '',
    Number(row?.amount) || 0,
    String(what ?? '').trim().toLowerCase(),
  ].join('|')
}

// The keys already present, ready to be added to as an import proceeds — a file
// that repeats a row inside itself should import it once, not twice.
export const seenIndex = (rows = [], kind = 'expense') =>
  new Set(rows.map((r) => entryKey(r, kind)))

// "3 duplicates skipped", or nothing at all when there were none. Said in words
// because a silent skip and a silent double are equally hard to notice.
export const skippedNote = (n) =>
  n > 0 ? `, skipped ${n} duplicate${n === 1 ? '' : 's'} already in your books` : ''
