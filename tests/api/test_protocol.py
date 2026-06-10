"""Phase 5 Slice D — v1 protocol integration tests (all 8 spec tests).

Tests run against the REAL app via httpx ASGI transport (no Gemini — FunctionModel
injected; no MCP stdio child; InMemorySaver checkpointer; live Postgres DB for
session rows).

All tests are marked ``@pytest.mark.live_db``.

Design note: ALL tests use ``httpx.AsyncClient`` (not TestClient) because the
asyncpg pools are created on the async pytest event loop — TestClient spins up
its own thread-local event loop which causes "Future attached to a different
loop" errors with asyncpg.

SSE parsing
-----------
The naive line-parser used throughout: split raw bytes by lines, yield events
as dicts with ``type``, ``data`` (parsed JSON), and ``id`` fields.  Keepalive
comments (lines starting with ``:```) are silently skipped, matching the spec
for test 8.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

from tests.api.conftest import (
    _build_live_app,
    _build_test_runtime,
    _fn_model,
    delete_session,
)

pytestmark = pytest.mark.live_db

# ---------------------------------------------------------------------------
# SSE wire parser (the naive parser the spec requires)
# ---------------------------------------------------------------------------


def parse_sse_stream(raw: bytes) -> list[dict[str, Any]]:
    """Parse a complete SSE stream into a list of event dicts.

    Each dict has: ``type`` (str), ``data`` (parsed JSON dict), ``id`` (str|None).
    Keepalive comments (``: ping`` lines) are silently skipped, as the spec requires.

    This is deliberately a "naive" line-splitting implementation — the spec
    contract is that every event must survive this parser (test 8).
    """
    events: list[dict[str, Any]] = []
    current: dict[str, str] = {}

    for line in raw.decode().splitlines():
        # Skip keepalive comments and blank comment lines
        if line.startswith(":"):
            continue
        if line == "":
            # Blank line = end of event
            if "event" in current and "data" in current:
                events.append(
                    {
                        "type": current["event"],
                        "data": json.loads(current["data"]),
                        "id": current.get("id"),
                    }
                )
            current = {}
            continue
        if line.startswith("id: "):
            current["id"] = line[4:]
        elif line.startswith("event: "):
            current["event"] = line[7:]
        elif line.startswith("data: "):
            current["data"] = line[6:]

    # Handle stream with no trailing blank line
    if "event" in current and "data" in current:
        events.append(
            {
                "type": current["event"],
                "data": json.loads(current["data"]),
                "id": current.get("id"),
            }
        )
    return events


def _event_types(events: list[dict[str, Any]]) -> list[str]:
    return [ev["type"] for ev in events]


def _done_event(events: list[dict[str, Any]]) -> dict[str, Any]:
    return next(ev for ev in events if ev["type"] == "done")


async def _create_session(app: FastAPI, source_config: dict[str, Any] | None = None) -> str:
    """Create a session via POST /v1/sessions and return the session_id."""
    payload: dict[str, Any] = {}
    if source_config is not None:
        payload["source_config"] = source_config
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.post("/v1/sessions", json=payload)
    assert resp.status_code == 201, f"POST /v1/sessions failed: {resp.status_code} {resp.text}"
    return resp.json()["session_id"]  # type: ignore[no-any-return]


async def _stream_message(
    app: FastAPI, session_id: str, text: str, extra: dict[str, Any] | None = None
) -> bytes:
    """POST a message and collect the full SSE stream as raw bytes."""
    payload: dict[str, Any] = {"text": text}
    if extra:
        payload.update(extra)
    async with (
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client,
        client.stream(
            "POST",
            f"/v1/sessions/{session_id}/messages",
            json=payload,
        ) as resp,
    ):
        return await resp.aread()


# ---------------------------------------------------------------------------
# Test 1: POST /v1/sessions → 201, row exists
# ---------------------------------------------------------------------------


async def test_create_session_201_with_defaults(live_app: FastAPI) -> None:
    """Test 1a: POST /v1/sessions → 201; response contains session_id + source_config."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=live_app), base_url="http://test"
    ) as client:
        resp = await client.post("/v1/sessions", json={})

    assert resp.status_code == 201
    body = resp.json()
    assert "session_id" in body
    assert "source_config" in body
    session_id = body["session_id"]
    assert session_id  # non-empty string

    # source_config has the expected keys
    cfg = body["source_config"]
    assert "web" in cfg
    assert "reddit" in cfg
    assert "edu" in cfg

    await delete_session(live_app.state.runtime.app_pool, session_id)


