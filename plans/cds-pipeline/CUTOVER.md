# CDS pipeline — cutover runbook

Operational steps to finish replacing the separate `counselle-data-pipeline` repo with
the in-app CDS pipeline. Read `docs/adr/0036-cds-pipeline-in-app.md` first for what
changed and why.

Nothing here is destructive to student-facing data. The one genuinely risky item is
password rotation (§2), which is also the one real security fix in this list.

---

## 0. State at the time of writing (verified 2026-08-18)

| Thing | State |
|---|---|
| `counselle-data-pipeline-app-1` | Exited ~4 weeks |
| `counselle-data-pipeline-worker-1` | Exited ~4 weeks |
| `counselle-data-pipeline-db-1` | **Up, healthy, and still required** — this is the shared Postgres both systems use |
| `cds_library` schema | 8 base tables + 5 reader views, migrations 0001–0004 applied |
| Real data | 2,746 school profiles, 5,946 CT-index rows, 5 school-year slots, 5 documents, 217 packets, manifest 5.0.2 current |
| Writer role | `cds_library_app` — INSERT/SELECT/UPDATE on all base tables, **no DELETE grant anywhere** |
| Reader role | `counselle_ro` ∈ `cds_library_reader` — SELECT on exactly the 5 views |

Because the old worker has been stopped for weeks, there is no two-writer race to
resolve. The cutover is mostly bookkeeping plus the password rotation.

---

## 1. Stop and decommission the old pipeline

The compute is already stopped; this makes it permanent and removes the ability for it
to start writing again.

```bash
cd /home/saifuddin/Projects/counselle-data-pipeline
docker compose ps                      # confirm app + worker are Exited, db is Up
docker compose rm -f app worker        # remove the stopped compute containers
```

**Do not** `docker compose down` and **do not** stop or remove `counselle-data-pipeline-db-1`.
That container is the live Postgres holding `cds_library` *and* `counselle.*`; stopping it
takes down Counselle itself.

If you want the database container to outlive the old repo's compose file, move it to its
own compose project or a plain `docker run` unit before deleting anything else. Until then,
keep `docker-compose.yml` in place even though the app/worker services are dead.

---

## 2. Rotate the placeholder database passwords ⚠️ security

The live database is still using the credentials committed to the old repo's
`.env.example`. They are genuinely enforced (scram-sha-256 — a wrong password is rejected),
they were simply never rotated.

| Role | Current password | Action |
|---|---|---|
| `cds_library_app` | the unrotated `.env.example` placeholder | Rotate |
| `postgres` | the unrotated `.env.example` placeholder | Rotate |

```sql
-- as a superuser on 127.0.0.1:5433/counselle_data
ALTER ROLE cds_library_app WITH PASSWORD '<new-strong-secret>';
ALTER ROLE postgres        WITH PASSWORD '<new-strong-secret>';
```

Then update every consumer:

1. `.env` in this repo — `COUNSELLE_DB_PIPELINE_DSN` (the only consumer of `cds_library_app`).
2. Any deploy/secret store that carries these values.
3. Restart the Counselle API so the pipeline pool reconnects.

Verify afterwards:

```bash
# writer still works
uv run python -c "import asyncio,asyncpg,os; asyncio.run(asyncpg.connect(os.environ['COUNSELLE_DB_PIPELINE_DSN']))"
# reader path untouched
uv run pytest -m live_db -q
```

Rotation was deliberately deferred out of P0 to avoid breaking a running system
mid-build. There is no longer a reason to defer it.

---

## 3. The old repository

**Archive it — do not delete it.** `counselle-data-pipeline/config/cds/` is the provenance
of the 1,149 metric definitions now living in this repo's `config/cds/`, and the old
`src/` is the only record of how manifest 5.0.2 and packet v8 were originally produced.

Suggested: mark the GitHub repo archived (read-only), and leave the local clone in place.
Add a note at the top of its README pointing at `docs/adr/0036-cds-pipeline-in-app.md`
in this repo so anyone who lands there knows where the live system went.

---

## 4. Flag for whoever owns deploy tooling

Two schemas exist on the live database that appear in **no** migration in either repo:

- `cds_deploy_export`
- `cds_deploy_seed`

They contain static snapshot tables and are correctly inaccessible to `counselle_ro`.
Nobody on this project knows what writes them. Identify the owner and either document
them or remove them; an undocumented schema on a production database is a liability.

---

## 5. Verification checklist

Run after §1 and §2. The point is to prove the **student-facing path is unchanged** —
that was the central design constraint of this whole change.

- [ ] `uv run python scripts/cds_manifest_check.py` prints
      `c821b2e61cf71f99c1f8503f8940bbce48354b978e091bb81223718784ad6f0a` and exits 0
      (the ported catalog is still byte-identical to the live manifest; a mismatch would
      make every existing packet report `current_definition_match = false`)
