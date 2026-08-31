import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, Loader2, Sparkles, Plus, X, Building2, Inbox } from 'lucide-react'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { usePlan } from '../context/PlanContext'
import { db } from '../lib/storage'
import { CATEGORIES } from '../lib/constants'
import { currencySymbol, todayISO } from '../lib/format'
import { gmailConfigured, connectGmail, isGmailConnected, fetchBillCandidates, attachmentToFile } from '../lib/gmail'
import { Card, Button, EmptyState, Spinner } from '../components/ui'
import PageHeader from '../components/PageHeader'
import BankImport from '../components/BankImport'

export default function ImportBills() {
  const { properties, loading, addExpense } = useData()
  const toast = useToast()
  const plan = usePlan()
  const [rows, setRows] = useState([])
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [scanned, setScanned] = useState(false)
  const [error, setError] = useState(null)

  if (loading) return <Spinner />

  const firstAsset = properties[0]?.id || ''

  const run = async () => {
    setError(null)
    setScanning(true)
    setProgress({ done: 0, total: 0 })
    try {
      if (!isGmailConnected()) await connectGmail()
      const cands = await fetchBillCandidates({ max: 15, onProgress: (done, total) => setProgress({ done, total }) })
      setRows(
        cands.map((c, i) => ({
          key: `${c.id}-${i}`,
          subject: c.subject,
          from: c.from,
          mimeType: c.mimeType,
          data: c.data,
          filename: c.filename,
          date: c.parsed?.date || todayISO(),
          amount: c.parsed?.amount != null ? String(c.parsed.amount) : '',
          tax: c.parsed?.tax != null ? String(c.parsed.tax) : '',
          category: c.parsed?.category || '',
          vendor: c.parsed?.vendor || '',
          property_id: firstAsset,
          status: 'idle',
          read: c.parsed?.amount != null || !!c.parsed?.date,
        })),
      )
      setScanned(true)
      if (cands.length === 0) setError('No bills with attachments found in the last 120 days.')
    } catch (err) {
      setError(err?.message || 'Could not read your Gmail.')
    } finally {
      setScanning(false)
    }
  }

  const upd = (key, field) => (e) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [field]: e.target.value } : r)))

  const dismiss = (key) => setRows((rs) => rs.filter((r) => r.key !== key))

  const addRow = async (row) => {
    if (!row.property_id) return toast('Pick an asset for this bill first.', { type: 'error' })
    const amount = Number(row.amount)
    if (!amount || amount <= 0) return toast('Enter an amount greater than zero.', { type: 'error' })
    setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, status: 'adding' } : r)))
    try {
      const receipt_url = await db.uploadReceipt(attachmentToFile(row))
      await addExpense({
        property_id: row.property_id,
        date: row.date || todayISO(),
        amount,
        tax: row.tax === '' ? null : Number(row.tax),
        category: row.category || 'Other',
        vendor: row.vendor || '',
        payment_method: '',
        status: 'paid',
        due_date: null,
        description: row.subject ? `From email: ${row.subject}`.slice(0, 180) : '',
        receipt_url: receipt_url || null,
      })
      dismiss(row.key)
      toast('Bill added')
    } catch (err) {
      setRows((rs) => rs.map((r) => (r.key === row.key ? { ...r, status: 'idle' } : r)))
      toast(err?.message || 'Could not add this bill.', { type: 'error' })
    }
  }

  const addAll = async () => {
    for (const row of [...rows]) {
      if (row.property_id && Number(row.amount) > 0) await addRow(row)
    }
  }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Import"
        subtitle="Reconcile a bank / UPI statement to see which bills are paid, or pull invoices from your inbox."
      />

      {properties.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Add an asset first"
          subtitle="Imported entries are logged against an asset, so create one before importing."
          action={
            <Link to="/properties/new" className="btn-primary">
              <Plus size={16} /> Add asset
            </Link>
          }
        />
      ) : (
        <>
          <BankImport />

          <div className="space-y-6 border-t border-border-light pt-6">
            <h2 className="text-sm font-semibold uppercase tracking-[1px] text-ink-5">Bills from Gmail</h2>
            {plan && plan.billingEnabled && !plan.can('gmailImport') ? (
              <Card className="flex flex-col items-start gap-3 p-6">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-gold/15 text-gold">
                  <Mail size={20} />
                </span>
                <div>
                  <p className="font-semibold text-ink-2">Importing bills from Gmail is a Pro feature.</p>
                  <p className="mt-1 text-sm text-ink-5">Upgrade to read invoices straight from your inbox with Gemini.</p>
                </div>
                <Link to="/settings" className="btn-primary">
                  Upgrade to Pro
                </Link>
              </Card>
            ) : !gmailConfigured ? (
              <Card className="p-5 text-sm text-ink-4">
                <p className="font-semibold text-ink-2">Gmail import isn’t set up yet.</p>
                <p className="mt-2">
                  It uses the same <code className="bg-surface-chip px-1">VITE_GOOGLE_CLIENT_ID</code> as Drive backup. In Google Cloud:
                  enable the <strong>Gmail API</strong>, add the <strong>gmail.readonly</strong> scope to your OAuth consent screen,
                  add yourself as a <strong>Test user</strong>, then redeploy. (Gmail is a Google “restricted” scope, so it works for
                  your own account; opening it to everyone needs Google’s security review.)
                </p>
              </Card>
            ) : (
              <>
          <Card className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-light text-brand">
                <Mail size={18} />
              </span>
              <div className="text-sm text-ink-4">
                Reads up to 15 recent emails with bill/invoice attachments. Nothing is stored — it runs in your browser with your Google login.
              </div>
            </div>
            <Button onClick={run} loading={scanning} className="shrink-0">
              {!scanning && <Sparkles size={16} />}
              {scanning
                ? progress.total
                  ? `Reading ${progress.done}/${progress.total}…`
                  : 'Connecting…'
                : isGmailConnected()
                  ? 'Rescan inbox'
                  : 'Connect Gmail & scan'}
            </Button>
          </Card>

          {error && <p className="text-sm text-red-600">{error}</p>}

          {rows.length > 0 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-ink-5">
                {rows.length} bill{rows.length === 1 ? '' : 's'} found — review and add.
              </p>
              <Button variant="ghost" onClick={addAll}>
                <Plus size={15} /> Add all
              </Button>
            </div>
          )}

          {scanned && rows.length === 0 && !error && (
            <EmptyState icon={Inbox} title="Nothing to import" subtitle="No new bill emails with attachments were found." />
          )}

          <div className="space-y-3">
            {rows.map((r) => (
              <Card key={r.key} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-ink-2">{r.subject || r.filename}</div>
                    <div className="truncate text-xs text-ink-6">{r.from}</div>
                  </div>
                  <button onClick={() => dismiss(r.key)} className="shrink-0 text-ink-6 hover:text-ink-3" title="Dismiss">
                    <X size={16} />
                  </button>
                </div>

                {!r.read && (
                  <p className="mt-2 text-xs text-amber-600">Couldn’t auto-read this one — please fill the details in.</p>
                )}

                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  <label className="flex flex-col gap-1">
                    <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-ink-6">Date</span>
                    <input type="date" className="field-input min-w-0" value={r.date} onChange={upd(r.key, 'date')} max={todayISO()} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-ink-6">Amount</span>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-ink-5">{currencySymbol}</span>
                      <input type="number" inputMode="decimal" className="field-input min-w-0 pl-6" value={r.amount} onChange={upd(r.key, 'amount')} placeholder="0" />
                    </div>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-ink-6">Category</span>
                    <input list="import-categories" className="field-input min-w-0" value={r.category} onChange={upd(r.key, 'category')} placeholder="Category" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-ink-6">Vendor</span>
                    <input className="field-input min-w-0" value={r.vendor} onChange={upd(r.key, 'vendor')} placeholder="Vendor" />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-ink-6">Asset</span>
                    <select className="field-input min-w-0" value={r.property_id} onChange={upd(r.key, 'property_id')}>
                      {properties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="mt-3 flex justify-end">
                  <Button onClick={() => addRow(r)} loading={r.status === 'adding'}>
                    {r.status !== 'adding' && <Plus size={15} />} Add expense
                  </Button>
                </div>
              </Card>
            ))}
          </div>

          <datalist id="import-categories">
            {CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
