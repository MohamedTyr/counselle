# Phases 0 and 9 — Preflight, traceability, eradication, and release gate

## 0.1 Phase 0 preflight

Before implementation, create a local phase log under `artifacts/db-rewire/` and record:

- both repository HEADs, branches, remotes, status, ignored local files in paths to be
  deleted/moved;
- canonical design SHA and line count;
- pipeline migration head, manifest/contract/compiler/extractor identifiers;
- exact five-view columns/types/grants and reader negative permissions;
- active packet version/status/year/domain counts and profile/manifest/PDF hashes;
- Counselle routine/frontend baseline, known pre-existing failures, MCP inventory,
  route inventory, skill inventory, fixture versions;
- live Counselle retained-table counts/digests and Postgres major versions;
- Docker project/image/volume/container identities and port bindings;
- disk capacity sufficient for old volume + copied volume + dumps + build artifacts.

If either repo moved materially from the plan's recorded HEAD, re-audit every named
symbol and update this plan before editing. Preserve dirty user files; do not fold them
into implementation commits accidentally.

## 9.1 Requirement traceability

| Canonical requirement | Implementation owner | Proof |
|---|---|---|
| Five views only | Pipeline 0004, setup roles, query guard | view schema/grant + negative login tests |
| Unitid preserved | profiles/Catalog/service | live mismatch query = 0; workspace smoke |
| Dynamic profile groups | profile service | object-root tests; unknown-group live list |
| Dynamic manifest/domains/refs | pipeline compiler + Catalog | manifest publish/refresh/invalid-domain tests |
| Four DB tools | service/server/labels | independently pinned inventory + MCP smoke |
| Ambient picture | Catalog/graph/prompt asset | exact-slot, aggregate, refresh/state tests |
| Two-channel render | domain specs/app viz | all composition invariants and mixed-card E2E |
| Open viz types | parser/replay/frontend | opaque payload live/replay/export fallback tests |
| Citation source v2 | envelope/search/frontend mirror | shared fixture and source-condition tests |
| One marker/document + evidence | SourceRegistry/stripper/rail | dedupe, promotion, click-focus E2E |
| Evidence cap/exact omitted | state/wire/UI | repeated-EID/cap/round-trip test |
| Packet seam/version guard | packets.py | all versions/invariants/provider-drop tests |
| Reading rules/caveats | packets/caveat asset | exhaustive deterministic tests |
| Context-bound vintage | pipeline binder compiler + reader | compiler target tests + read fixture |
| Four final skills | disk/loader/config | inventory, alias/resume, content tests |
| Eval rewrite | questions/runner | category report + deterministic scorer tests |
| Old DB eradicated | deletions/0012/residue/old-off | catalog assertions + stopped-old full proof |
| Pipeline rename | package/Compose/DB/docs | wheel/import/DB/volume/signature gates |
| App-state migration | filtered transfer | counts/digests/FKs/checkpointer/workspace smokes |
| Rollback | protected old state/runbook | pre-open rehearsal record |

## 9.2 Counselle file disposition matrix

This matrix supplements the canonical design's incomplete blast radius. Verify each path
still exists before changing it.

### New

| Path | Exact role |
|---|---|
| `counselle_db/packets.py` | sole packet/manifest anti-corruption parsing and reading rules |
| `domain/caveats.py` or focused equivalent | strict caveat asset loader/renderer |
| `config/assets/caveats.yaml` | one home for honesty wording |
| `config/assets/prompts/data_picture.md` | fixed-slot ambient content |
| `skills/db-recipes/SKILL.md` | internal five-view SQL recipes |
| `skills/school-deep-dive/SKILL.md` | public replacement for dossier procedure |
| `tests/counselle_db/test_packets.py` | packet boundary invariants |
| `tests/counselle_db/test_reading_rules.py` | normalization/caveat/vintage truth |
| `tests/domain/test_envelope.py` | v2 source/citation/envelope rules |
| `migrations/0012_drop_old_db_objects.sql` | old helper/index tombstone |
| `migrations/0012_drop_old_db_objects.rollback.sql` | loud operational-rollback redirect |
| `docs/adr/0032-db-rewire-cds-library.md` | shipped decision/supersessions |

