import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { FileSpreadsheet, FileText, FileType, Download, CheckCircle2, AlertCircle, UploadCloud, Calculator, PieChart } from 'lucide-react'
import { useData } from '../context/DataContext'
import { applyFilters, sumAmount } from '../lib/filters'
import { useFilterParams } from '../lib/useFilterParams'
import { useBackup } from '../lib/useBackup'
import { formatCurrency } from '../lib/format'
import { toExportRows, toIncomeRows, exportWorkbook, exportCSV, exportPDF } from '../lib/exports'
import { toTallyXML } from '../lib/tally'
import { Card, Button, Spinner } from '../components/ui'
import PageHeader from '../components/PageHeader'
import FilterBar from '../components/FilterBar'

// Getting data out. Everything that comes the other way — a mailbox, a
// spreadsheet, a Tally file, a backup — is on Import, including restoring the
// backup this page makes.
export default function Exports() {
  const { expenses, income, properties, loading, propertyNameById } = useData()
  const [filters, setFilters] = useFilterParams()
  const { search } = useLocation()

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

  const backup = useBackup(baseName)

  if (loading) return <Spinner />

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Export"
        subtitle="Filter first, then take the rows out as Excel, CSV, PDF or Tally."
        action={
          <Link to={{ pathname: '/reports', search }} className="btn-ghost">
            <PieChart size={15} /> See the summary
          </Link>
        }
      />

      <FilterBar properties={properties} value={filters} onChange={setFilters} />

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


      {/* The other half of this is Restore, on Import — a backup is a file
          leaving, restoring it is a file arriving. Both call the same hook, so
          the format they agree on cannot drift apart. */}
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <UploadCloud size={16} className="text-ink-5" />
          <h2 className="text-sm font-semibold text-ink-3">Back up everything</h2>
        </div>
        <p className="mt-1 text-xs text-ink-5">
          Assets, expenses and income, with receipts inlined so the file stands on its own. Ignores the filter above —
          a partial backup is a trap. Restore it from <Link to="/import" className="underline">Import</Link>.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={backup.downloadBackup}>
            <Download size={16} className="text-ink-4" /> Download backup
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
              <Button variant="ghost" onClick={backup.cloudBackup} loading={backup.busy}>
                {!backup.busy && <UploadCloud size={16} className="text-emerald-600" />} Back up to cloud
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
    </div>
  )
}
