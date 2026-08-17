import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Banknote, Building2, Search, X } from 'lucide-react'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { sumAmount } from '../lib/filters'
import { formatCurrency, todayISO } from '../lib/format'
import { Card, EmptyState, Spinner } from '../components/ui'
import PageHeader from '../components/PageHeader'
import IncomeTable from '../components/IncomeTable'

const EMPTY = { propertyId: '', from: '', to: '', q: '' }

export default function Income() {
  const { income, properties, loading, deleteIncome, restoreIncome, addIncome, updateIncome, propertyNameById, canWrite } = useData()
  const [filters, setFilters] = useState(EMPTY)
  const navigate = useNavigate()
  const toast = useToast()

  const removeIncome = async (e) => {
    await deleteIncome(e.id)
    toast('Income moved to bin', { action: { label: 'Undo', onClick: () => restoreIncome(e) } })
  }
  const removeMany = async (rows) => {
    for (const e of rows) await deleteIncome(e.id)
    toast(`${rows.length} moved to bin`, {
      action: {
        label: 'Undo',
        onClick: async () => {
          for (const e of rows) await restoreIncome(e)
        },
      },
    })
  }

  const markReceived = async (e) => {
    const { id, user_id, created_at, ...rest } = e
    await updateIncome(id, { ...rest, status: 'received', due_date: null })
    toast('Marked as received', {
      action: { label: 'Undo', onClick: () => updateIncome(id, { ...rest, status: e.status, due_date: e.due_date || null }) },
    })
  }
  const duplicate = async (e) => {
    const { id, user_id, created_at, receipt_url, ...rest } = e
    const row = await addIncome({ ...rest, date: todayISO(), status: 'received', due_date: null })
    toast('Income duplicated', { action: { label: 'Undo', onClick: () => deleteIncome(row.id) } })
  }

  const filtered = useMemo(
    () =>
      income.filter((e) => {
        if (filters.propertyId && e.property_id !== filters.propertyId) return false
        if (filters.from && (e.date || '') < filters.from) return false
        if (filters.to && (e.date || '') > filters.to) return false
        if (filters.q) {
          const hay = `${e.source || ''} ${e.payer || ''} ${e.description || ''}`.toLowerCase()
          if (!hay.includes(filters.q.trim().toLowerCase())) return false
        }
        return true
      }),
    [income, filters],
  )
  const total = useMemo(() => sumAmount(filtered), [filtered])
  const active = filters.propertyId || filters.from || filters.to || filters.q
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))

  if (loading) return <Spinner />
  const noProperties = properties.length === 0

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Income"
        subtitle={`${filtered.length} ${filtered.length === 1 ? 'entry' : 'entries'}${active ? ' (filtered)' : ''} · ${formatCurrency(total)} total`}
        actions={
          canWrite ? (
            <Link to="/income/new" className="btn-primary">
              <Plus size={16} /> Add income
            </Link>
          ) : null
        }
      />

      {noProperties ? (
        <EmptyState
          icon={Building2}
          title="Add an asset first"
          subtitle="Income is tracked per asset, so create one before logging rent."
          action={
            <Link to="/properties/new" className="btn-primary">
              <Plus size={16} /> Add asset
            </Link>
          }
        />
      ) : (
        <>
          <Card className="p-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-12">
              <div className="relative lg:col-span-4">
                <Search size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="field-input pl-9" aria-label="Search income" placeholder="Search source, payer, note…" value={filters.q} onChange={set('q')} />
              </div>
              <select className="field-input lg:col-span-4" aria-label="Filter by asset" value={filters.propertyId} onChange={set('propertyId')}>
                <option value="">All assets</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <input type="date" className="field-input lg:col-span-2" value={filters.from} onChange={set('from')} title="From date" />
              <input type="date" className="field-input lg:col-span-2" value={filters.to} onChange={set('to')} title="To date" />
            </div>
            {active && (
              <button onClick={() => setFilters(EMPTY)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
                <X size={13} /> Clear filters
              </button>
            )}
          </Card>

          {income.length === 0 ? (
            <EmptyState
              icon={Banknote}
              title="No income yet"
              subtitle="Log rent or other income to see it here."
              action={
                <Link to="/income/new" className="btn-primary">
                  <Plus size={16} /> Add income
                </Link>
              }
            />
          ) : filtered.length === 0 ? (
            <Card className="p-10 text-center text-sm text-slate-500">No income matches these filters.</Card>
          ) : (
            <IncomeTable
              income={filtered}
              propertyNameById={propertyNameById}
              onEdit={(e) => navigate(`/income/${e.id}/edit`)}
              onDelete={removeIncome}
              onMarkSettled={markReceived}
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
