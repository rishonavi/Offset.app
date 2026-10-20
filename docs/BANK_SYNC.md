# Live bank connection (scaffold, off by default)

> **Read this first: the live connection is not finished.** The server side is
> written and the normalisation is tested, but **the link cannot currently be
> completed end to end**, so turning this on will not pull transactions. What
> works today, fully, is **file import** (Import → Bank & UPI statement).
>
> Precisely what is missing, so you can judge the gap rather than discover it:
>
> | Step | State |
> | --- | --- |
> | `POST /api/bank/link` → Plaid Link token / AA consent URL | **written** |
> | Client hands the Link token to the **Plaid Link SDK** | **missing** — the SDK is not installed or rendered, so no `public_token` is ever produced. For the AA path the consent URL does open in a new tab. |
> | `POST /api/bank/transactions` exchanges `public_token` → `access_token` | written, but the token **is not persisted** (`api/bank/transactions.js`), so even a completed link would sync once and never again |
> | Client sends the tokens back on sync | **missing** — `src/components/BankImport.jsx` calls `fetchLiveTransactions({})` with no tokens |
> | Normalising a provider's rows to Offset's shape | **written and tested** (`tests/logic/banksync.test.mjs`) |
>
> Finishing it means installing a Plaid Link SDK (or an AA TSP widget) and adding
> somewhere to keep the access token per user — a feature, not a configuration
> step. Credentials alone will not do it.

Once finished, connected transactions flow into the **same reconciliation** used
for file import: debits match your unpaid expenses, credits match pending income.

## Providers

| Region | Provider | Notes |
| --- | --- | --- |
| US / UK / EU | **Plaid** | `link/token/create` → Plaid Link → `item/public_token/exchange` → `transactions/get`. |
| India | **Account Aggregator** (Setu / Finvu) | RBI-regulated consent flow. You must be a registered **FIU** or use an AA **TSP**. |

> There is **no API to read a personal Google Pay / UPI feed** — Google Pay's
> APIs are merchant-side. For UPI/bank data in India, the Account Aggregator
> framework is the sanctioned route; otherwise use file import (Google Pay lets
> you export your transaction history).

## Enable it

Setting these makes the button and the endpoints live; it does **not** complete
the gap above.

**Client** (`.env` — controls whether the "Connect a bank" button shows):

```
VITE_BANK_SYNC=true
VITE_BANK_PROVIDER=plaid   # or "setu"
```

**Server** (host dashboard, e.g. Vercel → Settings → Env — never VITE_-prefixed):

Plaid:
```
BANK_PROVIDER=plaid
PLAID_CLIENT_ID=...
PLAID_SECRET=...
PLAID_ENV=sandbox          # sandbox | development | production
PLAID_COUNTRIES=US         # csv, e.g. US,GB
```

Account Aggregator (Setu):
```
BANK_PROVIDER=setu
SETU_CLIENT_ID=...
SETU_CLIENT_SECRET=...
SETU_PRODUCT_INSTANCE_ID=...
SETU_BASE_URL=https://fiu-sandbox.setu.co
BANK_REDIRECT_URL=https://your-app/import
```

Optional, either provider:
```
BANK_TIMEZONE=Asia/Kolkata  # the zone the account's days are reckoned in
BANK_CURRENCY=INR           # defaults to VITE_CURRENCY, then INR
```

`VITE_BANK_PROVIDER` only decides the badge the client shows; `BANK_PROVIDER`
decides what actually runs. Set both, to the same value — they default
independently, so setting only the server one left the UI labelled "Plaid" over
an Account Aggregator flow. `serverBankProvider()` in `src/lib/bankSync.js` asks
the server which it is.

## How it works

1. `POST /api/bank/link` starts a connection — a Plaid **Link token** or an AA
   **consent URL**. Who it is for comes from the caller's bearer token, never
   from the request body.
2. The user approves (Plaid Link widget / AA redirect). **This is the missing
   step for Plaid** — see the note at the top.
3. `POST /api/bank/transactions` fetches and normalises transactions to
   `{ date, amount, direction, description }` — the same shape `parseStatement()`
   produces — and reports what it left out as
   `{ skipped: { unusable, foreign } }`.
4. The client runs `reconcile()` and shows the same preview as file import,
   naming anything the sync dropped.

### What a sync will not import

- **A row in another currency.** Nothing converts: the books are kept in
  `VITE_CURRENCY` (default `INR`), and a Plaid row whose `iso_currency_code`
  says otherwise is left out and counted rather than booked at face value — a
  $42 charge filed as ₹42 is wrong by a factor of ninety and looks like a fact.
  Set `BANK_CURRENCY` if the account's currency differs from the one the app
  displays. A row that states no currency is accepted (AA payloads carry none).
- **A row with no usable date or amount**, matching what file import drops.
- **A row already in your books.** Applying a sync skips anything matching an
  existing entry on asset, date, amount and category, and says how many —
  necessary because the endpoint asks the provider for the whole history every
  time, so a second sync would otherwise re-add everything.

The serverless handlers in `api/bank/*.js` are a scaffold: the request shapes
follow each provider's docs, but exact fields (consent templates, product
config) depend on your account. With no credentials set they return **501**, and
the UI shows "live connection isn't set up" and keeps file import available.
