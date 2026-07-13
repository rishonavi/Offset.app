# Live bank connection (optional)

Offset can pull transactions **directly from a bank**, so payments reconcile
without exporting a statement. This is off by default — the app works fully with
**file import** (Import → Bank & UPI statement). Turn it on only when you have a
provider set up.

The connected transactions flow into the **same reconciliation** used for file
import: debits match your unpaid expenses, credits match pending income.

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

## How it works

1. `POST /api/bank/link` starts a connection — a Plaid **Link token** or an AA
   **consent URL**.
2. The user approves (Plaid Link widget / AA redirect).
3. `POST /api/bank/transactions` fetches and normalises transactions to
   `{ date, amount, direction, description }`.
4. The client runs `reconcile()` and shows the same preview as file import.

The serverless handlers in `api/bank/*.js` are a scaffold: the request shapes
follow each provider's docs, but exact fields (consent templates, product
config) depend on your account. With no credentials set they return **501**, and
the UI shows "live connection isn't set up" and keeps file import available.
