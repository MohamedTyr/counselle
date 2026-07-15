-- Retire old-reader helpers and vector index after DB rewire.
-- depends: 0011_school_workspace

DROP FUNCTION IF EXISTS counselle.decode_ipeds(text, text, text);
DROP FUNCTION IF EXISTS counselle.value_vintage(integer, text);
DROP TABLE IF EXISTS counselle.field_index;
