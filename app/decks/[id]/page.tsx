import Link from "next/link";
import { notFound } from "next/navigation";
import { currentViewer } from "@/lib/session";
import { deckCards } from "@/lib/queries";
import { deleteDeck } from "../actions";
import WishFromDeck from "../wish-from-deck";

export const dynamic = "force-dynamic";

export default async function Deck({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { discordId, me } = await currentViewer();

  if (me?.state !== "approved") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-neutral-400">
          {me ? "Your account is waiting for approval." : "Sign in first."}{" "}
          <Link href="/" className="underline">
            Back
          </Link>
        </p>
      </main>
    );
  }

  const { deck, cards } = await deckCards(discordId, id);
  if (!deck) notFound();

  const missing = cards.reduce((n, c) => n + Math.max(0, c.main + c.sideboard - c.owned), 0);
  const hasSide = cards.some((c) => c.sideboard > 0);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/decks" className="text-sm text-neutral-500 underline">
        All decks
      </Link>

      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">{deck.name}</h1>
        <span
          className={
            missing === 0 ? "text-sm text-emerald-400" : "text-sm font-medium text-amber-300"
          }
        >
          {missing === 0 ? "You can build this" : `${missing} cards missing`}
        </span>
      </div>
      <p className="mt-1 text-sm text-neutral-500">
        {deck.isMine ? "Yours" : `${deck.ownerName}'s deck`}
        {deck.notes && <> · {deck.notes}</>}
      </p>

      <table className="mt-8 w-full text-sm">
        <thead className="text-left text-xs text-neutral-500">
          <tr className="border-b border-neutral-800">
            <th className="py-2 font-normal">Card</th>
            {hasSide && <th className="py-2 text-right font-normal">Main / Side</th>}
            <th className="py-2 text-right font-normal">Need</th>
            <th className="py-2 text-right font-normal">You have</th>
            <th className="py-2 text-right font-normal">Missing</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => {
            const need = c.main + c.sideboard;
            const short = Math.max(0, need - c.owned);
            return (
              <tr key={c.cardId} className="border-b border-neutral-900">
                <td className="py-1.5">
                  {c.name}
                  {c.type && <span className="ml-2 text-xs text-neutral-600">{c.type}</span>}
                </td>
                {hasSide && (
                  <td className="py-1.5 text-right font-mono text-xs tabular-nums text-neutral-600">
                    {c.main} / {c.sideboard}
                  </td>
                )}
                <td className="py-1.5 text-right tabular-nums text-neutral-400">{need}</td>
                <td className="py-1.5 text-right tabular-nums text-neutral-400">{c.owned}</td>
                <td
                  className={`py-1.5 text-right tabular-nums ${
                    short > 0 ? "text-amber-300" : "text-neutral-700"
                  }`}
                >
                  {short || "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <WishFromDeck deckId={id} missing={missing} />

      {deck.isMine && (
        <form
          action={async () => {
            "use server";
            await deleteDeck(id);
          }}
          className="mt-8"
        >
          <button className="rounded border border-neutral-800 px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-900">
            Delete deck
          </button>
        </form>
      )}
    </main>
  );
}
