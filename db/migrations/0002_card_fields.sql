-- Fields the official feed carries that 0001 did not model.
--
-- `might` and `tags` appear only on unit cards, which is why they were missed: the card
-- sampled when 0001 was written was a spell. Both are nullable for that reason.
--
-- `rules_text` is the normalised plain-text rendering used for collision detection when
-- minting card ids. It is NOT the text to display: Riot's policy requires the official
-- text, which is `rules_html`, shown unmodified. See docs/design.md 1.5.

alter table card add column might      int;
alter table card add column tags       text[] not null default '{}';
alter table card add column rules_text text;

comment on column card.rules_html is
    'Official card text, verbatim from Riot''s feed. Display this, unmodified.';
comment on column card.rules_text is
    'Normalised plain text: tags stripped, parenthetical reminder text removed. Used to
     detect whether two printings sharing a name are really the same card. Never shown.';
