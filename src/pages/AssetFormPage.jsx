import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Building2, Crown, Eye } from 'lucide-react'
import { useData } from '../context/DataContext'
import { usePlan } from '../context/PlanContext'
import { Card, EmptyState, Spinner } from '../components/ui'
import PageHeader from '../components/PageHeader'
import PropertyForm from '../components/PropertyForm'

export default function AssetFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { properties, loading, addProperty, updateProperty, canWrite } = useData()
  const plan = usePlan()

  if (loading) return <Spinner />

  if (!canWrite) {
    return (
      <div className="animate-fade-in">
        <EmptyState
          icon={Eye}
          title="Read-only workspace"
          subtitle="You’re viewing a shared workspace. Switch to your own workspace to add or edit assets."
          action={
            <Link to="/properties" className="btn-primary">
              Back to assets
            </Link>
          }
        />
      </div>
    )
  }

  const editing = id ? properties.find((p) => p.id === id) : null
  const goBack = () => (location.key === 'default' ? navigate('/properties') : navigate(-1))
  const atAssetLimit = !editing && plan && !plan.canAddAsset(properties.length)

  if (id && !editing) {
    return (
      <div className="animate-fade-in">
        <EmptyState
          icon={Building2}
          title="Asset not found"
          subtitle="It may have been deleted."
          action={
            <Link to="/properties" className="btn-primary">
              Back to assets
            </Link>
          }
        />
      </div>
    )
  }

  const onSubmit = async (data) => {
    if (editing) await updateProperty(editing.id, data)
    else await addProperty(data)
    goBack()
  }

  return (
    <div className="animate-fade-in space-y-6">
      <Link to="/properties" className="inline-flex min-h-6 items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={15} /> Back to assets
      </Link>
      <PageHeader title={editing ? 'Edit asset' : 'Add asset'} />
      {atAssetLimit ? (
        <Card className="flex max-w-2xl flex-col items-start gap-3 p-6">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-gold/15 text-gold">
            <Crown size={20} />
          </span>
          <div>
            <p className="font-semibold text-slate-800">You’ve reached the {plan.info.limits.assets}-asset limit on the Free plan.</p>
            <p className="mt-1 text-sm text-slate-500">Upgrade to Pro for unlimited assets.</p>
          </div>
          <Link to="/settings" className="btn-primary">
            <Crown size={16} /> Upgrade to Pro
          </Link>
        </Card>
      ) : (
        <Card className="max-w-2xl p-5 sm:p-7">
          <PropertyForm initial={editing} onSubmit={onSubmit} onCancel={goBack} />
        </Card>
      )}
    </div>
  )
}
