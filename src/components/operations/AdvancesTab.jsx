// Money paid out before the work or the goods arrived, and the bills it is
// later set against.
//
// Lifted out of `Operations.jsx`, which had grown to fifteen hundred lines
// holding three unrelated screens. Nothing here changed in the move.
import { useMemo, useState } from 'react'
import { Plus, Check } from 'lucide-react'
import * as store from '../../lib/storage/corporate'
import {
  makeAdvance, makeAdjustment, outstandingAdvances, advancesByParty, balanceOf,
  canAdjust, canAmend, canRemove, canReadjust, ADVANCE_PARTIES,
} from '../../lib/advances'
import { formatCurrency, formatDate } from '../../lib/format'
import { Card, Button, Field, Input, Select, Badge, attempt } from '../ui'
import Stat from './Stat'
import { todayISO } from '../../lib/today'

export default function Advances({ data, eid, actor, canWrite, bump, toast, gate }) {
  const [form, setForm] = useState({ party: '', partyType: 'vendor', amount: '', purpose: '', expectedBy: '' })
  const [settle, setSettle] = useState({ advanceId: '', amount: '', note: '' })
  // What is open for correction. Advances and the adjustments against them are
  // separate things to fix and the wrong one is usually the adjustment.
  const [editing, setEditing] = useState(null)
  const [draft, setDraft] = useState({})
  const out = useMemo(() => outstandingAdvances(data.advances, data.adjustments, { entityId: eid }), [data, eid])
  const byParty = useMemo(() => advancesByParty(data.advances, data.adjustments, { entityId: eid }), [data, eid])

  const add = (e) => {
    e.preventDefault()
    if (!form.party.trim() || !Number(form.amount)) return
    const row = makeAdvance({ entityId: eid, ...form, amount: Number(form.amount), date: todayISO(), createdBy: actor?.id })
    if (!attempt(() => store.advances.add({ ...row, ...gate(row, 'advance') }, actor), toast)) return
    setForm({ party: '', partyType: 'vendor', amount: '', purpose: '', expectedBy: '' })
    bump()
    toast('Advance recorded')
  }
  const adjust = (e) => {
    e.preventDefault()
    const advance = data.advances.find((a) => a.id === settle.advanceId)
    const amount = Number(settle.amount)
    if (!advance || !amount) return
    // An adjustment cannot take out more than was ever paid in. Saying so beats
    // letting the balance go negative and calling it a bookkeeping error later.
    const check = canAdjust(advance, data.adjustments, amount)
    if (!check.ok) {
      toast(check.why, { type: 'error' })
      return
    }
    if (!attempt(() => store.adjustments.add(makeAdjustment({ entityId: eid, advanceId: advance.id, amount, note: settle.note, date: todayISO() }), actor), toast)) return
    setSettle({ advanceId: '', amount: '', note: '' })
    bump()
    toast('Adjusted')
  }

  // Every advance, not the party totals. An advance entered twice, or for the
  // wrong amount, was invisible under a total and could not be touched.
  const ledger = useMemo(() => data.advances
    .filter((a) => !a.deleted_at && (!eid || a.entity_id === eid))
    .map((a) => ({
      ...balanceOf(a, data.adjustments),
      against: data.adjustments.filter((j) => j.advance_id === a.id && !j.deleted_at)
        .sort((x, y) => String(x.date).localeCompare(String(y.date))),
    }))
    .sort((x, y) => String(y.advance.date).localeCompare(String(x.advance.date))),
  [data.advances, data.adjustments, eid])

  const editAdvance = (a) => {
    setEditing(`a:${a.id}`)
    setDraft({ party: a.party || '', partyType: a.party_type || 'vendor', amount: a.amount ?? '',
      purpose: a.purpose || '', expectedBy: a.expected_by || '', date: a.date || '' })
  }
  const saveAdvance = (a) => {
    // The mirror of the guard on the way in: correcting an advance below what
    // has already been set against it makes a balance nobody can explain.
    const check = canAmend(a, data.adjustments, Number(draft.amount))
    if (!check.ok) return toast(check.why, { type: 'error' })
    if (!draft.party.trim()) return toast('Say who it was paid to.', { type: 'error' })
    const { id: _id, entity_id: _e, created_at: _c, created_by: _b, ...patch } = makeAdvance({
      entityId: eid, party: draft.party, partyType: draft.partyType, amount: Number(draft.amount),
      purpose: draft.purpose, expectedBy: draft.expectedBy, date: draft.date || a.date,
    })
    if (!attempt(() => store.advances.update(a.id, patch, actor), toast)) return
    setEditing(null); bump(); toast('Advance corrected')
  }
  const dropAdvance = (a) => {
    const check = canRemove(a, data.adjustments)
    if (!check.ok) return toast(check.why, { type: 'error' })
    if (!window.confirm(`Delete the ${formatCurrency(a.amount)} advance to ${a.party}?`)) return
    if (!attempt(() => store.advances.remove(a.id, actor), toast)) return
    setEditing(null); bump(); toast('Advance deleted')
  }
  const editAdjustment = (j) => {
    setEditing(`j:${j.id}`)
    setDraft({ amount: j.amount ?? '', note: j.note || '', date: j.date || '' })
  }
  const saveAdjustment = (advance, j) => {
    // Checked against the advance without counting itself, or raising ₹5,000 to
    // ₹6,000 is refused as though ₹11,000 were being taken out.
    const check = canReadjust(advance, data.adjustments, j.id, Number(draft.amount))
    if (!check.ok) return toast(check.why, { type: 'error' })
    const { id: _id, entity_id: _e, created_at: _c, ...patch } = makeAdjustment({
      entityId: eid, advanceId: advance.id, amount: Number(draft.amount), note: draft.note, date: draft.date || j.date,
    })
    if (!attempt(() => store.adjustments.update(j.id, patch, actor), toast)) return
    setEditing(null); bump(); toast('Adjustment corrected')
  }
  const dropAdjustment = (j) => {
    // Always safe: undoing a recovery puts the money back as outstanding, which
    // is exactly what somebody who set one against the wrong bill wants.
    if (!window.confirm(`Undo the ${formatCurrency(j.amount)} set against this advance?`)) return
    if (!attempt(() => store.adjustments.remove(j.id, actor), toast)) return
    setEditing(null); bump(); toast('Adjustment undone')
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Outstanding" value={formatCurrency(out.total)} />
        <Stat label="Overdue" value={formatCurrency(out.overdueTotal)} tone={out.overdueTotal ? 'warn' : undefined} />
        <Stat label="Open advances" value={String(out.count)} />
      </div>

      {canWrite && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink-3">Pay an advance</h2>
            <p className="mt-1 text-xs text-ink-5">
              An advance is money owed back to the company, not a cost. It becomes a cost when the bill arrives and is set against it.
            </p>
            <form onSubmit={add} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <Field label="Paid to" required>
                <Input value={form.party} onChange={(e) => setForm({ ...form, party: e.target.value })} placeholder="Ravi Contractors" />
              </Field>
              <Field label="Who they are">
                <Select value={form.partyType} onChange={(e) => setForm({ ...form, partyType: e.target.value })}>
                  {Object.values(ADVANCE_PARTIES).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
              </Field>
              <Field label="Amount" required>
                <Input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
              </Field>
              <Field label="Expected back by" hint="What makes it chaseable.">
                <Input type="date" value={form.expectedBy} onChange={(e) => setForm({ ...form, expectedBy: e.target.value })} />
              </Field>
              <Field className="sm:col-span-2" label="What for">
                <Input value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} />
              </Field>
              <div className="sm:col-span-2"><Button type="submit"><Plus size={16} /> Record advance</Button></div>
            </form>
          </Card>

          <Card className="p-5">
            <h2 className="text-sm font-semibold text-ink-3">Set one against a bill</h2>
            <form onSubmit={adjust} className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
              <Field className="sm:col-span-2" label="Advance" required>
                <Select value={settle.advanceId} onChange={(e) => setSettle({ ...settle, advanceId: e.target.value })}>
                  <option value="">Choose…</option>
                  {out.lines.map((l) => (
                    <option key={l.advance.id} value={l.advance.id}>
                      {l.advance.party} — {formatCurrency(l.outstanding)} left
                    </option>
                  ))}
                </Select>
              </Field>
              <Field className="sm:col-span-2" label="Amount used" required>
                <Input type="number" step="0.01" min="0" value={settle.amount} onChange={(e) => setSettle({ ...settle, amount: e.target.value })} />
              </Field>
              <Field className="sm:col-span-2" label="Note">
                <Input value={settle.note} onChange={(e) => setSettle({ ...settle, note: e.target.value })} placeholder="Invoice 114" />
              </Field>
              <div className="sm:col-span-2"><Button type="submit" disabled={!settle.advanceId}><Check size={16} /> Adjust</Button></div>
            </form>
          </Card>
        </div>
      )}

      {/* Every advance, and every adjustment under it. Before this the only
          list was the party totals below, so an advance entered twice or for
          the wrong amount was invisible — and an adjustment set against the
          wrong bill could never be undone at all. */}
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink-3">Every advance</h2>
        <p className="mt-1 text-xs text-ink-5">
          What was paid out, and what has been set against each one. Correcting an advance below what is already set
          against it is refused — undo the adjustment first.
        </p>
        {ledger.length === 0 ? (
          <p className="mt-3 text-sm text-ink-5">Nothing paid out yet.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line-soft">
            {ledger.map(({ advance: a, used, outstanding, settled, overAdjusted, against }) => (
              <li key={a.id} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
                      {a.party}
                      <span className="text-xs text-ink-6">{ADVANCE_PARTIES[a.party_type]?.label}</span>
                      {settled && <Badge color="#059669">settled</Badge>}
                      {overAdjusted && <Badge color="#dc2626">over-adjusted</Badge>}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-5">
                      {formatCurrency(a.amount)} on {formatDate(a.date)}
                      {used > 0 ? ` · ${formatCurrency(used)} set against it` : ''}
                      {a.expected_by ? ` · back by ${formatDate(a.expected_by)}` : ''}
                      {a.purpose ? ` · ${a.purpose}` : ''}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="tabular text-sm font-medium">{formatCurrency(outstanding)} left</span>
                    {canWrite && (
                      <>
                        <Button variant="ghost" aria-label={`Edit advance to ${a.party}`}
                          onClick={() => (editing === `a:${a.id}` ? setEditing(null) : editAdvance(a))}>
                          {editing === `a:${a.id}` ? 'Close' : 'Edit'}
                        </Button>
                        {/* Offered only where it is allowed, and refused with a
                            reason where it is not — a disabled button nobody can
                            explain is its own kind of unhelpful. */}
                        <Button variant="ghost" aria-label={`Delete advance to ${a.party}`} onClick={() => dropAdvance(a)}>
                          Delete
                        </Button>
                      </>
                    )}
                  </span>
                </div>

                {canWrite && editing === `a:${a.id}` && (
                  // Named, so the fields in here can be told apart from the
                  // identically-labelled ones on the form above. Reaching for
                  // "the first Paid to on the page" finds the add form.
                  <div className="mt-3 rounded-xl border border-line-soft p-3" role="group"
                    aria-label={`Editing advance to ${a.party}`}>
                    <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
                      <Field label="Paid to" required>
                        <Input value={draft.party} onChange={(e) => setDraft({ ...draft, party: e.target.value })} />
                      </Field>
                      <Field label="Who they are">
                        <Select value={draft.partyType} onChange={(e) => setDraft({ ...draft, partyType: e.target.value })}>
                          {Object.values(ADVANCE_PARTIES).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </Select>
                      </Field>
                      <Field label="Amount" required hint={used > 0 ? `${formatCurrency(used)} is already set against it.` : ''}>
                        <Input type="number" step="0.01" min="0" value={draft.amount}
                          onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
                      </Field>
                      <Field label="Paid on">
                        <Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
                      </Field>
                      <Field label="Expected back by">
                        <Input type="date" value={draft.expectedBy} onChange={(e) => setDraft({ ...draft, expectedBy: e.target.value })} />
                      </Field>
                      <Field label="What for">
                        <Input value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value })} />
                      </Field>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button onClick={() => saveAdvance(a)}><Check size={16} /> Save</Button>
                      <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                    </div>
                  </div>
                )}

                {against.length > 0 && (
                  <ul className="mt-2 space-y-1 ps-3">
                    {against.map((j) => (
                      <li key={j.id} className="border-s border-line-soft ps-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-xs text-ink-5">
                          <span>
                            {formatCurrency(j.amount)} on {formatDate(j.date)}
                            {j.note ? ` — ${j.note}` : ''}
                          </span>
                          {canWrite && (
                            <span className="flex shrink-0 gap-2">
                              <button type="button" className="text-ink-5 underline-offset-2 hover:text-ink-2 hover:underline"
                                aria-label={`Edit ${formatCurrency(j.amount)} against ${a.party}`}
                                onClick={() => (editing === `j:${j.id}` ? setEditing(null) : editAdjustment(j))}>
                                {editing === `j:${j.id}` ? 'Close' : 'Edit'}
                              </button>
                              <button type="button" className="text-ink-5 underline-offset-2 hover:text-ink-2 hover:underline"
                                aria-label={`Undo ${formatCurrency(j.amount)} against ${a.party}`}
                                onClick={() => dropAdjustment(j)}>
                                Undo
                              </button>
                            </span>
                          )}
                        </div>
                        {canWrite && editing === `j:${j.id}` && (
                          <div className="my-2 rounded-xl border border-line-soft p-3" role="group"
                            aria-label={`Editing adjustment against ${a.party}`}>
                            <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
                              <Field label="Amount used" required>
                                <Input type="number" step="0.01" min="0" value={draft.amount}
                                  onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
                              </Field>
                              <Field label="On">
                                <Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
                              </Field>
                              <Field label="Note">
                                <Input value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
                              </Field>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Button onClick={() => saveAdjustment(a, j)}><Check size={16} /> Save</Button>
                              <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-ink-3">Who is holding the company’s money</h2>
        {byParty.length === 0 ? (
          <p className="mt-3 text-sm text-ink-5">Nothing outstanding.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line-soft">
            {byParty.map((p) => (
              <li key={`${p.partyType}:${p.party}`} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="text-ink-2">{p.party}</span>
                  <span className="ms-2 text-xs text-ink-6">{ADVANCE_PARTIES[p.partyType]?.label}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {p.overdue && <Badge color="#dc2626">overdue</Badge>}
                  <span className="tabular font-medium">{formatCurrency(p.outstanding)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

// ── Payroll ─────────────────────────────────────────────────────────────────
