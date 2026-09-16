import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, IndianRupee, Eye, Sparkles, Check, ArrowRight } from 'lucide-react'
import { useEntity } from '../context/EntityContext'
import { useData } from '../context/DataContext'
import * as store from '../lib/storage/corporate'
import { attention, LEVELS } from '../lib/attention'
import { formatCurrency } from '../lib/format'
import { Card, Badge, cx } from './ui'

// What is going wrong, on the page people actually open.
//
// Every module in this app works out something nobody will go looking for, and
// all of it sits three clicks deep in a sub-tab. This is the whole point of
// having written them: a company that opens the app is told what is wrong
// before it is told anything else.
const ICONS = { error: AlertTriangle, money: IndianRupee, risk: Eye, chance: Sparkles }
const TONE = {
  error: 'border-red-500/30 bg-red-500/[0.04]',
  money: 'border-amber-500/30 bg-amber-500/[0.04]',
  risk: 'border-line',
  chance: 'border-emerald-500/25 bg-emerald-500/[0.03]',
}
const DOT = { error: '#dc2626', money: '#d97706', risk: '#64748b', chance: '#059669' }

export default function Attention({ limit = 6 }) {
  const ent = useEntity()
  const { expenses, income } = useData()
  const scoped = Boolean(ent?.corporate && ent.activeId && !ent.consolidated)
  const eid = ent?.activeId

  const report = useMemo(() => {
    if (!scoped) return null
    const at = (name) => store.collections[name]?.list(eid) || []
    return attention({
      entityId: eid,
      items: at('items'), movements: at('movements'), quotes: at('quotes'),
      stockCounts: at('stockCounts'),
      projects: at('projects'), muster: at('muster'),
      workOrders: at('workOrders'), raBills: at('raBills'),
      workItems: at('workItems'), measurements: at('measurements'),
      plant: at('plant'), plantLogs: at('plantLogs'),
      units: at('units'), planStages: store.planStages.list(), receipts: at('receipts'),
      advances: at('advances'), adjustments: store.adjustments.list(),
      // A budget that nothing checks, and a month nobody ran, are both things
      // this surface exists to say out loud.
      departments: ent.departments || [], employees: at('employees'), payrollRuns: at('payrollRuns'),
      expenses: expenses.filter((e) => e.entity_id === eid),
      income: income.filter((e) => e.entity_id === eid),
      policy: ent.policy, role: ent.role, userId: ent.actor?.id,
      fyStartMonth: ent.entity?.fy_start_month || 4,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, eid, ent?.version, ent?.departments, expenses, income, ent?.policy?.enabled])

  if (!report) return null

  // An empty list reads like something failed to load, so nothing wrong is
  // said rather than shown.
  if (report.clear) {
    return (
      <Card className="flex items-center gap-3 p-5">
        <Check size={18} className="text-emerald-600" />
        <p className="text-sm text-ink-3">
          Nothing needs attention. No short stores, no unclaimed rejections, no job past its costing.
        </p>
      </Card>
    )
  }

  const shown = report.findings.slice(0, limit)
  const rest = report.count - shown.length

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-3">Needs attention</h2>
        {report.atStake > 0 && (
          <p className="text-xs text-ink-5">
            {formatCurrency(report.atStake)} wrong, owed or at risk
          </p>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {shown.map((f) => {
          const Icon = ICONS[f.level] || Eye
          return (
            <li key={f.id} className={cx('rounded-xl border p-3', TONE[f.level])}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 gap-2.5">
                  <Icon size={15} className="mt-0.5 shrink-0" style={{ color: DOT[f.level] }} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink-2">{f.title}</p>
                    <p className="mt-0.5 text-xs text-ink-5">{f.detail}</p>
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-2">
                  {f.amount > 0 && (
                    <span className="tabular text-sm font-semibold text-ink-2">{formatCurrency(f.amount)}</span>
                  )}
                  {f.where?.to && (
                    <Link
                      to={f.where.to}
                      aria-label={`${f.where.label || 'Open'}: ${f.title}`}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-brand underline-offset-4 hover:underline"
                    >
                      {f.where.label || 'Open'} <ArrowRight size={12} />
                    </Link>
                  )}
                </span>
              </div>
            </li>
          )
        })}
      </ul>

      {rest > 0 && (
        <p className="mt-3 text-xs text-ink-5">
          {rest} more —{' '}
          {Object.entries(report.byLevel)
            .filter(([, n]) => n > 0)
            .map(([level, n]) => `${n} ${LEVELS[level].label.toLowerCase()}`)
            .join(', ')}
          .
        </p>
      )}
      {shown.some((f) => f.level === 'error') && (
        <p className="mt-2 flex items-center gap-1.5 text-[0.7rem] text-ink-6">
          <Badge color={DOT.error}>wrong</Badge>
          comes first whatever it is worth, because every total downstream of a wrong number is also suspect.
        </p>
      )}
    </Card>
  )
}
