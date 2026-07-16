# Phases 7–8 — Pipeline rename, schema migration, cutover, and rollback

## Execution split

The canonical sequence requires the pipeline rename first. Execute §§7.0, 7.1, and 8.1
immediately after Phase 0, before `01-pipeline-contract.md`. At that early gate,
Counselle remains on its untouched old PostgreSQL 17 DSNs and no app schema is moved.
After Phases 1–6 pass, return here for §§7.2, 7.3, 8.2–8.5: rehearse and perform the
Counselle schema/DSN cutover. Do not postpone the pipeline identity rename to the final
application cutover.

## Mission

Correct the pipeline identity everywhere and move live Counselle state to PostgreSQL 16
without orphaning the pipeline volume or losing application data. Traffic stays closed
until both systems pass against the new DB. Zero-loss rollback exists only until writes
reopen.

## Read first

- `specs/db-rewire/design.md` §§4, 14–17.
- Both repository `AGENTS.md`, git status/log, real non-secret `.env` key names.
- Pipeline `pyproject.toml`, `uv.lock`, `src/councelle_data_pipeline/`,
  `docker-compose.yml`, `Dockerfile`, config/tests, README/live docs/runbooks.
- Counselle `config/settings.py`, `.env.example`, `scripts/setup_db.sql`, migrations,
  checkpointer startup, deployment docs.
- Official Docker Compose project-name precedence, official Postgres image init rules,
  PostgreSQL 16 `pg_dump`/cross-version caveats, and `ALTER DATABASE` docs.

Never print DSNs, passwords, role dumps, `.env` values, or password hashes. Commands
below use placeholders/environment names intentionally.

## 7.0 Hard preflight gates

1. Preserve the current dirty work in both repos. Counselle has user-owned spec/plan
   changes; pipeline has an untracked bulk-extraction spec. The owner must commit,
   stash, or explicitly carry them before branch/directory operations.
2. Record:

   ```bash
   git rev-parse HEAD
   git status --short --branch
   docker compose ps
   docker volume inspect councelle-data-pipeline_postgres_data
   ```

3. Pipeline currently has no Git remote. Do not run `gh repo rename` or invent an
   origin. Require the owner to provide/confirm `<owner>/<repo>` and canonical URL.
4. Confirm whether `councelle.tailnet.ts.net` will actually change. Default is keep.
5. Stop/finish active Counselle turns for the maintenance window. In-flight v1 turns
   will not be translated.
6. Require `cds_extractions.status='running'` count zero before stopping pipeline
   workers; queued rows may remain.
7. Create mode-0700 `artifacts/db-rewire/<UTC timestamp>/`; every dump/TOC/log there is
   local and gitignored. Files containing roles or data are mode 0600.

Capture pre-change signatures, not only counts:

- profile count/distinct SHA/date range;
- manifest version/content SHA/domain hashes/current pointer;
- document count/distinct PDF SHA/total PDF bytes;
- active document/packet counts and version/status distribution;
- Counselle retained-table counts and deterministic digests;
- sequence last values/max IDs;
- role memberships/owners/defaults without secrets.

## 7.1 Code/package/repo rename

Work on a dedicated pipeline rename branch from the intended clean base. Store
`PRE_RENAME_SHA`.

### Files and exact changes

- `git mv src/councelle_data_pipeline src/counselle_data_pipeline`.
- `pyproject.toml`: distribution name, entry-point target module, wheel package path,
  hatch force-include destination.
- Every live source/test import and the exact self-path literals in `cli.py` and
  `library/profiles.py`.
- `src/.../config.py`: default DSN and both strict database-name validators/errors from
  `/councelle_data` to `/counselle_data` in the same commit.
- `Dockerfile`: uvicorn module.
- `docker-compose.yml`: corrected image tag, database name, healthcheck, three DSNs,
  explicit loopback port, top-level project name, explicit volume name.
