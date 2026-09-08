#!/usr/bin/env bash
#
# Apply db/migrations/*.sql exactly once each, in filename order.
#
# Each migration and the record of having applied it go in as ONE transaction, so a
# failure leaves neither a half-applied schema nor a false record. Files already recorded
# are skipped, which is what makes `make db-migrate` safe to re-run.
set -euo pipefail

# Credentials come from .env; these are the OWNER, which bypasses RLS by design.
if [ -f .env ]; then set -a; . ./.env; set +a; fi

PSQL=(docker compose exec -T db psql -v ON_ERROR_STOP=1 \
      -U "${POSTGRES_USER:-riftbound}" -d "${POSTGRES_DB:-riftbound}")

"${PSQL[@]}" -q -c "create table if not exists schema_migrations (
    filename   text primary key,
    applied_at timestamptz not null default now()
)"

applied=$("${PSQL[@]}" -tAc "select filename from schema_migrations" || true)

pending=0
for f in db/migrations/*.sql; do
    n=$(basename "$f")
    if grep -qxF "$n" <<<"$applied"; then
        printf '   skip   %s\n' "$n"
        continue
    fi
    printf '-> apply  %s\n' "$n"
    {
        cat "$f"
        printf "\ninsert into schema_migrations (filename) values ('%s');\n" "$n"
    } | "${PSQL[@]}" --single-transaction -f -
    pending=$((pending + 1))
done

if [ "$pending" -eq 0 ]; then
    echo "database is up to date"
else
    echo "applied $pending migration(s)"
fi
