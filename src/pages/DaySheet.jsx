import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Check, Minus, Plus, HardHat } from 'lucide-react'
import { useEntity } from '../context/EntityContext'
import { useToast } from '../context/ToastContext'
import * as store from '../lib/storage/corporate'
import { daySheet, planSave } from '../lib/daysheet'
import { todayISO } from '../lib/today'
import { TRADES, TRADE_IDS } from '../lib/labour'
import { isOpen } from '../lib/projects'
import { formatCurrency } from '../lib/format'
import { Button, Card, EmptyState, Field, Input, Select, Spinner, cx } from '../components/ui'
import PageHeader from '../components/PageHeader'

// Today, on one site, in one screen.
//
// This is the page a supervisor opens at a gate on a phone, and the only one
// where that is the primary case rather than a size the desktop layout also
// survives at. Every control is a thumb's width, the headcount is a pair of
// buttons rather than a number pad, and the whole day saves once.
//
// The reason it exists is in lib/daysheet.js: entering a day used to be one
// form submission per line, so five trades and three machines was eight trips
// through a form for something a gate register answers in one look.

const STEP = 'grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-line text-ink-3 ' +
  'active:scale-95 disabled:opacity-40 hover:bg-surface-hover'

function Stepper({ label, value, onChange, min = 0, step = 1 }) {
  const n = Number(value) || 0
  return (
    <div className="flex items-center gap-2">
      <button type="button" className={STEP} aria-label={`One fewer ${label}`}
        disabled={n <= min} onClick={() => onChange(Math.max(min, Math.round((n - step) * 100) / 100))}>
        <Minus size={18} />
      </button>
      <Input
        aria-label={label}
        type="number"
        inputMode="decimal"
        min={min}
        step={step}
        className="h-11 w-20 text-center text-base tabular"
        value={value === 0 ? '' : value}
        placeholder="0"
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
      />
      <button type="button" className={STEP} aria-label={`One more ${label}`}
        onClick={() => onChange(Math.round((n + step) * 100) / 100)}>
        <Plus size={18} />
      </button>
    </div>
  )
}

