"""AI verification and live-session enforcement at the mounted route boundary."""

from __future__ import annotations

import asyncio
import hashlib
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from api.auth import current_active_user
from api.context import install_middleware
from api.deps import owned_session
from api.routes import documents, sessions, workspace_events
from app.workspace.changes import WorkspaceEventBus, make_change_event
from domain.events import ev_delta
from tests.api.conftest import TEST_USER_ID, _test_user

_SESSION_ID = uuid4()


def _guarded_app(monkeypatch: pytest.MonkeyPatch) -> tuple[FastAPI, Mock, AsyncMock]:
    app = FastAPI()
    settings = SimpleNamespace(
        cors_origins=[],
        turns_per_hour=60,
        turns_per_day=300,
        workspace_writes_per_minute=240,
    )
    install_middleware(app, settings)
    app.state.settings = settings
    registry = Mock()
    app.state.turn_registry = registry
    app.state.runtime = SimpleNamespace(app_pool=Mock())
    app.include_router(sessions.router, prefix="/v1")
    app.include_router(documents.router, prefix="/v1")
    app.dependency_overrides[current_active_user] = lambda: replace(_test_user(), is_verified=False)
    app.dependency_overrides[owned_session] = lambda: {"user_id": str(TEST_USER_ID)}
    upload = AsyncMock()
    monkeypatch.setattr(documents, "upload_document", upload)
    return app, registry, upload


@pytest.mark.parametrize(
    "body",
    [
        {"text": "Help me pick schools"},
        {"text": "Make a plan", "goal_mode": True},
        {
            "text": "Review my essay",
            "surface": "essay",
            "essay_context": {"essay_id": str(uuid4())},
        },
        {"text": "My clarification answer", "in_reply_to": "pending-question"},
    ],
)
def test_unverified_user_cannot_start_any_agent_surface(monkeypatch, body):
    app, registry, upload = _guarded_app(monkeypatch)
    with TestClient(app) as client:
        response = client.post(f"/v1/sessions/{_SESSION_ID}/messages", json=body)
    assert response.status_code == 403
    assert "VERIFICATION" in response.text.upper() or "VERIFIED" in response.text.upper()
    assert registry.mock_calls == []
    upload.assert_not_awaited()


def test_unverified_user_cannot_steer_existing_run(monkeypatch):
    app, registry, _ = _guarded_app(monkeypatch)
    with TestClient(app) as client:
        response = client.post(f"/v1/sessions/{_SESSION_ID}/steer", json={"text": "Keep working"})
    assert response.status_code == 403
    assert registry.mock_calls == []


def test_unverified_user_cannot_trigger_document_summary(monkeypatch):
    app, _, upload = _guarded_app(monkeypatch)
    with TestClient(app) as client:
        response = client.post(
            "/v1/documents",
            headers={"Origin": "http://testserver"},
            data={"title": "My transcript", "doc_type": "transcript"},
            files={"file": ("transcript.pdf", b"%PDF-1.4 fake", "application/pdf")},
        )
    assert response.status_code == 403
    assert "VERIFICATION" in response.text.upper() or "VERIFIED" in response.text.upper()
    upload.assert_not_awaited()


def _stream_request(pool, *, registry=None, bus=None) -> Request:
    settings = SimpleNamespace(
        cookie_name="auth",
        jwt_lifetime_seconds=3600,
        auth_session_poll_seconds=0.005,
        sse_keepalive_s=15,
    )
    app = SimpleNamespace(
        state=SimpleNamespace(
            settings=settings,
            turn_registry=registry,
            runtime=SimpleNamespace(app_pool=pool, deps=SimpleNamespace(workspace_events=bus)),
        )
    )
    return Request(
        {
            "type": "http",
            "app": app,
            "query_string": b"",
            "headers": [(b"cookie", b"auth=opaque-test-token")],
        }
    )


def _session_row():
    now = datetime.now(UTC)
    return {
        "token_hash": hashlib.sha256(b"opaque-test-token").hexdigest(),
        "user_id": TEST_USER_ID,
        "created_at": now,
        "authenticated_at": now,
        "expires_at": now + timedelta(hours=1),
    }


async def test_chat_stream_route_terminates_on_revocation_and_releases_consumer():
    closed = asyncio.Event()

    async def events():
        try:
            yield ev_delta("private text"), 1
            await asyncio.Event().wait()
        finally:
            closed.set()

    pool = SimpleNamespace(fetchrow=AsyncMock(side_effect=[_session_row(), None]))
    request = _stream_request(pool, registry=SimpleNamespace(attach=lambda *_: events()))
    response = await sessions.stream_session(_SESSION_ID, request, _row={})
    stream = response.body_iterator
    first = await anext(stream)
    assert "private text" in first.data
    with pytest.raises(StopAsyncIteration):
        await asyncio.wait_for(anext(stream), timeout=1)
    assert closed.is_set()
    assert pool.fetchrow.await_count == 2


async def test_workspace_stream_route_terminates_on_revocation_and_unsubscribes(monkeypatch):
    bus = WorkspaceEventBus()
    pool = SimpleNamespace(fetchrow=AsyncMock(side_effect=[_session_row(), None]))
    request = _stream_request(pool, bus=bus)
    monkeypatch.setattr(request, "is_disconnected", AsyncMock(return_value=False))
    response = await workspace_events.workspace_events_route(request, user=_test_user())
    stream = response.body_iterator
    pending = asyncio.create_task(anext(stream))
    try:
        async with asyncio.timeout(1):
            while not bus._queues:
                await asyncio.sleep(0)
        change = make_change_event(
            change_id=1,
            actor="student",
            object_type="task",
            object_id=uuid4(),
            op="created",
        )
        bus.publish(TEST_USER_ID, change)
        first = await pending
        assert first.event == "task.created"
        with pytest.raises(StopAsyncIteration):
            await asyncio.wait_for(anext(stream), timeout=1)
        assert bus._queues == {}
        assert pool.fetchrow.await_count == 2
    finally:
        if not pending.done():
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
        await stream.aclose()
