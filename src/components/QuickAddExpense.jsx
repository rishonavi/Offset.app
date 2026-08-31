import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { X, Plus } from 'lucide-react'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { CATEGORIES } from '../lib/constants'
import { currencySymbol, todayISO } from '../lib/format'
import { lastUsed } from '../lib/defaults'
import { Field, Input, Select, Button } from './ui'

// A compact modal for logging an expense from anywhere — no page navigation,
// smart defaults (last-used category, single asset auto-selected), and only
// the essential fields.
export default function QuickAddExpense({ open, onClose }) {
  const { properties, expenses, addExpense } = useData()
  const toast = useToast()
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    // Both of these went by list order, which is only the last-used entry if
    // the list happens to be sorted newest-first. `lastUsed` sorts by date and
    // skips values whose asset has since been deleted, so the quick form agrees
    // with the full one instead of guessing differently.
    setForm({
      property_id: lastUsed(expenses, 'property_id', { among: properties.map((p) => p.id) })
        || properties[0]?.id || '',
      amount: '',
      category: lastUsed(expenses, 'category'),
      date: todayISO(),
    })
    setError(null)
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !form) return null
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    const amount = Number(form.amount)
    if (!amount || amount <= 0) return setError('Enter an amount greater than zero.')
    if (!form.property_id) return setError('Add an asset first.')
    setSaving(true)
    setError(null)
    try {
      await addExpense({
        property_id: form.property_id,
        date: form.date,
        amount,
        category: form.category.trim() || 'Other',
        status: 'paid',
      })
      toast('Expense added.')
      onClose()
    } catch (err) {
      setError(err?.message || String(err))
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Quick add expense"
      className="fixed inset-0 z-50 flex items-start justify-center bg-navy/40 p-4 pt-24 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="card w-full max-w-md animate-fade-in p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-serif text-lg font-bold text-ink-1">Quick add expense</h2>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-ink-6 hover:bg-surface-hover" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {properties.length === 0 ? (
          <div className="py-4 text-center text-sm text-ink-5">
            Add an asset first, then log expenses against it.
            <div className="mt-3">
              <Link to="/properties/new" onClick={onClose} className="btn-primary">
                Add asset
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Amount" required>
              <div className="relative">
                <span className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-sm text-ink-5">{currencySymbol}</span>
                <Input autoFocus type="number" inputMode="decimal" step="0.01" min="0" className="ps-8" value={form.amount} onChange={set('amount')} placeholder="0" />
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Category">
                <Input list="qa-cats" value={form.category} onChange={set('category')} placeholder="Optional" />
                <datalist id="qa-cats">
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </Field>
              <Field label="Date">
                <Input type="date" value={form.date} onChange={set('date')} max={todayISO()} />
              </Field>
            </div>
            {properties.length > 1 && (
              <Field label="Asset">
                <Select value={form.property_id} onChange={set('property_id')}>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </Select>
              </Field>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                <Plus size={16} /> Add
              </Button>
            </div>
            <p className="text-center text-[0.7rem] text-ink-6">
              Tip: press <kbd className="rounded bg-surface-chip px-1 font-sans">N</kbd> anywhere to open this.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
