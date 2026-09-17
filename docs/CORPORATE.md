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

### Subcontracts, and retention that has a date on it

Running account bills are cumulative — each states the work done **to date**,
and what is payable is the difference from the last one. That is the single
thing the module has to get right, and it is why a bill carries one entered
quantity rather than an amount.

Retention is the part that used to be a number with nothing attached to it.
Five per cent held against defects is a liability, not a saving, and it comes
back in two pieces: half when the work is finished and half when the defect
liability period runs out a year later. So an order records when the work was
completed, how many months the liability runs, and how the release splits.
What has already been given back is still one running total, so the allocation
is decided rather than read — **a release fills the completion tranche before
the defects tranche**, because any other rule reports a company that has paid
the first half as though it still owed it.

Three states are worth telling apart, and the app does:

- **due** — the date has passed and the money has not moved.
- **waiting** — dated, not yet.
- **undated** — nobody recorded when the work finished, so nothing can ever
  make it due. This is the one that hides money for years, and it is a finding
  of its own rather than a quiet zero.

**A builder is on both sides of this.** He holds retention from the
subcontractors he engages and his client holds retention from him, and both are
the same cumulative bill with the same arithmetic. So an order carries a
`side`, the screen has a toggle, and one rule is enforced rather than trusted:
work certified to a client is revenue, and `subcontractCostsBySite` forces the
subcontract side rather than defaulting to it — a client contract that leaked
into a job's cost would book the company's own income as money it spent.

### What is actually on the shelf

Every movement in this app is a claim. A receipt says a lorry arrived, an issue
says a bag went to the slab, and the balance that falls out of them is what the
paperwork believes — consistent to the paisa and never once checked against a
godown. On an Indian site that gap is the largest silent leak there is: material
goes a few bags at a time, through issues nobody wrote down, and the books stay
perfectly consistent the whole way.

`stock_counts` is the one table in this schema whose rows somebody stood in a
store to produce. Three decisions:

- **The count is evidence; the adjustment is the consequence.** Storing only the
  correction loses which corrections were verified and which were somebody
  fixing a typo — and loses the counts that found nothing, which are what proves
  a store sound.
- **A sheet is a store and a date**, with no id of its own, the same way a muster
  roll is a site and a day.
- **`book_qty` and `avg_cost` are frozen into the row.** A count compared against
  today's balance changes its own answer every time a later lorry arrives, and a
  verification that moves is not one.

On screen: a blank row is not a zero (a zero is a material somebody looked for
and did not find), short and over are never netted, and a store holding nothing
is never called overdue — nagging a company that has never bought a bag of
cement to count an empty godown is how a warning list gets ignored.

### What was certified, against what was measured

The comparison this app could not make. A running account bill is what the
contractor *claims*; a schedule of work is what the engineer *measured*. They
were two tables with nothing between them, so a bill could certify ₹9,80,000 of
plaster against ₹8,61,000 of measured plaster and every total in the app would
still add up.

A schedule item now carries `work_order_id` — the contract that bills it, at
most one, because an item split between two contractors is a second item. With
that, `certifiedAgainstMeasured` compares the running account against quantity
measured × the rate it was priced at, which is the only honest figure available.

Two caveats are part of the feature rather than footnotes to it:

- **It only speaks where somebody linked something.** A contract naming no
  scheduled item reports `measured: null` and *says so* — not a gap of a
  hundred per cent against a measured value of nothing. The screen prints how
  many contracts it could not speak for, because a check is only as good as the
  linking behind it.
- **The link has to be honest to be useful.** A labour-only subcontract priced
  against a full-rate BOQ item compares two different things. The field is
  offered with that said on it, and left blank by default.

Ahead and behind are kept apart and never netted: a contractor who has
over-billed and one who has under-billed are two problems, and adding them
reports none.

### What a thing normally costs here

`priceList` answers the question before buying: what did this last cost, and
what is quoted now. `rates.js` answers the one after — *was that lorry in line
with the others* — which nobody asks, because asking it by hand means reading
down a column of forty receipts holding an average in your head.

The norm is the **median** of the few purchases before it, never the mean: one
emergency lorry at double rate drags a mean up far enough to make the next
three purchases look like bargains, and the mean is exactly the statistic a bad
purchase must not be allowed to move.

