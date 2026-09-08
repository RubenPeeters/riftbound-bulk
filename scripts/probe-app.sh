#!/usr/bin/env bash
#
# Run the registration insert exactly as the application does: a real connection as
# app_user (not `set role`), with the same ON CONFLICT clause. `make doctor`'s probe
# differs in both respects, which is enough to make it disagree.
#
#   make doctor-app
set -euo pipefail
if [ -f .env ]; then set -a; . ./.env; set +a; fi

: "${APP_USER_PASSWORD:?APP_USER_PASSWORD is not set in .env}"
ID=${1:-probe-app-user}

docker compose exec -T -e PGPASSWORD="$APP_USER_PASSWORD" db \
  psql -v ON_ERROR_STOP=0 -U app_user -d "${POSTGRES_DB:-riftbound}" <<SQL
\\set ON_ERROR_STOP off
\\echo '=== connected as (should be app_user, and bypass_rls false) ==='
select current_user, session_user;

begin;
select set_config('app.discord_id', '$ID', true) as asserted;
\\echo '=== what the policy will evaluate ==='
select current_discord_id() as current_discord_id,
       current_discord_id() is not null as is_not_null;

\\echo '=== the insert, verbatim from lib/db.ts ==='
insert into person (discord_id, display_name, avatar_url)
values ('$ID', 'Probe App User', null)
on conflict (discord_id) do nothing;
\\echo '--> insert SUCCEEDED'
rollback;
SQL
