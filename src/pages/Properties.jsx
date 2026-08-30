import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Building2, Plus, Pencil, Trash2, MapPin, ArrowRight } from 'lucide-react'
import { useData } from '../context/DataContext'
import { formatCurrency } from '../lib/format'
import { monthSpendByProperty } from '../lib/budget'
import { iconForAssetType } from '../lib/assetIcon'
import { EmptyState, Spinner } from '../components/ui'
import PageHeader from '../components/PageHeader'
import BudgetBar from '../components/BudgetBar'

export default function Properties() {
  const { properties, expenses, income, loading, deleteProperty } = useData()
  const navigate = useNavigate()

  const earned = useMemo(() => {
    const map = new Map()
    for (const e of income || []) {
      map.set(e.property_id, (map.get(e.property_id) || 0) + (Number(e.amount) || 0))
    }
    return map
  }, [income])

  const totals = useMemo(() => {
    const sum = new Map()
    const count = new Map()
    for (const e of expenses) {
      sum.set(e.property_id, (sum.get(e.property_id) || 0) + (Number(e.amount) || 0))
      count.set(e.property_id, (count.get(e.property_id) || 0) + 1)
    }
    return { sum, count }
  }, [expenses])

  const monthSpend = useMemo(() => monthSpendByProperty(expenses), [expenses])

  const onEdit = (e, p) => {
    e.preventDefault()
    e.stopPropagation()
    navigate(`/properties/${p.id}/edit`)
  }

  const onDelete = (e, p) => {
    e.preventDefault()
    e.stopPropagation()
    const n = totals.count.get(p.id) || 0
    const msg = n
      ? `Delete "${p.name}" and its ${n} expense(s)? This cannot be undone.`
      : `Delete "${p.name}"?`
    if (window.confirm(msg)) deleteProperty(p.id)
  }

  if (loading) return <Spinner />

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Assets"
        subtitle="Properties, vehicles, yachts, aircraft, machinery — anything with income or running costs."
        actions={
          <Link to="/properties/new" className="btn-primary">
            <Plus size={16} /> Add asset
          </Link>
        }
      />

      {properties.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No assets yet"
          subtitle="Add your first asset — a property, car, yacht, aircraft or machine — to start tracking it."
          action={
            <Link to="/properties/new" className="btn-primary">
              <Plus size={16} /> Add asset
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 stagger sm:grid-cols-2 lg:grid-cols-3">
          {properties.map((p) => {
            const count = totals.count.get(p.id) || 0
            const Icon = iconForAssetType(p.type)
            return (
              <Link key={p.id} to={`/properties/${p.id}`} className="card card-hover flex flex-col p-5">
                <div className="flex items-start justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-light text-brand">
                      <Icon size={18} />
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold text-slate-900">{p.name}</h2>
                      {p.type && <span className="text-xs text-slate-400">{p.type}</span>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={(e) => onEdit(e, p)}
                      className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-brand"
                      title="Edit"
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={(e) => onDelete(e, p)}
                      className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition hover:bg-red-50 hover:text-red-600"
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {p.address && (
                  <p className="mt-3 flex items-start gap-1.5 text-sm text-slate-500">
                    <MapPin size={14} className="mt-0.5 shrink-0 text-slate-400" />
                    <span className="line-clamp-2">{p.address}</span>
                  </p>
                )}

                {p.monthly_budget ? (
                  <div className="mt-4">
                    <BudgetBar spent={monthSpend.get(p.id) || 0} budget={p.monthly_budget} />
                  </div>
                ) : null}

                {/* What it is worth leads, because that is the question an asset
                    card is asked first. Spend and income sit under it as the
                    two figures that change it. A value nobody entered stays
                    absent rather than being shown as zero — an asset worth
                    nothing and an asset nobody valued are different claims. */}
                <div className="mt-auto border-t border-slate-100 pt-4">
                  <div className="flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs text-slate-400">{p.value ? 'Value' : 'Total spent'}</div>
                      <div className="tabular text-lg font-bold text-slate-900">
                        {p.value ? formatCurrency(p.value) : formatCurrency(totals.sum.get(p.id) || 0)}
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-brand">
                      Details <ArrowRight size={13} />
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-xs">
                    <div>
                      <dt className="text-slate-400">Spent · {count}</dt>
                      <dd className="tabular font-semibold text-slate-700">
                        {formatCurrency(totals.sum.get(p.id) || 0)}
                      </dd>
                    </div>
                    <div className="text-end">
                      <dt className="text-slate-400">Earned</dt>
                      <dd className="tabular font-semibold text-emerald-700">
                        {formatCurrency(earned.get(p.id) || 0)}
                      </dd>
                    </div>
                  </dl>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
