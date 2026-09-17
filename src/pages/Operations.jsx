import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Boxes, HandCoins, Users, HardHat, Truck, Building2, Wallet, Plus, Check, FileSpreadsheet } from 'lucide-react'
import { useEntity } from '../context/EntityContext'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import * as store from '../lib/storage/corporate'
import { makeAdvance, makeAdjustment, outstandingAdvances, advancesByParty, balanceOf, canAdjust, ADVANCE_PARTIES } from '../lib/advances'
import {
  makeEmployee, runPayroll, makePayrollRun, recordedRun, canRerun, canSetStatus,
  configForEntity, statutoryStatus, SCHEMES, SCHEME_IDS,
  isLocked, RUN_STATUS, RUN_STATUS_LABEL,
} from '../lib/payroll'
import { STATES, STATES_BY_NAME, stateFromGstin, describeState, AS_OF } from '../lib/ptax'
import { gratuityLiability, VESTING_YEARS } from '../lib/gratuity'
import { bonusRegister, MIN_RATE, MAX_RATE, ELIGIBILITY_CEILING, CALCULATION_CEILING } from '../lib/bonus'
import { formatCurrency, formatDate } from '../lib/format'
import { approvalQueue } from '../lib/corporate'
import { Card, Button, Field, Input, Select, EmptyState, Badge, cx, attempt } from '../components/ui'
import SheetImport from '../components/SheetImport'
import PageHeader from '../components/PageHeader'
import Materials from '../components/MaterialsTabs'
import Projects from '../components/ProjectsTabs'
import Labour from '../components/LabourTabs'
import Plant from '../components/PlantTabs'
import Sales from '../components/SalesTabs'

// Sites, materials, labour, plant, advances and payroll — what a company runs
// on and a landlord does not.
//
// All three were written and tested a while ago and had no screen at all, which
// made them the largest gap in the app: 151 assertions of working logic that
// nobody could reach. They share a page rather than taking three more places in
// the side bar, because they are one job — running the company behind the
// property — and because eleven destinations was already too many.
const TABS = [
  // Sites first: everything else on this page is a cost, and a cost belongs to
  // a job before it belongs to a ledger.
  { id: 'projects', label: 'Projects', icon: HardHat },
  { id: 'materials', label: 'Materials', icon: Boxes },
  { id: 'labour', label: 'Labour', icon: Users },
  { id: 'plant', label: 'Plant', icon: Truck },
  // The other side of the ledger: what the company is building to sell.
  { id: 'sales', label: 'Sales', icon: Building2 },
  { id: 'advances', label: 'Advances', icon: HandCoins },
  { id: 'payroll', label: 'Payroll', icon: Wallet },
  // Everything here can be typed in and on a real site nothing is.
  { id: 'import', label: 'Import', icon: FileSpreadsheet },
]

const thisMonth = () => new Date().toISOString().slice(0, 7)
const today = () => new Date().toISOString().slice(0, 10)

