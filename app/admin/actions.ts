"use server";

import { revalidatePath } from "next/cache";
import { asUser } from "@/lib/db";
import { currentViewer } from "@/lib/session";

/**
 * Approve or suspend a member.
 *
 * Authorisation is not checked here on purpose: the admin_manage_members policy is
 * `using (is_admin())`, so a non-admin's update matches no rows and changes nothing. The
 * with-check clause additionally forces approved_by to be the acting admin, so an
 * approval always records who made it.
 *
 * approved_at is set for a suspension too. It reads oddly, but the column means "when a
 * decision was recorded", and the approval_recorded constraint requires it for any state
 * other than pending.
 */
async function decide(personId: string, state: "approved" | "suspended") {
  const { discordId, me } = await currentViewer();
  if (me?.role !== "admin") throw new Error("not an admin");

  await asUser(discordId, async (db) => {
    const { rowCount } = await db.query(
      `update person
          set state = $2, approved_at = now(), approved_by = me()
        where id = $1`,
      [personId, state],
    );
    if (!rowCount) throw new Error("no such person, or the policy refused the change");
  });
  revalidatePath("/admin");
}

export async function approvePerson(personId: string) {
  await decide(personId, "approved");
}

export async function suspendPerson(personId: string) {
  await decide(personId, "suspended");
}
