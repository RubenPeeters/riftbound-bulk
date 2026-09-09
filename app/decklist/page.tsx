import Link from "next/link";
import { currentViewer } from "@/lib/session";
import DecklistForm from "./form";

export const dynamic = "force-dynamic";

export default async function Decklist() {
  const { me } = await currentViewer();

  if (me?.state !== "approved") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Decklist</h1>
        <p className="mt-3 text-neutral-400">
          {me ? "Your account is waiting for approval." : "Sign in first."}{" "}
          <Link href="/" className="underline">
            Back
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Decklist</h1>
      <p className="mt-2 mb-6 text-sm text-neutral-400">
        Paste a list to see what you are missing. Counts are across every printing of a card
        and exclude anything you have lent out, since a deck you cannot physically build is a
        deck you are short for.
      </p>
      <DecklistForm />
    </main>
  );
}