A purchase has to be out of line with **two** things before it is flagged — the
median of the window *and* the purchase immediately before it. That second half
was added because the first half alone was wrong: a median over five purchases
lags a steady climb, so six per cent a month compounds to fifteen per cent above
the middle of the window by the sixth month, and the check called an ordinary
market a scandal four times running. A climb is always in line with the lorry
before it. A spike is in line with neither. The lorry *after* a spike is not
flagged, which is right — by then the rate is not news.

Cheap is reported as well as dear. A per-kilo rate keyed against a tonne looks
like the buy of the year, and a check that only looks upward finds one half of
that mistake.

The same idea applies to labour, where it bites hardest and where no report has
ever looked: `labourRateSpread` finds **the same trade, the same fortnight, two
different rates across sites**. Each site is perfectly consistent with itself,
which is exactly why nothing else can see it.

### What is already promised

The ledger answers "what has this cost". The question before it is what the
company has already agreed to spend that has not reached the books yet — a work
order signed for ₹1.8 crore with ₹60 lakh certified, an accepted quotation
nobody has taken delivery of. Neither is an expense, so neither appears in any
total, and both are spent.

`commitments.js` keeps three horizons apart, and the mistake is folding them
into one figure:

- **Committed** — agreed, not yet incurred. It *will* become cost. It is not
  cash due today, and putting it in a cash figure makes a solvent company look
  bankrupt.
- **Owed now** — incurred, not settled. Bills unpaid, bills certified and not
  paid, retention past its release date.
- **Due in** — contracted to arrive. Invoices awaited, instalments fallen due,
  retention the client owes back.

Only a *running* order commits anything: an order closed at half its value is a
saving, not a debt. An order priced per unit with no value on it commits a real
amount nobody wrote down, so it is counted as a contract rather than folded in
as a zero, and the total says it is a floor.

One thing this turned up that nothing else would have: an instalment falls due
when a stage of **its own building** is finished. `salesReport` is handed the
completed stages rather than working them out, so asking it about every unit at
once with one merged list demands money on the villas because the tower reached
its eighth slab. It is computed a site at a time.

### Closing a month

Every report is a photograph of a moving thing. Somebody prints March, sends it
to the bank, and a fortnight later a bill dated the 28th of March is entered —
not dishonestly, just late — and March is now a different number from the one in
the bank's file. Nothing in the app had any idea March was ever finished.

`books_locked_through` is **one line on the entity**, not a table of month
flags. You do not close March and leave February open, and a schema that allowed
it produces a year whose parts nobody can add up. Reopening is a step backwards
and takes the months after it with it — the honest consequence, said in the
confirmation, rather than a limitation.

**The rule lives where the writes are.** A control enforced by a disabled field
is not a control: an import, a second screen and a restored backup all reach the
store directly. So the corporate store refuses in `add`, `update` and `remove`,
and the money ledger — which has its own backend and never goes through that
store — refuses in `DataContext`. Both ends of a move are checked: redating a
row out of a closed month restates that month just as surely as redating one in.

Rows with no date pass through. A work order or a material is not an entry in a
period, and refusing those would close the company rather than its books.

One bug fell out of this and it was not about dates. The store refused correctly
and **the person standing there was told nothing** — an uncaught throw from a
click handler goes to the window, not to the screen. `attempt()` in `ui.jsx` now
wraps every write that can be refused, so a refusal is a sentence.

### Tax deducted at source, on what goes out

A work order carries a `tds_percent` and the bill ladder applies it. What
nothing checked is that figure against what the law requires — and **the law
does not ask about one order, it asks about one deductee across one financial
year**.

That is the whole point of `tds.js`, and the mistake it exists to catch: a
contractor paid ₹28,000 on one order, ₹34,000 on another and ₹41,000 on a third
has crossed the ₹1,00,000 aggregate under 194C. Every order is individually fine
on its own screen. Nobody finds this without adding a name up across a year.

Three things it gets right that are easy to get wrong:

- **Crossing the annual limit is retrospective.** The payment that crosses it
  makes *everything paid that year* liable, not the excess. A module deducting
  on the excess is short by the first ninety-nine thousand.
- **194Q is the opposite.** Goods above ₹50 lakh deduct on the excess only.
  Getting these the same way round is how a return comes out wrong by crores.
- **No PAN is twenty per cent** — a penalty, not a bracket. The deductee type
  (individual/HUF at 1%, anybody else at 2%) moves the rate and never the limit.

