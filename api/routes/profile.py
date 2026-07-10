"""Workspace profile routes (Part A/F): one row per student, lazy-created."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from api.auth import current_active_user
from api.deps import require_json
from api.ratelimit import workspace_write_rate_limit
from api.routes.workspace_common import runtime_parts
from api.users_db import UserDB
from app.workspace.models import ProfilePatch
from app.workspace.service_profile import get_profile, update_profile

router = APIRouter(tags=["workspace"])


@router.get("/profile")
async def get_profile_route(
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, _, _ = runtime_parts(request)
    return await get_profile(app_pool, user_id=user.id)


@router.patch(
    "/profile",
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def update_profile_route(
    body: ProfilePatch,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, _, event_bus = runtime_parts(request)
    return await update_profile(
        app_pool, event_bus, user_id=user.id, actor="student", data=body
    )
