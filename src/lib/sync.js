// Making the same books work on four phones and a laptop.
//
// A construction company is not one person at a desk. The store keeper records
// receipts at the gate, the site engineer measures work on the fourth floor,
// the accountant enters bills in an office, and the owner reads totals in a
// car. Two of those places have no signal. So this is local-first: every read
// comes from the copy on the device, every write lands there immediately, and
// the copy is reconciled with the server whenever there is a connection.
//
// A row carries two timestamps, and the difference between them is the whole
// mechanism:
//
//   `updated_at`  when this version was written, wherever it was written.
//   `_rev`        the `updated_at` the server last acknowledged for this row.
//
// A row is unsent exactly when those differ. A new row has no `_rev` at all and
// is therefore unsent; a row just pulled has them equal and is therefore not.
// One derived flag beats two stored ones, because two stored ones can disagree.
//
// ── What happens when two people change the same thing ──
//
// **First write wins, and the loser is told.** Never last-write-wins: that is
// the rule where somebody's afternoon disappears and nobody finds out until a
// total is wrong. Here the edit that reached the server first stands, and the
// other person is shown what they changed, what it says now, and can redo it.
// Losing work silently is the one outcome worth any amount of machinery to
// avoid.
//
// **Creations never conflict.** Ids are UUIDs made on the device, so two people
// adding Tuesday's muster produce two rows and both are kept. The real hazard
// there is not a clash but a duplicate — the same day's labour counted twice —
// so near-identical entries on the append-only ledgers are flagged rather than
// quietly doubling a wage bill.

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

// Ledgers that are written and not revised: a day's muster, a log sheet, a
// measurement, a stock movement. An edit to one of these is rare and a
// duplicate is common, which is the opposite of the documents.
export const APPEND_ONLY = new Set([
  'movements', 'muster', 'plantLogs', 'measurements', 'raBills', 'receipts', 'adjustments',
])
export const isAppendOnly = (kind) => APPEND_ONLY.has(kind)

// Unsent: this device has a version the server has not acknowledged.
export const isDirty = (row) => String(row?.updated_at || '') !== String(row?._rev || '')

// Stamped on every local write. Without it nothing can tell a row that has been
// sent from one that has not.
//
// A version never repeats. `new Date()` has millisecond resolution and a person
// creating a row and correcting it immediately does both inside one — which
// would leave two versions carrying the same stamp, and two versions carrying
// the same stamp are two versions nothing can tell apart. When the clock has
// not moved it is nudged by the smallest amount the format can carry, which is
// wrong by a millisecond and right about the ordering.
export const touch = (row) => {
  const now = new Date().toISOString()
  const previous = String(row?.updated_at || '')
  const at = now > previous ? now : new Date(Date.parse(previous) + 1).toISOString()
  return { ...row, updated_at: at }
}

// What the server said, accepted. `_rev` and `updated_at` are set together so
// the row reads as sent, and from a single value so they cannot drift apart.
export const accepted = (row, serverUpdatedAt) => {
  const at = serverUpdatedAt || row?.updated_at || new Date().toISOString()
  return { ...row, updated_at: at, _rev: at }
}

export const toPush = (rows = []) => rows.filter((r) => isDirty(r))

// Which version of one row survives.
//
// `remote` is what the server holds; `local` is what this device holds.
export function reconcile(local, remote) {
  if (!local && !remote) return { take: 'none' }
  // Somebody else created it, or this device has never seen it.
  if (!local) return { take: 'remote', reason: 'new here' }
  // This device created it and the server has not got it yet.
  if (!remote) return { take: 'local', reason: 'not sent yet' }
  // Nothing of ours to lose, so the server's copy is simply newer news.
  if (!isDirty(local)) return { take: 'remote', reason: 'nothing local to keep' }
  // Ours is unsent and nobody else has touched it since we last heard: our
  // version is the next one, and pushing it is not a conflict.
  if (String(remote.updated_at || '') === String(local._rev || '')) {
    return { take: 'local', reason: 'ours to send' }
  }
  // Both moved. The one that reached the server first stands.
  return { take: 'remote', reason: 'someone else got there first', conflict: true }
}

// What the person who lost needs in order to decide whether to redo it.
//
// Not a diff of everything — a row has thirty fields and two of them moved.
// Only what this device changed and what the server now says for those same
// fields, which is the question they are actually being asked.
export function describeConflict(local, remote, { kind = '', label = '' } = {}) {
  const fields = []
  for (const field of Object.keys(local || {})) {
    if (field.startsWith('_') || field === 'updated_at' || field === 'created_at' || field === 'id') continue
    const mine = local[field]
    const theirs = remote?.[field]
    const same = mine === theirs
      || (mine && theirs && typeof mine === 'object' && JSON.stringify(mine) === JSON.stringify(theirs))
    if (same) continue
    if (fields.length >= 8) break
    fields.push({
      field,
      mine: typeof mine === 'object' && mine !== null ? 'changed' : mine ?? null,
      theirs: typeof theirs === 'object' && theirs !== null ? 'changed' : theirs ?? null,
    })
  }
  return {
    kind,
    id: local?.id,
    label: label || local?.name || local?.contractor || local?.vendor || local?.description || local?.id,
    fields,
    // Kept whole so the change can be re-applied, rather than retyped from a
    // list of field names.
    mine: local,
    theirs: remote,
    at: new Date().toISOString(),
  }
}

