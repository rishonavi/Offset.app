import { Suspense, lazy, useState } from 'react'
import { Boxes, IndianRupee, FileText, HardHat, ClipboardCheck } from 'lucide-react'
import { Card, Spinner, cx } from './ui'

// Materials, for a company that builds things.
//
// Four questions, in the order somebody on a site asks them: what have we got,
// what does it cost, who will sell it cheaper, and which job burned it. They
// are sub-tabs rather than four more entries in the side bar because they are
// one job — running the stores — and because splitting them would mean four
// screens each showing a quarter of the same table.
// Five, since a stores ledger that has never been checked against a shelf is
// a ledger of claims. Counting is the only one of these that involves leaving
// the office.
//
// One screen at a time, because they do not share a library. This file used to
// hold all five and import everything any of them touched, so opening Prices —
// which is read-only and writes nothing — pulled in the PDF writer, the stores
// ledger and the stock-count arithmetic, and a phone on a site downloaded all
// of it before it could show a rate.
const Inventory = lazy(() => import('./materials/InventoryTab'))
const Verify = lazy(() => import('./materials/VerifyTab'))
const Prices = lazy(() => import('./materials/PricesTab'))
const Quotations = lazy(() => import('./materials/QuotationsTab'))
const Usage = lazy(() => import('./materials/UsageTab'))

const VIEWS = [
  { id: 'stock', label: 'Inventory', icon: Boxes, View: Inventory },
  { id: 'count', label: 'Verify', icon: ClipboardCheck, View: Verify },
  { id: 'prices', label: 'Prices', icon: IndianRupee, View: Prices },
  { id: 'quotes', label: 'Quotations', icon: FileText, View: Quotations },
  { id: 'usage', label: 'Usage', icon: HardHat, View: Usage },
]

export default function Materials(shared) {
  const [view, setView] = useState('stock')
  const { View } = VIEWS.find((v) => v.id === view) || VIEWS[0]
  return (
    <div className="space-y-4">
      {/* One scrolling row, like the bar above it. These wrapped 3/2 on a
          phone — a second tab idiom, in a second shape, directly under the
          first. `shrink-0` so the pills keep their size and the row runs off
          the end instead of squeezing. */}
      <div className="scroll-row flex gap-1" role="tablist" aria-label="Materials">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            onClick={() => setView(v.id)}
            aria-selected={view === v.id}
            className={cx(
              'inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-xs font-semibold transition',
              view === v.id
                ? 'border-brand bg-brand/15 text-ink-1'
                : 'border-line text-ink-5 hover:border-line-strong hover:text-ink-2',
            )}
          >
            <v.icon size={14} /> {v.label}
          </button>
        ))}
      </div>

      <Suspense fallback={<Card className="p-5"><Spinner className="py-10" /></Card>}>
        <View {...shared} />
      </Suspense>
    </div>
  )
}
