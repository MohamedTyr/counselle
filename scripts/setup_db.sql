-- Counselle role & schema bootstrap for the connected CDS Library database.
-- Idempotent: safe to rerun. Passwords are read from the environment, never argv.
-- ADR 0012 (read-only role), ADR 0019 (counselle-owned schema), ADR 0032 (db-rewire),
-- ADR 0038 (school-data-v3: the CollegeData facts store; cds_library_app is
-- repurposed to drive the facts crawler, mutually exclusive with the parked
-- CDS extraction pipeline).
--
-- This script owns ROLES only (create/reconcile, passwords, session
-- defaults) -- it grants no cds_library object. Every object grant on
-- cds_library (schema USAGE, view/table SELECT/INSERT/UPDATE/DELETE, the
-- default-privilege rows) lives in deploy/seed/cds_library_schema.sql,
-- which is the single source of every such grant (plan §3.3). Run this
-- script BEFORE that seed: the seed's own bootstrap
-- (`GRANT cds_library_owner TO CURRENT_USER WITH SET TRUE`) requires the
-- cds_library_owner role to already exist.
--
-- WARNING: roles and their passwords are cluster-global, not database-local.
-- Running this script against ANY database on a Postgres instance overwrites
-- the live passwords for counselle_ro, counselle_app, and cds_library_app
-- across that entire instance -- every other database sharing the cluster,
-- not just the one you connected to. Point this at a scratch/local Postgres
-- instance, never at a shared cluster that also serves a live deployment.

\set ON_ERROR_STOP on
\set counselle_ro_password ''
\set counselle_app_password ''
\set counselle_pipeline_password ''
\getenv counselle_ro_password COUNSELLE_RO_PASSWORD
\getenv counselle_app_password COUNSELLE_APP_PASSWORD
\getenv counselle_pipeline_password COUNSELLE_PIPELINE_PASSWORD
SELECT nullif(:'counselle_ro_password', '') IS NOT NULL AS ro_password_present,
       nullif(:'counselle_app_password', '') IS NOT NULL AS app_password_present,
       nullif(:'counselle_pipeline_password', '') IS NOT NULL AS pipeline_password_present \gset
SELECT current_database() AS target_database \gset
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
-- cds_library_app (ADR 0038: the facts crawler, mutually exclusive with the
-- parked CDS admin write path) must always exist as a role: the seed
-- (deploy/seed/cds_library_schema.sql) GRANTs to it by name unconditionally
-- on every boot (plan §3.3), regardless of whether this deployment
-- configures a pipeline DSN. When the password is unset, the role is
-- created/kept NOLOGIN -- present but inert, never a login target.
\if :pipeline_password_present
\else
  \echo 'COUNSELLE_PIPELINE_PASSWORD not set -- cds_library_app will be created NOLOGIN (inert)'
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
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cds_library_reader') THEN
    CREATE ROLE cds_library_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  END IF;
  -- cds_library_owner (plan §3.3): owns every cds_library object (schema,
  -- tables, views, triggers, functions). NOLOGIN -- nothing authenticates
  -- as it directly; the seed acquires it via
  -- `GRANT cds_library_owner TO CURRENT_USER WITH SET TRUE` so a managed
  -- provider's admin identity (which may not itself hold CREATE on the
  -- database) can still own every object it creates.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cds_library_owner') THEN
    CREATE ROLE cds_library_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  END IF;
  -- cds_library_app (ADR 0038): always created, NOLOGIN by default -- see
  -- the comment above this DO block for why it can never be skipped
  -- entirely under v3.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cds_library_app') THEN
    CREATE ROLE cds_library_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

-- Existing roles are normalized too: setup is reconciliation, not create-only.
ALTER ROLE counselle_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
ALTER ROLE counselle_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
ALTER ROLE cds_library_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
\if :pipeline_password_present
ALTER ROLE cds_library_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
\else
ALTER ROLE cds_library_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
\endif

-- Remove inherited authority before granting the one intended reader membership.
SELECT format('REVOKE %I FROM counselle_ro', granted.rolname)
FROM pg_auth_members membership
JOIN pg_roles granted ON granted.oid = membership.roleid
JOIN pg_roles member ON member.oid = membership.member
WHERE member.rolname = 'counselle_ro'
  AND granted.rolname <> 'cds_library_reader'
