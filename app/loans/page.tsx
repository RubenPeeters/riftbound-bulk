import Link from "next/link";
import { currentViewer } from "@/lib/session";
import { lendable, openLoans, loanBundles, listMembers } from "@/lib/queries";
import LendForm from "./lend-form";
import ReturnButton from "./return-button";
import Acknowledge from "./acknowledge";

export const dynamic = "force-dynamic";

function overdue(dueAt: string | null): boolean {
  return Boolean(dueAt && new Date(dueAt) < new Date());
}

export default async function Loans({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { discordId, me } = await currentViewer();

  if (me?.state !== "approved") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Loans</h1>
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
  const q = typeof sp.q === "string" && sp.q ? sp.q : undefined;
  const finish = sp.finish === "foil" ? "foil" : "normal";

  const [out, incoming, rows, members, toConfirm, awaitingThem] = await Promise.all([
    openLoans(discordId, "out"),
    openLoans(discordId, "in"),
    lendable(discordId, q, finish),
    listMembers(discordId),
    loanBundles(discordId, "in"),
    loanBundles(discordId, "out"),
  ]);
  const unconfirmed = toConfirm.filter((b) => b.state === "proposed");
  const disputed = [...toConfirm, ...awaitingThem].filter((b) => b.state === "disputed");
  const waiting = awaitingThem.filter((b) => b.state === "proposed");

  const others = members
    .filter((m) => m.id !== me.id && m.state === "approved")
    .map((m) => ({ id: m.id, displayName: m.displayName }));

  const Section = ({
    title, empty, lines, direction,
  }: {
    title: string;
    empty: string;
    lines: typeof out;
    direction: "out" | "in";
  }) => (
    <section className="mt-10">
      <h2 className="text-sm font-medium text-neutral-300">
        {title}
        {lines.length > 0 && <span className="ml-2 text-neutral-600">({lines.length})</span>}
      </h2>
      {lines.length === 0 ? (
        <p className="mt-2 text-sm text-neutral-500">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-neutral-900 rounded-lg border border-neutral-800">
          {lines.map((l) => (
            <li
              key={`${l.counterpartyId}-${l.printingId}-${l.finish}`}
              className="flex flex-wrap items-center gap-3 p-3"
            >
              <span className="min-w-0 flex-1">
                <span className="text-sm">
                  {l.quantity}× {l.name}
                </span>
                {l.finish !== "normal" && (
                  <span className="ml-1.5 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px]">
                    {l.finish}
                  </span>
                )}
                <span className="ml-2 font-mono text-[10px] text-neutral-600">
                  {l.printedCode}
                </span>
                <span className="block text-xs text-neutral-500">
                  {direction === "out" ? "with" : "from"} {l.counterparty}
                  {l.purpose && <> · {l.purpose}</>}
                  {l.dueAt && (
                    <span className={overdue(l.dueAt) ? " text-red-400" : ""}>
                      {" "}
                      · back by {new Date(l.dueAt).toLocaleDateString()}
                      {overdue(l.dueAt) && " (overdue)"}
                    </span>
                  )}
                </span>
              </span>
              <ReturnButton
                counterpartyId={l.counterpartyId}
                printingId={l.printingId}
                finish={l.finish}
                quantity={l.quantity}
                direction={direction}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Loans</h1>
      <p className="mt-2 text-sm text-neutral-400">
        Ownership never moves when you lend: these are your cards, in someone else&rsquo;s
        hands. Recording a return appends to the ledger rather than erasing the loan, so the
        history stays.
      </p>

      {unconfirmed.length > 0 && (
        <section className="mt-8 rounded-lg border border-amber-900/60 bg-amber-950/10 p-4">
          <h2 className="text-sm font-medium text-amber-300">
            Waiting on you to confirm ({unconfirmed.length})
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            Someone recorded lending you these. Confirming changes nothing about where the
            cards are; it records that you agree they are with you.
          </p>
          <ul className="mt-3 space-y-3">
            {unconfirmed.map((b) => (
              <li key={b.transactionId} className="rounded border border-neutral-800 p-3">
                <p className="text-sm">
                  {b.quantity} card{b.quantity === 1 ? "" : "s"} from {b.counterparty}
                  {b.purpose && <span className="text-neutral-500"> · {b.purpose}</span>}
                </p>
                <p className="mt-0.5 truncate text-xs text-neutral-500" title={b.cards ?? ""}>
                  {b.cards}
                </p>
                <div className="mt-2">
                  <Acknowledge transactionId={b.transactionId} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {disputed.length > 0 && (
        <section className="mt-8 rounded-lg border border-red-900/60 bg-red-950/10 p-4">
          <h2 className="text-sm font-medium text-red-300">Disputed ({disputed.length})</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Nothing has been changed. The two of you disagree, and that is recorded rather
            than resolved by the app.
          </p>
          <ul className="mt-3 space-y-2">
            {disputed.map((b) => (
              <li key={b.transactionId} className="text-sm">
                {b.quantity} card{b.quantity === 1 ? "" : "s"} with {b.counterparty}
                {b.note && <span className="text-neutral-400"> — &ldquo;{b.note}&rdquo;</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {waiting.length > 0 && (
        <p className="mt-8 text-xs text-neutral-500">
          {waiting.length} loan{waiting.length === 1 ? "" : "s"} of yours{" "}
          {waiting.length === 1 ? "is" : "are"} not yet confirmed by the borrower:{" "}
          {waiting.map((b) => b.counterparty).join(", ")}.
        </p>
      )}

      <Section
        title="Who has my cards"
        empty="Nothing of yours is out."
        lines={out}
        direction="out"
      />
      <Section
        title="What I owe"
        empty="You are not holding anything of anyone else's."
        lines={incoming}
        direction="in"
      />

      <section className="mt-12 border-t border-neutral-900 pt-8">
        <h2 className="text-sm font-medium text-neutral-300">Lend something</h2>
        <p className="mt-1 mb-4 text-xs text-neutral-500">
          Only cards you own and are holding. Passing on someone else&rsquo;s card is not
          possible here by design: they record it, which is how asking them is enforced.
        </p>
        <LendForm members={others} rows={rows} finish={finish} query={q ?? ""} />
      </section>
    </main>
  );
}
