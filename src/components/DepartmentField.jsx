import { useMemo } from 'react'
import { useEntity } from '../context/EntityContext'
import { departmentOptions } from '../lib/costcentres'
import { Field, Select } from './ui'

// Which part of the company carries this cost.
//
// The same rule as SiteField, and for the same reasons: offered only inside a
// single company's books, because a personal expense has no cost centre and the
// consolidated view spans companies whose departments are not interchangeable.
// Absent entirely when the company has no departments, rather than rendered as
// a select whose only option says "none".
//
// A site and a cost centre are different questions and a cost can need both.
// The tower is the job the money was spent on; Construction is the part of the
// company whose budget it came out of. A firm with one division and ten sites
// uses one of them; a firm with three divisions and one site uses the other.
export default function DepartmentField({ value, onChange, className = 'sm:col-span-2', hint }) {
  const ent = useEntity()
  const scoped = Boolean(ent?.corporate && ent.activeId && !ent.consolidated)
  const options = useMemo(
    () => (scoped ? departmentOptions(ent.departments || [], { entityId: ent.activeId }) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoped, ent?.activeId, ent?.departments, ent?.version],
  )
  if (options.length === 0) return null

  return (
    <Field
      className={className}
      label="Cost centre"
      hint={hint || 'Whose budget this comes out of. A cost with none is one no department is answering for.'}
    >
      <Select aria-label="Cost centre" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not booked to a cost centre</option>
        {options.map((o) => (
          // Indented by depth and labelled with the path, so two teams called
          // "Site" in different divisions are told apart in a list that is only
          // ever seen one line at a time.
          <option key={o.id} value={o.id}>
            {`${'  '.repeat(o.depth)}${o.name}${o.code ? ` (${o.code})` : ''}`}
          </option>
        ))}
      </Select>
    </Field>
  )
}
