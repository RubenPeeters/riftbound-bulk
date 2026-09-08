import { auth } from "@/auth";
import { viewer, type Viewer } from "@/lib/db";

/**
 * The signed-in person, resolved through RLS. `me` is null when nobody is signed in, and
 * carries state `pending` for someone awaiting approval: signing in is not membership.
 */
export async function currentViewer(): Promise<{ discordId: string | null; me: Viewer | null }> {
  const session = await auth();
  const discordId = session?.discordId ?? null;
  return { discordId, me: await viewer(discordId) };
}
