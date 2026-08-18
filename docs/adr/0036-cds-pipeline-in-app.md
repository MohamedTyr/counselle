# ADR 0036 — CDS extraction pipeline moves in-app; Counselle becomes a writer

**Status:** Accepted

## Context

Since ADR 0032, Counselle consumed CDS Library data produced by an independently
deployed sibling repo, `counselle-data-pipeline`: its own FastAPI app, its own
worker container, its own extraction engine, writing into the shared
`counselle_data` Postgres database that Counselle only read from. That separation
was reasonable while the pipeline was actively evolving in isolation, but it had
become a real operational liability:

- **Two repos, one database, one team.** Every extraction-engine change required
  switching repos, and the pipeline's `app`/`worker` containers had drifted to
  "stopped for 4 weeks" in practice — nobody was maintaining a second deployable
  for a workload of a handful of documents.
- **The pipeline's own extraction recall was poor and invisible.** A live count
  showed most requested domains storing effectively empty packets (e.g.
  Harvard's `admissions` domain: 2 of 152 metrics verified) with no admin
  surface to see, correct, or re-run a bad extraction — only direct SQL access
  to the pipeline's database told the story.
- **CDS coverage was, and remains, a cold start**: 3 schools, 5 school-year
  slots, 4 active documents, out of a 2,746-school catalog. There is essentially
  no production data at stake, which makes this exactly the right moment to
  change who writes it — before the corpus is large, not after.
- **The 1,149 metric definitions and the manifest/packet-v8 contract are the
  expensive, correct asset**, not the pipeline app that wrote them. Porting the
  manifest byte-identically and rebuilding the writer in-repo captures that
  asset while retiring the second deployable.

Full evidence and the build-out plan: `plans/cds-pipeline/PLAN.md` (architecture,
DB, API, frontend, phased build) and `plans/cds-pipeline/routing-tuning.md`
(the routing/citation fixes and the measured per-metric recall improvement).

## Decision

The CDS extraction pipeline and its admin tool are rebuilt **inside the
Counselle repo**, as a new layered subsystem (`domain/cds/`, `adapters/cds_*`,
`app/cds/`, `api/routes/cds_admin.py`), following ADR 0017's four-layer
discipline exactly like the rest of the app. `counselle-data-pipeline` is
retired as an active writer.

**What is unchanged — the read path, in full:**

- `cds_library`'s schema, its 5 reader views (`school_profiles`,
  `active_cds_documents`, `active_cds_domain_packets`, `cds_document_sources`,
  `cds_manifest_snapshots`), and the `cds_library_reader` role are untouched.
  **Zero DDL, zero grant changes, zero view changes.**
- The 1,149 metric definitions are ported byte-identically. The compiled
  manifest's `content_sha256` is unchanged
  (`c821b2e61cf71f99c1f8503f8940bbce48354b978e091bb81223718784ad6f0a`), so
  manifest `5.0.2` stays current and every one of the 51 existing active
  packets keeps `current_definition_match = true`. The new engine is invisible
  to the reader contract as long as this hash check passes
  (`scripts/cds_manifest_check.py`, a committed regression test).
- `counselle_db/*.py`, `app/deps.py`'s read-side (`ro_pool`, `Catalog`), and
  every existing consumer of `counselle_db.service` are unmodified. ADR 0032's
  packet-v8 anti-corruption boundary, evidence rules, and honesty spec in
  `docs/DATABASE_GUIDE.md` are the same code, reading the same views, applying
  the same rules.

**What is new — a write path, walled off by role and DSN:**

- A third DSN, `COUNSELLE_DB_PIPELINE_DSN` (`config/settings.py`), connects as
  `cds_library_app` — a role with `INSERT, SELECT, UPDATE` (never `DELETE`) on
  the 8 `cds_library` base tables. It is used **only** by the new admin
  pipeline (`adapters/cds_store.py`, `adapters/cds_admin_queries.py`), never by
  the student-facing agent path, which keeps using `COUNSELLE_DB_RO_DSN` /
  `cds_library_reader` exactly as before.
- The engine writes through two new extractor identities —
  `counselle-cds-v1` (model extractions) and `human-review-v1` (admin
  corrections) — added to the existing `supported_packet_extractor_versions`
  allow-list alongside the legacy `gemini-*` identities. Reusing the old
  identity for a different engine would misstate provenance; a new identity
  says plainly which engine produced a packet.
- Every packet the writer builds — model or human-corrected — is validated
  through the reader's own `counselle_db.packets.parse_packet_row()` inside
  the transaction, before COMMIT. If the reader would reject it, the write
  aborts. The write path cannot produce a packet the read path can't parse;
  this is enforced at runtime, not by convention.
