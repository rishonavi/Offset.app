import { useMemo, useState } from 'react'
import {
  HardHat, IndianRupee, ReceiptText, Ruler, Plus, AlertTriangle, CalendarClock, Pencil, Check, X, Printer,
} from 'lucide-react'
import * as store from '../lib/storage/corporate'
import {
  makeProject, projectSummary, projectReport, unattributed, daysLate,
  PROJECT_STATUS, PROJECT_STATUS_IDS, isOpen,
} from '../lib/projects'
import { usageBySite } from '../lib/inventory'
import { labourCostsBySite } from '../lib/labour'
import { subcontractCostsBySite, measurementCheck } from '../lib/subcontract'
import { plantCostsBySite } from '../lib/plant'
import {
  makeWorkItem, makeMeasurement, siteProgress, progressAgainstSpend,
  WORK_STAGES, WORK_STAGE_IDS, stageOf,
} from '../lib/progress'
import { measurementSheet } from '../lib/siteDocs'
import { documentToPDF } from '../lib/siteDocsPdf'
import { formatCurrency } from '../lib/format'
import { Card, Button, Field, Input, Select, Textarea, Badge, EmptyState, cx } from './ui'

// The jobs, and whether anyone can tell they are losing money.
//
// Three views, which are three questions a builder asks in this order: how is
// each job doing, where did the money go, and has the client paid. They are
// sub-tabs for the same reason Materials has them — one job, three angles, and
// splitting them across the side bar would put a quarter of the same table on
// four screens.
const VIEWS = [
  { id: 'sites', label: 'Sites', icon: HardHat },
  { id: 'progress', label: 'Progress', icon: Ruler },
  { id: 'costs', label: 'Costs', icon: IndianRupee },
  { id: 'billing', label: 'Billing', icon: ReceiptText },
]

const num = (v) => Number(v) || 0

// A job is not its bills. It is its bills, the material issued to it, the
// muster roll, what its subcontractors were certified for, and the machines
// that worked on it — and leaving any one of those out makes the job look
// cheaper than it is. Worked out once here because three views need the same
// four maps.
const costsBy = (data, eid) => {
  const materialCosts = {}
  for (const u of usageBySite(data.items, data.movements, { projects: data.projects })) {
    if (u.projectId) materialCosts[u.projectId] = u.value
  }
  return {
    materialCosts,
    labourCosts: labourCostsBySite(data.muster, { entityId: eid }),
    subcontractCosts: subcontractCostsBySite(data.workOrders, data.raBills, { entityId: eid }),
    plantCosts: plantCostsBySite(data.plant, data.plantLogs, { entityId: eid }),
  }
}

export default function Projects(shared) {
  const [view, setView] = useState('sites')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Projects">
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

      {view === 'sites' && <Sites {...shared} />}
      {view === 'progress' && <Progress {...shared} />}
      {view === 'costs' && <Costs {...shared} />}
      {view === 'billing' && <Billing {...shared} />}
    </div>
  )
}

// ── Sites ───────────────────────────────────────────────────────────────────
const blankSite = {
  name: '', code: '', client: '', siteAddress: '',
  contractValue: '', estimate: '', startedOn: '', dueOn: '', status: 'planned', notes: '',
}