A payment already liable under the single-payment rule is not charged again when
the year crosses. That bug printed a liable total larger than the amount paid —
a number that cannot exist — before any test was written for it.

Shortfall and excess are never netted: one contractor under-deducted and another
over-deducted are two returns to correct. Salary TDS is still absent, for the
same reason `payroll.js` refuses it.

The sample makes the ordinary mistake on purpose — the individual rate deducted
from a partnership firm, ₹96,000 short on ₹96 lakh of certified work, with three
correctly-rated individuals beside it.

### Payroll

Indian statutory shape, all rates configurable:

- **PF** 12% of basic, capped at ₹15,000 basic by default (switchable to actual)
  — only if the company says it is registered
- **ESI** 0.75% employee / 3.25% employer, only below the ₹21,000 gross ceiling
  — likewise
- **Professional tax** by slab on **gross** (Maharashtra by default; ₹300 in February)
- **TDS is not computed.** It depends on declared investments and projected
  annual income — guessing it is worse than asking for it.

Loss of pay pro-rates every component. Take-home never goes negative; a
deduction larger than the pay is flagged as the data error it is. Employer cost
(gross + employer PF + employer ESI) is reported alongside, because what someone
costs is not what they are paid.

#### Neither PF nor ESI is something every employer has

Both used to be on. `DEFAULT_PAYROLL_CONFIG` said `enabled: true` for each, no
screen passed a config, so every company had twelve per cent of basic taken off
every payslip and three and a quarter of gross on top — including a builder with
four men and no registration, who had nowhere to turn it off and no hint that
anything had been assumed on their behalf.

They are now two questions, asked separately on the payroll tab, because they
have different answers for the same company on the same day:

| | Bites at | Also |
|---|---|---|
| **PF** | 20 employees (`EPF & MP Act`) | voluntary registration below that is common |
| **ESI** | 10 employees (`ESI Act`) — 20 in a few states, hence configurable | per person, only up to the ₹21,000 gross ceiling |

`SCHEMES` holds the thresholds, `schemeStatus(id, { headcount, config })` says
whether a scheme runs and *why* in a sentence, `statutoryStatus` does both and
`resolveConfig` is what a run computes from — so a scheme cannot run because a
default said so.

Three things this gets right that a boolean would not:

- **`registered: null` is not `false`.** Nobody having said is a different
  answer from having said no, and a payslip that quietly deducts nothing because
  a question was never asked is as wrong as one that deducts because a flag
  defaulted to true. The unanswered case is a finding on the dashboard.
- **Over the threshold and not registered is not a setting.** It is a compliance
  problem, and the payroll tab and the attention list both say so out loud
  rather than treating it as a preference that has been exercised.
- **The headcount is this month's employees, not every row.** An earlier version
  counted every active employee on the reasoning that the Act applies to the
  establishment. True of the Act, false of this data: the only way the two sets
  differ here is somebody hired after the period, and counting them would put a
  company over a threshold a month before it got there.

The answers live on the company — `entities.pf_registered` and
`esi_registered`, both nullable on purpose — not in a payroll setting, because
they are facts about the company rather than about a run.

Three screens need those answers as a config, and each of them built it inline.
The report forgot: `OperationsSummary` called `payrollOverPeriods` with no
config at all, so a company that had said it was registered saw the deduction on
its payslips and a cost to company in its report that did not include the
employer's half of it — the same figure, two answers, depending on which page
you were on. `configForEntity(entity)` is now the one way to build it, and the
payroll tab, the report and the attention list all call it.

### The parts have to add up to the whole

Almost every screen shows a total and a breakdown of it, and two things go wrong
with that arrangement without either showing up as an error. The parts stop
adding to the whole — a filter added to the breakdown and not to the total, a
rounding applied twice — and every figure still looks like a figure. Or the
leftovers get absorbed: costs booked to no site, stock at the yard rather than a
store, a team in no department. The tidy thing is to leave them out of the
breakdown; the honest thing is to show them, because they are exactly the rows
nobody is looking after.

`rollups.test.mjs` asks both questions of every hierarchy at once — stock,
subcontracts, sales plans, the muster, plant, the schedule of work, payroll,
cost centres, TDS, commitments, count sheets — against the sample rather than a
fixture, with real quantities, real rates and real rounding, and **exact to the
paisa**. A tolerance would hide the drift it exists to find. A suite of
per-module tests can each be right about its own numbers while the family drifts
apart.

