import Link from "next/link";
import { currentViewer } from "@/lib/session";
import { listPrintings, filterOptions, PAGE_SIZE, type CardFilters } from "@/lib/queries";
import Grid from "./grid";

export const dynamic = "force-dynamic";

const FINISHES = ["normal", "foil"];

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

  const edit = one("edit") === "1";
  const finish = FINISHES.includes(one("finish") ?? "") ? one("finish")! : "normal";
  const show = (["all", "owned", "missing"] as const).find((v) => v === one("show")) ?? "all";

  const filters: CardFilters = {
    set: one("set"),
    domain: one("domain"),
    rarity: one("rarity"),
    type: one("type"),
    q: one("q"),
    show,
    finish,
    page: Number(one("page") ?? 1) || 1,
  };

  const [{ rows, total }, options] = await Promise.all([
    listPrintings(discordId, filters),
    filterOptions(discordId),
  ]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(filters.page ?? 1, pages);

  const href = (over: Record<string, string | number | undefined>) => {
    const qs = new URLSearchParams();
    const merged = { ...filters, edit: edit ? "1" : undefined, ...over };
    for (const [k, v] of Object.entries(merged)) {
      if (v !== undefined && v !== "" && !(k === "show" && v === "all") && !(k === "page" && v === 1))
        qs.set(k, String(v));
    }
    const s = qs.toString();
    return s ? `/cards?${s}` : "/cards";
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">{edit ? "My collection" : "Cards"}</h1>
        <p className="text-sm text-neutral-500">
          {total.toLocaleString()} printing{total === 1 ? "" : "s"}
        </p>
      </div>

      <form className="mt-6 flex flex-wrap items-end gap-3">
        {edit && <input type="hidden" name="edit" value="1" />}
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
        <Select
          name="show"
          value={show === "all" ? "" : show}
          label="Mine"
          options={[
            { value: "owned", label: "owned" },
            { value: "missing", label: "missing" },
          ]}
        />
        <Select
          name="finish"
          value={finish === "normal" ? "" : finish}
          label="Finish"
          options={FINISHES.map((f) => ({ value: f, label: f }))}
        />
        <button className="rounded bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900">
          Filter
        </button>
        <Link href={edit ? "/cards?edit=1" : "/cards"} className="py-1.5 text-sm text-neutral-500 underline">
          Reset
        </Link>
      </form>

      <div className="mt-5 mb-6 flex items-center gap-3 text-sm">
        <Link
          href={href({ edit: edit ? undefined : "1" })}
          className={`rounded px-3 py-1.5 ${
            edit
              ? "bg-emerald-600 font-medium"
              : "border border-neutral-700 text-neutral-300 hover:bg-neutral-800"
          }`}
        >
          {edit ? "Editing my collection" : "Edit my collection"}
        </Link>
        {edit && (
          <span className="text-xs text-neutral-500">
            Counting {finish} copies you own and hold. Changes are kept while you filter and
            page, and saved when you press Save.
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="mt-10 text-neutral-500">Nothing matches those filters.</p>
      ) : (
        <Grid rows={rows} editable={edit} finish={finish} />
      )}

      {pages > 1 && (
        <nav className="mt-10 flex items-center justify-center gap-3 text-sm">
          {page > 1 && (
            <Link href={href({ page: page - 1 })} className="text-neutral-400 underline">
              Previous
            </Link>
          )}
          <span className="text-neutral-500">
            Page {page} of {pages}
          </span>
          {page < pages && (
            <Link href={href({ page: page + 1 })} className="text-neutral-400 underline">
              Next
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
