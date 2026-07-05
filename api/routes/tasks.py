"""Workspace task routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from api.auth import current_active_user
from api.deps import require_json
from api.ratelimit import workspace_write_rate_limit
from api.routes.workspace_common import map_workspace_errors, runtime_parts
from api.users_db import UserDB
from app.workspace.models import TaskCreate, TaskPatch, TaskStatus
from app.workspace.service_tasks import (
    archive_task,
    bulk_archive,
    bulk_update_status,
    create_task,
    list_tasks,
    restore_task,
    update_task,
)

router = APIRouter(tags=["workspace"])


class BulkStatusBody(BaseModel):
    ids: list[UUID]
    status: TaskStatus


class BulkArchiveBody(BaseModel):
    ids: list[UUID]


@router.get("/tasks")
async def list_tasks_route(
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, _, _ = runtime_parts(request)
    return await list_tasks(app_pool, user_id=user.id)


@router.post(
    "/tasks",
    status_code=201,
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def create_task_route(
    body: TaskCreate,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, _, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: create_task(
            app_pool, event_bus, user_id=user.id, actor="student", data=body
        )
    )


@router.patch(
    "/tasks/{task_id}",
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def update_task_route(
    task_id: UUID,
    body: TaskPatch,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, _, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: update_task(
            app_pool,
            event_bus,
            user_id=user.id,
            actor="student",
            task_id=task_id,
            data=body,
        )
    )


@router.delete(
    "/tasks/{task_id}",
    status_code=204,
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def archive_task_route(
    task_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> Response:
    app_pool, _, _, event_bus = runtime_parts(request)
    await map_workspace_errors(
        lambda: archive_task(
            app_pool, event_bus, user_id=user.id, actor="student", task_id=task_id
        )
    )
    return Response(status_code=204)


@router.post(
    "/tasks/{task_id}/restore",
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def restore_task_route(
    task_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, _, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: restore_task(
            app_pool, event_bus, user_id=user.id, actor="student", task_id=task_id
        )
    )


@router.post(
    "/tasks/bulk-status",
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def bulk_status_route(
    body: BulkStatusBody,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, _, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: bulk_update_status(
            app_pool,
            event_bus,
            user_id=user.id,
            actor="student",
            ids=body.ids,
            status=body.status,
        )
    )


@router.post(
    "/tasks/bulk-archive",
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def bulk_archive_route(
    body: BulkArchiveBody,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, _, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: bulk_archive(
            app_pool, event_bus, user_id=user.id, actor="student", ids=body.ids
        )
    )
