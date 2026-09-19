import { useMemo, useState } from 'react'
import {
  Boxes, IndianRupee, FileText, HardHat, Plus, AlertTriangle, Printer,
  TrendingDown, TrendingUp, Undo2, Trash2, ClipboardCheck,
} from 'lucide-react'
import * as store from '../lib/storage/corporate'
import {
  makeItem, makeMovement, stockReport, reorderList, usageBySite, movementLog,
  UNITS, MOVEMENT_KINDS, MOVEMENT_KIND_IDS, CENTRAL,
  canAmendItem, canRemoveItem, stockAfter,
} from '../lib/inventory'
import {
  MATERIAL_CATEGORIES, MATERIAL_CATEGORY_IDS, CATALOGUE,
  catalogueFor, fromCatalogue, unitFor, byCategory, categoryOf,
} from '../lib/materials'
import {
  makeQuote, makeQuoteLine, quoteTotals, quoteState, quoteBook, compareQuotes,
  priceList, receiptsFromQuote, GST_RATES, DEFAULT_GST, QUOTE_STATE_LABELS,
} from '../lib/quotes'

import { stockStatement, materialIndent } from '../lib/siteDocs'
import { documentToPDF } from '../lib/siteDocsPdf'
import { materialVariance } from '../lib/rates'
import { countSheet, makeStockCount, sheetResult, adjustmentsFrom, shrinkage } from '../lib/stockcount'
import { formatCurrency } from '../lib/format'
import { Card, Button, Field, Input, Select, Badge, EmptyState, cx, attempt } from './ui'

// Materials, for a company that builds things.
//
// Four questions, in the order somebody on a site asks them: what have we got,
// what does it cost, who will sell it cheaper, and which job burned it. They
// are sub-tabs rather than four more entries in the side bar because they are
// one job — running the stores — and because splitting them would mean four
// screens each showing a quarter of the same table.
// Five, since a stores ledger that has never been checked against a shelf is
// a ledger of claims. Counting is the only one of these that involves leaving
// the office.
const VIEWS = [
  { id: 'stock', label: 'Inventory', icon: Boxes },
  { id: 'count', label: 'Verify', icon: ClipboardCheck },
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
      {view === 'count' && <Verify {...shared} />}
      {view === 'prices' && <Prices {...shared} />}
      {view === 'quotes' && <Quotations {...shared} />}
      {view === 'usage' && <Usage {...shared} />}
    </div>
  )
}

