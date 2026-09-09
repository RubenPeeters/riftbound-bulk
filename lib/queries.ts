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
              coalesce(h.anyone, 0)::int as "groupQuantity"
       ${base}
        order by p.expansion_code, p.collector_number, p.collector_code
        limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
      params,
    );

    return { rows, total: Number(counted.rows[0]?.total ?? 0) };
  });
}

/** Distinct values for the filter controls, taken from what the caller can actually see. */
export async function filterOptions(discordId: string | null) {
  return asUser(discordId, async (db) => {
    const sets = await db.query<{ code: string; name: string; n: string }>(
      `select e.code, e.name, count(*) as n
         from expansion e join printing p on p.expansion_code = e.code
        group by e.code, e.name order by e.code`,
    );
    const domains = await db.query<{ v: string }>(
      `select distinct unnest(domains) as v from card order by v`,
    );
    const rarities = await db.query<{ v: string }>(
      `select distinct rarity as v from printing where rarity is not null order by v`,
    );
    const types = await db.query<{ v: string }>(
      `select distinct type as v from card where type is not null order by v`,
    );
    return {
      sets: sets.rows,
      domains: domains.rows.map((r) => r.v),
      rarities: rarities.rows.map((r) => r.v),
      types: types.rows.map((r) => r.v),
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
      `with candidate as (
             select c.id as card_id, lower(c.name) as key from card c
             union all
             select c.id, lower(t || ', ' || c.name)
               from card c, unnest(c.tags) t
              where c.type = 'legend'
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
              pe.display_name as "displayName",
              sum(h.quantity)::int as quantity
         from holding h
         join person pe on pe.id = h.owner_id
        where h.printing_id = any($1::text[])
          and h.finish = $2
          and h.owner_id = h.holder_id
        group by h.printing_id, pe.display_name
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

export interface DeckSummary {
  id: string;
  name: string;
  notes: string | null;
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
       select d.id, d.name, d.notes,
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
        group by d.id, d.name, d.notes, pe.display_name, d.owner_id, d.updated_at
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
      `select d.id, d.name, d.notes, pe.display_name as "ownerName",
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
