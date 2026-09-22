import { Card, cx } from '../ui'

// One figure with its label above it. Shared by the Operations tabs, which all
// open with a row of these.
export default function Stat({ label, value, tone }) {
  return (
    <Card className="p-4">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[1.5px] text-ink-5">{label}</p>
      <p className={cx('mt-1 text-xl font-semibold tabular', tone === 'warn' ? 'text-warn' : 'text-ink-1')}>{value}</p>
    </Card>
  )
}
