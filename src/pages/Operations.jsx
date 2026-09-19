import { Suspense, lazy, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Boxes, HandCoins, Users, HardHat, Truck, Building2, Wallet, FileSpreadsheet } from 'lucide-react'
import { useEntity } from '../context/EntityContext'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import * as store from '../lib/storage/corporate'

import { formatCurrency } from '../lib/format'
import { approvalQueue } from '../lib/corporate'
import { Card, EmptyState, Spinner, cx } from '../components/ui'
import PageHeader from '../components/PageHeader'

// Every tab is its own chunk, including the one that opens first.
//
// Three of these were split out and five were not, under a comment claiming
// all of them had been. The five that were left carried the whole page: eight
// hundred lines of sites, nine hundred of labour, the plant register and the
// sales ledger, plus the spreadsheet reader behind Import — so somebody
// opening Materials to look up one rate downloaded the payroll screen, the
// muster, the machine log and `xlsx` to do it.
//
// Splitting the default tab as well costs one paint of the loading line on a
// cold visit and saves that download on every other tab.
const Projects = lazy(() => import('../components/ProjectsTabs'))
const Materials = lazy(() => import('../components/MaterialsTabs'))
const Labour = lazy(() => import('../components/LabourTabs'))
const Plant = lazy(() => import('../components/PlantTabs'))
const Sales = lazy(() => import('../components/SalesTabs'))
const Advances = lazy(() => import('../components/operations/AdvancesTab'))
const Payroll = lazy(() => import('../components/operations/PayrollTab'))
const SheetImport = lazy(() => import('../components/SheetImport'))

// Sites, materials, labour, plant, advances and payroll — what a company runs
// on and a landlord does not.
//
// All three were written and tested a while ago and had no screen at all, which
// made them the largest gap in the app: 151 assertions of working logic that
// nobody could reach. They share a page rather than taking three more places in
// the side bar, because they are one job — running the company behind the
// property — and because eleven destinations was already too many.
const TABS = [
  // Sites first: everything else on this page is a cost, and a cost belongs to
  // a job before it belongs to a ledger.
  { id: 'projects', label: 'Projects', icon: HardHat },
  { id: 'materials', label: 'Materials', icon: Boxes },
  { id: 'labour', label: 'Labour', icon: Users },
  { id: 'plant', label: 'Plant', icon: Truck },
  // The other side of the ledger: what the company is building to sell.
  { id: 'sales', label: 'Sales', icon: Building2 },
  { id: 'advances', label: 'Advances', icon: HandCoins },
  { id: 'payroll', label: 'Payroll', icon: Wallet },
  // Everything here can be typed in and on a real site nothing is.
  { id: 'import', label: 'Import', icon: FileSpreadsheet },
]

