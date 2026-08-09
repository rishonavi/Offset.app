import { Search, X } from 'lucide-react'
import { CATEGORIES } from '../lib/constants'
import { emptyFilters, hasActiveFilters } from '../lib/filters'
import { Card } from './ui'

export default function FilterBar({ properties, value, onChange, categories = CATEGORIES }) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value })

  return (
    <Card className="p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-12">
        <div className="relative lg:col-span-3">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="field-input pl-9"
            aria-label="Search expenses"
            placeholder="Search vendor, note…"
            value={value.q}
            onChange={set('q')}
          />
        </div>

        <select className="field-input lg:col-span-3" aria-label="Filter by asset" value={value.propertyId} onChange={set('propertyId')}>
          <option value="">All properties</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select className="field-input lg:col-span-2" aria-label="Filter by category" value={value.category} onChange={set('category')}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <label className="flex min-w-0 flex-col gap-1 lg:col-span-2">
          <span className="inline-flex min-h-6 items-center text-xs font-medium text-slate-500 lg:hidden">From date</span>
          <input type="date" className="field-input min-w-0" value={value.from} onChange={set('from')} title="From date" />
        </label>
        <label className="flex min-w-0 flex-col gap-1 lg:col-span-2">
          <span className="inline-flex min-h-6 items-center text-xs font-medium text-slate-500 lg:hidden">To date</span>
          <input type="date" className="field-input min-w-0" value={value.to} onChange={set('to')} title="To date" />
        </label>
      </div>

      {hasActiveFilters(value) && (
        <button
          onClick={() => onChange(emptyFilters)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
        >
          <X size={13} /> Clear filters
        </button>
      )}
    </Card>
  )
}
