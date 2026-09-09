import { cache } from "react";
import { auth } from "@/auth";
import { viewer, type Viewer } from "@/lib/db";

/**
 * The signed-in person, resolved through RLS.
 *
 * Wrapped in React's `cache` so the nav and the page it wraps share one lookup rather
 * than issuing the same query twice on every request. `me` is null when nobody is signed in, and
 * carries state `pending` for someone awaiting approval: signing in is not membership.
 */
export const currentViewer = cache(
  async (): Promise<{ discordId: string | null; me: Viewer | null }> => {
    const session = await auth();
    const discordId = session?.discordId ?? null;
    return { discordId, me: await viewer(discordId) };
  },
);
