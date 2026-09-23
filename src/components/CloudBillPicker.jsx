import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Mail, Paperclip, AlertCircle } from 'lucide-react'
import { connectGmail, isGmailConnected, fetchBillAttachments, attachmentToFile, billSummary } from '../lib/gmail'
import { useT } from '../context/LanguageContext'
import { Card, Button, Spinner, cx } from './ui'

// Attaching a bill that is not on this device.
//
// The bill for a load of cement arrives as a PDF in an inbox, and the person
// entering it is on a phone at a site office. "Choose file" means finding the
// mail app, saving the attachment somewhere, coming back and hunting for it in
// a downloads folder — four steps in which the number they were about to type
// is forgotten. This reads the last four months of bill-like mail and lets
// them pick the attachment directly.
//
// Deliberately not a scan. The form already has a Scan button for reading a
// figure off an attachment; parsing all fifteen on the way in would spend a
// scan from the monthly allowance for each one to fill in fields nobody asked
// for. This only fetches and attaches — see `fetchBillAttachments`.
const kb = (bytes) => (bytes >= 1_000_000 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

export default function CloudBillPicker({ open, onClose, onPick }) {
  const t = useT()
  const [state, setState] = useState('idle')
  const [rows, setRows] = useState([])
  const [progress, setProgress] = useState([0, 0])
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setState('loading')
    setError(null)
    setProgress([0, 0])
    try {
      if (!isGmailConnected()) await connectGmail()
      const found = await fetchBillAttachments({ max: 15, onProgress: (done, total) => setProgress([done, total]) })
      setRows(found)
      setState('done')
    } catch (e) {
      // A popup the person closed is not a failure worth a red box — it is
      // them changing their mind, and the dialog should just be sitting there
      // as they left it.
      const msg = String(e?.message || e)
      if (/popup|cancel|closed|denied/i.test(msg)) { setState('idle'); return }
      setError(msg)
      setState('failed')
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Reset on close, so reopening does not show the last search's results as
  // though they were fresh.
  useEffect(() => {
    if (!open) { setState('idle'); setRows([]); setError(null) }
  }, [open])

  if (!open) return null

  const take = (cand) => {
    onPick(attachmentToFile(cand))
    onClose()
  }

  // Rendered into <body>, not where it is written.
  //
  // A modal belongs at the top of the document rather than wherever it was
  // convenient to write it: the call site is inside a <form>, which makes it a
  // submit scope — every button in here would default to type=submit, and
  // Enter would save the expense behind the dialog.
  //
  // It also sidesteps a trap the call site walked into first. The picker was
  // written inside the branch that shows the two file buttons, which is the
  // branch that disappears the moment a file is attached: picking one set the
  // state and unmounted the picker in the same update, and the attachment
  // appeared for exactly one render before reverting to nothing. Both the
  // portal and moving it out of the branch fix that independently — measured
  // one at a time. Giving the buttons explicit types, which was the first
  // guess, changed nothing at all.
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cloud-bill-title"
      className="fixed inset-0 z-[70] flex items-end justify-center bg-navy/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <Card
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-b-none p-0 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line p-5">
          <div className="min-w-0">
            <h2 id="cloud-bill-title" className="flex items-center gap-2 font-serif text-lg font-bold text-ink-1">
              <Mail size={18} className="shrink-0 text-brand-ink" aria-hidden="true" />
              {t('cloudbill.title')}
            </h2>
            <p className="mt-1 text-xs text-ink-5">{t('cloudbill.subtitle')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="icon-btn shrink-0 text-ink-6 hover:bg-surface-hover">
            <X size={20} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {state === 'idle' && (
            <div className="text-center">
              <p className="text-sm text-ink-4">{t('cloudbill.connectBody')}</p>
              <Button type="button" className="mt-4" onClick={load}>
                <Mail size={16} /> {t('cloudbill.connect')}
              </Button>
            </div>
          )}

          {state === 'loading' && (
            <div className="py-6 text-center">
              <Spinner className="py-4" label={t('cloudbill.searching')} />
              {progress[1] > 0 && (
                <p className="text-xs tabular text-ink-5">{progress[0]} / {progress[1]}</p>
              )}
            </div>
          )}

          {state === 'failed' && (
            <div className="text-center">
              <AlertCircle size={22} className="mx-auto text-bad" aria-hidden="true" />
              <p className="mt-2 text-sm text-ink-3">{t('cloudbill.failed')}</p>
              {/* The reason as the API gave it. A dialog that says only
                  "something went wrong" cannot be acted on by anyone. */}
              <p className="mt-1 break-words text-xs text-ink-6">{error}</p>
              <Button type="button" variant="ghost" className="mt-4" onClick={load}>{t('cloudbill.retry')}</Button>
            </div>
          )}

          {state === 'done' && rows.length === 0 && (
            <p className="py-6 text-center text-sm text-ink-5">{t('cloudbill.none')}</p>
          )}

          {state === 'done' && rows.length > 0 && (
            <ul className="space-y-2">
              {rows.map((cand) => {
                const s = billSummary(cand)
                return (
                  <li key={cand.id}>
                    <button
                      type="button"
                      onClick={() => take(cand)}
                      className={cx(
                        'flex w-full items-center gap-3 rounded-xl border border-border-strong p-3 text-start transition',
                        'hover:border-brand hover:bg-brand/10 focus-visible:border-brand',
                      )}
                    >
                      <Paperclip size={16} className="shrink-0 text-ink-5" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink-2">{s.file}</span>
                        <span className="block truncate text-xs text-ink-5">
                          {s.who}{s.who && s.subject ? ' · ' : ''}{s.subject}
                        </span>
                      </span>
                      <span className="shrink-0 tabular text-[0.6875rem] text-ink-6">{kb(s.bytes)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Card>
    </div>,
    document.body,
  )
}
