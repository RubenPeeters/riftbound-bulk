import "next-auth";

declare module "next-auth" {
  interface Session {
    /** Discord's own user id, asserted to Postgres as app.discord_id. */
    discordId?: string;
  }
}
