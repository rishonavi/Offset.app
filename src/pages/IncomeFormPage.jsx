import { useMemo } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Plus, Banknote, Building2, Eye } from 'lucide-react'
import { useData } from '../context/DataContext'
import { Card, EmptyState, Spinner } from '../components/ui'
import PageHeader from '../components/PageHeader'
import IncomeForm from '../components/IncomeForm'

export default function IncomeFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const { income, properties, loading, addIncome, updateIncome, canWrite } = useData()

  // Distinct payer names already used, for the autocomplete suggestions.
  const payers = useMemo(() => {
    const seen = new Map() // lowercased → original casing
    for (const e of income) {
      const v = (e.payer || '').trim()
      if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [income])

  if (loading) return <Spinner />

  if (!canWrite) {
    return (
      <div className="animate-fade-in">
        <EmptyState
          icon={Eye}
          title="Read-only workspace"
          subtitle="You’re viewing a shared workspace. Switch to your own workspace to add or edit records."
          action={
            <Link to="/income" className="btn-primary">
              Back to income
            </Link>
          }
        />
      </div>
    )
  }

  const editing = id ? income.find((e) => e.id === id) : null
  const goBack = () => (location.key === 'default' ? navigate('/income') : navigate(-1))

  if (id && !editing) {
    return (
      <div className="animate-fade-in">
        <EmptyState
          icon={Banknote}
          title="Income entry not found"
          subtitle="It may have been deleted."
          action={
            <Link to="/income" className="btn-primary">
              Back to income
            </Link>
          }
        />
      </div>
    )
  }

  if (properties.length === 0) {
    return (
      <div className="animate-fade-in">
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
      </div>
    )
  }

  const onSubmit = async (data) => {
    if (editing) await updateIncome(editing.id, data)
    else await addIncome(data)
    goBack()
  }

  return (
    <div className="animate-fade-in space-y-6">
      <Link to="/income" className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={15} /> Back to income
      </Link>
      <PageHeader title={editing ? 'Edit income' : 'Add income'} />
      <Card className="max-w-2xl p-5 sm:p-7">
        <IncomeForm
          initial={editing}
          properties={properties}
          payers={payers}
          defaultPropertyId={params.get('asset') || ''}
          onSubmit={onSubmit}
          onCancel={goBack}
        />
      </Card>
    </div>
  )
}
