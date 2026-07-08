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
    _FakeSupervisor,
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
    app.state.mcp_supervisor = _FakeSupervisor()
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
                "list_type": "Target",
                "round": "RD",
            },
        )
        assert create.status_code == 201, create.text
        application_id = create.json()["application"]["id"]
        # Seeding no longer creates a starter checklist (change 11): zero
        # tasks, one supplement essay slot.
        assert create.json()["seeded"]["task_ids"] == []
        assert len(create.json()["seeded"]["essay_ids"]) == 1

        listed = await client.get("/v1/applications")
        assert listed.status_code == 200
        applications_body = listed.json()
        assert len(applications_body) == 1
        assert applications_body[0]["id"] == application_id
        assert applications_body[0]["progress"] == {"completed": 0, "total": 0}

        task_list = await client.get("/v1/tasks")
        assert task_list.status_code == 200
        assert task_list.json() == []

        created_task = await client.post(
            "/v1/tasks",
            json={"application_id": application_id, "title": "Request transcript"},
        )
        assert created_task.status_code == 201, created_task.text
        task_id = created_task.json()["id"]

        completed = await client.patch(f"/v1/tasks/{task_id}", json={"status": "done"})
        assert completed.status_code == 200
        assert completed.json()["status"] == "done"

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
            json={"unitid": unitid, "list_type": "Target", "round": "RD"},
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
