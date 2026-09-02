"""The CDS admin router (plan §D): ~14 endpoints under `/v1/admin/cds`, every
one gated by `current_superuser`. Thin translation only — multipart/JSON in,
`app/cds/service_*.py` out, `map_cds_errors` translates the narrow
`app/cds/errors.py` family into the project's error envelope.

`GET .../pages/{page}.png` is the one binary route: it renders a PDF page to
PNG in-process (`adapters/cds_pdf.render_page_png`, off-loop via
`asyncio.to_thread` inside the adapter) and never streams `pdf_content`
through any other route — every list/grid/review query goes through
`adapters/cds_admin_queries.py`, which never selects that column.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile

from adapters import cds_admin_queries, cds_pdf, cds_store
from api.auth import current_superuser
from api.auth_security import auth_origin_protect
from api.deps import EnvelopeError, require_json
from api.ratelimit import workspace_write_rate_limit
from api.users_db import UserDB
from app.cds import service_ingest, service_review, service_review_approve
from app.cds.errors import CdsAdminConflictError, CdsAdminNotFoundError, CdsAdminValidationError
from app.cds.models import (
    ApproveBody,
    ApproveResult,
    CoverageResult,
    JobStatusRow,
    MetricEditsBody,
    ProcessResult,
    RejectBody,
    RerunBody,
    RerunResult,
    SchoolSummary,
    UploadBatch,
    UploadPatchBody,
    UploadRow,
)

router = APIRouter(
    tags=["cds-admin"],
    prefix="/admin/cds",
    dependencies=[Depends(current_superuser)],
)

_PAGE_IMAGE_DEFAULT_WIDTH = 1400
_PAGE_IMAGE_MAX_WIDTH = 2400
_PAGE_IMAGE_MIN_WIDTH = 200
_LETTER_WIDTH_INCHES = 8.5  # dpi = pixels-across / page-width-in-inches


def _cds_parts(request: Request) -> tuple[Any, Any, Any]:
    """The three pools/settings the CDS admin surface needs: the pipeline
    pool (writes/reads on `cds_library.*`), the app pool (`counselle.*`
    staging/pending-edits/audit), and settings. 503s cleanly when the
    pipeline DSN isn't configured (plan §C3) — the router still mounts."""
    runtime = request.app.state.runtime
    if runtime.pipeline_pool is None:
        raise EnvelopeError(503, "CDS admin is not configured.")
    return runtime.pipeline_pool, runtime.app_pool, request.app.state.settings


async def map_cds_errors[T](call: Callable[[], Awaitable[T]]) -> T:
    """Translate the `app/cds/errors.py` family into the project's envelope
    (mirrors `api/routes/workspace_common.py::map_workspace_errors`)."""
    try:
        return await call()
    except CdsAdminNotFoundError as exc:
        raise EnvelopeError(404, str(exc) or "Not found.") from exc
    except CdsAdminConflictError as exc:
        raise EnvelopeError(409, str(exc) or "Conflict.") from exc
    except CdsAdminValidationError as exc:
        raise EnvelopeError(422, str(exc) or "Invalid request.") from exc


_write_deps = [Depends(require_json), Depends(workspace_write_rate_limit)]


# ---------------------------------------------------------------------------
# #1-#2: coverage + school search
# ---------------------------------------------------------------------------


@router.get("/coverage")
async def coverage_route(
    request: Request,
    q: str | None = None,
    year: list[int] | None = None,
    status: list[str] | None = None,
    missing_year: int | None = None,
    all_schools: bool = False,
    limit: int = 50,
    offset: int = 0,
    _user: UserDB = Depends(current_superuser),
) -> CoverageResult:
    pipeline_pool, _app_pool, _settings = _cds_parts(request)
    return await cds_admin_queries.coverage_grid(
        pipeline_pool,
        q=q,
        year_filter=year,
        status_filter=status,
        missing_year=missing_year,
        all_schools=all_schools,
        limit=min(max(limit, 1), 200),
        offset=max(offset, 0),
    )