It also states the thing that must *not* add up: a division counts the teams
inside it, so the cost-centre column deliberately comes to more than the total,
and that is asserted so nobody "fixes" it.

Two things fell out of writing it. `byTrade[].cost` already includes overtime,
so adding the overtime column to it double-counts — and the first version of the
file did exactly that and passed, because **the sample had never produced a
single hour of overtime**: the condition picked every seventh day back and the
list of working days contains no multiple of seven. The demo's overtime column
had been flat zero since it was written, and `overtimePercent` with it.

### Somebody else's spreadsheet

Everything here can be typed in, and on a real site nothing is. The sales list
is a spreadsheet the broker sent; the salary register is whatever the last
accountant left behind. Re-keying four hundred flats is not a data-entry
problem, it is the reason an app never gets used.

`intake.js` is one importer rather than four, because the hard parts are the
same every time. Somebody else named the columns — "Carpet Area (sq.ft.)",
"CARPET", "Carpet_Area" are one column — so matching has to be loose. **And a
loose match is a guess, so it is shown before anything is written**: which of
your columns became which field, which of them were ignored, and which rows will
be skipped and why. An importer that guesses silently and writes four hundred
rows is worse than one that refuses.

Three rules follow:

- **A missing required column refuses the whole file.** Four hundred unnamed
  rows is not a partial success.
- **A skipped row is named by its line number.** "12 skipped" with no reason is
  how somebody finds out in March that the penthouse is missing. Blank rows are
  kept while reading so that line number is the line number in the *file* — the
  reader drops them by default, which would make every number after the first
  blank row a lie.
- **Ambiguity is reported, not resolved.** "Rate" and "Rate per sq ft" both look
  like the rate; matching is scored so the answer does not depend on the order a
  spreadsheet happens to be in, and a tie is said out loud.

Three targets: flats and shops, a payroll register, and a vendor's price list —
one row per material, grouped into quotations by vendor and reference, which is
what a quotation is.

A `.numbers` file is a zip package rather than a spreadsheet and nothing here
reads one, so it is detected by name and the person is told to export, rather
than shown "could not read file" about a file that is perfectly fine.

### A document, read

A spreadsheet is four hundred rows of one shape. A PDF is one document of a
shape somebody chose — a salary slip, a vendor's quotation, an allotment letter.
`intake.js` matches columns because a sheet has columns; `papers.js` matches
**labels**, because a document has a label in front of every figure and that is
the only thing all of them have in common.

The same three rules as the spreadsheet importer, and one more:

- **What was not found is said, not filled.** A slip with no PF line gives a PF
  of nothing-at-all, not nought. One of those is a fact about the slip and the
  other is a fact about the reader.
- **The document's own totals are checked, not trusted.** A slip saying Gross
  43,600 when its own lines come to 42,000 has been read wrong or written wrong,
  and either way somebody has to look. The arithmetic is done and the
  disagreement reported.
- **One document is one record**, so a letter about one flat does not produce
  four rows.
- **The kind is guessed and the guess is admitted.** Reading a quotation as a
  salary slip produces a confident set of zeroes, so an unsure guess says so.

Four things went wrong writing it, every one of them silent — a wrong figure
that reads like a right one. "Rs. 1,24,50,000" stripped character by character
keeps the full stop from "Rs." and becomes 0.1245. "TMT bars 12mm" has a 12 in
it, counted as a quantity. `12-06-2026` handed to a browser is the sixth of
December, in an app that is India-first everywhere else — and that one reached
the spreadsheet importer too, which had been swapping the two numbers on every
day of the month up to the twelfth since it was written.

And the largest: **the PDF reader joined every text item on a page with a single
space**, so a document arrived as one enormous line. Line breaks went, and with
them the gap between the earnings column and the deductions column on a payslip
— the only thing separating them. Every parser downstream works on lines, so all
of them were reading a blob. Lines are rebuilt from the items' own baselines
now.

Even rebuilt, a real reader collapses the wide gaps, so `Basic        30,000.00
      PF     1,800.00` comes back as `Basic  30,000.00 PF  1,800.00`. Splitting
on wide gaps therefore reads a slip as a third of itself; the line reader scans
for **label-then-number** instead, which does not care how wide the gaps were.

### Recorded, agreed, projected, estimated

Payroll already drew this line and it took a bug to learn why: a month that has
been *run* is a fact — the slips are frozen and a raise in June cannot change
what March paid — while a month worked out on today's salaries is a model that
moves under you. The two look identical on screen, and somebody acts on the
second believing it is the first.

