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

/**
 * Set how many of a card you want.
 *
 * Targets are absolute, like collection quantities and for the same reason: the client
 * holds pending edits across paging and no longer knows the old value. A target of 0
 * removes the wish rather than storing a zero, so "I want none of this" and "I never
 * said" stay the same thing.
 *
 * Wishes are keyed by card, so this takes printing ids only because that is what the
 * grid has, and resolves them.
 */
export async function saveDesired(targets: Target[]): Promise<number> {
  const { discordId, me } = await currentViewer();
  if (me?.state !== "approved") throw new Error("not an approved member");

  const wanted = targets.filter(
    (t) => Number.isInteger(t.quantity) && t.quantity >= 0 && t.quantity <= 999,
  );
  if (wanted.length === 0) return 0;

  const n = await asUser(discordId, async (db) => {
    const { rows } = await db.query<{ printingId: string; cardId: string }>(
      `select id as "printingId", card_id as "cardId"
         from printing where id = any($1::text[])`,
      [wanted.map((t) => t.printingId)],
    );
    const cardOf = new Map(rows.map((r) => [r.printingId, r.cardId]));

    // Several printings of one card can be edited in a single pass; the last target wins
    // rather than summing, since they are all statements about the same want.
    const perCard = new Map<string, number>();
    for (const t of wanted) {
      const cardId = cardOf.get(t.printingId);
      if (cardId) perCard.set(cardId, t.quantity);
    }

    for (const [cardId, desired] of perCard) {
      if (desired === 0) {
        await db.query(`delete from wish where person_id = me() and card_id = $1`, [cardId]);
      } else {
        await db.query(
          `insert into wish (person_id, card_id, desired) values (me(), $1, $2)
           on conflict (person_id, card_id) do update
              set desired = excluded.desired, updated_at = now()`,
          [cardId, desired],
        );
      }
    }
    return perCard.size;
  });

  revalidatePath("/cards");
  revalidatePath("/wishlist");
  return n;
}
