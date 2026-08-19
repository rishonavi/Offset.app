# Offset

Track what you own and what it costs you. Log every expense and every rupee of
income against the asset it belongs to, raise invoices, reconcile a bank
statement, and hand your accountant a file they can actually import.

India-first — ₹ INR, `en-IN`, GST-aware, April–March financial year — and
configurable away from all of that.

Built with **React 19 + Vite + Tailwind v4**, with **Supabase** (Postgres +
Auth + Storage) as the optional cloud backend.

---

## The longer documentation

The README is the tour. Each of these explains one area and, more usefully, why
it was built the way it was:

| Document | Covers |
| --- | --- |
| [`docs/ASSETS.md`](./docs/ASSETS.md) | Metals and broker holdings — assets that are a quantity, not a price |
| [`docs/INVOICES.md`](./docs/INVOICES.md) | The invoice template language and its tokens |
| [`docs/CORPORATE.md`](./docs/CORPORATE.md) | Entities, roles, departments, approvals and the four ledgers |
| [`docs/TRANSLATION.md`](./docs/TRANSLATION.md) | Adding a language, plurals, RTL |
| [`docs/BANK_SYNC.md`](./docs/BANK_SYNC.md) | Live bank / UPI connection |
| [`docs/REPORTS.md`](./docs/REPORTS.md) | "Report a problem" and where reports go |
| [`BILLING.md`](./BILLING.md) | Optional Free/Pro tiers with Stripe |
| [`tests/README.md`](./tests/README.md) | How to run both kinds of test |

---

## Features

### Assets and entries

- **Assets** — property, vehicles, and anything else you want costs attributed
  to. Every expense and every receipt of income belongs to one.
- **Precious metals** — gold and silver held by weight and purity, valued
  correctly: MCX quotes gold per **10 grams** and silver per **kilogram**, and
  purity is millesimal fineness (916 = 22K), so a 22K piece is worth 91.6% of
  the fine rate. Grams, kilograms, tola and troy ounces all convert.
- **Broker holdings** — import a holdings export and keep forty positions as one
  asset instead of forty rows. Column names vary by broker and are matched by
  alias, not by exact header.
- **Expenses and income** — date, amount, category, vendor/payer, payment
  method, notes, tax.
- **Bills** — due dates, paid/unpaid status, one-tap *mark paid*, and a comment
  thread per bill.
- **Receipts** — attach a photo, PDF, Word or Excel file to any entry. Bills
  often arrive as a `.docx` or `.xlsx` rather than a scan, so those are stored
  and handed back on download; only images and PDFs can be *scanned*, so the
  scan button appears for those alone.
- **Recurring entries** — duplicate any entry to re-log rent, EMI or utilities
  quickly.
- **Bin** — deleted entries are recoverable rather than gone.

**"Unknown" is never rendered as zero.** A metal holding with no rate, or a
gain where a cost is missing, reports as unknown and is counted separately. A
silent zero drags a total down and looks like an answer.

### Reading things in for you

- **Scan to auto-fill** — read a receipt's amount, tax, date, vendor and
  category off a photo (AI vision when configured, on-device OCR otherwise).
- **Import bills from Gmail** — read-only Gmail connection; Offset finds recent
  invoice emails, extracts the details, and you add them with one tap.
- **Bank & UPI statements** — import a statement file and auto-reconcile it
  against unpaid expenses and pending income. A live bank connection is
  scaffolded and off by default (see [`docs/BANK_SYNC.md`](./docs/BANK_SYNC.md)).
- **Spreadsheet import** — bulk-load from Excel or CSV; unknown asset names
  create the asset.

### Getting things out

- **Invoices** — build an invoice from entries already in your ledger and print
  it in **your** format. A format is an HTML file with `{{tokens}}`, or the
  Word (`.docx`) or Excel (`.xlsx`) draft you already have — import it once and
  it sits alongside the built-in one. GST is applied properly: same
  state gives CGST + SGST, different states gives IGST, and when neither party
  is registered there are no tax lines at all — not a zero row.
- **Tally** — export income and expenses as import-ready Tally XML vouchers,
  and import Tally XML back in.
- **Export** — Excel (`.xlsx`), CSV, or a formatted PDF of any filtered view.
- **Reports** — GST/tax paid vs collected, deductible expenses by category, a
  per-year statement and a year-end PDF.
- **Backup & restore** — a private JSON backup, to a file or to your own Google
  Drive / Dropbox / OneDrive.

### Seeing where you are

