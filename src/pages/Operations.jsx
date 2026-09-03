import { useMemo, useState } from 'react'
import { Boxes, HandCoins, Users, AlertTriangle, Plus, Check } from 'lucide-react'
import { useEntity } from '../context/EntityContext'
import { useToast } from '../context/ToastContext'
import * as store from '../lib/storage/corporate'
import { makeItem, makeMovement, stockReport, reorderList, UNITS, MOVEMENT_KINDS } from '../lib/inventory'
import { makeAdvance, makeAdjustment, outstandingAdvances, advancesByParty, balanceOf, canAdjust, ADVANCE_PARTIES } from '../lib/advances'
import { makeEmployee, runPayroll } from '../lib/payroll'
import { formatCurrency } from '../lib/format'
import { Card, Button, Field, Input, Select, EmptyState, Badge, cx } from '../components/ui'
import PageHeader from '../components/PageHeader'

// Stock, advances and payroll — the three ledgers a company keeps that a
// landlord does not.
//
// All three were written and tested a while ago and had no screen at all, which
// made them the largest gap in the app: 151 assertions of working logic that
// nobody could reach. They share a page rather than taking three more places in
// the side bar, because they are one job — running the company behind the
// property — and because eleven destinations was already too many.
const TABS = [
  { id: 'stock', label: 'Stock', icon: Boxes },
  { id: 'advances', label: 'Advances', icon: HandCoins },
  { id: 'payroll', label: 'Payroll', icon: Users },
]

const thisMonth = () => new Date().toISOString().slice(0, 7)
const today = () => new Date().toISOString().slice(0, 10)

export default function Operations() {
  const ent = useEntity()
  const toast = useToast()
  const [tab, setTab] = useState('stock')
  // The corporate store is synchronous and outside React, so a counter is what
  // tells the page something changed. It is the same pattern EntityContext uses.
  const [version, setVersion] = useState(0)
  const bump = () => setVersion((v) => v + 1)

  const eid = ent?.activeId
  const scoped = ent?.enabled && eid && !ent.consolidated

  const data = useMemo(() => {
    if (!scoped) return null
    return {
      items: store.items.list(eid),
      movements: store.movements.list(eid),
      advances: store.advances.list(eid),
      adjustments: store.adjustments.list(),
      employees: store.employees.list(eid),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, eid, version])

  if (!ent?.enabled) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader title="Operations" subtitle="Stock, advances and payroll." />
        <EmptyState
          icon={Boxes}
          title="Add a company first"
          subtitle="Stock, advances and payroll belong to a company. Create one under Companies and this fills in."
        />
      </div>
    )
  }
  if (!scoped) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader title="Operations" subtitle="Stock, advances and payroll." />
        <EmptyState
          icon={Boxes}
          title="Pick one company"
          subtitle="These are kept per company, so the consolidated view has nothing to show. Switch to a single company above."
        />
      </div>
    )
  }

  const canWrite = ent.canWrite && ent.can('entry.create')
  const shared = { data, eid, actor: ent.actor, canWrite, bump, toast }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="Operations" subtitle={`Stock, advances and payroll for ${ent.entity?.name || 'this company'}.`} />

      <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface-raised p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={cx(
              'inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-[0.8rem] font-semibold transition',
              tab === t.id ? 'bg-brand text-navy' : 'text-ink-5 hover:text-ink-2',
            )}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === 'stock' && <Stock {...shared} />}
      {tab === 'advances' && <Advances {...shared} />}
      {tab === 'payroll' && <Payroll {...shared} />}
    </div>
  )
}

