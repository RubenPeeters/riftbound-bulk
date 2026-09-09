-- Derive wanted quantities from decks instead of pushing them there.
--
-- 0009 let you set a target per card, and the deck page pushed a deck's needs onto it.
-- Pushing has three problems: editing a deck leaves the wishlist stale, deleting a deck
-- leaves its demand behind, and the additive mode is not idempotent, so pressing it twice
-- quietly asks for twice as much.
--
-- Deriving fixes all three. The question the push mode was asking -- do two decks wanting
-- the same card mean three or six? -- is a fact about the decks, not about the person or
-- the card, so it belongs on the deck:
--
--   none       this deck does not feed the wishlist
--   shared     cards move between decks, so this deck's needs overlap with other shared
--              decks: take the largest, not the sum
--   dedicated  this deck keeps its own copies, so its needs add on top
--
-- Manual per-card targets are untouched and win when they are higher, which is what keeps
-- "I want exactly one signed Kai'Sa" expressible: no deck can talk you into more.

create type wishlist_mode as enum ('none', 'shared', 'dedicated');

-- Existing decks default to feeding nothing: turning this on should be a choice someone
-- makes, not a change that appears in their wishlist unannounced.
alter table deck add column wishlist_mode wishlist_mode not null default 'none';

-- What a new deck gets, so nobody answers the same question for every deck they save.
alter table person add column deck_wishlist_default wishlist_mode not null default 'shared';

drop view wishlist;

create view wishlist as
with deck_demand as (
    select d.owner_id as person_id,
           s.card_id,
           coalesce(sum(s.main + s.sideboard)
                    filter (where d.wishlist_mode = 'dedicated'), 0) as dedicated,
           coalesce(max(s.main + s.sideboard)
                    filter (where d.wishlist_mode = 'shared'), 0)    as shared
      from deck d
      join deck_slot s on s.deck_id = d.id
     where d.wishlist_mode <> 'none'
     group by d.owner_id, s.card_id
),
target as (
    select coalesce(w.person_id, dd.person_id)                 as person_id,
           coalesce(w.card_id, dd.card_id)                     as card_id,
           coalesce(w.desired, 0)                              as manual,
           coalesce(dd.dedicated, 0) + coalesce(dd.shared, 0)  as from_decks,
           w.note
      from wish w
      full outer join deck_demand dd
        on dd.person_id = w.person_id and dd.card_id = w.card_id
),
owned as (
    select h.owner_id, p.card_id, sum(h.quantity) as qty
      from holding h
      join printing p on p.id = h.printing_id
     group by h.owner_id, p.card_id
)
select t.person_id,
       t.card_id,
       greatest(t.manual, t.from_decks)::int                              as desired,
       coalesce(o.qty, 0)::int                                            as owned,
       greatest(0, greatest(t.manual, t.from_decks) - coalesce(o.qty, 0))::int as missing,
       t.note,
       t.manual::int     as manual,
       t.from_decks::int as from_decks
  from target t
  left join owned o on o.owner_id = t.person_id and o.card_id = t.card_id
 where greatest(t.manual, t.from_decks) > 0;

alter view wishlist set (security_invoker = true);
grant select on wishlist to app_user;

comment on view wishlist is
    'What each person still needs. `manual` is what they asked for by hand and `from_decks`
     what their decks imply; the target is the larger, so a deck cannot talk someone into
     more copies than they said they wanted.';