- `.env.example`: two DSNs and `CDS_DB_PORT`.
- real operator `.env`: database name/port, never committed or displayed.
- tests: imports, fixture paths, config/image/restore/dump literals. Preserve tailnet
  fixture unless the external gate says otherwise.
- live `README.md`, `docs/architecture.md`, `docs/reference/config.md`,
  `school-profiles.md`, `docs/runbooks.md`: command/path/package/database names. Change
  PGSERVICE to `counselle-data-backup`, dump to `counselle-data.dump`, restore DB to
  `counselle_data_restore`.
- regenerate `uv.lock` with `uv lock`, then `uv sync --extra test`. Never edit venv,
  `.pth`, or site-packages.

The final Compose identity is:

```yaml
name: counselle-data-pipeline

services:
  db:
    ports:
      - "127.0.0.1:${CDS_DB_PORT:-5433}:5432"

volumes:
  postgres_data:
    name: counselle-data-pipeline_postgres_data
```

`-p` has higher precedence and is used only to address the old project during cutover.
Do not pin the misspelled project forever.

Historical pipeline `specs/`/`plans/` stay unchanged. The current untracked proposed
bulk plan is preserved as work-in-progress rather than mechanically rewritten during a
package rename.

### Code gate before live rename

```bash
uv lock
uv sync --extra test
uv run pytest
uv run cds-library --help
uv build --out-dir artifacts/dist
docker compose build
```

Inspect the wheel to prove it contains `counselle_data_pipeline/` and no misspelled
package. Run a live-root residue grep excluding historical specs/plans. If the owner
supplies a remote, rename externally only after these gates and set origin to the exact
returned canonical URL.

## 7.2 Backups and PG17→PG16 rehearsal

### 7.2.1 Backups

With pipeline services quiesced for the snapshot, create:

- full PG16 custom-format pipeline dump;
- PG16 roles-only dump (sensitive; 0600);
- full old Counselle PG17 custom dump for rollback only;
- plain schema/data transfer SQL for `counselle.*`.

Use the correct major's client for each source and checksum every artifact immediately:

```bash
umask 077
pg_dump "$PIPELINE_OWNER_DSN" --format=custom \
  --file "$ARTIFACT_DIR/pipeline-pg16.dump"
pg_dumpall --database="$PIPELINE_OWNER_DSN" --roles-only \
  > "$ARTIFACT_DIR/pipeline-roles.sql"
pg_dump "$OLD_COUNSELLE_APP_DSN" --format=custom \
  --file "$ARTIFACT_DIR/counselle-pg17-rollback.dump"
sha256sum "$ARTIFACT_DIR"/*.dump "$ARTIFACT_DIR"/*.sql \
  > "$ARTIFACT_DIR/SHA256SUMS"
chmod 600 "$ARTIFACT_DIR"/*
```

If `pg_dumpall --database` is unsupported by the installed client, run it inside the
PG16 DB container and redirect stdout locally. Never put a password in the command.

The transfer dump must exclude only disposable field index and use cross-version-safe
quoting:

```bash
pg_dump "$OLD_COUNSELLE_APP_DSN" \
  --format=plain \
  --schema=counselle \
  --exclude-table=counselle.field_index \
  --no-owner \
  --no-privileges \
  --quote-all-identifiers \
  --file "$ARTIFACT_DIR/counselle-transfer.raw.sql"
```

PG17 dump output is not guaranteed to restore to PG16. Create a reviewed transfer copy
by removing exactly:

```text
SET transaction_timeout = 0;
CREATE SCHEMA "counselle";
```

Also accept the unquoted schema line only if the actual dump produced it. Implement the
two-line transformation with a reviewed, anchored filter and compare removed lines:

