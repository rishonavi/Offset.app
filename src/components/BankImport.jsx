import { useRef, useState } from 'react'
import { Landmark, Upload, CheckCircle2, AlertCircle, ArrowRight, Link2 } from 'lucide-react'
import { useData } from '../context/DataContext'
import { parseSpreadsheet } from '../lib/exports'
import { parseStatement, reconcile, parseCSV } from '../lib/statement'
import { buildVendorIndex, suggestCategory } from '../lib/categorize'
import { bankSyncEnabled, bankProviderLabel, startBankLink, fetchLiveTransactions } from '../lib/bankSync'
import { formatCurrency, formatDate } from '../lib/format'
import { Card, Button } from './ui'

const strip = (e) => {
  const { id, user_id, created_at, ...rest } = e // eslint-disable-line no-unused-vars
  return rest
}

// Upload a bank / UPI statement, reconcile it against outstanding bills, then
// mark matched bills paid/received and (optionally) add the rest.
export default function BankImport() {
  const { expenses, income, properties, addExpense, addIncome, updateExpense, updateIncome, propertyNameById, canWrite } = useData()
  const fileRef = useRef(null)
  const [plan, setPlan] = useState(null)
  const [meta, setMeta] = useState(null)
  const [assetId, setAssetId] = useState(properties[0]?.id || '')
  const [addNew, setAddNew] = useState(true)
  const [busy, setBusy] = useState(false)
  const [linking, setLinking] = useState(false)
  const [msg, setMsg] = useState(null)

  const reset = () => {
    setPlan(null)
    setMeta(null)
    setMsg(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  // Shared by file import and live sync: reconcile a set of transactions and
  // show the preview.
  const loadTransactions = (transactions, sourceName) => {
    if (!transactions || transactions.length === 0) {
      setMsg({ ok: false, text: 'No transactions found in that source.' })
      setPlan(null)
      return
    }
    setPlan(reconcile(transactions, expenses, income))
    setMeta({ name: sourceName, count: transactions.length })
    setAssetId((id) => id || properties[0]?.id || '')
  }

  const onFile = async (file) => {
    if (!file) return
    setMsg(null)
    setBusy(true)
    try {
      // CSV: parse as text (keeps day-first dates as strings). Excel: use the
      // spreadsheet reader (dates are unambiguous serials there).
      const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv'
      const rows = isCsv ? parseCSV(await file.text()) : await parseSpreadsheet(file)
      const { transactions } = parseStatement(rows)
      if (transactions.length === 0) {
        setMsg({ ok: false, text: 'Couldn’t find transactions. Expected columns like Date and Debit/Credit (or Amount).' })
        setPlan(null)
        return
      }
      loadTransactions(transactions, file.name)
    } catch (err) {
      setMsg({ ok: false, text: `Could not read that file: ${err?.message || err}` })
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Live connection (optional; needs a provider configured — see docs/BANK_SYNC).
  const NOT_SET_UP =
    'Live bank connection isn’t enabled here. It supports Plaid (US/UK/EU) and Account Aggregator (India) — see docs/BANK_SYNC.md. Import a statement file below in the meantime.'

  const connectLive = async () => {
    setMsg(null)
    if (!bankSyncEnabled) return setMsg({ ok: false, text: NOT_SET_UP })
    setLinking(true)
    try {
      const link = await startBankLink()
      if (link.url) {
        window.open(link.url, '_blank', 'noopener')
        setMsg({ ok: true, text: `Approve access in the ${bankProviderLabel} window, then click “Sync transactions”.` })
      } else {
        setMsg({ ok: true, text: 'Bank link ready — complete it in the provider window, then click “Sync transactions”.' })
      }
    } catch (e) {
      setMsg({ ok: false, text: e?.code === 'not_configured' ? NOT_SET_UP : e?.message || 'Could not start the connection.' })
    } finally {
      setLinking(false)
    }
  }

  const syncLive = async () => {
    setMsg(null)
    setBusy(true)
    try {
      loadTransactions(await fetchLiveTransactions({}), `your bank (${bankProviderLabel})`)
    } catch (e) {
      setMsg({ ok: false, text: e?.code === 'not_configured' ? NOT_SET_UP : e?.message || 'Could not sync transactions.' })
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    setBusy(true)
    setMsg(null)
    try {
      let paid = 0
      let received = 0
      for (const { entry } of plan.matchedPaid) {
        await updateExpense(entry.id, { ...strip(entry), status: 'paid', due_date: null })
        paid++
      }
      for (const { entry } of plan.matchedReceived) {
        await updateIncome(entry.id, { ...strip(entry), status: 'received', due_date: null })
        received++
      }
      let added = 0
      if (addNew && assetId) {
        const index = buildVendorIndex(expenses)
        for (const t of plan.newExpenses) {
          const guess = suggestCategory(t.description, index)
          await addExpense({
            property_id: assetId,
            date: t.date,
            amount: t.amount,
            category: guess?.category || 'Other',
            vendor: '',
            payment_method: 'Bank Transfer',
            status: 'paid',
            description: t.description,
            receipt_url: null,
          })
          added++
        }
        for (const t of plan.newIncome) {
          await addIncome({
            property_id: assetId,
            date: t.date,
            amount: t.amount,
            source: 'Other',
            payer: '',
            payment_method: 'Bank Transfer',
            status: 'received',
            description: t.description,
            receipt_url: null,
          })
          added++
        }
      }
      reset()
      setMsg({
        ok: true,
        text: `Reconciled: ${paid} expense${paid === 1 ? '' : 's'} marked paid, ${received} income marked received${
          added ? `, ${added} new transaction${added === 1 ? '' : 's'} added` : ''
        }.`,
      })
    } catch (err) {
      setMsg({ ok: false, text: `Import failed: ${err?.message || err}` })
    } finally {
      setBusy(false)
    }
  }

  const matchedCount = plan ? plan.matchedPaid.length + plan.matchedReceived.length : 0
  const newCount = plan ? plan.newExpenses.length + plan.newIncome.length : 0

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Landmark size={16} className="text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-700">Bank &amp; UPI statement</h2>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Export your transactions from your bank or Google Pay / PhonePe (CSV or Excel) and upload here. Offset finds which of
        your <strong>unpaid bills</strong> the statement settles and marks them done — the rest can be added in one tap.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0])}
        disabled={!canWrite}
      />

      {!plan && (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <Link2 size={15} className="text-slate-500" /> Connect a bank (live)
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wide text-slate-500">
                  {bankSyncEnabled ? bankProviderLabel : 'Setup required'}
                </span>
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={connectLive} loading={linking} disabled={!canWrite} className="px-3 py-1.5 text-[0.65rem]">
                  Connect
                </Button>
                {bankSyncEnabled && (
                  <Button variant="ghost" onClick={syncLive} loading={busy} disabled={!canWrite} className="px-3 py-1.5 text-[0.65rem]">
                    Sync transactions
                  </Button>
                )}
              </div>
            </div>
            <p className="mt-1.5 text-[0.7rem] text-slate-400">
              Pull transactions straight from your bank — no file needed. Uses Plaid or an Account Aggregator (India).
              {!bankSyncEnabled && ' Not enabled on this deployment.'}
            </p>
          </div>

          <div className="flex items-center gap-2 text-[0.7rem] uppercase tracking-wide text-slate-400">
            <span className="h-px flex-1 bg-slate-200" /> or import a file <span className="h-px flex-1 bg-slate-200" />
          </div>

          <Button variant="ghost" onClick={() => fileRef.current?.click()} loading={busy} disabled={!canWrite}>
            {!busy && <Upload size={16} />} Choose statement…
          </Button>
        </div>
      )}

      {plan && (
        <div className="mt-4 space-y-4">
          <div className="text-xs text-slate-500">
            Read <strong>{meta?.count}</strong> transactions from <span className="font-medium text-slate-700">{meta?.name}</span>.
          </div>

          {matchedCount > 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                <CheckCircle2 size={14} /> {matchedCount} payment{matchedCount === 1 ? '' : 's'} confirmed in your statement
              </div>
              <ul className="divide-y divide-emerald-100/70">
                {plan.matchedPaid.map(({ entry, txn }, i) => (
                  <li key={`p${i}`} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <span className="min-w-0 truncate text-slate-600">
                      {entry.category || 'Expense'} · {propertyNameById(entry.property_id) || '—'}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-slate-500">
                      {formatCurrency(txn.amount)} · {formatDate(txn.date)}
                      <ArrowRight size={12} /> <span className="font-semibold text-emerald-700">mark paid</span>
                    </span>
                  </li>
                ))}
                {plan.matchedReceived.map(({ entry, txn }, i) => (
                  <li key={`r${i}`} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <span className="min-w-0 truncate text-slate-600">
                      {entry.source || 'Income'} · {propertyNameById(entry.property_id) || '—'}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 text-slate-500">
                      {formatCurrency(txn.amount)} · {formatDate(txn.date)}
                      <ArrowRight size={12} /> <span className="font-semibold text-emerald-700">mark received</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
              No outstanding bills matched this statement. Nothing was pending, or amounts/dates didn’t line up.
            </div>
          )}

          {newCount > 0 && (
            <div className="rounded-xl border border-slate-200 p-3">
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" className="mt-1" checked={addNew} onChange={(e) => setAddNew(e.target.checked)} />
                <span>
                  Also add <strong>{newCount}</strong> unmatched transaction{newCount === 1 ? '' : 's'} (
                  {plan.newExpenses.length} expense{plan.newExpenses.length === 1 ? '' : 's'}, {plan.newIncome.length} income) as new entries.
                </span>
              </label>
              {addNew && (
                <div className="mt-3">
                  <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-slate-400">Add them to asset</span>
                  <select className="field-input w-full sm:w-auto" aria-label="Assign imported rows to asset" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[0.7rem] text-slate-400">Categories are guessed from the description — review them on the Expenses page after.</p>
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={apply} loading={busy} disabled={matchedCount === 0 && !(addNew && newCount > 0)}>
              {!busy && <CheckCircle2 size={16} />} Apply
            </Button>
            <Button variant="ghost" onClick={reset} disabled={busy}>
              Choose different file
            </Button>
          </div>
        </div>
      )}

      {msg && (
        <div className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {msg.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
          {msg.text}
        </div>
      )}
    </Card>
  )
}
