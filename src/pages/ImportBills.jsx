import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Mail, Loader2, Sparkles, Plus, X, Building2, Inbox, Upload, Calculator, CheckCircle2, AlertCircle, DownloadCloud, FileUp, FileSpreadsheet } from 'lucide-react'
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
import { parseSpreadsheet, rowToExpenseInput } from '../lib/exports'
import { parseTallyXML } from '../lib/tally'
import { useBackup } from '../lib/useBackup'

function ImportResult({ msg, source }) {
  if (!msg || msg.source !== source) return null
  return (
    <div
      role="status"
      className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
        msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
      }`}
    >
      {msg.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
      {msg.text}
    </div>
  )
}

export default function ImportBills() {
  const { properties, loading, addExpense, addIncome, addProperty, propertyNameById } = useData()
  const toast = useToast()
  const plan = usePlan()
  // Every way data comes in now lives here — a mailbox, a spreadsheet, a Tally
  // export, a backup file. They were spread across two pages, one of which was
  // called Export.
  // Which import is running, so only that card's button spins.
  const [importing, setImporting] = useState(null)
  const [importMsg, setImportMsg] = useState(null)
  const fileRef = useRef(null)
  const tallyRef = useRef(null)
  const backup = useBackup(`offset-${new Date().toISOString().slice(0, 10)}`)
  const [rows, setRows] = useState([])
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [scanned, setScanned] = useState(false)
  const [error, setError] = useState(null)

  if (loading) return <Spinner />

  const firstAsset = properties[0]?.id || ''

  const handleImport = async (file) => {
    if (!file) return
    setImporting('sheet')
    setImportMsg(null)
    try {
      const raw = await parseSpreadsheet(file)
      const parsed = raw.map(rowToExpenseInput).filter((r) => r.amount > 0 && r.date)
      if (parsed.length === 0) {
        setImportMsg({ source: 'sheet', ok: false, text: 'No valid rows found. Expected columns: Date, Property, Category, Amount.' })
        return
      }
      const nameToId = new Map(properties.map((p) => [p.name.trim().toLowerCase(), p.id]))
      let createdProps = 0
      for (const r of parsed) {
        const propName = r.property || 'Unassigned'
        const key = propName.toLowerCase()
        let pid = nameToId.get(key)
        if (!pid) {
          const created = await addProperty({ name: propName, type: 'Other', address: '', notes: '' })
          pid = created.id
          nameToId.set(key, pid)
          createdProps += 1
        }
        await addExpense({
          property_id: pid,
          date: r.date,
          amount: r.amount,
          category: r.category || 'Other',
          vendor: r.vendor,
          payment_method: r.payment_method,
          description: r.description,
          receipt_url: null,
        })
      }
      setImportMsg({
        source: 'sheet',
        ok: true,
        text: `Imported ${parsed.length} expense${parsed.length === 1 ? '' : 's'}${
          createdProps ? `, created ${createdProps} new propert${createdProps === 1 ? 'y' : 'ies'}` : ''
        }.`,
      })
    } catch (err) {
      setImportMsg({ source: 'sheet', ok: false, text: `Import failed: ${err?.message || err}` })
    } finally {
      setImporting(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Import a Tally XML export — Payment/Purchase vouchers become expenses,
  // Receipt/Sales become income. Each voucher is matched to an asset named in
  // its narration, else filed under a single "Imported from Tally" asset.
  const handleTallyImport = async (file) => {
    if (!file) return
    setImporting('tally')
    setImportMsg(null)
    try {
      const vouchers = parseTallyXML(await file.text())
      if (vouchers.length === 0) {
        setImportMsg({ source: 'tally', ok: false, text: 'No vouchers found in that Tally file.' })
        return
      }
      const nameToId = new Map(properties.map((p) => [p.name.trim().toLowerCase(), p.id]))
      const matchAsset = (narration) => {
        for (const seg of (narration || '').split('·').map((s) => s.trim().toLowerCase())) {
          if (seg && nameToId.has(seg)) return nameToId.get(seg)
        }
        return null
      }
      let fallbackId = nameToId.get('imported from tally') || null
      const ensureFallback = async () => {
        if (fallbackId) return fallbackId
        const created = await addProperty({ name: 'Imported from Tally', type: 'Other', address: '', notes: '' })
        fallbackId = created.id
        nameToId.set('imported from tally', fallbackId)
        return fallbackId
      }
      // Skip entries that already exist so re-importing the same day book is safe.
      const expSeen = new Set(expenses.map((e) => `${e.property_id}|${e.date}|${Number(e.amount)}|${e.category}`))
      const incSeen = new Set(income.map((e) => `${e.property_id}|${e.date}|${Number(e.amount)}|${e.source}`))
      let addedE = 0
      let addedI = 0
      let skipped = 0
      for (const v of vouchers) {
        const pid = matchAsset(v.narration) || (await ensureFallback())
        const key = `${pid}|${v.date}|${v.amount}|${v.ledger}`
        if (v.kind === 'income') {
          if (incSeen.has(key)) { skipped++; continue }
          incSeen.add(key)
          await addIncome({ property_id: pid, date: v.date, amount: v.amount, source: v.ledger, payer: '', payment_method: v.payment_method, status: 'received', description: v.narration, receipt_url: null })
          addedI++
        } else {
          if (expSeen.has(key)) { skipped++; continue }
          expSeen.add(key)
          await addExpense({ property_id: pid, date: v.date, amount: v.amount, category: v.ledger, vendor: '', payment_method: v.payment_method, status: 'paid', description: v.narration, receipt_url: null })
          addedE++
        }
      }
      setImportMsg({
        source: 'tally',
        ok: true,
        text: `Imported ${addedE} expense${addedE === 1 ? '' : 's'} and ${addedI} income from Tally${skipped ? `, skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}` : ''}.`,
      })
    } catch (err) {
      setImportMsg({ source: 'tally', ok: false, text: `Tally import failed: ${err?.message || err}` })
    } finally {
      setImporting(null)
      if (tallyRef.current) tallyRef.current.value = ''
    }
  }

  // Attachments live in IndexedDB and the rows carry only a token, which means
  // nothing on the device a backup is restored to. So the files travel with it,
  // inlined the way they used to be stored — a backup that quietly leaves the
  // receipts behind is worse than one that is honestly large.

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
        subtitle="Everything that comes in: a bank statement, your inbox, a spreadsheet, Tally, or a backup."
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

        {/* A spreadsheet and a Tally export are different errands with
            different files and different rules, and Tally was a paragraph
            below a horizontal rule inside somebody else's card — findable only
            if you already knew it was there. */}
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={16} className="text-emerald-600" />
            <h2 className="text-sm font-semibold text-ink-3">From a spreadsheet</h2>
          </div>
          <p className="mt-1 text-xs text-ink-5">
            An <strong>.xlsx</strong> or <strong>.csv</strong> with columns:
            <span className="font-medium text-ink-4"> Date, Property, Category, Vendor, Payment Method, Description, Amount</span>.
            New property names are created automatically.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => handleImport(e.target.files?.[0])}
          />
          <div className="mt-4">
            <Button variant="ghost" onClick={() => fileRef.current?.click()} loading={importing === 'sheet'}>
              {importing !== 'sheet' && <Upload size={16} />} Choose file…
            </Button>
          </div>
          <ImportResult msg={importMsg} source="sheet" />
        </Card>

        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Calculator size={16} className="text-indigo-600" />
            <h2 className="text-sm font-semibold text-ink-3">From Tally</h2>
          </div>
          <p className="mt-1 text-xs text-ink-5">
            A <strong>Tally XML</strong> export — Day Book or Voucher Register. Payment and Purchase vouchers become
            expenses, Receipt and Sales become income, each matched to the asset named in the voucher. Duplicates are
            skipped, so re-importing the same file is safe.
          </p>
          <p className="mt-2 text-[0.7rem] text-ink-6">
            In TallyPrime: Gateway of Tally → Display More Reports → Day Book → Export.
          </p>
          <input
            ref={tallyRef}
            type="file"
            accept=".xml,text/xml,application/xml"
            className="hidden"
            onChange={(e) => handleTallyImport(e.target.files?.[0])}
          />
          <div className="mt-4">
            <Button variant="ghost" onClick={() => tallyRef.current?.click()} loading={importing === 'tally'}>
              {importing !== 'tally' && <Calculator size={16} className="text-indigo-600" />} Choose Tally XML…
            </Button>
          </div>
          <ImportResult msg={importMsg} source="tally" />
        </Card>


          {/* Restoring is an import too: it is a file arriving, not one
              leaving. Its other half — making the backup — sits on the export
              page, and both call the same hook so the format cannot drift. */}
          <Card className="p-5">
            <div className="flex items-center gap-2">
              <DownloadCloud size={16} className="text-ink-5" />
              <h2 className="text-sm font-semibold text-ink-3">Restore a backup</h2>
            </div>
            <p className="mt-1 text-xs text-ink-5">
              From a backup file, or from the cloud account you backed up to. Entries are added, not replaced.
            </p>
            <input
              ref={backup.backupFileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => backup.restoreFromFile(e.target.files?.[0])}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => backup.backupFileRef.current?.click()} loading={backup.busy}>
                {!backup.busy && <FileUp size={16} />} Restore from file
              </Button>
              {backup.providers.length > 0 && (
                <>
                  <select
                    className="field-input w-auto"
                    aria-label="Cloud account"
                    value={backup.providerId}
                    onChange={(e) => backup.setProviderId(e.target.value)}
                  >
                    {backup.providers.map((x) => (
                      <option key={x.id} value={x.id}>{x.label}</option>
                    ))}
                  </select>
                  <Button variant="ghost" onClick={backup.cloudRestore} loading={backup.busy}>
                    {!backup.busy && <DownloadCloud size={16} className="text-sky-600" />} Restore from cloud
                  </Button>
                </>
              )}
            </div>
            {backup.msg && (
              <div className={`mt-3 flex items-start gap-2 px-3 py-2 text-sm ${backup.msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {backup.msg.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
                {backup.msg.text}
              </div>
            )}
          </Card>

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
