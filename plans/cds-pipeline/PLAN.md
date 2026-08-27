# CDS Pipeline — master implementation plan

**Branch:** `feat/cds-pipeline` · **Status:** built and ship-gated — see `SHIP-PLAN.md` for the
execution record and `CUTOVER.md` for the ship-gate log
**Goal:** retire the separate `counselle-data-pipeline` repo and rebuild the CDS
extraction pipeline as an **admin surface inside the Counselle app** — reliable, cheap,
extremely accurate, minimal UI, and **zero breakage** of the student-facing read path.

This plan assumes the six recon reports in this directory (`recon-backend`,
`recon-frontend`, `recon-old-pipeline`, `recon-cds-corpus`, `recon-vertex`,
`recon-db-live`). Everything below that is load-bearing was **re-verified against the
live database and the current source tree** while writing this plan; those checks are
marked ✅ and their evidence is inline.

A parallel spike is empirically testing the extraction engine right now. §B4 defines the
engine's architecture and seams; every number the spike will settle is tagged
**`[SPIKE]`** and must not be guessed before it lands.

---

## A. Current state, and what breaks

### A1. Everything in the Counselle repo that touches CDS data today

| Layer | Files | Role |
|---|---|---|
| DB access | `counselle_db/db.py`, `catalog.py`, `service.py`, `packets.py`, `formatting.py`, `models.py`, `server.py` | The whole read path: pool, catalog snapshot, four tools, packet-v8 anti-corruption parser, MCP shell |
| App | `app/deps.py` (`ro_pool`, `Catalog`), `app/toolset.py`, `app/graph.py`, `app/prompt.py`, `app/viz.py`, `app/sessions.py`, `app/tool_middleware.py`, `app/workspace/service_reference.py`, `service_applications.py`, `service_essays.py`, `service_essay_prompt_drafts.py`, `service_utils.py`, `app/workspace/agent_tools*.py` | Consumers of `counselle_db.service` (ADR 0017 accepted deviation 1) |
| Config | `config/settings.py` — `db_ro_dsn`, `cds_data_enabled`, `db_statement_timeout_ms`, `db_row_cap`, `query_database_max_bytes`, `data_catalog_refresh_seconds`, **`supported_packet_extractor_versions`** (×2: `Settings` and `DbChildSettings`) | The read path's tunables |
| Ops/docs | `scripts/setup_db.sql`, `scripts/mcp_smoke.py`, `evals/runner.py`, `skills/db-recipes/SKILL.md`, `docs/DATABASE_GUIDE.md`, `docs/ARCHITECTURE.md`, ADRs 0012/0032 | Bootstrap, evals, honesty spec |
| Tests | `tests/counselle_db/*` (9 files), `tests/app/test_viz*.py`, `test_caveats.py`, `test_steps.py`, `test_workspace_services_live.py`, … | Read-path regression net |

**Not present anywhere:** any write to `cds_library.*`, any PDF-bytes-to-model call, any
job queue, any admin route, any PDF renderer, any drag-drop. All net-new.

### A2. Live database state ✅ (verified 2026-08-18, `127.0.0.1:5433/counselle_data`)

```
schools               2,746     (full IPEDS catalog — inherited, do not touch)
cds_school_years          5     Harvard 2024/2025, Yale 2024/2025, Penn 2024
cds_documents             5     4 active + 1 candidate (Yale 2025, school_year_id=3)
cds_domain_packets      217     51 active, all extractor_version = gemini-routed-extraction-v8
cds_extractions          26
cds_manifests            14     current = 5.0.2, contract 8
ct_index_entries      5,946     (College Transitions scrape — frozen, see cut list)
```

**Current manifest fingerprint** ✅ — this is the single most important constant in the
whole port:

```
version                 5.0.2
extraction_contract     8
content_sha256          c821b2e61cf71f99c1f8503f8940bbce48354b978e091bb81223718784ad6f0a
content top-level keys  {root, prompt, domains, extraction_contract_version}
```

**Read this correctly: CDS coverage is a cold start.** 3 schools, 5 slots, 4 active
documents. There is essentially no production CDS data to protect — the expensive,
irreplaceable asset is the **1,149 metric definitions** and the **schema contract**, not
the extracted rows. That makes the cutover cheap and the risk profile favourable.

### A3. The read path survives — proof

The five reader views are plain SQL over the base tables ✅ (`pg_dump` of `cds_library`
read in full while planning). They select from `cds_school_years`, `cds_documents`,
`cds_domain_packets`, `cds_extractions`, `cds_manifests`, `schools`. **A different
writer producing the same base-table rows is invisible to them.** Therefore:

| Thing | Changes? | Evidence |
|---|---|---|
| The 5 view definitions | **No** | We write base tables only; no view DDL in this plan |
| `cds_library_reader` grants | **No** | `scripts/setup_db.sql` untouched |
| `COUNSELLE_DB_RO_DSN` / `counselle_ro` | **No** | We add a *third* DSN, never widen the second |
| `counselle_db/*.py` (all 7 files) | **No code changes** | The write path is a separate package |
| `app/`, `api/`, `evals/`, `skills/` read consumers | **No** | They call `counselle_db.service`, unchanged |
| Packet JSON shape (v8) | **No** | We emit the identical v8 contract |
| Manifest version / domain hashes | **No** (5.0.2 stays current) | §B2 |

**The one honest exception — and it is a config value, not code.**
`counselle_db/packets.py:278` gates every packet on
`packet.extractor_version in supported_extractors`, sourced from
`Settings.supported_packet_extractor_versions` (`config/settings.py:214`) and mirrored
in `DbChildSettings` (`:69`) for the MCP child. Today that frozenset is
`{gemini-native-pdf-v2, gemini-native-pdf-v5, gemini-routed-extraction-v7,
gemini-routed-extraction-v8}`.

The new engine must write **new** extractor identities — `counselle-cds-v1` for model
extractions and `human-review-v1` for admin corrections — because reusing
`gemini-routed-extraction-v8` for a different engine would make the provenance label a
lie (AGENTS.md principle 3). So **both allow-lists gain two strings.** That is the
designed extension point (it is an env-overridable Settings field with a validator, not
a hardcoded literal), and it is the *entire* read-path delta. Anything beyond it is a
plan violation and must be escalated.

**Three non-obvious read-path constraints the writer MUST satisfy** ✅ (read from
`counselle_db/packets.py`, these will silently blackhole a whole domain if violated):

1. `Packet` is `ConfigDict(extra="forbid")`. The parser pops exactly one extra key,
   `provider_contract`, which must be a `dict` if present. **Any other top-level key →
   the packet is rejected wholesale.** Human-review provenance therefore lives at
   `packet.provider_contract.human_review`, never at the top level.
2. `packet.counts` must **exactly equal** the tallied `extraction_status` histogram
   (`packets.py:305-309`). Recompute counts on every write, including corrections.
3. An *active* packet's `status` may only be `validated` or `partial` (DB CHECK
   `cds_domain_packets_check1` + the parser's `Literal`). `parse_failed` packets may be
   stored but never activated.

**Mitigation, cheap and decisive:** the writer calls
`counselle_db.packets.parse_packet_row()` on every packet it has just built, *inside the
transaction, before COMMIT*. If the reader would reject it, the write aborts. One
import, ~10 lines, and it makes "the read path survives" a runtime invariant instead of
a promise. This is the honesty carve-out; do not simplify it away.

### A4. Freshness after approval

`Catalog` refreshes on a TTL (`data_catalog_refresh_seconds = 3600`). Without help, an
approved document is invisible to the agent for up to an hour. The approve handler calls
`runtime.deps.catalog.maybe_refresh(force=True)` — one line, existing API.

---

## B. Target architecture

### B1. Layering (ADR 0017) — module map

Dependencies point inward only: `domain/` → `app/` → `adapters/` → `api/`.

