// What each material has been costing, and whether somebody is quoting less.
//
// Read-only: it takes the movement history and the quote book and reports.
// Nothing on this screen writes, which is why it imports neither the store nor
// the PDF writer.
import { useMemo } from 'react'
import { TrendingDown, TrendingUp } from 'lucide-react'
import { categoryOf } from '../../lib/materials'
import { priceList } from '../../lib/quotes'
import { materialVariance } from '../../lib/rates'
import { formatCurrency } from '../../lib/format'
import { Card, cx } from '../ui'
import Stat from '../operations/Stat'

export default function Prices({ data }) {
  const list = useMemo(
    () => priceList(data.items, data.movements, data.quotes),
    [data],
  )
  // The question after buying rather than before it: was that lorry in line
  // with the others. Keyed by material so the table below can read it off.
  const paid = useMemo(() => materialVariance(data.items, data.movements), [data])
  const byItem = useMemo(() => Object.fromEntries(paid.rows.map((r) => [r.item.id, r])), [paid])

  return (
    <div className="space-y-4">
      {/* Five, not four. "Never priced" is the count of materials nobody has
          ever bought — the leftovers, and the ones no rate check can say
          anything about. Replacing it with the new figure rather than adding
          to it lost exactly the row this app keeps insisting must stay
          visible. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Materials priced" value={`${list.count - list.unpriced}/${list.count}`} />
        <Stat label="Quoted for" value={String(list.quoted)} />
        <Stat label="Cheaper available" value={String(list.cheaperAvailable)} tone={list.cheaperAvailable ? 'warn' : undefined} />
        <Stat label="Paid above the norm" value={formatCurrency(paid.overpaid)} tone={paid.overpaid > 0 ? 'warn' : undefined} />
        <Stat label="Never priced" value={String(list.unpriced)} />
      </div>

      {paid.dear > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <TrendingUp size={16} className="text-warn" />
            <h3 className="text-sm font-semibold text-ink-3">
              {paid.dear} {paid.dear === 1 ? 'delivery came' : 'deliveries came'} in above the going rate
            </h3>
          </div>
          <p className="mt-1 text-xs text-ink-5">
            Each measured against the middle of the five purchases before it <em>and</em> the one immediately before
            it, so a rising market does not set this off — only a jump does.
          </p>
          <ul className="mt-3 space-y-2">
            {paid.rows.filter((r) => r.worst).slice(0, 4).map((r) => (
              <li key={r.item.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="text-ink-2">
                  {r.item.name}
                  <span className="block text-[0.7rem] text-ink-6">
                    {formatCurrency(r.worst.rate)} on {r.worst.date} against {formatCurrency(r.worst.baseline)} normal
                    {r.worst.vendor && ` · ${r.worst.vendor}`}
                  </span>
                </span>
                <span className="tabular font-semibold text-warn">
                  +{formatCurrency(r.worst.value)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-ink-3">What it costs</h3>
        <p className="mt-1 text-xs text-ink-5">
          Last paid against the best quote on the table today. Drift is how far the rate has moved since the first
          purchase — the number that explains why a job costed last year no longer adds up.
        </p>
        {list.count === 0 ? (
          <p className="mt-3 text-sm text-ink-5">Add materials and this fills in.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-5">
                <tr>
                  <th className="py-2 text-start">Material</th>
                  <th className="text-end">Last paid</th>
                  <th className="text-end">Drift</th>
                  <th className="text-end">Normal</th>
                  <th className="text-end">Best quote</th>
                  <th className="text-start ps-4">Vendor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {list.rows.map((r) => (
                  <tr key={r.item.id}>
                    <td className="py-2 text-ink-2">
                      {r.item.name}
                      <span className="block text-[0.7rem] text-ink-6">{categoryOf(r.item).label}</span>
                    </td>
                    <td className="text-end tabular text-ink-3">
                      {r.lastRate === null ? '—' : formatCurrency(r.lastRate)}
                      {r.lastPaidOn && <span className="block text-[0.7rem] text-ink-6">{r.lastPaidOn}</span>}
                    </td>
                    <td className={cx('text-end tabular', (r.driftPercent || 0) > 0 ? 'text-warn' : 'text-ink-4')}>
                      {r.driftPercent === null ? '—' : `${r.driftPercent > 0 ? '+' : ''}${r.driftPercent}%`}
                    </td>
                    {/* What the next lorry ought to cost, on this evidence.
                        Blank where there are too few purchases to have a norm,
                        because a norm of one number is not a norm. */}
                    <td className="text-end tabular text-ink-4">
                      {byItem[r.item.id]?.norm == null || byItem[r.item.id]?.judged === 0
                        ? '—'
                        : formatCurrency(byItem[r.item.id].norm)}
                      {byItem[r.item.id]?.dear > 0 && (
                        <span className="block text-[0.7rem] font-semibold text-warn">
                          {byItem[r.item.id].dear} above it
                        </span>
                      )}
                    </td>
                    <td className="text-end tabular text-ink-3">
                      {r.bestRate === null ? '—' : formatCurrency(r.bestRate)}
                      {r.spreadPercent > 0 && (
                        <span className="block text-[0.7rem] text-ink-6">{r.quotes} quotes, {r.spreadPercent}% apart</span>
                      )}
                    </td>
                    <td className="ps-4 text-ink-4">
                      {r.bestVendor || '—'}
                      {r.cheaperAvailable && (
                        <span className="mt-1 flex items-center gap-1 text-[0.7rem] font-semibold text-good">
                          <TrendingDown size={12} /> {r.savingPercent}% below what you paid
                        </span>
                      )}
                    </td>
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
