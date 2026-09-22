// Payslips, and the four statutory liabilities around them.
//
// Lifted out of `Operations.jsx` with nothing changed in the move. It was eight
// hundred and ninety lines inside a fifteen-hundred-line file that also held
// the advances screen and the page shell.
import { useMemo, useState } from 'react'
import { Plus, Check } from 'lucide-react'
import * as store from '../../lib/storage/corporate'
import {
  makeEmployee,
  grossOf,
  runPayroll,
  makePayrollRun,
  recordedRun,
  canRerun,
  canSetStatus,
  configForEntity,
  statutoryStatus,
  SCHEMES,
  SCHEME_IDS,
  isLocked,
  RUN_STATUS,
  RUN_STATUS_LABEL,
} from '../../lib/payroll'
import { makeAdjustment, outstandingAdvances, balanceOf, canAdjust } from '../../lib/advances'
import { STATES, STATES_BY_NAME, stateFromGstin, describeState, AS_OF } from '../../lib/ptax'
import { gratuityLiability, VESTING_YEARS } from '../../lib/gratuity'
import { bonusRegister, MIN_RATE, MAX_RATE, ELIGIBILITY_CEILING, CALCULATION_CEILING } from '../../lib/bonus'
import { leaveLiability, POLICIES, POLICY_IDS } from '../../lib/leave'
import { maternityExposure, QUALIFYING_DAYS, MEDICAL_BONUS, NURSING_MONTHS } from '../../lib/maternity'
import { formatCurrency, formatDate } from '../../lib/format'
import { Card, Button, Field, Input, Select, Badge, cx } from '../ui'
import Stat from './Stat'
import { thisMonth, todayISO } from '../../lib/today'

function EmployeeFields({ form, setForm, ptState }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })
  const money = (k, label, hint) => (
    <Field label={label} hint={hint}>
      <Input type="number" step="0.01" min="0" value={form[k]} onChange={set(k)} />
    </Field>
  )
  return (
    <>
      <Field label="Name" required><Input value={form.name} onChange={set('name')} /></Field>
      <Field label="Code"><Input value={form.code} onChange={set('code')} placeholder="EMP01" /></Field>
      {/* Gratuity is fifteen days' wages for every year since this date. Without
          it the liability is nil for that person and nothing says why. */}
      <Field label="Joined on" hint="Gratuity and bonus are both counted from here.">
        <Input type="date" value={form.joinedOn} onChange={set('joinedOn')} />
      </Field>
      {money('basic', 'Basic', 'PF is a share of this.')}
      {/* Both the Gratuity and Bonus Acts mean basic *plus this* by wages, so
          folding it into an allowance understates both. */}
      {money('da', 'Dearness allowance', 'Counted with basic for gratuity and bonus.')}
      {money('hra', 'HRA')}
      {money('conveyance', 'Conveyance')}
      {money('medical', 'Medical')}
      {money('special', 'Special allowance')}
      {money('other', 'Other')}
      {/* Professional tax follows the work, not the head office. For a builder
          with a site over a state line that is the ordinary case. */}
      <Field label="Works in" hint="Only if not the company’s own state.">
        <Select value={form.workState} onChange={set('workState')}>
          <option value="">{STATES[ptState]?.name || 'The company’s state'}</option>
          {STATES_BY_NAME.map((st) => <option key={st.code} value={st.code}>{st.name}</option>)}
        </Select>
      </Field>
      <Field label="Leave standing" hint="Days of earned leave carried in.">
        <Input type="number" step="0.5" min="0" value={form.leaveBalance} onChange={set('leaveBalance')} />
      </Field>
      {/* Asked because Maharashtra exempts women up to ₹25,000 a month and an
          exemption nobody claims costs that person ₹2,400 a year. */}
      <Field label="Sex" hint="Only used where a state exempts women.">
        <Select value={form.female} onChange={set('female')}>
          <option value="">Not recorded</option>
          <option value="f">Woman</option>
          <option value="m">Man</option>
        </Select>
      </Field>
      <Field label="PAN"><Input value={form.pan} onChange={set('pan')} placeholder="ABCDE1234F" /></Field>
      <Field label="UAN" hint="Provident fund account."><Input value={form.uan} onChange={set('uan')} /></Field>
    </>
  )
}

