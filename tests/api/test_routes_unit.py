"""Focused unit tests for the v1 route stubs (Slice B).

These tests run WITHOUT a live DB — the full protocol integration suite is
Slice D.  The app is assembled with a minimal fake state injected on
``app.state`` before the test client is opened.

Covered:
- GET /v1/sessions/{id} → 404 for unknown session
- GET /v1/sessions/{id} → 422 for malformed (non-UUID) session id (H1)
- POST /v1/sessions/{id}/messages → 404 for unknown session
- POST /v1/sessions/{id}/messages → 422 for malformed (non-UUID) session id (H1)
- POST /v1/sessions/{id}/messages → 422 for oversized text (>4000 chars)
- POST /v1/sessions/{id}/messages → 409 when a turn is already in flight (H2)
- GET /v1/health → correct shape with mocked pools
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth import current_active_user
from api.context import install_middleware
from api.routes import sessions as session_routes
from api.routes import system as system_routes
from app.turns import TurnRegistry
from tests.api.conftest import TEST_USER_ID, _test_user

# Fake session rows in these unit tests are owned by the override's test user.
_OWNER_ID = str(TEST_USER_ID)

# ---------------------------------------------------------------------------
# Fake DB helpers
# ---------------------------------------------------------------------------


def _make_pool(select_one: Any = 1, fail: bool = False) -> Any:
    """Return a minimal mock asyncpg pool that handles acquire()."""
    conn = AsyncMock()
    if fail:
        conn.fetchval.side_effect = Exception("pool fail")
        conn.fetchrow.side_effect = Exception("pool fail")
    else:
        conn.fetchval.return_value = select_one
        conn.fetchrow.return_value = None  # unknown session by default

    pool = MagicMock()
    pool.acquire.return_value.__aenter__ = AsyncMock(return_value=conn)
    pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
    return pool, conn


# ---------------------------------------------------------------------------
# App factory for tests (no lifespan, state injected directly)
# ---------------------------------------------------------------------------


def make_test_app(
    *,
    ro_pool: Any = None,
    app_pool: Any = None,
    graph: Any = None,
    supervisor: Any = None,
    reconciler: Any = None,
    run_turn_fn: Any = None,
) -> FastAPI:
    """Build a FastAPI test app with fake state — no lifespan needed."""
    app = FastAPI()
    install_middleware(app, SimpleNamespace(cors_origins=["*"]))
    app.include_router(session_routes.router, prefix="/v1")
    app.include_router(system_routes.router, prefix="/v1")

    # Minimal fake settings
    settings = SimpleNamespace(
        sse_keepalive_s=15,
        model_counselor="google-vertex:gemini-2.5-pro",
        usage_accounting=True,
        model_prices={},
        source_web_default=True,
        source_reddit_default=True,
        source_edu_default=True,
        stream_buffer_size=1000,
        turn_timeout_s=30,
        reattach_enabled=True,
    )

    # Default fake pools
    _ro_pool, _ = _make_pool()
    _app_pool, _ = _make_pool()

    # Fake supervisor
    fake_supervisor = MagicMock()
    fake_supervisor.status.return_value = {
        "status": "ok",
        "consecutive_failures": 0,
        "restarts": 0,
        "last_probe_at": None,
        "last_error": None,
    }

    # Fake reconciler
    fake_reconciler = SimpleNamespace(
        last_run=None,
        last_result=None,
        last_error=None,
    )
    fake_reconciler.as_dict = lambda: {
        "last_run": fake_reconciler.last_run,
        "last_result": fake_reconciler.last_result,
        "last_error": fake_reconciler.last_error,
    }

    fake_graph = AsyncMock()
    fake_graph.aget_state.return_value = SimpleNamespace(
        tasks=[],
        values={"messages": []},
    )

    fake_deps = SimpleNamespace(
        app_pool=app_pool or _app_pool,
        settings=settings,
    )

    app.state.settings = settings
    app.state.runtime = SimpleNamespace(
        ro_pool=ro_pool or _ro_pool,
        app_pool=app_pool or _app_pool,
        graph=graph or fake_graph,
        deps=fake_deps,
    )
    app.state.reconciler = reconciler or fake_reconciler
    app.state.mcp_supervisor = supervisor or fake_supervisor
    app.state.turn_registry = TurnRegistry(
        deps=fake_deps,
        graph=graph or fake_graph,
        settings=settings,
        run_turn_fn=run_turn_fn,
    )
    # B3: the session routes require auth + ownership. These unit tests fake the
    # principal with the shared test user; fake session rows are owned by it.
    app.dependency_overrides[current_active_user] = _test_user
    return app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client() -> TestClient:
    app = make_test_app()
    return TestClient(app, raise_server_exceptions=False)


# A well-formed UUID that has no matching DB row (fake pool returns None).
_UNKNOWN_UUID = "00000000-0000-4000-8000-000000000001"
# A non-UUID string that should be rejected by FastAPI's path-param type (422).
_BAD_ID = "not-a-uuid"

# ---------------------------------------------------------------------------
# 404: GET /v1/sessions/{id} — unknown session (valid UUID, no DB row)
# ---------------------------------------------------------------------------


def test_get_session_unknown_returns_404(client: TestClient) -> None:
    """GET /v1/sessions/{id} with a valid UUID but no matching DB row → 404."""
    # The fake pool's fetchrow returns None by default (unknown session).
    response = client.get(f"/v1/sessions/{_UNKNOWN_UUID}")
    assert response.status_code == 404
    body = response.json()
    assert "error" in body
    assert body["error"]["message"] == "Session not found."


# ---------------------------------------------------------------------------
# 422 (H1): malformed session_id — rejected before hitting the DB
# ---------------------------------------------------------------------------


def test_get_session_bad_id_returns_422(client: TestClient) -> None:
    """GET /v1/sessions/{id} with a non-UUID path param → 422 (never 500)."""
    response = client.get(f"/v1/sessions/{_BAD_ID}")
    assert response.status_code == 422


def test_post_message_bad_id_returns_422(client: TestClient) -> None:
    """POST /v1/sessions/{id}/messages with a non-UUID path param → 422 (never 500)."""
    response = client.post(
        f"/v1/sessions/{_BAD_ID}/messages",
        json={"text": "hello"},
    )
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# 404: POST /v1/sessions/{id}/messages — unknown session
# ---------------------------------------------------------------------------


def test_post_message_unknown_session_returns_404(client: TestClient) -> None:
    """POST /v1/sessions/{id}/messages with a valid UUID but no DB row → 404 before any SSE."""
    response = client.post(
        f"/v1/sessions/{_UNKNOWN_UUID}/messages",
        json={"text": "hello"},
    )
    assert response.status_code == 404
    body = response.json()
    assert "error" in body
    assert body["error"]["message"] == "Session not found."


# ---------------------------------------------------------------------------
# 422: POST /v1/sessions/{id}/messages — oversized / empty text
# ---------------------------------------------------------------------------


def test_post_message_oversized_text_returns_422() -> None:
    """POST body with text > 4000 chars → 422 (owned session, so body validates)."""
    app, session_id = _known_session_app()
    with TestClient(app, raise_server_exceptions=False) as tc:
        response = tc.post(f"/v1/sessions/{session_id}/messages", json={"text": "x" * 4001})
    assert response.status_code == 422


def test_post_message_empty_text_returns_422() -> None:
    """POST body with empty text → 422 (owned session, so body validates)."""
    app, session_id = _known_session_app()
    with TestClient(app, raise_server_exceptions=False) as tc:
        response = tc.post(f"/v1/sessions/{session_id}/messages", json={"text": ""})
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# 409 (H2): POST /v1/sessions/{id}/messages — turn already in flight
# ---------------------------------------------------------------------------


async def test_post_message_409_when_turn_in_flight() -> None:
    """POST /v1/sessions/{id}/messages → 409 while the registry holds the claim.

    B2 rewrite of the MVP1 claim-set test: a hung fake ``run_turn`` is
    injected through the registry seam, the turn is started via the registry
    API, and the second POST must 409 while ``is_generating`` is True.
    """
    import asyncio

    import httpx

    from domain.events import ev_meta

    test_session_uuid = "00000000-0000-4000-8000-000000000002"
    test_session_id = test_session_uuid  # canonical string form

    _, app_conn = _make_pool()
    fake_row = {
        "session_id": test_session_id,
        "user_id": _OWNER_ID,
        "title": None,
        "source_config": None,
        "created_at": None,
        "updated_at": None,
    }
    app_conn.fetchrow.return_value = fake_row

    app_pool = MagicMock()
    app_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=app_conn)
    app_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

    gate = asyncio.Event()

    async def hung_run_turn(session_id: str, text: str, *args: Any, **kwargs: Any) -> Any:
        yield ev_meta("trace-409", session_id, "model-x", "m-409", "um-409")
        await gate.wait()

    app = make_test_app(app_pool=app_pool, run_turn_fn=hung_run_turn)
    registry = app.state.turn_registry

    await registry.start(test_session_id, "first message")
    try:
        assert registry.is_generating(test_session_id) is True

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.post(
                f"/v1/sessions/{test_session_uuid}/messages",
                json={"text": "hello"},
            )

        assert response.status_code == 409
        body = response.json()
        assert "error" in body
        assert "already streaming" in body["error"]["message"]
    finally:
        gate.set()
        await registry.cancel(test_session_id)
        assert registry.is_generating(test_session_id) is False


# ---------------------------------------------------------------------------
# GET /v1/health — shape check with mocked pools
# ---------------------------------------------------------------------------


def test_health_returns_ok_shape_with_healthy_pools() -> None:
    """GET /v1/health → 200 with correct shape when both pools respond."""
    _, ro_conn = _make_pool()
    ro_conn.fetchval.return_value = 1
    ro_pool = MagicMock()
    ro_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=ro_conn)
    ro_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

    _, app_conn = _make_pool()
    app_conn.fetchval.return_value = 1
    app_pool = MagicMock()
    app_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=app_conn)
    app_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

    app = make_test_app(ro_pool=ro_pool, app_pool=app_pool)

    with TestClient(app, raise_server_exceptions=False) as tc:
        response = tc.get("/v1/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["db"] == "ok"
    assert body["checkpointer"] == "ok"
    assert "mcp" in body
    assert "reconciler" in body
    assert body["version"] == "0.1.0"


def test_health_returns_503_when_pool_fails() -> None:
    """GET /v1/health → 503 when either pool fails SELECT 1."""
    _, ro_conn = _make_pool(fail=True)
    ro_pool = MagicMock()
    ro_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=ro_conn)
    ro_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

    _, app_conn = _make_pool()
    app_conn.fetchval.return_value = 1
    app_pool = MagicMock()
    app_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=app_conn)
    app_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

    app = make_test_app(ro_pool=ro_pool, app_pool=app_pool)

    with TestClient(app, raise_server_exceptions=False) as tc:
        response = tc.get("/v1/health")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "degraded"
    assert body["db"] == "fail"


# ---------------------------------------------------------------------------
# _extract_transcript unit tests
# ---------------------------------------------------------------------------


def test_extract_transcript_maps_user_and_assistant() -> None:
    """_extract_transcript correctly maps request→user and response→assistant."""
    messages = [
        {
            "kind": "request",
            "timestamp": "2026-06-10T12:00:00Z",
            "parts": [
                {"part_kind": "user-prompt", "content": "hello"},
            ],
        },
        {
            "kind": "response",
            "timestamp": "2026-06-10T12:00:01Z",
            "parts": [
                {"part_kind": "text", "content": "world"},
            ],
        },
    ]
    result = session_routes._extract_transcript(messages)
    assert len(result) == 2
    assert result[0] == {"role": "user", "text": "hello", "ts": "2026-06-10T12:00:00Z"}
    assert result[1] == {"role": "assistant", "text": "world", "ts": "2026-06-10T12:00:01Z"}


def test_extract_transcript_skips_tool_only_responses() -> None:
    """Responses with no text parts (tool-call only) are skipped."""
    messages = [
        {
            "kind": "response",
            "timestamp": None,
            "parts": [
                {"part_kind": "tool-call", "tool_name": "search", "args": {}},
            ],
        },
    ]
    result = session_routes._extract_transcript(messages)
    assert result == []


def test_extract_transcript_concatenates_multiple_text_parts() -> None:
    """Multiple text parts in one response are concatenated."""
    messages = [
        {
            "kind": "response",
            "timestamp": None,
            "parts": [
                {"part_kind": "text", "content": "Hello "},
                {"part_kind": "text", "content": "world"},
            ],
        }
    ]
    result = session_routes._extract_transcript(messages)
    assert result[0]["text"] == "Hello world"


# ---------------------------------------------------------------------------
# FIX 4: GET /v1/sessions/{id} — aget_state failure → 500, not 200
# ---------------------------------------------------------------------------


def test_get_session_checkpointer_failure_returns_500() -> None:
    """GET /v1/sessions/{id} where aget_state raises → 500, never 200 with empty transcript."""
    test_session_uuid = "00000000-0000-4000-8000-000000000099"
    test_session_id = test_session_uuid

    _, app_conn = _make_pool()
    fake_row = {
        "session_id": test_session_id,
        "user_id": _OWNER_ID,
        "title": None,
        "source_config": None,
        "created_at": None,
        "updated_at": None,
    }
    app_conn.fetchrow.return_value = fake_row

    app_pool = MagicMock()
    app_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=app_conn)
    app_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

    # Graph whose aget_state raises an exception
    broken_graph = AsyncMock()
    broken_graph.aget_state.side_effect = RuntimeError("checkpointer exploded")

    app = make_test_app(app_pool=app_pool, graph=broken_graph)

    with TestClient(app, raise_server_exceptions=False) as tc:
        response = tc.get(f"/v1/sessions/{test_session_uuid}")

    assert response.status_code == 500
    body = response.json()
    assert "error" in body
    assert "transcript" not in body  # 500 envelope, not the 200 transcript shape


# ---------------------------------------------------------------------------
# FIX 1 (B2: now the registry's after-commit fallback) — exception after 200
# committed → error SSE event in stream
# ---------------------------------------------------------------------------


def test_stream_yields_error_event_when_enrich_usage_raises() -> None:
    """When enrich_usage_event raises on the buffer-fill path, the stream must
    end with an error event (the registry's after-commit error fallback)."""
    import json
    from unittest.mock import patch

    test_session_uuid = "00000000-0000-4000-8000-000000000098"
    test_session_id = test_session_uuid

    _, app_conn = _make_pool()
    fake_row = {
        "session_id": test_session_id,
        "user_id": _OWNER_ID,
        "title": None,
        "source_config": None,
        "created_at": None,
        "updated_at": None,
    }
    app_conn.fetchrow.return_value = fake_row
    app_pool = MagicMock()
    app_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=app_conn)
    app_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)

    # Turn that yields a usage event (to trigger enrich_usage_event)
    from domain.events import UsageData, ev_meta, ev_usage

    usage_event = ev_usage(UsageData(input_tokens=1, output_tokens=1, tool_calls=0))

    async def fake_run_turn(*args: Any, **kwargs: Any):  # type: ignore[no-untyped-def]
        yield ev_meta("trace-1", test_session_id, "model-x", "m-1", "um-1")
        yield usage_event

    app = make_test_app(app_pool=app_pool, run_turn_fn=fake_run_turn)

    with (
        # B2: enrichment lives on the registry's buffer-fill path (app/turns.py)
        patch(
            "app.turns.enrich_usage_event",
            side_effect=RuntimeError("enrichment boom"),
        ),
        TestClient(app, raise_server_exceptions=False) as tc,
    ):
        response = tc.post(
            f"/v1/sessions/{test_session_uuid}/messages",
            json={"text": "hello"},
        )

    # The response is still 200 (SSE headers already sent)
    assert response.status_code == 200
    # Parse the SSE frames and find an error event
    frames = response.text.split("\r\n\r\n")
    error_frames = [f for f in frames if "event: error" in f]
    assert error_frames, f"expected an error SSE frame, got frames: {frames}"
    # Extract the data line from the first error frame
    data_line = next(
        (line for line in error_frames[0].splitlines() if line.startswith("data: ")), None
    )
    assert data_line is not None
    payload = json.loads(data_line[len("data: ") :])
    assert payload["type"] == "error"
    assert "Something went wrong" in payload["data"]["message"]


