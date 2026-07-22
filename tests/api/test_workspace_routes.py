"""Phase 3 workspace route tests."""

from __future__ import annotations

import asyncio
import json
from collections.abc import MutableMapping
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sse_starlette import ServerSentEvent

from api.auth import current_active_user
from api.context import install_middleware
from api.ratelimit import _RATE_LIMITER_ATTR, SlidingWindowLimiter
from api.routes import activities, applications, essays, tasks, workspace_events
from app.workspace.changes import WorkspaceEventBus, make_change_event
from app.workspace.models import (
    Activity,
    ApplicationAddResult,
    ApplicationView,
    Rollup,
    Task,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)
from tests.api.conftest import TEST_USER_ID, _test_user

_UNKNOWN_UUID = "00000000-0000-4000-8000-000000000001"


def _app(*, authed: bool = True, workspace_writes_per_minute: int = 240) -> FastAPI:
    app = FastAPI()
    settings = SimpleNamespace(
        cors_origins=["*"],
        sse_keepalive_s=15,
        workspace_writes_per_minute=workspace_writes_per_minute,
    )
    install_middleware(app, settings)
    app.include_router(applications.router, prefix="/v1")
    app.include_router(tasks.router, prefix="/v1")
    app.include_router(essays.router, prefix="/v1")
    app.include_router(activities.router, prefix="/v1")
    app.include_router(workspace_events.router, prefix="/v1")
    app.state.settings = settings
    app.state.runtime = SimpleNamespace(
        app_pool=object(),
        deps=SimpleNamespace(
            catalog=object(),
            workspace_events=WorkspaceEventBus(),
        ),
    )
    setattr(app.state, _RATE_LIMITER_ATTR, SlidingWindowLimiter())
    if authed:
        app.dependency_overrides[current_active_user] = _test_user
    return app


def _application_view(application_id: UUID | None = None, *, completed: int = 0) -> ApplicationView:
    return ApplicationView(
        id=application_id or uuid4(),
        user_id=TEST_USER_ID,
        school_unitid=166027,
        status="Considering",
        list_type="Target",
        round="RD",
        deadline=None,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
        school_name="Harvard University",
        school_city="Cambridge",
        school_state="MA",
        website_url="https://harvard.edu",
        progress=Rollup(completed=completed, total=6),
        essays=Rollup(completed=0, total=1),
    )


