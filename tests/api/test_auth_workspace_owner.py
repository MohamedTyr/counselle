"""Private workspace requests remain bound to the account shown in their tab."""

from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient

import api.auth as auth
from api.routes import profile, workspace_events
from api.users_db import UserDB


@pytest.fixture
def workspace_app(monkeypatch):
    user = UserDB(uuid4(), "cookie-owner@example.com", "hash", True, False, True)
    app = FastAPI()
    app.state.runtime = SimpleNamespace(
        app_pool=object(), deps=SimpleNamespace(workspace_events=Mock(), catalog=object())
    )
    app.state.settings = SimpleNamespace(sse_keepalive_s=15, workspace_writes_per_minute=240)
    app.dependency_overrides[auth._authenticated_active_user] = lambda: user
    app.dependency_overrides[auth._authenticated_superuser] = lambda: replace(
        user, is_superuser=True
    )
    app.include_router(profile.router, prefix="/v1")
    app.include_router(workspace_events.router, prefix="/v1")
    get_profile = AsyncMock(return_value={"private": "profile"})
    update_profile = AsyncMock(return_value={"saved": True})
    monkeypatch.setattr(profile, "get_profile", get_profile)
    monkeypatch.setattr(profile, "update_profile", update_profile)
    admin = Mock()

    @app.get("/admin")
    async def admin_route(user=Depends(auth.current_superuser)):
        admin(user.id)
        return {"id": str(user.id)}

    return SimpleNamespace(
        app=app, user=user, get_profile=get_profile, update_profile=update_profile, admin=admin
    )


@pytest.mark.parametrize(
    "path,method", [("/v1/profile", "GET"), ("/v1/profile", "PATCH"), ("/admin", "GET")]
)
@pytest.mark.parametrize("expected", ["other", "malformed", "empty"])
async def test_owner_mismatch_stops_private_reads_writes_and_admin(
    workspace_app, path, method, expected
):
    h = workspace_app
    value = {"other": str(uuid4()), "malformed": "not-a-uuid", "empty": ""}[expected]
    async with AsyncClient(transport=ASGITransport(app=h.app), base_url="http://test") as client:
        response = await client.request(
            method,
            path,
            headers={"X-Expected-User-Id": value},
            json={"basics": {"preferred_name": "Other account"}} if method == "PATCH" else None,
        )
    assert response.status_code == 409
    assert response.json() == {"detail": "ACCOUNT_CHANGED"}
    h.get_profile.assert_not_awaited()
    h.update_profile.assert_not_awaited()
    h.admin.assert_not_called()


@pytest.mark.parametrize("expected", ["matching", "absent"])
@pytest.mark.parametrize(
    "path,method", [("/v1/profile", "GET"), ("/v1/profile", "PATCH"), ("/admin", "GET")]
)
async def test_current_owner_and_legacy_clients_remain_supported(
    workspace_app, expected, path, method
):
    h = workspace_app
    headers = {"X-Expected-User-Id": str(h.user.id)} if expected == "matching" else {}
    async with AsyncClient(transport=ASGITransport(app=h.app), base_url="http://test") as client:
        response = await client.request(
            method,
            path,
            headers=headers,
            json={"basics": {"preferred_name": "Owner"}} if method == "PATCH" else None,
        )
    assert response.status_code == 200


@pytest.mark.parametrize("expected", ["other", "malformed", "empty"])
async def test_workspace_event_query_owner_rejected_before_stream(
    workspace_app, monkeypatch, expected
):
    h = workspace_app
    stream = Mock(side_effect=AssertionError("private stream must not open"))
    monkeypatch.setattr(workspace_events, "workspace_event_stream", stream)
    value = {"other": str(uuid4()), "malformed": "not-a-uuid", "empty": ""}[expected]
    async with AsyncClient(transport=ASGITransport(app=h.app), base_url="http://test") as client:
        response = await client.get("/v1/workspace/events", params={"expected_user_id": value})
    assert response.status_code == 409
    assert response.json() == {"detail": "ACCOUNT_CHANGED"}
    stream.assert_not_called()


async def test_expected_owner_query_is_not_a_global_header_substitute(workspace_app):
    h = workspace_app
    async with AsyncClient(transport=ASGITransport(app=h.app), base_url="http://test") as client:
        response = await client.get("/v1/profile", params={"expected_user_id": str(uuid4())})
    assert response.status_code == 200
    h.get_profile.assert_awaited_once()


@pytest.mark.parametrize("expected", ["absent", "matching", "other"])
async def test_me_discovers_cookie_owner_unless_explicitly_bound(
    workspace_app, monkeypatch, expected
):
    from api.routes import me

    h = workspace_app
    read_session = AsyncMock(return_value=None)
    pool = SimpleNamespace(fetchval=AsyncMock(return_value=None))
    h.app.state.runtime.app_pool = pool
    monkeypatch.setattr(me, "get_request_session", read_session)
    h.app.include_router(me.router, prefix="/v1")
    headers = (
        {}
        if expected == "absent"
        else {"X-Expected-User-Id": str(h.user.id if expected == "matching" else uuid4())}
    )
    async with AsyncClient(transport=ASGITransport(app=h.app), base_url="http://test") as client:
        response = await client.get("/v1/me", headers=headers)
    if expected == "other":
        assert response.status_code == 409
        read_session.assert_not_awaited()
        pool.fetchval.assert_not_awaited()
    else:
        assert response.status_code == 200
        assert response.json()["id"] == str(h.user.id)


@pytest.mark.parametrize("expected", ["absent", "matching"])
async def test_workspace_event_query_allows_current_owner(workspace_app, monkeypatch, expected):
    h = workspace_app

    async def empty_stream(*args, **kwargs):
        if False:
            yield

    stream = Mock(side_effect=empty_stream)
    monkeypatch.setattr(workspace_events, "workspace_event_stream", stream)
    monkeypatch.setattr(workspace_events, "stream_with_session", lambda request, source: source)
    params = {} if expected == "absent" else {"expected_user_id": str(h.user.id)}
    async with AsyncClient(transport=ASGITransport(app=h.app), base_url="http://test") as client:
        response = await client.get("/v1/workspace/events", params=params)
    assert response.status_code == 200
    stream.assert_called_once()