export default function Operations() {
  const ent = useEntity()
  // Bills and invoices live in the main ledger, not the corporate store, and a
  // site's cost is meaningless without them.
  const { expenses, income } = useData()
  const toast = useToast()
  // In the URL, so a finding somewhere else can send somebody straight to the
  // thing it is about. A note saying "₹60,000 of plant hire has no log sheet"
  // that then makes you hunt through seven tabs is a note people stop reading.
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'projects'
  const setTab = (id) => setParams(id === 'projects' ? {} : { tab: id }, { replace: true })
  // The corporate store is synchronous and outside React, so a counter is what
  // tells the page something changed. It is the same pattern EntityContext uses.
  const [version, setVersion] = useState(0)
  const bump = () => setVersion((v) => v + 1)

  const eid = ent?.activeId
  const scoped = ent?.corporate && eid && !ent.consolidated

  const data = useMemo(() => {
    if (!scoped) return null
    return {
      items: store.items.list(eid),
      movements: store.movements.list(eid),
      stockCounts: store.stockCounts.list(eid),
      quotes: store.quotes.list(eid),
      projects: store.projects.list(eid),
      muster: store.muster.list(eid),
      workOrders: store.workOrders.list(eid),
      raBills: store.raBills.list(eid),
      workItems: store.workItems.list(eid),
      measurements: store.measurements.list(eid),
      plant: store.plant.list(eid),
      plantLogs: store.plantLogs.list(eid),
      units: store.units.list(eid),
      planStages: store.planStages.list(),
      receipts: store.receipts.list(eid),
      advances: store.advances.list(eid),
      adjustments: store.adjustments.list(),
      employees: store.employees.list(eid),
      payrollRuns: store.payrollRuns.list(eid),
      expenses,
      income,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, eid, version, expenses, income])

  // A control nobody finds gets switched off, and the queue lives on another
  // page — so the page where the documents are raised says when something is
  // held up, rather than waiting to be visited.
  const waiting = useMemo(() => {
    if (!scoped || !ent.policy?.enabled) return approvalQueue([])
    return approvalQueue([
      { kind: 'expense', rows: expenses.filter((e) => e.entity_id === eid) },
      { kind: 'advance', rows: data?.advances || [] },
      { kind: 'workorder', rows: data?.workOrders || [] },
      { kind: 'rabill', rows: data?.raBills || [] },
    ], { role: ent.role, userId: ent.actor?.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, eid, data, expenses, ent.policy?.enabled, ent.role])

  if (!ent?.enabled) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader title="Operations" subtitle="Sites, materials, labour, plant, sales and payroll." />
        <EmptyState
          icon={Boxes}
          title="Add a company first"
          subtitle="Sites, materials, labour, plant, sales and payroll belong to a company. Create one under Companies and this fills in."
        />
      </div>
    )
  }
  if (!scoped) {
    const personal = ent.personal
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader title="Operations" subtitle="Sites, materials, labour, plant, sales and payroll." />
        <EmptyState
          icon={Boxes}
          title={personal ? 'You are in your personal books' : 'Pick one company'}
          subtitle={
            personal
              ? 'Sites, materials, labour, plant, sales and payroll belong to a company. Switch to one at the top of the side bar and this fills in.'
              : 'These are kept per company, so the consolidated view has nothing to show. Switch to a single company above.'
          }
        />
      </div>
    )
  }

  const canWrite = ent.canWrite && ent.can('entry.create')
  // What goes at the top of anything that leaves the building.
  const company = { name: ent.entity?.name || 'Company', gstin: ent.entity?.gstin || '', address: ent.entity?.address || '' }
  // The company's own year, not April by assumption: a tax year that starts in
  // the wrong month adds a contractor's payments into the wrong return.
  const shared = { data, eid, actor: ent.actor, canWrite, bump, toast, gate: ent.gate, role: ent.role, company, fyStart: ent.entity?.fy_start_month || 4, entity: ent.entity, reloadEntity: ent.reload }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="Operations" subtitle={`Sites, materials, labour, plant, sales and payroll for ${ent.entity?.name || 'this company'}.`} />

      {waiting.count > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-ink-3">
            <strong className="text-ink-1">
              {waiting.count} {waiting.count === 1 ? 'document is' : 'documents are'} waiting for approval
            </strong>
            , holding {formatCurrency(waiting.total)}.
            {waiting.mine > 0 && ` ${waiting.mine} you can sign.`}
          </p>
          <Link to="/companies" className="text-sm font-semibold text-brand underline-offset-4 hover:underline">
            Review them
          </Link>
        </Card>
      )}

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

      {tab === 'projects' && <Projects {...shared} />}
      {tab === 'materials' && <Materials {...shared} />}
      {tab === 'labour' && <Labour {...shared} />}
      {tab === 'plant' && <Plant {...shared} />}
      {tab === 'sales' && <Sales {...shared} />}
      {tab === 'advances' && <Advances {...shared} />}
      {tab === 'payroll' && <Payroll {...shared} />}
      {tab === 'import' && <SheetImport {...shared} />}
    </div>
  )
}

