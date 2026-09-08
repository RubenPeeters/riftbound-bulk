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
}

export interface CardFilters {
  set?: string;
  domain?: string;
  rarity?: string;
  type?: string;
  q?: string;
  page?: number;
}

export const PAGE_SIZE = 60;

/**
 * One page of printings. Returns nothing at all for a caller who is not an approved
 * member: the policies deny, so there is no separate permission check here.
 */
export async function listPrintings(
  discordId: string | null,
  f: CardFilters,
): Promise<{ rows: CardRow[]; total: number }> {
  const page = Math.max(1, f.page ?? 1);
  return asUser(discordId, async (db) => {
    const where = `
      where ($1::text is null or p.expansion_code = $1)
        and ($2::text is null or $2 = any(c.domains))
        and ($3::text is null or p.rarity = $3)
        and ($4::text is null or c.type = $4)
        and ($5::text is null or c.name ilike '%' || $5 || '%')`;
    const params = [f.set ?? null, f.domain ?? null, f.rarity ?? null, f.type ?? null, f.q ?? null];

    const counted = await db.query<{ total: string }>(
      `select count(*) as total from printing p join card c on c.id = p.card_id ${where}`,
      params,
    );

    const { rows } = await db.query<CardRow>(
      `select p.id            as "printingId",
              p.printed_code  as "printedCode",
              p.expansion_code as "set",
              c.name, c.type,
              c.super_types   as "superTypes",
              c.domains,
              p.rarity, c.energy, c.might,
              p.image_url     as "imageUrl"
         from printing p join card c on c.id = p.card_id
         ${where}
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
