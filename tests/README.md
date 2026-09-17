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
| `attention.test.mjs` | 64 | what is going wrong, ranked — and why wrong outranks large |
| `assettypes.test.mjs` | 75 | which fields an asset type has, how it is grouped and what it looks like |
| `auth.test.mjs` | 21 | the API's shared bearer-token check |
| `brokers.test.mjs` | 42 | broker holdings exports, column aliasing |
| `certainty.test.mjs` | 34 | how a figure was arrived at, and why a total is only as certain as its least certain part |
| `corp.test.mjs` | 149 | entities, control, ledgers, audit events, and what needs a second pair of eyes |
| `daysheet.test.mjs` | 51 | a day on a site entered once, and what saving it twice must not do |
| `deadwiring.test.mjs` | 47 | exports nothing calls and columns nothing writes, as a ratchet rather than a wall |
| `dedupe.test.mjs` | 25 | not importing the same row twice |
| `commitments.test.mjs` | 50 | what has been agreed and not yet spent, against what is owed now — and why an instalment falls due on its own building |
| `costcentres.test.mjs` | 55 | what each part of the company spent against what it was given, and why the parts must not exceed the whole |
| `defaults.test.mjs` | 30 | filling a form in from history, and when not to |
| `filled.test.mjs` | 22 | which values on a form the app put there |
| `gst2b.test.mjs` | 52 | the input credit a vendor never filed for, and two ways of reading a name that made it invisible |
| `i18n.test.mjs` | 81 | dictionaries, plurals, coverage |
| `idempotent.test.mjs` | 31 | a second tap on a slow connection, and the line between that and two real gangs |
| `intake.test.mjs` | 62 | somebody else's spreadsheet into the books, and why a loose column match has to be shown before it is acted on |
| `invoice.test.mjs` | 81 | template language, GST, totals, what a template may not do |
| `labour.test.mjs` | 115 | the muster roll, cumulative running-account bills, and what is actually built |
| `langs.test.mjs` | 139 | the thirteen languages, RTL, detection |
| `money.test.mjs` | 44 | what counts as an amount, and what a row is cleaned to on its way in |
| `lineage.test.mjs` | 48 | what a contractor certified against what the engineer measured, and why an unlinked contract is not a gap |
| `materials.test.mjs` | 187 | construction trades, in/out/wasted/rejected, landed cost, prices, quotations |
| `metalbill.test.mjs` | 43 | reading a jeweller's bill into a metal holding |
| `metals.test.mjs` | 92 | units, purity, quoting, session close |
| `office.test.mjs` | 18 | Word / Excel drafts becoming invoice formats |
| `onboarding.test.mjs` | 62 | empty install, sample data, and the different list a builder is given |
| `ops.test.mjs` | 215 | inventory, payables, advances, payroll, and each over a period |
| `papers.test.mjs` | 89 | a salary slip, a quotation and an allotment letter read as documents, including as a PDF reader actually hands them over |
| `payrollruns.test.mjs` | 56 | a month that was run against a month worked out again, and what a raise in June must not do to March |
| `retention.test.mjs` | 89 | when money held back comes back, which tranche a release pays first, and why a client contract can never be a cost |
| `periods.test.mjs` | 60 | a month that has been closed, and the store rather than the button refusing to write into it |
| `ptax.test.mjs` | 150 | professional tax in every state that levies it, the constitutional cap, and the four things a zero can mean |
| `place.test.mjs` | 29 | what a cost is booked to when the company owns nothing, and what may be left blank |
| `plant.test.mjs` | 72 | what a machine costs per hour it works, not per hour it is hired |
| `projects.test.mjs` | 71 | a site against its contract and its estimate, which are not the same number, and the stores counted in |
| `rates.test.mjs` | 70 | what a material normally costs here against what it cost that time, and why a rising market is not a spike |
| `rollups.test.mjs` | 108 | the parts adding to the whole across every hierarchy at once, and the leftovers staying visible |
| `sales.test.mjs` | 69 | flats and shops, and instalments that fall due when the building says so |
| `samplesite.test.mjs` | 88 | the construction demo, read back through the screens' own reports: stock that balances, bills that run forward, a job over its costing and still paying |
| `sanitise.test.mjs` | 40 | what a template may not do, tried rather than assumed |
| `searchhistory.test.mjs` | 29 | remembering searches for a week, and forgetting them |
| `statutory.test.mjs` | 69 | whether a company runs PF or ESI at all, when the Acts require it, and why nobody having said is not the same as no |
| `sitedocs.test.mjs` | 67 | the papers that get signed, and rupees in words |
| `searchmatch.test.mjs` | 24 | matching a query the way people type it |
| `sync.test.mjs` | 68 | which version survives when two devices disagree, and who is told |
| `syncwire.test.mjs` | 41 | what a pull asks for, what a push sends, and one table failing |
| `wirecheck.test.mjs` | 119 | every column the client sends against the columns the schema has, including the ones only an update writes, and whether the type will accept what is sent — the failures that would otherwise wait for a live Supabase |
| `stockcount.test.mjs` | 64 | what is actually on the shelf, a book figure frozen into the row, and why short and over are never netted |
| `store.test.mjs` | 116 | corporate storage layer, the trail every ledger leaves, and a backup that carries it |
| `tds.test.mjs` | 97 | what the law requires deducting against what the orders said to, counted per contractor across a year |
| `tokens.test.mjs` | 8 | the theme's invariants: no half-declared colour, no raw palette |
| | **3,763** | |

