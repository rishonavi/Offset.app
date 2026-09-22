import { useMemo, useState } from 'react'
import { Truck, ClipboardList, Plus, AlertTriangle, Gauge } from 'lucide-react'
import * as store from '../lib/storage/corporate'
import {
  makePlant,
  makePlantLog,
  plantReport,
  hireVsOwn,
  dailyOwnershipCost,
  PLANT_KINDS,
  PLANT_KIND_IDS,
  HIRE_BASIS,
  HIRE_BASIS_IDS,
  OWNERSHIP,
  OWNERSHIP_IDS,
} from '../lib/plant'
import { formatCurrency } from '../lib/format'
import { Card, Button, Field, Input, Select, Badge, EmptyState, cx, attempt } from './ui'
import { todayISO } from '../lib/today'

// Plant and equipment.
//
// The screen is built around one figure that no hire bill contains: what an
// hour of actual work off a machine costs, once idle time, breakdowns, fuel and
// the days nobody wrote a log sheet for are in it. The nominal rate is shown
// beside it, because the gap between the two is the point.
const VIEWS = [
  { id: 'yard', label: 'The yard', icon: Truck },
  { id: 'logs', label: 'Log sheets', icon: ClipboardList },
]

const num = (v) => Number(v) || 0

export default function Plant(shared) {
  const [view, setView] = useState('yard')
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Plant">
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
      {view === 'yard' && <Yard {...shared} />}
      {view === 'logs' && <Logs {...shared} />}
    </div>
  )
}

// ── The yard ────────────────────────────────────────────────────────────────
const blankPlant = {
  name: '', kind: 'excavator', ownership: 'hired', registration: '', vendor: '',
  hireRate: '', hireBasis: 'daily', minimumHours: '', hiredFrom: '', hiredTo: '',
  fuelIncluded: false, operatorIncluded: false,
  purchaseValue: '', salvageValue: '', usefulLifeYears: '8', projectId: '',
}

