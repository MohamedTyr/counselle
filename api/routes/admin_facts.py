"""The school-data admin router (plan §5.5, D12): `GET /v1/admin/facts/status`,
`GET /v1/admin/facts/unmapped`, `POST /v1/admin/facts/passes` — the minimal
bird's-eye view of the CollegeData facts crawler that replaces the parked CDS
admin nav entry (ADR 0038, `PARKED.md`).

Every route is gated by `current_superuser` at router level, mirroring
`api/routes/cds_admin.py:45-49`. Thin translation only: `status` assembles
`app.facts.service_admin.get_facts_status`; `unmapped` pages the
live `cds_library.school_facts` population via `adapters/admin_facts_queries`
(this module's own adapter, kept separate from
`adapters/facts_queries.py` — see that file's docstring); `passes` enqueues
through `adapters/facts_jobs_store.enqueue_now`, the same function `--once`
uses.
"""

from __future__ import annotations

import asyncpg
from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from adapters import admin_facts_queries, facts_jobs_store
from api.auth import current_superuser
from api.deps import EnvelopeError, require_json
from api.ratelimit import workspace_write_rate_limit
from app.facts.models import FactsStatusResponse
from app.facts.service_admin import get_facts_status
from config.settings import Settings

router = APIRouter(
    tags=["admin-facts"],
    prefix="/admin/facts",
    dependencies=[Depends(current_superuser)],
)


def _facts_admin_parts(request: Request) -> tuple[asyncpg.Pool, Settings]:
    """The pipeline pool + settings this surface needs (a copy of
    `cds_admin.py`'s `_cds_parts`, plan §5.5) — 503s cleanly when the
    pipeline DSN isn't configured, since `school_pages`/`facts_jobs` are
    base tables reached only through it and the router still mounts."""
    runtime = request.app.state.runtime
    if runtime.pipeline_pool is None:
        raise EnvelopeError(503, "School data admin is not configured.")
    return runtime.pipeline_pool, request.app.state.settings


@router.get("/status")
async def facts_status_route(request: Request) -> FactsStatusResponse:
    pool, settings = _facts_admin_parts(request)
    return await get_facts_status(pool, settings)


class UnmappedLabelItem(BaseModel):
    source_path: str
    label: str
    school_count: int


class UnmappedLabelsPage(BaseModel):
    items: list[UnmappedLabelItem]
    total: int


@router.get("/unmapped")
async def unmapped_labels_route(request: Request, page: int = 1) -> UnmappedLabelsPage:
    pool, settings = _facts_admin_parts(request)
    result = await admin_facts_queries.get_unmapped_labels_page(
        pool, page=max(page, 1), page_size=settings.facts_admin_unmapped_limit
    )
    return UnmappedLabelsPage(
        items=[
            UnmappedLabelItem(
                source_path=row.source_path, label=row.label, school_count=row.school_count
            )
            for row in result.items
        ],
        total=result.total,
    )


@router.post(
    "/passes",
    status_code=202,
    dependencies=[Depends(require_json), Depends(workspace_write_rate_limit)],
)
async def enqueue_pass_route(request: Request) -> Response:
    """Enqueue one `crawl_pass` job — the "Run a pass now" button. 409s when
    one is already queued or running (`enqueue_now`'s `ON CONFLICT DO
    NOTHING`); never triggers or waits on the crawl itself."""
    pool, _settings = _facts_admin_parts(request)
    enqueued = await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    if not enqueued:
        raise EnvelopeError(409, "A pass is already queued or running.")
    return Response(status_code=202)
