"""Supplemental essays for the schools on the student's list (app.workspace.service_supplements)."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response

from api.auth import current_active_user
from api.ratelimit import workspace_write_rate_limit
from api.routes.workspace_common import map_workspace_errors, runtime_parts
from api.users_db import UserDB
from app.workspace.service_supplements import (
    acknowledge_prompt_change,
    list_supplements,
    start_supplement_essay,
)

router = APIRouter(tags=["workspace"])


@router.get("/supplements")
async def list_supplements_route(
    request: Request, user: UserDB = Depends(current_active_user)
) -> object:
    app_pool, _, _ = runtime_parts(request)
    return await list_supplements(app_pool, user_id=user.id)


@router.post(
    "/applications/{application_id}/supplements/{key}/essay",
    status_code=201,
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def start_supplement_essay_route(
    application_id: UUID, key: str, request: Request, user: UserDB = Depends(current_active_user)
) -> object:
    app_pool, _, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: start_supplement_essay(
            app_pool,
            event_bus,
            user_id=user.id,
            actor="student",
            application_id=application_id,
            key=key,
        )
    )


@router.post(
    "/essays/{essay_id}/prompt-change/acknowledge",
    status_code=204,
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def acknowledge_prompt_change_route(
    essay_id: UUID, request: Request, user: UserDB = Depends(current_active_user)
) -> Response:
    app_pool, _, event_bus = runtime_parts(request)
    await map_workspace_errors(
        lambda: acknowledge_prompt_change(app_pool, event_bus, user_id=user.id, essay_id=essay_id)
    )
    return Response(status_code=204)
