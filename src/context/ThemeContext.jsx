import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_ACCENT, DEFAULT_TONE, accentById, toneById, applyAppearance } from '../lib/appearance'

const ThemeContext = createContext(null)

export const useTheme = () => useContext(ThemeContext)
// Appearance is everything someone has chosen about how Offset looks. It rides
// with the theme because it is stored the same way and applied at the same
// moment — one provider, one place a flash of the wrong colour could come from.
export const useAppearance = () => useContext(ThemeContext)

const read = (key, fallback) => {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

const save = (key, value) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* a browser refusing to store a preference is not worth an error */
  }
}

// The avatar is stored as one blob because its parts only make sense together.
// A malformed value falls back to the default rather than taking the app down.
const readAvatar = () => {
  try {
    const raw = localStorage.getItem('pl_avatar')
    if (!raw) return {}
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {}
  } catch {
    return {}
  }
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    // The no-FOUC inline script in index.html may already have set the class.
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
      return 'dark'
    }
    return read('pl_theme', 'light')
  })
  // An accent is a preset id or a hue somebody chose, kept as written. Passing
  // it through accentById would turn every custom hue back into gold.
  const [accent, setAccentState] = useState(() => read('pl_accent', DEFAULT_ACCENT))
  const [tone, setToneState] = useState(() => toneById(read('pl_tone', DEFAULT_TONE)).id)
  const [avatar, setAvatarState] = useState(readAvatar)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    save('pl_theme', theme)
  }, [theme])

  useEffect(() => {
    applyAppearance({ accent, tone })
    // The defaults are what the stylesheet already says, so storing them would
    // only make a default look like a decision. Removing the key means "no
    // choice made".
    save('pl_accent', accent === DEFAULT_ACCENT ? null : accent)
    save('pl_tone', tone === DEFAULT_TONE ? null : tone)
  }, [accent, tone])

  useEffect(() => {
    save('pl_avatar', Object.keys(avatar).length ? JSON.stringify(avatar) : null)
  }, [avatar])

  const value = useMemo(
    () => ({
      theme,
      toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
      accent,
      setAccent: (value) => setAccentState(String(value)),
      tone,
      setTone: (id) => setToneState(toneById(id).id),
      avatar,
      // Merging rather than replacing, so setting a name does not silently drop
      // the symbol someone picked a minute earlier.
      setAvatar: (patch) => setAvatarState((a) => ({ ...a, ...patch })),
      resetAvatar: () => setAvatarState({}),
    }),
    [theme, accent, tone, avatar],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
