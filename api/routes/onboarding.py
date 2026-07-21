"""Onboarding progress route (README §8, plan `03-implementation.md` §19.3).

A thin authenticated `PATCH /v1/onboarding`: progress is UI flow state, not
student Profile data, so — unlike `/v1/profile` — there is no workspace change
row or SSE event here.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from api.auth import current_active_user
from api.deps import EnvelopeError, require_json
from api.ratelimit import workspace_write_rate_limit
from api.users_db import UserDB
from app.onboarding import OnboardingCommand, OnboardingStateError, update_onboarding_progress

router = APIRouter(tags=["onboarding"])


@router.patch(
    "/onboarding",
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def update_onboarding_route(
    body: OnboardingCommand,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool = request.app.state.runtime.app_pool
    try:
        return await update_onboarding_progress(app_pool, user.id, body)
    except OnboardingStateError as exc:
        raise EnvelopeError(422, str(exc)) from exc
