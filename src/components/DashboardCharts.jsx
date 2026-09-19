import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

// The dashboard's four charts, in one module, so that recharts arrives when
// there is something to draw rather than before the page has painted.
//
// It was imported at the top of Dashboard.jsx, which meant 367 kB of charting
// library in front of the first view of the app — on a page whose headline
// figures are all text and whose rings are explicitly decoration. Everything
// here takes its colours already resolved and its formatters as props: a chart
// module that reaches into the app's palette and its money formatting is a
// chart module that cannot be loaded separately from them.
export function SpendTrend({ data, format, formatCompact, tooltipStyle }) {
  return (
    <ResponsiveContainer>
      <AreaChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#C5A059" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#C5A059" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={formatCompact} tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={48} />
        <Tooltip formatter={(v) => [format(v), 'Spent']} contentStyle={tooltipStyle} />
        <Area type="monotone" dataKey="total" stroke="#C5A059" strokeWidth={2.5} fill="url(#g)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function CashflowBars({ data, format, formatCompact, tooltipStyle }) {
  return (
    <ResponsiveContainer>
      <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef2f7" />
        <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={formatCompact} tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} width={48} />
        <Tooltip
          formatter={(v, n) => [format(v), n === 'income' ? 'Income' : 'Expense']}
          contentStyle={tooltipStyle}
          cursor={{ fill: '#f1f5f9' }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => (v === 'income' ? 'Income' : 'Expense')} />
        <Bar dataKey="income" fill="#2F8F6B" radius={[3, 3, 0, 0]} />
        <Bar dataKey="expense" fill="#C5A059" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// The ring is decoration; the key beside it is the content. Hidden from the
// accessibility tree because everything it shows is in the key, in words.
export function CategoryRing({ data, format, tooltipStyle }) {
  return (
    <ResponsiveContainer>
      <PieChart role="presentation" aria-hidden="true">
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
          {data.map((d) => <Cell key={d.name} fill={d.color} />)}
        </Pie>
        <Tooltip formatter={(v, n) => [format(v), n]} contentStyle={tooltipStyle} />
      </PieChart>
    </ResponsiveContainer>
  )
}

export function PropertyBars({ data, format, formatCompact, tooltipStyle }) {
  return (
    <ResponsiveContainer>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#eef2f7" />
        <XAxis type="number" tickFormatter={formatCompact} tick={{ fontSize: 12, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v) => [format(v), 'Spent']} contentStyle={tooltipStyle} cursor={{ fill: '#f1f5f9' }} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={22}>
          {data.map((d) => <Cell key={d.id} fill={d.color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
