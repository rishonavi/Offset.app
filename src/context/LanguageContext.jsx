import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import en from '../locales/en'
import {
  DEFAULT_LANG, LANGUAGES, coverage, detectLanguage, languageFor,
  loadDictionary, storeLanguage, storedLanguage, translate,
} from '../lib/i18n'

const LanguageContext = createContext(null)
export const useLanguage = () => useContext(LanguageContext)

// The hook components actually use: `const t = useT()` then `t('nav.assets')`.
export const useT = () => useContext(LanguageContext).t

// Sits above everything, including the router, because the language decides
// what the very first screen says. English is bundled — it is the fallback for
// every other language — and the rest load when chosen, so a user who never
// changes this downloads nothing extra.
export function LanguageProvider({ children }) {
  // '' means "follow the browser", which is a different state from having
  // explicitly chosen English: it keeps tracking the browser if that changes.
  const [chosen, setChosen] = useState(() => storedLanguage())
  const [dict, setDict] = useState({})

  const active = useMemo(
    () => chosen || detectLanguage(typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : []),
    [chosen],
  )

  useEffect(() => {
    let live = true
    if (active === DEFAULT_LANG) {
      setDict({})
      return
    }
    // A failed chunk means the app keeps speaking English rather than breaking.
    loadDictionary(active).then((d) => live && setDict(d)).catch(() => live && setDict({}))
    return () => {
      live = false
    }
  }, [active])

  // Screen readers announce content in the page's declared language, and the
  // browser picks fonts and hyphenation from it, so this has to be told.
  useEffect(() => {
    const meta = languageFor(active)
    document.documentElement.lang = active
    document.documentElement.dir = meta.dir
  }, [active])

  const t = useCallback(
    (key, vars) => translate({ dict, base: en, lang: active }, key, vars),
    [dict, active],
  )

  const setLanguage = useCallback((code) => {
    storeLanguage(code)
    setChosen(code)
  }, [])

  const value = useMemo(
    () => ({
      lang: active,
      chosen,
      setLanguage,
      t,
      languages: LANGUAGES,
      meta: languageFor(active),
      // How much of the current language is actually filled in — the picker
      // says so rather than letting the user find the gaps a screen at a time.
      coverage: coverage(dict, en),
    }),
    [active, chosen, setLanguage, t, dict],
  )

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
}
