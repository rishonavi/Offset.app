import { differenceInCalendarDays, parseISO, isValid } from 'date-fns'

// Tenancy / lease summary for a rental asset, or null when nothing is set.
// state: upcoming | active | ending (<= 60 days left) | expired.
export function leaseStatus(property, today = new Date()) {
  const tenant = property?.tenant_name || ''
  const start = property?.lease_start ? parseISO(property.lease_start) : null
  const end = property?.lease_end ? parseISO(property.lease_end) : null
  const deposit = Number(property?.deposit) || 0
  const hasStart = start && isValid(start)
  const hasEnd = end && isValid(end)
  if (!tenant && !hasStart && !hasEnd && !deposit) return null

  let state = 'active'
  let daysLeft = null
  if (hasEnd) {
    daysLeft = differenceInCalendarDays(end, today)
    state = daysLeft < 0 ? 'expired' : daysLeft <= 60 ? 'ending' : 'active'
  }
  if (hasStart && differenceInCalendarDays(start, today) > 0) state = 'upcoming'

  return {
    tenant,
    start: hasStart ? property.lease_start : null,
    end: hasEnd ? property.lease_end : null,
    deposit,
    daysLeft,
    state,
  }
}

// Leases that are ending soon or already expired, across all assets — for the
// dashboard renewal nudge.
export function leasesNeedingAttention(properties, today = new Date()) {
  return properties
    .map((property) => ({ property, lease: leaseStatus(property, today) }))
    .filter((x) => x.lease && (x.lease.state === 'ending' || x.lease.state === 'expired'))
    .sort((a, b) => (a.lease.daysLeft ?? 0) - (b.lease.daysLeft ?? 0))
}
