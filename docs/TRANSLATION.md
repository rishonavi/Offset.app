# Language

Offset can speak English, हिन्दी, मराठी, ગુજરાતી, বাংলা and தமிழ். The choice
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

## Partial translation is normal

English is the source of truth. Anything a translation hasn't covered falls back
to English rather than showing a blank or a raw key, which is what makes it safe
to translate the app in pieces. Settings says so, with the percentage covered,
rather than letting you discover the gaps one screen at a time.

Currently translated: the sidebar and navigation, the app chrome (search,
menus, theme toggle, workspace switcher, sign-out), the banners, and the
Settings headings. The rest of the app is still English.

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

Then add the file to the `switch` in `loadDictionary()`. Only English is in the
main bundle; every other language is fetched when it's chosen, so adding one
costs nothing to users who don't pick it.

## Writing translations

- **Keep the `{placeholders}`.** `{count} entries` must keep `{count}` or the
  number won't appear. Move it wherever the grammar needs it.
- **Plurals** can be split into `key_one` / `key_other` (and `_zero`, `_two`,
  `_few`, `_many` where a language needs them). `Intl.PluralRules` picks the
  form, so this isn't limited to English's two-way split.
- **Don't translate** "Offset", "Supabase", or `.env`.

## Checking your work

`coverage(dict, en)` in `src/lib/i18n.js` reports what a dictionary is missing.
The test suite additionally checks every shipped language for full coverage,
empty strings, placeholders lost in translation, and strings accidentally left
in English.
