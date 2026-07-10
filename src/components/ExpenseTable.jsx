import { useEffect, useState } from 'react'
import { Paperclip, Pencil, Trash2, Copy, CheckCircle2, ChevronDown } from 'lucide-react'
import { colorForCategory } from '../lib/constants'
import { formatCurrency, formatDate } from '../lib/format'
import { isSettled } from '../lib/payments'
import { useSorted, SortTh } from '../lib/tableSort'
import { Badge } from './ui'
import PaymentChip from './PaymentChip'
import ReceiptViewer from './ReceiptViewer'

// Render rows in pages so a few thousand entries don't paint at once.
const PAGE = 100

export default function ExpenseTable({ expenses, propertyNameById, onEdit, onDelete, onMarkSettled, onDuplicate, onBulkDelete, selectable, readOnly }) {
  const [viewing, setViewing] = useState(null)
  const [selected, setSelected] = useState(() => new Set())
  const [limit, setLimit] = useState(PAGE)
  const canSelect = selectable && !readOnly

  const { sorted, sort, toggle: onSort } = useSorted(expenses, {
    date: (e) => e.date || '',
    property: (e) => propertyNameById(e.property_id) || '',
    category: (e) => e.category || '',
    vendor: (e) => e.vendor || '',
    amount: (e) => Number(e.amount) || 0,
  })

  // Reset paging whenever the (filtered) list changes.
  useEffect(() => setLimit(PAGE), [expenses])
  const visible = sorted.slice(0, limit)

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const allSelected = expenses.length > 0 && expenses.every((e) => selected.has(e.id))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(expenses.map((e) => e.id)))
  const clearSel = () => setSelected(new Set())
  const bulkDelete = () => {
    onBulkDelete(expenses.filter((e) => selected.has(e.id)))
    clearSel()
  }

  return (
    <>
      {canSelect && selected.size > 0 && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-gold/30 bg-brand-light px-4 py-2.5">
          <span className="text-sm font-medium text-slate-700">{selected.size} selected</span>
          <div className="flex items-center gap-3">
            <button onClick={clearSel} className="text-xs font-medium text-slate-500 hover:text-slate-800">Clear</button>
            <button onClick={bulkDelete} className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline">
              <Trash2 size={14} /> Delete {selected.size}
            </button>
          </div>
        </div>
      )}

      {/* Desktop / tablet table */}
      <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              {canSelect && (
                <th className="w-10 px-4 py-3">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" />
                </th>
              )}
              <SortTh label="Date" k="date" sort={sort} onSort={onSort} />
              <SortTh label="Property" k="property" sort={sort} onSort={onSort} />
              <SortTh label="Category" k="category" sort={sort} onSort={onSort} />
              <SortTh label="Vendor" k="vendor" sort={sort} onSort={onSort} />
              <SortTh label="Amount" k="amount" sort={sort} onSort={onSort} align="right" />
              <th className="px-4 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((e) => (
              <tr key={e.id} className={`transition hover:bg-slate-50/70 ${selected.has(e.id) ? 'bg-brand-light/40' : ''}`}>
                {canSelect && (
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} aria-label="Select row" />
                  </td>
                )}
                <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(e.date)}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{propertyNameById(e.property_id) || '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge color={colorForCategory(e.category)}>{e.category}</Badge>
                    <PaymentChip entry={e} kind="expense" />
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  <div className="flex items-center gap-1.5">
                    {e.vendor || <span className="text-slate-300">—</span>}
                    {e.receipt_url && (
                      <button
                        onClick={() => setViewing(e.receipt_url)}
                        className="text-slate-400 transition hover:text-brand"
                        title="View receipt"
                      >
                        <Paperclip size={14} />
                      </button>
                    )}
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-900">
                  {formatCurrency(e.amount)}
                </td>
                <td className="px-4 py-3">
                  <div className={`flex items-center justify-end gap-1 ${readOnly ? 'hidden' : ''}`}>
                    {onMarkSettled && !isSettled(e, 'expense') && (
                      <button
                        onClick={() => onMarkSettled(e)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-emerald-50 hover:text-emerald-600"
                        title="Mark as paid"
                      >
                        <CheckCircle2 size={15} />
                      </button>
                    )}
                    {onDuplicate && (
                      <button
                        onClick={() => onDuplicate(e)}
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-brand"
                        title="Duplicate"
                      >
                        <Copy size={15} />
                      </button>
                    )}
                    <button
                      onClick={() => onEdit(e)}
                      className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-brand"
                      title="Edit"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => onDelete(e)}
                      className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {visible.map((e) => (
          <div key={e.id} className={`card p-4 ${selected.has(e.id) ? 'border-gold' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-2">
                {canSelect && (
                  <input type="checkbox" className="mt-1" checked={selected.has(e.id)} onChange={() => toggle(e.id)} aria-label="Select row" />
                )}
                <div className="min-w-0">
                  <div className="truncate font-semibold text-slate-800">{propertyNameById(e.property_id) || '—'}</div>
                  <div className="mt-0.5 text-xs text-slate-500">{formatDate(e.date)}</div>
                </div>
              </div>
              <div className="text-right font-bold text-slate-900">{formatCurrency(e.amount)}</div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge color={colorForCategory(e.category)}>{e.category}</Badge>
              <PaymentChip entry={e} kind="expense" />
              {e.vendor && <span className="text-xs text-slate-500">{e.vendor}</span>}
              {e.receipt_url && (
                <button
                  onClick={() => setViewing(e.receipt_url)}
                  className="inline-flex items-center gap-1 text-xs text-brand"
                >
                  <Paperclip size={12} /> Receipt
                </button>
              )}
            </div>
            {e.description && <p className="mt-2 text-sm text-slate-500">{e.description}</p>}
            <div className={`mt-3 flex-wrap justify-end gap-3 border-t border-slate-100 pt-3 ${readOnly ? 'hidden' : 'flex'}`}>
              {onMarkSettled && !isSettled(e, 'expense') && (
                <button onClick={() => onMarkSettled(e)} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                  <CheckCircle2 size={13} /> Mark paid
                </button>
              )}
              {onDuplicate && (
                <button onClick={() => onDuplicate(e)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-600">
                  <Copy size={13} /> Duplicate
                </button>
              )}
              <button onClick={() => onEdit(e)} className="inline-flex items-center gap-1 text-xs font-medium text-slate-600">
                <Pencil size={13} /> Edit
              </button>
              <button onClick={() => onDelete(e)} className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {expenses.length > limit && (
        <div className="flex items-center justify-center gap-3 pt-2 text-sm text-slate-500">
          <span>
            Showing {visible.length} of {expenses.length}
          </span>
          <button
            onClick={() => setLimit((l) => l + PAGE * 5)}
            className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"
          >
            <ChevronDown size={15} /> Show more
          </button>
        </div>
      )}

      {viewing && <ReceiptViewer stored={viewing} onClose={() => setViewing(null)} />}
    </>
  )
}