### Rewrite or material extension

| Area | Paths / required change |
|---|---|
| DB core | `counselle_db/catalog.py`, `models.py`, `service.py`, `server.py`, `db.py` |
| Domain wire | `domain/envelope.py`, `domain/specs.py`, `domain/events.py`, `domain/urls.py` |
| Runtime | `app/graph.py`, `state.py`, `agent_node.py`, `tool_middleware.py`, `sources.py`, `viz.py`, `viz_signature.py`, `run_turn.py`, `turns.py`, `steps.py`, `prompt.py`, `skills.py`, `toolset.py`, `deps.py`, `records.py`, `transcript.py` |
| Adapters/API | `adapters/tavily_tools.py`, `api/main.py`, `api/routes/system.py` |
| Workspace | `app/workspace/service_utils.py`, `service_reference.py` |
| Config/assets | `config/settings.py`, `.env.example`, `config/assets/step_labels.yaml`, `abbreviations.yaml`, `prompts/counselor.md`, `prompts/README.md` |
| Skills | rewrite `citation-and-recency`, `school-comparison`; replace dossier; loader/config tests |
| Scripts | `scripts/setup_db.sql`, `scripts/mcp_smoke.py` |
| Evals | `evals/questions.yaml`, `evals/runner.py`, judge/event-summary helpers/tests |
| Living docs | `README.md`, `AGENTS.md`, `TODOS.md`, `docs/DATABASE_GUIDE.md`, `ARCHITECTURE.md`, `DEPLOY.md`, ADR index/0007/0008 banners |
| Backend tests | all data service/catalog/server/live/query/guard/settings/toolset/prompt/skills/steps/sources/state/viz/run-turn/record/transcript/system/workspace/Tavily fixtures named in phase briefs |
| Protocol fixtures | generator + `tests/fixtures/protocol/*.json`; add separate legacy fixture |
| Frontend wire | `frontend/src/api/chat/types.ts`, `sse.ts` and tests |
| Frontend runtime | `citations.ts`, `turn-reducer.ts`, `step-receipts.ts`, `AiChatPage.tsx`, `CitationRenderer.tsx`, `MessageSources.tsx`, `SourcesRail.tsx`, `VizBlock.tsx`, `ChatMessage.tsx`, `ChatMessages.tsx`, `AgentRunView.tsx`, `ToolWidgets.tsx`, `remark-citation-refs.ts` and tests |

### Delete

```text
counselle_db/search_fields.py
counselle_db/reconcile.py
counselle_db/service_find.py
counselle_db/static_map.py
adapters/embeddings.py
domain/normalize.py
domain/vintage.py
domain/tiers.py
scripts/gen_static_map.py
scripts/embed_smoke.py
config/assets/static_field_map.md
config/assets/dossier_shortlist.yaml
skills/decode-coded-value/
skills/dossier-assembly/          # replaced by school-deep-dive; alias lives in code
frontend.backup-20260705-070513/  # after ignored .env owner decision
```

Delete direct tests of deleted behavior:

```text
tests/counselle_db/test_reconcile.py
tests/counselle_db/test_search_fields.py
tests/counselle_db/test_search_fields_pure.py
tests/counselle_db/test_live_find_schools.py
tests/domain/test_normalize.py
tests/domain/test_normalize_properties.py
tests/domain/test_tiers.py
tests/domain/test_vintage.py
```

Use `rg --files` before deletion to find exact current names; remove a test only when its
entire subject is deleted. Preserve useful placement/guard/workspace tests by rewriting
fixtures.

### Intentionally untouched

- API routes other than reconciler/health shape;
- graph topology `prepare -> agent -> END`;
- auth, rate limit, turn registry concepts, workspace mutation/event architecture;
- Tavily backend/gating other than citation/domain lookup construction;
- `mvp3-frontend/` (audited clean);
- historical specs/plans, ADR bodies, and eval reports;
- deferred PDF page endpoint, community card, benchmark, compare batch, big-grid UI.

## 9.3 Pipeline file disposition matrix

### New/change

