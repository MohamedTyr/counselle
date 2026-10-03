"""Route tests for `/v1/scholarships` and `/v1/admin/scholarships` (plan
§11 behaviours 8, 13, 20).

Hermetic: the SQL behaviour is pinned by `tests/app/scholarships/`. This
file covers the HTTP layer: which user id reaches the service, the auth
gate, the ETag/304, and which error becomes which envelope.
"""

from __future__ import annotations

import datetime as dt
import inspect
import re
from types import SimpleNamespace
from typing import Any
from unittest.mock import ANY, AsyncMock, call, patch
from uuid import UUID, uuid4

from fastapi import FastAPI, HTTPException
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from api.auth import current_active_user, current_superuser
from api.context import install_middleware
from api.ratelimit import _RATE_LIMITER_ATTR, SlidingWindowLimiter
from api.routes import scholarships, scholarships_admin
from api.users_db import UserDB
from app.scholarships.errors import (
    ScholarshipConflictError,
    ScholarshipNotFoundError,
    ScholarshipValidationError,
)
from app.scholarships.models import AdminScholarship, ScholarshipPublic

USER = UUID("00000000-0000-4000-8000-00000000aaaa")
ORIGIN = "http://testserver"
HEADERS = {"origin": ORIGIN}


def _user(*, superuser: bool = False) -> UserDB:
    return UserDB(
        id=USER,
        email="admin@counselle.test",
        hashed_password="x",
        is_active=True,
        is_superuser=superuser,
        is_verified=True,
    )


def _deny() -> None:
    raise HTTPException(403, "The user doesn't have enough privileges.")


def _app(*, auth: str = "superuser") -> FastAPI:
    """`auth` is "superuser", "user" (403 on admin routes) or "none"."""
    app = FastAPI()
    settings = SimpleNamespace(
        cors_origins=[ORIGIN],
        cookie_secure=False,
        workspace_writes_per_minute=240,
        jwt_secret="test-secret-" * 4,
        jwt_lifetime_seconds=3600,
        cookie_name="counselle_auth",
        password_min_length=8,
        email_provider="console",
        email_from="accounts@mail.acceptra.ai",
    )
    install_middleware(app, settings)
    app.include_router(scholarships.router, prefix="/v1")
    app.include_router(scholarships_admin.router, prefix="/v1")
    app.state.settings = settings
    app.state.runtime = SimpleNamespace(app_pool=object())
    setattr(app.state, _RATE_LIMITER_ATTR, SlidingWindowLimiter())
    if auth != "none":
        app.dependency_overrides[current_active_user] = lambda: _user(superuser=auth == "superuser")
        app.dependency_overrides[current_superuser] = (
            (lambda: _user(superuser=True)) if auth == "superuser" else _deny
        )
    return app


def _public() -> ScholarshipPublic:
    return ScholarshipPublic(
        id=uuid4(),
        created_at=dt.datetime.now(dt.UTC),
        name="Award",
        last_checked_on=dt.date(2026, 10, 1),
    )


def _admin_record() -> AdminScholarship:
    return AdminScholarship(
        id=uuid4(),
        created_at=dt.datetime.now(dt.UTC),
        updated_at=dt.datetime.now(dt.UTC),
        status="draft",
        version=3,
        updated_by_email=None,
    )


# --- behaviour 8: ETag ---------------------------------------------------------


def test_list_returns_items_and_304_on_matching_etag() -> None:
    client = TestClient(_app(auth="user"))
    with (
        patch("app.scholarships.service.published_vintage", AsyncMock(return_value="1:t:1")),
        patch("app.scholarships.service.list_published", AsyncMock(return_value=[_public()])),
    ):
        first = client.get("/v1/scholarships")
        again = client.get("/v1/scholarships", headers={"if-none-match": first.headers["etag"]})
    assert first.status_code == 200
    assert first.headers["cache-control"] == "private, no-cache"
    assert len(first.json()["items"]) == 1
    assert again.status_code == 304


# --- user id scoping -------------------------------------------------------------


def test_save_routes_use_the_authed_user() -> None:
    client = TestClient(_app(auth="user"))
    target = uuid4()
    with (
        patch("app.scholarships.service_saves.save", AsyncMock()) as save,
        patch("app.scholarships.service_saves.unsave", AsyncMock()) as unsave,
        patch("app.scholarships.service_saves.saved_ids", AsyncMock(return_value=[target])),
    ):
        assert client.put(f"/v1/scholarships/{target}/save", headers=HEADERS).status_code == 204
        assert client.delete(f"/v1/scholarships/{target}/save", headers=HEADERS).status_code == 204
        saved = client.get("/v1/scholarships/saved")
    save.assert_awaited_once_with(ANY, USER, target)
    unsave.assert_awaited_once_with(ANY, USER, target)
    assert saved.json() == {"ids": [str(target)]}


