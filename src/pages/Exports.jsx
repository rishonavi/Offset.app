import { useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { FileSpreadsheet, FileText, FileType, Upload, Download, CheckCircle2, AlertCircle, Cloud, UploadCloud, DownloadCloud, Calculator, PieChart } from 'lucide-react'
import { useData } from '../context/DataContext'
import { applyFilters, sumAmount } from '../lib/filters'
import { useFilterParams } from '../lib/useFilterParams'
import { formatCurrency } from '../lib/format'
import { isBlobToken, blobToDataUrl } from '../lib/storage/blobs'
import {
  toExportRows,
  toIncomeRows,
  exportWorkbook,
  exportCSV,
  exportPDF,
  parseSpreadsheet,
  rowToExpenseInput,
} from '../lib/exports'
import { toTallyXML, parseTallyXML } from '../lib/tally'
import { cloudProviders } from '../lib/cloud'
import { Card, Button, Spinner } from '../components/ui'
import PageHeader from '../components/PageHeader'
import FilterBar from '../components/FilterBar'

// Getting data out of Offset, and back in.
//
// This used to share a page with the year-end summary under the heading
// "Reports & Export", which put two different errands behind one door: reading
// what the year came to, and moving the rows somewhere else. They ask the same
// question of the same records — which entries, over which period — so the
// filter lives in the URL and follows you between the two rather than being
// built twice.
export default function Exports() {
  const { expenses, income, properties, loading, propertyNameById, addProperty, addExpense, addIncome } = useData()
  const [filters, setFilters] = useFilterParams()
  const { search } = useLocation()
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState(null)
  const fileRef = useRef(null)
  const tallyRef = useRef(null)
  const backupFileRef = useRef(null)
  const [cloudBusy, setCloudBusy] = useState(false)
  const [cloudMsg, setCloudMsg] = useState(null)
  const [providerId, setProviderId] = useState(cloudProviders[0]?.id || '')

  const filtered = useMemo(() => applyFilters(expenses, filters), [expenses, filters])
  const total = useMemo(() => sumAmount(filtered), [filtered])

  // Income matching the same property + date range (category/text don't apply).
  const incomeFiltered = useMemo(
    () =>
      income.filter((e) => {
        if (filters.propertyId && e.property_id !== filters.propertyId) return false
        if (filters.from && (e.date || '') < filters.from) return false
        if (filters.to && (e.date || '') > filters.to) return false
        return true
      }),
    [income, filters],
  )

  const baseName = `property-expenses-${new Date().toISOString().slice(0, 10)}`
  const subtitle = `${filtered.length} expense${filtered.length === 1 ? '' : 's'} · Total ${formatCurrency(total)}`

  const doExport = (kind) => {
    const rows = toExportRows(filtered, propertyNameById)
    if (kind === 'xlsx')
      exportWorkbook({ expenses: rows, income: toIncomeRows(incomeFiltered, propertyNameById) }, baseName)
    if (kind === 'csv') exportCSV(rows, baseName)
    if (kind === 'pdf') exportPDF(rows, { title: 'Offset — Expense Report', subtitle })
  }

  // Tally-importable XML (Payment vouchers for expenses, Receipt for income).
  const exportTally = () => {
    const xml = toTallyXML({ expenses: filtered, income: incomeFiltered, propertyNameById, company: 'Offset' })
    const blob = new Blob([xml], { type: 'application/xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${baseName}-tally.xml`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (file) => {
    if (!file) return
    setImporting(true)
    setImportMsg(null)
    try {
      const raw = await parseSpreadsheet(file)
      const parsed = raw.map(rowToExpenseInput).filter((r) => r.amount > 0 && r.date)
      if (parsed.length === 0) {
        setImportMsg({ ok: false, text: 'No valid rows found. Expected columns: Date, Property, Category, Amount.' })
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
        ok: true,
        text: `Imported ${parsed.length} expense${parsed.length === 1 ? '' : 's'}${
          createdProps ? `, created ${createdProps} new propert${createdProps === 1 ? 'y' : 'ies'}` : ''
        }.`,
      })
    } catch (err) {
      setImportMsg({ ok: false, text: `Import failed: ${err?.message || err}` })
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  // Import a Tally XML export — Payment/Purchase vouchers become expenses,
  // Receipt/Sales become income. Each voucher is matched to an asset named in
  // its narration, else filed under a single "Imported from Tally" asset.
  const handleTallyImport = async (file) => {
    if (!file) return
    setImporting(true)
    setImportMsg(null)
    try {
      const vouchers = parseTallyXML(await file.text())
      if (vouchers.length === 0) {
        setImportMsg({ ok: false, text: 'No vouchers found in that Tally file.' })
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
        ok: true,
        text: `Imported ${addedE} expense${addedE === 1 ? '' : 's'} and ${addedI} income from Tally${skipped ? `, skipped ${skipped} duplicate${skipped === 1 ? '' : 's'}` : ''}.`,
      })
    } catch (err) {
      setImportMsg({ ok: false, text: `Tally import failed: ${err?.message || err}` })
    } finally {
      setImporting(false)
      if (tallyRef.current) tallyRef.current.value = ''
    }
  }

  // Attachments live in IndexedDB and the rows carry only a token, which means
  // nothing on the device a backup is restored to. So the files travel with it,
  // inlined the way they used to be stored — a backup that quietly leaves the
  // receipts behind is worse than one that is honestly large.
  const withAttachments = async (rows) =>
    Promise.all(
      rows.map(async (row) => {
        if (!isBlobToken(row.receipt_url)) return row
        const inlined = await blobToDataUrl(row.receipt_url).catch(() => null)
        return { ...row, receipt_url: inlined || null }
      }),
    )

  const buildPayload = async () => ({
    version: 1,
    exportedAt: new Date().toISOString(),
    properties,
    expenses: await withAttachments(expenses),
    income: await withAttachments(income),
  })

  // Recreate assets/expenses/income from a backup object (matches assets by
  // name; additive). Shared by every cloud provider and the file restore.
  const importBackup = async (data) => {
    const oldIdToName = new Map((data.properties || []).map((p) => [p.id, p.name]))
    const nameToId = new Map(properties.map((p) => [p.name.trim().toLowerCase(), p.id]))
    let createdProps = 0
    let addedExp = 0
    let addedInc = 0
    for (const p of data.properties || []) {
      const key = (p.name || '').trim().toLowerCase()
      if (!key) continue
      if (!nameToId.has(key)) {
        const np = await addProperty({
          name: p.name,
          type: p.type || 'Other',
          address: p.address || '',
          notes: p.notes || '',
          monthly_budget: p.monthly_budget ?? null,
          value: p.value ?? null,
        })
        nameToId.set(key, np.id)
        createdProps += 1
      }
    }
    for (const e of data.expenses || []) {
      const pid = nameToId.get((oldIdToName.get(e.property_id) || '').trim().toLowerCase())
      if (!pid) continue
      await addExpense({
        property_id: pid,
        date: e.date,
        amount: Number(e.amount) || 0,
        category: e.category || 'Other',
        vendor: e.vendor || '',
        payment_method: e.payment_method || '',
        status: e.status || 'paid',
        due_date: e.due_date || null,
        tax: e.tax ?? null,
        description: e.description || '',
        receipt_url: null,
      })
      addedExp += 1
    }
    for (const e of data.income || []) {
      const pid = nameToId.get((oldIdToName.get(e.property_id) || '').trim().toLowerCase())
      if (!pid) continue
      await addIncome({
        property_id: pid,
        date: e.date,
        amount: Number(e.amount) || 0,
        source: e.source || 'Other',
        payer: e.payer || '',
        payment_method: e.payment_method || '',
        status: e.status || 'received',
        due_date: e.due_date || null,
        tax: e.tax ?? null,
        description: e.description || '',
        receipt_url: null,
      })
      addedInc += 1
    }
    return { createdProps, addedExp, addedInc }
  }

  const provider = cloudProviders.find((p) => p.id === providerId)

  const cloudBackup = async () => {
    if (!provider) return
    setCloudBusy(true)
    setCloudMsg(null)
    try {
      await provider.backup(await buildPayload())
      setCloudMsg({ ok: true, text: `Backed up your data to ${provider.label}.` })
    } catch (err) {
      setCloudMsg({ ok: false, text: err?.message || String(err) })
    } finally {
      setCloudBusy(false)
    }
  }

  const cloudRestore = async () => {
    if (!provider) return
    if (!window.confirm(`Restore adds the records from your ${provider.label} backup to this account. Continue?`)) return
    setCloudBusy(true)
    setCloudMsg(null)
    try {
      const data = await provider.restore()
      if (!data) {
        setCloudMsg({ ok: false, text: `No backup found in your ${provider.label}.` })
        return
      }
      const { createdProps, addedExp, addedInc } = await importBackup(data)
      setCloudMsg({
        ok: true,
        text: `Restored ${addedExp} expenses, ${addedInc} income${createdProps ? `, created ${createdProps} assets` : ''} from ${provider.label}.`,
      })
    } catch (err) {
      setCloudMsg({ ok: false, text: err?.message || String(err) })
    } finally {
      setCloudBusy(false)
    }
  }

  const downloadBackup = async () => {
    const blob = new Blob([JSON.stringify(await buildPayload(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${baseName}-backup.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const restoreFromFile = async (file) => {
    if (!file) return
    setCloudBusy(true)
    setCloudMsg(null)
    try {
      const data = JSON.parse(await file.text())
      const { createdProps, addedExp, addedInc } = await importBackup(data)
      setCloudMsg({
        ok: true,
        text: `Restored ${addedExp} expenses, ${addedInc} income${createdProps ? `, created ${createdProps} assets` : ''} from file.`,
      })
    } catch (err) {
      setCloudMsg({ ok: false, text: `Could not read backup file: ${err?.message || err}` })
    } finally {
      setCloudBusy(false)
      if (backupFileRef.current) backupFileRef.current.value = ''
    }
  }

  if (loading) return <Spinner />

  if (loading) return <Spinner />

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Export & import"
        subtitle="Filter first, then take the rows out as Excel, CSV, PDF or Tally — or bring them in."
        action={
          <Link to={{ pathname: '/reports', search }} className="btn-ghost">
            <PieChart size={15} /> See the summary
          </Link>
        }
      />

      <FilterBar properties={properties} value={filters} onChange={setFilters} />


      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Export */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink-3">Export</h2>
          <p className="mt-1 text-xs text-ink-5">{subtitle}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => doExport('xlsx')} disabled={filtered.length === 0}>
              <FileSpreadsheet size={16} className="text-emerald-600" /> Excel (.xlsx)
            </Button>
            <Button variant="ghost" onClick={() => doExport('csv')} disabled={filtered.length === 0}>
              <FileType size={16} className="text-sky-600" /> CSV
            </Button>
            <Button variant="ghost" onClick={() => doExport('pdf')} disabled={filtered.length === 0}>
              <FileText size={16} className="text-red-600" /> PDF
            </Button>
            <Button variant="ghost" onClick={exportTally} disabled={filtered.length === 0 && incomeFiltered.length === 0}>
              <Calculator size={16} className="text-indigo-600" /> Tally (XML)
            </Button>
          </div>
          <p className="mt-3 text-[0.7rem] text-ink-6">
            Excel includes a separate <strong>Income</strong> sheet. CSV/PDF cover expenses; the year-end PDF below covers income, expenses &amp; tax by year and a deductible breakdown by category.
            <br />
            <strong>Tally</strong> exports the filtered income &amp; expenses as import-ready vouchers — in TallyPrime: Gateway of Tally → Import → Vouchers.
          </p>
        </Card>

        {/* Import */}
        <Card className="p-5">
          <h2 className="text-sm font-semibold text-ink-3">Import from spreadsheet</h2>
          <p className="mt-1 text-xs text-ink-5">
            Upload an <strong>.xlsx</strong> or <strong>.csv</strong> with columns:
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
            <Button variant="ghost" onClick={() => fileRef.current?.click()} loading={importing}>
              {!importing && <Upload size={16} />} Choose file…
            </Button>
          </div>

          <div className="mt-4 border-t border-line pt-4">
            <p className="text-xs text-ink-5">
              Or import a <strong>Tally XML</strong> export (Day Book / Voucher Register). Payment/Purchase vouchers become
              expenses and Receipt/Sales become income, matched to the asset named in each voucher. Duplicates are skipped.
            </p>
            <input
              ref={tallyRef}
              type="file"
              accept=".xml,text/xml,application/xml"
              className="hidden"
              onChange={(e) => handleTallyImport(e.target.files?.[0])}
            />
            <div className="mt-3">
              <Button variant="ghost" onClick={() => tallyRef.current?.click()} loading={importing}>
                {!importing && <Calculator size={16} className="text-indigo-600" />} Import Tally XML
              </Button>
            </div>
          </div>

          {importMsg && (
            <div
              className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
                importMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
              }`}
            >
              {importMsg.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
              {importMsg.text}
            </div>
          )}
        </Card>
      </div>

      {/* Backup & restore */}
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <Cloud size={16} className="text-ink-5" />
          <h2 className="text-sm font-semibold text-ink-3">Backup &amp; restore</h2>
        </div>

        {cloudProviders.length > 0 ? (
          <div className="mt-3">
            <p className="text-xs text-ink-5">
              Connect a cloud account to keep a private backup of your assets, expenses &amp; income, and restore it
              on any device. (Receipts stay in Supabase.)
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select className="field-input w-auto" aria-label="Accounting format" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
                {cloudProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <Button variant="ghost" onClick={cloudBackup} loading={cloudBusy}>
                {!cloudBusy && <UploadCloud size={16} className="text-emerald-600" />} Back up
              </Button>
              <Button variant="ghost" onClick={cloudRestore} loading={cloudBusy}>
                {!cloudBusy && <DownloadCloud size={16} className="text-sky-600" />} Restore
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-ink-5">
            Connect a cloud account by adding a client ID — Google Drive (<code className="bg-surface-chip px-1">VITE_GOOGLE_CLIENT_ID</code>),
            Dropbox (<code className="bg-surface-chip px-1">VITE_DROPBOX_APP_KEY</code>) or OneDrive (<code className="bg-surface-chip px-1">VITE_MS_CLIENT_ID</code>).
            See the README. You can still use a backup file below.
          </p>
        )}

        <div className="mt-4 border-t border-line pt-4">
          <p className="text-xs text-ink-5">
            Or use a <strong>backup file</strong> — download it and keep it in iCloud Drive, Dropbox or anywhere; restore it on any device.
          </p>
          <input
            ref={backupFileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => restoreFromFile(e.target.files?.[0])}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="ghost" onClick={downloadBackup}>
              <Download size={16} className="text-ink-4" /> Download backup
            </Button>
            <Button variant="ghost" onClick={() => backupFileRef.current?.click()} loading={cloudBusy}>
              {!cloudBusy && <Upload size={16} />} Restore from file
            </Button>
          </div>
        </div>

        {cloudMsg && (
          <div
            className={`mt-3 flex items-start gap-2 px-3 py-2 text-sm ${
              cloudMsg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {cloudMsg.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
            {cloudMsg.text}
          </div>
        )}
      </Card>
    </div>
  )
}
