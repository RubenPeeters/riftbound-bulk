"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveDeck } from "./actions";

export default function NewDeck() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-6 rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900"
      >
        Save a deck
      </button>
    );
  }

  return (
    <div className="mt-6 rounded-lg border border-neutral-800 p-4">
      <div className="flex flex-wrap gap-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Deck name"
          className="flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm"
        />
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        spellCheck={false}
        placeholder={"1 Lillia, Bashful Bloom\n3 Sprite Burst\nSideboard:\n1 Back Off"}
        className="mt-3 w-full rounded border border-neutral-800 bg-neutral-900 p-3 font-mono text-sm"
      />
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={pending || !name.trim() || !text.trim()}
          onClick={() =>
            start(async () => {
              setError(null);
              try {
                const { id, unresolved } = await saveDeck(name, text, notes);
                if (unresolved > 0) {
                  setError(
                    `Saved, but ${unresolved} line${unresolved === 1 ? "" : "s"} matched no card and ${
                      unresolved === 1 ? "was" : "were"
                    } left out.`,
                  );
                }
                router.push(`/decks/${id}`);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            })
          }
          className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save deck"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded border border-neutral-800 px-3 py-1.5 text-sm text-neutral-400"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
