import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { isCloud } from '../lib/storage'
import { listTeam } from '../lib/team'
import { useAuth } from './AuthContext'

const WorkspaceContext = createContext(null)
export const useWorkspace = () => useContext(WorkspaceContext)

// Tracks which workspace the user is viewing: their own (default, read/write) or
// one shared with them (read-only). Only relevant in cloud mode.
export function WorkspaceProvider({ children }) {
  const { user } = useAuth()
  const myId = user?.id || 'me'
  const [shared, setShared] = useState([]) // memberships where I'm the member
  const [activeOwner, setActiveOwner] = useState(myId)

  const refresh = useCallback(async () => {
    if (!isCloud || !user) return setShared([])
    try {
      const { sharedWithMe } = await listTeam()
      setShared(sharedWithMe)
    } catch {
      setShared([])
    }
  }, [user])

  // Reset to my own workspace whenever the signed-in user changes.
  useEffect(() => {
    setActiveOwner(myId)
  }, [myId])
  useEffect(() => {
    refresh()
  }, [refresh])

  const workspaces = useMemo(() => {
    const list = [{ ownerId: myId, label: 'My workspace', own: true }]
    for (const m of shared) list.push({ ownerId: m.owner_id, label: m.owner_email || 'Shared workspace', own: false })
    return list
  }, [shared, myId])

  const isOwnWorkspace = activeOwner === myId
  // Your role in the active workspace: owner (your own), or the membership role
  // shared with you (editor can write, viewer is read-only).
  const activeRole = isOwnWorkspace ? 'owner' : shared.find((m) => m.owner_id === activeOwner)?.role || 'viewer'
  const canWriteActive = isOwnWorkspace || activeRole === 'editor'

  const value = useMemo(
    () => ({
      myId,
      activeOwner,
      setActiveOwner,
      workspaces,
      hasShared: shared.length > 0,
      isOwnWorkspace,
      activeRole,
      canWriteActive,
      activeLabel: workspaces.find((w) => w.ownerId === activeOwner)?.label || 'Workspace',
      refresh,
    }),
    [myId, activeOwner, workspaces, shared, isOwnWorkspace, activeRole, canWriteActive, refresh],
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
