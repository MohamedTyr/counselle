"""`PATCH /v1/onboarding` route tests: auth, user-scoping, malformed commands.

Mirrors the pattern in tests/api/test_profile_documents_memories_routes.py —
the real FastAPI app with the service function mocked, no live DB.
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth import current_active_user
from api.context import install_middleware
from api.ratelimit import _RATE_LIMITER_ATTR, SlidingWindowLimiter
from api.routes import onboarding
from app.onboarding import OnboardingProgress, OnboardingStateError
from tests.api.conftest import TEST_USER_ID, _test_user


def _app(*, authed: bool = True, workspace_writes_per_minute: int = 240) -> FastAPI:
    app = FastAPI()
    settings = SimpleNamespace(
        cors_origins=["*"],
        sse_keepalive_s=15,
        workspace_writes_per_minute=workspace_writes_per_minute,
    )
    install_middleware(app, settings)
    app.include_router(onboarding.router, prefix="/v1")
    app.state.settings = settings
    app.state.runtime = SimpleNamespace(app_pool=object())
    setattr(app.state, _RATE_LIMITER_ATTR, SlidingWindowLimiter())
    if authed:
        app.dependency_overrides[current_active_user] = _test_user
    return app


def _await_kwargs(mock: AsyncMock) -> Any:
    call = mock.await_args
    assert call is not None
    return call.kwargs, call.args


def _progress() -> OnboardingProgress:
    return OnboardingProgress(
        status="in_progress", current_step="basics", updated_at=datetime.now(UTC)
    )


def test_patch_onboarding_requires_auth() -> None:
    with TestClient(_app(authed=False), raise_server_exceptions=False) as client:
        response = client.patch("/v1/onboarding", json={"action": "start"})

    assert response.status_code == 401


def test_patch_onboarding_scopes_to_authenticated_user_id_only() -> None:
    service = AsyncMock(return_value=_progress())
    with (
        patch("api.routes.onboarding.update_onboarding_progress", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.patch(
            "/v1/onboarding",
            json={"action": "start", "user_id": "00000000-0000-4000-8000-000000000099"},
        )

    assert response.status_code == 200
    _, args = _await_kwargs(service)
    # positional call: (pool, user_id, command) — the authenticated id, never
    # anything the client could smuggle in through the body.
    assert args[1] == TEST_USER_ID
    assert args[1] != "00000000-0000-4000-8000-000000000099"


def test_patch_onboarding_returns_the_normalized_state() -> None:
    progress = _progress()
    service = AsyncMock(return_value=progress)
    with (
        patch("api.routes.onboarding.update_onboarding_progress", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.patch("/v1/onboarding", json={"action": "start"})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "in_progress"
    assert body["current_step"] == "basics"


def test_patch_onboarding_maps_state_error_to_422() -> None:
    service = AsyncMock(side_effect=OnboardingStateError("advance requires a step"))
    with (
        patch("api.routes.onboarding.update_onboarding_progress", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.patch("/v1/onboarding", json={"action": "advance"})

    assert response.status_code == 422


@pytest.mark.parametrize(
    "body",
    [
        {"action": "not-a-real-action"},
        {"action": "advance", "step": "not-a-real-step"},
        {},
    ],
)
def test_patch_onboarding_rejects_malformed_body_with_422(body: dict[str, object]) -> None:
    service = AsyncMock(return_value=_progress())
    with (
        patch("api.routes.onboarding.update_onboarding_progress", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.patch("/v1/onboarding", json=body)

    assert response.status_code == 422
    service.assert_not_awaited()


def test_patch_onboarding_requires_json_content_type() -> None:
    service = AsyncMock(return_value=_progress())
    with (
        patch("api.routes.onboarding.update_onboarding_progress", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.patch(
            "/v1/onboarding",
            content=b'{"action": "start"}',
            headers={"Content-Type": "text/plain"},
        )

    assert response.status_code == 415
