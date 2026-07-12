"""Workspace memory routes (Part C/F): list and student-initiated delete."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response

from api.auth import current_active_user
from api.ratelimit import workspace_write_rate_limit
from api.routes.workspace_common import map_workspace_errors, runtime_parts
from api.users_db import UserDB
from app.workspace.service_memory import archive_memory, list_memories

router = APIRouter(tags=["workspace"])


@router.get("/memories")
async def list_memories_route(
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, _ = runtime_parts(request)
    return await list_memories(app_pool, user_id=user.id)


@router.delete(
    "/memories/{memory_id}",
    status_code=204,
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def archive_memory_route(
    memory_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> Response:
    app_pool, _, event_bus = runtime_parts(request)
    await map_workspace_errors(
        lambda: archive_memory(
            app_pool, event_bus, user_id=user.id, actor="student", memory_id=memory_id
        )
    )
    return Response(status_code=204)
