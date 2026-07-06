import { useEffect, useRef, useState } from 'react'
import { Paperclip, X, Loader2, Sparkles, Camera, Upload } from 'lucide-react'
import { INCOME_SOURCES, PAYMENT_METHODS } from '../lib/constants'
import { RECURRENCE_OPTIONS } from '../lib/recurring'
import { currencySymbol, todayISO } from '../lib/format'
import { db } from '../lib/storage'
import { usePlan } from '../context/PlanContext'
import { Field, Input, Select, Textarea, Button } from './ui'

export default function IncomeForm({ initial, properties, payers = [], defaultPropertyId, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    property_id: initial?.property_id || defaultPropertyId || (properties[0]?.id ?? ''),
    date: initial?.date || todayISO(),
    amount: initial?.amount ?? '',
    tax: initial?.tax ?? '',
    source: initial?.source || 'Rent',
    payer: initial?.payer || '',
    payment_method: initial?.payment_method || '',
    status: initial?.status || 'received',
    due_date: initial?.due_date || '',
    recurrence: initial?.recurrence || 'none',
    description: initial?.description || '',
  })
  const [file, setFile] = useState(null)
  const [existingReceipt, setExistingReceipt] = useState(initial?.receipt_url || null)
  const [receiptPreview, setReceiptPreview] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [scanPct, setScanPct] = useState(0)
  const [scanMsg, setScanMsg] = useState(null)
  const fileRef = useRef(null)
  const cameraRef = useRef(null)
  const plan = usePlan()

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

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
        payer: parsed.vendor || f.payer,
      }))
      const got = [
        parsed.amount != null && 'amount',
        parsed.tax != null && 'tax',
        parsed.date && 'date',
        parsed.vendor && 'payer',
      ].filter(Boolean)
      const base = got.length
        ? `Filled ${got.join(', ')} — please double-check.`
        : 'Couldn’t read the details — please enter them manually.'
      setScanMsg(`${base} ${scanSourceNote(parsed)}`)
    } catch {
      setScanMsg('Scan failed — please enter details manually.')
    } finally {
      setScanning(false)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!form.property_id) return setError('Please choose a property.')
    if (!form.date) return setError('Please choose a date.')
    if (!form.source) return setError('Please choose a source.')
    const amount = Number(form.amount)
    if (!amount || amount <= 0) return setError('Enter an amount greater than zero.')

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
        source: form.source,
        payer: form.payer.trim(),
        payment_method: form.payment_method,
        status: form.status,
        due_date: form.status === 'pending' ? form.due_date || null : null,
        recurrence: form.recurrence,
        description: form.description.trim(),
        receipt_url: receipt_url || null,
      })
    } catch (err) {
      setError(err?.message || String(err))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid grid-cols-1 gap-4">
        <Field label="Property" required>
          <Select value={form.property_id} onChange={set('property_id')}>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Date" required>
          <Input type="date" value={form.date} onChange={set('date')} max={todayISO()} />
        </Field>

        <Field label="Amount received" required>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
              {currencySymbol}
            </span>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              className="pl-8"
              value={form.amount}
              onChange={set('amount')}
              placeholder="0"
            />
          </div>
        </Field>

        <Field label="Tax / GST" hint="Optional — already part of the amount">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
              {currencySymbol}
            </span>
            <Input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              className="pl-8"
              value={form.tax}
              onChange={set('tax')}
              placeholder="0"
            />
          </div>
        </Field>

        <Field label="Source" required>
          <Input
            list="income-sources"
            value={form.source}
            onChange={set('source')}
            placeholder="Select or type a source"
          />
          <datalist id="income-sources">
            {INCOME_SOURCES.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>

        <Field label="Received from (tenant / payer)">
          <Input
            list="income-payers"
            value={form.payer}
            onChange={set('payer')}
            placeholder="e.g. Mr. Sharma"
          />
          {payers.length > 0 && (
            <datalist id="income-payers">
              {payers.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          )}
        </Field>

        <Field label="Payment method">
          <Select value={form.payment_method} onChange={set('payment_method')}>
            <option value="">—</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Status">
          <div className="flex gap-2">
            {[
              { v: 'received', label: 'Received' },
              { v: 'pending', label: 'Pending' },
            ].map((o) => (
              <button
                type="button"
                key={o.v}
                onClick={() => setForm((f) => ({ ...f, status: o.v }))}
                className={`flex-1 border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                  form.status === o.v
                    ? o.v === 'received'
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

        {form.status === 'pending' && (
          <Field label="Due date">
            <Input type="date" value={form.due_date} onChange={set('due_date')} />
          </Field>
        )}

        <Field label="Repeats" hint="Recurring income shows a one-tap prompt on the dashboard when due">
          <Select value={form.recurrence} onChange={set('recurrence')}>
            {RECURRENCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field label="Description / Notes">
        <Textarea rows={2} value={form.description} onChange={set('description')} placeholder="e.g. June rent" />
      </Field>

      <Field label="Proof / receipt" hint="JPG, PNG or PDF">
        {receiptPreview || existingReceipt ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3 border border-border-light bg-slate-50 px-3 py-2">
              <Paperclip size={16} className="text-slate-400" />
              <a
                href={receiptPreview || '#'}
                target="_blank"
                rel="noreferrer"
                className="flex-1 truncate text-sm font-medium text-gold hover:underline"
              >
                {file ? file.name : 'View attached file'}
              </a>
              <button
                type="button"
                onClick={clearReceipt}
                className="grid h-7 w-7 place-items-center text-slate-400 hover:bg-slate-200 hover:text-slate-700"
                title="Remove"
              >
                <X size={15} />
              </button>
            </div>
            {file && (
              <button type="button" onClick={runScan} disabled={scanning} className="btn-ghost w-full">
                {scanning ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    {scanPct > 0 ? ` Reading… ${scanPct}%` : ' Reading…'}
                  </>
                ) : (
                  <>
                    <Sparkles size={15} /> Scan to auto-fill
                  </>
                )}
              </button>
            )}
            {scanMsg && <p className="text-xs text-slate-500">{scanMsg}</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-2">
              <button type="button" onClick={() => cameraRef.current?.click()} className="btn-ghost flex-1">
                <Camera size={15} /> Take photo
              </button>
              <button type="button" onClick={() => fileRef.current?.click()} className="btn-ghost flex-1">
                <Upload size={15} /> Choose file
              </button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onPickFile} className="hidden" />
            <input ref={fileRef} type="file" accept="image/*,.pdf" onChange={onPickFile} className="hidden" />
          </div>
        )}
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-3 border-t border-border-light pt-5">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {initial ? 'Save changes' : 'Add income'}
        </Button>
      </div>
    </form>
  )
}
