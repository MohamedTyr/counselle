# Parked systems

This register tracks everything **parked** under decision **D8** (`plans/school-data-v3.md` §0):
the CDS management + extraction system (ADR 0036) is parked, not deleted, when the school-data v3
re-architecture (ADR 0037) replaces its runtime role with the CollegeData facts store. "Parked"
means a specific, checkable state — not a synonym for "unused" or "stale" — and this file is the
place a future reader (or agent) checks before assuming something is dead.

See `plans/school-data-v3.md` §10 for the formal three-way disposition rule this file implements:
every file this re-architecture touches is `PARKED` (here), `DEAD` (deleted in the phase that
orphaned it), or `LIVE` (load-bearing, unchanged). This file is the `PARKED` half of that rule —
if a file is parked, it is listed here with a revival step; if it is not listed here and it is not
`LIVE`, treat that as a gap to report, not as license to delete it.

## Why parked, not deleted

- CollegeData's daily, code-side-typed scrape (D1) replaces the CDS extraction pipeline's product
  role — a slow, cost-bound, human-reviewed corpus that will never cover every school. The pipeline
  is not being retired because it is broken; it is being superseded for the runtime path it served.
- The pipeline has real, hard-won value that took real cost to build: 394 metric definitions across
  13 domains, a validated manifest/packet-v8 anti-corruption boundary, a working admin review UI, and
  four fully re-extracted and reapproved documents (Harvard ×2, Yale, UPenn). None of that should be
  thrown away on the chance CDS-sourced data (richer per-school detail, CDS-specific fields
  CollegeData does not publish) matters again later — see `plans/school-data-v2.md`, which is kept
  open for exactly that future.
- D8 states the requirement plainly: code stays in-tree and importable, its unit tests keep passing,
  nothing is mounted or started, its live tables are removed, and its DDL and its data are both
  preserved.

## What is parked

### Backend packages (importable, in-tree, unmounted)

Verified present at these exact paths in the live tree:

- `domain/cds/` — `__init__.py`, `claims.py`, `manifest_compile.py`, `manifest_types.py`,
  `packet_build.py`, `pages.py`, `validators.py`
- `app/cds/` — `__init__.py`, `audit.py`, `batching.py`, `batch_run.py`, `calling.py`,
  `citation_remap.py`, `detect.py`, `engine.py`, `errors.py`, `jobs.py`, `manifest.py`, `models.py`,
  `routing.py`, `service_ingest.py`, `service_review.py`, `service_review_approve.py`,
  `starved_retry.py`, `usage.py`
- `adapters/cds_*` — `adapters/cds_admin_queries.py`, `adapters/cds_admin_types.py`,
  `adapters/cds_gemini.py`, `adapters/cds_pdf.py`, `adapters/cds_store.py`
- `api/routes/cds_admin.py`
- `config/cds/` — `manifest.yaml`, `extraction-prompt.md`, `extractor-version.yaml`,
  `domains/{academics,admissions,class_profile,class_size,cost,degrees,enrollment,faculty,
  financial_aid,identity,outcomes,student_life,transfer}.yaml`
- `counselle_db/packets.py` — parked (it is the packet-v8 read boundary for the parked write path);
  **not the same file as** `counselle_db/formatting.py`, which stays live (see "Stale pointers"
  below for the one import edge this creates)

### Parked scripts (importable, not run by any live entrypoint)

Verified present in `scripts/`: `_cds_crash_test_worker.py`, `cds_domain_diff.py`,
`cds_manifest_check.py`, `publish_cds_manifest.py`, `verify_cds_adapters.py`,
`verify_cds_engine.py`.

This phase also deletes one CDS-adjacent script and its test outright, rather than parking them —
they were a one-off operational data-cleanup tool for a past incident, not part of the parked
subsystem's ongoing shape, and had no importers anywhere in the tree.

### Config surface parked as a commented block, not removed

