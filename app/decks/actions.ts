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
      `insert into deck (owner_id, name, notes, wishlist_mode)
       select me(), $1, $2, p.deck_wishlist_default from person p where p.id = me()
       returning id`,
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

export type WishlistMode = "none" | "shared" | "dedicated";

/**
 * Say whether, and how, this deck feeds your wishlist.
 *
 * This replaces pushing a deck's needs onto the wishlist. Pushing left the wishlist stale
 * when a deck changed, left demand behind when a deck was deleted, and the additive mode
 * was not idempotent, so pressing it twice quietly asked for twice as much. A flag is
 * read every time the wishlist is computed, so all three stop being possible.
 *
 *   shared     cards move between your decks, so this deck's needs overlap with your
 *              other shared decks and the largest wins
 *   dedicated  this deck keeps its own copies, so its needs add on top
 */
export async function setDeckWishlistMode(deckId: string, mode: WishlistMode): Promise<void> {
  const { discordId, me } = await currentViewer();
  if (me?.state !== "approved") throw new Error("not an approved member");

  await asUser(discordId, async (db) => {
    // The policy restricts updates to the deck's owner, so this changes nothing for
    // anyone else without needing a check here.
    await db.query(`update deck set wishlist_mode = $2, updated_at = now() where id = $1`, [
      deckId,
      mode,
    ]);
  });

  revalidatePath("/wishlist");
  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/decks");
}

/** Remember what new decks should default to, so the question is answered once. */
export async function setDeckWishlistDefault(mode: WishlistMode): Promise<void> {
  const { discordId, me } = await currentViewer();
  if (me?.state !== "approved") throw new Error("not an approved member");
  await asUser(discordId, async (db) => {
    await db.query(`update person set deck_wishlist_default = $1 where id = me()`, [mode]);
  });
  revalidatePath("/wishlist");
}
