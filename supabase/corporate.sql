-- ════════════════════════════════════════════════════════════════
--  Offset — the corporate layer (entities, control, ledgers)
--
--  Run this AFTER schema.sql. It is ADDITIVE: it creates its own tables and
--  adds nullable columns to expenses/income. A personal install that never
--  creates an entity is unaffected — every added column stays null and every
--  policy below is scoped to entity membership, of which there is none.
--
--  Safe to re-run.
--
--  ⚠️ This touches row-level security. Test on a branch first if you can.
-- ════════════════════════════════════════════════════════════════

-- ── Entities ─────────────────────────────────────────────────────
-- The thing that files its own return: its own books, its own GSTIN, its own
-- financial-year start (April here; a foreign subsidiary may differ).
create table if not exists public.entities (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  registration    text,
  gstin           text,
  currency        text not null default 'INR',
  fy_start_month  smallint not null default 4 check (fy_start_month between 1 and 12),
  -- Archived, never deleted: deleting an entity orphans its books.
  archived_at     timestamptz,
  created_by      uuid not null references auth.users(id) on delete restrict default auth.uid(),
  created_at      timestamptz not null default now()
);

-- ── Departments / cost centres ───────────────────────────────────
create table if not exists public.departments (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid not null references public.entities(id) on delete cascade,
  name            text not null,
  code            text,
  budget_monthly  numeric(14,2) not null default 0,
  -- on delete restrict, not cascade: removing a parent must not silently take
  -- its children and their budgets with it.
  parent_id       uuid references public.departments(id) on delete restrict,
  created_at      timestamptz not null default now()
);
create index if not exists departments_entity_idx on public.departments (entity_id);