- `config/settings.py`'s `supported_packet_extractor_versions` field stays, carrying a
  `# parked (ADR 0036)` comment — it is still read by the parked `adapters/cds_store.py`. The
  broader `cds_*`/`model_cds_*` Settings block stays as parked config for the same reason: removing
  it would make the parked write path fail to even import.

### Frontend (importable, unmounted, unrouted)

- `frontend/src/features/cds-admin/` (50 files on disk — down from 51 at fork point, since its only
  DRY-shared piece, `CdsErrorCard.tsx`, is **promoted out**) and `frontend/src/api/cds-admin/` (9
  files on disk) stay in the tree. `CdsErrorCard.tsx` is promoted before parking (to
  `frontend/src/components/ui/error-card.tsx`) so the parked admin pages still compile against a
  component that continues to exist at its old relative meaning — the promoted file is imported
  back into the parked pages, not duplicated.
- `frontend/src/pages/cds-coverage-page.tsx`, `cds-review-page.tsx` (+ `.test.tsx`),
  `cds-upload-page.tsx` (+ `.test.tsx`) — the three page shells. Their three `router.tsx` route
  entries are removed (this is what makes them unmounted); the pages themselves are not deleted.
- `frontend/src/config.ts`'s `CDS_ADMIN_SLOW_REQUEST_TIMEOUT_MS` export — its only consumers
  (`api/cds-admin/documents.ts`, `api/cds-admin/uploads.ts`) are inside the parked admin tree, which
  is already covered by `knip.json`'s `src/api/cds-admin/**` glob ignore; `knip` traces the import
  edge through that ignored path back to `config.ts` and does not flag the export, so no separate
  ignore entry is needed for it and none is present. The constant is not deleted, since deleting it
  would touch a file (`config.ts`) that also holds the live `DEFAULT_REQUEST_TIMEOUT_MS` constant.
- `app/auth/AdminGate.tsx` is **not parked** — it is unimported for exactly one phase (Phase 0 only;
  Phase 1 re-imports it for the new `/app/admin/facts` route) and is recorded here only so the
  Phase 0 `knip` baseline is not misread as a permanent orphan.

### Database DDL and data (D8 — preservation, not just code)