function Yard({ data, eid, actor, canWrite, bump, toast }) {
  const [form, setForm] = useState(blankPlant)
  const [market, setMarket] = useState({})

  const report = useMemo(() => plantReport(data.plant, data.plantLogs, { entityId: eid }), [data, eid])

  const pickKind = (kind) =>
    setForm((f) => ({ ...f, kind, hireBasis: PLANT_KINDS[kind]?.basis || 'daily' }))

  const add = (e) => {
    e.preventDefault()
    if (!form.name.trim() && !PLANT_KINDS[form.kind]) return
    store.plant.add(makePlant({
      entityId: eid, projectId: form.projectId || null, ...form,
      hireRate: num(form.hireRate), minimumHours: num(form.minimumHours),
      fuelIncluded: form.fuelIncluded, operatorIncluded: form.operatorIncluded,
      purchaseValue: num(form.purchaseValue), salvageValue: num(form.salvageValue),
      usefulLifeYears: num(form.usefulLifeYears) || 8, createdBy: actor?.id,
    }), actor)
    setForm({ ...blankPlant, kind: form.kind, hireBasis: form.hireBasis, ownership: form.ownership })
    bump()
    toast('Machine added')
  }

  const hired = form.ownership === 'hired'

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Machines" value={String(report.count)} />
        <Stat label="Plant cost" value={formatCurrency(report.total)} />
        <Stat
          label="Utilisation"
          value={report.utilisation === null ? '—' : `${report.utilisation}%`}
          tone={report.utilisation !== null && report.utilisation < 60 ? 'warn' : undefined}
        />
        {/* The figure the screen exists for. */}
        <Stat
          label="Per working hour"
          value={report.costPerWorkingHour === null ? '—' : formatCurrency(report.costPerWorkingHour)}
        />
      </div>

      {(report.unloggedDays > 0 || report.neverLogged > 0) && (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-warn" />
            <h3 className="text-sm font-semibold text-ink-3">Billing with nothing written down</h3>
          </div>
          {/* The quietest cost there is: the machine billed and nobody recorded
              whether it turned a wheel. */}
          <p className="mt-1 text-xs text-ink-5">
            {report.unloggedDays} {report.unloggedDays === 1 ? 'day' : 'days'} on hire with no log sheet
            {report.unloggedCost > 0 && <>, worth {formatCurrency(report.unloggedCost)}</>}
            {report.neverLogged > 0 && <> · {report.neverLogged} {report.neverLogged === 1 ? 'machine has' : 'machines have'} never been logged at all</>}.
          </p>
        </Card>
      )}

      {(report.idleCost > 0 || report.breakdownCost > 0) && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-ink-3">What standing still cost</h3>
          {/* Idle means there was no work for it. Breakdown means it could not
              work. Different people are answerable, and one figure protects both. */}
          <p className="mt-1 text-xs text-ink-5">
            Idle is no work for it — late drawings, a slab not ready. Breakdown is it could not work. Different
            failures, and different people answerable for them.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Cell label="Idle hours" value={String(report.idleHours)} />
            <Cell label="Idle cost" value={formatCurrency(report.idleCost)} tone="warn" />
            <Cell label="Breakdown hours" value={String(report.breakdownHours)} />
            <Cell label="Breakdown cost" value={formatCurrency(report.breakdownCost)} tone="warn" />
          </div>
        </Card>
      )}

      {canWrite && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-ink-3">Add a machine</h3>
          <p className="mt-1 text-xs text-ink-5">
            Hired or owned. An owned machine still costs its depreciation every day it exists — charging a job
            nothing for it is how owning looks free and hiring looks expensive.
          </p>
          <form onSubmit={add} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Field label="Kind" className="sm:col-span-2">
              <Select aria-label="Plant kind" value={form.kind} onChange={(e) => pickKind(e.target.value)}>
                {PLANT_KIND_IDS.map((id) => <option key={id} value={id}>{PLANT_KINDS[id].label}</option>)}
              </Select>
            </Field>
            <Field label="Name">
              <Input aria-label="Plant name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={PLANT_KINDS[form.kind].label} />
            </Field>
            <Field label="Registration" hint="What a log sheet is headed with.">
              <Input aria-label="Registration" value={form.registration} onChange={(e) => setForm({ ...form, registration: e.target.value })} placeholder="MH-04-AB-1234" />
            </Field>
            <Field label="Hired or owned">
              <Select aria-label="Ownership" value={form.ownership} onChange={(e) => setForm({ ...form, ownership: e.target.value })}>
                {OWNERSHIP_IDS.map((id) => <option key={id} value={id}>{OWNERSHIP[id].label}</option>)}
              </Select>
            </Field>

            {hired ? (
              <>
                <Field label="Hire rate">
                  <Input aria-label="Hire rate" type="number" min="0" step="0.01" value={form.hireRate} onChange={(e) => setForm({ ...form, hireRate: e.target.value })} />
                </Field>
                <Field label="Charged">
                  <Select aria-label="Hire basis" value={form.hireBasis} onChange={(e) => setForm({ ...form, hireBasis: e.target.value })}>
                    {HIRE_BASIS_IDS.map((id) => <option key={id} value={id}>{HIRE_BASIS[id].label}</option>)}
                  </Select>
                </Field>
                {form.hireBasis === 'hourly' && (
                  <Field label="Minimum hours" hint="Per day. Most hourly contracts have one.">
                    <Input aria-label="Minimum hours" type="number" min="0" step="0.5" value={form.minimumHours} onChange={(e) => setForm({ ...form, minimumHours: e.target.value })} />
                  </Field>
                )}
                <Field label="Vendor">
                  <Input aria-label="Plant vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
                </Field>
                <Field label="On hire from">
                  <Input aria-label="Hired from" type="date" value={form.hiredFrom} onChange={(e) => setForm({ ...form, hiredFrom: e.target.value })} />
                </Field>
                <Field label="To" hint="Blank means still on hire.">
                  <Input aria-label="Hired to" type="date" value={form.hiredTo} onChange={(e) => setForm({ ...form, hiredTo: e.target.value })} />
                </Field>
                {/* What the rate covers. Most crane and mixer contracts are
                    quoted wet — diesel and a driver in the price — and a site
                    that logs the tank anyway was having the diesel charged
                    twice, once inside the rate and once again as fuel. */}
                <Field className="sm:col-span-2" label="What the rate includes">
                  <div className="flex flex-wrap gap-4 pt-1">
                    <label className="flex items-center gap-2 text-sm text-ink-3">
                      <input
                        type="checkbox"
                        aria-label="Fuel included in the hire"
                        className="accent-brand"
                        checked={form.fuelIncluded}
                        onChange={(e) => setForm({ ...form, fuelIncluded: e.target.checked })}
                      />
                      Fuel
                    </label>
                    <label className="flex items-center gap-2 text-sm text-ink-3">
                      <input
                        type="checkbox"
                        aria-label="Operator included in the hire"
                        className="accent-brand"
                        checked={form.operatorIncluded}
                        onChange={(e) => setForm({ ...form, operatorIncluded: e.target.checked })}
                      />
                      Operator
                    </label>
                  </div>
                </Field>
              </>
            ) : (
              <>
                <Field label="What it cost">
                  <Input aria-label="Purchase value" type="number" min="0" step="0.01" value={form.purchaseValue} onChange={(e) => setForm({ ...form, purchaseValue: e.target.value })} />
                </Field>
                <Field label="Scrap value">
                  <Input aria-label="Salvage value" type="number" min="0" step="0.01" value={form.salvageValue} onChange={(e) => setForm({ ...form, salvageValue: e.target.value })} />
                </Field>
                <Field label="Useful life, years">
                  <Input aria-label="Useful life" type="number" min="1" step="1" value={form.usefulLifeYears} onChange={(e) => setForm({ ...form, usefulLifeYears: e.target.value })} />
                </Field>
                <Field label="In service from">
                  <Input aria-label="Hired from" type="date" value={form.hiredFrom} onChange={(e) => setForm({ ...form, hiredFrom: e.target.value })} />
                </Field>
              </>
            )}
            <div className="sm:col-span-4"><Button type="submit"><Plus size={16} /> Add machine</Button></div>
          </form>
        </Card>
      )}

      {report.count === 0 ? (
        <Card className="p-5">
          <EmptyState icon={Truck} title="No plant yet" subtitle="Add a machine above and its log sheets go under Log sheets." />
        </Card>
      ) : (
        report.lines.map((l) => {
          const basis = HIRE_BASIS[l.plant.hire_basis]
          const verdict = hireVsOwn(l, num(market[l.plant.id]))
          return (
            <Card key={l.plant.id} className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-2">
                    {l.plant.name}
                    {l.plant.registration && <span className="text-xs font-normal text-ink-6">{l.plant.registration}</span>}
                    <Badge color={l.plant.ownership === 'owned' ? '#7c3aed' : '#2563eb'}>
                      {OWNERSHIP[l.plant.ownership].label}
                    </Badge>
                    {/* What the rate covers, so a site manager knows not to
                        book an operator on the muster for a machine that came
                        with one — and can see why the diesel below is reported
                        without being charged. */}
                    {l.plant.ownership === 'hired' && l.plant.fuel_included && <Badge color="#0f766e">fuel in the rate</Badge>}
                    {l.plant.ownership === 'hired' && l.plant.operator_included && <Badge color="#0f766e">operator in the rate</Badge>}
                    {l.logs === 0 && <Badge color="#dc2626">never logged</Badge>}
                    {l.utilisation !== null && l.utilisation < 50 && <Badge color="#d97706">under half used</Badge>}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-5">
                    {PLANT_KINDS[l.plant.kind].label}
                    {l.plant.ownership === 'hired'
                      ? <> · {formatCurrency(l.plant.hire_rate)} {basis?.label.toLowerCase()}{l.plant.vendor ? ` · ${l.plant.vendor}` : ''}</>
                      : <> · {formatCurrency(dailyOwnershipCost(l.plant))} a day in depreciation</>}
                  </p>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Cell label="Worked" value={`${l.workingHours} h`} />
                <Cell label="Idle" value={`${l.idleHours} h`} tone={l.idleHours > l.workingHours ? 'warn' : undefined} />
                <Cell label="Broken" value={`${l.breakdownHours} h`} />
                <Cell label="Utilisation" value={l.utilisation === null ? '—' : `${l.utilisation}%`} />
                <Cell label="Cost" value={formatCurrency(l.total)} />
              </div>

              {/* The nominal rate beside the real one. The gap is the point. */}
              {l.costPerWorkingHour !== null && (
                <p className="mt-3 text-sm text-ink-3">
                  An hour of work off this machine costs{' '}
                  <strong className="text-ink-1">{formatCurrency(l.costPerWorkingHour)}</strong>
                  {l.plant.ownership === 'hired' && basis && !basis.perHour && l.plant.hire_rate > 0 && (
                    <span className="text-ink-5">
                      {' '}— the rate is {formatCurrency(l.plant.hire_rate)} {basis.label.toLowerCase()}.
                    </span>
                  )}
                </p>
              )}
              {l.paidNotWorked > 0 && (
                <p className="mt-1 text-xs text-warn">
                  {l.paidNotWorked} hours paid for and not worked, on the daily minimum.
                </p>
              )}
              {l.unloggedDays > 0 && (
                <p className="mt-1 text-xs text-warn">
                  {l.unloggedDays} {l.unloggedDays === 1 ? 'day' : 'days'} on hire with no log sheet
                  {l.unloggedCost > 0 && <>, worth {formatCurrency(l.unloggedCost)}</>}.
                </p>
              )}

              {l.workingHours > 0 && (
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <Field label="Compare with a market day rate" className="max-w-[16rem]">
                    <Input
                      aria-label={`Market day rate for ${l.plant.name}`}
                      type="number" min="0" step="0.01"
                      value={market[l.plant.id] || ''}
                      onChange={(e) => setMarket({ ...market, [l.plant.id]: e.target.value })}
                    />
                  </Field>
                  {verdict.known && (
                    <p className={cx('flex items-center gap-2 pb-2 text-xs font-medium',
                      verdict.cheaperToHire ? 'text-warn' : 'text-good')}>
                      <Gauge size={13} /> {verdict.why}
                    </p>
                  )}
                </div>
              )}
            </Card>
          )
        })
      )}
    </div>
  )
}

