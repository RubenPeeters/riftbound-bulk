-- Acknowledge a loan, not forty events.
--
-- 0001 keyed acknowledgement to a single transfer_event, which is the right grain for
-- correcting one movement but the wrong one for a loan: you lend a deck, and asking the
-- borrower to confirm each card separately guarantees nobody confirms anything. The
-- design said as much (docs/design.md 1.9) and the table did not follow.
--
-- An acknowledgement now attaches to exactly one of an event or a loan_transaction. The
-- primary key becomes two partial unique indexes, since neither column is always present.

alter table acknowledgement add column transaction_id uuid references loan_transaction (id);

-- The primary key goes first: a column cannot be made nullable while it is still part of
-- one, and event_id has to become nullable for a transaction-scoped acknowledgement.
alter table acknowledgement drop constraint acknowledgement_pkey;
alter table acknowledgement alter column event_id drop not null;

alter table acknowledgement add constraint ack_subject check (
    (event_id is not null and transaction_id is null)
 or (transaction_id is not null and event_id is null)
);

create unique index acknowledgement_event_person
    on acknowledgement (event_id, person_id) where event_id is not null;
create unique index acknowledgement_transaction_person
    on acknowledgement (transaction_id, person_id) where transaction_id is not null;

comment on table acknowledgement is
    'One person''s position on a loan or a correction. Absence means unconfirmed, which is
     shown rather than assumed: the schema''s job is to make disagreement visible, not to
     decide who is right.';
