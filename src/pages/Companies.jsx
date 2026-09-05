import { useMemo, useState } from 'react'
import { Building2, Plus, Users, Network, ShieldCheck, Trash2, Archive, ScrollText } from 'lucide-react'
import { useEntity } from '../context/EntityContext'
import { useToast } from '../context/ToastContext'
import { useData } from '../context/DataContext'
import { ROLES, ROLE_IDS, roleLabel, departmentLabel, CONSOLIDATED } from '../lib/corporate'
import * as store from '../lib/storage/corporate'
import { formatCurrency, formatDate } from '../lib/format'
import { Card, Button, Field, Input, Select, EmptyState } from '../components/ui'
import PageHeader from '../components/PageHeader'

// The corporate control panel: the companies themselves, who is in them, how
// they are divided up, and what needs signing off. Everything on this page is
// gated on the role the current user holds in the active company.
export default function Companies() {
  const ent = useEntity()
  const { expenses, income } = useData()
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: '', gstin: '', registration: '', currency: 'INR' })
  const [dept, setDept] = useState({ name: '', code: '', parentId: '', budgetMonthly: '' })
  const [invite, setInvite] = useState({ email: '', role: 'member' })

  const entries = useMemo(() => [...expenses, ...income], [expenses, income])
  const audit = useMemo(
    () => (ent.enabled ? store.listAudit({ entityId: ent.consolidated ? null : ent.activeId, limit: 40 }) : []),
    // Re-read whenever anything on this page changes something.
    [ent.enabled, ent.activeId, ent.consolidated, ent.version],
  )

  const act = (fn, done) => {
    try {
      fn()
      ent.reload()
      if (done) toast(done)
    } catch (e) {
      toast(e?.message || 'That didn’t work.', { type: 'error' })
    }
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
    setDraft({ name: '', gstin: '', registration: '', currency: 'INR' })
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
            <Field label="Registered name" required>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Acme Industries Pvt Ltd" autoFocus />
            </Field>
            <Field label="GSTIN">
              <Input value={draft.gstin} onChange={(e) => setDraft({ ...draft, gstin: e.target.value.toUpperCase() })} placeholder="27AAAPA1234A1Z5" />
            </Field>
            <Field label="CIN / registration">
              <Input value={draft.registration} onChange={(e) => setDraft({ ...draft, registration: e.target.value })} />
            </Field>
            <Field label="Reporting currency" hint="Companies in another currency are shown separately, never converted.">
              <Input value={draft.currency} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase().slice(0, 3) })} />
            </Field>
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
                <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                    <input type="radio" name="active-company" checked={ent.activeId === e.id} onChange={() => ent.switchTo(e.id)} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink-2">{e.name}</span>
                      <span className="block text-xs text-ink-6">
                        {[e.gstin, e.currency, `FY from month ${e.fyStartMonth}`].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </label>
                  {ent.can('entity.manage') && ent.entities.length > 1 && (
                    <button
                      onClick={() => {
                        if (!window.confirm(`Archive ${e.name}? Its books stay, but it stops appearing in the switcher. Nothing is deleted.`)) return
                        act(() => store.archiveEntity(e.id, ent.actor), `${e.name} archived.`)
                      }}
                      className="grid h-8 w-8 place-items-center text-ink-6 hover:text-red-600"
                      aria-label={`Archive ${e.name}`}
                      title={`Archive ${e.name}`}
                    >
                      <Archive size={15} />
                    </button>
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
                            className="grid h-8 w-8 place-items-center text-ink-6 hover:text-red-600"
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
                      value={ent.policy.threshold}
                      disabled={!ent.can('approve') || !ent.policy.enabled}
                      onChange={(e) => act(() => store.setApprovalPolicy(ent.activeId, { ...ent.policy, threshold: e.target.value }, ent.actor))}
                    />
                  </Field>
                </div>
              </Card>

              {/* Audit */}
              {ent.can('audit.view') && (
                <Card className="p-5">
                  <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-3"><ScrollText size={16} className="text-gold" /> Audit log</h2>
                  <p className="mt-1 text-xs text-ink-5">Who changed what, most recent first.</p>
                  <div className="mt-3 max-h-72 divide-y divide-border-subtle overflow-y-auto">
                    {audit.length === 0 && <p className="py-2 text-sm text-ink-6">Nothing recorded yet.</p>}
                    {audit.map((a) => (
                      <div key={a.id} className="flex items-baseline justify-between gap-3 py-1.5 text-xs">
                        <span className="min-w-0 text-ink-4">
                          <span className="font-medium text-ink-2">{a.actor_email || 'Someone'}</span> {a.summary}
                        </span>
                        <span className="shrink-0 text-ink-6">{formatDate(a.at)}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
