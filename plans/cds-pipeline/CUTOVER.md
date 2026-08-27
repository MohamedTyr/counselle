# CDS pipeline — cutover runbook

Operational steps to finish replacing the separate `counselle-data-pipeline` repo with
the in-app CDS pipeline. Read `docs/adr/0036-cds-pipeline-in-app.md` first for what
changed and why.

Nothing here is destructive to student-facing data. The one genuinely risky item is
password rotation (§2), which is also the one real security fix in this list.

---

## 0. State at the time of writing (verified 2026-08-27)

**Supersedes the 2026-08-18 block below (kept in the execution log for history).** The
2026-08-18 PASS predates the 394-metric cut, the manifest republish, and 30+ commits — it
described a system that no longer exists. This block reflects Phase 4, the live ship gate
(`SHIP-PLAN.md` §"Phase 4 — Prove it end to end, live"), now complete.

| Thing | State |
|---|---|
| `counselle-data-pipeline-app-1` / `-worker-1` | Still decommissioned, unchanged since §1 |
| `counselle-data-pipeline-db-1` | Still up, healthy, still the shared Postgres — unchanged since §1 |
| Manifest | **`5.1.0` published and current** — `content_sha256 = 6367c0fee822f4d07725abc7274c8a589edefd64fb7301eac8372568941b04ae`, 394 metrics, 13 domains, extraction contract 8. `5.0.2` demoted. The DB previously held **1,149-metric** content under the `5.0.2` version string — that stale-version collision is what blocked every write before this session (§0.3/§0.5 in `SHIP-PLAN.md`) |
| Corpus | Documents **1, 2, 4, 5** (Harvard 2025, Harvard 2024, Yale 2024, UPenn 2024) — 13/13 domains each, 52 active packets, `NOT current_definition_match` count = **0** |
| Database pollution (§0.11) | Phase 1.0 disposed of the 16 polluted `cds_school_years` rows found this session — see the Phase 4 execution log below for what was retired vs. kept |
| Writer role | `cds_library_app` — INSERT/SELECT/UPDATE on all base tables, **no DELETE grant anywhere** (unchanged) |
| Reader role | `counselle_ro` ∈ `cds_library_reader` — SELECT on exactly the 5 views (unchanged) |
| Plan phases | 1, 2, 3 complete; 4.1–4.5 executed this session (below); 6.4, 6.7, 6.8 complete |

Because the old worker has been stopped for weeks, there is no two-writer race to
resolve. The cutover is mostly bookkeeping plus the password rotation.

### 0 (original, 2026-08-18) — kept for history, no longer current

| Thing | State |
|---|---|
| `counselle-data-pipeline-app-1` | Exited ~4 weeks |
| `counselle-data-pipeline-worker-1` | Exited ~4 weeks |
| `counselle-data-pipeline-db-1` | **Up, healthy, and still required** — this is the shared Postgres both systems use |
| `cds_library` schema | 8 base tables + 5 reader views, migrations 0001–0004 applied |
| Real data | 2,746 school profiles, 5,946 CT-index rows, 5 school-year slots, 5 documents, 217 packets, manifest 5.0.2 current |
| Writer role | `cds_library_app` — INSERT/SELECT/UPDATE on all base tables, **no DELETE grant anywhere** |
| Reader role | `counselle_ro` ∈ `cds_library_reader` — SELECT on exactly the 5 views |

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

- **[Updated 2026-08-27, supersedes the paragraph below]** The shipped configuration
  (`tuning/FINAL-REPORT.md` §12, 2026-08-25, "option A" by that section's title but its
  numbers match column **C**/`exp32` — a confusing label, not a wrong number) measures
  **99.01% accuracy, 96.96% coverage, 4 known hallucinations, $0.2088/document, 419.3s
  latency**. **4 of the 5 `SHIP-PLAN.md` §1 floors were missed — only the coverage floor
  was met** (`FINAL-REPORT.md` §12's own table shows accuracy/hallucinations/cost/latency
  all ✗; its prose says "three floors," which is an arithmetic slip its own table
  contradicts — corrected here). ~~Per-metric recall is 65.6%, measured on Harvard (up
  from 17.9% pre-batching), partially corroborated on Cornell.~~ That 65.6% figure was
  measured against the **pre-cut 1,149-metric** catalog, before deliberation tuning
  existed — it describes a system that no longer exists and is superseded by the numbers
  above.
