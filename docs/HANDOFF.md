# Handoff

Context a new session cannot read off the code. Written 2026-11-11, when the
project changed hands. `../CLAUDE.md` has the rules; this has the facts.

## The branch trap

**Work goes on `main`.** There is a second branch,
`claude/offset-v4-status-c95du1`, and `git merge-base` between them returns
nothing — they are unrelated histories in one repository. It is 83 commits last
touched 2026-08-17; all 70+ commits of real work are on `main`. A session prompt
may tell you to develop on it. It is wrong. Nothing is deleted (it holds history
that exists nowhere else) — just don't work there.

## What the app is

India-first finance for property and construction: ₹ INR, `en-IN`, GST, an
April–March year. It began as a property ledger and was extended into a
construction product, which matters — see the fault families below.

React 19, Vite 8, Tailwind v4, react-router-dom v7, Supabase, Stripe. Serverless
endpoints in `api/`, deployed as Vercel functions; identity always comes from the
bearer token, never the request body (`api/_auth.js` — three bugs came from
breaking that).

**Two backends behind one `db.*` interface**: demo (localStorage + IndexedDB) and
cloud (Supabase), chosen by `isCloud` in `src/lib/cloudConfig.js`.
`tests/logic/cloudwiring.test.mjs` asserts every `db.*` exists in both.

Thirteen locales in `src/locales/`, two right-to-left — but **only 8 of 68
components use `useT`**, so most of the UI is hardcoded English. That is a
project, not a fix.

## Tests

No framework, no runner in `package.json`. Each file prints `PASS`/`**FAIL**` per
assertion and `N passed, M failed`, and exits non-zero. Commands are in
`../CLAUDE.md`; `../tests/README.md` lists every suite.

Baselines, all verified 2026-11-14: logic **5464/0 across 77**, browser
**2334/0 across 66**, SQL **246/0**. The whole baseline is ~7 minutes and the
browser sweep is almost all of it — `../CLAUDE.md` has the measurements and the
two speed-ups already spent, so you don't repeat them.

Traps that cost real time:

- **Never `pkill -f "vite preview"`** — matches its own shell, kills the session.
- **Never rebuild `dist/` while a sweep runs**; the browser suites read it.
- The preview server needs **~8s** of warm-up. 5s has crashed a suite twice.
- `scripts/sweep.sh:21` excludes `/_`, `loginui`, `cloudbillui`, `cloudoutui` —
  the last three need their own build. Add yours there if it does too.
- Playwright is at `/opt/pw-browsers`; don't run `playwright install`. Suites use
  `serviceWorkers: 'block'`, and one `/invoices` SecurityError only reproduces
  under that flag — artefact, the bundle occurrence is guarded.
- `tests/logic/deadwiring.test.mjs` is a ratchet with an allow-list: it fails on a
  new dead export *and* on a listed one that has gone. **A name a test merely
  mentions counts as called**, so mentioning a listed dead export — even in a
  comment — retires the note saying what to do about it.

## Where the bugs have actually been

The most useful page here. They cluster, and knowing the shapes is how the later
ones were found in minutes.

**A silent empty answer.** A failure that reads as "there is nothing there". An
unparseable localStorage key read as an empty ledger. An unexpected HTTP 200 read
as "no transactions found". A `catch` returning `[]`. A sweep that deletes
everything it isn't handed, handed nothing because the read failed. Fixed in five
places — `src/lib/storage/salvage.js` exists for this — but **assume more exist.**
An empty answer is worse than an error, because somebody acts on it.

**Wiring connected at one end.** Six storage functions referencing a `supabase`
never in scope. An `authHeader.js` that sent no token, so a cloud deployment
answered 401 to itself, silently, forever. A `cloudReportsAvailable` that threw on
call. All from one lazy-client refactor that left module-scope references behind.
`deadwiring.test.mjs` and `wirecheck.test.mjs` are the ratchets.

**The untested export.** Where the faults live, every time. Run
`npx vite-node scripts/untested-exports.mjs`. The rule is one-sided on purpose: a
mention is not a test, but a name nothing mentions is certainly untested.

