
import { CloudOff, RefreshCw, Check, AlertTriangle, Copy } from 'lucide-react'
import { useSync } from '../context/SyncContext'
import { formatDate } from '../lib/format'
import { Card, Button, Badge, cx } from './ui'

// What this device has not managed to tell the others.
//
// The one thing this must never do is show a tick while work is queued. "Synced"
// with three unsent rows behind it is the kind of reassurance that costs
// somebody a day, so the wording follows the state exactly: waiting, offline,
// failed, or up to date — and never two of those at once.
export default function SyncStatus({ compact = false }) {
  const sync = useSync()
  const { state, running, conflicts, duplicates: doubled, duplicateCount } = sync || {}

  // Two entries of the same day's muster is a mistake whether it was made on
  // two devices or twice on one, so that stays visible in demo mode. What does
  // not is a reassuring tick: with no server to reconcile with there is nothing
  // honest to say about being up to date.
  if (!sync?.enabled) {
    if (!duplicateCount) return null
    return <Card className="p-5"><Doubled doubled={doubled} count={duplicateCount} /></Card>
  }
  const bad = Boolean(state.error) || conflicts.length > 0
  const waiting = state.pending > 0 || !state.online

  if (compact) {
    return (
      <button
        onClick={sync.run}
        aria-label="Sync status"
        className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[0.6875rem] font-semibold',
          bad ? 'text-warn' : waiting ? 'text-ink-4' : 'text-good')}
      >
        {running ? <RefreshCw size={12} className="animate-spin" />
          : !state.online ? <CloudOff size={12} />
            : bad ? <AlertTriangle size={12} />
              : state.settled ? <Check size={12} /> : <RefreshCw size={12} />}
        {state.pending > 0 ? state.pending : ''}
      </button>
    )
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-3">
            {!state.online ? <CloudOff size={16} className="text-ink-5" />
              : state.settled ? <Check size={16} className="text-good" />
                : <RefreshCw size={16} className={cx('text-ink-5', running && 'animate-spin')} />}
            Sync
          </h2>
          <p className="mt-1 text-xs text-ink-5">{state.why}</p>
          {state.lastSyncedAt && (
            <p className="mt-0.5 text-[0.6875rem] text-ink-6">Last reconciled {formatDate(state.lastSyncedAt)}</p>
          )}
        </div>
        <Button variant="ghost" onClick={sync.run} disabled={running || !state.online}>
          <RefreshCw size={14} className={cx(running && 'animate-spin')} /> Sync now
        </Button>
      </div>

      {/* The whole reason first-write-wins is safe: the edit that lost is shown
          to the person who made it, with what they changed and what it says
          now. An edit that vanishes without a word is the failure this design
          exists to prevent. */}
      {conflicts.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-warn" />
            <h3 className="text-sm font-semibold text-ink-3">
              {conflicts.length === 1 ? 'One change did not go through' : `${conflicts.length} changes did not go through`}
            </h3>
          </div>
          <p className="mt-1 text-xs text-ink-5">
            Somebody else changed these first. Nothing of yours was thrown away — what you had is below, so you can
            decide whether to make the change again.
          </p>
          <ul className="mt-3 space-y-3">
            {conflicts.map((c) => (
              <li key={`${c.kind}-${c.id}-${c.at}`} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-ink-2">{c.label}</p>
                  <Button variant="ghost" aria-label={`Dismiss ${c.label}`} onClick={() => sync.dismissConflict(c.id)}>
                    Got it
                  </Button>
                </div>
                <table className="mt-2 w-full text-xs">
                  <thead className="text-ink-5">
                    <tr><th className="text-start font-medium">Field</th><th className="text-start font-medium">You had</th><th className="text-start font-medium">It says now</th></tr>
                  </thead>
                  <tbody className="text-ink-4">
                    {c.fields.map((f) => (
                      <tr key={f.field}>
                        <td className="py-0.5 pe-3">{f.field.replace(/_/g, ' ')}</td>
                        <td className="py-0.5 pe-3 text-warn">{String(f.mine ?? '—')}</td>
                        <td className="py-0.5 text-ink-2">{String(f.theirs ?? '—')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </li>
            ))}
          </ul>
        </div>
      )}

      {duplicateCount > 0 && <div className="mt-4"><Doubled doubled={doubled} count={duplicateCount} /></div>}
    </Card>
  )
}

// The hazard when several people keep one ledger is not a clash, it is the same
// day entered twice: the gate writes it up and the office writes it up again,
// both entries are valid, and the wage bill is wrong by a day.
function Doubled({ doubled = [], count = 0 }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <Copy size={15} className="text-warn" />
        <h3 className="text-sm font-semibold text-ink-3">
          {count === 1 ? 'One entry looks like a repeat' : `${count} entries look like repeats`}
        </h3>
      </div>
      <p className="mt-1 text-xs text-ink-5">
        Same day, same details, entered more than once — usually the gate and the office both writing it up.
        Nothing has been deleted; check them and remove whichever is the second copy.
      </p>
      <ul className="mt-3 divide-y divide-line-soft">
        {doubled.slice(0, 12).map((d) => (
          <li key={`${d.kind}-${d.keep.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span className="text-ink-2">
              {d.keep.date || d.keep.name || d.keep.id}
              <span className="block text-[0.6875rem] text-ink-6">{d.kind} · {d.count} copies</span>
            </span>
            <Badge color="#d97706">{d.count}×</Badge>
          </li>
        ))}
      </ul>
    </>
  )
}
