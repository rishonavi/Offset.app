import { useEffect, useMemo, useRef, useState } from 'react'
import { Paperclip, X, Loader2, Sparkles, Camera, Upload, Wand2 } from 'lucide-react'
import { CATEGORIES, PAYMENT_METHODS, ATTACHMENT_ACCEPT, isScannable } from '../lib/constants'
import { useT } from '../context/LanguageContext'
import { draftKey, readDraft, writeDraft, clearDraft, draftDiffers } from '../lib/draft'
import { RECURRENCE_OPTIONS } from '../lib/recurring'
import { buildVendorIndex, suggestCategory } from '../lib/categorize'
import { parseEntry } from '../lib/ai'
import { currencySymbol, todayISO } from '../lib/format'
import { usual, lastUsed, hasDetail } from '../lib/defaults'
import { db } from '../lib/storage'
import { usePlan } from '../context/PlanContext'
import { Field, FormSection, Input, Select, Textarea, Button, MoreDetails } from './ui'

const DETAIL_FIELDS = ['tax', 'payment_method', 'status', 'due_date', 'recurrence', 'description']
// What each of those looks like when it holds nothing worth showing. 'paid' and
// 'none' are the form's own starting point, not something someone chose.
const BLANK_DETAIL = { status: 'paid', recurrence: 'none' }

