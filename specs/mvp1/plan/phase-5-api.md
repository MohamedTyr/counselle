# Phase 5 — The API edge (the v1 event protocol)

**Branch:** `feat/p5-api`
**Objective:** the service's public contract per ADR 0016: FastAPI + SSE, the session endpoints, request context with trace IDs, usage accounting, health, admin reconcile. After this phase Counselle is a real network service any client can talk to.

## Inputs for builder agents
- `docs/ARCHITECTURE.md` §6, §7, §19, §20; ADR 0016.
- Phase 4's `app/run_turn.py` (the API is a thin shell over it — if something is hard here, the fix belongs in Phase 4's runner, not in route code).

## Step 0 (orchestrator): `uv add fastapi uvicorn sse-starlette`.

## Work breakdown

### Slice A — app skeleton & middleware (`api/main.py`, `api/context.py`)
- `create_app() -> FastAPI` factory; lifespan: `setup_logging`, `get_settings` (fail-fast boots here), start the counselle-db MCP child + checkpointer (incl. the D3 schema assertion) + reconciler interval task; graceful shutdown closes pools.
- **(Eng-review D4) MCP child supervision:** the lifespan owns a supervisor task — if the stdio child exits, log it, restart with exponential backoff (1s → 30s cap), and surface state as `mcp: ok | restarting | failed` in `/v1/health`. An in-flight turn whose tool call hits the dead child gets a structured tool error (the agent apologizes and continues), never a hang. Test: kill the child PID mid-suite → next tool call errors cleanly → a later call succeeds after auto-restart.
- `RequestContext` middleware: mint `trace_id` (uuid4 hex), bind to structlog; **optional principal**: read `Authorization: Bearer …` if present and stash a `principal: str | None` on request.state — no validation, no auth (the platform seam, ADR 0016). CORS from Settings.
- Error envelope: every unhandled exception → JSON `{error: {message: "Something went wrong — this is on us.", trace_id}}`, 500, full traceback logged with trace_id. Never leak internals (PRD security rules).

### Slice B — routes (`api/routes/sessions.py`, `api/routes/system.py`)

| Route | Behavior |
|---|---|
| `POST /v1/sessions` | body `{source_config?: SourceConfig}` → create `counselle.sessions` row (defaults from Settings when omitted) → `201 {session_id, source_config}` |
| `POST /v1/sessions/{id}/messages` | body `{text: str (1..4000), source_config?: SourceConfig (per-request override), in_reply_to?: str (clarify event id)}` → **SSE stream**: encode each domain `Event` from `run_turn` as an SSE message (`event: <type>`, `data: <json>`, `id: <seq>`), keepalive comments every `sse_keepalive_s`. `in_reply_to`/parked-graph case: `run_turn` resumes the interrupt with the text. 404 unknown session. 409 if a turn is already streaming for this session (single-flight per session, in-process lock — sufficient for the single-instance MVP; a multi-replica deployment later needs a DB advisory lock, noted in §23 of ARCHITECTURE). |
| `GET /v1/sessions/{id}` | `{session_id, title, created_at, source_config, transcript: [{role, text, ts}]}` — transcript read from the checkpointer's message history (ADR 0019; the platform's chat-history read). |
| `GET /v1/health` | `{status, db: ok/fail (SELECT 1 on both pools), checkpointer: ok, reconciler: {last_run, last_result}, version}` — 200/503. |
| `POST /v1/admin/reconcile` | runs `reconcile_field_index()` → its summary. (No auth in MVP1; document as dev-only.) |

### Slice C — usage accounting & SSE correctness
- Wrap each turn: accumulate PydanticAI usage per model call + tool-call count; emit one `usage` event before `done`; structured log line `turn_complete {session_id, trace_id, input_tokens, output_tokens, tool_calls, duration_ms, est_cost_usd}`. Cost table (USD/1M tokens) lives in Settings as `model_prices: dict[str, tuple[float, float]]` with Gemini 2.5 Pro/Flash defaults — est only, None for unknown models.
- SSE details that bite: set `Cache-Control: no-store`, `X-Accel-Buffering: no`; flush per event; client-disconnect cancels the turn cleanly (assert no orphaned tasks via test).

### Slice D — protocol tests (`tests/api/`, httpx ASGI client; LLM = TestModel/FunctionModel, DB live)
1. Create session → 201, row exists with defaults.
2. Message happy path → event order: `meta` first, ≥1 `delta`, `sources` present iff registry non-empty, exactly one `usage`, terminal `done{status:"complete"}`; every event has `v:1`.
3. Clarify path (FunctionModel scripted to call ask_student) → stream ends `clarify` + `done{status:"awaiting_input"}`; second POST with `in_reply_to` resumes and completes.
4. Unknown session → 404 envelope with trace_id; oversized text → 422.
5. Concurrent second message during a stream → 409.
6. Disabled source override honored end-to-end (reddit off → no reddit tool call — FunctionModel asserts toolset).
7. Health: 200 with live DB; flip DSN → 503 path (monkeypatched pool).
8. SSE encoding: `event:`/`data:` framing parseable by a naive line parser (the harness's parser, kept in sync).

## Live verification (orchestrator)
```bash
uv run uvicorn api.main:create_app --factory --port 8000 &
curl -s -X POST localhost:8000/v1/sessions | jq          # session_id
curl -N -X POST localhost:8000/v1/sessions/<id>/messages \
  -H 'content-type: application/json' -d '{"text":"Compare Duke and Harvard on cost"}'
# watch real SSE: meta → deltas → viz → sources → usage → done   (real Gemini)
curl -s localhost:8000/v1/health | jq
```

## Gate checklist
- [ ] All 8 protocol tests green; live curl session shows the full event sequence with a real model.
- [ ] Transcript endpoint returns the conversation just held (live check).
- [ ] No secret/DSN appears in any log line (grep a captured log run).
- [ ] security-reviewer pass on input validation, error envelope, CORS.
- [ ] Containerfile builds and the container serves `/v1/health` (now testable: `podman/docker build` + run with env).

## Milestone commit
```
feat(api): v1 event protocol over SSE — sessions, messages, transcript, health, usage accounting

Versioned envelope per ADR 0016; trace-id request context with auth-ready
principal stub; per-turn token/cost logging per ARCHITECTURE §19.
```
