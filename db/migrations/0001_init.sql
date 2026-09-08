-- riftbound-db, initial schema.
--
-- Single source of truth for the data model. docs/design.md documents it; if the two
-- disagree, this file wins.
--
-- Three layers:
--   1. reference data  -- vendored from data/cards/*.json, read-only to the app
--   2. ledger          -- append-only; the only thing the app writes
--   3. views           -- current state, folded from the ledger
--
-- Nothing here is world-readable. Registration is self-serve, but a new account is
-- `pending` and sees nothing until an admin approves it.
--
-- Runs on plain Postgres. Identity is asserted per transaction by the application; see
-- section 6 for how, and for what that costs.

-- ---------------------------------------------------------------------------
-- 1. People
-- ---------------------------------------------------------------------------

create type member_state as enum ('pending', 'approved', 'suspended');
create type member_role  as enum ('member', 'admin');

-- A person is never deleted. The ledger is append-only and its events reference people
-- by id, so revoking access is a state change: history keeps naming them.
create table person (
    id            uuid primary key default gen_random_uuid(),
    -- Discord's own user id, from the OAuth profile. This is the login key.
    discord_id    text unique not null,
    display_name  text not null,
    avatar_url    text,
    state         member_state not null default 'pending',
    role          member_role  not null default 'member',
    requested_at  timestamptz not null default now(),
    approved_at   timestamptz,
    approved_by   uuid references person (id),
    -- anything past pending must have been approved at some point
    constraint approval_recorded check (state = 'pending' or approved_at is not null)
);

create index on person (state);

-- ---------------------------------------------------------------------------
-- 2. Reference data (loaded by scripts/load-cards.ts as the owner role)
-- ---------------------------------------------------------------------------

create table expansion (
    code       text primary key,              -- 'OGN'
    name       text not null,                 -- 'Origins'
    card_total int                            -- parsed from publicCode '131/219'
);

-- Oracle level: the abstract card, stable across reprints.
-- card.id is minted from the name slug; see docs/design.md 1.5 for why this is
-- imperfect and what to do when a new set breaks it.
create table card (
    id          text primary key,             -- 'abandon'
    name        text not null,
    -- a card may belong to several domains at once (e.g. mind + body)
    domains     text[] not null default '{}',
    type        text,                         -- unit | spell | gear | battlefield | legend
    super_types text[] not null default '{}', -- champion | signature | token | basic
    energy      int,
    orientation text,                         -- portrait | landscape (battlefields)
    -- Riot's policy requires official text to be displayed unmodified, so the feed's
    -- HTML is stored verbatim and never reformatted or truncated.
    rules_html  text,
    rules_hash  text not null,
    -- when true, ownership is recorded as identified copies rather than counts
    tracked     boolean not null default false
);

-- Hand-maintained escape hatch for cards the minting rule gets wrong.
create table card_alias (
    alias_id text primary key,
    card_id  text not null references card (id),
    reason   text not null
);

-- A card as printed in one set, in one language. This is the leaf of the reference
-- data: the official feed has no notion of foil, so finish is NOT here. See
-- docs/design.md 1.3a.
create table printing (
    id               text primary key,        -- feed id, 'unl-131-219'
    card_id          text not null references card (id),
    expansion_code   text not null references expansion (code),
    collector_number int not null,            -- 131
    printed_code     text,                    -- 'UNL-131/219'
    rarity           text,                    -- common|uncommon|rare|epic|showcase
    illustrator      text,
    image_url        text,
    language_code    text not null default 'en-us',
    unique (expansion_code, collector_number, language_code)
);

-- Volatile, third-party, non-authoritative. Snapshots only, never a current price.
create table price_snapshot (
    id          bigserial primary key,
    printing_id text not null references printing (id),
    finish      text not null default 'normal',
    source      text not null,                -- 'cardmarket'
    condition   text,
    currency    text not null,
    low         numeric(10, 2),
    market      numeric(10, 2),
    fetched_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Ledger
-- ---------------------------------------------------------------------------

create type transfer_kind as enum (
    'acquire', 'lend', 'return', 'give', 'trade', 'lose', 'destroy', 'stocktake'
);

create type ack_state as enum ('proposed', 'confirmed', 'disputed');

-- An identified physical card. Created only for cards flagged card.tracked.
create table copy (
    id          uuid primary key default gen_random_uuid(),
    printing_id text not null references printing (id),
    -- finish belongs to the physical object, not to the printing
    finish      text not null default 'normal',
    condition   text not null default 'NM',
    marker      text,                         -- 'signed', 'sleeve #3'
    note        text,
    created_at  timestamptz not null default now()
);

-- The bundle. You lend a deck, not forty cards: one due date, one acknowledgement.
create table loan_transaction (
    id          uuid primary key default gen_random_uuid(),
    lender_id   uuid not null references person (id),
    borrower_id uuid not null references person (id),
    purpose     text,                          -- 'regionals 2026-10'
    opened_at   timestamptz not null default now(),
    due_at      timestamptz,
    closed_at   timestamptz,
    check (lender_id <> borrower_id)
);

-- Append-only. Never updated, never deleted; a mistake is corrected by a new row
-- whose `corrects` points at the row it supersedes.
create table transfer_event (
    id             uuid primary key default gen_random_uuid(),
    kind           transfer_kind not null,
    transaction_id uuid references loan_transaction (id),

    -- fungible lot ...
    printing_id    text references printing (id),
    finish         text,
    quantity       int check (quantity > 0),
    -- ... or one identified copy
    copy_id        uuid references copy (id),

    condition      text,

    -- ownership and possession are separate axes; see docs/design.md 1.1
    owner_id       uuid references person (id),   -- whose stock moves
    from_id        uuid references person (id),   -- null = outside the group
    to_id          uuid references person (id),   -- null = outside the group

    occurred_at    timestamptz not null default now(),
    recorded_by    uuid not null references person (id),
    recorded_at    timestamptz not null default now(),
    note           text,
    corrects       uuid references transfer_event (id),

    constraint lot_xor_copy check (
        (printing_id is not null and finish is not null and quantity is not null
         and copy_id is null)
        or (copy_id is not null and printing_id is null and quantity is null)
    ),
    constraint somewhere check (from_id is not null or to_id is not null),
    constraint stocktake_has_reason check (kind <> 'stocktake' or note is not null)
);

create index on transfer_event (printing_id, finish);
create index on transfer_event (copy_id);
create index on transfer_event (transaction_id);
create index on transfer_event (owner_id);

-- Makes disagreement visible instead of silently picking a winner.
create table acknowledgement (
    event_id  uuid not null references transfer_event (id),
    person_id uuid not null references person (id),
    state     ack_state not null default 'proposed',
    note      text,
    at        timestamptz not null default now(),
    primary key (event_id, person_id)
);

-- ---------------------------------------------------------------------------
-- 4. Derived state
-- ---------------------------------------------------------------------------

-- Current fungible holdings: the fold over the ledger.
-- Keyed by BOTH owner and holder, which is what makes loan chains representable:
-- (owner=ruben, holder=carla) survives Bob lending Ruben's card onward.
create view holding as
with moves as (
    select owner_id, printing_id, finish, condition, to_id as holder_id, quantity as qty
      from transfer_event
     where to_id is not null and printing_id is not null
    union all
    select owner_id, printing_id, finish, condition, from_id as holder_id, -quantity as qty
      from transfer_event
     where from_id is not null and printing_id is not null
)
select owner_id, holder_id, printing_id, finish, condition, sum(qty) as quantity
  from moves
 group by owner_id, holder_id, printing_id, finish, condition
having sum(qty) <> 0;

-- Where each identified copy currently is: last event wins.
create view copy_location as
select distinct on (copy_id)
       copy_id, owner_id, to_id as holder_id, occurred_at as as_of
  from transfer_event
 where copy_id is not null
 order by copy_id, occurred_at desc, recorded_at desc;

-- The question the project exists to answer.
create view outstanding_loan as
select owner_id, holder_id, printing_id, finish, condition, quantity
  from holding
 where owner_id is distinct from holder_id
   and quantity > 0;

-- ---------------------------------------------------------------------------
-- 5. Allocation policy
-- ---------------------------------------------------------------------------

-- "Whose stock moves" when a lender holds physically indistinguishable copies from
-- more than one owner. See docs/design.md 1.3 for the worked example.
--
-- Policy: spend own stock first, then borrowed stock oldest loan first. "Oldest first"
-- because if two people lent you the same card, the one who has waited longer is the one
-- whose card should move on. The caller overrides by naming owner_id explicitly. This
-- function is the ONLY place the rule is expressed; no screen re-derives it.
--
-- Deterministic: the ordering is total, so the same inputs always return the same rows.
-- The caller must check that the returned quantities sum to p_quantity; a short sum
-- means the lender does not hold enough and the lend must be refused (invariant 3).
create function allocate_lend(
    p_lender    uuid,
    p_printing  text,
    p_finish    text,
    p_condition text,
    p_quantity  int
)
returns table (owner_id uuid, quantity int)
language sql
stable
as $$
    with available as (
        select h.owner_id,
               h.quantity,
               -- false (0) for own stock, true (1) for borrowed: own sorts first
               (h.owner_id is distinct from p_lender)::int as borrowed,
               -- when this stock first reached the lender, for oldest-first ordering
               coalesce((
                   select min(e.occurred_at)
                     from transfer_event e
                    where e.to_id      = p_lender
                      and e.owner_id   is not distinct from h.owner_id
                      and e.printing_id = p_printing
                      and e.finish      is not distinct from p_finish
                      and e.condition   is not distinct from p_condition
               ), 'epoch'::timestamptz) as since
          from holding h
         where h.holder_id   = p_lender
           and h.printing_id = p_printing
           and h.finish      is not distinct from p_finish
           and h.condition   is not distinct from p_condition
           and h.quantity > 0
    ),
    ranked as (
        select owner_id,
               quantity,
               sum(quantity) over (
                   -- owner_id last, so the ordering is total and the result deterministic
                   order by borrowed, since, owner_id
                   rows between unbounded preceding and current row
               ) as cumulative
          from available
    )
    select owner_id,
           least(quantity, p_quantity - (cumulative - quantity))::int
      from ranked
     -- take rows until the running total before this row covers the request
     where cumulative - quantity < p_quantity;
$$;

-- ---------------------------------------------------------------------------
-- 6. Roles and row-level security
-- ---------------------------------------------------------------------------

-- Nothing is world-readable, not even the card list. Registration is open to anyone with
-- a Discord account, but a new account is `pending` and can see exactly one thing: its
-- own row, so the app can render "waiting for approval". An admin approves it.
--
--   pending   -> sees only its own person row
--   approved  -> sees all cards, all holdings, all loans; may record events
--   suspended -> same as pending; existing ledger history is untouched
--
-- HOW IDENTITY REACHES POSTGRES. There is no auth.uid() here. The application
-- authenticates the user with Auth.js, then asserts who they are with a
-- transaction-scoped session variable before any query runs:
--
--   begin;
--   set local app.person_id = '<uuid>';
--   ... queries ...
--   commit;
--
-- `set local` is discarded at commit or rollback, which is what makes it safe behind a
-- connection pool: a pooled connection cannot carry one user's identity into the next
-- user's request. A plain `set` would, and that is the bug to watch for.
--
-- READ THIS BEFORE TRUSTING RLS HERE. Postgres is no longer verifying a signed token,
-- it is believing whatever the application tells it. RLS is defence in depth against a
-- missing WHERE clause in application code, not a cryptographic boundary. If the app
-- asserts the wrong person id, Postgres enforces the wrong identity faithfully. The
-- boundary that actually authenticates the user is Auth.js.
--
-- It does fail closed. With no variable set, current_person() is null, is_member() is
-- false and every policy denies, so a forgotten `set local` produces an empty page
-- rather than a leak.

-- BOOTSTRAP. A fresh database has no admin, so nobody can approve anybody, including
-- you. Log in once with Discord to create your own pending row, then promote it by
-- connecting as the owner role, which bypasses RLS:
--
--   update person set state = 'approved', role = 'admin', approved_at = now()
--    where discord_id = '<your discord id>';
--
-- `make promote DISCORD_ID=...` does exactly this.

-- The role the web application connects as. It must NOT own these tables, because a
-- table owner bypasses row-level security. Migrations and the card loader connect as
-- the owner, which bypasses RLS by design.
do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'app_user') then
        create role app_user login;
    end if;
end $$;

-- The person the current transaction is acting as, or null if none was asserted.
create function current_person() returns uuid
language sql stable as $$
    select nullif(current_setting('app.person_id', true), '')::uuid;
$$;

-- Is the caller an approved member?
create function is_member() returns boolean
language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from person
         where id = current_person()
           and state = 'approved'
    );
$$;

-- Is the caller an approved admin?
create function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from person
         where id = current_person()
           and state = 'approved'
           and role = 'admin'
    );
$$;

-- The caller's person.id, or null if they are not an approved member.
create function me() returns uuid
language sql stable security definer set search_path = public as $$
    select id from person
     where id = current_person()
       and state = 'approved';
$$;

alter table expansion      enable row level security;
alter table card           enable row level security;
alter table card_alias     enable row level security;
alter table printing       enable row level security;
alter table price_snapshot enable row level security;

alter table person           enable row level security;
alter table copy             enable row level security;
alter table loan_transaction enable row level security;
alter table transfer_event   enable row level security;
alter table acknowledgement  enable row level security;

-- Reference data: approved members only. Written solely by the loader, which connects
-- as the owner and bypasses RLS.
create policy member_read on expansion      for select using (is_member());
create policy member_read on card           for select using (is_member());
create policy member_read on card_alias     for select using (is_member());
create policy member_read on printing       for select using (is_member());
create policy member_read on price_snapshot for select using (is_member());

-- Members see each other. A pending or suspended account sees only itself, which is
-- what lets the app say "your request is waiting" without leaking the group.
create policy read_self_or_group on person for select
    using (id = current_person() or is_member());

-- Self-registration on first Discord login. You may create only your own row, only as a
-- pending member, and you cannot grant yourself a role or an approval.
create policy register_self on person for insert
    with check (
        id = current_person()
        and state = 'pending'
        and role  = 'member'
        and approved_at is null
        and approved_by is null
    );

-- Approving, suspending and promoting are admin actions. The with-check clause stops an
-- admin from approving someone without recording that it was them.
create policy admin_manage_members on person for update
    using (is_admin())
    with check (state = 'pending' or (approved_at is not null and approved_by = me()));

-- Everything else is approved-members-only.
create policy member_read on copy             for select using (is_member());
create policy member_read on loan_transaction for select using (is_member());
create policy member_read on transfer_event   for select using (is_member());
create policy member_read on acknowledgement  for select using (is_member());

-- You may record an event only where you are a party to it, and you cannot record it
-- as someone else.
create policy member_append on transfer_event for insert
    with check (
        recorded_by = me()
        and me() in (from_id, to_id, owner_id)
    );

create policy member_open_loan on loan_transaction for insert
    with check (me() in (lender_id, borrower_id));

create policy member_create_copy on copy for insert with check (is_member());

-- Condition changes as a card gets played. That is not a transfer, so copy is the one
-- table in the domain that is legitimately mutable. See docs/design.md 4.
create policy member_update_copy on copy for update using (is_member());

-- You confirm or dispute on your own behalf only.
create policy member_ack on acknowledgement for insert with check (person_id = me());
create policy member_ack_update on acknowledgement for update using (person_id = me());

-- No update or delete policy exists on transfer_event, so both are denied to every role
-- that goes through RLS. Corrections append a new row pointing at the old one. This is
-- the property that stops an inconvenient loan record from quietly vanishing.
--
-- Nor is there a delete policy on person: a member who leaves is suspended, never
-- removed, because the loans they are part of still name them.

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------

-- RLS restricts which rows; grants restrict which verbs. Both are needed. Without the
-- grants below app_user could read nothing; without the policies above it could read
-- everything.

grant usage on schema public to app_user;

grant select on
    expansion, card, card_alias, printing, price_snapshot,
    person, copy, loan_transaction, transfer_event, acknowledgement,
    holding, copy_location, outstanding_loan
    to app_user;

grant insert on person, copy, loan_transaction, transfer_event, acknowledgement to app_user;
grant update on person, copy, acknowledgement to app_user;

-- Deliberately never granted: update or delete on transfer_event, delete on person.
-- The ledger is append-only at the privilege level as well as the policy level, so a
-- policy mistake alone cannot make it mutable.

grant execute on function
    current_person(), is_member(), is_admin(), me(),
    allocate_lend(uuid, text, text, text, int)
    to app_user;
