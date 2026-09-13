# Offset for companies

Personal Offset has one set of books owned by one person. The corporate version
has several **legal entities** under one login, people with **roles** inside
them, costs tagged to **departments**, spending that needs **approval**, and an
**audit trail** of who did what — plus the four operational ledgers a company
runs on: stock, what's owed, advances, and payroll.

This document describes the model. It is being built in slices; what is done
and what is next is at the bottom.

## The model

### Entities

An entity is the thing that files its own return. Each has its own books, its
own GSTIN and its own financial-year start (April by default; a foreign
subsidiary may differ).

`__all__` is the **consolidated view** — every entity added together. It is not
an entity, and it is deliberately **read-only**: you cannot book a cost against
a group. Entities reporting in a different currency are listed on their own
lines and **named as excluded** from the total rather than converted at an
invented rate. An incomplete total you can see the edges of beats a wrong one.

### Roles

Four, because that is what a finance function actually has.

| Role | Can |
|---|---|
| **Owner** | Everything, including the entity itself and its members |
| **Finance** | Books, budgets, approvals; not members or the entity |
| **Member** | Logs spending against their own department; cannot approve |
| **Auditor** | Sees and exports everything, changes nothing |

Permissions are named (`entry.create`, `approve`, `audit.view`…) rather than
role checks scattered through the app, so the rules can't drift apart.

Two rules worth stating: **an approved entry can only be corrected by finance
or an owner** — an approved cost is a record, not a draft — and **an entity
always keeps at least one owner**, so it can never be locked out.

### Departments / cost centres

Departments nest. A cost lands on one, and a divisional report rolls up
everything beneath it. Each carries a short code (what appears in exports) and
an optional monthly budget.

### Approvals

The rule a company actually states: *anything over ₹X needs sign-off, and these
categories always do.* A threshold of zero means everything needs it, which is
strict but legitimate.

**Nobody approves their own entry, however senior.** That is the entire point
of an approval, so it is enforced in the model rather than in the UI.

Pending spend is reported separately from approved spend: it is committed money
that has not cleared a control.

## The operational ledgers

### Inventory

Valued at **weighted average cost** — what Indian companies overwhelmingly use
and what Ind AS 2 permits. A receipt moves the average; an issue consumes at it
and leaves it alone. Movements are applied oldest-first regardless of the order
they were entered.

Negative stock (issuing more than the system holds) is **flagged, not hidden** —
the books and the shelf disagree and someone needs to know. Stock value never
goes below zero.

### Due payments

Not "₹4,00,000 outstanding" but "₹40,000 of it is 90 days late and it's all with
one vendor" — the ageing ladder (not yet due / 1–30 / 31–60 / 61–90 / 90+), by
vendor, worst first. Bills with no due date can't be aged, so they get their own
line rather than being dropped or counted as current.

The same machinery runs receivables, because "who owes us" is the same question
pointed the other way.

### Advances

An advance is **not an expense** — it is an asset until it is used up. Booking
it as a cost double-counts it when the invoice lands, which is the most common
way small books go wrong. So it is recorded once, adjusted against bills as they
arrive, and what remains is a balance to chase. An adjustment can never take
out more than is left; over-adjustment (only reachable through bad data) is
surfaced, not clamped away.

### Payroll

Indian statutory shape, all rates configurable:

- **PF** 12% of basic, capped at ₹15,000 basic by default (switchable to actual)
- **ESI** 0.75% employee / 3.25% employer, only below the ₹21,000 gross ceiling
- **Professional tax** by slab on **gross** (Maharashtra by default; ₹300 in February)
- **TDS is not computed.** It depends on declared investments and projected
  annual income — guessing it is worse than asking for it.

Loss of pay pro-rates every component. Take-home never goes negative; a
deduction larger than the pay is flagged as the data error it is. Employer cost
(gross + employer PF + employer ESI) is reported alongside, because what someone
costs is not what they are paid.

## Status

**Done and verified** — the model, 257 assertions:

- entities, consolidation and the read-only group view
- roles, the permission matrix, edit rules, owner protection
- departments, nesting, roll-up
- approval policy and who may sign off
- audit events
- inventory valuation, due-payment ageing, advances, payroll

**Done and verified** — storage and the switcher, 106 more assertions:

