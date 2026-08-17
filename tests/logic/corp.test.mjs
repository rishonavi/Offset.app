// The corporate rules: who may do what, where a cost lands, what needs
// sign-off, and what a consolidated total is allowed to claim.
import {
  CONSOLIDATED, isConsolidated, makeEntity, ROLES, ROLE_IDS, roleLabel, can, canEditEntry, canWriteIn,
  makeDepartment, departmentPath, departmentLabel, departmentSubtree,
  makeApprovalPolicy, APPROVAL_STATUS, needsApproval, initialApprovalStatus, canApprove, whyCannotApprove,
  splitByApproval, sumAmount, consolidate, makeAuditEvent, AUDIT_ACTIONS,
  makeMember, roleFor, canRemoveMember, canChangeRole,
} from '../../src/lib/corporate.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

console.log('\n── ENTITIES ──')
const acme = makeEntity({ name: 'Acme Industries Pvt Ltd', gstin: '27aaapa1234a1z5', currency: 'INR' })
ok('an entity gets an id', Boolean(acme.id))
eq('the GSTIN is normalised', acme.gstin, '27AAAPA1234A1Z5')
eq('the financial year defaults to April', acme.fyStartMonth, 4)
eq('a nameless entity still has a name', makeEntity({}).name, 'Untitled company')
eq('an out-of-range FY month is clamped', makeEntity({ fyStartMonth: 99 }).fyStartMonth, 12)
eq('a zero FY month is clamped up', makeEntity({ fyStartMonth: 0 }).fyStartMonth, 4)
ok('two entities never share an id', makeEntity({}).id !== makeEntity({}).id)
ok('the consolidated view is not an entity', isConsolidated(CONSOLIDATED) && !isConsolidated(acme.id))

console.log('\n── ROLES ──')
eq('there are four roles', ROLE_IDS.length, 4)
ok('every role has a label and a hint', ROLE_IDS.every((r) => ROLES[r].label && ROLES[r].hint))
eq('an unknown role reads as Member', roleLabel('nonsense'), 'Member')
ok('an owner can manage members', can('owner', 'member.manage'))
ok('finance cannot manage members', !can('finance', 'member.manage'))
ok('finance can approve', can('finance', 'approve'))
ok('a member cannot approve', !can('member', 'approve'))
ok('a member can create entries', can('member', 'entry.create'))
ok('an auditor cannot create entries', !can('auditor', 'entry.create'))
ok('an auditor can still export', can('auditor', 'export'))
ok('an auditor can read the audit log', can('auditor', 'audit.view'))
ok('a member cannot read the audit log', !can('member', 'audit.view'))
ok('only the owner manages the entity', can('owner', 'entity.manage') && !can('finance', 'entity.manage'))
ok('an unknown role can do nothing', !can('intern', 'view'))

console.log('\n── EDITING AN ENTRY ──')
const mine = { id: 'e1', created_by: 'u1', approval_status: 'none' }
const theirs = { id: 'e2', created_by: 'u2', approval_status: 'none' }
const settled = { id: 'e3', created_by: 'u1', approval_status: 'approved' }
ok('a member may edit their own entry', canEditEntry('member', mine, 'u1'))
ok('a member may not edit someone else’s', !canEditEntry('member', theirs, 'u1'))
ok('finance may edit anyone’s', canEditEntry('finance', theirs, 'u1'))
ok('an auditor may edit nothing', !canEditEntry('auditor', mine, 'u1'))
ok('a member may not edit their own once approved', !canEditEntry('member', settled, 'u1'))
ok('finance may still correct an approved entry', canEditEntry('finance', settled, 'u1'))
ok('an unsigned-in user edits nothing', !canEditEntry('member', mine, null))

console.log('\n── WRITING, AND THE CONSOLIDATED VIEW ──')
ok('a member can write inside an entity', canWriteIn('ent1', 'member'))
ok('nobody writes to the consolidated view', !canWriteIn(CONSOLIDATED, 'owner'))
ok('not even an owner', !canWriteIn(CONSOLIDATED, 'owner'))
ok('an auditor cannot write anywhere', !canWriteIn('ent1', 'auditor'))