export default function DaySheet() {
  const ent = useEntity()
  const toast = useToast()
  const [version, setVersion] = useState(0)
  const [date, setDate] = useState(todayISO())
  const [siteId, setSiteId] = useState('')
  const [extra, setExtra] = useState([])
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)

  const eid = ent?.corporate && !ent.consolidated ? ent.activeId : ''
  const books = useMemo(() => {
    if (!eid) return { projects: [], muster: [], plant: [], plantLogs: [] }
    return {
      projects: store.projects.list(eid),
      muster: store.muster.list(eid),
      plant: store.plant.list(eid),
      plantLogs: store.plantLogs.list(eid),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eid, ent?.version, version])

  const sites = books.projects.filter((p) => isOpen(p.status))
  const site = siteId || sites[0]?.id || ''

  // Rebuilt whenever the day, the site or the books change; edits live in
  // `draft` on top of it. A sheet that reset on every keystroke would lose the
  // line you were typing.
  const base = useMemo(
    () => daySheet({
      projectId: site, date, muster: books.muster, plant: books.plant,
      plantLogs: books.plantLogs, trades: null,
    }),
    [site, date, books],
  )
  const key = `${site}|${date}|${version}`
  const sheet = draft?.key === key ? draft.sheet : base
  const shown = useMemo(() => {
    if (!extra.length) return sheet
    const have = new Set(sheet.labour.map((l) => l.trade))
    const added = extra.filter((t) => !have.has(t)).map((trade) => ({
      trade, label: TRADES[trade].label, id: null, headcount: 0, rate: 0,
      overtimeHours: 0, overtimeRate: 0, contractor: '', recorded: false,
    }))
    return { ...sheet, labour: [...sheet.labour, ...added] }
  }, [sheet, extra])

  const edit = (next) => setDraft({ key, sheet: next })
  const setLine = (trade, patch) => edit({
    ...shown,
    labour: shown.labour.map((l) => (l.trade === trade ? { ...l, ...patch } : l)),
  })
  const setMachine = (plantId, patch) => edit({
    ...shown,
    machines: shown.machines.map((m) => (m.plantId === plantId ? { ...m, ...patch } : m)),
  })

  const heads = shown.labour.reduce((t, l) => t + (Number(l.headcount) || 0), 0)
  const wages = shown.labour.reduce(
    (t, l) => t + (Number(l.headcount) || 0) * (Number(l.rate) || 0)
      + (Number(l.overtimeHours) || 0) * (Number(l.overtimeRate) || 0), 0)

  if (!ent) return <Spinner />
  if (!eid) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Day sheet" subtitle="Today’s muster and log sheets, on one screen." />
        <EmptyState
          icon={HardHat}
          title="Open a company’s books first"
          subtitle="A day sheet belongs to one site in one company. The consolidated view spans companies whose sites are not interchangeable."
          action={<Link to="/companies" className="btn-primary">Companies</Link>}
        />
      </div>
    )
  }
  if (sites.length === 0) {
    return (
      <div className="animate-fade-in">
        <PageHeader title="Day sheet" subtitle="Today’s muster and log sheets, on one screen." />
        <EmptyState
          icon={HardHat}
          title="No sites on the go"
          subtitle="A day sheet is a day on a site. Add one and it will show up here."
          action={<Link to="/operations" className="btn-primary"><Plus size={16} /> Add a site</Link>}
        />
      </div>
    )
  }

  const save = () => {
    setSaving(true)
    try {
      const plan = planSave(shown, { entityId: eid, actor: ent.actor })
      if (!plan.touched) {
        toast('Nothing to record yet.')
        return
      }
      for (const { kind, row } of plan.add) store[kind].add(row, ent.actor, eid)
      for (const { kind, id, patch } of plan.update) store[kind].update(id, patch, ent.actor)
      for (const { kind, id } of plan.remove) store[kind].remove(id, ent.actor)
      setDraft(null)
      setExtra([])
      setVersion((v) => v + 1)
      ent.reload?.()
      // Said as what it did, not as "Saved": a supervisor who taps twice wants
      // to know the second tap changed nothing rather than doubled the day.
      const parts = [
        plan.add.length && `${plan.add.length} recorded`,
        plan.update.length && `${plan.update.length} updated`,
        plan.remove.length && `${plan.remove.length} removed`,
      ].filter(Boolean)
      toast(parts.join(' · '))
    } catch (e) {
      toast(e?.message || 'Could not save the sheet.')
    } finally {
      setSaving(false)
    }
  }

  const unused = TRADE_IDS.filter((t) => !shown.labour.some((l) => l.trade === t))

  return (
    // The save bar is a sibling of the animated wrapper, not a child of it.
    // `animate-fade-in` ends on a transform, and an element with a transform is
    // the containing block for anything `fixed` inside it — so the bar pinned
    // itself to the bottom of the page instead of the bottom of the screen,
    // which on this page means below three cards of scrolling. Measured, not
    // assumed: the test reads where the button actually is.
    <>
    <div className="animate-fade-in space-y-4 pb-28">
      <PageHeader
        title="Day sheet"
        subtitle={shown.started ? 'Already started — this edits today rather than adding to it.' : 'Today’s muster and log sheets, on one screen.'}
      />

      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Site">
            <Select aria-label="Site" className="h-11 text-base" value={site}
              onChange={(e) => { setSiteId(e.target.value); setDraft(null); setExtra([]) }}>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Date">
            <Input aria-label="Sheet date" type="date" className="h-11 text-base" value={date} max={todayISO()}
              onChange={(e) => { setDate(e.target.value); setDraft(null); setExtra([]) }} />
          </Field>
        </div>
      </Card>

      <Card className="p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-3">
          <CalendarDays size={16} className="text-ink-5" /> Muster
        </h2>
        <p className="mt-1 text-xs text-ink-5">
          Heads on site today, by trade. The rate is what this trade was last paid here.
        </p>
        <div className="mt-3 space-y-3">
          {shown.labour.map((l) => (
            <div key={l.trade} className={cx('rounded-xl border p-3', l.headcount > 0 ? 'border-gold/50 bg-brand-light/20' : 'border-line')}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink-2">{l.label}</p>
                  {l.recorded && <p className="text-[0.6875rem] text-ink-6">Already on the sheet</p>}
                </div>
                <Stepper label={`${l.label} headcount`} value={l.headcount}
                  onChange={(v) => setLine(l.trade, { headcount: v })} />
              </div>
              {l.headcount > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <Field label="Day rate">
                    <Input aria-label={`${l.label} rate`} type="number" inputMode="decimal" min="0"
                      className="h-11 text-base tabular" value={l.rate === 0 ? '' : l.rate} placeholder="0"
                      onChange={(e) => setLine(l.trade, { rate: e.target.value === '' ? 0 : Number(e.target.value) })} />
                  </Field>
                  <Field label="Overtime hours" hint="Paid separately, because eight hours plus four over is not twelve at the day rate.">
                    <Input aria-label={`${l.label} overtime hours`} type="number" inputMode="decimal" min="0"
                      className="h-11 text-base tabular" value={l.overtimeHours === 0 ? '' : l.overtimeHours} placeholder="0"
                      onChange={(e) => setLine(l.trade, { overtimeHours: e.target.value === '' ? 0 : Number(e.target.value) })} />
                  </Field>
                  {l.overtimeHours > 0 && (
                    <Field label="Overtime rate per hour" className="col-span-2">
                      <Input aria-label={`${l.label} overtime rate`} type="number" inputMode="decimal" min="0"
                        className="h-11 text-base tabular" value={l.overtimeRate === 0 ? '' : l.overtimeRate} placeholder="0"
                        onChange={(e) => setLine(l.trade, { overtimeRate: e.target.value === '' ? 0 : Number(e.target.value) })} />
                    </Field>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {unused.length > 0 && (
          <div className="mt-3">
            <Select aria-label="Add a trade" className="h-11 text-base" value=""
              onChange={(e) => { if (e.target.value) setExtra((x) => [...x, e.target.value]) }}>
              <option value="">Add a trade…</option>
              {unused.map((t) => <option key={t} value={t}>{TRADES[t].label}</option>)}
            </Select>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink-3">Plant</h2>
        {shown.machines.length === 0 ? (
          <p className="mt-1 text-xs text-ink-5">No machines on this site. Assign one on the Plant tab and it will appear here.</p>
        ) : (
          <>
            <p className="mt-1 text-xs text-ink-5">
              Worked, idle and broken are three different answers, and only one of them is the machine’s fault.
              A machine left blank is a day with no sheet, which is reported as exactly that.
            </p>
            <div className="mt-3 space-y-3">
              {shown.machines.map((m) => (
                <div key={m.plantId} className={cx('rounded-xl border p-3',
                  (m.workingHours || m.idleHours || m.breakdownHours) ? 'border-gold/50 bg-brand-light/20' : 'border-line')}>
                  <p className="truncate text-sm font-medium text-ink-2">
                    {m.label}{m.registration ? ` · ${m.registration}` : ''}
                  </p>
                  {m.recorded && <p className="text-[0.6875rem] text-ink-6">Already on the sheet</p>}
                  <div className="mt-3 space-y-3">
                    {[['workingHours', 'Worked'], ['idleHours', 'Idle'], ['breakdownHours', 'Broken down']].map(([field, label]) => (
                      <div key={field} className="flex items-center justify-between gap-3">
                        <span className="text-xs text-ink-5">{label}</span>
                        <Stepper label={`${m.label} ${label.toLowerCase()} hours`} value={m[field]} step={0.5}
                          onChange={(v) => setMachine(m.plantId, { [field]: v })} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

    </div>

      {/* Pinned, because the thing you came to do should not be below three
          cards of scrolling on the screen this page is for. */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface-raised/95 p-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-1">
          <div className="min-w-0 text-xs text-ink-5">
            <span className="font-semibold text-ink-2">{heads}</span> on site
            {wages > 0 && <> · <span className="tabular">{formatCurrency(wages)}</span></>}
            {shown.hours > 0 && <> · {shown.hours}h worked</>}
          </div>
          <Button className="h-11 px-5" onClick={save} loading={saving} disabled={!ent.canWrite}>
            {!saving && <Check size={16} />} Save the day
          </Button>
        </div>
      </div>
    </>
  )
}
