import { useMemo } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { startOfMonth, subMonths, format } from 'date-fns'
import { ArrowLeft, Plus, Pencil, Trash2, MapPin, Wallet, Receipt, CalendarDays, Banknote, Scale } from 'lucide-react'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { formatCurrency, formatCompact, formatDate } from '../lib/format'
import { colorForCategory } from '../lib/constants'
import { totalsByCategory, monthlySeries } from '../lib/stats'
import { sumAmount } from '../lib/filters'
import { assetMetrics } from '../lib/metrics'
import { loanSummary } from '../lib/loan'
import { leaseStatus } from '../lib/lease'
import { iconForAssetType } from '../lib/assetIcon'
import { Card, Button, EmptyState, Spinner } from '../components/ui'
import BudgetBar from '../components/BudgetBar'
import DocumentsCard from '../components/DocumentsCard'
import ExpenseTable from '../components/ExpenseTable'
import IncomeTable from '../components/IncomeTable'

const tooltipStyle = {
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
  fontSize: 13,
}

const fmtPct = (v) => (v == null ? '—' : `${v.toFixed(1)}%`)

function StatCard({ icon: Icon, label, value, accent = '#C5A059' }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: `${accent}1a`, color: accent }}>
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-slate-500">{label}</div>
          <div className="truncate font-serif text-xl font-bold text-slate-900">{value}</div>
        </div>
      </div>
    </Card>
  )
}

