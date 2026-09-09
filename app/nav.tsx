import Link from "next/link";
import { currentViewer } from "@/lib/session";

const LINKS = [
  { href: "/cards?edit=1", label: "My collection" },
  { href: "/cards", label: "Cards" },
  { href: "/wishlist", label: "Wishlist" },
  { href: "/loans", label: "Loans" },
  { href: "/decks", label: "Decks" },
  { href: "/decklist", label: "Decklist" },
  { href: "/people", label: "People" },
];

/**
 * Every page had to be reached through the home page, which made the app feel smaller
 * than it is. Links appear only for approved members, since nothing behind them renders
 * anything for anyone else.
 */
export default async function Nav() {
  const { me } = await currentViewer();
  const approved = me?.state === "approved";

  return (
    <nav className="sticky top-0 z-30 border-b border-neutral-900 bg-neutral-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-1 gap-y-1 px-6 py-2.5">
        <Link href="/" className="mr-3 text-sm font-semibold">
          riftbound
        </Link>
        {approved &&
          LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
            >
              {l.label}
            </Link>
          ))}
        {approved && me.role === "admin" && (
          <Link
            href="/admin"
            className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-900 hover:text-neutral-100"
          >
            Members
          </Link>
        )}
        {approved && (
          <span className="ml-auto truncate text-xs text-neutral-600">{me.displayName}</span>
        )}
      </div>
    </nav>
  );
}
