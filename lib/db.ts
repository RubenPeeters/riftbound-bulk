import { Pool, type PoolClient } from "pg";

/**
 * The application connects as `app_user`, which is subject to row-level security.
 * The card loader uses different credentials (the owner role) and bypasses RLS.
 */
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Run queries as a given person.
 *
 * EVERY query against a domain table must go through this. Postgres has no auth.uid()
 * here: identity is asserted by the application, per transaction, and the policies read
 * it back via current_person(). See docs/design.md §3.
 *
 * Two details carry the safety:
 *
 * 1. `set_config(..., is_local => true)` is the parameterised form of `SET LOCAL`. It is
 *    transaction-scoped, so Postgres discards it at commit or rollback and a pooled
 *    connection cannot carry one request's identity into the next. A plain `SET` would.
 *    It is also the only form that takes a bound parameter: `set local app.person_id =
 *    $1` is not valid, and building that string by hand would be an injection point on a
 *    value that decides what the caller can see.
 *
 * 2. Passing null yields an empty setting, so current_person() is null, is_member() is
 *    false and every policy denies. Anonymous callers get an empty result, never a leak.
 */
export async function asPerson<T>(
  personId: string | null,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.person_id', $1, true)", [personId ?? ""]);
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
export const asAnonymous = <T>(fn: (client: PoolClient) => Promise<T>) => asPerson(null, fn);
