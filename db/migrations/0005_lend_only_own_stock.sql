-- You may only lend cards you own.
--
-- Group decision: re-lending requires asking the owner. This encodes it in the simplest
-- enforceable way. If Bob holds Ruben's card and Carla wants it, Bob cannot record that
-- transfer at all: Ruben records it, and Ruben recording it IS the consent. No separate
-- request-and-approve flow is needed to make the rule real.
--
-- A CHECK rather than a policy, so it binds the owner role and the loader too, not only
-- app_user. Only `lend` is constrained: a `return` legitimately has from_id set to the
-- borrower while ownership stays with the lender.
--
-- Consequence worth knowing (docs/design.md 1.3): with re-lending forbidden, a lend can
-- only ever move the lender's own stock, so the "whose stock moves" ambiguity that
-- allocate_lend() exists to resolve cannot arise on this path.

alter table transfer_event
    add constraint lend_only_own_stock
    check (kind <> 'lend' or owner_id = from_id);

comment on constraint lend_only_own_stock on transfer_event is
    'Re-lending requires the owner to record the transfer, which is how consent is
     demonstrated. Relaxing this means building a request-and-acknowledge flow first.';