# ---------------------------------------------------------------------------
# B2 routes: GET /sessions/{id}/stream (reattach) + POST /sessions/{id}/cancel
# ---------------------------------------------------------------------------


def _known_session_app(run_turn_fn: Any = None) -> tuple[Any, str]:
    """A test app whose fake pool knows one session row."""
    session_id = "00000000-0000-4000-8000-000000000042"
    _, app_conn = _make_pool()
    app_conn.fetchrow.return_value = {
        "session_id": session_id,
        "user_id": _OWNER_ID,
        "title": None,
        "source_config": None,
        "created_at": None,
        "updated_at": None,
    }
    app_pool = MagicMock()
    app_pool.acquire.return_value.__aenter__ = AsyncMock(return_value=app_conn)
    app_pool.acquire.return_value.__aexit__ = AsyncMock(return_value=False)
    app = make_test_app(app_pool=app_pool, run_turn_fn=run_turn_fn)
    return app, session_id


def test_stream_route_204_when_no_active_turn() -> None:
    app, session_id = _known_session_app()
    with TestClient(app, raise_server_exceptions=False) as tc:
        response = tc.get(f"/v1/sessions/{session_id}/stream")
    assert response.status_code == 204


def test_stream_route_404_for_unknown_session() -> None:
    app = make_test_app()  # fetchrow → None
    with TestClient(app, raise_server_exceptions=False) as tc:
        response = tc.get(f"/v1/sessions/{_UNKNOWN_UUID}/stream")
    assert response.status_code == 404