- Only `admissions` has an independently estimated answerable ceiling (80–98 of 152 on
  Harvard), against which its 85 verified metrics is near-saturation. `degrees` (20.9%)
  and `transfer` (41.6%) most likely retain real headroom. (This estimate predates the
  394-metric cut and has not been re-measured against it.)
- **[Updated 2026-08-27]** ~~Cost is ~$0.30/document; latency roughly 6–20 minutes
  depending on document size.~~ Superseded by the shipped-configuration numbers above
  ($0.2088/document, 419.3s). Phase 4.1's real re-extraction of 4 documents cost
  **$0.9126 total** ($0.1799 / $0.1847 / $0.2817 / $0.2663 per document), latency 1421s
  total — about 9% over the plan's $0.84 estimate.
- **[Updated 2026-08-27]** ~~Hash-scoped incremental re-extraction is deferred.~~ Shipped
  in Phase 6.8: `scripts/cds_domain_diff.py` plus `diff_domain_hashes` /
  `changed_domains_since_publish` in `app/cds/manifest.py`. A manifest change no longer
  requires paying for every domain — only the domains whose hash actually changed.
- The ported metric `instructions` were hand-authored against Harvard and Yale only, so
  they generalise unevenly across institutions.
- Deliberately not built (see `PLAN.md` §I2): College Transitions scraping/auto-download,
  XLSX ingestion, split-CDS aggregation, the Gemini Batch API, SSE job progress, and RBAC
  beyond `is_superuser`.
- **[Updated 2026-08-27]** ~~Review-screen flag precision has **not** been measured.~~ It
  has: `plans/cds-pipeline/flag-precision.md` measured all 83 flags on **one document**
  (Alabama A&M, `document_id=2018`) and a fix shipped off that measurement. This is
  **single-document evidence, not corpus-wide** — treat it as directional, not a general
  precision figure, until measured on more documents.

---

## 7. Owner decisions recorded this session (2026-08-27)

Both decisions were required by `SHIP-PLAN.md` Phase 4's precondition, before 4.1 was
allowed to run. Recorded here per the Phase 7 docs-table rows that flag `tuning/
experiments.md`/`FINAL-REPORT.md` as the wrong permanent home for them.

### §0.9 (`D8`/`F4`, vintage-loss escalation) — decision: **MITIGATE**

The 394-metric cut deleted `context_bindings` (and their binder metrics) in 10 of 13
domains, which silently drops the period qualifier from the rendered vintage string (e.g.
"; entering class: Fall 2024" becomes just the bare CDS year) with no error and no flag.
Rather than accept the coarser vintage silently, a `vintage_period_unavailable` caveat now
fires whenever a rendered vintage lacks a period qualifier the manifest promised — whether
the domain lost its `context_bindings` in the cut (10 of 13 domains), a declared binder
failed to resolve at read time, or only some of several contexts resolved. The wording is
**metric-scoped, not domain-scoped**: an earlier domain-scoped draft would have been false
for the 3 domains with partial context coverage (e.g. reading `financial_aid
.aid_reporting_academic_year` — itself the binder qualifying its own siblings — would have
told a student the whole domain lacks period qualification when only some metrics do).
Confirmed live in a student-facing answer during the §4.2 re-run (below).

### §0.12 (`D18`, holdout-gap escalation) — decision: **VERIFY**

The shipped 99.01% accuracy / 4-hallucination figures were measured on UGA, Cornell,
Caltech, UCF, Dartmouth — **zero overlap** with the four documents this plan actually
publishes (Harvard ×2, Yale, UPenn). Rather than ship on the five-document proxy alone, a
hand spot-check of document 1 (Harvard 2025) against its source PDF checked 11 of 394
retained metrics. 9 confirmed correct — including several where the new run **corrected**
prior errors (`selection_factor_*`, `class_rank`). It found **one hard extraction error**:
`class_size.students_per_faculty` read as `7` where the CDS prints "11 to 1" — the model
read an adjacent institution-added "Ugrad Ratio 7" annotation instead of the ratio field.
The spot-check is exactly what the D18 escalation was for: the tuning accuracy figures
were measured on a corpus with zero overlap with what actually shipped, and the spot-check
is what caught a real error the proxy evidence could never have caught.

