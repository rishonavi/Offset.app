import { useMemo, useState } from 'react'
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

// Reusable client-side sort for the expense/income tables. `accessors` maps a
// column key to a value getter; strings sort locale-aware, numbers numerically.
// Sorting runs on the full list before the table pages it, so it always covers
// every row, not just the visible page.
export function useSorted(rows, accessors, initial = { key: 'date', dir: 'desc' }) {
  const [sort, setSort] = useState(initial)
  const sorted = useMemo(() => {
    const acc = accessors[sort.key]
    if (!acc) return rows
    const sign = sort.dir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      const va = acc(a)
      const vb = acc(b)
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sign
      return String(va ?? '').localeCompare(String(vb ?? '')) * sign
    })
  }, [rows, sort]) // eslint-disable-line react-hooks/exhaustive-deps
  // Toggle direction on the active column; new columns start desc for date/amount
  // (most-recent / largest first) and asc for text.
  const toggle = (key) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'date' || key === 'amount' ? 'desc' : 'asc' },
    )
  return { sorted, sort, toggle }
}

// A sortable table header cell.
export function SortTh({ label, k, sort, onSort, align = 'left', className = '' }) {
  const active = sort.key === k
  const Icon = active ? (sort.dir === 'asc' ? ChevronUp : ChevronDown) : ChevronsUpDown
  return (
    <th className={`px-4 py-3 font-semibold ${align === 'right' ? 'text-right' : ''} ${className}`}>
      <button
        type="button"
        onClick={() => onSort(k)}
        aria-label={`Sort by ${label}`}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-700 ${
          align === 'right' ? 'flex-row-reverse' : ''
        } ${active ? 'text-slate-700' : ''}`}
      >
        {label}
        <Icon size={13} className={active ? 'text-gold' : 'text-slate-300'} />
      </button>
    </th>
  )
}
