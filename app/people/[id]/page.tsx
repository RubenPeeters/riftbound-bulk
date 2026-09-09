import Link from "next/link";
import { notFound } from "next/navigation";
import { currentViewer } from "@/lib/session";
import {
  memberProfile,
  personHoldings,
  filterOptions,
  wishlistFor,
  PAGE_SIZE,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const { discordId, me } = await currentViewer();

  if (me?.state !== "approved") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-neutral-400">
          {me ? "Your account is waiting for approval." : "Sign in first."}{" "}
          <Link href="/" className="underline">
            Back
          </Link>
        </p>
      </main>
    );
  }

  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const gap = one("gap") === "1";
  const filters = { q: one("q"), set: one("set"), gap, page: Number(one("page") ?? 1) || 1 };

  const [profile, { rows, total }, options, wants] = await Promise.all([
    memberProfile(discordId, id),
    personHoldings(discordId, id, filters),
    filterOptions(discordId),
    wishlistFor(discordId, id),
  ]);
  if (!profile) notFound();

  const isMe = profile.id === me.id;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(filters.page, pages);

  const href = (o: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    const merged: Record<string, string | undefined> = {
      q: filters.q,
      set: filters.set,
      gap: gap ? "1" : undefined,
      ...o,
    };
    for (const [k, v] of Object.entries(merged)) if (v) qs.set(k, v);
    const s = qs.toString();
    return `/people/${id}${s ? `?${s}` : ""}`;
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/people" className="text-sm text-neutral-500 underline">
        Everyone
      </Link>

      <div className="mt-3 flex items-center gap-4">
        {profile.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.avatarUrl} alt="" width={48} height={48} className="size-12 rounded-full" />
        ) : (
          <span className="grid size-12 place-items-center rounded-full bg-neutral-800">
            {profile.displayName.slice(0, 2)}
          </span>
        )}
        <div>
          <h1 className="text-2xl font-semibold">
            {profile.displayName}
            {isMe && <span className="ml-2 text-sm font-normal text-neutral-500">you</span>}
          </h1>
          <p className="text-sm text-neutral-500">
            {profile.owned} cards, {profile.distinct} distinct · {profile.available} to hand
            {profile.lentOut > 0 && <> · {profile.lentOut} lent out</>}
          </p>
        </div>
      </div>

      {wants.length > 0 && (
        <section className="mt-8 rounded-lg border border-neutral-800 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium text-neutral-300">
              {isMe ? "You want" : "Wants"}
            </h2>
            <Link href={`/wishlist?who=${id}`} className="text-xs text-neutral-500 underline">
              Full wishlist
            </Link>
          </div>
          <ul className="mt-3 space-y-1.5">
            {wants.slice(0, 12).map((w) => {
              // The spare list excludes the wisher, so anything of mine in it is something
              // I could actually hand over. That is the only reason to show this here.
              const mySpare = isMe ? null : w.spares.find((sp) => sp.personId === me.id);
              return (
                <li key={w.cardId} className="flex items-baseline gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  <span className="shrink-0 text-xs text-neutral-500">
                    wants {w.desired}, has {w.owned}
                  </span>
                  {mySpare ? (
                    <span className="shrink-0 rounded bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                      you have {mySpare.quantity}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                      short {w.missing}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {wants.length > 12 && (
            <p className="mt-2 text-xs text-neutral-600">
              and {wants.length - 12} more
            </p>
          )}
        </section>
      )}

      <form className="mt-8 flex flex-wrap items-end gap-3">
        {gap && <input type="hidden" name="gap" value="1" />}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Name</span>
          <input
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Void Gate"
            className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Set</span>
          <select
            name="set"
            defaultValue={filters.set ?? ""}
            className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm"
          >
            <option value="">any</option>
            {options.sets.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900">
          Filter
        </button>
        {!isMe && (
          <Link
            href={href({ gap: gap ? undefined : "1" })}
            className={`rounded px-3 py-1.5 text-sm ${
              gap
                ? "bg-sky-600 font-medium"
                : "border border-neutral-700 text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            {gap ? "Showing what I lack" : "Only what I lack"}
          </Link>
        )}
      </form>

      <p className="mt-4 text-sm text-neutral-500">
        {total.toLocaleString()} printing{total === 1 ? "" : "s"}
        {gap && " they have and you do not"}
      </p>

      {rows.length === 0 ? (
        <p className="mt-10 text-neutral-500">Nothing here.</p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {rows.map((r) => (
            <li key={r.printingId} className="rounded-lg border border-neutral-800 p-2">
              <div className="relative">
                {r.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.imageUrl}
                    alt={r.name}
                    loading="lazy"
                    className="aspect-[744/1039] w-full rounded object-cover"
                  />
                ) : (
                  <div className="aspect-[744/1039] w-full rounded bg-neutral-900" />
                )}
                <span className="absolute top-1.5 right-1.5 rounded bg-neutral-950/90 px-1.5 py-0.5 text-xs font-medium">
                  ×{r.theirs}
                </span>
              </div>
              <p className="mt-2 truncate text-sm font-medium" title={r.name}>
                {r.name}
              </p>
              <p className="font-mono text-[10px] text-neutral-600">{r.printedCode}</p>
              {!isMe && (
                <p
                  className={`mt-0.5 text-[10px] ${
                    r.mine > 0 ? "text-neutral-500" : "text-sky-400/80"
                  }`}
                >
                  {r.mine > 0 ? `you have ${r.mine}` : "you have none"}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-3 text-sm">
          {page > 1 && (
            <Link href={href({ page: String(page - 1) })} className="text-neutral-400 underline">
              Previous
            </Link>
          )}
          <span className="text-neutral-500">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link href={href({ page: String(page + 1) })} className="text-neutral-400 underline">
              Next
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
