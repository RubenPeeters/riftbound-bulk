import { redirect } from "next/navigation";

/**
 * Collection entry and card browsing were separate pages with filter bars that had
 * drifted apart for no reason. They are one page now; this keeps old links working.
 */
export default async function Collection({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams({ edit: "1" });
  for (const k of ["set", "finish"]) {
    const v = sp[k];
    if (typeof v === "string" && v) qs.set(k, v);
  }
  redirect(`/cards?${qs}`);
}
