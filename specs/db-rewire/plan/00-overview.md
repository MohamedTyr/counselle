# DB Rewire implementation plan

> Status: implementation-ready draft. The canonical product/design source is
> `specs/db-rewire/design.md` revision 3. This folder is the execution plan; when the
> implementation has shipped and all exit gates pass, move the finalized folder to
> `specs/db-rewire/plan/` and update `specs/README.md`.
>
> Prepared against Counselle `50c4d0f` on `main` and the pipeline
> `652ff47` on `feat/domain-group-extraction`, plus the live Postgres instances, on
> 2026-07-15. Re-run Phase 0 preflight if either HEAD changes.

## 1. Outcome

Ship Counselle as a read-only consumer of the renamed CDS Library pipeline database,
with no runtime dependency on the retired `ascensia` data model. The shipped system
must satisfy all of the following at once:

1. Counselle reads only the five `cds_library` reader views.
2. The MCP database surface contains exactly `resolve_school`,
   `get_school_profile`, `get_domain`, and `query_database`.
3. Every CDS value passes through a strict Counselle-owned packet parser, reading
   rules, structured caveats, and document/evidence citations.
4. The system prompt receives a live, cached data picture every turn.
5. `render_viz` v2 accepts only DB references, registered external values, or an
   explicit unavailable hole; it never accepts an uncited model-authored number.
6. Current frontend messages expose real CDS/profile bibliography entries and exact
   CDS evidence, while historical v1 messages remain viewable.
7. The pipeline repo/package/database typo is corrected from `councelle` to
   `counselle` without losing its live volume.
8. Existing Counselle users, chats, checkpoints, workspace rows, and feedback move
   from PostgreSQL 17 to the pipeline's PostgreSQL 16 instance without loss.
9. The old database can be stopped and the routine, live, frontend, E2E, and eval
   gates still pass.

This is a replacement, not a compatibility bridge to the old database. Legacy support
is restricted to rendering already-persisted v1 turn records; no new request may query
or mint an old source, field key, tier, helper, or table.

## 2. How to use this plan

Every phase brief is a cold-start handoff. An executor must read, in order:

1. this overview;
2. the canonical design;
3. the named phase brief;
4. every file listed in that phase's “Read first” section;
5. the current `AGENTS.md` in each repository.

Do not implement from code snippets alone. Snippets pin contracts and algorithms; the
executor must extend the verified current symbols with the smallest coherent diff.
No phase may silently reinterpret the decisions in section 4.

The plan is split as follows:

| File | Scope |
|---|---|
| `00-overview.md` | Decisions, dependency graph, global invariants, phase protocol |
| `01-pipeline-contract.md` | Reader-view fix, extractor v8, manifest 5.0.0, context binders |
| `02-data-foundation.md` | Packet seam, catalog, four services/tools, schema/config cleanup |
| `03-citations-and-runtime.md` | Envelope v2, source registry, evidence-use ledger, prompt runtime |
| `04-render-viz-and-frontend.md` | Render v2 resolver, wire models, source rail and card behavior |
| `05-guidance-evals-docs.md` | Prompt, skills, receipts, eval rewrite, living docs and ADRs |
| `06-rename-cutover-rollback.md` | Pipeline rename, volume/database rename, PG17→PG16 migration, rollback |
| `07-verification-matrix.md` | File disposition, requirement traceability, tests and residue gates |

## 3. Dependency graph and phase order

```text
Phase 0  freeze inputs and capture baselines
   |
   v
Rename R pipeline repo/package/volume/database (06 §§7.0, 7.1, 8.1)
   |
   +--> Phase 1A pipeline reader contract (migration 0004)
   |       |
   |       +--> Phase 1B extractor v8 + manifest 5.0.0 + re-extraction
   |                    |
   +--------------------+--> Contract guide: rewrite DATABASE_GUIDE
                                  |
                                  v
                            Phase 2 Counselle data foundation
                                  |
                       +----------+----------+
                       |                     |
                       v                     v
                Phase 3 citations      Phase 4 render-viz core
                       |                     |
                       +----------+----------+
                                  v
                          Phase 5 frontend/wire
                                  |
                          Phase 6 guidance/evals/docs
                                  |
                          Phase 7 app-schema transfer rehearsal
                                  |
                          Phase 8 production cutover
                                  |
                          Phase 9 eradication/release
```