// ── Advances ────────────────────────────────────────────────────────────────
function Advances({ data, eid, actor, canWrite, bump, toast, gate }) {
  const [form, setForm] = useState({ party: '', partyType: 'vendor', amount: '', purpose: '', expectedBy: '' })
  const [settle, setSettle] = useState({ advanceId: '', amount: '', note: '' })
  const out = useMemo(() => outstandingAdvances(data.advances, data.adjustments, { entityId: eid }), [data, eid])
  const byParty = useMemo(() => advancesByParty(data.advances, data.adjustments, { entityId: eid }), [data, eid])

  const add = (e) => {
    e.preventDefault()
    if (!form.party.trim() || !Number(form.amount)) return
    const row = makeAdvance({ entityId: eid, ...form, amount: Number(form.amount), date: today(), createdBy: actor?.id })
    if (!attempt(() => store.advances.add({ ...row, ...gate(row, 'advance') }, actor), toast)) return
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
    if (!attempt(() => store.adjustments.add(makeAdjustment({ entityId: eid, advanceId: advance.id, amount, note: settle.note, date: today() }), actor), toast)) return
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
function Payroll({ data, eid, actor, canWrite, bump, toast, entity, reloadEntity }) {
  const [form, setForm] = useState({ name: '', code: '', basic: '', hra: '', special: '', workState: '', female: '' })
  const [period, setPeriod] = useState(thisMonth())
  // Off by default. Recovering an advance out of someone's salary without being
  // asked is the kind of surprise that costs trust, so it is a decision the
  // person running payroll makes, once, per run.
  const [recover, setRecover] = useState(false)

  const byId = useMemo(() => new Map(data.employees.map((e) => [e.id, e])), [data.employees])

  // What the company has said about the two schemes. Neither runs until it has
  // said yes, and neither used to be askable — the payroll simply deducted.
  // Every answer the company gives, or the field is written and never read
  // back. The bonus rate and the minimum wage were missing from this list: the
  // input took the number, the entity kept it, and the figure above it did not
  // move — which looks exactly like the app ignoring you.
  const config = useMemo(() => configForEntity(entity), [
    entity?.pf_registered, entity?.esi_registered, entity?.pt_state, entity?.gstin,
    entity?.bonus_rate, entity?.minimum_wage, entity?.gratuity_voluntary, entity?.bonus_voluntary,
  ])
  // The company has already said which state it is in, at the front of its
  // GSTIN. Asking a second time only gives the two a chance to disagree, so the
  // picker's blank option is that answer rather than nothing.
  const derivedState = stateFromGstin(entity?.gstin)
  const ptState = entity?.pt_state || derivedState || ''
  const setPtState = (code) => {
    store.updateEntity(eid, { pt_state: code || null }, actor)
    reloadEntity?.()
    bump()
    toast(code ? `Professional tax: ${STATES[code]?.name}` : derivedState ? `Professional tax: ${STATES[derivedState]?.name}, from the GSTIN` : 'No state chosen')
  }
  const employed = useMemo(() => data.employees.filter((e) => e.active !== false).length, [data.employees])
  const schemes = useMemo(() => statutoryStatus({ headcount: employed, config }), [employed, config])

  // Neither of these is a deduction and neither reaches a payslip, which is
  // exactly why they go unnoticed: nothing in a month's accounts moves and both
  // grow anyway. Gratuity falls due when a job ends and the men are paid off;
  // bonus falls due eight months after the year closes.
  const gratuity = useMemo(() => gratuityLiability(data.employees, { config: config.gratuity }),
    [data.employees, config.gratuity])
  const bonus = useMemo(() => bonusRegister(data.employees, {
    fyStartMonth: entity?.fy_start_month || 4,
    rate: config.bonus.rate, minimumWage: config.bonus.minimumWage, config: config.bonus,
    born: entity?.created_at || '',
  }), [data.employees, entity?.fy_start_month, entity?.created_at, config.bonus])

  const setCompany = (patch, said) => {
    store.updateEntity(eid, patch, actor)
    reloadEntity?.()
    bump()
    toast(said)
  }

  const answer = (id, value) => {
    store.updateEntity(eid, { [`${id}_registered`]: value }, actor)
    // The answer lives on the company row, not in this page's data, so bumping
    // the page's own version reads the same stale entity back. Without this the
    // button looked pressed and the payslips below it did not move.
    reloadEntity?.()
    bump()
    toast(value === null
      ? `${SCHEMES[id].short} left unanswered`
      : `${SCHEMES[id].short} ${value ? 'on' : 'off'} for this company`)
  }

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

  // The month as it was run, where somebody has run it. Only a month with no
  // record is worked out from today's salaries — which is the right answer for
  // this month and the wrong one for every month before it.
  const kept = useMemo(
    () => recordedRun(data.payrollRuns || [], { entityId: eid, period }),
    [data.payrollRuns, eid, period],
  )

  const run = useMemo(() => {
    if (kept) return { ...kept, employerCost: kept.employer_cost }
    const perEmployee = {}
    if (recover) {
      for (const [id, hit] of matched) perEmployee[id] = { advanceRecovery: hit.total }
    }
    return runPayroll(data.employees, { period, perEmployee, config })
    // A recovery bigger than the pay is clamped by payslipFor and flagged, not
    // hidden — so the run still balances and the problem is visible.
  }, [kept, data.employees, period, recover, matched, config])

  // Running it writes what is on screen. A month already approved is history
  // and the store refuses, so the button is not the control — `canRerun` is.
  const keepRun = () => {
    const allowed = canRerun(kept)
    if (!allowed.ok) return toast(allowed.why)
    const perEmployee = {}
    if (recover) for (const [id, hit] of matched) perEmployee[id] = { advanceRecovery: hit.total }
    const fresh = runPayroll(data.employees, { period, perEmployee, config })
    const row = makePayrollRun({
      id: kept?.id, entityId: eid, period, run: fresh, employees: data.employees, actor,
    })
    if (kept) store.payrollRuns.update(kept.id, row, actor)
    else store.payrollRuns.add(row, actor, eid)
    bump()
    toast(`${period} recorded — ${row.headcount} ${row.headcount === 1 ? 'payslip' : 'payslips'}`)
  }

  const setStatus = (next) => {
    const allowed = canSetStatus(kept, next)
    if (!allowed.ok) return toast(allowed.why)
    store.payrollRuns.update(kept.id, {
      status: next,
      ...(next === RUN_STATUS.approved
        ? { approved_by: actor?.id || null, approved_at: new Date().toISOString() }
        : {}),
      ...(next === RUN_STATUS.paid ? { paid_at: new Date().toISOString() } : {}),
    }, actor)
    bump()
    toast(next === RUN_STATUS.approved ? `${period} approved` : `${period} marked paid`)
  }

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
      // Blank means the company's own state, and blank sex means nobody said —
      // which is not the same as "not a woman" and is why the run counts them.
      workState: form.workState,
      female: form.female === 'f' ? true : form.female === 'm' ? false : null,
    }), actor)
    setForm({ name: '', code: '', basic: '', hra: '', special: '', workState: '', female: '' })
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
          entityId: eid,
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

      {/* Neither scheme is something every employer has, and neither used to be
          askable: the payroll defaulted both to on, so a builder with four men
          and no registration had twelve per cent taken off every payslip with
          nowhere to turn it off. */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink-3">Provident fund and state insurance</h2>
        <p className="mt-1 text-xs text-ink-5">
          Both turn on a headcount and on whether this company is registered, and they are separate questions — a
          company can be registered while under the threshold, or over it and not registered. Nothing is deducted
          until you say.
        </p>
        <ul className="mt-3 space-y-2">
          {SCHEME_IDS.map((id) => {
            const st = schemes[id]
            return (
              <li key={id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line-soft p-3">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-2">
                    {st.label}
                    {st.runs && <Badge color="#059669">deducting</Badge>}
                    {/* Over the threshold and not registered is not a setting.
                        It is a thing somebody has to do something about. */}
                    {st.mustRegister && <Badge color="#dc2626">required at {st.threshold}</Badge>}
                    {!st.answered && !st.mustRegister && <Badge color="#d97706">not answered</Badge>}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-5">{st.why}</span>
                  <span className="mt-0.5 block text-[0.68rem] text-ink-6">{st.note}</span>
                </span>
                <span className="flex shrink-0 gap-1" role="group" aria-label={`${st.short} registration`}>
                  {[['Yes', true], ['No', false], ['Not sure', null]].map(([label, value]) => (
                    <button
                      key={label}
                      type="button"
                      disabled={!canWrite}
                      aria-label={`${st.short} registered: ${label}`}
                      onClick={() => answer(id, value)}
                      className={cx('rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
                        st.registered === value
                          ? 'border-brand bg-brand/15 text-ink-1'
                          : 'border-line text-ink-5 hover:border-line-strong hover:text-ink-2')}
                    >
                      {label}
                    </button>
                  ))}
                </span>
              </li>
            )
          })}
        </ul>
        {/* The per-person half of the ESI rule, which no headcount decides. */}
        {schemes.esi.runs && (
          <p className="mt-2 text-[0.68rem] text-ink-6">
            State insurance covers only those drawing up to {formatCurrency(config.esi.grossCeiling)} gross. Anybody
            above it is left out of it, person by person.
          </p>
        )}
      </Card>

      {/* Professional tax is twenty-two different taxes wearing one name, and
          this app had one set of slabs — Maharashtra's — switched on for
          everybody. A company in Delhi, which levies none at all, had ₹200 a
          month taken off every payslip. */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink-3">Professional tax</h2>
            <p className="mt-1 text-xs text-ink-5">
              A state levy, and the states agree on nothing below the ₹2,500 a year the Constitution caps them at.
              Fourteen states and union territories charge none.
            </p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-xs text-ink-5">
            State
            <Select
              className="field-input-compact w-auto"
              aria-label="Professional tax state"
              disabled={!canWrite}
              value={entity?.pt_state || ''}
              onChange={(e) => setPtState(e.target.value)}
            >
              <option value="">{derivedState ? `From the GSTIN — ${STATES[derivedState]?.name}` : 'Not chosen'}</option>
              {STATES_BY_NAME.map((st) => (
                <option key={st.code} value={st.code}>
                  {st.name}{st.levies ? (st.known ? '' : ' — slabs not built in') : ' — no professional tax'}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <p className="mt-2 text-xs text-ink-4">{describeState(ptState)}</p>
        {/* Not a footnote. A slab that moved last April is a wrong payslip every
            month until somebody notices, and the app cannot know that it has. */}
        <p className="mt-1 text-[0.68rem] text-ink-6">
          Slabs as of {formatDate(AS_OF)}. States revise them in their budgets — check yours against its own
          notification before you file.
        </p>
        {ptState && STATES[ptState]?.caveat && (
          <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/[0.05] p-2.5 text-xs text-ink-4">
            {STATES[ptState].caveat}
          </p>
        )}
        {run.ptax && (
          <ul className="mt-3 space-y-1.5 text-xs">
            {run.ptax.states.filter((st) => st.code).map((st) => (
              <li key={st.code} className="flex items-center justify-between gap-3 text-ink-4">
                <span>{st.name} — {st.people} {st.people === 1 ? 'person' : 'people'}</span>
                <span className="tabular font-medium text-ink-2">{formatCurrency(st.amount)}</span>
              </li>
            ))}
            {/* Three ways this can be quietly wrong, each said rather than
                folded into a zero. */}
            {run.ptax.unanswered > 0 && (
              <li className="text-ink-5">
                <Badge color="#d97706">no state</Badge>{' '}
                {run.ptax.unanswered} {run.ptax.unanswered === 1 ? 'person has' : 'people have'} no state, so nothing is
                worked out for them.
              </li>
            )}
            {run.ptax.needsSlabs > 0 && (
              <li className="text-ink-5">
                <Badge color="#dc2626">slabs missing</Badge>{' '}
                {run.ptax.needsSlabs} {run.ptax.needsSlabs === 1 ? 'person works' : 'people work'} in a state that does
                levy professional tax whose slabs are not built in. Nothing is being deducted and something is owed.
              </li>
            )}
            {/* Deducting, but from this app's reading rather than from
                something anybody should file on unchecked. The smaller states
                revise their slabs quietly and a wrong one is a wrong payslip
                every month with nothing on screen to say so. */}
            {run.ptax.verify > 0 && (
              <li className="text-ink-5">
                <Badge color="#d97706">check these slabs</Badge>{' '}
                {run.ptax.verify} {run.ptax.verify === 1 ? 'person is' : 'people are'} on slabs that are this app&rsquo;s
                best reading of the state&rsquo;s notification. Check them once against it, and enter your own if they
                differ.
              </li>
            )}
            {run.ptax.mayBeExempt > 0 && (
              <li className="text-ink-5">
                <Badge color="#d97706">sex not recorded</Badge>{' '}
                {run.ptax.mayBeExempt} {run.ptax.mayBeExempt === 1 ? 'person is' : 'people are'} under{' '}
                {STATES[ptState]?.name || 'this state'}&rsquo;s women&rsquo;s exemption and nobody recorded whether they
                are women. They are being deducted from meanwhile.
              </li>
            )}
          </ul>
        )}
      </Card>

      {/* Gratuity: the money the company already owes and has never added up.
          Nothing monthly mentions it, so the liability grows in silence and
          falls due all at once when a site finishes and the men are paid off. */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-3">
              Gratuity
              {gratuity.applies
                ? <Badge color="#2563eb">{gratuity.voluntary ? 'paid voluntarily' : 'applies'}</Badge>
                : <Badge color="#64748b">under {gratuity.threshold}</Badge>}
            </h2>
            <p className="mt-1 text-xs text-ink-5">{gratuity.why}</p>
          </div>
          {!gratuity.over && canWrite && (
            <label className="flex shrink-0 items-center gap-2 text-xs text-ink-5">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand"
                aria-label="This company pays gratuity anyway"
                checked={Boolean(entity?.gratuity_voluntary)}
                onChange={(e) => setCompany({ gratuity_voluntary: e.target.checked },
                  e.target.checked ? 'Gratuity is paid here' : 'Gratuity is not paid here')}
              />
              We pay it anyway
            </label>
          )}
        </div>
        {gratuity.applies && (
          <>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* Owed today against a bet on people staying. Adding the two
                  together would make one number that is true of neither. */}
              <Stat label="Owed if everyone left today" value={formatCurrency(gratuity.vestedTotal)} />
              <Stat label="Not yet vested" value={formatCurrency(gratuity.unvested)} />
              <Stat label="Accrued in all" value={formatCurrency(gratuity.accrued)} />
            </div>
            <p className="mt-2 text-xs text-ink-5">
              Fifteen days of basic and dearness allowance for each year worked, payable after {VESTING_YEARS} years.
              It is a cost the company carries, not a deduction, so it appears on no payslip.
            </p>
            {gratuity.undated > 0 && (
              <p className="mt-2 text-xs text-ink-4">
                <Badge color="#d97706">no joining date</Badge>{' '}
                {gratuity.undated} {gratuity.undated === 1 ? 'person has' : 'people have'} no joining date, so nothing
                is worked out for them and the figures above are short by however much they are owed.
              </p>
            )}
            {gratuity.vestingSoon.length > 0 && (
              <div className="mt-3 rounded-xl border border-line-soft p-3">
                {/* On a site where a dozen men started together, the cliff
                    arrives for all of them in the same month. */}
                <p className="text-xs font-semibold text-ink-3">
                  Crossing {VESTING_YEARS} years within the year
                </p>
                <ul className="mt-1.5 space-y-1 text-xs text-ink-5">
                  {gratuity.vestingSoon.slice(0, 6).map((l) => (
                    <li key={l.employee_id} className="flex items-center justify-between gap-3">
                      <span>{l.name} — {l.monthsToVest === 0 ? 'this month' : `in ${l.monthsToVest} ${l.monthsToVest === 1 ? 'month' : 'months'}`}</span>
                      <span className="tabular text-ink-3">{formatCurrency(l.accrued)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Bonus, and the two ceilings everybody runs together. */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-3">
              Bonus for {bonus.year.label}
              {bonus.applies && bonus.year.overdue && <Badge color="#dc2626">overdue</Badge>}
              {bonus.applies && !bonus.year.overdue && bonus.year.closed && (
                <Badge color="#d97706">due {formatDate(bonus.year.due)}</Badge>
              )}
              {!bonus.applies && <Badge color="#64748b">under {bonus.threshold}</Badge>}
            </h2>
            <p className="mt-1 text-xs text-ink-5">{bonus.why}</p>
          </div>
          {!bonus.over && canWrite && (
            <label className="flex shrink-0 items-center gap-2 text-xs text-ink-5">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand"
                aria-label="This company pays a bonus anyway"
                checked={Boolean(entity?.bonus_voluntary)}
                onChange={(e) => setCompany({ bonus_voluntary: e.target.checked },
                  e.target.checked ? 'Bonus is paid here' : 'Bonus is not paid here')}
              />
              We pay it anyway
            </label>
          )}
        </div>
        {bonus.applies && (
          <>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat label={`At ${bonus.rate}%`} value={formatCurrency(bonus.total)} />
              <Stat label={`At the ${MAX_RATE}% maximum`} value={formatCurrency(bonus.atMaximum)} />
              <Stat label="People it is owed to" value={`${bonus.eligible} of ${bonus.people}`} />
            </div>
            {canWrite && (
              <div className="mt-3 flex flex-wrap items-end gap-4">
                <Field label="Rate" hint={`${MIN_RATE}% is the minimum the Act allows.`}>
                  <Input
                    type="number" step="0.01" min={MIN_RATE} max={MAX_RATE}
                    className="field-input-compact w-28"
                    aria-label="Bonus rate"
                    value={entity?.bonus_rate ?? ''}
                    placeholder={String(MIN_RATE)}
                    onChange={(e) => setCompany({ bonus_rate: e.target.value === '' ? null : Number(e.target.value) },
                      e.target.value === '' ? 'No rate chosen' : `Bonus at ${e.target.value}%`)}
                  />
                </Field>
                {/* Per state and per scheduled employment, revised twice a year
                    in most states, construction on its own schedule — so it is
                    asked for rather than built in and wrong by June. */}
                <Field label="Minimum wage" hint="For the work, per month. Bonus is computed on this where it is above the ceiling.">
                  <Input
                    type="number" step="1" min="0"
                    className="field-input-compact w-36"
                    aria-label="Minimum wage"
                    value={entity?.minimum_wage ?? ''}
                    placeholder={String(CALCULATION_CEILING)}
                    onChange={(e) => setCompany({ minimum_wage: e.target.value === '' ? null : Number(e.target.value) },
                      e.target.value === '' ? 'No minimum wage set' : `Minimum wage ${formatCurrency(Number(e.target.value))}`)}
                  />
                </Field>
              </div>
            )}
            {!bonus.rateChosen && (
              <p className="mt-2 text-xs text-ink-4">
                <Badge color="#d97706">no rate chosen</Badge>{' '}
                Nobody has set a rate, so this is the {MIN_RATE}% the Act imposes rather than a figure the company
                decided. The Act allows anything up to {MAX_RATE}%.
              </p>
            )}
            {/* Section 16, flagged rather than applied. Telling a young company
                it owes nothing, wrongly, means finding out eight months late. */}
            {bonus.infancy && (
              <p className="mt-2 text-xs text-ink-4">
                <Badge color="#64748b">under {bonus.infancyYears} years old</Badge>{' '}
                A new establishment is outside the Act for its first {bonus.infancyYears} years, except in a year it
                makes a profit. Whether this one did is not something the payroll knows, so the figures above assume
                it owes the bonus.
              </p>
            )}
            {/* The part that gets computed wrong, said plainly. */}
            <p className="mt-2 text-xs text-ink-5">
              Two ceilings, and they are different numbers: {formatCurrency(ELIGIBILITY_CEILING)} a month decides who is
              covered, and {formatCurrency(bonus.ceiling)} decides what the bonus is worked out on
              {bonus.minimumWage > CALCULATION_CEILING ? ' — the minimum wage, here' : ''}.
            </p>
            {bonus.held > 0 && (
              <p className="mt-1 text-xs text-ink-5">
                {bonus.held} {bonus.held === 1 ? 'person is' : 'people are'} paid on {formatCurrency(bonus.ceiling)}{' '}
                rather than on their wages, because the Act caps the calculation there.
              </p>
            )}
            {bonus.overCeiling > 0 && (
              <p className="mt-1 text-xs text-ink-6">
                {bonus.overCeiling} {bonus.overCeiling === 1 ? 'person draws' : 'people draw'} more than{' '}
                {formatCurrency(ELIGIBILITY_CEILING)} a month and are outside the Act altogether.
              </p>
            )}
          </>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-3">
            Payslips
            {kept
              ? <Badge color={kept.status === RUN_STATUS.paid ? '#059669' : kept.status === RUN_STATUS.approved ? '#2563eb' : '#64748b'}>
                  {RUN_STATUS_LABEL[kept.status]}
                </Badge>
              : <Badge color="#d97706">not run</Badge>}
          </h2>
          <label className="flex items-center gap-2 text-xs text-ink-5">
            Month
            <Input type="month" className="field-input-compact w-auto" value={period} onChange={(e) => setPeriod(e.target.value)} />
          </label>
        </div>
        {/* The distinction the whole thing turns on. A month nobody has run is
            arithmetic on today's salaries wearing a date: give somebody a raise
            and last March gets more expensive. */}
        <p className="mt-2 text-xs text-ink-5">
          {kept
            ? `Recorded on ${formatDate(kept.run_at)}. These are the payslips as they were run — a raise since then does not change them.`
            : 'Not run yet, so this is worked out from today\u2019s salaries. Record it and the month stops moving.'}
        </p>
        {canWrite && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant={kept ? 'ghost' : 'primary'} onClick={keepRun} disabled={isLocked(kept)}>
              {kept ? 'Run again' : 'Record this month'}
            </Button>
            {kept && kept.status === RUN_STATUS.draft && (
              <Button variant="ghost" onClick={() => setStatus(RUN_STATUS.approved)}>Approve</Button>
            )}
            {kept && kept.status === RUN_STATUS.approved && (
              <Button variant="ghost" onClick={() => setStatus(RUN_STATUS.paid)}>Mark paid</Button>
            )}
            {isLocked(kept) && (
              <span className="self-center text-xs text-ink-6">{canRerun(kept).why}</span>
            )}
          </div>
        )}
        <p className="mt-1 text-xs text-ink-5">
          PF, ESI and professional tax are computed from the statutory rules. TDS is not — it depends on declared
          investments and projected annual income, and a wrong guess is worse than an empty field.
        </p>

        {matched.size > 0 && (
          <label className="mt-3 flex items-start gap-2.5 rounded-lg border border-line-soft bg-surface-sunk p-3 text-xs text-ink-4">
            <input
              type="checkbox"
              aria-label="Recover advances in this run"
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
                        {/* The name off the slip where the run was recorded:
                            somebody who has since left is still on last March's
                            payroll, and their row may be gone. */}
                        {s.name || emp?.name || 'Unnamed'} <span className="text-ink-6">{s.code || emp?.code}</span>
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
            {/* Professional tax follows the work, not the head office. For a
                builder with a site over a state line that is the ordinary case
                and not the exception. */}
            <Field label="Works in" hint="Only if not the company’s own state.">
              <Select value={form.workState} onChange={(e) => setForm({ ...form, workState: e.target.value })}>
                <option value="">{STATES[ptState]?.name || 'The company’s state'}</option>
                {STATES_BY_NAME.map((st) => <option key={st.code} value={st.code}>{st.name}</option>)}
              </Select>
            </Field>
            {/* Asked because Maharashtra exempts women up to ₹25,000 a month and
                an exemption nobody claims costs that person ₹2,400 a year.
                Nowhere else asks, and the field says so rather than looking
                like something the app wants for its own reasons. */}
            <Field label="Sex" hint="Only used where a state exempts women.">
              <Select value={form.female} onChange={(e) => setForm({ ...form, female: e.target.value })}>
                <option value="">Not recorded</option>
                <option value="f">Woman</option>
                <option value="m">Man</option>
              </Select>
            </Field>
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