@router.get("/schools")
async def search_schools_route(
    request: Request,
    q: str = "",
    limit: int = 20,
    _user: UserDB = Depends(current_superuser),
) -> list[SchoolSummary]:
    pipeline_pool, _app_pool, _settings = _cds_parts(request)
    return await cds_admin_queries.search_schools(pipeline_pool, q, limit=min(max(limit, 1), 50))


# ---------------------------------------------------------------------------
# #3-#7: upload staging
# ---------------------------------------------------------------------------


@router.post(
    "/uploads",
    status_code=201,
    dependencies=[Depends(workspace_write_rate_limit), Depends(auth_origin_protect)],
)
async def create_upload_route(
    request: Request,
    file: UploadFile = File(...),
    batch_id: UUID = Form(...),
    user: UserDB = Depends(current_superuser),
) -> UploadRow:
    pipeline_pool, app_pool, settings = _cds_parts(request)
    content = await file.read(settings.cds_upload_max_bytes + 1)
    if len(content) > settings.cds_upload_max_bytes:
        # [F-02] `cds_upload_max_bytes` is a decimal cap (50_000_000, i.e. 50
        # MB) — dividing by 1024*1024 printed "47 MiB" for a 50 MB limit.
        max_mb = settings.cds_upload_max_bytes // (1000 * 1000)
        raise EnvelopeError(413, f"file must be no larger than {max_mb} MB")
    if not content:
        raise EnvelopeError(422, "file must be non-empty")
    return await service_ingest.create_upload(
        app_pool,
        pipeline_pool,
        settings,
        user_id=user.id,
        batch_id=batch_id,
        filename=file.filename or "upload.pdf",
        content=content,
    )


@router.get("/uploads")
async def list_uploads_route(
    request: Request, batch_id: UUID, _user: UserDB = Depends(current_superuser)
) -> UploadBatch:
    pipeline_pool, app_pool, _settings = _cds_parts(request)
    return await service_ingest.list_batch(app_pool, pipeline_pool, batch_id=batch_id)


@router.patch("/uploads/{file_id}", dependencies=_write_deps)
async def patch_upload_route(
    file_id: UUID,
    body: UploadPatchBody,
    request: Request,
    _user: UserDB = Depends(current_superuser),
) -> UploadRow:
    pipeline_pool, app_pool, _settings = _cds_parts(request)
    return await map_cds_errors(
        lambda: service_ingest.patch_upload_row(
            app_pool,
            pipeline_pool,
            file_id=file_id,
            school_id=body.school_id,
            academic_year=body.academic_year,
        )
    )


@router.delete(
    "/uploads/{file_id}", status_code=204, dependencies=[Depends(workspace_write_rate_limit)]
)
async def delete_upload_route(
    file_id: UUID, request: Request, _user: UserDB = Depends(current_superuser)
) -> Response:
    _pipeline_pool, app_pool, _settings = _cds_parts(request)
    await map_cds_errors(lambda: service_ingest.delete_upload_row(app_pool, file_id=file_id))
    return Response(status_code=204)


@router.post("/uploads/{batch_id}/process", dependencies=_write_deps)
async def process_batch_route(
    batch_id: UUID,
    request: Request,
    user: UserDB = Depends(current_superuser),
) -> ProcessResult:
    pipeline_pool, app_pool, settings = _cds_parts(request)
    return await service_ingest.process_batch(
        app_pool, pipeline_pool, settings, batch_id=batch_id, actor_user_id=user.id
    )


# ---------------------------------------------------------------------------
# #8: job polling
# ---------------------------------------------------------------------------


@router.get("/jobs")
async def jobs_route(
    request: Request,
    batch_id: UUID | None = None,
    ids: list[UUID] | None = None,
    _user: UserDB = Depends(current_superuser),
) -> list[JobStatusRow]:
    pipeline_pool, app_pool, _settings = _cds_parts(request)
    if batch_id is None and not ids:
        raise EnvelopeError(422, "batch_id or ids is required")
    extraction_ids = list(ids) if ids else await service_ingest.batch_extraction_ids(
        app_pool, batch_id=batch_id  # type: ignore[arg-type]
    )
    return await cds_admin_queries.job_status(pipeline_pool, extraction_ids)


