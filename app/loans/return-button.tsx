"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { returnCards } from "./actions";

export default function ReturnButton({
  counterpartyId,
  printingId,
  finish,
  quantity,
  direction,
}: {
  counterpartyId: string;
  printingId: string;
  finish: string;
  quantity: number;
  direction: "out" | "in";
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await returnCards(counterpartyId, printingId, finish, quantity, direction);
          router.refresh();
        })
      }
      className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
    >
      {pending ? "…" : direction === "out" ? "Got it back" : "Gave it back"}
    </button>
  );
}