The same line runs through most of this app and was drawn nowhere else. A work
order's unspent value is agreed, not spent. Depreciation is a rule, not a
payment. An instalment that has not fallen due is a forecast about a building.

`certainty.js` names the four levels and enforces one rule: **a total is only as
certain as its least certain part.** Adding a fact to a forecast and presenting
the sum as a fact is easy, because the arithmetic is right. A part whose
provenance nobody wrote down counts as projected, not recorded — defaulting to
the confident end is how a vocabulary like this becomes decoration.

The level is declared on the **report** rather than decided by the screen that
prints it, because it is a property of the arithmetic: `commitments` says its
committed figure is agreed and its owed figure recorded, `plantReport` says a
machine's cost has a straight line in it, `tdsLedger` says what the year will
require is a forecast, `salesReport` says its plan waits on a building.

### The input credit a vendor never filed for

You pay 18% on steel and 28% on cement and get it back — but only if the vendor
files. When he does not the money is gone, and there is nothing in the books to
say so: the purchase is recorded, the tax is recorded, and the credit that never
arrived leaves no row anywhere.

`gst2b.js` reads the portal's download in the browser — never stored, because it
is somebody's tax filing — and matches it against recorded purchases. Two limits
are stated on the screen rather than buried: it matches on **the supplier's name
and the tax amount**, since an expense here carries no GSTIN or invoice number,
which finds a vendor who filed nothing (the case worth money) and will not
settle an argument about one invoice; and unmatched in either direction is a
question, not a verdict — a 2B line with no purchase is either a bill nobody
entered or somebody else's invoice raised against your GSTIN.

Both bugs found writing it were in the reading, not the arithmetic, and both
made the reconciliation report everything as broken: "GSTIN of supplier" matches
the vendor pattern as well as the GSTIN one, and `&` is not a word character so
stripping the word "and" never reached it — "Shakti Steel & Alloys" and "Shakti
Steel and Alloys" were two vendors.

### The same thing recorded twice

A site engineer taps Record, the phone is on 2G in a basement lift shaft, and
nothing visible happens for four seconds. He taps again. The books now say the
gang was twice the size it was — two rows that are individually perfect and a
total nobody will question.

Half of idempotence was already handled: rows carry a client-generated id and
the push upserts on it, so a *sync* retried after a dropped connection is one
row. `idempotent.js` is the half the id cannot help with, because a second tap
makes a second id. An identical row written **seconds** ago is the same row.

Two things follow, and both matter:

- **Seconds, not days.** Two genuinely separate gangs of six masons at ₹850 on
  one site on one day happens, and a rule that refused it would have people
  entering fiction to get round the app. Fifteen seconds apart it is a tap; an
  hour apart it is two gangs.
- **It is reported, not swallowed.** The repeat comes back marked `_repeat` so a
  screen can say nothing was added twice. Silently dropping a real second entry
  is worse than the double it prevents, because nobody can see it.

A deleted row is never handed back — somebody who removed a line and entered it
again meant to — and a row with no usable timestamp is never assumed recent,
because guessing would drop a legitimate entry. The guard sits on the
collection, not on a form, so anything that writes goes through it.

### Wiring that goes nowhere

The highest-yield bug class here has not been wrong arithmetic. It has been
things connected at one end: a column the client writes that the database does
not have, a field a form fills that no report reads, a function exported and
never called. Every one looks right in the file it lives in. Three audits of
this kind produced five real bugs in two commits — including the delivery stamp
whose missing column made a guard against double-counting stock fail silently in
cloud mode.

Those audits were done by hand, on a good day. `deadwiring.test.mjs` is them on
every commit, and it is a **ratchet, not a wall**: static scanning of JavaScript
cannot be exact, so every finding that exists today is written down with the
reason it is allowed, and the suite fails on two things — a finding that is not
on the list, and a listed finding that has gone away. The second matters as much
as the first, or the list rots into a page of excuses for code that was cleaned
up years ago.

It found its own first bug on the first run: counting its own allowlist as
usage, so the scan reported nothing and passed.

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

**Done and verified** — the first screen a builder sees, 18 more logic
assertions and 11 more on screen:

The getting-started checklist told every new install that everything hangs off
an asset. That is the same sentence that produced the invented "Company Depot",
and it was still being said on the dashboard after the books underneath had
stopped requiring one.

