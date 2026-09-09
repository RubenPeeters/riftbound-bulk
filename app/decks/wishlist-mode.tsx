"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { setDeckWishlistMode, type WishlistMode } from "./actions";

const OPTIONS: { value: WishlistMode; label: string; hint: string }[] = [
  { value: "none", label: "Not at all", hint: "This deck is just a note. It asks for nothing." },
  {
    value: "shared",
    label: "Sharing cards",
    hint: "Cards move between your decks, so this overlaps with your other shared decks: two of them wanting three of a card means you want three.",
  },
  {
    value: "dedicated",
    label: "Keeping its own",
    hint: "This deck stays built, so its cards are on top of everything else: two decks wanting three means you want six.",
  },
];

export default function WishlistModeControl({
  deckId,
  mode,
  missing,
}: {
  deckId: string;
  mode: WishlistMode;
  missing: number;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <section className="mt-8 rounded-lg border border-neutral-800 p-4">
      <h2 className="text-sm font-medium text-neutral-300">Feed my wishlist</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Whether two decks wanting the same card means one set or two is a fact about the
        decks, so it lives here rather than on a button. Change a deck and the wishlist
        follows on its own.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await setDeckWishlistMode(deckId, o.value);
                router.refresh();
              })
            }
            className={`rounded border p-3 text-left disabled:opacity-40 ${
              mode === o.value
                ? "border-emerald-700 bg-emerald-950/20"
                : "border-neutral-800 hover:bg-neutral-900"
            }`}
          >
            <span className="block text-sm font-medium">{o.label}</span>
            <span className="mt-0.5 block text-xs text-neutral-500">{o.hint}</span>
          </button>
        ))}
      </div>

      {mode !== "none" && missing > 0 && (
        <p className="mt-3 text-sm text-neutral-400">
          {missing} card{missing === 1 ? "" : "s"} of this deck{" "}
          {missing === 1 ? "is" : "are"} on{" "}
          <Link href="/wishlist" className="underline">
            your wishlist
          </Link>
          .
        </p>
      )}
    </section>
  );
}