function Sites({ data, eid, actor, canWrite, bump, toast }) {
  const [form, setForm] = useState(blankSite)
  const [editing, setEditing] = useState(null)
  const [openOnly, setOpenOnly] = useState(false)

  const costs = useMemo(() => costsBy(data, eid), [data, eid])
  const report = useMemo(
    () => projectReport(data.projects, data.expenses, data.income, { openOnly, ...costs }),
    [data, openOnly, costs],
  )

  const save = (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    const payload = {
      ...form,
      contractValue: num(form.contractValue),
      estimate: num(form.estimate),
    }
    if (editing) {
      // makeProject re-derives the stored shape, then the id and the creation
      // date are put back: editing a site must not make it a different one.
      const next = makeProject({ ...payload, entityId: eid, id: editing.id })
      store.projects.update(editing.id, { ...next, created_at: editing.created_at }, actor)
      toast('Site updated')
    } else {
      store.projects.add(makeProject({ ...payload, entityId: eid }), actor)
      toast('Site added')
    }
    setForm(blankSite)
    setEditing(null)
    bump()
  }

  const edit = (project) => {
    setEditing(project)
    setForm({
      name: project.name, code: project.code || '', client: project.client || '',
      siteAddress: project.site_address || '',
      contractValue: project.contract_value || '', estimate: project.estimate || '',
      startedOn: project.started_on || '', dueOn: project.due_on || '',
      status: project.status, notes: project.notes || '',
    })
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Sites" value={String(report.count)} />
        <Stat label="Under contract" value={formatCurrency(report.contract)} />
        <Stat label="Spent" value={formatCurrency(report.spent)} />
        {/* Over the costing, not over the contract. The two answer different
            questions and the report keeps them apart. */}
        <Stat
          label="Over estimate"
          value={report.overrunning ? `${report.overrunning} · ${formatCurrency(report.overrunTotal)}` : '0'}
          tone={report.overrunning ? 'warn' : undefined}
        />
      </div>

      {canWrite && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-ink-3">{editing ? `Edit ${editing.name}` : 'Add a site'}</h3>
            {editing && (
              <Button variant="ghost" onClick={() => { setEditing(null); setForm(blankSite) }}>
                <X size={15} /> Cancel
              </Button>
            )}
          </div>
          {/* The one thing worth saying on this form, because getting it wrong
              is how a job looks profitable right up until it isn't. */}
          <p className="mt-1 text-xs text-ink-5">
            The contract is what the client agreed to pay. The estimate is what the work was costed at. They are not
            the same number — margin is measured against the first and overrun against the second.
          </p>
          <form onSubmit={save} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Field label="Site" required className="sm:col-span-2">
              <Input aria-label="Site name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Marine Drive Tower" />
            </Field>
            <Field label="Code" hint="Goes on a delivery note.">
              <Input aria-label="Site code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="MD-1" />
            </Field>
            <Field label="Status">
              <Select aria-label="Site status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                {PROJECT_STATUS_IDS.map((id) => <option key={id} value={id}>{PROJECT_STATUS[id].label}</option>)}
              </Select>
            </Field>
            <Field label="Client" className="sm:col-span-2">
              <Input aria-label="Client" value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} />
            </Field>
            <Field label="Contract value" hint="What the client pays.">
              <Input aria-label="Contract value" type="number" step="0.01" min="0" value={form.contractValue}
                onChange={(e) => setForm({ ...form, contractValue: e.target.value })} />
            </Field>
            <Field label="Estimate" hint="What it was costed at.">
              <Input aria-label="Estimate" type="number" step="0.01" min="0" value={form.estimate}
                onChange={(e) => setForm({ ...form, estimate: e.target.value })} />
            </Field>
            <Field label="Started" className="sm:col-span-2">
              <Input aria-label="Started on" type="date" value={form.startedOn} onChange={(e) => setForm({ ...form, startedOn: e.target.value })} />
            </Field>
            <Field label="Due" className="sm:col-span-2">
              <Input aria-label="Due on" type="date" value={form.dueOn} onChange={(e) => setForm({ ...form, dueOn: e.target.value })} />
            </Field>
            <Field label="Site address" className="sm:col-span-4">
              <Input aria-label="Site address" value={form.siteAddress} onChange={(e) => setForm({ ...form, siteAddress: e.target.value })} />
            </Field>
            <Field label="Notes" className="sm:col-span-4">
              <Textarea aria-label="Site notes" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
            <div className="sm:col-span-4">
              <Button type="submit">
                {editing ? <><Check size={16} /> Save site</> : <><Plus size={16} /> Add site</>}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink-3">Every site, worst first</h3>
          <label className="flex items-center gap-2 text-xs text-ink-5">
            <input type="checkbox" aria-label="Open sites only" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            Open only
          </label>
        </div>
        {report.count === 0 ? (
          <EmptyState
            icon={HardHat}
            title="No sites yet"
            subtitle="Add one above and material, bills and invoices can be booked to it."
          />
        ) : (
          <ul className="mt-3 space-y-3">
            {report.lines.map((l) => <SiteLine key={l.project.id} line={l} onEdit={canWrite ? edit : null} />)}
          </ul>
        )}
      </Card>
    </div>
  )
}

