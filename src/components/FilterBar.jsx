import { Search, X } from 'lucide-react'
import { CATEGORIES } from '../lib/constants'
import { emptyFilters, hasActiveFilters } from '../lib/filters'
import { Card, DateFilter } from './ui'

export default function FilterBar({ properties, value, onChange, categories = CATEGORIES }) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value })

  return (
    <Card className="p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-12">
        {/* The placeholder is shorter than it was: the date fields took two of
            this row's twelve columns so they could show a full date without
            clipping, and "Search vendor, note…" no longer fitted in what is
            left. What the box searches moved into the label, where a screen
            reader still gets it and nothing is cut off. */}
        <div className="relative lg:col-span-2">
          <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-6" />
          <input
            className="field-input pl-9"
            aria-label="Search expenses by vendor or note"
            placeholder="Search…"
            value={value.q}
            onChange={set('q')}
          />
        </div>

        <select className="field-input lg:col-span-2" aria-label="Filter by asset" value={value.propertyId} onChange={set('propertyId')}>
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

        {/* Every other control on this row says what it is from the inside: the
            search box has a placeholder, the two selects open on "All
            properties" and "All categories". A date input can carry neither,
            so these two had their labels above them — and then hidden above
            `lg`, which is exactly the width where there is room. On a desktop
            the row ended in two identical empty boxes and nothing said which
            was the start of the range. The word goes inside the control, so it
            reads like its neighbours and the row keeps one height. */}
        <DateFilter label="From" className="lg:col-span-3" value={value.from} onChange={set('from')} />
        <DateFilter label="To" className="lg:col-span-3" value={value.to} onChange={set('to')} />
      </div>

      {hasActiveFilters(value) && (
        <button
          onClick={() => onChange(emptyFilters)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-ink-5 hover:text-ink-2"
        >
          <X size={13} /> Clear filters
        </button>
      )}
    </Card>
  )
}