- **Dashboard** — totals, 12-month trend, spend by category, spend by asset.
- **ROI & yield** — add an asset value for gross/net rental yield and total ROI.
- **Budgets** — per-asset monthly budgets with a progress bar.
- **Personal** — a separate lightweight month-by-month personal ledger, kept
  apart from the asset books.
- **Filter & search** — by asset, category, date range or free text; sortable
  columns; long lists render a page at a time behind *Show more*.
- **Command palette** — `⌘K` to jump anywhere, `N` to quick-add an expense, `?`
  for the shortcut list.

### Working with other people

- **Private login** — enforced by row-level security.
- **Share read-only** — invite an accountant or partner to view your workspace
  (Settings → Team; run `supabase/teams.sql`).
- **Companies** — several legal entities under one login, with roles,
  departments and approval rules. See [Companies](#companies-optional) below.
- **Report a problem** — users can tell you what broke with the diagnostics
  already attached.

### Everywhere else

- **13 languages** — English, 简体中文, हिन्दी, Español, Français, العربية, বাংলা,
  Português, Русский, اردو, मराठी, ગુજરાતી, தமிழ். Arabic and Urdu render
  right-to-left. Language changes **wording only** — amounts and dates stay in
  the currency and locale you configured, which is what someone filing Indian
  accounts wants whatever language the buttons are in.
- **Installable app (PWA)** — add to your home screen; runs full-screen and
  works offline.
- **Payment reminders** *(optional)* — daily email digest of overdue and
  upcoming payments (see
  [`supabase/functions/payment-reminders`](./supabase/functions/payment-reminders/README.md)).
- **Light and dark** themes.

---

## Two ways to run

### 1. Demo mode (zero setup)

No account, no backend. Data is stored **only in this browser** — good for
trying it out, not for real records.

```bash
npm install
npm run dev
```

A yellow "Demo mode" banner reminds you that nothing is synced. Every feature
works in demo mode; that is how they are developed and tested.

Two consequences worth knowing before using it for anything real. Data lives in
**one browser on one device** — it does not follow you to a phone, another
browser, or a private window, and iOS Safari discards it after about a week of
not visiting. And the whole ledger shares that browser's **~5MB** of storage, so
attachments over 1.5MB are refused with a message saying so rather than
silently failing later. Cloud mode has neither limit.

### 2. Cloud mode (login + sync + receipt storage)

1. Create a free project at <https://supabase.com>.
2. In the Supabase dashboard open **SQL Editor**, paste the contents of
   [`supabase/schema.sql`](./supabase/schema.sql) and click **Run**. This
   creates the tables, the security rules and the private `receipts` bucket.
   The file is written with `add column if not exists` throughout, so it is
   **safe to re-run** after pulling — and you need to, because later features
   add columns to existing tables.
3. In **Project Settings → API**, copy your **Project URL** and **anon public
   key**.
4. Copy `.env.example` to `.env` and fill them in:

   ```bash
   cp .env.example .env
   ```

   ```env
   VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   VITE_CURRENCY=INR
   ```

5. `npm install && npm run dev`.
6. Open the app, click **Create one**, and register with email + password.
   - To skip email confirmation: **Authentication → Providers → Email**, turn
     **Confirm email** off.
   - To keep it single-user, turn off public sign-ups once your account exists.

Optional SQL, each applied after `schema.sql`: `teams.sql` (read-only sharing),
`admin.sql` (the admin panel), `reports.sql` (problem reports), `limits.sql`
(plan limits).

> `VITE_OPEN_ACCESS=true` skips login entirely and runs on browser storage even
> when Supabase keys are present — that is how the public demo is deployed.

---

## Logins (Google, Apple, email) & backup

**Sign-in** is Supabase Auth. Email + password works out of the box. For the
social buttons:

1. **Google** — create an *OAuth 2.0 Web client* in Google Cloud, then paste the
   Client ID + secret into **Authentication → Providers → Google**.
2. **Apple** — needs a paid Apple Developer account: a Services ID + key, into
   **Authentication → Providers → Apple**.
3. In **Authentication → URL Configuration** set your **Site URL** and add your
   deployed URL (and `http://localhost:5173`) to **Redirect URLs**.

The buttons appear automatically in cloud mode once configured.

**Backup & restore** lives on the **Reports** page. Receipts stay in Supabase;
the backup is your data as JSON:

- **Backup file** — no setup; download a `.json` and keep it wherever you like.
- **Google Drive** — set `VITE_GOOGLE_CLIENT_ID` (enable the Drive API; add your
  site to Authorized JavaScript origins).
- **Dropbox** — set `VITE_DROPBOX_APP_KEY` (Scoped app, App-folder access,
  `files.content.read`/`write`).
- **OneDrive** — set `VITE_MS_CLIENT_ID` (Azure SPA app, implicit access tokens,
  `Files.ReadWrite.AppFolder`).

Each connects in a popup and reads/writes a private `offset-backup.json` in your
own account. (iCloud has no public web API for this — use the backup file.)

---

## Receipt scanning (auto-fill)

Attach a bill photo or PDF to an entry and press **Scan to auto-fill**. Two
readers, and the app picks the best one available:

1. **AI vision (recommended, and free).** Create a
   [Google AI Studio](https://aistudio.google.com) key — a Google account, no
   card — and set `GEMINI_API_KEY` on your host. It copes with angled photos,
   faint thermal prints, handwriting and non-English bills, and maps the spend
   onto one of your categories. The key is used only by the serverless function
   in [`api/scan-receipt.js`](./api/scan-receipt.js) and is **never** shipped to
   the browser — note the absent `VITE_` prefix. `SCAN_MODEL` overrides the
   model (default `gemini-2.0-flash`).
2. **On-device OCR (free, zero setup).** With no key, scanning falls back to
   in-browser Tesseract plus heuristics — handy, less accurate.

> The `/api` functions run on Vercel or any host with Node serverless functions.
> On a purely static host they don't run, and scanning uses the OCR fallback.

---

## Import bills from Gmail (optional)

**Import from Gmail** connects your Gmail read-only, finds recent emails with
invoice or receipt attachments, reads each with the Gemini scanner, and shows
them in a review list — pick the asset, confirm the amount and date, add.
Everything runs in your browser under your own Google login; nothing is stored
on a server.

Setup reuses `VITE_GOOGLE_CLIENT_ID`:

1. **APIs & Services → Library** → enable the **Gmail API**.
2. **OAuth consent screen** → add the scope
   `https://www.googleapis.com/auth/gmail.readonly` and add yourself as a
   **Test user**.
3. **Credentials → OAuth client ID (Web)** → add your site to **Authorized
   JavaScript origins** → set `VITE_GOOGLE_CLIENT_ID` → redeploy.
4. Make sure `GEMINI_API_KEY` is set — the import uses the same reader.

> `gmail.readonly` is a Google **restricted** scope. In Testing mode it works
> for you and your test users; opening it to the public would require Google's
> restricted-scope security assessment.

---

## Companies (optional)

Personal Offset has one set of books owned by one person. The corporate layer
adds several **legal entities** under one login, people with **roles** inside
them, costs tagged to **departments**, spending that needs **approval**, and an
audit trail — plus models for inventory, payables, advances and payroll.

**The whole layer stays dormant until you create a company.** A personal install
sees no Companies nav, no entity switcher, and writes no `pl_corp_*` keys. The
route exists regardless: go to **`/companies`** and press *Add a company*, and
the nav entry and switcher appear from then on.

Two rules are enforced in the model rather than the UI, because that is where
they matter: **nobody approves their own entry**, and **an entity always keeps
at least one owner** so it can never be locked out. `__all__` is a read-only
consolidated view; entities reporting in another currency are listed as excluded
rather than converted at an invented rate.

> **Current limitation.** The corporate layer stores in the browser under
> **both** backends — the Supabase schema and row-level security for entities,
> departments, members and the ledgers are not written yet. A company's books
> are local to the device until they are. The app says so rather than pretending
> to sync. What is built, and what is next, is tracked at the bottom of
> [`docs/CORPORATE.md`](./docs/CORPORATE.md).

---

## Report a problem

Users can file what broke from the sidebar, with the diagnostics attached
automatically. Reports are read in `/admin` and are never listed back to the
user. Two independent destinations — a Postgres table (apply
`supabase/reports.sql`) and an email inbox (`REPORTS_EMAIL` + `RESEND_API_KEY`).
A deployment can have either, both or neither, and the dialog tells the user
which of them took the report.

> The email path has not yet been exercised against a live mail provider. See
> [`docs/REPORTS.md`](./docs/REPORTS.md).

---

## Scripts

| Command           | What it does                         |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Start the Vite dev server            |
| `npm run build`   | Production build into `dist/`        |
| `npm run preview` | Serve the production build locally   |

### Tests

There is no test framework and no runner in `package.json`. Each test file is a
script that asserts, prints a line per assertion, and exits non-zero if anything
failed — so it works in CI as-is.

```sh
npx vite-node tests/logic/metals.test.mjs      # logic: 10 suites, 804 assertions
```

```sh
VITE_OPEN_ACCESS=true npx vite build           # browser: 10 suites, 320
npx vite preview --port 4188 &
node tests/browser/flows.mjs
```

Browser tests run Playwright against the **production build**, never the dev
server, and must keep `serviceWorkers: 'block'` — the PWA worker serves stale
chunks and will make a fixed bug look unfixed. Full detail, including the two
environment overrides, is in [`tests/README.md`](./tests/README.md).

---

## Deploying

A static SPA plus serverless functions. On **Vercel**: import the repo, leave
the project root at the repository root, framework **Vite**, and add your
environment variables. [`vercel.json`](./vercel.json) rewrites everything except
`/api/*` to `index.html` so client-side routing works on refresh.

Any host that serves `dist/` will run the app; the `/api` functions need Node
serverless support. Without them, receipt scanning falls back to on-device OCR,
and the other server-backed features return 501 and are hidden rather than
breaking the page.

---

## Import / export format

Spreadsheet exports and imports use these columns:

| Date | Property | Category | Vendor | Payment Method | Description | Amount |
| ---- | -------- | -------- | ------ | -------------- | ----------- | ------ |

- **Date** accepts `yyyy-mm-dd`, common date strings, or Excel date cells.
- **Property** is matched by name; an unknown name creates the asset on import.
- **Amount** ignores currency symbols and commas.

---

## Project structure

```
src/
  lib/
    storage/        cloud (Supabase) + local (browser) backends, one shared API
    corporate.js    entities, roles, departments, approvals, audit
    inventory.js    weighted-average stock (Ind AS 2)
    payables.js     ageing ladder for payables and receivables
    advances.js     advances as an asset, adjusted against bills
    payroll.js      PF / ESI / professional tax (TDS deliberately not computed)
    metals.js       units, purity, quoting, session close
    brokers.js      broker holdings imports and column aliasing
    invoice.js      line items, GST, totals
    invoiceTemplate.js  the {{token}} template language
    i18n.js         languages, plurals, RTL
    exports.js      Excel / CSV / PDF export + spreadsheet import
    tally.js        Tally XML vouchers, both directions
    bankSync.js     statement import and reconciliation
    stats.js        chart aggregations
    format.js       currency / date formatting
    constants.js    categories, payment methods, colours, currency
  locales/          13 dictionaries; en.js is the source of truth
  context/          auth, data, config, entity, language, plan, theme, …
  components/       Layout, forms, tables, charts, and the ui.jsx primitives
  pages/            Dashboard, Assets, Income, Expenses, Bills, Invoices,
                    Reports, Companies, Personal, Settings, Admin, Bin, …
api/                Vercel serverless functions; files prefixed _ are helpers
supabase/           schema.sql plus the optional teams / admin / reports / limits
docs/               the reasoning behind each area
tests/              logic/ (vite-node) and browser/ (Playwright)
```

The data layer is backend-agnostic. `src/lib/storage/index.js` picks the
Supabase backend when `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set and
`VITE_OPEN_ACCESS` is unset, and otherwise falls back to browser storage. The
rest of the app only ever imports `db` from there.

---

## Environment variables

[`.env.example`](./.env.example) is the annotated list — copy it and read the
comments. In short:

| Variable | For |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Cloud mode; leave blank for demo mode |
| `VITE_CURRENCY`, `VITE_LOCALE` | Currency and number/date formatting (`INR`, `en-IN`) |
| `VITE_OPEN_ACCESS` | `true` runs with no login on browser storage |
| `VITE_GOOGLE_CLIENT_ID` | Google Drive backup **and** Gmail import |
| `VITE_DROPBOX_APP_KEY`, `VITE_MS_CLIENT_ID` | Dropbox / OneDrive backup |
| `VITE_BILLING_ENABLED`, `VITE_PRO_PRICE` | Free/Pro tiers — see `BILLING.md` |
| `VITE_BANK_SYNC`, `VITE_BANK_PROVIDER` | Live bank connection — see `docs/BANK_SYNC.md` |
| `GEMINI_API_KEY`, `SCAN_MODEL` | Server-side receipt scanning |
| `REPORTS_EMAIL`, `RESEND_API_KEY`, `REPORTS_FROM` | Problem reports by email |
| `STRIPE_*`, `SUPABASE_SERVICE_ROLE_KEY` | Stripe checkout, portal and webhook |
| `PLAID_*` / `SETU_*` | Bank provider credentials |

Anything without a `VITE_` prefix is read only by the serverless functions and
never reaches the browser. Every server-backed feature is env-gated and returns
**501 when unconfigured**, so an unconfigured deployment degrades quietly
instead of breaking.
