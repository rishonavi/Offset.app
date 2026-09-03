// The ten most spoken languages, plus the Indian ones Offset started with:
// complete, correctly plural, and pointing the right way.
import { LANGUAGES, DEFAULT_LANG, coverage, translate, loadDictionary, isSupported, normaliseLang, detectLanguage, isRTL, languageFor } from '../../src/lib/i18n.js'
import en from '../../src/locales/en.js'

let pass = 0, fail = 0
const ok = (n, c, e = '') => { c ? pass++ : fail++; console.log(`${c ? 'PASS' : '**FAIL**'}  ${n}${c ? '' : '  — ' + e}`) }
const eq = (n, a, b) => ok(n, a === b, `got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}`)

// Ethnologue's total-speaker (L1+L2) top ten.
const TOP_TEN = ['en', 'zh', 'hi', 'es', 'fr', 'ar', 'bn', 'pt', 'ru', 'ur']

console.log('\n── THE TOP TEN ARE ALL THERE ──')
for (const code of TOP_TEN) {
  const l = LANGUAGES.find((x) => x.code === code)
  ok(`${code} is offered${l ? ` — ${l.english} (${l.name})` : ''}`, Boolean(l))
}
eq('and they lead the picker, in speaker order', LANGUAGES.slice(0, 10).map((l) => l.code).join(','), TOP_TEN.join(','))
ok('the Indian languages Offset began with are kept',
  ['mr', 'gu', 'ta'].every((c) => isSupported(c)))
eq('thirteen languages in total', LANGUAGES.length, 13)

console.log('\n── EVERY ENTRY IS WELL FORMED ──')
const seen = new Set()
for (const l of LANGUAGES) {
  ok(`${l.code}: has an endonym, not just an English name`, Boolean(l.name) && Boolean(l.english),
    JSON.stringify(l))
  ok(`${l.code}: declares a direction`, l.dir === 'ltr' || l.dir === 'rtl', l.dir)
  ok(`${l.code}: is listed once`, !seen.has(l.code)); seen.add(l.code)
}
// The endonym is the point — someone who reads only Arabic cannot find "Arabic".
eq('Arabic is listed as العربية', languageFor('ar').name, 'العربية')
eq('Chinese as 简体中文', languageFor('zh').name, '简体中文')
eq('Russian as Русский', languageFor('ru').name, 'Русский')

console.log('\n── DIRECTION ──')
ok('Arabic is right-to-left', isRTL('ar'))
ok('Urdu is right-to-left', isRTL('ur'))
ok('English is not', !isRTL('en'))
ok('nor is Hindi', !isRTL('hi'))
eq('exactly two right-to-left languages', LANGUAGES.filter((l) => l.dir === 'rtl').length, 2)

console.log('\n── EVERY DICTIONARY IS COMPLETE ──')
const dicts = {}
for (const l of LANGUAGES) {
  if (l.code === DEFAULT_LANG) continue
  dicts[l.code] = await loadDictionary(l.code)
  const c = coverage(dicts[l.code], en)
  ok(`${l.english} is fully translated`, c.percent === 100, `${c.percent}% — missing ${c.missing.slice(0, 4).join(', ')}`)
}

// Chinese has one plural form, Arabic six. Neither is a gap in the translation.
eq('Chinese counts as complete despite having no plural', coverage(dicts.zh, en).percent, 100)
eq('Arabic counts as complete with six forms', coverage(dicts.ar, en).percent, 100)
eq('Russian counts as complete with four', coverage(dicts.ru, en).percent, 100)
// A genuinely missing string must still be reported.
const holed = { ...dicts.fr }; delete holed['nav.income']
ok('but a genuinely missing key is still counted',
  coverage(holed, en).missing.includes('nav.income'), JSON.stringify(coverage(holed, en).missing))
ok('and drops the percentage below 100', coverage(holed, en).percent < 100)
// Dropping every plural form of one stem is a real gap too.
const noPlural = { ...dicts.fr }
delete noPlural['common.entries_one']; delete noPlural['common.entries_other']
ok('losing every form of a counted string is a gap',
  coverage(noPlural, en).missing.includes('common.entries'), JSON.stringify(coverage(noPlural, en).missing))

