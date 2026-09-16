// Storage for the corporate layer.
//
// Kept apart from the personal backend on purpose: a personal Offset install
// should carry none of this, and a company install should not have its
// entities, members and payroll tangled into the same keys as somebody's
// household expenses. Everything here is namespaced `pl_corp_*` and is absent
// until a company is created.
//
// Demo mode stores in the browser. Cloud mode needs the Supabase schema, which
// ships separately — until then this is the local backend for both, and the
// app says so rather than pretending to sync.

import {
  makeEntity, makeDepartment, makeMember, makeApprovalPolicy, makeAuditEvent,
  canRemoveMember, canChangeRole, canApprove, whyCannotApprove, APPROVAL_STATUS,
} from '../corporate'
import { touch } from '../sync'

const KEYS = {
  entities: 'pl_corp_entities',
  members: 'pl_corp_members',
  departments: 'pl_corp_departments',
  policy: 'pl_corp_policy',
  audit: 'pl_corp_audit',
  active: 'pl_corp_active',
  items: 'pl_corp_items',
  movements: 'pl_corp_movements',
  stockCounts: 'pl_corp_stock_counts',
  advances: 'pl_corp_advances',
  adjustments: 'pl_corp_adjustments',
  employees: 'pl_corp_employees',
  payrollRuns: 'pl_corp_payroll_runs',
  projects: 'pl_corp_projects',
  quotes: 'pl_corp_quotes',
  muster: 'pl_corp_muster',
  workOrders: 'pl_corp_work_orders',
  raBills: 'pl_corp_ra_bills',
  workItems: 'pl_corp_work_items',
  measurements: 'pl_corp_measurements',
  plant: 'pl_corp_plant',
  plantLogs: 'pl_corp_plant_logs',
  units: 'pl_corp_units',
  planStages: 'pl_corp_plan_stages',
  receipts: 'pl_corp_receipts',
}

const read = (key) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(key))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    const quota = e?.name === 'QuotaExceededError' || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e?.code === 22
    if (quota) {
      throw new Error(
        'This browser’s storage is full, so the change wasn’t saved. Export your data from Settings, then delete some old entries.',
      )
    }
    throw e
  }
}

const readOne = (key, fallback) => {
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(key)) || {}) }
  } catch {
    return fallback
  }
}

// ── Audit ──────────────────────────────────────────────────────────
// Every mutation below records one. The log is capped so a busy month can't
// fill the browser's storage and take the books down with it; the cap is high
// enough that it holds far more than anyone reviews at once.
const AUDIT_CAP = 2000

export function recordAudit(event) {
  const list = read(KEYS.audit)
  list.push(event)
  write(KEYS.audit, list.slice(-AUDIT_CAP))
  return event
}

export const listAudit = ({ entityId = null, limit = 200 } = {}) =>
  read(KEYS.audit)
    .filter((e) => !entityId || e.entity_id === entityId)
    .slice(-limit)
    .reverse()

const audit = (actor, entityId, action, targetId, detail) =>
  recordAudit(makeAuditEvent({
    entityId,
    actorId: actor?.id || null,
    actorEmail: actor?.email || '',
    action,
    targetId,
    detail,
  }))

// ── Entities ───────────────────────────────────────────────────────
export const listEntities = () => read(KEYS.entities)

export function createEntity(data, actor) {
  const entity = makeEntity(data)
  write(KEYS.entities, [...read(KEYS.entities), entity])
  // Whoever creates a company owns it — otherwise the first company would have
  // no one able to administer it.
  const owner = makeMember({
    entityId: entity.id,
    userId: actor?.id || 'local-user',
    email: actor?.email || '',
    role: 'owner',
  })
  write(KEYS.members, [...read(KEYS.members), owner])
  audit(actor, entity.id, 'entity.create', entity.id, { name: entity.name })
  return entity
}

export function updateEntity(id, patch, actor) {
  const list = read(KEYS.entities).map((e) => (e.id === id ? { ...e, ...patch, id: e.id } : e))
  write(KEYS.entities, list)
  audit(actor, id, 'entity.update', id, patch)
  return list.find((e) => e.id === id)
}

// Deleting a company would orphan every row pointing at it, so it is archived
// instead. The books stay; the company stops appearing in the switcher.
export function archiveEntity(id, actor) {
  const list = read(KEYS.entities).map((e) => (e.id === id ? { ...e, archived_at: new Date().toISOString() } : e))
  write(KEYS.entities, list)
  audit(actor, id, 'entity.update', id, { archived: true })
}

