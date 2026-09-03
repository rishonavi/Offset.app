import { useMemo } from 'react'
import { Boxes, Users, HandCoins } from 'lucide-react'
import { useEntity } from '../context/EntityContext'
import * as store from '../lib/storage/corporate'
import { stockOverPeriod } from '../lib/inventory'
import { periodsBetween, payrollOverPeriods } from '../lib/payroll'
import { advancesOverPeriod } from '../lib/advances'
import { formatCurrency } from '../lib/format'
import { Card } from './ui'

// What the company cost, next to what the property earned.
//
// Stock and payroll were their own page and nothing else knew about them, so a
// company's books were two sets of numbers that never met. Both belong in a
// report for the same reason rent does: they are money that moved.
//
// The three answer the period differently, and the difference is worth keeping.
// Stock and advances are dated — every movement, every advance and every
// adjustment carries a date, so opening and closing figures over a range are
// real. Payroll is not: Offset holds today's employees and today's salaries and
// no history of past runs, so a past month is computed from the payroll as it
// stands now. The card says so rather than letting a projection pass for a
// record.
//
// An advance is the odd one of the three: it is not a cost at all. It is money
// the company is still owed, and booking it as spending is the single most
// common way small books go wrong — so it is shown as a balance, under its own
// heading, and never added into a total with the others.

const thisMonth = () => new Date().toISOString().slice(0, 7)

export function useOperationsSummary(filters) {
  const ent = useEntity()
  const eid = ent?.activeId
  const scoped = Boolean(ent?.enabled && eid && !ent.consolidated)
  const { from, to } = filters

  return useMemo(() => {
    if (!scoped) return null
    const items = store.items.list(eid)
    const movements = store.movements.list(eid)
    const employees = store.employees.list(eid)
    const advances = store.advances.list(eid)
    if (items.length === 0 && employees.length === 0 && advances.length === 0) return null

    // With no range set, the honest answer is "as it stands": stock up to
    // today, payroll for the month we are in. A blank filter meaning "no
    // months at all" would have shown a company with staff a payroll of zero.
    const asked = periodsBetween(from, to)
    const wanted = asked.length ? asked : [thisMonth()]

    // Clamped to the months the company actually existed for. An employee with
    // no joining date would otherwise be costed back to whatever year the
    // filter reaches, and a table of wages for a company that did not exist yet
    // is worse than no table: it looks like a record.
    const born = String(ent.entity?.created_at || '').slice(0, 7)
    const now = thisMonth()
    const periods = wanted.filter((m) => (!born || m >= born) && m <= now)

    return {
      entity: ent.entity,
      ranged: asked.length > 0,
      // Said out loud when the answer covers less than what was asked for.
      clamped: periods.length < wanted.length,
      periods,
      stock: stockOverPeriod(items, movements, { from: from || null, to: to || null }),
      itemCount: items.length,
      payroll: payrollOverPeriods(employees, periods),
      advanceCount: advances.length,
      advances: advancesOverPeriod(advances, store.adjustments.list(), {
        entityId: eid,
        from: from || null,
        to: to || null,
      }),
    }
  }, [scoped, eid, ent?.entity, ent?.version, from, to])
}

