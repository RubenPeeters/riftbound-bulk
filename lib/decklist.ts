/**
 * Parse a pasted decklist.
 *
 * There is no single decklist format, and Riftbound's is not documented anywhere I could
 * check, so this accepts the shapes that TCG exports and forum posts generally use rather
 * than committing to one. Anything it cannot read is returned in `ignored` and shown to
 * the user: silently dropping a line would understate what you are missing, which is the
 * one error this feature must not make.
 */

export type Section = "main" | "sideboard";

/** One card, counted per section: the same card often appears in both. */
export interface DeckEntry {
  name: string;
  main: number;
  sideboard: number;
}

export interface ParsedDecklist {
  entries: DeckEntry[];
  ignored: string[];
  /** Whether the list declared a sideboard, which decides if the toggle is worth showing. */
  hasSideboard: boolean;
}

/** Cards needed for the chosen scope. A sideboard card is one you must still own. */
export function quantityFor(e: DeckEntry, scope: Section | "full"): number {
  return scope === "main" ? e.main : e.main + e.sideboard;
}

/**
 * Fold the spellings a person might type onto the one the database uses.
 *
 * Curly apostrophes because Kai'Sa is routinely pasted from a site that uses them, and
 * spaced dashes because "Lee Sin - Blind Monk" is the same card as "Lee Sin, Blind Monk".
 * Only *spaced* dashes are touched: "Nine-Tailed Fox" is a real name.
 */
export function normaliseName(name: string): string {
  return name
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/\s+[\u2013\u2014-]\s+/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Comments and separators carry no cards. */
function isNoise(line: string): boolean {
  if (!line) return true;
  if (/^[#/;]/.test(line)) return true; // # comment, // comment, ; comment
  if (/^[-=_*\s]+$/.test(line)) return true; // rules and separators
  return false;
}

/**
 * Is this line a section header, and if so which section does it open?
 *
 * Headers appear with and without a colon, so a bare "Sideboard" counts. Only sideboard
 * is distinguished: "Legend:", "Units:" and the rest all describe parts of the main deck,
 * and a list that separates its sideboard only by a blank line is not detectable, so it
 * is read as one deck rather than guessed at.
 */
function sectionHeader(line: string): { section: Section } | { section: null } | null {
  const hasColon = /:$/.test(line);
  const word = line.replace(/:$/, "").trim().toLowerCase();
  if (!word) return null;
  if (/^(side\s*board|sb)$/.test(word)) return { section: "sideboard" };
  if (
    hasColon ||
    /^(main(\s*deck)?|deck|legend|champions?|battlefields?|units?|spells?|gear|runes?)$/.test(word)
  ) {
    return { section: "main" };
  }
  return null;
}

/** Trailing set/collector annotations: "(OGN)", "[OGN-007]", "*F*", "OGN-007". */
function stripAnnotations(name: string): string {
  return name
    .replace(/\s*\*[A-Za-z]\*\s*$/, "")
    .replace(/\s*[([{][^)\]}]*[)\]}]\s*$/, "")
    .replace(/\s+[A-Z]{2,4}-\w+(?:\/\d+)?\s*$/, "")
    .trim();
}

export function parseDecklist(text: string): ParsedDecklist {
  const totals = new Map<string, DeckEntry>();
  const ignored: string[] = [];
  let section: Section = "main";
  let hasSideboard = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (isNoise(line)) continue;

    const header = sectionHeader(line);
    if (header?.section) {
      section = header.section;
      if (section === "sideboard") hasSideboard = true;
      continue;
    }

    let quantity: number | null = null;
    let name: string | null = null;

    // "3 Card Name", "3x Card Name", "3 x Card Name"
    let m = /^(\d{1,3})\s*[xX]?\s+(.+)$/.exec(line);
    if (m) {
      quantity = Number(m[1]);
      name = m[2];
    } else {
      // "Card Name x3", "Card Name X3"
      m = /^(.+?)\s+[xX](\d{1,3})$/.exec(line);
      if (m) {
        name = m[1];
        quantity = Number(m[2]);
      } else if (/[A-Za-z]/.test(line)) {
        // A bare name means one copy.
        name = line;
        quantity = 1;
      }
    }

    if (name === null || quantity === null || quantity < 1) {
      ignored.push(raw);
      continue;
    }

    name = normaliseName(stripAnnotations(name));
    if (!name) {
      ignored.push(raw);
      continue;
    }

    // The same card can appear on several lines and in both sections; sum per section.
    const key = name.toLowerCase();
    const seen = totals.get(key) ?? { name, main: 0, sideboard: 0 };
    if (section === "sideboard") seen.sideboard += quantity;
    else seen.main += quantity;
    totals.set(key, seen);
  }

  return { entries: [...totals.values()], ignored, hasSideboard };
}
