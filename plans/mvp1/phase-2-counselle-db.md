# Phase 2 — The `counselle-db` MCP server

**Branch:** `feat/p2-counselle-db`
**Objective:** the standalone MCP server (ADRs 0004/0005/0012): roles + grants, the counselle schema + migrations, the 9 tools returning citation envelopes, the data calendar, decode caching — integration-tested against the **live pipeline database**.

## Inputs for builder agents
- `docs/DATABASE_GUIDE.md` — §2, §3, §4, §8, §9, §10, §11, §14 (the SQL recipes are the implementations), §13 (gotchas).
- `docs/ARCHITECTURE.md` §8.
- Phase 1's `domain/` (normalize, vintage, tiers).

## Step 0 (orchestrator, interactive — NOT an agent): roles & schema bootstrap

Write `scripts/setup_db.sql`, show it to the user, then run it once via the pipeline's psql (admin):

```sql
-- Roles (passwords substituted at run time; store the chosen ones in .env)
CREATE ROLE counselle_ro LOGIN PASSWORD :'ro_pw';
CREATE ROLE counselle_app LOGIN PASSWORD :'app_pw';
ALTER ROLE counselle_ro SET default_transaction_read_only = on;
ALTER ROLE counselle_ro SET statement_timeout = '8s';
-- Read grants (DATABASE_GUIDE §3/§8: public read model + the multi-row & dict & provenance raw tables)
GRANT USAGE ON SCHEMA public, raw TO counselle_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO counselle_ro;
GRANT SELECT ON raw.scorecard_fos, raw.ipeds_ef2024a, raw.ipeds_valuesets24,
               raw.ipeds_vartable24, raw.files, raw.ipeds_hd2024, raw.ipeds_flags2024 TO counselle_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO counselle_ro;
-- Counselle's own schema (ADR 0019)
CREATE SCHEMA counselle AUTHORIZATION counselle_app;
GRANT USAGE ON SCHEMA counselle TO counselle_ro;
-- pgvector availability check (informational)
SELECT count(*) AS pgvector_available FROM pg_available_extensions WHERE name = 'vector';
```
Then fill `.env`: `COUNSELLE_DB_RO_DSN=postgresql://counselle_ro:<pw>@localhost:5432/ascensia`, `COUNSELLE_DB_APP_DSN=postgresql://counselle_app:<pw>@localhost:5432/ascensia`. Record the pgvector answer for Phase 3.

## Work breakdown

