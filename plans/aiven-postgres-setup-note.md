# Aiven PostgreSQL Setup Note

Date: 2026-06-19

Purpose: capture the practical database-hosting answer for Counselle before implementation. This is a planning note, not the canonical deploy runbook. The canonical deploy flow still lives in `docs/DEPLOY.md`.

## Decision

Use **Aiven for PostgreSQL** as the first database-hosting choice.

Why:

- Counselle needs hosted PostgreSQL, not just a frontend/backend host.
- The database must support PostgreSQL 16 and `pgvector`.
- The free Aiven PostgreSQL tier is a reasonable first target if the restored database fits its limits.
- The setup maps cleanly to the repo's deploy expectation: one hosted Postgres database containing the pipeline data plus Counselle's own `counselle.*` schema.

Fallback rule:

- If the restored database is too large for the Aiven free tier, move to Aiven Developer or another paid PostgreSQL tier.
- Do not choose a provider before checking the real dump size.

Official docs checked:

- Aiven PostgreSQL get started: https://aiven.io/docs/products/postgresql/get-started
- Aiven service pricing/free tier: https://aiven.io/docs/platform/concepts/service-pricing
- Aiven pricing: https://aiven.io/pricing
- Aiven PostgreSQL pgvector: https://aiven.io/docs/products/postgresql/howto/use-pgvector
- Aiven pg_dump/pg_restore migration: https://aiven.io/docs/products/postgresql/howto/migrate-pg-dump-restore
- Aiven PostgreSQL connection limits: https://aiven.io/docs/products/postgresql/reference/pg-connection-limits

## What The Repo Expects

The repo's deploy docs say the database comes first:

1. Provision PostgreSQL 16, preferably near the app host.
2. Pre-create the `vector` extension as an admin user.
3. Restore the pipeline database into the hosted database.
4. Run `scripts/setup_db.sql` to create Counselle roles, grants, and schema.
5. Run Counselle migrations.
6. Set both runtime DSNs:
   - `COUNSELLE_DB_RO_DSN`
   - `COUNSELLE_DB_APP_DSN`

The README says the same thing for local/dev setup: Counselle needs a populated pipeline Postgres plus the `counselle_ro` and `counselle_app` roles.

## What To Create In Aiven

Create one **Aiven for PostgreSQL** service.

Recommended choices:

- PostgreSQL version: 16 if available.
- Region: as close as possible to the backend host.
- Plan: Free only if the database fits; otherwise Developer or higher.
- Database: the default `defaultdb` is fine unless the team chooses a custom name.

Important free-tier constraints to remember:

- Storage is limited.
- Connection count is limited.
- Free services may be powered off after inactivity.
- This is fine for MVP/demo, not for serious production traffic.

## One Env File

Use **one local `.env` file**. Do not use a second env file for normal workflow.

The `.env` file has two jobs:

1. run the Counselle app;
2. provide migration variables to `scripts/migrate_pipeline_to_aiven.sh`.

The migration script automatically loads `.env`.

## What To Get From Aiven

You need the Aiven **service/admin connection URI** first. In Aiven Console, open the PostgreSQL service and copy the Quick Connect / Service URI.

It will look like:

```text
postgres://avnadmin:<password>@<host>:<port>/defaultdb?sslmode=require
```

Put it in local `.env` as:

```text
COUNSELLE_AIVEN_ADMIN_DSN=postgres://avnadmin:<password>@<host>:<port>/defaultdb?sslmode=require
```

Use this admin URI only for setup/migration tasks:

- creating `vector`
- restoring the pipeline dump
- running `scripts/setup_db.sql`
- verifying grants

Do not commit `.env`.

## Runtime Connection Strings

Counselle needs two runtime DSNs.

Read-only pipeline/database DSN:

```text
COUNSELLE_DB_RO_DSN=postgres://counselle_ro:<ro_pw>@<host>:<port>/defaultdb?sslmode=require
```

Counselle app/session schema DSN:

```text
COUNSELLE_DB_APP_DSN=postgres://counselle_app:<app_pw>@<host>:<port>/defaultdb?sslmode=require
```

These usually point to the same hosted database and host. The difference is the database role:

- `counselle_ro`: read-only access to the pipeline/public/raw data.
- `counselle_app`: write access to Counselle's own `counselle.*` schema for sessions, users, feedback, and field embeddings.

Generate and save two strong passwords:

- `ro_pw`
- `app_pw`

Put them in local `.env` as:

```text
COUNSELLE_RO_PASSWORD=<ro_pw>
COUNSELLE_APP_PASSWORD=<app_pw>
```

Those passwords must match the runtime DSNs.

## Setup Order