```bash
sed -e '/^SET transaction_timeout = 0;$/d' \
    -e '/^CREATE SCHEMA "counselle";$/d' \
    "$ARTIFACT_DIR/counselle-transfer.raw.sql" \
    > "$ARTIFACT_DIR/counselle-transfer.sql"
chmod 600 "$ARTIFACT_DIR/counselle-transfer.sql"
diff -u "$ARTIFACT_DIR/counselle-transfer.raw.sql" \
        "$ARTIFACT_DIR/counselle-transfer.sql" \
  > "$ARTIFACT_DIR/counselle-transfer-filter.diff" || test "$?" -eq 1
```

The reviewer must see exactly those expected deleted lines in the diff. Do not use a
broad regex that deletes other DDL. Preflight the final file:

```text
must not contain: transaction_timeout, CREATE SCHEMA counselle, field_index,
                  public.vector, CREATE EXTENSION
may contain:      decode_ipeds, value_vintage (0012 drops them after restore)
```

Never restore the PG17 custom archive directly with PG16 `pg_restore`; it is rollback
backup only.

### 7.2.2 Retained Counselle tables

Migrate and compare at least:

```text
users, oauth_accounts, sessions, feedback, profiles, documents, memories,
applications, essays, tasks, activities, honors, workspace_changes,
school_prompt_groups, school_essay_prompts, school_requirements,
checkpoints, checkpoint_blobs, checkpoint_writes,
_yoyo_log, _yoyo_migration, _yoyo_version, checkpoint_migrations
```

Include any additional live table discovered at preflight unless it is explicitly
classified as disposable. Exclude `field_index`, locks, and transient logs only.

### 7.2.3 Disposable PG16 rehearsal

On a throwaway database made from the same Postgres 16 image:

1. run the idempotent role/schema setup;
2. restore under `SET ROLE counselle_app` with:

   ```bash
   psql -X "$REHEARSAL_APP_DSN" \
     --single-transaction \
     --set ON_ERROR_STOP=1 \
     --file "$ARTIFACT_DIR/counselle-transfer.sql"
   ```

3. run yoyo so the migrated 0001–0011 metadata applies only 0012;
4. compare every retained count/digest, FK, sequence, owner, and permission;
5. boot the checkpointer and run a session/transcript/workspace smoke;
6. verify helpers/field index absent and no vector/pg_trgm requirement;
7. drop the rehearsal database.

Any warning, ignored SQL error, missing row, digest mismatch, invalid owner, or fresh
migration replay blocks live cutover. The target cannot fresh-replay 0001–0011 because
it lacks vector/pg_trgm and the historical chain has ordering assumptions; this rewire
migrates the existing schema. A fresh B6 baseline is deferred deployment work and must
not be falsely claimed complete here.

## 7.3 Idempotent role/schema setup

Rewrite Counselle `scripts/setup_db.sql` for the renamed DB. It must:

- read secrets from environment using psql `\getenv`, never `-v secret=value` argv;
- create or rotate `counselle_ro` and `counselle_app` with no superuser/create-db/
  create-role/replication/bypass-RLS;
- `GRANT cds_library_reader TO counselle_ro`;
- set RO `default_transaction_read_only=on`, statement timeout, and
  `search_path=cds_library,pg_catalog` in `counselle_data`;
- create/verify schema `counselle AUTHORIZATION counselle_app`;
- set app search path to `counselle,pg_catalog`;
- not grant app any pipeline membership;
- remove every old public/raw/table/function grant and extension check;
- be safe to rerun without printing passwords.

Use this SQL shape; keep passwords in psql variables sourced from the environment:

