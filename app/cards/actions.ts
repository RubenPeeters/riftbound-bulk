"use server";

import { revalidatePath } from "next/cache";
import { asUser } from "@/lib/db";
import { currentViewer } from "@/lib/session";

export interface Target {
  printingId: string;
  quantity: number;
}

/**
 * Record collection changes as ledger events.
 *
 * Takes absolute target quantities, not deltas. The client can hold pending edits across
 * filter changes and pagination, at which point it no longer knows what the server said
 * the old value was; and computing the difference here also means a change someone else
 * made in the meantime is accounted for rather than overwritten.
 *
 * Holdings are a fold over transfer_event, so this never writes a quantity: going from 2
 * to 5 appends an `acquire` of 3, and going from 5 to 2 appends a `stocktake` of 3
 * leaving the group, because the quantity column is constrained positive and direction is
 * carried by which of from_id and to_id is set.
 */
export async function saveQuantities(finish: string, targets: Target[]): Promise<number> {
  const { discordId, me } = await currentViewer();
  if (me?.state !== "approved") throw new Error("not an approved member");

  const wanted = targets.filter(
    (t) => Number.isInteger(t.quantity) && t.quantity >= 0 && t.quantity <= 999,
  );
  if (wanted.length === 0) return 0;

  const changed = await asUser(discordId, async (db) => {
    const ids = wanted.map((t) => t.printingId);
    const { rows } = await db.query<{ printingId: string; qty: string }>(
      `select printing_id as "printingId", sum(quantity) as qty
         from holding
        where owner_id = me() and holder_id = me() and finish = $2
          and printing_id = any($1::text[])
        group by printing_id`,
      [ids, finish],
    );
    const current = new Map(rows.map((r) => [r.printingId, Number(r.qty)]));

    let n = 0;
    for (const t of wanted) {
      const delta = t.quantity - (current.get(t.printingId) ?? 0);
      if (delta === 0) continue;
      n++;
      if (delta > 0) {
        await db.query(
          `insert into transfer_event
             (kind, printing_id, finish, quantity, condition, owner_id, to_id, recorded_by)
           values ('acquire', $1, $2, $3, 'NM', me(), me(), me())`,
          [t.printingId, finish, delta],
        );
      } else {
        await db.query(
          `insert into transfer_event
             (kind, printing_id, finish, quantity, condition, owner_id, from_id, recorded_by, note)
           values ('stocktake', $1, $2, $3, 'NM', me(), me(), me(), $4)`,
          [t.printingId, finish, -delta, "collection edit: corrected downwards"],
        );
      }
    }
    return n;
  });

  revalidatePath("/cards");
  return changed;
}
