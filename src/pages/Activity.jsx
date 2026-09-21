import { useMemo } from 'react'
import { ScrollText } from 'lucide-react'
import { useEntity } from '../context/EntityContext'
import * as store from '../lib/storage/corporate'
import { EmptyState } from '../components/ui'
import PageHeader from '../components/PageHeader'
import AuditLog from '../components/AuditLog'

// Everything anybody changed, on a page of its own.
//
// The trail used to be the last card at the bottom of Companies, under the
// approval policy and the closing-the-books panel — a place you land on when
// you are administering a company, not when you are asking who moved a rate.
// Those are different errands, and the second one is the common one.
//
// Its own destination also means its own URL, so "look at what happened on the
// 4th" is a link somebody can send.
export default function Activity() {
  const ent = useEntity()

  // The whole trail for this company, not a page of it: the filters below are
  // the point of the screen, and filtering the last forty is filtering the
  // wrong thing.
  const events = useMemo(
    () => (ent.enabled ? store.listAudit({ entityId: ent.consolidated ? null : ent.activeId, limit: 2000 }) : []),
    [ent.enabled, ent.activeId, ent.consolidated, ent.version],
  )

  if (!ent.enabled) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader title="Activity" subtitle="Who changed what, and what it was before." />
        <EmptyState
          icon={ScrollText}
          title="Nothing to keep track of yet"
          subtitle="The trail records who changed what once there is a company with people in it. Your own books are yours alone, so nothing is logged against them."
        />
      </div>
    )
  }

  if (!ent.can('audit.view')) {
    return (
      <div className="animate-fade-in space-y-6">
        <PageHeader title="Activity" subtitle="Who changed what, and what it was before." />
        <EmptyState
          icon={ScrollText}
          title="Not yours to read"
          subtitle="The trail is visible to owners, finance and auditors. Ask somebody with one of those roles."
        />
      </div>
    )
  }

  return (
    <div className="animate-fade-in space-y-5">
      <PageHeader
        title="Activity"
        subtitle={ent.consolidated ? 'Every company, most recent first.' : `${ent.entity?.name || 'This company'}, most recent first.`}
      />
      <AuditLog events={events} />
    </div>
  )
}
