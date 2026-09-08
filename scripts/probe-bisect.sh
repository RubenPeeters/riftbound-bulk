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

-- Each variant asserts its OWN id. Asserting once and then inserting different ids makes
-- every variant fail on `discord_id = current_discord_id()`, which is the policy behaving
-- correctly and tells us nothing about the statement shape.

\echo ''
\echo '--- A: minimal insert (what make doctor does) ---'
select set_config('app.discord_id', 'bisect-a', true) as asserted;
insert into person (discord_id, display_name) values ('bisect-a', 'A');

\echo '--- B: plus avatar_url ---'
select set_config('app.discord_id', 'bisect-b', true) as asserted;
insert into person (discord_id, display_name, avatar_url) values ('bisect-b', 'B', null);

\echo '--- C: minimal plus ON CONFLICT ---'
select set_config('app.discord_id', 'bisect-c', true) as asserted;
insert into person (discord_id, display_name) values ('bisect-c', 'C')
on conflict (discord_id) do nothing;

\echo '--- D: the full statement lib/db.ts uses ---'
select set_config('app.discord_id', 'bisect-d', true) as asserted;
insert into person (discord_id, display_name, avatar_url) values ('bisect-d', 'D', null)
on conflict (discord_id) do nothing;

\echo '--- E: state and role written out explicitly ---'
select set_config('app.discord_id', 'bisect-e', true) as asserted;
insert into person (discord_id, display_name, state, role)
values ('bisect-e', 'E', 'pending', 'member');

\echo '--- F: parameterised, as the pg driver sends it ---'
prepare ins (text, text, text) as
  insert into person (discord_id, display_name, avatar_url) values ($1, $2, $3)
  on conflict (discord_id) do nothing;
select set_config('app.discord_id', 'bisect-f', true) as asserted;
execute ins ('bisect-f', 'F', null);

\echo '--- G: read-then-insert, which is what lib/db.ts now does ---'
select set_config('app.discord_id', 'bisect-g', true) as asserted;
select 1 from person where discord_id = 'bisect-g';
insert into person (discord_id, display_name, avatar_url) values ('bisect-g', 'G', null);

\echo '--- H: G again, with the row already present (the repeat-login path) ---'
select 1 from person where discord_id = 'bisect-g';

\echo ''
\echo '=== what survived (only the variants that passed) ==='
select discord_id, display_name from person where discord_id like 'bisect-%' order by 1;

rollback;
\echo ''
\echo 'rolled back; nothing kept.'
SQL
