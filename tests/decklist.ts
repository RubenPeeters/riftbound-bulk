/**
 * Checks for the decklist parser. Pure input to output, so this runs anywhere:
 *   make check-decklist
 */
import { parseDecklist } from "../lib/decklist";

interface Case {
  name: string;
  input: string;
  entries: [string, number][];
  ignored?: number;
}

const CASES: Case[] = [
  { name: "leading count", input: "3 Void Gate", entries: [["Void Gate", 3]] },
  { name: "leading count with x", input: "3x Void Gate", entries: [["Void Gate", 3]] },
  { name: "leading count, spaced x", input: "2 x Void Gate", entries: [["Void Gate", 2]] },
  { name: "trailing count", input: "Void Gate x4", entries: [["Void Gate", 4]] },
  { name: "bare name is one copy", input: "Void Gate", entries: [["Void Gate", 1]] },
  {
    name: "comments and section headers ignored",
    input: "# my deck\nMain Deck:\n---\n2 Void Gate\n// end",
    entries: [["Void Gate", 2]],
  },
  {
    name: "set annotations stripped",
    input: "1 Void Gate (OGN)\n1 Akali, Deadly Weapon [VEN-021]\n1 Baron Nashor *F*",
    entries: [
      ["Void Gate", 1],
      ["Akali, Deadly Weapon", 1],
      ["Baron Nashor", 1],
    ],
  },
  {
    name: "trailing collector code stripped",
    input: "2 Void Gate OGN-296/298",
    entries: [["Void Gate", 2]],
  },
  {
    name: "repeated card summed, not overwritten",
    input: "2 Void Gate\n1 Void Gate",
    entries: [["Void Gate", 3]],
  },
  {
    name: "case-insensitive when summing, first spelling kept",
    input: "1 Void Gate\n2 VOID GATE",
    entries: [["Void Gate", 3]],
  },
  {
    name: "commas in names survive",
    input: "3 Akali, Deadly Weapon",
    entries: [["Akali, Deadly Weapon", 3]],
  },
  { name: "blank input", input: "\n\n   \n", entries: [] },
  {
    name: "spaced dash becomes a comma (legend written as champion - epithet)",
    input: "1 Lee Sin - Blind Monk\n1 Ahri \u2014 Nine-Tailed Fox",
    entries: [
      ["Lee Sin, Blind Monk", 1],
      ["Ahri, Nine-Tailed Fox", 1],
    ],
  },
  {
    name: "hyphen inside a name is left alone",
    input: "1 Nine-Tailed Fox",
    entries: [["Nine-Tailed Fox", 1]],
  },
  {
    name: "sideboard header skipped, and its copies added to the main deck",
    input: "1 Charm\n2 Disarming Rake\nSideboard:\n1 Charm\n1 Disarming Rake",
    entries: [
      ["Charm", 2],
      ["Disarming Rake", 3],
    ],
  },
  {
    name: "legend written as champion, epithet (from a real list)",
    input: "1 Lillia, Bashful Bloom\n1 Lillia, Fae Fawn",
    entries: [
      ["Lillia, Bashful Bloom", 1],
      ["Lillia, Fae Fawn", 1],
    ],
  },
  {
    name: "curly apostrophe folded to straight",
    input: "1 Kai\u2019Sa, Daughter of the Void",
    entries: [["Kai'Sa, Daughter of the Void", 1]],
  },
];

let failures = 0;
for (const c of CASES) {
  const got = parseDecklist(c.input);
  const actual = got.entries.map((e) => [e.name, e.quantity] as [string, number]);
  const ok =
    JSON.stringify(actual) === JSON.stringify(c.entries) &&
    (c.ignored === undefined || got.ignored.length === c.ignored);
  failures += ok ? 0 : 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
  if (!ok) {
    console.log(`      got      ${JSON.stringify(actual)}  ignored=${got.ignored.length}`);
    console.log(`      expected ${JSON.stringify(c.entries)}`);
  }
}
console.log(failures ? `\n${failures} FAILURE(S)` : "\nall pass");
process.exit(failures ? 1 : 0);
