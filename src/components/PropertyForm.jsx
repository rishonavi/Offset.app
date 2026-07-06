import { useState } from 'react'
import { ASSET_TYPES } from '../lib/constants'
import { currencySymbol } from '../lib/format'
import { Field, Input, Select, Textarea, Button } from './ui'

export default function PropertyForm({ initial, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    name: initial?.name || '',
    type: initial?.type || ASSET_TYPES[0],
    address: initial?.address || '',
    value: initial?.value ?? '',
    monthly_budget: initial?.monthly_budget ?? '',
    loan_principal: initial?.loan_principal ?? '',
    loan_rate: initial?.loan_rate ?? '',
    loan_tenure_months: initial?.loan_tenure_months ?? '',
    loan_start: initial?.loan_start || '',
    notes: initial?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) {
      setError('Property name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const num = (v) => (v === '' || v == null ? null : Number(v))
      await onSubmit({
        ...form,
        name: form.name.trim(),
        value: num(form.value),
        monthly_budget: num(form.monthly_budget),
        loan_principal: num(form.loan_principal),
        loan_rate: num(form.loan_rate),
        loan_tenure_months: num(form.loan_tenure_months),
        loan_start: form.loan_start || null,
      })
    } catch (err) {
      setError(err?.message || String(err))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Field label="Asset name" required>
        <Input value={form.name} onChange={set('name')} placeholder="e.g. Sea View Apartment · BMW X5 · Sunseeker 60" autoFocus />
      </Field>

      <Field label="Type">
        <Select value={form.type} onChange={set('type')}>
          {ASSET_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Address">
        <Input value={form.address} onChange={set('address')} placeholder="Street, area, city" />
      </Field>

      <Field label="Asset value" hint="Optional — purchase price or current value, used for ROI & yield">
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
            value={form.value}
            onChange={set('value')}
            placeholder="0"
          />
        </div>
      </Field>

      <Field label="Monthly budget" hint="Optional — used for budget alerts on this property">
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
            value={form.monthly_budget}
            onChange={set('monthly_budget')}
            placeholder="0"
          />
        </div>
      </Field>

      {/* Loan / mortgage (optional) */}
      <div className="border-t border-border-light pt-5">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[1.5px] text-slate-500">Loan / mortgage</p>
        <p className="mt-1 text-xs text-slate-400">
          Optional — fill all four to see EMI, outstanding balance and payoff date on the asset page.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Loan amount">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                {currencySymbol}
              </span>
              <Input type="number" inputMode="decimal" step="0.01" min="0" className="pl-8"
                value={form.loan_principal} onChange={set('loan_principal')} placeholder="0" />
            </div>
          </Field>
          <Field label="Interest rate" hint="Annual %">
            <Input type="number" inputMode="decimal" step="0.001" min="0"
              value={form.loan_rate} onChange={set('loan_rate')} placeholder="e.g. 8.5" />
          </Field>
          <Field label="Tenure" hint="Total months">
            <Input type="number" inputMode="numeric" step="1" min="0"
              value={form.loan_tenure_months} onChange={set('loan_tenure_months')} placeholder="e.g. 240" />
          </Field>
          <Field label="Start date">
            <Input type="date" value={form.loan_start} onChange={set('loan_start')} />
          </Field>
        </div>
      </div>

      <Field label="Notes">
        <Textarea rows={3} value={form.notes} onChange={set('notes')} placeholder="Anything worth remembering" />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-end gap-3 border-t border-border-light pt-5">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={saving}>
          {initial ? 'Save changes' : 'Add asset'}
        </Button>
      </div>
    </form>
  )
}