-- ── Members and roles ────────────────────────────────────────────
create table if not exists public.entity_members (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references public.entities(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- Denormalised so the members list renders without reading auth.users.
  email         text,
  role          text not null default 'member'
                check (role in ('owner', 'finance', 'member', 'auditor')),
  department_id uuid references public.departments(id) on delete set null,
  created_at    timestamptz not null default now(),
  -- One row per person per entity; two roles for one person is a contradiction
  -- rather than a generalisation.
  unique (entity_id, user_id)
);
create index if not exists entity_members_entity_idx on public.entity_members (entity_id);
create index if not exists entity_members_user_idx on public.entity_members (user_id);

-- ── Approval policy ──────────────────────────────────────────────
-- One per entity: "anything over ₹X needs sign-off, and these categories always
-- do". A threshold of zero means everything does, which is strict but a
-- legitimate thing to ask for.
create table if not exists public.approval_policies (
  entity_id         uuid primary key references public.entities(id) on delete cascade,
  enabled           boolean not null default false,
  threshold         numeric(14,2) not null default 0,
  always_categories text[] not null default '{}',
  updated_at        timestamptz not null default now()
);

-- ── Audit ────────────────────────────────────────────────────────
-- Append-only by policy below: an audit trail that can be edited is not one.
create table if not exists public.audit_events (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid references public.entities(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  actor_email text,
  action      text not null,
  target_id   text,
  summary     text,
  detail      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_events_entity_idx on public.audit_events (entity_id, created_at desc);

-- ── The four operational ledgers ─────────────────────────────────
-- A site is a job: a client, a contract value, a start and an end. It is not an
-- asset the company owns — it is what the work produces — so it is its own
-- table rather than a row in properties.
create table if not exists public.projects (
  id             uuid primary key default gen_random_uuid(),
  entity_id      uuid not null references public.entities(id) on delete cascade,
  name           text not null,
  code           text,
  client         text,
  site_address   text,
  -- Deliberately two numbers. The contract is what the client agreed to pay and
  -- the estimate is what the work was costed at; margin is measured against the
  -- first and overrun against the second, and a job can be over its estimate and
  -- still make money.
  contract_value numeric(16,2) not null default 0 check (contract_value >= 0),
  estimate       numeric(16,2) not null default 0 check (estimate >= 0),
  started_on     date,
  due_on         date,
  status         text not null default 'planned'
                 check (status in ('planned', 'active', 'onHold', 'completed')),
  department_id  uuid references public.departments(id) on delete set null,
  notes          text,
  created_at     timestamptz not null default now()
);
create index if not exists projects_entity_idx on public.projects (entity_id, status);

create table if not exists public.inventory_items (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references public.entities(id) on delete cascade,
  name          text not null,
  sku           text,
  unit          text,
  -- The trade it belongs to, from the materials catalogue. Null is allowed and
  -- means uncategorised: stock kept before there were trades is still stock.
  category      text,
  brand         text,
  spec          text,
  hsn           text,
  reorder_level numeric(16,4) not null default 0,
  department_id uuid references public.departments(id) on delete set null,
  opening_qty   numeric(16,4) not null default 0,
  opening_value numeric(16,2) not null default 0,
  created_at    timestamptz not null default now()
);
-- Installs that applied an earlier version of this file get the new columns
-- rather than a table that silently disagrees with the app.
alter table public.inventory_items add column if not exists category      text;
alter table public.inventory_items add column if not exists brand         text;
alter table public.inventory_items add column if not exists spec          text;
alter table public.inventory_items add column if not exists hsn           text;
alter table public.inventory_items add column if not exists reorder_level numeric(16,4) not null default 0;
alter table public.inventory_items add column if not exists department_id uuid references public.departments(id) on delete set null;

-- Five kinds, and the three that reduce stock are three on purpose. Issued
-- material is in the building and wasted material is gone — both are costs of
-- the job. Rejected material arrived damaged or off-spec and went back to the
-- supplier: it is a credit they owe, not a cost, and a schema that can only say
-- 'issue' forces it to be recorded as one.
create table if not exists public.inventory_movements (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid not null references public.entities(id) on delete cascade,
  item_id    uuid not null references public.inventory_items(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  -- Two different questions, and folding them into one column is a mistake
  -- that looks harmless until a site issues material out of the yard:
  --   `store_id`   which shelf this moved. Null is the central store — the
  --                yard — which is what every row written before there were
  --                site stores already says, so they stay right untouched.
  --   `project_id` which job is charged. On an issue straight from the yard to
  --                a job these differ, and both are true.
  store_id    uuid references public.projects(id) on delete set null,
  -- Where it went, on a transfer. A transfer is one row and not two: recorded
  -- as a pair, one half can be entered and the other forgotten, and the
  -- company's total silently changes.
  to_store_id uuid references public.projects(id) on delete set null,
  kind       text not null,
  date       date not null,
  qty        numeric(16,4) not null,
  -- Null on an issue: an issue consumes at the running weighted average and
  -- does not carry a value of its own.
  value      numeric(16,2),
  unit_cost  numeric(16,4),
  -- Freight, loading and unloading for the whole delivery. On a lorry of sand
  -- this can be a fifth of the bill, and stock valued at the invoice rate alone
  -- understates what the material cost to have on site.
  other_cost numeric(16,2) not null default 0 check (other_cost >= 0),
  vendor     text,
  -- Why it was rejected. A rejection nobody wrote a reason for is one nobody
  -- can claim.
  reason     text,
  ref        text,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.inventory_movements add column if not exists project_id  uuid references public.projects(id) on delete set null;
alter table public.inventory_movements add column if not exists store_id    uuid references public.projects(id) on delete set null;
alter table public.inventory_movements add column if not exists to_store_id uuid references public.projects(id) on delete set null;
alter table public.inventory_movements add column if not exists unit_cost  numeric(16,4);
alter table public.inventory_movements add column if not exists other_cost numeric(16,2) not null default 0;
alter table public.inventory_movements add column if not exists vendor     text;
alter table public.inventory_movements add column if not exists reason     text;
alter table public.inventory_movements add column if not exists ref        text;
-- Named, so re-applying this file can widen it. The unnamed inline check an
-- earlier version created is dropped by its generated name.
alter table public.inventory_movements drop constraint if exists inventory_movements_kind_check;
alter table public.inventory_movements drop constraint if exists inventory_movements_kind;
alter table public.inventory_movements add constraint inventory_movements_kind
  check (kind in ('receipt', 'transfer', 'issue', 'rejected', 'wastage', 'adjustment'));
create index if not exists inventory_movements_item_idx on public.inventory_movements (item_id, date);
create index if not exists inventory_movements_project_idx on public.inventory_movements (project_id, date);
create index if not exists inventory_movements_store_idx   on public.inventory_movements (store_id, date);

-- Three quotes for the same material are how anyone knows the accepted one was
-- reasonable, so a declined quote is kept rather than deleted.
create table if not exists public.material_quotes (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references public.entities(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete set null,
  vendor      text not null,
  contact     text,
  date        date not null,
  -- A quote expires by the calendar. There is no 'expired' status because a
  -- stored flag is wrong every morning until somebody runs the job that sets it.
  valid_until date,
  status      text not null default 'draft'
              check (status in ('draft', 'sent', 'accepted', 'declined')),
  ref         text,
  notes       text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists material_quotes_entity_idx on public.material_quotes (entity_id, date desc);

create table if not exists public.material_quote_lines (
  id          uuid primary key default gen_random_uuid(),
  -- Carried on the line as well as the quote so the one row-level security
  -- policy that covers every ledger covers this too, without a join.
  entity_id   uuid not null references public.entities(id) on delete cascade,
  quote_id    uuid not null references public.material_quotes(id) on delete cascade,
  item_id     uuid references public.inventory_items(id) on delete set null,
  -- Vendors quote for things the company has never stocked. Refusing those
  -- would make a quote useless exactly when it is most useful.
  name        text not null,
  qty         numeric(16,4) not null default 0,
  rate        numeric(16,4) not null default 0,
  unit        text,
  -- Per line, because cement at 28% and sand at 5% are not the same price
  -- however similar the rate looks.
  gst_percent numeric(5,2) not null default 18,
  note        text
);
create index if not exists material_quote_lines_quote_idx on public.material_quote_lines (quote_id);
create index if not exists material_quote_lines_item_idx on public.material_quote_lines (item_id);

-- The muster roll. Deliberately not employees: site labour is "fourteen masons
-- on Tuesday", hired through a mestri and different people next week. A table
-- with a name column would be a register nobody fills in whose totals still
-- look real.
create table if not exists public.labour_muster (
  id             uuid primary key default gen_random_uuid(),
  entity_id      uuid not null references public.entities(id) on delete cascade,
  project_id     uuid references public.projects(id) on delete set null,
  date           date not null,
  trade          text not null,
  headcount      integer not null default 0 check (headcount >= 0),
  rate           numeric(14,2) not null default 0 check (rate >= 0),
  -- Kept apart from the day rate because it is the figure that quietly doubles
  -- while everyone watches the material rates.
  overtime_hours numeric(10,2) not null default 0 check (overtime_hours >= 0),
  overtime_rate  numeric(14,2) not null default 0 check (overtime_rate >= 0),
  contractor     text,
  note           text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists labour_muster_entity_idx  on public.labour_muster (entity_id, date);
create index if not exists labour_muster_project_idx on public.labour_muster (project_id, date);

create table if not exists public.work_orders (
  id                uuid primary key default gen_random_uuid(),
  entity_id         uuid not null references public.entities(id) on delete cascade,
  project_id        uuid references public.projects(id) on delete set null,
  contractor        text not null,
  scope             text,
  order_value       numeric(16,2) not null default 0 check (order_value >= 0),
  pricing           text not null default 'lumpSum' check (pricing in ('lumpSum', 'rate', 'dayWork')),
  retention_percent numeric(5,2) not null default 5 check (retention_percent between 0 and 100),
  tds_percent       numeric(5,2) not null default 1 check (tds_percent between 0 and 100),
  started_on        date,
  due_on            date,
  status            text not null default 'running' check (status in ('draft', 'running', 'held', 'closed')),
  -- Retention given back. Held separately so what is still owed is a figure
  -- rather than a memory.
  retention_released numeric(16,2) not null default 0 check (retention_released >= 0),
  ref               text,
  notes             text,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists work_orders_entity_idx on public.work_orders (entity_id, status);

-- Running account bills are CUMULATIVE. Each one states the work done to date,
-- and what is payable now is that figure less everything certified before it.
-- Storing this month's amount instead is how a job gets paid for several times
-- over, with arithmetic that still adds up.
create table if not exists public.ra_bills (
  id                 uuid primary key default gen_random_uuid(),
  entity_id          uuid not null references public.entities(id) on delete cascade,
  work_order_id      uuid not null references public.work_orders(id) on delete cascade,
  project_id         uuid references public.projects(id) on delete set null,
  number             integer not null check (number >= 1),
  date               date not null,
  -- The contractor claims; the engineer measures and certifies. Paying the
  -- claim is the mistake this trade is built on, so both are kept.
  claimed_to_date    numeric(16,2) not null default 0 check (claimed_to_date >= 0),
  certified_to_date  numeric(16,2) not null default 0 check (certified_to_date >= 0),
  advance_recovered  numeric(16,2) not null default 0 check (advance_recovered >= 0),
  material_recovered numeric(16,2) not null default 0 check (material_recovered >= 0),
  penalty            numeric(16,2) not null default 0 check (penalty >= 0),
  other_deduction    numeric(16,2) not null default 0 check (other_deduction >= 0),
  status             text not null default 'certified' check (status in ('draft', 'certified', 'paid')),
  note               text,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  -- Two bills dated the same day is ordinary; two numbered the same is not,
  -- and the number is what orders the ladder.
  unique (work_order_id, number)
);
create index if not exists ra_bills_order_idx on public.ra_bills (work_order_id, number);

-- The schedule of quantities, and what has actually been built against it. The
-- only physical measurements in the schema: everything else counts money.
create table if not exists public.work_items (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references public.entities(id) on delete cascade,
  project_id  uuid references public.projects(id) on delete set null,
  code        text,
  description text not null,
  stage       text not null default 'structure',
  unit        text,
  planned_qty numeric(16,4) not null default 0 check (planned_qty >= 0),
  -- What weights progress. Half the lines done means nothing if the other half
  -- is the expensive half, and on a construction schedule it usually is.
  rate        numeric(16,4) not null default 0 check (rate >= 0),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists work_items_project_idx on public.work_items (project_id, stage);

create table if not exists public.work_measurements (
  id           uuid primary key default gen_random_uuid(),
  entity_id    uuid not null references public.entities(id) on delete cascade,
  work_item_id uuid not null references public.work_items(id) on delete cascade,
  project_id   uuid references public.projects(id) on delete set null,
  date         date not null,
  -- May be negative: a re-measurement that found less is a correction, and
  -- forcing it positive means the only way to fix an error is to delete it.
  qty          numeric(16,4) not null,
  note         text,
  recorded_by  uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists work_measurements_item_idx on public.work_measurements (work_item_id, date);

-- Plant and equipment. Hired or owned, and the distinction changes where the
-- money comes from and nothing else: an owned machine's daily cost is its
-- depreciation and is charged to a job exactly like a hire rate. Charging a job
-- nothing for owned plant is how owning comes to look free.
create table if not exists public.plant (
  id                uuid primary key default gen_random_uuid(),
  entity_id         uuid not null references public.entities(id) on delete cascade,
  project_id        uuid references public.projects(id) on delete set null,
  name              text not null,
  kind              text not null default 'other',
  ownership         text not null default 'hired' check (ownership in ('hired', 'owned')),
  -- What a log sheet is headed with, and the only way two identical JCBs are
  -- told apart.
  registration      text,
  vendor            text,
  hire_rate         numeric(16,2) not null default 0 check (hire_rate >= 0),
  hire_basis        text not null default 'daily' check (hire_basis in ('hourly', 'daily', 'monthly', 'trip')),
  -- "Eight hours minimum" is in most hourly contracts: a machine that worked
  -- three hours bills eight, and the five hours of nothing are invisible
  -- unless somebody works them out.
  minimum_hours     numeric(10,2) not null default 0 check (minimum_hours >= 0),
  hired_from        date,
  hired_to          date,
  fuel_included     boolean not null default false,
  operator_included boolean not null default false,
  purchase_value    numeric(16,2) not null default 0 check (purchase_value >= 0),
  purchased_on      date,
  useful_life_years integer not null default 8 check (useful_life_years >= 1),
  salvage_value     numeric(16,2) not null default 0 check (salvage_value >= 0),
  status            text not null default 'active' check (status in ('active', 'idle', 'breakdown', 'returned')),
  note              text,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index if not exists plant_entity_idx on public.plant (entity_id, status);

-- The log sheet: one machine, one day. Idle and breakdown are separate columns
-- on purpose. Idle means there was no work for it — late drawings, a slab not
-- ready. Breakdown means it could not work. Different people are answerable for
-- those two, and a single "not working" figure protects both of them.
create table if not exists public.plant_logs (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid not null references public.entities(id) on delete cascade,
  plant_id        uuid not null references public.plant(id) on delete cascade,
  project_id      uuid references public.projects(id) on delete set null,
  date            date not null,
  working_hours   numeric(10,2) not null default 0 check (working_hours >= 0),
  idle_hours      numeric(10,2) not null default 0 check (idle_hours >= 0),
  breakdown_hours numeric(10,2) not null default 0 check (breakdown_hours >= 0),
  trips           integer not null default 0 check (trips >= 0),
  fuel_litres     numeric(12,2) not null default 0 check (fuel_litres >= 0),
  fuel_cost       numeric(14,2) not null default 0 check (fuel_cost >= 0),
  operator        text,
  note            text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists plant_logs_plant_idx   on public.plant_logs (plant_id, date);
create index if not exists plant_logs_project_idx on public.plant_logs (project_id, date);

-- What the company is building to sell. The rest of this schema is a cost
-- ledger; these three tables are the other side of it.
create table if not exists public.sale_units (
  id                  uuid primary key default gen_random_uuid(),
  entity_id           uuid not null references public.entities(id) on delete cascade,
  project_id          uuid references public.projects(id) on delete set null,
  name                text not null,
  kind                text not null default 'flat'
                      check (kind in ('flat', 'shop', 'office', 'villa', 'plot', 'parking', 'other')),
  tower               text,
  floor               integer,
  configuration       text,
  -- Three numbers describe the same flat in India and they are not close:
  -- carpet is what you can walk on, super built-up adds a share of the lobby
  -- and can be 30% more. A rate per square foot means nothing without saying
  -- which one it is quoted on, so the basis is stored beside them.
  carpet_area         numeric(12,2) not null default 0 check (carpet_area >= 0),
  built_up_area       numeric(12,2) not null default 0 check (built_up_area >= 0),
  super_built_up_area numeric(12,2) not null default 0 check (super_built_up_area >= 0),
  area_basis          text not null default 'carpet' check (area_basis in ('carpet', 'builtUp', 'superBuiltUp')),
  rate_per_area       numeric(14,2) not null default 0 check (rate_per_area >= 0),
  agreed_price        numeric(16,2) not null default 0 check (agreed_price >= 0),
  -- Floor rise, parking, club, deposits. Real money and not part of the unit's
  -- price, so a rate per square foot stays a rate per square foot.
  other_charges       numeric(16,2) not null default 0 check (other_charges >= 0),
  -- `available` and `held` are both unsold and are not the same thing: one can
  -- be sold tomorrow and the other cannot. A developer who counts them together
  -- believes he has stock he does not have. `cancelled` exists so a booking
  -- that fell through returns the flat to the shelf rather than being deleted.
  status              text not null default 'available'
                      check (status in ('available', 'blocked', 'held', 'booked',
                                        'agreement', 'registered', 'possession', 'cancelled')),
  note                text,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now()
);
create index if not exists sale_units_entity_idx  on public.sale_units (entity_id, status);
create index if not exists sale_units_project_idx on public.sale_units (project_id);

-- One instalment of a payment plan. A construction-linked plan — the Indian
-- standard — names a stage of the building rather than a date: "10% on
-- completion of the structure" is a fact about the structure, and it falls due
-- when the site says so rather than when somebody remembers to write a letter.
create table if not exists public.sale_plan_stages (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references public.entities(id) on delete cascade,
  unit_id     uuid not null references public.sale_units(id) on delete cascade,
  label       text not null,
  percent     numeric(6,2) not null default 0 check (percent between 0 and 100),
  -- A flat amount instead of a share, for the instalments that are one: a
  -- booking amount is usually a round number.
  amount      numeric(16,2) not null default 0 check (amount >= 0),
  work_stage  text,
  -- How far that stage must have got. 100 means finished.
  trigger_at  numeric(6,2) not null default 100 check (trigger_at between 0 and 100),
  due_on      date,
  sequence    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists sale_plan_stages_unit_idx on public.sale_plan_stages (unit_id, sequence);

create table if not exists public.sale_receipts (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid not null references public.entities(id) on delete cascade,
  unit_id    uuid not null references public.sale_units(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  date       date not null,
  amount     numeric(16,2) not null check (amount >= 0),
  mode       text not null default 'bank' check (mode in ('bank', 'cheque', 'cash', 'loan', 'upi')),
  reference  text,
  towards    text,
  note       text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists sale_receipts_unit_idx on public.sale_receipts (unit_id, date);

-- An advance is an asset until it is used up. Booking it as a cost
-- double-counts it when the invoice lands.
create table if not exists public.advances (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid not null references public.entities(id) on delete cascade,
  party      text not null,
  party_kind text not null default 'vendor' check (party_kind in ('vendor', 'employee', 'customer')),
  date       date not null,
  amount     numeric(14,2) not null check (amount > 0),
  note       text,
  created_at timestamptz not null default now()
);

create table if not exists public.advance_adjustments (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references public.entities(id) on delete cascade,
  advance_id  uuid not null references public.advances(id) on delete cascade,
  date        date not null,
  amount      numeric(14,2) not null check (amount > 0),
  against     text,
  created_at  timestamptz not null default now()
);
create index if not exists advance_adjustments_advance_idx on public.advance_adjustments (advance_id);

create table if not exists public.employees (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references public.entities(id) on delete cascade,
  name          text not null,
  code          text,
  department_id uuid references public.departments(id) on delete set null,
  basic         numeric(14,2) not null default 0,
  hra           numeric(14,2) not null default 0,
  allowances    numeric(14,2) not null default 0,
  pf_on_actual  boolean not null default false,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

-- ── Advances, employees and movements, as the client actually writes them ────
-- These three tables were written before the ledgers that fill them, and had
-- drifted: the client sends `party_type` where the column said `party_kind`,
-- and several fields it has always produced had no column at all. Rows are
-- pushed key by key, so each of these was a row the server would refuse — on
-- first contact, for everybody, at once.
--
-- Additive and re-runnable, and the rename is guarded, so a database that ran
-- the earlier version of this file converges on the same shape as a fresh one.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'advances' and column_name = 'party_kind')
     and not exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'advances' and column_name = 'party_type')
  then execute 'alter table public.advances rename column party_kind to party_type';
  end if;
end $$;
alter table public.advances add column if not exists party_type    text not null default 'vendor';
alter table public.advances add column if not exists purpose       text;
alter table public.advances add column if not exists department_id uuid references public.departments(id) on delete set null;
-- What makes an advance chaseable rather than forgotten.
alter table public.advances add column if not exists expected_by   text;
alter table public.advances add column if not exists created_by    uuid references auth.users(id) on delete set null;

alter table public.advance_adjustments add column if not exists note text;

alter table public.employees add column if not exists email     text;
alter table public.employees add column if not exists pan       text;
alter table public.employees add column if not exists uan       text;
alter table public.employees add column if not exists joined_on text;
-- One object rather than a column per head of pay. Basic, HRA, conveyance,
-- medical, special and other are a payslip's shape, not a schema's, and a
-- company that adds a seventh head should not need a migration to do it. The
-- original columns stay where they are and are simply no longer written.
alter table public.employees add column if not exists pay       jsonb not null default '{}'::jsonb;

-- Who booked the movement. Every other ledger records it and this one did not,
-- which on a stores register is the field that settles an argument.
alter table public.inventory_movements add column if not exists created_by uuid references auth.users(id) on delete set null;

-- ── Entries gain an entity, a cost centre and an approval ────────
-- Nullable throughout: a personal install has no entity and these stay null,
-- which is what keeps this file additive.
alter table public.expenses add column if not exists entity_id       uuid references public.entities(id) on delete set null;
alter table public.expenses add column if not exists department_id   uuid references public.departments(id) on delete set null;
alter table public.expenses add column if not exists created_by      uuid references auth.users(id) on delete set null default auth.uid();
alter table public.expenses add column if not exists approval_status text not null default 'none';
alter table public.expenses add column if not exists approved_by     uuid references auth.users(id) on delete set null;
alter table public.expenses add column if not exists approved_at     timestamptz;

alter table public.income   add column if not exists entity_id       uuid references public.entities(id) on delete set null;
alter table public.income   add column if not exists department_id   uuid references public.departments(id) on delete set null;
alter table public.income   add column if not exists created_by      uuid references auth.users(id) on delete set null default auth.uid();
alter table public.income   add column if not exists approval_status text not null default 'none';
alter table public.income   add column if not exists approved_by     uuid references auth.users(id) on delete set null;
alter table public.income   add column if not exists approved_at     timestamptz;

-- An asset belongs to one set of books too. Without this column the client can
-- read which books a row is in but never write it, so every asset created
-- inside a company would come back as personal on the next load.
alter table public.properties add column if not exists entity_id uuid references public.entities(id) on delete set null;

-- add column if not exists carries its check only when it creates the column,
-- so the constraint is added separately and idempotently.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expenses_approval_status_check') then
    alter table public.expenses add constraint expenses_approval_status_check
      check (approval_status in ('none', 'pending', 'approved', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'income_approval_status_check') then
    alter table public.income add constraint income_approval_status_check
      check (approval_status in ('none', 'pending', 'approved', 'rejected'));
  end if;
end $$;

create index if not exists expenses_entity_idx   on public.expenses (entity_id);
create index if not exists income_entity_idx     on public.income (entity_id);
create index if not exists properties_entity_idx on public.properties (entity_id);

-- ════════════════════════════════════════════════════════════════
--  Who may do what
-- ════════════════════════════════════════════════════════════════

-- SECURITY DEFINER so a policy on entity_members can ask about entity_members
-- without re-entering its own policy and recursing.
create or replace function public.entity_role(entity uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.entity_members
  where entity_id = entity and user_id = auth.uid()
  limit 1
$$;

-- Whether an entity has anybody in it yet, asked with definer rights.
--
-- This cannot be an inline subquery on entity_members. Row-level security
-- applies inside a policy's own subqueries, so a stranger — who by definition
-- sees none of that entity's members — reads it as empty and satisfies a
-- "nobody is here yet" test for every entity in the database. That is how the
-- founder exception turns into a way to walk into somebody else's company as
-- its owner, which is exactly what happened before this existed.
create or replace function public.entity_has_members(entity uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.entity_members where entity_id = entity)
$$;

create or replace function public.is_entity_member(entity uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.entity_members
    where entity_id = entity and user_id = auth.uid()
  )
$$;

-- The same matrix as PERMISSIONS in src/lib/corporate.js, and deliberately
-- written out per role rather than derived: two systems have to agree on it,
-- and a clever encoding here would make the disagreement harder to spot.
create or replace function public.can_in_entity(entity uuid, permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case public.entity_role(entity)
    when 'owner' then permission = any (array[
      'view','export','entry.create','entry.edit.own','entry.edit.any','entry.delete',
      'asset.manage','budget.manage','department.manage','approve','member.manage',
      'entity.manage','audit.view'])
    when 'finance' then permission = any (array[
      'view','export','entry.create','entry.edit.own','entry.edit.any','entry.delete',
      'asset.manage','budget.manage','department.manage','approve','audit.view'])
    when 'member' then permission = any (array[
      'view','export','entry.create','entry.edit.own'])
    when 'auditor' then permission = any (array[
      'view','export','audit.view'])
    else false
  end
$$;

-- ════════════════════════════════════════════════════════════════
--  Invariants the UI must not be the only thing enforcing
-- ════════════════════════════════════════════════════════════════

-- An entity always keeps at least one owner, so it can never be locked out.
create or replace function public.entity_keeps_an_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owners_left integer;
begin
  -- Only the loss of an owner can break this, so nothing else pays for it.
  if tg_op = 'UPDATE' and old.role = 'owner' and new.role = 'owner' then
    return new;
  end if;
  if old.role <> 'owner' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  -- The entity is being deleted and these rows are going with it. Postgres
  -- deletes the parent before cascading to the children, so an absent entity
  -- here means the whole thing is on its way out and there is no entity left to
  -- protect. Without this, a cascade would fail on its own last owner and the
  -- entity could not be removed at all — including by the service role.
  if not exists (select 1 from public.entities where id = old.entity_id) then
    return old;
  end if;

  select count(*) into owners_left
  from public.entity_members
  where entity_id = old.entity_id and role = 'owner' and id <> old.id;

  if owners_left = 0 then
    raise exception 'An entity must keep at least one owner.'
      using errcode = 'check_violation';
  end if;

  return case tg_op when 'DELETE' then old else new end;
end $$;

drop trigger if exists entity_keeps_an_owner on public.entity_members;
create trigger entity_keeps_an_owner
  before update or delete on public.entity_members
  for each row execute function public.entity_keeps_an_owner();

-- Nobody approves their own entry, however senior. That is the entire point of
-- an approval, so it lives here rather than in a form.
create or replace function public.no_self_approval()
returns trigger
language plpgsql
as $$
begin
  if new.approval_status = 'approved'
     and coalesce(old.approval_status, 'none') is distinct from 'approved'
     and new.approved_by is not null
     and new.approved_by = new.created_by then
    raise exception 'Nobody may approve their own entry.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists expenses_no_self_approval on public.expenses;
create trigger expenses_no_self_approval
  before update on public.expenses
  for each row execute function public.no_self_approval();

drop trigger if exists income_no_self_approval on public.income;
create trigger income_no_self_approval
  before update on public.income
  for each row execute function public.no_self_approval();


-- ── Approvals on the documents that commit money ─────────────────
-- Not everything a company records. A muster roll, a measurement and a plant
-- log sheet are observations, and putting those through a queue would be
-- bureaucracy that teaches people to click Approve without reading. These
-- commit money, so each carries who signed it and when.
alter table public.advances    add column if not exists approval_status text not null default 'none'
  check (approval_status in ('none', 'pending', 'approved', 'rejected'));
alter table public.advances    add column if not exists approved_by uuid references auth.users(id) on delete set null;
alter table public.advances    add column if not exists approved_at timestamptz;
alter table public.advances    add column if not exists created_by  uuid references auth.users(id) on delete set null;
alter table public.work_orders add column if not exists approval_status text not null default 'none'
  check (approval_status in ('none', 'pending', 'approved', 'rejected'));
alter table public.work_orders add column if not exists approved_by uuid references auth.users(id) on delete set null;
alter table public.work_orders add column if not exists approved_at timestamptz;
alter table public.ra_bills    add column if not exists approval_status text not null default 'none'
  check (approval_status in ('none', 'pending', 'approved', 'rejected'));
alter table public.ra_bills    add column if not exists approved_by uuid references auth.users(id) on delete set null;
alter table public.ra_bills    add column if not exists approved_at timestamptz;


-- ── A version to sync against ────────────────────────────────────
-- Every synced table carries `updated_at`, and a trigger maintains it rather
-- than the client. A timestamp the client sets is a timestamp the client can
-- get wrong: a phone with a slow clock would win every race it should lose, and
-- a phone with a fast one would lose every race it should win. The server's
-- clock is the only one all the devices share.
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'entities','departments','entity_members','approval_policies','audit_events',
    'projects','inventory_items','inventory_movements','material_quotes','material_quote_lines',
    'labour_muster','work_orders','ra_bills','work_items','work_measurements',
    'plant','plant_logs','sale_units','sale_plan_stages','sale_receipts',
    'advances','advance_adjustments','employees']
  loop
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
    -- An index on it, because every pull asks the same question: what has
    -- changed since I last looked.
    execute format('create index if not exists %I on public.%I (updated_at)', t || '_updated_idx', t);
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.touch_updated_at()',
      t || '_touch', t);
  end loop;
end $$;

-- A row deleted on one device has to be able to reach the others, and a row
-- that is simply gone cannot. So the synced tables tombstone rather than
-- vanish, the same way the personal ledger already does.
do $$
declare t text;
begin
  foreach t in array array[
    'projects','inventory_items','inventory_movements','material_quotes','material_quote_lines',
    'labour_muster','work_orders','ra_bills','work_items','work_measurements',
    'plant','plant_logs','sale_units','sale_plan_stages','sale_receipts',
    'advances','advance_adjustments','employees']
  loop
    execute format('alter table public.%I add column if not exists deleted_at timestamptz', t);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════
--  Row-level security
-- ════════════════════════════════════════════════════════════════

alter table public.entities            enable row level security;
alter table public.entity_members      enable row level security;
alter table public.departments         enable row level security;
alter table public.approval_policies   enable row level security;
alter table public.audit_events        enable row level security;
alter table public.projects            enable row level security;
alter table public.inventory_items     enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.advances            enable row level security;
alter table public.advance_adjustments enable row level security;
alter table public.employees           enable row level security;
alter table public.material_quotes     enable row level security;
alter table public.material_quote_lines enable row level security;
alter table public.labour_muster       enable row level security;
alter table public.work_orders         enable row level security;
alter table public.ra_bills            enable row level security;
alter table public.work_items          enable row level security;
alter table public.work_measurements   enable row level security;
alter table public.plant               enable row level security;
alter table public.plant_logs          enable row level security;
alter table public.sale_units          enable row level security;
alter table public.sale_plan_stages    enable row level security;
alter table public.sale_receipts       enable row level security;

-- Entities: members see it, owners change it. Creation is separate because at
-- the moment of insert there is no membership yet to be a member of.
drop policy if exists "members see their entities" on public.entities;
create policy "members see their entities" on public.entities
  for select using (public.is_entity_member(id));

drop policy if exists "anyone may found an entity" on public.entities;
create policy "anyone may found an entity" on public.entities
  for insert with check (created_by = auth.uid());

drop policy if exists "owners change the entity" on public.entities;
create policy "owners change the entity" on public.entities
  for update using (public.can_in_entity(id, 'entity.manage'))
  with check (public.can_in_entity(id, 'entity.manage'));

-- No delete policy at all, which is the point: an entity is archived, never
-- deleted, because deleting it orphans its books.

-- Members: everyone in an entity can see who else is, owners manage them. The
-- founder's own first row is the exception — there is no owner yet to grant it.
drop policy if exists "members see each other" on public.entity_members;
create policy "members see each other" on public.entity_members
  for select using (public.is_entity_member(entity_id));

drop policy if exists "owners add members" on public.entity_members;
create policy "owners add members" on public.entity_members
  for insert with check (
    public.can_in_entity(entity_id, 'member.manage')
    or (
      user_id = auth.uid()
      and role = 'owner'
      and not public.entity_has_members(entity_id)
    )
  );

drop policy if exists "owners change members" on public.entity_members;
create policy "owners change members" on public.entity_members
  for update using (public.can_in_entity(entity_id, 'member.manage'))
  with check (public.can_in_entity(entity_id, 'member.manage'));

drop policy if exists "owners remove members" on public.entity_members;
create policy "owners remove members" on public.entity_members
  for delete using (public.can_in_entity(entity_id, 'member.manage'));

-- Departments, budgets and the approval policy: finance and owners.
drop policy if exists "members see departments" on public.departments;
create policy "members see departments" on public.departments
  for select using (public.is_entity_member(entity_id));

drop policy if exists "finance manages departments" on public.departments;
create policy "finance manages departments" on public.departments
  for all using (public.can_in_entity(entity_id, 'department.manage'))
  with check (public.can_in_entity(entity_id, 'department.manage'));

drop policy if exists "members see the policy" on public.approval_policies;
create policy "members see the policy" on public.approval_policies
  for select using (public.is_entity_member(entity_id));

drop policy if exists "approvers set the policy" on public.approval_policies;
create policy "approvers set the policy" on public.approval_policies
  for all using (public.can_in_entity(entity_id, 'approve'))
  with check (public.can_in_entity(entity_id, 'approve'));

-- Audit: readable by those allowed to audit, written by anyone acting in the
-- entity, and never updated or deleted by anyone. A log that can be rewritten
-- is not a log, so there is deliberately no update or delete policy.
drop policy if exists "auditors read the log" on public.audit_events;
create policy "auditors read the log" on public.audit_events
  for select using (public.can_in_entity(entity_id, 'audit.view'));

drop policy if exists "members append to the log" on public.audit_events;
create policy "members append to the log" on public.audit_events
  for insert with check (public.is_entity_member(entity_id) and actor_id = auth.uid());

-- The ledgers. Everyone in the entity reads; finance and owners write.
do $$
declare t text;
begin
  foreach t in array array['projects','inventory_items','inventory_movements','advances','advance_adjustments','employees','material_quotes','material_quote_lines','labour_muster','work_orders','ra_bills','work_items','work_measurements','plant','plant_logs','sale_units','sale_plan_stages','sale_receipts']
  loop
    execute format('drop policy if exists "members read %1$s" on public.%1$I', t);
    execute format(
      'create policy "members read %1$s" on public.%1$I for select using (public.is_entity_member(entity_id))', t);
    execute format('drop policy if exists "finance writes %1$s" on public.%1$I', t);
    execute format(
      'create policy "finance writes %1$s" on public.%1$I for all '
      'using (public.can_in_entity(entity_id, ''budget.manage'')) '
      'with check (public.can_in_entity(entity_id, ''budget.manage''))', t);
  end loop;
end $$;

-- A cost belongs to a job as well as to a company. Nullable, like entity_id and
-- for the same reason: an entry booked to no site is the ordinary case, and
-- every row written before there were sites is one.
alter table public.expenses add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.income   add column if not exists project_id uuid references public.projects(id) on delete set null;
create index if not exists expenses_project_idx on public.expenses (project_id);
create index if not exists income_project_idx   on public.income (project_id);

-- ── A cost need not sit on something the company owns ────────────
-- schema.sql requires an asset on every entry, which is right for the books it
-- was written for: a landlord's expenses are all against a flat, and an entry
-- pointing at nothing there is a mistake. A builder's are not. The cement is
-- for a tower being sold by the flat, the wages are for the crew pouring it,
-- and neither is company property; the office rent and the auditor's fee are
-- against nothing at all.
--
-- So the requirement is dropped here rather than in schema.sql, and only here:
-- an install that never became a company keeps the tighter constraint it has
-- always had, and gets it back if its only entity is removed only by running
-- schema.sql again — which is the honest trade. The alternative was what the
-- app did before, which was to make people invent an asset called "Depot" and
-- then carry it in every total forever.
alter table public.expenses  alter column property_id drop not null;
alter table public.income    alter column property_id drop not null;
alter table public.documents alter column property_id drop not null;

-- ── Entries inside an entity ─────────────────────────────────────
-- schema.sql already restricts expenses/income to their owner. These add the
-- entity case alongside it: a row tagged to an entity is visible to that
-- entity's members, and writable according to their role.
drop policy if exists "entity members see entity expenses" on public.expenses;
create policy "entity members see entity expenses" on public.expenses
  for select using (entity_id is not null and public.is_entity_member(entity_id));

drop policy if exists "entity members log expenses" on public.expenses;
create policy "entity members log expenses" on public.expenses
  for insert with check (entity_id is not null and public.can_in_entity(entity_id, 'entry.create'));

-- An approved entry is a record, not a draft, so only someone who may edit
-- anyone's entry may touch it once approved.
drop policy if exists "entity members edit entity expenses" on public.expenses;
create policy "entity members edit entity expenses" on public.expenses
  for update using (
    entity_id is not null and (
      public.can_in_entity(entity_id, 'entry.edit.any')
      or (approval_status <> 'approved'
          and public.can_in_entity(entity_id, 'entry.edit.own')
          and created_by = auth.uid())
    )
  );

-- Permissive policies OR together, and schema.sql already grants a user full
-- control of any row carrying their user_id. Those two facts combine badly: the
-- author of an entity entry satisfies "own expenses" and so could edit it after
-- approval, or log one against an entity they do not belong to, whatever the
-- policies above say. A RESTRICTIVE policy is ANDed with the permissive set
-- instead of joining it, which is the only way to bind a rule that already
-- exists. Rows with no entity are untouched, so a personal install is unchanged.
drop policy if exists "entity rules bind entity expenses" on public.expenses;
create policy "entity rules bind entity expenses" on public.expenses
  as restrictive for update using (
    entity_id is null
    or public.can_in_entity(entity_id, 'entry.edit.any')
    or (approval_status <> 'approved'
        and public.can_in_entity(entity_id, 'entry.edit.own')
        and created_by = auth.uid())
  );

drop policy if exists "entity membership binds new expenses" on public.expenses;
create policy "entity membership binds new expenses" on public.expenses
  as restrictive for insert with check (
    entity_id is null or public.can_in_entity(entity_id, 'entry.create')
  );

drop policy if exists "entity rules bind deleting expenses" on public.expenses;
create policy "entity rules bind deleting expenses" on public.expenses
  as restrictive for delete using (
    entity_id is null or public.can_in_entity(entity_id, 'entry.delete')
  );

drop policy if exists "entity rules bind entity income" on public.income;
create policy "entity rules bind entity income" on public.income
  as restrictive for update using (
    entity_id is null
    or public.can_in_entity(entity_id, 'entry.edit.any')
    or (approval_status <> 'approved'
        and public.can_in_entity(entity_id, 'entry.edit.own')
        and created_by = auth.uid())
  );

drop policy if exists "entity membership binds new income" on public.income;
create policy "entity membership binds new income" on public.income
  as restrictive for insert with check (
    entity_id is null or public.can_in_entity(entity_id, 'entry.create')
  );

drop policy if exists "entity rules bind deleting income" on public.income;
create policy "entity rules bind deleting income" on public.income
  as restrictive for delete using (
    entity_id is null or public.can_in_entity(entity_id, 'entry.delete')
  );

drop policy if exists "entity members see entity income" on public.income;
create policy "entity members see entity income" on public.income
  for select using (entity_id is not null and public.is_entity_member(entity_id));

drop policy if exists "entity members log income" on public.income;
create policy "entity members log income" on public.income
  for insert with check (entity_id is not null and public.can_in_entity(entity_id, 'entry.create'));

drop policy if exists "entity members edit entity income" on public.income;
create policy "entity members edit entity income" on public.income
  for update using (
    entity_id is not null and (
      public.can_in_entity(entity_id, 'entry.edit.any')
      or (approval_status <> 'approved'
          and public.can_in_entity(entity_id, 'entry.edit.own')
          and created_by = auth.uid())
    )
  );
