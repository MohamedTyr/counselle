# Fix plan — `search_fields` tool failure & degradation-path hardening

**Proposed branch:** `fix/search-fields-resilience`
**Tier:** Standard (multi-file, new behavior, DB + MCP server + tests)
**Trigger incident:** "compare MIT and Harvard financial aid" turn died with the generic
`Something went wrong on our side — please try that again.` (trace_id `8d840b94-ca60-4119-ae45-5ef514b5684b`).

---

## 1. Problem statement

A single agent tool call (`search_fields`) failed hard and killed the whole turn. The
investigation (2026-07-08, backend log + live DB probes) found **one environment drift
and three code defects stacked on top of each other**. Every layer that was designed to
degrade gracefully instead escalated:

```
pgvector .so missing            → vector path fails (degrades correctly, per ADR 0007)
pg_trgm not installed           → "always-on" keyword fallback ALSO throws        (Bug B)
tool_errors returns D6 dict     → violates FastMCP output schema for list tools   (Bug A)
schema violation → ToolError    → pydantic_ai ModelRetry, model retries once
retry hits identical failure    → max_retries=1 exceeded → UnexpectedModelBehavior
run_turn catch-all              → whole turn dies with the generic user error     (Bug C)
```

### Verified evidence

| Fact | How verified |
|---|---|
| App DB is `ascensia` on `ascensia-data-pipeline-db-1` (`postgres:16-alpine`, port 5432) | `.env` DSNs + `docker ps` |
| `pg_trgm` **available (1.6) but not installed** | `pg_available_extensions`: `installed_version` empty; `SELECT similarity('a','b')` → `UndefinedFunctionError` |
| `vector` extension **row exists in `pg_extension` but the `.so` is gone** | `SELECT '[1,2]'::vector` → `could not access file "$libdir/vector"`. `postgres:16-alpine` does not ship pgvector; the volume outlived a pgvector-capable image |
| DB *used to* have pg_trgm | `tests/counselle_db/test_search_fields.py` docstring: "pg_trgm is installed in the pipeline DB (verified 2026-06-10)" — the DB was re-provisioned since |
| Bug A failure text | log: `ToolError: Error executing tool search_fields: 1 validation error for discover_fieldsOutput — Input should be a valid list [input_value={'error': 'tool_error', ...}]` |
| Turn-kill path | log: `UnexpectedModelBehavior: Tool 'search_fields' exceeded max retries count of 1` → `run_turn` yields `_USER_SAFE_ERROR` (`app/run_turn.py:74`) |
| Same pg_trgm dependency 500s the workspace API | log traceback: `GET /v1/schools/search` → `counselle_db/service.py:317` (`_FUZZY_SEARCH_SQL`) → `UndefinedFunctionError` |

### Root causes

- **Environment (trigger):** the pipeline DB container lost both extensions. Owned by
  `~/Projects/ascensia-data-pipeline` (compose `image: postgres:16-alpine`), *not* this repo.