console.log('\n── DEPARTMENTS ──')
const ops = makeDepartment({ entityId: 'e', name: 'Operations', code: 'ops' })
const mum = makeDepartment({ entityId: 'e', name: 'Mumbai', parentId: ops.id })
const site = makeDepartment({ entityId: 'e', name: 'Site A', parentId: mum.id })
const hr = makeDepartment({ entityId: 'e', name: 'People', code: 'HR' })
const tree = [ops, mum, site, hr]
eq('the code is upper-cased', ops.code, 'OPS')
eq('a long code is trimmed', makeDepartment({ name: 'x', code: 'A'.repeat(40) }).code.length, 12)
eq('a negative budget becomes zero', makeDepartment({ name: 'x', budgetMonthly: -5 }).budget_monthly, 0)
eq('a path reads from the top down', departmentLabel(tree, site.id), 'Operations › Mumbai › Site A')
eq('a top-level department is its own path', departmentLabel(tree, hr.id), 'People')
eq('an unknown department has no path', departmentLabel(tree, 'nope'), '')
eq('a subtree includes the department itself', departmentSubtree(tree, site.id), [site.id])
eq('a subtree includes descendants', departmentSubtree(tree, ops.id).sort(), [ops.id, mum.id, site.id].sort())
eq('a sibling branch is excluded', departmentSubtree(tree, hr.id), [hr.id])
// A cycle would hang a naive walk; a hand-edited export could contain one.
const a = makeDepartment({ name: 'A' }), bDept = makeDepartment({ name: 'B' })
a.parent_id = bDept.id; bDept.parent_id = a.id
ok('a cyclic parent chain terminates', departmentPath([a, bDept], a.id).length <= 2)

console.log('\n── APPROVAL POLICY ──')
const off = makeApprovalPolicy({ enabled: false, threshold: 10000 })
const over10k = makeApprovalPolicy({ enabled: true, threshold: 10000 })
const always = makeApprovalPolicy({ enabled: true, threshold: 0 })
const byCat = makeApprovalPolicy({ enabled: true, threshold: 1e9, alwaysCategories: ['Legal', 'Consulting'] })
ok('with the policy off nothing needs approval', !needsApproval({ amount: 1e6 }, off))
ok('over the threshold needs approval', needsApproval({ amount: 25000 }, over10k))
ok('exactly at the threshold needs approval', needsApproval({ amount: 10000 }, over10k))
ok('under the threshold does not', !needsApproval({ amount: 9999 }, over10k))
ok('a zero threshold catches everything', needsApproval({ amount: 1 }, always))
ok('and catches a zero-value entry too', needsApproval({ amount: 0 }, always))
ok('a flagged category always needs approval', needsApproval({ amount: 5, category: 'Legal' }, byCat))
ok('an unflagged category under the threshold does not', !needsApproval({ amount: 5, category: 'Utilities' }, byCat))
ok('a credit note is judged on size, not sign', needsApproval({ amount: -25000 }, over10k))
ok('a missing amount is treated as zero', !needsApproval({}, over10k))
eq('a new entry over the threshold starts pending', initialApprovalStatus({ amount: 20000 }, over10k), APPROVAL_STATUS.pending)
eq('a small one needs nothing', initialApprovalStatus({ amount: 20 }, over10k), APPROVAL_STATUS.none)
eq('duplicate flagged categories are de-duplicated', makeApprovalPolicy({ alwaysCategories: ['A', 'A', ''] }).alwaysCategories, ['A'])

console.log('\n── WHO MAY APPROVE ──')
const pending = { amount: 50000, created_by: 'u2', approval_status: 'pending' }
ok('finance may approve someone else’s', canApprove('finance', pending, 'u1'))
ok('an owner may approve', canApprove('owner', pending, 'u1'))
ok('a member may not', !canApprove('member', pending, 'u1'))
ok('an auditor may not', !canApprove('auditor', pending, 'u1'))
ok('nobody approves their own, however senior',
  !canApprove('owner', { ...pending, created_by: 'u1' }, 'u1'))
ok('an already-approved entry cannot be approved again',
  !canApprove('finance', { ...pending, approval_status: 'approved' }, 'u1'))
ok('a rejected entry is not pending', !canApprove('finance', { ...pending, approval_status: 'rejected' }, 'u1'))
ok('the refusal explains itself', /own entry/.test(whyCannotApprove('owner', { ...pending, created_by: 'u1' }, 'u1')))
ok('a role refusal explains itself', /role/.test(whyCannotApprove('member', pending, 'u1')))
eq('an approvable entry has nothing to explain', whyCannotApprove('finance', pending, 'u1'), '')

console.log('\n── PENDING VS APPROVED ──')
const mixed = [
  { amount: 100, approval_status: 'approved' },
  { amount: 200, approval_status: 'pending' },
  { amount: 300, approval_status: 'rejected' },
  { amount: 400 },
]
const split = splitByApproval(mixed)
eq('approved is separated', sumAmount(split.approved), 100)
eq('pending is separated', sumAmount(split.pending), 200)
eq('rejected is separated', sumAmount(split.rejected), 300)
eq('an entry with no status is not lost', sumAmount(split.none), 400)
eq('nothing is double-counted',
  split.approved.length + split.pending.length + split.rejected.length + split.none.length, mixed.length)