The pipeline rename lands first, as required by the canonical sequence, so migration
0004, manifest 5.0.0, all new DSNs, and all new docs use the corrected identity once.
The early rename does not move Counselle's schema or switch its DSNs; those happen only
after the later transfer rehearsal. Phases 3 and 4 may be developed in parallel only
after the v2 Python models are merged on their shared branch. Frontend work starts from
the finalized fixture-producing backend shapes, not guessed mirrors.

## 4. Closed decisions

These decisions close §17 and the repo-grounded ambiguities. Changing one requires an
explicit update to the canonical design or the new ADR, not an implementation-local
choice.

### 4.1 Product/data decisions

- Accept the loss of annual IPEDS/Scorecard breadth. The fallback is identity profile,
  then official web/search. No time-series compatibility layer is part of this rewire.
- Bulk extraction is an external, non-blocking breadth dependency. The rewire ships
  honestly against current coverage; it does not wait for nationwide extraction.
- Yearless tools select exactly one edition per school: the active document with the
  greatest `(academic_year, document_id)`. All coverage and domain reads use that same
  document. They never silently fall back to an older document for a missing domain.
  Historical documents remain queryable only through `query_database` until an
  explicit year parameter is designed later.
- “Covered” in the ambient picture means the selected document has at least one usable
  current-manifest packet. “Fully” means all current-manifest domains have accepted
  packets and none is partial. “Partial” is covered minus fully. A selected document
  with zero usable packets is reported by `resolve_school`, but is not advertised as
  covered CDS data.
- Profile groups are only object-valued top-level `basic_profile` keys. Scalar
  `id`, `name`, and `aliases` are school metadata, not group names.
- No domain, group, metric, or profile-field enumeration lives in Counselle code,
  prompt prose, tool schemas, or tests. All are loaded from the current manifest or
  profile JSON.

### 4.2 Database/operations decisions

- Rename the pipeline database to `counselle_data` and place Counselle's `counselle.*`
  schema inside that same physical database. This preserves the existing dual-DSN
  seam without adding a second server.
- Use separate LOGIN roles: `counselle_ro` is only a member of the pipeline's
  `cds_library_reader`; `counselle_app` owns only `counselle.*`. Never grant the app
  role pipeline-write membership.
- Publish Postgres only on loopback at
  `127.0.0.1:${CDS_DB_PORT:-5433}:5432`. The old local Supabase remains on 54322 during
  migration.
- The real Tailscale hostname `councelle.tailnet.ts.net` is infrastructure identity,
  not automatically a typo. Keep it unless the owner confirms the node/DNS rename.
- Delete the tracked `frontend.backup-20260705-070513/` during eradication, after the
  owner intentionally preserves or discards its ignored local `.env`.
- Keep the old volume, old PG17 schema, dumps, and rollback worktree until the owner
  approves retention cleanup after acceptance. Never delete them in the core rewire.

### 4.3 Pipeline contract decisions

- Land `migrations/0004_reader_contract.sql` before the proposed/untracked bulk work;
  future bulk migration numbering starts at 0005.
- Publish extractor contract 8 as `gemini-routed-extraction-v8` and immutable manifest
  `5.0.0`. This is a major manifest change because availability semantics and compiled
  metric metadata change.
- Runtime packet keys are already qualified. Counselle validates and preserves
  `<domain>.<metric>`; it never prefixes the key again.
- Counselle initially supports the exact live compatible packet identifiers
  `gemini-native-pdf-v2`, `gemini-native-pdf-v5`,
  `gemini-routed-extraction-v7`, and `gemini-routed-extraction-v8`. Remove an older
  identifier only after a live query proves no active packet uses it.