- Human corrections are new packet rows with `provider_contract.human_review`
  provenance, never mutations — `cds_domain_packets` has a BEFORE UPDATE
  immutability trigger that makes this the only possible shape, not just the
  chosen one.
- A new, additive `counselle` schema migration (`0015_cds_admin.sql`) adds
  upload staging, pending review edits, and an admin audit log — entirely
  inside Counselle's own schema, no cross-schema foreign keys into
  `cds_library` (`counselle_app` still has zero grants there).
- An in-process asyncio poller (`app/cds/jobs.py`), started from the FastAPI
  lifespan, claims and runs extraction jobs using the lease/claim columns
  `cds_extractions` already had. No Celery, no Redis, no second container —
  one deployable, per ADR 0023.
- 15 endpoints under `/v1/admin/cds`, gated by the pre-existing
  `current_superuser` dependency (defined in ADR 0021's auth module, wired
  nowhere until now), and three admin screens
  (`frontend/src/features/cds-admin/`) nested inside the existing workspace
  shell, visible only to superusers.
- The extraction engine (`adapters/cds_gemini.py`) calls `google-genai` against
  Vertex `gemini-3.1-flash-lite` directly — inline PDF, `response_schema`
  strict JSON, temperature 0 — as a one-shot, no-tool, schema-constrained
  provider call. It is deliberately **not** wrapped in PydanticAI's `Agent`;
  ADR 0011's `model=` seam is scoped to agentic, per-agent swapping, and
  wrapping a one-shot extraction call in `Agent` would be exactly the
  pass-through wrapper ADR 0017 §4 says to delete. ADR 0011 is still honored
  the way it actually matters: the model id is a named Settings field
  (`model_cds_extract`), never a literal.

## Relationship to earlier decisions

- **ADR 0032 is preserved, not superseded, for the read path.** The five
  reader views, the four LLM-facing tools, the packet-v8 anti-corruption
  boundary, the manifest-driven dynamic catalog, and every honesty rule in
  `docs/DATABASE_GUIDE.md` are unchanged. What ADR 0032 did not specify — who
  writes the base tables those views read — is this ADR's subject. Read this
  ADR as narrowing ADR 0032's silence, not amending its contract.
- **ADR 0012 is reversed in one specific, isolated way, and this must be
  stated plainly.** ADR 0012's decision was "Counselle uses a dedicated
  read-only DB role" and its consequences said the agent "cannot write, drop,
  or lock pipeline tables." That is no longer true of the Counselle codebase
  as a whole: it now contains a writer. It remains true of the **agent path**
  specifically — the LangGraph runtime, the four DB tools, and everything in
  `docs/DATABASE_GUIDE.md`'s fallback ladder connect only through
  `COUNSELLE_DB_RO_DSN`/`cds_library_reader` and can still not write, drop, or
  lock anything. The write capability lives entirely in `app/cds/`,
  `adapters/cds_store.py`, and `api/routes/cds_admin.py`, behind
  `current_superuser`, on a separate DSN and a separate Postgres role with no
  `DELETE` grant. The isolation that makes this reversal safe is role-level
  (`cds_library_app` vs. `cds_library_reader`), not just code-organizational —
  even a bug in `app/cds/` cannot let the agent's request path write, because
  the agent's connection pool is never given the write role's credentials.
- **ADR 0017's layering is followed, not amended.** The new subsystem adds
  `domain/cds/`, `adapters/cds_*.py`, `app/cds/`, `api/routes/cds_admin.py` —
  the same four layers, same inward-only dependency rule, same "the domain
  core holds the honesty logic" principle already applied to
  `counselle_db/packets.py`. `domain/cds/packet_build.py` and
  `manifest_compile.py` are the write side's honesty core, exactly as
  `counselle_db/packets.py` is the read side's.
- **ADR 0011 is honored, not bypassed**, per the "not PydanticAI" note above.
- **ADR 0023 (one deployable) is honored**: the poller runs in the same
  process as the agent service, not a second container.
- **The 4 pipeline ADRs in `counselle-data-pipeline/docs/adr/`** (parameterized
  SQL only; CDS never auto-collects; native-PDF and page-routed extraction)
  remain the historical record for why the ported engine is shaped the way it
  is. They are not superseded so much as inherited — their reasoning informed
  this rebuild, and the old repo is archived, not deleted, so that record
  stays reachable.

## Alternatives considered

- **Leave the pipeline as a separate repo/service, fix its extraction recall
  in place.** Rejected: it does not solve the actual problem, which was
  operational (two deployables, one drifting out of maintenance) as much as
  technical (poor recall, no review UI). Fixing recall inside the old repo
  still leaves a second app to deploy, monitor, and keep in sync with
  Counselle's auth and admin conventions.
