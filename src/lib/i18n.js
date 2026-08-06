// Choosing the language the app speaks.
//
// Deliberately small: a dictionary is a flat object of key → string, English is
// the source of truth, and anything a translation hasn't covered falls back to
// English rather than showing a raw key. That fallback is what makes it safe to
// translate the app in pieces instead of all at once.
//
// Adding a language is one file in src/locales and one line in LANGUAGES below.

export const DEFAULT_LANG = 'en'

// `name` is the endonym — a language picker that lists "Hindi" is no use to
// someone who can only read हिन्दी. `english` is for the sighted-in-English
// operator reading a bug report.
export const LANGUAGES = [
  { code: 'en', name: 'English', english: 'English', dir: 'ltr' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi', dir: 'ltr' },
  { code: 'mr', name: 'मराठी', english: 'Marathi', dir: 'ltr' },
  { code: 'gu', name: 'ગુજરાતી', english: 'Gujarati', dir: 'ltr' },
  { code: 'bn', name: 'বাংলা', english: 'Bengali', dir: 'ltr' },
  { code: 'ta', name: 'தமிழ்', english: 'Tamil', dir: 'ltr' },
]

export const isSupported = (code) => LANGUAGES.some((l) => l.code === code)
export const languageFor = (code) => LANGUAGES.find((l) => l.code === code) || LANGUAGES[0]

// "hi-IN", "HI", " hi " all mean Hindi. Anything else means English.
export function normaliseLang(code) {
  const base = String(code || '').trim().toLowerCase().split(/[-_]/)[0]
  return isSupported(base) ? base : ''
}

// First of the browser's preferences that Offset actually speaks. Someone whose
// browser is set to Marathi should not have to go and find the setting.
export function detectLanguage(preferences = []) {
  for (const p of preferences) {
    const code = normaliseLang(p)
    if (code) return code
  }
  return DEFAULT_LANG
}

// ── Interpolation ──────────────────────────────────────────────────
// {name} placeholders, because word order differs between languages and a
// translator must be able to move them.
export function interpolate(text, vars) {
  if (!vars) return text
  return String(text).replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole))
}

// ── Plurals ────────────────────────────────────────────────────────
// A key may be written as one string, or split into `key_one` / `key_other`
// (and `_zero`, `_two`, `_few`, `_many` for languages that need them). Intl
// decides which form applies, so this doesn't hard-code English's two-way split.
const pluralRules = new Map()
function pluralCategory(lang, count) {
  try {
    if (!pluralRules.has(lang)) pluralRules.set(lang, new Intl.PluralRules(lang))
    return pluralRules.get(lang).select(count)
  } catch {
    return count === 1 ? 'one' : 'other'
  }
}

function pick(dict, key, vars, lang) {
  if (vars && typeof vars.count === 'number') {
    const category = pluralCategory(lang, vars.count)
    const exact = dict[`${key}_${category}`]
    if (exact != null) return exact
    const other = dict[`${key}_other`]
    if (other != null) return other
  }
  return dict[key]
}

// translate(dictionaries, key, vars) — dictionaries are tried in order, so the
// live language comes first and English last.
export function translate({ dict = {}, base = {}, lang = DEFAULT_LANG }, key, vars) {
  const found = pick(dict, key, vars, lang) ?? pick(base, key, vars, DEFAULT_LANG)
  // A key that exists in neither is a bug in the app, not in the translation.
  // Showing the key's tail beats showing "undefined" or an empty gap.
  if (found == null) return interpolate(key.split('.').pop(), vars)
  return interpolate(found, vars)
}

// ── Coverage ───────────────────────────────────────────────────────
// What a translation has and hasn't reached, so the picker can be honest about
// it rather than letting someone discover the gaps one screen at a time.
export function coverage(dict = {}, base = {}) {
  const keys = Object.keys(base)
  if (!keys.length) return { done: 0, total: 0, percent: 100, missing: [] }
  const missing = keys.filter((k) => {
    if (dict[k] != null) return false
    // A pluralised key counts as covered if any of its forms is present.
    return !Object.keys(dict).some((d) => d.startsWith(`${k}_`))
  })
  const done = keys.length - missing.length
  return { done, total: keys.length, percent: Math.round((done / keys.length) * 100), missing }
}

// ── Loading ────────────────────────────────────────────────────────
// English ships in the main bundle because it is the fallback for everything
// else; the rest arrive only when chosen.
export async function loadDictionary(code) {
  if (!isSupported(code) || code === DEFAULT_LANG) return {}
  switch (code) {
    case 'hi': return (await import('../locales/hi.js')).default
    case 'mr': return (await import('../locales/mr.js')).default
    case 'gu': return (await import('../locales/gu.js')).default
    case 'bn': return (await import('../locales/bn.js')).default
    case 'ta': return (await import('../locales/ta.js')).default
    default: return {}
  }
}

export const STORAGE_KEY = 'pl_lang'

export function storedLanguage() {
  try {
    return normaliseLang(localStorage.getItem(STORAGE_KEY)) || ''
  } catch {
    return ''
  }
}

export function storeLanguage(code) {
  try {
    if (code) localStorage.setItem(STORAGE_KEY, code)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* a remembered preference is not worth failing over */
  }
}
