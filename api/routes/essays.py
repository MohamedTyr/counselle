"""Workspace essay routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response

from api.auth import current_active_user
from api.deps import require_json
from api.ratelimit import workspace_write_rate_limit
from api.routes.workspace_common import map_workspace_errors, runtime_parts
from api.users_db import UserDB
from app.workspace.models import EssayCreate, EssayPatch
from app.workspace.service_essays import (
    archive_essay,
    create_essay,
    duplicate_essay,
    get_essay,
    list_essays,
    restore_essay,
    update_essay,
)

router = APIRouter(tags=["workspace"])


@router.get("/essays")
async def list_essays_route(
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, catalog, _ = runtime_parts(request)
    return await list_essays(app_pool, catalog, user_id=user.id)


@router.post(
    "/essays",
    status_code=201,
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def create_essay_route(
    body: EssayCreate,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, catalog, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: create_essay(
            app_pool, catalog, event_bus, user_id=user.id, actor="student", data=body
        )
    )


@router.get("/essays/{essay_id}")
async def get_essay_route(
    essay_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, catalog, _ = runtime_parts(request)
    return await map_workspace_errors(
        lambda: get_essay(app_pool, catalog, user_id=user.id, essay_id=essay_id)
    )


@router.patch(
    "/essays/{essay_id}",
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def update_essay_route(
    essay_id: UUID,
    body: EssayPatch,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, catalog, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: update_essay(
            app_pool,
            catalog,
            event_bus,
            user_id=user.id,
            actor="student",
            essay_id=essay_id,
            data=body,
        )
    )


@router.delete(
    "/essays/{essay_id}",
    status_code=204,
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def archive_essay_route(
    essay_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> Response:
    app_pool, _, event_bus = runtime_parts(request)
    await map_workspace_errors(
        lambda: archive_essay(
            app_pool, event_bus, user_id=user.id, actor="student", essay_id=essay_id
        )
    )
    return Response(status_code=204)


@router.post(
    "/essays/{essay_id}/restore",
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def restore_essay_route(
    essay_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, catalog, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: restore_essay(
            app_pool,
            catalog,
            event_bus,
            user_id=user.id,
            actor="student",
            essay_id=essay_id,
        )
    )


@router.post(
    "/essays/{essay_id}/duplicate",
    status_code=201,
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def duplicate_essay_route(
    essay_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, catalog, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: duplicate_essay(
            app_pool,
            catalog,
            event_bus,
            user_id=user.id,
            actor="student",
            essay_id=essay_id,
        )
    )
