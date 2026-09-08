"use server";

import { revalidatePath } from "next/cache";
import { asUser } from "@/lib/db";
import { currentViewer } from "@/lib/session";

export interface Delta {
  printingId: string;
  delta: number;
}

/**
 * Record collection changes as ledger events.
 *
 * Holdings are a fold over transfer_event, so entry never writes a quantity: it appends
 * the difference. Going from 2 to 5 appends an `acquire` of 3; going from 5 to 2 appends
 * a `stocktake` of 3 leaving the group. Nothing is ever overwritten, which is what makes
 * "what did I own in March" answerable and what lets two people edit at once without
 * clobbering each other.
 *
 * Condition is fixed at NM here. Entry that asks about condition per card is entry nobody
 * finishes; the ledger can express it and a later screen can correct it.
 */
export async function saveDeltas(finish: string, deltas: Delta[]): Promise<number> {
  const { discordId, me } = await currentViewer();
  if (me?.state !== "approved") throw new Error("not an approved member");

  const changes = deltas.filter((d) => Number.isInteger(d.delta) && d.delta !== 0);
  if (changes.length === 0) return 0;

  await asUser(discordId, async (db) => {
    for (const { printingId, delta } of changes) {
      if (delta > 0) {
        await db.query(
          `insert into transfer_event
             (kind, printing_id, finish, quantity, condition, owner_id, to_id, recorded_by)
           values ('acquire', $1, $2, $3, 'NM', me(), me(), me())`,
          [printingId, finish, delta],
        );
      } else {
        // The quantity column is constrained positive: direction is carried by which of
        // from_id and to_id is set, not by the sign.
        await db.query(
          `insert into transfer_event
             (kind, printing_id, finish, quantity, condition, owner_id, from_id, recorded_by, note)
           values ('stocktake', $1, $2, $3, 'NM', me(), me(), me(), $4)`,
          [printingId, finish, -delta, "collection entry: corrected downwards"],
        );
      }
    }
  });

  revalidatePath("/collection");
  return changes.length;
}
