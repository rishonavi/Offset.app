import { useEffect, useMemo, useRef, useState } from 'react'
import { Bug, X, Check, Copy, Mail, ChevronDown, ShieldCheck, Send } from 'lucide-react'
import { useData } from '../context/DataContext'
import { useTheme } from '../context/ThemeContext'
import { usePlan } from '../context/PlanContext'
import { useToast } from '../context/ToastContext'
import { isCloud } from '../lib/storage'
import { useModal } from '../lib/useModal'
import {
  REPORT_KINDS,
  collectDiagnostics,
  describeDiagnostics,
  formatReportText,
  mailtoLink,
  saveReport,
  markReportSent,
  validateReport,
  SUPPORT_EMAIL,
} from '../lib/reports'
import { submitReportToCloud } from '../lib/reportsCloud'

// The report dialog. Deliberately short: a person who has just hit a bug is
// already annoyed, and a nine-field form is how you turn a bug report into
// nothing at all. One required box, one optional box, and the machine fills in
// everything it can work out for itself.
export default function ReportProblem({ open, onClose, prefill = null, route = '/', onFiled }) {
  const dialogRef = useRef(null)
  const firstFieldRef = useRef(null)
  const { properties, expenses, income } = useData()
  const { theme } = useTheme()
  const { plan } = usePlan()
  const toast = useToast()

  const [draft, setDraft] = useState({ kind: 'broken', message: '', expected: '', email: '' })
  const [attach, setAttach] = useState(true)
  const [showDetail, setShowDetail] = useState(false)
  const [errors, setErrors] = useState({})
  const [saved, setSaved] = useState(null)
  const [saveError, setSaveError] = useState('')
  const [sending, setSending] = useState(false)
  const [delivery, setDelivery] = useState(null) // { ok } | { ok: false, why }

  useModal(dialogRef, { open, onClose, initialFocus: firstFieldRef })

  // A fresh dialog every time it opens; a report opened from a crash starts on
  // the right type with the error already in hand.
  useEffect(() => {
    if (!open) return
    setDraft({ kind: prefill?.error ? 'broken' : 'broken', message: '', expected: '', email: '' })
    setAttach(true)
    setShowDetail(false)
    setErrors({})
    setSaved(null)
    setSaveError('')
    setSending(false)
    setDelivery(null)
  }, [open, prefill])

  const diagnostics = useMemo(
    () =>
      open
        ? collectDiagnostics({
            route,
            theme,
            backend: isCloud ? 'cloud' : 'demo',
            plan,
            counts: { assets: properties.length, expenses: expenses.length, income: income.length },
            error: prefill?.error || null,
          })
        : null,
    // Snapshot taken when the dialog opens — the state at the moment of the
    // complaint, not the state after the user typed for two minutes.
    [open], // eslint-disable-line react-hooks/exhaustive-deps
  )

  if (!open) return null

  const rows = describeDiagnostics(diagnostics)

  const submit = async (e) => {
    e.preventDefault()
    const found = validateReport(draft)
    setErrors(found)
    if (Object.keys(found).length) return

    // Written down before anything is attempted: whatever fails next, the
    // report the user just typed is not lost.
    let report
    try {
      report = saveReport(draft, attach ? diagnostics : null)
      setSaved(report)
      setSaveError('')
      onFiled?.()
    } catch (err) {
      // The report is still on screen and copying needs no storage, so this is
      // a setback rather than a dead end — say which.
      setSaveError(err?.message || 'Could not file the report.')
      return
    }

    // Delivery is best-effort. It failing does not lose the report, and the
    // copy/email routes below work with no server at all.
    if (!isCloud) return
    setSending(true)
    try {
      await submitReportToCloud(report)
      markReportSent(report.id, 'sent')
      setDelivery({ ok: true })
    } catch (err) {
      setDelivery({ ok: false, why: err?.message || 'Could not send it from here.' })
    } finally {
      setSending(false)
    }
  }

  const copyReport = async (report) => {
    const text = formatReportText(report)
    try {
      await navigator.clipboard.writeText(text)
      toast('Report copied — paste it wherever you like.')
      if (report.id) markReportSent(report.id, 'copied')
    } catch {
      toast('Couldn’t reach the clipboard. Select the text below and copy it.', { type: 'error' })
      setShowDetail(true)
    }
  }

  const emailReport = (report) => {
    const href = mailtoLink(report)
    if (!href) return
    window.location.href = href
    markReportSent(report.id, 'email')
  }

  // ── Sent ──
  if (saved) {
    return (
      <Shell dialogRef={dialogRef} onClose={onClose} title="Thanks — that helps">
        <div className="flex items-start gap-3 border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/40">
          <Check size={18} className="mt-0.5 shrink-0 text-emerald-600" />
          <div className="text-sm text-emerald-900 dark:text-emerald-200">
            <p className="font-semibold">Report {saved.reference} filed.</p>
            <p className="mt-1">
              Quote that reference if you follow it up. You can see it again under{' '}
              <span className="font-medium">Settings → Reports you’ve filed</span>.
            </p>
          </div>
        </div>

        {/* What became of it. "Filed" and "delivered" are different claims, and
            saying the second when only the first happened is how a report form
            quietly becomes a bin. */}
        {sending && <p className="mt-4 text-sm text-ink-5">Sending it to the developer…</p>}
        {delivery?.ok && (
          <p className="mt-4 flex items-start gap-2 text-sm text-ink-4">
            <Send size={15} className="mt-0.5 shrink-0 text-emerald-600" />
            Sent — it’s in the developer’s queue. Nothing else to do.
          </p>
        )}
        {delivery && !delivery.ok && (
          <p className="mt-4 border-s-2 border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            Saved here, but it couldn’t be sent: {delivery.why}
          </p>
        )}

        {!sending && !delivery?.ok && (
          <p className="mt-4 text-sm text-ink-4">
            {SUPPORT_EMAIL
              ? 'Send it on so it reaches someone:'
              : 'This copy of Offset has no support address configured, so send it on yourself:'}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {SUPPORT_EMAIL && !delivery?.ok && (
            <button type="button" className="btn-primary" onClick={() => emailReport(saved)}>
              <Mail size={16} /> Email the report
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={() => copyReport(saved)}>
            <Copy size={16} /> Copy report
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>

        <details className="mt-4" open={showDetail}>
          <summary className="cursor-pointer text-xs font-medium text-ink-5">See exactly what it says</summary>
          <textarea
            readOnly
            aria-label="Report text"
            className="field-input mt-2 h-48 w-full resize-y font-mono text-[0.7rem] leading-relaxed"
            value={formatReportText(saved)}
          />
        </details>
      </Shell>
    )
  }

  // ── Compose ──
  return (
    <Shell dialogRef={dialogRef} onClose={onClose} title="Report a problem">
      <form onSubmit={submit} noValidate>
        {prefill?.error && (
          <p className="mb-4 border-s-2 border-red-400 bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
            Reporting the error that just appeared: <span className="font-mono">{String(prefill.error.message || prefill.error).slice(0, 120)}</span>
          </p>
        )}

        <fieldset className="mb-4">
          <legend className="field-label">What kind of problem?</legend>
          <div className="mt-1 space-y-1.5">
            {REPORT_KINDS.map((k, i) => (
              <label
                key={k.id}
                className={`flex cursor-pointer items-start gap-2.5 border p-2.5 transition ${
                  draft.kind === k.id ? 'border-gold bg-brand-light' : 'border-border-light hover:border-gold/40'
                }`}
              >
                <input
                  ref={i === 0 ? firstFieldRef : null}
                  type="radio"
                  name="report-kind"
                  value={k.id}
                  checked={draft.kind === k.id}
                  onChange={() => setDraft((d) => ({ ...d, kind: k.id }))}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink-2">{k.label}</span>
                  {k.hint && <span className="block text-xs text-ink-5">{k.hint}</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <span className="field-label">
            What happened? <span className="text-red-500">*</span>
          </span>
          <textarea
            className="field-input h-24 resize-y"
            placeholder="I clicked Save on an expense and the page went blank…"
            value={draft.message}
            onChange={(e) => setDraft((d) => ({ ...d, message: e.target.value }))}
            aria-invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? 'report-message-error' : undefined}
          />
          {errors.message && (
            <span id="report-message-error" className="mt-1 block text-xs text-red-600">
              {errors.message}
            </span>
          )}
        </label>

        <label className="mt-3 block">
          <span className="field-label">What did you expect instead?</span>
          <textarea
            className="field-input h-16 resize-y"
            placeholder="Optional — but it’s often the whole bug."
            value={draft.expected}
            onChange={(e) => setDraft((d) => ({ ...d, expected: e.target.value }))}
          />
        </label>

        <label className="mt-3 block">
          <span className="field-label">Your email</span>
          <input
            type="email"
            className="field-input"
            placeholder="Optional — only so someone can reply"
            value={draft.email}
            onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? 'report-email-error' : undefined}
          />
          {errors.email && (
            <span id="report-email-error" className="mt-1 block text-xs text-red-600">
              {errors.email}
            </span>
          )}
        </label>

        {/* What gets attached, spelled out. */}
        <div className="mt-4 border border-border-light bg-surface-sunk p-3 dark:bg-white/5">
          <label className="flex items-start gap-2.5">
            <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} className="mt-1" />
            <span className="min-w-0">
              <span className="flex items-center gap-1.5 text-sm font-medium text-ink-2">
                <ShieldCheck size={14} className="text-gold" /> Attach {rows.length} technical details
              </span>
              <span className="mt-0.5 block text-xs text-ink-5">
                Your entries, amounts, names and documents are never included — only counts of them.
              </span>
            </span>
          </label>
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="mt-2 flex items-center gap-1 text-xs font-medium text-brand hover:underline"
            aria-expanded={showDetail}
          >
            <ChevronDown size={13} className={showDetail ? 'rotate-180 transition' : 'transition'} />
            {showDetail ? 'Hide' : 'Show'} what’s attached
          </button>
          {showDetail && (
            <dl className="mt-2 space-y-1 border-t border-border-subtle pt-2">
              {rows.map((r) => (
                <div key={r.label} className="flex gap-3 text-xs">
                  <dt className="w-32 shrink-0 text-ink-5">{r.label}</dt>
                  <dd className="min-w-0 break-words font-medium text-ink-3">{r.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        {saveError && <p className="mt-3 text-sm text-red-600">{saveError}</p>}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            <Bug size={16} /> File report
          </button>
        </div>
      </form>
    </Shell>
  )
}

function Shell({ dialogRef, onClose, title, children }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-navy/50 p-4 py-[6vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div ref={dialogRef} className="card w-full max-w-lg animate-fade-in p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-serif text-lg font-bold text-ink-1">
            <Bug size={18} className="text-gold" /> {title}
          </h3>
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-ink-6 hover:bg-surface-hover">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
