import { useMemo } from 'react'
import { useEntity } from '../context/EntityContext'
import * as store from '../lib/storage/corporate'
import { isOpen, PROJECT_STATUS } from '../lib/projects'
import { Field, Select } from './ui'

// Which job a cost belongs to.
//
// Offered only in a single company's books. A personal expense has no site, and
// the consolidated view spans companies whose sites are not interchangeable —
// booking a cost from one company's books to another's job is not a thing a
// form should make possible.
//
// Absent entirely when the company has no sites yet, rather than rendered as a
// select whose only option says "none". A question with one answer is not a
// question; it is a field people learn to skip, and then skip once it matters.
export function useSites() {
  const ent = useEntity()
  const scoped = Boolean(ent?.corporate && ent.activeId && !ent.consolidated)
  return useMemo(
    () => (scoped ? store.projects.list(ent.activeId) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoped, ent?.activeId, ent?.version],
  )
}

export default function SiteField({ value, onChange, className = 'sm:col-span-2', hint }) {
  const sites = useSites()
  if (sites.length === 0) return null

  // Closed jobs stay selectable — a bill for a finished site arrives weeks
  // later and has to land on it — but they sit below, out of the way of the
  // ones being worked on.
  const open = sites.filter((s) => isOpen(s.status))
  const closed = sites.filter((s) => !isOpen(s.status))

  return (
    <Field
      className={className}
      label="Site"
      hint={hint || 'A cost with no site is one no job is charged for.'}
    >
      <Select aria-label="Site" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not booked to a site</option>
        {open.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}{s.status !== 'active' ? ` — ${PROJECT_STATUS[s.status]?.label || s.status}` : ''}
          </option>
        ))}
        {closed.length > 0 && (
          <optgroup label="Completed">
            {closed.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </optgroup>
        )}
      </Select>
    </Field>
  )
}
