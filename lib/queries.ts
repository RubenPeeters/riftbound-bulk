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
}

export interface CardFilters {
  set?: string;
  domain?: string;
  rarity?: string;
  type?: string;
  q?: string;
  /** "owned" and "missing" filter against the caller's own shelf. */
  show?: "all" | "owned" | "missing";
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
           select printing_id, sum(quantity) as qty
             from holding
            where owner_id = me() and holder_id = me() and finish = $6
            group by printing_id
      ) h on h.printing_id = p.id
      where ($1::text is null or p.expansion_code = $1)
        and ($2::text is null or $2 = any(c.domains))
        and ($3::text is null or p.rarity = $3)
        and ($4::text is null or c.type = $4)
        and ($5::text is null or c.name ilike '%' || $5 || '%')
        and ($7::text = 'all'
             or ($7 = 'owned'   and coalesce(h.qty, 0) > 0)
             or ($7 = 'missing' and coalesce(h.qty, 0) = 0))`;

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
              coalesce(h.qty, 0)::int as quantity
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
    const { rows } = await db.query<{ lname: string; cardId: string; owned: string }>(
      `select lower(c.name) as lname, c.id as "cardId",
              coalesce(sum(h.quantity), 0) as owned
         from card c
         left join printing p on p.card_id = c.id
         left join holding h
                on h.printing_id = p.id
               and h.owner_id = me() and h.holder_id = me()
        where lower(c.name) = any($1::text[])
        group by c.id, c.name`,
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