def _task(task_id: UUID | None = None, *, status: str = "todo") -> Task:
    return Task(
        id=task_id or uuid4(),
        user_id=TEST_USER_ID,
        title="Request transcript",
        status=status,  # type: ignore[arg-type]
        category="form",
        priority="med",
        assignee="student",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


def _activity(activity_id: UUID | None = None) -> Activity:
    return Activity(
        id=activity_id or uuid4(),
        user_id=TEST_USER_ID,
        sort_order=0,
        position="Founder",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


async def _call_workspace_events_until_first_body(
    app: FastAPI, *, headers: dict[str, str] | None = None
) -> tuple[int, dict[str, str], str]:
    messages: list[MutableMapping[str, Any]] = []
    body_seen = asyncio.Event()
    request_sent = False
    raw_headers = [(b"host", b"testserver")]
    for name, value in (headers or {}).items():
        raw_headers.append((name.lower().encode(), value.encode()))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/v1/workspace/events",
        "raw_path": b"/v1/workspace/events",
        "query_string": b"",
        "headers": raw_headers,
        "client": ("testclient", 50000),
        "server": ("testserver", 80),
        "root_path": "",
    }

    async def receive() -> dict[str, Any]:
        nonlocal request_sent
        if not request_sent:
            request_sent = True
            return {"type": "http.request", "body": b"", "more_body": False}
        await body_seen.wait()
        return {"type": "http.disconnect"}

    async def send(message: MutableMapping[str, Any]) -> None:
        messages.append(message)
        if message["type"] == "http.response.body" and message.get("body"):
            body_seen.set()

    await asyncio.wait_for(app(scope, receive, send), timeout=1)
    start = next(message for message in messages if message["type"] == "http.response.start")
    body = next(
        message["body"]
        for message in messages
        if message["type"] == "http.response.body" and message.get("body")
    )
    response_headers = {key.decode().lower(): value.decode() for key, value in start["headers"]}
    return int(start["status"]), response_headers, body.decode()


async def _publish_after_workspace_subscription(
    app: FastAPI, *, event: Any, user_id: UUID = TEST_USER_ID
) -> None:
    bus = app.state.runtime.deps.workspace_events
    for _ in range(100):
        if bus._queues.get(user_id):
            bus.publish(user_id, event)
            return
        await asyncio.sleep(0.01)
    raise AssertionError("workspace SSE subscription was not registered")


def test_workspace_route_requires_auth() -> None:
    with TestClient(_app(authed=False), raise_server_exceptions=False) as client:
        response = client.get("/v1/applications")

    assert response.status_code == 401


def test_unknown_workspace_item_maps_to_404() -> None:
    with (
        patch(
            "api.routes.applications.get_application_detail",
            new=AsyncMock(side_effect=WorkspaceNotFoundError()),
        ),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.get(f"/v1/applications/{_UNKNOWN_UUID}")

    assert response.status_code == 404
    assert response.json()["error"]["message"] == "Workspace item not found."


@pytest.mark.parametrize(
    ("patch_target", "method", "path", "json_body"),
    [
        (
            "api.routes.applications.search_schools",
            "get",
            "/v1/schools/search?q=Harvard",
            None,
        ),
        (
            "api.routes.applications.update_application",
            "patch",
            f"/v1/applications/{_UNKNOWN_UUID}",
            {"status": "Applying"},
        ),
        (
            "api.routes.applications.archive_application",
            "delete",
            f"/v1/applications/{_UNKNOWN_UUID}",
            None,
        ),
        (
            "api.routes.applications.restore_application",
            "post",
            f"/v1/applications/{_UNKNOWN_UUID}/restore",
            None,
        ),
        (
            "api.routes.tasks.update_task",
            "patch",
            f"/v1/tasks/{_UNKNOWN_UUID}",
            {"title": "Request transcript"},
        ),
        (
            "api.routes.tasks.archive_task",
            "delete",
            f"/v1/tasks/{_UNKNOWN_UUID}",
            None,
        ),
        (
            "api.routes.tasks.restore_task",
            "post",
            f"/v1/tasks/{_UNKNOWN_UUID}/restore",
            None,
        ),
        (
            "api.routes.tasks.bulk_update_status",
            "post",
            "/v1/tasks/bulk-status",
            {"ids": [_UNKNOWN_UUID], "status": "done"},
        ),
        (
            "api.routes.tasks.bulk_archive",
            "post",
            "/v1/tasks/bulk-archive",
            {"ids": [_UNKNOWN_UUID]},
        ),
        (
            "api.routes.essays.get_essay",
            "get",
            f"/v1/essays/{_UNKNOWN_UUID}",
            None,
        ),
        (
            "api.routes.essays.update_essay",
            "patch",
            f"/v1/essays/{_UNKNOWN_UUID}",
            {"title": "Personal statement"},
        ),
        (
            "api.routes.essays.archive_essay",
            "delete",
            f"/v1/essays/{_UNKNOWN_UUID}",
            None,
        ),
        (
            "api.routes.essays.restore_essay",
            "post",
            f"/v1/essays/{_UNKNOWN_UUID}/restore",
            None,
        ),
        (
            "api.routes.essays.duplicate_essay",
            "post",
            f"/v1/essays/{_UNKNOWN_UUID}/duplicate",
            None,
        ),
        (
            "api.routes.activities.update_activity",
            "patch",
            f"/v1/activities/{_UNKNOWN_UUID}",
            {"position": "Founder"},
        ),
        (
            "api.routes.activities.archive_activity",
            "delete",
            f"/v1/activities/{_UNKNOWN_UUID}",
            None,
        ),
        (
            "api.routes.activities.restore_activity",
            "post",
            f"/v1/activities/{_UNKNOWN_UUID}/restore",
            None,
        ),
        (
            "api.routes.activities.reorder_activities",
            "put",
            "/v1/activities/order",
            {"ids": [_UNKNOWN_UUID]},
        ),
        (
            "api.routes.activities.update_honor",
            "patch",
            f"/v1/honors/{_UNKNOWN_UUID}",
            {"title": "National Merit"},
        ),
        (
            "api.routes.activities.archive_honor",
            "delete",
            f"/v1/honors/{_UNKNOWN_UUID}",
            None,
        ),
        (
            "api.routes.activities.restore_honor",
            "post",
            f"/v1/honors/{_UNKNOWN_UUID}/restore",
            None,
        ),
        (
            "api.routes.activities.reorder_honors",
            "put",
            "/v1/honors/order",
            {"ids": [_UNKNOWN_UUID]},
        ),
    ],
)
def test_workspace_foreign_or_unknown_surfaces_map_to_404_never_403(
    patch_target: str,
    method: str,
    path: str,
    json_body: dict[str, Any] | None,
) -> None:
    with (
        patch(patch_target, new=AsyncMock(side_effect=WorkspaceNotFoundError())),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        request = getattr(client, method)
        response = request(path) if json_body is None else request(path, json=json_body)

    assert response.status_code == 404
    assert response.status_code != 403
    assert response.json()["error"]["message"] == "Workspace item not found."


def test_body_route_without_json_content_type_returns_415() -> None:
    with TestClient(_app(), raise_server_exceptions=False) as client:
        response = client.post(
            "/v1/tasks",
            content='{"title":"Request transcript"}',
            headers={"Content-Type": "text/plain"},
        )

    assert response.status_code == 415
    assert response.json()["error"]["message"] == "Content-Type must be application/json."


def test_bad_enum_stays_pydantic_422() -> None:
    with TestClient(_app(), raise_server_exceptions=False) as client:
        response = client.post(
            "/v1/applications",
            json={"unitid": 166027, "cycle_year": 2027, "list_type": "Maybe", "round": "RD"},
        )

    assert response.status_code == 422


def test_scholarship_deadline_round_is_rejected() -> None:
    with TestClient(_app(), raise_server_exceptions=False) as client:
        response = client.post(
            "/v1/applications",
            json={
                "unitid": 166027,
                "cycle_year": 2027,
                "list_type": "Target",
                "round": "Scholarship deadline",
            },
        )

    assert response.status_code == 422


@pytest.mark.parametrize("round_value", ["EA", "ED", "ED2", "REA", "RD", "Rolling", "Priority"])
def test_new_round_values_are_accepted(round_value: str) -> None:
    service = AsyncMock(
        return_value=ApplicationAddResult(
            application=_application_view(),
        )
    )
    with (
        patch("api.routes.applications.add_application", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.post(
            "/v1/applications",
            json={
                "unitid": 166027,
                "cycle_year": 2027,
                "list_type": "Target",
                "round": round_value,
            },
        )

    assert response.status_code == 201


@pytest.mark.parametrize(
    "status_value",
    [
        "Considering",
        "Applying",
        "Submitted",
        "Deferred",
        "Accepted",
        "Enrolled",
        "Rejected",
        "Waitlisted",
        "Withdrawn",
    ],
)
def test_new_status_values_are_accepted_on_patch(status_value: str) -> None:
    service = AsyncMock(return_value=_application_view())
    with (
        patch("api.routes.applications.update_application", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.patch(
            f"/v1/applications/{_UNKNOWN_UUID}",
            json={"status": status_value},
        )

    assert response.status_code == 200


def test_task_category_interview_is_accepted_on_patch() -> None:
    service = AsyncMock(return_value=(_task(), _task()))
    with (
        patch("api.routes.tasks.update_task", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.patch(
            f"/v1/tasks/{_UNKNOWN_UUID}",
            json={"category": "interview"},
        )

    assert response.status_code == 200


def test_duplicate_active_school_maps_to_409() -> None:
    with (
        patch(
            "api.routes.applications.add_application",
            new=AsyncMock(
                side_effect=WorkspaceValidationError("school is already active on this list")
            ),
        ),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.post(
            "/v1/applications",
            json={"unitid": 166027, "cycle_year": 2027, "list_type": "Target", "round": "RD"},
        )

    assert response.status_code == 409
    assert "already active" in response.json()["error"]["message"]


def test_workspace_write_rate_limit_returns_429_with_retry_after() -> None:
    app = _app(workspace_writes_per_minute=1)
    with (
        patch(
            "api.routes.activities.create_activity",
            new=AsyncMock(return_value=_activity()),
        ),
        TestClient(app, raise_server_exceptions=False) as client,
    ):
        first = client.post("/v1/activities", json={"position": "Founder"})
        second = client.post("/v1/activities", json={"position": "Tutor"})

    assert first.status_code == 201
    assert second.status_code == 429
    assert int(second.headers["Retry-After"]) >= 1
    assert "workspace updates" in second.json()["error"]["message"]


def test_application_add_route_passes_runtime_parts_and_actor() -> None:
    service = AsyncMock(
        return_value=ApplicationAddResult(
            application=_application_view(),
        )
    )
    with (
        patch("api.routes.applications.add_application", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.post(
            "/v1/applications",
            json={"unitid": 166027, "cycle_year": 2027, "list_type": "Target", "round": "RD"},
        )

    assert response.status_code == 201
    call = service.await_args
    assert call is not None
    _, _, event_bus = call.args[:3]
    kwargs = call.kwargs
    assert isinstance(event_bus, WorkspaceEventBus)
    assert kwargs["user_id"] == TEST_USER_ID
    assert kwargs["actor"] == "student"


async def test_workspace_sse_encoding_replay_and_subscription(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = _app()
    request = SimpleNamespace(
        app=app,
        is_disconnected=AsyncMock(side_effect=[False, False]),
    )
    user = _test_user()
    bus = app.state.runtime.deps.workspace_events
    replayed = make_change_event(
        change_id=7,
        actor="student",
        object_type="task",
        object_id=uuid4(),
        op="updated",
    )
    live = make_change_event(
        change_id=8,
        actor="student",
        object_type="essay",
        object_id=uuid4(),
        op="created",
    )

    async def fake_replay(pool: object, *, user_id: UUID, after_id: int, limit: int) -> list[Any]:
        assert pool is app.state.runtime.app_pool
        assert user_id == TEST_USER_ID
        assert after_id == 6
        assert limit == 1000
        return [replayed]

    monkeypatch.setattr(workspace_events, "replay_changes", fake_replay)

    stream = workspace_events.workspace_event_stream(request, user, bus, 6)
    first = await stream.__anext__()
    assert isinstance(first, ServerSentEvent)
    assert first.id == "7"
    assert first.event == "task.updated"

    async def next_event() -> ServerSentEvent:
        return await anext(stream)

    publish_task: asyncio.Task[ServerSentEvent] = asyncio.create_task(next_event())
    await asyncio.sleep(0)
    bus.publish(TEST_USER_ID, live)
    second = await publish_task
    await cast(Any, stream).aclose()

    assert second.id == "8"
    assert second.event == "essay.created"
    assert isinstance(second.data, str)
    payload = json.loads(second.data)
    assert payload["data"]["object_type"] == "essay"


async def test_workspace_sse_subscribes_before_replay_and_drains_race_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = _app()
    request = SimpleNamespace(
        app=app,
        is_disconnected=AsyncMock(return_value=False),
    )
    user = _test_user()
    bus = app.state.runtime.deps.workspace_events
    race_event = make_change_event(
        change_id=11,
        actor="student",
        object_type="task",
        object_id=uuid4(),
        op="updated",
    )

    async def fake_replay(pool: object, *, user_id: UUID, after_id: int, limit: int) -> list[Any]:
        assert after_id == 10
        bus.publish(user_id, race_event)
        return []

    monkeypatch.setattr(workspace_events, "replay_changes", fake_replay)

    stream = workspace_events.workspace_event_stream(request, user, bus, 10)
    delivered = await asyncio.wait_for(anext(stream), timeout=1)
    await cast(Any, stream).aclose()

    assert delivered.id == "11"
    assert delivered.event == "task.updated"
    assert bus._queues == {}


async def test_workspace_sse_dedupes_change_present_in_replay_and_live_queue(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = _app()
    request = SimpleNamespace(
        app=app,
        is_disconnected=AsyncMock(return_value=True),
    )
    user = _test_user()
    bus = app.state.runtime.deps.workspace_events
    duplicated = make_change_event(
        change_id=12,
        actor="student",
        object_type="essay",
        object_id=uuid4(),
        op="updated",
    )

    async def fake_replay(pool: object, *, user_id: UUID, after_id: int, limit: int) -> list[Any]:
        bus.publish(user_id, duplicated)
        return [duplicated]

    monkeypatch.setattr(workspace_events, "replay_changes", fake_replay)

    stream = workspace_events.workspace_event_stream(request, user, bus, 10)
    first = await asyncio.wait_for(anext(stream), timeout=1)
    with pytest.raises(StopAsyncIteration):
        await anext(stream)
    await cast(Any, stream).aclose()

    assert first.id == "12"
    assert first.event == "essay.updated"
    assert bus._queues == {}


async def test_workspace_sse_replays_more_than_one_page_without_silent_loss(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    app = _app()
    request = SimpleNamespace(
        app=app,
        is_disconnected=AsyncMock(return_value=True),
    )
    user = _test_user()
    bus = app.state.runtime.deps.workspace_events
    object_id = uuid4()
    events = [
        make_change_event(
            change_id=change_id,
            actor="student",
            object_type="task",
            object_id=object_id,
            op="updated",
        )
        for change_id in range(1, 1006)
    ]
    replay_after_ids: list[int] = []

    async def fake_replay(pool: object, *, user_id: UUID, after_id: int, limit: int) -> list[Any]:
        assert pool is app.state.runtime.app_pool
        assert user_id == TEST_USER_ID
        assert limit == 1000
        replay_after_ids.append(after_id)
        return [event for event in events if event.id > after_id][:limit]

    monkeypatch.setattr(workspace_events, "replay_changes", fake_replay)

    stream = workspace_events.workspace_event_stream(request, user, bus, 0)
    delivered_ids: list[int] = []
    for _ in range(1005):
        event = await anext(stream)
        assert event.id is not None
        delivered_ids.append(int(event.id))
    await cast(Any, stream).aclose()

    assert delivered_ids == list(range(1, 1006))
    assert replay_after_ids == [0, 1000]
    assert bus._queues == {}


async def test_workspace_events_route_replays_missed_rows_only_with_last_event_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    old = make_change_event(
        change_id=40,
        actor="student",
        object_type="task",
        object_id=uuid4(),
        op="created",
    )
    replayed = make_change_event(
        change_id=42,
        actor="student",
        object_type="task",
        object_id=uuid4(),
        op="updated",
    )
    seen: dict[str, Any] = {}

    async def fake_replay(pool: object, *, user_id: UUID, after_id: int, limit: int) -> list[Any]:
        seen["pool"] = pool
        seen["user_id"] = user_id
        seen["after_id"] = after_id
        seen["limit"] = limit
        return [old, replayed]

    monkeypatch.setattr(workspace_events, "replay_changes", fake_replay)

    app = _app()
    status, headers, frame = await _call_workspace_events_until_first_body(
        app,
        headers={"Last-Event-ID": "41"},
    )

    assert status == 200
    assert headers["content-type"].startswith("text/event-stream")
    assert seen["user_id"] == TEST_USER_ID
    assert seen["after_id"] == 41
    assert seen["limit"] == 1000
    assert seen["pool"] is app.state.runtime.app_pool
    assert "id: 42" in frame
    assert f"id: {old.id}" not in frame
    assert "event: task.updated" in frame
    assert '"object_type":"task"' in frame


async def test_workspace_events_route_without_header_emits_live_only_not_replay(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    historical = make_change_event(
        change_id=42,
        actor="student",
        object_type="task",
        object_id=uuid4(),
        op="updated",
    )
    live = make_change_event(
        change_id=43,
        actor="student",
        object_type="activity",
        object_id=uuid4(),
        op="created",
    )

    app = _app()
    replay = AsyncMock(return_value=[historical])
    monkeypatch.setattr(workspace_events, "replay_changes", replay)

    request_task = asyncio.create_task(_call_workspace_events_until_first_body(app))
    await _publish_after_workspace_subscription(app, event=live)
    status, _, frame = await request_task

    assert status == 200
    assert "id: 43" in frame
    assert "event: activity.created" in frame
    assert "id: 42" not in frame
    replay.assert_not_awaited()


async def test_workspace_events_route_malformed_last_event_id_replays_from_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    replayed = make_change_event(
        change_id=41,
        actor="student",
        object_type="task",
        object_id=uuid4(),
        op="updated",
    )
    seen: dict[str, Any] = {}

    async def fake_replay(pool: object, *, user_id: UUID, after_id: int, limit: int) -> list[Any]:
        seen["after_id"] = after_id
        return [replayed]

    monkeypatch.setattr(workspace_events, "replay_changes", fake_replay)

    status, _, frame = await _call_workspace_events_until_first_body(
        _app(),
        headers={"Last-Event-ID": "not-an-int"},
    )

    assert status == 200
    assert seen["after_id"] == 0
    assert "id: 41" in frame
    assert "event: task.updated" in frame


async def test_workspace_events_route_future_last_event_id_does_not_starve_live_events(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    live = make_change_event(
        change_id=44,
        actor="student",
        object_type="activity",
        object_id=uuid4(),
        op="created",
    )
    replay = AsyncMock(return_value=[])
    monkeypatch.setattr(workspace_events, "replay_changes", replay)

    app = _app()
    request_task = asyncio.create_task(
        _call_workspace_events_until_first_body(
            app,
            headers={"Last-Event-ID": "999999999"},
        )
    )
    await _publish_after_workspace_subscription(app, event=live)
    status, _, frame = await request_task

    assert status == 200
    replay.assert_awaited_once()
    replay_call = replay.await_args
    assert replay_call is not None
    assert replay_call.kwargs["after_id"] == 0
    assert "id: 44" in frame
    assert "event: activity.created" in frame


def test_parse_last_change_id_is_safe() -> None:
    assert workspace_events.parse_last_change_id("42") == 42
    assert workspace_events.parse_last_change_id("0") == 0
    assert workspace_events.parse_last_change_id(None) is None
    assert workspace_events.parse_last_change_id("-1") == 0
    assert workspace_events.parse_last_change_id("not-an-int") == 0
    assert workspace_events.parse_last_change_id("999999999") == 0
