// The corporate layer: several legal entities under one login.
//
// A personal Offset account owns its own rows. A company doesn't work that way:
// the books belong to an *entity* (a registered company), a person is a member
// of that entity with a role, and the finance team wants to see one entity at a
// time and then all of them added up. That shape is what everything here
// serves — entities, who may do what inside them, which department a cost
// lands in, and which spending needs a second pair of eyes.
//
// Deliberately pure: no React, no storage, no network. It is the part that has
// to be right, so it is the part that can be tested without a browser.

// ── Entities ───────────────────────────────────────────────────────
// A legal entity: the thing that files its own return. "Consolidated" is not an
// entity — it is the view across all of them, and it is read-only by
// definition, because you cannot book a cost against a group.
export const CONSOLIDATED = '__all__'

// Your own books, kept even after the first company exists. A landlord who
// incorporates does not stop owning the flat they live in, and the two sets of
// books are not the same set of books — so which one you are looking at is a
// choice, not something inferred from whether a company happens to exist.
export const PERSONAL = '__personal__'

export const isConsolidated = (id) => id === CONSOLIDATED
export const isPersonal = (id) => id === PERSONAL

export function makeEntity({ id, name, registration = '', gstin = '', currency = 'INR', fyStartMonth = 4 } = {}) {
  return {
    id: id || newId(),
    name: (name || 'Untitled company').trim().slice(0, 120),
    registration: registration.trim(),
    gstin: gstin.trim().toUpperCase(),
    currency,
    // India's financial year starts in April; a subsidiary abroad may not.
    fyStartMonth: Math.min(12, Math.max(1, Number(fyStartMonth) || 4)),
    created_at: new Date().toISOString(),
  }
}

function newId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

// ── Roles ──────────────────────────────────────────────────────────
// Four roles, because that is what a finance function actually has. More would
// be configuration nobody sets up; fewer and the approver has to be an admin.
export const ROLES = {
  owner: {
    id: 'owner',
    label: 'Owner',
    hint: 'Full control, including the entity itself and who belongs to it.',
    rank: 4,
  },
  finance: {
    id: 'finance',
    label: 'Finance',
    hint: 'Books, budgets and approvals. Cannot remove the entity or its owners.',
    rank: 3,
  },
  member: {
    id: 'member',
    label: 'Member',
    hint: 'Logs spending against their own department. Cannot approve it.',
    rank: 2,
  },
  auditor: {
    id: 'auditor',
    label: 'Auditor',
    hint: 'Sees everything, changes nothing — for an accountant or a reviewer.',
    rank: 1,
  },
}

export const ROLE_IDS = Object.keys(ROLES)
export const roleLabel = (id) => ROLES[id]?.label || 'Member'

// Every distinct thing a person can attempt. Keeping them named — rather than
// checking `role === 'finance'` at each call site — is what stops the rules
// drifting apart as the app grows.
export const PERMISSIONS = {
  owner:   ['view', 'export', 'entry.create', 'entry.edit.own', 'entry.edit.any', 'entry.delete', 'asset.manage', 'budget.manage', 'department.manage', 'approve', 'member.manage', 'entity.manage', 'audit.view'],
  finance: ['view', 'export', 'entry.create', 'entry.edit.own', 'entry.edit.any', 'entry.delete', 'asset.manage', 'budget.manage', 'department.manage', 'approve', 'audit.view'],
  member:  ['view', 'export', 'entry.create', 'entry.edit.own'],
  auditor: ['view', 'export', 'audit.view'],
}

export function can(role, permission) {
  return (PERMISSIONS[role] || []).includes(permission)
}

// Editing an entry is two different questions depending on whose it is, and on
// whether it has already been approved — an approved cost is a record, not a
// draft, so nobody edits it back into a different number.
export function canEditEntry(role, entry, userId) {
  if (entry?.approval_status === 'approved' && !can(role, 'entry.edit.any')) return false
  if (can(role, 'entry.edit.any')) return true
  if (!can(role, 'entry.edit.own')) return false
  return Boolean(userId) && entry?.created_by === userId
}

// A consolidated view spans entities that each have their own rules, so it is
// read-only. Anything else defers to the role.
export function canWriteIn(entityId, role) {
  if (isConsolidated(entityId)) return false
  return can(role, 'entry.create')
}

