import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// App-wide config driven by the admin area: the broadcast banner, maintenance
// mode, and editable plan limits. Publicly readable; empty in demo mode.
const DEFAULTS = { announcement: null, maintenance: null, plans: null }
const ConfigContext = createContext(DEFAULTS)
export const useConfig = () => useContext(ConfigContext)

export function ConfigProvider({ children }) {
  const [config, setConfig] = useState(DEFAULTS)

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase
      .from('app_config')
      .select('key, value')
      .then(({ data }) => {
        if (!active || !data) return
        const map = {}
        for (const row of data) map[row.key] = row.value
        setConfig({
          announcement: map.announcement || null,
          maintenance: map.maintenance || null,
          plans: map.plans || null,
        })
      })
    return () => {
      active = false
    }
  }, [])

  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
}