- companies created, edited and archived (never deleted — that would orphan
  the books); the creator becomes the owner automatically
- the company switcher in the sidebar, and the consolidated option once there
  is more than one company
- members with roles, departments with nesting, the approval policy, and the
  audit log on screen
- **the whole layer stays dormant until the first company exists**: a personal
  install shows no Companies nav, no switcher, and writes no `pl_corp_*` keys

**Done and verified** — stock, advances and payroll on screen, 64 more
assertions:

- one page at `/operations`, three tabs, appearing in the sidebar and the
  command palette only once a company exists, and scoped to one company at a
  time — the consolidated view says so rather than showing a mixture
- stock: items, movements at a running average cost, and the reorder list
- advances: outstanding and overdue, set against a bill, and the refusal when
  that would take out more than is left
- payroll: payslips with PF, ESI and professional tax, and what to deposit
- an employee advance recovered in a payroll run — matched by name, shown
  before it is applied, off unless asked for, and writing the adjustment that
  actually closes the advance
- **a backup now carries all of it.** `exportCorporate()` had been written and
  never called, so until now a backup held only the personal books and
  restoring one onto a new browser lost every company in it. The restore merges
  by id, so the same file twice adds nothing and a movement still points at its
  item.

**Done and verified** — the company's own figures inside the report, 28 more
assertions:

- **Reports** grows a *What the company cost, and what it is owed* section once
  a company has stock, staff or advances — nothing on a personal install,
  nothing in the consolidated view
- stock as a period statement, not a snapshot: opening, received, used up and
  on hand. Movements are dated, so both ends are real figures
- payroll month by month over the filter's range, with the statutory total and
  the cost to company, and the same numbers in the year-end PDF
- advances as opening, paid out, recovered and still owed — the four tie
  together by construction — aged on the same ladder as unpaid bills, with what
  is past its expected-back date said in words. **An advance is never added into
  a cost total**, because booking it as spending is the single most common way
  small books go wrong: it is money the company is owed until a bill arrives
- **the projection is labelled as one.** Offset holds today's employees and
  today's salaries and no record of past runs, so a past month is what this
  payroll *would have* cost. The months are clamped to the ones the company
  existed for and has actually reached, and the card says when it clamped them —
  a table of wages for a company that did not exist yet looks like a record

**Done and verified** — personal books and company books as two tabs, 20 more
assertions:

- the side bar's top control is now **Personal | Company**, with the
  which-company dropdown appearing under it only when there is more than one
- `PERSONAL` is a third active-id sentinel alongside `CONSOLIDATED`. The rule
  that matters: `can` is about a company and answers **no** in personal books,
  while `canWrite` is about the ledger in front of you and keeps answering
  **yes** — getting that backwards would turn the whole app read-only the
  moment someone looked at their own books, so it is asserted directly
- Operations, Companies and the report's company card all follow the tab
- the choice persists across reloads and writes nothing corporate

**Done and verified** — one login, two sets of books, 15 more assertions:

- **the ledger is scoped by which books you are in.** Assets, expenses, income,
  bills, invoices, documents — a row carries the company it belongs to, and a
  row with none belongs to you. What you add in a company is invisible in your
  own books and the other way round.
- **the migration is no migration.** Everything written before companies existed
  has no entity_id, so it is all personal — which is what it already was. Nobody
  logs in to find their flat has become company property.
- a personal install never reaches the filter: with no company every row is
  unstamped and the whole thing is a no-op on the app most people run
- `EntityProvider` moved above `DataProvider`, because the ledger now has to ask
  which books it is in. It only ever needed auth, so it could

### What is per books, and what is not

Every store in the app had to be put on one side of this line, so the decision
is written down rather than re-argued each time something new is added.

**Per books** — it is a fact about a ledger, or about who is issuing something:

| | Why |
|---|---|
| assets, expenses, income, documents, comments | the ledger itself; a row carries its company |
| bills, reports, exports, the dashboard, nav counts | all read those rows, so they follow for free |
| the bin | deleted rows keep their company; without this a company's entries sat in your personal bin |
| invoice issuer, numbering series, habits | an invoice says who it is *from*; a company's GSTIN on a personal invoice is the wrong entity on a tax document |
| drafts | a half-typed company expense restoring into a personal form is the same leak in miniature |
| remembered searches | searches run over the rows you can see |