- `migrations/0004_reader_contract.sql` (+ rollback if runner convention requires).
- `library/manifest.py`, `extractor.py`, provider schema/prompt/builder for contract 8,
  template absence, binder compilation.
- `config/cds/manifest.yaml` to 5.0.0 and relevant domain YAML annotations.
- reader/compiler/extractor/repository/live tests.
- Package rename in every live source/test/config/package/Compose/Docker/live-doc path
  enumerated in Phase 7.
- `uv.lock` regenerated.

### Preserve

- Roles `cds_library_owner|app|reader` names.
- CLI command `cds-library`.
- All base data/PDF/profile identities and hashes.
- Historical specs/plans including proposed bulk narrative (unless separately promoted).
- Tailnet hostname unless owner confirms infrastructure rename.

## 9.4 Test matrix by risk

### Honesty-critical deterministic backend tests

- Packet: supported IDs, strict unknowns, qualified/bare historical normalization if
  intentionally supported, double/cross-domain rejection, row/root/hash/count/status
  consistency, provider drop, input immutability, diagnostics redaction.
- Reading: all extraction+availability states, raw/type formatting, no percent scaling,
  old-manifest interpretation, every caveat combination, binder vintage, no questionable
  partial result.
- Profile: dynamic object groups, recursive refs, provenance, profile identity/caveat,
  arrays/nulls.
- Coverage: one newest document, no older fallback, current-domain counts, covered/full/
  partial/stale/by-year definitions, forced refresh.
- Source: conditional keys, exact marker grammar, per-turn reset, pending promotion,
  hidden token chunking, evidence cap/fingerprints/omitted count, immutable fork.
- Viz: strict four variants, external-only sourced channel, all defects, suggestions,
  cap before I/O, grouped reads, unavailable correction, all-or-nothing registry/stage,
  mismatch, compact ack.
- Query/security: one SELECT/WITH, five qualified views, params, row/byte caps, bytea
  rejection, statement timeout, no error leakage.
- Migration/roles: five views positive, base/write negative, app isolation, 0012 drops.

### Wire/frontend regression tests

- outer v1 + nested v2 fixture;
- current strict/legacy opaque parsers;
- null unitid and unknown viz;
- real CDS bibliography, exact evidence click, prose document click;
- tier every available cell, unavailable inert;
- no synthetic DB card, safe URL, omitted evidence, legacy no-evidence;
- reducer/signature/replay/export provenance.

### Agent evals, not brittle unit tests

- domain routing, no-packet fallback, profile limitation;
- stale/partial/template/mismatch caveat phrasing;
- mixed-card composition and no uncited named number;
- coverage denominator and aggregate as-of attribution;
- comparison latency/token trigger.

## 9.5 Full verification commands

Pipeline, from renamed repo:

```bash
uv sync --extra test
uv run pytest
uv run cds-library --help
uv build --out-dir artifacts/dist
docker compose build
```

Counselle backend:

```bash
REGEN_PROTOCOL_FIXTURES=1 uv run pytest tests/app/test_protocol_fixtures.py
uv run pytest tests/app/test_protocol_fixtures.py
uv run pytest -m "not live_llm and not live_search and not live_db"
uv run pytest -m live_db
uv run ruff check .
uv run mypy .
uv run bandit -r api app adapters counselle_db domain
```

Frontend:

```bash
cd frontend
npm ci
npm run typecheck
npm test
npm run lint
npm run build
```

Full/live:

```bash
uv run pytest
uv run python -m evals.runner
```

Run the final backend/full/eval/E2E pass with the old PG17 database stopped. Capture
cost, skips, failures, and live DB identifiers without secrets. A conditional live
template-absence skip is acceptable only if deterministic contract tests pass and the
DB truthfully contains no such packet; it must be visible in the report.

## 9.6 Residue gate

A whole-history zero grep is impossible and would encourage corrupting immutable
migration/decision history. Define live roots and exclusions explicitly.

### Historical exclusions

