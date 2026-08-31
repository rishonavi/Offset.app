# Putting Offset online

Two steps, and only the first is required. Offset runs without Supabase — it
just runs **in the browser only**: no login, and each visitor's data lives in
their own browser and goes no further. That is a real mode, not a broken one,
and it is the right way to show someone the app. It is not the right way to
keep books you care about, because nothing is backed up and clearing site data
loses everything.

## 1. Vercel

The repository is `rishonavi/Offset.app`, and this has to be done from an
account with access to it — Vercel's GitHub app must be able to see that owner,
which is the usual reason a connection fails at this step.

1. **vercel.com → Add New → Project**, and pick `rishonavi/Offset.app`.
   If it is not listed, "Adjust GitHub App Permissions" and grant access to
   that owner.
2. Framework preset **Vite**, build `npm run build`, output `dist`. Vercel
   detects all three; `vercel.json` in the repo handles the SPA rewrite so a
   refresh on `/expenses` does not 404.
3. **Deploy.** Every push to `main` deploys from then on.

At this point the app is live in demo mode. `api/` deploys as serverless
functions and each one answers **501** until its keys are set, rather than
failing — an unconfigured feature says it is unconfigured.

## 2. Supabase — login, sync and receipt storage

1. **supabase.com → New project.** Any region; the free tier is enough.
2. **SQL Editor**, then run the files in `supabase/` in this order:
   `schema.sql`, then `corporate.sql` if you want entities and approvals.
   Both are written to be re-runnable.
3. **Settings → API** gives you two values. In Vercel, under
   **Settings → Environment Variables**, add:

   | Variable | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | Project URL |
   | `VITE_SUPABASE_ANON_KEY` | The `anon` / publishable key |

   The anon key is meant to be public — it ships in the browser bundle, and
   row-level security is what protects the data. The **service role** key is
   the one that must never go in a `VITE_` variable; it belongs only to the
   server-side variables further down.

4. **Remove `VITE_OPEN_ACCESS`** if it is set. While it is `true` the app skips
   login entirely and stays on browser storage, so Supabase will appear to do
   nothing no matter how correctly it is configured. This is the single most
   common reason "Supabase is connected but nothing happens".

5. **Redeploy.** `VITE_` variables are read at build time, not at run time, so
   an existing deployment will not pick them up — it has to be rebuilt.

### Signing in with Google

In **Supabase → Authentication → Providers → Google**: paste a Google OAuth
client ID and secret, and in the Google Cloud console add this exact redirect
URI:

```
https://<your-project-ref>.supabase.co/auth/v1/callback
```

The redirect goes to *Supabase*, not to your Vercel domain — pointing it at the
app is the mistake that produces a login loop with no error.

Then add your Vercel URL under **Authentication → URL Configuration** as both
the Site URL and a redirect URL, or Supabase will refuse to send people back.

## Optional, and each independently skippable

| What | Variables | Without it |
|---|---|---|
| AI receipt scanning | `GEMINI_API_KEY` | On-device OCR, less accurate |
| Emailed problem reports | `REPORTS_EMAIL`, `RESEND_API_KEY` | Reports stay in the browser; the UI offers a mailto |
| Billing / plan limits | `VITE_BILLING_ENABLED`, `ENFORCE_PLAN_LIMITS`, `STRIPE_*` | Everyone is treated as Pro |
| Drive / Dropbox / OneDrive backup | `VITE_GOOGLE_CLIENT_ID`, `VITE_DROPBOX_APP_KEY`, `VITE_MS_CLIENT_ID` | Those buttons are hidden |
| Live bank connection | `VITE_BANK_SYNC`, `BANK_PROVIDER`, provider keys | Reconcile from an imported statement file |

`.env.example` is the full list with a note on each.

## Checking it actually worked

- The amber **"Demo mode"** banner across the top is gone. While it is there,
  the app is on browser storage regardless of what the dashboard says.
- Signing out and back in keeps your data.
- `curl https://<your-app>/api/scan-receipt` answers 501 without a Gemini key
  and 405 with one — either way it is deployed and reachable.

## Running the tests against a deployment

Everything in `tests/browser/` takes a URL, so the suites can be pointed at the
real thing rather than only at a local preview:

```sh
OFFSET_TEST_URL=https://your-app.vercel.app node tests/browser/flows.mjs
```

`loginui.mjs` is the one that needs Supabase keys present in the build; it skips
itself and says so when they are missing.