# ---------------------------------------------------------------------------
# #9-#14: document review
# ---------------------------------------------------------------------------


@router.get("/documents/{document_id}")
async def get_document_route(
    document_id: int, request: Request, _user: UserDB = Depends(current_superuser)
) -> object:
    pipeline_pool, app_pool, _settings = _cds_parts(request)
    return await map_cds_errors(
        lambda: service_review.get_review(pipeline_pool, app_pool, document_id=document_id)
    )


def _clamp_page_width(width: int) -> int:
    return min(max(width, _PAGE_IMAGE_MIN_WIDTH), _PAGE_IMAGE_MAX_WIDTH)


@router.get("/documents/{document_id}/pages/{page}.png")
async def page_image_route(
    document_id: int,
    page: int,
    request: Request,
    w: int = _PAGE_IMAGE_DEFAULT_WIDTH,
    _user: UserDB = Depends(current_superuser),
) -> Response:
    pipeline_pool, _app_pool, _settings = _cds_parts(request)
    try:
        async with pipeline_pool.acquire() as conn:
            doc = await cds_store.fetch_document_for_extraction(conn, document_id=document_id)
    except cds_store.CdsStoreError as exc:
        raise EnvelopeError(404, "Document not found.") from exc
    width = _clamp_page_width(w)
    dpi = max(1, round(width / _LETTER_WIDTH_INCHES))
    try:
        png_bytes = await cds_pdf.render_page_png(doc.pdf_content, page, dpi=dpi)
    except cds_pdf.CdsPdfPageRangeError as exc:
        raise EnvelopeError(404, str(exc)) from exc
    except cds_pdf.CdsPdfError as exc:
        raise EnvelopeError(422, str(exc)) from exc
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={
            "Cache-Control": "private, max-age=86400, immutable",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.patch("/documents/{document_id}/metrics", dependencies=_write_deps)
async def patch_metrics_route(
    document_id: int,
    body: MetricEditsBody,
    request: Request,
    user: UserDB = Depends(current_superuser),
) -> object:
    pipeline_pool, app_pool, _settings = _cds_parts(request)
    return await map_cds_errors(
        lambda: service_review.save_metric_edits(
            app_pool, pipeline_pool, document_id=document_id, actor_user_id=user.id,
            edits=body.edits,
        )
    )


@router.post("/documents/{document_id}/approve", dependencies=_write_deps)
async def approve_route(
    document_id: int,
    body: ApproveBody,
    request: Request,
    user: UserDB = Depends(current_superuser),
) -> ApproveResult:
    pipeline_pool, app_pool, settings = _cds_parts(request)
    result = await map_cds_errors(
        lambda: service_review_approve.approve_document(
            app_pool, pipeline_pool, settings, document_id=document_id, actor_user_id=user.id,
            override_flags=body.override_flags, note=body.note,
        )
    )
    catalog = request.app.state.runtime.deps.catalog
    if catalog is not None:
        await catalog.maybe_refresh(force=True)
    return result


@router.post(
    "/documents/{document_id}/reject",
    status_code=204,
    dependencies=_write_deps,
)
async def reject_route(
    document_id: int,
    body: RejectBody,
    request: Request,
    user: UserDB = Depends(current_superuser),
) -> Response:
    pipeline_pool, app_pool, _settings = _cds_parts(request)
    await map_cds_errors(
        lambda: service_review_approve.reject_document(
            app_pool, pipeline_pool, document_id=document_id, actor_user_id=user.id,
            reason=body.reason,
        )
    )
    return Response(status_code=204)


@router.post("/documents/{document_id}/rerun", dependencies=_write_deps)
async def rerun_route(
    document_id: int,
    body: RerunBody,
    request: Request,
    user: UserDB = Depends(current_superuser),
) -> RerunResult:
    pipeline_pool, app_pool, settings = _cds_parts(request)
    return await map_cds_errors(
        lambda: service_review_approve.rerun_extraction(
            app_pool, pipeline_pool, settings, document_id=document_id, actor_user_id=user.id,
            domains=body.domains,
        )
    )
