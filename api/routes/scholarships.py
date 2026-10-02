"""Student scholarship routes, `/v1/scholarships` (plan §6.2).

Thin HTTP over `app/scholarships/`. `user_id` only ever comes from
`Depends(current_active_user)`. `map_scholarship_errors` is shared with the
admin router.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Request, Response

from api.auth import current_active_user
from api.deps import EnvelopeError, etag_response
from api.ratelimit import workspace_write_rate_limit
from api.users_db import UserDB
from app.scholarships import service, service_saves
from app.scholarships.errors import (
    ScholarshipConflictError,
    ScholarshipError,
    ScholarshipNotFoundError,
    ScholarshipValidationError,
)
from app.scholarships.models import SavedIds, ScholarshipList

router = APIRouter(prefix="/scholarships", tags=["scholarships"])

_LIST_CACHE_CONTROL = "private, no-cache"


async def map_scholarship_errors[T](call: Callable[[], Awaitable[T]]) -> T:
    """Translate `app/scholarships/errors.py` into the error envelope."""
    try:
        return await call()
    except ScholarshipNotFoundError as exc:
        raise EnvelopeError(404, str(exc)) from exc
    except ScholarshipConflictError as exc:
        raise EnvelopeError(409, str(exc), extra={"current_version": exc.current_version}) from exc
    except ScholarshipValidationError as exc:
        extra = {"problems": exc.problems} if exc.problems is not None else None
        raise EnvelopeError(422, str(exc), extra=extra) from exc
    except ScholarshipError as exc:  # pragma: no cover - defensive: no other subclass
        raise EnvelopeError(422, str(exc) or "Invalid request.") from exc


def scholarship_pool(request: Request) -> Any:
    return request.app.state.runtime.app_pool


@router.get("")
async def list_scholarships_route(
    request: Request, _user: UserDB = Depends(current_active_user)
) -> Response:
    """Every published record, sorted by deadline then name. A refetch with
    the returned ETag is a 304."""
    pool = scholarship_pool(request)
    vintage = await service.published_vintage(pool)
    items = await service.list_published(pool)
    return etag_response(
        request,
        ScholarshipList(items=items),
        vintage=vintage,
        cache_control=_LIST_CACHE_CONTROL,
    )


@router.get("/saved")
async def saved_scholarships_route(
    request: Request, user: UserDB = Depends(current_active_user)
) -> SavedIds:
    return SavedIds(ids=await service_saves.saved_ids(scholarship_pool(request), user.id))


@router.put(
    "/{scholarship_id}/save",
    status_code=204,
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def save_scholarship_route(
    scholarship_id: UUID, request: Request, user: UserDB = Depends(current_active_user)
) -> Response:
    await map_scholarship_errors(
        lambda: service_saves.save(scholarship_pool(request), user.id, scholarship_id)
    )
    return Response(status_code=204)


@router.delete(
    "/{scholarship_id}/save",
    status_code=204,
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def unsave_scholarship_route(
    scholarship_id: UUID, request: Request, user: UserDB = Depends(current_active_user)
) -> Response:
    await service_saves.unsave(scholarship_pool(request), user.id, scholarship_id)
    return Response(status_code=204)
