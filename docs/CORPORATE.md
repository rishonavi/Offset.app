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

**Done and verified** — the company's costs inside the report, 18 more
assertions:

- **Reports** grows a *What the company cost* section once a company has stock
  or staff — nothing on a personal install, nothing in the consolidated view
- stock as a period statement, not a snapshot: opening, received, used up and
  on hand. Movements are dated, so both ends are real figures
- payroll month by month over the filter's range, with the statutory total and
  the cost to company, and the same numbers in the year-end PDF
- **the projection is labelled as one.** Offset holds today's employees and
  today's salaries and no record of past runs, so a past month is what this
  payroll *would have* cost. The months are clamped to the ones the company
  existed for and has actually reached, and the card says when it clamped them —
  a table of wages for a company that did not exist yet looks like a record

**Done and verified** — the Supabase schema and row-level security,
`supabase/corporate.sql`, 50 assertions against a real PostgreSQL:

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

**Next**, in order:

1. Departments on entry forms; budgets and reports per cost centre
2. The approvals queue
3. A record of payroll runs, so a past month is history rather than a
   projection from today's salaries
4. The client storage layer talking to those tables — `storage/corporate.js` is
   still browser-only under both backends, and is synchronous throughout, so
   this is an async refactor of `EntityContext` and `Companies.jsx` rather than
   a swap of one backend for another
5. SSO (Google Workspace / SAML) *(unverifiable here)*

Billing for the corporate tier is deliberately not built yet.
