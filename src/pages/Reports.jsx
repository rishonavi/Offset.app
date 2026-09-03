import { useMemo } from 'react'
import jsPDF from 'jspdf'
import autoTableImport from 'jspdf-autotable'
// jspdf-autotable ships as CJS; under Vite's interop the default import can be
// the module wrapper rather than the function itself, so unwrap defensively.
const autoTable = autoTableImport?.default || autoTableImport
import { Link, useLocation } from 'react-router-dom'
import { FileText, Landmark, FileUp } from 'lucide-react'
import { useData } from '../context/DataContext'
import { applyFilters, sumAmount } from '../lib/filters'
import { useFilterParams } from '../lib/useFilterParams'
import { formatCurrency, formatDate } from '../lib/format'
import { colorForCategory } from '../lib/constants'
import { Card, Button, EmptyState, Badge } from '../components/ui'
import PageHeader from '../components/PageHeader'
import AskCard from '../components/AskCard'
import FilterBar from '../components/FilterBar'

const PREVIEW_LIMIT = 100

// What the year came to. Moving the rows anywhere else is Export & import,
// which shares this page's filter through the URL.
export default function Reports() {
  const { expenses, income, properties, propertyNameById } = useData()
  const [filters, setFilters] = useFilterParams()
  const { search } = useLocation()
  // Left behind when this page was split from Export: downloadYearEndPDF still
  // named it, so the one button on this page that produces a file threw
  // ReferenceError instead. Nothing here rendered wrong, which is why it
  // survived a review and a full suite — it only failed on the click.
  const baseName = `property-expenses-${new Date().toISOString().slice(0, 10)}`

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

  const taxPaid = useMemo(() => filtered.reduce((s, e) => s + (Number(e.tax) || 0), 0), [filtered])
  const taxCollected = useMemo(() => incomeFiltered.reduce((s, e) => s + (Number(e.tax) || 0), 0), [incomeFiltered])
  const netTax = taxCollected - taxPaid

  // Per-year statement: income, expenses, net, and tax paid vs collected.
  const byYear = useMemo(() => {
    const m = new Map()
    const row = (y) => {
      if (!m.has(y)) m.set(y, { year: y, income: 0, expense: 0, taxPaid: 0, taxCollected: 0 })
      return m.get(y)
    }
    for (const e of filtered) {
      const y = (e.date || '').slice(0, 4)
      if (!y) continue
      const r = row(y)
      r.expense += Number(e.amount) || 0
      r.taxPaid += Number(e.tax) || 0
    }
    for (const e of incomeFiltered) {
      const y = (e.date || '').slice(0, 4)
      if (!y) continue
      const r = row(y)
      r.income += Number(e.amount) || 0
      r.taxCollected += Number(e.tax) || 0
    }
    return [...m.values()].sort((a, b) => b.year.localeCompare(a.year))
  }, [filtered, incomeFiltered])

  // Deductible expenses grouped by category — the view tax returns (Schedule E /
  // SA105) are actually built from.
  const byCategoryTax = useMemo(() => {
    const m = new Map()
    for (const e of filtered) {
      const k = e.category || 'Other'
      if (!m.has(k)) m.set(k, { category: k, total: 0, tax: 0, count: 0 })
      const r = m.get(k)
      r.total += Number(e.amount) || 0
      r.tax += Number(e.tax) || 0
      r.count += 1
    }
    return [...m.values()].sort((a, b) => b.total - a.total)
  }, [filtered])

  const downloadYearEndPDF = () => {
    const doc = new jsPDF()
    doc.setFontSize(16)
    doc.text('Offset — Year-end & tax summary', 14, 18)
    doc.setFontSize(10)
    doc.setTextColor(120)
    const scope = filters.propertyId ? propertyNameById(filters.propertyId) || 'Asset' : 'All assets'
    doc.text(`${scope} · generated ${new Date().toLocaleDateString()}`, 14, 25)
    autoTable(doc, {
      startY: 32,
      head: [['Year', 'Income', 'Expenses', 'Net', 'Tax collected', 'Tax paid']],
      body: byYear.map((r) => [
        r.year,
        formatCurrency(r.income),
        formatCurrency(r.expense),
        formatCurrency(r.income - r.expense),
        formatCurrency(r.taxCollected),
        formatCurrency(r.taxPaid),
      ]),
      foot: [[
        'Total',
        formatCurrency(incomeFiltered.reduce((s, e) => s + (Number(e.amount) || 0), 0)),
        formatCurrency(total),
        formatCurrency(incomeFiltered.reduce((s, e) => s + (Number(e.amount) || 0), 0) - total),
        formatCurrency(taxCollected),
        formatCurrency(taxPaid),
      ]],
      styles: { fontSize: 9 },
      headStyles: { fillColor: [10, 24, 40] },
      footStyles: { fillColor: [245, 245, 245], textColor: 20, fontStyle: 'bold' },
    })

    if (byCategoryTax.length > 0) {
      const y = doc.lastAutoTable.finalY + 10
      doc.setFontSize(12)
      doc.setTextColor(20)
      doc.text('Expenses by category (deductible)', 14, y)
      autoTable(doc, {
        startY: y + 4,
        head: [['Category', 'Entries', 'Tax', 'Amount']],
        body: byCategoryTax.map((r) => [r.category, String(r.count), formatCurrency(r.tax), formatCurrency(r.total)]),
        foot: [['Total', String(filtered.length), formatCurrency(taxPaid), formatCurrency(total)]],
        styles: { fontSize: 9 },
        headStyles: { fillColor: [10, 24, 40] },
        footStyles: { fillColor: [245, 245, 245], textColor: 20, fontStyle: 'bold' },
      })
    }
    doc.save(`${baseName}-year-end.pdf`)
  }

  const preview = filtered.slice(0, PREVIEW_LIMIT)
  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader
        title="Reports"
        subtitle="Income, expenses and tax over the period you choose."
        action={
          <Link to={{ pathname: '/exports', search }} className="btn-ghost">
            <FileUp size={15} /> Export these
          </Link>
        }
      />

      <AskCard />

      <FilterBar properties={properties} value={filters} onChange={setFilters} />

      {/* Tax / GST & year-end summary */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Landmark size={16} className="text-ink-5" />
            <h2 className="text-sm font-semibold text-ink-3">Tax &amp; year-end summary</h2>
          </div>
          <Button variant="ghost" onClick={downloadYearEndPDF} disabled={byYear.length === 0}>
            <FileText size={16} className="text-red-600" /> Year-end PDF
          </Button>
        </div>
        <p className="mt-1 text-xs text-ink-5">
          GST/tax totals for the current filter{filters.propertyId ? ` · ${propertyNameById(filters.propertyId) || 'asset'}` : ''}.
        </p>

        <div className="mt-4 grid grid-cols-3 gap-3">
          <div className="border-s-2 border-emerald-500 pl-3">
            <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-ink-5">Tax collected</div>
            <div className="font-serif text-xl font-bold text-emerald-700">{formatCurrency(taxCollected)}</div>
          </div>
          <div className="border-s-2 border-gold pl-3">
            <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-ink-5">Tax paid</div>
            <div className="font-serif text-xl font-bold text-ink-1">{formatCurrency(taxPaid)}</div>
          </div>
          <div className="border-s-2 border-navy pl-3">
            <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-ink-5">Net tax</div>
            <div className="font-serif text-xl font-bold" style={{ color: netTax >= 0 ? '#2F8F6B' : '#C0492F' }}>
              {formatCurrency(netTax)}
            </div>
          </div>
        </div>

        {byYear.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-start text-xs uppercase tracking-wide text-ink-5">
                  <th className="py-2 pr-3 font-semibold">Year</th>
                  <th className="px-3 py-2 text-end font-semibold">Income</th>
                  <th className="px-3 py-2 text-end font-semibold">Expenses</th>
                  <th className="px-3 py-2 text-end font-semibold">Net</th>
                  <th className="px-3 py-2 text-end font-semibold">Tax coll.</th>
                  <th className="py-2 pl-3 text-end font-semibold">Tax paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {byYear.map((r) => (
                  <tr key={r.year}>
                    <td className="py-2 pr-3 font-medium text-ink-2">{r.year}</td>
                    <td className="px-3 py-2 text-end text-emerald-700">{formatCurrency(r.income)}</td>
                    <td className="px-3 py-2 text-end text-ink-3">{formatCurrency(r.expense)}</td>
                    <td className="px-3 py-2 text-end font-semibold" style={{ color: r.income - r.expense >= 0 ? '#2F8F6B' : '#C0492F' }}>
                      {formatCurrency(r.income - r.expense)}
                    </td>
                    <td className="px-3 py-2 text-end text-ink-4">{formatCurrency(r.taxCollected)}</td>
                    <td className="py-2 pl-3 text-end text-ink-4">{formatCurrency(r.taxPaid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {byCategoryTax.length > 0 && (
          <div className="mt-6">
            <div className="mb-2 text-xs font-semibold uppercase tracking-[1px] text-ink-5">
              Deductible expenses by category
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-start text-xs uppercase tracking-wide text-ink-5">
                    <th className="py-2 pr-3 font-semibold">Category</th>
                    <th className="px-3 py-2 text-end font-semibold">Entries</th>
                    <th className="px-3 py-2 text-end font-semibold">Tax</th>
                    <th className="py-2 pl-3 text-end font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {byCategoryTax.map((r) => (
                    <tr key={r.category}>
                      <td className="py-2 pr-3">
                        <Badge color={colorForCategory(r.category)}>{r.category}</Badge>
                      </td>
                      <td className="px-3 py-2 text-end text-ink-4">{r.count}</td>
                      <td className="px-3 py-2 text-end text-ink-4">{formatCurrency(r.tax)}</td>
                      <td className="py-2 pl-3 text-end font-semibold text-ink-2">{formatCurrency(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-line font-semibold text-ink-1">
                    <td className="py-2 pr-3">Total</td>
                    <td className="px-3 py-2 text-end">{filtered.length}</td>
                    <td className="px-3 py-2 text-end">{formatCurrency(taxPaid)}</td>
                    <td className="py-2 pl-3 text-end">{formatCurrency(total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}
      </Card>

      {/* Preview */}
      {filtered.length === 0 ? (
        <EmptyState icon={FileText} title="Nothing to show" subtitle="No expenses match the current filters." />
      ) : (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold text-ink-3">Preview</h2>
            <span className="text-xs text-ink-6">
              {preview.length < filtered.length ? `Showing ${preview.length} of ${filtered.length}` : `${filtered.length} rows`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-sunk text-start text-xs uppercase tracking-wide text-ink-5">
                  <th className="px-5 py-2.5 font-semibold">Date</th>
                  <th className="px-5 py-2.5 font-semibold">Property</th>
                  <th className="px-5 py-2.5 font-semibold">Category</th>
                  <th className="px-5 py-2.5 font-semibold">Vendor</th>
                  <th className="px-5 py-2.5 text-end font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {preview.map((e) => (
                  <tr key={e.id}>
                    <td className="whitespace-nowrap px-5 py-2.5 text-ink-4">{formatDate(e.date)}</td>
                    <td className="px-5 py-2.5 font-medium text-ink-2">{propertyNameById(e.property_id) || '—'}</td>
                    <td className="px-5 py-2.5">
                      <Badge color={colorForCategory(e.category)}>{e.category}</Badge>
                    </td>
                    <td className="px-5 py-2.5 text-ink-4">{e.vendor || '—'}</td>
                    <td className="whitespace-nowrap px-5 py-2.5 text-end font-semibold text-ink-1">{formatCurrency(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-surface-sunk font-semibold text-ink-1">
                  <td className="px-5 py-2.5" colSpan={4}>Total</td>
                  <td className="px-5 py-2.5 text-end">{formatCurrency(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
