import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { isCloud } from '../lib/storage'
import * as store from '../lib/storage/corporate'
import { syncAll } from '../lib/storage/corporateSync'
import { syncState, duplicates, isAppendOnly } from '../lib/sync'
import { useEntity } from './EntityContext'

const SyncContext = createContext(null)
export const useSync = () => useContext(SyncContext)

// Keeping the company's books the same on every device that touches them.
//
// Reads never wait for this. Everything on screen comes from the copy on the
// device, so the app works the same in a basement as it does in an office, and
// a write lands locally before anything is sent anywhere. This runs alongside:
// when there is a connection it reconciles, and when there is not it says so
// and counts what is waiting.
//
// In demo mode there is no server to reconcile with, and the honest thing is to
// say that rather than show a reassuring tick.
export function SyncProvider({ children }) {
  const ent = useEntity()
  const [state, setState] = useState(() => syncState({ collections: {}, online: true }))
  const [conflicts, setConflicts] = useState([])
  const [running, setRunning] = useState(false)
  const [lastAt, setLastAt] = useState(null)
  const [progress, setProgress] = useState(null)
  // A second run started while the first is in flight would push the same rows
  // twice and race its own writes.
  const busy = useRef(false)

  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false

  // Recomputed from what is actually on the device rather than remembered from
  // the last run, so a write made thirty seconds ago is counted immediately.
  const recount = useCallback((error = null, at = lastAt) => {
    const collections = {}
    for (const kind of Object.keys(store.collections)) collections[kind] = store.collections[kind].list(null, { withDeleted: true })
    setState(syncState({
      collections,
      lastSyncedAt: at,
      online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
      error,
    }))
  }, [lastAt])

  const run = useCallback(async () => {
    if (!isCloud || !supabase || busy.current) return null
    if (typeof navigator !== 'undefined' && navigator.onLine === false) { recount(); return null }
    busy.current = true
    setRunning(true)
    try {
      const result = await syncAll(
        supabase,
        (kind) => store.collections[kind]?.list(null, { withDeleted: true }) || [],
        (kind, rows) => store.collections[kind]?.replaceAll(rows),
        {
          entityIds: ent?.entities?.map((e) => e.id) || null,
          onProgress: setProgress,
        },
      )
      setLastAt(result.at)
      setConflicts((prev) => [...result.conflicts, ...prev].slice(0, 100))
      setState(result.state)
      ent?.reload?.()
      return result
    } catch (e) {
      recount(e?.message || String(e))
      return null
    } finally {
      busy.current = false
      setRunning(false)
      setProgress(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ent?.entities, recount])

  // On arrival, and whenever the connection comes back. A site engineer who
  // walks out of a basement should not have to find a button.
  useEffect(() => {
    recount()
    if (!isCloud) return undefined
    run()
    const back = () => { recount(); run() }
    const away = () => recount()
    window.addEventListener('online', back)
    window.addEventListener('offline', away)
    const every = setInterval(run, 5 * 60 * 1000)
    return () => {
      window.removeEventListener('online', back)
      window.removeEventListener('offline', away)
      clearInterval(every)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recount whenever anything in the corporate store changed.
  useEffect(() => { recount() }, [ent?.version, recount])

  // The same day entered twice, which is what goes wrong when several people
  // keep one ledger. Computed here rather than during a sync, because it is
  // just as true of two entries made on one device.
  const doubled = useMemo(() => {
    const out = []
    for (const kind of Object.keys(store.collections)) {
      if (!isAppendOnly(kind)) continue
      out.push(...duplicates(store.collections[kind].list(ent?.activeId || null), kind))
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ent?.version, ent?.activeId, lastAt])

  const value = useMemo(() => ({
    // False in demo mode, where there is nothing to reconcile with. Saying so
    // beats a tick that means nothing.
    enabled: isCloud,
    online,
    running,
    progress,
    state,
    conflicts,
    duplicates: doubled,
    duplicateCount: doubled.reduce((t, d) => t + d.others.length, 0),
    run,
    dismissConflict: (id) => setConflicts((prev) => prev.filter((c) => c.id !== id)),
    clearConflicts: () => setConflicts([]),
  }), [online, running, progress, state, conflicts, doubled, run])

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>
}