```sql
\set ON_ERROR_STOP on
\getenv counselle_ro_password COUNSELLE_RO_PASSWORD
\getenv counselle_app_password COUNSELLE_APP_PASSWORD
SELECT nullif(:'counselle_ro_password', '') IS NOT NULL AS ro_password_present,
       nullif(:'counselle_app_password', '') IS NOT NULL AS app_password_present \gset
\if :ro_password_present
\else
  \warn 'COUNSELLE_RO_PASSWORD is required'
  \quit 3
\endif
\if :app_password_present
\else
  \warn 'COUNSELLE_APP_PASSWORD is required'
  \quit 3
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

GRANT cds_library_reader TO counselle_ro;
ALTER ROLE counselle_ro SET default_transaction_read_only = on;
ALTER ROLE counselle_ro SET statement_timeout = '8s';
ALTER ROLE counselle_ro IN DATABASE counselle_data
  SET search_path = cds_library, pg_catalog;

CREATE SCHEMA IF NOT EXISTS counselle AUTHORIZATION counselle_app;
ALTER SCHEMA counselle OWNER TO counselle_app;
ALTER ROLE counselle_app IN DATABASE counselle_data
  SET search_path = counselle, pg_catalog;
REVOKE ALL ON SCHEMA counselle FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA counselle TO counselle_app;
```

The guard never interpolates the secret into an error/log. Run the file as the pipeline
DB owner with named environment variables, e.g. `docker compose exec -T -e
COUNSELLE_RO_PASSWORD -e COUNSELLE_APP_PASSWORD db psql ...`; never append values to
the command line.

Generate new high-entropy URL-safe passwords. Pass named environment variables into a
container/process, not their values in command history/log output. URL-encode them only
when writing the local `.env`.

Permission acceptance:

- RO: five views succeed; representative base tables and every write fail.
- APP: Counselle tables read/write; pipeline views/base-table writes fail.
- owner: migrations only; not used by runtime.

## 8.1 Offline pipeline volume and database rename

Traffic/worker maintenance starts here.

1. Stop Counselle and prevent new turns/workspace writes.
2. Confirm zero running extractions.
3. Stop old pipeline with no volume removal:

   ```bash
   docker compose -p councelle-data-pipeline down
   ```

   Never add `-v`.
4. Abort if `counselle-data-pipeline_postgres_data` already exists. Investigate rather
   than overwrite.
5. Create corrected volume and copy offline with the present `postgres:16-alpine`
   image, old mounted read-only and new writable. Use a tar stream preserving modes/
   ownership; compare file count and `du`. Keep old volume untouched.

   ```bash
   if docker volume inspect counselle-data-pipeline_postgres_data >/dev/null 2>&1; then
     echo 'target volume already exists; abort' >&2
     exit 1
   fi
   docker volume create counselle-data-pipeline_postgres_data
   docker run --rm \
     -v councelle-data-pipeline_postgres_data:/from:ro \
     -v counselle-data-pipeline_postgres_data:/to \
     postgres:16-alpine \
     sh -ceu 'cd /from && tar cf - . | tar xpf - -C /to'
   docker run --rm -v councelle-data-pipeline_postgres_data:/data:ro \
     postgres:16-alpine sh -ceu 'find /data -xdev | wc -l; du -sk /data'
   docker run --rm -v counselle-data-pipeline_postgres_data:/data:ro \
     postgres:16-alpine sh -ceu 'find /data -xdev | wc -l; du -sk /data'
   ```

   Compare both outputs exactly enough to catch an incomplete copy; a byte-identical
   filesystem is not expected after reads, but file count and allocated size must not
   show an unexplained difference.
6. Move directory:

   ```bash
   mv /home/saifuddin/Projects/councelle-data-pipeline \
      /home/saifuddin/Projects/counselle-data-pipeline
   ```

7. Start corrected project's DB only. It may be unhealthy because copied cluster still
   has the old database while env expects the new name; this is expected.
8. Connect to the separate `postgres` database as owner, terminate sessions to old DB,
   and run:

   ```sql
   SELECT pg_terminate_backend(pid)
   FROM pg_stat_activity
   WHERE datname = 'councelle_data'
     AND pid <> pg_backend_pid();

   ALTER DATABASE councelle_data RENAME TO counselle_data;
   ```

9. Assert the database catalog contains `counselle_data` and not `councelle_data`.
10. Start/build app and worker. `POSTGRES_DB` does not rename initialized clusters; the
    explicit SQL step is mandatory.
