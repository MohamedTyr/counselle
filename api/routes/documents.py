"""Workspace document routes (Part B/F): list, multipart upload, archive.

``POST /documents`` is the first production caller of
``app.workspace.service_documents.upload_document`` — it accepts a normal
multipart form upload and passes the raw bytes straight through to the
service layer, which owns every real validation (size cap, extension/MIME
allowlist, file-signature checks, extraction). This route only translates
the multipart parts into a :class:`DocumentUpload` and turns a resulting
``pydantic.ValidationError`` (e.g. an empty or oversized file) into the
project's error envelope.
"""

from __future__ import annotations

from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Request, Response, UploadFile
from pydantic import ValidationError

from api.auth import current_active_user
from api.auth_security import auth_origin_protect
from api.deps import EnvelopeError
from api.ratelimit import workspace_write_rate_limit
from api.routes.workspace_common import map_workspace_errors, runtime_parts
from api.users_db import UserDB
from app.workspace.models import DOCUMENT_MAX_BYTES, DocumentType, DocumentUpload
from app.workspace.service_documents import (
    archive_document,
    list_documents,
    read_document,
    upload_document,
)

router = APIRouter(tags=["workspace"])

_DEFAULT_DOC_TYPE: DocumentType = "other"
_DEFAULT_UPLOAD_MIME = "application/octet-stream"
_DEFAULT_UPLOAD_FILENAME = "upload"


@router.get("/documents")
async def list_documents_route(
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, _, _ = runtime_parts(request)
    return await list_documents(app_pool, user_id=user.id)


@router.post(
    "/documents",
    status_code=201,
    dependencies=[Depends(workspace_write_rate_limit), Depends(auth_origin_protect)],
)
async def create_document_route(
    request: Request,
    file: UploadFile = File(...),
    title: str = Form(...),
    doc_type: DocumentType = Form(_DEFAULT_DOC_TYPE),
    user: UserDB = Depends(current_active_user),
) -> object:
    app_pool, _, _, event_bus = runtime_parts(request)
    content = await file.read(DOCUMENT_MAX_BYTES + 1)
    if len(content) > DOCUMENT_MAX_BYTES:
        max_mb = DOCUMENT_MAX_BYTES // (1024 * 1024)
        raise EnvelopeError(413, f"document must be no larger than {max_mb} MiB")
    try:
        upload = DocumentUpload(
            title=title,
            doc_type=doc_type,
            filename=file.filename or _DEFAULT_UPLOAD_FILENAME,
            mime=file.content_type or _DEFAULT_UPLOAD_MIME,
            content=content,
        )
    except ValidationError as exc:
        raise EnvelopeError(422, _upload_validation_message(exc)) from exc

    deps = request.app.state.runtime.deps
    return await map_workspace_errors(
        lambda: upload_document(
            app_pool,
            event_bus,
            user_id=user.id,
            actor="student",
            data=upload,
            summary_generator=deps.document_summary_generator,
            extraction_timeout_s=request.app.state.settings.document_extraction_timeout_s,
        )
    )


@router.delete(
    "/documents/{document_id}",
    status_code=204,
    dependencies=[Depends(workspace_write_rate_limit)],
)
async def archive_document_route(
    document_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> Response:
    app_pool, _, _, event_bus = runtime_parts(request)
    await map_workspace_errors(
        lambda: archive_document(
            app_pool, event_bus, user_id=user.id, actor="student", document_id=document_id
        )
    )
    return Response(status_code=204)


@router.get("/documents/{document_id}/file")
async def read_document_file_route(
    document_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> Response:
    app_pool, _, _, _ = runtime_parts(request)
    document = await map_workspace_errors(
        lambda: read_document(app_pool, user_id=user.id, document_id=document_id)
    )
    return Response(
        content=document.content,
        media_type=document.mime,
        headers={
            "Content-Disposition": _content_disposition(document.filename),
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
        },
    )


def _content_disposition(filename: str) -> str:
    """Build a header-injection-safe ``attachment`` Content-Disposition value.

    Always forces ``attachment`` (never inline) so a browser never renders
    user-uploaded content in-page. The stored filename was sanitized at
    upload time (``extraction.py::_unsafe_filename``), but header injection
    is a distinct risk from path traversal, so it is re-escaped here too —
    mirroring Starlette's own ``FileResponse`` RFC 6266 quoting.
    """
    safe_filename = quote(filename)
    if safe_filename != filename:
        return f"attachment; filename*=utf-8''{safe_filename}"
    return f'attachment; filename="{filename}"'


def _upload_validation_message(exc: ValidationError) -> str:
    """Translate a DocumentUpload construction error into a user-safe message."""
    fields = {error["loc"][0] for error in exc.errors() if error["loc"]}
    if "content" in fields:
        max_mb = DOCUMENT_MAX_BYTES // (1024 * 1024)
        return f"document must be non-empty and no larger than {max_mb} MiB"
    if "title" in fields:
        return "document title is required"
    if fields & {"filename", "mime"}:
        return "document filename and content type are required"
    return "invalid document upload"
