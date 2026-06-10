-- Counselle role & schema bootstrap (Phase 2 Step 0 — run ONCE by the orchestrator
-- via the pipeline's admin psql; passwords substituted at run time with -v).
-- ADR 0012 (read-only role), ADR 0019 (counselle-owned schema).

-- Roles
CREATE ROLE counselle_ro LOGIN PASSWORD :'ro_pw';
CREATE ROLE counselle_app LOGIN PASSWORD :'app_pw';
ALTER ROLE counselle_ro SET default_transaction_read_only = on;
ALTER ROLE counselle_ro SET statement_timeout = '8s';

-- Read grants (DATABASE_GUIDE §3/§8: public read model + the multi-row & dict
-- & provenance raw tables)
GRANT USAGE ON SCHEMA public, raw TO counselle_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO counselle_ro;
GRANT SELECT ON raw.scorecard_fos, raw.ipeds_ef2024a, raw.ipeds_valuesets24,
               raw.ipeds_vartable24, raw.files, raw.ipeds_hd2024, raw.ipeds_flags2024
       TO counselle_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO counselle_ro;

-- Counselle's own schema (ADR 0019)
CREATE SCHEMA counselle AUTHORIZATION counselle_app;
GRANT USAGE ON SCHEMA counselle TO counselle_ro;

-- pgvector availability check (informational, recorded for Phase 3)
SELECT count(*) AS pgvector_available FROM pg_available_extensions WHERE name = 'vector';
