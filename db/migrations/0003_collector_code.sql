-- The collector number on a Riftbound card is not a number.
--
-- 0001 stored it as an int and made (expansion, collector_number, language) unique. The
-- feed's own `collectorNumber` field is indeed an int, which is what made that look
-- right, but 162 of 1189 printings collide under it: OGN-007 and OGN-007a are both
-- collector number 7, and the alternate-art suffix is the only thing separating them.
-- Others carry no plain number at all (VEN-R04, SFD-T03, VEN-SP6) or a star (SFD-232*).
--
-- So the printed designator gets its own column. collector_number stays for sorting,
-- because "7" orders correctly against "10" and "007a" does not.

alter table printing add column collector_code text;

-- Backfill from printed_code ('OGN-007a/298' -> '007a', 'VEN-R04' -> 'R04'): strip the
-- leading set prefix and the trailing set total.
update printing
   set collector_code = regexp_replace(regexp_replace(printed_code, '^[A-Za-z]+-', ''), '/\d+$', '')
 where collector_code is null and printed_code is not null;

alter table printing drop constraint if exists
    printing_expansion_code_collector_number_language_code_key;

alter table printing alter column collector_code set not null;
alter table printing add constraint printing_designator_unique
    unique (expansion_code, collector_code, language_code);

comment on column printing.collector_code is
    'The designator as printed: 007a, R04, T03, SP6, 232*. Unique within a set and
     language. collector_number is the numeric part, kept only so sorting works.';