def test_save_of_unpublished_is_404_envelope() -> None:
    client = TestClient(_app(auth="user"))
    with patch(
        "app.scholarships.service_saves.save",
        AsyncMock(side_effect=ScholarshipNotFoundError("That scholarship was not found.")),
    ):
        response = client.put(f"/v1/scholarships/{uuid4()}/save", headers=HEADERS)
    assert response.status_code == 404
    assert response.json()["error"]["message"] == "That scholarship was not found."


def test_student_routes_are_401_signed_out() -> None:
    client = TestClient(_app(auth="none"))
    assert client.get("/v1/scholarships").status_code == 401
    assert client.get("/v1/scholarships/saved").status_code == 401


# --- behaviour 13: admin gate ----------------------------------------------------


def _admin_routes(app: FastAPI) -> list[tuple[str, str]]:
    pairs: list[tuple[str, str]] = []
    for route in app.routes:
        if not isinstance(route, APIRoute) or not route.path.startswith("/v1/admin/scholarships"):
            continue
        sig = inspect.signature(route.endpoint)
        path = route.path
        for name in re.findall(r"\{(\w+)\}", path):
            annotation = sig.parameters[name].annotation
            path = path.replace("{" + name + "}", str(uuid4()) if annotation is UUID else "1")
        pairs.extend((method, path) for method in sorted(route.methods - {"HEAD", "OPTIONS"}))
    return pairs


def test_every_admin_route_is_401_signed_out_and_403_for_students() -> None:
    routes = _admin_routes(_app())
    assert len(routes) == 7, routes
    with (
        TestClient(_app(auth="none"), raise_server_exceptions=False) as anonymous,
        TestClient(_app(auth="user"), raise_server_exceptions=False) as student,
    ):
        for method, path in routes:
            assert anonymous.request(method, path, headers=HEADERS).status_code == 401, path
            assert student.request(method, path, headers=HEADERS).status_code == 403, path


def test_superuser_create_and_get() -> None:
    client = TestClient(_app())
    record = _admin_record()
    with (
        patch("app.scholarships.service.create", AsyncMock(return_value=record)) as create,
        patch("app.scholarships.service.get", AsyncMock(return_value=record)),
    ):
        created = client.post("/v1/admin/scholarships", json={"name": "A"}, headers=HEADERS)
        fetched = client.get(f"/v1/admin/scholarships/{record.id}")
    assert created.status_code == 201
    assert create.call_args == call(ANY, ANY, USER)
    assert fetched.json()["version"] == 3


def test_admin_write_rejects_non_json_and_unknown_fields() -> None:
    client = TestClient(_app())
    form = client.post(
        "/v1/admin/scholarships",
        content="name=A",
        headers={**HEADERS, "content-type": "text/plain"},
    )
    unknown = client.post("/v1/admin/scholarships", json={"bogus": 1}, headers=HEADERS)
    unsafe = client.post(
        "/v1/admin/scholarships", json={"apply_url": "javascript:alert(1)"}, headers=HEADERS
    )
    assert form.status_code == 415
    assert unknown.status_code == 422
    assert unsafe.status_code == 422


# --- behaviour 20: envelopes -----------------------------------------------------


def _put(client: TestClient, error: Exception) -> Any:
    with patch("app.scholarships.service.update", AsyncMock(side_effect=error)):
        return client.put(
            f"/v1/admin/scholarships/{uuid4()}",
            json={"name": "A", "status": "published", "expected_version": 2},
            headers=HEADERS,
        )


def test_conflict_envelope_carries_current_version() -> None:
    response = _put(TestClient(_app()), ScholarshipConflictError(7))
    assert response.status_code == 409
    error = response.json()["error"]
    assert error["message"] == "Someone else changed this scholarship."
    assert error["current_version"] == 7
    assert "trace_id" in error


def test_publish_failure_envelope_carries_problems() -> None:
    response = _put(
        TestClient(_app()),
        ScholarshipValidationError("This scholarship isn't ready to publish.", ["award", "fresh"]),
    )
    assert response.status_code == 422
    assert response.json()["error"]["problems"] == ["award", "fresh"]


def test_plain_validation_envelope_has_no_problems() -> None:
    response = _put(
        TestClient(_app()), ScholarshipValidationError("Use the status action for this.")
    )
    assert response.status_code == 422
    assert "problems" not in response.json()["error"]
