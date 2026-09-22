import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, Plus, Users, Network, ShieldCheck, Trash2, Archive, Lock, LockOpen, Pencil } from 'lucide-react'
import { useEntity } from '../context/EntityContext'
import { useToast } from '../context/ToastContext'
import { useData } from '../context/DataContext'
import {
  ROLES, ROLE_IDS, roleLabel, departmentLabel, CONSOLIDATED,
  APPROVABLE, APPROVABLE_IDS, approvalQueue, makeEntity,
} from '../lib/corporate'
import * as store from '../lib/storage/corporate'
import { monthsToClose, reopenTo, lockedThrough, describeLock } from '../lib/periods'
import { formatCurrency } from '../lib/format'
import { Card, Button, Field, Input, Select, Textarea, EmptyState } from '../components/ui'
import PageHeader from '../components/PageHeader'
import SyncStatus from '../components/SyncStatus'

// The corporate control panel: the companies themselves, who is in them, how
// they are divided up, and what needs signing off. Everything on this page is
// gated on the role the current user holds in the active company.
const FY_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// The fields a company is, asked the same way whether it is being created or
// corrected. Kept in one place so the two forms cannot drift into asking
// different questions about the same row.
function CompanyFields({ value, onChange, autoFocus = false }) {
  const set = (key, clean = (v) => v) => (e) => onChange({ ...value, [key]: clean(e.target.value) })
  return (
    <>
      <Field label="Registered name" required>
        <Input value={value.name} onChange={set('name')} placeholder="Acme Industries Pvt Ltd" autoFocus={autoFocus} />
      </Field>
      <Field label="GSTIN">
        <Input value={value.gstin} onChange={set('gstin', (v) => v.toUpperCase())} placeholder="27AAAPA1234A1Z5" />
      </Field>
      <Field label="CIN / registration">
        <Input value={value.registration} onChange={set('registration')} />
      </Field>
      <Field label="Reporting currency" hint="Companies in another currency are shown separately, never converted.">
        <Input value={value.currency} onChange={set('currency', (v) => v.toUpperCase().slice(0, 3))} />
      </Field>
      {/* Printed under the company name on the stock statement, the material
          indent and the demand letter. All three read it off the entity and
          nothing ever wrote it, so the line was blank on every document that
          left the building. */}
      <Field label="Registered address" hint="Printed on indents, stock statements and demand letters.">
        <Textarea className="h-16 resize-y" value={value.address} onChange={set('address')} />
      </Field>
      {/* Shown on this page as "FY from month 4" and never askable: the default
          was the only value it could ever hold. A subsidiary on a calendar year
          had its whole year reported three months out. */}
      <Field label="Financial year starts" hint="April in India. A subsidiary abroad may differ.">
        <Select value={String(value.fyStartMonth)} onChange={set('fyStartMonth')}>
          {FY_MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
        </Select>
      </Field>
    </>
  )
}

export default function Companies() {
  const ent = useEntity()
  const { expenses, income, updateExpense } = useData()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: '', gstin: '', registration: '', address: '', currency: 'INR', fyStartMonth: 4 })
  // Which company's details are open for editing, and the working copy.
  const [editing, setEditing] = useState(null)
  const [edit, setEdit] = useState({})
  const [dept, setDept] = useState({ name: '', code: '', parentId: '', budgetMonthly: '' })
  const [invite, setInvite] = useState({ email: '', role: 'member' })

  const entries = useMemo(() => [...expenses, ...income], [expenses, income])
  const audit = useMemo(
    () => (ent.enabled ? store.listAudit({ entityId: ent.consolidated ? null : ent.activeId, limit: 500 }) : []),
    // Re-read whenever anything on this page changes something.
    [ent.enabled, ent.activeId, ent.consolidated, ent.version],
  )

  // Everything waiting on somebody, across every kind of document. Read from
  // the store rather than from props because three of the four kinds live in
  // the corporate ledgers and never pass through DataContext.
  const queue = useMemo(() => {
    if (!ent.enabled || ent.consolidated || !ent.activeId) return approvalQueue([])
    const eid = ent.activeId
    return approvalQueue([
      { kind: 'expense', rows: expenses.filter((e) => e.entity_id === eid) },
      { kind: 'advance', rows: store.advances.list(eid) },
      { kind: 'workorder', rows: store.workOrders.list(eid) },
      { kind: 'rabill', rows: store.raBills.list(eid) },
    ], { role: ent.role, userId: ent.actor?.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ent.enabled, ent.activeId, ent.consolidated, ent.version, ent.role, expenses])

  const STORES = { advance: store.advances, workorder: store.workOrders, rabill: store.raBills }
  const decide = (line, status) => {
    const done = status === 'approved' ? 'Approved.' : 'Refused.'
    const collection = STORES[line.kind]
    if (collection) {
      act(() => collection.decide(line.row.id, status, ent.actor, ent.role), done)
      return
    }
    // Bills and expenses live in the main ledger rather than the corporate
    // store, so the same decision is written through DataContext. The rule is
    // the queue's: it only offers a button where `canApprove` said yes.
    updateExpense(line.row.id, {
      approval_status: status,
      approved_by: ent.actor?.id || null,
      approved_at: new Date().toISOString(),
    }).then(() => { ent.reload(); toast(done) }).catch((e) => toast(e?.message || String(e)))
  }

  const act = (fn, done) => {
    try {
      fn()
      ent.reload()
      if (done) toast(done)
    } catch (e) {
      toast(e?.message || 'That didn’t work.', { type: 'error' })
    }
  }

  // Everything asked for when a company is created, askable again afterwards.
  //
  // `updateEntity` has existed and been tested since the corporate layer was
  // written, and nothing on any screen ever called it for a company's own
  // details: a name typed wrong, a GSTIN entered before the certificate
  // arrived, or a subsidiary whose year starts in January were all permanent.
  // The only control on this list was Archive, which is not a correction.
  const startEdit = (e) => {
    setEditing(e.id)
    setEdit({
      name: e.name || '',
      gstin: e.gstin || '',
      registration: e.registration || '',
      address: e.address || '',
      currency: e.currency || 'INR',
      fyStartMonth: String(e.fy_start_month ?? e.fyStartMonth ?? 4),
    })
  }

  const saveEdit = (e, company) => {
    e.preventDefault()
    if (!edit.name.trim()) return toast('Give the company a name.', { type: 'error' })
    // Rebuilt through `makeEntity` so a name, a GSTIN or a month typed here is
    // cleaned exactly as one typed on the form above — and then the id, the
    // creation date and everything the statutory screens own are put back,
    // because this panel did not ask about any of them and must not reset them.
    const { id: _i, created_at: _c, ...patch } = makeEntity({ ...edit, fyStartMonth: edit.fyStartMonth })
    const { pf_registered: _pf, esi_registered: _esi, pt_state: _pt, pt_slabs: _ps, bonus_rate: _br,
      minimum_wage: _mw, gratuity_voluntary: _gv, bonus_voluntary: _bv, leave_policy: _lp,
      leave_carry_cap: _lc, leave_days_per_year: _ld, leave_divisor: _lv,
      books_locked_through: _bl, ...safe } = patch
    act(() => store.updateEntity(company.id, safe, ent.actor), `${safe.name} updated.`)
    setEditing(null)
  }

  const createCompany = (e) => {
    e.preventDefault()
    if (!draft.name.trim()) return toast('Give the company a name.', { type: 'error' })
    act(() => {
      const created = store.createEntity(draft, ent.actor)
      // switchTo, not store.setActiveEntity: the latter writes the choice to
      // storage and never tells React, so the books you were in stayed on
      // screen while storage had already moved. Creating a company from your
      // personal books left the tab reading Personal and the stored active
      // company set to the new one — and the next reload jumped you into it
      // without being asked. reload() refreshes the lists but re-reads the
      // active id only on mount, so it could not have caught this.
      ent.switchTo(created.id)
    }, `${draft.name.trim()} created.`)
    setDraft({ name: '', gstin: '', registration: '', address: '', currency: 'INR', fyStartMonth: 4 })
    setCreating(false)
  }

  // ── Nothing set up yet ──
  if (!ent.enabled && !creating) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader title="Companies" subtitle="Run several legal entities from one login." />
        <EmptyState
          icon={Building2}
          title="No companies yet"
          subtitle="Add a company to turn on entity-scoped books, roles, departments and approvals. Your existing assets and entries stay exactly as they are."
          action={<Button onClick={() => setCreating(true)}><Plus size={16} /> Add a company</Button>}
        />
      </div>
    )
  }

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Companies"
        subtitle={ent.personal ? 'You are in your personal books.' : ent.consolidated ? 'Viewing all companies together.' : ent.entity?.name || ''}
        actions={ent.can('entity.manage') || !ent.corporate ? (
          <Button variant="ghost" onClick={() => setCreating((v) => !v)}>
            <Plus size={16} /> Add a company
          </Button>
        ) : null}
      />

      {creating && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink-3">New company</h2>
          <form onSubmit={createCompany} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CompanyFields value={draft} onChange={setDraft} autoFocus />
            <div className="sm:col-span-2 flex gap-2">
              <Button type="submit"><Building2 size={16} /> Create company</Button>
              <Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {ent.enabled && (
        <>
          {/* Companies */}
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink-3">Your companies</h2>
            <div className="mt-3 divide-y divide-border-light">
              {ent.entities.map((e) => (
                <div key={e.id} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                    <input type="radio" name="active-company" checked={ent.activeId === e.id} onChange={() => ent.switchTo(e.id)} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink-2">{e.name}</span>
                      <span className="block text-xs text-ink-6">
                        {[e.gstin, e.currency, `FY from ${FY_MONTHS[(e.fy_start_month ?? e.fyStartMonth ?? 4) - 1]}`].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </label>
                  {ent.can('entity.manage') && (
                    <button
                      onClick={() => (editing === e.id ? setEditing(null) : startEdit(e))}
                      className="icon-btn text-ink-6 hover:text-ink-2"
                      aria-label={`Edit ${e.name}`}
                      title={`Edit ${e.name}`}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                  {ent.can('entity.manage') && ent.entities.length > 1 && (
                    <button
                      onClick={() => {
                        if (!window.confirm(`Archive ${e.name}? Its books stay, but it stops appearing in the switcher. Nothing is deleted.`)) return
                        act(() => store.archiveEntity(e.id, ent.actor), `${e.name} archived.`)
                      }}
                      className="icon-btn text-ink-6 hover:text-red-600"
                      aria-label={`Archive ${e.name}`}
                      title={`Archive ${e.name}`}
                    >
                      <Archive size={15} />
                    </button>
                  )}
                </div>
                {ent.can('entity.manage') && editing === e.id && (
                  // Named, so its fields can be told apart from the
                  // identically-labelled ones on the New company form above.
                  <form
                    onSubmit={(ev) => saveEdit(ev, e)}
                    className="mt-3 rounded-xl border border-line-soft p-3"
                    role="group"
                    aria-label={`Editing ${e.name}`}
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <CompanyFields value={edit} onChange={setEdit} autoFocus />
                    </div>
                    <div className="mt-3 flex gap-2">
                      <Button type="submit">Save changes</Button>
                      <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    </div>
                  </form>
                )}
                </div>
              ))}
              {ent.entities.length > 1 && (
                <label className="flex cursor-pointer items-center gap-2.5 py-2.5">
                  <input type="radio" name="active-company" checked={ent.consolidated} onChange={() => ent.switchTo(CONSOLIDATED)} />
                  <span>
                    <span className="block text-sm font-medium text-ink-2">All companies</span>
                    <span className="block text-xs text-ink-6">Consolidated and read-only — you can’t book a cost against a group.</span>
                  </span>
                </label>
              )}
            </div>
          </Card>

          {ent.consolidated || ent.personal ? (
            <Card className="p-5 text-sm text-ink-5">
              Members, departments and approvals are set per company. Pick one above to manage them.
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {/* Members */}
              <Card className="p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-3"><Users size={16} className="text-gold" /> People</h2>
                <p className="mt-1 text-xs text-ink-5">
                  You are <strong>{roleLabel(ent.role)}</strong> here. {ROLES[ent.role]?.hint}
                </p>
                <div className="mt-3 divide-y divide-border-subtle">
                  {ent.members.map((m) => (
                    <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="min-w-0 truncate text-sm text-ink-3">{m.email || m.user_id}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Select
                          className="h-8 w-auto py-0 text-xs"
                          aria-label={`Role for ${m.email || m.user_id}`}
                          value={m.role}
                          disabled={!ent.can('member.manage')}
                          onChange={(e) => act(() => store.setMemberRole(ent.activeId, m.id, e.target.value, ent.actor), 'Role updated.')}
                        >
                          {ROLE_IDS.map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
                        </Select>
                        {ent.can('member.manage') && (
                          <button
                            onClick={() => act(() => store.removeMember(ent.activeId, m.id, ent.actor), 'Removed.')}
                            className="icon-btn text-ink-6 hover:text-red-600"
                            aria-label={`Remove ${m.email || m.user_id}`}
                            title="Remove"
                          >
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {ent.can('member.manage') && (
                  <form
                    className="mt-3 flex flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!invite.email.trim()) return
                      act(() => store.addMember({ entityId: ent.activeId, email: invite.email, role: invite.role }, ent.actor), 'Added.')
                      setInvite({ email: '', role: 'member' })
                    }}
                  >
                    <Input className="min-w-0 flex-1" type="email" aria-label="Email to add" placeholder="them@company.com" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
                    <Select className="w-auto" aria-label="Role for the new member" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })}>
                      {ROLE_IDS.map((r) => <option key={r} value={r}>{ROLES[r].label}</option>)}
                    </Select>
                    <Button type="submit">Add</Button>
                  </form>
                )}
              </Card>

              {/* Departments */}
              <Card className="p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-3"><Network size={16} className="text-gold" /> Departments</h2>
                <p className="mt-1 text-xs text-ink-5">Cost centres. A cost lands on one, and a division rolls up everything beneath it.</p>
                <div className="mt-3 divide-y divide-border-subtle">
                  {ent.departments.length === 0 && <p className="py-2 text-sm text-ink-6">None yet.</p>}
                  {ent.departments.map((d) => (
                    <div key={d.id} className="flex items-center justify-between gap-2 py-2">
                      <span className="min-w-0 truncate text-sm text-ink-3">
                        {departmentLabel(ent.departments, d.id)}
                        {d.code && <span className="ml-2 bg-surface-chip px-1.5 py-0.5 font-mono text-[0.6rem] text-ink-5">{d.code}</span>}
                        {d.budget_monthly > 0 && <span className="ml-2 text-xs text-ink-6">{formatCurrency(d.budget_monthly)}/mo</span>}
                      </span>
                      {ent.can('department.manage') && (
                        <button
                          onClick={() => act(() => store.deleteDepartment(d.id, ent.actor, { entries }), 'Department removed.')}
                          className="grid h-8 w-8 shrink-0 place-items-center text-ink-6 hover:text-red-600"
                          aria-label={`Remove ${d.name}`}
                          title="Remove"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {ent.can('department.manage') && (
                  <form
                    className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!dept.name.trim()) return
                      act(() => store.createDepartment({ ...dept, entityId: ent.activeId, parentId: dept.parentId || null }, ent.actor), 'Department added.')
                      setDept({ name: '', code: '', parentId: '', budgetMonthly: '' })
                    }}
                  >
                    <Input aria-label="Department name" placeholder="Operations" value={dept.name} onChange={(e) => setDept({ ...dept, name: e.target.value })} />
                    <Input aria-label="Department code" placeholder="OPS" value={dept.code} onChange={(e) => setDept({ ...dept, code: e.target.value })} />
                    <Select aria-label="Sits inside" value={dept.parentId} onChange={(e) => setDept({ ...dept, parentId: e.target.value })}>
                      <option value="">Top level</option>
                      {ent.departments.map((d) => <option key={d.id} value={d.id}>{departmentLabel(ent.departments, d.id)}</option>)}
                    </Select>
                    <Input aria-label="Monthly budget" type="number" min="0" placeholder="Monthly budget" value={dept.budgetMonthly} onChange={(e) => setDept({ ...dept, budgetMonthly: e.target.value })} />
                    <div className="sm:col-span-2"><Button type="submit"><Plus size={15} /> Add department</Button></div>
                  </form>
                )}
              </Card>

              {/* Closing the books */}
              <Card className="p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-3">
                  <Lock size={16} className="text-gold" /> Closing the books
                </h2>
                <p className="mt-1 text-xs text-ink-5">
                  Every report is a photograph of a moving thing. Somebody prints March, sends it to the bank, and a
                  bill dated the 28th arrives a fortnight later — and March is now a different number from the one in
                  the bank’s file. Closing a month refuses anything dated into it, wherever the write comes from.
                </p>
                <p className="mt-2 text-xs font-medium text-ink-3">{describeLock(ent.entity)}</p>

                {ent.can('entity.manage') ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {/* Offered one at a time and in order. You do not close March
                        and leave February open, so there is no list to pick from
                        out of sequence. */}
                    {monthsToClose(ent.entity).slice(0, 1).map((m) => (
                      <Button
                        key={m}
                        type="button"
                        onClick={() => {
                          if (!window.confirm(`Close ${m}? Nothing dated on or before the end of that month can be added, changed or deleted until you reopen it.`)) return
                          act(() => store.updateEntity(ent.activeId, { books_locked_through: m }, ent.actor), `Closed through ${m}.`)
                        }}
                      >
                        <Lock size={15} /> Close {m}
                      </Button>
                    ))}
                    {lockedThrough(ent.entity) && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          const back = reopenTo(ent.entity)
                          // Said plainly, because it is not obvious: reopening a
                          // month takes the months after it with it. A month
                          // cannot be final while the one before it is being
                          // edited.
                          if (!window.confirm(`Reopen ${lockedThrough(ent.entity)}? The books will be closed through ${back || 'nothing at all'}, so every month after it reopens too.`)) return
                          act(() => store.updateEntity(ent.activeId, { books_locked_through: back }, ent.actor),
                            back ? `Reopened. Closed through ${back}.` : 'Reopened. Nothing is closed now.')
                        }}
                      >
                        <LockOpen size={15} /> Reopen {lockedThrough(ent.entity)}
                      </Button>
                    )}
                    {!monthsToClose(ent.entity).length && !lockedThrough(ent.entity) && (
                      <p className="text-xs text-ink-6">Nothing to close yet — the month has to finish first.</p>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-ink-6">Only an owner can close or reopen the books.</p>
                )}
              </Card>

              {/* Approvals */}
              <Card className="p-5">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-3"><ShieldCheck size={16} className="text-gold" /> Approvals</h2>
                <p className="mt-1 text-xs text-ink-5">
                  Spending at or above the threshold waits for sign-off. Nobody can approve their own entry, whatever their role.
                </p>
                <div className="mt-3 space-y-3">
                  <label className="flex items-center gap-2 text-sm text-ink-3">
                    <input
                      type="checkbox"
                      checked={ent.policy.enabled}
                      disabled={!ent.can('approve')}
                      onChange={(e) => act(() => store.setApprovalPolicy(ent.activeId, { ...ent.policy, enabled: e.target.checked }, ent.actor), 'Approvals updated.')}
                    />
                    Require approval for large spending
                  </label>
                  <Field label="Threshold" hint="Zero means every entry needs sign-off.">
                    <Input
                      type="number"
                      min="0"
                      aria-label="Approval threshold"
                      value={ent.policy.threshold}
                      disabled={!ent.can('approve') || !ent.policy.enabled}
                      onChange={(e) => act(() => store.setApprovalPolicy(ent.activeId, { ...ent.policy, threshold: e.target.value }, ent.actor))}
                    />
                  </Field>
                  {/* Per document, because the scales are not comparable. A
                      ₹50,000 expense is unusual enough to look at; a ₹50,000
                      running account bill is a Tuesday, and one figure for both
                      means either the bills drown the queue or the expenses
                      walk through it. */}
                  {ent.policy.enabled && (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {APPROVABLE_IDS.map((kind) => (
                        <Field key={kind} label={APPROVABLE[kind].label} hint="Blank uses the threshold above.">
                          <Input
                            type="number"
                            min="0"
                            aria-label={`${APPROVABLE[kind].label} threshold`}
                            value={ent.policy.thresholds?.[kind] ?? ''}
                            disabled={!ent.can('approve')}
                            onChange={(e) => act(() => store.setApprovalPolicy(
                              ent.activeId,
                              { ...ent.policy, thresholds: { ...ent.policy.thresholds, [kind]: e.target.value } },
                              ent.actor,
                            ))}
                          />
                        </Field>
                      ))}
                    </div>
                  )}
                </div>
              </Card>

              {/* One queue and not four. An approval that lives on the page
                  where the document was raised is an approval nobody finds, and
                  a control nobody finds gets switched off. */}
              {ent.policy.enabled && (
                <Card className="p-5">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-3">
                    <ShieldCheck size={16} className="text-gold" /> Waiting for approval
                  </h2>
                  {queue.count === 0 ? (
                    <p className="mt-2 text-sm text-ink-5">Nothing is waiting.</p>
                  ) : (
                    <>
                      <p className="mt-1 text-xs text-ink-5">
                        {queue.count} {queue.count === 1 ? 'document' : 'documents'} holding{' '}
                        {formatCurrency(queue.total)}. {queue.mine} you can sign
                        {queue.ownRaised > 0 && `, ${queue.ownRaised} you raised yourself`}.
                      </p>
                      <ul className="mt-3 divide-y divide-border-subtle">
                        {queue.lines.map((l) => (
                          <li key={`${l.kind}-${l.row.id}`} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                            <span className="min-w-0">
                              <span className="text-ink-2">
                                {l.row.contractor || l.row.party || l.row.vendor || l.row.category || l.doc.label}
                              </span>
                              <span className="block text-[0.7rem] text-ink-6">
                                {l.doc.label}
                                {l.row.number ? ` · RA ${l.row.number}` : ''}
                                {!l.canSign && l.why ? ` · ${l.why}` : ''}
                              </span>
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="tabular font-medium text-ink-2">{formatCurrency(l.amount)}</span>
                              {l.canSign && (
                                <>
                                  <Button variant="ghost" aria-label={`Approve ${l.doc.label} ${l.amount}`} onClick={() => decide(l, 'approved')}>Approve</Button>
                                  <Button variant="ghost" aria-label={`Refuse ${l.doc.label} ${l.amount}`} onClick={() => decide(l, 'rejected')}>Refuse</Button>
                                </>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </Card>
              )}

              <SyncStatus />

              {/* The trail has a page of its own now. Two copies of it is two
                  chances for one to drift; this points at the one place. */}
              {ent.can('audit.view') && (
                <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-ink-3">Activity</h2>
                    <p className="mt-1 text-xs text-ink-5">
                      {audit.length === 0
                        ? 'Nothing recorded yet.'
                        : `${audit.length} ${audit.length === 1 ? 'change' : 'changes'} recorded — who changed what, and what it was before.`}
                    </p>
                  </div>
                  <Link to="/activity" className="text-action text-sm font-semibold text-brand underline-offset-4 hover:underline">
                    Open the log
                  </Link>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
