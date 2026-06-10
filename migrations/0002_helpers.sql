-- Escape-hatch helper functions for Layer 3 (ARCHITECTURE §8 L3)
-- decode_ipeds: valuesets store bare table names (verified live 2026-06-10:
-- "TableName" values are e.g. HD2024 / ADM2024, no raw.ipeds_ prefix).
-- depends: 0001_sessions

-- counselle_app (the migration role) has no USAGE on schema raw — only
-- counselle_ro does (Step 0 grants). Skip body validation at CREATE time;
-- the body is checked at call time with the caller's (counselle_ro) grants.
SET check_function_bodies = off;

CREATE FUNCTION counselle.decode_ipeds(p_table text, p_column text, p_code text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT "ValueLabel" FROM raw.ipeds_valuesets24
  WHERE lower("TableName") = lower(replace(p_table,'raw.ipeds_',''))
    AND lower("VarName") = lower(p_column) AND "Codevalue" = p_code LIMIT 1 $$;

CREATE FUNCTION counselle.value_vintage(p_unitid int, p_field_key text)
RETURNS TABLE(source text, cycle_year int, file_name text, db_loaded_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT fv.source, fv.cycle_year, rf.filename, rf.downloaded_at
  FROM field_values fv JOIN raw.files rf ON rf.id = fv.raw_file_id
  WHERE fv.unitid = p_unitid AND fv.field_key = p_field_key $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA counselle TO counselle_ro;