- A company gets four different steps, ticked by the same books: add a site,
  log a cost against it, record what the client has paid, cost one of your jobs.
  The last replaces the monthly budget and does the same work — until a site has
  an estimate, Offset can say what a job has cost but not whether that is too
  much.
- An asset does not tick "add your first site", and a budget on an asset does
  not finish a company's list.
- The checklist is **dismissed per set of books**. Waving away your own says
  nothing about a company you were added to yesterday, where the list is a
  different list and none of it is done. Personal keeps the original storage
  key, so nobody who has already dismissed it sees it again.
- The sample portfolio — two flats, a car and a year of rent — is not offered
  inside a company. Loading a landlord's assets into a construction ledger is
  the invented asset again with a button on it. A company gets its own instead
  — see below.

**Done and verified** — a builder's demo books, 84 logic assertions and 27 more
on screen:

An empty app is a fair thing to show someone who has decided to use it and a
terrible thing to show someone deciding whether to. `sampleSite.js` is three
sites, eight materials moving between a yard and two site stores, three weeks
of muster, four running accounts — two of them the company's own billing to a
client — a measured schedule, plant log sheets, eight
flats and shops with a construction-linked payment plan, and a ledger booked to
the jobs.

It is chosen to show the distinctions the app exists for, because an empty
screen shows none of them: material rejected back to the vendor leaving the
job's cost, a running account stated to date rather than bill by bill, progress
weighted by value so a cheap stage finishing is not "half done", a machine idle
because the slab was not ready told apart from one that broke, a flat's agreed
price against what has actually been banked, and a finished job that went over
its costing and still made money.

The tests are the part worth reading. "It loads" is not an assertion; these
read the sample back through the same report functions the screens use, so a
demo whose stock goes negative or whose bills run backwards fails rather than
teaching the app's own warnings as the normal state of the world. Six
deliberate breaks — a site issuing more than it was sent, a bill stating less
than the one before it, every flat sold and paid up, no overheads at all, every
machine logged and never idle, the finished job under its costing — and all six
were caught.

Loading and removing it go through the same store the app writes through, so
the demo rows are stamped, versioned and audited like real ones, and removal
tombstones them rather than leaving holes. It refuses to run where there is
anything real in the books, in either direction.

One thing it turned up on the way: `Settings.jsx` called `useEntity()` below an
early return. A hook below one is a hook that sometimes does not run, and it
had been sitting there.

**Done and verified** — the columns the client actually sends, 73 logic
assertions and 19 more against PostgreSQL:

The sync layer had been tested from both ends and never in the middle. The
reconciliation rules run against a stub that accepts whatever it is handed; the
schema runs against a real PostgreSQL that nothing pushes to. Between them sat
the question neither asked, and it was described here as unverifiable without a
live Supabase. Half of that was true: auth, row-level security under a real
token and the network do need a server. The specific failure — a field the
makers produce and the schema has no column for — does not. Rows are upserted
key by key, so that is a static mismatch between two files in this repository.

`wirecheck.test.mjs` reads both `.sql` files, works out what each table has, and
compares it against what every maker produces. It found seven, each of which
would have failed on first contact, for everybody, at once:

| | |
|---|---|
| `entities` | client sent `fyStartMonth`; the column is `fy_start_month` — the one camelCase field in an otherwise snake_case row |
| `audit_events` | client sent `at`; the column is `created_at` |
| `inventory_movements` | client sent `created_by`; no such column |
| `advances` | client sends `party_type`, `purpose`, `department_id`, `expected_by`; the table said `party_kind` and had none of the rest |
| `advance_adjustments` | client sends `note`; no such column |
| `employees` | client sends `email`, `pan`, `uan`, `joined_on` and `pay` as one object; the table had a column per head of pay |
| `properties`, `expenses`, `income` | no `is_sample` — so **"Load sample data" was refused in cloud mode**, and had been |

The two spelling mistakes were fixed on the client, which is where they were
wrong: every other field on those rows is snake_case. The rest were added to the
schema, since the client shape is what the app and its tests are built on. The
`party_kind` rename is guarded, so a database that ran the earlier file
converges on the same shape as a fresh one.

The same questions are then put to PostgreSQL rather than to a regular
expression, because a parser that is subtly wrong makes every static assertion
pass. Six deliberate breaks across both halves; all six caught — including one
that was caught twice, by the maker check and by the sample rows independently.

