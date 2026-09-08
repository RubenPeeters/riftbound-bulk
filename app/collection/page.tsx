import Link from "next/link";
import { currentViewer } from "@/lib/session";
import { filterOptions, listForEntry } from "@/lib/queries";
import Grid from "./grid";

export const dynamic = "force-dynamic";

const FINISHES = ["normal", "foil"];

export default async function Collection({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { discordId, me } = await currentViewer();

  if (me?.state !== "approved") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">My collection</h1>
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
  const one = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);

  const options = await filterOptions(discordId);
  const set = one("set") ?? options.sets[0]?.code;
  const finish = FINISHES.includes(one("finish") ?? "") ? one("finish")! : "normal";

  if (!set) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">My collection</h1>
        <p className="mt-3 text-neutral-400">No card data is loaded yet.</p>
      </main>
    );
  }

  const rows = await listForEntry(discordId, set, finish);

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">My collection</h1>
        <p className="text-sm text-neutral-500">
          Counting what you own <em>and</em> hold. Cards lent out are tracked separately.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap gap-4">
        <div className="flex flex-wrap gap-1.5">
          {options.sets.map((s) => (
            <Link
              key={s.code}
              href={`/collection?set=${s.code}&finish=${finish}`}
              className={`rounded px-2.5 py-1 text-sm ${
                s.code === set
                  ? "bg-neutral-100 font-medium text-neutral-900"
                  : "border border-neutral-800 text-neutral-400 hover:bg-neutral-900"
              }`}
            >
              {s.name}
            </Link>
          ))}
        </div>
        <div className="flex gap-1.5">
          {FINISHES.map((f) => (
            <Link
              key={f}
              href={`/collection?set=${set}&finish=${f}`}
              className={`rounded px-2.5 py-1 text-sm ${
                f === finish
                  ? "bg-neutral-100 font-medium text-neutral-900"
                  : "border border-neutral-800 text-neutral-400 hover:bg-neutral-900"
              }`}
            >
              {f}
            </Link>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <Grid rows={rows} finish={finish} set={set} />
      </div>
    </main>
  );
}