console.log('\n── NOTHING IS LEFT IN ENGLISH BY ACCIDENT ──')
// A "translation" that is character-for-character the English is usually a
// forgotten key. Proper nouns and format strings are the honest exceptions.
// Words that legitimately survive translation unchanged. Scoped to the language
// that earns the exemption: "Date" is the correct French word, which says
// nothing about whether the Hindi is still sitting in English, and a bare key
// here would excuse both.
const ALLOWED_SAME = new Set([
  'language.coverage', 'chrome.sharedWorkspace',
  'es:nav.personal',   // "Personal" is the Spanish word as well
  'es:company.personal', // and the books tab uses the same word as the nav
  'fr:entry.date',     // as is "Date" in French
  'fr:entry.notes',    // and "Description / Notes"
  'fr:income.source',  // and "Source"
])
for (const [code, dict] of Object.entries(dicts)) {
  const untouched = Object.keys(en).filter(
    (k) =>
      dict[k] != null &&
      dict[k] === en[k] &&
      !ALLOWED_SAME.has(k) &&
      !ALLOWED_SAME.has(`${code}:${k}`) &&
      !/^\{/.test(en[k]),
  )
  ok(`${code}: no string is a verbatim copy of the English`, untouched.length === 0, untouched.join(', '))
}

console.log('\n── PLURALS, WHERE THEY ARE NOT TWO-WAY ──')
const say = (code, n) => translate({ dict: dicts[code], base: en, lang: code }, 'common.entries', { count: n })
// Arabic needs all six forms and they are different words.
const arForms = new Set([0, 1, 2, 3, 11, 100].map((n) => say('ar', n)))
ok('Arabic produces six distinct forms', arForms.size === 6, [...arForms].join(' | '))
ok('one entry in Arabic is not "1 قيد"', !/^1 /.test(say('ar', 1)), say('ar', 1))
ok('two entries uses the dual', say('ar', 2) === 'قيدان', say('ar', 2))
// Russian needs four.
const ruForms = new Set([1, 2, 5, 21].map((n) => say('ru', n)))
ok('Russian produces distinct forms for 1 / 2 / 5', ruForms.size >= 3, [...ruForms].join(' | '))
eq('1 запись', say('ru', 1), '1 запись')
eq('2 записи', say('ru', 2), '2 записи')
eq('5 записей', say('ru', 5), '5 записей')
eq('21 takes the singular form in Russian', say('ru', 21), '21 запись')
// Chinese has none.
eq('Chinese says the same for 1 and 5', say('zh', 1), say('zh', 5).replace('5', '1'))
// French counts zero as singular.
eq('French treats 0 as singular', say('fr', 0), '0 entrée')
eq('and 2 as plural', say('fr', 2), '2 entrées')
// English still behaves.
eq('English singular', say('en', 1), '1 entry')
eq('English plural', say('en', 2), '2 entries')
eq('Spanish singular', say('es', 1), '1 entrada')
eq('Urdu plural', say('ur', 2), '2 اندراجات')

console.log('\n── INTERPOLATION SURVIVES TRANSLATION ──')
for (const [code, dict] of Object.entries(dicts)) {
  const withVar = translate({ dict, base: en, lang: code }, 'language.changed', { name: 'X' })
  ok(`${code}: {name} is filled, not printed`, withVar.includes('X') && !withVar.includes('{name}'), withVar)
  const pct = translate({ dict, base: en, lang: code }, 'language.coverage', { percent: 42 })
  ok(`${code}: {percent} is filled`, pct.includes('42') && !pct.includes('{percent}'), pct)
}

console.log('\n── DETECTION ──')
eq('a browser set to Spanish gets Spanish', detectLanguage(['es-MX', 'en']), 'es')
eq('zh-Hans-CN resolves to Chinese', detectLanguage(['zh-Hans-CN']), 'zh')
eq('ar-EG resolves to Arabic', detectLanguage(['ar-EG']), 'ar')
eq('pt-BR resolves to Portuguese', detectLanguage(['pt-BR']), 'pt')
eq('an unspoken language falls back to English', detectLanguage(['is-IS']), 'en')
eq('and the first one we do speak wins', detectLanguage(['is-IS', 'ru-RU', 'fr']), 'ru')
eq('case and whitespace do not matter', normaliseLang('  RU_ru '), 'ru')

console.log('\n── FALLBACK STILL WORKS ──')
const partial = { 'nav.assets': 'X' }
eq('a translated key is used', translate({ dict: partial, base: en, lang: 'fr' }, 'nav.assets'), 'X')
eq('an untranslated one falls back to English',
  translate({ dict: partial, base: en, lang: 'fr' }, 'nav.income'), 'Income')
eq('a key in neither shows its tail, not "undefined"',
  translate({ dict: partial, base: en, lang: 'fr' }, 'nope.missing'), 'missing')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
