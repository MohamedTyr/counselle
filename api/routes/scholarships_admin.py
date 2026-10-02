"""Scholarship admin routes, `/v1/admin/scholarships` (plan §6.3).

Every route is gated by `current_superuser` at router level, so a signed-out
caller gets 401 and a non-superuser 403 before any 404 (as in
`admin_facts.py`). Admin access is granted only by
`scripts/promote_admin.py`.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, Request

from api.auth import current_superuser
from api.deps import require_json
from api.ratelimit import workspace_write_rate_limit
from api.routes.scholarships import map_scholarship_errors, scholarship_pool
from api.users_db import UserDB
from app.scholarships import service
from app.scholarships.models import (
    AdminScholarship,
    RevisionOut,
    ScholarshipCreateIn,
    ScholarshipUpdateIn,
    StatusChangeIn,
)

router = APIRouter(
    prefix="/admin/scholarships",
    tags=["admin-scholarships"],
    dependencies=[Depends(current_superuser)],
)

_WRITE = [Depends(require_json), Depends(workspace_write_rate_limit)]


@router.get("")
async def list_admin_scholarships_route(request: Request) -> list[AdminScholarship]:
    """Every status, newest edit first."""
    return await service.list_all(scholarship_pool(request))


@router.get("/{scholarship_id}")
async def get_admin_scholarship_route(scholarship_id: UUID, request: Request) -> AdminScholarship:
    return await map_scholarship_errors(
        lambda: service.get(scholarship_pool(request), scholarship_id)
    )


@router.post("", status_code=201, dependencies=_WRITE)
async def create_scholarship_route(
    body: ScholarshipCreateIn, request: Request, user: UserDB = Depends(current_superuser)
) -> AdminScholarship:
    return await map_scholarship_errors(
        lambda: service.create(scholarship_pool(request), body, user.id)
    )


@router.put("/{scholarship_id}", dependencies=_WRITE)
async def update_scholarship_route(
    scholarship_id: UUID,
    body: ScholarshipUpdateIn,
    request: Request,
    user: UserDB = Depends(current_superuser),
) -> AdminScholarship:
    """Full replacement of the editable fields plus status, so "Save and
    publish" is one PUT."""
    return await map_scholarship_errors(
        lambda: service.update(scholarship_pool(request), scholarship_id, body, user.id)
    )


@router.post("/{scholarship_id}/status", dependencies=_WRITE)
async def change_scholarship_status_route(
    scholarship_id: UUID,
    body: StatusChangeIn,
    request: Request,
    user: UserDB = Depends(current_superuser),
) -> AdminScholarship:
    return await map_scholarship_errors(
        lambda: service.change_status(scholarship_pool(request), scholarship_id, body, user.id)
    )


@router.post("/{scholarship_id}/checked", dependencies=[Depends(workspace_write_rate_limit)])
async def mark_scholarship_checked_route(
    scholarship_id: UUID, request: Request, user: UserDB = Depends(current_superuser)
) -> AdminScholarship:
    """The "Mark checked today" action."""
    return await map_scholarship_errors(
        lambda: service.mark_checked(scholarship_pool(request), scholarship_id, user.id)
    )


@router.get("/{scholarship_id}/revisions")
async def scholarship_revisions_route(scholarship_id: UUID, request: Request) -> list[RevisionOut]:
    return await map_scholarship_errors(
        lambda: service.revisions(scholarship_pool(request), scholarship_id)
    )
