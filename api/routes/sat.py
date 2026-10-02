"""SAT practice routes, `/v1/sat/...` (plan.md §4.1, §4.2).

Thin HTTP over `app/sat/service_*.py`; every function takes `user_id` only
from `Depends(current_active_user)` — never from a path/query/body value —
so authorization lives in the tool, not the model (CLAUDE.md "Writing the
agent"). Own error mapping (`map_sat_errors` over `app/sat/errors.py`), not
`workspace_common.map_workspace_errors`: a SAT 404/422 must never carry the
workspace surface's "Workspace item not found." sentence (precedent
`app/cds/errors.py` + `api/routes/cds_admin.py::map_cds_errors`). Own rate
buckets (`api/ratelimit.py::sat_write_rate_limit` /
`sat_read_rate_limit`) so SAT traffic never shares a budget with workspace
writes.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import Field

from api.auth import current_active_user
from api.deps import EnvelopeError, content_disposition, etag_response, require_json
from api.ratelimit import sat_read_rate_limit, sat_write_rate_limit
from api.users_db import UserDB
from app.sat import service_attempts, service_progress, service_questions
from app.sat.errors import SatError, SatNotFoundError, SatValidationError
from app.sat.models import (
    SatAttemptOut,
    SatAttemptSubmit,
    SatCounts,
    SatImportResult,
    SatSessionRow,
    SatStatsResponse,
    SatSubmitResult,
    question_public_from_domain,
)
from app.sat.taxonomy_loader import load_taxonomy
from domain.sat.taxonomy import Taxonomy
from domain.sat.types import SolvedStatus

router = APIRouter(prefix="/sat", tags=["sat"])

#: `sat_questions.score_band`'s own range (migration 0021: `CHECK (score_band
#: BETWEEN 1 AND 7)`) -- bounding each `bands` item here means an
#: out-of-smallint-range or garbage value 422s at the FastAPI boundary
#: instead of reaching `q.score_band = ANY($2::smallint[])` unguarded and
#: raising an unmapped asyncpg error (`map_sat_errors` only translates
#: `SatError` subclasses, so that would otherwise surface as a 500).
_SatBand = Annotated[int, Field(ge=1, le=7)]
_MAX_BANDS = 7

#: The taxonomy holds 29 skill codes (`domain/sat/taxonomy.py`) -- 32 is a
#: round ceiling above that, on `/session`'s `skills` filter, for the same
#: reason `bands` above is capped: an unbounded list query param is an easy
#: way to force an oversized `= ANY($n::text[])` array against
#: `sat_questions` for no legitimate filtering purpose.
_MAX_SKILLS = 32

_EMPTY_BANDS: list[int] = []
_EMPTY_SKILLS: list[str] = []
_TAXONOMY_CACHE_CONTROL = "private, max-age=86400"
_IMPORT_TOO_LARGE_MESSAGE = "That file is too large to import."


async def map_sat_errors[T](call: Callable[[], Awaitable[T]]) -> T:
    """Translate `app/sat/errors.py` into the project's error envelope
    (plan §4.1; precedent `api/routes/cds_admin.py::map_cds_errors`)."""
    try:
        return await call()
    except SatNotFoundError as exc:
        raise EnvelopeError(404, str(exc) or "That question was not found.") from exc
    except SatValidationError as exc:
        raise EnvelopeError(422, str(exc) or "Invalid request.") from exc
    except SatError as exc:  # pragma: no cover - defensive: no other subclass exists today
        raise EnvelopeError(422, str(exc) or "Invalid request.") from exc


def _pool(request: Request) -> Any:
    return request.app.state.runtime.app_pool


async def _sat_import_body_size_guard(request: Request) -> None:
    """413 against `sat_import_max_bytes` from the declared `Content-Length`
    before the body is read (plan §4.6) — a chunked upload declaring none
    falls through to the post-read check in `import_progress_route`."""
    settings = request.app.state.settings
    declared = request.headers.get("content-length", "").strip()
    if declared.isdigit() and int(declared) > settings.sat_import_max_bytes:
        raise EnvelopeError(413, _IMPORT_TOO_LARGE_MESSAGE)


def _today_query(today: date | None) -> date:
    """`today` defaults to the server's UTC date when omitted, matching the
    device-local semantics the plan describes (§4.2, §4.3): the caller is
    expected to pass its own local date; a missing one is not a client bug
    worth 422-ing over, since export/stats degrade gracefully to UTC."""
    return today if today is not None else datetime.now(UTC).date()


@router.get("/taxonomy")
async def get_taxonomy_route(response: Response) -> Taxonomy:
    """Modules -> domains -> skills, band tiers, section labels (plan §4.2,
    X6). Static content — cached a day, private (auth still required)."""
    response.headers["Cache-Control"] = _TAXONOMY_CACHE_CONTROL
    return load_taxonomy()


@router.get("/counts")
async def get_counts_route(
    request: Request,
    bands: list[_SatBand] = Query(default=_EMPTY_BANDS, max_length=_MAX_BANDS),
    status: SolvedStatus = "all",
    exclude_bluebook: bool = False,
    user: UserDB = Depends(current_active_user),
) -> SatCounts:
    """`{skill_cd: n}` for all 29 skills, zero-filled (plan §4.2, §4.5)."""
    return await service_questions.get_counts(
        _pool(request),
        user.id,
        bands=bands,
        status=status,
        exclude_bluebook=exclude_bluebook,
    )


@router.get("/session")
async def get_session_route(
    request: Request,
    question: str | None = None,
    skills: list[str] = Query(default=_EMPTY_SKILLS, max_length=_MAX_SKILLS),
    bands: list[_SatBand] = Query(default=_EMPTY_BANDS, max_length=_MAX_BANDS),
    status: SolvedStatus = "all",
    exclude_bluebook: bool = False,
    user: UserDB = Depends(current_active_user),
) -> SatSessionRow | list[SatSessionRow]:
    """The launched session as light rows, or one row for `?question=<id>`
    (plan §4.2, P0.4) — an id lookup, not a filtered list, and it ignores
    `retired_at` so a deep link keeps working after a bank refresh."""
    if question is not None:
        return await map_sat_errors(
            lambda: service_questions.get_session_row(_pool(request), user.id, question)
        )
    return await service_questions.list_session(
        _pool(request),
        user.id,
        skills=skills,
        bands=bands,
        status=status,
        exclude_bluebook=exclude_bluebook,
    )


@router.get("/questions/{question_id}", dependencies=[Depends(sat_read_rate_limit)])
async def get_question_route(
    question_id: str,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> Response:
    """One question without `correct_answers`/`rationale` (plan §4.2) —
    weak ETag + 304 keyed on `content_sha256`, and read-limited (ADR 0044
    Risk R0: the one enumerable, licensed corpus this codebase serves)."""
    question = await map_sat_errors(
        lambda: service_questions.get_question(_pool(request), question_id)
    )
    public = question_public_from_domain(question)
    return etag_response(
        request,
        public,
        vintage=question.content_sha256,
        cache_control="private, max-age=300",
    )


@router.post(
    "/questions/{question_id}/attempts",
    dependencies=[Depends(require_json), Depends(sat_write_rate_limit)],
)
async def submit_attempt_route(
    question_id: str,
    body: SatAttemptSubmit,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> SatSubmitResult:
    """Grade + record in one round trip; retry-safe on `client_attempt_id`
    (plan §4.3)."""
    return await map_sat_errors(
        lambda: service_attempts.submit(
            _pool(request),
            user.id,
            question_id,
            client_attempt_id=body.client_attempt_id,
            answer=body.answer,
            time_spent_seconds=body.time_spent_seconds,
            local_date=body.local_date,
        )
    )


@router.get("/questions/{question_id}/attempts")
async def get_attempt_history_route(
    question_id: str,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> list[SatAttemptOut]:
    """The student's own history for one question, oldest first (plan §4.2)."""
    return await service_attempts.get_attempt_history(_pool(request), user.id, question_id)