**Not per books** — it is a fact about you, your account, or this browser:

| | Why |
|---|---|
| theme, accent, tone, avatar, language | how the app looks to you, not whose books you are in |
| plan, scan count | billing is per account |
| problem reports you filed | yours, not a ledger's |
| invoice templates | a template is a page layout; wanting the same one on both sides is reasonable |
| the Personal page | it is the personal side by definition |

The rule itself lives in exactly one function — `inEntity` in `EntityContext` —
which both `DataProvider` and the bin filter with, so they cannot drift apart
about what "personal" means. It had drifted once already: it returned *every*
row in personal books rather than only the unstamped ones, which was harmless
while nothing called it and wrong the moment something did.

**Done and verified** — the Supabase schema and row-level security,
`supabase/corporate.sql`, 57 assertions against a real PostgreSQL:

- every table, and the file applying cleanly twice over
- the permission matrix as policies, mirroring `PERMISSIONS` role by role
- both invariants as triggers rather than UI rules: an entity keeps at least
  one owner, and nobody approves their own entry
- an approved entry is editable only by someone who may edit anyone's
- the audit log has no update or delete policy at all
- an entity can be archived but not deleted
- a personal install, which has no entity, behaves exactly as before

This was going to ship `[unverified]`. It did not need to: PostgreSQL runs
anywhere, and running it is what found the two policies that were wrong. See
`tests/README.md`. What remains unverified is only the Supabase-specific
surface — `auth.uid()` and friends are stood in for by the runner.

**Done and verified** — a cost that belongs to nothing the company owns, 29
logic assertions, 36 on screen and 8 against PostgreSQL:

Every expense in this app required an asset. That is right for the books it
grew out of — a landlord's costs are all against a flat, and an entry pointing
at nothing there is a mistake — and wrong for a builder, whose spend is on
towers being sold by the flat and whose overheads sit against nothing at all.
The app's answer was to refuse the form, and the answer to the refusal was an
invented asset. Four of this repo's own test fixtures carry one called
"Company Depot", which is the app telling you it is wrong.

- **Personal books are unchanged.** They still insist, and the constraint is
  still `not null` in `schema.sql`; `corporate.sql` drops it, so an install that
  never became a company keeps the tighter rule it has always had.
- `lib/place.js` holds the whole rule: asset, else site, else nothing. An asset
  id that will not resolve falls through to the site rather than showing
  nothing, and "not booked" and "cannot be found" stay different answers —
  the dashboard used to call both of them *Unknown*.
- The column over that answer is headed **Property** in personal books and
  **Booked to** in a company's, because a site under a column headed "Property"
  is a category error.
- Nothing is pre-picked in a company. Defaulting to whichever asset sorts first
  is how a site's cement ends up on the head office every time somebody does
  not notice the field.
- The entry forms, the quick-add, the bank-statement importer and the list
  pages no longer refuse to open until an asset exists.
- Restore used to drop any entry it could not match to an asset, silently. It
  could not tell "booked to nothing" from "booked to something missing"; a
  builder restoring a backup would have lost every overhead in it. It now
  carries the unbooked through, and carries `project_id` so a restored cost
  still knows its job.

One thing this found in the test harness itself: `tests/sql/run.mjs` applied the
schema on top of whatever was already in the scratch database, so deleting the
migration that makes a column nullable left it nullable from yesterday with
every assertion still green. It empties the database first now.

**Next**, in order:

1. Departments on entry forms; budgets and reports per cost centre
2. ~~The approvals queue~~ — built; four documents share one queue
3. A record of payroll runs, so a past month is history rather than a
   projection from today's salaries
4. The client storage layer talking to those tables — `storage/corporate.js` is
   still browser-only under both backends, and is synchronous throughout, so
   this is an async refactor of `EntityContext` and `Companies.jsx` rather than
   a swap of one backend for another. `lib/storage/corporateSync.js` and
   `lib/sync.js` are the half of it that exists: reconciliation is tested
   against a stub and the schema against a real PostgreSQL, but the two have
   never met a live Supabase, so column names could still disagree on first
   contact
5. SSO (Google Workspace / SAML) *(unverifiable here)*

Billing for the corporate tier is deliberately not built yet.
