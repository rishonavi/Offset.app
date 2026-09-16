// Carrying the company's books between devices.
//
// The reconciliation rules live in `lib/sync.js` and are pure. This is the part
// that talks: which local collection is which table, what a pull asks for, and
// what a push sends. It takes its client as an argument rather than importing
// one, so the whole orchestration — the order of operations, what happens when
// a table fails halfway, what is left unsent afterwards — can be exercised
// against a stub instead of a server.
//
// The shape is deliberately dull: pull everything changed since we last looked,
// merge it by the rules, push whatever is still ours. No streaming, no
// subscriptions, no partial page cursors. A construction company has thousands
// of rows, not millions, and the interesting failure is a lorry driver in a
// basement with no signal rather than throughput.

import { mergePull, toPush, isDirty, syncState } from '../sync'

// Local collection → the table it lives in. Written out rather than derived,
// because a guessed name that is nearly right fails at run time on somebody
// else's phone.
export const TABLES = {
  entities: 'entities',
  members: 'entity_members',
  departments: 'departments',
  audit: 'audit_events',
  projects: 'projects',
  items: 'inventory_items',
  movements: 'inventory_movements',
  quotes: 'material_quotes',
  muster: 'labour_muster',
  workOrders: 'work_orders',
  raBills: 'ra_bills',
  workItems: 'work_items',
  measurements: 'work_measurements',
  plant: 'plant',
  plantLogs: 'plant_logs',
  units: 'sale_units',
  planStages: 'sale_plan_stages',
  receipts: 'sale_receipts',
  advances: 'advances',
  adjustments: 'advance_adjustments',
  employees: 'employees',
  payrollRuns: 'payroll_runs',
}
export const SYNCED = Object.keys(TABLES)

// A quotation is one row here and two tables there: the quote and its lines.
// Kept inline locally because every screen reads a quote whole and a join on a
// phone with no signal is a join that does not happen.
const SPLIT = {
  quotes: { child: 'material_quote_lines', field: 'lines', fk: 'quote_id' },
}

// Columns the server owns or the device invented. Sending `_rev` would have the
// database reject the row for a column it does not have.
const strip = (row) => {
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    if (k.startsWith('_')) continue
    out[k] = v
  }
  return out
}

const lastSeen = (rows = []) =>
  rows.reduce((latest, r) => (String(r?._rev || '') > latest ? String(r._rev) : latest), '')

// One collection, one round trip.
export async function syncCollection(client, kind, localRows, { entityIds = null } = {}) {
  const table = TABLES[kind]
  if (!table) throw new Error(`Nothing on the server holds ${kind}.`)
  const split = SPLIT[kind]

  // Only what has changed since the newest thing this device has already been
  // told about. A first run asks for everything, which is what a first run is.
  const since = lastSeen(localRows)
  let query = client.from(table).select('*')
  if (since) query = query.gt('updated_at', since)
  // Row-level security already limits this to companies the person belongs to.
  // The filter is a courtesy to the network, not the control.
  if (entityIds?.length) query = query.in('entity_id', entityIds)

  const { data: remote, error } = await query
  if (error) throw error

  let incoming = remote || []
  if (split && incoming.length) {
    const { data: kids, error: kidErr } = await client
      .from(split.child).select('*').in(split.fk, incoming.map((r) => r.id))
    if (kidErr) throw kidErr
    incoming = incoming.map((r) => ({ ...r, [split.field]: (kids || []).filter((k) => k[split.fk] === r.id) }))
  }

  const merged = mergePull(localRows, incoming, { kind })

  // Push whatever is still ours. Upsert rather than insert-or-update, because
  // the device cannot know whether the server has seen this id before — it may
  // have pushed it and lost the reply.
  const outgoing = toPush(merged.rows)
  let pushed = []
  if (outgoing.length) {
    const { data: saved, error: pushErr } = await client
      .from(table)
      .upsert(outgoing.map((r) => strip(split ? { ...r, [split.field]: undefined } : r)), { onConflict: 'id' })
      .select()
    if (pushErr) throw pushErr
    pushed = saved || []

    if (split) {
      // Lines are replaced wholesale. A quote's lines are written together and
      // read together, and reconciling them one by one would be machinery for a
      // case nobody has: two people editing different lines of one quotation.
      for (const row of outgoing) {
        const lines = (row[split.field] || []).map((l) => ({ ...strip(l), [split.fk]: row.id, entity_id: row.entity_id }))
        await client.from(split.child).delete().eq(split.fk, row.id)
        if (lines.length) {
          const { error: lineErr } = await client.from(split.child).insert(lines)
          if (lineErr) throw lineErr
        }
      }
    }
  }

  // The server's version of what it just accepted, so the rows read as sent.
  const byId = new Map(pushed.map((r) => [r.id, r]))
  const rows = merged.rows.map((r) => {
    const saved = byId.get(r.id)
    if (!saved) return r
    return { ...r, updated_at: saved.updated_at, _rev: saved.updated_at }
  })

  return {
    kind,
    rows,
    conflicts: merged.conflicts,
    pulled: merged.applied,
    pushed: pushed.length,
    // Anything still unsent after a clean round trip was refused, which is
    // worth knowing rather than discovering next time.
    stuck: rows.filter((r) => isDirty(r)).length,
  }
}

// Every collection, in an order that does not leave a child pointing at a
// parent the server has not got yet.
export const ORDER = [
  'entities', 'members', 'departments', 'projects',
  'items', 'movements', 'quotes',
  'employees', 'muster', 'workOrders', 'raBills',
  'workItems', 'measurements', 'plant', 'plantLogs',
  'units', 'planStages', 'receipts',
  'advances', 'adjustments', 'audit',
]

export async function syncAll(client, read, write, { entityIds = null, onProgress = null } = {}) {
  const conflicts = []
  const failures = []
  const collections = {}
  let pulled = 0
  let pushed = 0

  for (const kind of ORDER) {
    try {
      const result = await syncCollection(client, kind, read(kind), { entityIds })
      write(kind, result.rows)
      collections[kind] = result.rows
      conflicts.push(...result.conflicts)
      pulled += result.pulled
      pushed += result.pushed
    } catch (e) {
      // One table failing does not stop the rest. A company whose quotations
      // will not sync should still get its muster roll through, and the thing
      // that failed is named rather than swallowed into a single red cross.
      failures.push({ kind, message: e?.message || String(e) })
      collections[kind] = read(kind)
    }
    onProgress?.({ kind, done: ORDER.indexOf(kind) + 1, total: ORDER.length })
  }

  const at = new Date().toISOString()
  return {
    at,
    pulled,
    pushed,
    conflicts,
    failures,
    state: syncState({
      collections,
      lastSyncedAt: failures.length ? null : at,
      online: true,
      error: failures.length ? `${failures.length} of ${ORDER.length} did not sync: ${failures.map((f) => f.kind).join(', ')}` : null,
    }),
  }
}
