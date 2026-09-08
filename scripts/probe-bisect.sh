#!/usr/bin/env bash
#
# `make doctor` (SET ROLE, plain insert) succeeds where `make doctor-app` (real app_user
# connection, avatar_url, ON CONFLICT) fails. Three things differ. This runs the variants
# one at a time as app_user so exactly one of them is to blame.
set -euo pipefail
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${APP_USER_PASSWORD:?APP_USER_PASSWORD is not set in .env}"

docker compose exec -T -e PGPASSWORD="$APP_USER_PASSWORD" db \
  psql -U app_user -d "${POSTGRES_DB:-riftbound}" <<'SQL'
\set ON_ERROR_STOP off
\set ON_ERROR_ROLLBACK on
\pset border 2

\echo ''
\echo '=== every policy on person (a RESTRICTIVE one would AND with the rest) ==='
select polname,
       case polcmd when 'r' then 'select' when 'a' then 'insert'
                   when 'w' then 'update' when 'd' then 'delete' else 'all' end as command,
       polpermissive as permissive,
       pg_get_expr(polqual, polrelid)      as using_expr,
       pg_get_expr(polwithcheck, polrelid) as with_check
  from pg_policy where polrelid = 'person'::regclass order by polname;

\echo '=== can app_user execute the functions the policy calls? ==='
select has_function_privilege('app_user', 'current_discord_id()', 'execute') as exec_discord,
       has_function_privilege('app_user', 'current_person()', 'execute')     as exec_person;

begin;
select set_config('app.discord_id', 'bisect', true) as asserted;

\echo ''
\echo '--- A: minimal insert (this is what make doctor does) ---'
insert into person (discord_id, display_name) values ('bisect', 'A');

\echo '--- B: plus avatar_url ---'
insert into person (discord_id, display_name, avatar_url) values ('bisect-b', 'B', null);

\echo '--- C: minimal plus ON CONFLICT ---'
insert into person (discord_id, display_name) values ('bisect-c', 'C')
on conflict (discord_id) do nothing;

\echo '--- D: the full statement lib/db.ts uses ---'
insert into person (discord_id, display_name, avatar_url) values ('bisect-d', 'D', null)
on conflict (discord_id) do nothing;

\echo '--- E: state and role written out explicitly ---'
insert into person (discord_id, display_name, state, role)
values ('bisect-e', 'E', 'pending', 'member');

rollback;
\echo ''
\echo 'rolled back; nothing kept.'
SQL