export default function Payroll({ data, eid, actor, canWrite, bump, toast, entity, reloadEntity }) {
  const [form, setForm] = useState(EMPTY_EMPLOYEE)
  // Which person is open for correction, and what is being typed into them.
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState(EMPTY_EMPLOYEE)
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

  const leave = useMemo(() => leaveLiability(data.employees, { policy: config.leave }),
    [data.employees, config.leave])
  // Who this company would pay for itself, which turns on state insurance:
  // where ESI reaches a woman, ESIC pays her maternity benefit and the employer
  // pays nothing.
  const mothers = useMemo(() => maternityExposure(data.employees, { esi: config.esi }),
    [data.employees, config.esi])

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
    store.employees.add(makeEmployee({ entityId: eid, ...employeeFields(form) }), actor)
    setForm(EMPTY_EMPLOYEE)
    bump()
    toast('Employee added')
  }

  const startEdit = (e) => { setEditing(e.id); setDraft(employeeToForm(e)) }
  const saveEdit = (e) => {
    if (!draft.name.trim()) return toast('Give them a name.', { type: 'error' })
    // Through the maker and back, so a correction is validated exactly as a new
    // row is. Its id, company and creation date are not the edit's to change.
    const { id: _id, entity_id: _eid, created_at: _at, ...patch } =
      makeEmployee({ entityId: eid, ...employeeFields(draft) })
    store.employees.update(e.id, patch, actor)
    setEditing(null)
    bump()
    toast(`${draft.name.trim()} updated`)
  }
  // Not deleted. A payroll run already carries their name and their slip, and a
  // row that vanishes leaves last March's payroll referring to nobody — which
  // is the whole reason a run freezes the name. Leaving is a state, not an
  // erasure, and it can be undone.
  const setActive = (e, active) => {
    store.employees.update(e.id, { active }, actor)
    bump()
    toast(active ? `${e.name} is back on the payroll` : `${e.name} is off the payroll`)
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
          date: todayISO(),
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
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
                  <span className="mt-0.5 block text-[0.6875rem] text-ink-6">{st.note}</span>
                </span>
                <span className="flex shrink-0 gap-1" role="group" aria-label={`${st.short} registration`}>
                  {[['Yes', true], ['No', false], ['Not sure', null]].map(([label, value]) => (
                    <button
                      key={label}
                      type="button"
                      disabled={!canWrite}
                      aria-label={`${st.short} registered: ${label}`}
                      onClick={() => answer(id, value)}
                      className={cx('inline-flex min-h-11 items-center rounded-lg border px-3.5 text-xs font-semibold transition',
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
          <p className="mt-2 text-[0.6875rem] text-ink-6">
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
        <p className="mt-1 text-[0.6875rem] text-ink-6">
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
                className="accent-brand"
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
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
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

      {/* Earned leave: a liability on the way out, and a cap that quietly takes
          days off people at the year end. */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink-3">Earned leave</h2>
            <p className="mt-1 text-xs text-ink-5">
              Days standing are payable in cash when somebody leaves. Days over the carry-forward cap lapse at the
              year end — the first is the company&rsquo;s money, the second is theirs.
            </p>
          </div>
          {canWrite && (
            <label className="flex shrink-0 items-center gap-2 text-xs text-ink-5">
              Policy
              <Select
                className="field-input-compact w-auto"
                aria-label="Leave policy"
                value={entity?.leave_policy || 'factories'}
                onChange={(e) => setCompany({ leave_policy: e.target.value }, POLICIES[e.target.value].label)}
              >
                {POLICY_IDS.map((id) => <option key={id} value={id}>{POLICIES[id].label}</option>)}
              </Select>
            </label>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Standing, in cash" value={formatCurrency(leave.value)} />
          <Stat label="Days standing" value={String(leave.days)} />
          <Stat
            label="About to lapse"
            value={formatCurrency(leave.lapsingValue)}
            tone={leave.lapsingValue > 0 ? 'warn' : undefined}
          />
        </div>
        {/* The number nobody is ever shown, and it is always somebody's pay. */}
        {leave.lapsingPeople > 0 && (
          <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-3">
            <p className="text-xs text-ink-4">
              {leave.lapsingPeople} {leave.lapsingPeople === 1 ? 'person is' : 'people are'} over the{' '}
              {leave.policy.carryCap}-day cap and will lose {leave.lapsingDays}{' '}
              {leave.lapsingDays === 1 ? 'day' : 'days'} between them at the year end. Encashing the excess before
              then costs the same and keeps it theirs.
            </p>
            <ul className="mt-2 space-y-1 text-xs text-ink-5">
              {leave.over.slice(0, 6).map((l) => (
                <li key={l.employee_id} className="flex items-center justify-between gap-3">
                  <span>{l.name} — {l.balance} days, {l.lapsing} over the cap</span>
                  <span className="tabular text-ink-3">{formatCurrency(l.lapsingValue)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {leave.unrecorded > 0 && (
          <p className="mt-2 text-xs text-ink-6">
            {leave.unrecorded} of {leave.people} have no balance recorded, so they count as nil here — which is not
            the same as having taken all their leave.
          </p>
        )}
        <p className="mt-2 text-[0.6875rem] text-ink-6">
          {leave.policy.act}. A day is worth basic and dearness allowance divided by {leave.policy.divisor}.
        </p>
      </Card>

      {/* Maternity, and the question that decides who writes the cheque. */}
      {mothers.applies && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink-3">Maternity benefit</h2>
          <p className="mt-1 text-xs text-ink-5">
            Twenty-six weeks for a first or second child, twelve for a third. {mothers.why}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Women on the payroll" value={String(mothers.women)} />
            {/* The distinction the card exists for. */}
            <Stat label="ESIC would pay for" value={String(mothers.esicPays)} />
            <Stat label="This company would pay for" value={String(mothers.employerPays)} />
          </div>
          <p className="mt-2 text-xs text-ink-5">
            Where state insurance reaches a woman — the company registered, and her gross inside the ceiling — ESIC
            pays her benefit and the employer pays nothing. The liability is for the women it does not reach.
          </p>
          {mothers.employerPays > 0 && (
            <p className="mt-1 text-xs text-ink-4">
              Twenty-six weeks for {mothers.employerPays === 1 ? 'her' : 'them'} would cost about{' '}
              {formatCurrency(mothers.exposure)}, including the {formatCurrency(MEDICAL_BONUS)} medical bonus where no
              free pre-natal and post-natal care is given.
            </p>
          )}
          {mothers.unrecorded > 0 && (
            <p className="mt-2 text-xs text-ink-4">
              <Badge color="#d97706">sex not recorded</Badge>{' '}
              {mothers.unrecorded} {mothers.unrecorded === 1 ? 'person has' : 'people have'} no sex recorded, so
              nobody knows whether they belong in the figures above.
            </p>
          )}
          {mothers.crecheRequired && (
            <p className="mt-2 text-xs text-ink-4">
              <Badge color="#2563eb">creche required</Badge>{' '}
              At {mothers.crecheThreshold} employees a creche is compulsory, with {mothers.crecheVisits} visits a day
              allowed. It is a separate duty with a separate threshold.
            </p>
          )}
          <p className="mt-2 text-[0.6875rem] text-ink-6">
            She must have worked {QUALIFYING_DAYS} days in the twelve months before her expected date to qualify at
            all. Nursing breaks run until the child is {NURSING_MONTHS} months old, and every woman must be told of
            these benefits in writing when she is taken on.
          </p>
        </Card>
      )}

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
                className="accent-brand"
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
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
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

      {/* Everybody on the books, and the only place any of them can be
          corrected. Inactive people are here too: they were invisible before,
          so somebody taken off the payroll by mistake could never be put back. */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink-3">People</h2>
        <p className="mt-1 text-xs text-ink-5">
          Pay, joining dates and the rest can be changed here. Payroll months already recorded do not move — they
          carry the payslips as they were run.
        </p>
        {data.employees.length === 0 ? (
          <p className="mt-3 text-sm text-ink-5">Nobody on the payroll yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line-soft">
            {data.employees.map((e) => (
              <li key={e.id} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                      {e.name}
                      {e.code && <span className="text-xs text-ink-6">{e.code}</span>}
                      {e.active === false && <Badge color="#64748b">off the payroll</Badge>}
                      {/* The two fields the new liabilities need and the two
                          nobody could fill in until now. */}
                      {!e.joined_on && <Badge color="#d97706">no joining date</Badge>}
                      {grossOf(e) <= 0 && <Badge color="#dc2626">no pay set</Badge>}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-5">
                      {formatCurrency(grossOf(e))} a month
                      {e.joined_on ? ` · joined ${formatDate(e.joined_on)}` : ''}
                      {e.work_state ? ` · works in ${STATES[e.work_state]?.name}` : ''}
                      {Number(e.leave_balance) > 0 ? ` · ${e.leave_balance} days' leave` : ''}
                    </span>
                  </span>
                  {canWrite && (
                    <span className="flex shrink-0 gap-2">
                      <Button variant="ghost" onClick={() => (editing === e.id ? setEditing(null) : startEdit(e))}
                        aria-label={`Edit ${e.name}`}>
                        {editing === e.id ? 'Close' : 'Edit'}
                      </Button>
                      <Button variant="ghost" onClick={() => setActive(e, e.active === false)}
                        aria-label={`${e.active === false ? 'Restore' : 'Remove'} ${e.name}`}>
                        {e.active === false ? 'Put back' : 'Take off'}
                      </Button>
                    </span>
                  )}
                </div>
                {canWrite && editing === e.id && (
                  <div className="mt-3 rounded-xl border border-line-soft p-3" role="group"
                    aria-label={`Editing ${e.name}`}>
                    <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
                      <EmployeeFields form={draft} setForm={setDraft} ptState={ptState} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button onClick={() => saveEdit(e)}><Check size={16} /> Save</Button>
                      <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canWrite && (
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink-3">Add an employee</h2>
          <form onSubmit={add} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
            <EmployeeFields form={form} setForm={setForm} ptState={ptState} />
            <div className="sm:col-span-3"><Button type="submit"><Plus size={16} /> Add employee</Button></div>
          </form>
        </Card>
      )}
    </div>
  )
}

// One field set, used to add somebody and to correct them afterwards.
//
// There was no way to change anything once it was entered: a name typed wrong
// stayed wrong, and somebody added with no pay sat at zero on every payslip for
// good. Worse, every field added since — dearness allowance, the joining date,
// the work state, leave standing — could only ever be set at the moment of
// creation, so a company that had already entered its people could never fill
// them in. Gratuity is fifteen days' wages for each year *since the joining
// date*, and the joining date was not on the form at all, which made the whole
// liability nil for everybody.
//
// So the two forms are one component. Two copies of this would be the edit form
// quietly falling behind the add form all over again.
const EMPTY_EMPLOYEE = {
  name: '', code: '', basic: '', da: '', hra: '', conveyance: '', medical: '', special: '', other: '',
  joinedOn: '', pan: '', uan: '', workState: '', female: '', leaveBalance: '',
}

const employeeToForm = (e) => ({
  name: e.name || '', code: e.code || '',
  basic: e.pay?.basic ?? '', da: e.pay?.da ?? '', hra: e.pay?.hra ?? '',
  conveyance: e.pay?.conveyance ?? '', medical: e.pay?.medical ?? '',
  special: e.pay?.special ?? '', other: e.pay?.other ?? '',
  joinedOn: e.joined_on || '', pan: e.pan || '', uan: e.uan || '',
  workState: e.work_state || '',
  female: e.female === true ? 'f' : e.female === false ? 'm' : '',
  leaveBalance: e.leave_balance ?? '',
})

// Both paths go through `makeEmployee`, so a correction is validated and
// normalised exactly as a new row is — a patch that skipped it would let an
// edit write things the maker would have refused.
const employeeFields = (form) => ({
  name: form.name, code: form.code,
  basic: Number(form.basic) || 0, da: Number(form.da) || 0, hra: Number(form.hra) || 0,
  conveyance: Number(form.conveyance) || 0, medical: Number(form.medical) || 0,
  special: Number(form.special) || 0, other: Number(form.other) || 0,
  joinedOn: form.joinedOn, pan: form.pan, uan: form.uan,
  workState: form.workState,
  female: form.female === 'f' ? true : form.female === 'm' ? false : null,
  leaveBalance: Number(form.leaveBalance) || 0,
})
