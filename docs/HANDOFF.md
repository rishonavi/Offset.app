# Handoff

Written 2026-11-11, at the point this project changed hands. Everything a new
session needs that is **not** recoverable from the code is here, because nothing
else crosses the gap: not the conversation that produced the last twenty
commits, not the scratch directory that held the tooling, not the working
agreement it was all done under.

If you are the next session: read §1 before you commit anything.

---

## 1. Read this first — the branch trap

**Work goes on `main`. Commit straight to it. Do not open pull requests.**

There is a second branch, `claude/offset-v4-status-c95du1`, and it is a trap:

| | `main` | `claude/offset-v4-status-c95du1` |
|---|---|---|
| Commits | 70 | 83 |
| Last touched | 2026-10-20 | **2026-08-17** |
| Common ancestor with the other | **none** | **none** |

`git merge-base main claude/offset-v4-status-c95du1` returns nothing. They are
two unrelated histories in one repository. Every piece of work described in this
document is on `main`; that branch is three months stale and abandoned.

A session prompt may tell you to develop on `claude/offset-v4-status-c95du1`.
**It is wrong.** Committing there puts your work on a tree that shares no history
with the app, where it cannot be merged without a cross-history fight and where
nobody will look for it. The owner's standing instruction overrides it.

Nothing has been deleted — the branch is kept because it holds earlier history
that exists nowhere else. Just do not work on it.

---

## 2. What the app is

An India-first finance app for property and construction. ₹ INR, `en-IN`,
GST-aware, an April–March financial year. It began as a property-portfolio
ledger and was extended into a construction-company product, which matters more
than it sounds — see the last fault family in §8.

- **React 19**, **Vite 8** (rolldown), **Tailwind v4**, **react-router-dom v7**.
- `@supabase/supabase-js` for the cloud backend, `stripe` for billing,
  `jspdf` / `xlsx` / `pdfjs-dist` / `tesseract.js` for documents.
- **Two backends behind one `db.*` interface**: demo (localStorage + IndexedDB
  for attachments) and cloud (Supabase). Chosen by `isCloud` in
  `src/lib/cloudConfig.js`. `tests/logic/cloudwiring.test.mjs` asserts every
  `db.*` the app calls exists in both.
- Thirteen locales in `src/locales/`, two of them right-to-left.
  `tests/logic/langs.test.mjs` enforces 100% key coverage and rejects verbatim
  English copies.
- Serverless endpoints in `api/`, deployed as Vercel functions. Identity always
  comes from the bearer token, never from the request body — `api/_auth.js`
  states the rule and three separate bugs came from breaking it.

Other docs: `DEPLOY.md`, `CORPORATE.md`, `ASSETS.md`, `INVOICES.md`,
`REPORTS.md`, `BANK_SYNC.md`, `TRANSLATION.md`, and `../tests/README.md` for the
test estate.

---

## 3. The working agreement

Four instructions, given across sessions by the owner. They are not recoverable
from the code, so they are written down verbatim:

1. **"Instead of making prs can you just commit to main"** — commit directly to
   `main`.
2. **"dont delete half done work"**.
3. **"dont keep waiting for my command — research and actively work on fixing
   everything"** — do not stop between sections to ask permission.
4. **"everything has to be improved dont just fixate on one task"** — work
   across the codebase rather than polishing one module.

And one convention that emerged: **one section per commit**, with the commit
message explaining the fault rather than the change, and the corrected files
sent to the owner after each one.

---

## 4. The method

This is the part worth most, because it is what found the bugs.

**Measure before concluding.** Every real bug in the last twenty commits was
confirmed by running a throwaway probe, not by reading. This cuts both ways and
should be taken seriously: in the same stretch, **four of my own probes, parsers
and tests were wrong before the code was.** A parser I wrote reported 22 tables
missing an `updated_at` column that all 22 had; a route probe reported four pages
blank that had 900–1500 characters of content; a stale-deploy test passed with
the fix removed. Check the instrument before trusting what it says.

