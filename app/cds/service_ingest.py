"""Batch upload ingest (plan §B1 `app/cds/service_ingest.py`): accept N PDFs,
hash + dedupe, stage rows in `counselle.cds_upload_files`, run per-file
detection, let admins patch school/year, then "process all" turns ready rows
into `cds_library` candidate documents + queued extractions.

Per-file isolation is structural, not defensive (plan §D endpoint #7):
`create_upload` never raises on a bad/unreadable PDF (an `error`-status row
is returned instead), and each row of `process_batch` is wrapped in its own
try/except so one bad file never blocks the rest of the batch.

Staging rows (`content`, `sha256`, `detection`, ...) live on the app pool
(`counselle.*`); committing a row writes to `cds_library.*` through
`adapters/cds_store.py` on the pipeline pool — the two writes happen in
separate transactions (different databases/roles), which is why a mid-commit
crash between them is handled by marking the row `committed` only after the
`cds_library` writes succeed.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from hashlib import sha256
from typing import Any
from uuid import UUID

import asyncpg
import structlog

from adapters import cds_admin_queries, cds_pdf, cds_store
from app.agent_node import model_name_from_setting
from app.cds import audit, detect
from app.cds import manifest as manifest_mod
from app.cds.engine import EXTRACTOR_VERSION
from app.cds.errors import CdsAdminNotFoundError, CdsAdminValidationError
from app.cds.models import (
    DetectionCandidate,
    DetectionInfo,
    ProcessQueuedItem,
    ProcessResult,
    ProcessSkippedItem,
    UploadBatch,
    UploadRow,
)

logger = structlog.get_logger(__name__)

_READY_STATUSES = frozenset({"matched", "replaces_existing"})

_SELECT_COLUMNS = (
    "id, batch_id, filename, size_bytes, sha256, page_count, status, school_id, "
    "academic_year, detection, error_message, committed_document_id, "
    "committed_extraction_id, created_at, updated_at"
)


def _row_to_upload(row: asyncpg.Record, *, school_name: str | None = None) -> UploadRow:
    return UploadRow(
        id=str(row["id"]),
        batch_id=str(row["batch_id"]),
        filename=row["filename"],
        size_bytes=row["size_bytes"],
        sha256=bytes(row["sha256"]).hex(),
        page_count=row["page_count"],
        status=row["status"],
        school_id=row["school_id"],
        school_name=school_name,
        academic_year=row["academic_year"],
        detection=DetectionInfo.model_validate(row["detection"] or {}),
        error_message=row["error_message"],
        committed_document_id=row["committed_document_id"],
        committed_extraction_id=(
            str(row["committed_extraction_id"]) if row["committed_extraction_id"] else None
        ),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


async def _resolve_status(
    pipeline_pool: asyncpg.Pool,
    *,
    duplicate_of: int | None,
    school_id: int | None,
    academic_year: int | None,
) -> str:
    if duplicate_of is not None:
        return "duplicate"
    if school_id is None or academic_year is None:
        return "needs_input"
    exists = await cds_admin_queries.slot_has_document(
        pipeline_pool, school_id=school_id, academic_year=academic_year
    )
    return "replaces_existing" if exists else "matched"


async def create_upload(
    app_pool: asyncpg.Pool,
    pipeline_pool: asyncpg.Pool,
    settings: Any,
    *,
    user_id: UUID,
    batch_id: UUID,
    filename: str,
    content: bytes,
) -> UploadRow:
    """Stage one uploaded PDF: hash, page count, dedupe, and a per-file
    detection call. Never raises on an unreadable PDF -- an `error`-status
    row is returned instead of failing the whole upload request."""
    digest = sha256(content).digest()
    row_id = uuid.uuid4()
    try:
        page_count = await cds_pdf.get_page_count(content)
    except cds_pdf.CdsPdfError as exc:
        async with app_pool.acquire() as conn:
            row = await conn.fetchrow(
                f"""
                INSERT INTO counselle.cds_upload_files
                    (id, batch_id, uploaded_by, filename, content, size_bytes, sha256,
                     page_count, status, detection, error_message)
                VALUES ($1, $2, $3, $4, NULL, $5, $6, NULL, 'error', $7, $8)
                RETURNING {_SELECT_COLUMNS}
                """,
                row_id,
                batch_id,
                user_id,
                filename,
                len(content),
                digest,
                {},
                str(exc)[:2000],
            )
        return _row_to_upload(row)

    duplicate = await cds_admin_queries.find_document_by_sha256(pipeline_pool, digest)
    school_id: int | None = None
    academic_year: int | None = None
    duplicate_of: int | None = None
    if duplicate is not None:
        duplicate_of = duplicate.document_id
        school_id, academic_year = duplicate.school_id, duplicate.academic_year
        detection_info = DetectionInfo(duplicate_of=duplicate_of)
    else:
        result = await detect.detect_school_year(
            settings=settings, pool=pipeline_pool, pdf_content=content
        )
        candidates = [
            DetectionCandidate(
                school_id=candidate.school_id,
                name=candidate.name,
                state=candidate.state,
                city=candidate.city,
                score=candidate.score,
            )
            for candidate in result.candidates
        ]
        detection_info = DetectionInfo(
            name=result.detected_name,
            year=result.detected_academic_year,
            confident=result.confident,
            candidates=candidates,
            error=result.error,
        )
        if result.confident and result.best_match is not None:
            school_id = result.best_match.school_id
            academic_year = result.detected_academic_year

    status = await _resolve_status(
        pipeline_pool, duplicate_of=duplicate_of, school_id=school_id, academic_year=academic_year
    )
    async with app_pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            f"""
            INSERT INTO counselle.cds_upload_files
                (id, batch_id, uploaded_by, filename, content, size_bytes, sha256,
                 page_count, status, school_id, academic_year, detection)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING {_SELECT_COLUMNS}
            """,
            row_id,
            batch_id,
            user_id,
            filename,
            content,
            len(content),
            digest,
            page_count,
            status,
            school_id,
            academic_year,
            detection_info.model_dump(mode="json"),
        )
        await audit.record_audit(
            conn,
            actor_user_id=user_id,
            action="upload",
            school_id=school_id,
            academic_year=academic_year,
            detail={"filename": filename, "batch_id": str(batch_id), "status": status},
        )
    school_id_set = {school_id} if school_id else set()
    names = await cds_admin_queries.schools_by_ids(pipeline_pool, school_id_set)
    return _row_to_upload(row, school_name=names.get(school_id) if school_id else None)


async def list_batch(
    app_pool: asyncpg.Pool, pipeline_pool: asyncpg.Pool, *, batch_id: UUID
) -> UploadBatch:
    async with app_pool.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT {_SELECT_COLUMNS} FROM counselle.cds_upload_files "
            "WHERE batch_id = $1 ORDER BY created_at",
            batch_id,
        )
    school_ids = {row["school_id"] for row in rows if row["school_id"] is not None}
    names = await cds_admin_queries.schools_by_ids(pipeline_pool, school_ids)
    return UploadBatch(
        batch_id=str(batch_id),
        rows=[_row_to_upload(row, school_name=names.get(row["school_id"])) for row in rows],
    )


async def patch_upload_row(
    app_pool: asyncpg.Pool,
    pipeline_pool: asyncpg.Pool,
    *,
    file_id: UUID,
    school_id: int | None,
    academic_year: int | None,
) -> UploadRow:
    async with app_pool.acquire() as conn, conn.transaction():
        existing = await conn.fetchrow(
            "SELECT status, detection, school_id, academic_year "
            "FROM counselle.cds_upload_files WHERE id = $1 FOR UPDATE",
            file_id,
        )
        if existing is None:
            raise CdsAdminNotFoundError(f"upload row {file_id} not found")
        if existing["status"] == "committed":
            raise CdsAdminValidationError("cannot edit an already-committed upload row")
        new_school_id = school_id if school_id is not None else existing["school_id"]
        new_year = academic_year if academic_year is not None else existing["academic_year"]
        duplicate_of = (existing["detection"] or {}).get("duplicate_of")
        status = await _resolve_status(
            pipeline_pool,
            duplicate_of=duplicate_of,
            school_id=new_school_id,
            academic_year=new_year,
        )
        row = await conn.fetchrow(
            f"""
            UPDATE counselle.cds_upload_files
            SET school_id = $2, academic_year = $3, status = $4, updated_at = now()
            WHERE id = $1
            RETURNING {_SELECT_COLUMNS}
            """,
            file_id,
            new_school_id,
            new_year,
            status,
        )
    names = await cds_admin_queries.schools_by_ids(
        pipeline_pool, {new_school_id} if new_school_id is not None else set()
    )
    return _row_to_upload(
        row, school_name=names.get(new_school_id) if new_school_id is not None else None
    )


async def delete_upload_row(app_pool: asyncpg.Pool, *, file_id: UUID) -> None:
    async with app_pool.acquire() as conn:
        result = await conn.execute(
            "DELETE FROM counselle.cds_upload_files WHERE id = $1 AND status != 'committed'",
            file_id,
        )
    if result == "DELETE 0":
        raise CdsAdminNotFoundError(f"upload row {file_id} not found (or already committed)")


async def batch_extraction_ids(app_pool: asyncpg.Pool, *, batch_id: UUID) -> list[uuid.UUID]:
    """Every committed row's extraction id in a batch -- what the upload
    screen polls (plan §D endpoint #8)."""
    async with app_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT committed_extraction_id FROM counselle.cds_upload_files "
            "WHERE batch_id = $1 AND committed_extraction_id IS NOT NULL",
            batch_id,
        )
    return [row["committed_extraction_id"] for row in rows]