export const activeEntityId = () => {
  try {
    return localStorage.getItem(KEYS.active) || ''
  } catch {
    return ''
  }
}

export function setActiveEntity(id) {
  try {
    if (id) localStorage.setItem(KEYS.active, id)
    else localStorage.removeItem(KEYS.active)
  } catch {
    /* the switcher still works for this session */
  }
}

// ── Members ────────────────────────────────────────────────────────
export const listMembers = (entityId = null) =>
  read(KEYS.members).filter((m) => !entityId || m.entity_id === entityId)

export function addMember(data, actor) {
  const member = makeMember(data)
  write(KEYS.members, [...read(KEYS.members), member])
  audit(actor, member.entity_id, 'member.add', member.id, { email: member.email, role: member.role })
  return member
}

export function setMemberRole(entityId, memberId, role, actor) {
  const all = read(KEYS.members)
  const check = canChangeRole(all, entityId, memberId, role)
  if (!check.ok) throw new Error(check.why)
  const list = all.map((m) => (m.id === memberId ? { ...m, role } : m))
  write(KEYS.members, list)
  audit(actor, entityId, 'member.role', memberId, { role })
  return list.find((m) => m.id === memberId)
}

export function removeMember(entityId, memberId, actor) {
  const all = read(KEYS.members)
  const check = canRemoveMember(all, entityId, memberId)
  if (!check.ok) throw new Error(check.why)
  write(KEYS.members, all.filter((m) => m.id !== memberId))
  audit(actor, entityId, 'member.remove', memberId, null)
}

// ── Departments ────────────────────────────────────────────────────
export const listDepartments = (entityId = null) =>
  read(KEYS.departments).filter((d) => !entityId || d.entity_id === entityId)

export function createDepartment(data, actor) {
  const dept = makeDepartment(data)
  write(KEYS.departments, [...read(KEYS.departments), dept])
  audit(actor, dept.entity_id, 'department.create', dept.id, { name: dept.name })
  return dept
}

export function updateDepartment(id, patch, actor) {
  const list = read(KEYS.departments).map((d) => (d.id === id ? { ...d, ...patch, id: d.id } : d))
  write(KEYS.departments, list)
  const dept = list.find((d) => d.id === id)
  audit(actor, dept?.entity_id, 'department.update', id, patch)
  return dept
}

// A department with children would leave them parentless, and one with costs
// booked to it would leave those costs unattributed. Both are refused.
export function deleteDepartment(id, actor, { entries = [] } = {}) {
  const all = read(KEYS.departments)
  const dept = all.find((d) => d.id === id)
  if (!dept) return
  if (all.some((d) => d.parent_id === id)) {
    throw new Error('Move or remove the departments inside this one first.')
  }
  const used = entries.filter((e) => e.department_id === id).length
  if (used) {
    throw new Error(`${used} ${used === 1 ? 'entry is' : 'entries are'} booked to this department. Reassign them first.`)
  }
  write(KEYS.departments, all.filter((d) => d.id !== id))
  audit(actor, dept.entity_id, 'department.delete', id, { name: dept.name })
}

// ── Approval policy ────────────────────────────────────────────────
// One policy per entity, keyed by id inside a single object.
export const approvalPolicy = (entityId) => {
  const all = readOne(KEYS.policy, {})
  return makeApprovalPolicy(all[entityId] || {})
}

export function setApprovalPolicy(entityId, policy, actor) {
  const all = readOne(KEYS.policy, {})
  const next = makeApprovalPolicy(policy)
  write(KEYS.policy, { ...all, [entityId]: next })
  audit(actor, entityId, 'policy.update', entityId, next)
  return next
}

// ── Operational ledgers ────────────────────────────────────────────
// Thin CRUD; the arithmetic lives in the domain modules, not here.

// What the log says about a row, which is not the row.
//
// An entry has to say enough to recognise what happened without becoming a
// second copy of the ledger: the log is capped, and a full row per event would
// push a month of real history out of it inside a week.
const IDENTIFYING = [
  'name', 'label', 'description', 'contractor', 'vendor', 'party', 'trade',
  'kind', 'number', 'status', 'amount', 'qty', 'headcount', 'certified_to_date',
]
const brief = (value) => (typeof value === 'string' ? value.slice(0, 60) : value)