- Author context relationships once as domain-level `context_bindings`; the pipeline
  compiler validates local/cross-domain binder refs and target selectors, then
  materializes qualified context objects on target metrics. Counselle consumes only
  the compiled relationship.
- Reader views expose safe `latest_error_code`, never raw provider/database error
  messages. Internal diagnostics are logged server-side with no secrets or packet
  payloads.

### 4.4 Wire, citation, and state decisions

- Keep the outer SSE `Event.v` at 1. New `Citation`, `CitationEnvelope`,
  `SourceEntry`, and known tabular `RenderSpec` payloads are v2.
- Use `caveats: list[{kind,text}]`; several honesty conditions can coexist.
- Use `columns` in every new tabular input/output contract. `schools` is legacy-v1
  read-only vocabulary.
- An unavailable cell is a separate uncited state. “Tier on every cell” means every
  available cell; inventing provenance for an unavailable hole is forbidden.
- New source registries are per-answer, not cumulative across completed answers.
  Completed turn records retain their own sources. A new turn, edit, and regeneration
  start empty. Detach/reattach and a parked clarification resume preserve the current
  unfinished answer's registry, so facts gathered before the interruption remain
  usable. `[n]` always means the current answer's bibliography.
- The v2 backend vocabulary is exactly `cds|profile|web|edu|reddit`. Historical v1
  turns are parsed through opaque legacy read adapters; old literals never enter the
  current vocabulary and no migration rewrites history.
- Profile citation identity is `(school_unitid, profile_sha256)`. CDS identity is
  `(document_sha256)`. External identity is `(source,url,vintage)`.
- Store at most 50 evidence payloads per document entry, but persist the complete set
  of used `eid` fingerprints. This makes the omitted count exact without checkpointing
  all excerpts. The existing 300-character excerpt cap remains the one text cap.
- Exact prose evidence use is recorded by an internal, stripped evidence-use token
  paired with the visible document marker. This is telemetry, not a visible citation
  or UI anchor; the visible prose remains `[n]` and opens the document without
  pre-highlighting an item. Rendered cells promote their exact evidence directly.
- Plain aggregate values from the ambient data picture and raw SQL have no honest
  document marker. They are the sole system-metadata exception to the “number needs a
  marker” rule: if surfaced, they must be labelled as a live computed coverage/query
  result with its `as_of` time and denominator caveat. `query_database` is otherwise
  for candidate selection; named final values must be re-fetched through typed reads.
  Do not mint a fake CDS document citation for an aggregate.

### 4.5 Visualization decisions

- `viz_max_cells = 600`, allowing the design's 40×12 example.
- Rows/columns in defects are zero-based and also name the row/column in the reason.
- A valid DB ref whose value is unavailable is rejected with a corrective instruction
  to use `{unavailable:true}`; it never becomes a hole silently.
- A sourced cell may resolve only to `web|edu|reddit`. Allowing a CDS/profile marker
  with a model-authored display would launder an invented number through an official
  citation.
- Success acknowledgement fields are exactly `ok`, `status`, `placement_marker`,
  `cell_count`, `available_count`, `unavailable_count`, `source_count`, `sources`, and
  `public_receipt`. `cell_count` includes unavailable holes. No table values are echoed.
- Known tabular types are strict `stat_block|comparison_table`. Unknown types are
  preserved as opaque payloads and degrade safely; no generic code assumes they have
  rows or columns.

### 4.6 Guidance/compatibility decisions

- The final skill directory set is exactly `citation-and-recency`, `db-recipes`,
  `school-comparison`, and `school-deep-dive`; only comparison/deep-dive are public.
- A non-advertised loader alias maps persisted `dossier-assembly` selections to
  `school-deep-dive`, canonicalizes before duplicate/visibility checks, and persists
  the new name. No fifth stub skill remains on disk.
