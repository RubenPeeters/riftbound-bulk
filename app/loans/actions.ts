"use server";

import { revalidatePath } from "next/cache";
import { asUser } from "@/lib/db";
import { currentViewer } from "@/lib/session";

export interface LendLine {
  printingId: string;
  quantity: number;
}

/**
 * Lend cards, as one bundle.
 *
 * You lend a deck, not forty cards, so the lines share one loan_transaction with one due
 * date and one acknowledgement. Each line is still its own ledger event, because the
 * ledger's unit is a movement of a quantity of a printing.
 *
 * `owner_id = me()` on every event is not only correct but required: the
 * lend_only_own_stock constraint refuses a lend whose owner is not the person it comes
 * from, which is how "ask before re-lending someone else's card" is enforced.
 */
export async function lend(
  borrowerId: string,
  finish: string,
  lines: LendLine[],
  purpose: string | null,
  dueAt: string | null,
): Promise<number> {
  const { discordId, me } = await currentViewer();
  if (me?.state !== "approved") throw new Error("not an approved member");
  if (borrowerId === me.id) throw new Error("you cannot lend to yourself");

  const wanted = lines.filter((l) => Number.isInteger(l.quantity) && l.quantity > 0);
  if (wanted.length === 0) return 0;

  await asUser(discordId, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into loan_transaction (lender_id, borrower_id, purpose, due_at)
       values (me(), $1, $2, $3) returning id`,
      [borrowerId, purpose?.trim() || null, dueAt || null],
    );
    const transactionId = rows[0].id;

    for (const l of wanted) {
      // Refused by RLS or by the constraint if the stock is not the lender's own, so a
      // stale page cannot lend away something already gone.
      await db.query(
        `insert into transfer_event
           (kind, transaction_id, printing_id, finish, quantity, condition,
            owner_id, from_id, to_id, recorded_by)
         values ('lend', $1, $2, $3, $4, 'NM', me(), me(), $5, me())`,
        [transactionId, l.printingId, finish, l.quantity, borrowerId],
      );
    }
  });

  revalidatePath("/loans");
  revalidatePath("/cards");
  return wanted.length;
}

/**
 * Close a loan line by appending a return, never by deleting the lend. Either party may
 * record it: the borrower handing it back and the lender receiving it are the same event.
 */
export async function returnCards(
  counterpartyId: string,
  printingId: string,
  finish: string,
  quantity: number,
  direction: "out" | "in",
): Promise<void> {
  const { discordId, me } = await currentViewer();
  if (me?.state !== "approved") throw new Error("not an approved member");
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error("nothing to return");

  const ownerId = direction === "out" ? me.id : counterpartyId;
  const holderId = direction === "out" ? counterpartyId : me.id;

  await asUser(discordId, async (db) => {
    await db.query(
      `insert into transfer_event
         (kind, printing_id, finish, quantity, condition, owner_id, from_id, to_id, recorded_by)
       values ('return', $1, $2, $3, 'NM', $4, $5, $6, me())`,
      [printingId, finish, quantity, ownerId, holderId, ownerId],
    );
  });

  revalidatePath("/loans");
  revalidatePath("/cards");
}