1. Create the Aiven PostgreSQL service.
2. Copy the admin/service URI from Aiven.
3. Check the pipeline database dump size before committing to the free tier.
4. Connect as the Aiven admin user.
5. Create the `vector` extension before running Counselle migrations.
6. Restore the pipeline database dump into the hosted database.
7. Run `scripts/setup_db.sql` with `ro_pw` and `app_pw`.
8. Run the yoyo migrations using `COUNSELLE_DB_APP_DSN` with the `counselle` schema. If the DSN already has a query string such as `?sslmode=require`, append `&schema=counselle`, not another `?schema=counselle`.
9. Put `COUNSELLE_DB_RO_DSN` and `COUNSELLE_DB_APP_DSN` into the app environment.
10. Boot the backend and verify a known school/database lookup.

## Current Aiven State

As of 2026-06-19, the Aiven target service has been tested and prepared:

- Service host is reachable from this machine.
- PostgreSQL version: 17.10.
- Extensions installed:
  - `vector=0.8.1`
  - `pg_trgm=1.6`
- Target database size before pipeline restore: about 7.8 MiB.
- Runtime roles created:
  - `counselle_ro`
  - `counselle_app`
- `counselle_ro` connects and has `default_transaction_read_only=on`.
- `counselle_app` connects and owns/sees the `counselle` schema.
- LangGraph checkpoint tables exist in `counselle.*`.
- Counselle yoyo migrations 0001-0006 are applied.
- Local `.env` was created from `.env.example` with:
  - `COUNSELLE_DB_RO_DSN`
  - `COUNSELLE_DB_APP_DSN`
  - generated `COUNSELLE_JWT_SECRET`
  - `COUNSELLE_CHECKPOINTER=postgres`

Still missing:

- The pipeline-owned data tables have not been restored yet:
  - `public.schools`
  - `public.fields`
  - `public.field_values`
  - `raw.files`
- After restoring the real pipeline DB, run the full bootstrap/grant step again so `counselle_ro` and `counselle_app` receive grants on the restored `public` and `raw` objects.

## Migration Script

Use `scripts/migrate_pipeline_to_aiven.sh` for the actual migration. It supports:

- direct source DSN mode, when the other dev exposes the local pipeline DB on a port;
- Docker Compose source mode, when the pipeline DB is inside a compose service;
- auto-loading `.env`;
- using the other dev's old `COUNSELLE_DB_APP_DSN` as the source DB by default;
- source and dump size caps, defaulting to 700 MiB;
- `pg_dump` custom-format export of only `public` and `raw`;
- Aiven restore through the admin DSN;
- idempotent creation of `counselle_ro`, `counselle_app`, and the `counselle` schema;
- optional Counselle yoyo migration execution.

For the other dev's machine, the old local `.env` values are enough for the source:

```text
COUNSELLE_DB_APP_DSN=postgresql://counselle_app:<local-password>@localhost:5432/ascensia
```

Then add the Aiven target variable to the same `.env`:

```text
COUNSELLE_AIVEN_ADMIN_DSN=postgres://avnadmin:<password>@<host>:<port>/defaultdb?sslmode=require
```

The migration script generates `counselle_ro` and `counselle_app` passwords if they are not set, and prints the final app DSNs after bootstrap.

Run:

```bash
scripts/migrate_pipeline_to_aiven.sh check-source
scripts/migrate_pipeline_to_aiven.sh check-target
scripts/migrate_pipeline_to_aiven.sh migrate
```

If the app `.env` has already been switched to Aiven DB DSNs, set an explicit source:

```text
COUNSELLE_SOURCE_DB_DSN=postgresql://counselle_app:<local-password>@localhost:5432/ascensia
```

## Managed-Postgres Caveat

The repo script assumes an admin user can create roles:

```sql
CREATE ROLE counselle_ro LOGIN PASSWORD :'ro_pw';
CREATE ROLE counselle_app LOGIN PASSWORD :'app_pw';
```

If the chosen managed PostgreSQL plan blocks direct role creation through SQL, create the two service users through the provider console/CLI first, then adapt the setup by running only the grants/schema parts.

Do not skip the grants. A missing grant can make the app boot but silently fail database lookups.

## Fresh Start Meaning

Starting fresh is fine for:

- users
- saved chats
- sessions
- feedback
- Counselle-owned app state

Starting fresh does **not** remove the need for the college pipeline data.

Counselle still needs either:

- a restored dump of the existing pipeline database, or
- the separate pipeline repo rebuilding that database from source.

This repo alone cannot create the `public.*` and `raw.*` school dataset.

## Final Checklist

Before backend deploy, confirm:

- Aiven PostgreSQL service exists.
- Database size fits the selected plan.
- `vector` extension is installed.
- Pipeline data is restored.
- `counselle_ro` and `counselle_app` exist.
- `counselle_ro` can read required `public` and `raw` tables.
- `counselle_app` owns or can write to `counselle.*`.
- Counselle migrations completed.
- App env contains:
  - `COUNSELLE_DB_RO_DSN`
  - `COUNSELLE_DB_APP_DSN`
  - `COUNSELLE_CHECKPOINTER=postgres`
