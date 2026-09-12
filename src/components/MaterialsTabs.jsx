import { useMemo, useState } from 'react'
import {
  Boxes, IndianRupee, FileText, HardHat, Plus, AlertTriangle,
  TrendingDown, Undo2, Trash2,
} from 'lucide-react'
import * as store from '../lib/storage/corporate'
import {
  makeItem, makeMovement, stockReport, reorderList, usageBySite, movementLog,
  UNITS, MOVEMENT_KINDS, MOVEMENT_KIND_IDS,
} from '../lib/inventory'
import {
  MATERIAL_CATEGORIES, MATERIAL_CATEGORY_IDS, CATALOGUE,
  catalogueFor, fromCatalogue, unitFor, byCategory, categoryOf,
} from '../lib/materials'
import {
  makeQuote, makeQuoteLine, quoteTotals, quoteState, quoteBook, compareQuotes,
  priceList, receiptsFromQuote, GST_RATES, DEFAULT_GST, QUOTE_STATE_LABELS,
} from '../lib/quotes'
import { makeProject, PROJECT_STATUS, PROJECT_STATUS_IDS } from '../lib/projects'
import { formatCurrency } from '../lib/format'
import { Card, Button, Field, Input, Select, Badge, cx } from './ui'

// Materials, for a company that builds things.
//
// Four questions, in the order somebody on a site asks them: what have we got,
// what does it cost, who will sell it cheaper, and which job burned it. They
// are sub-tabs rather than four more entries in the side bar because they are
// one job — running the stores — and because splitting them would mean four
// screens each showing a quarter of the same table.
const VIEWS = [
  { id: 'stock', label: 'Inventory', icon: Boxes },
  { id: 'prices', label: 'Prices', icon: IndianRupee },
  { id: 'quotes', label: 'Quotations', icon: FileText },
  { id: 'usage', label: 'Usage', icon: HardHat },
]

const today = () => new Date().toISOString().slice(0, 10)
const num = (v) => Number(v) || 0

export default function Materials(shared) {
  const [view, setView] = useState('stock')
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Materials">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            onClick={() => setView(v.id)}
            aria-selected={view === v.id}
            className={cx(
              'inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-[0.78rem] font-semibold transition',
              view === v.id
                ? 'border-brand bg-brand/15 text-ink-1'
                : 'border-line text-ink-5 hover:border-line-strong hover:text-ink-2',
            )}
          >
            <v.icon size={14} /> {v.label}
          </button>
        ))}
      </div>

      {view === 'stock' && <Inventory {...shared} />}
      {view === 'prices' && <Prices {...shared} />}
      {view === 'quotes' && <Quotations {...shared} />}
      {view === 'usage' && <Usage {...shared} />}
    </div>
  )
}

