import Link from "next/link";
import { currentViewer } from "@/lib/session";
import { wishlistFor, memberList, deckWishlistDefault } from "@/lib/queries";
import DefaultMode from "./default-mode";
import { cardImage, THUMB } from "@/lib/images";

export const dynamic = "force-dynamic";

export default async function Wishlist({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { discordId, me } = await currentViewer();

  if (me?.state !== "approved") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Wishlist</h1>
        <p className="mt-3 text-neutral-400">
          {me ? "Your account is waiting for approval." : "Sign in first."}{" "}
          <Link href="/" className="underline">
            Back
          </Link>
        </p>
      </main>
    );
  }

  const sp = await searchParams;
  const who = typeof sp.who === "string" && sp.who ? sp.who : me.id;

  const [rows, members, defaultMode] = await Promise.all([
    wishlistFor(discordId, who),
    memberList(discordId),
    deckWishlistDefault(discordId),
  ]);
  const subject = members.find((m) => m.id === who);
  const isMe = who === me.id;
  const total = rows.reduce((n, r) => n + r.missing, 0);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">
        {isMe ? "My wishlist" : `${subject?.displayName ?? "Someone"}'s wishlist`}
      </h1>
      <p className="mt-2 text-sm text-neutral-400">
        Two things land here: targets you set by hand in{" "}
        <Link href="/cards?edit=1&mode=want" className="underline">
          edit mode
        </Link>
        , and whatever your decks need, for each deck you have told to feed this list. The
        larger of the two wins, so a deck can never talk you into more copies than you said
        you wanted.
      </p>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {members.map((m) => (
          <Link
            key={m.id}
            href={`/wishlist?who=${m.id}`}
            className={`rounded px-2.5 py-1 text-sm ${
              m.id === who
                ? "bg-neutral-100 font-medium text-neutral-900"
                : "border border-neutral-800 text-neutral-400 hover:bg-neutral-900"
            }`}
          >
            {m.isMe ? "Me" : m.displayName}
          </Link>
        ))}
      </div>

      {isMe && <DefaultMode current={defaultMode} />}

      {rows.length === 0 ? (
        <p className="mt-10 text-neutral-500">
          {isMe
            ? "Nothing outstanding. Either you have not set any targets, or you have met them all."
            : "Nothing outstanding."}
        </p>
      ) : (
        <>
          <p className="mt-8 text-sm text-neutral-500">
            {total} card{total === 1 ? "" : "s"} short, across {rows.length} name
            {rows.length === 1 ? "" : "s"}.
          </p>
          <ul className="mt-4 divide-y divide-neutral-900 rounded-lg border border-neutral-800">
            {rows.map((r) => (
              <li key={r.cardId} className="flex items-center gap-3 p-3">
                {r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={cardImage(r.imageUrl, THUMB)}
                    alt=""
                    loading="lazy"
                    className="h-14 w-10 shrink-0 rounded object-cover"
                  />
                ) : (
                  <div className="h-14 w-10 shrink-0 rounded bg-neutral-900" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="text-xs text-neutral-500">
                    wants {r.desired}, has {r.owned}
                    {r.fromDecks > 0 && r.fromDecks >= r.manual && (
                      <span className="ml-1.5 text-neutral-600">· from decks</span>
                    )}
                    {r.manual > 0 && r.manual > r.fromDecks && (
                      <span className="ml-1.5 text-neutral-600">· set by hand</span>
                    )}
                  </p>
                  {r.spares.length > 0 && (
                    <p className="mt-0.5 truncate text-[11px]">
                      <span className="text-neutral-600">spare: </span>
                      {r.spares.map((sp, i) => (
                        <span key={sp.personId}>
                          {i > 0 && <span className="text-neutral-700">, </span>}
                          <Link
                            href={`/people/${sp.personId}`}
                            className="text-sky-400/80 hover:underline"
                          >
                            {sp.displayName} ×{sp.quantity}
                          </Link>
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                <span className="shrink-0 rounded bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-300">
                  short {r.missing}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
