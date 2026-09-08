import NextAuth from "next-auth";
import Discord from "next-auth/providers/discord";
import { ensurePerson } from "@/lib/db";

/**
 * Discord OAuth. Sessions are JWTs, so there are no session tables to maintain.
 *
 * That is safe here despite membership being revocable: every policy calls is_member(),
 * which reads person.state from the database on each query. Suspending someone takes
 * effect on their next request even though their token is still valid; they simply see
 * what a pending member sees, which is their own row and nothing else.
 *
 * Signing in does NOT grant access. It creates a `pending` person row that an admin has
 * to approve. See docs/design.md §3.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Discord],
  session: { strategy: "jwt" },
  // The app runs behind Caddy, so the forwarded host is the real one.
  trustHost: true,
  callbacks: {
    async signIn({ profile }) {
      if (!profile?.id) return false;
      const name = (profile.global_name as string) ?? (profile.username as string) ?? "unknown";
      await ensurePerson(String(profile.id), name, (profile.image_url as string) ?? null);
      return true;
    },
    async jwt({ token, profile }) {
      if (profile?.id) token.discordId = String(profile.id);
      return token;
    },
    async session({ session, token }) {
      session.discordId = token.discordId as string | undefined;
      return session;
    },
  },
});
