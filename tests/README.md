# Tests

No framework and no runner in `package.json`. Each file is a script that
asserts, prints a `PASS` / `**FAIL**` line per assertion, and ends with a count.
A suite exits non-zero if anything failed, so it works in CI as-is.

## Logic — `tests/logic/`

Pure functions from `src/lib/`. No build, no browser.

```sh
npx vite-node tests/logic/metals.test.mjs
```

`vite-node` rather than plain `node` because the modules under test are written
for Vite's resolver.

| Suite | Assertions | Covers |
|---|---|---|
| `apiguard.test.mjs` | 25 | what the endpoints refuse, and the rate ceiling |
| `appearance.test.mjs` | 110 | accents, tones, avatars, and the two places that must agree |
| `assettypes.test.mjs` | 56 | which fields an asset type actually has |
| `auth.test.mjs` | 21 | the API's shared bearer-token check |
| `brokers.test.mjs` | 42 | broker holdings exports, column aliasing |
| `corp.test.mjs` | 106 | entities, control, ledgers, audit events |
| `defaults.test.mjs` | 30 | filling a form in from history, and when not to |
| `filled.test.mjs` | 22 | which values on a form the app put there |
| `i18n.test.mjs` | 81 | dictionaries, plurals, coverage |
| `invoice.test.mjs` | 81 | template language, GST, totals, what a template may not do |
| `langs.test.mjs` | 139 | the thirteen languages, RTL, detection |
| `metalbill.test.mjs` | 43 | reading a jeweller's bill into a metal holding |
| `metals.test.mjs` | 92 | units, purity, quoting, session close |
| `office.test.mjs` | 18 | Word / Excel drafts becoming invoice formats |
| `onboarding.test.mjs` | 44 | empty install, sample data |
| `ops.test.mjs` | 151 | inventory, payables, advances, payroll |
| `sanitise.test.mjs` | 40 | what a template may not do, tried rather than assumed |
| `searchhistory.test.mjs` | 29 | remembering searches for a week, and forgetting them |
| `searchmatch.test.mjs` | 24 | matching a query the way people type it |
| `store.test.mjs` | 65 | corporate storage layer |
| `tokens.test.mjs` | 8 | the theme's invariants: no half-declared colour, no raw palette |
| | **1,227** | |

## Browser — `tests/browser/`

Playwright against the **production build**, never the dev server.

```sh
VITE_OPEN_ACCESS=true npx vite build
npx vite preview --port 4188 &
node tests/browser/rtlui.mjs
```

| Suite | Assertions | Covers |
|---|---|---|
| `assetformui.mjs` | 37 | the asset form showing only the fields its type has |
| `auditui.mjs` | 17 | every page in both themes, on a phone, and under 2,400 entries |
| `appearanceui.mjs` | 53 | accent, base tone and avatar; every combination still readable |
| `attachui.mjs` | 20 | what the pickers take; attachments in IndexedDB; viewing and backup |
| `chartui.mjs` | 11 | whether a chart says what it means or only shows it in colour |
| `contrastui.mjs` | 20 | whether the interface can be read, hit, and stilled |
| `corpui.mjs` | 41 | companies nav, switcher, consolidated view |
| `defaultsui.mjs` | 18 | the form folding what most entries never touch |
| `draftui.mjs` | 18 | a half-typed entry surviving the screen being left |
| `exportsui.mjs` | 30 | data in, data out and the summary, as three pages sharing one filter |
| `flows.mjs` | 35 | create, edit, delete, filter, restore, export, keyboard |
| `invoiceui.mjs` | 36 | default and imported templates, Word drafts, GST, PDF |
| `loginui.mjs` | 12 | the sign-in screen, and what it says when a provider refuses |
| `langui.mjs` | 64 | the picker, what it changes, how honest coverage is, and the entry forms |
| `metalbillui.mjs` | 15 | filling a holding from a purchase bill |
| `metalsui.mjs` | 27 | metal holdings on screen |
| `navui.mjs` | 17 | the side bar: grouping, what is waiting, and a short screen |
| `namecheck.mjs` | 6 | asset names resolve on every row |
| `onboardui.mjs` | 22 | the empty install |
| `reportui.mjs` | 33 | the problem-report flow |
| `searchui.mjs` | 19 | the palette: what it finds and what it remembers |
| `rtlui.mjs` | 54 | Arabic and Urdu mirror correctly |
| `sweepui.mjs` | 6 | the startup sweeps, and what they must not delete |
| `transparencyui.mjs` | 11 | the app admitting on screen when a value is its guess |
| | **622** | |

Playwright is not a dependency of the app; `_playwright.mjs` resolves it from
the environment. Override either default if your machine differs:

- `PLAYWRIGHT_MODULE` — path to Playwright's `index.mjs`
  (default `/opt/node22/lib/node_modules/playwright/index.mjs`)
- `OFFSET_TEST_URL` — where the preview server is listening
  (default `http://localhost:4188`)

`loginui.mjs` is the one suite that needs a **different build**: there is no
sign-in screen under `VITE_OPEN_ACCESS=true`, because the demo backend reports
a signed-in user and `/login` redirects away. Give it Supabase keys — they can
point at nothing, since every call to them is intercepted:

```sh
VITE_SUPABASE_URL=https://example.supabase.co VITE_SUPABASE_ANON_KEY=anything npx vite build
```

Run against the ordinary build it prints that and exits 0 rather than failing.

**Do not remove `serviceWorkers: 'block'`** from any browser context. The PWA
worker serves stale chunks and will make a fixed bug look unfixed. This cost
hours twice.

## Schema — `tests/sql/`

Row-level security is evaluated by PostgreSQL or not at all, so these run
against a real one. Reading the policies is no substitute: two in
`corporate.sql` looked correct and were not, and one of them let a stranger
walk into somebody else's company as its owner.

```sh
createdb offset_test
OFFSET_TEST_PG='postgresql:///offset_test' node tests/sql/run.mjs
```

Without `OFFSET_TEST_PG` it prints how to run it and exits 0 — most machines
have no PostgreSQL, and a suite that fails for want of a server is one people
learn to ignore.

| Suite | Assertions | Covers |
|---|---|---|
| `corporate.sql` | 50 | schema applies and re-applies; who may see and change what; the two invariants; founding; that a personal install is untouched |

The runner stands up `auth.uid()`, `auth.users` and the storage schema, because
Supabase provides them and a bare PostgreSQL does not — the shipped `.sql`
files stay exactly what you paste into the Supabase SQL editor. Checks run as
an unprivileged role: superusers and table owners bypass RLS, so a test running
as `postgres` proves nothing.
