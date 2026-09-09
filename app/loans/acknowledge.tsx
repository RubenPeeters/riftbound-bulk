"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acknowledgeLoan } from "./actions";

export default function Acknowledge({ transactionId }: { transactionId: string }) {
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const act = (state: "confirmed" | "disputed", text: string | null) =>
    start(async () => {
      await acknowledgeLoan(transactionId, state, text);
      setDisputing(false);
      router.refresh();
    });

  if (disputing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What is wrong with this?"
          className="flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm"
        />
        <button
          type="button"
          disabled={pending}
          onClick={() => act("disputed", note)}
          className="rounded bg-red-600/80 px-2.5 py-1 text-xs font-medium hover:bg-red-600"
        >
          Record dispute
        </button>
        <button
          type="button"
          onClick={() => setDisputing(false)}
          className="text-xs text-neutral-500 underline"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() => act("confirmed", null)}
        className="rounded bg-emerald-600 px-2.5 py-1 text-xs font-medium hover:bg-emerald-500 disabled:opacity-40"
      >
        {pending ? "…" : "Yes, I have these"}
      </button>
      <button
        type="button"
        onClick={() => setDisputing(true)}
        className="rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
      >
        That&rsquo;s not right
      </button>
    </div>
  );
}
