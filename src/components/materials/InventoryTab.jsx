// The stores ledger: what the company owns, where it is, and every movement
// in or out of it. Split out of `MaterialsTabs.jsx`, which held all five of
// these screens and imported every library any of them touched — opening the
// prices tab downloaded the PDF writer, and opening any of them downloaded the
// stock-count arithmetic.
import { useMemo, useState } from 'react'
import { Plus, AlertTriangle, Printer, Undo2, Trash2 } from 'lucide-react'
import * as store from '../../lib/storage/corporate'
import { makeItem, makeMovement, stockReport, reorderList, UNITS, MOVEMENT_KINDS, MOVEMENT_KIND_IDS, CENTRAL, canAmendItem, canRemoveItem } from '../../lib/inventory'
import { MATERIAL_CATEGORIES, MATERIAL_CATEGORY_IDS, CATALOGUE, catalogueFor, fromCatalogue, unitFor, byCategory } from '../../lib/materials'
import { stockStatement, materialIndent } from '../../lib/siteDocs'
import { documentToPDF } from '../../lib/siteDocsPdf'
import { formatCurrency } from '../../lib/format'
import { todayISO } from '../../lib/today'
import { Card, Button, Field, Input, Select, Badge, cx, attempt } from '../ui'
import Stat from '../operations/Stat'
import { num } from './shared'

export default function Inventory({ data, eid, actor, canWrite, bump, toast, company }) {
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
      date: todayISO(), createdBy: actor?.id,
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
            <AlertTriangle size={16} className="text-warn" />
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
                {g.low > 0 && <span className="ms-2 text-warn">{g.low} to reorder</span>}
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
                      <td className={cx('text-end tabular', l.wastagePercent > 10 ? 'text-warn' : 'text-ink-4')}>
                        {l.wasted}{l.wastagePercent !== null && l.wasted > 0 ? ` (${l.wastagePercent}%)` : ''}
                      </td>
                      <td className={cx('text-end tabular', l.rejected > 0 ? 'text-warn' : 'text-ink-4')}>
                        {l.rejected}{l.rejectionPercent !== null && l.rejected > 0 ? ` (${l.rejectionPercent}%)` : ''}
                      </td>
                      <td className="text-end tabular text-ink-2">
                        {l.qty} {l.item.unit}
                        {l.sites > 0 && (
                          <span className="block text-[0.6875rem] font-normal text-ink-6">
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
              <p className="mt-2 flex items-center gap-2 text-xs text-warn">
                <Undo2 size={13} /> {formatCurrency(g.rejectedValue)} returned to suppliers and claimable.
              </p>
            )}
          </Card>
        ))
      )}
    </div>
  )
}
