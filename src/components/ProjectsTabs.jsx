import { useMemo, useState } from 'react'
import {
  HardHat, IndianRupee, ReceiptText, Plus, AlertTriangle, CalendarClock, Pencil, Check, X,
} from 'lucide-react'
import * as store from '../lib/storage/corporate'
import {
  makeProject, projectReport, unattributed, daysLate,
  PROJECT_STATUS, PROJECT_STATUS_IDS, isOpen,
} from '../lib/projects'
import { usageBySite } from '../lib/inventory'
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
  { id: 'costs', label: 'Costs', icon: IndianRupee },
  { id: 'billing', label: 'Billing', icon: ReceiptText },
]

const num = (v) => Number(v) || 0

// Material leaves the stores and becomes a cost of whichever job it went to.
// Both views need it, so it is worked out once here.
const materialCostsBy = (data) => {
  const out = {}
  for (const u of usageBySite(data.items, data.movements, { projects: data.projects })) {
    if (u.projectId) out[u.projectId] = u.value
  }
  return out
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

  const materialCosts = useMemo(() => materialCostsBy(data), [data])
  const report = useMemo(
    () => projectReport(data.projects, data.expenses, data.income, { openOnly, materialCosts }),
    [data, openOnly, materialCosts],
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
      store.projects.update(editing.id, { ...next, created_at: editing.created_at })
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

// ── Costs ───────────────────────────────────────────────────────────────────
function Costs({ data }) {
  const materialCosts = useMemo(() => materialCostsBy(data), [data])
  const report = useMemo(
    () => projectReport(data.projects, data.expenses, data.income, { materialCosts }),
    [data, materialCosts],
  )
  const loose = useMemo(() => unattributed(data.expenses, data.income), [data])
  const usage = useMemo(
    () => usageBySite(data.items, data.movements, { projects: data.projects }),
    [data],
  )
  const looseMaterial = usage.find((u) => !u.projectId)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Bills booked" value={formatCurrency(report.directCost)} />
        <Stat label="Material issued" value={formatCurrency(report.materialCost)} />
        <Stat label="Total on jobs" value={formatCurrency(report.spent)} />
        <Stat label="Owed on bills" value={formatCurrency(report.unpaid)} />
      </div>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-ink-3">Where the money went</h3>
        <p className="mt-1 text-xs text-ink-5">
          Bills booked to the site plus material issued to it from the stores. A builder who counts only the bills
          finds every job profitable and the company losing money.
        </p>
        {report.count === 0 ? (
          <p className="mt-3 text-sm text-ink-5">No sites yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-5">
                <tr>
                  <th className="py-2 text-start">Site</th>
                  <th className="text-end">Bills</th>
                  <th className="text-end">Material</th>
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
function Billing({ data }) {
  const materialCosts = useMemo(() => materialCostsBy(data), [data])
  const report = useMemo(
    () => projectReport(data.projects, data.expenses, data.income, { materialCosts }),
    [data, materialCosts],
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
