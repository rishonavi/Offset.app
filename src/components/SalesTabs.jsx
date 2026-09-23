import { useMemo, useState } from 'react'
import { Building2, IndianRupee, Plus, AlertTriangle, Wallet, Printer } from 'lucide-react'
import * as store from '../lib/storage/corporate'
import {
  makeUnit,
  makePlanStage,
  makeReceipt,
  salesReport,
  salesAgainstBuild,
  UNIT_KINDS,
  UNIT_KIND_IDS,
  UNIT_STATUS,
  UNIT_STATUS_IDS,
  AREA_BASIS,
  AREA_BASIS_IDS,
} from '../lib/sales'
import { siteProgress, WORK_STAGES, WORK_STAGE_IDS } from '../lib/progress'
import { demandLetter } from '../lib/siteDocs'
import { documentToPDF } from '../lib/siteDocsPdf'
import { formatCurrency } from '../lib/format'
import { Card, Button, Field, Input, Select, Badge, EmptyState, cx, attempt } from './ui'
import { todayISO } from '../lib/today'

// What the company is building to sell, and what the buyers owe for it.
//
// The rest of Operations is a cost ledger. This is the other side, and the
// join worth having is to the schedule of work: a construction-linked
// instalment falls due when the building reaches the stage it names, so what
// is owed today is derived from measured progress rather than from somebody
// remembering to send a demand letter.
const VIEWS = [
  { id: 'stock', label: 'Inventory', icon: Building2 },
  { id: 'collections', label: 'Collections', icon: IndianRupee },
]

const num = (v) => Number(v) || 0

const STATUS_COLOURS = {
  available: '#059669', blocked: '#d97706', held: '#7c3aed',
  booked: '#2563eb', agreement: '#2563eb', registered: '#0891b2',
  possession: '#64748b', cancelled: '#dc2626',
}

export default function Sales(shared) {
  const [view, setView] = useState('stock')
  return (
    <div className="space-y-4">
      {/* One scrolling row, like the bar above it. These wrapped 3/2 on a
          phone — a second tab idiom, in a second shape, directly under the
          first. `shrink-0` so the pills keep their size and the row runs off
          the end instead of squeezing. */}
      <div className="scroll-row flex gap-1" role="tablist" aria-label="Sales">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            onClick={() => setView(v.id)}
            aria-selected={view === v.id}
            className={cx(
              'inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-xs font-semibold transition',
              view === v.id
                ? 'border-brand bg-brand/15 text-ink-1'
                : 'border-line text-ink-5 hover:border-line-strong hover:text-ink-2',
            )}
          >
            <v.icon size={14} /> {v.label}
          </button>
        ))}
      </div>
      {view === 'stock' && <Inventory {...shared} />}
      {view === 'collections' && <Collections {...shared} />}
    </div>
  )
}

// Progress per stage of work, for whichever site is being looked at. This is
// what turns "10% on completion of 4th slab" into a figure.
const buildFor = (data, eid, projectId) => {
  const items = data.workItems.filter((i) => i.entity_id === eid && i.project_id === projectId)
  return siteProgress(items, data.measurements).stages
}

