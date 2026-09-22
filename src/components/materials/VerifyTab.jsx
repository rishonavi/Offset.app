// Counting the shelf and telling the ledger what is really there.
//
// A stores ledger that has never been checked against a shelf is a ledger of
// claims. This is the only screen here that involves leaving the office.
import { useMemo, useState } from 'react'
import { AlertTriangle, ClipboardCheck } from 'lucide-react'
import * as store from '../../lib/storage/corporate'
import { countSheet, makeStockCount, sheetResult, adjustmentsFrom, shrinkage } from '../../lib/stockcount'
import { formatCurrency } from '../../lib/format'
import { todayISO } from '../../lib/today'
import { Card, Button, Field, Input, Select, cx, attempt } from '../ui'
import Stat from '../operations/Stat'
import { num } from './shared'

// The only screen in this app that asks somebody to leave the office.
//
// Every balance in the stores ledger is what the paperwork believes. A count is
// the one row that somebody stood in a godown to produce, so it is stored as
// evidence in its own right — including the counts that found nothing, which
// are what proves a store sound — and the adjustment it justifies is posted
// through the same movement ledger as everything else.
export default function Verify({ data, eid, actor, canWrite, bump, toast }) {
  const [storeId, setStoreId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [entered, setEntered] = useState({})

  const sheet = useMemo(
    () => countSheet(data.items, data.movements, { storeId, asOf: date, entityId: eid }),
    [data, storeId, date, eid],
  )
  const history = useMemo(
    () => shrinkage(data.stockCounts || [], data.items, data.movements, { entityId: eid, stores: data.projects }),
    [data, eid],
  )
  const storeName = (id) => (!id ? 'The yard' : data.projects.find((p) => p.id === id)?.name || 'A site store')

  // Counted and corrected in one go. The count is written first and the
  // adjustment second, because the adjustment is the consequence of the count
  // and a correction with no evidence behind it is what this screen exists to
  // replace.
  const post = () => {
    const rows = sheet
      .filter((r) => entered[r.item.id] !== undefined && entered[r.item.id] !== '')
      .map((r) => makeStockCount({
        entityId: eid, itemId: r.item.id, storeId, date,
        countedQty: num(entered[r.item.id]), bookQty: r.bookQty, avgCost: r.avgCost,
        countedBy: actor?.id,
      }))
    if (!rows.length) return
    const corrections = adjustmentsFrom(rows, { entityId: eid, actorId: actor?.id })
    // Both or neither. A count written with its correction refused would leave
    // the sheet saying the shelf is short and the stock saying it is not.
    if (!attempt(() => {
      for (const row of rows) store.stockCounts.add(row, actor)
      for (const m of corrections) store.movements.add(m, actor)
    }, toast)) return
    setEntered({})
    bump()
    toast(corrections.length
      ? `${rows.length} counted, ${corrections.length} corrected`
      : `${rows.length} counted, all square`)
  }

  const pending = sheet.filter((r) => entered[r.item.id] !== undefined && entered[r.item.id] !== '')
  const preview = sheetResult(pending.map((r) => makeStockCount({
    entityId: eid, itemId: r.item.id, storeId, date,
    countedQty: num(entered[r.item.id]), bookQty: r.bookQty, avgCost: r.avgCost,
  })), data.items, { entityId: eid })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Counts on file" value={String(history.count)} />
        <Stat label="Found short" value={formatCurrency(history.shortValue)} tone={history.shortValue > 0 ? 'warn' : undefined} />
        <Stat label="Found over" value={formatCurrency(history.overValue)} />
        <Stat
          label="Stores unverified"
          value={String(history.unverifiedCount)}
          tone={history.unverifiedCount > 0 ? 'warn' : undefined}
        />
      </div>

      {history.unverifiedCount > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-warn" />
            <h3 className="text-sm font-semibold text-ink-3">
              {history.neverCounted === history.unverifiedCount
                ? `${history.unverifiedCount} ${history.unverifiedCount === 1 ? 'store has' : 'stores have'} never been counted`
                : `${history.unverifiedCount} ${history.unverifiedCount === 1 ? 'store is' : 'stores are'} overdue a count`}
            </h3>
          </div>
          <p className="mt-1 text-xs text-ink-5">
            {history.unverified.map((u) => `${u.name}${u.lastCounted ? ` — last counted ${u.lastCounted}` : ''}`).join(' · ')}
          </p>
        </Card>
      )}

      {canWrite && (
        <Card className="p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-ink-3">Count sheet</h3>
              <p className="mt-1 text-xs text-ink-5">
                Write down what is on the shelf. Leave a row blank and it is not counted — a blank is not a zero, and
                a zero is a material somebody looked for and did not find.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Field label="Store">
                <Select aria-label="Store to count" value={storeId} onChange={(e) => { setStoreId(e.target.value); setEntered({}) }}>
                  <option value="">The yard</option>
                  {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              <Field label="Counted on">
                <Input aria-label="Count date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
            </div>
          </div>

          {sheet.length === 0 ? (
            <p className="mt-3 text-sm text-ink-5">Add materials and this fills in.</p>
          ) : (
            <>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[34rem] text-sm">
                  <thead className="text-xs uppercase tracking-wide text-ink-5">
                    <tr>
                      <th className="py-2 text-start">Material</th>
                      <th className="text-end">Books say</th>
                      <th className="text-end">Counted</th>
                      <th className="text-end">Out by</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {sheet.map((r) => {
                      const typed = entered[r.item.id]
                      const has = typed !== undefined && typed !== ''
                      const diff = has ? Math.round((num(typed) - r.bookQty) * 1000) / 1000 : null
                      return (
                        <tr key={r.item.id}>
                          <td className="py-2 text-ink-2">
                            {r.item.name}
                            <span className="block text-[0.7rem] text-ink-6">{storeName(storeId)} · {r.item.unit}</span>
                          </td>
                          <td className="text-end tabular text-ink-4">{r.bookQty}</td>
                          <td className="text-end">
                            <input
                              type="number"
                              step="any"
                              min="0"
                              aria-label={`Counted ${r.item.name}`}
                              value={typed ?? ''}
                              onChange={(e) => setEntered({ ...entered, [r.item.id]: e.target.value })}
                              className="w-24 rounded-lg border border-line-soft bg-surface-1 px-2 py-1 text-end tabular text-ink-2"
                            />
                          </td>
                          <td className={cx('text-end tabular font-medium',
                            diff === null ? 'text-ink-6' : diff < 0 ? 'text-bad' : diff > 0 ? 'text-warn' : 'text-good')}>
                            {diff === null ? '—' : diff === 0 ? 'square' : `${diff > 0 ? '+' : ''}${diff}`}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3">
                <p className="text-xs text-ink-5">
                  {pending.length === 0
                    ? 'Nothing counted yet.'
                    : /* Short and over are never netted. A godown twelve bags
                         down on cement and twelve up on sand has two problems,
                         and a difference of nothing reports neither. */
                      `${pending.length} counted · ${preview.short} short, ${preview.over} over, ${preview.square} square` +
                      (preview.shortValue > 0 ? ` · ${formatCurrency(preview.shortValue)} short` : '')}
                </p>
                <Button type="button" onClick={post} disabled={pending.length === 0}>
                  <ClipboardCheck size={16} /> Record count
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {history.count > 0 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-ink-3">What has been checked</h3>
          <p className="mt-1 text-xs text-ink-5">
            A sheet is a store and a day. The ones that found nothing are here too — they are what proves a store
            sound, and a list of only the bad ones would read as though every count found something.
          </p>
          <ul className="mt-3 space-y-2">
            {history.sheets.slice(0, 8).map((sh) => (
              <li key={`${sh.storeId || 'yard'}-${sh.date}`} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="text-ink-2">
                  {storeName(sh.storeId)}
                  <span className="block text-[0.7rem] text-ink-6">
                    {sh.date} · {sh.count} counted · {sh.short} short, {sh.over} over, {sh.square} square
                  </span>
                </span>
                <span className={cx('tabular font-semibold', sh.shortValue > 0 ? 'text-bad' : 'text-good')}>
                  {sh.shortValue > 0 ? `−${formatCurrency(sh.shortValue)}` : 'all square'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