async def _commit_row(
    app_pool: asyncpg.Pool,
    pipeline_pool: asyncpg.Pool,
    *,
    compiled: Any,
    domains: tuple[str, ...],
    model_id: str,
    row: asyncpg.Record,
    actor_user_id: UUID,
) -> ProcessQueuedItem:
    if row["school_id"] is None or row["academic_year"] is None:
        raise CdsAdminValidationError("row is missing school_id/academic_year")
    async with pipeline_pool.acquire() as conn, conn.transaction():
        slot = await cds_store.upsert_school_year(
            conn, school_id=row["school_id"], academic_year=row["academic_year"]
        )
        doc = await cds_store.insert_document(
            conn,
            school_year_id=slot.id,
            pdf_content=row["content"],
            source_kind="upload",
            retrieved_at=datetime.now(UTC),
            original_filename=row["filename"],
        )
        await cds_store.set_candidate_document(conn, school_year_id=slot.id, document_id=doc.id)
        extraction = await cds_store.create_extraction(
            conn,
            school_year_id=slot.id,
            document_id=doc.id,
            manifest_version=compiled.version,
            target_kind="candidate",
            requested_domains=domains,
            extractor_version=EXTRACTOR_VERSION,
            model_id=model_id,
        )
    async with app_pool.acquire() as conn, conn.transaction():
        await conn.execute(
            """
            UPDATE counselle.cds_upload_files
            SET status = 'committed', content = NULL, committed_document_id = $2,
                committed_extraction_id = $3, updated_at = now()
            WHERE id = $1
            """,
            row["id"],
            doc.id,
            extraction.id,
        )
        await audit.record_audit(
            conn,
            actor_user_id=actor_user_id,
            action="commit",
            school_id=row["school_id"],
            academic_year=row["academic_year"],
            document_id=doc.id,
            detail={"filename": row["filename"], "duplicate_within_slot": doc.is_duplicate},
        )
        await audit.record_audit(
            conn,
            actor_user_id=actor_user_id,
            action="extract",
            school_id=row["school_id"],
            academic_year=row["academic_year"],
            document_id=doc.id,
            extraction_id=extraction.id,
        )
    return ProcessQueuedItem(
        file_id=str(row["id"]),
        school_year_id=slot.id,
        document_id=doc.id,
        extraction_id=str(extraction.id),
    )