The personal ledger has no makers to read: an expense is an object literal
typed inside a form's submit handler, and a dozen other places write one — a
quick-add, a bank statement, a spreadsheet, a Tally file, a restored backup, a
mark-paid that spreads the whole row back out. Parsing those out of the source
would be guessing at what the code does. So `columnsui.mjs` drives the real
paths in a browser and reads what they wrote, against the same parsed schema.

That one is worth a note on how it was got wrong first. It began as a single
pass over the finished state, and a deliberate break walked straight through
it: restoring a backup rebuilds each row from an explicit list of fields, so it
dropped the sample tag the step before had written, and the check cheerfully
found nothing. It accumulates every key seen at any point now, and names the
step that wrote each one.

What a live Supabase would still prove, and this cannot: `auth.uid()` under a
real token, the row-level policies as PostgREST applies them, and what happens
to a half-finished sync on a bad connection.

**Done and verified** — the day sheet, 51 logic assertions and 31 on a phone:

The muster roll and the plant log are the two ledgers somebody fills in every
working day, at the site, on a phone, with one hand free. Each line used to be
its own form submission: pick the site, pick the trade, type a headcount, type
a rate, save, and again. Five trades and three machines is eight trips through
a form for something a gate register answers in one look — so it was not being
kept, and every report built on it was empty.

`/day` is the whole day on one screen: every trade the site actually uses, with
the rate it was last paid here already filled in, every machine parked on it,
and one save. Headcounts are a pair of thumb-sized buttons rather than a number
pad. It is the one page in the app written for a phone first rather than for a
desktop layout that a phone also survives.

The rule that matters is idempotence, and it is the reason `lib/daysheet.js`
exists as a module rather than as state inside the page. A supervisor with one
bar of signal taps Save twice; a sheet that appended would treble a day's wages
and nobody would notice until the month closed. Every line carries the id of
the row it came from, so a second save updates. A line taken back to nothing
removes its row rather than leaving a zero — "0 carpenters" is not something
anybody writes on a muster, and a log sheet of zeroes would hide a day that had
no sheet at all, which the plant report reports on.

Two things the tests caught that reading would not have. The save bar pinned
itself to the bottom of the *page* rather than the screen: `animate-fade-in`
ends on a transform, and an element with a transform is the containing block
for anything `fixed` inside it, so the button sat 1,198px down. And the
deliberate break for the idempotence rule showed the wage bill going from
₹13,750 to ₹41,250 on two extra taps, which is what that assertion is worth.

**Done and verified** — a month that was run, 56 logic assertions, 30 on screen
and 12 against PostgreSQL:

Every payroll figure in this app was computed from the employees as they stand
now. That is right for this month and wrong for every month before it. Give
somebody a raise in June and March silently becomes more expensive, because
March was never a record — it was arithmetic on today's numbers wearing a date,
and an auditor asking what was paid got a different answer depending on when
they asked. The module said so about itself in a comment, which is the kind of
honesty that stops being enough once somebody relies on the number.

A run is now kept. `makePayrollRun` freezes the payslips, the totals re-derived
from those slips rather than copied, and the statutory rates it was run under —
PF ceilings and ESI thresholds move between financial years, and a run re-read
under this year's rates is not the run that happened.

The part that matters most is the smallest: each frozen slip carries the
employee's **name and code**, not just their id. A slip holding only an id stops
meaning anything the day somebody leaves and is taken off the roster, which is
exactly when a record of what they were paid becomes worth having.

Three states, and they only go one way. A draft can be run again — an LOP was
wrong, an advance was recovered twice. Approved and paid are history: the money
has been committed, and a figure that changes after that is a record of nothing.
The rules live in `canSetStatus` and `canRerun` rather than in a disabled
button, because a control enforced by a button is enforced by whoever does not
use the button.

One run to a month is the database's job, not the client's: a partial unique
index on `(entity_id, period)` where the row is not discarded. A second answer
for March is not a second run, it is a disagreement.

`payrollOverPeriods` now reports how much of a range is record and how much is
arithmetic, because a year that is half-recorded is not a year of history and a
report that mixed the two silently would be worse than one that refused.

The deliberate break for the central rule is worth quoting: with the screen
recomputing instead of reading the record, the recorded month went from
₹91,000 to ₹1,19,000 on a raise, and down to ₹35,000 when somebody left.

