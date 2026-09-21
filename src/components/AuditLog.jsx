import { useEffect, useMemo, useState } from 'react'
import { ScrollText, Download, X } from 'lucide-react'
import { AUDIT_ACTIONS, auditAt, auditChanges, describeAuditEvent } from '../lib/corporate'
import { formatDate } from '../lib/format'
import { Card, Button, Select, Input, DateFilter, cx } from './ui'

// Who changed what, and what it was before.
//
// The trail has been written since the corporate layer existed: every create,
// every edit, every delete, with the actor, the action, and — for an edit —
// the fields that moved and what they moved from. The card that showed it
// rendered the actor and a phrase and stopped, so the log read "Deepak edited
// a site" forty times and settled nothing. The `detail` the store had gone to
// the trouble of computing was written and never read.
//
// This shows it, and lets you narrow it. A log you cannot filter is one you
// scroll past; the question is never "what happened" but "what did *he* do to
// *that*, and when".

// The verb at the end of every action name. Grouped rather than listed,
// because thirty nouns times four verbs is not a menu anybody reads.
const KINDS = [
  { id: '', label: 'Everything' },
  { id: 'create', label: 'Added' },
  { id: 'update', label: 'Edited' },
  { id: 'delete', label: 'Deleted' },
  { id: 'approve', label: 'Approved' },
  { id: 'reject', label: 'Refused' },
]
const verbOf = (action) => String(action || '').split('.').pop()

// The hour matters and the date alone does not: six edits to one rate on one
// afternoon are six lines with the same date, in an order you cannot see.
const timeOf = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

const PAGE = 40

// What you were looking at, kept. Somebody chasing one person's changes across
// a fortnight does not want to set the same three filters every time they come
// back to the page — and the filters are the whole point of the page. Per
// browser, like every other preference here; nothing about them is worth a row
// on a server.
const REMEMBERED = 'pl_audit_filters'
const BLANK = { who: '', kind: '', q: '', from: '', to: '' }

const recall = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(REMEMBERED) || 'null')
    // Only the keys we know: storage can hold whatever an older build wrote,
    // and spreading a stray shape into state is how a page ends up behind
    // "Something went wrong".
    return saved && typeof saved === 'object'
      ? Object.fromEntries(Object.keys(BLANK).map((k) => [k, typeof saved[k] === 'string' ? saved[k] : '']))
      : BLANK
  } catch {
    return BLANK
  }
}