@router.put("/bookmarks/{question_id}", status_code=204)
async def set_bookmark_route(
    question_id: str,
    request: Request,
    _rate_limit: None = Depends(sat_write_rate_limit),
    user: UserDB = Depends(current_active_user),
) -> Response:
    """Idempotent set, not a toggle (plan §4.2)."""
    await service_attempts.set_bookmark(_pool(request), user.id, question_id)
    return Response(status_code=204)


@router.delete("/bookmarks/{question_id}", status_code=204)
async def clear_bookmark_route(
    question_id: str,
    request: Request,
    _rate_limit: None = Depends(sat_write_rate_limit),
    user: UserDB = Depends(current_active_user),
) -> Response:
    """Idempotent clear, not a toggle (plan §4.2)."""
    await service_attempts.clear_bookmark(_pool(request), user.id, question_id)
    return Response(status_code=204)


@router.get("/stats")
async def get_stats_route(
    request: Request,
    today: date | None = None,
    user: UserDB = Depends(current_active_user),
) -> SatStatsResponse:
    """`UserStats` (liprep's exact shape) + the activity heatmap (plan
    §4.2, §4.4)."""
    return await service_progress.get_stats(_pool(request), user.id, today=_today_query(today))


@router.get("/progress/export")
async def export_progress_route(
    request: Request,
    today: date | None = None,
    user: UserDB = Depends(current_active_user),
) -> Response:
    """The `.liprep` v1 export, filenamed `<today>.liprep` (plan §4.2) — a
    GET that only reads the caller's own rows, never cached."""
    resolved_today = _today_query(today)
    payload = await service_progress.export_progress(
        _pool(request), user.id, now=datetime.now(UTC)
    )
    return Response(
        content=payload,
        media_type="application/json",
        headers={
            "Content-Disposition": content_disposition(f"{resolved_today.isoformat()}.liprep"),
            "Cache-Control": "no-store",
        },
    )


@router.put(
    "/progress",
    dependencies=[
        Depends(_sat_import_body_size_guard),
        Depends(require_json),
        Depends(sat_write_rate_limit),
    ],
)
async def import_progress_route(
    request: Request,
    today: date | None = None,
    user: UserDB = Depends(current_active_user),
) -> SatImportResult:
    """Import = replace, one transaction (plan §4.6). The declared
    `Content-Length` is checked by `_sat_import_body_size_guard` before the
    body is read; this second check covers a chunked upload that declared
    none."""
    settings = request.app.state.settings
    body = await request.body()
    if len(body) > settings.sat_import_max_bytes:
        raise EnvelopeError(413, _IMPORT_TOO_LARGE_MESSAGE)
    return await map_sat_errors(
        lambda: service_progress.import_progress(
            _pool(request),
            user.id,
            data=body,
            today=_today_query(today),
            now=datetime.now(UTC),
        )
    )


@router.delete("/progress", status_code=204)
async def reset_progress_route(
    request: Request,
    _rate_limit: None = Depends(sat_write_rate_limit),
    user: UserDB = Depends(current_active_user),
) -> Response:
    """Reset: attempts + bookmarks only (plan §4.2, A14)."""
    await service_progress.reset_progress(_pool(request), user.id)
    return Response(status_code=204)


__all__ = ["router"]