// Apply what the server sent, and say what it cost.
//
// Returns the new local rows plus every edit that lost, because an edit that
// vanishes without a word is the failure this whole design exists to prevent.
// `full` says what an absent row means, and getting it wrong is catastrophic in
// one direction. A full snapshot is the whole truth, so a row this device has
// seen acknowledged and which is now missing has been deleted elsewhere. An
// incremental pull only carries what changed, so a missing row means *nothing
// happened to it* — and treating that as a deletion would empty the device on
// the first sync. Deletions travel as tombstones instead, which is what the
// `deleted_at` column is for.
export function mergePull(localRows = [], remoteRows = [], { kind = '', label = null, full = false } = {}) {
  const byId = new Map(localRows.map((r) => [r.id, r]))
  const seen = new Set()
  const rows = []
  const conflicts = []
  let applied = 0

  for (const remote of remoteRows) {
    if (!remote?.id) continue
    seen.add(remote.id)
    const local = byId.get(remote.id)
    const verdict = reconcile(local, remote)
    if (verdict.take === 'remote') {
      if (verdict.conflict) conflicts.push(describeConflict(local, remote, { kind, label: label?.(local) }))
      rows.push(accepted(remote, remote.updated_at))
      applied += 1
    } else {
      rows.push(local)
    }
  }

  // Rows this device has that the server did not send back.
  for (const local of localRows) {
    if (seen.has(local.id)) continue
    // On an incremental pull the server only sends what changed, so silence
    // about a row means nothing happened to it.
    if (!full) { rows.push(local); continue }
    // On a full snapshot, silence about a row the server once acknowledged
    // means it is gone. One it never acknowledged is simply still queued.
    if (local._rev) continue
    rows.push(local)
  }

  return {
    rows,
    applied,
    conflicts,
    // Still waiting to go out after this merge.
    pending: rows.filter((r) => isDirty(r)).length,
  }
}

// ── Duplicates ─────────────────────────────────────────────────────
//
// The hazard on an append-only ledger is not a clash, it is the same real-world
// event recorded twice: the site engineer enters Tuesday's muster from the gate
// and the office enters it again from the paper sheet. Both rows are valid,
// both have their own id, and the wage bill is now wrong by a day.
//
// What makes two rows the same event is different per ledger, so it is written
// down per ledger rather than guessed.
const SIGNATURES = {
  muster: (r) => [r.date, r.trade, r.project_id, r.headcount, r.rate],
  plantLogs: (r) => [r.date, r.plant_id, r.working_hours, r.idle_hours],
  measurements: (r) => [r.date, r.work_item_id, r.qty],
  movements: (r) => [r.date, r.item_id, r.kind, r.qty, r.store_id],
  raBills: (r) => [r.work_order_id, r.number],
  receipts: (r) => [r.date, r.unit_id, r.amount],
  adjustments: (r) => [r.date, r.advance_id, r.amount],
}

export const hasSignature = (kind) => Boolean(SIGNATURES[kind])

export function duplicates(rows = [], kind) {
  const sign = SIGNATURES[kind]
  if (!sign) return []
  const groups = new Map()
  for (const row of rows) {
    if (row?.deleted_at) continue
    const key = JSON.stringify(sign(row))
    // A signature of nothing at all matches every other empty row, which would
    // report a screenful of nonsense on a half-filled ledger.
    if (sign(row).every((v) => v === undefined || v === null || v === '')) continue
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => {
      const ordered = g.slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
      return {
        kind,
        // The first one entered is the one to keep, on the grounds that the
        // later ones are the re-entry.
        keep: ordered[0],
        others: ordered.slice(1),
        count: ordered.length,
      }
    })
    .sort((a, b) => b.count - a.count)
}

// ── What to show a person ──────────────────────────────────────────
export function syncState({ collections = {}, lastSyncedAt = null, online = true, error = null } = {}) {
  let pending = 0
  const dupes = []
  for (const [kind, rows] of Object.entries(collections)) {
    pending += toPush(rows).length
    if (isAppendOnly(kind)) dupes.push(...duplicates(rows, kind))
  }
  return {
    online,
    error,
    lastSyncedAt,
    pending,
    duplicates: dupes,
    duplicateCount: dupes.reduce((t, d) => t + d.others.length, 0),
    // Everything on this device has been acknowledged by the server. Said
    // plainly, because "synced" with three unsent rows behind it is the kind of
    // reassurance that costs somebody a day's work.
    settled: pending === 0 && !error,
    why: error
      ? String(error)
      : !online
        ? pending > 0
          ? `Offline. ${pending} ${pending === 1 ? 'change' : 'changes'} waiting to go out.`
          : 'Offline. Everything here has been sent.'
        : pending > 0
          ? `${pending} ${pending === 1 ? 'change' : 'changes'} waiting to go out.`
          : lastSyncedAt
            ? 'Everything is up to date.'
            : 'Not synced yet.',
  }
}
