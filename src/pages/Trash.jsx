import { useCallback, useEffect, useState } from 'react'
import { Trash2, RotateCcw, Undo2 } from 'lucide-react'
import { db } from '../lib/storage'
import { useData } from '../context/DataContext'
import { usePersonal } from '../context/PersonalContext'
import { useToast } from '../context/ToastContext'
import { formatCurrency, formatDate } from '../lib/format'
import { Card, Button, Spinner, EmptyState, Badge } from '../components/ui'
import PageHeader from '../components/PageHeader'

const RETENTION_DAYS = 30
const KIND_LABEL = { expense: 'Expense', income: 'Income', personal: 'Personal' }

export default function Trash() {
  const { propertyNameById, refresh: refreshData } = useData()
  const { refresh: refreshPersonal } = usePersonal()
  const toast = useToast()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const t = await db.getTrash()
      const tag = (rows, kind) => rows.map((r) => ({ ...r, kind }))
      const all = [
        ...tag(t.expenses, 'expense'),
        ...tag(t.income, 'income'),
        ...tag(t.personal, 'personal'),
      ].sort((a, b) => (b.deleted_at || '').localeCompare(a.deleted_at || ''))
      setItems(all)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const daysLeft = (deletedAt) => {
    const gone = Math.floor((Date.now() - Date.parse(deletedAt)) / 86400000)
    return Math.max(0, RETENTION_DAYS - gone)
  }

  const restore = async (it) => {
    setBusy(true)
    try {
      await db.restoreTrash(it.kind, it.id)
      setItems((prev) => prev.filter((x) => !(x.kind === it.kind && x.id === it.id)))
      if (it.kind === 'personal') await refreshPersonal()
      else await refreshData()
      toast('Restored.')
    } catch (e) {
      toast(e?.message || 'Could not restore.', { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const purge = async (it) => {
    setBusy(true)
    try {
      await db.purgeTrash(it.kind, it.id)
      setItems((prev) => prev.filter((x) => !(x.kind === it.kind && x.id === it.id)))
      toast('Deleted forever.')
    } catch (e) {
      toast(e?.message || 'Could not delete.', { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const emptyAll = async () => {
    if (!window.confirm(`Permanently delete all ${items.length} item(s) in the trash? This cannot be undone.`)) return
    setBusy(true)
    try {
      await db.emptyTrash()
      setItems([])
      toast('Trash emptied.')
    } catch (e) {
      toast(e?.message || 'Could not empty trash.', { type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Spinner />

  const label = (it) =>
    it.kind === 'income' ? it.source || 'Income' : it.category || (it.kind === 'personal' ? 'Personal' : 'Expense')

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title="Trash" subtitle={`Deleted items are kept for ${RETENTION_DAYS} days, then removed for good.`} />
        {items.length > 0 && (
          <Button variant="ghost" onClick={emptyAll} loading={busy} className="text-red-600 hover:bg-red-50">
            <Trash2 size={15} /> Empty trash
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState icon={Trash2} title="Trash is empty" subtitle="Deleted expenses and income appear here, recoverable for 30 days." />
      ) : (
        <Card className="p-0">
          <div className="divide-y divide-slate-100">
            {items.map((it) => (
              <div key={`${it.kind}-${it.id}`} className="flex items-center gap-3 px-5 py-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400">
                  <Undo2 size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{KIND_LABEL[it.kind]}</Badge>
                    <span className="text-sm font-medium text-slate-800">{label(it)}</span>
                    {it.kind !== 'personal' && (
                      <span className="text-xs text-slate-400">· {propertyNameById(it.property_id) || 'asset'}</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-400">
                    {formatCurrency(it.amount)} · {formatDate(it.date)} · deleted {formatDate(it.deleted_at)}
                  </div>
                </div>
                <span className="shrink-0 text-xs font-medium text-amber-600">{daysLeft(it.deleted_at)}d left</span>
                <button onClick={() => restore(it)} disabled={busy} className="shrink-0 text-slate-400 hover:text-emerald-600 disabled:opacity-50" title="Restore">
                  <RotateCcw size={16} />
                </button>
                <button onClick={() => purge(it)} disabled={busy} className="shrink-0 text-slate-400 hover:text-red-600 disabled:opacity-50" title="Delete forever">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
