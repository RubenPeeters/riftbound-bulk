import { asUser } from "@/lib/db";

export interface PendingPerson {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  requestedAt: string;
  state: "pending" | "approved" | "suspended";
}

/** Everyone awaiting a decision. Visible only to approved members; admins act on it. */
export async function listPending(discordId: string | null): Promise<PendingPerson[]> {
  return asUser(discordId, async (db) => {
    const { rows } = await db.query<PendingPerson>(
      `select id, display_name as "displayName", avatar_url as "avatarUrl",
              requested_at as "requestedAt", state
         from person
        where state = 'pending'
        order by requested_at`,
    );
    return rows;
  });
}

export interface Member {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  state: "pending" | "approved" | "suspended";
  role: "member" | "admin";
}

export async function listMembers(discordId: string | null): Promise<Member[]> {
  return asUser(discordId, async (db) => {
    const { rows } = await db.query<Member>(
      `select id, display_name as "displayName", avatar_url as "avatarUrl", state, role
         from person
        where state <> 'pending'
        order by role desc, display_name`,
    );
    return rows;
  });
}

export interface CardRow {
  printingId: string;
  printedCode: string;
  set: string;
  name: string;
  type: string | null;
  superTypes: string[];
  domains: string[];
  rarity: string | null;
  energy: number | null;
  might: number | null;
  imageUrl: string | null;
  /** How many of this printing the caller owns and holds, in the selected finish. */
  quantity: number;
  /** How many are available across the group: owned and held by the same person. */
  groupQuantity: number;
  /** How many the caller has said they want, or 0 if they have not said. */
  desired: number;
}

export interface CardFilters {
  set?: string;
  domain?: string;
  rarity?: string;
  type?: string;
  q?: string;
  /**
   * "owned"/"missing" filter against your own shelf; "anyone"/"nobody" against the
   * group's, counting only cards sitting with their owner, since a card already lent out
   * is not one you can borrow.
   */
  show?: "all" | "owned" | "missing" | "anyone" | "nobody";
  finish?: string;
  page?: number;
}

export const PAGE_SIZE = 60;

/**
 * One page of printings, with how many the caller owns and holds.
 *
 * Browsing and collection entry are the same query: the only difference is whether the
 * page draws steppers. Splitting them produced two filter bars that drifted apart for no
 * reason, and left entry without the name search it needs most.
 *
 * Returns nothing at all to a caller who is not an approved member: the policies deny, so
 * there is no separate permission check. `quantity` is 0 for a signed-out caller because
 * `me()` is null, which is also correct.
 */
