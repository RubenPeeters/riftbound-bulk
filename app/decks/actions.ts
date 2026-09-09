"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asUser } from "@/lib/db";
import { currentViewer } from "@/lib/session";
import { parseDecklist } from "@/lib/decklist";
import { deckDiff } from "@/lib/queries";

/**
 * Save a pasted list as a deck.
 *
 * Slots are stored per section, so the main/sideboard distinction survives and a saved
 * deck can still answer both questions later. Names that resolve to no card are dropped
 * with a count returned, rather than silently: a deck missing a card it named would
 * understate what you need, the same error the decklist check refuses to make.
 */
export async function saveDeck(
  name: string,
  text: string,
  notes: string | null,
): Promise<{ id: string; unresolved: number }> {
  const { discordId, me } = await currentViewer();
  if (me?.state !== "approved") throw new Error("not an approved member");
  if (!name.trim()) throw new Error("a deck needs a name");

  const { entries } = parseDecklist(text);
  // deckDiff resolves the same alternative spellings the decklist check accepts, so a
  // legend written as "Lillia, Bashful Bloom" saves correctly.
  const resolved = await deckDiff(
    discordId,
    entries.map((e) => ({ name: e.name, quantity: e.main + e.sideboard })),
  );
  const byName = new Map(resolved.map((r) => [r.name.toLowerCase(), r.cardId]));

  const slots = entries
    .map((e) => ({ cardId: byName.get(e.name.toLowerCase()), main: e.main, side: e.sideboard }))
    .filter((s): s is { cardId: string; main: number; side: number } => Boolean(s.cardId));

  const id = await asUser(discordId, async (db) => {
    const { rows } = await db.query<{ id: string }>(
      `insert into deck (owner_id, name, notes) values (me(), $1, $2) returning id`,
      [name.trim(), notes?.trim() || null],
    );
    const deckId = rows[0].id;
    for (const s of slots) {
      await db.query(
        `insert into deck_slot (deck_id, card_id, main, sideboard) values ($1, $2, $3, $4)
         on conflict (deck_id, card_id) do update
            set main = deck_slot.main + excluded.main,
                sideboard = deck_slot.sideboard + excluded.sideboard`,
        [deckId, s.cardId, s.main, s.side],
      );
    }
    return deckId;
  });

  revalidatePath("/decks");
  return { id, unresolved: entries.length - slots.length };
}

export async function deleteDeck(deckId: string): Promise<void> {
  const { discordId, me } = await currentViewer();
  if (me?.state !== "approved") throw new Error("not an approved member");
  await asUser(discordId, async (db) => {
    // The policy restricts this to the owner, so a non-owner deletes zero rows.
    await db.query(`delete from deck where id = $1`, [deckId]);
  });
  revalidatePath("/decks");
  redirect("/decks");
}

export type WishMode = "atleast" | "add";

/**
 * Put a deck's missing cards on your wishlist.
 *
 * The two modes are the answer to a real question, not a preference: do cards move
 * between your decks or not?
 *
 *   atleast  You play one deck at a time and shuffle cards between them. Two decks each
 *            wanting three Void Gate means you need three, so the target becomes the
 *            larger of what you already wanted and what this deck wants. Idempotent:
 *            running it again changes nothing.
 *
 *   add      You want this deck to keep its own copies. The same two decks mean six, so
 *            this deck's requirement is added on top of your existing target. NOT
 *            idempotent, deliberately: running it twice really does mean you asked twice.
 *
 * Targets are set from what the deck *needs*, never from today's shortfall, so acquiring
 * a card shrinks the wishlist on its own instead of leaving a stale wish behind.
 *
 * Only cards you are currently short of are touched. A deck you can already build adds
 * nothing, which keeps the wish table a list of intentions rather than an inventory.
 */
export async function wishFromDeck(deckId: string, mode: WishMode): Promise<number> {
  const { discordId, me } = await currentViewer();
  if (me?.state !== "approved") throw new Error("not an approved member");

  const desired =
    mode === "add"
      ? "coalesce(w.desired, 0) + (s.main + s.sideboard)"
      : "greatest(coalesce(w.desired, 0), s.main + s.sideboard)";

  const n = await asUser(discordId, async (db) => {
    const { rowCount } = await db.query(
      `insert into wish (person_id, card_id, desired)
       select me(), s.card_id, ${desired}
         from deck_slot s
         left join (
              select p.card_id, sum(h.quantity) as qty
                from holding h join printing p on p.id = h.printing_id
               where h.owner_id = me()
               group by p.card_id
         ) o on o.card_id = s.card_id
         left join wish w on w.person_id = me() and w.card_id = s.card_id
        where s.deck_id = $1
          and (s.main + s.sideboard) > coalesce(o.qty, 0)
       on conflict (person_id, card_id)
       do update set desired = excluded.desired, updated_at = now()`,
      [deckId],
    );
    return rowCount ?? 0;
  });

  revalidatePath("/wishlist");
  revalidatePath(`/decks/${deckId}`);
  return n;
}
