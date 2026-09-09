import Link from "next/link";
import { currentViewer } from "@/lib/session";
import { memberList } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function People() {
  const { discordId, me } = await currentViewer();

  if (me?.state !== "approved") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">People</h1>
        <p className="mt-3 text-neutral-400">
          {me ? "Your account is waiting for approval." : "Sign in first."}{" "}
          <Link href="/" className="underline">
            Back
          </Link>
        </p>
      </main>
    );
  }

  const members = await memberList(discordId);

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">People</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Everyone&rsquo;s collection is visible to the group. That is the point: it is what
        makes &ldquo;who could lend me this&rdquo; answerable.
      </p>

      <ul className="mt-8 space-y-2">
        {members.map((p) => (
          <li key={p.id}>
            <Link
              href={`/people/${p.id}`}
              className="flex items-center gap-3 rounded-lg border border-neutral-800 p-3 hover:bg-neutral-900"
            >
              {p.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.avatarUrl} alt="" width={36} height={36} className="size-9 rounded-full" />
              ) : (
                <span className="grid size-9 place-items-center rounded-full bg-neutral-800 text-xs">
                  {p.displayName.slice(0, 2)}
                </span>
              )}
              <span className="flex-1">
                <span className="text-sm font-medium">
                  {p.displayName}
                  {p.isMe && <span className="ml-2 text-xs text-neutral-500">you</span>}
                  {p.role === "admin" && (
                    <span className="ml-2 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400">
                      admin
                    </span>
                  )}
                </span>
                <span className="block text-xs text-neutral-500">
                  {p.owned} cards, {p.distinct} distinct
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