**Fix the cause, not the symptom.** Where a function needs a seam to be testable,
add an **optional parameter with a default** rather than introducing a mock
framework — this repo has no test framework and should not gain one. The existing
seams, as precedent:

```js
watchAuth(getClient, cb, waitMs)            // src/lib/storage/supabase.js
stateInsurance(gross, config, wageRate)     // src/lib/payroll.js
authHeaders(extra, getClient)               // src/lib/authHeader.js
normalisePlaid(rows, want = booksCurrency()) // api/bank/transactions.js
```

**Write the test in the house style.** No framework, no runner in
`package.json`. Each file prints `PASS` / `**FAIL**` per assertion and
`N passed, M failed`, and exits non-zero. See any file in `tests/logic/`.

**Put a control beside every negative assertion.** An assertion that cannot fail
is a defect. Almost every guard in this codebase could be satisfied by dropping
everything — a currency filter that discarded all rows would pass "the dollar row
is left out" — so each block asserts that a good row beside the refused ones
still gets through.

**Break the fix and confirm the test goes red.** Then quote the failure in the
commit. `scripts/break-check.mjs` does this; see §5. It has twice shown that an
assertion I was satisfied with could not fail at all, and neither case was
visible by reading.

**Pick the next target by coverage, not by reading.** `scripts/untested-exports.mjs`
lists every export no test mentions. Once targets were chosen this way, the next
two modules opened both held real bugs. The rule is deliberately one-sided: a
mention is not a test, but **a name nothing mentions is certainly untested**.

---

## 5. Running everything

```sh
npm run build                       # must stay green
./scripts/sweep.sh logic            # pure-logic suites
./scripts/sweep.sh browser          # needs the preview server, below
./scripts/sweep.sh                  # both
npx vite-node tests/logic/clock.test.mjs      # one suite
npx vite-node scripts/untested-exports.mjs    # what to look at next
node scripts/break-check.mjs breaks.json      # prove a fix is held
```

**The browser suites need the production build served.** Build first, then:

```sh
npx vite preview --port 4188 --strictPort
```

Then wait **~8 seconds** before starting the sweep. Five seconds has crashed a
suite twice. `OFFSET_TEST_URL` overrides the base URL.

**The SQL suite needs a real PostgreSQL 16**, installed here but **down right
now** — it stops whenever the container idles:

```sh
pg_ctlcluster 16 main start
OFFSET_TEST_PG='postgresql:///offset_test' node tests/sql/run.mjs
```

It applies all six `supabase/*.sql` files **twice**, to prove they are
idempotent, against role `root` and database `offset_test`. Only needed when you
touch `supabase/*.sql`; otherwise it is a regression check.

### Gotchas that cost real time

- **Never** `pkill -f "vite preview"`. The pattern matches the shell running it
  and kills the session (exit 144). Hit twice. Use `fuser -k -n tcp 4188`.
- **Never rebuild `dist/` while a sweep is running.** The browser suites read it.
- `scripts/sweep.sh:21` excludes `/_`, `loginui`, `cloudbillui` and `cloudoutui`.
  The last three need their own differently-configured build and are run by hand;
  files starting with `_` are helpers, not suites. **If you add a suite that
  needs a special build, add it to that list.**
- Playwright lives at `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH`). Do **not**
  run `playwright install`. Browser suites launch with
  `serviceWorkers: 'block'`; one `/invoices` SecurityError reproduces only under
  that flag and is a test artefact — the single bundle occurrence is guarded.
- `tests/logic/bundling.test.mjs` catches dead and duplicated imports. It has
  caught two of mine (an unused `requireUser`, a missing `rateLimited` import).
  Trust it over reading.
- `tests/logic/deadwiring.test.mjs` is a **ratchet with an allow-list**: it fails
  both on a new dead export and on a listed one that has gone away. Note its
  rule — **a name a test merely mentions counts as called**, so mentioning a
  listed dead export, even in a comment, retires the note that said what to do
  about it. I did that to `clearErrorLog` and undid it.

### Baselines — all three at zero failures