async def test_create_session_row_exists_in_db(live_app: FastAPI) -> None:
    """Test 1b: POST /v1/sessions → row inserted into counselle.sessions."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=live_app), base_url="http://test"
    ) as client:
        resp = await client.post("/v1/sessions", json={})
    session_id = resp.json()["session_id"]

    try:
        # Query the pool directly to verify the row exists
        async with live_app.state.runtime.app_pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT session_id, source_config FROM counselle.sessions WHERE session_id = $1",
                session_id,
            )
        assert row is not None, "session row must exist after POST /v1/sessions"
        assert str(row["session_id"]) == session_id
    finally:
        await delete_session(live_app.state.runtime.app_pool, session_id)


async def test_create_session_with_explicit_source_config(live_app: FastAPI) -> None:
    """Test 1c: POST /v1/sessions with explicit source_config → echoed back."""
    payload = {"source_config": {"web": True, "reddit": False, "edu": True}}
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=live_app), base_url="http://test"
    ) as client:
        resp = await client.post("/v1/sessions", json=payload)

    assert resp.status_code == 201
    cfg = resp.json()["source_config"]
    assert cfg["web"] is True
    assert cfg["reddit"] is False
    assert cfg["edu"] is True

    await delete_session(live_app.state.runtime.app_pool, resp.json()["session_id"])


# ---------------------------------------------------------------------------
# Test 2: Happy-path message → correct SSE event sequence
# ---------------------------------------------------------------------------


async def test_happy_path_event_sequence(live_app: FastAPI) -> None:
    """Test 2: meta first, ≥1 delta, sources, exactly one usage, done{complete}; v:1 on all."""
    session_id = await _create_session(live_app)
    try:
        raw = await _stream_message(live_app, session_id, "Tell me about Duke University")
        events = parse_sse_stream(raw)
        types = _event_types(events)

        # meta FIRST
        assert types[0] == "meta", f"first event must be 'meta', got {types[0]!r}"

        # ≥1 delta
        assert "delta" in types, "stream must have at least one delta event"

        # sources present (always emitted, even when empty)
        assert "sources" in types, "sources event must be present"

        # EXACTLY one usage
        assert types.count("usage") == 1, (
            f"expected exactly 1 usage event, got {types.count('usage')}"
        )

        # terminal done{status: "complete"}
        done = _done_event(events)
        assert done["data"]["data"]["status"] == "complete"

        # EVERY event has v:1
        for ev in events:
            assert ev["data"]["v"] == 1, f"event {ev['type']} missing v:1"
    finally:
        await delete_session(live_app.state.runtime.app_pool, session_id)


async def test_happy_path_sources_event_always_present(live_app: FastAPI) -> None:
    """Test 2b: sources event is always emitted (registry may be empty with TestModel)."""
    session_id = await _create_session(live_app)
    try:
        raw = await _stream_message(live_app, session_id, "hi")
        events = parse_sse_stream(raw)
        assert "sources" in _event_types(events), "sources event must always be present"
    finally:
        await delete_session(live_app.state.runtime.app_pool, session_id)


# ---------------------------------------------------------------------------
# Test 3: Clarify path
# ---------------------------------------------------------------------------


def _clarify_model() -> FunctionModel:
    """FunctionModel that calls ask_student on the first turn, then answers."""

    def fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        last = messages[-1]
        returns = (
            [p for p in last.parts if isinstance(p, ToolReturnPart)]
            if isinstance(last, ModelRequest)
            else []
        )
        if returns:
            return ModelResponse(parts=[TextPart(f"Focusing on {returns[0].content}.")])
        return ModelResponse(
            parts=[
                ToolCallPart(
                    tool_name="ask_student",
                    args={
                        "question": "What matters most to you?",
                        "header": "Pick one",
                        "options": [
                            {"label": "Cost", "hint": "affordability and aid"},
                            {"label": "Academics", "hint": "programs and rigor"},
                        ],
                    },
                )
            ]
        )

    return _fn_model(fn)


async def test_clarify_path_parks_and_resumes() -> None:
    """Test 3: ask_student → clarify + done{awaiting_input}; resume → done{complete}."""
    rt, orig = await _build_test_runtime(model_factory=_clarify_model)
    app = _build_live_app(rt)
    session_id = await _create_session(app)

    try:
        # First POST → parks on clarify
        raw1 = await _stream_message(app, session_id, "Tell me about NYU")
        events1 = parse_sse_stream(raw1)
        types1 = _event_types(events1)

        assert "clarify" in types1, f"expected clarify event, got: {types1}"
        done1 = _done_event(events1)
        assert done1["data"]["data"]["status"] == "awaiting_input"

        # Second POST with in_reply_to → resumes and completes
        raw2 = await _stream_message(
            app,
            session_id,
            "cost",
            extra={"in_reply_to": "some-clarify-event-id"},
        )
        events2 = parse_sse_stream(raw2)
        done2 = _done_event(events2)
        assert done2["data"]["data"]["status"] == "complete"

        # The model's answer reflects the resumed student answer
        delta_text = "".join(ev["data"]["data"]["text"] for ev in events2 if ev["type"] == "delta")
        assert "Focusing on cost." in delta_text
    finally:
        await delete_session(rt.app_pool, session_id)
        await orig.aclose()


# ---------------------------------------------------------------------------
# Test 4: Error cases — 404 unknown session, 422 oversized text
# ---------------------------------------------------------------------------


async def test_unknown_session_post_message_returns_404(live_app: FastAPI) -> None:
    """Test 4a: POST to a non-existent session → 404 with error envelope."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=live_app), base_url="http://test"
    ) as client:
        resp = await client.post(
            f"/v1/sessions/{uuid4()}/messages",
            json={"text": "hello"},
        )

    assert resp.status_code == 404
    body = resp.json()
    assert "error" in body, f"expected error envelope, got: {body}"
    # error envelope must contain a message field
    assert "message" in body["error"], f"error envelope missing 'message': {body['error']}"
    assert body["error"]["message"], "error.message must be non-empty"


