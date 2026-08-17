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
// The ten most spoken languages in the world by total speakers (Ethnologue's
// L1+L2 count), then the Indian languages Offset started with. Ordered that way
// deliberately: a picker sorted alphabetically buries Mandarin under Gujarati.
export const LANGUAGES = [
  { code: 'en', name: 'English', english: 'English', dir: 'ltr' },
  { code: 'zh', name: '简体中文', english: 'Chinese (Simplified)', dir: 'ltr' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi', dir: 'ltr' },
  { code: 'es', name: 'Español', english: 'Spanish', dir: 'ltr' },
  { code: 'fr', name: 'Français', english: 'French', dir: 'ltr' },
  { code: 'ar', name: 'العربية', english: 'Arabic', dir: 'rtl' },
  { code: 'bn', name: 'বাংলা', english: 'Bengali', dir: 'ltr' },
  { code: 'pt', name: 'Português', english: 'Portuguese', dir: 'ltr' },
  { code: 'ru', name: 'Русский', english: 'Russian', dir: 'ltr' },
  { code: 'ur', name: 'اردو', english: 'Urdu', dir: 'rtl' },
  { code: 'mr', name: 'मराठी', english: 'Marathi', dir: 'ltr' },
  { code: 'gu', name: 'ગુજરાતી', english: 'Gujarati', dir: 'ltr' },
  { code: 'ta', name: 'தமிழ்', english: 'Tamil', dir: 'ltr' },
]

export const isRTL = (code) => languageFor(code).dir === 'rtl'

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
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

export function coverage(dict = {}, base = {}) {
  // Count a pluralised string once, by its stem, rather than once per form.
  //
  // English needs two forms; Chinese needs one, Russian four, Arabic six. If
  // each English form had to be matched individually, Chinese would be scored
  // as incomplete for having a grammar with no plural — which is not a gap in
  // the translation, and telling the user "97% translated" because of it would
  // be a lie.
  const stems = [...new Set(Object.keys(base).map((k) => k.replace(PLURAL_SUFFIX, '')))]
  if (!stems.length) return { done: 0, total: 0, percent: 100, missing: [] }
  const dictKeys = Object.keys(dict)
  const missing = stems.filter((stem) => {
    if (dict[stem] != null) return false
    return !dictKeys.some((d) => d === stem || (d.startsWith(`${stem}_`) && PLURAL_SUFFIX.test(d)))
  })
  const done = stems.length - missing.length
  return { done, total: stems.length, percent: Math.round((done / stems.length) * 100), missing }
}

// ── Loading ────────────────────────────────────────────────────────
// English ships in the main bundle because it is the fallback for everything
// else; the rest arrive only when chosen.
export async function loadDictionary(code) {
  if (!isSupported(code) || code === DEFAULT_LANG) return {}
  switch (code) {
    case 'zh': return (await import('../locales/zh.js')).default
    case 'hi': return (await import('../locales/hi.js')).default
    case 'es': return (await import('../locales/es.js')).default
    case 'fr': return (await import('../locales/fr.js')).default
    case 'ar': return (await import('../locales/ar.js')).default
    case 'bn': return (await import('../locales/bn.js')).default
    case 'pt': return (await import('../locales/pt.js')).default
    case 'ru': return (await import('../locales/ru.js')).default
    case 'ur': return (await import('../locales/ur.js')).default
    case 'mr': return (await import('../locales/mr.js')).default
    case 'gu': return (await import('../locales/gu.js')).default
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