### Slice A — migrations + helper SQL (`migrations/`)
`uv add yoyo-migrations` (dev: none). Migration `0001_sessions.sql` (apply with `COUNSELLE_DB_APP_DSN`):
```sql
CREATE TABLE counselle.sessions (
  session_id uuid PRIMARY KEY,
  user_id uuid NULL,                       -- platform phase fills this (ADR 0019)
  title text NULL,
  source_config jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON counselle.sessions (user_id) WHERE user_id IS NOT NULL;
```
Migration `0002_helpers.sql` — the escape-hatch helper functions (ARCHITECTURE §8 L3):
```sql
CREATE FUNCTION counselle.decode_ipeds(p_table text, p_column text, p_code text)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT "ValueLabel" FROM raw.ipeds_valuesets24
  WHERE lower("TableName") = lower(replace(p_table,'raw.ipeds_','')) -- valuesets store bare table names; VERIFY against live data and adjust
    AND lower("VarName") = lower(p_column) AND "Codevalue" = p_code LIMIT 1 $$;
CREATE FUNCTION counselle.value_vintage(p_unitid int, p_field_key text)
RETURNS TABLE(source text, cycle_year int, file_name text, db_loaded_at timestamptz)
LANGUAGE sql STABLE AS $$
  SELECT fv.source, fv.cycle_year, rf.filename, rf.downloaded_at
  FROM field_values fv JOIN raw.files rf ON rf.id = fv.raw_file_id
  WHERE fv.unitid = p_unitid AND fv.field_key = p_field_key $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA counselle TO counselle_ro;
```
(The builder agent MUST verify the valuesets `TableName` casing/format against the live table with a query before finalizing `decode_ipeds` — the guide warns the decode table name can differ from the field's display table.)

### Slice B — DB access layer (`counselle_db/db.py`, `counselle_db/catalog.py`, `counselle_db/service.py`)

**(Eng-review D2) The service layer is the real API; the MCP server is a thin shell over it.** All tool logic below lives in `counselle_db/service.py` as plain async Python functions returning domain types (envelopes, dossiers, calendar entries). The MCP server (Slice C) wraps each service function in a ~3-line tool definition. The agent service (`app/` — Phase 4) **imports the service directly** for its own needs (`render_viz`, the data calendar, tier checks) — our own code never round-trips through the MCP child process. One choke point (`envelope_for`) serves both paths.
- `db.py`: asyncpg pool factory on `COUNSELLE_DB_RO_DSN` (pool sizes from Settings); jsonb codec so values arrive as Python objects; one `fetch(sql, *args)` helper.
- `catalog.py` (loaded once at server start, refreshed hourly):
  - `fields_by_key: dict[str, FieldMeta]` from `SELECT key,label,category,data_type,source,raw_table,raw_column FROM fields WHERE enabled`.
  - `decode_maps: dict[(raw_table, raw_column), dict[str,str]]` — lazily fetched per coded column from `raw.ipeds_valuesets24`, cached forever (codes are static; R1). Scorecard hardcoded maps from DATABASE_GUIDE §8 (PREDDEG/HIGHDEG/CONTROL/MAIN) live here as constants.
  - `data_calendar() -> list[CalendarEntry(source, vintage, cutoff_note)]` derived live (ARCHITECTURE §8): IPEDS from the `.accdb` row in `raw.files`; Scorecard from the zip filename (reuse `domain.vintage`); CDS from `settings.current_cycle_year` (the pipeline `settings` table) + count of cds-extracted schools.
- `envelope_for(unitid, meta: FieldMeta, value, cycle_year) -> CitationEnvelope` — glues `domain.normalize` + `domain.vintage` + the catalog's decode maps. **All tools below produce envelopes ONLY through this function** (one choke point = the honesty guarantee).

### Slice C — the MCP server + Layer-2 tools (`counselle_db/server.py`, `counselle_db/tools/*.py`)
FastMCP server (`mcp` SDK, stdio). Tool signatures and exact behavior:

1. `resolve_school(query: str) -> {match | candidates | not_found}`
   - Try int(query) → unitid lookup. Else expand via `abbreviations.yaml`, then `SELECT unitid,name,city,state,control FROM schools WHERE name ILIKE '%'||$1||'%' ORDER BY name LIMIT 10`.
   - 1 hit → `match` with basics + `coverage_tier` (Slice B query: `SELECT count(*) FROM field_values WHERE unitid=$1 AND source='cds' AND value IS NOT NULL` + `EXISTS(SELECT 1 FROM cds_files WHERE unitid=$1)` → `domain.tiers.compute_tier`).
   - multi-campus → return candidates with the no-suffix/main-campus row first (DATABASE_GUIDE §11) and a `hint` telling the agent to ask the student if genuinely ambiguous.
   - 0 hits → `not_found` with the graceful-response instruction text (PRD: "not in our database — we cover ~2,746 curated 4-year US institutions").
2. `get_values(unitid: int, field_keys: list[str]) -> list[CitationEnvelope]` — DATABASE_GUIDE §14.1 SQL (`key = ANY($2)`); **unknown keys → per-key error entries, never invented rows** (ADR 0014); keys present in catalog but row-missing → envelope with `available=False`. Scorecard keys query `cycle_year IS NULL`.
3. `get_dossier(unitid: int, sections: list[str] | None) -> {school, tier, sections: {A..F: [envelopes]}, programs_preview, diversity}` — drives off `dossier_shortlist.yaml`; sections default all; internally calls get_values batched + get_programs(top 10 by completions, credlev=3) + get_diversity.
   **(Eng-review, COA sibling trap — DATABASE_GUIDE §13.7):** section B treats `cost.room_and_board` and its post-restructure sibling (`cost.on_campus_room_board_other`) as a fallback pair — emit whichever is populated (prefer `room_and_board`), only "not available" when both are NULL. The pair is declared in `dossier_shortlist.yaml` (`fallback:` key on the entry). **Test:** the builder agent finds a live school where `room_and_board` IS NULL but the sibling has a value (one SQL query) and pins it as a live_db test.
4. `compare_schools(unitids: list[int], field_keys: list[str]) -> {schools, rows: [{field, label, cells: [envelope-per-school]}]}` — §14.2 pattern with `unitid = ANY($1)`; missing cell → available=False envelope. Max 6 schools, 25 fields (constants in Settings? No — tool-arg validation constants, fixed: they're protocol sanity caps, document inline).
5. `find_schools(criteria) -> ranked list` — criteria model: `state?, control? (public|private_nonprofit|private_forprofit), max_admit_rate?, min_admit_rate?, min_sat_avg?, max_net_price?, field_filters?: [{field_key, op: lt|lte|gt|gte|eq, value: float}], order_by?: {field_key, dir}, limit (default 20, max 50)`. Build SQL like §14.3 with one JOIN per filter on `field_values` (numeric cast), always `value IS NOT NULL`, percent filters documented as fractions. Returns school basics + the filtered values as envelopes.
   **(Eng-review D5) Safe-construction recipe — MANDATORY:** (a) every `field_key` (filters AND order_by) is validated against the in-memory catalog (`fields_by_key`) BEFORE any SQL string is assembled — unknown key → tool error, no SQL; (b) field keys are still bound as **parameters** in `fv.field_key = $n` predicates — never interpolated; (c) JOIN aliases are generated internally (`f0`, `f1`, …) — never derived from input; (d) `op` maps through a fixed dict to `<,<=,>,>=,=`; (e) `dir` ∈ {`ASC`,`DESC`} via dict lookup, anything else → error; (f) `limit` clamped server-side. **Adversarial tests (required):** quoted/injected field_key (`"x'; DROP--"`) → rejected pre-SQL; bogus `dir` ("ASC; DELETE") → rejected; 1,000 filters → rejected by a max-filters cap (8); valid filters produce SQL containing only generated aliases (assert via string inspection).
6. `national_benchmark(field_key: str) -> {median, mean, p25, p75, n}` — §14.4 percentile query, values normalized for display via the engine.
7. `get_programs(unitid: int, cip_prefix: str | None, credlev: int = 3) -> rows` — `raw.scorecard_fos` per §8: cipcode/cipdesc/credlev/completions/debt_median/earnings_1yr/4yr/5yr; suppressed → null preserved; each row stamped with the Scorecard citation; CREDLEV decode map applied.
8. `get_diversity(unitid: int) -> breakdown` — `raw.ipeds_ef2024a` with `EFALEVEL='2'` (undergrad total) per §8: total/men/women + 9 race groups; negative sentinels → null; IPEDS 2024-25 citation.
9. `query_database(sql: str, params: list) -> {columns, rows, row_count, truncated}` — Layer 3. Guards: strip + reject unless first keyword is `SELECT` or `WITH`; reject `;` beyond a trailing one; wrap as `SELECT * FROM (<sql>) q LIMIT {row_cap}`; rely on `counselle_ro` (read-only txn + 8s timeout) as the real enforcement. Tool description (the agent-facing contract) states: raw rows bypass normalization; reading rules still apply; prefer `counselle.decode_ipeds`/`counselle.value_vintage`; percent values are 0–1 fractions.

Also `get_data_calendar() -> CalendarEntry[]` exposed as a 10th read-only tool (the runtime injects it as context, but exposing it keeps the server self-contained).

### Slice D — live integration tests (`tests/counselle_db/`, marker `@pytest.mark.live_db`)
Stable facts from DATABASE_GUIDE (assert these exactly):
- `resolve_school("Duke")` → unitid **198419**, tier `cds_extracted`; `resolve_school("MIT")` → resolves via abbreviation to Massachusetts Institute of Technology; `resolve_school("Stanford")` → tier `cds_pdf_only` (the Stanford trap); `resolve_school("Hogwarts")` → not_found.
- `get_values(198419, ["admissions.acceptance_rate"])` → 1 envelope, unit percent, display endswith "%", citation.source == "scorecard", vintage contains "Scorecard"; raw between 0 and 1.
- `get_values(198419, ["institution.website"])` → display startswith "https://".
- `get_values(198419, ["bogus.key"])` → error entry, no envelope.
- `compare_schools([198419, 166027], ["admissions.acceptance_rate","cost.tuition_in_state"])` → 2×2 cells, every present cell cited.
- `get_dossier(198419)` → sections A–F present; section A contains a CDS-sourced envelope (Duke has 218 extracted fields).
- `find_schools(state="CA", control="public", max_admit_rate=0.30)` → >0 rows, all CA, every admit_rate raw < 0.30.
- `get_programs(198419)` → >0 rows, all credlev 3.
- `get_diversity(198419)` → total == men+women ± reporting categories sanity (just assert total > 0 and 9 race groups).
- `query_database("DELETE FROM schools", [])` → rejected; `query_database("SELECT count(*) FROM schools", [])` → 2746 (re-verify against live DB at build; if the pipeline re-ingested, update the expected count from a `COUNT(*)` run first).
- `get_data_calendar()` → 3 entries; scorecard entry contains "Mar 2026".

## Live verification (orchestrator)
```bash
uv run pytest -m live_db -q            # against the real DB
uv run python -m counselle_db.server & # boots; then list tools over MCP stdio with a 5-line client script (scripts/mcp_smoke.py)
```

## Gate checklist
- [ ] Setup script run; both DSNs in `.env`; `counselle_ro` verifiably cannot write (test: an UPDATE through the ro pool raises).
- [ ] All 10 tools implemented; every value path goes through `envelope_for` (grep: no tool builds a `CitationEnvelope(` directly).
- [ ] All live_db tests pass against the real database.
- [ ] Reviewers (incl. security-reviewer on Slice C/Layer 3) pass clean.
- [ ] pgvector availability recorded for Phase 3.

## Milestone commit
```
feat(counselle-db): MCP server — roles, migrations, 10 envelope-emitting tools, data calendar

Three-layer access per ADR 0004/0005; read-only counselle_ro enforcement per
ADR 0012; live-DB integration suite (Duke/Stanford/MIT resolution, envelope
correctness, escape-hatch guards).
```
