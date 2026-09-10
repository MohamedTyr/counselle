"""Live DB route gate for Phase 3 workspace API wiring."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any, cast
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import FastAPI

from api.auth import current_active_user
from api.context import install_middleware
from api.ratelimit import _RATE_LIMITER_ATTR, SlidingWindowLimiter
from api.routes import activities, applications, essays, tasks, workspace_events
from api.users_db import UserDB
from app.turns import TurnRegistry
from tests.api.conftest import (
    _FakeReconciler,
    _test_user,
    ensure_test_user,
)

pytestmark = pytest.mark.live_db


def _workspace_live_app(runtime: Any, user: UserDB) -> FastAPI:
    from config.settings import get_settings

    settings = get_settings()
    app = FastAPI(title="Counselle-Workspace-Live-Test")
    install_middleware(app, settings)
    app.include_router(applications.router, prefix="/v1")
    app.include_router(tasks.router, prefix="/v1")
    app.include_router(essays.router, prefix="/v1")
    app.include_router(activities.router, prefix="/v1")
    app.include_router(workspace_events.router, prefix="/v1")
    app.state.settings = settings
    app.state.runtime = runtime
    app.state.reconciler = _FakeReconciler()
    app.state.turn_registry = TurnRegistry(
        deps=runtime.deps, graph=runtime.graph, settings=settings
    )
    setattr(app.state, _RATE_LIMITER_ATTR, SlidingWindowLimiter())
    app.dependency_overrides[current_active_user] = lambda: user
    return app


@pytest_asyncio.fixture
async def workspace_user(test_runtime: Any) -> AsyncIterator[UserDB]:
    user = _test_user()
    user.id = uuid4()
    user.email = f"{user.id}@workspace-routes.test"
    await ensure_test_user(test_runtime.app_pool, user)
    try:
        yield user
    finally:
        async with test_runtime.app_pool.acquire() as conn:
            await conn.execute("DELETE FROM counselle.users WHERE id = $1", user.id)


def _first_unitid(runtime: Any) -> int:
    return int(sorted(runtime.deps.catalog.school_names)[0])


async def test_add_school_list_complete_task_rollup_moves(
    test_runtime: Any,
    workspace_user: UserDB,
) -> None:
    import httpx

    app = _workspace_live_app(test_runtime, workspace_user)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        create = await client.post(
            "/v1/applications",
            json={
                "unitid": _first_unitid(test_runtime),
                "cycle_year": 2027,
                "list_type": "Target",
                "round": "RD",
            },
        )
        assert create.status_code == 201, create.text
        application_id = create.json()["application"]["id"]
        assert set(create.json()) == {"application"}
        assert create.json()["application"]["cycle_year"] == 2027

        listed = await client.get("/v1/applications")
        assert listed.status_code == 200
        applications_body = listed.json()
        assert len(applications_body) == 1
        assert applications_body[0]["id"] == application_id
        assert applications_body[0]["progress"] == {"completed": 0, "total": 0}

        task_list = await client.get("/v1/tasks")
        assert task_list.status_code == 200
        assert task_list.json() == []

        essay_list = await client.get("/v1/essays")
        assert essay_list.status_code == 200
        assert essay_list.json() == []

        created_task = await client.post(
            "/v1/tasks",
            json={"application_id": application_id, "title": "Request transcript"},
        )
        assert created_task.status_code == 201, created_task.text
        task_id = created_task.json()["id"]

        completed = await client.patch(
            f"/v1/tasks/{task_id}", json={"done_at": "2027-01-01T00:00:00Z"}
        )
        assert completed.status_code == 200
        assert completed.json()["status"] == "done"
        assert completed.json()["done_at"] is not None

        moved = await client.get("/v1/applications")
        assert moved.status_code == 200
        assert moved.json()[0]["progress"] == {"completed": 1, "total": 1}


async def test_workspace_sse_replay_returns_route_events(
    test_runtime: Any,
    workspace_user: UserDB,
) -> None:
    import httpx

    app = _workspace_live_app(test_runtime, workspace_user)
    unitid = _first_unitid(test_runtime)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/applications",
            json={
                "unitid": unitid,
                "cycle_year": 2027,
                "list_type": "Target",
                "round": "RD",
            },
        )
        assert created.status_code == 201, created.text
        async with test_runtime.app_pool.acquire() as conn:
            max_id = await conn.fetchval(
                "SELECT max(id) FROM counselle.workspace_changes WHERE user_id = $1",
                workspace_user.id,
            )

        # The route generator is infinite after replay; consume it through the
        # helper to avoid a permanently open ASGI response in the test client.
        request = type(
            "Request",
            (),
            {
                "app": app,
                "is_disconnected": AsyncMock(return_value=True),
            },
        )()
        bus = test_runtime.deps.workspace_events
        stream = workspace_events.workspace_event_stream(
            request, workspace_user, bus, int(max_id) - 1
        )
        event = await stream.__anext__()
        await cast(Any, stream).aclose()

        assert event.id == str(max_id)
        assert event.event in {"task.created", "essay.created", "application.created"}


def _doc(text: str) -> dict[str, Any]:
    return {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
    }


async def _essay_with_suggestion(
    runtime: Any, user: UserDB, text: str, old_text: str, new_text: str
) -> tuple[Any, str]:
    """Create an essay carrying one pending suggestion, straight through the services."""
    from app.workspace.changes import WorkspaceEventBus
    from app.workspace.models import EssayCreate
    from app.workspace.service_essays import append_suggestions, create_essay

    essay = await create_essay(
        runtime.app_pool,
        runtime.deps.catalog,
        WorkspaceEventBus(),
        user_id=user.id,
        actor="student",
        data=EssayCreate(title="Draft", content=_doc(text)),
    )
    suggestion_id = str(uuid4())
    await append_suggestions(
        runtime.app_pool,
        WorkspaceEventBus(),
        user_id=user.id,
        actor="counselle",
        essay_id=essay.id,
        suggestions=[
            {
                "id": suggestion_id,
                "old_text": old_text,
                "new_text": new_text,
                "old_text_plain": old_text,
                "new_text_plain": new_text,
                "rationale": "tightens the line",
                "actor": "counselle",
                "created_at": "2026-09-04T12:00:00+00:00",
                "essay_version_at_creation": essay.updated_at.isoformat(),
                "turn_message_id": str(uuid4()),
            }
        ],
    )
    return essay, suggestion_id


async def test_accept_suggestion_routes_return_essay_applied_and_skipped(
    test_runtime: Any,
    workspace_user: UserDB,
) -> None:
    import httpx

    app = _workspace_live_app(test_runtime, workspace_user)
    essay, suggestion_id = await _essay_with_suggestion(
        test_runtime, workspace_user, "The board hissed.", "hissed", "hissed back"
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        accepted = await client.post(
            f"/v1/essays/{essay.id}/suggestions/{suggestion_id}/accept"
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["suggestions"] == []

        # Already resolved: suggestions are removed, never tombstoned.
        again = await client.post(f"/v1/essays/{essay.id}/suggestions/{suggestion_id}/accept")
        assert again.status_code == 404, again.text

        batch = await client.post(f"/v1/essays/{essay.id}/suggestions/reject-all")
        assert batch.status_code == 200, batch.text
        assert set(batch.json()) == {"essay", "applied", "skipped"}
        assert batch.json() == {
            "essay": batch.json()["essay"],
            "applied": 0,
            "skipped": [],
        }


async def test_accepting_a_stale_suggestion_over_http_is_422(
    test_runtime: Any,
    workspace_user: UserDB,
) -> None:
    """422, not 409 — ``map_workspace_errors`` reserves 409 for "already active"."""
    import httpx

    app = _workspace_live_app(test_runtime, workspace_user)
    essay, suggestion_id = await _essay_with_suggestion(
        test_runtime, workspace_user, "The board hissed.", "hissed", "hissed back"
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        typed = await client.patch(
            f"/v1/essays/{essay.id}", json={"content": _doc("The panel murmured.")}
        )
        assert typed.status_code == 200, typed.text

        stale = await client.post(f"/v1/essays/{essay.id}/suggestions/{suggestion_id}/accept")
        assert stale.status_code == 422, stale.text

        unchanged = await client.get(f"/v1/essays/{essay.id}")
        assert unchanged.json()["content"] == _doc("The panel murmured.")
        assert [s["id"] for s in unchanged.json()["suggestions"]] == [suggestion_id]


async def test_essay_session_route_is_idempotent_and_scoped(
    test_runtime: Any,
    workspace_user: UserDB,
) -> None:
    import httpx

    app = _workspace_live_app(test_runtime, workspace_user)
    essay, _ = await _essay_with_suggestion(
        test_runtime, workspace_user, "The board hissed.", "hissed", "hissed back"
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        first = await client.post(f"/v1/essays/{essay.id}/session")
        assert first.status_code == 200, first.text
        second = await client.post(f"/v1/essays/{essay.id}/session")
        assert second.json()["session_id"] == first.json()["session_id"]

        missing = await client.post(f"/v1/essays/{uuid4()}/session")
        assert missing.status_code == 404, missing.text
