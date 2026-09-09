import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";
import { viewer } from "@/lib/db";

// Never prerender: this reads the session and the database.
export const dynamic = "force-dynamic";

function SignIn() {
  return (
    <form
      action={async () => {
        "use server";
        await signIn("discord");
      }}
    >
      <button
        type="submit"
        className="rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium hover:bg-indigo-400"
      >
        Sign in with Discord
      </button>
    </form>
  );
}

function SignOut() {
  return (
    <form
      action={async () => {
        "use server";
        await signOut();
      }}
    >
      <button type="submit" className="text-sm text-neutral-400 underline hover:text-neutral-200">
        Sign out
      </button>
    </form>
  );
}

export default async function Home() {
  const session = await auth();
  const me = await viewer(session?.discordId ?? null);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold">riftbound-db</h1>
      <p className="mt-2 text-neutral-400">
        Who owns which Riftbound cards, and who is holding whose.
      </p>

      <section className="mt-10 rounded-lg border border-neutral-800 p-5">
        {!session ? (
          <>
            <h2 className="text-sm font-medium text-neutral-300">Not signed in</h2>
            <p className="mt-2 mb-4 text-sm text-neutral-500">
              Anyone can register. An admin approves before anything becomes visible.
            </p>
            <SignIn />
          </>
        ) : me?.state === "approved" ? (
          <>
            <h2 className="text-sm font-medium text-neutral-300">
              Signed in as {me.displayName}
              {me.role === "admin" ? " (admin)" : ""}
            </h2>
            <p className="mt-2 mb-4 text-sm text-neutral-400">
              Approved.
            </p>
            <div className="mb-4 flex flex-wrap gap-2">
              <Link
                href="/cards?edit=1"
                className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900"
              >
                My collection
              </Link>
              <Link
                href="/wishlist"
                className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                Wishlist
              </Link>
              <Link
                href="/people"
                className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                People
              </Link>
              <Link
                href="/loans"
                className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                Loans
              </Link>
              <Link
                href="/decks"
                className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                Decks
              </Link>
              <Link
                href="/decklist"
                className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                Decklist check
              </Link>
              <Link
                href="/cards"
                className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
              >
                Browse cards
              </Link>
              {me.role === "admin" && (
                <Link
                  href="/admin"
                  className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
                >
                  Members
                </Link>
              )}
            </div>
            <SignOut />
          </>
        ) : (
          <>
            <h2 className="text-sm font-medium text-amber-300">Waiting for approval</h2>
            <p className="mt-2 mb-4 text-sm text-neutral-400">
              Signed in as {me?.displayName ?? session.user?.name}. Your account is{" "}
              <span className="font-mono">{me?.state ?? "pending"}</span>, so nothing is visible
              yet. Ask Ruben to approve you.
            </p>
            <SignOut />
          </>
        )}
      </section>
    </main>
  );
}