// ── Inventory ───────────────────────────────────────────────────────────────
function Inventory({ data, eid, actor, canWrite, bump, toast }) {
  const [site, setSite] = useState(data.projects[0]?.id || '')
  const blank = {
    name: '', kind: 'flat', tower: '', floor: '', configuration: '',
    carpetArea: '', superBuiltUpArea: '', areaBasis: 'carpet', ratePerArea: '',
    agreedPrice: '', otherCharges: '', status: 'available',
  }
  const [form, setForm] = useState(blank)

  const stages = useMemo(() => buildFor(data, eid, site), [data, eid, site])
  const report = useMemo(
    () => salesReport(data.units, data.planStages, data.receipts, { entityId: eid, projectId: site || undefined, progressStages: stages }),
    [data, eid, site, stages],
  )
  const built = useMemo(() => {
    const items = data.workItems.filter((i) => i.entity_id === eid && i.project_id === site)
    return siteProgress(items, data.measurements).percent
  }, [data, eid, site])
  const pace = useMemo(() => salesAgainstBuild(report, built), [report, built])

  const add = (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    store.units.add(makeUnit({
      entityId: eid, projectId: site || null, ...form,
      carpetArea: num(form.carpetArea), superBuiltUpArea: num(form.superBuiltUpArea),
      ratePerArea: num(form.ratePerArea), agreedPrice: num(form.agreedPrice),
      otherCharges: num(form.otherCharges), floor: form.floor === '' ? null : num(form.floor),
      createdBy: actor?.id,
    }), actor)
    setForm({ ...blank, kind: form.kind, tower: form.tower, areaBasis: form.areaBasis, ratePerArea: form.ratePerArea })
    bump()
    toast('Unit added')
  }

  const setStatus = (unit, status) => {
    store.units.update(unit.id, { status }, actor)
    bump()
    toast(`Marked ${UNIT_STATUS[status].label.toLowerCase()}`)
  }

  if (data.projects.length === 0) {
    return (
      <Card className="p-5">
        <EmptyState icon={Building2} title="No sites yet" subtitle="Add a site under Projects and the flats and shops in it go here." />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <Field label="Site" className="max-w-md">
          <Select aria-label="Sales site" value={site} onChange={(e) => setSite(e.target.value)}>
            {data.projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
          </Select>
        </Field>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Units" value={String(report.count)} />
        <Stat label="Sold" value={String(report.sold)} />
        {/* Available and held back are both unsold and are not the same thing:
            one can be sold tomorrow and the other cannot. */}
        <Stat label="Available" value={String(report.available)} />
        <Stat label="Held back" value={String(report.heldBack)} />
        <Stat label="Sold value" value={formatCurrency(report.soldValue)} />
        <Stat label="Still to sell" value={formatCurrency(report.availableValue)} />
      </div>

      {pace.known && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-ink-3">Selling against building</h3>
          {/* Opposite problems, and both look like progress on their own. */}
          <div className="mt-3 space-y-3">
            <Bar label="Sold" percent={pace.sold} tone="brand" />
            <Bar label="Built" percent={pace.built} tone="muted" />
          </div>
          <p className={cx('mt-3 text-sm font-medium',
            pace.aheadOfBuild ? 'text-warn' : pace.behindBuild ? 'text-warn' : 'text-ink-3')}>
            {pace.why}
          </p>
        </Card>
      )}

      {canWrite && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-ink-3">Add a unit</h3>
          <p className="mt-1 text-xs text-ink-5">
            Three numbers describe the same flat and they are not close — carpet is what you can walk on, super
            built-up adds a share of the lobby. A rate means nothing without saying which it is quoted on.
          </p>
          <form onSubmit={add} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Field label="Unit" required>
              <Input aria-label="Unit name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="A-1204" />
            </Field>
            <Field label="Kind">
              <Select aria-label="Unit kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                {UNIT_KIND_IDS.map((id) => <option key={id} value={id}>{UNIT_KINDS[id].label}</option>)}
              </Select>
            </Field>
            <Field label="Tower / wing">
              <Input aria-label="Tower" value={form.tower} onChange={(e) => setForm({ ...form, tower: e.target.value })} placeholder="A" />
            </Field>
            <Field label="Floor">
              <Input aria-label="Floor" type="number" value={form.floor} onChange={(e) => setForm({ ...form, floor: e.target.value })} />
            </Field>
            <Field label="Configuration">
              <Input aria-label="Configuration" value={form.configuration} onChange={(e) => setForm({ ...form, configuration: e.target.value })} placeholder="3BHK" />
            </Field>
            <Field label="Carpet area">
              <Input aria-label="Carpet area" type="number" min="0" step="0.01" value={form.carpetArea} onChange={(e) => setForm({ ...form, carpetArea: e.target.value })} />
            </Field>
            <Field label="Super built-up">
              <Input aria-label="Super built-up area" type="number" min="0" step="0.01" value={form.superBuiltUpArea} onChange={(e) => setForm({ ...form, superBuiltUpArea: e.target.value })} />
            </Field>
            <Field label="Priced on">
              <Select aria-label="Area basis" value={form.areaBasis} onChange={(e) => setForm({ ...form, areaBasis: e.target.value })}>
                {AREA_BASIS_IDS.map((id) => <option key={id} value={id}>{AREA_BASIS[id].label}</option>)}
              </Select>
            </Field>
            <Field label="Rate per sq ft">
              <Input aria-label="Rate per area" type="number" min="0" step="0.01" value={form.ratePerArea} onChange={(e) => setForm({ ...form, ratePerArea: e.target.value })} />
            </Field>
            <Field label="Agreed price" hint="Beats the rate card — the agreement is what is enforceable.">
              <Input aria-label="Agreed price" type="number" min="0" step="0.01" value={form.agreedPrice} onChange={(e) => setForm({ ...form, agreedPrice: e.target.value })} />
            </Field>
            <Field label="Other charges" hint="Floor rise, parking, club, deposits.">
              <Input aria-label="Other charges" type="number" min="0" step="0.01" value={form.otherCharges} onChange={(e) => setForm({ ...form, otherCharges: e.target.value })} />
            </Field>
            <Field label="Status">
              <Select aria-label="Unit status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {UNIT_STATUS_IDS.map((id) => <option key={id} value={id}>{UNIT_STATUS[id].label}</option>)}
              </Select>
            </Field>
            <div className="sm:col-span-4"><Button type="submit"><Plus size={16} /> Add unit</Button></div>
          </form>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-ink-3">The stock list</h3>
        {report.count === 0 ? (
          <p className="mt-3 text-sm text-ink-5">No units yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-5">
                <tr>
                  <th className="py-2 text-start">Unit</th>
                  <th className="text-start ps-3">Kind</th>
                  <th className="text-end">Carpet</th>
                  <th className="text-end">Price</th>
                  <th className="text-end">Received</th>
                  <th className="text-end">Due now</th>
                  <th className="text-start ps-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {report.lines.map((l) => (
                  <tr key={l.unit.id}>
                    <td className="py-2 text-ink-2">
                      {l.unit.name}
                      <span className="block text-[0.6875rem] text-ink-6">
                        {l.unit.tower && `${l.unit.tower} · `}
                        {l.unit.floor !== null && `floor ${l.unit.floor} · `}
                        {l.unit.configuration}
                      </span>
                    </td>
                    <td className="ps-3 text-ink-4">{UNIT_KINDS[l.unit.kind].label}</td>
                    <td className="text-end tabular text-ink-4">{l.unit.carpet_area || '—'}</td>
                    <td className="text-end tabular text-ink-3">{formatCurrency(l.agreed)}</td>
                    <td className="text-end tabular text-ink-4">{l.sold ? formatCurrency(l.received) : '—'}</td>
                    <td className={cx('text-end tabular', l.overdue > 0 ? 'text-bad' : l.dueNow > 0 ? 'text-warn' : 'text-ink-4')}>
                      {l.sold ? formatCurrency(l.dueNow) : '—'}
                    </td>
                    <td className="ps-3">
                      {canWrite ? (
                        <Select
                          aria-label={`Status of ${l.unit.name}`}
                          className="field-input-compact"
                          value={l.unit.status}
                          onChange={(e) => setStatus(l.unit, e.target.value)}
                        >
                          {UNIT_STATUS_IDS.map((id) => <option key={id} value={id}>{UNIT_STATUS[id].label}</option>)}
                        </Select>
                      ) : (
                        <Badge color={STATUS_COLOURS[l.unit.status]}>{UNIT_STATUS[l.unit.status].label}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {report.count > 0 && (
          <p className="mt-3 text-xs text-ink-6">
            {report.soldArea} sq ft sold, {report.availableArea} sq ft still available. A developer counts stock in
            square feet as often as in flats, and eight one-bedrooms are not eight penthouses.
          </p>
        )}
      </Card>
    </div>
  )
}

// ── Collections ─────────────────────────────────────────────────────────────
function Collections({ data, eid, actor, canWrite, bump, toast, company }) {
  const [site, setSite] = useState(data.projects[0]?.id || '')
  const [planning, setPlanning] = useState(null)
  const [stage, setStage] = useState({ label: '', percent: '', amount: '', workStage: '', triggerAt: '100', dueOn: '' })
  const [money, setMoney] = useState({ unitId: '', amount: '', date: todayISO(), mode: 'bank', reference: '' })

  const stages = useMemo(() => buildFor(data, eid, site), [data, eid, site])
  const report = useMemo(
    () => salesReport(data.units, data.planStages, data.receipts, { entityId: eid, projectId: site || undefined, progressStages: stages }),
    [data, eid, site, stages],
  )
  const sold = report.lines.filter((l) => l.sold)

  const addStage = (e) => {
    e.preventDefault()
    if (!planning || !stage.label.trim()) return
    const existing = data.planStages.filter((s) => s.unit_id === planning).length
    store.planStages.add(makePlanStage({
      unitId: planning, entityId: eid, label: stage.label,
      percent: num(stage.percent), amount: num(stage.amount),
      workStage: stage.workStage, triggerAt: num(stage.triggerAt) || 100,
      dueOn: stage.dueOn, sequence: existing + 1,
    }), actor)
    setStage({ label: '', percent: '', amount: '', workStage: stage.workStage, triggerAt: '100', dueOn: '' })
    bump()
    toast('Instalment added')
  }

  const addReceipt = (e) => {
    e.preventDefault()
    if (!money.unitId || !num(money.amount)) return
    if (!attempt(() => store.receipts.add(makeReceipt({
      unitId: money.unitId, entityId: eid, projectId: site || null,
      date: money.date, amount: num(money.amount), mode: money.mode,
      reference: money.reference, createdBy: actor?.id,
    }), actor), toast)) return
    setMoney({ ...money, amount: '', reference: '' })
    bump()
    toast('Receipt recorded')
  }

  if (data.projects.length === 0) {
    return (
      <Card className="p-5">
        <EmptyState icon={Wallet} title="No sites yet" subtitle="Add a site under Projects, then its flats and shops under Inventory." />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <Field label="Site" className="max-w-md">
          <Select aria-label="Collections site" value={site} onChange={(e) => setSite(e.target.value)}>
            {data.projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
          </Select>
        </Field>
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Agreed" value={formatCurrency(report.agreed)} />
        {/* Four figures that are routinely treated as one. */}
        <Stat label="Demanded" value={formatCurrency(report.demanded)} />
        <Stat label="Received" value={formatCurrency(report.received)} />
        <Stat label="Due now" value={formatCurrency(report.dueNow)} tone={report.dueNow > 0 ? 'warn' : undefined} />
        <Stat label="Overdue" value={formatCurrency(report.overdue)} tone={report.overdue > 0 ? 'warn' : undefined} />
        <Stat label="Not yet due" value={formatCurrency(report.notYetDue)} />
      </div>

      {(report.untriggered > 0 || report.unitsWithGap > 0) && (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-warn" />
            <h3 className="text-sm font-semibold text-ink-3">Plans that will not collect themselves</h3>
          </div>
          <p className="mt-1 text-xs text-ink-5">
            {report.untriggered > 0 && (
              <>
                {report.untriggered} {report.untriggered === 1 ? 'instalment names' : 'instalments name'} no stage of
                work and carry no date, so nothing will ever make them fall due.{' '}
              </>
            )}
            {report.unitsWithGap > 0 && (
              <>
                {report.unitsWithGap} {report.unitsWithGap === 1 ? 'plan does' : 'plans do'} not add up to the price
                agreed — the last instalment is where that shows.
              </>
            )}
          </p>
        </Card>
      )}

      {canWrite && sold.length > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-ink-3">Record money in</h3>
          <form onSubmit={addReceipt} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Field label="Unit" required>
              <Select aria-label="Receipt unit" value={money.unitId} onChange={(e) => setMoney({ ...money, unitId: e.target.value })}>
                <option value="">Choose…</option>
                {sold.map((l) => <option key={l.unit.id} value={l.unit.id}>{l.unit.name}</option>)}
              </Select>
            </Field>
            <Field label="Amount" required>
              <Input aria-label="Receipt amount" type="number" min="0" step="0.01" value={money.amount} onChange={(e) => setMoney({ ...money, amount: e.target.value })} />
            </Field>
            <Field label="Date">
              <Input aria-label="Receipt date" type="date" value={money.date} onChange={(e) => setMoney({ ...money, date: e.target.value })} />
            </Field>
            <Field label="How">
              <Select aria-label="Receipt mode" value={money.mode} onChange={(e) => setMoney({ ...money, mode: e.target.value })}>
                <option value="bank">Bank transfer</option>
                <option value="cheque">Cheque</option>
                <option value="loan">Bank loan</option>
                <option value="upi">UPI</option>
                <option value="cash">Cash</option>
              </Select>
            </Field>
            <div className="sm:col-span-4">
              <Button type="submit" disabled={!money.unitId || !num(money.amount)}><Plus size={16} /> Record receipt</Button>
            </div>
          </form>
          <p className="mt-2 text-xs text-ink-6">
            Applied to the oldest unpaid instalment first, which is how a clerk does it and the only rule that needs
            no extra typing.
          </p>
        </Card>
      )}

      {sold.length === 0 ? (
        <Card className="p-5">
          <EmptyState icon={Wallet} title="Nothing sold yet" subtitle="Mark a unit booked under Inventory and its payment plan goes here." />
        </Card>
      ) : (
        sold.map((l) => (
          <Card key={l.unit.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-2">
                  {l.unit.name}
                  <Badge color={STATUS_COLOURS[l.unit.status]}>{UNIT_STATUS[l.unit.status].label}</Badge>
                  {l.overdue > 0 && <Badge color="#dc2626">{formatCurrency(l.overdue)} overdue</Badge>}
                  {l.overpaid > 0 && <Badge color="#d97706">{formatCurrency(l.overpaid)} over</Badge>}
                </p>
                <p className="mt-0.5 text-xs text-ink-5">
                  {formatCurrency(l.agreed)} agreed
                  {l.percentReceived !== null && ` · ${l.percentReceived}% received`}
                  {Math.abs(l.planGap) > 1 && (
                    <span className="text-warn"> · plan is {formatCurrency(Math.abs(l.planGap))} {l.planGap > 0 ? 'short of' : 'over'} the price</span>
                  )}
                </p>
              </div>
              <span className="flex flex-wrap gap-2">
                {/* What actually collects money, and it says which stage of
                    work made the instalment due — the sentence that turns a
                    demand a buyer queries into one they pay. */}
                {l.dueNow > 0 && (
                  <Button
                    variant="ghost"
                    aria-label={`Demand letter for ${l.unit.name}`}
                    onClick={async () => {
                      try {
                        await documentToPDF(
                          demandLetter(l.unit, data.planStages, data.receipts, { company, progressStages: stages }),
                          { filename: `demand-${l.unit.name}.pdf` },
                        )
                      } catch (e) { toast(e?.message || String(e)) }
                    }}
                  >
                    <Printer size={14} /> Demand letter
                  </Button>
                )}
                {canWrite && (
                  <Button variant="ghost" onClick={() => setPlanning(planning === l.unit.id ? null : l.unit.id)}>
                    <Plus size={14} /> Instalment
                  </Button>
                )}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Cell label="Demanded" value={formatCurrency(l.demanded)} />
              <Cell label="Received" value={formatCurrency(l.received)} />
              <Cell label="Due now" value={formatCurrency(l.dueNow)} tone={l.dueNow > 0 ? 'warn' : undefined} />
              <Cell label="Not yet due" value={formatCurrency(l.notYetDue)} />
            </div>

            {canWrite && planning === l.unit.id && (
              <form onSubmit={addStage} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 rounded-xl border border-line p-4 sm:grid-cols-4">
                <p className="text-xs text-ink-5 sm:col-span-4">
                  A construction-linked instalment names a stage of work rather than a date — “on completion of the
                  structure” is a fact about the building, and it falls due when the site says so.
                </p>
                <Field label="Instalment" required className="sm:col-span-2">
                  <Input aria-label="Instalment label" value={stage.label} onChange={(e) => setStage({ ...stage, label: e.target.value })} placeholder="On structure" />
                </Field>
                <Field label="Percent">
                  <Input aria-label="Instalment percent" type="number" min="0" max="100" step="0.01" value={stage.percent} onChange={(e) => setStage({ ...stage, percent: e.target.value })} />
                </Field>
                <Field label="or Amount">
                  <Input aria-label="Instalment amount" type="number" min="0" step="0.01" value={stage.amount} onChange={(e) => setStage({ ...stage, amount: e.target.value })} />
                </Field>
                <Field label="Falls due on" className="sm:col-span-2">
                  <Select aria-label="Instalment work stage" value={stage.workStage} onChange={(e) => setStage({ ...stage, workStage: e.target.value })}>
                    <option value="">A date instead</option>
                    {WORK_STAGE_IDS.map((id) => <option key={id} value={id}>{WORK_STAGES[id].label}</option>)}
                  </Select>
                </Field>
                {stage.workStage ? (
                  <Field label="When it reaches" hint="Per cent of that stage.">
                    <Input aria-label="Trigger at" type="number" min="0" max="100" step="1" value={stage.triggerAt} onChange={(e) => setStage({ ...stage, triggerAt: e.target.value })} />
                  </Field>
                ) : (
                  <Field label="Date">
                    <Input aria-label="Instalment date" type="date" value={stage.dueOn} onChange={(e) => setStage({ ...stage, dueOn: e.target.value })} />
                  </Field>
                )}
                <div className="sm:col-span-4"><Button type="submit">Add instalment</Button></div>
              </form>
            )}

            {l.lines.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead className="text-xs uppercase tracking-wide text-ink-5">
                    <tr>
                      <th className="py-2 text-start">Instalment</th>
                      <th className="text-start ps-3">Falls due on</th>
                      <th className="text-end">Amount</th>
                      <th className="text-end">Received</th>
                      <th className="text-end">Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {l.lines.map((r) => (
                      <tr key={r.stage.id}>
                        <td className="py-2 text-ink-2">{r.stage.label}</td>
                        <td className="ps-3 text-ink-5">
                          {r.stage.work_stage
                            ? `${WORK_STAGES[r.stage.work_stage]?.label || r.stage.work_stage}${r.stage.trigger_at < 100 ? ` at ${r.stage.trigger_at}%` : ''}`
                            : r.stage.due_on || <span className="text-warn">nothing — it will never fall due</span>}
                        </td>
                        <td className="text-end tabular text-ink-3">{formatCurrency(r.amount)}</td>
                        <td className="text-end tabular text-ink-4">{r.due ? formatCurrency(r.received) : '—'}</td>
                        <td className={cx('text-end tabular', r.due && r.outstanding > 0 ? 'text-warn' : 'text-ink-4')}>
                          {r.due ? formatCurrency(r.outstanding) : 'not yet due'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  )
}

function Bar({ label, percent, tone }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-ink-5">{label}</span>
        <span className="tabular font-semibold text-ink-2">{percent}%</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-line-soft">
        <div
          className={cx('h-full rounded-full', tone === 'brand' ? 'bg-brand' : 'bg-ink-6')}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
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
