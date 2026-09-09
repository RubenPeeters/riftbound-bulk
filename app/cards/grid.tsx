"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { saveQuantities } from "./actions";
import type { CardRow, Holder } from "@/lib/queries";

const DOMAIN_COLOR: Record<string, string> = {
  fury: "bg-red-500/15 text-red-300",
  calm: "bg-green-500/15 text-green-300",
  mind: "bg-sky-500/15 text-sky-300",
  body: "bg-amber-500/15 text-amber-300",
  order: "bg-yellow-500/15 text-yellow-200",
  chaos: "bg-purple-500/15 text-purple-300",
  colorless: "bg-neutral-500/15 text-neutral-300",
};

/**
 * Pending edits live in sessionStorage, keyed by finish.
 *
 * Filtering and paging are server round trips, which remount this component, so holding
 * edits in React state alone would silently discard them the moment someone searched for
 * the next card in their binder. That data loss is the reason browsing and entry were
 * separate pages; persisting the pending map is what let them merge.
 */
function loadPending(finish: string): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(`pending:${finish}`) ?? "{}");
  } catch {
    return {};
  }
}

export default function Grid({
  rows,
  editable,
  finish,
  holders = {},
}: {
  rows: CardRow[];
  editable: boolean;
  finish: string;
  /** Who in the group has each printing, so a card you lack says who to ask. */
  holders?: Record<string, Holder[]>;
}) {
  const [pending, setPending] = useState<Record<string, number>>({});
  const [busy, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read on mount rather than during render: the server has no sessionStorage, and
  // seeding state from it directly would mismatch the server-rendered markup.
  useEffect(() => setPending(loadPending(finish)), [finish]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(`pending:${finish}`, JSON.stringify(pending));
    } catch {
      /* private mode; edits then last only as long as the page does */
    }
  }, [pending, finish]);

  const quantityOf = (r: CardRow) => pending[r.printingId] ?? r.quantity;
  const dirtyCount = Object.keys(pending).length;

  const set = (r: CardRow, n: number) => {
    const q = Math.max(0, Math.min(999, n));
    setPending((p) => {
      const next = { ...p };
      // Back to what the server holds is not a change; drop it so the count stays honest.
      if (q === r.quantity) delete next[r.printingId];
      else next[r.printingId] = q;
      return next;
    });
  };

  function save() {
    setError(null);
    setNote(null);
    const targets = Object.entries(pending).map(([printingId, quantity]) => ({
      printingId,
      quantity,
    }));
    start(async () => {
      try {
        const n = await saveQuantities(finish, targets);
        setPending({});
        setNote(`Saved ${n} change${n === 1 ? "" : "s"}.`);
        setTimeout(() => setNote(null), 4000);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <>
      {editable && dirtyCount > 0 && (
        <div className="sticky top-0 z-20 -mx-6 mb-5 flex flex-wrap items-center gap-3 border-b border-emerald-900 bg-neutral-950/95 px-6 py-3 backdrop-blur">
          <p className="text-sm text-neutral-300">
            <span className="font-medium">{dirtyCount}</span> unsaved change
            {dirtyCount === 1 ? "" : "s"}
            <span className="ml-2 text-neutral-600">kept while you filter and page</span>
          </p>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => setPending({})}
              disabled={busy}
              className="rounded border border-neutral-800 px-2.5 py-1 text-xs text-neutral-500 hover:bg-neutral-900"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium disabled:opacity-40 hover:bg-emerald-500"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {note && <p className="mb-4 text-sm text-emerald-400">{note}</p>}
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {rows.map((r) => {
          const n = quantityOf(r);
          const dirty = pending[r.printingId] !== undefined;
          return (
            <li
              key={r.printingId}
              className={`rounded-lg border p-2 ${
                dirty ? "border-emerald-700 bg-emerald-950/20" : "border-neutral-800"
              }`}
            >
              <div className="relative">
                {r.imageUrl ? (
                  // Card art is Riot's, served from their CDN and never rehosted.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.imageUrl}
                    alt={r.name}
                    loading="lazy"
                    className={`aspect-[744/1039] w-full rounded object-cover ${
                      editable && n === 0 ? "opacity-35" : ""
                    }`}
                  />
                ) : (
                  <div className="aspect-[744/1039] w-full rounded bg-neutral-900" />
                )}
                {!editable && n > 0 && (
                  <span className="absolute top-1.5 right-1.5 rounded bg-neutral-950/90 px-1.5 py-0.5 text-xs font-medium">
                    ×{n}
                  </span>
                )}
              </div>

              <p className="mt-2 truncate text-sm font-medium" title={r.name}>
                {r.name}
              </p>
              <p className="font-mono text-[10px] text-neutral-600">{r.printedCode}</p>
              {n === 0 && (holders[r.printingId]?.length ?? 0) > 0 && (
                <p className="mt-1 truncate text-[10px]" title="Could lend you this">
                  {holders[r.printingId].map((h, i) => (
                    <span key={h.personId}>
                      {i > 0 && <span className="text-neutral-700">, </span>}
                      <Link
                        href={`/people/${h.personId}`}
                        className="text-sky-400/80 hover:text-sky-300 hover:underline"
                      >
                        {h.displayName} ×{h.quantity}
                      </Link>
                    </span>
                  ))}
                </p>
              )}

              {editable ? (
                <div className="mt-1.5 flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`One fewer ${r.name}`}
                    onClick={() => set(r, n - 1)}
                    className="grid size-7 place-items-center rounded border border-neutral-800 text-neutral-400 hover:bg-neutral-800"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    min={0}
                    value={n}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => set(r, Number(e.target.value))}
                    aria-label={`Copies of ${r.name}`}
                    className="w-full [appearance:textfield] rounded border border-neutral-800 bg-neutral-900 py-1 text-center text-sm [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    aria-label={`One more ${r.name}`}
                    onClick={() => set(r, n + 1)}
                    className="grid size-7 place-items-center rounded border border-neutral-800 text-neutral-400 hover:bg-neutral-800"
                  >
                    +
                  </button>
                </div>
              ) : (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {r.domains.map((d) => (
                    <span
                      key={d}
                      className={`rounded px-1.5 py-0.5 text-[10px] ${
                        DOMAIN_COLOR[d] ?? "bg-neutral-800 text-neutral-400"
                      }`}
                    >
                      {d}
                    </span>
                  ))}
                  {r.might !== null && (
                    <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300">
                      {r.might} might
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