// ── Departments / cost centres ─────────────────────────────────────
export function makeDepartment({ id, entityId, name, code = '', budgetMonthly = 0, parentId = null } = {}) {
  return {
    id: id || newId(),
    entity_id: entityId,
    name: (name || 'Untitled').trim().slice(0, 80),
    // A short code is what appears in exports and what accountants actually
    // type; the name is for humans.
    code: code.trim().toUpperCase().slice(0, 12),
    budget_monthly: Math.max(0, Number(budgetMonthly) || 0),
    parent_id: parentId,
    created_at: new Date().toISOString(),
  }
}

// Departments nest one level in most companies and arbitrarily deep in a few.
// Rolling a cost up to its ancestors is what makes a divisional report add up.
export function departmentPath(departments, id) {
  const byId = new Map(departments.map((d) => [d.id, d]))
  const path = []
  let cur = byId.get(id)
  const seen = new Set()
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id)
    path.unshift(cur)
    cur = cur.parent_id ? byId.get(cur.parent_id) : null
  }
  return path
}

export const departmentLabel = (departments, id) =>
  departmentPath(departments, id).map((d) => d.name).join(' › ') || ''

// Every department at or below the given one, so a divisional total includes
// the teams inside it.
export function departmentSubtree(departments, id) {
  const children = new Map()
  for (const d of departments) {
    if (!children.has(d.parent_id)) children.set(d.parent_id, [])
    children.get(d.parent_id).push(d)
  }
  const out = []
  const walk = (nodeId) => {
    out.push(nodeId)
    for (const c of children.get(nodeId) || []) walk(c.id)
  }
  walk(id)
  return out
}

// ── Approvals ──────────────────────────────────────────────────────
// The rule a company actually states: anything over X needs sign-off, and
// certain categories always do regardless of size.
export function makeApprovalPolicy({ threshold = 0, alwaysCategories = [], enabled = false } = {}) {
  return {
    enabled: Boolean(enabled),
    threshold: Math.max(0, Number(threshold) || 0),
    alwaysCategories: [...new Set(alwaysCategories.filter(Boolean))],
  }
}

export const APPROVAL_STATUS = { none: 'none', pending: 'pending', approved: 'approved', rejected: 'rejected' }

export function needsApproval(entry, policy) {
  if (!policy?.enabled) return false
  const amount = Math.abs(Number(entry?.amount) || 0)
  if (policy.alwaysCategories.includes(entry?.category)) return true
  // A threshold of zero means everything needs sign-off, which is a legitimate
  // (if strict) policy — so compare inclusively only when it is above zero.
  return policy.threshold === 0 ? true : amount >= policy.threshold
}

export function initialApprovalStatus(entry, policy) {
  return needsApproval(entry, policy) ? APPROVAL_STATUS.pending : APPROVAL_STATUS.none
}

// Who may sign this off. Not the person who raised it, however senior — that is
// the whole point of an approval.
export function canApprove(role, entry, userId) {
  if (!can(role, 'approve')) return false
  if (entry?.approval_status !== APPROVAL_STATUS.pending) return false
  return entry?.created_by !== userId
}

export function whyCannotApprove(role, entry, userId) {
  if (!can(role, 'approve')) return 'Your role can’t approve spending.'
  if (entry?.approval_status !== APPROVAL_STATUS.pending) return 'This isn’t waiting for approval.'
  if (entry?.created_by === userId) return 'You can’t approve your own entry.'
  return ''
}

// Pending spend is committed money that hasn't cleared a control yet, so it is
// reported apart from what has actually been approved.
export function splitByApproval(entries) {
  const out = { approved: [], pending: [], rejected: [], none: [] }
  for (const e of entries) {
    const s = e.approval_status || APPROVAL_STATUS.none
    ;(out[s] || out.none).push(e)
  }
  return out
}

export const sumAmount = (rows) => rows.reduce((total, r) => total + (Number(r.amount) || 0), 0)