ORDER BY granted.rolname
\gexec
SELECT format('REVOKE %I FROM counselle_app', granted.rolname)
FROM pg_auth_members membership
JOIN pg_roles granted ON granted.oid = membership.roleid
JOIN pg_roles member ON member.oid = membership.member
WHERE member.rolname = 'counselle_app'
ORDER BY granted.rolname
\gexec

SELECT format('ALTER ROLE counselle_ro PASSWORD %L', :'counselle_ro_password') \gexec
SELECT format('ALTER ROLE counselle_app PASSWORD %L', :'counselle_app_password') \gexec
\if :pipeline_password_present
SELECT format('ALTER ROLE cds_library_app PASSWORD %L', :'counselle_pipeline_password') \gexec
\endif

-- Read role: role-level reconciliation and read-only session defaults only.
-- Object grants (schema USAGE, view SELECT) belong to
-- deploy/seed/cds_library_schema.sql now (plan §3.3) -- this script no
-- longer names a single cds_library view or table.
GRANT cds_library_reader TO counselle_ro;
ALTER ROLE counselle_ro RESET ALL;
ALTER ROLE counselle_ro IN DATABASE :"target_database" RESET ALL;
ALTER ROLE counselle_ro SET default_transaction_read_only = on;
ALTER ROLE counselle_ro SET statement_timeout = '8s';
ALTER ROLE counselle_ro IN DATABASE :"target_database"
  SET search_path = cds_library, pg_catalog;

\if :pipeline_password_present
-- Write role (ADR 0038): role-level reconciliation and session defaults
-- only. Object grants (INSERT/SELECT/UPDATE on every cds_library base
-- table, DELETE on page_snapshots only -- never DELETE anywhere else)
-- belong to deploy/seed/cds_library_schema.sql now (plan §3.3).
ALTER ROLE cds_library_app RESET ALL;
ALTER ROLE cds_library_app IN DATABASE :"target_database" RESET ALL;
\endif

-- App role: owns the counselle schema, no pipeline membership.
ALTER ROLE counselle_app RESET ALL;
ALTER ROLE counselle_app IN DATABASE :"target_database" RESET ALL;
CREATE SCHEMA IF NOT EXISTS counselle AUTHORIZATION counselle_app;
ALTER SCHEMA counselle OWNER TO counselle_app;
ALTER ROLE counselle_app IN DATABASE :"target_database"
  SET search_path = counselle, pg_catalog;
REVOKE ALL ON SCHEMA counselle FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA counselle TO counselle_app;

-- Eradicate privileges retained from the retired public/raw data surface.  Guard
-- schema operations so the same script works after those schemas disappear.
DO $cleanup$
DECLARE
  target_schema text;
  owner_name text;
  target_role text;
BEGIN
  FOREACH target_schema IN ARRAY ARRAY['public', 'raw'] LOOP
    IF EXISTS (SELECT FROM pg_namespace WHERE nspname = target_schema) THEN
      FOREACH target_role IN ARRAY ARRAY['counselle_app', 'counselle_ro'] LOOP
        EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I',
                       target_schema, target_role);
        EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I',
                       target_schema, target_role);
        EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM %I',
                       target_schema, target_role);
        EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', target_schema, target_role);
      END LOOP;

      -- Default ACLs are owner-scoped. Revoke legacy grants for every role whose
      -- defaults mention either runtime role, rather than assuming an owner name.
      FOR owner_name IN
        SELECT DISTINCT owner_role.rolname
        FROM pg_default_acl defaults
        JOIN pg_roles owner_role ON owner_role.oid = defaults.defaclrole
        JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace
        CROSS JOIN LATERAL aclexplode(defaults.defaclacl) acl
        JOIN pg_roles grantee ON grantee.oid = acl.grantee
        WHERE namespace.nspname = target_schema
          AND grantee.rolname IN ('counselle_app', 'counselle_ro')
      LOOP
        FOREACH target_role IN ARRAY ARRAY['counselle_app', 'counselle_ro'] LOOP
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON TABLES FROM %I',
            owner_name, target_schema, target_role);
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I',
            owner_name, target_schema, target_role);
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON FUNCTIONS FROM %I',
            owner_name, target_schema, target_role);
        END LOOP;
      END LOOP;
    END IF;
  END LOOP;
END
$cleanup$;