**Root cause, worth recording plainly.** The M1 cut deleted
`undergraduate_supplemental_reported_value`, a sink metric whose instructions literally
cite *"Harvard's 2025-26 form prints '7' this way"* — it existed to absorb exactly this
distractor and keep `students_per_faculty` clean. The cut kept the warning text inside
`students_per_faculty`'s own instructions but removed the structural safeguard, and the
warning text alone was not enough to stop the model. The other three documents (Yale,
UPenn, Harvard 2024) extracted this metric correctly (7 / 5 / 8, all matching their PDFs)
— only Harvard's page layout has the trap.

**Five metrics were hand-corrected via the review edit path before approval**, each
verified against the source PDF:

| Document | Metric | Corrected to |
|---|---|---|
| doc 1 (Harvard 2025) | `class_size.students_per_faculty` | 11 |
| doc 1 (Harvard 2025) | `admissions.high_school_completion_requirement` | `diploma_or_equivalent_not_required` |
| doc 1 (Harvard 2025) | `financial_aid.aid_notification_fixed_selected` | True |
| doc 4 (Yale 2024) | `cost.cost_academic_year` | '2025-2026' |
| doc 5 (UPenn 2024) | `cost.cost_academic_year` | '2025-26' |

All five read back correctly through the live read path after approval.

**Consequence for the headline accuracy figures wherever they're cited (§6 above and
`SHIP-PLAN.md` §0.5):** they remain the best available evidence, but they were measured on
a corpus with zero overlap with the four schools actually shipped, and the tuning loop's
own benchmark set never exercised Harvard's page layout — which is precisely where the one
real error surfaced. Treat the 99.01%/4-hallucination figures as a proxy, not
corpus-specific evidence, until a broader spot-check exists.

### §0.11 database pollution — disposal record

Full inventory and disposal plan lived in `SHIP-PLAN.md` §0.11/Phase 1.0; this is the
after-the-fact record of what was actually done.

- **The honesty-critical row** — Amherst College, `cds_school_years.id = 4015`, year 2091
  (fabricated), document 2013, a section-A-only probe PDF — was live in the student read
  path (2 real packets, `class_size`/`identity`, serving under a fabricated year). Fixed
  first, before any other Phase 1.0 work: `cds_documents.invalidated_at` set for document
  2013, `cds_school_years.active_document_id` cleared for row 4015, `retired_at` set (2091
  has no legitimate future use).
- **12 fabricated-year Alabama A&M rows** (`4008, 4009, 4011, 4012, 4013, 4020, 4021, 4022,
  4024, 4028, 4029, 4030` — years 2091–2195): the 11 with a live candidate document were
  rejected through the existing `service_review.reject_document` path; row `4009` had no
  candidate (both referencing documents already orphaned/invalidated) — nothing to reject.
  All 12 rows retired (`retired_at` set) — a fabricated year has no legitimate future use.
- **Stanford (`id = 4026`) and Dartmouth (`id = 4027`)** — real years (2025, 2024)
  contaminated by a dogfooding candidate upload. Candidates rejected via the same existing
  path. **Rows NOT retired** — 2025/2024 are real CDS years these schools may still need a
  legitimate document for; retiring would have blocked a future legitimate upload.
- **Yale University, `id = 3`, document `3` (`yale_cds_2024-25_rmd_20250612.pdf`) — the
  decide-and-resolve row.** Six consecutive `identity_year_mismatch` failures since
  2026-07-14, unresolved for six weeks. **Decision: reject the stuck candidate** via the
  existing, already-legal path (document 3 was a genuine candidate, never active). **The
  row was NOT retired** — 2025 is Yale's legitimate next CDS year (Yale already has a clean
  active 2024 document, `id = 4`), so the slot stays open for a future legitimate upload.

**Gate re-run after disposal:** Amherst College/2091 no longer appears in
`active_cds_domain_packets`; `SELECT count(*) FROM cds_school_years WHERE academic_year >
2030 AND retired_at IS NULL` → 0; Stanford/Dartmouth rows have `candidate_document_id IS
NULL` and `retired_at IS NULL`; Yale's row 3 is no longer stuck. The corpus for Phase 4
was cleanly the 4 documents `1, 2, 4, 5`.

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

---

## Phase 4 execution log (2026-08-27) — the ship gate

