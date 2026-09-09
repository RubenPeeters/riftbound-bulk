"use client";

import { useState, useTransition } from "react";
import { analyseDecklist, acceptAsOwned, type DeckResult, type Scope } from "./actions";

const PLACEHOLDER = `3 Void Gate
2x Akali, Deadly Weapon
Baron Nashor x1
1 Sett, Brawler (OGN)

# comments and section headers are ignored`;

export default function DecklistForm() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<DeckResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("full");
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<void>) => {
    setError(null);
    setNote(null);
    start(async () => {
      try {
        await fn();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        spellCheck={false}
        placeholder={PLACEHOLDER}
        className="w-full rounded-lg border border-neutral-800 bg-neutral-900 p-3 font-mono text-sm"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!text.trim() || pending}
          onClick={() => run(async () => setResult(await analyseDecklist(text, scope)))}
          className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-40"
        >
          {pending ? "Checking…" : "What am I missing?"}
        </button>
        {result && result.totals.missing > 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const n = await acceptAsOwned(text, scope);
                setNote(`Added the shortfall for ${n} card${n === 1 ? "" : "s"} to your collection.`);
                setResult(await analyseDecklist(text, scope));
              })
            }
            className="rounded border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-800"
          >
            I own all of these — add the missing copies
          </button>
        )}
      </div>

      {result?.hasSideboard && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-neutral-500">Count</span>
          {(
            [
              ["main", "Main deck only"],
              ["full", "Main deck and sideboard"],
            ] as [Scope, string][]
          ).map(([v, label]) => (
            <button
              key={v}
              type="button"
              disabled={pending}
              onClick={() =>
                run(async () => {
                  setScope(v);
                  setResult(await analyseDecklist(text, v));
                })
              }
              className={`rounded px-2.5 py-1 text-sm ${
                scope === v
                  ? "bg-neutral-100 font-medium text-neutral-900"
                  : "border border-neutral-800 text-neutral-400 hover:bg-neutral-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      {note && <p className="mt-4 text-sm text-emerald-400">{note}</p>}

      {result && (
        <section className="mt-8">
          <p className="text-sm text-neutral-400">
            <span className="font-medium text-neutral-100">{result.totals.wanted}</span> cards in
            the list,{" "}
            <span className="font-medium text-emerald-400">{result.totals.owned}</span> you have,{" "}
            <span
              className={
                result.totals.missing > 0
                  ? "font-medium text-amber-300"
                  : "font-medium text-emerald-400"
              }
            >
              {result.totals.missing}
            </span>{" "}
            missing
            {result.totals.unmatched > 0 && (
              <>
                {", "}
                <span className="font-medium text-red-400">{result.totals.unmatched}</span> not
                recognised
              </>
            )}
            .
          </p>

          <table className="mt-4 w-full text-sm">
            <thead className="text-left text-xs text-neutral-500">
              <tr className="border-b border-neutral-800">
                <th className="py-2 font-normal">Card</th>
                {result.hasSideboard && (
                  <th className="py-2 text-right font-normal text-neutral-600">Main / Side</th>
                )}
                <th className="py-2 text-right font-normal">Need</th>
                <th className="py-2 text-right font-normal">Have</th>
                <th className="py-2 text-right font-normal">Missing</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.name} className="border-b border-neutral-900">
                  <td className="py-1.5">
                    {r.name}
                    {r.cardId === null && (
                      <span className="ml-2 rounded bg-red-500/15 px-1.5 py-0.5 text-[10px] text-red-300">
                        no such card
                      </span>
                    )}
                  </td>
                  {result.hasSideboard && (
                    <td className="py-1.5 text-right font-mono text-xs tabular-nums text-neutral-600">
                      {r.main} / {r.sideboard}
                    </td>
                  )}
                  <td className="py-1.5 text-right tabular-nums text-neutral-400">{r.wanted}</td>
                  <td className="py-1.5 text-right tabular-nums text-neutral-400">{r.owned}</td>
                  <td
                    className={`py-1.5 text-right tabular-nums ${
                      r.missing > 0 ? "text-amber-300" : "text-neutral-700"
                    }`}
                  >
                    {r.missing || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {result.ignored.length > 0 && (
            <div className="mt-6 rounded border border-neutral-800 p-3">
              <p className="text-xs text-neutral-500">
                {result.ignored.length} line{result.ignored.length === 1 ? "" : "s"} could not be
                read and {result.ignored.length === 1 ? "was" : "were"} left out:
              </p>
              <ul className="mt-1.5 font-mono text-xs text-neutral-600">
                {result.ignored.map((l, i) => (
                  <li key={i}>{l || "(blank)"}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </>
  );
}