async def test_oversized_text_returns_422(live_app: FastAPI) -> None:
    """Test 4b: POST body with text > 4000 chars → 422 Unprocessable Entity."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=live_app), base_url="http://test"
    ) as client:
        resp = await client.post(
            f"/v1/sessions/{uuid4()}/messages",
            json={"text": "x" * 4001},
        )
    assert resp.status_code == 422


async def test_404_error_envelope_has_trace_id(live_app: FastAPI) -> None:
    """Test 4c: the 404 error envelope includes a trace_id field."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=live_app), base_url="http://test"
    ) as client:
        resp = await client.post(
            f"/v1/sessions/{uuid4()}/messages",
            json={"text": "hello"},
        )
    assert resp.status_code == 404
    body = resp.json()
    err = body.get("error", {})
    # trace_id is set by the RequestContext middleware (may be None if middleware not active)
    # The route always includes it: {"error": {"message": ..., "trace_id": ...}}
    assert "message" in err


# ---------------------------------------------------------------------------
# Test 5: Concurrent second message during an active stream → 409
# ---------------------------------------------------------------------------


async def test_concurrent_second_message_returns_409(live_app: FastAPI) -> None:
    """Test 5: second POST while a turn lock is held → 409."""
    session_id = await _create_session(live_app)

    try:
        # Pre-claim the session id in the active-sessions set to simulate an
        # in-flight streaming turn (H2: sync claim-set approach).
        from api.routes.sessions import _get_active_sessions

        active = _get_active_sessions(live_app)
        active.add(session_id)

        try:
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=live_app), base_url="http://test"
            ) as client:
                resp = await client.post(
                    f"/v1/sessions/{session_id}/messages",
                    json={"text": "second attempt while turn is in flight"},
                )

            assert resp.status_code == 409
            body = resp.json()
            assert "error" in body
            assert "message" in body["error"]
        finally:
            active.discard(session_id)
    finally:
        await delete_session(live_app.state.runtime.app_pool, session_id)


# ---------------------------------------------------------------------------
# Test 6: source_config override honored — reddit off → no search_reddit tool
# ---------------------------------------------------------------------------


async def test_source_config_override_reddit_off() -> None:
    """Test 6: POST with reddit=false → search_reddit not in model's available tools."""
    seen_tools: list[str] = []

    def record_tools(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        seen_tools.extend(t.name for t in info.function_tools)
        return ModelResponse(parts=[TextPart("ok")])

    rt, orig = await _build_test_runtime(model_factory=lambda: _fn_model(record_tools))
    app = _build_live_app(rt)
    session_id = await _create_session(app)

    try:
        await _stream_message(
            app,
            session_id,
            "Tell me about Duke",
            extra={"source_config": {"web": True, "reddit": False, "edu": True}},
        )

        assert "search_reddit" not in seen_tools, (
            f"search_reddit must not be available when reddit=False, got: {seen_tools}"
        )
        # web and edu sources should be present when enabled
        assert "search_web" in seen_tools, f"search_web should be present: {seen_tools}"
        assert "search_school_site" in seen_tools, (
            f"search_school_site should be present: {seen_tools}"
        )
    finally:
        await delete_session(rt.app_pool, session_id)
        await orig.aclose()


# ---------------------------------------------------------------------------
# Test 7: Health — 200 with live DB; monkeypatched pool → 503 degraded
# ---------------------------------------------------------------------------


async def test_health_200_with_live_db(live_app: FastAPI) -> None:
    """Test 7a: GET /v1/health → 200, status=ok when DB is reachable."""
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=live_app), base_url="http://test"
    ) as client:
        resp = await client.get("/v1/health")

    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["db"] == "ok"