```
config/cds/                              PORTED, versioned data assets (ADR 0018)
  manifest.yaml                          root: version 5.0.2, 7 extraction_groups
  extraction-prompt.md                   the one shared global prompt
  extractor-version.yaml                 pinned contract identity
  domains/*.yaml                         13 files, 1,149 metrics, ~1.1 MB — DO NOT EDIT in this project

domain/cds/                              PURE. no I/O, no SDK, no framework.
  manifest_types.py     Pydantic models for the manifest YAML (replaces 690 lines of bespoke validation)
  manifest_compile.py   YAML → CompiledManifest; canonical-JSON hashing; domain_hashes; provider schema
  claims.py             Finding / WindowExtraction / DocumentRouting response models
  packet_build.py       findings → packet v8: typed coercion, page fencing, outcome resolution, counts
  pages.py              page-range pad/merge/cluster math + narrowed→original page_map translation
  validators.py         pure (packet, doc_facts) → ReviewFlag[]  — the accuracy gate

adapters/
  cds_gemini.py         raw google-genai client; one call in, typed JSON out. temperature 0, response_schema
  cds_pdf.py            PyMuPDF: page_count, narrow_document, render_page_png, page_text, corruption probe
  cds_store.py          asyncpg WRITES to cds_library.* through the pipeline pool (school_years, documents,
                        extractions, packets, activation) — the only writer in the repo
  cds_admin_queries.py  asyncpg READS of cds_library base tables for the coverage grid + review model

app/cds/
  models.py             Pydantic API models for the three screens (request/response shapes)
  manifest.py           loads + caches the CompiledManifest at boot; exposes it to engine + review
  engine.py             orchestration: plan calls → route → extract per group → build packets → validate
  jobs.py               the DB-leased job runner + the in-process poller task
  detect.py             per-file school+year detection (PDF text + one cheap model call + fuzzy match)
  service_ingest.py     upload → hash → dedupe → detect → staging rows; "process all" → queued extractions
  service_review.py     review read model; pending edits; approve/reject; human-review packet synthesis
  audit.py              one function: record every admin action

api/routes/cds_admin.py  the router. thin. multipart/JSON translation + error envelope only.

migrations/0015_cds_admin.sql(+.rollback)   counselle.* only — staging + pending edits + audit

scripts/promote_admin.py                     flip counselle.users.is_superuser by email
scripts/cds_manifest_check.py                recompile the ported YAMLs, assert the sha256
```

Two notes on placement, both deliberate:

- **The manifest compiler and packet builder go in `domain/`, not `adapters/`.** They are
  the honesty core of the write side, exactly as `counselle_db/packets.py` is the honesty
  core of the read side. Pure, zero-mock testable, no framework. This is the one part of
  the new system that gets tested hard (AGENTS.md principle 3).
- **The model call goes in `adapters/`, not behind PydanticAI.** ADR 0011's PydanticAI
  `model=` seam is scoped to *agentic* per-agent swapping. CDS extraction is a one-shot,
  no-tool, schema-constrained provider call. Wrapping it in `Agent` is the pass-through
  wrapper ADR 0017 §4 says to delete. ADR 0011 compliance is satisfied the way it
  actually matters: **the model id comes from Settings, never a literal**
  (`model_cds_extract: str = "google-vertex:gemini-3.1-flash-lite"`, same
  provider-prefixed convention as the other five model settings, stripped by the same
  `model_name_from_setting` split). `google-genai>=2.8.0` is **already a dependency** ✅
  (`pyproject.toml`), and the auth path is the shared `COUNSELLE_VERTEX_API_KEY` Express
  Mode key already used by three call sites. No new secret, no new provider.

### B2. The manifest: keep 5.0.2, port byte-identically

The metric definitions are ported verbatim into `config/cds/`. Nothing is re-authored.
The compiler is *reimplemented* (Pydantic models over the YAML instead of the old repo's
hand-rolled closed-vocabulary validator + two DFS cycle checkers), but it must produce
**bit-identical output**.

The compile contract, reproduced exactly (from the old `library/manifest.py`):

- canonical JSON = `json.dumps(v, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`
- `domain_hashes[d] = sha256(canonical({"id", "metrics": <metrics minus "title">, "prompt": <shared prompt>, "contract": "8"}))`
- `content_sha256 = sha256(canonical({"root", "domains", "prompt", "extraction_contract_version": "8"}))`
- local metric ids are qualified to `<domain_id>.<metric_id>` at compile time; `context_bindings` and `formula.inputs` resolve against the qualified index
- `extraction_groups` must exactly partition all 13 domain ids

**Acceptance gate (P1, non-negotiable):** `scripts/cds_manifest_check.py` recompiles the
ported YAMLs and asserts
`content_sha256 == c821b2e61cf71f99c1f8503f8940bbce48354b978e091bb81223718784ad6f0a`.
If it matches, the port is provably correct and **no manifest republish is needed** —
5.0.2 stays current, all 51 active packets stay `current_definition_match = true`, and
the engine swap is invisible to every downstream consumer. Commit the hash as a
regression test.

**Why the engine can change freely anyway:** `extractor_version` and `model_id` are
*not* inputs to any hash. Call granularity, routing, voting, and validators can all
change without touching the manifest.

### B3. The Harvard/Yale instruction problem

Recon is right: hundreds of metrics say things like *"Harvard 2025-26 and Yale 2024-25
both label this E1 row exactly …"*. Re-authoring 1,149 metrics is off the table (huge,
and the taxonomy is genuinely good). Three-part answer, in value×ease order:

