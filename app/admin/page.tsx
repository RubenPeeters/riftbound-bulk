import Link from "next/link";
import { currentViewer } from "@/lib/session";
import { listPending, listMembers } from "@/lib/queries";
import { approvePerson, suspendPerson } from "./actions";

export const dynamic = "force-dynamic";

function Avatar({ url, name }: { url: string | null; name: string }) {
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt="" width={32} height={32} className="size-8 rounded-full" />
  ) : (
    <span className="grid size-8 place-items-center rounded-full bg-neutral-800 text-xs">
      {name.slice(0, 2)}
    </span>
  );
}

export default async function Admin() {
  const { discordId, me } = await currentViewer();

  if (me?.role !== "admin") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Members</h1>
        <p className="mt-3 text-neutral-400">
          Only admins can approve members.{" "}
          <Link href="/" className="underline">
            Back
          </Link>
        </p>
      </main>
    );
  }

  const [p, m] = await Promise.all([listPending(discordId), listMembers(discordId)]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Members</h1>

      <section className="mt-8">
        <h2 className="text-sm font-medium text-neutral-300">
          Waiting for approval {p.length > 0 && <span className="text-amber-300">({p.length})</span>}
        </h2>
        {p.length === 0 ? (
          <p className="mt-2 text-sm text-neutral-500">Nobody is waiting.</p>
        ) : (
          <ul className="mt-3 divide-y divide-neutral-800 rounded-lg border border-neutral-800">
            {p.map((person) => (
              <li key={person.id} className="flex items-center gap-3 p-3">
                <Avatar url={person.avatarUrl} name={person.displayName} />
                <span className="flex-1 text-sm">{person.displayName}</span>
                <form
                  action={async () => {
                    "use server";
                    await approvePerson(person.id);
                  }}
                >
                  <button className="rounded bg-emerald-600 px-3 py-1 text-sm hover:bg-emerald-500">
                    Approve
                  </button>
                </form>
                <form
                  action={async () => {
                    "use server";
                    await suspendPerson(person.id);
                  }}
                >
                  <button className="rounded border border-neutral-700 px-3 py-1 text-sm text-neutral-400 hover:bg-neutral-800">
                    Reject
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium text-neutral-300">Members</h2>
        <ul className="mt-3 divide-y divide-neutral-800 rounded-lg border border-neutral-800">
          {m.map((person) => (
            <li key={person.id} className="flex items-center gap-3 p-3">
              <Avatar url={person.avatarUrl} name={person.displayName} />
              <span className="flex-1 text-sm">
                {person.displayName}
                {person.role === "admin" && (
                  <span className="ml-2 rounded bg-neutral-800 px-1.5 py-0.5 text-xs text-neutral-400">
                    admin
                  </span>
                )}
              </span>
              <span
                className={
                  person.state === "approved"
                    ? "text-xs text-emerald-400"
                    : "text-xs text-neutral-500"
                }
              >
                {person.state}
              </span>
              {person.state === "approved" && person.id !== me.id && (
                <form
                  action={async () => {
                    "use server";
                    await suspendPerson(person.id);
                  }}
                >
                  <button className="rounded border border-neutral-700 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800">
                    Suspend
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