- [ ] The 5 reader views still return data for `counselle_ro`, and base tables still
      return `permission denied`
- [ ] A student-facing school query returns the same values as before cutover
- [ ] `uv run pytest -m "not live_llm and not live_search and not live_db"` — no new failures
- [ ] `cd frontend && npm run typecheck && npm run lint && npm run test && npm run build`
- [ ] Admin surface: `/app/admin/cds` loads for a superuser and 403s for a normal user
- [ ] Upload → process → review → approve round-trips, and the approved document appears
      in `cds_library.active_cds_documents`
- [ ] The CDS worker starts with the API and stops cleanly on shutdown

---

## 6. Known limitations carried into production

State these plainly to anyone relying on the data. None are blockers; all are honest gaps.

- **Per-metric recall is 65.6%**, measured on Harvard (up from 17.9% pre-batching),
  partially corroborated on Cornell. It is **not** a whole-corpus number and it is not 100%.
- Only `admissions` has an independently estimated answerable ceiling (80–98 of 152 on
  Harvard), against which its 85 verified metrics is near-saturation. `degrees` (20.9%)
  and `transfer` (41.6%) most likely retain real headroom.
- Cost is ~$0.30/document; latency roughly 6–20 minutes depending on document size.
- **Hash-scoped incremental re-extraction is deferred.** `rerun` re-extracts full domain
  sets, so a manifest change means paying for everything, not just what changed.
- The ported metric `instructions` were hand-authored against Harvard and Yale only, so
  they generalise unevenly across institutions.
- Deliberately not built (see `PLAN.md` §I2): College Transitions scraping/auto-download,
  XLSX ingestion, split-CDS aggregation, the Gemini Batch API, SSE job progress, and RBAC
  beyond `is_superuser`.
- Review-screen flag precision has **not** been measured. One live document showed 83
  unresolved flags; spike evidence suggests many excerpt-mismatch flags are false alarms
  on documents with imperfect text layers. Until measured, expect review to be noisier
  than the two-minute design target.

---

## Cutover execution log (2026-08-18)

Full cutover completed across two sessions on `feat/cds-pipeline` @ `317fd81`. This is
the complete record — including the parts a prior session finished before this one
picked up §4–§6.

### §1 — Decommission old compute (done in prior session, re-verified here)

- `counselle-data-pipeline-app-1` and `counselle-data-pipeline-worker-1` removed via
  `docker compose rm -f app worker`.
- `counselle-data-pipeline-db-1` left running throughout. Confirmed `Up (healthy)` at
  the start of this session, and again `Up 25 hours (healthy)` at the end — never
  touched, never restarted.

### §2 — Password rotation (done in prior session, re-verified here)

- `cds_library_app` and `postgres` role passwords rotated off the `.env.example`
  placeholders. New credentials recorded only in the session scratchpad
  (`cds_cutover_rollback_note.txt`, `.cds_new_app_pw`, `.cds_new_pg_pw`) — never
  committed to any tracked file.
- `.env` in this worktree and in `/home/saifuddin/Projects/counselle/.env` updated
  consistently with the new `COUNSELLE_DB_PIPELINE_DSN`.
- Re-verified this session: `COUNSELLE_DB_RO_DSN` → `counselle_ro`,
  `COUNSELLE_DB_APP_DSN` → `counselle_app`, `COUNSELLE_DB_PIPELINE_DSN` →
  `cds_library_app` all connect with the rotated credentials (see §5 below).

### §3 — Old repository (left to the owner)

Local clone at `/home/saifuddin/Projects/counselle-data-pipeline` retained, not deleted.
**Not pushed and not archived on GitHub** — the owner is handling the outward-facing
archive action, per explicit instruction for this session.

### §4 — Old repo provenance note

Added a provenance blockquote to the top of
`/home/saifuddin/Projects/counselle-data-pipeline/README.md`, pointing at
`docs/adr/0036-cds-pipeline-in-app.md` in this repo and stating the old repo is kept
only for the `config/cds/` (1,149 metric definitions) and `src/` provenance. Committed
alone as `517b85f` (`docs: note repo retirement, point to ADR 0036 in Counselle app`)
in the old repo — `scripts/` and `specs/queue-progress-and-bulk-extraction/` (unrelated
untracked directories already present in that repo) were left untouched, staged
explicitly by filename, never `git add -A`. **Not pushed**, per instruction.

