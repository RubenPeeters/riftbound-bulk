-- Does row-level security actually deny? Everything in this project rests on it, so it
-- gets asserted rather than assumed.
--
-- Runs entirely inside a transaction that rolls back, so it leaves no trace: the probe
-- person and its approval are discarded.
--
--   make check-rls

\set ON_ERROR_STOP on
begin;

insert into person (discord_id, display_name)
values ('rls-probe', 'RLS Probe')
returning id as probe \gset

\echo ''
\echo '=== privileges (verb level, independent of policies) ==='
\echo 'expect: insert t, update f, delete f  -- the ledger is append-only'
select has_table_privilege('app_user', 'transfer_event', 'INSERT') as ins,
       has_table_privilege('app_user', 'transfer_event', 'UPDATE') as upd,
       has_table_privilege('app_user', 'transfer_event', 'DELETE') as del;

set local role app_user;

\echo '=== no identity asserted: must fail closed ==='
\echo 'expect 0 cards, 0 people'
select (select count(*) from card) as cards, (select count(*) from person) as people;

set local app.person_id = :'probe';

\echo '=== pending member: sees nothing but itself ==='
\echo 'expect 0 cards, 1 person'
select (select count(*) from card) as cards, (select count(*) from person) as people;

reset role;
update person set state = 'approved', approved_at = now() where id = :'probe';
set local role app_user;
set local app.person_id = :'probe';

\echo '=== approved member: sees the whole index ==='
\echo 'expect 1189 printings, 1 person visible so far'
select (select count(*) from printing) as printings, (select count(*) from person) as people;

reset role;
rollback;
\echo ''
\echo 'rolled back: the probe person was not kept.'
