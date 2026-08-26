# CDS Pipeline — ship plan

**Branch:** `feat/cds-pipeline` · **Status:** engine built, not shippable · **Owner decision recorded:** keep the metric cut
**Goal:** take the in-app CDS pipeline from "code exists, cannot write a packet" to "fully functional CDS management, end to end, verified live."

This plan supersedes nothing. `PLAN.md` is the build plan (P0–P7) and stays the architectural
reference; `CUTOVER.md` is the operational runbook and its §0 state block is now stale.
This document is the ordered list of what remains.

Every fact below was verified against the live database and the current source tree on
**2026-08-26**. Verified facts are marked ✅ with the evidence inline. Nothing here is
inferred from the plan's own prose about what was done.

---

## 0. Ground truth (verified 2026-08-26)

### 0.1 The metric catalog — the cut stands

The M1 cut (`91d07a2`) is **kept**. It is the owner's decision and this plan does not
revisit it. The exact number, since it has been quoted loosely:

```
version               5.0.2  (on disk, unchanged)
content_sha256        ae78912f23f693a3bd11313b798ccd957b93eaf51c9e1574a29b4470fc421196
extraction_contract   8
domains               13
metrics               394      ← not "~350"; the precise count
```

✅ `uv run python -c "from pathlib import Path; from domain.cds.manifest_compile import compile_manifest; c=compile_manifest(Path('config/cds')); print(c.content_sha256, sum(len(d['metrics']) for d in c.content['domains']))"`

Per-domain: `admissions` 98, `financial_aid` 67, `cost` 43, `degrees` 41, `class_profile` 36,
`academics` 24, `transfer` 23, `class_size` 17, `identity` 14, `student_life` 13,
`outcomes` 10, `enrollment` 4, `faculty` 4.

### 0.2 The live database

```
cds_library.cds_manifests
  5.0.2   c821b2e6…  is_current = t   published 2026-07-16   ← 1,149-metric content
  5.0.1   369087ea…  is_current = f
  5.0.0   60a97b28…  is_current = f
  (+ 4.0.0, 3.3.0, 3.2.0 …)

active packets   54, across 5 active documents (4 at 13/13 domains + Amherst College
                 [document_id=2013] at 2/13 — see §0.10 for why). **This is the
                 pre-cleanup count.** §0.11 documents that document 2013 is dev pollution,
                 not a corpus member, and Phase 1.0 disposes of it — after which the corpus
                 is 4 documents, all at 13/13. §0.11 also covers 15 further polluted
                 `cds_school_years` rows the earlier audits never surfaced, one of which
                 (this same Amherst slot) is live in the student read path today.
```

✅ `psql "$COUNSELLE_DB_PIPELINE_DSN" -c "SELECT version, encode(content_sha256,'hex'), is_current FROM cds_library.cds_manifests ORDER BY published_at DESC"`

**The DB was never republished.** Disk says `ae78912f` / 394 metrics; the DB's `5.0.2` row
says `c821b2e6` / 1,149 metrics. Same version string, different content. This is the
divergence that blocks everything.

### 0.3 What that divergence actually does — the corrected mechanism

Two earlier audits described this wrongly in opposite directions. The real chain:

1. `app/cds/manifest.py:205` `verify_manifest_current()` is the intended pre-flight drift
   detector. ✅ **It is called from nowhere in the repo** (`rg -n verify_manifest_current`
   returns only its own definition, its `__all__` entry, and prose in `plans/`). Dead code.
   So there is no clean stop before spending money.
2. The run therefore proceeds and pays Gemini for a full extraction.
3. `adapters/cds_store.py:329` `insert_packet()` round-trips every packet through the
   reader's own `parse_packet_row()` **against the DB-stored manifest snapshot**, inside
   the transaction, before COMMIT.
4. `counselle_db/packets.py:285-288` checks
   `packet.domain_schema_hash == historical_domain.schema_hash`. The packet's hash comes
   from the compiled 394-metric config; `historical_domain` comes from the DB's
   1,149-metric `5.0.2` row. **Mismatch → `packet_identity_mismatch` → rollback.**

**Net effect: every extraction fails at commit, after being paid for. Zero packets can be
written.** The honesty gate holds — this is a loud failure, not a silent lie. The 54
existing active packets still match `c821b2e6` and students are served correctly today.
The pipeline is simply non-functional.

### 0.4 Constraints on the fix

```
cds_manifests_pkey                  PRIMARY KEY (version)
cds_manifests_content_sha256_key    UNIQUE (content_sha256)
cds_manifests_one_current_idx       UNIQUE (is_current) WHERE is_current
cds_manifests_immutable             BEFORE UPDATE → reject_immutable_manifest()
```

✅ The trigger body raises `'manifest snapshot is immutable'` if any of `version`,
`content_sha256`, `content`, `domain_hashes`, `extractor_contract_version`, `created_at`,
`published_at` changes. It **permits** `is_current` to be flipped.

Consequences, and they are not negotiable:
- **`5.0.2` cannot be rewritten in place.** Updating its content is blocked by the trigger.
- **The fix must be a new version row.** There is no other path short of DDL surgery on a
  schema this plan has no mandate to touch (`PLAN.md` §C1: `cds_library` gets zero DDL).
- Flipping `is_current` is allowed, so the publish transaction can hand over cleanly.

### 0.5 The read-path consequence of republishing — honest, not spurious

`cds_library.active_cds_domain_packets` computes:

```sql
COALESCE(p.domain_schema_hash = current_domains.domain_schema_hash, false) AS current_definition_match
```

✅ `psql -tAc "SELECT pg_get_viewdef('cds_library.active_cds_domain_packets'::regclass, true)"`

So the moment a 394-metric manifest becomes current, all 54 existing packets flip to
`current_definition_match = false` and students see a "definitions have changed" caveat.

**Precisely why the hashes differ — not the version bump.** `domain_hashes` are computed
from `_semantic_domain(domain, prompt)` — `{id, metrics minus NON_SEMANTIC_METRIC_KEYS,
prompt, contract}` (`domain/cds/manifest_compile.py:316-322`) — which does **not** include
the root `version` string. `content_sha256`, by contrast, hashes the whole compiled
content including `root`, which does include `version` (`manifest_compile.py:374-382`). So
editing `version: "5.0.2"` → `"5.1.0"` alone would **not** change any domain hash and would
**not** by itself trigger `current_definition_match = false`. ✅ Verified directly: all 13
compiled domain hashes differ from the DB's stored `5.0.2` domain hashes, and none is
missing — the mismatch is caused by the metric cut and any prompt/contract wording changes
baked into the compiled domains, not by the version string. Don't let a future reader
conclude the caveat can be cleared by reverting the version bump — it can't; reverting it
changes nothing about the domain hashes that actually drive the caveat.

**That caveat is true.** The definitions did change — 755 metrics were removed. Surfacing
it is the honest behaviour, and the honesty carve-out says we do not suppress it. It is
cleared the correct way: by re-extracting those documents under the new manifest (Phase 4),
which touches the **4**-document corpus (§0.11 disposes of the 5th, document 2013, as dev
pollution before Phase 4 runs). Cost: the plan previously estimated ~$0.30/document; the
shipped configuration's actual measured cost is **$0.2088/document**
(`tuning/FINAL-REPORT.md` §12, see the Phase 7 docs-table row) — 4 × $0.2088 ≈ **$0.84**.

Do **not** reach for a shortcut that backdates hashes or special-cases the view.

### 0.6 There is no manifest publish script

✅ `rg -ln "cds_manifests"` across the repo actually returns 11 files, not 5: the 5 code
sites below, plus this plan document itself and 5 other prose files that merely discuss
manifests (`plans/cds-pipeline/PLAN.md`, `CUTOVER.md`, `recon-db-live.md`,
`recon-old-pipeline.md`, `recon-backend.md`). Scoped to code, the substantive point holds:
`docs/DATABASE_GUIDE.md`, `adapters/cds_store.py`, `scripts/verify_cds_engine.py`,
`app/cds/manifest.py`, `specs/db-rewire/plan/01-pipeline-contract.md` — **every one of them
a SELECT.**

`PLAN.md` §I2 cut the manifest-publish *UI* on the grounds that "manifest publishing is a
script, run rarely, by one person." The UI was correctly cut; **the script was never
written.** It lived in the retired repo and was not ported. This is a missing P0/P1
deliverable, not a new feature.

Reference implementation to port:
`/home/saifuddin/Projects/counselle-data-pipeline/src/counselle_data_pipeline/library/manifest.py:641-689`
(`publish_manifest`). Its shape is correct and should be preserved: advisory lock →
`SELECT … WHERE is_current FOR UPDATE` → refuse if the version exists with different
content → INSERT with `is_current = false` → `UPDATE … SET is_current = false WHERE
is_current AND version <> $1` → `UPDATE … SET is_current = true WHERE version = $1`, all in
one transaction. Note the ordering: the partial unique index means the old row must be
demoted before the new one is promoted.

### 0.7 Repo state

```
branch vs main        11 behind, 30 ahead      ✅ git rev-list --left-right --count main...HEAD
root DESIGN.md        does not exist on branch ✅ ls DESIGN.md
plans/…/tuning/       118 MB, 224 tracked files, 53 untracked paths (47 dirs + 6 files —
                       the 6 are gt/passes/_adj_u_*.json)
ruff (repo-wide)      93 errors — 100% inside plans/cds-pipeline/tuning/
ruff (--exclude plans) All checks passed!      ✅
mypy (repo-wide)      hard-fails: duplicate module `crop` under tuning/harness/scratch_*
mypy (--exclude plans) 3 errors, all pre-existing in scripts/finish_render_staging.py ✅
CDS-scoped tests       109/109 green (`tests/app/cds` + `tests/domain/cds`: 108 passed,
                       1 deselected) — this is what earlier audits meant by "109/109,"
                       and it is not the full routine suite
routine suite (full)  `uv run pytest -m "not live_llm and not live_search and not
                       live_db"` → **8 failed, 1676 passed, 230 deselected** ✅ — the
                       pre-Phase-1 baseline, before this plan adds any test. Settled,
                       not an open question: all 8 are pre-existing, unrelated to CDS, and
                       verified identical on `main` — see the corrected breakdown below.
                       (Phase 2.5 adds one `live_db`-marked test; by Phase 3.3 this reads
                       231 deselected, not 230 — see that gate.)
```

**Correction to an earlier audit's breakdown.** The 8 failures are not "two clusters" but
**four distinct mechanisms** — an MCP transport assertion, three tests on a missing
`search_school_site` tool, two protocol-fixture drift tests, and a `cds_data_enabled` /
`setup_db.sql` pair — all pre-existing, unrelated to CDS, and confirmed identical on `main`.

The 11 missing commits are main's design-system rebuild: `c4f02d1` (four token tiers +
Schools), `a11bd31` (wine brand + sidebar), `e2ad390`, and `c389c50` — **the commit that
added root `DESIGN.md`**. The CDS admin UI was therefore built against
`plans/cds-pipeline/DESIGN.md` (the feature's own 1,102-line spec) and has never been
checked against the real one.

### 0.8 The `active_update` dead end — corrections after approval have no working path

Re-extracting an already-**active** document (not a newly uploaded candidate) is the
correction path `active_update` exists for. It is unreachable, which means Phase 4's own
corpus re-extraction (all 4 of its documents are already active — §0.11 disposes of the
5th, document 2013, before Phase 4 runs) cannot complete without a fix, and this is a
required implementation step, not a documentation fix.

✅ `cds_store.activate_packet` is called from exactly two places, both in
`app/cds/service_review.py` (`:453`, `:470`), both inside `_apply_edits_and_activate`,
reached only from `approve_document`. `engine.py` never calls it.

✅ `approve_document` (`:489`), `reject_document` (`:556`), and `save_metric_edits` (`:274`)
each hard-refuse unless `raw.document.is_candidate` —
`COALESCE(sy.candidate_document_id = d.id, false)` (`adapters/cds_admin_queries.py:150`).

✅ `rerun_extraction` (`:596-597`): when `domains is None` and the document `is_active`, it
sets `target_kind = "active_update"` and creates the extraction — but never touches
`candidate_document_id`. The new packets land with `is_active = false` (the column's
default; `insert_packet`, `adapters/cds_store.py:391-406`, never sets it) and there is no
code path back to `activate_packet`. They are stored, valid, and permanently invisible.

**The constraint that rules out the obvious fix:**
```
cds_school_years_check  CHECK (active_document_id IS NULL OR candidate_document_id IS NULL
                                OR active_document_id <> candidate_document_id)