11. Compare saved pipeline profile/manifest/document/PDF/packet signatures before any
    Counselle restore.

If any pipeline signature differs, stop and return to the untouched old volume/project.

## 8.2 Restore Counselle into the target

1. Run the idempotent setup/role script against `counselle_data`.
2. Restore the reviewed transfer SQL by connecting directly with
   `TARGET_COUNSELLE_APP_DSN`, using `psql -X`, single transaction, and
   `ON_ERROR_STOP=1`:

   ```bash
   psql -X "$TARGET_COUNSELLE_APP_DSN" \
     --single-transaction \
     --set ON_ERROR_STOP=1 \
     --file "$ARTIFACT_DIR/counselle-transfer.sql"
   ```
3. Apply yoyo migration 0012. Because yoyo metadata moved with the schema, 0001–0011
   remain recorded; do not replay them.
4. Update local Counselle secrets:

   ```text
   COUNSELLE_DB_RO_DSN=postgresql://counselle_ro:<encoded>@127.0.0.1:5433/counselle_data
   COUNSELLE_DB_APP_DSN=postgresql://counselle_app:<encoded>@127.0.0.1:5433/counselle_data
   ```

5. Verify retained counts/digests/FKs/sequences/owners exactly. For each integer/UUID
   sequence-backed table, ensure sequence last value cannot collide with current max.
6. Verify `to_regprocedure`/`to_regclass` return null for both helper signatures and
   field index; 0012 is recorded.
7. Verify all target Counselle objects are owned by app except intentional extension/
   system objects; runtime roles have least privilege.

## 8.3 Closed-traffic verification

Start Counselle on the new DSNs with old PG17/Supabase still stopped. Verify:

- API health/config, login and Google OAuth callback configuration;
- existing user login, sessions list, old transcript/v1 card/source view;
- new v2 turn, detach/reattach/cancel, edit/regenerate;
- checkpointer write/read/delete;
- workspace school add/edit/task/essay/activity and actor/event rows;
- feedback and rate limiting;
- four MCP tools and no reconcile endpoint;
- mixed render card and exact evidence rail;
- pipeline app/worker still healthy and reader permissions exact.

Run the full gates from Phase 9 while old database is not running. Reopen traffic only
after all pass and owner signs the captured parity report.

## 8.4 Rollback boundary and runbook

### Before traffic reopens: zero-loss rollback

Because no writes were admitted after the old snapshot:

1. stop Counselle and corrected pipeline;
2. restore the protected pre-cutover Counselle `.env`/DSNs;
3. start the old pipeline project from a detached rollback worktree at
   `PRE_RENAME_SHA`, using the untouched old volume/image/env;
4. restart old Counselle against untouched PG17 schema;
5. verify old health/signatures and reopen only the old system.

No reverse data copy is required. Keep the rollback worktree and protected env under
the secured artifact/runbook location without committing secrets.

### After traffic reopens

Zero-loss rollback expires as soon as new user/workspace/checkpoint writes are accepted.
Then choose forward-fix or a new controlled delta migration; never silently revert DSNs
and discard new writes. State this in the maintenance approval before reopening.

Never auto-delete old volume/schema/dumps. Owner-set retention cleanup is a separate
post-acceptance operation.

## 8.5 Rename/cutover acceptance

The operational phase passes only when:

- package/wheel/imports/database/Compose volume/image/live docs use corrected spelling;
- no repo remote action was guessed;
- pipeline signatures match across the offline volume copy and DB rename;
- every retained Counselle count/digest/owner/FK/sequence matches;
- roles pass positive and negative permission tests;
- new application boots without vector/pg_trgm or old DB;
- old completed turns and new v2 turns both work;
- old DB remains stopped throughout final live/full/eval proof;
- rollback steps have been rehearsed before traffic opens and their expiry is recorded.