export default function Operations() {
  const ent = useEntity()
  // Bills and invoices live in the main ledger, not the corporate store, and a
  // site's cost is meaningless without them.
  const { expenses, income } = useData()
  const toast = useToast()
  // In the URL, so a finding somewhere else can send somebody straight to the
  // thing it is about. A note saying "₹60,000 of plant hire has no log sheet"
  // that then makes you hunt through seven tabs is a note people stop reading.
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'projects'
  const setTab = (id) => setParams(id === 'projects' ? {} : { tab: id }, { replace: true })
  // The corporate store is synchronous and outside React, so a counter is what
  // tells the page something changed. It is the same pattern EntityContext uses.
  const [version, setVersion] = useState(0)
  const bump = () => setVersion((v) => v + 1)

  const eid = ent?.activeId
  const scoped = ent?.corporate && eid && !ent.consolidated

  const data = useMemo(() => {
    if (!scoped) return null
    return {
      items: store.items.list(eid),
      movements: store.movements.list(eid),
      stockCounts: store.stockCounts.list(eid),
      quotes: store.quotes.list(eid),
      projects: store.projects.list(eid),
      muster: store.muster.list(eid),
      workOrders: store.workOrders.list(eid),
      raBills: store.raBills.list(eid),
      workItems: store.workItems.list(eid),
      measurements: store.measurements.list(eid),
      plant: store.plant.list(eid),
      plantLogs: store.plantLogs.list(eid),
      units: store.units.list(eid),
      planStages: store.planStages.list(),
      receipts: store.receipts.list(eid),
      advances: store.advances.list(eid),
      adjustments: store.adjustments.list(),
      employees: store.employees.list(eid),
      payrollRuns: store.payrollRuns.list(eid),
      expenses,
      income,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, eid, version, expenses, income])

  // A control nobody finds gets switched off, and the queue lives on another
  // page — so the page where the documents are raised says when something is
  // held up, rather than waiting to be visited.
  const waiting = useMemo(() => {
    if (!scoped || !ent.policy?.enabled) return approvalQueue([])
    return approvalQueue([
      { kind: 'expense', rows: expenses.filter((e) => e.entity_id === eid) },
      { kind: 'advance', rows: data?.advances || [] },
      { kind: 'workorder', rows: data?.workOrders || [] },
      { kind: 'rabill', rows: data?.raBills || [] },
    ], { role: ent.role, userId: ent.actor?.id })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoped, eid, data, expenses, ent.policy?.enabled, ent.role])

  if (!ent?.enabled) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader title="Operations" subtitle="Sites, materials, labour, plant, sales and payroll." />
        <EmptyState
          icon={Boxes}
          title="Add a company first"
          subtitle="Sites, materials, labour, plant, sales and payroll belong to a company. Create one under Companies and this fills in."
        />
      </div>
    )
  }
  if (!scoped) {
    const personal = ent.personal
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader title="Operations" subtitle="Sites, materials, labour, plant, sales and payroll." />
        <EmptyState
          icon={Boxes}
          title={personal ? 'You are in your personal books' : 'Pick one company'}
          subtitle={
            personal
              ? 'Sites, materials, labour, plant, sales and payroll belong to a company. Switch to one at the top of the side bar and this fills in.'
              : 'These are kept per company, so the consolidated view has nothing to show. Switch to a single company above.'
          }
        />
      </div>
    )
  }

  const canWrite = ent.canWrite && ent.can('entry.create')
  // What goes at the top of anything that leaves the building.
  const company = { name: ent.entity?.name || 'Company', gstin: ent.entity?.gstin || '', address: ent.entity?.address || '' }
  // The company's own year, not April by assumption: a tax year that starts in
  // the wrong month adds a contractor's payments into the wrong return.
  const shared = { data, eid, actor: ent.actor, canWrite, bump, toast, gate: ent.gate, role: ent.role, company, fyStart: ent.entity?.fy_start_month || 4, entity: ent.entity, reloadEntity: ent.reload }

  return (
    <div className="animate-fade-in space-y-6">
      <PageHeader title="Operations" subtitle={`Sites, materials, labour, plant, sales and payroll for ${ent.entity?.name || 'this company'}.`} />

      {waiting.count > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-ink-3">
            <strong className="text-ink-1">
              {waiting.count} {waiting.count === 1 ? 'document is' : 'documents are'} waiting for approval
            </strong>
            , holding {formatCurrency(waiting.total)}.
            {waiting.mine > 0 && ` ${waiting.mine} you can sign.`}
          </p>
          <Link to="/companies" className="text-sm font-semibold text-brand underline-offset-4 hover:underline">
            Review them
          </Link>
        </Card>
      )}

      <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface-raised p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={cx(
              'inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 text-[0.8rem] font-semibold transition',
              tab === t.id ? 'bg-brand text-navy' : 'text-ink-5 hover:text-ink-2',
            )}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      <Suspense fallback={<Card className="p-5"><Spinner className="py-10" /></Card>}>
        {tab === 'projects' && <Projects {...shared} />}
        {tab === 'materials' && <Materials {...shared} />}
        {tab === 'labour' && <Labour {...shared} />}
        {tab === 'plant' && <Plant {...shared} />}
        {tab === 'sales' && <Sales {...shared} />}
        {tab === 'advances' && <Advances {...shared} />}
        {tab === 'payroll' && <Payroll {...shared} />}
        {tab === 'import' && <SheetImport {...shared} />}
      </Suspense>
    </div>
  )
}

