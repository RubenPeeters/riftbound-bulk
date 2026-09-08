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
function discordIdOf(
  account: { providerAccountId?: string } | null | undefined,
  profile: { id?: unknown } | null | undefined,
): string | null {
  if (account?.providerAccountId) return String(account.providerAccountId);
  if (profile?.id) return String(profile.id);
  return null;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Discord],
  session: { strategy: "jwt" },
  // The app runs behind Caddy, so the forwarded host is the real one.
  trustHost: true,
  // Surfaces provider and callback errors in `make logs` instead of swallowing them.
  debug: process.env.AUTH_DEBUG === "1",
  callbacks: {
    async signIn({ user, account, profile }) {
      // providerAccountId is the canonical id for an OAuth account and is always set;
      // `profile` is the raw provider payload and its shape is not guaranteed.
      const discordId = discordIdOf(account, profile);
      if (!discordId) {
        console.error("[auth] no Discord id on the account", {
          provider: account?.provider,
          profileKeys: profile ? Object.keys(profile) : null,
        });
        return false;
      }
      const name =
        (profile?.global_name as string) ??
        (profile?.username as string) ??
        user?.name ??
        "unknown";
      // Deliberately not caught: a database failure must not be reported to the user as
      // "you do not have permission to sign in", which sends them looking in the wrong
      // place entirely.
      await ensurePerson(discordId, name, user?.image ?? null);
      return true;
    },
    async jwt({ token, account, profile }) {
      const discordId = discordIdOf(account, profile);
      if (discordId) token.discordId = discordId;
      return token;
    },
    async session({ session, token }) {
      session.discordId = token.discordId as string | undefined;
      return session;
    },
  },
});
