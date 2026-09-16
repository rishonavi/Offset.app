import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowDownLeft, ArrowUpRight, FileSignature } from 'lucide-react'
import { useEntity } from '../context/EntityContext'
import { useData } from '../context/DataContext'
import * as store from '../lib/storage/corporate'
import { commitments, describeGap } from '../lib/commitments'
import { describeCertainty } from '../lib/certainty'
import { formatCurrency } from '../lib/format'
import { Card, cx, Certainty } from './ui'

// What is already promised, on the page people actually open.
//
// The ledger says what a job has cost. This says what has been agreed and has
// not reached the ledger — a work order signed and half certified, an accepted
// quotation nobody has taken delivery of. Neither is an expense, so neither
// appears in any total on this screen, and both are spent.
//
// The three figures are deliberately not added into one. Committed is not cash
// due this month, and folding it in makes a solvent company look bankrupt.
function Row({ label, value, hint, tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="min-w-0 text-xs text-ink-5">
        {label}
        {hint && <span className="block text-[0.68rem] text-ink-6">{hint}</span>}
      </span>
      <span className={cx('shrink-0 tabular text-sm font-semibold',
        tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-emerald-600' : 'text-ink-2')}>
        {value}
      </span>
    </div>
  )
}

export default function Commitments() {
  const ent = useEntity()
  const { expenses, income } = useData()
  const scoped = Boolean(ent?.corporate && ent.activeId && !ent.consolidated)
  const eid = ent?.activeId

  const c = useMemo(() => {
    if (!scoped) return null
    const at = (name) => store.collections[name]?.list(eid) || []
    return commitments({
      workOrders: at('workOrders'), raBills: at('raBills'), quotes: at('quotes'),
      units: at('units'), planStages: store.planStages.list(), receipts: at('receipts'),
      workItems: at('workItems'), measurements: at('measurements'),
      expenses: expenses.filter((e) => e.entity_id === eid),
      income: income.filter((e) => e.entity_id === eid),
    }, { entityId: eid })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, eid, ent?.version, expenses, income])

  // Nothing agreed and nothing owed is not a card worth a sixth of the screen.
  if (!c || (c.committed <= 0 && c.dueOut <= 0 && c.dueIn <= 0)) return null

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-3">
          <FileSignature size={15} /> Already promised
        </h3>
        <Link to="/operations?tab=labour" className="inline-flex items-center gap-1 text-xs font-semibold text-brand underline-offset-4 hover:underline">
          Contracts <ArrowRight size={12} />
        </Link>
      </div>
      <p className="mt-1 text-xs text-ink-5">{describeGap(c)}</p>

      <div className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-3">
        <div className="sm:border-e sm:border-line-soft sm:pe-6">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[1px] text-ink-5">Agreed, not yet spent</p>
          <p className="mt-0.5 text-lg font-semibold tabular text-ink-2">{formatCurrency(c.committed)}</p>
          {/* A contract is not a payment and not a forecast. Saying which it is
              keeps somebody from reading this column as money in the bank. */}
          <Certainty made={c.certainty.committed} />
          <Row label="Work orders outstanding" value={formatCurrency(c.subcontract.remaining)} />
          <Row label="Deliveries accepted" value={formatCurrency(c.materials.ordered)}
            hint={c.materials.count ? `${c.materials.count} ${c.materials.count === 1 ? 'quotation' : 'quotations'}` : null} />
          {c.incomplete && (
            // A rate contract commits a real amount nobody wrote down. Saying
            // the total is a floor beats printing it as though it were the
            // answer.
            <p className="mt-1 text-[0.68rem] text-amber-600">
              {c.subcontract.unvalued + c.client.unvalued} {c.subcontract.unvalued + c.client.unvalued === 1 ? 'contract carries' : 'contracts carry'} no
              value, so this is a floor.
            </p>
          )}
        </div>

        <div className="mt-3 sm:mt-0 sm:border-e sm:border-line-soft sm:pe-6">
          <p className="flex items-center gap-1 text-[0.68rem] font-semibold uppercase tracking-[1px] text-ink-5">
            <ArrowUpRight size={11} /> Owed now
          </p>
          <p className="mt-0.5 text-lg font-semibold tabular text-ink-2">{formatCurrency(c.dueOut)}</p>
          <Certainty made={c.certainty.dueOut} />
          <Row label="Bills unpaid" value={formatCurrency(c.payable.total)} />
          <Row label="Certified, not paid" value={formatCurrency(c.subcontract.unpaid)} />
          <Row label="Retention due for release" value={formatCurrency(c.subcontract.retentionDue)}
            tone={c.subcontract.retentionDue > 0 ? 'bad' : undefined} />
        </div>

        <div className="mt-3 sm:mt-0">
          <p className="flex items-center gap-1 text-[0.68rem] font-semibold uppercase tracking-[1px] text-ink-5">
            <ArrowDownLeft size={11} /> Due in
          </p>
          <p className="mt-0.5 text-lg font-semibold tabular text-ink-2">{formatCurrency(c.dueIn)}</p>
          <Certainty made={c.certainty.dueIn} />
          <Row label="Invoices awaited" value={formatCurrency(c.receivable.total)} />
          <Row label="Instalments fallen due" value={formatCurrency(c.sales.dueNow)} />
          <Row label="Retention the client owes" value={formatCurrency(c.client.retentionDue)} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-line-soft pt-3">
        <span className="text-xs text-ink-5">
          If everything due came in and everything owed went out
          {/* The three are never added into one figure, and this says why:
              agreed money plus recorded money is agreed money. */}
          <span className="block text-[0.68rem] text-ink-6">{describeCertainty(c.certainty.committedAndDue)}</span>
        </span>
        <span className={cx('tabular text-base font-semibold', c.gap < 0 ? 'text-red-600' : 'text-emerald-600')}>
          {c.gap < 0 ? '−' : '+'}{formatCurrency(Math.abs(c.gap))}
          {c.cover !== null && <span className="ms-2 text-xs font-medium text-ink-5">{c.cover}× cover</span>}
        </span>
      </div>
    </Card>
  )
}
