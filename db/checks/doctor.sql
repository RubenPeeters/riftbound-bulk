-- What state is this database actually in?
--
-- Read-only: the one write is a registration probe inside a transaction that rolls back.
--
--   make doctor

-- Diagnostics must report failures, not abort on the first one.
\set ON_ERROR_STOP off
\pset border 2
\echo ''
\echo '=== migrations applied ==='
select filename, applied_at from schema_migrations order by filename;

\echo '=== app_user: does it exist, and does it have a password? ==='
select rolname,
       rolcanlogin                   as can_login,
       rolpassword is not null       as has_password,
       rolbypassrls                  as bypasses_rls
  from pg_authid where rolname = 'app_user';

\echo '=== identity functions (0004 replaces current_person) ==='
select p.proname,
       p.prosecdef as security_definer,
       pg_get_function_result(p.oid) as returns
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('current_person', 'current_discord_id', 'is_member', 'is_admin', 'me')
 order by p.proname;

\echo '=== register_self policy: must mention current_discord_id(), not current_person() ==='
select pg_get_expr(polwithcheck, polrelid) as with_check
  from pg_policy where polname = 'register_self';

\echo '=== does the printing uniqueness use collector_code (0003)? ==='
select conname from pg_constraint
 where conrelid = 'printing'::regclass and contype = 'u';

\echo '=== row counts (as owner, so RLS does not apply) ==='
select (select count(*) from expansion) as sets,
       (select count(*) from card)      as cards,
       (select count(*) from printing)  as printings,
       (select count(*) from person)    as people;

\echo ''
\echo '=== registration probe: exactly what the app does at first sign-in ==='
\echo 'If this fails, the policy is the problem. If it succeeds, the policy is fine and'
\echo 'the app is not asserting app.discord_id (stale image, or an old build).'
begin;
set local role app_user;
select set_config('app.discord_id', 'doctor-probe', true) as asserted;
insert into person (discord_id, display_name) values ('doctor-probe', 'Doctor Probe');
\echo '--> registration insert SUCCEEDED (policy is correct)'
rollback;
\echo ''
\echo 'probe rolled back; nothing was kept.'
