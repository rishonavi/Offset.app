import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from 'recharts'
import { startOfMonth, startOfYear, subMonths, format } from 'date-fns'
import {
  Wallet,
  Receipt,
  Building2,
  Banknote,
  Scale,
  TrendingUp,
  TrendingDown,
  Plus,
  ArrowRight,
  AlertTriangle,
  Repeat,
  CalendarClock,
  FileText,
} from 'lucide-react'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { formatCurrency, formatCompact, formatDate } from '../lib/format'
import { colorForCategory, CHART_PALETTE } from '../lib/constants'
import { totalsByCategory, totalsByProperty, monthlySeries, monthlyIncomeExpense } from '../lib/stats'
import { sumAmount } from '../lib/filters'
import { monthSpendByProperty, budgetStatus } from '../lib/budget'
import { outstandingTotal, isOverdue } from '../lib/payments'
import { dueRecurring, nextOccurrencePayload, RECURRENCE_LABEL } from '../lib/recurring'
import { leasesNeedingAttention } from '../lib/lease'
import { expiringDocuments } from '../lib/documents'
import { Card, Button, EmptyState, Skeleton } from '../components/ui'
import BudgetBar from '../components/BudgetBar'

const RANGES = [
  { id: 'month', label: 'This month' },
  { id: 'year', label: 'This year' },
  { id: 'all', label: 'All time' },
]

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function DeltaChip({ delta }) {
  if (delta == null) return null
  const up = delta >= 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
        up ? 'bg-rose-500/25 text-rose-50' : 'bg-emerald-500/25 text-emerald-50'
      }`}
    >
      <Icon size={12} />
      {up ? '+' : ''}
      {delta.toFixed(0)}% vs last month
    </span>
  )
}

function StatCard({ icon: Icon, label, value, accent = '#C5A059' }) {
  return (
    <Card className="card-hover p-4">
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

function ChartCard({ title, children, empty, action }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        {action}
      </div>
      {empty ? (
        <div className="grid h-64 place-items-center text-sm text-slate-400">No data for this view</div>
      ) : (
        <div style={{ width: '100%', height: 260 }}>{children}</div>
      )}
    </Card>
  )
}

const tooltipStyle = {
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  boxShadow: '0 8px 24px rgba(15,23,42,0.08)',
  fontSize: 13,
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-40 w-full rounded-3xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-2xl" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { expenses, income, properties, documents, loading, propertyNameById, canWrite, addExpense, addIncome } = useData()
  const toast = useToast()
  const [propertyId, setPropertyId] = useState('')
  const [range, setRange] = useState('all')

  const recurringDue = useMemo(
    () =>
      [...dueRecurring(expenses, 'expense'), ...dueRecurring(income, 'income')].sort((a, b) =>
        a.dueDate.localeCompare(b.dueDate),
      ),
    [expenses, income],
  )
  const logDue = async (d) => {
    try {
      const payload = nextOccurrencePayload(d.template, d.kind, d.dueDate)
      if (d.kind === 'income') await addIncome(payload)
      else await addExpense(payload)
      toast(`Logged ${d.kind === 'income' ? 'income' : 'expense'} for ${formatDate(d.dueDate)}.`)
    } catch (e) {
      toast(e?.message || 'Could not log it.', { type: 'error' })
    }
  }

  const leaseAlerts = useMemo(() => leasesNeedingAttention(properties), [properties])
  const docAlerts = useMemo(() => expiringDocuments(documents), [documents])

  const propertyScoped = useMemo(
    () => (propertyId ? expenses.filter((e) => e.property_id === propertyId) : expenses),
    [expenses, propertyId],
  )

  const scoped = useMemo(() => {
    if (range === 'month') {
      const s = format(startOfMonth(new Date()), 'yyyy-MM-dd')
      return propertyScoped.filter((e) => (e.date || '') >= s)
    }
    if (range === 'year') {
      const s = format(startOfYear(new Date()), 'yyyy-MM-dd')
      return propertyScoped.filter((e) => (e.date || '') >= s)
    }
    return propertyScoped
  }, [propertyScoped, range])

  const allTimeTotal = useMemo(() => sumAmount(propertyScoped), [propertyScoped])

  const { thisMonth, delta } = useMemo(() => {
    const now = new Date()
    const thisStart = format(startOfMonth(now), 'yyyy-MM-dd')
    const lastStart = format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd')
    const tm = sumAmount(propertyScoped.filter((e) => (e.date || '') >= thisStart))
    const lm = sumAmount(propertyScoped.filter((e) => (e.date || '') >= lastStart && (e.date || '') < thisStart))
    return { thisMonth: tm, delta: lm > 0 ? ((tm - lm) / lm) * 100 : null }
  }, [propertyScoped])

  const total = useMemo(() => sumAmount(scoped), [scoped])
  const byCategory = useMemo(() => totalsByCategory(scoped), [scoped])
  const byProperty = useMemo(() => totalsByProperty(scoped, propertyNameById), [scoped, propertyNameById])
  const monthly = useMemo(() => monthlySeries(propertyScoped, 12), [propertyScoped])
  const recent = useMemo(() => propertyScoped.slice(0, 5), [propertyScoped])
  const rangeLabel = RANGES.find((r) => r.id === range).label.toLowerCase()

  const incomePropertyScoped = useMemo(
    () => (propertyId ? income.filter((e) => e.property_id === propertyId) : income),
    [income, propertyId],
  )
  const incomeScoped = useMemo(() => {
    if (range === 'month') {
      const s = format(startOfMonth(new Date()), 'yyyy-MM-dd')
      return incomePropertyScoped.filter((e) => (e.date || '') >= s)
    }
    if (range === 'year') {
      const s = format(startOfYear(new Date()), 'yyyy-MM-dd')
      return incomePropertyScoped.filter((e) => (e.date || '') >= s)
    }
    return incomePropertyScoped
  }, [incomePropertyScoped, range])
  const incomeTotal = useMemo(() => sumAmount(incomeScoped), [incomeScoped])
  const incomeAllTime = useMemo(() => sumAmount(incomePropertyScoped), [incomePropertyScoped])
  const netScoped = incomeTotal - total
  const netAllTime = incomeAllTime - allTimeTotal
  const portfolioValue = useMemo(
    () =>
      properties
        .filter((p) => !propertyId || p.id === propertyId)
        .reduce((s, p) => s + (Number(p.value) || 0), 0),
    [properties, propertyId],
  )
  const cashflow = useMemo(
    () => monthlyIncomeExpense(propertyScoped, incomePropertyScoped, 12),
    [propertyScoped, incomePropertyScoped],
  )

  const monthSpend = useMemo(() => monthSpendByProperty(expenses), [expenses])
  const budgeted = useMemo(
    () =>
      properties
        .filter((p) => Number(p.monthly_budget) > 0)
        .filter((p) => !propertyId || p.id === propertyId)
        .map((p) => {
          const spent = monthSpend.get(p.id) || 0
          return { p, spent, status: budgetStatus(spent, p.monthly_budget) }
        })
        .sort((a, b) => (b.status?.pct || 0) - (a.status?.pct || 0)),
    [properties, monthSpend, propertyId],
  )
  const budgetAlerts = budgeted.filter((b) => b.status && b.status.level !== 'ok').length

  const payables = useMemo(() => outstandingTotal(expenses, 'expense'), [expenses])
  const receivables = useMemo(() => outstandingTotal(income, 'income'), [income])
  const overdue = useMemo(() => {
    const ex = expenses.filter((e) => isOverdue(e, 'expense')).map((e) => ({ ...e, kind: 'expense', label: e.category }))
    const inc = income.filter((e) => isOverdue(e, 'income')).map((e) => ({ ...e, kind: 'income', label: e.source }))
    return [...ex, ...inc].sort((a, b) => (a.due_date || '').localeCompare(b.due_date || '')).slice(0, 6)
  }, [expenses, income])

  if (loading) return <DashboardSkeleton />

  if (properties.length === 0 && expenses.length === 0) {
    return (
      <div className="animate-fade-in">
        <h1 className="mb-6 text-2xl font-bold text-slate-900">Dashboard</h1>
        <EmptyState
          icon={Building2}
          title="Welcome to Offset"
          subtitle="Start by adding an asset — property, vehicle, yacht and more — then log its income & expenses. Your charts and totals appear here."
          action={
            <Link to="/properties" className="btn-primary">
              <Plus size={16} /> Add your first asset
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="animate-fade-in space-y-6">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
        <div className="flex flex-wrap items-center gap-2">
          <select className="field-input h-9 w-auto py-1" value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            <option value="">All assets</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  range === r.id ? 'bg-brand text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Hero */}
      <div className="relative overflow-hidden border border-gold/30 bg-gradient-to-br from-navy via-[#0d2747] to-navy-dark p-6 text-white shadow-lg sm:p-8">
        <span className="absolute left-0 top-0 h-full w-[3px] bg-gold" />
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="eyebrow">{greeting()}</p>
            <p className="mt-4 text-[0.7rem] font-semibold uppercase tracking-[2px] text-white/50">
              Net position · {properties.length} {properties.length === 1 ? 'asset' : 'assets'}
            </p>
            <div className="mt-1 font-serif text-4xl font-bold tracking-tight sm:text-5xl">{formatCurrency(netAllTime)}</div>
            <p className="mt-2 text-xs text-white/60">
              {formatCurrency(incomeAllTime)} income · {formatCurrency(allTimeTotal)} expenses
            </p>
            {portfolioValue > 0 && (
              <p className="mt-1 text-xs text-white/60">
                Portfolio value · <span className="font-semibold text-gold">{formatCurrency(portfolioValue)}</span>
                {' · '}net worth {formatCurrency(portfolioValue + netAllTime)}
              </p>
            )}
          </div>
          <div className="border border-white/10 bg-white/5 p-4 backdrop-blur sm:min-w-56">
            <div className="text-[0.65rem] font-semibold uppercase tracking-[1.5px] text-white/50">Spent this month</div>
            <div className="mt-1 font-serif text-2xl font-bold">{formatCurrency(thisMonth)}</div>
            <div className="mt-2">
              <DeltaChip delta={delta} />
            </div>
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 stagger lg:grid-cols-4">
        <StatCard icon={Banknote} label={`Income (${rangeLabel})`} value={formatCurrency(incomeTotal)} accent="#2F8F6B" />
        <StatCard icon={Wallet} label={`Expenses (${rangeLabel})`} value={formatCurrency(total)} accent="#C5A059" />
        <StatCard icon={Scale} label={`Net (${rangeLabel})`} value={formatCurrency(netScoped)} accent={netScoped >= 0 ? '#2F8F6B' : '#C0492F'} />
        <StatCard icon={Receipt} label="Expense entries" value={String(scoped.length)} accent="#0A1828" />
      </div>

      {/* Recurring due to log */}
      {canWrite && recurringDue.length > 0 && (
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Repeat size={16} className="text-gold" />
            <h3 className="text-sm font-semibold text-slate-700">Recurring — due to log</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {recurringDue.map((d) => (
              <div key={`${d.kind}-${d.template.id}`} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">
                    {propertyNameById(d.template.property_id) || '—'} ·{' '}
                    {(d.kind === 'income' ? d.template.source : d.template.category) || (d.kind === 'income' ? 'Income' : 'Expense')}
                  </div>
                  <div className="text-xs text-slate-400">
                    {RECURRENCE_LABEL[d.template.recurrence]} · due {formatDate(d.dueDate)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-semibold" style={{ color: d.kind === 'income' ? '#2F8F6B' : '#0A1828' }}>
                    {d.kind === 'income' ? '+' : ''}
                    {formatCurrency(d.template.amount)}
                  </span>
                  <Button onClick={() => logDue(d)} className="px-3 py-1.5">
                    <Plus size={15} /> Log
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Lease renewals */}
      {leaseAlerts.length > 0 && (
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <CalendarClock size={16} className="text-gold" />
            <h3 className="text-sm font-semibold text-slate-700">Lease renewals</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {leaseAlerts.map(({ property, lease }) => (
              <Link
                key={property.id}
                to={`/properties/${property.id}`}
                className="flex items-center justify-between gap-3 py-2.5 transition hover:opacity-80"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">{property.name}</div>
                  <div className="text-xs text-slate-400">
                    {lease.tenant ? `${lease.tenant} · ` : ''}ends {formatDate(lease.end)}
                  </div>
                </div>
                <span
                  className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  style={
                    lease.state === 'expired'
                      ? { background: '#fee2e2', color: '#b91c1c' }
                      : { background: '#fef3c7', color: '#b45309' }
                  }
                >
                  {lease.state === 'expired' ? `Expired ${Math.abs(lease.daysLeft)}d ago` : `${lease.daysLeft}d left`}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Documents expiring */}
      {docAlerts.length > 0 && (
        <Card className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <FileText size={16} className="text-gold" />
            <h3 className="text-sm font-semibold text-slate-700">Documents expiring</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {docAlerts.map(({ doc, exp }) => (
              <Link
                key={doc.id}
                to={`/properties/${doc.property_id}`}
                className="flex items-center justify-between gap-3 py-2.5 transition hover:opacity-80"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">
                    {doc.title} <span className="text-slate-400">· {doc.doc_type}</span>
                  </div>
                  <div className="text-xs text-slate-400">
                    {propertyNameById(doc.property_id) || '—'} · expires {formatDate(doc.expiry_date)}
                  </div>
                </div>
                <span
                  className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold"
                  style={
                    exp.state === 'expired'
                      ? { background: '#fee2e2', color: '#b91c1c' }
                      : { background: '#fef3c7', color: '#b45309' }
                  }
                >
                  {exp.state === 'expired' ? `Expired ${Math.abs(exp.daysLeft)}d ago` : `${exp.daysLeft}d left`}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Budgets */}
      {budgeted.length > 0 && (
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Monthly budgets</h3>
            {budgetAlerts > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                <AlertTriangle size={12} /> {budgetAlerts} need attention
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            {budgeted.map((b) => (
              <Link key={b.p.id} to={`/properties/${b.p.id}`} className="block transition hover:opacity-80">
                <div className="mb-1 truncate text-sm font-medium text-slate-700">{b.p.name}</div>
                <BudgetBar spent={b.spent} budget={b.p.monthly_budget} />
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Payments due */}
      {(payables > 0 || receivables > 0) && (
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-700">Payments due</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="border-l-2 border-gold pl-3">
              <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-slate-500">You owe · unpaid expenses</div>
              <div className="font-serif text-2xl font-bold text-slate-900">{formatCurrency(payables)}</div>
            </div>
            <div className="border-l-2 border-emerald-500 pl-3">
              <div className="text-[0.65rem] font-semibold uppercase tracking-[1px] text-slate-500">Owed to you · pending income</div>
              <div className="font-serif text-2xl font-bold text-emerald-700">{formatCurrency(receivables)}</div>
            </div>
          </div>
          {overdue.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <div className="mb-2 flex items-center gap-1 text-xs font-semibold text-red-600">
                <AlertTriangle size={13} /> Overdue
              </div>
              <div className="divide-y divide-slate-100">
                {overdue.map((o) => (
                  <Link
                    key={o.id}
                    to={`/properties/${o.property_id}`}
                    className="flex items-center justify-between gap-3 py-2 text-sm transition hover:opacity-80"
                  >
                    <span className="min-w-0 truncate text-slate-700">
                      {propertyNameById(o.property_id) || '—'} · {o.label || (o.kind === 'income' ? 'Income' : 'Expense')}
                    </span>
                    <span className="shrink-0 font-semibold" style={{ color: o.kind === 'income' ? '#2F8F6B' : '#C0492F' }}>
                      {formatCurrency(o.amount)} · {formatDate(o.due_date)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Trend */}
      <ChartCard title="Spending over the last 12 months" empty={monthly.every((m) => m.total === 0)}>
        <ResponsiveContainer>
          <AreaChart data={monthly} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#C5A059" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#C5A059" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={formatCompact} tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={48} />
            <Tooltip formatter={(v) => [formatCurrency(v), 'Spent']} contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="total" stroke="#C5A059" strokeWidth={2.5} fill="url(#g)" />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Income vs expenses */}
      <ChartCard
        title="Income vs expenses (last 12 months)"
        empty={cashflow.every((m) => m.income === 0 && m.expense === 0)}
      >
        <ResponsiveContainer>
          <BarChart data={cashflow} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
            <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={formatCompact} tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={48} />
            <Tooltip
              formatter={(v, n) => [formatCurrency(v), n === 'income' ? 'Income' : 'Expense']}
              contentStyle={tooltipStyle}
              cursor={{ fill: '#f1f5f9' }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === 'income' ? 'Income' : 'Expense')} />
            <Bar dataKey="income" fill="#2F8F6B" radius={[3, 3, 0, 0]} />
            <Bar dataKey="expense" fill="#C5A059" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Category + property charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Spending by category" empty={byCategory.length === 0}>
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
        </ChartCard>

        <ChartCard title="Spending by property" empty={byProperty.length === 0}>
          <ResponsiveContainer>
            <BarChart data={byProperty} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef2f7" />
              <XAxis type="number" tickFormatter={formatCompact} tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => [formatCurrency(v), 'Spent']} contentStyle={tooltipStyle} cursor={{ fill: '#f1f5f9' }} />
              <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={22}>
                {byProperty.map((d, i) => (
                  <Cell key={d.id} fill={CHART_PALETTE[i % CHART_PALETTE.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Recent activity + breakdown */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Recent activity</h3>
            <Link to="/expenses" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
              View all <ArrowRight size={13} />
            </Link>
          </div>
          {recent.length === 0 ? (
            <div className="grid h-32 place-items-center text-sm text-slate-400">No expenses yet</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recent.map((e) => (
                <Link key={e.id} to="/expenses" className="flex items-center gap-3 py-2.5 transition hover:opacity-80">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorForCategory(e.category) }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">{propertyNameById(e.property_id) || '—'}</div>
                    <div className="truncate text-xs text-slate-400">
                      {e.category} · {formatDate(e.date)}
                    </div>
                  </div>
                  <div className="shrink-0 text-sm font-semibold text-slate-900">{formatCurrency(e.amount)}</div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {byCategory.length > 0 ? (
          <Card className="p-5">
            <h3 className="mb-4 text-sm font-semibold text-slate-700">Category breakdown</h3>
            <div className="space-y-3">
              {byCategory.slice(0, 6).map((c) => {
                const pct = total ? Math.round((c.value / total) * 100) : 0
                return (
                  <div key={c.name}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 text-slate-600">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorForCategory(c.name) }} />
                        {c.name}
                      </span>
                      <span className="font-semibold text-slate-800">
                        {formatCurrency(c.value)} <span className="ml-1 text-xs font-normal text-slate-400">{pct}%</span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: colorForCategory(c.name) }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        ) : (
          <Card className="grid place-items-center p-5 text-sm text-slate-400">No category data yet</Card>
        )}
      </div>
    </div>
  )
}
