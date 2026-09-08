import { Pool, type PoolClient } from "pg";

/**
 * The application connects as `app_user`, which is subject to row-level security.
 * The card loader uses different credentials (the owner role) and bypasses RLS.
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Run queries as a given Discord user.
 *
 * EVERY query against a domain table must go through this. Postgres has no auth.uid()
 * here: identity is asserted by the application, per transaction, and the policies read
 * it back via current_discord_id(), which resolves to a person. See docs/design.md §3.
 *
 * The Discord id is asserted rather than the person id because it is what the OAuth
 * exchange verifies, and because it exists before the person row does: first login has
 * nothing else to identify itself with.
 *
 * Two details carry the safety:
 *
 * 1. `set_config(..., is_local => true)` is the parameterised form of `SET LOCAL`. It is
 *    transaction-scoped, so Postgres discards it at commit or rollback and a pooled
 *    connection cannot carry one request's identity into the next. A plain `SET` would.
 *    It is also the only form that takes a bound parameter: `set local app.person_id =
 *    $1` is not valid, and building that string by hand would be an injection point on
 *    a value that decides what the caller can see.
 *
 * 2. Passing null yields an empty setting, so current_person() is null, is_member() is
 *    false and every policy denies. Anonymous callers get an empty result, never a leak.
 */
export async function asUser<T>(
  discordId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.discord_id', $1, true)", [discordId ?? ""]);
    if (process.env.AUTH_DEBUG === "1") {
      // What Postgres actually sees on THIS connection, which is the only thing that
      // decides whether the policies pass.
      const { rows } = await client.query(
        "select current_user, current_setting('app.discord_id', true) as asserted",
      );
      console.log("[db] session:", rows[0]);
    }
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Convenience for reads by an unauthenticated caller. Returns whatever RLS allows,
 *  which for an anonymous or unapproved caller is nothing. */
export const asAnonymous = <T>(fn: (client: PoolClient) => Promise<T>) => asUser(null, fn);

/**
 * Create the caller's person row if it does not exist. Called on sign-in.
 *
 * The row is always `pending`: the register_self policy forbids setting state, role or
 * approval, so this cannot grant access to anything. An admin has to approve it.
 */
export async function ensurePerson(
  discordId: string,
  displayName: string,
  avatarUrl: string | null,
): Promise<void> {
  if (!discordId) throw new Error("ensurePerson called with no Discord id");
  try {
    await asUser(discordId, async (db) => {
      // NOT `insert ... on conflict (discord_id) do nothing`. Under this policy set that
      // form is refused outright, verified by `make doctor-bisect`: the same insert
      // succeeds without the ON CONFLICT clause and fails with it, whether sent as plain
      // SQL or through the extended protocol.
      //
      // The likely reason is that resolving a conflict requires reading the arbiter
      // index, and the SELECT policy on `person` is `id = current_person() or
      // is_member()`. During a first registration current_person() is null, because it
      // resolves through the very row being inserted, so nothing on this table is
      // visible and the speculative insertion cannot be checked.
      //
      // Reading first works for exactly the reason the conflict path does not: once the
      // row exists, current_person() resolves to it and the SELECT policy admits it.
      const existing = await db.query("select 1 from person where discord_id = $1", [
        discordId,
      ]);
      if (existing.rowCount) return;

      await db.query(
        `insert into person (discord_id, display_name, avatar_url) values ($1, $2, $3)`,
        [discordId, displayName, avatarUrl],
      );
    });
  } catch (cause) {
    // Two first logins racing: the loser's insert hits the unique index. Already
    // registered is the desired end state, so this is success.
    if (typeof cause === "object" && cause !== null && (cause as { code?: string }).code === "23505") {
      return;
    }
    // The bare Postgres message ("new row violates row-level security policy") does not
    // say which identity was asserted, which is the only thing that distinguishes a
    // wrong policy from an unset session variable.
    throw new Error(
      `could not register Discord id ${JSON.stringify(discordId)}: ` +
        (cause instanceof Error ? cause.message : String(cause)) +
        " -- compare with `make doctor-bisect`",
      { cause },
    );
  }
}

export interface Viewer {
  id: string;
  displayName: string;
  state: "pending" | "approved" | "suspended";
  role: "member" | "admin";
}

/** The caller's own row, or null if they have never signed in. */
export async function viewer(discordId: string | null): Promise<Viewer | null> {
  if (!discordId) return null;
  return asUser(discordId, async (db) => {
    const { rows } = await db.query<Viewer>(
      `select id, display_name as "displayName", state, role
         from person where discord_id = $1`,
      [discordId],
    );
    return rows[0] ?? null;
  });
}
