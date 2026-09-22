import { useMemo, useState } from 'react'
import { Users, FileSignature, Plus, AlertTriangle, Clock, Printer } from 'lucide-react'
import * as store from '../lib/storage/corporate'
import { makeMuster, musterCost, labourReport, TRADES, TRADE_IDS } from '../lib/labour'
import {
  makeWorkOrder,
  makeRaBill,
  subcontractReport,
  retentionSchedule,
  canAmendBill,
  removingBill,
  ORDER_STATUS,
  ORDER_STATUS_IDS,
  PRICING,
  PRICING_IDS,
  SIDE,
  SIDE_IDS,
  round2,
} from '../lib/subcontract'
import { tdsLedger, DEDUCTEE, DEDUCTEE_IDS } from '../lib/tds'
import { paymentCertificate, musterSheet } from '../lib/siteDocs'
import { documentToPDF } from '../lib/siteDocsPdf'
import { formatCurrency } from '../lib/format'
import { Card, Button, Field, Input, Select, Badge, EmptyState, cx, attempt } from './ui'
import { todayISO } from '../lib/today'

// Labour, in the two shapes a site actually has it.
//
// The muster roll is day labour: a trade, a date, a headcount and a rate.
// Nobody is named, because nobody is named on a real muster either — the same
// gang is different people next week, and asking for names would produce a
// register nobody fills in whose totals still look real.
//
// Contractors are the other shape: a work order, then running account bills
// against it. Those are cumulative, which is the single thing this screen has
// to get right.
const VIEWS = [
  { id: 'muster', label: 'Muster roll', icon: Users },
  { id: 'contractors', label: 'Contractors', icon: FileSignature },
]

const num = (v) => Number(v) || 0

export default function Labour(shared) {
  const [view, setView] = useState('muster')
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Labour">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            onClick={() => setView(v.id)}
            aria-selected={view === v.id}
            className={cx(
              'inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-xs font-semibold transition',
              view === v.id
                ? 'border-brand bg-brand/15 text-ink-1'
                : 'border-line text-ink-5 hover:border-line-strong hover:text-ink-2',
            )}
          >
            <v.icon size={14} /> {v.label}
          </button>
        ))}
      </div>
      {view === 'muster' && <Muster {...shared} />}
      {view === 'contractors' && <Contractors {...shared} />}
    </div>
  )
}

