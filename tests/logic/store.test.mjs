// The corporate storage layer: creating a company, who owns it, what the audit
// log records, and the refusals that protect the books.
import {
  listEntities, createEntity, updateEntity, archiveEntity, activeEntityId, setActiveEntity,
  listMembers, addMember, setMemberRole, removeMember,
  listDepartments, createDepartment, updateDepartment, deleteDepartment,
  approvalPolicy, setApprovalPolicy, listAudit, recordAudit,
  items, movements, advances, employees, exportCorporate, hasCorporateData, clearCorporate,
} from '../../src/lib/storage/corporate.js'
import { makeItem, makeMovement } from '../../src/lib/inventory.js'
import { makeAdvance } from '../../src/lib/advances.js'
import { makeEmployee } from '../../src/lib/payroll.js'
import { makeAuditEvent } from '../../src/lib/corporate.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

const map = new Map()
globalThis.localStorage = {
  getItem: (k) => (map.has(k) ? map.get(k) : null),
  setItem: (k, v) => map.set(k, String(v)),
  removeItem: (k) => map.delete(k),
}
const reset = () => map.clear()
const actor = { id: 'u1', email: 'krish@example.com' }
const other = { id: 'u2', email: 'other@example.com' }

console.log('\n── A FIRST COMPANY ──')
reset()
ok('nothing is there to begin with', !hasCorporateData())
eq('and no entities', listEntities(), [])
const acme = createEntity({ name: 'Acme Industries', gstin: '27AAAPA1234A1Z5' }, actor)
ok('the company exists', hasCorporateData())
eq('and is listed', listEntities().length, 1)
eq('whoever created it owns it', listMembers(acme.id)[0].role, 'owner')
eq('and it is them', listMembers(acme.id)[0].user_id, 'u1')
eq('creating it is audited', listAudit({ entityId: acme.id })[0].action, 'entity.create')
ok('the audit records who', listAudit({ entityId: acme.id })[0].actor_email === 'krish@example.com')

console.log('\n── EDITING AND ARCHIVING ──')
updateEntity(acme.id, { name: 'Acme Industries Pvt Ltd' }, actor)
eq('the name changes', listEntities()[0].name, 'Acme Industries Pvt Ltd')
eq('the id cannot be overwritten', updateEntity(acme.id, { id: 'hacked' }, actor).id, acme.id)
eq('the edit is audited', listAudit({ entityId: acme.id })[0].action, 'entity.update')
const second = createEntity({ name: 'Acme Logistics' }, actor)
archiveEntity(second.id, actor)
ok('an archived company keeps its rows', listEntities().find((e) => e.id === second.id)?.archived_at)
eq('archiving is audited', listAudit({ entityId: second.id })[0].detail.archived, true)

console.log('\n── THE ACTIVE COMPANY ──')
eq('nothing is active at first', activeEntityId(), '')
setActiveEntity(acme.id)
eq('a choice is remembered', activeEntityId(), acme.id)
setActiveEntity('')
eq('and can be cleared', activeEntityId(), '')

console.log('\n── MEMBERS ──')
reset()
const co = createEntity({ name: 'Acme' }, actor)
const fin = addMember({ entityId: co.id, userId: 'u2', email: 'FIN@Example.com', role: 'finance' }, actor)
eq('a member is added', listMembers(co.id).length, 2)
eq('their email is normalised', fin.email, 'fin@example.com')
eq('adding is audited', listAudit({ entityId: co.id })[0].action, 'member.add')
setMemberRole(co.id, fin.id, 'auditor', actor)
eq('a role can change', listMembers(co.id).find((m) => m.id === fin.id).role, 'auditor')
eq('the change is audited', listAudit({ entityId: co.id })[0].action, 'member.role')

const ownerId = listMembers(co.id).find((m) => m.role === 'owner').id
let threw = ''
try { removeMember(co.id, ownerId, actor) } catch (e) { threw = e.message }
ok('the last owner cannot be removed', /at least one owner/.test(threw), threw)
threw = ''
try { setMemberRole(co.id, ownerId, 'member', actor) } catch (e) { threw = e.message }
ok('nor demoted', /at least one owner/.test(threw), threw)
eq('and the books still show them as owner', listMembers(co.id).find((m) => m.id === ownerId).role, 'owner')

addMember({ entityId: co.id, userId: 'u3', role: 'owner' }, actor)
removeMember(co.id, ownerId, actor)
eq('with a second owner the first can go', listMembers(co.id).filter((m) => m.role === 'owner').length, 1)
eq('removal is audited', listAudit({ entityId: co.id })[0].action, 'member.remove')

console.log('\n── DEPARTMENTS ──')
reset()
const ent = createEntity({ name: 'Acme' }, actor)
const ops = createDepartment({ entityId: ent.id, name: 'Operations', code: 'ops' }, actor)
const mum = createDepartment({ entityId: ent.id, name: 'Mumbai', parentId: ops.id }, actor)
eq('departments are listed for their entity', listDepartments(ent.id).length, 2)
eq('another entity sees none of them', listDepartments('elsewhere').length, 0)
updateDepartment(mum.id, { budgetMonthly: 50000, budget_monthly: 50000 }, actor)
eq('a department can be edited', listDepartments(ent.id).find((d) => d.id === mum.id).budget_monthly, 50000)