export default function AuditLog({ events }) {
  const [f, setF] = useState(recall)
  const [shown, setShown] = useState(PAGE)
  const { who, kind, q, from, to } = f
  const set = (key) => (e) => { setF((prev) => ({ ...prev, [key]: e.target.value })); setShown(PAGE) }
  const active = Object.values(f).some(Boolean)

  useEffect(() => {
    try { localStorage.setItem(REMEMBERED, JSON.stringify(f)) } catch { /* not worth failing over */ }
  }, [f])

  // Whoever actually appears in the trail, not the member list: somebody who
  // has left still did what they did, and their name has to stay selectable.
  const people = useMemo(
    () => [...new Set(events.map((e) => e.actor_email).filter(Boolean))].sort(),
    [events],
  )

  const filtered = useMemo(() => events.filter((e) => {
    if (who && e.actor_email !== who) return false
    if (kind && verbOf(e.action) !== kind) return false
    // The stamp is a full ISO instant; the filters are days. Comparing the
    // first ten characters keeps both ends inclusive, which is what somebody
    // typing the same date in both boxes means by it.
    const day = auditAt(e).slice(0, 10)
    if (from && day < from) return false
    if (to && day > to) return false
    if (!q.trim()) return true
    const hay = `${describeAuditEvent(e)} ${auditChanges(e).map((c) => `${c.field} ${c.from} ${c.to}`).join(' ')}`
    return hay.toLowerCase().includes(q.trim().toLowerCase())
  }), [events, who, kind, q, from, to])

  // One line per event, as a string, for a spreadsheet or an auditor's email.
  const download = () => {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = [['When', 'Who', 'What', 'Changed'].map(cell).join(',')]
    for (const e of filtered) {
      rows.push([
        auditAt(e),
        e.actor_email || 'Someone',
        describeAuditEvent(e),
        auditChanges(e).map((c) => (c.note ? `${c.field} ${c.note}`
          : c.from === null ? `${c.field}: ${c.to}` : `${c.field}: ${c.from} → ${c.to}`)).join('; '),
      ].map(cell).join(','))
    }
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-${auditAt(filtered[0] || {}).slice(0, 10) || 'log'}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-3">
          <ScrollText size={16} className="text-gold" /> Audit log
        </h2>
        {filtered.length > 0 && (
          <Button variant="ghost" onClick={download} aria-label="Download the audit log">
            <Download size={14} /> Download
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-ink-5">
        Who changed what, and what it was before. Most recent first.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Select value={who} onChange={set('who')} aria-label="Filter the log by person">
          <option value="">Everyone</option>
          {people.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
        <Select value={kind} onChange={set('kind')} aria-label="Filter the log by what was done">
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </Select>
        {/* Both ends inclusive: the same date in both boxes means that day. */}
        <DateFilter label="From" value={from} onChange={set('from')} />
        <DateFilter label="To" value={to} onChange={set('to')} />
        <Input value={q} onChange={set('q')} aria-label="Search the audit log" placeholder="Search…" />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <p className="text-xs text-ink-6">
          {filtered.length === events.length
            ? `${events.length} ${events.length === 1 ? 'entry' : 'entries'}`
            : `${filtered.length} of ${events.length}`}
        </p>
        {/* Filters that are remembered have to be visibly undoable, or somebody
            comes back a week later to a log that looks empty and has no idea
            why. */}
        {active && (
          <button
            onClick={() => { setF(BLANK); setShown(PAGE) }}
            className="inline-flex items-center gap-1 text-xs font-medium text-ink-5 hover:text-ink-2"
          >
            <X size={13} /> Clear filters
          </button>
        )}
      </div>

      <div className="mt-2 divide-y divide-border-subtle">
        {filtered.length === 0 && (
          <p className="py-3 text-sm text-ink-6">
            {events.length === 0 ? 'Nothing recorded yet.' : 'Nothing matches that.'}
          </p>
        )}
        {filtered.slice(0, shown).map((e) => {
          const changes = auditChanges(e)
          return (
            <div key={e.id} className="py-2 text-xs">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-ink-4">
                  <span className="font-medium text-ink-2">{e.actor_email || 'Someone'}</span>{' '}
                  {e.summary || AUDIT_ACTIONS[e.action] || e.action}
                </span>
                <span className="shrink-0 tabular text-ink-6">
                  {formatDate(auditAt(e))} {timeOf(auditAt(e))}
                </span>
              </div>
              {changes.length > 0 && (
                <ul className="mt-1 space-y-0.5 ps-3">
                  {changes.map((c, i) => (
                    <li key={`${c.field}-${i}`} className="text-ink-5">
                      <span className="text-ink-4">{c.field}</span>{' '}
                      {c.note ? (
                        <span className="text-ink-6">{c.note}</span>
                      ) : c.from === null ? (
                        <span className="text-ink-3">{c.to}</span>
                      ) : (
                        <>
                          {/* The old value struck through, so the eye finds the
                              new one without reading the line twice. */}
                          <span className="text-ink-6 line-through">{c.from}</span>
                          <span className="mx-1 text-ink-6" aria-hidden="true">→</span>
                          <span className="text-ink-3">{c.to}</span>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {filtered.length > shown && (
        <button
          onClick={() => setShown((n) => n + PAGE)}
          className={cx('mt-3 text-xs font-medium text-brand hover:underline')}
        >
          Show {Math.min(PAGE, filtered.length - shown)} more
        </button>
      )}
    </Card>
  )
}
