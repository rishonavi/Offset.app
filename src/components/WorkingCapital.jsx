import { useMemo } from 'react'
import { Scale } from 'lucide-react'
import { workingCapital, describeAgeing } from '../lib/payables'
import { formatCurrency } from '../lib/format'
import { Card } from './ui'

// What is owed, in both directions, and how late it is.
//
// The ageing ladder in payables.js had been written and tested and reached no
// screen at all: the dashboard shows two totals, and nothing anywhere said how
// old they were. A ₹2,00,000 payable is a different problem depending on
// whether it is due next week or has been sitting for four months, and that
// difference is the whole reason ageing exists.
//
// The one thing worth understanding here: ageing deliberately ignores the start
// of the report's date range. "Still open as at the close" is the question, and
// a bill from two years ago that has never been paid is the single most
// important row on this card — a start date would hide exactly that. The
// property and category filters do apply, because they narrow which bills are
// being asked about rather than which are allowed to be old.

export function useWorkingCapital(expenses, income, filters) {
  const { propertyId, category, to } = filters
  return useMemo(() => {
    const mine = (rows, withCategory) =>
      rows
        .filter((r) => !propertyId || r.property_id === propertyId)
        .filter((r) => !withCategory || !category || r.category === category)
    return workingCapital({
      expenses: mine(expenses, true),
      income: mine(income, false),
      asOf: to || undefined,
    })
  }, [expenses, income, propertyId, category, to])
}

export default function WorkingCapital({ capital, dated }) {
  const { payable, receivable, net, netOverdue } = capital
  if (!payable.count && !receivable.count) return null

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Scale size={16} className="text-ink-5" />
        <h2 className="text-sm font-semibold text-ink-3">What is owed, and how late</h2>
      </div>
      <p className="mt-1 text-xs text-ink-5">
        Everything still open{dated ? ` as at ${dated}` : ' today'} — not just what falls inside the period above, because
        a bill that has been unpaid for a year is the row that matters most.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Side label="You owe" report={payable} tone="#C0492F" />
        <Side label="Owed to you" report={receivable} tone="#2F8F6B" />
        <div className="border-s-2 border-navy ps-3">
          <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-ink-5">If both settled</div>
          <div className="font-serif text-xl font-bold" style={{ color: net >= 0 ? '#2F8F6B' : '#C0492F' }}>
            {formatCurrency(net)}
          </div>
          <p className="mt-1 text-xs text-ink-6">
            {netOverdue === 0
              ? 'Nothing is late in either direction.'
              : `${formatCurrency(Math.abs(netOverdue))} ${netOverdue >= 0 ? 'more is owed to you late than by you' : 'more is late from you than to you'}.`}
          </p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Ladder title="Bills you have not paid" report={payable} />
        <Ladder title="Money not yet received" report={receivable} />
      </div>
    </Card>
  )
}

function Side({ label, report, tone }) {
  return (
    <div className="border-s-2 ps-3" style={{ borderColor: tone }}>
      <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-ink-5">{label}</div>
      <div className="font-serif text-xl font-bold text-ink-1">{formatCurrency(report.total)}</div>
      <p className="mt-1 text-xs text-ink-6">{describeAgeing(report)}</p>
    </div>
  )
}

function Ladder({ title, report }) {
  if (!report.buckets.length) return null
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-[1px] text-ink-5">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-start text-xs uppercase tracking-wide text-ink-5">
              <th className="py-2 pr-3 font-semibold">Age</th>
              <th className="px-3 py-2 text-end font-semibold">Count</th>
              <th className="py-2 pl-3 text-end font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {report.buckets.map((b) => (
              <tr key={b.id}>
                {/* Anything past its date is the part someone has to act on. */}
                <td className={b.id === 'current' || b.id === 'nodate' ? 'py-2 pr-3 text-ink-3' : 'py-2 pr-3 font-medium text-amber-700 dark:text-amber-400'}>
                  {b.label}
                </td>
                <td className="px-3 py-2 text-end text-ink-4">{b.count}</td>
                <td className="py-2 pl-3 text-end font-semibold text-ink-1">{formatCurrency(b.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line font-semibold text-ink-1">
              <td className="py-2 pr-3">Total</td>
              <td className="px-3 py-2 text-end">{report.count}</td>
              <td className="py-2 pl-3 text-end">{formatCurrency(report.total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