def test_stream_route_204_when_reattach_disabled() -> None:
    app, session_id = _known_session_app()
    app.state.settings.reattach_enabled = False
    with TestClient(app, raise_server_exceptions=False) as tc:
        response = tc.get(f"/v1/sessions/{session_id}/stream")
    assert response.status_code == 204


async def test_stream_route_replays_from_last_event_id_header() -> None:
    """GET .../stream with Last-Event-ID: k → only frames with id > k."""
    import asyncio
    import json

    import httpx

    from domain.events import ev_delta, ev_done, ev_meta

    gate = asyncio.Event()

    async def gated_run_turn(sid: str, text: str, *args: Any, **kwargs: Any) -> Any:
        yield ev_meta("t-1", sid, "model-x", "m-1", "um-1")  # seq 0
        yield ev_delta("Hello ")  # seq 1
        await gate.wait()
        yield ev_delta("world.")  # seq 2
        yield ev_done("complete")  # seq 3

    app, session_id = _known_session_app(run_turn_fn=gated_run_turn)
    registry = app.state.turn_registry

    handle = await registry.start(session_id, "hi")
    turn = registry._turns[session_id]
    # wait until seq 0..1 are buffered
    while turn.buffer.next_seq < 2:
        await asyncio.sleep(0.01)

    async def _release_gate() -> None:
        # Release after a tick so the GET attaches to the STILL-active turn
        # (B3 added an ownership DB read to the route — setting the gate before
        # the GET would let the turn finalize + evict first, yielding a 204).
        await asyncio.sleep(0.05)
        gate.set()

    releaser = asyncio.create_task(_release_gate())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get(
            f"/v1/sessions/{session_id}/stream",
            headers={"Last-Event-ID": "1"},
        )
    await releaser

    assert resp.status_code == 200
    frames = [f for f in resp.text.split("\r\n\r\n") if "data: " in f]
    ids = [
        line[len("id: ") :]
        for frame in frames
        for line in frame.splitlines()
        if line.startswith("id: ")
    ]
    assert ids == ["2", "3"]  # exactly seq > 1, nothing replayed below
    payloads = [
        json.loads(line[len("data: ") :])
        for frame in frames
        for line in frame.splitlines()
        if line.startswith("data: ")
    ]
    assert [p["type"] for p in payloads] == ["delta", "done"]
    # drain the original handle so no task leaks
    async for _ in handle:
        pass


