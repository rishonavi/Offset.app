import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Receipt, Building2 } from 'lucide-react'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { applyFilters, emptyFilters, sumAmount, hasActiveFilters } from '../lib/filters'
import { CATEGORIES } from '../lib/constants'
import { formatCurrency, todayISO } from '../lib/format'
import { Card, EmptyState, Spinner } from '../components/ui'
import PageHeader from '../components/PageHeader'
import FilterBar from '../components/FilterBar'
import ExpenseTable from '../components/ExpenseTable'

export default function Expenses() {
  const { expenses, properties, loading, deleteExpense, restoreExpense, addExpense, updateExpense, propertyNameById, canWrite } = useData()
  const [filters, setFilters] = useState(emptyFilters)
  const navigate = useNavigate()
  const toast = useToast()

  const removeExpense = async (e) => {
    await deleteExpense(e.id)
    toast('Expense moved to bin', { action: { label: 'Undo', onClick: () => restoreExpense(e) } })
  }
  const removeMany = async (rows) => {
    for (const e of rows) await deleteExpense(e.id)
    toast(`${rows.length} moved to bin`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          for (const e of rows) await restoreExpense(e)
        },
      },
    })
  }

  const markPaid = async (e) => {
    const { id, user_id, created_at, ...rest } = e
    await updateExpense(id, { ...rest, status: 'paid', due_date: null })
    toast('Marked as paid', {
      action: { label: 'Undo', onClick: () => updateExpense(id, { ...rest, status: e.status, due_date: e.due_date || null }) },
    })
  }
  const duplicate = async (e) => {
    // Fresh copy dated today, reset to settled (no receipt, no stale due date).
    const { id, user_id, created_at, receipt_url, ...rest } = e
    const row = await addExpense({ ...rest, date: todayISO(), status: 'paid', due_date: null })
    toast('Expense duplicated', { action: { label: 'Undo', onClick: () => deleteExpense(row.id) } })
  }

  const filtered = useMemo(() => applyFilters(expenses, filters), [expenses, filters])
  const total = useMemo(() => sumAmount(filtered), [filtered])
  const categoryOptions = useMemo(
    () => [...new Set([...CATEGORIES, ...expenses.map((e) => e.category).filter(Boolean)])],
    [expenses],
  )

  if (loading) return <Spinner />

  const noProperties = properties.length === 0

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Expenses"
        subtitle={`${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}${
          hasActiveFilters(filters) ? ' (filtered)' : ''
        } · ${formatCurrency(total)}`}
        actions={
          canWrite ? (
            <Link to="/expenses/new" className="btn-primary">
              <Plus size={16} /> Add expense
            </Link>
          ) : null
        }
      />

      {noProperties ? (
        <EmptyState
          icon={Building2}
          title="Add an asset first"
          subtitle="Expenses are tracked per asset, so create one before logging expenses."
          action={
            <Link to="/properties/new" className="btn-primary">
              <Plus size={16} /> Add asset
            </Link>
          }
        />
      ) : (
        <>
          <FilterBar properties={properties} value={filters} onChange={setFilters} categories={categoryOptions} />

          {expenses.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No expenses yet"
              subtitle="Log your first expense to see it here."
              action={
                <Link to="/expenses/new" className="btn-primary">
                  <Plus size={16} /> Add expense
                </Link>
              }
            />
          ) : filtered.length === 0 ? (
            <Card className="p-10 text-center text-sm text-ink-5">No expenses match these filters.</Card>
          ) : (
            <ExpenseTable
              expenses={filtered}
              propertyNameById={propertyNameById}
              onEdit={(e) => navigate(`/expenses/${e.id}/edit`)}
              onDelete={removeExpense}
              onMarkSettled={markPaid}
              onDuplicate={duplicate}
              onBulkDelete={removeMany}
              selectable
              readOnly={!canWrite}
            />
          )}
        </>
      )}
    </div>
  )
}
