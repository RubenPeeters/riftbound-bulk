/**
 * Load vendored card data from data/cards/ into Postgres.
 *
 * Connects as the OWNER role, which bypasses row-level security by design: reference
 * data is not writable by the application. Set LOADER_DATABASE_URL, not DATABASE_URL
 * (that one is app_user, which has no insert privilege on these tables).
 *
 * Idempotent: every write is an upsert keyed on natural identifiers, so re-running after
 * a new set drops is safe and touches only what changed.
 *
 * ORACLE IDS. card.id is slug(name), so every printing of a card collapses to one row.
 * That is the intent: "do I own Void Gate" should not depend on which set it came from.
 * The risk is two genuinely different cards sharing a name. This script detects that by
 * comparing normalised rules text across printings of the same slug and printing a
 * report; it does not guess. Resolve real collisions by adding card_alias rows.
 *
 * Usage:
 *   npx tsx scripts/load-cards.ts [--in data/cards] [--dry-run]
 */

import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";

// `pg` is imported lazily inside main() so that --dry-run, which only reads the vendored
// files and reports id collisions, works before any dependency is installed.

const args: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i]?.replace(/^--/, "");
  if (k) args[k] = process.argv[i + 1] ?? "";
}
const IN = args.in ?? "data/cards";
const DRY = "dry-run" in args;

interface Card {
  id: string; publicCode: string; set: string; setName: string;
  collectorNumber: number; setTotal: number | null;
  name: string; slug: string; type: string | null; superTypes: string[];
  domains: string[]; rarity: string | null; energy: number | null; might: number | null;
  tags: string[]; orientation: string | null; illustrator: string | null;
  imageUrl: string | null; rulesHtml: string; rulesText: string;
}

const sha256 = async (s: string) =>
  Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))).toString("hex");

async function main() {
  const files = (await readdir(IN)).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) throw new Error(`no card files in ${IN}; run \`make cards\` first`);

  const cards: Card[] = [];
  for (const f of files) cards.push(...JSON.parse(await readFile(path.join(IN, f), "utf8")));
  cards.sort((a, b) => a.id.localeCompare(b.id));
  process.stderr.write(`${cards.length} printings from ${files.length} files\n`);

  // --- collision report, before touching the database -----------------------------
  const bySlug = new Map<string, Card[]>();
  for (const c of cards) (bySlug.get(c.slug) ?? bySlug.set(c.slug, []).get(c.slug)!).push(c);

  const collisions: string[] = [];
  for (const [slug, group] of bySlug) {
    if (new Set(group.map((c) => c.rulesText)).size > 1) collisions.push(slug);
  }
  if (collisions.length) {
    process.stderr.write(
      `\n${collisions.length} card ids cover printings whose rules text differs.\n` +
      `These need a human decision: same card with errata, or two different cards?\n` +
      `Add card_alias rows for any that are genuinely distinct.\n`);
    for (const s of collisions.sort()) {
      process.stderr.write(`  ${s.padEnd(34)} ${bySlug.get(s)!.map((c) => c.publicCode).join(", ")}\n`);
    }
    process.stderr.write("\n");
  }

  if (DRY) { process.stderr.write("dry run: nothing written\n"); return; }

  const url = process.env.LOADER_DATABASE_URL;
  if (!url) throw new Error("LOADER_DATABASE_URL is not set (owner credentials; see .env.example)");

  const { Client } = await import("pg");
  const db = new Client({ connectionString: url });
  await db.connect();
  try {
    // One transaction: a partial card database is worse than none.
    await db.query("begin");

    const sets = new Map<string, Card>();
    for (const c of cards) if (!sets.has(c.set)) sets.set(c.set, c);
    for (const [code, c] of sets) {
      await db.query(
        `insert into expansion (code, name, card_total) values ($1, $2, $3)
         on conflict (code) do update set name = excluded.name,
              card_total = coalesce(excluded.card_total, expansion.card_total)`,
        [code, c.setName, c.setTotal]);
    }

    // One row per oracle card. Later printings overwrite earlier ones, so iterate in a
    // stable order and let the highest printing win: reprints carry the current text.
    const oracle = new Map<string, Card>();
    for (const c of cards) oracle.set(c.slug, c);
    for (const [slug, c] of oracle) {
      await db.query(
        `insert into card (id, name, domains, type, super_types, energy, might, tags,
                           orientation, rules_html, rules_text, rules_hash)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         on conflict (id) do update set
           name = excluded.name, domains = excluded.domains, type = excluded.type,
           super_types = excluded.super_types, energy = excluded.energy,
           might = excluded.might, tags = excluded.tags,
           orientation = excluded.orientation, rules_html = excluded.rules_html,
           rules_text = excluded.rules_text, rules_hash = excluded.rules_hash`,
        [slug, c.name, c.domains, c.type, c.superTypes, c.energy, c.might, c.tags,
         c.orientation, c.rulesHtml, c.rulesText, await sha256(c.rulesText)]);
    }

    for (const c of cards) {
      await db.query(
        `insert into printing (id, card_id, expansion_code, collector_number,
                               printed_code, rarity, illustrator, image_url, language_code)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (id) do update set
           card_id = excluded.card_id, rarity = excluded.rarity,
           illustrator = excluded.illustrator, image_url = excluded.image_url`,
        [c.id, c.slug, c.set, c.collectorNumber, c.publicCode, c.rarity,
         c.illustrator, c.imageUrl, "en-us"]);
    }

    await db.query("commit");
    process.stderr.write(
      `loaded ${sets.size} sets, ${oracle.size} cards, ${cards.length} printings\n`);
  } catch (e) {
    await db.query("rollback");
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((e) => { process.stderr.write(`load-cards: ${e.message}\n`); process.exit(1); });