async def test_cancel_route_202_active_then_204_idle() -> None:
    import asyncio

    import httpx

    from domain.events import ev_meta

    gate = asyncio.Event()  # never set

    async def hung_run_turn(sid: str, text: str, *args: Any, **kwargs: Any) -> Any:
        yield ev_meta("t-1", sid, "model-x", "m-1", "um-1")
        await gate.wait()

    app, session_id = _known_session_app(run_turn_fn=hung_run_turn)
    registry = app.state.turn_registry
    await registry.start(session_id, "hi")

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        first = await client.post(f"/v1/sessions/{session_id}/cancel")
        second = await client.post(f"/v1/sessions/{session_id}/cancel")

    assert first.status_code == 202  # active → cancelled
    assert second.status_code == 204  # idle no-op


def test_cancel_route_404_for_unknown_session() -> None:
    app = make_test_app()
    with TestClient(app, raise_server_exceptions=False) as tc:
        response = tc.post(f"/v1/sessions/{_UNKNOWN_UUID}/cancel")
    assert response.status_code == 404


async def test_post_message_503_when_concurrent_turn_cap_reached() -> None:
    """The global concurrent-turn cap (H6) maps to 503, distinct from the 409
    single-flight."""
    import asyncio

    import httpx

    from domain.events import ev_meta

    gate = asyncio.Event()  # never set — turns hang, holding their claims

    async def hung_run_turn(sid: str, text: str, *args: Any, **kwargs: Any) -> Any:
        yield ev_meta("t-1", sid, "model-x", "m-1", "um-1")
        await gate.wait()

    app, session_id = _known_session_app(run_turn_fn=hung_run_turn)
    app.state.settings.max_concurrent_turns = 1
    registry = app.state.turn_registry
    await registry.start("00000000-0000-4000-8000-0000000000aa", "hold the slot")

    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            resp = await client.post(
                f"/v1/sessions/{session_id}/messages", json={"text": "hello"}
            )
        assert resp.status_code == 503
        assert "capacity" in resp.json()["error"]["message"]
    finally:
        gate.set()
        await registry.cancel("00000000-0000-4000-8000-0000000000aa")


def test_post_message_422_for_invalid_edit_target() -> None:
    """replace_message_id that matches nothing → 422 (G3: pre-MVP2 turns and
    unknown ids are never edit targets)."""
    app, session_id = _known_session_app()
    with TestClient(app, raise_server_exceptions=False) as tc:
        response = tc.post(
            f"/v1/sessions/{session_id}/messages",
            json={"text": "edited", "replace_message_id": str(__import__("uuid").uuid4())},
        )
    assert response.status_code == 422
    body = response.json()
    assert "error" in body
