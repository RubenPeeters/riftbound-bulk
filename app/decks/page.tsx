import Link from "next/link";
import { currentViewer } from "@/lib/session";
import { listDecks } from "@/lib/queries";
import NewDeck from "./new-deck";

export const dynamic = "force-dynamic";

export default async function Decks() {
  const { discordId, me } = await currentViewer();

  if (me?.state !== "approved") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Decks</h1>
        <p className="mt-3 text-neutral-400">
          {me ? "Your account is waiting for approval." : "Sign in first."}{" "}
          <Link href="/" className="underline">
            Back
          </Link>
        </p>
      </main>
    );
  }

  const decks = await listDecks(discordId);
  const mine = decks.filter((d) => d.isMine);
  const others = decks.filter((d) => !d.isMine);

  const Card = ({ d }: { d: (typeof decks)[number] }) => (
    <li className="rounded-lg border border-neutral-800 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <Link href={`/decks/${d.id}`} className="font-medium hover:underline">
          {d.name}
        </Link>
        <span
          className={
            d.missing === 0
              ? "text-xs font-medium text-emerald-400"
              : "text-xs font-medium text-amber-300"
          }
        >
          {d.missing === 0 ? "you can build this" : `${d.missing} missing`}
        </span>
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        {d.cards} cards, {d.distinct} distinct
        {!d.isMine && <> · {d.ownerName}</>}
      </p>
      {d.notes && <p className="mt-2 text-sm text-neutral-400">{d.notes}</p>}
    </li>
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Decks</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Decks are visible to everyone in the group. Saving one you cannot build yet is the
        point: &ldquo;missing&rdquo; is counted against <em>your</em> collection, so someone
        else&rsquo;s deck tells you what you would need to copy it.
      </p>

      <NewDeck />

      <section className="mt-10">
        <h2 className="text-sm font-medium text-neutral-300">Mine</h2>
        {mine.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">No decks yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {mine.map((d) => (
              <Card key={d.id} d={d} />
            ))}
          </ul>
        )}
      </section>

      {others.length > 0 && (
        <section className="mt-10">
          <h2 className="text-sm font-medium text-neutral-300">Everyone else</h2>
          <ul className="mt-3 space-y-2">
            {others.map((d) => (
              <Card key={d.id} d={d} />
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
