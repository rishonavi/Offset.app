import { useMemo } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Plus, Receipt, Building2, Eye } from 'lucide-react'
import { useData } from '../context/DataContext'
import { Card, EmptyState, Spinner } from '../components/ui'
import PageHeader from '../components/PageHeader'
import ExpenseForm from '../components/ExpenseForm'
import { useT } from '../context/LanguageContext'

export default function ExpenseFormPage() {
  const t = useT()
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const { expenses, properties, loading, addExpense, updateExpense, canWrite } = useData()

  // Distinct vendor names already used, for the autocomplete suggestions.
  const vendors = useMemo(() => {
    const seen = new Map() // lowercased → original casing
    for (const e of expenses) {
      const v = (e.vendor || '').trim()
      if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [expenses])

  if (loading) return <Spinner />

  if (!canWrite) {
    return (
      <div className="animate-fade-in">
        <EmptyState
          icon={Eye}
          title={t('entry.readOnly')}
          subtitle={t('entry.readOnlyBody')}
          action={
            <Link to="/expenses" className="btn-primary">
              {t('entry.backToExpenses')}
            </Link>
          }
        />
      </div>
    )
  }

  const editing = id ? expenses.find((e) => e.id === id) : null
  const goBack = () => (location.key === 'default' ? navigate('/expenses') : navigate(-1))

  if (id && !editing) {
    return (
      <div className="animate-fade-in">
        <EmptyState
          icon={Receipt}
          title="Expense not found"
          subtitle="It may have been deleted."
          action={
            <Link to="/expenses" className="btn-primary">
              {t('entry.backToExpenses')}
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
          title={t('entry.needAssetFirst')}
          subtitle="Expenses are tracked per asset, so create one before logging expenses."
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
    if (editing) await updateExpense(editing.id, data)
    else await addExpense(data)
    goBack()
  }

  return (
    <div className="animate-fade-in space-y-6">
      <Link to="/expenses" className="inline-flex min-h-6 items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={15} /> {t('entry.backToExpenses')}
      </Link>
      <PageHeader title={editing ? t('entry.editExpense') : t('expense.add')} />
      <Card className="max-w-2xl p-5 sm:p-7">
        <ExpenseForm
          initial={editing}
          properties={properties}
          vendors={vendors}
          history={expenses}
          defaultPropertyId={params.get('asset') || ''}
          onSubmit={onSubmit}
          onCancel={goBack}
        />
      </Card>
    </div>
  )
}
