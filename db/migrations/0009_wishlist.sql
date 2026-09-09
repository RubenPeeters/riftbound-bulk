-- Wanted quantities, per card, chosen deliberately.
--
-- A blanket rule ("I want a playset of everything") is the wrong shape: it would insist
-- you are short three copies of a signed card you own exactly one of and are perfectly
-- happy with. So a target exists only where someone sets one, and the wishlist is what
-- falls out of the targets they set.
--
-- Targets are per card rather than per printing, matching how decks and the decklist
-- check already work: a want is "three Void Gate", not "three of the OGN printing". If
-- wanting a specific art turns out to matter, that is a printing_id column later, not a
-- different design.

create table wish (
    person_id  uuid not null references person (id),
    card_id    text not null references card (id),
    desired    int  not null check (desired > 0),
    note       text,
    updated_at timestamptz not null default now(),
    primary key (person_id, card_id)
);

-- What each person still needs. Owned counts cards that are lent out too: they are yours,
-- you are just not holding them, and you do not need to buy another.
create view wishlist as
select w.person_id,
       w.card_id,
       w.desired,
       coalesce(h.qty, 0)::int                          as owned,
       greatest(0, w.desired - coalesce(h.qty, 0))::int as missing,
       w.note
  from wish w
  left join (
       select h.owner_id, p.card_id, sum(h.quantity) as qty
         from holding h
         join printing p on p.id = h.printing_id
        group by h.owner_id, p.card_id
  ) h on h.owner_id = w.person_id and h.card_id = w.card_id;

-- Views run as their owner unless told otherwise, which is how 0006 came about. Set it
-- here rather than discover it again.
alter view wishlist set (security_invoker = true);

alter table wish enable row level security;

-- Wishlists are visible to the group, like collections and decks. Someone knowing you
-- want two more of a card is what lets them offer the spares they are sitting on.
create policy member_read on wish for select using (is_member());
create policy owner_write on wish for all
    using (person_id = me()) with check (person_id = me());

grant select on wish, wishlist to app_user;
grant insert, update, delete on wish to app_user;