```
✅ `\d cds_library.cds_school_years`. A document cannot be both `active_document_id` and
`candidate_document_id` for the same school-year at once — so "point `candidate_document_id`
at the same document that's already active, then approve normally" is not legal SQL, let
alone a legal state. Requiring `active_document_id` to be cleared first would also take the
school offline mid-review, which the honesty carve-out argues against: a school a student
is looking at right now shouldn't go dark because an admin queued a routine correction.

**The fix — see Phase 2.** Weighed against the honesty carve-out (a re-extraction can
change a value a student already saw, so it deserves a human look, not a silent flip):
- **(a) auto-activate on run success, no review** — rejected. Cheap, but bypasses review on
  data that may have genuinely changed.
- **(b) as literally stated** ("let review/approve operate on the extraction against the
  still-active document by making it a candidate too") — rejected as written; it is not
  legal SQL under the constraint above.
- **Chosen: (b)'s intent, implemented without touching `candidate_document_id` at all.**
  The document-level `is_candidate`/`is_active` pointer answers one question — "which PDF
  is this school-year's current source" — and is orthogonal to packet-level activation,
  which is already correctly scoped to `(document_id, extraction_id, domain_id)`
  regardless of the document's candidate/active status. Review and approval for an
  `active_update` extraction can operate directly against the still-active document: the
  document keeps serving its current packets, domain by domain, until each corrected
  packet is individually activated at approval — never a document-level cutover, never an
  offline window. This is what packet-level `is_active` and the `active_update` target
  kind were already shaped for; it just needs the three gates wired to admit this case, and
  a way to know when a case has stopped being pending — see Phase 2.1 for the two bugs a
  naive "does a succeeded `active_update` extraction exist" predicate has (it never closes,
  and it collides with the ordinary edit-and-approve path) and the fix, which reuses the
  existing unwritten `cds_extractions.reactivated_at` column as a resolution marker rather
  than adding schema.

### 0.9 Vintage-loss escalation (D8/F4) — unresolved, owner decision required

`plans/cds-pipeline/tuning/experiments.md` finding **F4** / decision **D8** (2026-08-23,
marked **ESCALATED** by the tuning session, but never surfaced in this ship plan or in
`AGENTS.md`/`docs/`): the metric cut deleted `context_bindings` blocks — and their binder
metrics — in 10 of 13 domains. ✅ Verified live in `counselle_db/packets.py:427-438`:

```python
vintage = f"CDS {academic_year}-{str(academic_year + 1)[-2:]}"
for context in definition.contexts:
    ...
    vintage += f"; {context.label}: {', '.join(displays)}"
```

With `context_bindings` gone, `definition.contexts` is empty for those 10 domains, the loop
never runs, and the vintage string silently loses its period qualification — e.g.
"; entering class: Fall 2024" — with no error and no flag. This is not a hypothetical
consequence of the cut sitting inertly on disk: it is a hard-encoded fact of it, and it
becomes real for students **the moment those 10 domains' packets are re-extracted and
activated** — which is exactly what Phase 4.1 is about to do to 4 already-active
documents. Today's 54 active packets still carry full vintage context because they predate
the cut; that stops being true the instant Phase 4 runs.

This is honesty-critical under `AGENTS.md`'s carve-out and cannot be resolved inside this
plan's mandate — the only fix (re-adding the cut binder metrics) contradicts the owner's
already-recorded decision to keep the 394-metric cut, which this plan does not revisit.
**Required: an explicit owner decision, made before Phase 4.1 runs** (see Phase 4's
precondition and the Phase 7 docs table):
- **Accept and disclose** — the vintage string becomes coarser (year only, no period
  qualifier) for the 10 affected domains; document this plainly wherever CDS data
  provenance is described.
- **Mitigate** — e.g. omit the misleading half-formed suffix logic entirely for domains
  with no contexts (already correct behaviour — the loop simply doesn't fire) but add an
  explicit, separate disclosure that period qualification isn't available for these
  domains, rather than relying on its silent absence to communicate that.

Not proposing which; this plan surfaces it loudly instead of silently discovering it live.

### 0.10 Document 2013's mechanism — why it failed 10 of 13 domains

✅ `SELECT document_id, count(*), count(*) FILTER (WHERE NOT current_definition_match) FROM
cds_library.active_cds_domain_packets GROUP BY document_id`:

```
document_id | rows_in_view | not_matching
1           | 13           | 1
2           | 13           | 0
4           | 13           | 0
5           | 13           | 0
2013        | 13           | 11
```

`2013` is filed as "Amherst College" — active (`active_document_id = 2013`), never a
candidate. ✅ Its extraction history: one `candidate` run requesting all 13 domains, `status
= 'partial'`, plus one later `active_update` that succeeded for `identity` alone. Its
`validation_summary` shows exactly what happened: `class_size` and `identity` partially
verified (1/22 and 21/50 metrics), and the other **10** domains — `academics`,
`admissions`, `class_profile`, `cost`, `degrees`, `enrollment`, `faculty`, `outcomes`,
`student_life`, `transfer` — all failed with the **identical** error:
`"packet ... failed the reader's own parse_packet_row() round-trip: Stored CDS data for
this domain uses an unsupported/inconsistent contract; no values were returned."` That is
the exact `packet_identity_mismatch` failure mode §0.3 describes — this document's original
run already collided with a manifest-hash mismatch, predating this plan's fix.

**This is not a corpus member, though — see §0.11.** Document 2013 is
`amherst_2024-2025_secA.pdf`, a **section-A-only** PDF (`PLAN.md` §I2 explicitly cut
split-CDS aggregation — this is a probe of that cut case), filed under academic year
**2091**, one of 16 rows a 2026-08-18 dogfooding session left in `cds_school_years`. It
happens to also be **active**, which means its 2 successfully-verified domains
(`class_size`, `identity`) are live in the student-facing read path today under a
fabricated year. §0.11 is the full picture and the disposal plan (Phase 1.0); once disposed
of, the real corpus is the 4 documents `1, 2, 4, 5`, all already at 13/13 — the
`current_definition_match` gate in Phase 4.1 becomes achievable outright, with no hedge.

### 0.11 The database has 16 polluted `cds_school_years` rows — one live in the read path

A 2026-08-18 dogfooding session left junk behind that no prior audit, including this plan's
own §0.2/§0.10 before this revision, fully surfaced. ✅ Full inventory
(`cds_school_years` joined to `schools`/`cds_documents`):

```
 id  | school                     | year | active | candidate | filename
4008 | Alabama A & M University   | 2091 |        | 2008      | harvard_2024-2025.pdf
4009 | Alabama A & M University   | 2092 |        |     —     | (empty slot; orphaned docs, see below)
4011 | Alabama A & M University   | 2101 |        | 2010      | harvard_2024-2025.pdf
4012 | Alabama A & M University   | 2102 |        | 2011      | cornell_2022-2023.pdf
4013 | Alabama A & M University   | 2103 |        | 2012      | michigan_2024-2025.pdf
4015 | Amherst College            | 2091 | 2013   |     —     | amherst_2024-2025_secA.pdf
4020 | Alabama A & M University   | 2104 |        | 2015      | caltech_2024-2025.pdf
4021 | Alabama A & M University   | 2105 |        | 2016      | ohio-state_2023-2024.pdf
4022 | Alabama A & M University   | 2111 |        | 2017      | harvard_2024-2025.pdf
4024 | Alabama A & M University   | 2093 |        | 2018      | cornell_2022-2023.pdf
4028 | Alabama A & M University   | 2094 |        | 2021      | harvard_2024-2025.pdf
4029 | Alabama A & M University   | 2191 |        | 2022      | harvard_2024-2025.pdf
4030 | Alabama A & M University   | 2195 |        | 2023      | cornell_2022-2023.pdf
4026 | Stanford University        | 2025 |        | 2019      | dummy_unidentifiable.pdf
4027 | Dartmouth College          | 2024 |        | 2020      | dartmouth_2024-2025.pdf
   3 | Yale University            | 2025 |        | 3         | yale_cds_2024-25_rmd_...pdf
```

✅ 13 rows carry `academic_year > 2030` (fabricated years); 130 packet rows attach to them
in aggregate across their (mostly failed) extractions. Two rows — Stanford and Dartmouth —
carry real, legitimate years (2025, 2024) contaminated by a dogfooding candidate upload;
they are **not** fabricated and must not be treated the same way as the other 13 (below).

**Two things beyond what any prior audit reported, found during this revision's
verification:**

- **Row `4009` (Alabama A&M, year 2092) is a fully orphaned slot.** ✅ It has neither an
  `active_document_id` nor a `candidate_document_id` — both are `NULL` — yet two documents
  reference it: document `2009` (`harvard_2024-2025.pdf`, never invalidated, never pointed
  to by anything) and document `2014` (`dummy_unidentifiable.pdf`, `invalidated_at =
  2026-08-18 04:59:53`). Someone rejected an upload, tried a dummy replacement, rejected
  that too, and the empty year row was left behind. Neither document is reachable through
  any view today, so this is inert — but the school-year row itself (year 2092, fabricated)
  still clutters the admin coverage grid.
- **The Yale University row (`id = 3`, year 2025) has a stuck candidate**, document `3`
  (`yale_cds_2024-25_rmd_20250612.pdf`). ✅ It has failed **6 times** with
  `identity_year_mismatch`, first at 2026-07-14 09:42, last at 2026-07-15 00:13 — unresolved
  for six weeks as of this plan's verification date. 2025 is Yale's legitimate next CDS
  year (Yale already has a clean active 2024 document, `id = 4`) — this is not a fabricated
  year and the row must not be retired, only unstuck.

**The honesty-critical finding: Amherst College, academic year 2091, is live in the
student read path right now.** ✅
`SELECT school_id, academic_year, count(*) FILTER (WHERE packet IS NOT NULL) FROM
cds_library.active_cds_domain_packets GROUP BY 1,2` returns `164465 | 2091 | 2` (school
`164465` is Amherst College, confirmed against `cds_library.schools`). A fabricated academic
year, sourced from a section-A-only probe PDF, is serving 2 real packets (`class_size`,
`identity`) to any student who looks up Amherst College today. That is a live violation of
`AGENTS.md`'s honesty carve-out, not a hygiene item, and Phase 1.0 fixes it first, before
any other phase.

**Disposal constraint verified directly**, so Phase 1.0 doesn't guess at a mechanism: no
`cds_library` table grants `cds_library_app` (or any app role) DELETE — ✅ all 39 granted
`(table, privilege)` pairs are INSERT/SELECT/UPDATE only
(`information_schema.role_table_grants`). Disposal must be UPDATE-only, through the
existing write surface. Two gaps exist in that surface, both closed in Phase 1.0:

- **The existing candidate-reject path does not suffice for document 2013.** ✅ Verified
  directly: `service_review.reject_document` (`:556`) raises
  `CdsAdminValidationError("document is not a candidate")` for an active, non-candidate
  document — document 2013 has never been a candidate. Even bypassing the service layer,
  the adapter `cds_store.reject_candidate_document` only ever writes `invalidated_at` on
  the document and clears `candidate_document_id` — it never touches
  `active_document_id`. ✅ And it wouldn't be enough to invalidate the document alone
  either: both `active_cds_documents` and `active_cds_domain_packets` join purely on
  `sy.active_document_id = d.id` with no `d.invalidated_at` filter anywhere in either view
  definition — an invalidated-but-still-`active_document_id`-pointed-to document would
  keep serving. The fix has to clear the pointer, not just flag the document.
