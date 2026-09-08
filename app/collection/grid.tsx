"use client";

import { useMemo, useState, useTransition } from "react";
import { saveDeltas } from "./actions";
import type { EntryRow } from "@/lib/queries";

/**
 * Entry is local until saved. Every stepper press writing to the database would make a
 * binder session hundreds of round trips, each one able to fail on a phone with poor
 * signal. Counts are held here, the diff is sent in one action, and the ledger receives
 * one event per changed card.
 */
export default function Grid({
  rows,
  finish,
  set,
}: {
  rows: EntryRow[];
  finish: string;
  set: string;
}) {
  const initial = useMemo(
    () => Object.fromEntries(rows.map((r) => [r.printingId, r.quantity])),
    [rows],
  );
  const [counts, setCounts] = useState<Record<string, number>>(initial);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulk, setBulk] = useState(1);

  const changed = rows
    .map((r) => ({ printingId: r.printingId, delta: (counts[r.printingId] ?? 0) - r.quantity }))
    .filter((d) => d.delta !== 0);

  const owned = rows.reduce((n, r) => n + (counts[r.printingId] ?? 0), 0);
  const distinct = rows.filter((r) => (counts[r.printingId] ?? 0) > 0).length;

  const set1 = (id: string, n: number) =>
    setCounts((c) => ({ ...c, [id]: Math.max(0, Math.min(99, n)) }));

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        const n = await saveDeltas(finish, changed);
        setSaved(`Saved ${n} change${n === 1 ? "" : "s"}.`);
        setTimeout(() => setSaved(null), 4000);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  return (
    <>
      <div className="sticky top-0 z-10 -mx-6 mb-6 flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-950/95 px-6 py-3 backdrop-blur">
        <p className="text-sm text-neutral-400">
          <span className="font-medium text-neutral-100">{owned}</span> cards,{" "}
          <span className="font-medium text-neutral-100">{distinct}</span> of {rows.length} distinct
        </p>

        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-neutral-500">
            set all to
            <input
              type="number"
              min={0}
              max={99}
              value={bulk}
              onChange={(e) => setBulk(Number(e.target.value))}
              className="w-14 rounded border border-neutral-800 bg-neutral-900 px-1.5 py-1 text-sm text-neutral-100"
            />
          </label>
          <button
            type="button"
            onClick={() => setCounts(Object.fromEntries(rows.map((r) => [r.printingId, bulk])))}
            className="rounded border border-neutral-700 px-2.5 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            Apply to all
          </button>
          <button
            type="button"
            onClick={() => setCounts(initial)}
            disabled={changed.length === 0 || pending}
            className="rounded border border-neutral-800 px-2.5 py-1 text-xs text-neutral-500 disabled:opacity-40 hover:bg-neutral-900"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={save}
            disabled={changed.length === 0 || pending}
            className="rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium disabled:opacity-40 hover:bg-emerald-500"
          >
            {pending ? "Saving…" : `Save ${changed.length || ""}`.trim()}
          </button>
        </div>
      </div>

      {saved && <p className="mb-4 text-sm text-emerald-400">{saved}</p>}
      {error && <p className="mb-4 text-sm text-red-400">{error}</p>}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {rows.map((r) => {
          const n = counts[r.printingId] ?? 0;
          const dirty = n !== r.quantity;
          return (
            <li
              key={r.printingId}
              className={`rounded-lg border p-2 ${
                dirty ? "border-emerald-700 bg-emerald-950/20" : "border-neutral-800"
              }`}
            >
              <div className={n === 0 ? "opacity-35 transition-opacity" : "transition-opacity"}>
                {r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.imageUrl}
                    alt={r.name}
                    loading="lazy"
                    className="aspect-[744/1039] w-full rounded object-cover"
                  />
                ) : (
                  <div className="aspect-[744/1039] w-full rounded bg-neutral-900" />
                )}
              </div>
              <p className="mt-1.5 truncate text-xs font-medium" title={r.name}>
                {r.name}
              </p>
              <p className="font-mono text-[10px] text-neutral-600">{r.printedCode}</p>
              <div className="mt-1.5 flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`One fewer ${r.name}`}
                  onClick={() => set1(r.printingId, n - 1)}
                  className="grid size-7 place-items-center rounded border border-neutral-800 text-neutral-400 hover:bg-neutral-800"
                >
                  −
                </button>
                <input
                  type="number"
                  min={0}
                  max={99}
                  value={n}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => set1(r.printingId, Number(e.target.value))}
                  aria-label={`Copies of ${r.name}`}
                  className="w-full [appearance:textfield] rounded border border-neutral-800 bg-neutral-900 py-1 text-center text-sm [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  aria-label={`One more ${r.name}`}
                  onClick={() => set1(r.printingId, n + 1)}
                  className="grid size-7 place-items-center rounded border border-neutral-800 text-neutral-400 hover:bg-neutral-800"
                >
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-8 text-xs text-neutral-600">
        Changes are held here until you press Save, so you can work through a binder
        offline and commit once. Set: {set}, finish: {finish}.
      </p>
    </>
  );
}