const summarise = (row) => {
  const out = {}
  for (const field of IDENTIFYING) {
    if (Object.keys(out).length >= 5) break
    const v = row?.[field]
    if (v === undefined || v === null || v === '') continue
    out[field] = brief(v)
  }
  return Object.keys(out).length ? out : null
}

// Only the fields that actually moved, and only the ones worth reading. An
// entry saying `status: booked → cancelled` is the point of having a log; one
// echoing every field of an unchanged row is how a log becomes unreadable.
const changed = (before, after) => {
  const out = {}
  for (const field of Object.keys(after || {})) {
    if (Object.keys(out).length >= 8) break
    if (field === 'id' || field === 'created_at') continue
    const a = before?.[field]
    const b = after?.[field]
    // Objects and arrays are compared shallowly by their JSON, which is enough
    // to know they differ and too much to print, so they are named and not
    // quoted.
    const same = a === b || (a && b && typeof a === 'object' && JSON.stringify(a) === JSON.stringify(b))
    if (same) continue
    out[field] = typeof b === 'object' && b !== null ? 'changed' : [brief(a) ?? null, brief(b) ?? null]
  }
  return Object.keys(out).length ? out : null
}

// `noun` names the thing in the audit trail: 'site' gives site.create,
// site.update and site.delete. A collection without one writes no history,
// which is a decision and not a default — every ledger below passes one.
const collection = (key, noun) => ({
  // Deleted rows are filtered here rather than removed from storage, so every
  // caller sees what it saw before. `withDeleted` is for the one caller that
  // needs them: whatever is carrying changes to the other devices, which cannot
  // tell "deleted" from "never existed" if the row is simply gone.
  list: (entityId = null, { withDeleted = false } = {}) =>
    read(key)
      .filter((r) => withDeleted || !r.deleted_at)
      .filter((r) => !entityId || r.entity_id === entityId),
  add: (row, actor, entityId = null) => {
    const stamped = touch(row)
    write(key, [...read(key), stamped])
    if (noun) audit(actor, row.entity_id || entityId, `${noun}.create`, row.id, summarise(row))
    return stamped
  },
  update: (id, patch, actor) => {
    const before = read(key).find((r) => r.id === id)
    const list = read(key).map((r) => (r.id === id ? touch({ ...r, ...patch, id: r.id }) : r))
    write(key, list)
    const after = list.find((r) => r.id === id)
    if (noun && before) audit(actor, after?.entity_id, `${noun}.update`, id, changed(before, after))
    return after
  },
  // A tombstone, not a hole. A row that is simply gone cannot reach the other
  // devices — they would each keep their copy and re-send it, and the thing
  // somebody deleted would come back.
  remove: (id, actor) => {
    const row = read(key).find((r) => r.id === id)
    if (!row) return
    write(key, read(key).map((r) => (r.id === id ? touch({ ...r, deleted_at: new Date().toISOString() }) : r)))
    if (noun) audit(actor, row.entity_id, `${noun}.delete`, id, summarise(row))
  },
  // Replacing the lot, which only whatever is reconciling with the server has
  // any business doing. Every other caller goes through add, update or remove.
  replaceAll: (rows) => write(key, rows),
  // Signing something off, or refusing it.
  //
  // The rule lives here rather than in the screen that calls it, because a
  // control enforced only by a disabled button is not a control: whoever gets
  // to the store gets to decide, and the store is what a second screen or a
  // restored backup will go through.
  decide: (id, status, actor, role) => {
    const row = read(key).find((r) => r.id === id)
    if (!row) throw new Error('That has already gone.')
    if (!canApprove(role, row, actor?.id)) throw new Error(whyCannotApprove(role, row, actor?.id))
    const patch = {
      approval_status: status,
      approved_by: actor?.id || null,
      approved_at: new Date().toISOString(),
    }
    const list = read(key).map((r) => (r.id === id ? touch({ ...r, ...patch }) : r))
    write(key, list)
    if (noun) {
      audit(actor, row.entity_id, `${noun}.${status === APPROVAL_STATUS.approved ? 'approve' : 'reject'}`, id, summarise(row))
    }
    return list.find((r) => r.id === id)
  },
})