threw = ''
try { deleteDepartment(ops.id, actor) } catch (e) { threw = e.message }
ok('a department with children cannot be deleted', /inside this one/.test(threw), threw)
threw = ''
try { deleteDepartment(mum.id, actor, { entries: [{ department_id: mum.id }, { department_id: mum.id }] }) } catch (e) { threw = e.message }
ok('nor one with costs booked to it', /2 entries are booked/.test(threw), threw)
deleteDepartment(mum.id, actor, { entries: [] })
eq('an empty leaf department can go', listDepartments(ent.id).length, 1)
eq('deletion is audited', listAudit({ entityId: ent.id })[0].action, 'department.delete')
ok('deleting something that is not there is harmless', (() => { deleteDepartment('nope', actor); return true })())

console.log('\n── APPROVAL POLICY ──')
reset()
const pc = createEntity({ name: 'Acme' }, actor)
eq('no policy means approvals are off', approvalPolicy(pc.id).enabled, false)
setApprovalPolicy(pc.id, { enabled: true, threshold: 25000, alwaysCategories: ['Legal'] }, actor)
eq('a policy is stored', approvalPolicy(pc.id).threshold, 25000)
eq('and its categories', approvalPolicy(pc.id).alwaysCategories, ['Legal'])
eq('setting it is audited', listAudit({ entityId: pc.id })[0].action, 'policy.update')
const pc2 = createEntity({ name: 'Other' }, actor)
eq('each company has its own policy', approvalPolicy(pc2.id).enabled, false)
ok('and the first one is untouched', approvalPolicy(pc.id).enabled)

console.log('\n── THE LEDGERS ──')
reset()
const le = createEntity({ name: 'Acme' }, actor)
const cement = items.add(makeItem({ entityId: le.id, name: 'Cement' }), actor)
items.add(makeItem({ entityId: 'other-co', name: 'Elsewhere' }), actor)
eq('items are scoped to their entity', items.list(le.id).length, 1)
eq('and all of them are listed unscoped', items.list().length, 2)
movements.add(makeMovement({ itemId: cement.id, entityId: le.id, kind: 'receipt', qty: 10, unitCost: 300 }), actor)
eq('a movement is stored', movements.list(le.id).length, 1)
items.update(cement.id, { reorder_level: 5 })
eq('an item can be edited', items.list(le.id)[0].reorder_level, 5)
items.remove(cement.id)
eq('and removed', items.list(le.id).length, 0)
advances.add(makeAdvance({ entityId: le.id, party: 'Sharma', amount: 5000 }), actor)
eq('advances are stored', advances.list(le.id).length, 1)
employees.add(makeEmployee({ entityId: le.id, name: 'R. Mehta', basic: 30000 }), actor)
eq('employees are stored', employees.list(le.id).length, 1)

console.log('\n── THE AUDIT LOG ──')
reset()
const a1 = createEntity({ name: 'One' }, actor)
const a2 = createEntity({ name: 'Two' }, other)
eq('the log is per entity', listAudit({ entityId: a1.id }).length, 1)
eq('and separates companies', listAudit({ entityId: a2.id })[0].actor_email, 'other@example.com')
eq('unfiltered it shows everything', listAudit().length, 2)
eq('newest first', listAudit()[0].entity_id, a2.id)
for (let i = 0; i < 2500; i++) recordAudit(makeAuditEvent({ entityId: a1.id, actorId: 'u1', action: 'entry.create' }))
ok('the log is capped so it cannot fill storage', listAudit({ limit: 5000 }).length <= 2000, String(listAudit({ limit: 5000 }).length))
eq('a limit is respected', listAudit({ limit: 10 }).length, 10)

console.log('\n── EXPORT AND RESET ──')
reset()
const ee = createEntity({ name: 'Acme' }, actor)
createDepartment({ entityId: ee.id, name: 'Ops' }, actor)
setApprovalPolicy(ee.id, { enabled: true, threshold: 100 }, actor)
const dump = exportCorporate()
ok('the export carries entities', dump.entities.length === 1)
ok('and members', dump.members.length === 1)
ok('and departments', dump.departments.length === 1)
ok('and the policy', Boolean(dump.policy[ee.id]))
ok('and the audit trail', dump.audit.length > 0)
ok('the active company is not exported as data', dump.active === undefined)
clearCorporate()
ok('clearing removes the corporate side', !hasCorporateData())
eq('and the audit with it', listAudit().length, 0)

console.log('\n── CORRUPT STORAGE ──')
reset()
map.set('pl_corp_entities', 'garbage{')
eq('a corrupt entity list reads as empty', listEntities(), [])
map.set('pl_corp_entities', '{"not":"an array"}')
eq('a non-array reads as empty', listEntities(), [])
map.set('pl_corp_policy', 'nonsense')
eq('a corrupt policy falls back to off', approvalPolicy('x').enabled, false)
ok('and a company can still be created over it', Boolean(createEntity({ name: 'Recovered' }, actor).id))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
