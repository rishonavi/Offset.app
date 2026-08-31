import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { budgetStatus, BUDGET_COLORS } from '../lib/budget'
import { formatCurrency } from '../lib/format'

export default function BudgetBar({ spent, budget, showLabel = true, showStatus = true }) {
  const status = budgetStatus(spent, budget)
  if (!status) return null

  const color = BUDGET_COLORS[status.level]
  const width = Math.min(100, status.pct)

  return (
    <div>
      {showLabel && (
        <div className="mb-1 flex items-center justify-between text-xs">
          <span className="text-ink-5">Budget this month</span>
          <span className="font-semibold" style={{ color }}>
            {formatCurrency(spent)} / {formatCurrency(status.budget)}
          </span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-chip">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${width}%`, background: color }} />
      </div>
      {showStatus && (
        <div className="mt-1.5 flex items-center gap-1 text-xs font-medium" style={{ color }}>
          {status.level === 'over' ? (
            <>
              <AlertTriangle size={12} /> Over budget by {formatCurrency(status.spent - status.budget)}
            </>
          ) : status.level === 'warn' ? (
            <>
              <AlertTriangle size={12} /> {Math.round(status.pct)}% used · {formatCurrency(status.remaining)} left
            </>
          ) : (
            <>
              <CheckCircle2 size={12} /> {formatCurrency(status.remaining)} left
            </>
          )}
        </div>
      )}
    </div>
  )
}
