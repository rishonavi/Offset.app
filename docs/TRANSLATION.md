# Language

Offset can speak thirteen languages: English, 简体中文, हिन्दी, Español, Français,
العربية, বাংলা, Português, Русский, اردو, मराठी, ગુજરાતી and தமிழ். The choice
lives in **Settings → Language**, and with nothing chosen the app follows the
browser's own preference — so someone whose browser is set to Marathi gets
Marathi without having to find the setting.

The choice is remembered on the device. Picking "Match my browser" clears it
again, which is a different state from picking English once: it keeps tracking
the browser if that changes later.

## What changes, and what doesn't

Changing language changes **wording only**. Amounts stay in the currency and
number format configured by `VITE_CURRENCY` / `VITE_LOCALE`, and dates keep
their `dd MMM yyyy` shape. That is deliberate — a landlord filing Indian
accounts wants ₹ and Indian digit grouping whichever language the buttons are
in.

## What is translated today

The dictionary is 66 strings, and they are the app's chrome: the sidebar and
navigation, the top bar, the banners, the shared button labels, and the
Settings language card itself. **The entry forms, the tables, the dashboard,
reports and invoices are still English**, because their wording was written
straight into the components and never moved into a dictionary.

This matters for how the coverage figure reads. `coverage()` compares one
dictionary against the English one, so it measures *the dictionary*, not the
app — a language with all 66 strings scores 100% while most of what someone
actually looks at is still English. The Settings card therefore always tells a
non-English speaker that untranslated parts stay in English, rather than only
when the dictionary has holes; a 100% that appears next to an English expense
form is worse than no number at all.

Moving a screen into the dictionary is the work that raises real coverage.
Start with the entry forms — they are the most-used screens in the app.

## Partial translation is normal

English is the source of truth. Anything a translation hasn't covered falls back
to English rather than showing a blank or a raw key, which is what makes it safe
to translate the app in pieces. Settings says so, rather than letting you
discover the gaps one screen at a time.

## Adding a language

Two steps.

1. Copy `src/locales/en.js` to `src/locales/<code>.js` and translate the values.
   Leave the keys alone. Anything you don't translate falls back to English, so
   a partial file is a perfectly good starting point.

2. Add a line to `LANGUAGES` in `src/lib/i18n.js`:

   ```js
   { code: 'pa', name: 'ਪੰਜਾਬੀ', english: 'Punjabi', dir: 'ltr' },
   ```

   `name` is the endonym — a picker that says "Punjabi" is no use to someone who
   can only read ਪੰਜਾਬੀ. Set `dir: 'rtl'` for a right-to-left language; the
   document direction follows it.

   The list is ordered by number of speakers rather than alphabetically, which
   is why the ten most spoken languages in the world come first. Alphabetical
   order buries Mandarin under Gujarati.

### Right-to-left

Arabic and Urdu read right to left, and the layout follows `dir` on the
document. Components use **logical** properties — `ps-`/`pe-`, `ms-`/`me-`,
`start-`/`end-`, `border-s`/`border-e`, `text-start`/`text-end` — rather than
`pl-`, `left-` and `text-left`. They render identically in a left-to-right
language and correctly in a right-to-left one, so there is no reason to reach
for the physical version. The one place that needs an explicit `[dir='rtl']`
rule is the select chevron, because `background-position` has no logical form.

Then add the file to the `switch` in `loadDictionary()`. Only English is in the
main bundle; every other language is fetched when it's chosen, so adding one
costs nothing to users who don't pick it.

## Writing translations

- **Keep the `{placeholders}`.** `{count} entries` must keep `{count}` or the
  number won't appear. Move it wherever the grammar needs it.
- **Plurals** can be split into `key_one` / `key_other` (and `_zero`, `_two`,
  `_few`, `_many` where a language needs them). `Intl.PluralRules` picks the
  form, so this isn't limited to English's two-way split.

  Write the forms your language actually has, not the ones English has.
  Chinese needs only `_other`; Russian needs `_one`, `_few`, `_many`, `_other`
  (1 запись, 2 записи, 5 записей); Arabic uses all six, and they are different
  words rather than the same word after a different number. Coverage counts a
  counted string **once, by its stem** — a language is not incomplete for
  having fewer plural forms than English.
- **Don't translate** "Offset", "Supabase", or `.env`.

## Checking your work

`coverage(dict, en)` in `src/lib/i18n.js` reports what a dictionary is missing.
The test suite additionally checks every shipped language for full coverage,
empty strings, placeholders lost in translation, and strings accidentally left
in English.