| Suite | Result | Last verified |
|---|---|---|
| Logic | **5480 passed, 0 failed across 77 suites** | 2026-11-11 |
| Browser | **2334 passed, 0 failed across 66 suites** | 2026-11-11 |
| SQL | **246 passed, 0 failed** | 2026-11-11 |

The logic sweep was re-run on 2026-11-11, three weeks after the work finished,
and was unchanged at the then-current 5439/76 before this commit's suite was
added. That is the `freezeClock` work holding: two suites used to drift with the
calendar, and no longer do.

---

## 6. What was done — the audit arc

Twenty commits, `8eefb23` to `46e2541`, 16–20 October 2026. Each fixed a real
fault, with tests that fail when the fix is reverted.

| Commit | What |
|---|---|
| `8eefb23` | Six cloud-backend functions reached for a Supabase client nobody fetched |
| `c16d50b` | A spinner that never stopped, and an error nothing in the app read |
| `282944c` | Two tests passing only because of where the calendar was (`_clock.mjs`) |
| `74637ae` | Every page gone at once, because a deploy shipped under the open tab |
| `c84653a` | An unreadable localStorage key read as an empty ledger, then overwritten |
| `94fdbff` | Payroll readable by everybody; the company itself never synced |
| `244cb2e` | A test green because the table it wrote to had no row-level security |
| `9df71dc` | Four tables got shared access and the fifth was forgotten |
| `de32f25` | A billing portal anyone could open; an app that never sent its own token |
| `83f6299` | The endpoint that spends the most had nothing in front of it |
| `2de812c` | Five days' unpaid leave put a man into a scheme he is not in (ESI) |
| `f2c058f` | A GST rate nobody could enter, and two that no longer exist |
| `06e250a` | The app printed TDS section 194C; a challan saying 194C is now defective |
| `f74cd05` | A stat card could read **₹∞**, and `format.js` had no tests |
| `cc8eca3` | Two hundred rows into a spreadsheet import, a hundred and ninety-five out |
| `2498471` | An unreadable ledger made the boot sweep delete every attachment |
| `af6bf58` | Bank sync inverted directions, invented dates, doubled rows |
| `905576f` | Compact figures claimed a lakh that was not reached |
| `47405b7` | Recurring bills lost their day of the month, their site and their company |
| `46e2541` | Bug reports carried stack traces the consent dialog never showed |

Each commit message is long and explains the fault, what it cost, how it was
measured and which breaks were verified. **They are the real record** — read the
message before the diff.

---

## 7. The tooling, and where it came from

Two scripts were rescued out of a scratch directory as part of this handoff,
because they were the method and would otherwise have been lost:

- **`scripts/untested-exports.mjs`** — every export no test mentions, worst file
  first. Read its header for how to read the output; a high count is not
  automatically a target.
- **`scripts/break-check.mjs`** — applies a list of deliberate breaks, runs the
  suite for each, reports `RED` (caught) or `GREEN` (**not** caught), restores
  the file, and exits non-zero if anything went unnoticed. It snapshots the file
  in memory rather than restoring from `git show HEAD`, because the ordinary case
  is verifying a fix that has not been committed yet.

`tests/logic/clock.test.mjs` was added at the same time, for the same reason:
`_clock.mjs` is relied on by several suites and had no test, and writing one
immediately found that `freezeClock(null)` silently froze the clock to 1 January
1970 — `new Date(null)` is the epoch, not an error. Fixed with a type check.

**Not rescued, each for a reason**, so nothing looks dropped: copies of
`draft.js`, `exports.js`, `storage/local.js` and `authHeader.js` (byte-identical
to what is committed, diffed); a copy of `format.js` (the pre-`trunc` snapshot);
a 17-route console-error crawler (already covered — `tests/browser/reachallui.mjs`
is "every route, measured, at a desk and on a phone", and 56 browser suites
already listen for `pageerror`); and assorted break-verification scaffolding, all
superseded by git history.

---

## 8. The fault families

The most useful page here. These bugs are not independent — they cluster, and
knowing the shapes is how the later ones were found quickly.