This is the item the 2026-08-18 log left open: the upload/process/review/approve
round-trip, run for real this time as `SHIP-PLAN.md` Phase 4 — "the gate `PLAN.md` §H
P5/P7 specifies and that has never been executed... this is the actual proof the feature
works." Both Phase 4 preconditions (§0.9, §0.12) were resolved first — see §7 above — and
Phase 1.0's database-pollution disposal ran before this, since it's a prerequisite (also
§7 above). Evidence lives under `artifacts/cds-phase4*/`.

### 4.1 — Parity re-extraction of the existing corpus

Re-extracted all 4 active documents (`1, 2, 4, 5`) under manifest `5.1.0`. All 4 succeeded
**13/13 domains**. `SELECT count(*) FROM active_cds_domain_packets WHERE NOT
current_definition_match` → **0**, unconditional gate met with no hedge (Phase 1.0 having
already disposed of document 2013's dev pollution, so the corpus was clean going in).

**Cost: $0.9126 total** ($0.1799 / $0.1847 / $0.2817 / $0.2663 per document), **latency
1421s total** — about 9% over the plan's $0.84 estimate (`SHIP-PLAN.md` §4.1, based on
the shipped configuration's measured $0.2088/document).

**The value diff (risk 6's mitigation) — the important finding, not a footnote.** 111
changed values across the 4 documents; 15 were real-value→None. Investigation against the
source PDFs (`artifacts/cds-phase4-investigation/`, `diff.log`, `value_diff.py`) split
these 15 into two very different buckets:

- **11 were the new run CORRECTING prior fabrications**, not losses:
  - UPenn `class_profile.sat_composite_p25/p50/p75` (740/760/770 → None): UPenn's C9 table
    has **no SAT Composite row** at all — the old packet had relabelled the "SAT
    Evidence-Based Reading + Writing" row as composite. The new None is the honest answer.
  - Harvard 2024 `*_units_required` ×6 (english/math/science/foreign_language/
    social_studies/history): the values actually sit in C5's **"Units recommended"**
    column, not "required" (which is blank on this form). The M1 cut deleted the
    `*_units_recommended` metrics, so these numbers correctly have nowhere to go now — not
    a regression, a consequence of a decision already made.
  - UPenn `cost.food_and_housing_on_campus_*` (19876 → None): a **derived sum** of the
    separate Room ($13,132) + Board ($6,744) rows, which the metric's own instructions
    forbid computing. The new None is correct; the old value violated its own metric spec.
- **4 were genuine skips** (`extraction_status: not_extracted`) with unambiguous PDF
  evidence — real coverage loss, not a false alarm.

### 4.2 — Student-facing read path, not just the write

Ran the eval set and confirmed **zero regressions** attributable to the CDS republish, the
§0.9 caveat change, or any commit landed this session (full eval detail in 4.2's own
subsection below). Called `counselle_db.service.get_domain` directly for a re-extracted
school/domain: `current_definition_match` no longer flags it, and the §0.9 MITIGATE
decision is live — the `vintage_period_unavailable` caveat rendered in a real student-
facing answer during this run, not just decided on paper.

### 4.3 — Full admin round-trip, in a browser (`artifacts/cds-phase4-browser/`)

Run against real PDFs from `artifacts/cds-corpus/`, including `ohio-state_2023-2024.pdf`
(187 pages) per the plan's instruction to fold 4.5's large-document check into this same
round-trip. **8 of 10 steps passed outright.** Screenshots `01`–`16` in
`artifacts/cds-phase4-browser/` document the full sequence: coverage grid, empty-cell
prefill, drag-3-PDFs (including one duplicate and one unrecognisable), corrected/ready-to-
process, extraction complete, review screen, evidence-chip jump, approve-blocked,
approve-anyway dialog, approved, coverage updated with no manual refresh, plus the
`active_update` rerun/correction/re-approval sequence (12–16, folding in 4.4).

**Three defects found and fixed this session** (not pre-existing — introduced or missed
during this branch's own earlier phases):

1. **The review screen had no Approve control at all for an `active_update`
   correction.** `readOnly = !is_candidate` gated the control off entirely for a
   correction to an already-active document — §2.4 had specified broadening this and the
   §2.4 work missed the case. Backend was provably correct (the API accepted the
   correction); the UI made it unreachable. Fixed.
2. **The upload Year `<Select>` was inoperable by mouse and keyboard** — it used a plain
   `useRender` wrapper instead of base-ui's Select trigger, so it never opened correctly.
   Fixed (`artifacts/cds-phase4-fixes/`, `01-year-select-open.png`,
   `task2-year-select-open.png`, `task2-year-select-typeahead.png`).
3. **Duplicate detection surfaced a retired dev-pollution document** — an admin uploading
   a fresh document saw a stale "Alabama A & M University, 2091–92" duplicate match
   (fabricated year, from the §0.11 pollution disposed of in Phase 1.0). Fixed.

### 4.4 — `active_update` round-trip, in a browser

Folded into the 4.3 sequence above (screenshots 12–16): reran an already-active document,
the review screen now accepts the correction (fix #1 above), approved, confirmed the
document never left `active` and the new packets are live on next load
(`16-active-update-approved-fresh-load.png`).

### 4.5 — Resilience checks

- **Worker death:** killed the process mid-run; on next boot the job swept to
  `failed`/`worker_lost` and the document was re-runnable — confirmed.
- **Drift guard:** re-ran the 1.3 gate against the live DB; failed as `manifest_drift`
  with **zero model calls**, proven by patching `_process_calls` to raise if invoked
  (it never fired).
- **Auth:** every admin route 200 as superuser, 403 as a normal user — confirmed, and now
  permanently covered by a test (P5's gate, also never executed before this session).
- **Large document:** `ohio-state_2023-2024.pdf` (187 pages, run through 4.3) completed
  **twice** (11m41s, 9m31s) inside the 900s lease. `cds_max_pages_per_call` (named in
  `PLAN.md` §I1 risk 6's mitigation list but never built) is confirmed **not needed yet**
  — page routing plus the 900s lease with background renewal are the load-bearing
  mitigation today, and Ohio State completing cleanly twice is live evidence of that.

### 4.2 detail — eval baseline, including the run history (don't flatten this)

Three runs against `evals/runner`, recorded honestly rather than just the final number:

- **Run 1: 24 PASS / 8 FAIL.**
- **Run 2: 23 PASS / 9 FAIL, with 6 Vertex 429s.** Attribution found the counselor's model
  client had **no retry/backoff configured at all**, unlike the pipeline's Gemini client —
  a transient 429 became a hard failed turn for a real student, not just a failed eval
  run. This was a genuine production bug, found because Phase 4 ran the eval set live
  under real load; fixed before re-running.
- **Run 3 (the baseline): 27 PASS / 5 FAIL, zero rate-limit errors.** Of the 5 failures:
  - 2 were mid-stream transport crashes (`httpx.ReadError`, `RemoteProtocolError`) that
    produced no content. **Both re-ran individually and PASSED**, including the
    honesty-critical `caveat-stale-partial` case.
  - 1 was a checker regex gap (since fixed) that failed an actually-correct answer.
  - 2 are pre-existing agent-behaviour gaps, not caused by this session's changes (below).
  - **Effective result: 29/32, with 2 known agent gaps**, not a raw 27/32.

**The two known agent gaps, recorded as known-open, not fixed this session:**

- `guided-counselor` ends a turn on a bare `ask_student` with no framing prose — reproduced
  in all three runs, so not new.
- `deep-research-triangulates` cited CDS for a deadline the eval prompt scoped to
  official-site-only — newly **visible** this session (not newly introduced) because the
  retry fix let this eval case be scored on content for the first time; runs 1–2 never got
  far enough to exercise it.

**Zero regressions** were attributable to the CDS republish, the §0.9 vintage-loss
mitigation, or any commit landed this session — evidence in
`artifacts/cds-phase4-eval2/`, `artifacts/cds-phase4-eval3/eval-run.log`.

### Phase 4 outcome

All of 4.1–4.5 pass. This closes the ship gate — `SHIP-PLAN.md`'s Phase 4 gate is: "all of
4.1–4.5 pass. Record the results in `CUTOVER.md`... This phase is the ship gate." Three
real defects were found and fixed along the way (the missing Approve control, the broken
Year select, the stale-duplicate false positive), one real extraction error was caught by
the §0.12 spot-check and hand-corrected (`students_per_faculty`), one real production bug
was caught and fixed by running the eval set live (missing retry/backoff on 429s), and the
§0.9/§0.12 owner decisions are both resolved and live in the student-facing product, not
just decided on paper. Remaining open items are unchanged from the 2026-08-18 log: GitHub
archive of the old repo (§3), the undocumented `cds_deploy_export`/`cds_deploy_seed`
schemas (§4), plus the two known agent-behaviour eval gaps recorded above.
