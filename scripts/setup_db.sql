-- Counselle role & schema bootstrap for the counselle_data (CDS Library) database.
-- Idempotent: safe to rerun. Passwords are read from the environment, never argv.
-- ADR 0012 (read-only role), ADR 0019 (counselle-owned schema), ADR 0032 (db-rewire).

\set ON_ERROR_STOP on
\set counselle_ro_password ''
\set counselle_app_password ''
\getenv counselle_ro_password COUNSELLE_RO_PASSWORD
\getenv counselle_app_password COUNSELLE_APP_PASSWORD
SELECT nullif(:'counselle_ro_password', '') IS NOT NULL AS ro_password_present,
       nullif(:'counselle_app_password', '') IS NOT NULL AS app_password_present \gset
-- \quit takes no exit-code argument in psql 16, so a missing password is
-- enforced as a real SQL error under ON_ERROR_STOP, not a silent \quit.
\if :ro_password_present
\else
  DO $$ BEGIN RAISE EXCEPTION 'COUNSELLE_RO_PASSWORD is required'; END $$;
\endif
\if :app_password_present
\else
  DO $$ BEGIN RAISE EXCEPTION 'COUNSELLE_APP_PASSWORD is required'; END $$;
\endif

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'counselle_ro') THEN
    CREATE ROLE counselle_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'counselle_app') THEN
    CREATE ROLE counselle_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

SELECT format('ALTER ROLE counselle_ro PASSWORD %L', :'counselle_ro_password') \gexec
SELECT format('ALTER ROLE counselle_app PASSWORD %L', :'counselle_app_password') \gexec

-- Read role: the five cds_library reader views only, read-only session defaults.
GRANT cds_library_reader TO counselle_ro;
ALTER ROLE counselle_ro SET default_transaction_read_only = on;
ALTER ROLE counselle_ro SET statement_timeout = '8s';
ALTER ROLE counselle_ro IN DATABASE counselle_data
  SET search_path = cds_library, pg_catalog;

-- App role: owns the counselle schema, no pipeline membership.
CREATE SCHEMA IF NOT EXISTS counselle AUTHORIZATION counselle_app;
ALTER SCHEMA counselle OWNER TO counselle_app;
ALTER ROLE counselle_app IN DATABASE counselle_data
  SET search_path = counselle, pg_catalog;
REVOKE ALL ON SCHEMA counselle FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA counselle TO counselle_app;
