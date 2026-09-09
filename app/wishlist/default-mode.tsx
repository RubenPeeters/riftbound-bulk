"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setDeckWishlistDefault, type WishlistMode } from "../decks/actions";

const LABELS: Record<WishlistMode, string> = {
  none: "not feed it",
  shared: "share cards with my other decks",
  dedicated: "keep its own copies",
};

/** Answered once rather than on every deck someone saves. */
export default function DefaultMode({ current }: { current: WishlistMode }) {
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <p className="mt-5 text-xs text-neutral-500">
      A new deck should{" "}
      {(Object.keys(LABELS) as WishlistMode[]).map((m, i) => (
        <span key={m}>
          {i > 0 && <span className="text-neutral-700"> / </span>}
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await setDeckWishlistDefault(m);
                router.refresh();
              })
            }
            className={
              current === m
                ? "font-medium text-neutral-200 underline"
                : "text-neutral-500 underline hover:text-neutral-300"
            }
          >
            {LABELS[m]}
          </button>
        </span>
      ))}{" "}
      by default. Each deck can still be changed on its own page.
    </p>
  );
}
