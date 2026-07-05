"""Workspace application and school-search routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response

from api.auth import current_active_user
from api.deps import require_json
from api.ratelimit import workspace_write_rate_limit
from api.routes.workspace_common import map_workspace_errors, runtime_parts
from api.users_db import UserDB
from app.workspace.models import ApplicationCreate, ApplicationPatch
from app.workspace.service_applications import (
    add_application,
    archive_application,
    get_application_detail,
    list_applications,
    restore_application,
    search_schools,
    update_application,
)

router = APIRouter(tags=["workspace"])


@router.get("/schools/search")
async def search_schools_route(
    request: Request,
    q: str = Query(min_length=1),
    limit: int = Query(default=8, ge=1, le=25),
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, catalog, _, _ = runtime_parts(request)
    return await map_workspace_errors(
        lambda: search_schools(catalog, app_pool, user_id=user.id, query=q, limit=limit)
    )


@router.get("/applications")
async def list_applications_route(
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, catalog, _, _ = runtime_parts(request)
    return await list_applications(app_pool, catalog, user_id=user.id)


@router.post(
    "/applications",
    status_code=201,
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def add_application_route(
    body: ApplicationCreate,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, catalog, template, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: add_application(
            app_pool,
            catalog,
            event_bus,
            user_id=user.id,
            actor="student",
            data=body,
            template=template,
        )
    )


@router.get("/applications/{application_id}")
async def get_application_route(
    application_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, catalog, _, _ = runtime_parts(request)
    return await map_workspace_errors(
        lambda: get_application_detail(
            app_pool, catalog, user_id=user.id, application_id=application_id
        )
    )


@router.patch(
    "/applications/{application_id}",
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def update_application_route(
    application_id: UUID,
    body: ApplicationPatch,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, catalog, _, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: update_application(
            app_pool,
            catalog,
            event_bus,
            user_id=user.id,
            actor="student",
            application_id=application_id,
            data=body,
        )
    )


@router.delete(
    "/applications/{application_id}",
    status_code=204,
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def archive_application_route(
    application_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> Response:
    app_pool, _, _, event_bus = runtime_parts(request)
    await map_workspace_errors(
        lambda: archive_application(
            app_pool,
            event_bus,
            user_id=user.id,
            actor="student",
            application_id=application_id,
        )
    )
    return Response(status_code=204)


@router.post(
    "/applications/{application_id}/restore",
    status_code=204,
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def restore_application_route(
    application_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> Response:
    app_pool, _, _, event_bus = runtime_parts(request)
    await map_workspace_errors(
        lambda: restore_application(
            app_pool,
            event_bus,
            user_id=user.id,
            actor="student",
            application_id=application_id,
        )
    )
    return Response(status_code=204)
