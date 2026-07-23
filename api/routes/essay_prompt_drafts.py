"""Workspace essay prompt draft routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response

from api.auth import current_active_user
from api.deps import require_json
from api.ratelimit import workspace_write_rate_limit
from api.routes.workspace_common import map_workspace_errors, runtime_parts
from api.users_db import UserDB
from app.workspace.models import EssayPromptDraftConvert, EssayPromptDraftCreate
from app.workspace.service_essay_prompt_drafts import (
    archive_essay_prompt_draft,
    convert_essay_prompt_draft,
    create_essay_prompt_draft,
    list_essay_prompt_drafts,
    restore_essay_prompt_draft,
)

router = APIRouter(tags=["workspace"])


@router.get("/essay-prompt-drafts")
async def list_essay_prompt_drafts_route(
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, catalog, _ = runtime_parts(request)
    return await list_essay_prompt_drafts(app_pool, catalog, user_id=user.id)


@router.post(
    "/essay-prompt-drafts",
    status_code=201,
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def create_essay_prompt_draft_route(
    body: EssayPromptDraftCreate,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, catalog, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: create_essay_prompt_draft(
            app_pool, catalog, event_bus, user_id=user.id, actor="student", data=body
        )
    )


@router.delete(
    "/essay-prompt-drafts/{draft_id}",
    status_code=204,
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def archive_essay_prompt_draft_route(
    draft_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> Response:
    app_pool, _, event_bus = runtime_parts(request)
    await map_workspace_errors(
        lambda: archive_essay_prompt_draft(
            app_pool, event_bus, user_id=user.id, actor="student", draft_id=draft_id
        )
    )
    return Response(status_code=204)


@router.post(
    "/essay-prompt-drafts/{draft_id}/restore",
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def restore_essay_prompt_draft_route(
    draft_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, catalog, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: restore_essay_prompt_draft(
            app_pool, catalog, event_bus, user_id=user.id, actor="student", draft_id=draft_id
        )
    )


@router.post(
    "/essay-prompt-drafts/{draft_id}/convert",
    status_code=201,
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def convert_essay_prompt_draft_route(
    draft_id: UUID,
    body: EssayPromptDraftConvert,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, catalog, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: convert_essay_prompt_draft(
            app_pool,
            catalog,
            event_bus,
            user_id=user.id,
            actor="student",
            draft_id=draft_id,
            data=body,
        )
    )