// ── Inventory ───────────────────────────────────────────────────────────────
function Inventory({ data, eid, actor, canWrite, bump, toast }) {
  const blank = { category: 'cement', name: '', brand: '', spec: '', sku: '', unit: 'bag', reorderLevel: '' }
  const [form, setForm] = useState(blank)
  const [move, setMove] = useState({ itemId: '', kind: 'receipt', qty: '', unitCost: '', otherCost: '', vendor: '', projectId: '', reason: '', note: '' })

  const report = useMemo(() => stockReport(data.items, data.movements), [data])
  const low = useMemo(() => reorderList(data.items, data.movements), [data])
  const groups = useMemo(() => byCategory(report.lines), [report])
  const kind = MOVEMENT_KINDS[move.kind] || MOVEMENT_KINDS.receipt

  // Choosing a trade changes the unit a form offers, because cement is bagged
  // and sand is not. Anything already typed is left alone.
  const pickCategory = (category) =>
    setForm((f) => ({ ...f, category, unit: unitFor(category) }))

  // Typing a catalogue name fills in what the catalogue knows. Typing something
  // else is not an error — the list is a shortcut, not a whitelist.
  const pickName = (name) => {
    const known = fromCatalogue(name)
    setForm((f) => (known ? { ...f, ...known } : { ...f, name }))
  }

  const addItem = (e) => {
    e.preventDefault()
    if (!form.name.trim()) return
    const cat = MATERIAL_CATEGORIES[form.category]
    store.items.add(makeItem({
      entityId: eid, ...form,
      hsn: fromCatalogue(form.name)?.hsn || cat?.hsn || '',
      reorderLevel: num(form.reorderLevel),
    }), actor)
    setForm({ ...blank, category: form.category, unit: unitFor(form.category) })
    bump()
    toast('Material added')
  }

  const addMovement = (e) => {
    e.preventDefault()
    if (!move.itemId || !num(move.qty)) return
    store.movements.add(makeMovement({
      entityId: eid, itemId: move.itemId, kind: move.kind,
      qty: num(move.qty), unitCost: num(move.unitCost), otherCost: num(move.otherCost),
      vendor: move.vendor, projectId: move.projectId || null, reason: move.reason, note: move.note,
      date: today(), createdBy: actor?.id,
    }), actor)
    setMove({ itemId: '', kind: move.kind, qty: '', unitCost: '', otherCost: '', vendor: '', projectId: '', reason: '', note: '' })
    bump()
    toast(move.kind === 'rejected' ? 'Rejection recorded' : 'Movement recorded')
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Materials" value={String(data.items.length)} />
        <Stat label="Stock value" value={formatCurrency(report.totalValue)} />
        <Stat label="Below reorder" value={String(report.itemsBelowReorder)} tone={report.itemsBelowReorder ? 'warn' : undefined} />
        {/* Not part of the stock value: this is money a supplier owes back, not
            an asset on the shelf, and adding the two would inflate both. */}
        <Stat
          label="Rejected — claimable"
          value={formatCurrency(report.rejectedValue)}
          tone={report.rejectedValue > 0 ? 'warn' : undefined}
        />
      </div>

      {low.length > 0 && (
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-600" />
            <h3 className="text-sm font-semibold text-ink-3">Reorder</h3>
          </div>
          <p className="mt-1 text-xs text-ink-5">Negative stock first — there the books and the shelf disagree.</p>
          <ul className="mt-3 divide-y divide-line-soft">
            {low.map((l) => (
              <li key={l.item.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 truncate text-ink-2">{l.item.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  {l.negative && <Badge color="#dc2626">negative</Badge>}
                  <span className="tabular text-ink-4">{l.qty} {l.item.unit} · reorder at {l.item.reorder_level}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {canWrite && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card className="p-5">
            <h3 className="text-sm font-semibold text-ink-3">Add a material</h3>
            <p className="mt-1 text-xs text-ink-5">
              Pick a trade and the unit and HSN fill themselves in. The name list is a shortcut — anything can be typed.
            </p>
            <form onSubmit={addItem} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <Field label="Trade" className="sm:col-span-2">
                <Select value={form.category} onChange={(e) => pickCategory(e.target.value)} aria-label="Trade">
                  {MATERIAL_CATEGORY_IDS.map((id) => (
                    <option key={id} value={id}>{MATERIAL_CATEGORIES[id].label}</option>
                  ))}
                </Select>
              </Field>
              <Field className="sm:col-span-2" label="Material" required>
                <Input
                  list="material-catalogue"
                  aria-label="Material name"
                  value={form.name}
                  onChange={(e) => pickName(e.target.value)}
                  placeholder={catalogueFor(form.category)[0]?.name || 'Cement OPC 53 grade'}
                />
                <datalist id="material-catalogue">
                  {CATALOGUE.map((c) => <option key={c.name} value={c.name} />)}
                </datalist>
              </Field>
              <Field label="Brand" hint="Two makers, two prices.">
                <Input aria-label="Brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} placeholder="UltraTech" />
              </Field>
              <Field label="Grade / size">
                <Input aria-label="Grade or size" value={form.spec} onChange={(e) => setForm({ ...form, spec: e.target.value })} placeholder="53 grade" />
              </Field>
              <Field label="Unit">
                <Select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} aria-label="Unit">
                  {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </Select>
              </Field>
              <Field label="SKU" hint="What is written on the bin.">
                <Input aria-label="SKU" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
              </Field>
              <Field label="Reorder level" hint="Zero means never warn.">
                <Input aria-label="Reorder level" type="number" min="0" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} />
              </Field>
              <div className="sm:col-span-2"><Button type="submit"><Plus size={16} /> Add material</Button></div>
            </form>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold text-ink-3">Record a movement</h3>
            <p className="mt-1 text-xs text-ink-5">
              Issued material is in the building and wasted material is gone. Rejected material went back to the
              supplier — it is a credit they owe, not a cost of the job.
            </p>
            <form onSubmit={addMovement} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <Field className="sm:col-span-2" label="Material" required>
                <Select value={move.itemId} onChange={(e) => setMove({ ...move, itemId: e.target.value })} aria-label="Material">
                  <option value="">Choose…</option>
                  {data.items.map((i) => (
                    <option key={i.id} value={i.id}>{i.name}{i.brand ? ` · ${i.brand}` : ''}</option>
                  ))}
                </Select>
              </Field>
              <Field label="What happened">
                <Select value={move.kind} onChange={(e) => setMove({ ...move, kind: e.target.value })} aria-label="What happened">
                  {MOVEMENT_KIND_IDS.map((id) => (
                    <option key={id} value={id}>{MOVEMENT_KINDS[id].label}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Quantity" required>
                <Input aria-label="Quantity" type="number" step="any" value={move.qty} onChange={(e) => setMove({ ...move, qty: e.target.value })} />
              </Field>
              {kind.needsCost && (
                <Field
                  label="Rate per unit"
                  hint={move.kind === 'rejected' ? 'The rate it was invoiced at, so the credit note matches the bill.' : undefined}
                >
                  <Input aria-label="Rate per unit" type="number" step="0.01" min="0" value={move.unitCost} onChange={(e) => setMove({ ...move, unitCost: e.target.value })} />
                </Field>
              )}
              {move.kind === 'receipt' && (
                <Field label="Freight & handling" hint="For the whole delivery. It belongs in the cost of the material.">
                  <Input aria-label="Freight and handling" type="number" step="0.01" min="0"
                    value={move.otherCost} onChange={(e) => setMove({ ...move, otherCost: e.target.value })} />
                </Field>
              )}
              {(move.kind === 'receipt' || move.kind === 'rejected') && (
                <Field label="Vendor">
                  <Input aria-label="Vendor" value={move.vendor} onChange={(e) => setMove({ ...move, vendor: e.target.value })} placeholder="Shree Traders" />
                </Field>
              )}
              {move.kind === 'rejected' && (
                <Field className="sm:col-span-2" label="Why it was rejected" hint="A rejection nobody wrote a reason for is one nobody can claim.">
                  <Input aria-label="Rejection reason" value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} placeholder="Set hard in transit" />
                </Field>
              )}
              {data.projects.length > 0 && kind.direction === 'out' && (
                <Field className="sm:col-span-2" label="Site" hint="Material with no site is material no job is charged for.">
                  <Select value={move.projectId} onChange={(e) => setMove({ ...move, projectId: e.target.value })} aria-label="Site">
                    <option value="">Not booked to a site</option>
                    {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </Field>
              )}
              <div className="sm:col-span-2">
                <Button type="submit" disabled={!move.itemId}><Plus size={16} /> Record</Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {groups.length === 0 ? (
        <Card className="p-5"><p className="text-sm text-ink-5">No materials yet.</p></Card>
      ) : (
        groups.map((g) => (
          <Card key={g.category.id || 'none'} className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink-3">{g.category.label}</h3>
              <span className="text-xs text-ink-5">
                {formatCurrency(g.value)}
                {g.low > 0 && <span className="ms-2 text-amber-600">{g.low} to reorder</span>}
              </span>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[42rem] text-sm">
                <thead className="text-xs uppercase tracking-wide text-ink-5">
                  <tr>
                    <th className="py-2 text-start">Material</th>
                    <th className="text-end">In</th>
                    <th className="text-end">Issued</th>
                    <th className="text-end">Wasted</th>
                    <th className="text-end">Rejected</th>
                    <th className="text-end">On hand</th>
                    <th className="text-end">Rate</th>
                    <th className="text-end">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {g.lines.map((l) => (
                    <tr key={l.item.id}>
                      <td className="py-2 text-ink-2">
                        {l.item.name}
                        {l.item.brand && <span className="text-ink-6"> · {l.item.brand}</span>}
                        {l.negative && <span className="ms-2"><Badge color="#dc2626">negative</Badge></span>}
                      </td>
                      <td className="text-end tabular text-ink-4">{l.received}</td>
                      <td className="text-end tabular text-ink-4">{l.issued}</td>
                      <td className={cx('text-end tabular', l.wastagePercent > 10 ? 'text-amber-600' : 'text-ink-4')}>
                        {l.wasted}{l.wastagePercent !== null && l.wasted > 0 ? ` (${l.wastagePercent}%)` : ''}
                      </td>
                      <td className={cx('text-end tabular', l.rejected > 0 ? 'text-amber-600' : 'text-ink-4')}>
                        {l.rejected}{l.rejectionPercent !== null && l.rejected > 0 ? ` (${l.rejectionPercent}%)` : ''}
                      </td>
                      <td className="text-end tabular text-ink-2">{l.qty} {l.item.unit}</td>
                      <td className="text-end tabular text-ink-4">{formatCurrency(l.avgCost)}</td>
                      <td className="text-end tabular font-medium">{formatCurrency(l.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {g.lines.some((l) => l.carriage > 0) && (
              <p className="mt-2 text-xs text-ink-6">
                Includes {formatCurrency(g.lines.reduce((t, l) => t + l.carriage, 0))} of freight and handling,
                which is part of what the material cost to have on site.
              </p>
            )}
            {g.rejectedValue > 0 && (
              <p className="mt-2 flex items-center gap-2 text-xs text-amber-600">
                <Undo2 size={13} /> {formatCurrency(g.rejectedValue)} returned to suppliers and claimable.
              </p>
            )}
          </Card>
        ))
      )}
    </div>
  )
}

// ── Prices ──────────────────────────────────────────────────────────────────
function Prices({ data }) {
  const list = useMemo(
    () => priceList(data.items, data.movements, data.quotes),
    [data],
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Materials priced" value={`${list.count - list.unpriced}/${list.count}`} />
        <Stat label="Quoted for" value={String(list.quoted)} />
        <Stat label="Cheaper available" value={String(list.cheaperAvailable)} tone={list.cheaperAvailable ? 'warn' : undefined} />
        <Stat label="Never priced" value={String(list.unpriced)} />
      </div>

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
                    <td className={cx('text-end tabular', (r.driftPercent || 0) > 0 ? 'text-amber-600' : 'text-ink-4')}>
                      {r.driftPercent === null ? '—' : `${r.driftPercent > 0 ? '+' : ''}${r.driftPercent}%`}
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
                        <span className="mt-1 flex items-center gap-1 text-[0.7rem] font-semibold text-emerald-600">
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

// ── Quotations ──────────────────────────────────────────────────────────────
const STATE_COLOURS = { sent: '#d97706', accepted: '#059669', declined: '#64748b', expired: '#dc2626', draft: '#64748b' }

function Quotations({ data, eid, actor, canWrite, bump, toast }) {
  const blankLine = () => ({ key: Math.random().toString(36).slice(2), itemId: '', qty: '', rate: '', gstPercent: DEFAULT_GST })
  const [form, setForm] = useState({ vendor: '', contact: '', date: today(), validUntil: '', ref: '', lines: [blankLine()] })
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
    setForm({ vendor: '', contact: '', date: today(), validUntil: '', ref: '', lines: [blankLine()] })
    bump()
    toast('Quotation saved')
  }

  // Accepting is a decision, not a delivery. Booking the stock here would put
  // 100 bags of cement on the shelf the moment somebody agreed a price, and the
  // stores would be wrong until the lorry turned up — or for ever, if it never
  // did. So accepting only records the decision.
  const accept = (quote) => { store.quotes.update(quote.id, { status: 'accepted' }); bump(); toast('Quotation accepted') }

  // The delivery, when it arrives, at the rate that was agreed — so nobody
  // re-keys the rate and nobody re-keys it wrong. Stamped once, because
  // pressing this twice would double the stock and there is no sign on the
  // shelf that it happened.
  const receive = (quote) => {
    if (quote.received_at) return
    for (const r of receiptsFromQuote(quote, { entityId: eid })) {
      store.movements.add(makeMovement({ ...r, createdBy: actor?.id }), actor)
    }
    store.quotes.update(quote.id, { received_at: new Date().toISOString() })
    bump()
    toast('Delivery recorded at the quoted rate')
  }

  const decline = (quote) => { store.quotes.update(quote.id, { status: 'declined' }); bump(); toast('Quotation declined') }
  const remove = (quote) => { store.quotes.remove(quote.id); bump(); toast('Quotation deleted') }

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
                <p className="mt-2 flex items-center gap-2 text-xs text-amber-600">
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

// ── Usage ───────────────────────────────────────────────────────────────────
function Usage({ data, eid, actor, canWrite, bump, toast }) {
  const [site, setSite] = useState({ name: '', client: '', status: 'active' })
  const [filter, setFilter] = useState({ kind: '', projectId: '' })

  const usage = useMemo(
    () => usageBySite(data.items, data.movements, { projects: data.projects }),
    [data],
  )
  const log = useMemo(
    () => movementLog(data.items, data.movements, {
      kind: filter.kind || null,
      projectId: filter.projectId || null,
      limit: 100,
    }),
    [data, filter],
  )
  const siteName = (id) => data.projects.find((p) => p.id === id)?.name || 'Not booked to a site'

  const addSite = (e) => {
    e.preventDefault()
    if (!site.name.trim()) return
    store.projects.add(makeProject({ entityId: eid, ...site }), actor)
    setSite({ name: '', client: '', status: 'active' })
    bump()
    toast('Site added')
  }

  return (
    <div className="space-y-4">
      {canWrite && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-ink-3">Sites</h3>
          <p className="mt-1 text-xs text-ink-5">
            Material is booked to a site when it is issued. A company that knows what it consumed but not which job
            consumed it knows nothing useful.
          </p>
          <form onSubmit={addSite} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-4">
            <Field label="Site" required className="sm:col-span-2">
              <Input aria-label="Site name" value={site.name} onChange={(e) => setSite({ ...site, name: e.target.value })} placeholder="Marine Drive Tower" />
            </Field>
            <Field label="Client">
              <Input aria-label="Site client" value={site.client} onChange={(e) => setSite({ ...site, client: e.target.value })} />
            </Field>
            <Field label="Status">
              <Select value={site.status} onChange={(e) => setSite({ ...site, status: e.target.value })} aria-label="Site status">
                {PROJECT_STATUS_IDS.map((id) => <option key={id} value={id}>{PROJECT_STATUS[id].label}</option>)}
              </Select>
            </Field>
            <div className="sm:col-span-4"><Button type="submit"><Plus size={16} /> Add site</Button></div>
          </form>
          {data.projects.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2">
              {data.projects.map((p) => (
                <li key={p.id} className="rounded-full border border-line px-3 py-1 text-xs text-ink-4">
                  {p.name} <span className="text-ink-6">· {PROJECT_STATUS[p.status]?.label || p.status}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card className="p-5">
        <h3 className="text-sm font-semibold text-ink-3">What each site consumed</h3>
        <p className="mt-1 text-xs text-ink-5">
          Issued and wasted material only. A rejection went back to the supplier and is charged to nobody.
        </p>
        {usage.length === 0 ? (
          <p className="mt-3 text-sm text-ink-5">Nothing has been issued yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-5">
                <tr>
                  <th className="py-2 text-start">Site</th>
                  <th className="text-end">Materials</th>
                  <th className="text-end">Issued</th>
                  <th className="text-end">Wasted</th>
                  <th className="text-end">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {usage.map((u) => (
                  <tr key={u.projectId || 'none'}>
                    <td className={cx('py-2', u.projectId ? 'text-ink-2' : 'text-amber-600')}>
                      {u.project?.name || siteName(u.projectId)}
                    </td>
                    <td className="text-end tabular text-ink-4">{u.items}</td>
                    <td className="text-end tabular text-ink-4">{u.issued}</td>
                    <td className="text-end tabular text-ink-4">
                      {u.wasted}{u.wastedValue > 0 ? ` · ${formatCurrency(u.wastedValue)}` : ''}
                    </td>
                    <td className="text-end tabular font-medium">{formatCurrency(u.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-ink-3">Movement log</h3>
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Filter by movement" value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value })}>
              <option value="">Everything</option>
              {MOVEMENT_KIND_IDS.map((id) => <option key={id} value={id}>{MOVEMENT_KINDS[id].label}</option>)}
            </Select>
            {data.projects.length > 0 && (
              <Select aria-label="Filter by site" value={filter.projectId} onChange={(e) => setFilter({ ...filter, projectId: e.target.value })}>
                <option value="">Every site</option>
                {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            )}
          </div>
        </div>
        {log.length === 0 ? (
          <p className="mt-3 text-sm text-ink-5">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line-soft">
            {log.map((l) => (
              <li key={l.movement.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 text-ink-2">
                  <span className="text-ink-5">{l.movement.date}</span>{' '}
                  {l.kind.label} · {l.item?.name || 'Unknown material'}
                  {l.movement.reason && <span className="block text-xs text-amber-600">{l.movement.reason}</span>}
                  {l.movement.project_id && (
                    <span className="block text-xs text-ink-6">{siteName(l.movement.project_id)}</span>
                  )}
                </span>
                <span className="tabular text-ink-4">
                  {l.movement.qty} {l.item?.unit || ''}
                  {l.value > 0 && <span className="ms-2 text-ink-3">{formatCurrency(l.value)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <Card className="p-4">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[1.5px] text-ink-5">{label}</p>
      <p className={cx('mt-1 text-xl font-semibold tabular', tone === 'warn' ? 'text-amber-600' : 'text-ink-1')}>{value}</p>
    </Card>
  )
}