// ── Inventory ───────────────────────────────────────────────────────────────
function Inventory({ data, eid, actor, canWrite, bump, toast, company }) {
  // Nothing here could be touched once entered. A receipt booked at the wrong
  // rate is worse than a wrong figure elsewhere, because stock is valued at a
  // moving average: one bad rate quietly reprices every issue after it.
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState({})
  // The yard has no row of its own anywhere, so it needs a name here.
  const storeName = (id) => (id ? data.projects.find((p) => p.id === id)?.name || 'Unknown site' : 'Central store')
  const blank = { category: 'cement', name: '', brand: '', spec: '', sku: '', unit: 'bag', reorderLevel: '' }
  const [form, setForm] = useState(blank)
  const [move, setMove] = useState({
    itemId: '', kind: 'receipt', qty: '', unitCost: '', otherCost: '',
    vendor: '', storeId: '', toStoreId: '', projectId: '', reason: '', note: '',
  })

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

  const startItem = (i) => {
    setEditing(`i:${i.id}`)
    setDraft({ name: i.name || '', brand: i.brand || '', spec: i.spec || '', sku: i.sku || '',
      unit: i.unit || 'nos', reorderLevel: i.reorder_level ?? '' })
  }
  const saveItem = (i) => {
    if (!draft.name.trim()) return toast('Give it a name.', { type: 'error' })
    // The unit is the one field that cannot move once anything has: a hundred
    // bags that become a hundred kilos are still a hundred, and every quantity
    // in the history silently changes meaning.
    const check = canAmendItem(i, data.movements, { unit: draft.unit })
    if (!check.ok) return toast(check.why, { type: 'error' })
    const { id: _i, entity_id: _e, created_at: _c, ...patch } = makeItem({
      entityId: eid, ...draft, hsn: i.hsn || '', reorderLevel: num(draft.reorderLevel),
    })
    if (!attempt(() => store.items.update(i.id, patch, actor), toast)) return
    setEditing(null); bump(); toast('Material updated')
  }
  const dropItem = (i) => {
    const check = canRemoveItem(i, data.movements)
    if (!check.ok) return toast(check.why, { type: 'error' })
    if (!window.confirm(`Delete ${i.name}?`)) return
    if (!attempt(() => store.items.remove(i.id, actor), toast)) return
    setEditing(null); bump(); toast('Material deleted')
  }

  const addMovement = (e) => {
    e.preventDefault()
    if (!move.itemId || !num(move.qty)) return
    if (!attempt(() => store.movements.add(makeMovement({
      entityId: eid, itemId: move.itemId, kind: move.kind,
      qty: num(move.qty), unitCost: num(move.unitCost), otherCost: num(move.otherCost),
      vendor: move.vendor, storeId: move.storeId || null, toStoreId: move.toStoreId || null,
      // An issue from a store on a site is charged to that site unless somebody
      // says otherwise, because that is what it almost always means. Issuing
      // out of the yard says nothing about who pays, so it has to be asked.
      projectId: move.projectId || (move.kind !== 'transfer' ? move.storeId || null : null),
      reason: move.reason, note: move.note,
      date: today(), createdBy: actor?.id,
    }), actor), toast)) return
    setMove({
      itemId: '', kind: move.kind, qty: '', unitCost: '', otherCost: '', vendor: '',
      // The store stays: a stores clerk enters a run of movements at one place.
      storeId: move.storeId, toStoreId: '', projectId: '', reason: '', note: '',
    })
    bump()
    toast(move.kind === 'rejected' ? 'Rejection recorded' : 'Movement recorded')
  }

  return (
    <div className="space-y-4">
      {/* Carried round a yard with a pen, and handed to a supplier. Neither is
          a screenshot of a table. */}
      {data.items.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            aria-label="Print stock statement"
            onClick={async () => {
              try {
                await documentToPDF(stockStatement(data.items, data.movements, { company, storeName }))
              } catch (e) { toast(e?.message || String(e)) }
            }}
          >
            <Printer size={14} /> Stock statement
          </Button>
          {low.length > 0 && (
            <Button
              variant="ghost"
              aria-label="Print material indent"
              onClick={async () => {
                try {
                  await documentToPDF(materialIndent(data.items, data.movements, { company }))
                } catch (e) { toast(e?.message || String(e)) }
              }}
            >
              <Printer size={14} /> Indent
            </Button>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Materials" value={String(data.items.length)} />
        {/* The company total, and the two halves it is made of. A builder who
            knows only the total will buy again for a site that already has it. */}
        <Stat label="Stock value" value={formatCurrency(report.totalValue)} />
        <Stat label="In the yard" value={formatCurrency(report.centralValue)} />
        <Stat label="Out on sites" value={formatCurrency(report.onSitesValue)} />
        <Stat label="Below reorder" value={String(report.itemsBelowReorder)} tone={report.itemsBelowReorder ? 'warn' : undefined} />
        {/* Not part of the stock value: this is money a supplier owes back, not
            an asset on the shelf, and adding the two would inflate both. */}
        <Stat
          label="Rejected — claimable"
          value={formatCurrency(report.rejectedValue)}
          tone={report.rejectedValue > 0 ? 'warn' : undefined}
        />
      </div>

      {report.byLocation.filter((l) => l.value !== 0 || l.items > 0).length > 1 && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-ink-3">Where the stock is</h3>
          <p className="mt-1 text-xs text-ink-5">
            The yard and every site store. A company holding forty tonnes of steel and not knowing which site has it
            is a company that will buy forty more.
          </p>
          <ul className="mt-3 divide-y divide-line-soft">
            {report.byLocation.filter((l) => l.value !== 0 || l.items > 0).map((l) => (
              <li key={l.locationId || 'central'} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <span className={cx('min-w-0 truncate', l.locationId ? 'text-ink-2' : 'font-medium text-ink-1')}>
                  {storeName(l.locationId)}
                  {l.negative > 0 && <span className="ms-2"><Badge color="#dc2626">{l.negative} short</Badge></span>}
                </span>
                <span className="tabular text-ink-4">
                  {l.items} {l.items === 1 ? 'material' : 'materials'} ·{' '}
                  <span className="font-medium text-ink-2">{formatCurrency(l.value)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

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
              supplier — it is a credit they owe, not a cost of the job. A transfer only changes which store holds
              it; the company gains nothing.
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
              <Field
                label={move.kind === 'transfer' ? 'Out of' : 'Store'}
                hint={move.kind === 'receipt' ? 'Where the lorry unloaded.' : undefined}
              >
                <Select aria-label="Store" value={move.storeId} onChange={(e) => setMove({ ...move, storeId: e.target.value })}>
                  <option value={CENTRAL}>Central store</option>
                  {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              {move.kind === 'transfer' && (
                <Field label="Into" hint="The company gains nothing; it only changes shelf.">
                  <Select aria-label="Into store" value={move.toStoreId} onChange={(e) => setMove({ ...move, toStoreId: e.target.value })}>
                    <option value={CENTRAL}>Central store</option>
                    {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </Field>
              )}
              {/* Where it physically is and who pays for it are different
                  questions, and they only differ when material goes straight
                  out of the yard to a job — so the second is asked only then. */}
              {data.projects.length > 0 && kind.direction === 'out' && !move.storeId && (
                <Field className="sm:col-span-2" label="Charge to site" hint="Material with no site is material no job is charged for.">
                  <Select value={move.projectId} onChange={(e) => setMove({ ...move, projectId: e.target.value })} aria-label="Site">
                    <option value="">Not booked to a site</option>
                    {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                </Field>
              )}
              <div className="sm:col-span-2">
                <Button type="submit" disabled={!move.itemId || (move.kind === 'transfer' && move.toStoreId === move.storeId)}>
                  <Plus size={16} /> Record
                </Button>
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
                        {/* Beside the name rather than in a column of its own:
                            a ninth column pushed this table past what its
                            scroll container was absorbing and the page itself
                            started scrolling sideways on a phone. */}
                        {canWrite && (
                          <button type="button" aria-label={`Edit ${l.item.name}`}
                            className="ms-2 text-xs text-ink-5 underline-offset-2 hover:text-ink-2 hover:underline"
                            onClick={() => (editing === `i:${l.item.id}` ? setEditing(null) : startItem(l.item))}>
                            {editing === `i:${l.item.id}` ? 'Close' : 'Edit'}
                          </button>
                        )}
                      </td>
                      <td className="text-end tabular text-ink-4">{l.received}</td>
                      <td className="text-end tabular text-ink-4">{l.issued}</td>
                      <td className={cx('text-end tabular', l.wastagePercent > 10 ? 'text-amber-600' : 'text-ink-4')}>
                        {l.wasted}{l.wastagePercent !== null && l.wasted > 0 ? ` (${l.wastagePercent}%)` : ''}
                      </td>
                      <td className={cx('text-end tabular', l.rejected > 0 ? 'text-amber-600' : 'text-ink-4')}>
                        {l.rejected}{l.rejectionPercent !== null && l.rejected > 0 ? ` (${l.rejectionPercent}%)` : ''}
                      </td>
                      <td className="text-end tabular text-ink-2">
                        {l.qty} {l.item.unit}
                        {l.sites > 0 && (
                          <span className="block text-[0.7rem] font-normal text-ink-6">
                            {l.central.qty} in the yard · {l.onSites} on {l.sites} {l.sites === 1 ? 'site' : 'sites'}
                          </span>
                        )}
                      </td>
                      <td className="text-end tabular text-ink-4">{formatCurrency(l.avgCost)}</td>
                      <td className="text-end tabular font-medium">{formatCurrency(l.value)}</td>
                    </tr>
                  ))}
                  {/* The edit sits in the table so it appears under the row it
                      belongs to, rather than in a dialog that hides the figures
                      somebody is correcting against. */}
                  {canWrite && g.lines.filter((l) => editing === `i:${l.item.id}`).map((l) => (
                    <tr key={`${l.item.id}-edit`}>
                      <td colSpan={8} className="py-3">
                        <div className="rounded-xl border border-line-soft p-3" role="group" aria-label={`Editing ${l.item.name}`}>
                          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
                            <Field label="Material" required>
                              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                            </Field>
                            <Field label="Brand"><Input value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} /></Field>
                            <Field label="Grade / size"><Input value={draft.spec} onChange={(e) => setDraft({ ...draft, spec: e.target.value })} /></Field>
                            <Field label="SKU"><Input value={draft.sku} onChange={(e) => setDraft({ ...draft, sku: e.target.value })} /></Field>
                            {/* Fixed once anything has moved, and the hint says
                                so rather than leaving somebody to discover it
                                from a refusal. */}
                            <Field label="Unit" hint={l.received > 0 || l.issued > 0 ? 'Fixed — this has already moved in this unit.' : ''}>
                              <Select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })}>
                                {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                              </Select>
                            </Field>
                            <Field label="Reorder level" hint="Zero means never warn.">
                              <Input type="number" min="0" value={draft.reorderLevel}
                                onChange={(e) => setDraft({ ...draft, reorderLevel: e.target.value })} />
                            </Field>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button onClick={() => saveItem(l.item)}>Save</Button>
                            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                            <Button variant="ghost" aria-label={`Delete ${l.item.name}`} onClick={() => dropItem(l.item)}>
                              <Trash2 size={15} /> Delete
                            </Button>
                          </div>
                        </div>
                      </td>
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

// ── Verify ──────────────────────────────────────────────────────────────────
// The only screen in this app that asks somebody to leave the office.
//
// Every balance in the stores ledger is what the paperwork believes. A count is
// the one row that somebody stood in a godown to produce, so it is stored as
// evidence in its own right — including the counts that found nothing, which
// are what proves a store sound — and the adjustment it justifies is posted
// through the same movement ledger as everything else.
function Verify({ data, eid, actor, canWrite, bump, toast }) {
  const [storeId, setStoreId] = useState('')
  const [date, setDate] = useState(today())
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
            <AlertTriangle size={16} className="text-amber-600" />
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
                            diff === null ? 'text-ink-6' : diff < 0 ? 'text-red-600' : diff > 0 ? 'text-amber-600' : 'text-emerald-600')}>
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
                <span className={cx('tabular font-semibold', sh.shortValue > 0 ? 'text-red-600' : 'text-emerald-600')}>
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

// ── Prices ──────────────────────────────────────────────────────────────────
function Prices({ data }) {
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
            <TrendingUp size={16} className="text-amber-600" />
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
                <span className="tabular font-semibold text-amber-600">
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
                    <td className={cx('text-end tabular', (r.driftPercent || 0) > 0 ? 'text-amber-600' : 'text-ink-4')}>
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
                        <span className="block text-[0.7rem] font-semibold text-amber-600">
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
  const [filter, setFilter] = useState({ kind: '', projectId: '' })
  // A movement entered wrong was permanent, and a wrong receipt rate is the
  // worst of them: stock is valued at a moving average, so one bad rate quietly
  // reprices every issue after it and every job cost that follows.
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState({})
  const num = (v) => Number(v) || 0

  const startMovement = (m) => {
    setEditing(m.id)
    setDraft({ qty: m.qty ?? '', unitCost: m.unit_cost ?? '', otherCost: m.other_cost ?? '',
      vendor: m.vendor || '', reason: m.reason || '', note: m.note || '', date: m.date || '' })
  }
  const saveMovement = (m) => {
    const item = data.items.find((i) => i.id === m.item_id)
    const next = makeMovement({
      entityId: eid, itemId: m.item_id, kind: m.kind,
      qty: num(draft.qty), unitCost: num(draft.unitCost), otherCost: num(draft.otherCost),
      vendor: draft.vendor, storeId: m.store_id, toStoreId: m.to_store_id, projectId: m.project_id,
      reason: draft.reason, note: draft.note, date: draft.date || m.date, createdBy: m.created_by,
    })
    // Negative stock is not forbidden — a store that has issued more than it was
    // sent is a real thing, and the attention list says so rather than the app
    // refusing an entry and losing it. But somebody about to create one should
    // hear it before rather than after.
    const effect = stockAfter(item, data.movements, { replace: { ...next, id: m.id } })
    if (effect.newlyShort.length && !window.confirm(
      `That leaves ${effect.newlyShort.length === 1 ? 'a store' : `${effect.newlyShort.length} stores`} holding less than nothing. Record it anyway?`)) return
    const { id: _i, entity_id: _e, created_at: _c, ...patch } = next
    if (!attempt(() => store.movements.update(m.id, patch, actor), toast)) return
    setEditing(null); bump(); toast('Movement corrected')
  }
  const dropMovement = (m) => {
    const item = data.items.find((i) => i.id === m.item_id)
    const effect = stockAfter(item, data.movements, { remove: m.id })
    const warn = effect.newlyShort.length ? ' That leaves a store holding less than nothing.' : ''
    if (!window.confirm(`Delete this ${MOVEMENT_KINDS[m.kind]?.label.toLowerCase() || 'movement'} of ${m.qty}?${warn}`)) return
    if (!attempt(() => store.movements.remove(m.id, actor), toast)) return
    setEditing(null); bump(); toast('Movement deleted')
  }
  const logStore = (id) => (id ? data.projects.find((p) => p.id === id)?.name || 'Unknown site' : 'Central store')

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

  return (
    <div className="space-y-4">
      {data.projects.length === 0 && (
        <Card className="p-5">
          <EmptyStateSites canWrite={canWrite} />
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
                  <span className="block text-xs text-ink-6">
                    {l.movement.kind === 'transfer'
                      ? `${logStore(l.movement.store_id)} → ${logStore(l.movement.to_store_id)}`
                      : logStore(l.movement.store_id)}
                    {l.movement.project_id && l.movement.project_id !== l.movement.store_id &&
                      ` · charged to ${siteName(l.movement.project_id)}`}
                  </span>
                </span>
                <span className="flex items-baseline gap-3">
                  <span className="tabular text-ink-4">
                    {l.movement.qty} {l.item?.unit || ''}
                    {l.value > 0 && <span className="ms-2 text-ink-3">{formatCurrency(l.value)}</span>}
                  </span>
                  {canWrite && (
                    <button type="button" aria-label={`Edit ${l.kind.label.toLowerCase()} of ${l.movement.qty} ${l.item?.name || ''}`}
                      className="text-xs text-ink-5 underline-offset-2 hover:text-ink-2 hover:underline"
                      onClick={() => (editing === l.movement.id ? setEditing(null) : startMovement(l.movement))}>
                      {editing === l.movement.id ? 'Close' : 'Edit'}
                    </button>
                  )}
                </span>
                {canWrite && editing === l.movement.id && (
                  <div className="mt-2 w-full rounded-xl border border-line-soft p-3" role="group"
                    aria-label={`Editing ${l.kind.label.toLowerCase()} of ${l.item?.name || 'material'}`}>
                    <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
                      <Field label="Quantity" required>
                        <Input type="number" step="0.01" value={draft.qty}
                          onChange={(e) => setDraft({ ...draft, qty: e.target.value })} />
                      </Field>
                      {/* The field that poisons everything downstream when it is
                          wrong, and the reason this whole section exists. */}
                      {l.movement.kind === 'receipt' && (
                        <>
                          <Field label="Rate per unit" hint="Stock is valued at the average of these.">
                            <Input type="number" step="0.01" min="0" value={draft.unitCost}
                              onChange={(e) => setDraft({ ...draft, unitCost: e.target.value })} />
                          </Field>
                          <Field label="Freight and handling">
                            <Input type="number" step="0.01" min="0" value={draft.otherCost}
                              onChange={(e) => setDraft({ ...draft, otherCost: e.target.value })} />
                          </Field>
                          <Field label="Supplier">
                            <Input value={draft.vendor} onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} />
                          </Field>
                        </>
                      )}
                      <Field label="Date">
                        <Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
                      </Field>
                      {['wastage', 'rejected'].includes(l.movement.kind) && (
                        <Field label="Reason">
                          <Input value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} />
                        </Field>
                      )}
                      <Field label="Note">
                        <Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
                      </Field>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button onClick={() => saveMovement(l.movement)}>Save</Button>
                      <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                      <Button variant="ghost" aria-label={`Delete ${l.kind.label.toLowerCase()} of ${l.movement.qty} ${l.item?.name || ''}`}
                        onClick={() => dropMovement(l.movement)}>
                        <Trash2 size={15} /> Delete
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

// Sites are created and edited on the Projects tab. Two forms writing the same
// store is how the two quietly stop agreeing about what a site is, so this one
// points there rather than offering a second way in.
function EmptyStateSites({ canWrite }) {
  return (
    <EmptyState
      icon={HardHat}
      title="No sites yet"
      subtitle={
        canWrite
          ? 'Add one under Projects and material can be issued against it. Until then everything issued shows as booked to no site.'
          : 'Nothing has been issued against a site yet.'
      }
    />
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
