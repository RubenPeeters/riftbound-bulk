import { asPerson } from "@/lib/db";

// Must not be prerendered: the Docker build runs with no database reachable, so a static
// render would bake "not connected" into the page for the life of the image.
export const dynamic = "force-dynamic";

/**
 * Counts read as the owner would see them are not available to the app, by design: this
 * page asks Postgres directly with no identity asserted, so the numbers it shows are the
 * ones an anonymous visitor is allowed to see. They should be zero. That is the point.
 */
async function anonymousVisibility() {
  return asPerson(null, async (db) => {
    const { rows } = await db.query<{ printings: string; people: string }>(
      "select (select count(*) from printing) as printings, (select count(*) from person) as people",
    );
    return rows[0];
  });
}

export default async function Home() {
  let visible: { printings: string; people: string } | null = null;
  let error: string | null = null;
  try {
    visible = await anonymousVisibility();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">riftbound-db</h1>
      <p className="mt-2 text-neutral-400">
        Who owns which Riftbound cards, and who is holding whose.
      </p>

      <section className="mt-10 rounded-lg border border-neutral-800 p-5">
        <h2 className="text-sm font-medium text-neutral-300">Database</h2>
        {error ? (
          <p className="mt-2 font-mono text-sm text-red-400">not connected: {error}</p>
        ) : (
          <>
            <p className="mt-2 text-sm text-neutral-400">
              Connected. Visible to an anonymous caller:{" "}
              <span className="font-mono text-neutral-100">{visible?.printings}</span> printings,{" "}
              <span className="font-mono text-neutral-100">{visible?.people}</span> people.
            </p>
            <p className="mt-2 text-sm text-neutral-500">
              Both should be zero: row-level security denies everything until an approved
              member is asserted. Sign-in is not built yet.
            </p>
          </>
        )}
      </section>
    </main>
  );
}