1. **Tolerate now, for free.** Those sentences are *examples appended to a correct
   general rule*; the rule itself ("extract the E1 row labelled 'Accelerated program',
   emit true only when visibly checked") generalises. Ship them unchanged in P1.
2. **One prompt sentence, later, if the spike proves it matters.** If the corpus run
   shows the named-school framing causing misses on non-Harvard/Yale documents, add one
   paragraph to the shared `extraction-prompt.md`: *"Institution names in a metric's
   instructions are illustrative of which CDS item is meant, not a required literal
   match. Apply the rule to whatever wording this document uses."* This changes every
   domain hash → publish `5.1.0` (contract stays **8**, packet shape unchanged) and
   re-extract the 4 live documents. That is a ~15-line diff plus a script run, not 1,149
   rewrites. Do it in P7 only if the spike justifies it.
3. **Incremental improvement seam, permanent.** `domain_hashes` are per-domain, and the
   old `derive_requested_domains` logic re-extracts only domains whose hash changed.
   Keep that. Fixing one domain's instructions later costs one domain's re-extraction
   across the corpus, not a full re-run. This is the mechanism that makes "improve the
   metrics gradually" cheap forever — port it.

### B4. The engine — architecture and seams

**Fixed (not spike-dependent):**

- `adapters/cds_gemini.py` exposes one function:
  `async def generate(pdf_bytes, prompt, schema, *, max_output_tokens) -> tuple[Model, Usage]`.
  `genai.Client(vertexai=True, api_key=settings.vertex_api_key)`,
  `Part.from_bytes(mime_type="application/pdf")` inline (CDS PDFs are ≤5 MB, far under
  the ~50 MB / ~1000-page inline ceiling), `GenerateContentConfig(temperature=0,
  response_mime_type="application/json", response_schema=<PydanticModel>,
  http_options=HttpOptions(api_version="v1", timeout=…, retry_options=HttpRetryOptions(attempts=3)))`.
  `finish_reason != "STOP"` raises — never accept a truncated JSON candidate.
  Transport retries only; no hand-rolled retry loop. Called via `asyncio.to_thread`.
- The model **is a claim generator; the packet builder is the gate.** Every finding
  carries a mandatory non-blank `excerpt` and a 1-indexed physical page. Page numbers
  from a narrowed sub-PDF are translated back through `page_map` before they touch a
  packet. Typed coercion is lossless-only (`170.0 → 170`; anything else → `invalid` with
  `diagnostic_code: type_mismatch`). `not_reported` findings are dropped server-side —
  a blank cell is an omission, not a claim. All of this is ported logic; it was the best
  part of the old pipeline.

**Seams — each one is an interface the spike selects an implementation/parameter for:**

| Seam | Interface | What `[SPIKE]` settles |
|---|---|---|
| `CallPlan` | `plan(manifest, requested_domains) -> list[Call{group, domains, page_cluster}]` | Call granularity: the inherited 7 domain-groups, vs fewer/larger, vs per-domain |
| `PageSelector` | `select(pdf, manifest, domains) -> dict[domain, PageRange] \| None` | Whole-doc vs page-narrowed; routing-call cost/benefit; pad size (old default ±2); the whole-document fallback stays mandatory — narrowing is strictly an optimisation, never a correctness bet |
| `Sampler` | `samples: int` per call, merged through the existing `conflict` resolution | Whether N-of-M self-consistency voting pays for itself, and on which domains. The `conflict` machinery already exists in the packet builder and has **never been exercised** — this is the cheapest available accuracy lever |
| `ChecklistStrategy` | `resolve(pdf, section, labels) -> dict[label, choice] \| None` | The C7 three-tier fallback (text-adjacent → bare-`X` bbox-vs-column reconstruction → rasterised region + vision). Native PDF vision may already cover tier 3; measure before building |
| `validators` | ordered `list[(packet, DocFacts) -> ReviewFlag[]]` | The final list and thresholds |

**Validator starting set** (each maps to a documented real-world failure from the corpus
recon; each produces a review flag on a specific field, never a silent drop):

| Validator | Catches |
|---|---|
| `excerpt_on_cited_page` | Confidently-wrong page citations. Local PyMuPDF text of the cited page, normalised (NBSP→space, whitespace collapse), fuzzy-contains the excerpt. **Closes the biggest hole in the old pipeline** (critique #4) |
| `page_in_document` | Hallucinated page numbers (already in the old builder) |
| `type_coercion` | Stringly-typed drift (already in the old builder) |
| `corrupt_text_layer` | Caltech: 1,772 control chars from broken ToUnicode CMaps producing *plausible but wrong* digits. Flag the document at ingest; force vision-only reading and flag every digit-bearing value on affected pages |
| `year_consistency` | Cornell: 78% of pages carry a stale "Common Data Set 2021-2022" header. Cross-check `identity.academic_year` against filename/URL and the A0/A1 section; never a document-wide majority vote |
| `template_absence_has_evidence` | `not_in_template_version` asserted without a structural excerpt |
| `denominator_sanity` | e.g. admits > applicants, percent > 100, enrolled > admitted — pure arithmetic over verified siblings |

Flags are **advisory to the human**, not silent mutations. A flagged field keeps its
extracted value and shows the reason; Approve is blocked while any flag is unresolved
unless the admin explicitly overrides (recorded in the audit log).

**Cost, for context, not for tuning:** recon's arithmetic puts a 30-page document at
~$0.03 worst case (8 calls, no narrowing) on `gemini-3.1-flash-lite`; 1,000 schools ≈
$30. Cost is not a design constraint here. Accuracy is.

### B5. Human corrections are provenance, not mutation

`cds_domain_packets` has a BEFORE UPDATE immutability trigger ✅ (verified firing live,
even on rows created in the same transaction). Correcting a value therefore *cannot* be
an UPDATE, and shouldn't be.

Flow:

1. Admin edits fields in the review screen. Each edit lands in
   `counselle.cds_admin_pending_edits` (ours, mutable, deletable). Nothing in
   `cds_library` moves.
2. On **Approve**, if there are pending edits, synthesize per touched domain:
   - one new `cds_extractions` row: fresh uuid, same `school_year_id`/`document_id`,
     `manifest_version = 5.0.2`, `target_kind = 'active_update'` ✅ (existing CHECK
     value — no DDL), `status='succeeded'`, `started_at`/`finished_at` = now,
     `extractor_version='human-review-v1'`, `model_id='human'`.
   - one new `cds_domain_packets` row per touched domain: the **base is the currently
     active packet's metric map**, with edited refs replaced, `counts` recomputed,
     `status` recomputed, and `provider_contract` replaced by
     `{"human_review": {reviewer_user_id, reviewed_at, base_extraction_id, changed_refs, note}}`.
   - activate: deactivate the prior active packet, insert-then-flip the new one. The
     partial unique index `cds_domain_packets_one_active_idx (document_id, domain_id)
     WHERE is_active` ✅ enforces exactly one active packet per pair.
3. **Evidence stays truthful.** An edited metric must carry a real
   `{page_number, excerpt}` that the admin confirms from the page image on the left
   pane — the review UI pre-fills them from the original finding and requires a
   non-blank excerpt (the reader enforces `min_length=1` anyway). We never synthesize an
   excerpt like "corrected by admin"; the excerpt is what the document actually says.
   `provider_contract.human_review` carries the human part.
4. Validate through `parse_packet_row()` before COMMIT (§A3).

The whole audit trail — who, when, which refs, override or not — lands in
`counselle.cds_admin_audit`.

### B6. Document lifecycle (decision 10)

```
        upload                extract               approve
staged ────────► candidate ──────────► candidate ──────────► ACTIVE
(counselle.*)    (cds_documents +      (+ packets,           (school_years.active_document_id,
                  school_years          not active)           candidate cleared, packets activated)
                  .candidate_document_id)
                                  │
                                  └── reject ──► cds_documents.invalidated_at = now(),
                                                 candidate cleared  (trigger permits
                                                 setting it once ✅)
```

Only activated packets on the `active_document_id` reach the five views, therefore only
approved data reaches students. That is the existing design; we are reusing it, not
inventing it.

---

## C. Database plan

### C1. `cds_library` — **zero DDL**. Verified item by item.

| Requirement | Existing support | ✅ |
|---|---|---|
| Write school-years, documents, extractions, packets | `cds_library_app` has `INSERT, SELECT, UPDATE` on all 8 base tables, **no DELETE anywhere** | verified live: inserts succeeded in a rolled-back txn; `DELETE` denied |
| Sequences for new ids | `GRANT SELECT, USAGE` on `cds_documents_id_seq`, `cds_school_years_id_seq`, plus `ALTER DEFAULT PRIVILEGES` for future ones | verified in `pg_dump` |
| Admin upload source | `cds_documents.source_kind` CHECK ∈ `{upload, college_transitions}` | `upload` fits |
| Human corrections | `cds_extractions.target_kind` CHECK ∈ `{candidate, active_update, full_reextract}` | `active_update` fits |
| One live job per slot | `cds_extractions_one_live_per_slot_idx` UNIQUE on `school_year_id` WHERE status IN (queued, running) | free concurrency guard |
| Claim ordering | `cds_extractions_claim_idx (status, queued_at)` | free |
| Job progress storage | `cds_extractions.validation_summary jsonb` is UPDATE-able and **not** covered by any immutability trigger | write `{"progress": {"done": n, "total": m}}` mid-run |
| Activation promotion | `cds_school_years.active_document_id` / `candidate_document_id` UPDATE | verified live |
| Reject | `cds_documents.invalidated_at` settable exactly once | verified in trigger source |

**No migration against `cds_library` is needed or permitted by this plan.** If one ever
becomes necessary it cannot go through `migrations/` — `cds_library_app` is not the
schema owner and cannot DDL; it would need the owner DSN and its own yoyo directory
against `?schema=cds_library` (the pipeline's `cds_library._yoyo_migration` ledger ✅
already exists, migrations `0001`–`0004` applied). Treat that as an escalation, not a
routine step.

### C2. `counselle` — one additive migration

`migrations/0015_cds_admin.sql` + `0015_cds_admin.rollback.sql`, `-- depends: 0014_response_mode`,
applied by the existing `yoyo apply --batch --database "${COUNSELLE_DB_APP_DSN}?schema=counselle" migrations/`.

```sql
-- staging: files live here between upload and "Process all". PDFs cannot be written to
-- cds_documents until a school_year exists, and a school_year needs a confirmed school+year.
CREATE TABLE counselle.cds_upload_files (
  id              uuid PRIMARY KEY,
  batch_id        uuid NOT NULL,
  uploaded_by     uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  filename        text NOT NULL,
  content         bytea NOT NULL,          -- dropped once committed to cds_documents
  size_bytes      bigint NOT NULL CHECK (size_bytes > 0),
  sha256          bytea NOT NULL CHECK (octet_length(sha256) = 32),
  page_count      integer,
  status          text NOT NULL,           -- matched|needs_input|replaces_existing|duplicate|committed|error
  school_id       integer,                 -- no FK: cross-schema, counselle_app has no cds_library access
  academic_year   smallint,
  detection       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {name, confidence, year_source, candidates[]}
  error_message   text,
  committed_document_id  bigint,
  committed_extraction_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cds_upload_files_batch_idx ON counselle.cds_upload_files (batch_id, created_at);
CREATE INDEX cds_upload_files_sha_idx   ON counselle.cds_upload_files (sha256);

-- pending review edits, held until Approve materialises them into a human-review packet
CREATE TABLE counselle.cds_pending_edits (
  document_id   bigint NOT NULL,
  metric_ref    text   NOT NULL,
  domain_id     text   NOT NULL,
  payload       jsonb  NOT NULL,   -- {value, raw_value, availability_status, evidence{...}, note}
  edited_by     uuid   NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  edited_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, metric_ref)
);

-- who did what, forever
CREATE TABLE counselle.cds_admin_audit (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid NOT NULL REFERENCES counselle.users(id),
  action        text NOT NULL,   -- upload|commit|extract|edit|approve|approve_override|reject|rerun
  school_id     integer,
  academic_year smallint,
  document_id   bigint,
  extraction_id uuid,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX cds_admin_audit_at_idx ON counselle.cds_admin_audit (at DESC);
```

Deliberately no cross-schema FKs: `counselle_app` has zero grants on `cds_library` ✅ and
that wall stays up.

### C3. The third DSN

`config/settings.py` gains `db_pipeline_dsn: str | None = None`
(`COUNSELLE_DB_PIPELINE_DSN`), listed in `_SECRET_FIELDS` for masking. Shape (verified
working today ✅):
`postgresql://cds_library_app:***@127.0.0.1:5433/counselle_data`.

`app/deps.py::build_runtime` builds `pipeline_pool` **only when the DSN is set** and
attaches it to `Runtime`; `aclose()` closes it. When unset, the admin router still
mounts but every route returns a clean 503 "CDS admin is not configured" — the app must
boot fine without it (mirrors `cds_data_enabled`).

**Security note, must be actioned before anything leaves this laptop:** the live
`cds_library_app` password is still the literal placeholder the unrotated `.env.example` placeholder, and
`postgres` is the unrotated `.env.example` placeholder ✅. Rotate both in P0. Also flagged: two undocumented
schemas `cds_deploy_export` / `cds_deploy_seed` exist outside version control; inert (no
role has USAGE) but they belong in the old-repo teardown checklist.

---

## D. Backend API

Router: `api/routes/cds_admin.py`, `router = APIRouter(tags=["cds-admin"], prefix="/admin/cds")`,
registered as `app.include_router(cds_admin.router, prefix="/v1")` in `create_app()`
alongside the other workspace routers, **before** `_install_spa_routes(...)` ✅.

**Auth on every route:** `dependencies=[Depends(current_superuser)]` at the router level
(`api/auth.py:270`, already defined, currently wired nowhere ✅). Write routes add
`Depends(auth_origin_protect)`; JSON writes add `Depends(require_json)`; multipart
follows the `api/routes/documents.py` precedent (no `require_json`).

Errors follow the existing envelope: a narrow `CdsAdminError` family in `app/cds/`
translated at the route boundary by a local `map_cds_errors()` mirroring
`api/routes/workspace_common.py::map_workspace_errors` (404 not-found, 409 conflict,
422 validation) — a new family, not a reuse of `WorkspaceNotFoundError`.

No `response_model=`; routes return the Pydantic model and FastAPI serialises (house
convention ✅).

| # | Method + path | Request | Response | Notes |
|---|---|---|---|---|
| 1 | `GET /v1/admin/cds/coverage` | query: `q`, `year[]`, `status[]`, `missing_year`, `all_schools`, `limit`, `offset` | `{years:int[], rows:[{school_id,name,state,cells:{[year]:Cell}}], counters:{schools,editions,needs_review,processing,failed,missing}, total}` where `Cell = {status: none\|processing\|needs_review\|approved\|failed, document_id?, school_year_id?, extraction_id?, updated_at?, partial_domains?}` | Default lists only schools with ≥1 school-year row; `all_schools=true` + `q` searches the full 2,746 for empty-cell upload targets |
| 2 | `GET /v1/admin/cds/schools` | `q`, `limit` | `[{id,name,state,city}]` | Typeahead for the staging table's school picker |
| 3 | `POST /v1/admin/cds/uploads` | multipart: `file`, `batch_id` (client uuid) | `UploadRow` | **One file per request, N in parallel from the browser.** Hash + page-count + detection run inline; per-file isolation is structural |
| 4 | `GET /v1/admin/cds/uploads` | `batch_id` | `{batch_id, rows: UploadRow[]}` | Survives reload/restart — staging lives in Postgres |
| 5 | `PATCH /v1/admin/cds/uploads/{file_id}` | `{school_id?, academic_year?}` | `UploadRow` | Re-evaluates the row's status (dup / replaces existing / matched) |
| 6 | `DELETE /v1/admin/cds/uploads/{file_id}` | — | 204 | Drop a staged file |
| 7 | `POST /v1/admin/cds/uploads/{batch_id}/process` | `{}` | `{queued:[{file_id,school_year_id,document_id,extraction_id}], skipped:[{file_id,reason}]}` | Per-row try/except; one bad PDF never blocks the batch |
| 8 | `GET /v1/admin/cds/jobs` | `batch_id` \| `ids[]` | `[{extraction_id, school_id, school_name, academic_year, document_id, status, queued_at, started_at, finished_at, error_code, progress:{done,total}}]` | Polled while any row is non-terminal. **No SSE** |
| 9 | `GET /v1/admin/cds/documents/{document_id}` | — | `DocumentReview` (see below) | The review read model |
| 10 | `GET /v1/admin/cds/documents/{document_id}/pages/{page}.png` | `w` (default 1400, capped) | `image/png` | PyMuPDF render in `asyncio.to_thread`, bounded in-process LRU (64 pages). `Cache-Control: private, max-age=86400, immutable` (PDF bytes are immutable ✅), `X-Content-Type-Options: nosniff` |
| 11 | `PATCH /v1/admin/cds/documents/{document_id}/metrics` | `{edits:[{metric_ref, value, raw_value, availability_status, evidence:{page_number,excerpt,section?,row_label?,column_label?}, note?}]}` | `DocumentReview` | Writes `counselle.cds_pending_edits`; nothing in `cds_library` moves |
| 12 | `POST /v1/admin/cds/documents/{document_id}/approve` | `{override_flags: bool, note?}` | `{document_id, activated_domains, extraction_id?}` | **409** if unresolved flags and `override_flags=false`. Materialises pending edits → human-review packets → activates → clears candidate → `catalog.maybe_refresh(force=True)` |
| 13 | `POST /v1/admin/cds/documents/{document_id}/reject` | `{reason}` | 204 | `invalidated_at = now()`, clears candidate pointer |
| 14 | `POST /v1/admin/cds/documents/{document_id}/rerun` | `{domains?: string[]}` | `{extraction_id}` | New queued extraction, `target_kind='full_reextract'` (or hash-scoped `active_update` when `domains` omitted and the doc is already active) |
| 15 | `GET /v1/me` *(existing route, one added field)* | — | `… , "is_superuser": bool` | So the SPA can render the admin nav entry |

`DocumentReview` shape:

```jsonc
{
  "document": {"id","school_id","school_name","academic_year","filename","page_count",
               "sha256","source_kind","retrieved_at","is_candidate","is_active"},
  "extraction": {"id","status","extractor_version","model_id","finished_at","error_code",
                 "counts": {"verified","not_extracted","conflict","invalid"}},
  "sections": [{                              // CDS order: by the domain's first source_hint letter
    "domain_id","title","status","counts",
    "metrics": [{"ref","title","description","type","unit","source_hints",
                 "value","raw_value","display","availability_status","extraction_status",
                 "evidence": {"page_number","excerpt","section","row_label","column_label"},
                 "flags": [{"code","severity","message"}],
                 "pending_edit": {…} | null}]
  }],
  "flags_summary": {"unresolved": 3, "total": 7}
}
```

### D1. Admin promotion (decision 4)

`scripts/promote_admin.py --email a@b.c [--revoke]` → parameterized
`UPDATE counselle.users SET is_superuser = $1 WHERE email = $2 RETURNING id`, prints the
result, exits non-zero if no row matched. ~25 lines, uses `get_settings().db_app_dsn`.
No route, no UI, no RBAC table. `is_superuser` is a flat boolean and one admin surface
does not justify a role system.

---

## E. Job execution

**Decision: a single in-process asyncio poller, with all queue state in Postgres, using
the lease/claim mechanism `cds_extractions` already has.**

```python
# app/cds/jobs.py — started from the FastAPI lifespan, cancelled on shutdown
async def poller(runtime, settings):
    sem = asyncio.Semaphore(settings.cds_worker_concurrency)   # default 3
    while True:
        await recover_expired(pool)          # running + lease_expires_at < now() -> failed/worker_lost
        async with sem:
            claimed = await claim_next(pool) # FOR UPDATE SKIP LOCKED, oldest queued -> running + lease
        if claimed:
            asyncio.create_task(run_with_lease(claimed))   # LeaseKeeper renews every lease/3
        else:
            await asyncio.sleep(settings.cds_worker_poll_seconds)   # default 3s
```

**Why this and not the alternatives:**

- *Why not synchronous-in-request (the `document_summary.py` shape)?* Extraction is 8
  provider calls over multi-MB PDFs — tens of seconds to minutes. Way past an HTTP
  request's budget, and a batch of 40 files makes it absurd.
- *Why not `asyncio.create_task` fire-and-forget with an in-memory registry (the
  `TurnRegistry` shape)?* It loses everything on restart and gives no cross-restart
  status. Chat turns can afford that; a 40-file extraction batch cannot.
- *Why not Celery/RQ/Redis?* New infrastructure, new container, new failure mode — for a
  queue Postgres already implements, with fencing already built and indexed. Textbook
  over-engineering under AGENTS.md's value×ease rule.
- *Why not a separate worker process?* The old pipeline needed one because the API was a
  different service. Here it is the same process, and ADR 0023 says one deployable.

**Restart survival.** Queue state is 100% in `cds_extractions`. A crash mid-run leaves a
`running` row whose lease expires; the next boot's `recover_expired()` sweeps it to
`failed` with `error_code = 'worker_lost'`. The coverage cell turns red and the admin
clicks **Re-run**. We deliberately do **not** auto-requeue: there is no attempt-counter
column and adding one is `cds_library` DDL. Honest failure + a one-click retry beats an
invisible retry loop.

**Fencing, ported.** Every mutating call re-checks `status='running' AND lease_expires_at
> now()`; `complete_run` additionally re-checks that the school-year pointer still points
at the claimed document, the document SHA still matches, and manifest/extractor/model
identity is unchanged, all in one transaction. A worker that lost its lease can never
activate stale results. `cds_extractions_one_live_per_slot_idx` prevents two jobs on one
slot; `SKIP LOCKED` prevents double-claim.

**Blocking work off the loop.** Every PyMuPDF operation and every `google-genai` call
goes through `asyncio.to_thread`. Concurrency is capped (3) so extraction never starves
the chat event loop.

**Settings:** `cds_worker_enabled: bool = True` (kill switch), `cds_worker_poll_seconds:
int = 3`, `cds_worker_concurrency: int = 3`, `cds_extraction_lease_seconds: int = 900`,
`cds_model_timeout_seconds: int = 180`, `cds_upload_max_bytes: int = 50_000_000`,
`model_cds_extract: str = "google-vertex:gemini-3.1-flash-lite"`,
`model_cds_detect: str = "google-vertex:gemini-3.1-flash-lite"`.

---

## F. Frontend

All in `frontend/` ✅ (`mvp3-frontend/` is a frozen prototype — never build there).

### F1. Routing and gating

Three routes nested inside the existing `WorkspaceShell` under `/app` — so the admin
inherits the sidebar, auth, and shell chrome for free, and we build no second app shell:

```tsx
// frontend/src/app/router.tsx — inside the /app children array
{ path: "admin/cds",                element: <AdminGate><CdsCoveragePage /></AdminGate> },
{ path: "admin/cds/upload",         element: <AdminGate><CdsUploadPage /></AdminGate> },
{ path: "admin/cds/documents/:documentId", element: <AdminGate><CdsReviewPage /></AdminGate> },
```

`frontend/src/app/auth/AdminGate.tsx` — reads `is_superuser` from the existing `/v1/me`
query; renders the shared skeleton while loading, `<Navigate replace to="/app/ai"/>`
otherwise. Mirrors `RequireAuth`/`OnboardingGate`.

Nav: `frontend/src/app/shell/navigation.tsx` gains an exported
`adminShellRoutes: ShellRoute[] = [{id:"cds", title:"CDS", icon:<DatabaseZap/>, link:"/app/admin/cds"}]`,
appended by `MainNav` only when `is_superuser`. One entry, not a section.

### F2. API client (three-layer house convention ✅)

```
src/api/cds-admin/types.ts      Cell, UploadRow, JobRow, DocumentReview, ReviewFlag, MetricRow
src/api/cds-admin/coverage.ts   getCoverage(filters), searchSchools(q)
src/api/cds-admin/uploads.ts    uploadFile(file, batchId)  // FormData + safeFetch, per documents.ts
                                listBatch, patchRow, deleteRow, processBatch
src/api/cds-admin/documents.ts  getDocument, patchMetrics, approve, reject, rerun, pageImageUrl
src/api/cds-admin/jobs.ts       getJobs(batchId | ids)
src/api/cds-admin/keys.ts       query-key factory
src/api/cds-admin/hooks.ts      TanStack Query wrappers
```

Query keys:
`["cds-admin","coverage",filters]` · `["cds-admin","batch",batchId]` ·
`["cds-admin","jobs",batchId]` · `["cds-admin","document",documentId]` ·
`["cds-admin","schools",q]`.

`pageImageUrl(documentId, page, w)` returns a plain path — the `<img>` carries the
same-origin cookie automatically; no fetch wrapper needed.

### F3. Screen 1 — Coverage (`features/cds-admin/`)

```
CoverageRoute.tsx        page body: PageHeader + counters + filter bar + grid
CoverageGrid.tsx         the schools × years matrix
CoverageCell.tsx         one status chip, clickable
coverage-filters.ts      pure predicate/param builders
coverage-status.ts       status → Badge variant + label + icon (single source of truth)
cds-admin-types.ts
```

**Reuse:** `PageHeader` (title + right-aligned "Batch upload" button) · `Table` family ·
`Badge` (variants `success`/`warning`/`info`/`destructive`/`outline` map 1:1 onto
approved/needs-review/processing/failed/none — **zero new design tokens needed**) ·
`Input` + `Select`/`DropdownMenu` for filters · `Tooltip` for cell detail · `Skeleton` ·
the `Empty*` family · the verbatim error-card + "Try again" shape from
`SchoolsRoute.tsx:204-217`.

**Genuinely new:** sticky behaviour. The existing `Table` is a plain scrollable table.
This is CSS on the existing primitive, not a new component: `sticky top-0 z-10 bg-background`
on `<TableHead>`, `sticky left-0 z-20 bg-background` on the first cell of every row,
inside the primitive's existing `overflow-x-auto` container. Fixed 88 px year columns so
cells never reflow.

**UX details that make it feel excellent:**
- Header counters read as one sentence: *"4 schools · 5 editions · 1 needs review · 0 failed"*.
- Default view lists only schools that have CDS activity. A search box (`/` focuses it)
  with an "include all schools" toggle reaches into the full 2,746 to find an empty cell.
  Never render 2,746 rows by default.
- Clicking a filled cell → `/app/admin/cds/documents/{id}`. Clicking an empty cell →
  `/app/admin/cds/upload?school_id=…&year=…`, prefilled. That is the whole navigation model.
- Cell tooltip: extraction date, extractor version, `N/M domains`, error code if failed.
- A cell in `processing` polls (`refetchInterval` while any cell is non-terminal) and
  flips in place. No page refresh, no spinner overlay.

### F4. Screen 2 — Batch upload

```
BatchUploadRoute.tsx     drop zone + staging table + the single CTA
FileDropZone.tsx         NEW — native HTML5, ~60 lines, no dependency
StagingTable.tsx         one row per file, editable school/year
StagingRow.tsx
SchoolPicker.tsx         typeahead over GET /admin/cds/schools, built on `command` (cmdk) + `popover`
upload-status.ts         status → chip mapping
useBatchUpload.ts        client batch_id, parallel uploads (cap 4), per-file state machine
```

**Reuse:** `Table` · `Badge` · `Button` · `Select` · `Input` · `command`/`popover` for
the school typeahead · `Meter` for per-file upload progress · `sonner` toasts ·
`Empty*` for the pre-drop state.

**Genuinely new:** `FileDropZone` — `onDragOver`/`onDragLeave`/`onDrop` reading
`DataTransfer.files`, plus a hidden `<input type="file" multiple accept="application/pdf">`
for click-to-browse. `TaskBoard.tsx` is the in-repo precedent for native HTML5 DnD ✅.
**No new dependency** (decisions 6 and 7).

**UX details:**
- Rows appear the **instant** a file is dropped, in an optimistic `uploading` state with
  a `Meter`. Hash + page count + detection fill in-place as the response lands.
- Row statuses: `matched` (green, school+year confident and unique) · `needs input`
  (amber, editable school/year cells focused) · `replaces existing` (blue, links the
  document it would supersede) · `duplicate` (muted, struck-through filename, links the
  existing document, excluded from processing) · `error` (red, inline reason).
- One primary button: **"Process all (N ready)"** — disabled with the reason inline
  ("3 rows need a school"), never a modal.
- **The killer detail: pressing it does not navigate.** The same table transitions into a
  live job table — the status column starts polling `GET /admin/cds/jobs?batch_id=…` and
  each row walks `queued → running → done/failed` in place, with a link to review on
  success. One screen, start to finish.
- Per-file isolation is structural, not defensive: one request per file, one row per
  file, one try/except per row server-side.
- Reload-safe: staging lives in Postgres and the batch id is in the URL.

### F5. Screen 3 — Document review

```
DocumentReviewRoute.tsx  two-pane layout + sticky action bar
PdfPageViewer.tsx        NEW — left pane
ReviewSection.tsx        one CDS domain, collapsible
ReviewMetricRow.tsx      label · value · evidence chip · flags · click-to-edit
MetricEditor.tsx         inline editor (useSyncedDraft dirty/commit/revert pattern)
FlagChip.tsx
ApproveBar.tsx           Approve / Re-run / Reject + the override affordance
review-order.ts          pure: domains → CDS letter order
```

**Reuse:** `Accordion` for sections (already used for requirement rows in
`SchoolWorkspace.tsx` ✅) · `Badge` for flag severity · `Input`/`Textarea`/`Select` for
edits · the `useSyncedDraft` pattern (`SchoolWorkspace.tsx:198-207`) verbatim ·
`ScrollArea` · `Tooltip` · `Button` · `sonner`.

**Genuinely new:**
- `PdfPageViewer` — an `<img src="/v1/admin/cds/documents/{id}/pages/{n}.png?w=1400">`
  inside a `ScrollArea`, with prev/next, a page number input, and an imperative
  `goToPage(n)` the right pane calls. ~80 lines. **No PDF.js, no react-pdf** (decision 6):
  PyMuPDF is already needed by the engine, so server-side PNG is free capability and
  keeps the SPA bundle flat.
- The split layout is `grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]` with two
  independently scrolling columns. No split-pane component, no resize handle (YAGNI —
  add it only if an admin asks).

**UX details:**
- Clicking a metric's evidence chip jumps the left pane to that page and flashes a
  highlight ring. That single interaction is what makes review fast; it is the reason the
  viewer exists.
- Each section header shows `N/M verified` and a flag count; flagged metrics sort to the
  top of their section behind a "flagged first" toggle (default on).
- Editing is inline: click the value, it becomes an input, blur commits to pending edits
  with a subtle "edited" marker and an Undo in a `sonner` toast. Committing a value
  requires page + excerpt, prefilled from the original finding — the evidence contract is
  enforced in the UI, not just the API.
- Sticky bottom bar. **Approve** is disabled with the literal blocking reason ("3
  unresolved flags"), beside a secondary **"Approve anyway"** that sends
  `override_flags: true` and is recorded in the audit log. Re-run and Reject sit to the
  right; Reject requires a reason.
- Mobile: single column, the viewer collapses into a per-metric "view page" sheet. Admin
  work is desktop work — don't over-invest here.

### F6. Design-system discipline

Only the core semantic tokens (`--background`, `--card`, `--muted-foreground`, `--border`,
`--ring`, `--success`/`--warning`/`--info`/`--destructive`, the `--radius-*` scale, the
existing ad-hoc type sizes: page title `text-xl font-semibold tracking-tight`, section
`font-heading text-lg font-medium`, body `text-sm`, meta `text-xs text-muted-foreground`).
Feature-scoped `--workspace-*`/`--task-*`/etc. are private to their features and must not
be reused. **No `--cds-*` tokens are minted** — the eight existing `Badge` variants cover
all five statuses and all flag severities. If a genuinely new visual appears, mint
`--cds-*` in `index.css` following the `--task-*-pill-*` precedent; do not hardcode.

### F7. Checks

`cd frontend && npm run typecheck && npm run lint && npm run test && npm run build`.
Co-located `*.test.tsx` only where a test earns its place: `coverage-status.ts` mapping,
`review-order.ts` CDS ordering, the `useBatchUpload` state machine. No snapshot tests, no
coverage chasing (AGENTS.md).

---

## G. Migration and cutover

**The core fact that makes this cheap:** the new engine writes the same base tables, in
the same shapes, under the same manifest, behind the same views. There is no data
migration — only a change of who does the writing.

1. **Freeze the old repo's writer.** `docker compose stop worker app` in
   `counselle-data-pipeline`; leave `db` running (it is the shared Postgres). Two writers
   would not corrupt anything (`one_live_per_slot` + lease fencing), but they would waste
   provider calls and confuse the audit trail.
2. **Existing data stays exactly as it is.** 2,746 school profiles, 5,946 CT-index rows,
   14 manifests, 5 documents, 217 packets, 51 active. Nothing is deleted, relabelled, or
   rewritten — the immutability triggers would refuse anyway, and ADR 0032 forbids it.
   Old `gemini-routed-extraction-v8` packets keep serving students throughout the whole
   build. **The new system is purely additive until the first Approve.**
3. **Rotate credentials.** `cds_library_app` and `postgres` are still on `.env.example`
   placeholders ✅. Rotate, update both repos' `.env`, add `COUNSELLE_DB_PIPELINE_DSN`.
4. **Prove parity before trusting it (P7 gate).** Re-extract the 4 active documents with
   the new engine into *candidate* extractions (packets stored, not activated — the DB
   supports exactly this ✅) and diff metric-by-metric against the live v8 packets. Any
   metric that changes from `verified/reported` to something else, or changes value, is
   reviewed by hand before activation. This is the honesty gate on the engine swap and it
   costs about $0.12 of Gemini.
5. **Then activate**, one document at a time, through the real Approve flow — dogfooding
   the UI on the only data that matters.
6. **The old repo.** Once parity passes: archive it (`git tag pre-retirement`, push,
   archive on GitHub, README pointing here). Do **not** delete — `config/cds/` provenance
   and the 4 pipeline ADRs (0006/0007/0008 on native-PDF and page-routed extraction) are
   the historical record for why the engine is shaped the way it is. Keep `docker-compose`'s
   `db` service as the local Postgres until Counselle owns its own compose entry (a
   separate, later chore — out of scope here).
7. **Counselle docs.** New ADR `0036-cds-pipeline-in-app.md` (Counselle becomes a
   *writer* of `cds_library` through a third DSN; the read boundary is unchanged; engine
   in `adapters/`, not PydanticAI; extractor identities `counselle-cds-v1` /
   `human-review-v1`). Amends ADR 0012 and ADR 0032's "read-only consumer" framing —
   **do not silently break them.** Then update `docs/ARCHITECTURE.md` (repo layout + a
   CDS-manager section), `docs/DATABASE_GUIDE.md` §1 (the third DSN and its exact
   boundary), `AGENTS.md` (status + the "read-only consumer" sentence), `README.md`,
   `.env.example`, `docs/adr/README.md`.
8. **Rollback.** Stop the poller (`cds_worker_enabled=false`), do not approve anything.
   Because activation is the only step that changes what students see, rollback before
   any Approve is a no-op, and after an Approve it is a re-activation of the prior packet
   set (they are still in the table, `is_active=false`). Restarting the old worker
   container is always available as the last resort.

---

## H. Build phases

Each phase is independently verifiable and sized for one subagent.

| # | Phase | Depends on | Deliverable | Verification gate |
|---|---|---|---|---|
| **P0** | Foundations | — | Port `config/cds/` (13 YAMLs + manifest + prompt + extractor-version); add `pymupdf` to `pyproject.toml`; Settings: `db_pipeline_dsn`, `model_cds_extract`, `model_cds_detect`, worker knobs, upload cap, **+2 extractor versions in both allow-lists**; `pipeline_pool` in `build_runtime`/`Runtime.aclose`; `scripts/promote_admin.py`; ~~rotate DB passwords~~ **moved to P7 — see note below** | `uv run ruff check . && uv run mypy .` clean; `uv run pytest -m "not live_llm and not live_search and not live_db"` green; app boots with and without the new DSN; `promote_admin.py` flips a real user |

**P0 note — password rotation deferred to P7 (2026-08-18):** checked `docker ps -a` for the old pipeline's containers. `counselle-data-pipeline-db-1` (the shared Postgres) is `Up ... (healthy)` — leave it running, Counselle reads/writes it directly. But `counselle-data-pipeline-app-1` and `counselle-data-pipeline-worker-1` both show `Exited` (stopped 4 weeks ago) — the old pipeline's writer is **not currently running**, so there is no live process holding the the unrotated `.env.example` placeholder / the unrotated `.env.example` placeholder credentials that a mid-build rotation could break. Even so, rotating now is unnecessary risk for this phase (no consumer of the new credential exists yet — the pipeline pool isn't used until P2), and the plan's own §G step 3 already sequences rotation with "add `COUNSELLE_DB_PIPELINE_DSN`," which P0 does. Rotating is cheap to do later and costs nothing to defer, so it moves to P7 (cutover), right before the old repo is archived and nothing can accidentally reconnect with the stale password. `cds_deploy_export`/`cds_deploy_seed` drift schemas (recon-db-live.md §1) remain flagged for whoever owns deploy tooling — also out of scope for P0.
| **P1** | Manifest + packet core (`domain/cds/`) | P0 | `manifest_types`, `manifest_compile`, `claims`, `packet_build`, `pages`, `validators` | **`scripts/cds_manifest_check.py` prints `c821b2e6…` and exits 0.** Golden test: rebuild one of the 51 live packets from its own `provider_contract` + metrics and assert byte-equality. Every validator has a unit test (honesty-critical → tested hard) |
| **P2** | Adapters | P0 | `cds_gemini`, `cds_pdf`, `cds_store` | One-shot script extracts a single domain group from `artifacts/cds-corpus/harvard_2024-2025.pdf` and prints findings; `cds_pdf.render_page_png` produces a correct PNG; `cds_store` writes + rolls back a full school-year/document/extraction/packet chain |
| **P3** | DB + admin reads | P0 | `migrations/0015_cds_admin.sql(+rollback)`; `cds_admin_queries`; `app/cds/audit.py` | `yoyo apply` then `yoyo rollback` clean; the coverage query returns the 5 known slots with the right statuses (Yale 2025 = `needs_review` candidate, the other 4 = `approved`) |
| **P4** | Engine + jobs | P1, P2, P3, **spike results** | `app/cds/manifest.py`, `engine.py`, `jobs.py`, `detect.py` | Queue an extraction for Penn 2024 → completes → packets written → `parse_packet_row()` accepts every one. Kill the process mid-run → next boot sweeps it to `failed/worker_lost`. `detect.py` gets school+year right on ≥13/15 corpus PDFs (Cornell's stale header and Caltech's corrupt digits are the named hard cases) |
| **P5** | Ingest/review services + API | P4 | `service_ingest`, `service_review`, `models`, `api/routes/cds_admin.py`, `+is_superuser` on `/v1/me` | Every endpoint 200 as superuser and **403 as a normal user**; a full curl walkthrough: upload 3 PDFs → patch a row → process → poll jobs → fetch review → patch a metric → approve → the document appears in `active_cds_documents` and the packet parses. **FE contract frozen here** |
| **P6a** | FE Coverage | P5 | `features/cds-admin` coverage screen, `AdminGate`, nav, `api/cds-admin/*` | typecheck/lint/test/build green; grid renders live data; empty-cell click prefills upload |
| **P6b** | FE Batch upload | P5 (+ `api/cds-admin/*` from P6a) | drop zone, staging table, process + live job table | Drag 5 PDFs (one duplicate, one unrecognisable) → correct row statuses → process → rows go green in place |
| **P6c** | FE Document review | P5 | viewer, sections, inline edit, approve bar | Evidence chip jumps the viewer; edit + approve round-trips; Approve blocked by flags, override works |
| **P7** | Cutover + docs | all | Stop old worker; parity re-extraction of the 4 documents; ADR 0036; docs; optional manifest `5.1.0` per §B3; archive the old repo | Parity diff reviewed and signed off; full backend + frontend suites green; a live end-to-end pass in the browser |

**Concurrency:** **P1 ‖ P2 ‖ P3** (three subagents, only P0 in common).
**P6a ‖ P6b ‖ P6c** (three subagents, after the P5 contract freeze; P6a lands the shared
`api/cds-admin/{types,keys,hooks}` skeleton first — a 30-minute serialisation, then full
parallel). P4 is the one genuine bottleneck and needs the spike's answers.

Critical path: **P0 → P2 → P4 → P5 → P6c → P7.**

---

## I. Risks and cut list

### I1. Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Manifest hash drift on port.** Any whitespace/ordering/hash-input difference produces a new `content_sha256` → a new manifest version → all 51 active packets become `current_definition_match = false` → student answers gain spurious caveats | High | The P1 gate asserts the exact hash `c821b2e6…` before a single line of engine code is written. Committed as a regression test. If it cannot be matched, **stop and escalate** — do not "just publish 6.0.0" |
| 2 | **Reader silently rejects new packets.** New `extractor_version` not in the allow-list → `parse_packet_row` raises `packet_identity_mismatch` → the domain returns the safe error string and students see nothing. Fails *quietly* | High | Both allow-lists updated in P0; a `live_db`-marked test reads a `counselle-cds-v1` packet back through `parse_packet_row`; the writer self-validates through the same parser before COMMIT (§A3) |
| 3 | **Malformed packet rejected wholesale.** `extra="forbid"`, exact `counts`, `provider_contract`-only extra key — all easy to violate, especially in the hand-built human-review path | High | Every packet — model or human — is built by the one `domain/cds/packet_build.py` builder and validated by `parse_packet_row()` inside the transaction. Non-negotiable; this is the honesty carve-out |
| 4 | **Extraction accuracy on real documents.** Cornell's C1 numbers and labels arrive in disjoint, mis-ordered blocks; Caltech silently corrupts digits via broken ToUnicode CMaps (-29 / +3 shifts, no exception); a third of the corpus has no textual C7 checkbox mark at all | High | Validators (`excerpt_on_cited_page`, `corrupt_text_layer`, `year_consistency`, `denominator_sanity`) turn silent wrongness into visible review flags; the C7 three-tier strategy; the 15-PDF corpus becomes the standing regression set; **Approve is blocked while flags are unresolved.** A wrong value that a human sees is a bug; a wrong value nobody sees is a lie |
| 5 | **Two writers.** The old pipeline's `worker` container is still running against the same Postgres | Medium | P7 step 1 stops it. Structurally safe meanwhile (`one_live_per_slot` unique index + lease fencing + immutable evidence) — wasteful, not corrupting |
| 6 | **Pathological documents.** Ohio State 2023-24 is 187 pages (56 of them near-blank) — 8 calls × 187 pages of inline PDF, plus a long single run holding a lease | Medium | Page routing; a `cds_max_pages_per_call` cap with a whole-document fallback; per-run token accounting into `validation_summary`; the 900 s lease with background renewal; the job fails honestly and is re-runnable rather than hanging |
| 7 | **The worker starves the chat loop.** Extraction shares a process with student traffic (ADR 0023, one deployable) | Medium | All PyMuPDF and SDK work via `asyncio.to_thread`; concurrency capped at 3; `cds_worker_enabled=false` kill switch; if it ever actually hurts, the poller lifts out into a second process with no code change (queue state is already all in Postgres) |
| 8 | **Auth blast radius.** A compromised superuser account can now write pipeline data | Medium | `current_superuser` on the router; `auth_origin_protect` on every write; `cds_library_app` has **no DELETE grant anywhere** ✅; evidence is trigger-immutable; every action audited; corrections are new rows, never overwrites. Worst case is recoverable by re-activating a prior packet |
| 9 | **Placeholder DB passwords in the live database** (the unrotated `.env.example` placeholder, the unrotated `.env.example` placeholder) ✅ | Medium | ~~Rotate in P0~~ **Moved to P7** (see the P0 row note): the old pipeline's `app`/`worker` containers are already stopped, so nothing is actively depending on the placeholder credential during the build, and no code uses `db_pipeline_dsn` until P2. Rotate before the old repo is archived. Also flag the undocumented `cds_deploy_export` / `cds_deploy_seed` schemas to whoever owns the deploy tooling |
| 10 | **Spike lands late or inconclusive.** P4 depends on it | Low | The seams in §B4 all have a safe default: whole-document calls, 7 inherited groups, `samples=1`, native-PDF-only C7. P4 can be built and shipped against those defaults and re-tuned later — the seams exist precisely so the parameters are swappable without a rewrite |

### I2. Cut list — deliberately not building

| Cut | Why |
|---|---|
| **College Transitions scraping / auto-download** (`ct_index.py`, `ct_download.py`, SSRF allowlists, generation-versioned refresh) | A single-selector scrape of a third-party HTML table with no API contract. Admins upload PDFs; that is the product decision. Existing `ct_index_entries` rows stay, unrefreshed |
| **XLSX ingestion** (Purdue publishes `.xlsx`) | Requires changing the `cds_documents.mime_type` CHECK — the one place we would need `cds_library` DDL. Not for 1 known school |
| **Split-CDS aggregation** (Amherst/Reed publish one PDF per lettered section) | Section-only PDFs extract what they contain and the cell shows `partial`, honestly. Multi-file-per-edition is a schema change (`cds_school_years` assumes one active document). Revisit only if it becomes common |
| **Gemini Batch API** (50 % discount) and **context caching** | Whole-corpus cost is ~$30. Buying a 24 h-turnaround async job type to save $15 is a bad trade |
| **SSE job progress** | Polling a terminal-state list is ~10 lines. SSE is a protocol, a reconnect story, and a Last-Event-ID story |
| **Celery / RQ / Redis / a separate worker container** | Postgres already has the queue, the index, and the fencing |
| **RBAC, roles table, admin-management UI** | `is_superuser` + `scripts/promote_admin.py`. One admin surface does not need a permission system |
| **Re-authoring the 1,149 metric `instructions`** | §B3: tolerate, then one prompt sentence, then per-domain incremental fixes on the existing hash-scoped re-extraction mechanism |
| **A YAML authoring/lint UI, or a manifest-publish UI** | Manifest publishing is a script, run rarely, by one person |
| **PDF.js / react-pdf** | PyMuPDF server-side PNG (decision 6). Zero SPA bundle cost |
| **Any drag-drop library** | Native HTML5 DnD (decision 7) |
| **A resizable split-pane in review** | Two grid columns. Add the handle only if an admin asks |
| **Auto-requeue of `worker_lost` jobs** | No attempt-counter column without `cds_library` DDL. Honest `failed` + one-click Re-run |
| **Bulk "re-extract everything" button** | A script. The hash-scoped `derive_requested_domains` logic stays in code; it just has no button |
| **Porting `source_map.py`, `spike.py`, `profiles.py`, the HTMX UI, the CSRF module, `upload_guard.py`** | Dead weight, superseded by Counselle's own auth/rate-limit/upload machinery |
| **Cross-schema FKs from `counselle.*` to `cds_library.*`** | `counselle_app` has no grants there, and that wall is the security model |

---

## Appendix — constants this plan depends on (all verified 2026-08-18)

```
manifest content_sha256   c821b2e61cf71f99c1f8503f8940bbce48354b978e091bb81223718784ad6f0a
manifest version          5.0.2          extraction contract 8
domains / metrics         13 / 1,149     extraction_groups 7  (⇒ 1 routing + 7 group calls)
writer role               cds_library_app   INSERT+SELECT+UPDATE on all 8 base tables, NO DELETE
reader role               counselle_ro ∈ cds_library_reader   SELECT on exactly 5 views
new extractor identities  counselle-cds-v1 (model), human-review-v1 (corrections)
model                     settings.model_cds_extract = "google-vertex:gemini-3.1-flash-lite"
auth                      COUNSELLE_VERTEX_API_KEY (Vertex Express Mode) — already present
already a dependency      google-genai>=2.8.0        to add: pymupdf
corpus                    artifacts/cds-corpus/ — 15 PDFs, 14 institutions (gitignored)
```