- The fixed data-picture slots remain exactly those in the design. Profile and CDS are
  content lines in `data_picture.md`; adding a genuinely new first-party class later
  intentionally changes that asset plus one routing rung, as §13.1 already says.
- Migration 0012 is operationally irreversible. Its rollback SQL fails loudly and
  points operators to the untouched old DB/DSN rollback; it must not recreate helper
  bodies that query retired tables.

## 5. Global invariants

Every phase and review enforces these:

- Five reader views only; all SQL schema-qualified and parameterized.
- No pipeline imports from Counselle and no Counselle imports from the pipeline.
- Immutable Pydantic/domain objects and atomic snapshot/registry replacement; never
  mutate shared state in place.
- Raw `provider_contract`, PDF bytes, extraction error messages, diagnostic codes,
  credentials, and SQL parameters never reach model output, receipts, logs, SSE, or
  frontend state.
- `query_database` accepts one SELECT/WITH statement, only the five views, positional
  `$n` parameters, a row cap, a serialized-byte cap, a statement timeout, and rejects
  returned bytea values with an instruction to select metadata such as
  `octet_length(pdf_content)` instead.
- A packet inconsistency or unsupported version fails the entire affected domain read;
  no subset of questionable values is returned.
- Only `verified + reported + typed non-null value` is available. Verified source
  absences remain unavailable and can retain evidence.
- Display text comes from source `raw_value` when present, otherwise deterministic
  type formatting. Never multiply percentage values or reuse old Scorecard rules.
- No implementation change rewrites historical specs/plans, ADR bodies, or eval
  reports. Supersession banners and indexes are allowed where explicitly named.
- No commit is made by an executor until review has found no critical/high issue and
  all phase exit gates pass.

## 6. Standard phase protocol

For every phase:

1. Record both HEADs and `git status --short`; preserve all user-owned dirty files.
2. Read the phase inputs and verify every path/symbol before editing.
3. Add/change only the named surface. If another live dependency is discovered, stop
   and add it to this plan or the phase log before touching it.
4. Run targeted tests first, then the phase exit gate.
5. Run `git diff --check`, inspect the complete diff, and run secret/residue checks
   appropriate to the phase.
6. Have a domain reviewer inspect the diff before the next dependent phase.
7. Record commands, results, counts, version identifiers, and any deliberate variance
   in `artifacts/db-rewire/<timestamp>/`; artifacts stay gitignored.

Do not chase a coverage number. Add hard tests for packet honesty, reading rules,
citation identity/evidence, all-or-nothing composition, migration/permission safety,
bug regressions, and wire drift. Agent prose behavior belongs in evals.

## 7. Baselines that must be preserved

At plan time:

- Pipeline: 2,746 profiles, 3 active documents, 39 packet rows, 2 schools with active
  documents, manifest 4.0.0, 13 domains, 1,149 metrics, database 51 MB.
- Counselle old schema: 4 users, 18 sessions, 134 checkpoints, 321 blobs, 419 writes,
  4 applications, 1 essay, 2 tasks, 2 activities, 2 memories, 64 workspace changes,
  and additional rows listed in Phase 7. `field_index` has 190 disposable rows.
- Pipeline target is PostgreSQL 16.14 and lacks available `vector` and `pg_trgm`
  extensions. Old Counselle is PostgreSQL 17.6.
- Pipeline has no Git remote. External repository rename is gated on the owner supplying
  and confirming the canonical remote.
- The pipeline test suite currently inherits a real `.env` and has a config-default
  failure when `CT_INDEX_ENABLED=true`; unit tests must construct settings with
  `_env_file=None` rather than depending on operator state.
- Counselle has a pre-existing brittle failure in
  `tests/counselle_db/test_school_columns.py`; replace that assertion as part of the
  data rewrite and do not misreport it as a rewire regression.

Phase 0 recaptures these values. Any unexplained decrease or hash mismatch blocks the
cutover.