async def process_batch(
    app_pool: asyncpg.Pool,
    pipeline_pool: asyncpg.Pool,
    settings: Any,
    *,
    batch_id: UUID,
    actor_user_id: UUID,
) -> ProcessResult:
    """"Process all": commit every ready staging row into `cds_library` and
    queue its extraction. One row's failure never blocks the rest (plan §D
    endpoint #7's "per-row try/except; one bad PDF never blocks the batch")."""
    async with app_pool.acquire() as conn:
        rows = await conn.fetch(
            f"SELECT {_SELECT_COLUMNS}, content FROM counselle.cds_upload_files "
            "WHERE batch_id = $1 ORDER BY created_at",
            batch_id,
        )
    compiled = manifest_mod.load_compiled_manifest()
    domains = manifest_mod.domain_ids(compiled)
    model_id = model_name_from_setting(settings.model_cds_extract)
    queued: list[ProcessQueuedItem] = []
    skipped: list[ProcessSkippedItem] = []
    for row in rows:
        file_id = row["id"]
        if row["status"] not in _READY_STATUSES:
            skipped.append(
                ProcessSkippedItem(file_id=str(file_id), reason=f"status is {row['status']!r}")
            )
            continue
        try:
            queued.append(
                await _commit_row(
                    app_pool,
                    pipeline_pool,
                    compiled=compiled,
                    domains=domains,
                    model_id=model_id,
                    row=row,
                    actor_user_id=actor_user_id,
                )
            )
        except Exception as exc:  # noqa: BLE001 -- per-file isolation (plan §D endpoint #7)
            logger.exception("cds_ingest_commit_failed", file_id=str(file_id))
            async with app_pool.acquire() as conn:
                await conn.execute(
                    "UPDATE counselle.cds_upload_files SET status = 'error', "
                    "error_message = $2, updated_at = now() WHERE id = $1",
                    file_id,
                    str(exc)[:2000],
                )
            skipped.append(ProcessSkippedItem(file_id=str(file_id), reason=str(exc)[:200]))
    return ProcessResult(queued=queued, skipped=skipped)


__all__ = [
    "batch_extraction_ids",
    "create_upload",
    "delete_upload_row",
    "list_batch",
    "patch_upload_row",
    "process_batch",
]
