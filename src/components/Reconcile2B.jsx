import { useMemo, useState } from 'react'
import { FileUp, ShieldAlert, Check } from 'lucide-react'
import { useEntity } from '../context/EntityContext'
import { useData } from '../context/DataContext'
import { parse2B, reconcile2B, describe2B } from '../lib/gst2b'
import { formatCurrency } from '../lib/format'
import { Card, Field, Input, Badge, cx } from './ui'
import { thisMonth } from '../lib/today'

// The input credit a vendor has not filed for.
//
// A builder pays 18% on steel and 28% on cement and gets it back — but only if
// the vendor actually files. When he does not, the money is gone, and nothing
// in the books says so: the purchase is recorded, the tax is recorded, and the
// credit that never arrived leaves no row anywhere. Finding it means comparing
// the books against GSTR-2B line by line, every month, by hand.
//
// The 2B is read in the browser and never stored. It is somebody's tax filing;
// keeping a copy would be a liability nobody asked for, and the answer is the
// same either way.

export default function Reconcile2B() {
  const ent = useEntity()
  const { expenses } = useData()
  const [rows, setRows] = useState(null)
  const [month, setMonth] = useState(thisMonth())
  const [note, setNote] = useState('')
  const eid = ent?.corporate && !ent.consolidated ? ent.activeId : null

  const scoped = useMemo(
    () => (eid ? expenses.filter((e) => e.entity_id === eid) : expenses.filter((e) => !e.entity_id)),
    [expenses, eid],
  )
  const result = useMemo(
    () => reconcile2B(rows || [], scoped, { entityId: eid, month }),
    [rows, scoped, eid, month],
  )

  const load = async (file) => {
    if (!file) return
    try {
      const parsed = parse2B(await file.text())
      setRows(parsed)
      setNote(parsed.length
        ? `${parsed.length} line${parsed.length === 1 ? '' : 's'} read from ${file.name}.`
        : `Nothing in ${file.name} looked like a 2B. It needs a supplier, an invoice date and a tax figure.`)
    } catch (e) {
      setRows(null)
      setNote(e?.message || 'That file could not be read.')
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert size={16} className="text-ink-5" />
          <h2 className="text-sm font-semibold text-ink-3">Input credit against GSTR-2B</h2>
        </div>
        <span className="text-[0.6875rem] text-ink-6">Read here, never stored</span>
      </div>
      <p className="mt-1 text-xs text-ink-5">
        You pay the tax on a purchase and get it back as input credit — but only if the vendor files. When he does
        not, the money is simply gone, and there is nothing in your books to say so. Load the 2B and this says which
        purchases have no line against them.
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="Month">
          <Input aria-label="Reconciliation month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-line px-4 text-xs font-semibold text-ink-3 hover:border-line-strong">
          <FileUp size={15} /> Load 2B
          <input
            type="file"
            accept=".csv,text/csv,application/json,.json"
            aria-label="GSTR-2B file"
            className="hidden"
            onChange={(e) => load(e.target.files?.[0])}
          />
        </label>
        {note && <p className="text-xs text-ink-5">{note}</p>}
      </div>

      <p className="mt-3 text-xs font-medium text-ink-3">{describe2B(result)}</p>

      {!result.empty && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Cell label="Purchases with tax" value={String(result.counts.books)} />
            <Cell label="Matched" value={formatCurrency(result.matchedTax)} />
            {/* The money. A vendor who filed nothing at all. */}
            <Cell label="Credit at risk" value={formatCurrency(result.atRisk)} tone={result.atRisk > 0 ? 'bad' : undefined} />
            <Cell label="In 2B, not in books" value={formatCurrency(result.unrecordedTax)} tone={result.unrecordedTax > 0 ? 'warn' : undefined} />
          </div>

          {result.vendors.some((v) => v.atRisk > 0 || v.unrecorded > 0) && (
            <ul className="mt-3 space-y-1.5">
              {result.vendors.filter((v) => v.atRisk > 0 || v.unrecorded > 0).slice(0, 8).map((v) => (
                <li key={v.key} className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
                  <span className="text-ink-3">{v.vendor || 'Unnamed vendor'}</span>
                  <span className="flex items-center gap-2">
                    {v.matched > 0 && <span className="text-ink-6">{formatCurrency(v.matched)} filed</span>}
                    {v.atRisk > 0 && <span className="tabular font-semibold text-bad">{formatCurrency(v.atRisk)} at risk</span>}
                    {v.unrecorded > 0 && <Badge color="#d97706">{formatCurrency(v.unrecorded)} not in books</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {result.atRisk === 0 && result.unrecordedTax === 0 && (
            <p className="mt-3 flex items-center gap-2 text-xs text-good">
              <Check size={14} /> Every purchase on file appears in the 2B.
            </p>
          )}

          {/* Said rather than assumed: this matches on a vendor's name and a tax
              figure, because that is what an expense here carries. Enough to
              find the vendor who filed nothing; not enough to settle an argument
              about one invoice. */}
          <p className="mt-3 border-t border-line-soft pt-2 text-[0.6875rem] text-ink-6">
            Matched on the supplier’s name and the tax amount — an entry here carries no GSTIN or invoice number. That
            finds a vendor who has filed nothing, which is what costs money. It will not settle an argument about one
            invoice.
          </p>
        </>
      )}
    </Card>
  )
}

function Cell({ label, value, tone }) {
  return (
    <div>
      <p className="text-[0.6875rem] font-semibold uppercase tracking-[1px] text-ink-5">{label}</p>
      <p className={cx('mt-0.5 text-sm font-semibold tabular',
        tone === 'bad' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-ink-2')}>{value}</p>
    </div>
  )
}