export default function ExpenseForm({ initial, properties, vendors = [], history = [], defaultPropertyId, onSubmit, onCancel }) {
  const t = useT()
  // A draft only ever fills what the blank form would have left empty or
  // default; it never overwrites the record being edited.
  const key = draftKey('expense', initial?.id)
  // Filled in from what this person actually does, rather than left blank or set
  // to whichever asset happens to sort first. Both of these decline to answer
  // unless the history is one-sided — lib/defaults.js says why that matters.
  const assetIds = useMemo(() => properties.map((x) => x.id), [properties])
  const learned = useMemo(
    () => ({
      property_id: lastUsed(history, 'property_id', { among: assetIds }),
      payment_method: usual(history, 'payment_method', { among: PAYMENT_METHODS }),
    }),
    [history, assetIds],
  )
  const blank = {
    property_id:
      initial?.property_id || defaultPropertyId || learned.property_id || (properties[0]?.id ?? ''),
    date: initial?.date || todayISO(),
    amount: initial?.amount ?? '',
    tax: initial?.tax ?? '',
    category: initial?.category || '',
    vendor: initial?.vendor || '',
    payment_method: initial?.payment_method || learned.payment_method || '',
    status: initial?.status || 'paid',
    due_date: initial?.due_date || '',
    recurrence: initial?.recurrence || 'none',
    description: initial?.description || '',
  }
  const [restored] = useState(() => {
    const draft = readDraft(key)
    return draftDiffers(draft, blank) ? draft : null
  })
  const [form, setForm] = useState(() => ({ ...blank, ...(restored || {}) }))
  const [draftNoticed, setDraftNoticed] = useState(Boolean(restored))
  // Open from the start when there is already something in there. What counts
  // as "something" differs by what the form is for. Editing an entry measures
  // against an empty form, so every value it records is shown rather than
  // hidden. A new entry measures against its own starting point, because a
  // default nobody chose is not a value worth unfolding a form for — and the
  // button names it anyway.
  const [showMore, setShowMore] = useState(() =>
    hasDetail({ ...blank, ...(restored || {}) }, DETAIL_FIELDS, initial ? BLANK_DETAIL : blank))
  const [file, setFile] = useState(null)
  const [existingReceipt, setExistingReceipt] = useState(initial?.receipt_url || null)
  const [receiptPreview, setReceiptPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanPct, setScanPct] = useState(0)
  const [scanMsg, setScanMsg] = useState(null)
  const [nlText, setNlText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [nlNote, setNlNote] = useState(null)
  // The three ways a draft gets written all consult these, so they are declared
  // before the first of them: `latest` because an unmount handler closes over
  // the form as it was when the effect ran, and `settled` because a saved or
  // abandoned entry must not be written back as a draft.
  const latest = useRef(form)
  latest.current = form
  const settled = useRef(false)
  // Written on a timer rather than on every keystroke: this is a rescue for a
  // tab that goes away, not a live sync, and a write per character would be a
  // lot of JSON for no benefit.
  // Only once something has actually been changed. Without this, merely opening
  // the form and leaving would leave a draft of the defaults behind — and
  // pressing "start fresh" would immediately write back the draft it just
  // removed, since blanking the form is itself a change.
  const worthKeeping = draftDiffers(form, blank)
  useEffect(() => {
    if (!worthKeeping) return undefined
    // The guard matters: saving clears the draft, and a write already queued
    // when that happens would put it straight back — leaving the next blank
    // form pre-filled with the entry you just saved.
    const id = setTimeout(() => { if (!settled.current) writeDraft(key, form) }, 400)
    return () => clearTimeout(id)
  }, [key, form, worthKeeping])

  // Leaving the page is the moment the draft matters most, and it is also the
  // moment the timer above gets cancelled — so the last state is written on the
  // way out. Skipped once the entry has been saved or deliberately abandoned,
  // or this would put back the draft that was just cleared.
  useEffect(
    () => () => {
      if (!settled.current && draftDiffers(latest.current, blank)) writeDraft(key, latest.current)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )

  // React's unmount does not run when the page itself goes away — a closed tab,
  // a typed URL, a phone reclaiming the browser. pagehide does, and is the one
  // event that fires reliably on mobile Safari, where this is needed most.
  useEffect(() => {
    const save = () => {
      if (!settled.current && draftDiffers(latest.current, blank)) writeDraft(key, latest.current)
    }
    window.addEventListener('pagehide', save)
    document.addEventListener('visibilitychange', save)
    return () => {
      window.removeEventListener('pagehide', save)
      document.removeEventListener('visibilitychange', save)
    }
  }, [key])

  // Folded away is not the same as forgotten: whatever is inside gets named on
  // the button, so nothing can be set without being visible somewhere.
  const detailSummary = useMemo(() => {
    const bits = []
    if (form.status !== 'paid') bits.push(t('expense.unpaid'))
    if (form.payment_method) bits.push(form.payment_method)
    if (form.tax) bits.push(`${t('entry.tax')} ${form.tax}`)
    if (form.recurrence && form.recurrence !== 'none') bits.push(t('entry.repeats'))
    if (form.description) bits.push(t('entry.notes'))
    return bits.join(', ')
  }, [form.status, form.payment_method, form.tax, form.recurrence, form.description, t])

  const fileRef = useRef(null)
  const cameraRef = useRef(null)
  const plan = usePlan()

  // Suggest a category from the vendor — learns from past entries, falls back to
  // a built-in keyword map. Only offered while the category is still empty.
  const vendorIndex = useMemo(() => buildVendorIndex(history), [history])
  const suggestion = useMemo(
    () => (form.category.trim() ? null : suggestCategory(form.vendor, vendorIndex)),
    [form.vendor, form.category, vendorIndex],
  )
  const applySuggestion = () => suggestion && setForm((f) => ({ ...f, category: suggestion.category }))

  const runParse = async () => {
    if (!nlText.trim()) return
    setParsing(true)
    setNlNote(null)
    try {
      const r = await parseEntry(nlText, 'expense', properties)
      setForm((f) => ({
        ...f,
        property_id: r.property_id || f.property_id,
        amount: r.amount != null ? String(r.amount) : f.amount,
        tax: r.tax != null ? String(r.tax) : f.tax,
        date: r.date || f.date,
        category: r.category || f.category,
        vendor: r.vendor || f.vendor,
      }))
      setNlNote('Filled from your description — please double-check the fields.')
    } catch (e) {
      setNlNote(e?.code === 'not_configured' ? t('entry.aiUnavailable') : e?.message || t('entry.couldNotRead'))
    } finally {
      setParsing(false)
    }
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  // Resolve a viewable URL for an already-saved receipt (signed URL in cloud mode).
  useEffect(() => {
    let active = true
    if (existingReceipt && !file) {
      db.getReceiptUrl(existingReceipt).then((url) => active && setReceiptPreview(url))
    }
    return () => {
      active = false
    }
  }, [existingReceipt, file])

  const onPickFile = (e) => {
    const f = e.target.files?.[0] || null
    setFile(f)
    if (f) setReceiptPreview(URL.createObjectURL(f))
  }

  const clearReceipt = () => {
    setFile(null)
    setExistingReceipt(null)
    setReceiptPreview(null)
    setScanMsg(null)
  }

  const runScan = async () => {
    if (!file) return
    if (plan && !plan.canScan()) {
      setScanMsg(`You’ve used all ${plan.scanLimit} AI scans this month — upgrade to Pro for unlimited scanning (Settings).`)
      return
    }
    setScanning(true)
    setScanMsg(null)
    setScanPct(0)
    try {
      const { scanReceipt, scanSourceNote } = await import('../lib/ocr')
      const parsed = await scanReceipt(file, (p) => setScanPct(Math.round(p * 100)))
      if (parsed.source === 'ai') plan?.recordScan?.()
      setForm((f) => ({
        ...f,
        amount: parsed.amount != null ? String(parsed.amount) : f.amount,
        tax: parsed.tax != null ? String(parsed.tax) : f.tax,
        date: parsed.date || f.date,
        vendor: parsed.vendor || f.vendor,
        category: parsed.category || f.category,
      }))
      const got = [
        parsed.amount != null && 'amount',
        parsed.tax != null && 'tax',
        parsed.date && 'date',
        parsed.vendor && 'vendor',
        parsed.category && 'category',
      ].filter(Boolean)
      const base = got.length
        ? `Filled ${got.join(', ')} — please double-check.`
        : t('entry.scanNothing')
      setScanMsg(`${base} ${scanSourceNote(parsed)}`)
    } catch {
      setScanMsg(t('entry.scanFailed'))
    } finally {
      setScanning(false)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.property_id) return setError(t('entry.needProperty'))
    if (!form.date) return setError(t('entry.needDate'))
    const amount = Number(form.amount)
    if (!amount || amount <= 0) return setError(t('entry.needAmount'))

    setSaving(true)
    setError(null)
    try {
      let receipt_url = existingReceipt
      if (file) receipt_url = await db.uploadReceipt(file)

      await onSubmit({
        property_id: form.property_id,
        date: form.date,
        amount,
        tax: form.tax === '' ? null : Number(form.tax),
        category: form.category.trim() || 'Other',
        vendor: form.vendor.trim(),
        payment_method: form.payment_method,
        status: form.status,
        due_date: form.status === 'unpaid' ? form.due_date || null : null,
        recurrence: form.recurrence,
        description: form.description.trim(),
        receipt_url: receipt_url || null,
      })
      // The entry exists now; the draft of it is only a way to lose track of
      // which is which.
      settled.current = true
      clearDraft(key)
    } catch (err) {
      setError(err?.message || String(err))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {/* Restoring silently is unnerving — a form that fills itself in looks
          like a bug until you work out why. Say it happened, and offer the
          blank form back in one click. */}
      {draftNoticed && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-gold/40 bg-gold/10 px-3 py-2 text-xs text-slate-700">
          <span>{t('entry.draftRestored')}</span>
          <button
            type="button"
            className="shrink-0 font-semibold text-brand underline"
            onClick={() => { clearDraft(key); setForm(blank); setDraftNoticed(false) }}
          >
            {t('entry.draftDiscard')}
          </button>
        </div>
      )}
      <div className="rounded-xl border border-gold/30 bg-gold/[0.07] p-4">
        <div className="mb-1.5 flex items-center gap-1.5 text-[0.7rem] font-semibold uppercase tracking-[1.5px] text-slate-500">
          <Sparkles size={13} className="text-gold" /> {t('entry.quickAdd')}
        </div>
        <div className="flex gap-2">
          <Input
            value={nlText}
            onChange={(e) => setNlText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                runParse()
              }
            }}
            aria-label={t('expense.describe')}
            placeholder={t('expense.describePlaceholder')}
          />
          <Button type="button" variant="ghost" onClick={runParse} loading={parsing} className="shrink-0">
            {t('entry.parse')}
          </Button>
        </div>
        {nlNote && <p role="status" aria-live="polite" className="mt-1.5 text-xs text-slate-500">{nlNote}</p>}
      </div>

      <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
        <Field className="sm:col-span-2" label={t('entry.property')} required>
          <Select value={form.property_id} onChange={set('property_id')}>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        <FormSection title="The cost" />

        <Field className="sm:col-span-2" label={t('entry.date')} required>
          <Input type="date" className="field-input-compact" value={form.date} onChange={set('date')} max={todayISO()} />
        </Field>

        <Field label={t('entry.amount')} required>
          <div className="relative">
            <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
              {currencySymbol}
            </span>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              className="ps-8 field-input-lead"
              value={form.amount}
              onChange={set('amount')}
              placeholder="0"
            />
          </div>
        </Field>


        <FormSection title="What it was for" />

        <Field label={t('expense.category')} hint={t('expense.categoryHint')}>
          <Input
            list="expense-categories"
            value={form.category}
            onChange={set('category')}
            placeholder={t('expense.categoryPlaceholder')}
          />
          <datalist id="expense-categories">
            {CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          {suggestion && (
            <button
              type="button"
              onClick={applySuggestion}
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-brand-light px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-gold hover:text-gold"
            >
              <Wand2 size={12} className="text-gold" />
              Use <span className="font-semibold text-slate-800">{suggestion.category}</span>
              {suggestion.source === 'history' && <span className="text-slate-400">· from past entries</span>}
            </button>
          )}
        </Field>

        <Field label={t('expense.vendor')}>
          <Input
            list="expense-vendors"
            value={form.vendor}
            onChange={set('vendor')}
            placeholder={t('expense.vendorPlaceholder')}
          />
          {vendors.length > 0 && (
            <datalist id="expense-vendors">
              {vendors.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          )}
        </Field>


        <MoreDetails
          open={showMore}
          onToggle={() => setShowMore((v) => !v)}
          label={t('entry.moreDetails')}
          summary={detailSummary}
        />

        {showMore && (
          <>
            <Field label={t('entry.tax')} hint={t('entry.taxHint')}>
              <div className="relative">
                <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                  {currencySymbol}
                </span>
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  className="ps-8"
                  value={form.tax}
                  onChange={set('tax')}
                  placeholder="0"
                />
              </div>
            </Field>

            <FormSection title="Payment" />

            <Field label={t('entry.paymentMethod')}>
              <Select value={form.payment_method} onChange={set('payment_method')}>
                <option value="">—</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('expense.status')}>
              <div className="flex gap-2">
                {[
                  { v: 'paid', label: t('expense.paid') },
                  { v: 'unpaid', label: t('expense.unpaid') },
                ].map((o) => (
                  <button
                    type="button"
                    key={o.v}
                    onClick={() => setForm((f) => ({ ...f, status: o.v }))}
                    className={`flex-1 min-h-[2.75rem] rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                      form.status === o.v
                        ? o.v === 'paid'
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                          : 'border-gold bg-brand-light text-gold'
                        : 'border-border-light text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </Field>

            {form.status === 'unpaid' && (
              <Field className="sm:col-span-2" label={t('entry.dueDate')}>
                <Input type="date" className="field-input-compact" value={form.due_date} onChange={set('due_date')} />
              </Field>
            )}

            <Field className="sm:col-span-2" label={t('entry.repeats')} hint={t('expense.recurringHint')}>
              <Select className="field-input-compact" value={form.recurrence} onChange={set('recurrence')}>
                {RECURRENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field className="sm:col-span-2" label={t('entry.notes')}>
              <Textarea rows={2} value={form.description} onChange={set('description')} placeholder={t('entry.notesPlaceholder')} />
            </Field>
          </>
        )}
      </div>

      <Field label={t('expense.receipt')} hint={t('entry.attachmentHint')}>
        {receiptPreview || existingReceipt ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <Paperclip size={16} className="text-slate-400" />
              <a
                href={receiptPreview || '#'}
                target="_blank"
                rel="noreferrer"
                className="flex-1 truncate text-sm font-medium text-brand hover:underline"
              >
                {file ? file.name : t('entry.viewAttachment')}
              </a>
              <button
                type="button"
                onClick={clearReceipt}
                className="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                title={t('entry.removeAttachment')}
              >
                <X size={15} />
              </button>
            </div>
            {isScannable(file) && (
              <button type="button" onClick={runScan} disabled={scanning} className="btn-ghost w-full">
                {scanning ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    {scanPct > 0 ? ` ${t('entry.readingProgress', { percent: scanPct })}` : ` ${t('entry.reading')}`}
                  </>
                ) : (
                  <>
                    <Sparkles size={15} /> {t('entry.scan')}
                  </>
                )}
              </button>
            )}
            {scanMsg && <p role="status" aria-live="polite" className="text-xs text-slate-500">{scanMsg}</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <button type="button" onClick={() => cameraRef.current?.click()} className="btn-ghost flex-1">
                <Camera size={15} /> {t('entry.takePhoto')}
              </button>
              <button type="button" onClick={() => fileRef.current?.click()} className="btn-ghost flex-1">
                <Upload size={15} /> {t('entry.chooseFile')}
              </button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onPickFile} className="hidden" />
            <input ref={fileRef} type="file" accept={ATTACHMENT_ACCEPT} onChange={onPickFile} className="hidden" />
          </div>
        )}
      </Field>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="form-actions">
        <Button type="button" variant="ghost" onClick={() => { settled.current = true; clearDraft(key); onCancel?.() }}>
          {t('entry.cancel')}
        </Button>
        <Button type="submit" loading={saving}>
          {initial ? t('entry.save') : t('expense.add')}
        </Button>
      </div>
    </form>
  )
}
