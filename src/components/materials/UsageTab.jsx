// Which job burned the material, and the log of every issue against it.
import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import * as store from '../../lib/storage/corporate'
import { makeMovement, usageBySite, movementLog, MOVEMENT_KINDS, MOVEMENT_KIND_IDS, stockAfter } from '../../lib/inventory'
import { formatCurrency } from '../../lib/format'
import { Card, Button, Field, Input, Select, cx, attempt } from '../ui'
import { num } from './shared'
import EmptyStateSites from './EmptyStateSites'

export default function Usage({ data, eid, actor, canWrite, bump, toast }) {
  const [filter, setFilter] = useState({ kind: '', projectId: '' })
  // A movement entered wrong was permanent, and a wrong receipt rate is the
  // worst of them: stock is valued at a moving average, so one bad rate quietly
  // reprices every issue after it and every job cost that follows.
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState({})

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
                    <td className={cx('py-2', u.projectId ? 'text-ink-2' : 'text-warn')}>
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
                  {l.movement.reason && <span className="block text-xs text-warn">{l.movement.reason}</span>}
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
