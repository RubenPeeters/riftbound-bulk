-- Does the append-only ledger fold to the right holdings?
--
-- Collection entry is the first thing that writes transfer_event, so this exercises the
-- arithmetic the whole project rests on: acquire, correct downwards, lend, and the
-- separation of ownership from possession. Rolls back; leaves nothing.
--
--   make check-ledger

\set ON_ERROR_STOP on
\pset border 2
begin;

insert into person (discord_id, display_name, state, approved_at)
values ('ledger-a', 'Ledger A', 'approved', now()) returning id as a \gset
insert into person (discord_id, display_name, state, approved_at)
values ('ledger-b', 'Ledger B', 'approved', now()) returning id as b \gset
select id as pr from printing order by id limit 1 \gset

\echo ''
\echo '=== acquire 4: expect A holds 4 ==='
insert into transfer_event
  (kind, printing_id, finish, quantity, condition, owner_id, to_id, recorded_by)
values ('acquire', :'pr', 'normal', 4, 'NM', :'a', :'a', :'a');
select holder_id = :'a' as held_by_a, quantity from holding where owner_id = :'a';

\echo '=== correct downwards by 3: expect A holds 1 ==='
insert into transfer_event
  (kind, printing_id, finish, quantity, condition, owner_id, from_id, recorded_by, note)
values ('stocktake', :'pr', 'normal', 3, 'NM', :'a', :'a', :'a', 'ledger check');
select holder_id = :'a' as held_by_a, quantity from holding where owner_id = :'a';

\echo '=== lend that 1 to B: ownership must NOT move ==='
insert into transfer_event
  (kind, printing_id, finish, quantity, condition, owner_id, from_id, to_id, recorded_by)
values ('lend', :'pr', 'normal', 1, 'NM', :'a', :'a', :'b', :'a');

\echo 'expect one row: owner A, holder B, quantity 1'
select owner_id = :'a' as owned_by_a, holder_id = :'b' as held_by_b, quantity
  from holding where owner_id = :'a';

\echo 'expect the same row in outstanding_loan (the question the project exists to answer)'
select owner_id = :'a' as owner_a, holder_id = :'b' as holder_b, quantity
  from outstanding_loan where owner_id = :'a';

\echo 'expect B owns nothing: possession moved, ownership did not'
select count(*) as b_owns from holding where owner_id = :'b';

\echo '=== return it: expect A holds 1 again, no outstanding loan ==='
insert into transfer_event
  (kind, printing_id, finish, quantity, condition, owner_id, from_id, to_id, recorded_by)
values ('return', :'pr', 'normal', 1, 'NM', :'a', :'b', :'a', :'b');
select holder_id = :'a' as held_by_a, quantity from holding where owner_id = :'a';
select count(*) as still_out from outstanding_loan where owner_id = :'a';

rollback;
\echo ''
\echo 'rolled back; nothing kept.'