// ── Log sheets ──────────────────────────────────────────────────────────────
function Logs({ data, eid, actor, canWrite, bump, toast }) {
  const blank = {
    plantId: '', date: todayISO(), workingHours: '', idleHours: '', breakdownHours: '',
    trips: '', fuelLitres: '', fuelCost: '', operator: '', projectId: '', note: '',
  }
  const [form, setForm] = useState(blank)
  const machine = data.plant.find((p) => p.id === form.plantId) || null
  const byTrip = machine && HIRE_BASIS[machine.hire_basis]?.id === 'trip'

  const recent = useMemo(
    () => data.plantLogs
      .filter((l) => l.entity_id === eid)
      .slice()
      .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.created_at || '').localeCompare(a.created_at || ''))
      .slice(0, 60),
    [data, eid],
  )
  const plantName = (id) => data.plant.find((p) => p.id === id)?.name || 'Unknown machine'
  const siteName = (id) => data.projects.find((p) => p.id === id)?.name || 'Not booked to a site'

  const add = (e) => {
    e.preventDefault()
    if (!form.plantId) return
    if (!attempt(() => store.plantLogs.add(makePlantLog({
      plantId: form.plantId, entityId: eid, projectId: form.projectId || null, date: form.date,
      workingHours: num(form.workingHours), idleHours: num(form.idleHours),
      breakdownHours: num(form.breakdownHours), trips: num(form.trips),
      fuelLitres: num(form.fuelLitres), fuelCost: num(form.fuelCost),
      operator: form.operator, note: form.note, createdBy: actor?.id,
    }), actor), toast)) return
    // The machine, date and site stay: a log book is filled in a run.
    setForm({ ...blank, plantId: form.plantId, date: form.date, projectId: form.projectId, operator: form.operator })
    bump()
    toast('Log sheet recorded')
  }

  if (data.plant.length === 0) {
    return (
      <Card className="p-5">
        <EmptyState icon={ClipboardList} title="No machines yet" subtitle="Add one under The yard and its log sheets go here." />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {canWrite && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-ink-3">Log sheet</h3>
          <p className="mt-1 text-xs text-ink-5">
            One machine, one day. Idle and broken are entered apart because they are different failures — no work for
            it, against it could not work.
          </p>
          <form onSubmit={add} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Field label="Machine" required className="sm:col-span-2">
              <Select aria-label="Machine" value={form.plantId} onChange={(e) => setForm({ ...form, plantId: e.target.value })}>
                <option value="">Choose…</option>
                {data.plant.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{p.registration ? ` · ${p.registration}` : ''}</option>
                ))}
              </Select>
            </Field>
            <Field label="Date" required>
              <Input aria-label="Log date" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} max={todayISO()} />
            </Field>
            {data.projects.length > 0 && (
              <Field label="Site">
                <Select aria-label="Log site" value={form.projectId} onChange={(e) => setForm({ ...form, projectId: e.target.value })}>
                  <option value="">Not booked to a site</option>
                  {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Hours worked">
              <Input aria-label="Working hours" type="number" min="0" step="0.5" value={form.workingHours} onChange={(e) => setForm({ ...form, workingHours: e.target.value })} />
            </Field>
            <Field label="Hours idle" hint="No work for it.">
              <Input aria-label="Idle hours" type="number" min="0" step="0.5" value={form.idleHours} onChange={(e) => setForm({ ...form, idleHours: e.target.value })} />
            </Field>
            <Field label="Hours broken" hint="Could not work.">
              <Input aria-label="Breakdown hours" type="number" min="0" step="0.5" value={form.breakdownHours} onChange={(e) => setForm({ ...form, breakdownHours: e.target.value })} />
            </Field>
            {byTrip && (
              <Field label="Trips">
                <Input aria-label="Trips" type="number" min="0" step="1" value={form.trips} onChange={(e) => setForm({ ...form, trips: e.target.value })} />
              </Field>
            )}
            <Field label="Diesel, litres">
              <Input aria-label="Fuel litres" type="number" min="0" step="0.01" value={form.fuelLitres} onChange={(e) => setForm({ ...form, fuelLitres: e.target.value })} />
            </Field>
            <Field label="Diesel cost">
              <Input aria-label="Fuel cost" type="number" min="0" step="0.01" value={form.fuelCost} onChange={(e) => setForm({ ...form, fuelCost: e.target.value })} />
            </Field>
            <Field label="Operator">
              <Input aria-label="Operator" value={form.operator} onChange={(e) => setForm({ ...form, operator: e.target.value })} />
            </Field>
            <div className="sm:col-span-4">
              <Button type="submit" disabled={!form.plantId}><Plus size={16} /> Record log sheet</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-ink-3">The log book</h3>
        {recent.length === 0 ? (
          <p className="mt-3 text-sm text-ink-5">Nothing logged yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-5">
                <tr>
                  <th className="py-2 text-start">Date</th>
                  <th className="text-start ps-3">Machine</th>
                  <th className="text-end">Worked</th>
                  <th className="text-end">Idle</th>
                  <th className="text-end">Broken</th>
                  <th className="text-end">Diesel</th>
                  <th className="text-start ps-3">Site</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {recent.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 text-ink-4">{l.date}</td>
                    <td className="ps-3 text-ink-2">{plantName(l.plant_id)}</td>
                    <td className="text-end tabular text-ink-3">{l.working_hours}</td>
                    <td className={cx('text-end tabular', l.idle_hours > 0 ? 'text-warn' : 'text-ink-4')}>{l.idle_hours}</td>
                    <td className={cx('text-end tabular', l.breakdown_hours > 0 ? 'text-bad' : 'text-ink-4')}>{l.breakdown_hours}</td>
                    <td className="text-end tabular text-ink-4">{l.fuel_cost ? formatCurrency(l.fuel_cost) : '—'}</td>
                    <td className={cx('ps-3', l.project_id ? 'text-ink-4' : 'text-warn')}>{siteName(l.project_id)}</td>
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

function Cell({ label, value, tone }) {
  return (
    <div>
      <p className="text-[0.68rem] font-semibold uppercase tracking-[1px] text-ink-5">{label}</p>
      <p className={cx('mt-0.5 text-sm font-semibold tabular', tone === 'warn' ? 'text-warn' : 'text-ink-2')}>{value}</p>
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <Card className="p-4">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[1.5px] text-ink-5">{label}</p>
      <p className={cx('mt-1 text-xl font-semibold tabular', tone === 'warn' ? 'text-warn' : 'text-ink-1')}>{value}</p>
    </Card>
  )
}