eq('an unknown status falls into none', splitByApproval([{ amount: 5, approval_status: 'weird' }]).none.length, 1)

console.log('\n── CONSOLIDATION ──')
const in1 = makeEntity({ id: 'a', name: 'Acme India', currency: 'INR' })
const in2 = makeEntity({ id: 'b', name: 'Acme Logistics', currency: 'INR' })
const uk = makeEntity({ id: 'c', name: 'Acme UK', currency: 'GBP' })
const con = consolidate({
  entities: [in1, in2, uk],
  expenses: [
    { entity_id: 'a', amount: 1000 }, { entity_id: 'a', amount: 500 },
    { entity_id: 'b', amount: 250 },
    { entity_id: 'c', amount: 900 },
  ],
  income: [
    { entity_id: 'a', amount: 4000 },
    { entity_id: 'b', amount: 1000 },
    { entity_id: 'c', amount: 8000 },
  ],
  baseCurrency: 'INR',
})
eq('each entity is reported', con.byEntity.length, 3)
eq('an entity’s own spend is its own', con.byEntity[0].expenses, 1500)
eq('and its own net', con.byEntity[0].net, 2500)
eq('the total adds the comparable entities', con.total.expenses, 1750)
eq('income totals too', con.total.income, 5000)
eq('the net follows', con.total.net, 3250)
eq('only comparable entities are counted', con.total.entities, 2)
eq('a foreign-currency entity is named, not silently dropped', con.excluded.map((e) => e.name), ['Acme UK'])
ok('and its figures are still shown on its own line', con.byEntity[2].income === 8000)
ok('the excluded entity is flagged as not comparable', con.byEntity[2].comparable === false)
const none = consolidate({ entities: [], expenses: [], income: [] })
eq('no entities means a zero total', none.total.net, 0)
eq('and nothing excluded', none.excluded, [])
const orphan = consolidate({ entities: [in1], expenses: [{ entity_id: 'gone', amount: 999 }], income: [] })
eq('an entry pointing at no entity is not counted', orphan.total.expenses, 0)

console.log('\n── MEMBERS ──')
const owner1 = makeMember({ entityId: 'a', userId: 'u1', email: 'A@Example.com ', role: 'owner' })
const owner2 = makeMember({ entityId: 'a', userId: 'u2', role: 'owner' })
const fin = makeMember({ entityId: 'a', userId: 'u3', role: 'finance' })
const other = makeMember({ entityId: 'b', userId: 'u1', role: 'member' })
eq('the email is normalised', owner1.email, 'a@example.com')
eq('an unknown role becomes member', makeMember({ role: 'wizard' }).role, 'member')
eq('a role is read per entity', roleFor([owner1, other], 'b', 'u1'), 'member')
eq('and is null where there is no membership', roleFor([owner1], 'zzz', 'u1'), null)
ok('the last owner cannot be removed', !canRemoveMember([owner1, fin], 'a', owner1.id).ok)
ok('and the refusal says why', /at least one owner/.test(canRemoveMember([owner1, fin], 'a', owner1.id).why))
ok('a second owner makes the first removable', canRemoveMember([owner1, owner2, fin], 'a', owner1.id).ok)
ok('a non-owner is always removable', canRemoveMember([owner1, fin], 'a', fin.id).ok)
ok('removing someone from another company is refused', !canRemoveMember([owner1], 'zzz', owner1.id).ok)
ok('the last owner cannot be demoted', !canChangeRole([owner1, fin], 'a', owner1.id, 'finance').ok)
ok('but may be re-set as owner', canChangeRole([owner1, fin], 'a', owner1.id, 'owner').ok)
ok('with two owners a demotion is allowed', canChangeRole([owner1, owner2], 'a', owner1.id, 'finance').ok)
ok('an unknown role is refused', !canChangeRole([owner1, owner2], 'a', owner1.id, 'wizard').ok)

console.log('\n── AUDIT ──')
const ev = makeAuditEvent({ entityId: 'a', actorId: 'u1', actorEmail: 'a@b.co', action: 'entry.approve', targetId: 'e9' })
ok('an event has an id', Boolean(ev.id))
ok('it records who', ev.actor_email === 'a@b.co' && ev.actor_id === 'u1')
ok('it records what', ev.action === 'entry.approve')
ok('it records when', !Number.isNaN(Date.parse(ev.at)))
ok('it records which entity', ev.entity_id === 'a')
ok('it summarises in plain words', /approved/.test(ev.summary), ev.summary)
ok('every audit action has wording', Object.values(AUDIT_ACTIONS).every((v) => v && v.length > 3))
ok('an unknown action still produces a usable event',
  Boolean(makeAuditEvent({ entityId: 'a', actorId: 'u', action: 'weird.thing' }).summary))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
