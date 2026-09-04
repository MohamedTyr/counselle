"""Workspace essay routes."""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response

from api.auth import current_active_user
from api.deps import require_json
from api.ratelimit import workspace_write_rate_limit
from api.routes.workspace_common import map_workspace_errors, runtime_parts
from api.users_db import UserDB
from app.sessions import get_or_create_essay_session
from app.workspace.models import EssayCreate, EssayPatch
from app.workspace.service_essays import (
    archive_essay,
    create_essay,
    duplicate_essay,
    get_essay,
    list_essays,
    resolve_all_suggestions,
    resolve_suggestion,
    restore_essay,
    update_essay,
)
from domain.specs import SourceConfig

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
    "/essays/{essay_id}/suggestions/{suggestion_id}/accept",
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def accept_suggestion_route(
    essay_id: UUID,
    suggestion_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    """Apply one pending suggestion to the essay and drop it from the queue.

    422 when the suggestion is stale (its ``old_text`` no longer matches the
    essay uniquely); the essay is left untouched in that case. 404 when it was
    already accepted or rejected — resolved suggestions are removed, not
    tombstoned.
    """
    app_pool, catalog, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: resolve_suggestion(
            app_pool,
            catalog,
            event_bus,
            user_id=user.id,
            actor="student",
            essay_id=essay_id,
            suggestion_id=suggestion_id,
            accept=True,
        )
    )


@router.post(
    "/essays/{essay_id}/suggestions/{suggestion_id}/reject",
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def reject_suggestion_route(
    essay_id: UUID,
    suggestion_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    """Drop one pending suggestion without touching the essay's content."""
    app_pool, catalog, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: resolve_suggestion(
            app_pool,
            catalog,
            event_bus,
            user_id=user.id,
            actor="student",
            essay_id=essay_id,
            suggestion_id=suggestion_id,
            accept=False,
        )
    )


@router.post(
    "/essays/{essay_id}/suggestions/accept-all",
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def accept_all_suggestions_route(
    essay_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    """Apply every pending suggestion; returns ``{essay, applied, skipped}``.

    A suggestion that no longer applies is reported in ``skipped`` and stays
    pending — one stale item never blocks the rest.
    """
    app_pool, catalog, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: resolve_all_suggestions(
            app_pool,
            catalog,
            event_bus,
            user_id=user.id,
            actor="student",
            essay_id=essay_id,
            accept=True,
        )
    )


@router.post(
    "/essays/{essay_id}/suggestions/reject-all",
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def reject_all_suggestions_route(
    essay_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    """Clear the whole pending queue; same ``{essay, applied, skipped}`` shape,
    with ``skipped`` always empty (a rejection cannot fail)."""
    app_pool, catalog, event_bus = runtime_parts(request)
    return await map_workspace_errors(
        lambda: resolve_all_suggestions(
            app_pool,
            catalog,
            event_bus,
            user_id=user.id,
            actor="student",
            essay_id=essay_id,
            accept=False,
        )
    )


@router.post("/essays/{essay_id}/session")
async def essay_session_route(
    essay_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    """The essay's own durable chat thread — created on first call, returned
    unchanged after that (plan Part 0 C6).

    One thread per essay, enforced by a partial unique index rather than by
    client-side storage, so the conversation about an essay follows it to a
    different browser or device. These sessions are excluded from the main
    chat list. 404 when the essay is not this student's, archived, or gone —
    the ownership check lives in the service's own insert, not here.
    """
    app_pool, _catalog, _ = runtime_parts(request)
    settings = request.app.state.settings
    session_id = await map_workspace_errors(
        lambda: get_or_create_essay_session(
            app_pool,
            user_id=str(user.id),
            essay_id=essay_id,
            source_config=SourceConfig.defaults_from(settings).model_dump(mode="json"),
        )
    )
    return {"session_id": session_id}


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
