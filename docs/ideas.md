- add option to copy a decklist, and see which cards you are missing.
- link to riftbound.gg, riftdecks.gg to check which one of the decks you can make
- show prices of the decks you own
- save your own decks, which can be shared with others
- 
---

## Notes on the above (Claude, 2026-09-09)

All four read the ledger rather than change it, so none of them need schema beyond a
`deck` / `deck_slot` pair, which is already sketched in the class diagram in
[design.md](design.md).

**Decklist paste, showing what you are missing.** The most valuable of the four, and not
only for the stated reason: it is also the fastest way to *enter* a collection. Pasting a
list you own beats clicking three hundred steppers, so this doubles as a bulk-entry path
and takes pressure off `/collection`. The query is a diff between deck slots and
`holding`, resolving card names against `card.name`. Name resolution is the fiddly part,
since a list may not use the exact printed name.

**riftbound.gg / riftdecks.gg, which decks you can build.** The same query as the above,
run from the other end: instead of one list against your collection, every list against
your collection, ordered by how few cards are missing. Build the first and this is nearly
free. The open question is whether those sites expose deck lists in any parseable form.
Worth checking before committing, since scraping rendered HTML would be the most fragile
thing in the repo, and unlike Riot's card feed it could not be vendored, because the deck
lists change constantly.

**Deck prices.** Needs Cardmarket, the one paid dependency in the whole project.
Everything else works without it. Prices are already modelled as timestamped snapshots
with a source, deliberately not treated as authoritative: their real job is answering
"how much do I care that this never came back", which makes them more useful to the loan
ledger than to deck valuation.

**Save and share decks.** Inside the group this is free. Sharing outward is the first
feature that would escape the approval gate, so it needs a deliberate decision about what
a non-member can see: presumably a deck list, never a collection or a loan. That is a new
policy on a new table, not a relaxation of an existing one.

### Ordering

`decklist paste` first. It is the only one that makes the existing product materially
better rather than adding a new surface, and it makes collection entry, currently the
riskiest part of the project, much less of a chore.
