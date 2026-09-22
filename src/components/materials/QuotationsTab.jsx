// Quotes from suppliers, compared, and turned into receipts when one is taken.
import { useMemo, useState } from 'react'
import { Plus, AlertTriangle, Trash2 } from 'lucide-react'
import * as store from '../../lib/storage/corporate'
import { makeMovement } from '../../lib/inventory'
import { makeQuote, makeQuoteLine, quoteBook, compareQuotes, receiptsFromQuote, GST_RATES, DEFAULT_GST, QUOTE_STATE_LABELS } from '../../lib/quotes'
import { formatCurrency } from '../../lib/format'
import { todayISO } from '../../lib/today'
import { Card, Button, Field, Input, Select, Badge, attempt } from '../ui'
import Stat from '../operations/Stat'
import { num } from './shared'

const STATE_COLOURS = { sent: '#d97706', accepted: '#059669', declined: '#64748b', expired: '#dc2626', draft: '#64748b' }

export default function Quotations({ data, eid, actor, canWrite, bump, toast }) {
  const blankLine = () => ({ key: Math.random().toString(36).slice(2), itemId: '', qty: '', rate: '', gstPercent: DEFAULT_GST })
  const [form, setForm] = useState({ vendor: '', contact: '', date: todayISO(), validUntil: '', ref: '', lines: [blankLine()] })
  const [compareId, setCompareId] = useState('')

  const book = useMemo(() => quoteBook(data.quotes), [data])
  const comparison = useMemo(
    () => (compareId ? compareQuotes(compareId, data.quotes, { liveOnly: false }) : null),
    [compareId, data],
  )

  const setLine = (key, patch) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }))

  const save = (e) => {
    e.preventDefault()
    const lines = form.lines
      .filter((l) => l.itemId && num(l.qty) > 0)
      .map((l) => {
        const item = data.items.find((i) => i.id === l.itemId)
        return makeQuoteLine({
          itemId: l.itemId, name: item?.name || '', qty: num(l.qty),
          rate: num(l.rate), unit: item?.unit || 'pcs', gstPercent: Number(l.gstPercent),
        })
      })
    if (!form.vendor.trim() || lines.length === 0) return
    store.quotes.add(makeQuote({
      entityId: eid, vendor: form.vendor, contact: form.contact, date: form.date,
      validUntil: form.validUntil, ref: form.ref, lines, status: 'sent', createdBy: actor?.id,
    }), actor)
    setForm({ vendor: '', contact: '', date: todayISO(), validUntil: '', ref: '', lines: [blankLine()] })
    bump()
    toast('Quotation saved')
  }

  // Accepting is a decision, not a delivery. Booking the stock here would put
  // 100 bags of cement on the shelf the moment somebody agreed a price, and the
  // stores would be wrong until the lorry turned up — or for ever, if it never
  // did. So accepting only records the decision.
  const accept = (quote) => { store.quotes.update(quote.id, { status: 'accepted' }, actor); bump(); toast('Quotation accepted') }

  // The delivery, when it arrives, at the rate that was agreed — so nobody
  // re-keys the rate and nobody re-keys it wrong. Stamped once, because
  // pressing this twice would double the stock and there is no sign on the
  // shelf that it happened.
  const receive = (quote) => {
    if (quote.received_at) return
    if (!attempt(() => {
      for (const r of receiptsFromQuote(quote, { entityId: eid })) {
        store.movements.add(makeMovement({ ...r, createdBy: actor?.id }), actor)
      }
      store.quotes.update(quote.id, { received_at: new Date().toISOString() }, actor)
    }, toast)) return
    bump()
    toast('Delivery recorded at the quoted rate')
  }

  const decline = (quote) => { store.quotes.update(quote.id, { status: 'declined' }, actor); bump(); toast('Quotation declined') }
  const remove = (quote) => { store.quotes.remove(quote.id, actor); bump(); toast('Quotation deleted') }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Quotations" value={String(book.count)} />
        <Stat label="Awaiting a decision" value={String(book.awaiting)} />
        <Stat label="On the table" value={formatCurrency(book.awaitingValue)} />
        {/* Each one is a purchase that now has to be re-quoted. */}
        <Stat label="Expired unused" value={String(book.expired)} tone={book.expired ? 'warn' : undefined} />
      </div>

      {canWrite && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-ink-3">Record a quotation</h3>
          <p className="mt-1 text-xs text-ink-5">
            Three quotes for the same material are how anyone knows the accepted one was reasonable. Tax is per line,
            because cement at 28% and sand at 5% are not the same price however similar the rate looks.
          </p>
          <form onSubmit={save} className="mt-3 space-y-3">
            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-4">
              <Field label="Vendor" required className="sm:col-span-2">
                <Input aria-label="Quotation vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} placeholder="Shree Traders" />
              </Field>
              <Field label="Quoted on">
                <Input aria-label="Quoted on" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
              </Field>
              <Field label="Valid until" hint="Blank never expires.">
                <Input aria-label="Valid until" type="date" value={form.validUntil} onChange={(e) => setForm({ ...form, validUntil: e.target.value })} />
              </Field>
            </div>

            <div className="space-y-2">
              {form.lines.map((l) => (
                <div key={l.key} className="grid grid-cols-2 gap-2 sm:grid-cols-12">
                  <Select
                    className="sm:col-span-5"
                    aria-label="Quoted material"
                    value={l.itemId}
                    onChange={(e) => setLine(l.key, { itemId: e.target.value })}
                  >
                    <option value="">Material…</option>
                    {data.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </Select>
                  <Input className="sm:col-span-2" aria-label="Quoted quantity" type="number" step="any" placeholder="Qty"
                    value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                  <Input className="sm:col-span-3" aria-label="Quoted rate" type="number" step="0.01" placeholder="Rate"
                    value={l.rate} onChange={(e) => setLine(l.key, { rate: e.target.value })} />
                  <Select className="sm:col-span-2" aria-label="GST rate" value={l.gstPercent}
                    onChange={(e) => setLine(l.key, { gstPercent: e.target.value })}>
                    {GST_RATES.map((g) => <option key={g} value={g}>{g}% GST</option>)}
                  </Select>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="ghost" onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))}>
                <Plus size={15} /> Add a line
              </Button>
              <Button type="submit" disabled={!form.vendor.trim()}>Save quotation</Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-ink-3">Compare on one material</h3>
        <p className="mt-1 text-xs text-ink-5">
          Ranked by the landed price, tax included. The cheapest rate and the cheapest quote are often different vendors.
        </p>
        <Select className="mt-3" aria-label="Compare material" value={compareId} onChange={(e) => setCompareId(e.target.value)}>
          <option value="">Choose a material…</option>
          {data.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
        </Select>
        {comparison && (
          comparison.count === 0 ? (
            <p className="mt-3 text-sm text-ink-5">Nobody has quoted for this yet.</p>
          ) : (
            <>
              <ul className="mt-3 divide-y divide-line-soft">
                {comparison.offers.map((o, i) => (
                  <li key={`${o.quote.id}-${o.line.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="text-ink-2">
                      {o.vendor}
                      {i === 0 && <span className="ms-2"><Badge color="#059669">cheapest landed</Badge></span>}
                      {o.accepted && <span className="ms-2"><Badge color="#2563eb">accepted</Badge></span>}
                    </span>
                    <span className="tabular text-ink-4">
                      {formatCurrency(o.rate)}/{o.unit} + {o.line.gst_percent}% ={' '}
                      <span className="font-medium text-ink-2">{formatCurrency(o.landedRate)}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-ink-5">
                {comparison.spreadPercent}% between the cheapest and the dearest.
              </p>
              {comparison.acceptedNotCheapest && (
                <p className="mt-2 flex items-center gap-2 text-xs text-warn">
                  <AlertTriangle size={13} /> The accepted quote is not the cheapest on the table.
                </p>
              )}
            </>
          )
        )}
      </Card>

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-ink-3">Quotations on file</h3>
        {book.count === 0 ? (
          <p className="mt-3 text-sm text-ink-5">No quotations yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line-soft">
            {book.lines.map(({ quote, state, totals }) => (
              <li key={quote.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-2">
                    {quote.vendor}
                    <Badge color={STATE_COLOURS[state]}>{QUOTE_STATE_LABELS[state]}</Badge>
                  </p>
                  <p className="text-xs text-ink-5">
                    {quote.date}
                    {quote.valid_until && ` · valid to ${quote.valid_until}`}
                    {` · ${totals.lines} ${totals.lines === 1 ? 'line' : 'lines'}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular text-sm font-medium text-ink-2">{formatCurrency(totals.total)}</span>
                  {canWrite && state === 'sent' && (
                    <>
                      <Button variant="ghost" onClick={() => accept(quote)}>Accept</Button>
                      <Button variant="ghost" onClick={() => decline(quote)}>Decline</Button>
                    </>
                  )}
                  {canWrite && state === 'accepted' && !quote.received_at && (
                    <Button variant="ghost" onClick={() => receive(quote)}>Receive delivery</Button>
                  )}
                  {quote.received_at && <Badge color="#059669">delivered</Badge>}
                  {canWrite && (
                    <Button variant="ghost" aria-label={`Delete quotation from ${quote.vendor}`} onClick={() => remove(quote)}>
                      <Trash2 size={15} />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