async def test_health_503_when_pool_fails(live_app: FastAPI) -> None:
    """Test 7b: GET /v1/health → 503 degraded when the pool raises."""
    broken_conn = AsyncMock()
    broken_conn.fetchval.side_effect = Exception("connection refused")
    broken_pool = MagicMock()
    broken_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=broken_conn)
    broken_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

    # Swap the ro_pool to simulate failure
    orig_ro_pool = live_app.state.runtime.ro_pool
    live_app.state.runtime.ro_pool = broken_pool
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=live_app), base_url="http://test"
        ) as client:
            resp = await client.get("/v1/health")
    finally:
        live_app.state.runtime.ro_pool = orig_ro_pool

    assert resp.status_code == 503
    body = resp.json()
    assert body["status"] == "degraded"
    assert body["db"] == "fail"


# ---------------------------------------------------------------------------
# Test 8: SSE framing — raw bytes parseable; id lines increment
# ---------------------------------------------------------------------------


async def test_sse_framing_event_and_data_lines(live_app: FastAPI) -> None:
    """Test 8a: raw response bytes contain 'event: ' and 'data: ' lines."""
    session_id = await _create_session(live_app)
    try:
        raw = await _stream_message(live_app, session_id, "hello")

        assert b"event: " in raw, "raw SSE bytes must contain 'event: ' lines"
        assert b"data: " in raw, "raw SSE bytes must contain 'data: ' lines"
        assert b"id: " in raw, "raw SSE bytes must contain 'id: ' lines"
    finally:
        await delete_session(live_app.state.runtime.app_pool, session_id)


async def test_sse_naive_parser_yields_valid_event_sequence(live_app: FastAPI) -> None:
    """Test 8b: naive line parser yields same event sequence as test 2; all v:1."""
    session_id = await _create_session(live_app)
    try:
        raw = await _stream_message(live_app, session_id, "hello")
        events = parse_sse_stream(raw)
        types = _event_types(events)

        # Same invariants as test 2
        assert types[0] == "meta", f"first event must be meta, got: {types}"
        assert "done" in types

        # Every event's data field parsed by naive parser has v:1
        for ev in events:
            assert ev["data"]["v"] == 1, f"event {ev['type']} missing v:1"
            assert "type" in ev["data"]

        # All event types are known protocol types
        known = {"meta", "delta", "viz", "clarify", "sources", "usage", "done", "error"}
        for t in types:
            assert t in known, f"unknown event type: {t!r}"
    finally:
        await delete_session(live_app.state.runtime.app_pool, session_id)


async def test_sse_id_lines_increment(live_app: FastAPI) -> None:
    """Test 8c: id: lines are present and monotonically increment from 0."""
    session_id = await _create_session(live_app)
    try:
        raw = await _stream_message(live_app, session_id, "hello")

        # Extract id values from raw bytes
        ids = []
        for line in raw.decode().splitlines():
            if line.startswith("id: "):
                ids.append(int(line[4:]))

        assert ids, "stream must have at least one id: line"
        assert ids == list(range(len(ids))), f"id lines must be 0,1,2,..., got: {ids}"
    finally:
        await delete_session(live_app.state.runtime.app_pool, session_id)


async def test_sse_keepalive_comments_skipped_by_parser(live_app: FastAPI) -> None:
    """Test 8d: keepalive comment lines (: ping) are skipped by the naive parser."""
    # Simulate a raw SSE stream containing keepalive comments
    raw_with_pings = (
        b": ping\r\n"
        b"\r\n"
        b"id: 0\r\n"
        b"event: meta\r\n"
        b'data: {"v":1,"type":"meta","data":{"trace_id":"t","session_id":"s","model":"m"}}\r\n'
        b"\r\n"
        b": ping\r\n"
        b"\r\n"
        b"id: 1\r\n"
        b"event: done\r\n"
        b'data: {"v":1,"type":"done","data":{"status":"complete"}}\r\n'
        b"\r\n"
    )
    events = parse_sse_stream(raw_with_pings)
    types = _event_types(events)

    # Pings must be absent
    assert types == ["meta", "done"], f"expected [meta, done], got: {types}"
