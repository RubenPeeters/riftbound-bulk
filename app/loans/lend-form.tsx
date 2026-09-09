"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { lend } from "./actions";
import type { LendableRow } from "@/lib/queries";

export default function LendForm({
  members,
  rows,
  finish,
  query,
}: {
  members: { id: string; displayName: string }[];
  rows: LendableRow[];
  finish: string;
  query: string;
}) {
  const [borrower, setBorrower] = useState("");
  const [purpose, setPurpose] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const lines = Object.entries(picked)
    .filter(([, q]) => q > 0)
    .map(([printingId, quantity]) => ({ printingId, quantity }));
  const total = lines.reduce((n, l) => n + l.quantity, 0);

  const set = (r: LendableRow, n: number) =>
    setPicked((p) => ({ ...p, [r.printingId]: Math.max(0, Math.min(r.available, n)) }));

  return (
    <>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Lend to</span>
          <select
            value={borrower}
            onChange={(e) => setBorrower(e.target.value)}
            className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm"
          >
            <option value="">choose someone</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">What for (optional)</span>
          <input
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="regionals"
            className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Back by (optional)</span>
          <input
            type="date"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm"
          />
        </label>
      </div>

      <form className="mt-4 flex items-end gap-2">
        <input type="hidden" name="finish" value={finish} />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Find a card you own</span>
          <input
            name="q"
            defaultValue={query}
            placeholder="Void Gate"
            className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm"
          />
        </label>
        <button className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300">
          Search
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-neutral-500">
          Nothing here to lend. You can only lend cards you own and are holding.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-neutral-900 rounded-lg border border-neutral-800">
          {rows.map((r) => (
            <li key={r.printingId} className="flex items-center gap-3 p-2.5">
              <span className="flex-1 truncate text-sm">
                {r.name}
                <span className="ml-2 font-mono text-[10px] text-neutral-600">
                  {r.printedCode}
                </span>
              </span>
              <span className="text-xs text-neutral-500">{r.available} available</span>
              <input
                type="number"
                min={0}
                max={r.available}
                value={picked[r.printingId] ?? 0}
                onFocus={(e) => e.target.select()}
                onChange={(e) => set(r, Number(e.target.value))}
                aria-label={`Copies of ${r.name} to lend`}
                className="w-16 rounded border border-neutral-800 bg-neutral-900 py-1 text-center text-sm"
              />
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

      <button
        type="button"
        disabled={pending || !borrower || total === 0}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              await lend(borrower, finish, lines, purpose, dueAt || null);
              setPicked({});
              router.refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          })
        }
        className="mt-5 rounded bg-emerald-600 px-3 py-1.5 text-sm font-medium disabled:opacity-40"
      >
        {pending ? "Recording…" : total > 0 ? `Lend ${total} card${total === 1 ? "" : "s"}` : "Lend"}
      </button>
    </>
  );
}
