"""Facts-page + Explore + Majors routes (plan §5.2/§5.3).

Mounted after `applications.router` (which owns `GET /v1/schools/search`)
and before the SPA catch-all (`api/main.py`). The facts route's `/facts`
suffix is a third path segment, distinct from `explore`/`majors`'s two, so
no request can bind to the wrong route regardless of mount order; FastAPI
would 422 a non-int `unitid` rather than silently falling through either way.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, Response

from api.auth import current_active_user
from api.deps import EnvelopeError, etag_response
from api.users_db import UserDB
from app.facts.explore_models import ExploreQuery, ExploreResponse, MajorsResponse
from app.facts.response_models import SchoolFactsResponse
from app.facts.service import get_school_facts
from app.facts.service_explore import run_explore, run_majors
from counselle_db.models import ServiceError

router = APIRouter(tags=["schools-facts"])


async def map_facts_errors[T](call: Callable[[], Awaitable[T]]) -> T:
    """`ServiceError` (an unknown unitid) -> 404; anything else propagates
    to the app's generic 500 handler (plan §5.2: a school with no crawl row
    is a 200 with `has_collegedata=false`, never a `ServiceError`)."""
    try:
        return await call()
    except ServiceError as exc:
        raise EnvelopeError(404, "That school is not in our database.") from exc


def _facts_vintage(facts: SchoolFactsResponse) -> str | None:
    """The ETag input for a facts response (Finding 8, Phase 2 review).

    `is_stale` depends on `observed_at` *and* wall-clock time against
    `facts_stale_days` (`domain/facts/state.py::is_stale`) -- it can flip
    with no change to `observed_at` at all. Folding it in here ensures
    crossing that boundary changes the ETag, so a client holding a cached
    copy from before the boundary doesn't get a 304 and keep rendering a
    freshness claim that has since gone stale. `observed_at=None` stays
    `None` -- `etag_response` never mints an ETag for "nothing observed yet"
    (see its own docstring)."""
    if facts.observed_at is None:
        return None
    return f"{facts.observed_at}:{facts.is_stale}"


@router.get("/schools/{unitid}/facts")
async def get_facts_route(
    request: Request,
    unitid: int,
    user: UserDB = Depends(current_active_user),
) -> Response:
    catalog = request.app.state.runtime.deps.catalog
    settings = request.app.state.settings
    facts = await map_facts_errors(lambda: get_school_facts(catalog, unitid, settings))
    return etag_response(
        request, facts, vintage=_facts_vintage(facts), cache_control="private, max-age=300"
    )


@router.get("/schools/explore")
async def explore_route(
    request: Request,
    response: Response,
    # `Annotated[ExploreQuery, Query()]`, not `= Depends()`: FastAPI's actual
    # "query parameter model" feature (0.115+). `Depends()` on a bare
    # `BaseModel` subclass makes FastAPI call the class as if it were a
    # dependency function, introspecting *pydantic's own generated
    # `__signature__`* for its params -- and for any `default_factory`
    # field, pydantic puts the display-only `_HAS_DEFAULT_FACTORY` sentinel
    # in that signature's default (it mimics stdlib dataclasses; the
    # factory is never meant to be read off `Signature.default`). FastAPI
    # took that sentinel as the literal default, so a request omitting the
    # param failed `ExploreQuery` validation on the raw sentinel -- this
    # route 500'd unconditionally. Worse, `Depends()`'s signature
    # introspection also strips `Annotated`/`Query()` metadata and treats
    # any non-scalar field (a `list[...]`) as a JSON *body* param, not
    # query -- so `?state=CA&state=NY` was silently dropped even once the
    # crash was worked around. `Query()` instead reads `ExploreQuery.model_fields`
    # directly (real `FieldInfo`s, default factories called correctly) and
    # binds every field -- scalars and repeated-list fields alike -- to the
    # query string, matching `majors_route`'s plain `Query()` params below.
    query: Annotated[ExploreQuery, Query()],
    user: UserDB = Depends(current_active_user),
) -> ExploreResponse:
    catalog = request.app.state.runtime.deps.catalog
    settings = request.app.state.settings
    response.headers["Cache-Control"] = "private, max-age=60"
    return await run_explore(catalog, query, settings)


@router.get("/schools/majors")
async def majors_route(
    request: Request,
    response: Response,
    q: str = Query(min_length=1),
    user: UserDB = Depends(current_active_user),
) -> MajorsResponse:
    catalog = request.app.state.runtime.deps.catalog
    response.headers["Cache-Control"] = "private, max-age=60"
    return await run_majors(catalog, q)
