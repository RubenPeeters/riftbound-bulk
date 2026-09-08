import Link from "next/link";
import { currentViewer } from "@/lib/session";
import { listPrintings, filterOptions, PAGE_SIZE, type CardFilters } from "@/lib/queries";

export const dynamic = "force-dynamic";

const DOMAIN_COLOR: Record<string, string> = {
  fury: "bg-red-500/15 text-red-300",
  calm: "bg-green-500/15 text-green-300",
  mind: "bg-sky-500/15 text-sky-300",
  body: "bg-amber-500/15 text-amber-300",
  order: "bg-yellow-500/15 text-yellow-200",
  chaos: "bg-purple-500/15 text-purple-300",
  colorless: "bg-neutral-500/15 text-neutral-300",
};

function Select({
  name,
  value,
  options,
  label,
}: {
  name: string;
  value?: string;
  options: { value: string; label: string }[];
  label: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-neutral-500">{label}</span>
      <select
        name={name}
        defaultValue={value ?? ""}
        className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm"
      >
        <option value="">any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default async function Cards({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { discordId, me } = await currentViewer();

  if (me?.state !== "approved") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Cards</h1>
        <p className="mt-3 text-neutral-400">
          {me
            ? "Your account is waiting for approval, so no cards are visible yet."
            : "Sign in to browse the cards."}{" "}
          <Link href="/" className="underline">
            Back
          </Link>
        </p>
      </main>
    );
  }

  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const filters: CardFilters = {
    set: one("set"),
    domain: one("domain"),
    rarity: one("rarity"),
    type: one("type"),
    q: one("q"),
    page: Number(one("page") ?? 1) || 1,
  };

  const [{ rows, total }, options] = await Promise.all([
    listPrintings(discordId, filters),
    filterOptions(discordId),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(filters.page ?? 1, pages);
  const pageHref = (n: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v && k !== "page") qs.set(k, String(v));
    qs.set("page", String(n));
    return `/cards?${qs}`;
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Cards</h1>
        <p className="text-sm text-neutral-500">
          {total.toLocaleString()} printing{total === 1 ? "" : "s"}
        </p>
      </div>

      <form className="mt-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-neutral-500">Name</span>
          <input
            name="q"
            defaultValue={filters.q ?? ""}
            placeholder="Void Gate"
            className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm"
          />
        </label>
        <Select
          name="set"
          value={filters.set}
          label="Set"
          options={options.sets.map((s) => ({ value: s.code, label: `${s.name} (${s.n})` }))}
        />
        <Select
          name="domain"
          value={filters.domain}
          label="Domain"
          options={options.domains.map((v) => ({ value: v, label: v }))}
        />
        <Select
          name="type"
          value={filters.type}
          label="Type"
          options={options.types.map((v) => ({ value: v, label: v }))}
        />
        <Select
          name="rarity"
          value={filters.rarity}
          label="Rarity"
          options={options.rarities.map((v) => ({ value: v, label: v }))}
        />
        <button className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900">
          Filter
        </button>
        <Link href="/cards" className="py-1.5 text-sm text-neutral-500 underline">
          Reset
        </Link>
      </form>

      {rows.length === 0 ? (
        <p className="mt-10 text-neutral-500">Nothing matches those filters.</p>
      ) : (
        <ul className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {rows.map((c) => (
            <li key={c.printingId} className="rounded-lg border border-neutral-800 p-2">
              {c.imageUrl ? (
                // Card art is Riot's, served from their CDN and never rehosted. A plain
                // img keeps the container free of an image-optimisation dependency.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={c.imageUrl}
                  alt={c.name}
                  loading="lazy"
                  className="aspect-[744/1039] w-full rounded object-cover"
                />
              ) : (
                <div className="aspect-[744/1039] w-full rounded bg-neutral-900" />
              )}
              <p className="mt-2 truncate text-sm font-medium" title={c.name}>
                {c.name}
              </p>
              <p className="mt-0.5 font-mono text-xs text-neutral-500">{c.printedCode}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {c.domains.map((d) => (
                  <span
                    key={d}
                    className={`rounded px-1.5 py-0.5 text-[10px] ${
                      DOMAIN_COLOR[d] ?? "bg-neutral-800 text-neutral-400"
                    }`}
                  >
                    {d}
                  </span>
                ))}
                {c.might !== null && (
                  <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300">
                    {c.might} might
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-3 text-sm">
          {page > 1 && (
            <Link href={pageHref(page - 1)} className="text-neutral-400 underline">
              Previous
            </Link>
          )}
          <span className="text-neutral-500">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link href={pageHref(page + 1)} className="text-neutral-400 underline">
              Next
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
