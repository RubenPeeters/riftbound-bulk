-- Saved decks.
--
-- Slots reference `card`, not `printing`: a decklist names a card and does not care which
-- set it came from, which is the same reason the decklist check resolves to oracle ids.
-- Which physical copy fills a slot is a question for the collection, not the deck.
--
-- main and sideboard are separate counts on one row rather than two rows with a section
-- column, because the same card commonly appears in both and asking "how many of this
-- does the deck want" should not need a sum over sections.
--
-- A deck is not a claim on cards. Saving a deck you cannot build yet is the point: it is
-- how you record what you are working towards, so nothing here touches the ledger.

create table deck (
    id          uuid primary key default gen_random_uuid(),
    owner_id    uuid not null references person (id),
    name        text not null,
    notes       text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index on deck (owner_id);

create table deck_slot (
    deck_id    uuid not null references deck (id) on delete cascade,
    card_id    text not null references card (id),
    main       int not null default 0 check (main >= 0),
    sideboard  int not null default 0 check (sideboard >= 0),
    primary key (deck_id, card_id),
    constraint slot_not_empty check (main > 0 or sideboard > 0)
);

alter table deck      enable row level security;
alter table deck_slot enable row level security;

-- Decks are visible to the whole group, which is what makes "share a deck" work without
-- any sharing mechanism. Only the owner can change one.
create policy member_read on deck for select using (is_member());
create policy owner_write on deck for insert with check (owner_id = me());
create policy owner_update on deck for update using (owner_id = me());
create policy owner_delete on deck for delete using (owner_id = me());

create policy member_read on deck_slot for select using (is_member());
create policy owner_write on deck_slot for all
    using (exists (select 1 from deck d where d.id = deck_id and d.owner_id = me()))
    with check (exists (select 1 from deck d where d.id = deck_id and d.owner_id = me()));

grant select on deck, deck_slot to app_user;
grant insert, update, delete on deck, deck_slot to app_user;
