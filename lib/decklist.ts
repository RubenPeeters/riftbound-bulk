/**
 * Parse a pasted decklist.
 *
 * There is no single decklist format, and Riftbound's is not documented anywhere I could
 * check, so this accepts the shapes that TCG exports and forum posts generally use rather
 * than committing to one. Anything it cannot read is returned in `ignored` and shown to
 * the user: silently dropping a line would understate what you are missing, which is the
 * one error this feature must not make.
 */

export interface DeckEntry {
  name: string;
  quantity: number;
}

export interface ParsedDecklist {
  entries: DeckEntry[];
  ignored: string[];
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

/** Section headers, comments and separators carry no cards. */
function isNoise(line: string): boolean {
  if (!line) return true;
  if (/^[#/;]/.test(line)) return true; // # comment, // comment, ; comment
  if (/^[-=_*\s]+$/.test(line)) return true; // rules and separators
  if (/:$/.test(line)) return true; // "Main Deck:", "Legend:"
  return false;
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
  const totals = new Map<string, { name: string; quantity: number }>();
  const ignored: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (isNoise(line)) continue;

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

    // The same card can appear on several lines; sum rather than overwrite.
    const key = name.toLowerCase();
    const seen = totals.get(key);
    if (seen) seen.quantity += quantity;
    else totals.set(key, { name, quantity });
  }

  return { entries: [...totals.values()], ignored };
}
