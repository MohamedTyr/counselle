# Phase 3 — Field discovery (1,093 fields without overwhelm)

**Branch:** `feat/p3-field-discovery`
**Objective:** the hybrid discovery layer (ADRs 0007/0008): the static category map, the pgvector `field_index` with the self-healing reconciler, `search_fields` with the always-on keyword fallback. First phase to touch **live Vertex credentials** (embeddings).

## Inputs for builder agents
- `docs/ARCHITECTURE.md` §10; ADRs 0007, 0008.
- `docs/DATABASE_GUIDE.md` §5 (the 17 categories, counts, fill-rate tiers).
- Phase 2's `counselle_db/` (this phase extends it).

## Step 0 (orchestrator): credentials + pgvector decision
1. Read `~/Projects/ascensia-data-pipeline/.env`; mirror `GOOGLE_APPLICATION_CREDENTIALS` / project / location into Counselle's `.env`. Verify with a live embedding smoke call (`scripts/embed_smoke.py`: embed "acceptance rate", expect a vector of `embed_dimensions` floats).
2. pgvector check from Phase 2: if unavailable, present the user the image-swap decision (overview §4). If declined → set `COUNSELLE_VECTOR_SEARCH_ENABLED=false` and Slices B/C still ship (reconciler no-ops; keyword path serves everything).

## Work breakdown

### Slice A — static category map (`counselle_db/static_map.py` + generator)
- `scripts/gen_static_map.py`: queries `fields` grouped by the 17 categories (counts + per-category one-line description from DATABASE_GUIDE §5's table) + the dossier shortlist keys, and writes `config/assets/static_field_map.md` (a compact, few-hundred-token Markdown tree: category → count → notable keys). Regenerated whenever the catalog changes (the reconciler logs a reminder when it sees deltas).
- `static_map.py` exposes `load_static_map() -> str` for prompt injection (Phase 4).

### Slice B — `counselle.field_index` + reconciler (`counselle_db/reconcile.py`)
Migration `0003_field_index.sql`:
```sql
CREATE EXTENSION IF NOT EXISTS vector;          -- skipped when vector unavailable (guarded apply)
CREATE TABLE counselle.field_index (
  field_key text PRIMARY KEY,
  content_hash text NOT NULL,
  embedding vector(768),                        -- dimension from Settings; migration templated by the apply script
  embed_model_version text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```
`reconcile_field_index()` (ADR 0008, exactly):
1. Load all enabled `fields` rows; `content = f"{label} | {category} | {data_type} | {source} | {raw_column or ''}"`; `content_hash = sha256(content + embed_model_version)`.
2. Diff against `field_index` by (field_key, content_hash): embed **missing/changed** in batches of 64 via the Vertex embedding adapter (`adapters/embeddings.py`: `embed_texts(list[str]) -> list[list[float]]`, retry ×3 with backoff); upsert; delete index rows whose field_key vanished.
   **(Eng-review, search-verified):** `gemini-embedding-001` outputs **3072 dims by default and does not normalize non-3072 outputs**. The adapter MUST pass `output_dimensionality=settings.embed_dimensions` on **every** call (documents AND queries) and **L2-normalize the returned vectors itself** before storage/search — otherwise cosine distance silently degrades. Unit test: adapter output vectors have length `embed_dimensions` and L2 norm ≈ 1.0.
3. Idempotent; returns `{embedded: n, deleted: n, unchanged: n}`; logs one structured line. A changed `embed_model_version` in Settings naturally re-embeds everything (it's in the hash).
- Wire-up: runs at `counselle-db` server start (non-fatal on failure — log + continue serving with keyword fallback) and every `reconcile_interval_minutes` via an asyncio task. (The manual trigger endpoint arrives with the API in Phase 5: `POST /v1/admin/reconcile`.)

### Slice C — `search_fields` tool (`counselle_db/tools/search_fields.py`)
`search_fields(query: str, category: str | None, source: str | None, limit: int = 8) -> list[FieldHit]` where `FieldHit = {key, label, category, data_type, source, needs_decode: bool, fill_note: str | None, similarity: float | None}`:
1. **Vector path** (when enabled & index non-empty): embed the query, `ORDER BY embedding <=> $1 LIMIT $limit` (cosine), joined back to `fields` for metadata; apply category/source filters in SQL.
2. **Keyword fallback — ALWAYS unioned in** (the never-invisible guarantee): `SELECT … FROM fields WHERE key ILIKE '%'||$1||'%' OR label ILIKE '%'||$1||'%'` (+ pg_trgm `similarity(label, $1) > 0.25 ORDER BY similarity DESC` — pg_trgm exists in the pipeline DB). Merge: vector hits first, then keyword hits not already present, cap at limit.
3. `needs_decode` = (data_type=='int' AND a decode map exists for its raw column — ask the Slice-B catalog); `fill_note` from a small static dict of the DATABASE_GUIDE §5 fill-tier warnings (CDS → "only 8 schools have CDS data — have an IPEDS/Scorecard fallback"; IPEDS selectivity → "~62% fill; use Scorecard equivalent for breadth"; net-price bands → "27–53% fill").

### Slice D — tests
- Unit (mock embeddings): reconcile embeds-only-delta (run twice → second run `{embedded:0}`); deleted field removed; model-version bump re-embeds all.
- Live (`@pytest.mark.live_db`, embeddings live when enabled): after one reconcile, `search_fields("how much do graduates earn")` returns `earnings.*` keys in top 5; `search_fields("acceptance rate")` → `admissions.acceptance_rate` top 3; **fallback test**: with vector disabled (env flag), `search_fields("median_debt")` still finds `aid.median_debt_completers` via keyword; insert-visibility test: a fake row inserted into a *temp copy* is NOT testable read-only — instead assert the union logic covers catalog rows absent from field_index (delete one index row in counselle schema, search for it by exact label, found via fallback, then reconcile heals it).

## Live verification (orchestrator)
```bash
uv run python scripts/embed_smoke.py                      # real Vertex call
uv run python -c "import asyncio; from counselle_db.reconcile import reconcile_field_index as r; print(asyncio.run(r()))"
# expect {embedded: ~1093, deleted: 0, unchanged: 0} on first run; all-unchanged on second
uv run pytest -m live_db tests/counselle_db/test_search_fields.py -q
```

## Gate checklist
- [ ] Reconciler idempotent (live-verified twice) and self-healing (heal test passes).
- [ ] `search_fields` returns relevant keys for ≥5 orchestrator-chosen natural queries (spot-check by hand).
- [ ] Keyword fallback works with vectors disabled (flag flip verified).
- [ ] Static map asset generated and ≤ ~600 tokens (check with a tokenizer-ish heuristic: <2,500 chars… no — use 4 chars/token ≈ 2,400 chars budget).
- [ ] No secrets in logs (grep structured output for the key material).

## Milestone commit
```
feat(discovery): hybrid field discovery — static map, pgvector index, self-healing reconciler

search_fields = vector + always-on keyword fallback (new fields never invisible,
ADR 0008); reconciler hash-diffs the catalog and embeds only deltas.
```