// ── Stock ───────────────────────────────────────────────────────────────────
function Stock({ data, eid, actor, canWrite, bump, toast }) {
  const [form, setForm] = useState({ name: '', sku: '', unit: 'pcs', reorderLevel: '' })
  const [move, setMove] = useState({ itemId: '', kind: 'receipt', qty: '', unitCost: '', note: '' })
  const report = useMemo(() => stockReport(data.items, data.movements), [data])
  const low = useMemo(() => reorderList(data.items, data.movements), [data])

  const addItem = (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    store.items.add(makeItem({ entityId: eid, ...form, reorderLevel: Number(form.reorderLevel) || 0 }), actor)
    setForm({ name: '', sku: '', unit: 'pcs', reorderLevel: '' })
    bump()
    toast('Item added')
  }
  const addMovement = (e) => {
    e.preventDefault()
    if (!move.itemId || !Number(move.qty)) return
    store.movements.add(makeMovement({
      entityId: eid, itemId: move.itemId, kind: move.kind,
      qty: Number(move.qty), unitCost: Number(move.unitCost) || 0, note: move.note, date: today(), createdBy: actor?.id,
    }), actor)
    setMove({ itemId: '', kind: 'receipt', qty: '', unitCost: '', note: '' })
    bump()
    toast('Movement recorded')
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Items" value={String(data.items.length)} />
        <Stat label="Stock value" value={formatCurrency(report.totalValue)} />
        <Stat label="Below reorder" value={String(report.itemsBelowReorder)} tone={report.itemsBelowReorder ? 'warn' : undefined} />
      </div>

      {low.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-600" />
            <h2 className="text-sm font-semibold text-ink-3">Reorder</h2>
          </div>
          <p className="mt-1 text-xs text-ink-5">Negative stock first — the books and the shelf disagree there.</p>
          <ul className="mt-3 divide-y divide-line-soft">
            {low.map((l) => (
              <li key={l.item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-ink-2">{l.item.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {l.negative && <Badge color="#dc2626">negative</Badge>}
                  <span className="tabular text-ink-4">{l.qty} {l.item.unit} · reorder at {l.item.reorder_level}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canWrite && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink-3">Add an item</h2>
            <form onSubmit={addItem} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <Field className="sm:col-span-2" label="Name" required>
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Cement, 50kg bag" />
              </Field>
              <Field label="SKU"><Input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} /></Field>
              <Field label="Unit">
                <Select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </Select>
              </Field>
              <Field className="sm:col-span-2" label="Reorder level" hint="Zero means never warn.">
                <Input type="number" min="0" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} />
              </Field>
              <div className="sm:col-span-2"><Button type="submit"><Plus size={16} /> Add item</Button></div>
            </form>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink-3">Record a movement</h2>
            <p className="mt-1 text-xs text-ink-5">
              Receipts move the average cost; issues consume at it. An adjustment may be negative — a stock-take found less.
            </p>
            <form onSubmit={addMovement} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <Field className="sm:col-span-2" label="Item" required>
                <Select value={move.itemId} onChange={(e) => setMove({ ...move, itemId: e.target.value })}>
                  <option value="">Choose…</option>
                  {data.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </Select>
              </Field>
              <Field label="Kind">
                <Select value={move.kind} onChange={(e) => setMove({ ...move, kind: e.target.value })}>
                  {Object.entries(MOVEMENT_KINDS).map(([id, k]) => (
                    <option key={id} value={id}>{k.label || id}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Quantity" required>
                <Input type="number" step="any" value={move.qty} onChange={(e) => setMove({ ...move, qty: e.target.value })} />
              </Field>
              <Field className="sm:col-span-2" label="Unit cost" hint="Only receipts need one.">
                <Input type="number" step="0.01" min="0" value={move.unitCost} onChange={(e) => setMove({ ...move, unitCost: e.target.value })} />
              </Field>
              <div className="sm:col-span-2"><Button type="submit" disabled={!move.itemId}><Plus size={16} /> Record</Button></div>
            </form>
          </Card>
        </div>
      )}

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink-3">On hand</h2>
        {report.lines.length === 0 ? (
          <p className="mt-3 text-sm text-ink-5">No items yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-5">
                <tr><th className="py-2 text-start">Item</th><th className="text-end">Qty</th><th className="text-end">Avg cost</th><th className="text-end">Value</th></tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {report.lines.map((l) => (
                  <tr key={l.item.id}>
                    <td className="py-2 text-ink-2">{l.item.name} <span className="text-ink-6">{l.item.sku}</span></td>
                    <td className="text-end tabular">{l.qty} {l.item.unit}</td>
                    <td className="text-end tabular text-ink-4">{formatCurrency(l.avgCost)}</td>
                    <td className="text-end tabular font-medium">{formatCurrency(l.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

// ── Advances ────────────────────────────────────────────────────────────────
function Advances({ data, eid, actor, canWrite, bump, toast }) {
  const [form, setForm] = useState({ party: '', partyType: 'vendor', amount: '', purpose: '', expectedBy: '' })
  const [settle, setSettle] = useState({ advanceId: '', amount: '', note: '' })
  const out = useMemo(() => outstandingAdvances(data.advances, data.adjustments, { entityId: eid }), [data, eid])
  const byParty = useMemo(() => advancesByParty(data.advances, data.adjustments, { entityId: eid }), [data, eid])

  const add = (e) => {
    e.preventDefault()
    if (!form.party.trim() || !Number(form.amount)) return
    store.advances.add(makeAdvance({ entityId: eid, ...form, amount: Number(form.amount), date: today(), createdBy: actor?.id }), actor)
    setForm({ party: '', partyType: 'vendor', amount: '', purpose: '', expectedBy: '' })
    bump()
    toast('Advance recorded')
  }
  const adjust = (e) => {
    e.preventDefault()
    const advance = data.advances.find((a) => a.id === settle.advanceId)
    const amount = Number(settle.amount)
    if (!advance || !amount) return
    // An adjustment cannot take out more than was ever paid in. Saying so beats
    // letting the balance go negative and calling it a bookkeeping error later.
    const check = canAdjust(advance, data.adjustments, amount)
    if (!check.ok) {
      toast(check.why, { type: 'error' })
      return
    }
    store.adjustments.add(makeAdjustment({ advanceId: advance.id, amount, note: settle.note, date: today() }), actor)
    setSettle({ advanceId: '', amount: '', note: '' })
    bump()
    toast('Adjusted')
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Outstanding" value={formatCurrency(out.total)} />
        <Stat label="Overdue" value={formatCurrency(out.overdueTotal)} tone={out.overdueTotal ? 'warn' : undefined} />
        <Stat label="Open advances" value={String(out.count)} />
      </div>

      {canWrite && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink-3">Pay an advance</h2>
            <p className="mt-1 text-xs text-ink-5">
              An advance is money owed back to the company, not a cost. It becomes a cost when the bill arrives and is set against it.
            </p>
            <form onSubmit={add} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <Field label="Paid to" required>
                <Input value={form.party} onChange={(e) => setForm({ ...form, party: e.target.value })} placeholder="Ravi Contractors" />
              </Field>
              <Field label="Who they are">
                <Select value={form.partyType} onChange={(e) => setForm({ ...form, partyType: e.target.value })}>
                  {Object.values(ADVANCE_PARTIES).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
              </Field>
              <Field label="Amount" required>
                <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </Field>
              <Field label="Expected back by" hint="What makes it chaseable.">
                <Input type="date" value={form.expectedBy} onChange={(e) => setForm({ ...form, expectedBy: e.target.value })} />
              </Field>
              <Field className="sm:col-span-2" label="What for">
                <Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
              </Field>
              <div className="sm:col-span-2"><Button type="submit"><Plus size={16} /> Record advance</Button></div>
            </form>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink-3">Set one against a bill</h2>
            <form onSubmit={adjust} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <Field className="sm:col-span-2" label="Advance" required>
                <Select value={settle.advanceId} onChange={(e) => setSettle({ ...settle, advanceId: e.target.value })}>
                  <option value="">Choose…</option>
                  {out.lines.map((l) => (
                    <option key={l.advance.id} value={l.advance.id}>
                      {l.advance.party} — {formatCurrency(l.outstanding)} left
                    </option>
                  ))}
                </Select>
              </Field>
              <Field className="sm:col-span-2" label="Amount used" required>
                <Input type="number" step="0.01" min="0" value={settle.amount} onChange={(e) => setSettle({ ...settle, amount: e.target.value })} />
              </Field>
              <Field className="sm:col-span-2" label="Note">
                <Input value={settle.note} onChange={(e) => setSettle({ ...settle, note: e.target.value })} placeholder="Invoice 114" />
              </Field>
              <div className="sm:col-span-2"><Button type="submit" disabled={!settle.advanceId}><Check size={16} /> Adjust</Button></div>
            </form>
          </Card>
        </div>
      )}

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink-3">Who is holding the company’s money</h2>
        {byParty.length === 0 ? (
          <p className="mt-3 text-sm text-ink-5">Nothing outstanding.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line-soft">
            {byParty.map((p) => (
              <li key={`${p.partyType}:${p.party}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="text-ink-2">{p.party}</span>
                  <span className="ms-2 text-xs text-ink-6">{ADVANCE_PARTIES[p.partyType]?.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {p.overdue && <Badge color="#dc2626">overdue</Badge>}
                  <span className="tabular font-medium">{formatCurrency(p.outstanding)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

// ── Payroll ─────────────────────────────────────────────────────────────────
function Payroll({ data, eid, actor, canWrite, bump, toast }) {
  const [form, setForm] = useState({ name: '', code: '', basic: '', hra: '', special: '' })
  const [period, setPeriod] = useState(thisMonth())
  // Off by default. Recovering an advance out of someone's salary without being
  // asked is the kind of surprise that costs trust, so it is a decision the
  // person running payroll makes, once, per run.
  const [recover, setRecover] = useState(false)

  const byId = useMemo(() => new Map(data.employees.map((e) => [e.id, e])), [data.employees])

  // Where the three ledgers meet: an advance paid to an employee is money the
  // company gets back out of pay. Advances name their party in free text, so
  // the match is by name — shown, never silently applied.
  const owing = useMemo(() => {
    const open = outstandingAdvances(data.advances, data.adjustments, { entityId: eid }).lines
      .filter((l) => l.advance.party_type === 'employee' && l.outstanding > 0)
    const map = new Map()
    for (const l of open) {
      const key = l.advance.party.trim().toLowerCase()
      if (!key) continue
      const cur = map.get(key) || { total: 0, lines: [] }
      cur.total = Math.round((cur.total + l.outstanding) * 100) / 100
      cur.lines.push(l)
      map.set(key, cur)
    }
    return map
  }, [data.advances, data.adjustments, eid])

  const matched = useMemo(() => {
    const out = new Map()
    for (const e of data.employees) {
      const hit = owing.get((e.name || '').trim().toLowerCase())
      if (hit) out.set(e.id, hit)
    }
    return out
  }, [data.employees, owing])

  const run = useMemo(() => {
    const perEmployee = {}
    if (recover) {
      for (const [id, hit] of matched) perEmployee[id] = { advanceRecovery: hit.total }
    }
    return runPayroll(data.employees, { period, perEmployee })
    // A recovery bigger than the pay is clamped by payslipFor and flagged, not
    // hidden — so the run still balances and the problem is visible.
  }, [data.employees, period, recover, matched])

  const recovering = useMemo(
    () => Math.round(run.slips.reduce((t, s) => t + s.deductions.advanceRecovery, 0) * 100) / 100,
    [run],
  )

  const add = (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    store.employees.add(makeEmployee({
      entityId: eid, name: form.name, code: form.code,
      basic: Number(form.basic) || 0, hra: Number(form.hra) || 0, special: Number(form.special) || 0,
    }), actor)
    setForm({ name: '', code: '', basic: '', hra: '', special: '' })
    bump()
    toast('Employee added')
  }

  // Showing a recovery is not the same as making one. This is what actually
  // closes the advance, oldest first, and only for what this run deducted.
  const settleAdvances = () => {
    let written = 0
    for (const slip of run.slips) {
      let left = slip.deductions.advanceRecovery
      if (!(left > 0)) continue
      const hit = matched.get(slip.employee_id)
      if (!hit) continue
      const oldest = [...hit.lines].sort((a, b) => (a.advance.date || '').localeCompare(b.advance.date || ''))
      for (const l of oldest) {
        if (left <= 0) break
        // Re-read the balance rather than trusting the memo: another tab may
        // have adjusted this advance since the page last rendered.
        const fresh = balanceOf(l.advance, store.adjustments.list())
        const amount = Math.round(Math.min(left, fresh.outstanding) * 100) / 100
        if (!canAdjust(l.advance, store.adjustments.list(), amount).ok) continue
        store.adjustments.add(makeAdjustment({
          advanceId: l.advance.id,
          amount,
          against: `payroll:${period}`,
          date: today(),
          note: `Recovered in ${period} payroll`,
        }), actor)
        left = Math.round((left - amount) * 100) / 100
        written += 1
      }
    }
    bump()
    toast(written ? `Set against ${written} advance${written === 1 ? '' : 's'}` : 'Nothing left to recover')
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Stat label="On payroll" value={String(run.headcount)} />
        <Stat label="Gross" value={formatCurrency(run.gross)} />
        <Stat label="Take home" value={formatCurrency(run.net)} />
        <Stat label="Cost to company" value={formatCurrency(run.employerCost)} />
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink-3">Payslips</h2>
          <label className="flex items-center gap-2 text-xs text-ink-5">
            Month
            <Input type="month" className="field-input-compact w-auto" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </label>
        </div>
        <p className="mt-1 text-xs text-ink-5">
          PF, ESI and professional tax are computed from the statutory rules. TDS is not — it depends on declared
          investments and projected annual income, and a wrong guess is worse than an empty field.
        </p>

        {matched.size > 0 && (
          <label className="mt-3 flex items-start gap-2.5 rounded-lg border border-line-soft bg-surface-sunk p-3 text-xs text-ink-4">
            <input
              type="checkbox"
              checked={recover}
              onChange={(e) => setRecover(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-brand"
            />
            <span>
              <span className="font-semibold text-ink-3">Recover advances in this run</span> — {matched.size}{' '}
              {matched.size === 1 ? 'person has' : 'people have'} an advance outstanding, matched by name.
            </span>
          </label>
        )}

        {run.slips.length === 0 ? (
          <p className="mt-3 text-sm text-ink-5">Nobody on payroll yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-5">
                <tr>
                  <th className="py-2 text-start">Employee</th><th className="text-end">Gross</th>
                  <th className="text-end">PF</th><th className="text-end">ESI</th><th className="text-end">PT</th>
                  {recover && <th className="text-end">Advance</th>}
                  <th className="text-end">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {run.slips.map((s) => {
                  const emp = byId.get(s.employee_id)
                  return (
                    <tr key={s.employee_id}>
                      <td className="py-2 text-ink-2">
                        {emp?.name || 'Unnamed'} <span className="text-ink-6">{emp?.code}</span>
                        {s.overDeducted && <span className="ms-2"><Badge color="#dc2626">over-deducted</Badge></span>}
                      </td>
                      <td className="text-end tabular">{formatCurrency(s.gross)}</td>
                      <td className="text-end tabular text-ink-4">{formatCurrency(s.deductions.pf)}</td>
                      <td className="text-end tabular text-ink-4">{formatCurrency(s.deductions.esi)}</td>
                      <td className="text-end tabular text-ink-4">{formatCurrency(s.deductions.professionalTax)}</td>
                      {recover && <td className="text-end tabular text-ink-4">{formatCurrency(s.deductions.advanceRecovery)}</td>}
                      <td className="text-end tabular font-medium">{formatCurrency(s.net)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-ink-5">
              To deposit this month: PF {formatCurrency(run.statutory.pf)} · ESI {formatCurrency(run.statutory.esi)} ·
              PT {formatCurrency(run.statutory.professionalTax)}
            </p>
            {recover && recovering > 0 && canWrite && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button variant="ghost" onClick={settleAdvances}>
                  <Check size={16} /> Close {formatCurrency(recovering)} of advances
                </Button>
                <span className="text-xs text-ink-5">Writes the adjustment against each advance, oldest first.</span>
              </div>
            )}
          </div>
        )}
      </Card>

      {canWrite && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink-3">Add an employee</h2>
          <form onSubmit={add} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Field label="Name" required>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Code"><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="EMP01" /></Field>
            <Field label="Basic" required hint="PF is a share of this.">
              <Input type="number" step="0.01" min="0" value={form.basic} onChange={(e) => setForm({ ...form, basic: e.target.value })} />
            </Field>
            <Field label="HRA"><Input type="number" step="0.01" min="0" value={form.hra} onChange={(e) => setForm({ ...form, hra: e.target.value })} /></Field>
            <Field label="Special allowance"><Input type="number" step="0.01" min="0" value={form.special} onChange={(e) => setForm({ ...form, special: e.target.value })} /></Field>
            <div className="sm:col-span-3"><Button type="submit"><Plus size={16} /> Add employee</Button></div>
          </form>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <Card className="p-4">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[1.5px] text-ink-5">{label}</p>
      <p className={cx('mt-1 text-xl font-semibold tabular', tone === 'warn' ? 'text-amber-600' : 'text-ink-1')}>{value}</p>
    </Card>
  )
}