export async function listPrintings(
  discordId: string | null,
  f: CardFilters,
): Promise<{ rows: CardRow[]; total: number }> {
  const page = Math.max(1, f.page ?? 1);
  const finish = f.finish ?? "normal";
  const show = f.show ?? "all";

  return asUser(discordId, async (db) => {
    const base = `
      from printing p
      join card c on c.id = p.card_id
      left join wish w on w.card_id = c.id and w.person_id = me()
      left join (
           select printing_id,
                  coalesce(sum(quantity) filter (
                      where owner_id = me() and holder_id = me()), 0) as mine,
                  -- available to borrow: sitting with whoever owns it
                  coalesce(sum(quantity) filter (
                      where owner_id = holder_id), 0) as anyone
             from holding
            where finish = $6
            group by printing_id
      ) h on h.printing_id = p.id
      where ($1::text is null or p.expansion_code = $1)
        and ($2::text is null or $2 = any(c.domains))
        and ($3::text is null or p.rarity = $3)
        and ($4::text is null or c.type = $4)
        and ($5::text is null or c.name ilike '%' || $5 || '%')
        and ($7::text = 'all'
             or ($7 = 'owned'   and coalesce(h.mine, 0) > 0)
             or ($7 = 'missing' and coalesce(h.mine, 0) = 0)
             or ($7 = 'anyone'  and coalesce(h.anyone, 0) > 0)
             or ($7 = 'nobody'  and coalesce(h.anyone, 0) = 0))`;

    const params = [
      f.set ?? null, f.domain ?? null, f.rarity ?? null, f.type ?? null, f.q ?? null,
      finish, show,
    ];

    const counted = await db.query<{ total: string }>(`select count(*) as total ${base}`, params);

    const { rows } = await db.query<CardRow>(
      `select p.id             as "printingId",
              p.printed_code   as "printedCode",
              p.expansion_code as "set",
              c.name, c.type,
              c.super_types    as "superTypes",
              c.domains,
              p.rarity, c.energy, c.might,
              p.image_url      as "imageUrl",
              coalesce(h.mine, 0)::int   as quantity,
              coalesce(h.anyone, 0)::int as "groupQuantity",
              coalesce(w.desired, 0)::int as desired
       ${base}
        order by p.expansion_code, p.collector_number, p.collector_code
        limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
      params,
    );

    return { rows, total: Number(counted.rows[0]?.total ?? 0) };
  });
}

/**
 * Distinct values for the filter controls, in one round trip.
 *
 * This was four separate queries and runs on every card, collection and profile page. The
 * results are reference data and identical for every approved member, but they are not
 * cached across requests: they are reached through RLS, and a cache would have to be
 * keyed on membership to stay honest. One query is the cheap half of the win.
 */
export async function filterOptions(discordId: string | null) {
  return asUser(discordId, async (db) => {
    const { rows } = await db.query<{
      sets: { code: string; name: string; n: number }[] | null;
      domains: string[] | null;
      rarities: string[] | null;
      types: string[] | null;
    }>(
      `with s as (
             select e.code, e.name, count(*)::int as n
               from expansion e join printing p on p.expansion_code = e.code
              group by e.code, e.name
       ),
       d as (select distinct unnest(domains) as v from card),
       r as (select distinct rarity as v from printing where rarity is not null),
       t as (select distinct type   as v from card    where type   is not null)
       select
         (select json_agg(json_build_object('code', code, 'name', name, 'n', n)
                          order by code) from s) as sets,
         (select json_agg(v order by v) from d)  as domains,
         (select json_agg(v order by v) from r)  as rarities,
         (select json_agg(v order by v) from t)  as types`,
    );
    const o = rows[0];
    return {
      sets: o?.sets ?? [],
      domains: o?.domains ?? [],
      rarities: o?.rarities ?? [],
      types: o?.types ?? [],
    };
  });
}

export interface DeckDiffRow {
  name: string;
  cardId: string | null;
  wanted: number;
  owned: number;
  missing: number;
}

/**
 * Compare a parsed decklist against what the caller owns and holds.
 *
 * Ownership is summed across every printing of a card and every finish, because a deck
 * cares about the card, not which set it came from: three Void Gates are three Void
 * Gates. Cards lent out are excluded, since a deck you cannot physically build is a deck
 * you are missing cards for; that is the honest answer even though you own them.
 *
 * Unmatched names come back with cardId null rather than being dropped. Silently
 * discarding a line would understate what is missing, which is the one error this must
 * not make.
 */
export async function deckDiff(
  discordId: string | null,
  entries: { name: string; quantity: number }[],
): Promise<DeckDiffRow[]> {
  if (entries.length === 0) return [];
  const names = entries.map((e) => e.name.toLowerCase());

  const owned = await asUser(discordId, async (db) => {
    // A decklist names a card the way a person writes it, which is not always the way the
    // feed spells it. Legends are the case that matters: their card name is the epithet
    // alone ("Blind Monk"), while the champion lives in tags, so a list saying "Lee Sin,
    // Blind Monk" or "Lee Sin" matches nothing on name.
    //
    // Every alternative spelling that resolves to exactly one card is accepted. The
    // `having` clause drops any that would be ambiguous: Master Yi names two different
    // legends, so a bare "Master Yi" stays unmatched and is reported rather than guessed.
    const { rows } = await db.query<{ lname: string; cardId: string; owned: string }>(
      `with name_variant as (
             -- Four legends carry a printing suffix in their name, as
             -- "Wuju Bladesman - Starter", which no decklist writes. Two extra spellings
             -- cover it: the suffix dropped, and the dash turned into a comma, which is
             -- what the client-side normaliser does to an input line anyway.
             select c.id as card_id, c.type, c.tags, v.name
               from card c
               cross join lateral (values
                     (c.name),
                     (replace(c.name, ' - ', ', ')),
                     -- split_part rather than a regex: a backslash inside a template
                     -- literal is eaten by JavaScript before Postgres ever sees it, so
                     -- '\s' arrived as 's' and this variant silently matched nothing.
                     (split_part(c.name, ' - ', 1))
               ) as v(name)
       ),
       candidate as (
             select card_id, lower(name) as key from name_variant
             union all
             select nv.card_id, lower(t || ', ' || nv.name)
               from name_variant nv, unnest(nv.tags) t
              where nv.type = 'legend'
             union all
             select c.id, lower(t)
               from card c, unnest(c.tags) t
              where c.type = 'legend'
       ),
       resolved as (
             select key, min(card_id) as card_id
               from candidate
              group by key
             having count(distinct card_id) = 1
       )
       select r.key as lname, r.card_id as "cardId",
              coalesce(sum(h.quantity), 0) as owned
         from resolved r
         left join printing p on p.card_id = r.card_id
         left join holding h
                on h.printing_id = p.id
               and h.owner_id = me() and h.holder_id = me()
        where r.key = any($1::text[])
        group by r.key, r.card_id`,
      [names],
    );
    return new Map(rows.map((r) => [r.lname, { cardId: r.cardId, owned: Number(r.owned) }]));
  });

  return entries.map((e) => {
    const hit = owned.get(e.name.toLowerCase());
    return {
      name: e.name,
      cardId: hit?.cardId ?? null,
      wanted: e.quantity,
      owned: hit?.owned ?? 0,
      missing: Math.max(0, e.quantity - (hit?.owned ?? 0)),
    };
  });
}

/** The printing to credit when someone says "I own all of these": the earliest one. */
export async function defaultPrintings(
  discordId: string | null,
  cardIds: string[],
): Promise<Map<string, string>> {
  if (cardIds.length === 0) return new Map();
  return asUser(discordId, async (db) => {
    const { rows } = await db.query<{ cardId: string; printingId: string }>(
      `select distinct on (card_id) card_id as "cardId", id as "printingId"
         from printing
        where card_id = any($1::text[])
        order by card_id, expansion_code, collector_number, collector_code`,
      [cardIds],
    );
    return new Map(rows.map((r) => [r.cardId, r.printingId]));
  });
}

export interface Holder {
  printingId: string;
  personId: string;
  displayName: string;
  quantity: number;
}

/**
 * Who in the group has these printings, counting only cards sitting with their owner:
 * a card already lent out is not one you can borrow. This is what turns "I am missing
 * this" into "ask Bob".
 *
 * Safe to run without a me() filter only because 0006 made the holding view enforce RLS;
 * before that it would have answered a pending account too.
 */
export async function holdersOf(
  discordId: string | null,
  printingIds: string[],
  finish: string,
): Promise<Map<string, Holder[]>> {
  if (printingIds.length === 0) return new Map();
  return asUser(discordId, async (db) => {
    const { rows } = await db.query<Holder>(
      `select h.printing_id as "printingId",
              pe.id::text as "personId",
              pe.display_name as "displayName",
              sum(h.quantity)::int as quantity
         from holding h
         join person pe on pe.id = h.owner_id
        where h.printing_id = any($1::text[])
          and h.finish = $2
          and h.owner_id = h.holder_id
        group by h.printing_id, pe.id, pe.display_name
        having sum(h.quantity) > 0
        order by sum(h.quantity) desc, pe.display_name`,
      [printingIds, finish],
    );
    const map = new Map<string, Holder[]>();
    for (const r of rows) {
      const list = map.get(r.printingId) ?? [];
      list.push(r);
      map.set(r.printingId, list);
    }
    return map;
  });
}

export type WishlistMode = "none" | "shared" | "dedicated";

export interface DeckSummary {
  id: string;
  name: string;
  notes: string | null;
  wishlistMode: WishlistMode;
  ownerName: string;
  isMine: boolean;
  cards: number;
  distinct: number;
  /** Cards short of building it, against the viewer's own collection. */
  missing: number;
  updatedAt: string;
}

/**
 * Every deck in the group, with how far the viewer is from building each.
 *
 * "missing" is computed against the viewer, not the deck's owner, so someone else's deck
 * tells you what you would need to copy it. Cards lent out do not count as available,
 * on the same reasoning as the decklist check: a deck you cannot physically assemble is
 * one you are short for.
 */
export async function listDecks(discordId: string | null): Promise<DeckSummary[]> {
  return asUser(discordId, async (db) => {
    const { rows } = await db.query<DeckSummary>(
      `with mine as (
             select p.card_id, sum(h.quantity) as qty
               from holding h join printing p on p.id = h.printing_id
              where h.owner_id = me() and h.holder_id = me()
              group by p.card_id
       )
       select d.id, d.name, d.notes, d.wishlist_mode as "wishlistMode",
              pe.display_name as "ownerName",
              (d.owner_id = me()) as "isMine",
              coalesce(sum(s.main + s.sideboard), 0)::int as cards,
              count(s.card_id)::int                       as distinct,
              coalesce(sum(greatest(0,
                  s.main + s.sideboard - coalesce(m.qty, 0))), 0)::int as missing,
              d.updated_at as "updatedAt"
         from deck d
         join person pe on pe.id = d.owner_id
         left join deck_slot s on s.deck_id = d.id
         left join mine m on m.card_id = s.card_id
        group by d.id, d.name, d.notes, d.wishlist_mode, pe.display_name, d.owner_id,
                 d.updated_at
        order by (d.owner_id = me()) desc, d.updated_at desc`,
    );
    return rows;
  });
}

export interface DeckCardRow {
  cardId: string;
  name: string;
  type: string | null;
  main: number;
  sideboard: number;
  owned: number;
  imageUrl: string | null;
}

export async function deckCards(
  discordId: string | null,
  deckId: string,
): Promise<{ deck: DeckSummary | null; cards: DeckCardRow[] }> {
  return asUser(discordId, async (db) => {
    const head = await db.query<DeckSummary>(
      `select d.id, d.name, d.notes, d.wishlist_mode as "wishlistMode",
              pe.display_name as "ownerName",
              (d.owner_id = me()) as "isMine",
              0 as cards, 0 as distinct, 0 as missing, d.updated_at as "updatedAt"
         from deck d join person pe on pe.id = d.owner_id
        where d.id = $1`,
      [deckId],
    );
    if (head.rowCount === 0) return { deck: null, cards: [] };

    const { rows } = await db.query<DeckCardRow>(
      `with mine as (
             select p.card_id, sum(h.quantity) as qty
               from holding h join printing p on p.id = h.printing_id
              where h.owner_id = me() and h.holder_id = me()
              group by p.card_id
       ),
       art as (
             select distinct on (card_id) card_id, image_url
               from printing
              order by card_id, expansion_code, collector_number, collector_code
       )
       select s.card_id as "cardId", c.name, c.type,
              s.main, s.sideboard,
              coalesce(m.qty, 0)::int as owned,
              art.image_url as "imageUrl"
         from deck_slot s
         join card c on c.id = s.card_id
         left join mine m on m.card_id = s.card_id
         left join art on art.card_id = s.card_id
        where s.deck_id = $1
        order by c.type nulls last, c.name`,
      [deckId],
    );
    return { deck: head.rows[0], cards: rows };
  });
}

export interface LendableRow {
  printingId: string;
  printedCode: string;
  name: string;
  imageUrl: string | null;
  available: number;
}

/** Cards you own and are holding, so they are yours to lend. */
export async function lendable(
  discordId: string | null,
  q: string | undefined,
  finish: string,
): Promise<LendableRow[]> {
  return asUser(discordId, async (db) => {
    const { rows } = await db.query<LendableRow>(
      `select p.id as "printingId", p.printed_code as "printedCode", c.name,
              p.image_url as "imageUrl", h.quantity::int as available
         from holding h
         join printing p on p.id = h.printing_id
         join card c on c.id = p.card_id
        where h.owner_id = me() and h.holder_id = me()
          and h.finish = $2 and h.quantity > 0
          and ($1::text is null or c.name ilike '%' || $1 || '%')
        order by c.name
        limit 200`,
      [q ?? null, finish],
    );
    return rows;
  });
}

export interface LoanLine {
  transactionId: string;
  counterparty: string;
  counterpartyId: string;
  purpose: string | null;
  openedAt: string;
  dueAt: string | null;
  printingId: string;
  printedCode: string;
  name: string;
  finish: string;
  quantity: number;
}

/**
 * Open loans, from either end.
 *
 * "out" is what other people are holding for you; "in" is what you are holding for other
 * people. Both read outstanding_loan, which is the fold over the ledger, so a loan closes
 * by appending a return rather than by editing anything.
 */
export async function openLoans(
  discordId: string | null,
  direction: "out" | "in",
): Promise<LoanLine[]> {
  return asUser(discordId, async (db) => {
    const mineIs = direction === "out" ? "o.owner_id = me()" : "o.holder_id = me()";
    const other = direction === "out" ? "o.holder_id" : "o.owner_id";
    const { rows } = await db.query<LoanLine>(
      `select coalesce(t.id::text, '') as "transactionId",
              pe.display_name          as counterparty,
              ${other}::text           as "counterpartyId",
              t.purpose, t.opened_at as "openedAt", t.due_at as "dueAt",
              o.printing_id as "printingId", p.printed_code as "printedCode",
              c.name, o.finish, o.quantity
         from outstanding_loan o
         join printing p on p.id = o.printing_id
         join card c on c.id = p.card_id
         join person pe on pe.id = ${other}
         left join lateral (
              select lt.* from loan_transaction lt
               where lt.lender_id = o.owner_id and lt.borrower_id = o.holder_id
                 and lt.closed_at is null
               order by lt.opened_at desc limit 1
         ) t on true
        where ${mineIs}
        order by t.due_at nulls last, pe.display_name, c.name`,
    );
    return rows;
  });
}

export interface LoanBundle {
  transactionId: string;
  counterparty: string;
  purpose: string | null;
  openedAt: string;
  dueAt: string | null;
  state: "proposed" | "confirmed" | "disputed";
  note: string | null;
  cards: string;
  quantity: number;
}

/**
 * Loan bundles and where the borrower stands on each.
 *
 * A loan is recorded by one person and concerns two, so the borrower's position is
 * tracked separately from the fact of the loan. No acknowledgement row means unconfirmed,
 * which is displayed rather than assumed: the point is that a disagreement is visible,
 * not that the database picks a winner.
 *
 * `direction` is whose confirmation is at stake: "in" lists loans awaiting *your* word,
 * "out" lists yours awaiting theirs.
 */
export async function loanBundles(
  discordId: string | null,
  direction: "out" | "in",
): Promise<LoanBundle[]> {
  return asUser(discordId, async (db) => {
    const mineIs = direction === "out" ? "t.lender_id = me()" : "t.borrower_id = me()";
    const other = direction === "out" ? "t.borrower_id" : "t.lender_id";
    // The acknowledgement that matters is always the borrower's: the lender recorded it.
    const { rows } = await db.query<LoanBundle>(
      `select t.id::text as "transactionId",
              pe.display_name as counterparty,
              t.purpose, t.opened_at as "openedAt", t.due_at as "dueAt",
              coalesce(a.state::text, 'proposed') as state,
              a.note,
              string_agg(distinct c.name, ', ' order by c.name) as cards,
              coalesce(sum(e.quantity), 0)::int as quantity
         from loan_transaction t
         join person pe on pe.id = ${other}
         left join acknowledgement a
                on a.transaction_id = t.id and a.person_id = t.borrower_id
         left join transfer_event e on e.transaction_id = t.id and e.kind = 'lend'
         left join printing p on p.id = e.printing_id
         left join card c on c.id = p.card_id
        where ${mineIs} and t.closed_at is null
        group by t.id, pe.display_name, t.purpose, t.opened_at, t.due_at, a.state, a.note
        order by t.opened_at desc`,
    );
    return rows;
  });
}

export interface Profile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role: "member" | "admin";
  /** Everything they own, including what is currently lent out. */
  owned: number;
  /** Distinct printings they own. */
  distinct: number;
  /** Owned and in their own hands, so borrowable. */
  available: number;
  /** Of theirs, currently with someone else. */
  lentOut: number;
}

export async function memberProfile(
  discordId: string | null,
  personId: string,
): Promise<Profile | null> {
  return asUser(discordId, async (db) => {
    const { rows } = await db.query<Profile>(
      `select p.id, p.display_name as "displayName", p.avatar_url as "avatarUrl", p.role,
              coalesce((select sum(h.quantity) from holding h
                         where h.owner_id = p.id), 0)::int as owned,
              coalesce((select count(distinct h.printing_id) from holding h
                         where h.owner_id = p.id and h.quantity > 0), 0)::int as distinct,
              coalesce((select sum(h.quantity) from holding h
                         where h.owner_id = p.id and h.holder_id = p.id), 0)::int as available,
              coalesce((select sum(h.quantity) from holding h
                         where h.owner_id = p.id and h.holder_id <> p.id), 0)::int as "lentOut"
         from person p
        where p.id = $1 and p.state = 'approved'`,
      [personId],
    );
    return rows[0] ?? null;
  });
}

export interface ProfileCardRow {
  printingId: string;
  printedCode: string;
  set: string;
  name: string;
  imageUrl: string | null;
  theirs: number;
  mine: number;
}

/**
 * One person's collection, alongside what the viewer has of each.
 *
 * Finishes are summed: a profile is for looking, not for entry, and splitting foils here
 * would triple the rows for a distinction nobody is browsing by.
 *
 * The `gap` filter is the reason this page exists. "What does Bob have that I do not" is
 * the question that turns a collection into a loan.
 */
export async function personHoldings(
  discordId: string | null,
  personId: string,
  f: { q?: string; set?: string; gap?: boolean; page?: number },
): Promise<{ rows: ProfileCardRow[]; total: number }> {
  const page = Math.max(1, f.page ?? 1);
  return asUser(discordId, async (db) => {
    const base = `
      from printing p
      join card c on c.id = p.card_id
      join (select printing_id, sum(quantity) as qty from holding
             where owner_id = $1 and holder_id = $1
             group by printing_id) t on t.printing_id = p.id and t.qty > 0
      left join (select printing_id, sum(quantity) as qty from holding
                  where owner_id = me() and holder_id = me()
                  group by printing_id) m on m.printing_id = p.id
      where ($2::text is null or c.name ilike '%' || $2 || '%')
        and ($3::text is null or p.expansion_code = $3)
        and ($4::boolean is not true or coalesce(m.qty, 0) = 0)`;
    const params = [personId, f.q ?? null, f.set ?? null, f.gap ?? false];

    const counted = await db.query<{ total: string }>(`select count(*) as total ${base}`, params);
    const { rows } = await db.query<ProfileCardRow>(
      `select p.id as "printingId", p.printed_code as "printedCode",
              p.expansion_code as "set", c.name, p.image_url as "imageUrl",
              t.qty::int as theirs, coalesce(m.qty, 0)::int as mine
       ${base}
        order by c.name, p.expansion_code, p.collector_number
        limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
      params,
    );
    return { rows, total: Number(counted.rows[0]?.total ?? 0) };
  });
}