Also flagged: `cds_deploy_export` / `cds_deploy_seed` schemas (§4 above, "flag for
whoever owns deploy tooling") were **not** investigated this session — still open,
owner to identify.

### §5 — Verification checklist results

| Check | Result | Evidence |
|---|---|---|
| `cds_manifest_check.py` hash | **PASS** | Printed `c821b2e61cf71f99c1f8503f8940bbce48354b978e091bb81223718784ad6f0a`, exit 0 — exact match. |
| 5 reader views return data / 8 base tables denied | **PASS** | As `counselle_ro`: `active_cds_documents` 5 rows, `active_cds_domain_packets` 65 rows, `cds_document_sources` 21 rows, `cds_manifest_snapshots` 14 rows, `school_profiles` 2,746 rows — all OK. All 8 base tables in `cds_library` (`cds_documents`, `cds_domain_packets`, `cds_extractions`, `cds_manifests`, `cds_school_years`, `ct_index_entries`, `ct_index_state`, `schools`, discovered via superuser `\dt` since `counselle_ro` can't even see them in `information_schema`) returned `InsufficientPrivilegeError: permission denied` when queried directly by name. |
| Student-facing school query unaffected | **PASS** | `uv run pytest -m live_db tests/counselle_db/test_live_db.py -v` — 4/4 passed (`test_current_five_view_contract`, `test_parameterized_query_and_binary_rejection`, `test_manifest_metric_membership_is_structural_not_description_substring`, `test_reader_cannot_select_pipeline_base_table`). Also confirmed interactively: `resolve_school`/`get_school_profile` through `counselle_db/service.py` (the same layer the student agent's MCP tools call) returned real data for Alabama A&M University. |
| Routine pytest suite, no regressions | **PASS** | `uv run pytest -m "not live_llm and not live_search and not live_db"` → **8 failed, 1677 passed, 230 deselected** — matches the stated baseline exactly, no increase. Failures are pre-existing (MCP toolset transport assertion, `setup_db.sql` SQL-string assertions, golden-transcript fixtures) and unrelated to this cutover. |
| Frontend typecheck / lint / test / build | **PASS** | `npm run typecheck` clean. `npm run lint` → exactly 2 pre-existing errors, both in files untouched by this cutover (`src/components/ui/onboarding-setup.tsx:112` ref-during-render, `src/features/ai-chat/components/CitationRenderer.tsx:103` unused assignment). `npm run test` → 81 files / 923 tests passed. `npm run build` → succeeded (only a pre-existing >500kB chunk-size advisory, not an error). |
| Admin surface gating | **PASS** | Started API (`--api-port 8010`) + Vite (`--web-port 5183`) via `scripts/dev.py --no-open --no-migrate` (chosen to avoid the ports already in use by another live worktree), polled `/v1/health` for readiness. Registered two throwaway accounts (`cutover-admin@…`, `cutover-normal@…`), promoted the admin one with `scripts/promote_admin.py --email cutover-admin@…`. API layer: `GET /v1/admin/cds/coverage` → `403 {"detail":"Forbidden"}` as the normal user, `200` with real coverage JSON (7 schools, 19 editions) as the superuser. Browser layer (Playwright, cookies injected via `context.addCookies` since the dev Vite port isn't in the hardcoded CSRF-allowed origin list): superuser navigating to `/app/admin/cds` stayed there and rendered the live "CDS Coverage" dashboard; normal user navigating to the same URL was silently client-redirected to `/app/ai` (`AdminGate.tsx` — a route-level redirect, not a page-level 403, confirmed by prior code reading). Both servers killed cleanly afterward (`kill -INT` on the `dev.py` process → "✓ stack stopped", ports 8010/5183 confirmed free). Test accounts left in the dev DB (harmless). |
| CDS worker starts with API, stops cleanly | **PASS (indirect evidence)** | `app/cds/jobs.py` only logs on the *abnormal* paths (`cds_worker_not_started`, lease-sweep warnings, task crashes) — the happy-path start is silent by design. Across the full dev-server session log, `cds_worker_not_started` never fired (it would have, since `COUNSELLE_DB_PIPELINE_DSN` is configured and `cds_worker_enabled` defaults `true` with no override in `.env`), and there were zero `Traceback`/exception lines anywhere in the log. On shutdown (`kill -INT`), the log shows `Waiting for application shutdown.` → `Application shutdown complete.` → `Finished server process` with no errors — `cds_poller.stop()` runs in `api/main.py`'s lifespan `finally` block before the pools it depends on close, and that path completed without raising. |
| Upload → process → review → approve round-trip | **NOT RUN — deliberately out of scope this session.** | Not included in this session's requested checklist; also costs ~$0.30 and 6–20 minutes of live Gemini extraction per `CUTOVER.md` §6. Left open for a follow-up session if the owner wants it exercised before relying on new-document ingestion. |

### Outcome

Read path, write path (password rotation), and admin surface all verified working
against the rotated credentials. `counselle-data-pipeline-db-1` confirmed
`Up (healthy)` before and after this session's work. No regressions in either backend
or frontend test suites. Remaining open items, all deliberately deferred to the owner
or a follow-up session: GitHub archive of the old repo (§3), the undocumented
`cds_deploy_export`/`cds_deploy_seed` schemas (§4), and the upload/process/review/
approve round-trip (§5, last row above).
