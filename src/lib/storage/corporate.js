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
  canRemoveMember, canChangeRole,
} from '../corporate'

const KEYS = {
  entities: 'pl_corp_entities',
  members: 'pl_corp_members',
  departments: 'pl_corp_departments',
  policy: 'pl_corp_policy',
  audit: 'pl_corp_audit',
  active: 'pl_corp_active',
  items: 'pl_corp_items',
  movements: 'pl_corp_movements',
  advances: 'pl_corp_advances',
  adjustments: 'pl_corp_adjustments',
  employees: 'pl_corp_employees',
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
const collection = (key, action) => ({
  list: (entityId = null) => read(key).filter((r) => !entityId || r.entity_id === entityId),
  add: (row, actor) => {
    write(key, [...read(key), row])
    if (action) audit(actor, row.entity_id, action, row.id, null)
    return row
  },
  update: (id, patch) => {
    const list = read(key).map((r) => (r.id === id ? { ...r, ...patch, id: r.id } : r))
    write(key, list)
    return list.find((r) => r.id === id)
  },
  remove: (id) => write(key, read(key).filter((r) => r.id !== id)),
})

export const items = collection(KEYS.items)
export const movements = collection(KEYS.movements)
export const advances = collection(KEYS.advances)
export const adjustments = collection(KEYS.adjustments)
export const employees = collection(KEYS.employees)

// ── Whole-account helpers ──────────────────────────────────────────
export function exportCorporate() {
  const out = {}
  for (const [name, key] of Object.entries(KEYS)) {
    if (name === 'active') continue
    out[name] = name === 'policy' ? readOne(key, {}) : read(key)
  }
  return out
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