export async function deckWishlistDefault(
  discordId: string | null,
): Promise<"none" | "shared" | "dedicated"> {
  return asUser(discordId, async (db) => {
    const { rows } = await db.query<{ v: "none" | "shared" | "dedicated" }>(
      `select deck_wishlist_default as v from person where id = me()`,
    );
    return rows[0]?.v ?? "shared";
  });
}

export interface MemberSummary {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  role: "member" | "admin";
  owned: number;
  distinct: number;
  isMe: boolean;
}

export async function memberList(discordId: string | null): Promise<MemberSummary[]> {
  return asUser(discordId, async (db) => {
    const { rows } = await db.query<MemberSummary>(
      `select p.id, p.display_name as "displayName", p.avatar_url as "avatarUrl", p.role,
              coalesce(sum(h.quantity), 0)::int as owned,
              count(distinct h.printing_id) filter (where h.quantity > 0)::int as distinct,
              (p.id = me()) as "isMe"
         from person p
         left join holding h on h.owner_id = p.id
        where p.state = 'approved'
        group by p.id, p.display_name, p.avatar_url, p.role
        order by (p.id = me()) desc, p.display_name`,
    );
    return rows;
  });
}

export interface WishRow {
  cardId: string;
  name: string;
  imageUrl: string | null;
  desired: number;
  owned: number;
  missing: number;
  note: string | null;
  /** What they asked for by hand. */
  manual: number;
  /** What their decks imply. The target is the larger of the two. */
  fromDecks: number;
  /** Who in the group is holding spares, so a want becomes something you can act on. */
  spares: { personId: string; displayName: string; quantity: number }[];
}