- **Nothing sets `retired_at`.** ✅ It's an existing column, and it's already the exact
  filter every admin coverage query uses to hide a school-year row
  (`adapters/cds_admin_queries.py:69,135,143,195`), but no adapter function writes it.

For the 11 candidate-only fabricated-year rows and Stanford/Dartmouth's contaminated
candidates, the existing `reject_document` path already works unmodified (all of those
documents genuinely are candidates, never active) — no gap there.

### 0.12 D18 escalation — the tuning accuracy figures have zero overlap with the corpus this plan publishes

`tuning/experiments.md`'s escalation list (2026-08-23) and `FINAL-REPORT.md` §11 both flag
**D18**: "the holdout is unscored because the corpus was capped at five documents" — never
surfaced in this ship plan or in `AGENTS.md`/`docs/` until this revision (✅ `rg -i
"D18|holdout" SHIP-PLAN.md` previously returned nothing).

**Why it has teeth, concretely.** The tuning ground truth is UGA, Cornell, Caltech, UCF,
Dartmouth (`FINAL-REPORT.md` §1); PennState is a **mechanical-only** holdout — §8 states
outright "it is not evidence of accuracy on PennState," zero of its extractions were
scored. ✅ The production corpus Phase 4.1 re-extracts and activates is documents `1, 2, 4,
5` — Harvard (2025 *and* 2024 vintages), Yale, University of Pennsylvania (`SELECT s.name,
sy.academic_year FROM cds_documents d JOIN cds_school_years sy ON sy.active_document_id =
d.id JOIN schools s ON s.id = sy.school_id WHERE d.id IN (1,2,4,5)`). **Zero overlap** with
either the five scored ground-truth schools or the one mechanical-holdout school. The
99.01% accuracy and 4-hallucination figures the shipped config carries (§0.5, §7 docs table)
were never measured on any document this plan actually publishes to students — they are the
best evidence available, not evidence *of this corpus*.

This is not something Phase 4.1's value-diff mitigation (risk 6) covers: that step diffs
*changed* values on a metric already present in the prior 1,149-metric packet — it says
nothing about a new failure mode specific to an institution the tuning loop never saw at
all (a different CDS layout, a metric convention Harvard/Yale/UPenn don't happen to exercise
the same way UGA/Cornell/Caltech/UCF/Dartmouth do).

**Required, same treatment as §0.9: an explicit owner decision before Phase 4.1 runs.**
Not proposing which — surfacing it loudly instead of silently discovering it live once
4 real institutions' data is already approved and serving students:
- **Accept** — ship on the five-document evidence as the best available proxy, understanding
  it is not corpus-specific evidence, and disclose that framing wherever the accuracy
  figures are cited (the same Phase 7 docs-table row that already carries them).
- **Verify** — spot-check a sample of Phase 4.1's actual re-extracted values by hand against
  the source PDFs for at least one of the four production documents before approving it,
  buying direct evidence on this corpus rather than relying on the five-document proxy.

See Phase 4's precondition and Definition of Done item 8, which now covers both escalations.

---

## 1. Phase order, and why

Seven phases, numbered by content (Phase 3 is always hygiene, Phase 4 is always the live
proof) so every cross-reference elsewhere in this plan stays stable. The **run order**
below is not the same as the number order — see the fourth bullet — and the phase sections
that follow are laid out in run order, not numeric order, so a reader hits them in the
sequence they actually execute.

The ordering is forced by five dependencies:

- Phase 1.0 (dispose of database pollution) runs first and blocks nothing else — it's
  independent, cheap, and fixes a live honesty violation (§0.11: Amherst College under a
  fabricated year, serving real packets to students today). No reason to let it wait.
- Phase 1 (unblock writes) gates **everything** else — no packet, of any kind, can be
  written until it's done.
- Phase 2 (make corrections reviewable) gates Phase 4 — Phase 4.1's own corpus
  re-extraction hits the `active_update` dead end (§0.8) on **all 4** of its documents
  (once Phase 1.0 has disposed of document 2013, every remaining corpus document is
  already active), so the ship-gate proof cannot complete without it.
- **Phase 4 (prove it live) runs immediately after Phase 2, before Phase 3.** Publishing
  `5.1.0` (Phase 1.1) puts all 54 active packets into a real, honest, but avoidable
  `current_definition_match = false` caveat (§0.5) that only clears once Phase 4.1
  re-extracts them. ✅ Verified nothing in Phase 3 (relocating 118 MB of tuning artifacts,
  tightening the lint scope) is a prerequisite for Phase 4 — Phase 3 only has to finish
  before Phase 5 (rebase), not before Phase 4 — so there is no dependency reason to leave
  that caveat live on real student-facing packets through an unrelated hygiene pass. This is
  the same live-honesty-violation lens Phase 1.0 already gets; it wasn't applied here in
  earlier drafts (risk 11).
- Phase 3 (hygiene) must precede Phase 5 (rebase) because rebasing 118 MB of experiment
  artifacts through a conflict-heavy merge is gratuitous pain.
- Phase 5 (rebase) must precede the frontend design re-audit, because the spec to audit
  against arrives with the rebase.

```
Phase 1  Dispose of pollution, then unblock  ← honesty fix + packets can be written at all
Phase 2  Make corrections reviewable        ← active_update extractions can be approved
Phase 4  Prove it end to end (live)         ← clears the current_definition_match caveat
                                                immediately, instead of after hygiene
Phase 3  Repo hygiene + green gates
Phase 5  Rebase onto main + design reconciliation
Phase 6  Correctness + structure
Phase 7  Docs, ADRs, graduation
```

Phases 1, 2, 4, and 3 are the ship gate (in that run order). Phases 5–7 are required for
merge but do not block the "is the pipeline functional" question.

---

## Phase 1 — Dispose of database pollution, then unblock the pipeline

