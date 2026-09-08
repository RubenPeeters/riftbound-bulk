"""Independent recomputation of allocate_lend(), used to cross-check the SQL.

The SQL function in db/migrations/0001_init.sql is the single source of truth for
the allocation policy. This file is not a second implementation to be kept in sync: it is
an oracle that re-derives the expected answer from the stated rule, so that the SQL can
be checked against something that was not written by reading the SQL.

The rule (docs/design.md 1.3): when a lender holds physically indistinguishable copies
owned by several people, spend own stock first, then borrowed stock oldest loan first,
with owner id as a final tiebreak so the ordering is total and the result deterministic.

Run: make allocation-oracle
"""


def allocate(holdings, lender, requested):
    """holdings: [(owner, quantity, since)]. Returns [(owner, quantity)] to debit.

    Mirrors the SQL's `order by borrowed, since, owner_id` and its greedy running total.
    A returned sum below `requested` means the lender does not hold enough and the lend
    must be refused (invariant 3).
    """
    rows = sorted(
        [h for h in holdings if h[1] > 0],
        key=lambda h: (h[0] != lender, h[2], str(h[0])),
    )
    out, cumulative = [], 0
    for owner, quantity, _since in rows:
        before, cumulative = cumulative, cumulative + quantity
        if before < requested:
            out.append((owner, min(quantity, requested - before)))
    return out


CASES = [
    (
        "worked example: Bob holds 1 own + 1 of Ruben's, lends 1",
        [("bob", 1, 0), ("ruben", 1, 5)], "bob", 1,
        [("bob", 1)],
    ),
    (
        "lends 2: own stock spent first, then Ruben's",
        [("bob", 1, 0), ("ruben", 1, 5)], "bob", 2,
        [("bob", 1), ("ruben", 1)],
    ),
    (
        "lender holds only borrowed stock",
        [("ruben", 3, 5)], "bob", 2,
        [("ruben", 2)],
    ),
    (
        "two lenders: the oldest loan moves on, not the alphabetically first",
        [("bob", 2, 0), ("ruben", 2, 1), ("carla", 2, 9)], "bob", 3,
        [("bob", 2), ("ruben", 1)],
    ),
    (
        "requests more than held: short sum, caller must refuse the lend",
        [("bob", 1, 0)], "bob", 4,
        [("bob", 1)],
    ),
    (
        "identical loan dates: owner id breaks the tie deterministically",
        [("ruben", 1, 3), ("carla", 1, 3)], "bob", 2,
        [("carla", 1), ("ruben", 1)],
    ),
]


def main():
    failures = 0
    for name, holdings, lender, requested, expected in CASES:
        got = allocate(holdings, lender, requested)
        ok = got == expected
        failures += not ok
        print(f"{'PASS' if ok else 'FAIL'}  {name}")
        print(f"      got {got}")
        if not ok:
            print(f"      expected {expected}")
        short = requested - sum(q for _, q in got)
        if short > 0:
            print(f"      -> short by {short}: lend refused (invariant 3)")
    print("\nall pass" if not failures else f"\n{failures} FAILURE(S)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
