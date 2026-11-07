-- legacy_carry was created by migration 004 but no code reads or writes it; the
-- reset baseline lives in legacy_reset_baseline and legacy_raw_highwater.
DROP TABLE IF EXISTS legacy_carry;