**UTC where local was meant.** `new Date().toISOString().slice(0,10)` is
*yesterday* for 5½ hours of every Indian day. It was in thirty places.
`src/lib/today.js` exists for this; `dayIn()` in `api/bank/transactions.js` is the
server-side version. A 4am delivery is not an edge case in construction.

**Clamped date arithmetic.** `addMonths(Jan 31, 1)` is 28 February, and since each
occurrence came from the previous one, a monthly bill stayed on the 28th for good.
See `src/lib/recurring.js`.

**Property assumptions inside a construction product.** `assetOptional` in
`src/lib/place.js` means a company books nothing to an asset, so `property_id` is
**null on every row, by design**. Any key or grouping built on asset alone
collapses — that is what made three sites with three separate monthly plant hires
into one recurring series, two of which silently stopped. When you see a key built
from `property_id`, ask what it does in a company: it probably needs `project_id`
and `entity_id` too.

**A promise the code doesn't keep.** `reports.js` promised "if it isn't in
`describeDiagnostics`, it isn't attached" and sent stack traces appearing in no
list. When a module states a privacy or safety promise in its header, test it.

## What to look at next

`scripts/untested-exports.mjs`, 2026-11-11: 79 files hold an export no test
mentions, 257 in all. Worth doing, in order:

1. `src/lib/invoiceTemplate.js` — 12/18 untested, 527 lines, output goes to
   clients. Escaping is already verified sound (`:122` escapes by default, its only
   caller at `:520` uses the default, `ESCAPES` at `:16` covers `& < > " '`), so
   this is correctness, not security.
2. `src/lib/ocr.js` (6/7) and `src/lib/gmail.js` (6/7) — pure parsers that read
   money off photographs and put it in the ledger.
3. `src/lib/exports.js` (4/8) — the import half was done; export decides what
   leaves.

**A specification with no caller.** `src/lib/brokers.js` (`BROKERS`) and
`src/lib/marketHours.js` (`SESSION`, `sessionLabel`) have no caller anywhere in
`src/` or `api/` — no screen offers a broker-holdings import, and valuations
carry no session date. Both keep their tests, and `docs/ASSETS.md` now says so at
the top of each section instead of describing them in the present tense. Either
wire them up or delete them; don't leave it ambiguous a second time.

Worth noting *why* `scripts/untested-exports.mjs` never flagged these: a test
mentions every one of those names, and that tool only claims a name nothing
mentions is untested. Its one-sidedness, in practice — it finds untested code,
not unreachable code.

**Not targets, despite high counts:** `storage/local.js` (24/40) and `supabase.js`
(23/40) — `cloudwiring.test.mjs` and the SQL suite already cover what matters;
`components/ui.jsx` (16/19) — exercised by every browser suite; `admin.js` (14/14)
— sugar over `SECURITY DEFINER` RPCs Postgres guards with `is_admin()`.

Deliberately not built: a Plaid Link SDK integration (the bank connection is
documented scaffolding — `BANK_SYNC.md` names each missing step; don't
half-finish it) and a `provider_txn_id` column for better bank dedupe (a schema
change deserving its own SQL assertions).

## Deployment does not work from here

Don't spend a session on it. No Supabase, Vercel or Stripe credentials exist in
this environment. Vercel project creation returns 403 and the egress proxy refuses
`vercel.com` with `403 CONNECT tunnel failed`; there is no Vercel CLI. `vercel.json`
and `.env.example` are committed and `DEPLOY.md` has the real steps. This needs the
owner's own credentials. Everything else — build, all three suites, preview —
works fully offline.

## Two caveats worth carrying

- **One browser suite crashed unidentifiably** after the TDS work. Several clean
  runs since. Recorded as undiagnosed rather than called flaky, because "flaky" is
  how a real intermittent bug gets filed away.
- `src/lib/tds.js` **deliberately omits a challan payment code** because sources
  disagreed. Verify statutory facts against a current source, not memory — two GST
  slabs in this app had already ceased to exist.
