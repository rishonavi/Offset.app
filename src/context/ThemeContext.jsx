import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { DEFAULT_ACCENT, accentById, applyAccent } from '../lib/appearance'

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
  const [accent, setAccentState] = useState(() => accentById(read('pl_accent', DEFAULT_ACCENT)).id)
  const [avatar, setAvatarState] = useState(readAvatar)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    save('pl_theme', theme)
  }, [theme])

  useEffect(() => {
    applyAccent(accent)
    // Gold is what the stylesheet already says, so storing it would only make a
    // default look like a decision. Removing the key means "no choice made".
    save('pl_accent', accent === DEFAULT_ACCENT ? null : accent)
  }, [accent])

  useEffect(() => {
    save('pl_avatar', Object.keys(avatar).length ? JSON.stringify(avatar) : null)
  }, [avatar])

  const value = useMemo(
    () => ({
      theme,
      toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
      accent,
      setAccent: (id) => setAccentState(accentById(id).id),
      avatar,
      // Merging rather than replacing, so setting a name does not silently drop
      // the symbol someone picked a minute earlier.
      setAvatar: (patch) => setAvatarState((a) => ({ ...a, ...patch })),
      resetAvatar: () => setAvatarState({}),
    }),
    [theme, accent, avatar],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