/**
 * What someone still needs, and who could supply it.
 *
 * Only rows still short are returned: a target you have met is not a wish any more, and
 * leaving it on the list makes the list something people stop reading.
 */
export async function wishlistFor(
  discordId: string | null,
  personId: string,
): Promise<WishRow[]> {
  return asUser(discordId, async (db) => {
    const { rows } = await db.query<Omit<WishRow, "spares">>(
      `select w.card_id as "cardId", c.name, w.desired, w.owned, w.missing, w.note,
              w.manual, w.from_decks as "fromDecks",
              (select p.image_url from printing p
                where p.card_id = w.card_id
                order by p.expansion_code, p.collector_number, p.collector_code
                limit 1) as "imageUrl"
         from wishlist w join card c on c.id = w.card_id
        where w.person_id = $1 and w.missing > 0
        order by w.missing desc, c.name`,
      [personId],
    );
    if (rows.length === 0) return [];

    // Spares are counted from people other than the wisher, and only cards in their own
    // hands: something already lent out is not a spare anyone can offer.
    const { rows: spare } = await db.query<{
      cardId: string; personId: string; displayName: string; quantity: number;
    }>(
      `select p.card_id as "cardId", pe.id::text as "personId",
              pe.display_name as "displayName", sum(h.quantity)::int as quantity
         from holding h
         join printing p on p.id = h.printing_id
         join person pe on pe.id = h.owner_id
        where p.card_id = any($1::text[])
          and h.owner_id = h.holder_id
          and h.owner_id <> $2
        group by p.card_id, pe.id, pe.display_name
        having sum(h.quantity) > 0
        order by sum(h.quantity) desc`,
      [rows.map((r) => r.cardId), personId],
    );

    const byCard = new Map<string, WishRow["spares"]>();
    for (const s of spare) {
      const list = byCard.get(s.cardId) ?? [];
      list.push({ personId: s.personId, displayName: s.displayName, quantity: s.quantity });
      byCard.set(s.cardId, list);
    }
    return rows.map((r) => ({ ...r, spares: byCard.get(r.cardId) ?? [] }));
  });
}