## Browser — `tests/browser/`

Playwright against the **production build**, never the dev server.

```sh
VITE_OPEN_ACCESS=true npx vite build
npx vite preview --port 4188 &
node tests/browser/rtlui.mjs
```

| Suite | Assertions | Covers |
|---|---|---|
| `assetformui.mjs` | 60 | the asset form: picking a type, and asking for one thing at a time |
| `attentionui.mjs` | 19 | the findings on the page people open, and the links that reach them |
| `auditui.mjs` | 17 | every page in both themes, on a phone, and under 2,400 entries |
| `approvalsui.mjs` | 35 | the switch that used to change nothing, and one queue for four documents |
| `appearanceui.mjs` | 53 | accent, base tone and avatar; every combination still readable |
| `attachui.mjs` | 20 | what the pickers take; attachments in IndexedDB; viewing and backup |
| `booksui.mjs` | 27 | one login, two sets of books, and nothing leaking between them |
| `bulkui.mjs` | 17 | settling several at once, and re-importing a file |
| `chartui.mjs` | 11 | whether a chart says what it means or only shows it in colour |
| `closeui.mjs` | 24 | closing a month, the two write paths that refuse it, and reopening taking the months after it |
| `columnsui.mjs` | 36 | every key the running app writes to a personal row, against the columns that exist |
| `countui.mjs` | 34 | walking into the store with a clipboard: a blank that is not a zero, and a square count that is still a count |
| `contrastui.mjs` | 20 | whether the interface can be read, hit, and stilled |
| `clickui.mjs` | 18 | pressing every button on every page, each tab included, and watching |
| `corpui.mjs` | 85 | the way in, companies nav, the books switch in both places, consolidated view |
| `dayui.mjs` | 31 | the day sheet on a phone: thumb-sized controls, a pinned save, and a day that cannot be entered twice |
| `defaultsui.mjs` | 18 | the form folding what most entries never touch |
| `deptui.mjs` | 24 | a cost centre on the entry form, and a budget the report finally checks |
| `docsui.mjs` | 22 | six documents, offered where the thing lives, producing real files |
| `draftui.mjs` | 18 | a half-typed entry surviving the screen being left |
| `exportsui.mjs` | 31 | data in, data out and the summary, as three pages sharing one filter |
| `flows.mjs` | 35 | create, edit, delete, filter, restore, export, keyboard |
| `gst2bui.mjs` | 16 | the credit a vendor never filed for, and a 2B that was never loaded |
| `importui.mjs` | 45 | the mapping shown before anything is written, the rows it will skip, and the file it declines to read |
| `invoiceui.mjs` | 36 | default and imported templates, Word drafts, GST, PDF |
| `loginui.mjs` | 24 | the sign-in screen, its three providers, and what it says when one refuses |
| `labourui.mjs` | 67 | the muster roll, RA bills stated to date, retention, and built against spent |
| `langui.mjs` | 64 | the picker, what it changes, how honest coverage is, and the entry forms |
| `materialsui.mjs` | 89 | the trades on screen, rejection kept out of the job's cost, prices and quotes |
| `loadui.mjs` | 21 | a year of a builder: every page still arrives, and nothing has gone quadratic |
| `metalbillui.mjs` | 15 | filling a holding from a purchase bill |
| `metalsui.mjs` | 27 | metal holdings on screen |
| `navui.mjs` | 22 | the side bar: grouping, what is waiting, a short screen, and its own padding |
| `namecheck.mjs` | 6 | asset names resolve on every row |
| `onboardui.mjs` | 60 | the empty install, a company's — which starts with a site — and both sample portfolios in and out |
| `payrunui.mjs` | 30 | recording a month, locking it, and the wage bill that must not move afterwards |
| `placeui.mjs` | 36 | a builder's costs, which belong to things the builder does not own |
| `plantui.mjs` | 40 | the yard, log sheets, idle against broken, and days billed with nothing written down |
| `pressureui.mjs` | 93 | arriving with nothing, then leaning on everything |
| `projectsui.mjs` | 53 | sites against contract and estimate, where the money went, what the client owes |
| `owedui.mjs` | 22 | what is owed in both directions, and how old it is |
| `opsui.mjs` | 98 | sites, materials, advances, payroll — in the report, in a backup, and on their own page |
| `promisedui.mjs` | 26 | what is agreed and not yet spent, kept apart from what is owed now |
| `lineageui.mjs` | 20 | the measurement book against the running account, and the contracts it cannot speak for |
| `ratesui.mjs` | 18 | the lorry that jumped, beside the material that merely got dearer |
| `reportui.mjs` | 37 | the problem-report flow |
| `retentionui.mjs` | 29 | money held back, when it comes back, and which side of the contract is holding it |
| `searchui.mjs` | 19 | the palette: what it finds and what it remembers |
| `salesui.mjs` | 40 | flats and shops, the demand moving with the building, cancellations |
| `rtlui.mjs` | 55 | Arabic and Urdu mirror correctly |
| `statutoryui.mjs` | 67 | two schemes nobody asked about, deducted from every payslip, now asked |
| `syncui.mjs` | 16 | no false tick with no server, versions on writes, tombstoned deletes, repeats |
| `sweepui.mjs` | 6 | the startup sweeps, and what they must not delete |
| `transparencyui.mjs` | 11 | the app admitting on screen when a value is its guess |
| | **1,863** | |

