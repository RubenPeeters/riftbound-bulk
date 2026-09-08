/**
 * Fetch Riftbound card data from Riot's own site and vendor it into data/cards/.
 *
 * playriftbound.com is a Next.js application, so its card gallery is served as JSON at
 *   https://playriftbound.com/_next/data/{BUILD_ID}/{LOCALE}/card-gallery.json
 * with no key and no authentication. BUILD_ID changes whenever Riot redeploys, so it is
 * scraped from the page first unless --build-id pins it.
 *
 * This feed is an internal implementation detail of Riot's website. It can change shape
 * without notice, which is precisely why the output is committed to git: a break stops
 * new sets being ingested, it never affects the running site.
 *
 * DETERMINISM. For a given BUILD_ID the output is byte-identical across runs: records are
 * sorted by id, object keys are emitted in a fixed order, and no timestamp enters the
 * card files. Provenance that does vary per run (fetch time, build id) goes to
 * data/manifest.json, which is deliberately outside data/cards/ so `make determinism`
 * compares only the transform. Re-running after Riot redeploys may legitimately differ;
 * that is a source change, and the diff is the point.
 *
 * Usage:
 *   npx tsx scripts/fetch-cards.ts [--locale en-us] [--out data/cards] [--build-id X]
 */

import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import * as path from "node:path";

const SITE = "https://playriftbound.com";

type Arg = Record<string, string>;
const args: Arg = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i]?.replace(/^--/, "");
  if (k) args[k] = process.argv[i + 1] ?? "";
}
const LOCALE = args.locale ?? "en-us";
const OUT = args.out ?? "data/cards";

/** A card as we store it. Key order here is the key order on disk. */
interface Card {
  id: string;
  publicCode: string;
  set: string;
  setName: string;
  collectorNumber: number;
  setTotal: number | null;
  name: string;
  slug: string;
  type: string | null;
  superTypes: string[];
  domains: string[];
  rarity: string | null;
  energy: number | null;
  might: number | null;
  tags: string[];
  orientation: string | null;
  illustrator: string | null;
  imageUrl: string | null;
  rulesHtml: string;
  rulesText: string;
}

/** Oracle-level identity. Deliberately name-only; see docs/design.md 1.5. */
export const slugify = (n: string) =>
  n.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Normalised plain text, used only to decide whether two printings sharing a name are
 * really the same card. Parenthetical reminder text is stripped because alternate-art
 * printings omit it: without this, 83 of 935 names look like collisions; with it, 18 do.
 */
export function normaliseRules(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\([^()]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Riot's blade layout is not stable, so find the card array by shape, not by index. */
function findCardItems(node: unknown): any[] | null {
  if (Array.isArray(node)) {
    if (node.length > 20 && node[0] && typeof node[0] === "object" && "publicCode" in node[0]) {
      return node as any[];
    }
    for (const v of node) { const hit = findCardItems(v); if (hit) return hit; }
  } else if (node && typeof node === "object") {
    for (const v of Object.values(node)) { const hit = findCardItems(v); if (hit) return hit; }
  }
  return null;
}

const pick = (o: any, ...p: string[]) => p.reduce((a, k) => (a == null ? a : a[k]), o) ?? null;

function toCard(raw: any): Card {
  const rulesHtml: string = pick(raw, "text", "richText", "body") ?? "";
  // publicCode looks like 'UNL-131/219'; the denominator is the set size. Promos such as
  // 'VEN-R04' and 'SFD-T03' carry no denominator, hence the null.
  const total = /\/(\d+)\s*$/.exec(raw.publicCode ?? "");
  return {
    id: raw.id,
    publicCode: raw.publicCode,
    set: pick(raw, "set", "value", "id"),
    setName: pick(raw, "set", "value", "label"),
    collectorNumber: raw.collectorNumber,
    setTotal: total ? Number(total[1]) : null,
    name: raw.name,
    slug: slugify(raw.name),
    type: pick(raw, "cardType", "type", "0", "id"),
    superTypes: (pick(raw, "cardType", "superType") ?? []).map((t: any) => t.id).sort(),
    domains: (pick(raw, "domain", "values") ?? []).map((d: any) => d.id).sort(),
    rarity: pick(raw, "rarity", "value", "id"),
    energy: pick(raw, "energy", "value", "id"),
    might: pick(raw, "might", "value", "id"),
    // note the shape: { label, tags: string[] }, not the {values:[{id}]} the other
    // faceted fields use. 835 of 1189 cards carry one.
    tags: [...((pick(raw, "tags", "tags") ?? []) as string[])].sort(),
    orientation: raw.orientation ?? null,
    illustrator: (pick(raw, "illustrator", "values") ?? []).map((a: any) => a.label).join(", ") || null,
    imageUrl: pick(raw, "cardImage", "url"),
    rulesHtml,
    rulesText: normaliseRules(rulesHtml),
  };
}

async function resolveBuildId(): Promise<string> {
  if (args["build-id"]) return args["build-id"];
  const res = await fetch(`${SITE}/${LOCALE}/`, { redirect: "follow" });
  if (!res.ok) throw new Error(`could not load ${SITE}/${LOCALE}/ (HTTP ${res.status})`);
  const m = /"buildId":"([^"]+)"/.exec(await res.text());
  if (!m) throw new Error("no buildId in the page: Riot's site markup has changed");
  return m[1];
}

async function main() {
  const buildId = await resolveBuildId();
  const url = `${SITE}/_next/data/${buildId}/${LOCALE}/card-gallery.json`;
  process.stderr.write(`buildId ${buildId}\nGET ${url}\n`);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} from the gallery feed`);
  const items = findCardItems(await res.json());
  if (!items) throw new Error("no card array in the feed: its shape has changed");

  const cards = items.map(toCard).sort((a, b) => a.id.localeCompare(b.id));

  const bySet = new Map<string, Card[]>();
  for (const c of cards) {
    if (!c.set) throw new Error(`card ${c.id} has no set`);
    (bySet.get(c.set) ?? bySet.set(c.set, []).get(c.set)!).push(c);
  }

  await mkdir(OUT, { recursive: true });
  const files: Record<string, { count: number; sha256: string }> = {};
  for (const set of [...bySet.keys()].sort()) {
    const body = JSON.stringify(bySet.get(set), null, 2) + "\n";
    const name = `${set}.${LOCALE}.json`;
    await writeFile(path.join(OUT, name), body, "utf8");
    files[name] = {
      count: bySet.get(set)!.length,
      sha256: createHash("sha256").update(body).digest("hex"),
    };
    process.stderr.write(`  ${name.padEnd(20)} ${String(bySet.get(set)!.length).padStart(5)} cards\n`);
  }

  // Provenance lives outside data/cards/ so it cannot perturb `make determinism`.
  await writeFile(
    "data/manifest.json",
    JSON.stringify({ source: url, buildId, locale: LOCALE, fetchedAt: new Date().toISOString(),
                     totalCards: cards.length, files }, null, 2) + "\n",
    "utf8",
  );
  process.stderr.write(`\n${cards.length} cards across ${bySet.size} sets -> ${OUT}\n`);
}

main().catch((e) => { process.stderr.write(`fetch-cards: ${e.message}\n`); process.exit(1); });