**Goal:** the read path is honest (§0.11's Amherst row is gone) and a packet can be
written (§0.3's blocker is fixed). Two independent fixes bundled into one phase because
both are prerequisites everything else builds on, and both are cheap.

### 1.0 Dispose of database pollution (§0.11)

Three different disposal actions for three different situations — do not apply one
mechanism to all 16 rows uniformly; the years and states genuinely differ.

**(a) The 12 fabricated-year Alabama A&M rows** (`4008, 4009, 4011, 4012, 4013, 4020, 4021,
4022, 4024, 4028, 4029, 4030` — years 2091–2195, none legitimate):
- For the 11 with a live candidate document: reject it through the existing,
  already-legal path — `service_review.reject_document` /
  `cds_store.reject_candidate_document` — via a one-off script against
  `COUNSELLE_DB_PIPELINE_DSN` that calls the same service function the admin API calls (not
  a hand-written UPDATE; reuses the app's own write path).
- Row `4009` has no candidate (its two documents are already orphaned/invalidated, §0.11) —
  nothing to reject.
- Then retire all 12 rows: `UPDATE cds_school_years SET retired_at = now(),
  last_action_kind = 'retired' WHERE id = ANY($1)`. `retired_at` is an existing column
  within `cds_library_app`'s UPDATE grant, and it's already the filter every admin query
  uses to hide a row (§0.11) — add a small `cds_store.retire_school_year()` alongside the
  existing `reject_candidate_document`/`promote_candidate_document` pair so this isn't a
  bare inline UPDATE in a script. A fabricated year has no legitimate future use, so
  retiring the row (not just clearing its candidate) is correct here.

**(b) Amherst College, `id = 4015`, document `2013` — the honesty-critical one.** Active,
never a candidate, so the path in (a) does not apply (verified in §0.11: `reject_document`
refuses non-candidates, and even the adapter-level function never touches
`active_document_id`). Extend `cds_store.py` with the one write this needs — in a single
transaction: set `cds_documents.invalidated_at = now()` for document 2013, set
`cds_school_years.active_document_id = NULL` for row 4015, and set its `retired_at` (2091
is fabricated). This is a distinct case from Phase 2's `active_update` correction flow —
Phase 2 corrects an active document that's still good; this discards one that never was.

**(c) Stanford (`id = 4026`) and Dartmouth (`id = 4027`) — real years, contaminated
candidates.** Reject the candidate documents via the unmodified existing path, same as
(a)'s mechanism. **Do not retire these two rows** — 2025 and 2024 are real CDS years these
schools may still need a legitimate document for, and retiring would block a future
legitimate upload.

**(d) Yale University, `id = 3`, document `3` — decide and resolve, don't auto-dispose.**
Six consecutive `identity_year_mismatch` failures since 2026-07-14 (§0.11) is not
self-evidently a dogfooding artifact the way the others are — it's a real school's real
next-year CDS that keeps failing the same identity check. Before Phase 1.0 closes this row,
get an explicit call: retry (if the mismatch is fixable — e.g. a year-filing correction) or
reject via the existing path (legal today; document 3 is a genuine candidate, never
active). Record whichever is chosen, and why, in `CUTOVER.md`. Do not retire this row
either — 2025 is real.

**Gate:** re-run §0.11's queries. `SELECT school_id, academic_year, count(*) FILTER (WHERE
packet IS NOT NULL) FROM active_cds_domain_packets GROUP BY 1,2` no longer returns Amherst
College/2091. `SELECT count(*) FROM cds_school_years WHERE academic_year > 2030 AND
retired_at IS NULL` → 0. Yale's row 3 has a recorded decision and is no longer stuck.
Stanford's and Dartmouth's rows have `candidate_document_id IS NULL` and `retired_at IS
NULL`. The corpus for Phase 4 is now cleanly 4 documents: `1, 2, 4, 5`.

### 1.1 Choose the version number

Publish **`5.1.0`**. Rationale: the extraction contract is unchanged (still 8), the domain
set is unchanged (still 13), no metric was renamed or moved — this is a subtractive
catalog change within the same contract. A minor bump communicates that accurately. A
major bump (`6.0.0`) would falsely signal a contract break; reusing `5.0.2` is impossible
per §0.4.

Set `config/cds/manifest.yaml` `version: "5.1.0"`.

⚠️ **Changing the version string changes the compiled `content_sha256`**, because `version`
is part of the compiled content (§0.5's precision note: the version bump changes
`content_sha256`, but **not** the `domain_hashes` that actually drive
`current_definition_match` — the caveat comes from the metric cut, not the bump; the bump
still has to happen because `5.0.2` is immutable, §0.4). Recompute the hash *after* the
edit and use that value everywhere downstream — do not reuse `ae78912f…`, which is the hash
of the 5.0.2-labelled tree. Every hash pin in 1.4 must be updated from the post-edit
compile, in one pass.

### 1.2 Write `scripts/publish_cds_manifest.py`

Port `publish_manifest` from the old repo (§0.6) into a standalone script against
`COUNSELLE_DB_PIPELINE_DSN`. Requirements:

- One transaction, advisory lock `hashtext('cds_library:manifest-publish')`.
- Refuse with a clear error if the target version already exists with different content
  (the immutability rule, enforced in code as well as by the trigger).
- **Refuse if any extraction is in flight.** Inside the same transaction, before writing:
  refuse if any `cds_library.cds_extractions` row has `status IN ('queued', 'running')`
  (the states already used elsewhere, e.g. `adapters/cds_admin_queries.py:96`). This is
  risk 4 in the register below — the advisory lock serialises publishes against each
  other, but not against a run that's already mid-flight, and that run's packets would
  fail identity checks the moment the new manifest becomes current.
- `--dry-run` default: print the version, hash, per-domain hash diff vs the current
  manifest, and the count of active packets that will flip `current_definition_match` —
  then exit without writing. Require an explicit `--publish` to commit.
- Print the resulting `is_current` row on success.

The dry-run is not gold-plating: this is a one-shot irreversible write to an immutable
table, and the diff is the operator's only chance to catch a mistake.

**Gate:** `--dry-run` prints `5.1.0`, the new hash, 13 changed domain hashes, and "54
active packets will flip to current_definition_match=false"; running it with a queued or
running extraction present refuses with a clear error instead of writing.

### 1.3 Wire the drift guard

`verify_manifest_current()` is dead code (§0.3). Call it in the engine's pre-flight, before
any Gemini spend — the natural site is `run_extraction`'s preparation path in
`app/cds/engine.py` (`_prepare_run` / `run_extraction`, around `engine.py:917`), alongside
the existing `manifest_version_mismatch` check at `engine.py:937`.

On `ManifestDriftError`, fail the job with a distinct error code (`manifest_drift`) so the
admin UI surfaces "config/cds has drifted from the published manifest" rather than a
generic failure.

**Gate:** with a deliberately edited `config/cds/`, queueing an extraction fails
immediately with `manifest_drift` and **zero** model calls are made.

### 1.4 Update every hash pin, in one pass

From the post-1.1 compile:
- `scripts/cds_manifest_check.py:24` `EXPECTED_CONTENT_SHA256`
- `tests/app/cds/test_manifest.py:23-26`
- `tests/domain/cds/test_manifest_compile.py`

Also **fix the script's docstring**, which currently forbids exactly what was done to it
("do not adjust the expected constant here"). Rewrite it to state the real rule: the pin
tracks the *published* manifest, and changing it requires a matching publish. Silently
repinning it is what let this divergence ship.

Add an assertion that the pinned hash equals `compile_manifest()`'s output **and** that
`config/cds/manifest.yaml`'s version matches the pin's intended version, so a version edit
without a repin fails loudly.

### 1.5 Publish

Run `--dry-run`, read the diff, then `--publish`. Confirm:

```sql
SELECT version, encode(content_sha256,'hex'), is_current
FROM cds_library.cds_manifests ORDER BY published_at DESC LIMIT 3;
-- expect 5.1.0 is_current=t, 5.0.2 is_current=f
```

**Phase 1 gate:** 1.0's gate holds (§0.11 clean); `scripts/cds_manifest_check.py` exits 0;
`verify_manifest_current()` passes against the live DB; the routine suite is green (modulo
the 8 pre-existing failures, §0.7).

---

## Phase 2 — Make corrections reviewable

**Goal:** close the dead end in §0.8. Without this, no already-approved document can ever
be corrected or drift-cleared again — including the re-extraction Phase 4 is about to run
against **all 4** corpus documents (§1.0 disposes of the 5th; every remaining document is
already active).

**Chosen fix — see §0.8** for the full reasoning behind rejecting auto-activation and the
literal reading of "make it a candidate again." The short version: review, edit, and
approval extend to operate directly on an `active_update` extraction against the
still-active document, without the document ever becoming a candidate.

### 2.1 Fix `rerun_extraction`'s misclassification, then broaden the three document-level gates, with a predicate that actually resolves

**Bug found during this revision, upstream of the rest of this phase and of Phase 6.8.**
`rerun_extraction` (`service_review.py:596-597`) computes:
```python
reuse_active_slot = domains is None and raw.document.is_active
target_kind = "active_update" if reuse_active_slot else "full_reextract"
```
`and` binds `domains is None` first, so a **domain-scoped** rerun of an already-active
document (`domains=['identity']`) is classified `full_reextract` regardless of
`is_active`. That is exactly the case Phase 6.8 exists to make cheap — a targeted rerun of
one changed domain against an already-published document. Its packets land
`is_active = false` (§0.8's default) and match none of the three gates below, since none of
them admit `full_reextract` against a non-candidate document either: money spent, a packet
written, and no code path ever surfaces it for review. Fix the classification to key on
`is_active` alone:
```python
target_kind = "active_update" if raw.document.is_active else "full_reextract"
```
`full_reextract` now means what its name says — a full rerun of a candidate document.
`active_update` covers every rerun, full or domain-scoped, against an already-active
document. ✅ Verified this doesn't disturb any other consumer: `target_kind`'s only other
reads are the persisted column itself and 2.1's own predicate below (which already filters
on `target_kind = 'active_update'` and simply gains the case it was meant to cover); no
other code branches on `full_reextract` vs. `active_update`. The candidate-document path is
unaffected — a candidate document's `is_active` is false by construction
(`cds_school_years_check`, §0.8), so it still classifies as `full_reextract` before and
after this fix.

**This fix is a hard prerequisite for Phase 6.8**, not an independent cleanup: 6.8 adds the
first caller that passes a non-`None` `domains` list against an active document, and without
this correction every call it makes produces an unreachable packet, reopening the exact
false-badge failure mode Phase 2 exists to close. Sequence 2.1 before 6.8 (both are already
ordered that way — Phase 2 before Phase 6 — but note the dependency explicitly here, in 6.8,
and in the risk register (risk 2), since it isn't the kind of thing a phase-order table alone
makes obvious).

**Now, broaden the three document-level gates.**
`save_metric_edits`, `approve_document`, `reject_document` (`service_review.py:274, 489,
556`) each raise unless `raw.document.is_candidate`. Add a second admissible case: the
document `is_active` **and** there is a still-pending `active_update` extraction for it.

**Why the naive predicate is wrong — two convergent bugs, verified live.**

(a) **It never closes.** `activate_packet` (`cds_store.py:411-448`) flips
`cds_domain_packets.is_active`; it never touches the `cds_extractions` row itself. A
predicate of "does an `active_update` extraction with `status IN ('succeeded','partial')`
exist for this document" is therefore true forever, before *and* after approval — the exact
false-badge failure mode this status exists to prevent, inverted.

(b) **It collides with the routine edit-and-approve path.** ✅
`create_human_review_extraction` (`cds_store.py:518-548`), called from
`_apply_edits_and_activate` (`service_review.py:402`) on **every** approval that includes an
edit — candidate or active, this is the normal path, not an edge case — inserts its own row
with `target_kind = 'active_update'`, `status = 'succeeded'`, `extractor_version =
'human-review-v1'`. A predicate that only checks `target_kind`/`status` matches this row too,
so any document ever approved with an edit would show `correction_pending` permanently.

**The fix uses two discriminators already sitting in the schema — no new column.**
`cds_extractions.reactivated_at` (nullable, `CHECK (reactivated_at IS NULL OR status IN
('succeeded','partial'))`) exists today and is written by nothing in this codebase (✅ `rg
-n reactivated_at app/ adapters/ counselle_db/` returns nothing) — it is unused, not
load-bearing elsewhere, and `cds_library_app` already holds UPDATE on `cds_extractions`
(✅ `information_schema.role_table_grants`), so setting it costs zero DDL. It is reused here
as a **resolution marker**, distinct from the old pipeline's narrower "reactivate a stale
candidate" use of the same column name (`recon-old-pipeline.md:805`) — the name is a
coincidence of schema reuse, not the same feature; note this explicitly in code so a future
reader isn't misled into the old meaning. `extractor_version` distinguishes a genuine model
rerun (`counselle-cds-v1`) from the synthesized human-review row (`human-review-v1`), which
by construction is *born already applied* and should never itself read as pending.

**The predicate:**
```sql
SELECT id FROM cds_library.cds_extractions
WHERE document_id = $1 AND target_kind = 'active_update'
  AND status IN ('succeeded', 'partial')
  AND extractor_version <> 'human-review-v1'
  AND reactivated_at IS NULL
ORDER BY created_at DESC, id DESC LIMIT 1
```
This is a document-level gate ("is there any reviewable `active_update` for this document at
all"), a different granularity from the per-domain activation
`by_domain`/`DomainPacketSummary.extraction_id` already handles correctly, and the two must
not be conflated. None of the three endpoints currently carry an explicit `extraction_id`
(✅ `api/routes/cds_admin.py:290,306,330` all key off `document_id` only), so this query is
what resolves "the extraction being acted on" for review purposes. Closing the gate at
approve/reject (2.2/2.3) is a separate write, and it deliberately does **not** reuse this
query's `LIMIT 1` — see 2.2 for why a second, unreviewed rerun queued behind the one being
approved must close too, not just the single row this query surfaces (risk 10). The
`target_kind = 'active_update'` filter still matters on its own: without
it, an implementer could key off "most recent extraction for this document, full stop,"
which would wrongly admit review the moment an unrelated `full_reextract` on the same
document happens to be more recent. Candidate-document review keeps its existing behaviour
unchanged.

### 2.2 `approve_document`: skip the document-level swap, and close the gate

`promote_candidate_document` (`cds_store.py:582`) sets `active_document_id = document_id`
and clears `candidate_document_id` if it matches — both already true/no-ops when the
document is already active, so calling it is harmless, but skip it explicitly for the
`active_update` path so the audit log stays honest: this approval corrected an
already-active document in place, it didn't promote anything. Packet activation
(`_activate_untouched` / `activate_packet`) is untouched — it was already document-agnostic,
and this still holds when every touched domain's final packet lands under the new
human-review extraction id rather than the original.

**Close the gate — resolve every pending row for the document, not just the one reviewed.**
In the same transaction, after activation completes:
```sql
UPDATE cds_library.cds_extractions
SET reactivated_at = now()
WHERE document_id = $1 AND target_kind = 'active_update'
  AND status IN ('succeeded', 'partial')
  AND extractor_version <> 'human-review-v1'
  AND reactivated_at IS NULL
```
Deliberately no `LIMIT 1`. Without it: if rerun E2 is queued and succeeds before rerun E1 (on
the same document) is reviewed, 2.1's predicate (`ORDER BY created_at DESC LIMIT 1`) surfaces
E2 for review; closing only E2 would leave E1's `reactivated_at` NULL forever, so the next
predicate evaluation returns E1 and the coverage cell and review header chip flip back to
`correction_pending` over data that was correctly approved (risk 10). Chosen over the
alternative of refusing a second rerun while one is already pending: resolving every matching
row here is idempotent no matter how many reruns stack up unreviewed, and it doesn't add a
refusal an admin has to understand mid-workflow. Required regardless of whether the approval
touched every domain, some, or none — when every domain is touched, the reviewed
`active_update` row's own packets never get activated at all (superseded by the human-review
extraction's packets domain by domain), so packet-activation state alone cannot signal
"resolved" and the explicit marker is the only reliable close.

### 2.3 `reject_document`: don't invalidate the document — but do close the gate

`reject_candidate_document` (`cds_store.py:551`) sets `invalidated_at` on the document —
correct for rejecting a candidate upload, wrong for rejecting an `active_update`
correction, which must leave the still-serving active document alone.

**What "discard the pending extraction" can actually mean.** ✅ Verified:
`cds_library_app` holds no DELETE grant on any table (§0.11), and
`cds_extractions_status_check` permits only `queued/running/succeeded/partial/failed` —
there is no `rejected` state to move an extraction into. So "discard" cannot mean issuing a
DELETE, and it cannot mean an UPDATE to a rejected status, because that status doesn't
exist and adding it is a DDL change this plan has no mandate for (§0.4, §3 out-of-scope).
It can only mean: **take no action on `status`.** Add the `active_update` branch to
`reject_document` so it clears pending edits, records the audit entry, and — same as
2.2, same query, no `LIMIT 1` — sets `reactivated_at = now()` on every unresolved
`active_update` extraction row for the document to close 2.1's gate; `status` stays exactly
`succeeded`/`partial`, the row remains visible in history, and its packets stay permanently
`is_active = false`. Leave `cds_school_years` and the document's
`invalidated_at` untouched, same as before. Without this write, a rejected correction would
be indistinguishable from a never-reviewed one and the coverage cell would stay stuck on
`correction_pending` forever — the same bug as (a), on the reject path.

### 2.4 Surface the case, across every place the status is defined — backend and frontend

The review screen currently gates Approve/Reject/edit on `is_candidate` (verify the exact
prop at implementation time). Extend that check to the new `is_active` + `active_update`
case so the same screen serves both flows — no new screen needed for review itself.

**The Coverage grid is a separate, real gap, and it is four files, not three.** ✅ Verified:
`_cell_from_row` (`adapters/cds_admin_queries.py:237`) derives its status from
`_COVERAGE_SQL`'s `CASE` (`:100-106`), whose second branch is `WHEN
slots.active_document_id IS NOT NULL THEN 'approved'` — unconditional, with no inspection of
whether a completed `active_update` extraction is still awaiting review. ✅ The frontend
independently reaches the same gap: `documentStatus()`
(`frontend/src/features/cds-admin/review/document-status.ts:18-28`) returns
`"needs_review"` only when `document.is_candidate`, else `"approved"` once
`document.is_active`. The moment an `active_update` extraction finishes, both the coverage
cell and the review header chip say "Approved" over data nobody has looked at yet — a false
status label, which the design system's law that a badge must be true, never a guess,
forbids. An admin could only reach the pending correction by already knowing the
`document_id`.

**One SQL fragment, not two.** `_COVERAGE_SQL` is a set-based query across every
school-year row, so it can't call `find_pending_active_update` as a Python function — its
`EXISTS (...)` branch needs the same `WHERE` logic as inline SQL, which is exactly the
drift 2.1 already warns against. Extract the predicate's four clauses (`target_kind =
'active_update' AND status IN ('succeeded', 'partial') AND extractor_version <>
'human-review-v1' AND reactivated_at IS NULL` — everything except the `document_id = $1`
parameter and the `ORDER BY … LIMIT 1` that are specific to `find_pending_active_update`'s
single-row lookup) into one named SQL constant in `cds_store.py`, e.g.
`_PENDING_ACTIVE_UPDATE_PREDICATE_SQL`, and build both `find_pending_active_update`'s
`WHERE` clause and `_COVERAGE_SQL`'s `EXISTS (...)` branch by interpolating that constant.
This is static-fragment interpolation of a code-owned string, not user input, so it's
consistent with the parameterized-SQL house rule, which targets user-supplied values, not
code-owned SQL text.

A third file, `frontend/src/api/cds-admin/types.ts:7-9`, states outright that `CellStatus`
(`CoverageCell.status`'s wire type) is "the same set of five strings as `CdsStatus`" — so it
must gain the sixth value too, or `CoverageCell.status` and `CdsStatus` diverge and either
fail `npm run typecheck` or, if forced past that, crash `StatusChip`
(`cds-status.tsx:131-142`) at `cdsStatusMeta[status].variant` for an `undefined` entry. And
`CdsStatus` itself — the type `cds-status.tsx:30` defines and `cdsStatusMeta` (`:76`)
provides a chip treatment for — is the **fourth** file: it is the "single source of truth"
the module's own header comment claims, so the new value's chip variant/icon/label belong
there, not invented inline at a call site.

Add a sixth status value, `"correction_pending"`, threaded through all four: `cds-status.tsx`
(`CdsStatus` union + a `cdsStatusMeta` entry — a `warning`-family treatment consistent with
`needs_review`'s honesty framing, e.g. `ArrowRightLeft`/ `RotateCcw` icon and label
"Correction pending"), `frontend/src/api/cds-admin/types.ts`'s `CellStatus` union (keep its
comment's "same five" claim in sync — it becomes "same six"), `_COVERAGE_SQL`'s `CASE` (a
new branch before the `'approved'` branch: `WHEN slots.active_document_id IS NOT NULL AND
EXISTS (<the shared predicate fragment — see the note above>) THEN 'correction_pending'`),
and `documentStatus()` (check for a pending `active_update` before falling through to
`"approved"`).

**This is a genuine sixth status, not a `partial`-style modifier — record the exception.**
`plans/cds-pipeline/DESIGN.md` §2.2 says "do not invent a sixth status," but read in context
that rule is scoped to `partial`: a document that is **approved and incomplete** — the same
underlying state, a completeness modifier rendered as a sub-label beneath the `approved`
chip. `correction_pending` is a different axis entirely: **unreviewed new data exists that
has not been applied**, which is not true of `approved` at all — labelling that cell
"Approved" would itself violate the badge-must-be-true law the §2.2 rule exists to serve.
A modifier under `approved` cannot express "don't trust what you're looking at yet," which
is precisely what this state means. A sixth status is the correct fit here; the §2.2 rule
was written for a narrower case and doesn't anticipate this one. Phase 7 adds a docs item to
amend `plans/cds-pipeline/DESIGN.md` §2.2 with this exception and its rationale, rather than
silently contradicting a spec this plan cites elsewhere as authoritative.

**The review-screen chip has no way to detect resolution — a fifth file, and the harder
gap.** ✅ Verified: `ReviewExtraction` (`app/cds/models.py:200-207`) carries `id, status,
extractor_version, model_id, finished_at, error_code, counts` — no `target_kind`, no
`reactivated_at`. `get_review` (`service_review.py:238`) builds it from `raw.extractions[0]`,
the single latest `cds_extractions` row by `queued_at DESC` (`_DOCUMENT_EXTRACTIONS_SQL`,
`adapters/cds_admin_queries.py:158-164`, which selects `target_kind` but not
`reactivated_at`). 2.2/2.3's "approve or reject with no edited domains" path
(`_activate_untouched` only, no new extraction row) leaves that same `active_update` row as
the latest forever — only its `reactivated_at` changes, server-side, invisible on the wire.
So `documentStatus()` has nothing to check a pending `active_update` against: the header
chip would show "Correction pending" indefinitely, seconds after the admin approved it, on
the one screen the honesty law is strictest about. (The Coverage grid above doesn't have
this problem — its SQL runs server-side and can use `reactivated_at` directly.)

Two ways to close it, evaluated: (a) thread `target_kind` and `reactivated_at` through
`_DOCUMENT_EXTRACTIONS_SQL` → the internal row type → `ReviewExtraction`, and have
`documentStatus()` re-derive 2.1's predicate client-side; or (b) resolve 2.1's predicate
once, server-side, in `get_review`, and expose the result directly as a boolean —
`DocumentMeta.is_correction_pending` (new field). **Chosen: (b).** The predicate already has
one authoritative implementation, shared by the three write-path gates in 2.1; (a) would
re-derive the same logic a second time in TypeScript, which drifts the moment either side
changes without the other — the opposite of what 2.1 was careful to avoid on the backend.
(b) also removes a class of bug outright: the frontend can't misderive a boolean it never
computes. Factor 2.1's predicate into one query function (e.g.
`cds_store.find_pending_active_update`), built from the same
`_PENDING_ACTIVE_UPDATE_PREDICATE_SQL` constant `_COVERAGE_SQL`'s `EXISTS` branch
interpolates (see the note above) — so the write-path gates, `get_review`, and the coverage
grid all read one rule, not two copies that can drift; have `get_review` set
`DocumentMeta.is_correction_pending` from it; thread the field through the wire type
(`frontend/src/api/cds-admin/types.ts`'s `DocumentMeta`); `documentStatus()` checks it before
falling through to `"approved"`, rather than re-deriving anything.

**Gate:** rerun an already-active corpus document (`domains=None`) end to end: extraction
completes → the coverage cell shows `correction_pending`, not `approved`, and the review
header chip shows the same → review screen loads it → an edit round-trips → Approve
succeeds → both the coverage cell and the review header chip flip to `approved`, and stay
`approved` on a fresh page load (not just in the same session) →
`SELECT is_active FROM cds_library.cds_domain_packets WHERE extraction_id = ...` shows the
new packets active and the prior ones deactivated → `SELECT reactivated_at FROM
cds_library.cds_extractions WHERE id = ...` is non-null for the resolved `active_update` row
→ the document's `active_document_id` is unchanged throughout. Reject path, same setup:
Reject → document still active, still serving its prior packets, `invalidated_at` still
null, `reactivated_at` now set on the rejected extraction, coverage cell and review header
chip both back to `approved` on a fresh page load.

**Back-to-back reruns (risk 10):** rerun a document twice without reviewing the first — E1
succeeds, then E2 succeeds before E1 is reviewed — then approve E2 → `SELECT count(*) FROM
cds_library.cds_extractions WHERE document_id = ... AND target_kind = 'active_update' AND
reactivated_at IS NULL` → 0 (both E1 and E2 closed) → coverage cell and review header chip
show `approved` and stay `approved` on a fresh page load, not `correction_pending`.

### 2.5 One regression test for the predicate

Phase 2's predicate had two documented bugs before this revision — it never closed, and it
collided with the routine edit-and-approve path — both found by hand, not by a test. That's
exactly the case `AGENTS.md`'s no-reflexive-tests carve-out names: "logic gnarly enough that
a test is the fastest way to trust it." Add one test,
`tests/app/cds/test_service_review.py`, covering the predicate end to end (against a real
extraction row, not a mock): a genuine pending `active_update` rerun resolves it; a
synthesized `human-review-v1` row does not; setting `reactivated_at` closes it. One test, not
a suite — do not add a broader `service_review.py` test file around it.

Mark it `pytestmark = pytest.mark.live_db` (the existing convention — e.g.
`tests/domain/cds/test_packet_build_golden.py`, the one other `cds_library` test). It writes
throwaway rows against a real extraction, and running that under the routine suite would
write to the shared pipeline DB on every routine run — exactly the kind of dev-session
pollution §0.11 and Phase 1.0 exist to clean up. It is therefore excluded from `uv run pytest
-m "not live_llm and not live_search and not live_db"` and runs as a deliberate pre-merge
check, not a routine-suite gate — see Phase 3.3, whose expected `deselected` count accounts
for it.

---

## Phase 4 — Prove it end to end, live

*(Runs immediately after Phase 2, before Phase 3 — see §1 for why the numbering and the
run order diverge here.)*

**Goal:** the gate `PLAN.md` §H P5/P7 specifies and that has **never been executed**. This
is the actual proof the feature works. Everything before this is preparation.

**Precondition — two owner decisions required before 4.1 runs:**
- **§0.9 (`D8`/`F4`, vintage loss):** re-extracting under the new manifest is what actually
  makes the vintage-loss consequence real for students, not the metric cut sitting on disk.
  Get the owner's accept-and-disclose-or-mitigate call first.
- **§0.12 (`D18`, holdout gap):** the shipped accuracy/hallucination figures were measured on
  a five-document corpus (UGA, Cornell, Caltech, UCF, Dartmouth) with zero overlap with the
  four documents 4.1 is about to re-extract and activate (Harvard ×2, Yale, UPenn). Get the
  owner's accept-or-verify call first.

Discovering either live, after packets are already written and approved, is the wrong
order.

### 4.1 Parity re-extraction of the existing corpus

Re-extract the **4** existing active documents (`1, 2, 4, 5`) under `5.1.0`. Phase 1.0 has
already disposed of document 2013 as dev pollution (§0.11), so the corpus this phase proves
out is clean — no partial-document hedge needed. This is `PLAN.md` §G step 4, and it does
triple duty: it proves writes work, it proves Phase 2's `active_update` fix works for real
(all 4 documents hit that path, since all 4 are already active), and it clears the
honest-but-noisy `current_definition_match = false` caveat from §0.5.

**The gate, unconditional:**
```sql
SELECT count(*) FROM cds_library.active_cds_domain_packets WHERE NOT current_definition_match;
-- expect 0
```
must hold for all 4 documents — they were already at 13/13 before this run, so a
manifest-hash re-run failing on any of them is a real regression, not an acceptable gap.

**Before approving each re-extracted document, diff its new packet values against the
prior active packet, for every metric present in both, and review any change** (risk 6 in
the register below). ✅ Verified this has no home today: `domain/cds/validators.py` has no
history-aware check — `run_validators` (`:282`) only ever inspects the packet being built
against `doc_facts`, never against a prior packet. A retained metric changing value between
the 1,149-metric and 394-metric extraction is a signal worth a human look, not noise a
validator should silently pass. For 4 documents, a one-off script (or a manual `SELECT`
diff of old vs. new `cds_domain_packets` rows by `metric_id`) is proportionate — this is not
a validator-framework addition, and shouldn't become one.

Cost: the plan previously estimated ~$0.30/document; §0.5 already updated this to the
shipped configuration's measured **$0.2088/document** (`tuning/FINAL-REPORT.md` §12).
4 × $0.2088 ≈ **$0.84**. Budget it and move on.

### 4.2 Verify the student-facing read path, not just the write

A raw SQL count only proves the write succeeded; it says nothing about what a student
would actually see, and the 394-metric cut plus the §0.9 vintage-loss consequence is
exactly the regression class this exists to catch. After 4.1:

- Run the eval set (`uv run python -m evals.runner`) and confirm no new regressions
  against the last recorded baseline (`evals/report-2026-06-17.json`).
- Call `counselle_db.service.get_domain` (or `get_school_profile`) directly for one
  re-extracted school/domain and read the rendered caveats and vintage string — confirm
  `current_definition_match` no longer flags it, and confirm the §0.9 decision is actually
  reflected in what's rendered, not just decided on paper.

Proportionate, not a new test matrix — one eval run already in the toolbox, one direct
tool call.

### 4.3 The full admin round-trip, in a browser

Never executed. Run it against real PDFs from `artifacts/cds-corpus/` — include
`ohio-state_2023-2024.pdf` (187 pages) as one of the three, so 4.5's large-document check
rides this round-trip instead of needing a second one:

1. Coverage grid loads, shows the real slots with correct statuses.
2. Click an empty cell → upload prefills that school/year.
3. Drag 3 PDFs including **one duplicate** and **one unrecognisable** → row statuses are
   correct and distinguishable.
4. Correct a mis-detected school/year inline.
5. Process → jobs appear, poll, complete.
6. Open review → PDF page images render; evidence chips jump the viewer to the right page.
7. Edit a metric value → it round-trips.
8. Confirm Approve is **blocked** while flags are unresolved; exercise the override.
9. Approve → the document appears in `active_cds_documents`, and every packet parses
   through `parse_packet_row()`.
10. Return to Coverage → the cell reflects the new state without a manual refresh.

### 4.4 The `active_update` round-trip, in a browser

Phase 2's gate proved this mechanically; do it once more here, in the browser, as part of
the same live proof — rerun an already-active document, confirm the review screen accepts
it (2.4), approve, confirm the document never left `active` and the new packets are live.

### 4.5 Resilience checks

- **Worker death:** kill the process mid-run; on next boot the job sweeps to
  `failed/worker_lost` and the UI shows it as failed and re-runnable.
- **Drift guard:** the 1.3 gate, re-run against the live DB.
- **Auth:** every admin route 200 as superuser, **403 as a normal user** (P5's gate, also
  never executed — see 6.4 for making this permanent).
- **Large document:** `ohio-state_2023-2024.pdf` (run through 4.3) is `PLAN.md` §I1 risk
  6's named pathological case. Confirm it completes without a lease timeout, and check
  whether any domain fell back to whole-document sends — `engine.py`'s
  `_route_domains`/`_route_batches` fall back to sending the whole document for any domain
  or batch with zero routing hits. `cds_max_pages_per_call` (named in the same risk-6
  mitigation list) was never built (✅ zero hits in `config/settings.py` or `app/cds/`);
  page routing and the 900s lease-with-background-renewal were, and together they're the
  load-bearing mitigation today (see §3 for why the cap isn't being built preemptively).
  If Ohio State completes cleanly here, that's live evidence the cap isn't needed yet.

**Phase 4 gate:** all of 4.1–4.5 pass. Record the results in `CUTOVER.md`, replacing its
stale §0 state block with a dated 2026-08-26 block. **This phase is the ship gate.**

---

## Phase 3 — Repo hygiene and green gates

*(Runs after Phase 4 — see §1.)*

**Goal:** `uv run ruff check . && uv run mypy .` passes repo-wide, and the repo isn't
carrying 118 MB of experiment output.

### 3.1 Relocate the tuning artifacts

`plans/cds-pipeline/tuning/` is 118 MB / 224 tracked files / 53 untracked paths of
generated run output — JSON scores, scratch PNGs, probe scripts. `AGENTS.md` names this
case explicitly: generated artifacts go in `artifacts/` only, which is gitignored.

Split it by kind rather than moving the whole tree blindly:

- **Keep in `plans/cds-pipeline/tuning/`** (findings and reproduction tooling, not
  artifacts — the *only* record of why the catalog was cut): `m1-cut-report.md`,
  `experiments.md`, `FINAL-REPORT.md`, and the other prose reports, plus
  `harness/apply_cut.py`, `harness/verify_cut.py`, `harness/scorer.py`,
  `harness/keep_set.py`, and `harness/test_scorer.py` — **five** files, not three.
  ✅ `keep_set.py` is not optional: both `apply_cut.py` and `verify_cut.py` do
  `sys.path.insert(0, str(HERE)); from keep_set import ROOT, parse_keep` where `HERE` is
  their own directory, so moving `keep_set.py` out breaks both imports — and
  `keep_set.py`'s own `ROOT = Path(__file__).resolve().parents[4]` is computed relative to
  *its* location, so it must stay exactly four levels under the repo root
  (`plans/cds-pipeline/tuning/harness/`). ✅ `test_scorer.py` does
  `sys.path.insert(0, str(Path(__file__).resolve().parent)); import scorer` — it must stay
  beside `scorer.py`. (It's already excluded from the routine suite —
  `pyproject.toml`'s `testpaths = ["tests"]` never collects it — so keeping it here costs
  nothing against Phase 3.3's gate.)
- **Move to `artifacts/cds-tuning/`**: `runs/`, `gt/passes/`, `harness/scratch_*/`, and the
  rest of `harness/`'s probe/crop scratch scripts (`cost_anatomy.py`, `gt_adjudicate.py`,
  `gt_repair_keys.py`, `profile_corpus.py`, `run_extraction_offline.py`, `score_corpus.py`,
  `score_one.py`, `thoughts_by_call.py`, `residual.py`, `residual29.py`, `_reseal_*.py`),
  plus `scratch-review/` and `scratch-gt/`. These are reproducible outputs, not
  reproduction entry points.
- **Update the path references in the kept prose.** `experiments.md` cites
  `plans/cds-pipeline/tuning/harness/run_extraction_offline.py` and
  `plans/cds-pipeline/tuning/runs/<label>/` — both move under the split above, so both go
  stale the moment the move happens. Grep the kept prose files for every
  `plans/cds-pipeline/tuning/` path reference after the move and repoint the ones that
  moved to `artifacts/cds-tuning/...`; leave references to the five kept harness files
  alone.

Use `git mv` for tracked files so history follows. Do **not** rewrite history to purge the
118 MB from past commits — that rewrites 30 commits for a local-only repo and buys nothing.
The bloat stops growing; that is sufficient.

### 3.2 Belt-and-braces the lint scope

Even after 3.1, add `plans/` to the ruff and mypy exclude lists in `pyproject.toml`
(`exclude = ["^artifacts/", "^plans/"]` for mypy; the equivalent for ruff). Reason: `plans/`
is scratch by definition and will accumulate scratch scripts again. This is the one-source-
of-truth fix, not a workaround for 3.1.

### 3.3 Confirm

```
uv run ruff check .          → All checks passed!
uv run mypy .                → only the 3 pre-existing scripts/finish_render_staging.py errors
uv run pytest -m "not live_llm and not live_search and not live_db"
  → 8 failed, 1676 passed, 231 deselected — the 8 are pre-existing and unrelated to this
    branch (✅ verified identical on `main`), across the four mechanisms in §0.7; the
    deselected count is one higher than §0.7's pre-Phase-1 baseline (230) because Phase
    2.5's regression test is marked `live_db` (run order 1→2→4→3, so it exists by now)
```

Both the 3 `finish_render_staging.py` mypy errors and the 8 pytest failures are settled,
pre-existing findings, not open questions, and both are out of this feature's scope. Fix
either if trivial; do not let them gate this branch.

**Phase 3 gate:** the three commands above produce the stated output (pytest green modulo
the 8 documented pre-existing failures).

---

## Phase 5 — Rebase onto main and reconcile the design system

**Goal:** the branch merges, and the admin UI is judged against the real design spec.

### 5.1 Rebase

11 commits behind. Expect real conflicts in `frontend/src/styles/*`,
`frontend/src/features/schools/*`, and the shell/sidebar. The ~8,700 deleted frontend lines
in `git diff main` are this divergence, not the feature's doing — do not "fix" them, they
resolve when the rebase lands main's work.

Do this **after** Phase 3, so 118 MB of artifacts aren't dragged through the conflict
resolution.

### 5.2 Re-audit the admin UI against root `DESIGN.md`

Root `DESIGN.md` arrives with the rebase and has never applied to this code. The feature's
own `plans/cds-pipeline/DESIGN.md` was a good spec and the UI scored well against it —
zero hex/arbitrary-value violations, `Badge` correctly repointed to `--pill-*` tokens — but
the four-token-tier laws, the five-ramp palette, the surface/elevation scales, and the
shell/page scaffold from main are all unexamined here.

Check specifically: token-tier law compliance, status-badge vocabulary against the real
one, and whether the coverage/upload/review screens sit correctly in main's rebuilt shell.

**The re-audit needs a visual pass, not only a lint-level one.** ✅ Root `DESIGN.md:255`
(arriving with the rebase): "The app is **light-only**. There is no `.dark` class, no
`prefers-color-scheme` branch... Do not add `dark:` variants." ✅ The feature's own
`plans/cds-pipeline/DESIGN.md:279`: "The app is **dark-only on this branch**." All three
admin screens were designed and evaluated against a dark canvas — depth, glow, and hover
treatments tuned for it. ✅ Zero `dark:` classes exist in `frontend/src/features/cds-admin/`
(`rg -c "dark:" frontend/src/features/cds-admin/` → 0 everywhere), so the token-based
approach likely carries over mechanically, but that is exactly the kind of thing a lint
check can't confirm and Phase 5.4's re-run is functional (interaction steps), not visual.
Render all three screens (Coverage, Batch upload, Document review) in the light-only app as
an explicit step of this phase and confirm the depth/hover/status treatments still read
correctly — screenshot each, don't infer it from the absence of `dark:` classes alone.

### 5.3 Reconcile the two design docs

Two design specs for one app is a false-DRY hazard. Either fold the CDS-specific rules from
`plans/cds-pipeline/DESIGN.md` into root `DESIGN.md` as an admin-surfaces section, or
demote it to a screen-level spec that explicitly defers to root `DESIGN.md` for all token,
scale, and component rules. Do not leave two documents claiming independent authority.

### 5.4 Re-run the live round-trip against the rebased frontend

Phase 4.3's ship-gate proof runs against the pre-rebase frontend; this rebase then pulls in
main's full design-system rebuild, ~8,700 lines to reconcile. A conflict resolution that
drops a wired prop or route would pass a mere smoke pass while breaking what 4.3 proved,
and unit tests don't cover that flow. **Re-run the full Phase 4.3 admin round-trip (all 10
steps) and 4.4's `active_update` round-trip, against the rebased frontend, before calling
this phase done** — not a reduced smoke pass.

**Phase 5 gate:** rebase clean; `npm run typecheck && npm run lint && npm test && npm run
build` green; the design re-audit produces either zero violations or a tracked list, and
includes the light-only visual pass on all three admin screens; 5.4's full round-trip
re-run passes.

---

## Phase 6 — Correctness and structure

### 6.1 Upload delete doesn't cancel — the file resurrects `[data integrity]`

`frontend/src/features/cds-admin/upload/useBatchUpload.ts:192-196` — for an entry with no
server row yet (`uploading`/`detecting`), delete only does
`setLocalEntries(removeEntry(...))`: no server call, no request cancellation.
`staging-model.ts:48-72` `reconcileWithServer` rebuilds `knownRowIds` from current local
state, so when the in-flight POST resolves, the next poll re-adds the file via
`newFromServer` — and it is eligible for "Process all."

An admin who explicitly deletes a wrong PDF can have it committed anyway. Fix: tombstone by
**client id** (not server row id, which doesn't exist yet) so `reconcileWithServer`
suppresses it, and/or abort the in-flight request.

### 6.2 `PdfPageViewer` page inflation `[honesty]`

`frontend/src/features/cds-admin/review/PdfPageViewer.tsx:68-70,119-126` — `requestPage`
only floors (`Math.max(1, …)`); Next has no `disabled` guard though Previous does; the page
`Input` is unclamped. Because `total = Math.max(total, showPage)`, paging past the end makes
the toolbar's `/ N` and the image `alt` report a page count **higher than the document
actually has** — on the one screen whose entire premise is not misrepresenting the source.

Clamp against `pageCount` when known; disable Next at the last page.

### 6.3 Edit commit has no Undo and no inline failure reason

`review/MetricRow.tsx:52-82` — `handleSave` does `setValue → mutate → commit()/revert()`
with no Undo-action toast and no per-row error state; a rejected edit snaps back with a
generic toast and nothing on the row. Both are named requirements in the design spec's
honesty section. Add the Undo toast on success and an inline `text-xs text-destructive`
reason on failure.

### 6.4 Auth-gating test `[permanent]`

✅ Gating is correct today: `api/routes/cds_admin.py:48` sets
`dependencies=[Depends(current_superuser)]` at router level and no route opts out; writes
additionally carry `auth_origin_protect`. But there is **no test**, so a regression ships
silently. Add one: superuser → 200, normal user → 403, across the route table.

This is the rare test that earns its place under the no-reflexive-tests rule — it guards a
security boundary, and it makes P5's never-executed manual gate permanent.

### 6.5 Two queries missing `refetchOnWindowFocus: false`

`api/cds-admin/hooks.ts` — `useUploadBatch` and `useSearchSchools`. `useCoverage`,
`useJobs`, and `useDocumentReview` all set it. `useUploadBatch` backs the staging table an
admin tabs away from constantly to check a PDF; a focus-refetch reshuffles it mid-edit.
One line each.

### 6.6 409-on-Approve doesn't move focus

`frontend/src/pages/cds-review-page.tsx:128-145` — the conflict path correctly updates the
live region but never calls `.focus()`, and `ReviewPanel` has no ref threaded for the page
to target. Named in the design spec as the one non-obvious requirement of the 409 path.

### 6.7 Split `app/cds/engine.py`

978 lines against the hard 800 cap. 5 functions exceed the 50-line limit (start lines
✅ verified): `_process_calls` (`:699`), `_run_call_once` (`:446`),
`_build_and_store_domain_packet` (`:593`), `run_extraction` (`:917`), `_run_call` (`:537`).

Seams, matching `PLAN.md` §B4's own vocabulary — corrected to actually cover every line and
every reach-in. ✅ Verified the original three-way split left two things stranded:
`_build_and_store_domain_packet` (`:593-657`) between the calling range's end (`:591`) and
the usage range's start (`:658`), and — missed entirely — `EXTRACTOR_VERSION`,
`DomainOutcome`, and `_CallResult` (`:92-141`), all module-scope, all defined before the
first bucket even starts:

- `EXTRACTOR_VERSION` (`:92`) stays in `engine.py` as the orchestrator's own identity
  constant — it's imported externally as-is (`app/cds/service_review.py:39`:
  `from app.cds.engine import EXTRACTOR_VERSION as MODEL_EXTRACTOR_VERSION`), so leaving it
  in the orchestrator module keeps that import working unchanged.
- `DomainOutcome` and `_CallResult` (`:117-141`) move to `app/cds/calling.py` — both are
  produced by functions moving there (`_run_call_once`/`_run_call` build `_CallResult`,
  `_build_and_store_domain_packet` returns `DomainOutcome`). `engine.py` re-imports
  `DomainOutcome` for `_RunState`/`_overall_status`/`_finalize_run`, which stay in the
  orchestrator and consume it; `__all__` (`:978`, unchanged) still re-exports it from
  `engine.py`'s namespace.
- routing/prompting (`_metric_hints`…`_build_prompt`, `:143-401`) → `app/cds/routing.py`
- call execution, retry, **and result persistence** (`_Attempt`, `_deliberation_config`,
  `_run_call_once`, `_retry_clusters`, `_run_call`, `_build_and_store_domain_packet`,
  `:402-657`) → `app/cds/calling.py`. `_build_and_store_domain_packet` moves here rather
  than into a fourth module: every caller invokes it immediately after `_run_call`, both
  sibling modules below already reach into it alongside the call layer, and a module named
  for "usage" shouldn't gain a 65-line packet-persistence function just to give it
  somewhere to live.
- usage/cost (`_zero_usage`…`_estimate_cost_usd`, `:658-692`) → `app/cds/usage.py`
- remainder (`_RunState`, `_process_calls`, `_prepare_run`, `_finalize_run`,
  `run_extraction`) stays as the orchestrator.

This also resolves a real coupling smell in **two** siblings, not one:
- `app/cds/starved_retry.py` reaches into four engine privates behind `noqa: SLF001`
  (`_run_call_once`, `_add_usage`, `_usage_dict`, `_build_and_store_domain_packet`).
- ✅ `app/cds/batch_run.py` has the identical pattern and was never mentioned in the prior
  version of this plan — three reach-ins behind `noqa: SLF001`: `engine._run_call`
  (`:80`), `engine._add_usage` (`:168`), `engine._build_and_store_domain_packet` (`:196`).
  It also carries a `TYPE_CHECKING`-only import (`batch_run.py:27`:
  `from app.cds.engine import DomainOutcome, _CallResult, _RunState`) that must be split
  across the new module boundary too: `DomainOutcome, _CallResult` now come from
  `app.cds.calling`, `_RunState` still comes from `app.cds.engine`.

Both `starved_retry.py`'s reach-ins and `batch_run.py`'s (both the `SLF001` ones and the
`TYPE_CHECKING` import) become legitimate imports from `calling.py`/`usage.py` after the
split.

Mechanical, behaviour-preserving. Do it **after** Phase 4 so the end-to-end proof is
against the code that was actually verified, not a fresh refactor.

### 6.8 Restore hash-scoped incremental re-extraction

**Depends on 2.1's classification fix.** `PLAN.md` §B3 called this load-bearing — "the
mechanism that makes 'improve the metrics gradually' cheap forever — port it." It was
dropped: ✅ `service_review.py:597` only ever picks `active_update` or `full_reextract`. This
is also the exact line 2.1 fixes: before that fix, a domain-scoped rerun of an active
document misclassifies as `full_reextract` and its packets are permanently unreachable
(§2.1). Build 6.8 only after 2.1 ships — otherwise the first targeted rerun this feature
enables lands in the same dead end Phase 2 exists to close.

The expensive half already exists — the rerun endpoint accepts an explicit `domains` list
(`service_review.py:585-595`). What's missing is the cheap half: a helper that diffs
`domain_hashes` between the published manifest and the compiled one and returns the changed
domain ids, so a targeted rerun costs one domain instead of thirteen.

Small, high value, and it's the difference between "metric fixes are cheap forever" and
"every typo costs a full re-extraction."

### 6.9 Coverage can't distinguish queued from running

`CoverageGrid.tsx:94` calls `<StatusChip short status={cell.status} />` with no running
prop, and `api/cds-admin/types.ts:23-34` `CoverageCell` carries no field to derive it from.
Every processing cell shows the same icon regardless of actual state — a spinner for a job
that hasn't started. Needs a backend field (`started_at` or equivalent) threaded through;
**not fixable frontend-only.**

### 6.10 Lower-priority, batch them

Responsive breakpoint (240px school column below 1280px) unimplemented —
`CoverageGrid.tsx:212` hardcodes `width: 280`. Partial-domain count missing from the
coverage cell `aria-label` (`:87`). `MetricRow.tsx:44-50` reimplements flag-severity
precedence instead of importing `metricFlagSeverity` from `flag-queue.ts`. Keyboard
listener with no dependency array (`use-review-controller.ts:131-182`). The `detecting`
sub-phase is a size-scaled timer with no server signal behind it
(`staging-model.ts:116-123`) — simplest fix is to drop the sub-phase and stay on
"Uploading" until the response lands.

---

## Phase 7 — Docs, ADRs, graduation

Every item below is a verified factual inaccuracy in a committed document, not a style pass.

| File | What's wrong | Fix |
|---|---|---|
| `README.md:8` | Says the CDS pipeline is a separate repo and "Counselle shares credentials only." Counselle is now a **writer**. Flatly contradicts ADR 0036 | Rewrite the data-ownership paragraph |
| `docs/adr/0036-cds-pipeline-in-app.md:52-55` | Still cites `c821b2e6…` and claims the manifest was "ported byte-identically," so "5.0.2 stays current and every existing active packet is unaffected." All false post-cut | Amend with the cut, the `5.1.0` publish, and the `current_definition_match` consequence |
| `AGENTS.md` | Status block never mentions the 394-metric cut, the `5.1.0` publish, the hash divergence, or the `active_update` review fix | Update status; correct any "manifest 5.0.2 / 1,149 metrics" claim |
| `docs/DATABASE_GUIDE.md` | Touched by the M1 commit but not verified current against 394 metrics / `5.1.0` | Re-verify metric counts, manifest version, and the `current_definition_match` semantics |
| `plans/cds-pipeline/PLAN.md:3` | Header still reads **"Status: plan only, nothing implemented"** after 30 commits | Update; then graduate per below |
| `plans/cds-pipeline/CUTOVER.md` §0 | Records a PASS state from 2026-08-18 that predates the cut and 25+ commits | Replace with the dated Phase 4 results |
| `plans/cds-pipeline/CUTOVER.md` §6 | Says review-screen flag precision "has **not** been measured." ✅ It has: `plans/cds-pipeline/flag-precision.md` measured all 83 flags on one document (Alabama A&M, `document_id=2018`) and shipped a tuning fix | Cite `flag-precision.md`'s result in §6, explicitly noting it is single-document, not corpus-wide — don't claim more than what was measured |
| `plans/cds-pipeline/CUTOVER.md` §6 | Headline numbers are stale and pre-cut: "per-metric recall is 65.6%... ~$0.30/document... 6–20 minutes." ✅ 65.6% traces to `routing-tuning.md:534` (754/1149), measured against the **pre-cut 1,149-metric** catalog, before deliberation tuning existed | Replace with the shipped, owner-approved configuration (`tuning/FINAL-REPORT.md` §12, 2026-08-25): **99.01% accuracy, 96.96% coverage, 4 known hallucinations, $0.2088/doc, 419.3s latency** — **4 of the 5 §1 floors missed, only the coverage floor met.** ✅ `FINAL-REPORT.md` §12's own table shows accuracy/hallucinations/cost/latency all ✗ and coverage alone ✓ (four misses, not the "three §1 floors" its own prose claims — an arithmetic slip in the source, inherited and now corrected here), and §1's table independently gives this same configuration (column C / `exp32`) "floors met: 1 of 5." Note in passing, so a future reader isn't misled: §12 titles this "option A (max accuracy)," but its measured numbers match column **C** (`exp32`), not column A (96.86%/97.03%/27/$0.0921/315.5s) — a confusing label on unambiguous numbers, not an error in the numbers themselves |
| `plans/cds-pipeline/CUTOVER.md` §6 | ✅ States "hash-scoped incremental re-extraction is deferred… a manifest change means paying for everything" — Phase 6.8 implements exactly that, making the line false the moment it ships | Update to describe the diff-based targeted-rerun helper (6.8) once built, or remove the limitation if 6.8 ships in this same pass |
| `plans/cds-pipeline/CUTOVER.md` (new record) | The §0.9 vintage-loss decision (D8/F4) is recorded only in `tuning/experiments.md`, where a future reader of the shipped pipeline would never find it | Record the owner's actual decision (accept-and-disclose or mitigate) and, if disclosed, what the disclosure looks like to a student |
| `plans/cds-pipeline/CUTOVER.md` (new record) | The §0.12 holdout-gap decision (D18) has no record anywhere outside `tuning/experiments.md`/`FINAL-REPORT.md` §11, and the shipped accuracy figures elsewhere in this document (§0.5, the row above) need this caveat next to them, not buried in the tuning archive | Record the owner's accept-or-verify call, and if the figures are cited as accuracy going forward, note plainly that they were measured on a corpus with zero overlap with the schools actually shipped |
| `plans/cds-pipeline/CUTOVER.md` (new record) | The §0.11 database pollution (16 junk `cds_school_years` rows, one live in the student read path) has no record once Phase 1.0 disposes of it | Record what was found, what was disposed of and how, and the Yale-slot-3 decision (1.0.d) |
| `docs/adr/0012`, `0032` | Their "read-only consumer" framing is superseded by ADR 0036, but neither carries the amendment note `PLAN.md` §G step 7 requires | Add the cross-reference to each |
| `docs/DEPLOY.md`, `render.yaml`, `Containerfile` | ✅ Zero mentions of PyMuPDF, the third DSN, or the in-process worker | Add them. Deploy is deferred generally, so this documents rather than tests |
| `plans/cds-pipeline/DESIGN.md` §2.2 | "Do not invent a sixth status" is scoped to `partial` (a completeness modifier on `approved`) but is written broadly enough to read as a blanket rule; Phase 2.4 adds `correction_pending`, a genuinely different axis (unreviewed new data, not completeness), on the grounds that the modifier pattern can't express "don't trust this yet" | Add the exception and its rationale (2.4) directly under §2.2, so the rule and its one deliberate exception live together instead of the plan silently diverging from a spec it cites as authoritative elsewhere |

### 7.1 Graduate the plan

Per `AGENTS.md`, `plans/` is scratch and `specs/` is the permanent home. Once Phases 1–6
are done, move `plans/cds-pipeline/` → `specs/cds-pipeline/` (PRD/architecture/plan
structure), leaving the tuning prose reports with it as the historical record of the cut.

Do this **last**. Graduating a plan whose gates haven't been met is exactly the failure
mode that produced the stale `CUTOVER.md`.

---

## 2. Risk register for this plan

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **The version edit changes the hash and a pin is missed.** `version` is part of compiled content; editing `5.0.2`→`5.1.0` changes `content_sha256` | High | 1.4 updates all three pins in one pass from a single post-edit compile; the new assertion ties version and pin together so a mismatch fails loudly |
| 2 | **`rerun_extraction` misclassifies a domain-scoped rerun of an active document as `full_reextract`** (§2.1: `and` binds `domains is None` before `is_active`), stranding its packets `is_active=false` with no gate that ever admits them — the exact case Phase 6.8 depends on | High | 2.1 keys `target_kind` on `is_active` alone; verified no other consumer of `target_kind` depends on the old behaviour; 6.8 is built only after 2.1 ships |
| 3 | **Broadening the `is_candidate` gates (Phase 2) admits the wrong extraction, or never stops admitting the right one.** A naive predicate (any `active_update` extraction with `status IN ('succeeded','partial')`) both matches the synthesized `human-review-v1` row every ordinary edit-and-approve already creates, and never closes after approval, since nothing mutates `cds_extractions` on activation | Medium | 2.1's predicate excludes `extractor_version = 'human-review-v1'` and requires `reactivated_at IS NULL`; 2.2/2.3 set `reactivated_at` on every unresolved `active_update` row for the document at approve and reject (not just the one reviewed — see risk 10), closing the gate explicitly rather than relying on packet-activation state, which can't distinguish "resolved" from "pending" when every domain in the extraction was edited. 2.5's regression test covers the predicate directly; Phase 2's gate exercises one full rerun, one full reject, and one back-to-back-rerun sequence, end to end, before this ships |
| 4 | **Publishing while an extraction is in flight.** The new manifest becomes current mid-run; the job's packets fail identity checks at commit | Medium | 1.2 refuses to publish if any extraction is `queued`/`running`, checked inside the same transaction as the advisory lock |
| 5 | **`5.1.0` published, then `config/cds/` edited again.** Straight back to divergence | Medium | 1.3 makes the guard live, so the next drift costs zero dollars instead of a full run — this is the durable fix, not the publish itself |
| 6 | **Parity re-extraction produces materially different values** than the 1,149-metric run | Medium | Expected and fine for *removed* metrics. For **retained** ones, diff old vs new packet values and review any change before approving — a retained metric changing value is a signal, not noise. Implemented as an explicit step in 4.1, not left as an unimplemented promise |
| 7 | **Rebase conflicts silently drop CDS admin code** during a large styles/schools merge | Medium | Rebase after Phase 3; re-run the *full* live round-trip (5.4: Phase 4.3 + 4.4 in full, not a smoke pass) — a rebase reconciling ~8,700 lines is exactly where a mere smoke pass misses a dropped prop or route |
| 8 | **Refactoring `engine.py` regresses verified behaviour** | Low | Sequenced after Phase 4 deliberately; behaviour-preserving moves only; routine suite green before and after |
| 9 | **Disposing of Amherst's active document (1.0) clears the wrong pointer, or clears it without also retiring the row**, leaving a fabricated year visible in admin surfaces even after the packets are gone | Low | 1.0's gate re-runs the exact §0.11 read-path query and the `retired_at`/`academic_year > 2030` query after the write, not just a status assertion on the write itself |
| 10 | **Back-to-back `active_update` reruns can strand a phantom pending row that re-surfaces as a false status.** The one-live-per-slot index only blocks *simultaneous* queued/running extractions. If rerun E1 succeeds unreviewed, then rerun E2 is queued and also succeeds before E1 is reviewed, 2.1's predicate (`ORDER BY created_at DESC LIMIT 1`) surfaces E2 — the more recent one — for review. Closing only the reviewed row would leave E1's `reactivated_at` NULL forever; the next predicate evaluation then returns E1, and the coverage cell **and** the review header chip flip back to `correction_pending` over data that was correctly approved and is being served correctly — a false badge on the exact surface 2.4 exists to make honest, not a harmless audit-trail gap | High | 2.2/2.3 resolve **every** unresolved `active_update` extraction for the document at approve/reject, not just the one reviewed (no `LIMIT 1` on the closing `UPDATE`) — idempotent regardless of how many reruns stack up unreviewed, and it closes the hole even if a rerun reaches this state by a path other than `rerun_extraction` |
| 11 | **The `current_definition_match` caveat is live on all 54 active packets** from the moment `5.1.0` publishes (Phase 1.1) until Phase 4.1 clears it (§0.5) | Medium | Phase 4 now runs immediately after Phase 2, before Phase 3's hygiene pass (see §1) — minimizing, not eliminating, the window. The caveat itself is honest, not a bug to suppress |

---

## 3. Explicitly out of scope

Holding `PLAN.md` §I2's cut list — ✅ verified none of it was built, and none of it is
revisited here. Additionally out of scope for this plan:

- **Reverting the metric cut.** Owner decision: the cut stands.
- **Rewriting git history** to purge the 118 MB (§3.1).
- **`cds_library` DDL of any kind.** `PLAN.md` §C1 is zero-DDL and the immutability trigger
  is part of the security model, not an obstacle to route around.
- **CI.** Explicitly declined per `TODOS.md`; not re-proposed.
- **A manifest-publish UI.** The script (1.2) is the whole deliverable, exactly as §I2 said.
- **Building `cds_max_pages_per_call` preemptively.** ✅ Verified it was never built, and
  page routing's whole-document fallback (`_route_domains`/`_route_batches`) means it isn't
  fully superseded by page routing either — so 4.5 tests the actual pathological document
  (Ohio State, 187 pages) live instead of guessing. Build the cap only if that test shows
  it's actually needed.
- **The 3 pre-existing `scripts/finish_render_staging.py` mypy errors** and **the 8
  pre-existing routine-suite failures** (§0.7) — both unrelated to this feature.
- **Actually deploying.** Deploy is deferred app-wide; Phase 7 documents the config, it
  does not test it.

---

## 4. Definition of done

The feature is shippable when all of the following are true:

1. The 16 polluted `cds_school_years` rows are disposed of per §0.11/1.0: Amherst
   College/2091 no longer appears in `active_cds_documents` or
   `active_cds_domain_packets`, no row has `academic_year > 2030` and no `retired_at`, and
   Yale's stuck candidate has a recorded decision.
2. `cds_library.cds_manifests` has `5.1.0` current with the 394-metric content, and `5.0.2`
   demoted.
3. `scripts/publish_cds_manifest.py` exists, with a dry-run diff and the in-flight-run
   refusal (1.2).
4. `verify_manifest_current()` runs pre-flight and fails a drifted config before any spend.
5. All three hash pins match a single compile, and the pin's docstring states the real rule.
6. `rerun_extraction` classifies every rerun of an active document as `active_update`
   regardless of `domains` (2.1). `active_update` extractions can be reviewed, approved, and
   rejected against the still-active document, with no document-level candidate/active swap
   (Phase 2); the Coverage grid **and** the review-screen header chip both show a distinct
   `correction_pending` status rather than a false `approved` on a fresh page load (2.4);
   2.5's regression test passes; and 4.4's browser round-trip has been run.
7. `SELECT count(*) FROM active_cds_domain_packets WHERE NOT current_definition_match` → 0
   for all 4 corpus documents (1, 2, 4, 5), with each retained metric's value diffed
   against its prior packet and reviewed before approval (4.1).
8. The owner has made and recorded both the §0.9 vintage-loss decision and the §0.12
   holdout-gap decision before 4.1 ran.
9. The full admin round-trip (4.3) has been executed in a browser and recorded.
10. The student-facing read path was verified post-republish: evals run clean, and a direct
    `get_domain` call was checked (4.2).
11. Worker-death recovery, drift-guard, 403-as-normal-user, and the large-document check
    have been exercised live (4.5).
12. `ruff` clean repo-wide; `mypy` clean but for the 3 pre-existing errors; backend and
    frontend suites green (routine pytest green modulo the 8 documented pre-existing
    failures, §0.7).
13. The branch is rebased on `main`, the admin UI is reconciled with root `DESIGN.md`
    including a light-only visual pass on all three screens (5.2), and the full round-trip
    was re-run against the rebased frontend (5.4).
14. The upload-delete resurrection bug and the `PdfPageViewer` page inflation are fixed.
15. An auth-gating test exists.
16. `engine.py` is under 800 lines with no function over 50 (including `EXTRACTOR_VERSION`,
    `DomainOutcome`, and `_CallResult`, all explicitly assigned to a module — 6.7), and
    `starved_retry.py`'s and `batch_run.py`'s reach-ins, including `batch_run.py`'s
    `TYPE_CHECKING` import, are legitimate module imports.
17. Every document in the Phase 7 table is factually accurate, including the
    flag-precision, vintage-loss, holdout-gap, hash-scoped-incremental, and tuning-results
    rows, and `plans/cds-pipeline/DESIGN.md` §2.2 carries the `correction_pending` exception.
18. The plan has graduated to `specs/cds-pipeline/`.

**Ship gate (the pipeline is functional): 1–11.**
**Merge gate (the branch is mergeable): 12–18.**
