"""Calendar routes: every school's published deadlines for the current cycle."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Request, Response

from api.auth import current_active_user
from api.users_db import UserDB
from app.facts.calendar import SchoolDeadlineCalendar, school_deadline_calendar

router = APIRouter(tags=["calendar"])


@router.get("/calendar/school-deadlines")
async def school_deadlines_route(
    request: Request,
    response: Response,
    user: UserDB = Depends(current_active_user),
) -> SchoolDeadlineCalendar:
    catalog = request.app.state.runtime.deps.catalog
    settings = request.app.state.settings
    # No ETag: staleness moves with the clock, and the catalog has no vintage.
    response.headers["Cache-Control"] = "private, max-age=3600"
    return await school_deadline_calendar(
        catalog,
        cycle_year=settings.current_admissions_cycle_year,
        stale_days=settings.facts_stale_days,
        now=datetime.now(UTC),
    )
