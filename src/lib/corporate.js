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

export function makeEntity({ id, name, registration = '', gstin = '', currency = 'INR', fyStartMonth = 4, booksLockedThrough = '', pfRegistered = null, esiRegistered = null, ptState = '', ptSlabs = null, bonusRate = null, minimumWage = null, gratuityVoluntary = false, bonusVoluntary = false } = {}) {
  return {
    id: id || newId(),
    name: (name || 'Untitled company').trim().slice(0, 120),
    registration: registration.trim(),
    gstin: gstin.trim().toUpperCase(),
    currency,
    // India's financial year starts in April; a subsidiary abroad may not.
    //
    // Snake case because the column is `fy_start_month` and rows are pushed
    // key by key: this was the one camelCase field in an otherwise snake_case
    // row, and the server would have refused every entity carrying it. Rows
    // already written locally keep the old spelling, so readers take either.
    fy_start_month: Math.min(12, Math.max(1, Number(fyStartMonth) || 4)),
    // The month the books are closed through, as YYYY-MM, or null. A single
    // line rather than a table of month flags: you do not close March and leave
    // February open, and letting somebody do that produces a year whose parts
    // nobody can add up.
    books_locked_through: /^\d{4}-(0[1-9]|1[0-2])$/.test(String(booksLockedThrough || ''))
      ? String(booksLockedThrough)
      : null,
    // Whether the company is registered under the provident fund and state
    // insurance Acts. Three answers, not two: null means nobody has said, and
    // that is different from "no". Deducting twelve per cent from every payslip
    // because a default said true is what these replace.
    pf_registered: pfRegistered === true ? true : pfRegistered === false ? false : null,
    esi_registered: esiRegistered === true ? true : esiRegistered === false ? false : null,
    // Which state's professional tax, as a GST state code. Null rather than a
    // default, because the default used to be Maharashtra's slabs for every
    // company in the country — including the fourteen states that levy none.
    // Blank means read it off the GSTIN, whose first two digits are the state.
    pt_state: String(ptState || '').trim() || null,
    // The company's own slabs, where its state revised them or the app does not
    // carry that state. Null means use the built-in table.
    pt_slabs: Array.isArray(ptSlabs) && ptSlabs.length ? ptSlabs : null,
    // What the company pays as bonus, between the 8.33% the Act imposes and the
    // 20% it allows. Null is not 8.33: nobody having chosen is a decision not
    // taken, and the minimum is what the law would settle for rather than what
    // the company decided.
    bonus_rate: bonusRate == null || bonusRate === '' ? null : Math.min(20, Math.max(8.33, Number(bonusRate) || 8.33)),
    // The minimum wage for the work, which decides what bonus is computed on
    // where it is above ₹7,000. It is per state and per scheduled employment,
    // revised twice a year in most states, and construction has its own
    // schedule — so it is asked for rather than built in and wrong by June.
    minimum_wage: minimumWage == null || minimumWage === '' ? null : Math.max(0, Number(minimumWage) || 0),
    // Under the thresholds neither Act applies, and plenty of small firms pay
    // both anyway. A promise made is owed whatever the Act says, so it has to
    // be possible to say so.
    gratuity_voluntary: gratuityVoluntary === true,
    bonus_voluntary: bonusVoluntary === true,
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
  // The same guard `departmentPath` has, and for a reason that is not
  // hypothetical: without it a cycle — A inside B inside A — recurses until the
  // stack gives out. The form cannot make one, because a department picks its
  // parent from the ones that already exist, but a cycle can still arrive from
  // another device, a restored backup or a hand-edited store. One bad row must
  // not take down the dashboard and the report, which is what it did once this
  // walk started feeding the cost-centre figures on both.
  const seen = new Set()
  const walk = (nodeId) => {
    if (seen.has(nodeId)) return
    seen.add(nodeId)
    out.push(nodeId)
    for (const c of children.get(nodeId) || []) walk(c.id)
  }
  walk(id)
  return out
}

// ── Approvals ──────────────────────────────────────────────────────
// The rule a company actually states: anything over X needs sign-off, and
// certain categories always do regardless of size.
// What a second pair of eyes is for: the documents that commit money.
//
// Not everything a company records. A muster roll, a measurement and a plant
// log sheet are observations — somebody writing down what happened — and
// putting them through an approval queue would be bureaucracy that teaches
// people to click Approve without reading. These four are decisions to part
// with money, and each names the field that says how much.
export const APPROVABLE = {
  expense: { id: 'expense', label: 'Bills and expenses', field: 'amount' },
  advance: { id: 'advance', label: 'Advances', field: 'amount' },
  workorder: { id: 'workorder', label: 'Work orders', field: 'order_value' },
  rabill: { id: 'rabill', label: 'Running account bills', field: 'certified_to_date' },
}
export const APPROVABLE_IDS = Object.keys(APPROVABLE)

// The categories that always need signing off, under whichever spelling the
// policy was written with. A policy already in a browser keeps the old one.
export const categoriesOf = (policy) => policy?.always_categories || policy?.alwaysCategories || []

export function makeApprovalPolicy(input = {}) {
  const { threshold = 0, enabled = false, thresholds = {} } = input
  // Either spelling on the way in. The reader re-makes the stored policy on
  // every read, so a maker that only understood its input shape and not its own
  // output silently emptied the category list each time somebody looked at it —
  // which is exactly what it did for one commit, until the round trip caught it.
  const alwaysCategories = categoriesOf(input)
  const base = Math.max(0, Number(threshold) || 0)
  // Per document, because the scales are not comparable. A ₹50,000 expense is
  // unusual enough to look at; a ₹50,000 running account bill is a Tuesday, and
  // one threshold for both means either the bills drown the queue or the
  // expenses walk through it.
  //
  // Only what somebody actually set is kept. Resolving the fallback here
  // instead — writing the base figure into all four — looks equivalent and is
  // not: it freezes them at whatever the base happened to be when the policy
  // was first saved, so turning approvals on before setting a threshold pins
  // every document at zero (meaning everything needs sign-off) and raising the
  // base afterwards changes nothing. Unset has to stay unset, and the fallback
  // happens when the figure is read.
  const per = {}
  for (const kind of APPROVABLE_IDS) {
    const v = thresholds?.[kind]
    if (v === undefined || v === null || v === '') continue
    per[kind] = Math.max(0, Number(v) || 0)
  }
  return {
    enabled: Boolean(enabled),
    threshold: base,
    thresholds: per,
    // Snake case because the column is `always_categories`, and a policy is
    // pushed key by key like every other row. This and `thresholds` were the
    // two fields the wire check could not see, because the policy is one object
    // under its own key rather than a synced collection — so neither would have
    // reached the server, and the per-document thresholds would simply have
    // been lost.
    always_categories: [...new Set(alwaysCategories.filter(Boolean))],
  }
}

export const APPROVAL_STATUS = { none: 'none', pending: 'pending', approved: 'approved', rejected: 'rejected' }

export function needsApproval(entry, policy, kind = 'expense') {
  if (!policy?.enabled) return false
  const doc = APPROVABLE[kind] || APPROVABLE.expense
  const amount = Math.abs(Number(entry?.[doc.field]) || 0)
  // Categories are an expense idea; a running account bill has no category, and
  // a rule that quietly matched one would be a rule nobody could explain.
  if (kind === 'expense' && categoriesOf(policy).includes(entry?.category)) return true
  const limit = policy.thresholds?.[kind] ?? policy.threshold
  // A threshold of zero means everything needs sign-off, which is a legitimate
  // (if strict) policy — so compare inclusively only when it is above zero.
  return limit === 0 ? true : amount >= limit
}

export function initialApprovalStatus(entry, policy, kind = 'expense') {
  return needsApproval(entry, policy, kind) ? APPROVAL_STATUS.pending : APPROVAL_STATUS.none
}

// A rejected document is not a document. A certification somebody refused did
// not certify anything and an advance somebody refused was never paid, so the
// arithmetic has to leave them out — whereas a pending one is a real commitment
// that has not cleared a control yet, and leaving *that* out would report a
// company as owing less than it does.
export const isRefused = (row) => row?.approval_status === APPROVAL_STATUS.rejected
export const isPending = (row) => row?.approval_status === APPROVAL_STATUS.pending

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

// Everything waiting on somebody, across every kind of document, with whether
// *this* person can sign it off.
//
// One queue and not four. An approval that lives on the page where the document
// was raised is an approval nobody finds, and a control nobody finds is a
// control that gets switched off.
export function approvalQueue(groups = [], { role = 'member', userId = null } = {}) {
  const lines = []
  for (const { kind, rows = [] } of groups) {
    for (const row of rows) {
      if (row?.deleted_at) continue
      if (row?.approval_status !== APPROVAL_STATUS.pending) continue
      const doc = APPROVABLE[kind] || APPROVABLE.expense
      lines.push({
        kind,
        doc,
        row,
        amount: Math.abs(Number(row?.[doc.field]) || 0),
        mine: row?.created_by === userId,
        canSign: canApprove(role, row, userId),
        why: whyCannotApprove(role, row, userId),
      })
    }
  }
  lines.sort((a, b) => b.amount - a.amount)
  return {
    lines,
    count: lines.length,
    total: Math.round(lines.reduce((t, l) => t + l.amount, 0) * 100) / 100,
    // What this person can actually clear. The rest is waiting on somebody
    // else, and saying so beats a queue that never empties for the person
    // looking at it.
    mine: lines.filter((l) => l.canSign).length,
    // Raised by the person looking at the queue. They cannot sign these however
    // senior they are, which is the whole point of an approval.
    ownRaised: lines.filter((l) => l.mine).length,
  }
}

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

  // The construction ledgers. A certification decides a payment and a status
  // change decides whether a flat can be sold, so these are the writes most
  // worth being able to look up later.
  'site.create': 'opened a site',
  'site.update': 'edited a site',
  'site.delete': 'removed a site',
  'material.create': 'added a material',
  'material.update': 'edited a material',
  'material.delete': 'removed a material',
  'movement.create': 'recorded a stock movement',
  'movement.update': 'edited a stock movement',
  'movement.delete': 'removed a stock movement',
  'quotation.create': 'filed a quotation',
  'quotation.update': 'changed a quotation',
  'quotation.delete': 'deleted a quotation',
  'muster.create': 'recorded a day’s muster',
  'muster.update': 'edited a day’s muster',
  'muster.delete': 'removed a day’s muster',
  'workorder.create': 'raised a work order',
  'workorder.update': 'changed a work order',
  'workorder.delete': 'removed a work order',
  'rabill.create': 'certified a running account bill',
  'rabill.update': 'changed a running account bill',
  'rabill.delete': 'removed a running account bill',
  'workitem.create': 'added to the schedule of work',
  'workitem.update': 'changed the schedule of work',
  'workitem.delete': 'removed from the schedule of work',
  'measurement.create': 'measured work done',
  'measurement.update': 'corrected a measurement',
  'measurement.delete': 'removed a measurement',
  'plant.create': 'added a machine',
  'plant.update': 'edited a machine',
  'plant.delete': 'removed a machine',
  'plantlog.create': 'recorded a plant log sheet',
  'plantlog.update': 'edited a plant log sheet',
  'plantlog.delete': 'removed a plant log sheet',
  'unit.create': 'added a unit for sale',
  'unit.update': 'changed a unit',
  'unit.delete': 'removed a unit',
  'instalment.create': 'added a payment instalment',
  'instalment.update': 'changed a payment instalment',
  'instalment.delete': 'removed a payment instalment',
  'receipt.create': 'recorded money received',
  'receipt.update': 'changed a receipt',
  'receipt.delete': 'removed a receipt',
  'advance.approve': 'approved an advance',
  'advance.reject': 'refused an advance',
  'workorder.approve': 'approved a work order',
  'workorder.reject': 'refused a work order',
  'rabill.approve': 'approved a running account bill',
  'rabill.reject': 'refused a running account bill',
  'advance.create': 'paid an advance',
  'advance.update': 'edited an advance',
  'advance.delete': 'removed an advance',
  'adjustment.create': 'set an advance against a bill',
  'adjustment.update': 'changed an adjustment',
  'adjustment.delete': 'removed an adjustment',
  'employee.create': 'added an employee',
  'employee.update': 'edited an employee',
  'employee.delete': 'removed an employee',
  // Approving a month commits the money and marking it paid closes it. Both
  // are worth being able to look up a year later, which is the whole reason a
  // run is kept rather than worked out again.
  'payroll run.create': 'ran a month\u2019s payroll',
  'payroll run.update': 'changed a payroll run',
  'payroll run.delete': 'discarded a payroll run',
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
    // `created_at`, not `at`: the column is `created_at`, and an audit trail
    // the server refuses is an audit trail that does not exist.
    created_at: new Date().toISOString(),
  }
}

// When an event happened, whichever spelling the row was written with.
export const auditAt = (event) => event?.created_at || event?.at || ''

// One stored event as a sentence.
//
// The trail on screen renders the actor and the summary itself, and a stored
// event's `summary` already falls back to the action's phrase — so this is for
// anywhere that needs the whole line as a string. Its last clause used to be a
// ternary returning the empty string either way, which is what a half-finished
// thought looks like six months later.
export function describeAuditEvent(event) {
  const who = event?.actor_email || 'Someone'
  const phrase = event?.summary || AUDIT_ACTIONS[event?.action] || event?.action || 'changed something'
  return `${who} ${phrase}`
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