function SiteLine({ line, onEdit }) {
  const { project } = line
  const late = daysLate(project)
  return (
    <li className="rounded-xl border border-line p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-2">
            {project.name}
            {project.code && <span className="text-xs font-normal text-ink-6">{project.code}</span>}
            <Badge color={isOpen(project.status) ? '#2563eb' : '#64748b'}>
              {PROJECT_STATUS[project.status]?.label || project.status}
            </Badge>
            {line.overEstimate && <Badge color="#d97706">over estimate</Badge>}
            {line.losing && <Badge color="#dc2626">losing money</Badge>}
            {late !== null && (
              <Badge color="#dc2626">{late} {late === 1 ? 'day' : 'days'} late</Badge>
            )}
          </p>
          <p className="mt-0.5 text-xs text-ink-5">
            {project.client || 'No client named'}
            {project.due_on && <> · due {project.due_on}</>}
          </p>
        </div>
        {onEdit && (
          <Button variant="ghost" aria-label={`Edit ${project.name}`} onClick={() => onEdit(project)}>
            <Pencil size={14} />
          </Button>
        )}
      </div>

      {/* A site with neither a contract nor an estimate has nothing to compare
          against. Saying so beats printing 0% and letting it read as healthy. */}
      {line.uncosted ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-ink-5">
          <AlertTriangle size={13} className="text-amber-600" />
          Nothing costed on this site yet, so there is nothing to measure {formatCurrency(line.spent)} of spend against.
        </p>
      ) : (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Cell label="Contract" value={line.contract ? formatCurrency(line.contract) : '—'} />
            <Cell label="Estimate" value={line.estimate ? formatCurrency(line.estimate) : '—'} />
            <Cell label="Spent" value={formatCurrency(line.spent)} />
            <Cell
              label="Margin"
              value={line.margin === null ? '—' : `${formatCurrency(line.margin)}${line.marginPercent === null ? '' : ` · ${line.marginPercent}%`}`}
              tone={line.losing ? 'bad' : line.margin !== null ? 'good' : undefined}
            />
          </div>
          {line.usedPercent !== null && (
            <div className="mt-3">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-line-soft">
                <div
                  className={cx('h-full rounded-full', line.overEstimate ? 'bg-amber-500' : 'bg-brand')}
                  style={{ width: `${Math.min(100, line.usedPercent)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-ink-5">
                {line.usedPercent}% of the estimate used
                {line.overEstimate && <span className="text-amber-600"> · {formatCurrency(line.overrun)} over</span>}
              </p>
            </div>
          )}
        </>
      )}
    </li>
  )
}

// ── Progress ────────────────────────────────────────────────────────────────
// The one screen in this app that is not financial.
//
// Everything else here counts money. This counts cubic metres and square feet,
// and it exists so the two can be put side by side — because a site 40% built
// that has spent 60% of its budget is in trouble, and no ledger will say so.
function Progress({ data, eid, actor, canWrite, bump, toast, company }) {
  const [siteId, setSiteId] = useState(data.projects[0]?.id || '')
  const blankItem = { code: '', description: '', stage: 'structure', unit: 'cum', plannedQty: '', rate: '', workOrderId: '' }
  const [item, setItem] = useState(blankItem)
  const [measure, setMeasure] = useState({ workItemId: '', qty: '', date: new Date().toISOString().slice(0, 10), note: '' })

  const site = data.projects.find((p) => p.id === siteId) || null
  const items = useMemo(
    () => data.workItems.filter((i) => i.entity_id === eid && i.project_id === siteId),
    [data, eid, siteId],
  )
  const progress = useMemo(() => siteProgress(items, data.measurements), [items, data])
  // Subcontracts on this site, for the link a schedule item can carry.
  const siteOrders = useMemo(
    () => data.workOrders.filter((o) => o.entity_id === eid && o.project_id === siteId && !o.deleted_at && (o.side || 'sub') === 'sub'),
    [data, eid, siteId],
  )
  // Certified against measured, per order. The comparison the app could not
  // make until a schedule item could say which contract bills it.
  const checked = useMemo(
    () => measurementCheck(data.workOrders, data.raBills, items, data.measurements, { entityId: eid }),
    [data, items, eid],
  )
  const costs = useMemo(() => costsBy(data, eid), [data, eid])
  const summary = useMemo(
    () => (site ? projectSummary(site, data.expenses, data.income, {
      materialCost: costs.materialCosts[site.id] || 0,
      labourCost: costs.labourCosts[site.id] || 0,
      subcontractCost: costs.subcontractCosts[site.id] || 0,
      plantCost: costs.plantCosts[site.id] || 0,
    }) : null),
    [site, data, costs],
  )
  const against = useMemo(
    () => progressAgainstSpend({
      earned: progress.earned,
      value: progress.value,
      spent: summary?.spent || 0,
      estimate: summary?.estimate || 0,
    }),
    [progress, summary],
  )

  const addItem = (e) => {
    e.preventDefault()
    if (!siteId || !item.description.trim()) return
    store.workItems.add(makeWorkItem({
      entityId: eid, projectId: siteId, ...item,
      plannedQty: num(item.plannedQty), rate: num(item.rate),
      workOrderId: item.workOrderId || null,
    }), actor)
    setItem({ ...blankItem, stage: item.stage, unit: item.unit })
    bump()
    toast('Work item added')
  }

  const addMeasurement = (e) => {
    e.preventDefault()
    if (!measure.workItemId || !num(measure.qty)) return
    store.measurements.add(makeMeasurement({
      workItemId: measure.workItemId, entityId: eid, projectId: siteId,
      date: measure.date, qty: num(measure.qty), note: measure.note, recordedBy: actor?.id,
    }), actor)
    setMeasure({ ...measure, workItemId: '', qty: '', note: '' })
    bump()
    toast('Measurement recorded')
  }

  if (data.projects.length === 0) {
    return (
      <Card className="p-5">
        <EmptyState icon={Ruler} title="No sites yet" subtitle="Add a site under Sites and its schedule of work goes here." />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Field label="Site" className="max-w-md grow">
            <Select aria-label="Progress site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {data.projects.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
            </Select>
          </Field>
          {/* What a contractor's bill is checked against, and argues with. */}
          {progress.count > 0 && site && (
            <Button
              variant="ghost"
              aria-label="Print measurement sheet"
              onClick={async () => {
                try {
                  await documentToPDF(measurementSheet(site, data.workItems, data.measurements, { company }))
                } catch (e) { toast(e?.message || String(e)) }
              }}
            >
              <Printer size={14} /> Measurement sheet
            </Button>
          )}
        </div>
      </Card>

      {/* The comparison the whole view exists for. */}
      <Card className="p-5">
        <h3 className="text-sm font-semibold text-ink-3">Built against spent</h3>
        {!against.known ? (
          <p className="mt-2 text-sm text-ink-5">{against.why}</p>
        ) : (
          <>
            <div className="mt-3 space-y-3">
              <Bar label="Of the building" percent={against.built} tone="brand" />
              <Bar label="Of the budget" percent={against.burnt} tone={against.behind ? 'warn' : 'muted'} />
            </div>
            <p className={cx('mt-3 flex items-center gap-2 text-sm font-medium',
              against.behind ? 'text-amber-600' : against.ahead ? 'text-emerald-600' : 'text-ink-3')}>
              {against.behind && <AlertTriangle size={15} />}
              {against.why}
            </p>
            {against.forecast !== null && (
              <p className="mt-1 text-xs text-ink-6">
                At this rate the job finishes at about {formatCurrency(against.forecast)} against an estimate of{' '}
                {formatCurrency(summary.estimate)}. A projection, not a figure — it assumes the rest costs what the
                part already built cost, which is optimistic while the finishes are still to come.
              </p>
            )}
          </>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Schedule value" value={formatCurrency(progress.value)} />
        <Stat label="Built" value={progress.percent === null ? '—' : `${progress.percent}%`} />
        <Stat label="Items done" value={`${progress.itemsComplete}/${progress.count}`} />
        <Stat label="Left to build" value={formatCurrency(progress.remainingValue)} />
      </div>

      {canWrite && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-ink-3">Add to the schedule</h3>
            <p className="mt-1 text-xs text-ink-5">
              What is to be built, how much of it, and the rate it was priced at. The rate is what weights progress —
              half the items done means nothing if the other half is the expensive half.
            </p>
            <form onSubmit={addItem} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-4">
              <Field label="Stage" className="sm:col-span-2">
                <Select aria-label="Work stage" value={item.stage} onChange={(e) => setItem({ ...item, stage: e.target.value })}>
                  {WORK_STAGE_IDS.map((id) => <option key={id} value={id}>{WORK_STAGES[id].label}</option>)}
                </Select>
              </Field>
              <Field label="Code">
                <Input aria-label="Item code" value={item.code} onChange={(e) => setItem({ ...item, code: e.target.value })} placeholder="S-1" />
              </Field>
              <Field label="Unit">
                <Input aria-label="Item unit" value={item.unit} onChange={(e) => setItem({ ...item, unit: e.target.value })} placeholder="cum" />
              </Field>
              <Field label="Description" required className="sm:col-span-4">
                <Input aria-label="Item description" value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} placeholder="RCC framed structure" />
              </Field>
              <Field label="Planned quantity" className="sm:col-span-2">
                <Input aria-label="Planned quantity" type="number" min="0" step="any" value={item.plannedQty} onChange={(e) => setItem({ ...item, plannedQty: e.target.value })} />
              </Field>
              <Field label="Rate" className="sm:col-span-2">
                <Input aria-label="Item rate" type="number" min="0" step="0.01" value={item.rate} onChange={(e) => setItem({ ...item, rate: e.target.value })} />
              </Field>
              {/* The link that turns a certified figure back into the tape
                  measure it came from. Only offered where there are orders on
                  this site to link to, because a select with one option saying
                  "none" is a field people learn to skip. */}
              {siteOrders.length > 0 && (
                <Field label="Billed under" className="sm:col-span-4"
                  hint="Only where the contract is priced against this item. A labour-only rate against a full-rate item compares two different things.">
                  <Select aria-label="Billed under" value={item.workOrderId} onChange={(e) => setItem({ ...item, workOrderId: e.target.value })}>
                    <option value="">No subcontract</option>
                    {siteOrders.map((o) => <option key={o.id} value={o.id}>{o.contractor}{o.ref ? ` — ${o.ref}` : ''}</option>)}
                  </Select>
                </Field>
              )}
              <div className="sm:col-span-4"><Button type="submit"><Plus size={16} /> Add item</Button></div>
            </form>
          </Card>

          {/* What was certified against what was measured. Two screens that had
              nothing between them until a schedule item could name its
              contract. */}
          {(checked.count > 0 || checked.unlinkedCount > 0) && (
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-ink-3">Certified against measured</h3>
              <p className="mt-1 text-xs text-ink-5">
                What a contractor claims, against what the engineer recorded. The measurement book always lags the
                bill by a few days, so a small gap is ordinary — a large one is the only sign there is.
              </p>
              {checked.count === 0 ? (
                <p className="mt-3 text-sm text-ink-5">
                  No scheduled item names a subcontract yet, so there is nothing to compare. Set <em>Billed under</em>
                  {' '}on the items a contract is priced against.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {checked.lines.map((l) => (
                    <li key={l.order.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                      <span className="text-ink-2">
                        {l.order.contractor}
                        <span className="block text-[0.7rem] text-ink-6">
                          {formatCurrency(l.certified)} certified · {formatCurrency(l.measured)} measured
                          {' '}across {l.items} {l.items === 1 ? 'item' : 'items'}
                        </span>
                      </span>
                      <span className={cx('tabular font-semibold',
                        l.ahead ? 'text-red-600' : l.behind ? 'text-amber-600' : 'text-ink-4')}>
                        {l.gap > 0 ? '+' : ''}{formatCurrency(l.gap)}
                        {l.gapPercent !== null && <span className="ms-1 text-[0.7rem] font-medium">({l.gapPercent > 0 ? '+' : ''}{l.gapPercent}%)</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {checked.unlinkedCount > 0 && (
                // The reader is told how much of the book this covered. A check
                // is only as good as the linking behind it.
                <p className="mt-2 text-[0.7rem] text-ink-6">
                  {checked.unlinkedCount} {checked.unlinkedCount === 1 ? 'contract names' : 'contracts name'} no
                  scheduled item, so {checked.unlinkedCount === 1 ? 'it is' : 'they are'} not compared.
                </p>
              )}
            </Card>
          )}

          <Card className="p-5">
            <h3 className="text-sm font-semibold text-ink-3">Record a measurement</h3>
            <p className="mt-1 text-xs text-ink-5">
              Quantities, not percentages. A site engineer measures 42 cubic metres; a percentage asked for directly
              is a guess dressed up as a measurement. A negative quantity corrects an earlier one.
            </p>
            <form onSubmit={addMeasurement} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <Field label="Item" required className="sm:col-span-2">
                <Select aria-label="Measured item" value={measure.workItemId} onChange={(e) => setMeasure({ ...measure, workItemId: e.target.value })}>
                  <option value="">Choose…</option>
                  {items.map((i) => <option key={i.id} value={i.id}>{i.code ? `${i.code} · ` : ''}{i.description}</option>)}
                </Select>
              </Field>
              <Field label="Quantity" required>
                <Input aria-label="Measured quantity" type="number" step="any" value={measure.qty} onChange={(e) => setMeasure({ ...measure, qty: e.target.value })} />
              </Field>
              <Field label="Date">
                <Input aria-label="Measured on" type="date" value={measure.date} onChange={(e) => setMeasure({ ...measure, date: e.target.value })} />
              </Field>
              <Field label="Note" className="sm:col-span-2">
                <Input aria-label="Measurement note" value={measure.note} onChange={(e) => setMeasure({ ...measure, note: e.target.value })} placeholder="Slab, 4th floor" />
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit" disabled={!measure.workItemId}><Plus size={16} /> Record</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {progress.count === 0 ? (
        <Card className="p-5">
          <EmptyState icon={Ruler} title="No schedule yet" subtitle="Add what is to be built and progress can be measured against it." />
        </Card>
      ) : (
        progress.stages.map((st) => (
          <Card key={st.stage.id} className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink-3">{st.stage.label}</h3>
              <span className="text-xs text-ink-5">
                {st.percent === null ? 'unpriced' : `${st.percent}%`} · {formatCurrency(st.earned)} of {formatCurrency(st.value)}
              </span>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[38rem] text-sm">
                <thead className="text-xs uppercase tracking-wide text-ink-5">
                  <tr>
                    <th className="py-2 text-start">Item</th>
                    <th className="text-end">Planned</th>
                    <th className="text-end">Done</th>
                    <th className="text-end">Left</th>
                    <th className="text-end">Progress</th>
                    <th className="text-end">Value built</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {progress.lines.filter((l) => l.item.stage === st.stage.id).map((l) => (
                    <tr key={l.item.id}>
                      <td className="py-2 text-ink-2">
                        {l.item.code && <span className="text-ink-6">{l.item.code} · </span>}
                        {l.item.description}
                        {l.over && <span className="block text-[0.7rem] text-amber-600">more built than scheduled</span>}
                      </td>
                      <td className="text-end tabular text-ink-4">{l.planned} {l.item.unit}</td>
                      <td className="text-end tabular text-ink-3">{l.done}</td>
                      <td className="text-end tabular text-ink-4">{l.remaining}</td>
                      <td className={cx('text-end tabular', l.complete ? 'text-emerald-600' : 'text-ink-3')}>
                        {l.percent === null ? '—' : `${l.percent}%`}
                      </td>
                      <td className="text-end tabular font-medium">{formatCurrency(l.earned)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
          className={cx('h-full rounded-full',
            tone === 'warn' ? 'bg-amber-500' : tone === 'brand' ? 'bg-brand' : 'bg-ink-6')}
          style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
        />
      </div>
    </div>
  )
}

// ── Costs ───────────────────────────────────────────────────────────────────
function Costs({ data, eid }) {
  const costs = useMemo(() => costsBy(data, eid), [data, eid])
  const report = useMemo(
    () => projectReport(data.projects, data.expenses, data.income, costs),
    [data, costs],
  )
  const loose = useMemo(() => unattributed(data.expenses, data.income), [data])
  const usage = useMemo(
    () => usageBySite(data.items, data.movements, { projects: data.projects }),
    [data],
  )
  const looseMaterial = usage.find((u) => !u.projectId)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total on jobs" value={formatCurrency(report.spent)} />
        <Stat label="Bills booked" value={formatCurrency(report.directCost)} />
        <Stat label="Material issued" value={formatCurrency(report.materialCost)} />
        <Stat label="Labour" value={formatCurrency(report.labourCost)} />
        {/* Certified, not paid: retention and TDS change when the money leaves,
            not whether the work was done. */}
        <Stat label="Subcontractors" value={formatCurrency(report.subcontractCost)} />
        <Stat label="Plant" value={formatCurrency(report.plantCost)} />
      </div>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-ink-3">Where the money went</h3>
        <p className="mt-1 text-xs text-ink-5">
          Bills booked to the site, material issued to it from the stores, the muster roll, and what its
          subcontractors were certified for, and the machines that worked on it. A builder who counts only the bills
          finds every job profitable and the company losing money.
        </p>
        {report.count === 0 ? (
          <p className="mt-3 text-sm text-ink-5">No sites yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[50rem] text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-5">
                <tr>
                  <th className="py-2 text-start">Site</th>
                  <th className="text-end">Bills</th>
                  <th className="text-end">Material</th>
                  <th className="text-end">Labour</th>
                  <th className="text-end">Contractors</th>
                  <th className="text-end">Plant</th>
                  <th className="text-end">Spent</th>
                  <th className="text-end">Of estimate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {report.lines.map((l) => (
                  <tr key={l.project.id}>
                    <td className="py-2 text-ink-2">{l.project.name}</td>
                    <td className="text-end tabular text-ink-4">{formatCurrency(l.directCost)}</td>
                    <td className="text-end tabular text-ink-4">{formatCurrency(l.materialCost)}</td>
                    <td className="text-end tabular text-ink-4">{formatCurrency(l.labourCost)}</td>
                    <td className="text-end tabular text-ink-4">{formatCurrency(l.subcontractCost)}</td>
                    <td className="text-end tabular text-ink-4">{formatCurrency(l.plantCost)}</td>
                    <td className="text-end tabular font-medium">{formatCurrency(l.spent)}</td>
                    <td className={cx('text-end tabular', l.overEstimate ? 'text-amber-600' : 'text-ink-4')}>
                      {l.usedPercent === null ? '—' : `${l.usedPercent}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* The number that quietly grows. A site's true cost is wrong by whatever
          sits in here, and nobody looks for a total nobody prints. */}
      {(loose.count > 0 || looseMaterial) && (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-600" />
            <h3 className="text-sm font-semibold text-ink-3">Booked to no site</h3>
          </div>
          <p className="mt-1 text-xs text-ink-5">
            Overheads are real, but every rupee here is missing from some job’s cost.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Cell label="Bills" value={formatCurrency(loose.spent)} />
            <Cell label="Material" value={formatCurrency(looseMaterial?.value || 0)} />
            <Cell label="Entries" value={String(loose.count + (looseMaterial?.entries || 0))} />
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Billing ─────────────────────────────────────────────────────────────────
function Billing({ data, eid }) {
  const costs = useMemo(() => costsBy(data, eid), [data, eid])
  const report = useMemo(
    () => projectReport(data.projects, data.expenses, data.income, costs),
    [data, costs],
  )

  // Work done that has not been invoiced at all. On a running account this is
  // usually larger than the unpaid invoices and nobody has a number for it.
  const lines = report.lines.map((l) => ({
    ...l,
    unbilled: l.contract > 0 ? Math.max(0, Math.round((l.contract - l.billed) * 100) / 100) : null,
  }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Under contract" value={formatCurrency(report.contract)} />
        <Stat label="Invoiced" value={formatCurrency(report.billed)} />
        <Stat label="Received" value={formatCurrency(report.received)} />
        <Stat
          label="Outstanding"
          value={formatCurrency(report.outstanding)}
          tone={report.outstanding > 0 ? 'warn' : undefined}
        />
      </div>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-ink-3">What each client owes</h3>
        <p className="mt-1 text-xs text-ink-5">
          Invoiced is what has been billed against the contract. Not yet billed is work the contract covers that
          nobody has raised an invoice for — usually the larger number, and the one nobody has.
        </p>
        {report.count === 0 ? (
          <p className="mt-3 text-sm text-ink-5">No sites yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[38rem] text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-5">
                <tr>
                  <th className="py-2 text-start">Site</th>
                  <th className="text-start ps-4">Client</th>
                  <th className="text-end">Contract</th>
                  <th className="text-end">Invoiced</th>
                  <th className="text-end">Outstanding</th>
                  <th className="text-end">Not yet billed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {lines.map((l) => (
                  <tr key={l.project.id}>
                    <td className="py-2 text-ink-2">{l.project.name}</td>
                    <td className="ps-4 text-ink-4">{l.project.client || '—'}</td>
                    <td className="text-end tabular text-ink-4">{l.contract ? formatCurrency(l.contract) : '—'}</td>
                    <td className="text-end tabular text-ink-4">{formatCurrency(l.billed)}</td>
                    <td className={cx('text-end tabular', l.outstanding > 0 ? 'text-amber-600' : 'text-ink-4')}>
                      {formatCurrency(l.outstanding)}
                    </td>
                    <td className="text-end tabular text-ink-3">
                      {l.unbilled === null ? '—' : formatCurrency(l.unbilled)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {report.late > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <CalendarClock size={16} className="text-red-600" />
            <h3 className="text-sm font-semibold text-ink-3">Past their date</h3>
          </div>
          {/* Said in days rather than as a flag: "four days over" and "eight
              months over" are not the same conversation. */}
          <ul className="mt-3 divide-y divide-line-soft">
            {report.lines
              .filter((l) => daysLate(l.project) !== null)
              .sort((a, b) => daysLate(b.project) - daysLate(a.project))
              .map((l) => (
                <li key={l.project.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-ink-2">{l.project.name}</span>
                  <span className="tabular text-red-600">
                    {daysLate(l.project)} days past {l.project.due_on}
                  </span>
                </li>
              ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

function Cell({ label, value, tone }) {
  return (
    <div>
      <p className="text-[0.68rem] font-semibold uppercase tracking-[1px] text-ink-5">{label}</p>
      <p className={cx('mt-0.5 text-sm font-semibold tabular',
        tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-600' : 'text-ink-2')}>{value}</p>
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