export default function PropertyDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { properties, expenses, income, documents, loading, propertyNameById, deleteProperty, deleteExpense, restoreExpense, deleteIncome, restoreIncome, addDocument, deleteDocument, canWrite } = useData()
  const toast = useToast()

  const removeExpense = async (e) => {
    await deleteExpense(e.id)
    toast('Expense moved to bin', { action: { label: 'Undo', onClick: () => restoreExpense(e) } })
  }
  const removeIncome = async (e) => {
    await deleteIncome(e.id)
    toast('Income moved to bin', { action: { label: 'Undo', onClick: () => restoreIncome(e) } })
  }

  const property = useMemo(() => properties.find((p) => p.id === id), [properties, id])
  const items = useMemo(() => expenses.filter((e) => e.property_id === id), [expenses, id])
  const incomeItems = useMemo(() => income.filter((e) => e.property_id === id), [income, id])

  const total = useMemo(() => sumAmount(items), [items])
  const thisMonth = useMemo(() => {
    const s = format(startOfMonth(new Date()), 'yyyy-MM-dd')
    return sumAmount(items.filter((e) => (e.date || '') >= s))
  }, [items])
  const incomeTotal = useMemo(() => sumAmount(incomeItems), [incomeItems])
  const net = incomeTotal - total

  // Trailing-12-month figures for rental yield.
  const ttm = useMemo(() => {
    const start = format(subMonths(new Date(), 12), 'yyyy-MM-dd')
    const inc = sumAmount(incomeItems.filter((e) => (e.date || '') >= start))
    const exp = sumAmount(items.filter((e) => (e.date || '') >= start))
    return { inc, exp, net: inc - exp }
  }, [items, incomeItems])

  const assetValue = Number(property?.value) || 0
  const grossYield = assetValue ? (ttm.inc / assetValue) * 100 : null
  const netYield = assetValue ? (ttm.net / assetValue) * 100 : null
  const totalRoi = assetValue ? (net / assetValue) * 100 : null

  const metrics = useMemo(() => assetMetrics(property, items, incomeItems), [property, items, incomeItems])

  const byCategory = useMemo(() => totalsByCategory(items), [items])
  const monthly = useMemo(() => monthlySeries(items, 12), [items])
  const loan = useMemo(() => loanSummary(property), [property])
  const lease = useMemo(() => leaseStatus(property), [property])
  const docs = useMemo(() => documents.filter((d) => d.property_id === id), [documents, id])

  if (loading) return <Spinner />

  if (!property) {
    return (
      <div className="animate-fade-in">
        <EmptyState
          icon={MapPin}
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

  const AssetIcon = iconForAssetType(property.type)

  const onDeleteProperty = () => {
    const msg = items.length
      ? `Delete "${property.name}" and its ${items.length} expense(s)? This cannot be undone.`
      : `Delete "${property.name}"?`
    if (window.confirm(msg)) {
      deleteProperty(property.id)
      navigate('/properties')
    }
  }

  return (
    <div className="animate-fade-in space-y-6">
      <Link to="/properties" className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800">
        <ArrowLeft size={15} /> All assets
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-light text-brand">
            <AssetIcon size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{property.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500">
              {property.type && <span>{property.type}</span>}
              {property.address && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={13} /> {property.address}
                </span>
              )}
            </div>
          </div>
        </div>
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/properties/${property.id}/edit`} className="btn-ghost">
              <Pencil size={15} /> Edit
            </Link>
            <Button variant="ghost" onClick={onDeleteProperty} className="text-red-600 hover:bg-red-50">
              <Trash2 size={15} /> Delete
            </Button>
            <Link to={`/expenses/new?asset=${property.id}`} className="btn-primary">
              <Plus size={16} /> Add expense
            </Link>
          </div>
        )}
      </div>

      {/* Budget */}
      {property.monthly_budget ? (
        <Card className="p-5">
          <BudgetBar spent={thisMonth} budget={property.monthly_budget} />
        </Card>
      ) : (
        <Card className="flex items-center justify-between p-4 text-sm">
          <span className="text-slate-500">No monthly budget set for this asset.</span>
          <Link to={`/properties/${property.id}/edit`} className="font-medium text-brand hover:underline">
            Set a budget
          </Link>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon={Banknote} label="Income" value={formatCurrency(incomeTotal)} accent="#2F8F6B" />
        <StatCard icon={Wallet} label="Expenses" value={formatCurrency(total)} accent="#C5A059" />
        <StatCard icon={Scale} label="Net" value={formatCurrency(net)} accent={net >= 0 ? '#2F8F6B' : '#C0492F'} />
        <StatCard icon={CalendarDays} label="Spent this month" value={formatCurrency(thisMonth)} accent="#0A1828" />
      </div>

      {/* Value & returns (ROI / yield) */}
      {assetValue > 0 ? (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700">Value &amp; returns</h3>
            <span className="text-xs text-slate-400">Asset value · {formatCurrency(assetValue)}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            {[
              { label: 'Gross yield', v: grossYield, suffix: '% / yr', hint: 'last 12 mo income' },
              { label: 'Net yield', v: netYield, suffix: '% / yr', hint: 'last 12 mo net' },
              { label: 'Total ROI', v: totalRoi, suffix: '%', hint: 'net to date' },
            ].map((m) => (
              <div key={m.label}>
                <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-slate-500">{m.label}</div>
                <div
                  className="font-serif text-2xl font-bold"
                  style={{ color: m.v == null ? '#0A1828' : m.v >= 0 ? '#2F8F6B' : '#C0492F' }}
                >
                  {m.v == null ? '—' : `${m.v.toFixed(1)}${m.suffix}`}
                </div>
                <div className="text-[0.65rem] text-slate-400">{m.hint}</div>
              </div>
            ))}
            <div>
              <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-slate-500">Net to date</div>
              <div className="font-serif text-2xl font-bold" style={{ color: net >= 0 ? '#2F8F6B' : '#C0492F' }}>
                {formatCurrency(net)}
              </div>
              <div className="text-[0.65rem] text-slate-400">income − expenses</div>
            </div>
          </div>

          {/* Operating performance (trailing 12 months) */}
          <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-slate-100 pt-4 sm:grid-cols-4">
            {[
              { label: 'Cap rate', value: fmtPct(metrics.capRate), hint: 'NOI ÷ value', tone: metrics.capRate },
              { label: 'NOI', value: formatCurrency(metrics.noi), hint: 'last 12 mo operating', tone: metrics.noi },
              { label: 'Expense ratio', value: fmtPct(metrics.expenseRatio), hint: 'opex ÷ income' },
              {
                label: 'Cash flow / mo',
                value: formatCurrency(metrics.monthlyCashFlow),
                hint: metrics.hasLoan ? 'after loan' : 'operating',
                tone: metrics.monthlyCashFlow,
              },
            ].map((m) => (
              <div key={m.label}>
                <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-slate-500">{m.label}</div>
                <div
                  className={`font-serif text-xl font-bold ${m.tone == null ? 'text-slate-900' : ''}`}
                  style={m.tone == null ? undefined : { color: m.tone >= 0 ? '#2F8F6B' : '#C0492F' }}
                >
                  {m.value}
                </div>
                <div className="text-[0.65rem] text-slate-400">{m.hint}</div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card className="flex items-center justify-between p-4 text-sm">
          <span className="text-slate-500">Add an asset value to see ROI &amp; rental yield.</span>
          <Link to={`/properties/${property.id}/edit`} className="font-medium text-brand hover:underline">
            Set value
          </Link>
        </Card>
      )}

      {/* Loan / mortgage */}
      {loan && (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700">Loan / mortgage</h3>
            <span className="text-xs text-slate-400">
              {loan.rate}% · {loan.months} mo · payoff {formatDate(loan.payoffDate)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            {[
              { label: 'Monthly EMI', value: formatCurrency(loan.emi), hint: `${loan.paid} of ${loan.months} paid` },
              { label: 'Outstanding', value: formatCurrency(loan.outstanding), hint: `${loan.remaining} mo left`, accent: '#C0492F' },
              { label: 'Total interest', value: formatCurrency(loan.totalInterest), hint: 'over full tenure' },
              { label: 'Loan amount', value: formatCurrency(loan.principal), hint: 'original principal' },
            ].map((m) => (
              <div key={m.label}>
                <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-slate-500">{m.label}</div>
                <div className="font-serif text-2xl font-bold" style={{ color: m.accent || '#0A1828' }}>
                  {m.value}
                </div>
                <div className="text-[0.65rem] text-slate-400">{m.hint}</div>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
              <span>Repaid</span>
              <span className="font-semibold text-slate-700">{loan.progressPct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-gold" style={{ width: `${loan.progressPct}%` }} />
            </div>
          </div>
        </Card>
      )}

      {/* Tenancy / lease */}
      {lease && (
        <Card className="p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700">Tenancy / lease</h3>
            {lease.daysLeft != null && (
              <span
                className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                style={
                  lease.state === 'expired'
                    ? { background: '#fee2e2', color: '#b91c1c' }
                    : lease.state === 'ending'
                    ? { background: '#fef3c7', color: '#b45309' }
                    : { background: '#dcfce7', color: '#15803d' }
                }
              >
                {lease.state === 'expired'
                  ? `Expired ${Math.abs(lease.daysLeft)}d ago`
                  : lease.state === 'upcoming'
                  ? 'Starts soon'
                  : `${lease.daysLeft}d left`}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
            <div>
              <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-slate-500">Tenant</div>
              <div className="truncate font-serif text-lg font-bold text-slate-900">{lease.tenant || '—'}</div>
            </div>
            <div>
              <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-slate-500">Lease start</div>
              <div className="font-serif text-lg font-bold text-slate-900">{lease.start ? formatDate(lease.start) : '—'}</div>
            </div>
            <div>
              <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-slate-500">Lease end</div>
              <div className="font-serif text-lg font-bold text-slate-900">{lease.end ? formatDate(lease.end) : '—'}</div>
            </div>
            <div>
              <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-slate-500">Deposit held</div>
              <div className="font-serif text-lg font-bold text-slate-900">{lease.deposit ? formatCurrency(lease.deposit) : '—'}</div>
            </div>
          </div>
        </Card>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-700">Spending over the last 12 months</h3>
          {monthly.every((m) => m.total === 0) ? (
            <div className="grid h-64 place-items-center text-sm text-slate-400">No data yet</div>
          ) : (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <AreaChart data={monthly} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gd" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#C5A059" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#C5A059" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
                  <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={formatCompact} tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={48} />
                  <Tooltip formatter={(v) => [formatCurrency(v), 'Spent']} contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="total" stroke="#C5A059" strokeWidth={2.5} fill="url(#gd)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-700">Spending by category</h3>
          {byCategory.length === 0 ? (
            <div className="grid h-64 place-items-center text-sm text-slate-400">No data yet</div>
          ) : (
            <div style={{ width: '100%', height: 260 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
                    {byCategory.map((d) => (
                      <Cell key={d.name} fill={colorForCategory(d.name)} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v, n) => [formatCurrency(v), n]} contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Documents */}
      <DocumentsCard propertyId={property.id} documents={docs} canWrite={canWrite} onAdd={addDocument} onDelete={deleteDocument} />

      {/* Expenses */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Expenses ({items.length})</h3>
        {items.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No expenses for this asset"
            subtitle="Log the first one to start tracking."
            action={
              <Link to={`/expenses/new?asset=${property.id}`} className="btn-primary">
                <Plus size={16} /> Add expense
              </Link>
            }
          />
        ) : (
          <ExpenseTable
            expenses={items}
            propertyNameById={propertyNameById}
            onEdit={(e) => navigate(`/expenses/${e.id}/edit`)}
            onDelete={removeExpense}
            readOnly={!canWrite}
          />
        )}
      </div>

      {/* Income */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Income ({incomeItems.length})</h3>
          {canWrite && (
            <Link to={`/income/new?asset=${property.id}`} className="btn-ghost">
              <Plus size={15} /> Add income
            </Link>
          )}
        </div>
        {incomeItems.length === 0 ? (
          <EmptyState
            icon={Banknote}
            title="No income for this asset"
            subtitle="Log rent or other income to track net profit."
            action={
              <Link to={`/income/new?asset=${property.id}`} className="btn-primary">
                <Plus size={16} /> Add income
              </Link>
            }
          />
        ) : (
          <IncomeTable
            income={incomeItems}
            propertyNameById={propertyNameById}
            onEdit={(e) => navigate(`/income/${e.id}/edit`)}
            onDelete={removeIncome}
            readOnly={!canWrite}
          />
        )}
      </div>
    </div>
  )
}