- `specs/**`
- `plans/archive/**` and this execution plan's before/after discussion
- historical ADR bodies (except current index/banners/new ADR)
- `evals/report-*.json`
- applied migrations `0001`–`0011` and their rollbacks
- the dedicated legacy-v1 compatibility fixture/adapter tests, whose old vocabulary is
  opaque or explicitly annotated.

### Live-root forbidden concepts

Run literal-aware `rg` over live Python/TS/assets/scripts/current docs/tests for:

```text
ascensia
field_values
raw.ipeds_
raw.files
decode_ipeds
value_vintage
public.fields
FROM schools
coverage_tier
cds_pdf_only
cds_extracted
CoverageTier
_DERIVED_FILTERS
SOURCE_PREFERENCE
institution.website
reconcile_field_index
counselle.field_index
reconcile_interval_minutes
embed_dimensions
vector_search_enabled
field_key / field_keys as tool or wire keys
old DB tool names
decode-coded-value / dossier-assembly as advertised skill names
ipeds / scorecard as current source string literals
```

Allow only narrowly annotated compatibility alias/parser lines. Review every hit; do
not blanket-exclude all tests or docs. Include `README.md`, prompt/skill docs,
`domain/events/specs/urls` comments, frontend `sse.ts`, Tavily, scripts, and config.

Pipeline live roots must have no misspelled package/repo/database/image/volume identity.
The preserved tailnet hostname is an explicit allowed infrastructure hit. Historical
plans/specs are excluded.

### Live database eradication assertions

Text greps do not prove applied state. Require:

```sql
SELECT
  to_regprocedure('counselle.decode_ipeds(text,text,text)') IS NULL AS no_decode,
  to_regprocedure('counselle.value_vintage(integer,text)') IS NULL AS no_vintage,
  to_regclass('counselle.field_index') IS NULL AS no_field_index;
```

Also prove:

- runtime RO can see exactly five reader views and no base tables;
- no reconciler task/route/health key exists;
- MCP returns exactly four DB tools;
- current SourceName/skill inventories are exact;
- old database process/container is stopped.

## 9.7 Security and failure review

Before release, review:

- no secrets in git diff, artifacts listing, command history, logs, or URLs;
- role dump and transfer files mode 0600, artifact directory 0700;
- login roles least privilege and no PUBLIC leakage;
- SQL relation/placeholder/byte limits and PDF-content denial;
- unsafe external/source URLs fail closed;
- provider/error/diagnostic/prompt excerpts not leaked;
- evidence excerpts capped and escaped in UI;
- hidden evidence tokens cannot inject markup or survive stream;
- app/citation/state inputs immutable and no partial render mutation;
- external model input never supplies user_id/authz, DB citation metadata, or official
  school domain for a DB identity.

Any critical/high issue blocks release and is fixed/re-reviewed. Medium issues are fixed
if they affect data honesty, loss, authz, secrets, or rollback; otherwise record a
specific owner/follow-up rather than growing speculative machinery.

## 9.8 Final release checklist

- [ ] Phase 1 reader/extractor/manifest changes published and current packets processed.
- [ ] Phase 2 four-tool data layer and 0012 pass.
- [ ] Phase 3 per-turn citations/evidence/data picture pass.
- [ ] Phases 4–5 mixed viz and evidence UI pass current + legacy flows.
- [ ] Phase 6 prompt/skills/evals/living docs pass.
- [ ] Pipeline package/DB/volume rename signatures match.
- [ ] Counselle retained state parity and role permissions match.
- [ ] Full verification passes with old DB stopped.
- [ ] Residue/database assertions clean.
- [ ] Independent spec, data-honesty, wire/frontend, security, and operations reviews
      have no unresolved critical/high finding.
- [ ] Pre-traffic rollback was rehearsed; post-traffic rollback boundary acknowledged.
- [ ] Owner signs cutover evidence and reopens traffic.
- [ ] Final plan is moved from `plans/db-rewire/` to `specs/db-rewire/plan/`,
      `specs/README.md` updated, and historical design left intact.

Fast follows remain out of the release gate: PDF page endpoint/deep links, bulk
extraction, `compare_schools` batch convenience unless evals prove pain, national
benchmark, big-grid UI, community card, fresh B6 deployment baseline, and old-backup
retention cleanup.

