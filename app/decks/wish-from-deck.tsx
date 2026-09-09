"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { wishFromDeck, type WishMode } from "./actions";

/**
 * The two modes are shown side by side rather than hidden behind a default, because
 * choosing wrongly is silent: you would only notice when the wishlist says six of
 * something you meant to own three of.
 */
export default function WishFromDeck({ deckId, missing }: { deckId: string; missing: number }) {
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const run = (mode: WishMode) =>
    start(async () => {
      setError(null);
      try {
        const n = await wishFromDeck(deckId, mode);
        setDone(
          n === 0
            ? "Nothing to add: you already have everything this deck needs."
            : `${n} card${n === 1 ? "" : "s"} ${mode === "add" ? "added on top of" : "set on"} your wishlist.`,
        );
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });

  if (missing === 0) return null;

  return (
    <section className="mt-8 rounded-lg border border-neutral-800 p-4">
      <h2 className="text-sm font-medium text-neutral-300">
        Put the {missing} missing card{missing === 1 ? "" : "s"} on your wishlist
      </h2>
      <p className="mt-1 text-xs text-neutral-500">
        Which one you want depends on whether cards move between your decks.
      </p>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run("atleast")}
          className="rounded border border-neutral-700 p-3 text-left hover:bg-neutral-900 disabled:opacity-40"
        >
          <span className="block text-sm font-medium">Enough to build this deck</span>
          <span className="mt-0.5 block text-xs text-neutral-500">
            You shuffle cards between decks. Two decks wanting three of a card means you
            want three. Safe to press twice.
          </span>
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run("add")}
          className="rounded border border-neutral-700 p-3 text-left hover:bg-neutral-900 disabled:opacity-40"
        >
          <span className="block text-sm font-medium">On top of what I already want</span>
          <span className="mt-0.5 block text-xs text-neutral-500">
            This deck keeps its own copies. Two decks wanting three means you want six.
            Pressing twice really does ask twice.
          </span>
        </button>
      </div>

      {done && (
        <p className="mt-3 text-sm text-emerald-400">
          {done}{" "}
          <Link href="/wishlist" className="underline">
            See wishlist
          </Link>
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  );
}
