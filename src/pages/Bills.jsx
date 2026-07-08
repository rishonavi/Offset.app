import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Paperclip, Search, X, ExternalLink, MessageSquare, Send, Trash2 } from 'lucide-react'
import { useData } from '../context/DataContext'
import { useAuth } from '../context/AuthContext'
import { formatCurrency, formatDate } from '../lib/format'
import { colorForCategory, colorForSource } from '../lib/constants'
import { iconForAssetType } from '../lib/assetIcon'
import { Card, EmptyState, Spinner, Badge, Button } from '../components/ui'
import PageHeader from '../components/PageHeader'
import ReceiptViewer from '../components/ReceiptViewer'

export default function Bills() {
  const { expenses, income, properties, loading, propertyNameById, comments, addComment, deleteComment, canWrite } = useData()
  const { user } = useAuth()
  const [assetId, setAssetId] = useState('')
  const [q, setQ] = useState('')
  const [viewing, setViewing] = useState(null)
  const [openId, setOpenId] = useState(null)
  const authorLabel = user?.email || 'You'
  const commentsFor = (b) => comments.filter((c) => c.kind === b.kind && c.entry_id === b.id)

  const bills = useMemo(() => {
    const ex = expenses
      .filter((e) => e.receipt_url)
      .map((e) => ({ ...e, kind: 'expense', label: e.category, party: e.vendor }))
    const inc = income
      .filter((e) => e.receipt_url)
      .map((e) => ({ ...e, kind: 'income', label: e.source, party: e.payer }))
    let all = [...ex, ...inc]
    if (assetId) all = all.filter((b) => b.property_id === assetId)
    const s = q.trim().toLowerCase()
    if (s) {
      all = all.filter((b) =>
        `${b.label || ''} ${b.party || ''} ${propertyNameById(b.property_id) || ''}`.toLowerCase().includes(s),
      )
    }
    return all
  }, [expenses, income, assetId, q, propertyNameById])

  const groups = useMemo(() => {
    const m = new Map()
    for (const b of bills) {
      if (!m.has(b.property_id)) m.set(b.property_id, [])
      m.get(b.property_id).push(b)
    }
    return [...m.entries()]
      .map(([pid, list]) => ({
        pid,
        name: propertyNameById(pid) || 'Unknown asset',
        type: properties.find((p) => p.id === pid)?.type,
        list: list.sort((a, b) => (b.date || '').localeCompare(a.date || '')),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [bills, properties, propertyNameById])

  if (loading) return <Spinner />

  const active = assetId || q

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Bills"
        subtitle={`${bills.length} receipt${bills.length === 1 ? '' : 's'} attached, grouped by asset`}
      />

      <Card className="p-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="relative">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="field-input pl-9"
              placeholder="Search vendor, category, asset…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <select className="field-input" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">All assets</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {active && (
          <button
            onClick={() => {
              setAssetId('')
              setQ('')
            }}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            <X size={13} /> Clear filters
          </button>
        )}
      </Card>

      {groups.length === 0 ? (
        <EmptyState
          icon={Paperclip}
          title="No bills yet"
          subtitle="Attach a receipt or bill photo when adding an expense or income, and it'll show up here grouped by asset."
          action={
            <Link to="/expenses/new" className="btn-primary">
              Add expense
            </Link>
          }
        />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const Icon = iconForAssetType(g.type)
            return (
              <Card key={g.pid} className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                  <Link to={`/properties/${g.pid}`} className="flex items-center gap-2 font-semibold text-slate-800 hover:text-brand">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-light text-brand">
                      <Icon size={16} />
                    </span>
                    {g.name}
                  </Link>
                  <span className="text-xs text-slate-400">
                    {g.list.length} bill{g.list.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="divide-y divide-slate-100">
                  {g.list.map((b) => {
                    const key = `${b.kind}-${b.id}`
                    const cmts = commentsFor(b)
                    const open = openId === key
                    return (
                      <div key={key}>
                        <div className="flex w-full items-center gap-2 px-5 py-3 transition hover:bg-slate-50/70">
                          <button
                            onClick={() => setViewing(b.receipt_url)}
                            className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            title="View bill"
                          >
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500">
                              <Paperclip size={15} />
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <Badge color={b.kind === 'income' ? colorForSource(b.label) : colorForCategory(b.label)}>
                                  {b.label || (b.kind === 'income' ? 'Income' : 'Expense')}
                                </Badge>
                                <span className="text-xs text-slate-400">{formatDate(b.date)}</span>
                              </div>
                              <div className="mt-0.5 truncate text-sm text-slate-600">
                                {b.party || '—'} ·{' '}
                                <span className={b.kind === 'income' ? 'font-medium text-emerald-700' : 'font-medium text-slate-800'}>
                                  {b.kind === 'income' ? '+' : ''}
                                  {formatCurrency(b.amount)}
                                </span>
                              </div>
                            </div>
                            <ExternalLink size={15} className="shrink-0 text-slate-400" />
                          </button>
                          <button
                            onClick={() => setOpenId((cur) => (cur === key ? null : key))}
                            aria-expanded={open}
                            title={cmts.length ? `${cmts.length} comment${cmts.length === 1 ? '' : 's'}` : 'Add a comment'}
                            className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                              open || cmts.length ? 'bg-brand-light text-brand' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                            }`}
                          >
                            <MessageSquare size={15} />
                            {cmts.length > 0 && cmts.length}
                          </button>
                        </div>
                        {open && (
                          <BillCommentPanel
                            comments={cmts}
                            canWrite={canWrite}
                            onAdd={(body) => addComment({ kind: b.kind, entry_id: b.id, body, author: authorLabel })}
                            onDelete={deleteComment}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {viewing && <ReceiptViewer stored={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

// Inline comment thread for a single bill — read for everyone, post/delete when
// the workspace is writable.
function BillCommentPanel({ comments, canWrite, onAdd, onDelete }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    try {
      await onAdd(body)
      setText('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-4">
      {comments.length === 0 ? (
        <p className="text-xs text-slate-400">No comments yet.</p>
      ) : (
        <ul className="space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-light text-[0.7rem] font-semibold text-brand">
                {(c.author || 'U')[0].toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-semibold text-slate-700">{c.author || 'Someone'}</span>
                  <span className="shrink-0 text-[0.65rem] text-slate-400">{formatDate(c.created_at)}</span>
                  {canWrite && (
                    <button
                      onClick={() => onDelete(c.id)}
                      className="ml-auto shrink-0 text-slate-300 transition hover:text-red-600"
                      title="Delete comment"
                      aria-label="Delete comment"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-slate-600">{c.body}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        <form onSubmit={submit} className="mt-3 flex items-start gap-2">
          <textarea
            rows={1}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e)
            }}
            placeholder="Write a comment…"
            className="field-input min-h-[2.5rem] flex-1 resize-y py-2"
          />
          <Button type="submit" loading={busy} disabled={!text.trim()} className="shrink-0">
            <Send size={15} /> Post
          </Button>
        </form>
      ) : (
        <p className="mt-3 text-xs text-slate-400">You have read-only access to this workspace.</p>
      )}
    </div>
  )
}
