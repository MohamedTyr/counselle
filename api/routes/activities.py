"""Workspace activities and honors routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from api.auth import current_active_user
from api.deps import require_json
from api.ratelimit import workspace_write_rate_limit
from api.routes.workspace_common import map_workspace_errors, runtime_parts
from api.users_db import UserDB
from app.workspace.models import ActivityCreate, ActivityPatch, HonorCreate, HonorPatch
from app.workspace.service_activities import (
    archive_activity,
    archive_honor,
    create_activity,
    create_honor,
    list_activities,
    list_honors,
    reorder_activities,
    reorder_honors,
    restore_activity,
    restore_honor,
    update_activity,
    update_honor,
)

router = APIRouter(tags=["workspace"])


class OrderBody(BaseModel):
    ids: list[UUID]


@router.get("/activities")
async def list_activities_route(
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, _ = runtime_parts(request)
    return await list_activities(app_pool, user_id=user.id)


@router.post(
    "/activities",
    status_code=201,
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def create_activity_route(
    body: ActivityCreate,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: create_activity(
            app_pool, event_bus, user_id=user.id, actor="student", data=body
        )
    )


@router.patch(
    "/activities/{activity_id}",
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def update_activity_route(
    activity_id: UUID,
    body: ActivityPatch,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: update_activity(
            app_pool,
            event_bus,
            user_id=user.id,
            actor="student",
            activity_id=activity_id,
            data=body,
        )
    )


@router.delete(
    "/activities/{activity_id}",
    status_code=204,
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def archive_activity_route(
    activity_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> Response:
    app_pool, _, event_bus = runtime_parts(request)
    await map_workspace_errors(
        lambda: archive_activity(
            app_pool,
            event_bus,
            user_id=user.id,
            actor="student",
            activity_id=activity_id,
        )
    )
    return Response(status_code=204)


@router.post(
    "/activities/{activity_id}/restore",
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def restore_activity_route(
    activity_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: restore_activity(
            app_pool,
            event_bus,
            user_id=user.id,
            actor="student",
            activity_id=activity_id,
        )
    )


@router.put(
    "/activities/order",
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def reorder_activities_route(
    body: OrderBody,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: reorder_activities(
            app_pool, event_bus, user_id=user.id, actor="student", ids=body.ids
        )
    )


@router.get("/honors")
async def list_honors_route(
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, _ = runtime_parts(request)
    return await list_honors(app_pool, user_id=user.id)


@router.post(
    "/honors",
    status_code=201,
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def create_honor_route(
    body: HonorCreate,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: create_honor(
            app_pool, event_bus, user_id=user.id, actor="student", data=body
        )
    )


@router.patch(
    "/honors/{honor_id}",
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def update_honor_route(
    honor_id: UUID,
    body: HonorPatch,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: update_honor(
            app_pool,
            event_bus,
            user_id=user.id,
            actor="student",
            honor_id=honor_id,
            data=body,
        )
    )


@router.delete(
    "/honors/{honor_id}",
    status_code=204,
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def archive_honor_route(
    honor_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> Response:
    app_pool, _, event_bus = runtime_parts(request)
    await map_workspace_errors(
        lambda: archive_honor(
            app_pool, event_bus, user_id=user.id, actor="student", honor_id=honor_id
        )
    )
    return Response(status_code=204)


@router.post(
    "/honors/{honor_id}/restore",
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def restore_honor_route(
    honor_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: restore_honor(
            app_pool, event_bus, user_id=user.id, actor="student", honor_id=honor_id
        )
    )


@router.put(
    "/honors/order",
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def reorder_honors_route(
    body: OrderBody,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: reorder_honors(
            app_pool, event_bus, user_id=user.id, actor="student", ids=body.ids
        )
    )
