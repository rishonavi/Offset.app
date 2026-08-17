import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useAuth } from './AuthContext'
import { CONSOLIDATED, isConsolidated, can, canWriteIn, roleFor } from '../lib/corporate'
import * as store from '../lib/storage/corporate'

const EntityContext = createContext(null)
export const useEntity = () => useContext(EntityContext)

// Which company the app is currently looking at, who you are inside it, and
// what that lets you do.
//
// The corporate layer is dormant until the first company exists. Until then
// `enabled` is false and every consumer behaves exactly as the personal app
// always has — no entity column, no roles, no approvals. That is deliberate:
// a landlord tracking two flats should never meet any of this.
export function EntityProvider({ children }) {
  const { user } = useAuth()
  const [entities, setEntities] = useState([])
  const [members, setMembers] = useState([])
  const [departments, setDepartments] = useState([])
  const [activeId, setActiveId] = useState('')
  const [version, setVersion] = useState(0)

  const reload = useCallback(() => {
    setEntities(store.listEntities().filter((e) => !e.archived_at))
    setMembers(store.listMembers())
    setDepartments(store.listDepartments())
    setVersion((v) => v + 1)
  }, [])

  useEffect(() => {
    reload()
    setActiveId(store.activeEntityId())
  }, [reload])

  const enabled = entities.length > 0

  // A stored id can point at a company that has since been archived, and the
  // consolidated view only makes sense with more than one company.
  const active = useMemo(() => {
    if (!enabled) return ''
    if (isConsolidated(activeId)) return entities.length > 1 ? CONSOLIDATED : entities[0].id
    return entities.some((e) => e.id === activeId) ? activeId : entities[0].id
  }, [activeId, entities, enabled])

  const entity = useMemo(() => entities.find((e) => e.id === active) || null, [entities, active])

  const switchTo = useCallback((id) => {
    store.setActiveEntity(id)
    setActiveId(id)
  }, [])

  const userId = user?.id || 'local-user'
  const role = useMemo(() => {
    if (!enabled) return null
    // The consolidated view shows what you can see anywhere, at the weakest
    // level of authority you hold — it spans companies with different rules.
    if (isConsolidated(active)) return 'auditor'
    return roleFor(members, active, userId) || null
  }, [enabled, active, members, userId])

  const actor = useMemo(() => ({ id: userId, email: user?.email || '' }), [userId, user])

  const value = useMemo(() => {
    const entityDepartments = departments.filter((d) => d.entity_id === active)
    return {
      enabled,
      entities,
      entity,
      activeId: active,
      consolidated: isConsolidated(active),
      switchTo,
      reload,
      version,

      role,
      actor,
      members: members.filter((m) => m.entity_id === active),
      allMembers: members,
      // `can` is the single question every screen asks. With the corporate
      // layer off it answers yes, so the personal app is unchanged.
      can: (permission) => (!enabled ? true : can(role, permission)),
      canWrite: !enabled ? true : canWriteIn(active, role),

      departments: entityDepartments,
      allDepartments: departments,
      policy: enabled && !isConsolidated(active) ? store.approvalPolicy(active) : { enabled: false, threshold: 0, alwaysCategories: [] },

      // Rows carry an entity_id once the corporate layer is on. Personal rows
      // never had one, so with it off everything is in scope.
      inEntity: (rows) => {
        if (!enabled) return rows
        if (isConsolidated(active)) return rows.filter((r) => entities.some((e) => e.id === r.entity_id))
        return rows.filter((r) => r.entity_id === active)
      },
      // What to stamp on a new row.
      stamp: () => (enabled && !isConsolidated(active) ? { entity_id: active } : {}),
    }
  }, [enabled, entities, entity, active, switchTo, reload, version, role, actor, members, departments])

  return <EntityContext.Provider value={value}>{children}</EntityContext.Provider>
}