// Every ledger names itself in the trail. On a construction site a
// certification decides a payment and a status change decides whether a flat
// can be sold, so these are precisely the writes worth being able to look up
// later — and until now not one of them was recorded.
export const items = collection(KEYS.items, 'material')
export const movements = collection(KEYS.movements, 'movement')
// A physical verification. Named in the trail because a count is the one row
// in the stores ledger that somebody stood in a godown to produce, and the
// adjustment it justifies is worth being able to trace back to it.
export const stockCounts = collection(KEYS.stockCounts, 'stock count')
export const advances = collection(KEYS.advances, 'advance')
export const adjustments = collection(KEYS.adjustments, 'adjustment')
export const employees = collection(KEYS.employees, 'employee')
// A month that has been run. Named in the trail because approving one commits
// the money and marking it paid closes it — two writes worth being able to look
// up later.
export const payrollRuns = collection(KEYS.payrollRuns, 'payroll run')
export const projects = collection(KEYS.projects, 'site')
export const quotes = collection(KEYS.quotes, 'quotation')
export const muster = collection(KEYS.muster, 'muster')
export const workOrders = collection(KEYS.workOrders, 'workorder')
export const raBills = collection(KEYS.raBills, 'rabill')
export const workItems = collection(KEYS.workItems, 'workitem')
export const measurements = collection(KEYS.measurements, 'measurement')
export const plant = collection(KEYS.plant, 'plant')
export const plantLogs = collection(KEYS.plantLogs, 'plantlog')
export const units = collection(KEYS.units, 'unit')
export const planStages = collection(KEYS.planStages, 'instalment')
export const receipts = collection(KEYS.receipts, 'receipt')

// Every ledger by name, so whatever is carrying changes between devices can
// walk them without a second list that drifts out of step with the first.
export const collections = {
  entities: { list: (e, o) => listEntities().filter((r) => (!e || r.id === e) && (o?.withDeleted || !r.deleted_at)), replaceAll: (rows) => write(KEYS.entities, rows) },
  members: { list: (e, o) => listMembers(e).filter((r) => o?.withDeleted || !r.deleted_at), replaceAll: (rows) => write(KEYS.members, rows) },
  departments: { list: (e, o) => listDepartments(e).filter((r) => o?.withDeleted || !r.deleted_at), replaceAll: (rows) => write(KEYS.departments, rows) },
  audit: { list: () => read(KEYS.audit), replaceAll: (rows) => write(KEYS.audit, rows) },
  items, movements, stockCounts, quotes, projects, muster, workOrders, raBills,
  workItems, measurements, plant, plantLogs, units, planStages, receipts,
  advances, adjustments, employees, payrollRuns,
}

// ── Whole-account helpers ──────────────────────────────────────────
export function exportCorporate() {
  const out = {}
  for (const [name, key] of Object.entries(KEYS)) {
    if (name === 'active') continue
    out[name] = name === 'policy' ? readOne(key, {}) : read(key)
  }
  return out
}

// The other half of exportCorporate, and the reason it exists: a backup that
// can only be written is not a backup. Merged by id rather than replacing, so
// restoring the same file twice adds nothing the second time and a row's
// relationships — a movement's item, an adjustment's advance — survive intact.
export function importCorporate(data) {
  if (!data || typeof data !== 'object') return { added: 0, skipped: 0 }
  let added = 0
  let skipped = 0
  for (const [name, key] of Object.entries(KEYS)) {
    if (name === 'active') continue
    const incoming = data[name]
    if (name === 'policy') {
      if (!incoming || typeof incoming !== 'object') continue
      const current = readOne(key, {})
      // A policy already set here wins: it is what this install is running on.
      write(key, { ...incoming, ...current })
      continue
    }
    if (!Array.isArray(incoming)) continue
    const current = read(key)
    const seen = new Set(current.map((r) => r?.id))
    const merged = current.slice()
    for (const row of incoming) {
      if (!row || typeof row !== 'object' || !row.id) { skipped += 1; continue }
      if (seen.has(row.id)) { skipped += 1; continue }
      seen.add(row.id)
      merged.push(row)
      added += 1
    }
    if (merged.length !== current.length) write(key, merged)
  }
  return { added, skipped }
}

export function hasCorporateData() {
  return read(KEYS.entities).length > 0
}

// Turning the corporate side off again: the personal books are untouched.
export function clearCorporate() {
  for (const key of Object.values(KEYS)) {
    try {
      localStorage.removeItem(key)
    } catch {
      /* nothing to do */
    }
  }
}