- **Target DDL home:** `deploy/seed/parked/cds_extraction_schema.sql` — the seven CDS tables
  (`cds_documents`, `cds_domain_packets`, `cds_extractions`, `cds_manifests`, `cds_school_years`,
  `ct_index_entries`, `ct_index_state`), the four CDS-specific reader views, the shared
  `is_sorted_distinct_text_array` function, the three `cds_*_immutable` triggers and their
  functions, the `cds_library_app` grants on these tables (**not** on `schools` or `school_profiles`
  — both are live v3 objects this file references (`schools` via FK, `school_profiles` as an
  identical passthrough view over `schools`) but does not own, so its grant deliberately excludes
  both to avoid re-widening that role's privileges on them; see the comment above the `GRANT`
  block), and the two default-privilege rows — moved verbatim from today's
  `deploy/seed/cds_library_schema.sql` and completed from a live-catalog diff (this file also keeps
  the unapplied `V-01` partial unique index on `cds_documents(school_year_id, pdf_sha256)`, recorded
  separately in `TODOS.md`).
  **Status: done and verified (Phase 0, Unit F).** `deploy/seed/parked/cds_extraction_schema.sql`
  exists, applies cleanly against a fresh schema (a bare `cds_library.schools` table copied in,
  standing in for the live v3 seed's own `schools`), and produces the seven CDS base tables, the
  four CDS-specific reader views, `is_sorted_distinct_text_array`, and the three `cds_*_immutable`
  triggers/functions with zero errors. `artifacts/school-data-v3/20260906T214018Z-prenuke/
  triggers_and_functions.sql` (verified present) is the trigger-capture step's output
  (`pg_get_functiondef` / `pg_get_triggerdef`).
- **Target CSV home:** the four `deploy/seed/*cds*.csv.gz` files
  (`active_cds_documents.csv.gz`, `active_cds_domain_packets.csv.gz`, `cds_document_sources.csv.gz`,
  `cds_manifest_snapshots.csv.gz`) — **moved and verified present** at `deploy/seed/parked/`.
- **Data-only dump:** `artifacts/school-data-v3/20260906T214018Z-cds-preserve/cds_data.dump` (61 MB)
  — a `pg_dump --format=custom --data-only` of the seven CDS tables, including
  `cds_documents.pdf_content` (the four shipped PDFs). **Status: restore-verified (Phase 0, Unit F),
  off-workstation copy still outstanding.** Restored cleanly (`pg_restore --data-only
  --disable-triggers`, 0 errors) into a throwaway scratch database built from
  `deploy/seed/parked/cds_extraction_schema.sql` alone (i.e. verified independently of the full
  pre-nuke dump, proving the parked DDL + this data-only dump are self-sufficient for revival). Row
  counts match the pre-nuke full dump exactly: `cds_documents`=28, `cds_school_years`=26,
  `cds_manifests`=15, `cds_extractions`=77, `cds_domain_packets`=513, `ct_index_entries`=5946,
  `ct_index_state`=1; `pdf_content` is non-null for all 28 documents. The restored
  `cds_manifests.is_current` row is `version=5.1.0`,
  `content_sha256=6367c0fee822f4d07725abc7274c8a589edefd64fb7301eac8372568941b04ae` — the exact
  hash `uv run python scripts/cds_manifest_check.py` reproduces from `config/cds/` on disk, and the
  same hash the sibling `full.dump` (`artifacts/school-data-v3/20260906T214018Z-prenuke/full.dump`,
  219 MB, both schemas, also independently restore-verified with matching row counts) carries.
  **Not yet done: "copied off the workstation" (owner's own storage).** Both dumps exist only on
  this workstation as of this file's writing — restore-verification does not substitute for an
  off-workstation copy, and that step needs the owner (it is not something achievable from inside
  this repo/agent session). Treat D8's data-preservation requirement as **restore-verified but not
  yet fully satisfied** until an off-workstation location is recorded here.
- `specs/cds-pipeline/tuning/` (ground truth corpus + harness: `corpus-profile.json`,
  `experiments.md`, `FINAL-REPORT.md`, `gt/`, `harness/` — verified present) stays in place,
  untouched. It is not moved or archived — it is the evidence base for the pipeline's measured
  accuracy and the two untriaged `live_db` test failures below.

## What state it is in (the parking mechanism)

- **Importable:** every file listed above stays on disk, at its current relative path, with no
  edit that would make it fail to import (aside from the two moves noted under "Stale pointers").
- **Unit-tested:** its own unit tests (`tests/app/cds/`, `tests/domain/cds/`,
  `tests/counselle_db/test_packets.py`, `tests/counselle_db/test_reading_rules.py`,
  `tests/api/test_cds_admin_auth.py`, `tests/adapters/test_cds_pdf.py`) keep running and keep
  passing — they are not deleted, not skipped, not marked `xfail`. `tests/domain/test_purity.py`
  already whitelists `domain/cds/` in its purity gate and needs no change. (Two exceptions, both
  `live_db`-marked and both pre-existing before school-data-v3 — see "The dormant tests" below.)
- **Unmounted:** `api/main.py`'s import of `cds_admin` and its router mount, and its
  `start_cds_worker` lifespan start/stop, are removed (not merely disabled) — seven lines in total
  (2 imports, 1 router mount, 4 lifespan-related), named in "Revival steps" below as the ones a
  revival re-adds.
- **Flag-gated to off:** `COUNSELLE_CDS_WORKER_ENABLED` defaults to `false`. The parking switch is
  this flag plus the removed lifespan call — **not** an unset `COUNSELLE_DB_PIPELINE_DSN`. That DSN
  is repurposed to drive the facts crawler under v3, and if it were set while the untouched
  `start_cds_worker` still ran, the old poller would spin forever against the now-dropped
  `cds_extractions` table.
- **Tables dropped:** the seven CDS-specific `cds_library` base tables (`cds_documents`,
  `cds_domain_packets`, `cds_extractions`, `cds_manifests`, `cds_school_years`, `ct_index_entries`,
  `ct_index_state`) are removed from the live database at Phase 0 (D9) — their DDL and data survive
  only in the two locations above, not as live tables. `schools` is the one pre-v3 `cds_library`
  table that is *not* dropped — it is redefined (unchanged shape, per the plan) as part of the live
  v3 seed and remains a live table throughout.
- **Route/nav removed, not disabled:** the three `Cds*Page` frontend routes and their `router.tsx`
  imports are deleted; the `admin/cds/*` redirect is kept and re-pointed at the new
  `/app/admin/facts` screen. **That destination does not exist until Phase 1** — until it ships, a
  hit on `admin/cds/*` (stale bookmark or link) still falls through `router.tsx`'s outer `*` to
  `/app/tasks` unexplained, exactly as it would if the redirect were deleted outright; re-pointing
  it now only means it starts resolving correctly the moment Phase 1 adds the route, with no
  further edit to `router.tsx`. The superuser sidebar entry that used to link to `/app/admin/cds`
  is **hidden** for this same Phase 0 → Phase 1 window (`adminShellRoutes` in
  `frontend/src/app/shell/navigation.tsx` is emptied, not re-pointed) — leaving it live would have
  put a guaranteed dead click in front of every superuser, since both the old CDS screen and the
  new facts screen are unreachable right now.

  **Phase 1 must:** restore one entry to `adminShellRoutes` in
  `frontend/src/app/shell/navigation.tsx` — `{ id: "cds", title: "CDS", icon: <DatabaseZap />, link:
  "/app/admin/facts" }` (re-add the `import { DatabaseZap } from "lucide-react";` alongside it) —
  once `/app/admin/facts` exists. This is new Phase 1 work, not a revival of parked code, so it is
  not in "Revival steps" below.

## Import edges into the parked tree (must stay stable; a change here needs a matching update to this file)

Verified live in the current tree (source: `plans/school-data-v3.md` §6a, spot-checked by grep
against the files themselves):

1. `adapters/cds_store.py:34-35` → `counselle_db.models.ServiceError`,
   `counselle_db.packets.{compile_manifest, parse_packet_row}` (parked → live, into a live module).
2. `counselle_db/packets.py:11-12` → `counselle_db.formatting.{format_cds_edition, format_decimal}`,
   `counselle_db.models.{DomainRow, ServiceError}` (parked → live).
3. `app/cds/service_review.py:48` → `counselle_db.formatting.format_decimal` (parked → live).
4. `app/cds/service_ingest.py:31` and `app/cds/service_review_approve.py:42` →
   `model_name_from_setting`, imported `from app.agent_node import model_name_from_setting` — the
   function's real home is `app/model_selection.py` (hoisted in this phase, Unit B), and
   `app/agent_node.py` re-exports it (`from app.model_selection import model_name_from_setting as
   model_name_from_setting`) deliberately, because
   `tests/app/test_profile_memory_services.py:637` imports it from `app.agent_node` inside a test
   body. The three other live importers (`app/titles.py`, `app/workspace/document_summary.py`,
   `evals/runner.py`) were repointed to import directly `from app.model_selection import
   model_name_from_setting` in this same phase (Unit F) — same object either way, so leaving these
   two parked importers on the `app.agent_node` re-export costs nothing and was left as-is (not
   worth touching parked-tree files for a non-functional import-path preference). Nine current
   importers of `model_name_from_setting` verified by grep: `app/model_selection.py` (definition),
   `app/agent_node.py` (re-export), `app/titles.py`, `app/workspace/document_summary.py`,
   `evals/runner.py`, `tests/app/test_profile_memory_services.py` (test-body import, pinned) — six
   live — plus these two parked importers and `adapters/cds_gemini.py` (a ninth, also parked, see
   "Known stale pointers" below).
5. `api/routes/cds_admin.py:21-26,63-66,316` → `api.auth`, `api.deps`, `api.ratelimit`,
   `api.users_db`, and the app's `runtime.{pipeline_pool, app_pool, deps.catalog}` attributes (which
   stay on the runtime object; `pipeline_pool` may be `None`).
6. `adapters/cds_store.py:468` → `settings.supported_packet_extractor_versions` (the parked-config
   block above).
7. The five parked scripts (`_cds_crash_test_worker.py`, `cds_domain_diff.py`,
   `cds_manifest_check.py`, `publish_cds_manifest.py`, `verify_cds_adapters.py`,
   `verify_cds_engine.py` — six, not five; recorded as measured in the plan) →
   `counselle_db.db.create_pool`, `get_settings`.
8. `counselle_db/service.py:32` → the packet guards in `counselle_db/packets.py` — this is the one
   **live → parked** edge (the direction that matters most for "is anything on the live path still
   reaching into the parked tree"). It is removed in Phase 3 when the packet/manifest guard code in
   `counselle_db/service.py` is deleted outright.
9. **New in this phase:** `counselle_db/packets.py` imports `hex_digest` back from
   `counselle_db/formatting.py` (done — Unit F closed the loose end Unit B left of a duplicate
   local `def hex_digest` in `packets.py` alongside the moved one; both bodies were byte-identical,
   so `packets.py` now just imports it on the same line as `format_cds_edition`/`format_decimal`).
   `hex_digest` moved out of `packets.py` and into the live `formatting.py` in this phase, because
   `catalog.py` (a live, boot-path module) needs it for `profile_sha256` and must not import the
   parked module to get it.

## Known stale pointers (left as-is deliberately — D8 does not require editing comments inside parked code)

- `app/cds/jobs.py:182`'s comment names both `cds_data_enabled` and `EmptyCatalog`. `EmptyCatalog` is
  genuinely deleted this phase. `cds_data_enabled` is **not** dead — it is a live `Settings` field
  (`config/settings.py:259`, default `False`) with two live consumers: `app/deps.py:97` (gates
  whether the MCP toolset is built) and `app/workspace/service_reference.py:44` (the interim guard
  in `_compatible_test_policy`, gating real citation logic today — removed in Phase 3). The comment
  is not corrected, since it is inside parked code nobody runs; do not read "both are dead" out of
  it — only `EmptyCatalog` is.
- `adapters/cds_gemini.py:88`'s docstring says "Duplicated from `app.agent_node.model_name_from_setting`"
  — after this phase's hoist to `app/model_selection.py`, the docstring names the pre-hoist location.
  Not corrected, for the same reason.
- `adapters/cds_store.py`'s docstring reference to `deploy/seed/cds_library_schema.sql` now means
  `deploy/seed/parked/cds_extraction_schema.sql` (Unit A's move has landed). Not corrected.

## Revival steps, in order

1. Apply the parked DDL: run `deploy/seed/parked/cds_extraction_schema.sql` against the target
   database (re-creates the **seven** base tables, four views, triggers, and grants — not eight;
   the eight-table count belongs to the live v3 seed's own new tables, a different schema). This
   file's `CREATE TABLE cds_school_years` references `cds_library.schools(id)`, so the target
   database must already have `schools` populated (the live v3 seed's table) before this script
   will apply — confirmed by restore-verification (Phase 0, Unit F): applying it against a schema
   with no `schools` table fails with `relation "cds_library.schools" does not exist`. This file's
   grant block deliberately does not grant on `schools` or `school_profiles` (neither is this file's
   object to grant on), so applying it cannot widen `cds_library_app`'s privileges beyond the
   `SELECT`-only grant the live v3 seed already gives it on `schools` (and the none it gives it on
   `school_profiles`) — confirm that invariant still holds (`scripts/dev.py`'s
   `_print_grant_verification_summary` checks it) after this step, not as a separate manual regrant.
2. Restore the data: either restore
   `artifacts/school-data-v3/20260906T214018Z-cds-preserve/cds_data.dump` (the data-only dump,
   restore-verified — see "Database DDL and data" above) or `COPY` the four
   `deploy/seed/parked/*cds*.csv.gz` files back in.
3. Set `COUNSELLE_DB_PIPELINE_DSN` to a database that has the CDS tables from steps 1-2 (note: under
   v3 this DSN is shared with the facts crawler — reviving CDS writes on the same DSN the facts
   crawler uses means both systems now write through `cds_library_app`; confirm that is still the
   intended shape before flipping the flag).
4. Set `COUNSELLE_CDS_WORKER_ENABLED=true`.
5. Re-add the seven removed `api/main.py` lines: the two `cds_admin`/`start_cds_worker` imports, its
   router mount, and the four `start_cds_worker` lifespan start/stop lines.
6. Mount the router (the `api/main.py` edit in step 5 does this) and re-add the three frontend
   routes to `router.tsx` (`Cds*Page` imports + route entries) and the `AdminGate`-gated nav entry.
7. Confirm `scripts/cds_manifest_check.py` still reproduces the recorded `content_sha256` against
   the restored manifest data before trusting anything served from the revived path.

## The dormant tests and the two untriaged failures

Two pre-existing `live_db`-marked test failures were found at the CDS admin polish-2 batch's
baseline (before this re-architecture) and are recorded, untriaged, in `TODOS.md`. They go dormant
with the rest of the `live_db`-marked CDS tests when the live database no longer has CDS tables to
run against — they are not fixed, not newly broken, and not to be assumed closed. When the parked
system is revived, re-run these two specifically before assuming the parked test suite is clean.

**Confirmed dormant (Phase 0, Unit F — first `live_db` run against the actual v3 database, since
port 5433 was held by the old container throughout Units A-E):**
`uv run pytest -m live_db` → 203 passed, 3 failed, 1776 deselected. Two of the three failures are
exactly the two named above (`tests/app/cds/test_service_review.py::
test_pending_active_update_predicate_resolves_and_closes`,
`tests/domain/cds/test_packet_build_golden.py::
test_rebuild_a_live_packet_byte_identical_from_its_own_contract`) — still failing, now for the
anticipated dormancy reason (`UndefinedTableError: relation "cds_library.cds_manifests"/
"cds_library.active_cds_domain_packets" does not exist`, since the seven CDS-specific `cds_library`
base tables were correctly dropped per D9), not the original untriaged logic/fixture-drift reason recorded in
`TODOS.md`. The third failure, `tests/api/test_b4.py::test_config_shape`, is **unrelated to CDS or
this re-architecture** — a hardcoded skill list in that test does not include `essay-brainstorm`
(and the other new essay-* skills added by the college-essay skill library, already on `main` at
this branch's fork point, `4eb52f6`); it is a pre-existing bug outside D8's scope, not fixed here,
and worth a `TODOS.md` entry.

## What must not be deleted

- Any file listed under "What is parked" above.
- `plans/school-data-v2.md` — the RAG-corpus design measured on the CDS PDFs, kept for the day the
  corpus is used again.
- `specs/cds-pipeline/tuning/` — the measured ground truth and harness behind the pipeline's accuracy
  claims; without it the two untriaged failures above could never be triaged.
- `deploy/seed/parked/*` (present — see "Database DDL and data" above), and the pre-nuke full-schema
  dump `artifacts/school-data-v3/20260906T214018Z-prenuke/full.dump` and the data-only dump
  `artifacts/school-data-v3/20260906T214018Z-cds-preserve/cds_data.dump` (both present and
  restore-verified — see above) — and, once made, their off-workstation copy (**not yet made**, an
  owner action, tracked above).

## The rule that keeps this from rotting

Per `plans/school-data-v3.md` §10: every file this re-architecture touches is in exactly one of
three states — `PARKED` (listed here, with a revival step), `DEAD` (deleted in the phase that
orphaned it), or `LIVE` (load-bearing, unchanged or actively maintained). A file that is neither
running, nor listed here with a revival step, nor deleted, is a bug in this file or a bug in the
phase that should have updated it — not a third, unnamed state. Every phase after Phase 0 that
touches a parked path (or discovers a new one) updates this file in the same commit; it is not a
write-once document.
