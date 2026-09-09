"use server";

import { revalidatePath } from "next/cache";
import { asUser } from "@/lib/db";
import { currentViewer } from "@/lib/session";
import { parseDecklist } from "@/lib/decklist";
import { deckDiff, defaultPrintings, type DeckDiffRow } from "@/lib/queries";

export interface DeckResult {
  rows: DeckDiffRow[];
  ignored: string[];
  totals: { wanted: number; owned: number; missing: number; unmatched: number };
}

export async function analyseDecklist(text: string): Promise<DeckResult> {
  const { discordId, me } = await currentViewer();
  if (me?.state !== "approved") throw new Error("not an approved member");

  const { entries, ignored } = parseDecklist(text);
  const rows = await deckDiff(discordId, entries);

  return {
    rows,
    ignored,
    totals: {
      wanted: rows.reduce((n, r) => n + r.wanted, 0),
      owned: rows.reduce((n, r) => n + Math.min(r.owned, r.wanted), 0),
      missing: rows.reduce((n, r) => n + r.missing, 0),
      unmatched: rows.filter((r) => r.cardId === null).length,
    },
  };
}

/**
 * "I own all of these": append the shortfall to the ledger.
 *
 * This is the bulk-entry path, and it is why the decklist screen matters beyond deck
 * building. It credits the earliest printing of each card, because a list names a card
 * and not a printing. That is a guess, and the only one this feature makes; correct it in
 * /collection, where printings are explicit.
 *
 * Only the shortfall is added, so running it twice does not double a collection.
 */
export async function acceptAsOwned(text: string): Promise<number> {
  const { discordId, me } = await currentViewer();
  if (me?.state !== "approved") throw new Error("not an approved member");

  const { entries } = parseDecklist(text);
  const rows = (await deckDiff(discordId, entries)).filter((r) => r.cardId && r.missing > 0);
  if (rows.length === 0) return 0;

  const printings = await defaultPrintings(discordId, rows.map((r) => r.cardId!));

  await asUser(discordId, async (db) => {
    for (const r of rows) {
      const printingId = printings.get(r.cardId!);
      if (!printingId) continue;
      await db.query(
        `insert into transfer_event
           (kind, printing_id, finish, quantity, condition, owner_id, to_id, recorded_by, note)
         values ('acquire', $1, 'normal', $2, 'NM', me(), me(), me(), $3)`,
        [printingId, r.missing, "added from a pasted decklist"],
      );
    }
  });

  revalidatePath("/decklist");
  revalidatePath("/collection");
  return rows.length;
}