- **Give Counselle a second, generic "admin" role with broader grants.**
  Rejected: `cds_library_app`'s existing grant shape (`INSERT, SELECT, UPDATE`,
  no `DELETE`, exactly the 8 base tables) is already the minimum the writer
  needs and was already provisioned; a broader or differently-shaped role
  would be an unforced increase in blast radius.
- **Route the extraction engine through PydanticAI's `Agent`/`model=` seam**,
  for consistency with the rest of the codebase. Rejected: extraction is a
  one-shot, schema-constrained, no-tool call — the seam that exists for
  agentic per-agent model swapping would add indirection with no behavior it
  actually needs, which ADR 0017 already forbids.
- **A Celery/RQ/Redis job queue for extraction jobs.** Rejected: Postgres
  already implements the queue, the claim index, and lease fencing that
  `cds_extractions` needs; adding infrastructure to replace something already
  built and correct is the over-engineering ADR 0023 and the house rules argue
  against.
- **Mutate packets in place for human corrections.** Not actually available —
  `cds_domain_packets` has a BEFORE UPDATE immutability trigger, verified
  firing live — so corrections had to be new rows regardless; recorded here
  because it is a real design constraint, not an incidental style choice.

## Consequences

- Counselle is no longer purely a consumer of pipeline data; it is the
  pipeline, split into a read path (unrestricted role scope, agent-facing) and
  a write path (superuser-gated, separate DSN, admin-facing). Anyone reasoning
  about "can the agent write to the database" must now ask "which path" —
  the agent's own connections still cannot, ever.
- `counselle-data-pipeline` is decommissioned as an active writer (its `app`
  and `worker` containers stopped; see `plans/cds-pipeline/CUTOVER.md`) and
  archived, not deleted — `config/cds/`'s provenance and the pipeline's own
  ADRs remain the historical record for the manifest and engine design.
- New provenance identities (`counselle-cds-v1`, `human-review-v1`) appear
  in `cds_domain_packets.extractor_version` alongside the legacy
  `gemini-native-pdf-v2/v5` and `gemini-routed-extraction-v7/v8` identities;
  `docs/DATABASE_GUIDE.md` §5 is updated to list them as currently supported,
  not just legacy-readable.
- Extraction accuracy is now visible and improvable in a way it wasn't before:
  an admin can see a `needs_review` document, inspect flagged metrics against
  the source PDF page, correct a value, and approve — where the old pipeline
  had no such surface at all.
- **Extraction accuracy is not, and is not claimed to be, complete.**
  Per-metric recall measured 65.6% on Harvard after the routing/citation and
  metric-batching fixes (up from 17.9% pre-fix), corroborated structurally on
  Cornell (13/13 domains storing a packet, same fix pattern) but not
  re-measured for recall across the wider 15-document corpus. Only
  `admissions` has an independently estimated answerable ceiling (80–98 of 152
  metrics, i.e. already close to saturated at 85 verified); `degrees` (20.9%)
  and `transfer` (41.6%) are flagged as the two domains most likely to still
  have real headroom. See `plans/cds-pipeline/routing-tuning.md` §7–§8 for the
  full evidence and honest limitations, and do not read "65.6%" as a
  corpus-wide, ceiling-normalized number — it isn't one.
- Hash-scoped incremental re-extraction (`derive_requested_domains`, ported
  from the old pipeline) is the mechanism for cheaply improving one domain's
  instructions later; a bulk "re-extract everything" button was deliberately
  not built (`rerun` re-extracts a document's full domain set, not a
  hash-scoped delta, unless the document is already active).
- The auth blast radius grows by one class of action: a compromised superuser
  account can now write pipeline data (never delete it, always audited, always
  recoverable by re-activating a prior packet) where before it could not write
  pipeline data at all. `current_superuser` gating and the write role's lack
  of `DELETE` are the mitigations, not a claim that this raises no risk.

## Migration and rollback

The cutover is additive-then-switch, not a data migration: the new engine
writes the same base tables in the same shapes behind the same views, so there
is no schema migration for `cds_library` — only a change of who does the
writing. The full operational runbook — freezing the old pipeline's writer,
rotating the still-placeholder `cds_library_app`/`postgres` passwords, parity
re-extraction of the 4 live documents before trusting the new engine,
archiving the old repo, and the verification checklist — lives in
`plans/cds-pipeline/CUTOVER.md`.

Rollback before any `Approve` action in the new admin UI is a no-op: nothing
the new engine writes is activated, so old `gemini-routed-extraction-v8`
packets keep serving students throughout the build regardless of what the new
writer does. After an `Approve`, rollback is re-activating the prior packet
set — the immutability trigger means it is still sitting in the table,
`is_active=false`, never overwritten. Restarting the old pipeline's `worker`
container against the same shared Postgres remains available as a last
resort; it was never structurally incompatible with the new writer (the
`one_live_per_slot` unique index and lease fencing prevent corruption from two
writers), only wasteful.
