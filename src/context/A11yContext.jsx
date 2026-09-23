import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULTS, applyA11y, cycle, readStored, writeStored, activeCount, isDefault } from '../lib/a11y'

const A11yContext = createContext(null)

// Separate from ThemeContext on purpose. That one is taste — an accent, a
// tone, an avatar — and a person changes it once and forgets it. This is
// somebody's ability to read the screen, it is changed under pressure, and it
// has a reset. Mixing them would mean a "reset appearance" that either throws
// away the accessibility settings or quietly does not.
export const useA11y = () => useContext(A11yContext)

export function A11yProvider({ children }) {
  // Read once, synchronously, so the first render already matches what the
  // inline script in index.html put on the document. Reading it in an effect
  // instead would paint the app unadjusted for a frame, which for somebody who
  // turned the colours down because of light sensitivity is the frame that
  // hurts.
  const [settings, setSettings] = useState(readStored)

  useEffect(() => {
    applyA11y(settings)
    writeStored(settings)
  }, [settings])

  const value = useMemo(
    () => ({
      settings,
      count: activeCount(settings),
      isDefault: isDefault(settings),
      step: (key) => setSettings((s) => cycle(s, key)),
      reset: () => setSettings({ ...DEFAULTS }),
    }),
    [settings],
  )

  return <A11yContext.Provider value={value}>{children}</A11yContext.Provider>
}
