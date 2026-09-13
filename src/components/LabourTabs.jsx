import { useMemo, useState } from 'react'
import { Users, FileSignature, Plus, AlertTriangle, Clock } from 'lucide-react'
import * as store from '../lib/storage/corporate'
import { makeMuster, musterCost, labourReport, TRADES, TRADE_IDS } from '../lib/labour'
import {
  makeWorkOrder, makeRaBill, billLadder, subcontractReport,
  ORDER_STATUS, ORDER_STATUS_IDS, PRICING, PRICING_IDS,
} from '../lib/subcontract'
import { formatCurrency } from '../lib/format'
import { Card, Button, Field, Input, Select, Badge, EmptyState, cx } from './ui'

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

const today = () => new Date().toISOString().slice(0, 10)
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
              'inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-[0.78rem] font-semibold transition',
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
function Muster({ data, eid, actor, canWrite, bump, toast }) {
  const blank = {
    date: today(), trade: 'mason', headcount: '', rate: '',
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
    store.muster.add(makeMuster({
      entityId: eid, projectId: form.projectId || null, date: form.date, trade: form.trade,
      headcount: num(form.headcount), rate: num(form.rate),
      overtimeHours: num(form.overtimeHours), overtimeRate: num(form.overtimeRate),
      contractor: form.contractor, note: form.note, createdBy: actor?.id,
    }), actor)
    // The date, trade and rate stay: a muster is entered a dozen lines at a
    // time and re-typing yesterday's date for each is how it stops being kept.
    setForm({ ...blank, date: form.date, trade: form.trade, rate: form.rate, projectId: form.projectId })
    bump()
    toast('Muster recorded')
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
              <Input aria-label="Muster date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} max={today()} />
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
                    {!t.trade.skilled && <span className="ms-2 text-[0.7rem] text-ink-6">unskilled</span>}
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
                  <span className={cx('min-w-0 truncate', s.projectId ? 'text-ink-2' : 'text-amber-600')}>
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
        <h3 className="text-sm font-semibold text-ink-3">The register</h3>
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
                      <td className="py-2 text-ink-4">{m.date}</td>
                      <td className="ps-3 text-ink-2">{TRADES[m.trade]?.label || m.trade}</td>
                      <td className="text-end tabular text-ink-3">{m.headcount}</td>
                      <td className="text-end tabular text-ink-4">{formatCurrency(m.rate)}</td>
                      <td className="text-end tabular text-ink-4">{c.overtime ? formatCurrency(c.overtime) : '—'}</td>
                      <td className="text-end tabular font-medium">{formatCurrency(c.total)}</td>
                      <td className={cx('ps-3', m.project_id ? 'text-ink-4' : 'text-amber-600')}>{siteName(m.project_id)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

// ── Contractors ─────────────────────────────────────────────────────────────
function Contractors({ data, eid, actor, canWrite, bump, toast }) {
  const blankOrder = {
    contractor: '', scope: '', orderValue: '', pricing: 'lumpSum',
    retentionPercent: '5', tdsPercent: '1', projectId: '', dueOn: '', status: 'running',
  }
  const [order, setOrder] = useState(blankOrder)
  const [billing, setBilling] = useState(null)
  const [bill, setBill] = useState({ claimedToDate: '', certifiedToDate: '', advanceRecovered: '', materialRecovered: '', penalty: '', date: today() })

  const report = useMemo(
    () => subcontractReport(data.workOrders, data.raBills, { entityId: eid }),
    [data, eid],
  )
  const siteName = (id) => data.projects.find((p) => p.id === id)?.name || 'No site'

  const addOrder = (e) => {
    e.preventDefault()
    if (!order.contractor.trim()) return
    store.workOrders.add(makeWorkOrder({
      entityId: eid, projectId: order.projectId || null, contractor: order.contractor,
      scope: order.scope, orderValue: num(order.orderValue), pricing: order.pricing,
      retentionPercent: num(order.retentionPercent), tdsPercent: num(order.tdsPercent),
      dueOn: order.dueOn, status: order.status, createdBy: actor?.id,
    }), actor)
    setOrder(blankOrder)
    bump()
    toast('Work order created')
  }

  const addBill = (e) => {
    e.preventDefault()
    const line = report.lines.find((l) => l.order.id === billing)
    if (!line || !num(bill.certifiedToDate)) return
    store.raBills.add(makeRaBill({
      workOrderId: line.order.id, entityId: eid, projectId: line.order.project_id,
      number: line.count + 1, date: bill.date,
      claimedToDate: num(bill.claimedToDate) || num(bill.certifiedToDate),
      certifiedToDate: num(bill.certifiedToDate),
      advanceRecovered: num(bill.advanceRecovered),
      materialRecovered: num(bill.materialRecovered),
      penalty: num(bill.penalty),
      createdBy: actor?.id,
    }), actor)
    setBill({ claimedToDate: '', certifiedToDate: '', advanceRecovered: '', materialRecovered: '', penalty: '', date: today() })
    setBilling(null)
    bump()
    toast('Running account bill recorded')
  }

  const releaseRetention = (line) => {
    store.workOrders.update(line.order.id, { retention_released: line.retentionAccrued }, actor)
    bump()
    toast('Retention released')
  }

  const active = report.lines.find((l) => l.order.id === billing)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Work orders" value={String(report.count)} />
        <Stat label="Certified" value={formatCurrency(report.certified)} />
        {/* A liability with a release date, not a saving. */}
        <Stat label="Retention held" value={formatCurrency(report.retentionHeld)} />
        <Stat
          label="Claimed, not certified"
          value={formatCurrency(report.unCertified)}
          tone={report.unCertified > 0 ? 'warn' : undefined}
        />
      </div>

      {report.problems > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-600" />
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

      {canWrite && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-ink-3">New work order</h3>
          <p className="mt-1 text-xs text-ink-5">
            The agreed scope and rates. Running account bills are entered against it, and each one states the work
            done <em>to date</em> — not this month’s amount.
          </p>
          <form onSubmit={addOrder} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Field label="Contractor" required className="sm:col-span-2">
              <Input aria-label="Contractor" value={order.contractor} onChange={(e) => setOrder({ ...order, contractor: e.target.value })} placeholder="Sharma Plastering" />
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
              <Button type="submit" disabled={!order.contractor.trim()}><Plus size={16} /> Create work order</Button>
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
                  {l.retentionHeld > 0 && (
                    <Button variant="ghost" aria-label={`Release retention for ${l.order.contractor}`} onClick={() => releaseRetention(l)}>
                      Release retention
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Cell label="Order" value={l.orderValue ? formatCurrency(l.orderValue) : '—'} />
              <Cell label="Certified" value={formatCurrency(l.certifiedToDate)} />
              <Cell label="Paid out" value={formatCurrency(l.netPayable)} />
              <Cell label="Retention held" value={formatCurrency(l.retentionHeld)} tone={l.retentionHeld > 0 ? 'warn' : undefined} />
              <Cell label="Of the order" value={l.percentComplete === null ? '—' : `${l.percentComplete}%`} />
            </div>

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
                          <span className="block text-[0.7rem] text-ink-6">{r.bill.date}</span>
                          {r.overClaimed && <span className="block text-[0.7rem] text-red-600">certified above the claim</span>}
                          {r.negative && <span className="block text-[0.7rem] text-amber-600">certifies less than the last</span>}
                        </td>
                        <td className="text-end tabular text-ink-4">{formatCurrency(r.certifiedToDate)}</td>
                        <td className="text-end tabular font-medium text-ink-2">{formatCurrency(r.gross)}</td>
                        <td className="text-end tabular text-ink-4">{formatCurrency(r.retention)}</td>
                        <td className="text-end tabular text-ink-4">{formatCurrency(r.tds)}</td>
                        <td className="text-end tabular text-ink-4">{r.recovered ? formatCurrency(r.recovered) : '—'}</td>
                        <td className={cx('text-end tabular font-medium', r.net < 0 ? 'text-red-600' : 'text-ink-2')}>
                          {formatCurrency(r.net)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {l.unCertified > 0 && (
              <p className="mt-2 flex items-center gap-2 text-xs text-amber-600">
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
      <p className="text-[0.68rem] font-semibold uppercase tracking-[1px] text-ink-5">{label}</p>
      <p className={cx('mt-0.5 text-sm font-semibold tabular', tone === 'warn' ? 'text-amber-600' : 'text-ink-2')}>{value}</p>
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
