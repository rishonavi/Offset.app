import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'

// The ring on its own, in its own module, so that recharts can be loaded when
// something actually draws a chart.
//
// It used to be imported at the top of Personal and Dashboard, which put 367 kB
// of charting library in front of the first paint of both — on a dashboard
// whose numbers are all text, and where the ring is explicitly decoration:
// every one of these carries `aria-hidden` with a `ChartKey` underneath doing
// the telling. Downloading a third of a megabyte to draw a decoration before
// anybody has seen the figures is the wrong way round.
//
// Because the key is the content, the fallback while this arrives is nothing at
// all rather than a spinner: the reader has already been told what they came
// for and a spinner would only draw the eye to the part that does not matter.
export default function SpendRing({ data, format, tooltipStyle, height = 260 }) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <PieChart role="presentation" aria-hidden="true">
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
            {data.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
          <Tooltip formatter={(v, n) => [format(v), n]} contentStyle={tooltipStyle} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}
