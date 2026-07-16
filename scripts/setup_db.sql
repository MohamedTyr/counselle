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

-- Existing roles are normalized too: setup is reconciliation, not create-only.
ALTER ROLE counselle_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;
ALTER ROLE counselle_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS;

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

-- Read role: the five cds_library reader views only, read-only session defaults.
GRANT cds_library_reader TO counselle_ro;
ALTER ROLE counselle_ro RESET ALL;
ALTER ROLE counselle_ro IN DATABASE counselle_data RESET ALL;
ALTER ROLE counselle_ro SET default_transaction_read_only = on;
ALTER ROLE counselle_ro SET statement_timeout = '8s';
ALTER ROLE counselle_ro IN DATABASE counselle_data
  SET search_path = cds_library, pg_catalog;

-- App role: owns the counselle schema, no pipeline membership.
ALTER ROLE counselle_app RESET ALL;
ALTER ROLE counselle_app IN DATABASE counselle_data RESET ALL;
CREATE SCHEMA IF NOT EXISTS counselle AUTHORIZATION counselle_app;
ALTER SCHEMA counselle OWNER TO counselle_app;
ALTER ROLE counselle_app IN DATABASE counselle_data
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
