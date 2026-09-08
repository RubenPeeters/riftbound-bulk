-- Assert the Discord id, not the person id.
--
-- 0001 had the application assert `app.person_id` and resolve everything from it. That
-- cannot express first login: a brand-new user has no person row, so current_person() is
-- null, and the register_self policy's `id = current_person()` can never be satisfied.
-- Finding an existing row by discord_id was equally impossible, because reading `person`
-- requires already knowing which row is yours.
--
-- The Discord id is the better thing to assert anyway: it is what the OAuth exchange
-- actually verifies, and it exists before any row does. Postgres resolves it to a person.
--
-- The trust story is unchanged: the application still asserts, Postgres still believes
-- it, and RLS remains defence in depth rather than a cryptographic boundary. What changes
-- is only which identifier is passed. See docs/design.md 3.

create or replace function current_discord_id() returns text
language sql stable as $$
    select nullif(current_setting('app.discord_id', true), '');
$$;

-- Now a lookup rather than a cast. security definer so it can read `person` regardless
-- of the policies that are themselves defined in terms of it.
create or replace function current_person() returns uuid
language sql stable security definer set search_path = public as $$
    select id from person where discord_id = current_discord_id();
$$;

-- Registration keys on the asserted Discord id, since the row's own id cannot be known
-- before it exists. Still no self-approval and no self-promotion.
drop policy register_self on person;
create policy register_self on person for insert
    with check (
        discord_id = current_discord_id()
        and current_discord_id() is not null
        and state = 'pending'
        and role  = 'member'
        and approved_at is null
        and approved_by is null
    );

grant execute on function current_discord_id() to app_user;