That total is what one sweep of the demo build reports, plus `loginui.mjs`'s 24:
that suite needs the other build and does not run in the same pass, so a sweep
of this one reports 1,839.

`schema.mjs` is shared rather than per-suite: it reads the two shipped `.sql`
files and works out what columns each table has. `wirecheck.test.mjs` compares
that against what the makers produce; `columnsui.mjs` compares it against the
rows the running app actually leaves in storage. Two copies of that parser
would eventually disagree about what a column is.

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

The database is **emptied first**. It used not to be, and a suite that runs on
top of the last run cannot see a migration go missing: delete the line that
makes a column nullable and the column stays nullable from yesterday, with
every assertion still green. Point `OFFSET_TEST_PG` at a scratch database and
nothing else.

| Suite | Assertions | Covers |
|---|---|---|
| `corporate.sql` | 200 | schema applies and re-applies; who may see and change what; the two invariants; founding; an asset carrying its books; sites, materials and quotations, including the movement kinds an earlier schema could not express; the muster roll, work orders and cumulative running-account bills, the schedule of work and its measurements; plant and its log sheets, with idle and breakdown kept apart; a yard and a store on every site; a server-kept version on every synced table; flats and shops with construction-linked payment plans; that a personal install is untouched; that a company may book a cost to no asset, which the books it grew out of require; and that every column the client sends is really there, asked of the database rather than of a regular expression; and that one month cannot be run twice; which way an order's money goes, when its retention is released, the tape measure a certified figure came from, who is being deducted from, and a stores ledger somebody has actually checked against a shelf |

The runner stands up `auth.uid()`, `auth.users` and the storage schema, because
Supabase provides them and a bare PostgreSQL does not — the shipped `.sql`
files stay exactly what you paste into the Supabase SQL editor. Checks run as
an unprivileged role: superusers and table owners bypass RLS, so a test running
as `postgres` proves nothing.
