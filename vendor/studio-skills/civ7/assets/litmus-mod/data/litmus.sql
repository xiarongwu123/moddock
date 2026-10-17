-- Litmus probe: an obvious, immediately-visible change so you can tell at a glance
-- whether the mod actually applied. If maps suddenly have lots of natural wonders,
-- your load/deploy pipeline works.
UPDATE Maps SET NumNaturalWonders = 20;