// ── Muster roll ─────────────────────────────────────────────────────────────
function Muster({ data, eid, actor, canWrite, bump, toast, company }) {
  const blank = {
    date: todayISO(), trade: 'mason', headcount: '', rate: '',
    overtimeHours: '', overtimeRate: '', projectId: '', contractor: '', note: '',
  }
  const [form, setForm] = useState(blank)
  const [scope, setScope] = useState('')

  const report = useMemo(
    () => labourReport(data.muster, { entityId: eid, projectId: scope || undefined }),
    [data, eid, scope],
  )
  const siteName = (id) => data.projects.find((p) => p.id === id)?.name || 'Not booked to a site'

  const add = (e) => {
    e.preventDefault()
    if (!num(form.headcount) || !num(form.rate)) return
    // The store refuses a day inside a closed month, and a refusal is a sentence
    // for whoever is standing there rather than an error nobody sees.
    if (!attempt(() => store.muster.add(makeMuster({
      entityId: eid, projectId: form.projectId || null, date: form.date, trade: form.trade,
      headcount: num(form.headcount), rate: num(form.rate),
      overtimeHours: num(form.overtimeHours), overtimeRate: num(form.overtimeRate),
      contractor: form.contractor, note: form.note, createdBy: actor?.id,
    }), actor), toast)) return
    // The date, trade and rate stay: a muster is entered a dozen lines at a
    // time and re-typing yesterday's date for each is how it stops being kept.
    setForm({ ...blank, date: form.date, trade: form.trade, rate: form.rate, projectId: form.projectId })
    bump()
    toast('Muster recorded')
  }

  // A day's muster entered wrong stayed wrong: the heads, the rate and the site
  // it was booked to were all permanent, and the site is the one that quietly
  // moves cost onto the wrong job.
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState({})
  const startEdit = (m) => {
    setEditing(m.id)
    setDraft({ date: m.date || '', trade: m.trade || 'other', projectId: m.project_id || '',
      headcount: m.headcount ?? '', rate: m.rate ?? '', overtimeHours: m.overtime_hours ?? '',
      overtimeRate: m.overtime_rate ?? '', contractor: m.contractor || '', note: m.note || '' })
  }
  const saveEdit = (m) => {
    if (!num(draft.headcount) || !num(draft.rate)) return toast('A day needs heads and a rate.', { type: 'error' })
    const { id: _i, entity_id: _e, created_at: _c, created_by: _b, ...patch } = makeMuster({
      entityId: eid, projectId: draft.projectId || null, date: draft.date || m.date, trade: draft.trade,
      headcount: num(draft.headcount), rate: num(draft.rate),
      overtimeHours: num(draft.overtimeHours), overtimeRate: num(draft.overtimeRate),
      contractor: draft.contractor, note: draft.note,
    })
    if (!attempt(() => store.muster.update(m.id, patch, actor), toast)) return
    setEditing(null); bump(); toast('Muster corrected')
  }
  const dropEdit = (m) => {
    if (!window.confirm(`Delete ${m.headcount} ${TRADES[m.trade]?.label.toLowerCase() || m.trade} on ${m.date}?`)) return
    if (!attempt(() => store.muster.remove(m.id, actor), toast)) return
    setEditing(null); bump(); toast('Muster day deleted')
  }

  const recent = useMemo(
    () => data.muster
      .filter((m) => m.entity_id === eid)
      .slice()
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, 40),
    [data, eid],
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Wage bill" value={formatCurrency(report.total)} />
        <Stat label="Head-days" value={String(report.headDays)} />
        <Stat label="Average day" value={formatCurrency(report.averageDayRate)} />
        {/* The figure that quietly doubles while everyone watches the rates. */}
        <Stat
          label="Overtime"
          value={`${formatCurrency(report.overtime)}${report.overtimePercent ? ` · ${report.overtimePercent}%` : ''}`}
          tone={report.overtimePercent > 15 ? 'warn' : undefined}
        />
      </div>

      {canWrite && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-ink-3">Record a day’s muster</h3>
          <p className="mt-1 text-xs text-ink-5">
            A trade, a date and a headcount — the way a site diary already records it. Overtime is entered separately
            because eight hours at ₹700 plus four hours over is not twelve hours at ₹700.
          </p>
          <form onSubmit={add} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Field label="Date" required>
              <Input aria-label="Muster date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} max={todayISO()} />
            </Field>
            <Field label="Trade">
              <Select aria-label="Trade" value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })}>
                {TRADE_IDS.map((id) => <option key={id} value={id}>{TRADES[id].label}</option>)}
              </Select>
            </Field>
            <Field label="Headcount" required>
              <Input aria-label="Headcount" type="number" min="0" step="1" value={form.headcount} onChange={(e) => setForm({ ...form, headcount: e.target.value })} />
            </Field>
            <Field label="Day rate" required>
              <Input aria-label="Day rate" type="number" min="0" step="0.01" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} />
            </Field>
            <Field label="Overtime hours">
              <Input aria-label="Overtime hours" type="number" min="0" step="0.5" value={form.overtimeHours} onChange={(e) => setForm({ ...form, overtimeHours: e.target.value })} />
            </Field>
            <Field label="Overtime rate" hint="Per hour.">
              <Input aria-label="Overtime rate" type="number" min="0" step="0.01" value={form.overtimeRate} onChange={(e) => setForm({ ...form, overtimeRate: e.target.value })} />
            </Field>
            {data.projects.length > 0 && (
              <Field label="Site" hint="Labour with no site is labour no job is charged for.">
                <Select aria-label="Muster site" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                  <option value="">Not booked to a site</option>
                  {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Mestri / supplier">
              <Input aria-label="Mestri" value={form.contractor} onChange={(e) => setForm({ ...form, contractor: e.target.value })} placeholder="Ramesh gang" />
            </Field>
            <div className="sm:col-span-4">
              <Button type="submit" disabled={!num(form.headcount) || !num(form.rate)}>
                <Plus size={16} /> Record muster
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-ink-3">By trade</h3>
          {report.byTrade.length === 0 ? (
            <p className="mt-3 text-sm text-ink-5">Nothing recorded yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line-soft">
              {report.byTrade.map((t) => (
                <li key={t.trade.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-ink-2">
                    {t.trade.label}
                    {!t.trade.skilled && <span className="ms-2 text-[0.6875rem] text-ink-6">unskilled</span>}
                  </span>
                  <span className="tabular text-ink-4">
                    {t.headDays} days · <span className="font-medium text-ink-2">{formatCurrency(t.cost)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {report.headDays > 0 && (
            <p className="mt-3 text-xs text-ink-6">
              {report.skilledDays} skilled and {report.unskilledDays} unskilled head-days. A site running heavy on
              unskilled labour is usually a site waiting for something.
            </p>
          )}
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink-3">By site</h3>
            {data.projects.length > 0 && (
              <Select aria-label="Filter muster by site" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="">Every site</option>
                {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            )}
          </div>
          {report.bySite.length === 0 ? (
            <p className="mt-3 text-sm text-ink-5">Nothing recorded yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line-soft">
              {report.bySite.map((s) => (
                <li key={s.projectId || 'none'} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className={cx('min-w-0 truncate', s.projectId ? 'text-ink-2' : 'text-warn')}>
                    {siteName(s.projectId)}
                  </span>
                  <span className="tabular text-ink-4">
                    {s.headDays} days · <span className="font-medium text-ink-2">{formatCurrency(s.cost)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink-3">The register</h3>
          {/* Signed at the gate, which a screen cannot be. */}
          {recent.length > 0 && (
            <Button
              variant="ghost"
              aria-label="Print muster roll"
              onClick={async () => {
                try {
                  await documentToPDF(musterSheet(data.muster, {
                    company, date: recent[0].date, entityId: eid,
                    siteName: (id) => data.projects.find((p) => p.id === id)?.name || 'Not booked to a site',
                  }))
                } catch (e) { toast(e?.message || String(e)) }
              }}
            >
              <Printer size={14} /> Muster roll
            </Button>
          )}
        </div>
        {recent.length === 0 ? (
          <p className="mt-3 text-sm text-ink-5">Nothing recorded yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-5">
                <tr>
                  <th className="py-2 text-start">Date</th>
                  <th className="text-start ps-3">Trade</th>
                  <th className="text-end">Heads</th>
                  <th className="text-end">Rate</th>
                  <th className="text-end">Overtime</th>
                  <th className="text-end">Cost</th>
                  <th className="text-start ps-3">Site</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {recent.map((m) => {
                  const c = musterCost(m)
                  return (
                    <tr key={m.id}>
                      <td className="py-2 text-ink-4">
                        {m.date}
                        {/* Beside the date rather than in a column of its own,
                            for the same reason as the stock table. */}
                        {canWrite && (
                          <button type="button"
                            aria-label={`Edit ${m.headcount} ${TRADES[m.trade]?.label.toLowerCase() || m.trade} on ${m.date}`}
                            className="ms-2 text-xs text-ink-5 underline-offset-2 hover:text-ink-2 hover:underline"
                            onClick={() => (editing === m.id ? setEditing(null) : startEdit(m))}>
                            {editing === m.id ? 'Close' : 'Edit'}
                          </button>
                        )}
                      </td>
                      <td className="ps-3 text-ink-2">{TRADES[m.trade]?.label || m.trade}</td>
                      <td className="text-end tabular text-ink-3">{m.headcount}</td>
                      <td className="text-end tabular text-ink-4">{formatCurrency(m.rate)}</td>
                      <td className="text-end tabular text-ink-4">{c.overtime ? formatCurrency(c.overtime) : '—'}</td>
                      <td className="text-end tabular font-medium">{formatCurrency(c.total)}</td>
                      <td className={cx('ps-3', m.project_id ? 'text-ink-4' : 'text-warn')}>{siteName(m.project_id)}</td>
                    </tr>
                  )
                })}
                {/* Under the row it belongs to, so the figures being corrected
                    against are still on screen. */}
                {canWrite && recent.filter((m) => editing === m.id).map((m) => (
                  <tr key={`${m.id}-edit`}>
                    <td colSpan={7} className="py-3">
                      <div className="rounded-xl border border-line-soft p-3" role="group"
                        aria-label={`Editing muster of ${m.date}`}>
                        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
                          <Field label="Date"><Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
                          <Field label="Trade">
                            <Select value={draft.trade} onChange={(e) => setDraft({ ...draft, trade: e.target.value })}>
                              {TRADE_IDS.map((id) => <option key={id} value={id}>{TRADES[id].label}</option>)}
                            </Select>
                          </Field>
                          {/* The field that quietly moves a day's cost onto the
                              wrong job, and the reason the register needed this
                              more than the rest of it. */}
                          <Field label="Site" hint="Blank leaves the day unbooked.">
                            <Select value={draft.projectId} onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}>
                              <option value="">Not booked to a site</option>
                              {data.projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                            </Select>
                          </Field>
                          <Field label="Heads" required>
                            <Input type="number" min="0" value={draft.headcount} onChange={(e) => setDraft({ ...draft, headcount: e.target.value })} />
                          </Field>
                          <Field label="Rate a day" required>
                            <Input type="number" step="0.01" min="0" value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} />
                          </Field>
                          <Field label="Overtime hours">
                            <Input type="number" step="0.5" min="0" value={draft.overtimeHours} onChange={(e) => setDraft({ ...draft, overtimeHours: e.target.value })} />
                          </Field>
                          <Field label="Overtime rate an hour">
                            <Input type="number" step="0.01" min="0" value={draft.overtimeRate} onChange={(e) => setDraft({ ...draft, overtimeRate: e.target.value })} />
                          </Field>
                          <Field label="Through whom"><Input value={draft.contractor} onChange={(e) => setDraft({ ...draft, contractor: e.target.value })} /></Field>
                          <Field label="Note"><Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></Field>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button onClick={() => saveEdit(m)}>Save</Button>
                          <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                          <Button variant="ghost"
                            aria-label={`Delete ${m.headcount} ${TRADES[m.trade]?.label.toLowerCase() || m.trade} on ${m.date}`}
                            onClick={() => dropEdit(m)}>Delete</Button>
                        </div>
                      </div>
                    </td>
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

// ── Contractors ─────────────────────────────────────────────────────────────
function Contractors({ data, eid, actor, canWrite, bump, toast, gate, company, fyStart = 4 }) {
  // RA bills are cumulative, so a bill has two neighbours and correcting one has
  // to respect both. Below the bill before it and this bill's own amount goes
  // negative; above the bill after it and the *next* one does instead — which is
  // worse, because the figure that breaks is not the one on screen.
  const [editingBill, setEditingBill] = useState(null)
  const [billDraft, setBillDraft] = useState({})
  // The document with legal weight: what was measured, what was certified
  // before, and therefore what is payable now.
  const startBill = (b) => {
    setEditingBill(b.id)
    setBillDraft({ date: b.date || '', claimedToDate: b.claimed_to_date ?? '',
      certifiedToDate: b.certified_to_date ?? '', advanceRecovered: b.advance_recovered ?? '',
      materialRecovered: b.material_recovered ?? '', penalty: b.penalty ?? '' })
  }
  const saveBill = (order, b) => {
    const check = canAmendBill(order, data.raBills, b, num(billDraft.certifiedToDate))
    if (!check.ok) return toast(check.why, { type: 'error' })
    const { id: _i, entity_id: _e, created_at: _c, created_by: _b, ...patch } = makeRaBill({
      entityId: eid, workOrderId: order.id, projectId: b.project_id, number: b.number,
      date: billDraft.date || b.date,
      claimedToDate: num(billDraft.claimedToDate), certifiedToDate: num(billDraft.certifiedToDate),
      advanceRecovered: num(billDraft.advanceRecovered), materialRecovered: num(billDraft.materialRecovered),
      penalty: num(billDraft.penalty), otherDeduction: b.other_deduction, status: b.status, note: b.note,
    })
    if (!attempt(() => store.raBills.update(b.id, patch, actor), toast)) return
    setEditingBill(null); bump(); toast(`RA ${b.number} corrected`)
  }
  const dropBill = (order, b) => {
    // Arithmetically safe anywhere in the ladder — it re-bases and the bill
    // after certifies from further back — so this says what will happen
    // instead of refusing. Being told afterwards that another bill doubled is
    // how somebody stops trusting the screen.
    const effect = removingBill(order, data.raBills, b)
    const absorbs = effect.absorbs
      ? ` RA ${effect.absorbs.number} then pays ${formatCurrency(effect.absorbs.gross)}, because it certifies from further back.`
      : ''
    if (!window.confirm(`Delete RA ${b.number}?${absorbs}`)) return
    if (!attempt(() => store.raBills.remove(b.id, actor), toast)) return
    setEditingBill(null); bump(); toast(`RA ${b.number} deleted`)
  }

  const certify = async (order, bill) => {
    try {
      await documentToPDF(paymentCertificate(order, data.raBills, { company, billId: bill.id }),
        { filename: `payment-certificate-RA${bill.number}.pdf` })
    } catch (e) { toast(e?.message || String(e)) }
  }
  const blankOrder = {
    contractor: '', scope: '', orderValue: '', pricing: 'lumpSum',
    retentionPercent: '5', tdsPercent: '1', projectId: '', dueOn: '', status: 'running',
    dlpMonths: '12', releaseSplitPercent: '50', pan: '', deducteeType: 'other',
  }
  const [order, setOrder] = useState(blankOrder)
  // The same screen read from either end. A builder holds retention from the
  // contractors he engages and has it held from him by the client who engaged
  // him, and until now the app could only see the first of the two.
  const [side, setSide] = useState('sub')
  const [billing, setBilling] = useState(null)
  const [bill, setBill] = useState({ claimedToDate: '', certifiedToDate: '', advanceRecovered: '', materialRecovered: '', penalty: '', date: todayISO() })

  const report = useMemo(
    () => subcontractReport(data.workOrders, data.raBills, { entityId: eid, side }),
    [data, eid, side],
  )
  // Worked out per order rather than for the list, because a release date
  // belongs to a contract and not to a company.
  const schedules = useMemo(
    () => Object.fromEntries(report.lines.map((l) => [l.order.id, retentionSchedule(l.order, l, {})])),
    [report],
  )
  const party = SIDE[side].party
  // What the law requires deducting, against what the orders said to. Counted
  // per contractor across the year rather than per order, which is the only way
  // the aggregate limit can be seen at all.
  const tax = useMemo(
    () => tdsLedger(data.workOrders, data.raBills, { entityId: eid, fyStartMonth: fyStart }),
    [data, eid, fyStart],
  )
  const siteName = (id) => data.projects.find((p) => p.id === id)?.name || 'No site'

  const addOrder = (e) => {
    e.preventDefault()
    if (!order.contractor.trim()) return
    const row = makeWorkOrder({
      entityId: eid, projectId: order.projectId || null, contractor: order.contractor,
      scope: order.scope, orderValue: num(order.orderValue), pricing: order.pricing,
      retentionPercent: num(order.retentionPercent), tdsPercent: num(order.tdsPercent),
      dueOn: order.dueOn, status: order.status, createdBy: actor?.id,
      side, dlpMonths: num(order.dlpMonths), releaseSplitPercent: num(order.releaseSplitPercent),
      pan: order.pan, deducteeType: order.deducteeType,
    })
    store.workOrders.add({ ...row, ...gate(row, 'workorder') }, actor)
    setOrder(blankOrder)
    bump()
    toast('Work order created')
  }

  const addBill = (e) => {
    e.preventDefault()
    const line = report.lines.find((l) => l.order.id === billing)
    if (!line || !num(bill.certifiedToDate)) return
    const row = makeRaBill({
      workOrderId: line.order.id, entityId: eid, projectId: line.order.project_id,
      number: line.count + 1, date: bill.date,
      claimedToDate: num(bill.claimedToDate) || num(bill.certifiedToDate),
      certifiedToDate: num(bill.certifiedToDate),
      advanceRecovered: num(bill.advanceRecovered),
      materialRecovered: num(bill.materialRecovered),
      penalty: num(bill.penalty),
      createdBy: actor?.id,
    })
    if (!attempt(() => store.raBills.add({ ...row, ...gate(row, 'rabill') }, actor), toast)) return
    setBill({ claimedToDate: '', certifiedToDate: '', advanceRecovered: '', materialRecovered: '', penalty: '', date: todayISO() })
    setBilling(null)
    bump()
    toast('Running account bill recorded')
  }

  // Releasing the second tranche releases the first as well, because the figure
  // stored is cumulative and there is no way to owe the completion half after
  // paying the defects half. The guard against going backwards is the same
  // point: a release is not undone by clicking the earlier button again.
  const releaseThrough = (sched, index) => {
    const upto = sched.tranches.slice(0, index + 1).reduce((t, x) => t + x.amount, 0)
    const value = Math.max(sched.released, round2(upto))
    store.workOrders.update(sched.order.id, { retention_released: value }, actor)
    bump()
    toast(`${sched.tranches[index].label} retention released`)
  }

  // Retention has no release date until somebody says when the work finished.
  // Entered here rather than on the form, because on the day an order is
  // written nobody knows.
  const setCompleted = (orderId, date) => {
    store.workOrders.update(orderId, { completed_on: date || '' }, actor)
    bump()
  }

  const active = report.lines.find((l) => l.order.id === billing)

  return (
    <div className="space-y-4">
      {/* Same ladder, opposite sign. Certified work is a cost on one side and
          revenue on the other, so the two are never added together. */}
      <div className="flex flex-wrap gap-1 rounded-xl bg-surface-2 p-1" role="tablist" aria-label="Which side of the contract">
        {SIDE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={side === id}
            onClick={() => { setSide(id); setBilling(null) }}
            className={cx('rounded-lg px-3 py-1.5 text-xs font-semibold transition',
              side === id ? 'bg-surface-1 text-ink-2 shadow-sm' : 'text-ink-5 hover:text-ink-3')}
          >
            {SIDE[id].noun}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={side === 'sub' ? 'Work orders' : 'Client contracts'} value={String(report.count)} />
        <Stat label={side === 'sub' ? 'Certified' : 'Billed to client'} value={formatCurrency(report.certified)} />
        {/* A liability with a release date on one side, a receivable on the
            other. Never a saving on either. */}
        <Stat label={side === 'sub' ? 'Retention held' : 'Retention withheld'} value={formatCurrency(report.retentionHeld)} />
        <Stat
          label="Claimed, not certified"
          value={formatCurrency(report.unCertified)}
          tone={report.unCertified > 0 ? 'warn' : undefined}
        />
      </div>

      {report.problems > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-warn" />
            <h3 className="text-sm font-semibold text-ink-3">
              {report.problems} {report.problems === 1 ? 'bill needs' : 'bills need'} a second look
            </h3>
          </div>
          <p className="mt-1 text-xs text-ink-5">
            A bill certified above what was claimed, one certifying less than the bill before it, or work past the
            order value. All three are legitimate sometimes and none should pass unseen.
          </p>
        </Card>
      )}

      {side === 'sub' && tax.count > 0 && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink-3">Tax deducted at source — {tax.fy.label}</h3>
            <span className="text-[0.6875rem] text-ink-6">194C · {tax.from} to {tax.to}</span>
          </div>
          <p className="mt-1 text-xs text-ink-5">
            Counted per contractor across the year, not per order. The payment that takes a contractor past
            ₹1,00,000 makes <em>everything</em> paid to him that year liable — not the excess — so three orders each
            under the limit is the ordinary way to get this wrong.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Cell label="Paid this year" value={formatCurrency(tax.paid)} />
            <Cell label="Required" value={formatCurrency(tax.required)} />
            <Cell label="Deducted" value={formatCurrency(tax.deducted)} />
            {/* Never netted: one contractor short and another over are two
                returns to correct, and the difference of nothing is neither. */}
            <Cell label="Short by" value={formatCurrency(tax.shortfall)} tone={tax.shortfall > 0 ? 'warn' : undefined} />
          </div>
          {(tax.short > 0 || tax.over > 0 || tax.conflicts > 0 || tax.noPan > 0) && (
            <ul className="mt-3 space-y-1.5">
              {tax.lines.filter((l) => l.short || l.over || l.panConflict || !l.pan).slice(0, 6).map((l) => (
                <li key={l.party} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                  <span className="text-ink-3">
                    {l.party}
                    <span className="block text-[0.6875rem] text-ink-6">
                      {formatCurrency(l.paid)} across {l.orders} {l.orders === 1 ? 'order' : 'orders'} · {l.rate}%
                      {l.crossedOn && ` · crossed the year on ${l.crossedOn}`}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    {l.panConflict && <Badge color="#dc2626">two PANs</Badge>}
                    {!l.pan && <Badge color="#d97706">no PAN — 20%</Badge>}
                    {l.short && <span className="tabular font-semibold text-bad">short {formatCurrency(l.shortfall)}</span>}
                    {l.over && <span className="tabular font-semibold text-warn">over {formatCurrency(l.excess)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-4 border-t border-line-soft pt-3 text-[0.6875rem] text-ink-5">
            {tax.quarters.map((q) => (
              <span key={q.quarter}>
                Q{q.quarter} <span className="tabular font-semibold text-ink-3">{formatCurrency(q.tds)}</span>
              </span>
            ))}
          </div>
        </Card>
      )}

      {canWrite && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-ink-3">New {SIDE[side].noun.toLowerCase()}</h3>
          <p className="mt-1 text-xs text-ink-5">
            The agreed scope and rates. Running account bills are entered against it, and each one states the work
            done <em>to date</em> — not this month’s amount.
            {side === 'client' && ' On this side the certified figure is what the company earned, and the retention is money the client is holding back from it.'}
          </p>
          <form onSubmit={addOrder} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Field label={party} required className="sm:col-span-2">
              <Input aria-label="Contractor" value={order.contractor} onChange={(e) => setOrder({ ...order, contractor: e.target.value })} placeholder={side === 'sub' ? 'Sharma Plastering' : 'Metro Development Authority'} />
            </Field>
            <Field label="Order value">
              <Input aria-label="Order value" type="number" min="0" step="0.01" value={order.orderValue} onChange={(e) => setOrder({ ...order, orderValue: e.target.value })} />
            </Field>
            <Field label="Priced as">
              <Select aria-label="Pricing" value={order.pricing} onChange={(e) => setOrder({ ...order, pricing: e.target.value })}>
                {PRICING_IDS.map((id) => <option key={id} value={id}>{PRICING[id].label}</option>)}
              </Select>
            </Field>
            <Field label="Scope" className="sm:col-span-2">
              <Input aria-label="Scope" value={order.scope} onChange={(e) => setOrder({ ...order, scope: e.target.value })} placeholder="Internal plaster, all floors" />
            </Field>
            <Field label="Retention %" hint="Held against defects.">
              <Input aria-label="Retention percent" type="number" min="0" max="100" step="0.01" value={order.retentionPercent} onChange={(e) => setOrder({ ...order, retentionPercent: e.target.value })} />
            </Field>
            <Field label="TDS %">
              <Input aria-label="TDS percent" type="number" min="0" max="100" step="0.01" value={order.tdsPercent} onChange={(e) => setOrder({ ...order, tdsPercent: e.target.value })} />
            </Field>
            {/* Agreed when the contract is written, which is why they are here
                and the completion date is not. */}
            <Field label="PAN" hint="Blank means twenty per cent, which is a penalty and not a bracket.">
              <Input aria-label="Contractor PAN" value={order.pan} onChange={(e) => setOrder({ ...order, pan: e.target.value.toUpperCase() })} placeholder="AAAPZ1234C" maxLength={10} />
            </Field>
            <Field label="Deductee" hint="One per cent for an individual or HUF, two for anybody else.">
              <Select aria-label="Deductee type" value={order.deducteeType} onChange={(e) => setOrder({ ...order, deducteeType: e.target.value })}>
                {DEDUCTEE_IDS.map((id) => <option key={id} value={id}>{DEDUCTEE[id].label}</option>)}
              </Select>
            </Field>
            <Field label="Defect liability (months)" hint="Counted from the day the work is finished.">
              <Input aria-label="Defect liability months" type="number" min="0" max="120" step="1" value={order.dlpMonths} onChange={(e) => setOrder({ ...order, dlpMonths: e.target.value })} />
            </Field>
            <Field label="Released at completion %" hint="The rest comes back when the liability period ends.">
              <Input aria-label="Released at completion percent" type="number" min="0" max="100" step="0.01" value={order.releaseSplitPercent} onChange={(e) => setOrder({ ...order, releaseSplitPercent: e.target.value })} />
            </Field>
            {data.projects.length > 0 && (
              <Field label="Site" className="sm:col-span-2">
                <Select aria-label="Work order site" value={order.projectId} onChange={(e) => setOrder({ ...order, projectId: e.target.value })}>
                  <option value="">Not booked to a site</option>
                  {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Status">
              <Select aria-label="Order status" value={order.status} onChange={(e) => setOrder({ ...order, status: e.target.value })}>
                {ORDER_STATUS_IDS.map((id) => <option key={id} value={id}>{ORDER_STATUS[id].label}</option>)}
              </Select>
            </Field>
            <div className="sm:col-span-4">
              <Button type="submit" disabled={!order.contractor.trim()}><Plus size={16} /> Create {SIDE[side].noun.toLowerCase()}</Button>
            </div>
          </form>
        </Card>
      )}

      {canWrite && active && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-ink-3">
            RA bill {active.count + 1} — {active.order.contractor}
          </h3>
          {/* The single thing this screen has to get right. */}
          <p className="mt-1 text-xs text-ink-5">
            Enter the work done <strong>to date</strong>, not this bill’s amount. Already certified:{' '}
            {formatCurrency(active.certifiedToDate)}. What is payable now is worked out from the difference.
          </p>
          <form onSubmit={addBill} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Field label="Date">
              <Input aria-label="Bill date" type="date" value={bill.date} onChange={(e) => setBill({ ...bill, date: e.target.value })} />
            </Field>
            <Field label="Claimed to date">
              <Input aria-label="Claimed to date" type="number" min="0" step="0.01" value={bill.claimedToDate} onChange={(e) => setBill({ ...bill, claimedToDate: e.target.value })} />
            </Field>
            <Field label="Certified to date" required hint="What was measured, not what was asked for.">
              <Input aria-label="Certified to date" type="number" min="0" step="0.01" value={bill.certifiedToDate} onChange={(e) => setBill({ ...bill, certifiedToDate: e.target.value })} />
            </Field>
            <Field label="Advance recovered">
              <Input aria-label="Advance recovered" type="number" min="0" step="0.01" value={bill.advanceRecovered} onChange={(e) => setBill({ ...bill, advanceRecovered: e.target.value })} />
            </Field>
            <Field label="Material recovered" hint="Issued from the company’s stores.">
              <Input aria-label="Material recovered" type="number" min="0" step="0.01" value={bill.materialRecovered} onChange={(e) => setBill({ ...bill, materialRecovered: e.target.value })} />
            </Field>
            <Field label="Penalty">
              <Input aria-label="Penalty" type="number" min="0" step="0.01" value={bill.penalty} onChange={(e) => setBill({ ...bill, penalty: e.target.value })} />
            </Field>
            {num(bill.certifiedToDate) > 0 && (
              <div className="sm:col-span-4 rounded-lg border border-line bg-surface-raised p-3 text-xs text-ink-4">
                This bill: <strong className="text-ink-2">{formatCurrency(num(bill.certifiedToDate) - active.certifiedToDate)}</strong>
                {' '}· retention {formatCurrency((num(bill.certifiedToDate) - active.certifiedToDate) * (active.order.retention_percent / 100))}
                {' '}· TDS {formatCurrency((num(bill.certifiedToDate) - active.certifiedToDate) * (active.order.tds_percent / 100))}
              </div>
            )}
            <div className="sm:col-span-4 flex flex-wrap gap-2">
              <Button type="submit" disabled={!num(bill.certifiedToDate)}>Record bill</Button>
              <Button type="button" variant="ghost" onClick={() => setBilling(null)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      {report.count === 0 ? (
        <Card className="p-5">
          <EmptyState icon={FileSignature} title="No work orders yet" subtitle="Create one above and running account bills can be entered against it." />
        </Card>
      ) : (
        report.lines.map((l) => (
          <Card key={l.order.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-2">
                  {l.order.contractor}
                  <Badge color={l.order.status === 'closed' ? '#64748b' : '#2563eb'}>
                    {ORDER_STATUS[l.order.status]?.label || l.order.status}
                  </Badge>
                  {l.order.approval_status === 'pending' && <Badge color="#d97706">waiting for approval</Badge>}
                  {l.order.approval_status === 'rejected' && <Badge color="#dc2626">refused</Badge>}
                  {l.overOrder && <Badge color="#d97706">past the order value</Badge>}
                  {l.problems > 0 && <Badge color="#dc2626">{l.problems} to check</Badge>}
                </p>
                <p className="mt-0.5 text-xs text-ink-5">
                  {l.order.scope || 'No scope recorded'} · {siteName(l.order.project_id)}
                </p>
              </div>
              {canWrite && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="ghost" onClick={() => { setBilling(l.order.id); setBill({ ...bill, claimedToDate: '', certifiedToDate: '' }) }}>
                    <Plus size={14} /> RA bill
                  </Button>

                </div>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Cell label="Order" value={l.orderValue ? formatCurrency(l.orderValue) : '—'} />
              <Cell label="Certified" value={formatCurrency(l.certifiedToDate)} />
              <Cell label={side === 'sub' ? 'Paid out' : 'Received'} value={formatCurrency(l.netPayable)} />
              <Cell label="Retention held" value={formatCurrency(l.retentionHeld)} tone={l.retentionHeld > 0 ? 'warn' : undefined} />
              <Cell label="Of the order" value={l.percentComplete === null ? '—' : `${l.percentComplete}%`} />
            </div>

            {/* When it comes back. A balance held with no date against it is the
                state this block exists to make visible rather than restful. */}
            {schedules[l.order.id]?.accrued > 0 && (
              <div className="mt-3 rounded-xl border border-line-soft p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-[1px] text-ink-5">Retention release</h4>
                  <label className="flex items-center gap-2 text-[0.6875rem] text-ink-5">
                    Work finished
                    <input
                      type="date"
                      aria-label={`Completion date for ${l.order.contractor}`}
                      value={l.order.completed_on || ''}
                      disabled={!canWrite}
                      onChange={(e) => setCompleted(l.order.id, e.target.value)}
                      className="rounded-lg border border-line-soft bg-surface-1 px-2 py-1 text-[0.6875rem] text-ink-2"
                    />
                  </label>
                </div>
                {schedules[l.order.id].overReleased > 0 && (
                  <p className="mt-2 text-[0.6875rem] font-semibold text-bad">
                    {formatCurrency(schedules[l.order.id].overReleased)} more has been released than was ever held.
                  </p>
                )}
                <ul className="mt-2 space-y-1.5">
                  {schedules[l.order.id].tranches.map((t, i) => (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="text-ink-4">
                        {t.label}
                        {t.dueOn
                          ? <span className="text-ink-6"> · due {t.dueOn}</span>
                          : <span className="text-warn"> · no date until the work is marked finished</span>}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular font-semibold text-ink-2">{formatCurrency(t.outstanding || t.amount)}</span>
                        {t.state === 'released' && <Badge color="#16a34a">released</Badge>}
                        {t.state === 'due' && <Badge color="#d97706">{t.overdueDays > 0 ? `${t.overdueDays} days over` : 'due'}</Badge>}
                        {t.state === 'waiting' && <Badge color="#64748b">not yet</Badge>}
                        {t.state === 'undated' && <Badge color="#d97706">undated</Badge>}
                        {canWrite && side === 'sub' && t.outstanding > 0 && (
                          <Button variant="ghost" aria-label={`Release ${t.label.toLowerCase()} retention for ${l.order.contractor}`} onClick={() => releaseThrough(schedules[l.order.id], i)}>
                            Release
                          </Button>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
                {side === 'client' && schedules[l.order.id].due > 0 && (
                  <p className="mt-2 text-[0.6875rem] text-warn">
                    {formatCurrency(schedules[l.order.id].due)} of this stopped being security and became a debt. Nobody
                    sends an invoice for retention, which is why it sits.
                  </p>
                )}
              </div>
            )}

            {l.count > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead className="text-xs uppercase tracking-wide text-ink-5">
                    <tr>
                      <th className="py-2 text-start">Bill</th>
                      <th className="text-end">Certified to date</th>
                      <th className="text-end">This bill</th>
                      <th className="text-end">Retention</th>
                      <th className="text-end">TDS</th>
                      <th className="text-end">Recovered</th>
                      <th className="text-end">Net</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {l.lines.map((r) => (
                      <tr key={r.bill.id}>
                        <td className="py-2 text-ink-2">
                          RA {r.bill.number}
                          <span className="block text-[0.6875rem] text-ink-6">{r.bill.date}</span>
                          {r.bill.approval_status === 'pending' && <span className="block text-[0.6875rem] text-warn">waiting for approval</span>}
                          {r.overClaimed && <span className="block text-[0.6875rem] text-bad">certified above the claim</span>}
                          <button
                            type="button"
                            aria-label={`Payment certificate for RA ${r.bill.number}`}
                            onClick={() => certify(l.order, r.bill)}
                            className="mt-1 inline-flex items-center gap-1 text-[0.6875rem] font-semibold text-brand-ink underline-offset-4 hover:underline"
                          >
                            <Printer size={11} /> Certificate
                          </button>
                          {r.negative && <span className="block text-[0.6875rem] text-warn">certifies less than the last</span>}
                          {canWrite && (
                            <button type="button" aria-label={`Edit RA ${r.bill.number} for ${l.order.contractor}`}
                              className="mt-1 ms-3 inline-flex text-[0.6875rem] text-ink-5 underline-offset-2 hover:text-ink-2 hover:underline"
                              onClick={() => (editingBill === r.bill.id ? setEditingBill(null) : startBill(r.bill))}>
                              {editingBill === r.bill.id ? 'Close' : 'Edit'}
                            </button>
                          )}
                        </td>
                        <td className="text-end tabular text-ink-4">{formatCurrency(r.certifiedToDate)}</td>
                        <td className="text-end tabular font-medium text-ink-2">{formatCurrency(r.gross)}</td>
                        <td className="text-end tabular text-ink-4">{formatCurrency(r.retention)}</td>
                        <td className="text-end tabular text-ink-4">{formatCurrency(r.tds)}</td>
                        <td className="text-end tabular text-ink-4">{r.recovered ? formatCurrency(r.recovered) : '—'}</td>
                        <td className={cx('text-end tabular font-medium', r.net < 0 ? 'text-bad' : 'text-ink-2')}>
                          {formatCurrency(r.net)}
                        </td>
                      </tr>
                    ))}
                    {canWrite && l.lines.filter((r) => editingBill === r.bill.id).map((r) => {
                      // The bounds, shown before somebody types rather than as a
                      // refusal after: on a cumulative figure "invalid" is
                      // useless without saying what it has to sit between.
                      const bounds = canAmendBill(l.order, data.raBills, r.bill, num(billDraft.certifiedToDate))
                      const room = canAmendBill(l.order, data.raBills, r.bill, 0)
                      return (
                        <tr key={`${r.bill.id}-edit`}>
                          <td colSpan={7} className="py-3">
                            <div className="rounded-xl border border-line-soft p-3" role="group"
                              aria-label={`Editing RA ${r.bill.number}`}>
                              <p className="text-xs text-ink-5">
                                Certified <strong className="text-ink-3">to date</strong>, not this bill&rsquo;s amount.
                                It has to sit between {formatCurrency(room.floor || 0)}
                                {room.ceiling == null ? ' and whatever comes next' : ` and ${formatCurrency(room.ceiling)}`} —
                                the bills on either side are what make those the limits.
                              </p>
                              <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
                                <Field label="Bill date">
                                  <Input type="date" value={billDraft.date} onChange={(e) => setBillDraft({ ...billDraft, date: e.target.value })} />
                                </Field>
                                <Field label="Claimed to date">
                                  <Input type="number" min="0" step="0.01" value={billDraft.claimedToDate}
                                    onChange={(e) => setBillDraft({ ...billDraft, claimedToDate: e.target.value })} />
                                </Field>
                                <Field label="Certified to date" required
                                  hint={bounds.ok ? `This bill pays ${formatCurrency(num(billDraft.certifiedToDate) - (room.floor || 0))}.` : bounds.why}>
                                  <Input type="number" min="0" step="0.01" value={billDraft.certifiedToDate}
                                    onChange={(e) => setBillDraft({ ...billDraft, certifiedToDate: e.target.value })} />
                                </Field>
                                <Field label="Advance recovered">
                                  <Input type="number" min="0" step="0.01" value={billDraft.advanceRecovered}
                                    onChange={(e) => setBillDraft({ ...billDraft, advanceRecovered: e.target.value })} />
                                </Field>
                                <Field label="Material recovered">
                                  <Input type="number" min="0" step="0.01" value={billDraft.materialRecovered}
                                    onChange={(e) => setBillDraft({ ...billDraft, materialRecovered: e.target.value })} />
                                </Field>
                                <Field label="Penalty">
                                  <Input type="number" min="0" step="0.01" value={billDraft.penalty}
                                    onChange={(e) => setBillDraft({ ...billDraft, penalty: e.target.value })} />
                                </Field>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Button onClick={() => saveBill(l.order, r.bill)}>Save</Button>
                                <Button variant="ghost" onClick={() => setEditingBill(null)}>Cancel</Button>
                                <Button variant="ghost" aria-label={`Delete RA ${r.bill.number}`}
                                  onClick={() => dropBill(l.order, r.bill)}>Delete</Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {l.unCertified > 0 && (
              <p className="mt-2 flex items-center gap-2 text-xs text-warn">
                <Clock size={13} /> {formatCurrency(l.unCertified)} claimed and not yet certified.
              </p>
            )}
          </Card>
        ))
      )}
    </div>
  )
}

function Cell({ label, value, tone }) {
  return (
    <div>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[1px] text-ink-5">{label}</p>
      <p className={cx('mt-0.5 text-sm font-semibold tabular', tone === 'warn' ? 'text-warn' : 'text-ink-2')}>{value}</p>
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <Card className="p-4">
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[1.5px] text-ink-5">{label}</p>
      <p className={cx('mt-1 text-xl font-semibold tabular', tone === 'warn' ? 'text-warn' : 'text-ink-1')}>{value}</p>
    </Card>
  )
}