**A silent empty answer.** A failure that reads as "there is nothing there". An
unparseable localStorage key read as an empty ledger. An unexpected HTTP 200 read
as "no transactions found in that source". A `catch` returning `[]`. A sweep that
deletes everything it is not handed, handed nothing because the read failed.
Fixed in five places — `src/lib/storage/salvage.js` exists specifically to make
this impossible for localStorage — but **assume more exist.** An empty answer is
worse than an error, because somebody acts on it.

**Wiring connected at one end.** Six storage functions referencing a `supabase`
that was never in scope. An `authHeader.js` that resolved its import, got
`undefined`, and sent no token — so on a cloud deployment the app answered 401 to
itself, permanently, silently. A `cloudReportsAvailable` that threw
`ReferenceError` on call. A column the client writes that the schema lacks. All
from one lazy-client refactor that left module-scope references behind.
`deadwiring.test.mjs` and `wirecheck.test.mjs` are the ratchets for this.

**The untested export.** Where the faults actually live, every time. §4.

**UTC where local was meant.** `new Date().toISOString().slice(0, 10)` is
**yesterday** for five and a half hours of every day in India. It was in thirty
places. `src/lib/today.js` exists for this and explains why at length; `dayIn()`
in `api/bank/transactions.js` is the server-side equivalent, with a configurable
zone. A night-shift pour or a 4am delivery is not an edge case in construction.

**Clamped date arithmetic.** `addMonths(Jan 31, 1)` is 28 February, and because
each occurrence is computed from the previous one, a monthly bill stayed on the
28th for good. The 30th went the same way after one February; a yearly bill on 29
February lost its day in the first non-leap year. See `src/lib/recurring.js`.

**Property assumptions inside a construction product.** `assetOptional` in
`src/lib/place.js` means a construction company books nothing to an asset — so
`property_id` is **null on every row**, by design. Any key, index or grouping
built on asset alone therefore collapses. That is what made three sites with
three separate monthly plant hires into one recurring series, where two of them
silently stopped recurring. When you see a key built from `property_id`, ask what
it does in a company: it probably needs `project_id` and `entity_id` too.

**Consent that does not match what is sent.** `reports.js` promised "if it isn't
in `describeDiagnostics`, it isn't attached" and sent stack traces that appeared
in no list. When a module states a privacy promise in its header, test the
promise.

---

## 9. Known debt and what to look at next

From `scripts/untested-exports.mjs`, re-run 2026-11-11: **79 files hold at least
one export no test mentions; 257 exports in all.** In priority order, with the
reasoning, because the raw count is misleading:

**Worth doing, roughly in this order**

1. `src/lib/invoiceTemplate.js` — **12 of 18 untested.** 527 lines of template
   engine whose output goes to clients. The escaping is already verified sound
   (`renderTemplate` escapes by default at `:122`, its only caller uses the
   default at `:520`, the `ESCAPES` map covers `& < > " '`), so this is a
   **correctness** item, not a security one.
2. `src/lib/ocr.js` (6/7) and `src/lib/gmail.js` (6/7) — `parseReceipt`,
   `linesFromItems`, `scanMetalBill` are pure parsers that read **money off
   photographs** and put it in the ledger. High value, fully testable.
3. `src/lib/exports.js` — 4 of 8, the four being `exportWorkbook`, `exportCSV`,
   `exportPDF`, `parseSpreadsheet`. The import half was done (`cc8eca3`); the
   export half decides what leaves the app.
4. `src/lib/constants.js` (9/23) — mostly colour maps, but `isScannable` and
   `colorForCategory` have logic.
5. `src/lib/storage/blobs.js` (5/7) — attachments. Partly covered through
   `tests/browser/sweepui.mjs`, which the name-based scan cannot see.

**Deliberately not chased, with reasons**

- `src/lib/storage/local.js` (24/40) and `supabase.js` (23/40) top the raw count
  and the count **overstates them**: `cloudwiring.test.mjs` already asserts every
  `db.*` the app calls exists in both backends, and the SQL suite covers the
  policies behind them.
