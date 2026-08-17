// The translation layer: fallback, interpolation, plurals, detection, coverage,
// and that every shipped dictionary is actually usable.
import {
  LANGUAGES, DEFAULT_LANG, normaliseLang, detectLanguage, isSupported, languageFor,
  interpolate, translate, coverage, storedLanguage, storeLanguage,
} from '../../src/lib/i18n.js'
import en from '../../src/locales/en.js'
import hi from '../../src/locales/hi.js'
import mr from '../../src/locales/mr.js'
import gu from '../../src/locales/gu.js'
import bn from '../../src/locales/bn.js'
import ta from '../../src/locales/ta.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${e ? '  — ' + e : ''}`) }
const eq = (n, a, b) => ok(n, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const DICTS = { hi, mr, gu, bn, ta }

console.log('\n── LANGUAGE CODES ──')
eq('a plain code is kept', normaliseLang('hi'), 'hi')
eq('a regional code reduces to the language', normaliseLang('hi-IN'), 'hi')
eq('an underscore variant works too', normaliseLang('bn_BD'), 'bn')
eq('case does not matter', normaliseLang('TA'), 'ta')
eq('whitespace is trimmed', normaliseLang('  gu  '), 'gu')
eq('an unsupported language is rejected', normaliseLang('is'), '')
eq('junk is rejected', normaliseLang('not-a-language'), '')
eq('empty is rejected', normaliseLang(''), '')
eq('null is rejected', normaliseLang(null), '')
ok('every listed language is supported', LANGUAGES.every((l) => isSupported(l.code)))
eq('an unknown code falls back to English metadata', languageFor('zz').code, 'en')

console.log('\n── DETECTION ──')
eq('the browser’s first supported language wins', detectLanguage(['is-IS', 'ta-IN', 'hi']), 'ta')
eq('unsupported preferences are skipped', detectLanguage(['de', 'ja', 'mr-IN']), 'mr')
eq('no supported preference means English', detectLanguage(['de', 'ja']), 'en')
eq('an empty list means English', detectLanguage([]), 'en')
eq('a missing list means English', detectLanguage(), 'en')

console.log('\n── INTERPOLATION ──')
eq('a placeholder is filled', interpolate('Hello {name}', { name: 'Rao' }), 'Hello Rao')
eq('several placeholders are filled', interpolate('{a} and {b}', { a: '1', b: '2' }), '1 and 2')
eq('a repeated placeholder is filled each time', interpolate('{n}/{n}', { n: '7' }), '7/7')
eq('an unknown placeholder is left alone rather than blanked',
  interpolate('Hello {nobody}', { name: 'Rao' }), 'Hello {nobody}')
eq('no vars means no change', interpolate('Plain text'), 'Plain text')
eq('a zero value still substitutes', interpolate('{count} left', { count: 0 }), '0 left')

console.log('\n── FALLBACK ──')
const partial = { 'nav.assets': 'संपत्तियाँ' }
eq('a translated key comes back translated',
  translate({ dict: partial, base: en, lang: 'hi' }, 'nav.assets'), 'संपत्तियाँ')
eq('an untranslated key falls back to English',
  translate({ dict: partial, base: en, lang: 'hi' }, 'nav.income'), 'Income')
eq('a key in neither degrades to something readable',
  translate({ dict: partial, base: en, lang: 'hi' }, 'nav.nonsense'), 'nonsense')
ok('a missing key never renders "undefined"',
  !String(translate({ dict: {}, base: {}, lang: 'en' }, 'a.b.c')).includes('undefined'))
eq('an empty dictionary is just English',
  translate({ dict: {}, base: en, lang: 'hi' }, 'nav.settings'), 'Settings')

console.log('\n── PLURALS ──')
const p = (count, lang = 'en', dict = {}) => translate({ dict, base: en, lang }, 'common.entries', { count })
eq('one entry', p(1), '1 entry')
eq('two entries', p(2), '2 entries')
eq('zero entries', p(0), '0 entries')
eq('a large count', p(15000), '15000 entries')
eq('the plural falls back to English when untranslated', p(3, 'hi'), '3 entries')
eq('a translated plural is used', p(1, 'hi', hi), '1 प्रविष्टि')
eq('and its other form', p(5, 'hi', hi), '5 प्रविष्टियाँ')
// Only _other supplied: every count must still resolve rather than falling through.
eq('a dictionary with only the other form still works',
  translate({ dict: { 'common.entries_other': '{count} x' }, base: en, lang: 'en' }, 'common.entries', { count: 1 }),
  '1 x')
eq('without a count, the key is looked up as written',
  translate({ dict: {}, base: { plain: 'flat' }, lang: 'en' }, 'plain'), 'flat')

console.log('\n── COVERAGE ──')
const full = coverage(en, en)
eq('English covers itself completely', full.percent, 100)
eq('and reports nothing missing', full.missing.length, 0)
const half = coverage({ 'nav.assets': 'x' }, { 'nav.assets': 'a', 'nav.income': 'b' })
eq('a half-done dictionary reports 50%', half.percent, 50)
eq('and names what is missing', half.missing, ['nav.income'])
eq('an empty dictionary reports zero', coverage({}, en).percent, 0)
eq('an empty base cannot divide by zero', coverage({}, {}).percent, 100)
// A pluralised key is covered by any of its forms, not by a key of that exact name.
eq('a plural key counts as covered when its forms are present',
  coverage({ 'common.entries_one': 'a', 'common.entries_other': 'b' }, { 'common.entries': 'x' }).percent, 100)

console.log('\n── THE SHIPPED DICTIONARIES ──')
const baseKeys = Object.keys(en)
ok('English has a decent number of strings', baseKeys.length >= 50, `${baseKeys.length} keys`)
for (const [code, dict] of Object.entries(DICTS)) {
  const c = coverage(dict, en)
  ok(`${code}: covers every English key`, c.percent === 100, `${c.percent}% — missing ${c.missing.slice(0, 4).join(', ')}`)
  ok(`${code}: no empty strings`, Object.values(dict).every((v) => String(v).trim().length > 0))
  ok(`${code}: nothing left in English by mistake`,
    // A handful legitimately match (product name, "Supabase"); flag only if most do.
    Object.keys(dict).filter((k) => dict[k] === en[k]).length <= 2,
    Object.keys(dict).filter((k) => dict[k] === en[k]).join(', '))
  // Every placeholder in the English string must survive translation, or the
  // number simply won't appear on screen.
  for (const key of Object.keys(dict)) {
    const source = en[key] ?? en[key.replace(/_(one|other|zero|two|few|many)$/, '')]
    if (!source) continue
    const wanted = (source.match(/\{(\w+)\}/g) || []).sort()
    const got = (String(dict[key]).match(/\{(\w+)\}/g) || []).sort()
    if (wanted.length && JSON.stringify(wanted) !== JSON.stringify(got)) {
      ok(`${code}: ${key} keeps its placeholders`, false, `wanted ${wanted}, got ${got}`)
    }
  }
  ok(`${code}: placeholders survive translation`, true)
  ok(`${code}: is not accidentally a copy of another language`,
    Object.entries(DICTS).filter(([other, d]) => other !== code && d['nav.assets'] === dict['nav.assets']).length === 0,
    dict['nav.assets'])
}

console.log('\n── REMEMBERING THE CHOICE ──')
store.clear()
eq('nothing stored to begin with', storedLanguage(), '')
storeLanguage('ta')
eq('a choice is remembered', storedLanguage(), 'ta')
storeLanguage('')
eq('clearing it goes back to following the browser', storedLanguage(), '')
store.set('pl_lang', 'klingon')
eq('a stored language that no longer exists is ignored', storedLanguage(), '')
store.set('pl_lang', 'hi-IN')
eq('a stored regional code still resolves', storedLanguage(), 'hi')

console.log('\n── LANGUAGE LIST ──')
ok('every language has an endonym', LANGUAGES.every((l) => l.name && l.name.trim()))
ok('every language has an English name', LANGUAGES.every((l) => l.english && l.english.trim()))
ok('every language declares a direction', LANGUAGES.every((l) => l.dir === 'ltr' || l.dir === 'rtl'))
ok('codes are unique', new Set(LANGUAGES.map((l) => l.code)).size === LANGUAGES.length)
ok('endonyms are unique', new Set(LANGUAGES.map((l) => l.name)).size === LANGUAGES.length)
eq('English is first, since it is the fallback', LANGUAGES[0].code, DEFAULT_LANG)
ok('every non-English language is in its own script',
  LANGUAGES.slice(1).every((l) => !/^[\x20-\x7F]+$/.test(l.name)), LANGUAGES.map((l) => l.name).join(' '))

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