**Done and verified** — cost centres, 50 logic assertions and 24 on screen:

Two things were dead. `department_id` has been a column on expenses and income
since the corporate layer was written, and no form ever filled it in.
`budget_monthly` has been on a department just as long, and no screen ever
compared it to anything — you could give a cost centre a budget and the app
would never once tell you that you were over it. The same shape as the
approvals switch that changed nothing.

`DepartmentField` puts the question on both entry forms, under the same rule as
`SiteField`: a single company's books only, absent entirely when the company has
no departments. A site and a cost centre are different questions and a cost can
need both — the tower is the job the money was spent on, Construction is the
part of the company whose budget it came out of.

`lib/costcentres.js` is the report, and two rules do most of the work. A
parent's figure includes the teams inside it, because that is what a divisional
budget covers. And the company total is the sum of what each department spent
*itself*, never the sum of the rolled-up column — adding those counts every cost
once for its own team and again for each division above it, and a report whose
parts exceed the whole is one nobody trusts twice.

A monthly budget is scaled to the months asked for, so a quarter's spend is
judged against a quarter's budget rather than flagging every department in the
company. A department with no budget set reports `null` rather than zero,
because a department with no budget is not a department within budget. And what
nobody booked gets a line of its own with its share of the spend — the figure
that says whether the rest of the table is worth reading.

The payroll card in the same component was still projecting every month even
where a recorded run existed, which was a loose end from the commit before this
one. It now reads the record where there is one and counts how much of the range
is which.

Worth recording: the browser assertion on that total passed against a table
plainly showing ₹18,20,000, because it searched the whole page and the Reports
page carries an expense total of its own further down. It reads the table's own
block now, bounded so it cannot run on into the preview below it. An assertion
that cannot fail is worse than no assertion, and this one took a deliberate
break to expose.

**Done and verified** — an audit for dead wiring, and what it turned up:

A field written and never read is a feature that has never once worked, and
this codebase has produced one of those at a steady rate. So rather than build
anything new, three audits: every exported function against whether anything
calls it, every field the makers produce against whether anything reads it, and
every column in the shipped SQL against whether the client ever mentions it.

The approval policy was the worst of it, and it slipped past the wire check for
a structural reason worth writing down: a policy is **one object under its own
key**, not a row in a synced collection, so it is not in `TABLES` and the check
never looked at it. It had `alwaysCategories` where the column says
`always_categories`, and `thresholds` — the per-document limits, the whole point
of that feature — with **no column at all**. Both would have been dropped on the
way to the server, and a company's carefully set limits would have come back as
the base figure for everything. The check knows about the policy now.

Fixing the name introduced a second bug within the same commit, which the round
trip caught immediately: `approvalPolicy()` re-makes the stored object on every
read, so a maker that understood its input shape but not its own output silently
emptied the category list each time anybody looked at it. The same trap
`makeQuoteLine` fell into earlier. It accepts either spelling now.

Problem reports were being delivered to one destination out of two.
`deliverReport` was written to try the admin inbox and the operator's email and
say which took it; only the inbox half was ever called, so on every deployment
the operator was never told a report had arrived — which is the entire purpose
of that half. Worse, the caller returned early unless Supabase was configured,
so a deployment with the mail endpoint and no database delivered to nobody and
said nothing about it. The dialog now names which destination took it, and says
plainly when there is nowhere to send it.

`wasDelivered` existed and the caller reimplemented it inline. Two copies of
"did it reach anyone" is one of them going stale the first time a third
destination appears.

**Next**, in order:

1. ~~Departments on entry forms; budgets and reports per cost centre~~ — built
2. ~~The approvals queue~~ — built; four documents share one queue
3. ~~A record of payroll runs~~ — built; a month is frozen once approved
4. The client storage layer talking to those tables — `storage/corporate.js` is
   still browser-only under both backends, and is synchronous throughout, so
   this is an async refactor of `EntityContext` and `Companies.jsx` rather than
   a swap of one backend for another. `lib/storage/corporateSync.js` and
   `lib/sync.js` are the half of it that exists: reconciliation is tested
   against a stub and the schema against a real PostgreSQL. The column names
   they disagreed about have been found and fixed; what is left needs a server:
   `auth.uid()` under a live token, the policies as PostgREST applies them, and
   a half-finished sync on a bad connection
5. SSO (Google Workspace / SAML) *(unverifiable here)*

Billing for the corporate tier is deliberately not built yet.