- **Bug A (defect, HIGH):** `tool_errors` in `counselle_db/server.py:103` returns the D6
  error dict for *every* tool, but FastMCP derives an output schema from each tool's
  return annotation and validates results server-side. Five tools are annotated
  `-> list[dict[str, Any]]` (`get_values`, `find_schools`, `get_programs`,
  `get_data_calendar`, `discover_fields` — registered as `search_fields`), so for them
  the D6 envelope **can never be delivered**: it always becomes a hard `ToolError`.
  The D6 design ("guidance reaches the model as data; model self-corrects without
  burning retries") has silently never worked for list-returning tools.
  Existing tests (`tests/counselle_db/test_server.py`) only exercise the decorator in
  isolation — never through FastMCP validation — which is why this shipped.
- **Bug B (defect, HIGH):** ADR 0007 declares keyword/trigram the "always-on fail-safe
  layer", but `_keyword_rows` (`counselle_db/search_fields.py:152`) hard-depends on
  pg_trgm's `similarity()`. A fail-safe with an unverified runtime dependency is not a
  fail-safe. Same dependency in `counselle_db/service.py` `_FUZZY_SEARCH_SQL` (used by
  `resolve_school`'s fuzzy fallback and `search_school_names` → `/v1/schools/search`).
- **Bug C (resilience gap, MEDIUM):** one doubly-failing tool aborts the entire turn.
  pydantic_ai's default tool `max_retries=1` (nothing in `app/` overrides it) plus the
  broad catch in `run_turn` means the user gets the generic error and loses the turn.

### Non-goals

- No redesign of the D6 envelope shape or the reading rules (ADR 0006) — only make the
  existing shape actually deliverable.
- No change to vector search behavior/ranking (ADR 0007/0008 stand).
- No frontend changes — the SSE error path already renders correctly.
- No ownership move of the pipeline DB; the compose image change is a separate,
  one-line PR in `ascensia-data-pipeline`.

---

## 2. Ordered task list

### Phase 0 — Environment repair (do first; unblocks manual testing; no code)

- [ ] **0.1** Install pg_trgm in the live DB (trusted extension, no superuser needed on PG13+):
  `docker exec ascensia-data-pipeline-db-1 psql -U ascensia -d ascensia -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"`
  Verify: `SELECT similarity('mit','mit') = 1`.
- [ ] **0.2** Restore pgvector — **separate repo** (`~/Projects/ascensia-data-pipeline`):
  change `docker-compose.yml` `image: postgres:16-alpine` → `image: pgvector/pgvector:pg16`
  (drop-in; same data volume, same major version). Recreate the container.
  Verify: `SELECT '[1,2]'::vector;` succeeds and `field_index reconcile` stops logging
  `UndefinedFileError` on backend startup.
- [ ] **0.3** Interim toggle if 0.2 is deferred: set `COUNSELLE_VECTOR_SEARCH_ENABLED=false`
  (`config/settings.py:111`) so the vector path is skipped cleanly instead of
  warn-logging every call. Revert when 0.2 lands.
- [ ] **0.4** Re-run the failing scenario end-to-end (MIT vs Harvard aid question) to
  confirm the incident no longer reproduces — this proves the trigger, then the code
  phases below remove the fragility.

### Phase 1 — Prevent recurrence of the drift (this repo)

*Dependencies: none (parallel with Phase 0.2).*

- [ ] **1.1** New yoyo migration `migrations/0009_pg_trgm.sql`:
  `CREATE EXTENSION IF NOT EXISTS pg_trgm;` + rollback file (no-op comment — never drop
  a shared extension on rollback; match the 0003 pgvector precedent and its comment style).
- [ ] **1.2** Startup capability preflight in the MCP server lifespan
  (`counselle_db/server.py::_lifespan`): probe once for pg_trgm and pgvector usability
  (`SELECT similarity('a','a')`, `SELECT '[1]'::vector` under try/except). Store the two
  booleans on the app state / `Catalog`; structured **error-level** log with exact
  remediation text when either is missing (the current failure was a `warning` that
  scrolled past). This is the fail-loud half; Phase 3 is the degrade-gracefully half.
- [ ] **1.3** README prerequisites: add pg_trgm next to the existing pgvector bullet
  (README line ~34) and to the `setup_db.sql` flow. Keep docs version-agnostic
  (no MVP/phase labels).

### Phase 2 — Bug A: make the D6 envelope schema-valid (this repo)

*Dependencies: none. This is the defect that turned degradation into an outage.*

- [ ] **2.1** Change the return annotations of the five list-returning tools in
  `counselle_db/server.py` to `list[dict[str, Any]] | dict[str, Any]`
  (`resolve_school`-style dict tools already pass validation; `get_diversity`'s
  `dict | None` also passes). FastMCP will emit an `anyOf` output schema; the D6 dict
  then validates and reaches the model as a normal tool result — the original intent.
  - *Alternative considered:* `@mcp.tool(output_schema=None)` — rejected: loses the
    success-shape schema for clients. *Alternative:* raise `ToolError` with D6 text —
    rejected: becomes `ModelRetry`, burns the retry budget, and is exactly the path
    that killed this turn.
- [ ] **2.2** Docstring note on `tool_errors`: the decorator's contract requires every
  wrapped tool's return annotation to admit `dict[str, Any]` (one sentence, so the
  next list-returning tool doesn't regress this).
- [ ] **2.3** Regression test that goes **through FastMCP**, not around it
  (`tests/counselle_db/test_server.py`): using fastmcp's in-memory `Client(mcp)`,
  parametrized over **all registered tools**, monkeypatch the underlying service call
  to raise, call the tool, and assert the result is the D6 dict as data — no
  `ToolError`. This test fails on current `main` for the five list tools (RED first).

### Phase 3 — Bug B: make the fail-safe honest (this repo)

*Dependencies: 1.2 (capability flags).*

- [ ] **3.1** `counselle_db/search_fields.py::_keyword_rows`: when the pg_trgm
  capability flag is false, use a trigram-free variant of the SQL
  (key/label ILIKE only, `ORDER BY label`) instead of `similarity()`. Belt-and-braces:
  also catch `asyncpg.UndefinedFunctionError` from the trigram variant and retry once
  with the plain variant (covers an extension dropped after startup), logging at
  warning with remediation.
- [ ] **3.2** `counselle_db/service.py`: gate `_FUZZY_SEARCH_SQL` behind the same
  capability flag in both call sites (`resolve_school` fuzzy fallback,
  `search_school_names`). Degraded behavior: skip the fuzzy pass, return the ILIKE
  results (possibly empty candidates) — a worse answer, never a 500. Note the honesty
  carve-out comment (service.py:97): without trigram we may falsely say "not found"
  for punctuation variants — acceptable degraded mode, logged.
- [ ] **3.3** Module docstring updates in `search_fields.py` (lines 1–11) so the
  "ALWAYS unioned in" claim states the trigram→ILIKE degradation.
- [ ] **3.4** Tests:
  - Pure: SQL-variant selection for both capability states (`test_search_fields_pure.py`).
  - Unit: pool stub raising `UndefinedFunctionError` on the trigram SQL → plain-SQL
    retry serves rows; `search_fields(use_vector=False)` returns hits end-to-end.
  - Unit (API): `search_school_names` with capability off returns ILIKE-only results;
    `/v1/schools/search` route test asserting 200, not 500, when fuzzy is unavailable.
  - Live (`@pytest.mark.live_db`): drop the stale "verified 2026-06-10" docstring claim;
    assert the preflight capability flags are true against the provisioned DB (turns
    future env drift into a named test failure instead of a mid-conversation outage).

### Phase 4 — Bug C: one bad tool must not kill the turn (this repo, scoped small)

*Dependencies: Phase 2 (which already removes most of the pressure: schema-valid
envelopes never enter the retry machinery).*

- [ ] **4.1** Raise the tool retry budget from the default 1 to 2 where the agent is
  constructed (pydantic_ai `Agent(retries=...)` / toolset setting in `app/agent_node.py`
  or `app/toolset.py` — confirm exact seam in pydantic_ai 1.107 at implementation time).
- [ ] **4.2** In `app/run_turn.py`, catch `pydantic_ai.exceptions.UnexpectedModelBehavior`
  distinctly from the generic catch-all: log it with the tool name at error level
  (today it's only visible as a raw traceback) before yielding the same
  `_USER_SAFE_ERROR`. No user-visible copy change — observability only.

### Phase 5 — Verification gate

- [ ] **5.1** `uv run pytest tests/counselle_db tests/app tests/api` green; live_db
  markers against the repaired DB.
- [ ] **5.2** Lint/type: `ruff check`, `mypy` clean on touched files.
- [ ] **5.3** E2E repro: the exact incident prompt ("compare MIT and Harvard in terms of
  financial aid") through the UI — `search_fields` returns hits, no turn error. Also
  repeat with pg_trgm deliberately dropped in a scratch DB to watch the degraded-but-
  alive path (tool succeeds ILIKE-only, loud startup log).
- [ ] **5.4** Confirm backend startup log shows the preflight result and no
  `field_index reconcile failed`.

---

## 3. Behavior list (numbered, testable)

1. A tool wrapped by `tool_errors` whose body raises returns the D6 error dict **through
   a FastMCP client** for every registered tool, including list-returning ones — never a
   `ToolError`. *(Bug A — the incident's proximate cause.)*
2. `search_fields` with pg_trgm unavailable returns keyword hits via ILIKE-only SQL
   (no exception, hits have `similarity=None`), and logs one warning.
3. `search_fields` with pgvector unavailable and pg_trgm available serves keyword-only
   results (existing behavior, now covered by an explicit test).
4. `search_fields` with **both** extensions unavailable still returns ILIKE hits —
   the exact incident scenario ends in a useful tool result.
5. MCP server startup logs an error-level, remediation-bearing message when pg_trgm or
   pgvector is unusable, and records capability flags.
6. `search_school_names` (and `GET /v1/schools/search`) returns 200 with ILIKE-only
   results when pg_trgm is unavailable — never 500.
7. `resolve_school` with pg_trgm unavailable skips the fuzzy pass and returns
   ILIKE-based match/candidates/not_found without raising.
8. Migration `0009_pg_trgm` is idempotent (`IF NOT EXISTS`) and applies on a DB where
   pg_trgm is already installed.
9. A tool that fails twice no longer ends the turn on the *first* retry
   (retry budget = 2), and `UnexpectedModelBehavior` is logged with the tool name.
10. Live-DB guard test fails with a clear message if either extension goes missing again.

---

## 4. Risk register

1. **Union output schema (`anyOf`) confuses a strict MCP client.** Low: the only
   consumer is pydantic_ai in this repo (`app/toolset.py`), which parses content, not
   schema. Mitigated by behavior test 1 running through the real client class.
2. **ILIKE-only degraded mode silently worsens school resolution** (punctuation/word-order
   variants missed → false "not in database"). Accepted as degraded mode; mitigated by
   the loud startup error (1.2) and the live guard test (3.4) making the state
   short-lived, plus a log line whenever the degraded SQL variant serves.
3. **`pgvector/pgvector:pg16` image swap corrupts the pipeline volume.** Very low (same
   PG major, official image); mitigated by doing 0.1 first (keyword path is enough for
   the app to function) and snapshotting the volume before recreate. Owned by the
   other repo's PR.
4. **Retry budget increase (4.1) doubles latency on genuinely broken tools.** Low
   impact: retries are per-tool per-turn; Phase 2 removes the biggest source of
   retry-triggering errors. Keep at 2, not higher.
5. **Capability probe at startup races a DB that boots after the MCP server.** The
   probe runs in `_lifespan` per process start; if the DB was down, flags could stick
   false. Mitigation: 3.1's belt-and-braces exception path re-tries the trigram variant
   opportunistically... keep the flag as "last probe result" and re-probe on
   `UndefinedFunctionError` recovery. Verify seam during implementation.
6. **Hidden additional pg_trgm/vector call sites.** Grep confirmed consumers are only
   `counselle_db/{server,service,search_fields}.py` (plus migrations); re-grep at
   implementation time (`similarity(|word_similarity(|::vector`).

---

## 5. File change manifest

**This repo (`counselle`), branch `fix/search-fields-resilience`:**

| File | Change |
|---|---|
| `migrations/0009_pg_trgm.sql` (+ `.rollback.sql`) | new — `CREATE EXTENSION IF NOT EXISTS pg_trgm` |
| `counselle_db/server.py` | union return annotations on 5 list tools; `tool_errors` contract docstring; lifespan capability preflight |
| `counselle_db/search_fields.py` | trigram-free keyword SQL variant + selection/fallback logic; module docstring |
| `counselle_db/service.py` | capability-gated fuzzy pass in `resolve_school` path + `search_school_names` |
| `counselle_db/catalog.py` (or app-state equivalent) | carry the two capability flags (confirm best seam at implementation) |
| `app/toolset.py` or `app/agent_node.py` | tool retry budget = 2 |
| `app/run_turn.py` | distinct `UnexpectedModelBehavior` logging |
| `tests/counselle_db/test_server.py` | FastMCP in-memory client D6 regression (all tools, parametrized) |
| `tests/counselle_db/test_search_fields_pure.py` | SQL-variant selection tests |
| `tests/counselle_db/test_search_fields.py` | degraded-mode unit tests; extension guard (live); drop stale docstring claim |
| `tests/api/test_routes_unit.py` (or route test home) | `/v1/schools/search` degraded-mode 200 test |
| `README.md` | pg_trgm prerequisite |

**Other repo (`~/Projects/ascensia-data-pipeline`), separate one-line PR:**

| File | Change |
|---|---|
| `docker-compose.yml` | `postgres:16-alpine` → `pgvector/pgvector:pg16` |

**Ops-only (no repo change):** Phase 0.1 `CREATE EXTENSION` on the live DB.