// ── Consolidation ──────────────────────────────────────────────────
// The number a group finance director asks for: each entity's own figures, and
// the total. Entities in another currency are reported separately rather than
// added in at an invented rate — a wrong consolidated total is worse than an
// incomplete one.
export function consolidate({ entities, expenses, income, baseCurrency = 'INR' }) {
  const byEntity = entities.map((entity) => {
    const exp = expenses.filter((e) => e.entity_id === entity.id)
    const inc = income.filter((r) => r.entity_id === entity.id)
    const spent = sumAmount(exp)
    const earned = sumAmount(inc)
    return {
      entity,
      expenses: spent,
      income: earned,
      net: earned - spent,
      entries: exp.length + inc.length,
      comparable: (entity.currency || baseCurrency) === baseCurrency,
    }
  })

  const comparable = byEntity.filter((r) => r.comparable)
  const excluded = byEntity.filter((r) => !r.comparable)

  return {
    byEntity,
    total: {
      expenses: comparable.reduce((t, r) => t + r.expenses, 0),
      income: comparable.reduce((t, r) => t + r.income, 0),
      net: comparable.reduce((t, r) => t + r.net, 0),
      entities: comparable.length,
    },
    // Named, not silently dropped, so nobody reads the total as "everything".
    excluded: excluded.map((r) => ({ id: r.entity.id, name: r.entity.name, currency: r.entity.currency })),
    baseCurrency,
  }
}

// ── Audit ──────────────────────────────────────────────────────────
// What a company needs when someone asks "who changed this, and when".
export const AUDIT_ACTIONS = {
  'entry.create': 'created an entry',
  'entry.update': 'edited an entry',
  'entry.delete': 'deleted an entry',
  'entry.approve': 'approved an entry',
  'entry.reject': 'rejected an entry',
  'asset.create': 'added an asset',
  'asset.update': 'edited an asset',
  'asset.delete': 'deleted an asset',
  'member.add': 'added a member',
  'member.role': 'changed a member’s role',
  'member.remove': 'removed a member',
  'entity.create': 'created a company',
  'entity.update': 'edited a company',
  'department.create': 'added a department',
  'department.update': 'edited a department',
  'department.delete': 'removed a department',
  'policy.update': 'changed the approval policy',
}

export function makeAuditEvent({ entityId, actorId, actorEmail, action, targetId = null, summary = '', detail = null }) {
  return {
    id: newId(),
    entity_id: entityId,
    actor_id: actorId,
    actor_email: actorEmail || '',
    action,
    target_id: targetId,
    summary: summary || AUDIT_ACTIONS[action] || action,
    detail,
    at: new Date().toISOString(),
  }
}

export function describeAuditEvent(event) {
  const who = event.actor_email || 'Someone'
  return `${who} ${AUDIT_ACTIONS[event.action] || event.action}${event.summary && !AUDIT_ACTIONS[event.action] ? '' : ''}`
}

// ── Membership ─────────────────────────────────────────────────────
export function makeMember({ id, entityId, userId, email, role = 'member', departmentId = null } = {}) {
  return {
    id: id || newId(),
    entity_id: entityId,
    user_id: userId || null,
    email: (email || '').trim().toLowerCase(),
    role: ROLE_IDS.includes(role) ? role : 'member',
    department_id: departmentId,
    created_at: new Date().toISOString(),
  }
}

export function roleFor(members, entityId, userId) {
  const m = members.find((x) => x.entity_id === entityId && x.user_id === userId)
  return m?.role || null
}

// An entity must keep at least one owner, or nobody can ever administer it
// again — a mistake that needs a database fix rather than a click.
export function canRemoveMember(members, entityId, memberId) {
  const inEntity = members.filter((m) => m.entity_id === entityId)
  const target = inEntity.find((m) => m.id === memberId)
  if (!target) return { ok: false, why: 'That member isn’t in this company.' }
  if (target.role !== 'owner') return { ok: true, why: '' }
  const owners = inEntity.filter((m) => m.role === 'owner')
  if (owners.length <= 1) return { ok: false, why: 'A company needs at least one owner.' }
  return { ok: true, why: '' }
}

export function canChangeRole(members, entityId, memberId, nextRole) {
  if (!ROLE_IDS.includes(nextRole)) return { ok: false, why: 'Unknown role.' }
  const inEntity = members.filter((m) => m.entity_id === entityId)
  const target = inEntity.find((m) => m.id === memberId)
  if (!target) return { ok: false, why: 'That member isn’t in this company.' }
  if (target.role === 'owner' && nextRole !== 'owner') {
    const owners = inEntity.filter((m) => m.role === 'owner')
    if (owners.length <= 1) return { ok: false, why: 'A company needs at least one owner.' }
  }
  return { ok: true, why: '' }
}