- `src/components/ui.jsx` (16/19) — primitives exercised through every browser
  suite.
- `src/lib/admin.js` (14/14) — client-side sugar over `SECURITY DEFINER` RPCs
  that Postgres guards with `is_admin()`. Nothing to protect that Postgres is not
  already protecting.
- `src/components/DashboardCharts.jsx` (4/4) — Recharts wrappers, covered by
  `chartui.mjs`.

**Other debt**

- **i18n reaches only 8 of 68 components.** `ExpenseTable`, `IncomeTable` and
  most of the app are hardcoded English despite thirteen complete locales. So
  `paymentMeta`'s English labels in `PaymentChip` are a symptom of a pass that
  has not happened, not a bug to patch alone. This is a project, not a fix.
- `../tests/README.md`'s suite tables are maintained by hand and **nothing checks
  them**, which is worth knowing because they had rotted badly before this commit
  resynced them: 28 suites missing entirely, thirteen more carrying stale
  assertion counts, and all three totals wrong (logic read 4,319 against a real
  5,480; `corporate.sql` read 196 against 209). A reader would have concluded
  whole modules were untested that were not. They are now measured and exact,
  and the row set is reconciled against the files on disk in both directions —
  no orphans, nothing missing. Re-check when you add or rename a suite;
  `./scripts/sweep.sh` is the authority.
- The live bank connection is **scaffolding and documented as such** in
  `BANK_SYNC.md`, which now names each missing step. Do not half-finish it.

---

## 10. Deployment — what is actually true

**The app has not been deployed from this container, and cannot be.** Do not
spend a session trying; this was established the hard way.

- **No credentials exist in this environment.** Zero Supabase, Vercel or Stripe
  variables are set. Checked again on 2026-11-11.
- **Vercel is unreachable.** Project creation returned 403, and the egress proxy
  refuses `vercel.com` and `api.vercel.com` with `403 CONNECT tunnel failed`.
  There is no Vercel CLI installed.
- `vercel.json` and `.env.example` **are** committed, and `docs/DEPLOY.md` has
  the real steps — including the Supabase free-tier pause warning and all six
  SQL files with what breaks without each.

This needs the owner's own credentials. Re-check from an account that has them
rather than retrying from here. Everything else — build, all three test suites,
the preview server — works fully offline.

---

## 11. Deliberately not done

Each with its reason, so it is a decision rather than an omission:

- **A Plaid Link SDK integration.** The live bank connection is documented
  scaffolding; finishing it is a feature, not a fix. It needs the SDK installed
  and somewhere to persist an access token per user.
- **A `provider_txn_id` column on `expenses` / `income`.** Strictly better bank
  dedupe than the current asset+date+amount+category key, but it is a schema
  change and belongs in its own commit with its own SQL assertions.
- **The i18n pass.** §9.
- **`storage/local.js` / `storage/supabase.js` CRUD, `admin.js`, and
  `invoiceTemplate.js` escaping.** §9.

---

## 12. Honest caveats

- **One browser suite crashed unidentifiably** after the TDS work. Two full clean
  runs since, and it has not recurred. Recorded here as undiagnosed rather than
  called flaky, because calling it flaky is how a real intermittent bug gets
  filed away.
- A route probe of mine **falsely reported four public pages blank.** It looked
  for `#main-content`, which those pages do not have. Re-probing found
  927 / 623 / 1497 / 1238 characters of real content. The pages are fine; the
  probe was not.
- An `/invoices` SecurityError **reproduces only** under
  `serviceWorkers: 'block'`, and the single occurrence in the bundle is properly
  guarded. Test artefact.
- The TDS work **deliberately declined to carry a challan payment code**, because
  the sources disagreed about it. If you touch `src/lib/tds.js`, verify statutory
  facts against a current source rather than from memory — two GST slabs in this
  app had already ceased to exist.
- Two of the test expectations written during the last three sections were wrong
  on the first run and the suites caught them. That is the system working, but it
  means **a green suite you just wrote is not evidence**; §4's break step is.