export default function OperationsSummary({ summary }) {
  if (!summary) return null
  const { stock, payroll, advances, periods, ranged, clamped, itemCount, advanceCount, entity } = summary
  const hasStock = itemCount > 0
  const hasPayroll = payroll.months.some((m) => m.headcount > 0)
  const hasAdvances = advanceCount > 0
  if (!hasStock && !hasPayroll && !hasAdvances) return null

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Boxes size={16} className="text-ink-5" />
          <h2 className="text-sm font-semibold text-ink-3">What the company cost, and what it is owed</h2>
        </div>
        <span className="text-xs text-ink-6">{entity?.name}</span>
      </div>
      <p className="mt-1 text-xs text-ink-5">
        Stock, payroll and advances for {ranged ? 'the period above' : 'this month'}, alongside the rents and bills.
      </p>

      {hasStock && (
        <div className="mt-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-[1px] text-ink-5">Stock</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Opening" value={stock.openingValue} muted />
            <Figure label="Received" value={stock.receivedValue} muted />
            <Figure label="Used up" value={stock.consumedValue} />
            <Figure label="On hand" value={stock.closingValue} strong />
          </div>
          <p className="mt-2 text-xs text-ink-6">
            {itemCount === 1 ? '1 item' : `${itemCount} items`}, valued at average cost. Used up is what left the
            shelf — issues, wastage and anything a stock-take could not account for.
          </p>
        </div>
      )}

      {hasPayroll && (
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[1px] text-ink-5">
            <Users size={13} /> Payroll
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="On payroll" value={payroll.headcount} count />
            <Figure label="Gross" value={payroll.gross} muted />
            <Figure label="Statutory" value={payroll.statutory.pf + payroll.statutory.esi + payroll.statutory.professionalTax} muted />
            <Figure label="Cost to company" value={payroll.employerCost} strong />
          </div>

          {periods.length > 1 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-start text-xs uppercase tracking-wide text-ink-5">
                    <th className="py-2 pr-3 font-semibold">Month</th>
                    <th className="px-3 py-2 text-end font-semibold">Staff</th>
                    <th className="px-3 py-2 text-end font-semibold">Gross</th>
                    <th className="px-3 py-2 text-end font-semibold">Statutory</th>
                    <th className="py-2 pl-3 text-end font-semibold">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {payroll.months.map((m) => (
                    <tr key={m.period}>
                      <td className="py-2 pr-3 font-medium text-ink-2">{m.period}</td>
                      <td className="px-3 py-2 text-end text-ink-4">{m.headcount}</td>
                      <td className="px-3 py-2 text-end text-ink-3">{formatCurrency(m.gross)}</td>
                      <td className="px-3 py-2 text-end text-ink-4">
                        {formatCurrency(m.statutory.pf + m.statutory.esi + m.statutory.professionalTax)}
                      </td>
                      <td className="py-2 pl-3 text-end font-semibold text-ink-1">{formatCurrency(m.employerCost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line font-semibold text-ink-1">
                    <td className="py-2 pr-3">Total</td>
                    <td className="px-3 py-2 text-end">{payroll.headcount}</td>
                    <td className="px-3 py-2 text-end">{formatCurrency(payroll.gross)}</td>
                    <td className="px-3 py-2 text-end">
                      {formatCurrency(payroll.statutory.pf + payroll.statutory.esi + payroll.statutory.professionalTax)}
                    </td>
                    <td className="py-2 pl-3 text-end">{formatCurrency(payroll.employerCost)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* The app is worth more when it admits what it does not know. */}
          <p className="mt-2 text-xs text-ink-6">
            Offset keeps no history of past payroll runs, so every month here is worked out from the people and
            salaries on the payroll today{periods.length > 1 ? ', minus anyone who had not joined yet' : ''}. It is
            what this payroll would have cost, not a record of what was paid.
            {clamped && ' Months before the company was created, and months still to come, are left out.'}
          </p>
        </div>
      )}

      {hasAdvances && (
        <div className="mt-6">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[1px] text-ink-5">
            <HandCoins size={13} /> Advances
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure label="Opening" value={advances.openingOutstanding} muted />
            <Figure label="Paid out" value={advances.paidOut} muted />
            <Figure label="Recovered" value={advances.recovered} muted />
            <Figure label="Still owed" value={advances.closingOutstanding} strong />
          </div>

          {/* The distinction the module exists to protect. */}
          <p className="mt-2 text-xs text-ink-6">
            An advance is not a cost — it is money the company is still owed, and it becomes a cost only when a bill
            arrives and is set against it. Nothing here is added into the totals above.
          </p>

          {advances.buckets.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-start text-xs uppercase tracking-wide text-ink-5">
                    <th className="py-2 pr-3 font-semibold">How long it has been out</th>
                    <th className="px-3 py-2 text-end font-semibold">Advances</th>
                    <th className="py-2 pl-3 text-end font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {advances.buckets.map((b) => (
                    <tr key={b.id}>
                      <td className="py-2 pr-3 font-medium text-ink-2">{b.label}</td>
                      <td className="px-3 py-2 text-end text-ink-4">{b.count}</td>
                      <td className="py-2 pl-3 text-end font-semibold text-ink-1">{formatCurrency(b.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {advances.overdue > 0 && (
            <p className="mt-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
              {formatCurrency(advances.overdue)} is past the date it was expected back
              {advances.overdueCount > 1 ? `, across ${advances.overdueCount} advances` : ''}.
            </p>
          )}
          {advances.errors > 0 && (
            <p className="mt-1 text-xs font-semibold text-red-700 dark:text-red-400">
              {advances.errors === 1 ? 'One advance has' : `${advances.errors} advances have`} more set against
              {advances.errors === 1 ? ' it' : ' them'} than was ever paid in. That is a bookkeeping error, not a balance.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}

function Figure({ label, value, strong, muted, count }) {
  return (
    <div>
      <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-ink-5">{label}</div>
      <div
        className={
          strong
            ? 'font-serif text-lg font-bold text-ink-1'
            : muted
              ? 'font-serif text-lg text-ink-3'
              : 'font-serif text-lg font-semibold text-ink-2'
        }
      >
        {count ? value : formatCurrency(value)}
      </div>
    </div>
  )
}
