"""The only writer to ``cds_library`` base tables (PLAN §B1 `adapters/cds_store.py`).

Uses ``Runtime.pipeline_pool`` — the ``cds_library_app`` role, which has
``INSERT, SELECT, UPDATE`` on all 8 base tables and **no DELETE grant
anywhere** (recon-db-live.md §1/§4). Parameterized SQL only, never
f-strings. Evidence-bearing columns (``pdf_content``, ``packet``, …) are
protected by ``BEFORE UPDATE`` immutability triggers already live on the
schema; corrections are new rows, never mutations — this module never tries
to update them and would fail loudly if it did.

**Risk 3, non-negotiable (PLAN §A3):** every packet this module writes is
round-tripped through the reader's own
``counselle_db.packets.parse_packet_row()`` inside the same transaction
before the INSERT. A packet the reader would reject is refused here instead
of silently blackholing a domain for students — see ``insert_packet``.

Nothing in this module commits or rolls back a transaction itself (except
the small internal savepoint in ``activate_packet``); callers own the
transaction boundary, exactly like the ``app/workspace/service_*.py``
convention (recon-backend.md §3).
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from typing import Any, Literal

import asyncpg

from counselle_db.models import ServiceError
from counselle_db.packets import compile_manifest, parse_packet_row

_PDF_MIME_TYPE = "application/pdf"


class CdsStoreError(Exception):
    """Base for CDS write-path failures — never swallowed silently."""


class PacketValidationError(CdsStoreError):
    """A packet failed the reader's own ``parse_packet_row()`` round-trip
    (PLAN Risk 3) — the write is refused before it can blackhole a domain."""


class LeaseLostError(CdsStoreError):
    """A fencing UPDATE matched zero rows: the extraction's lease already
    expired or its status changed under this worker (PLAN §E fencing)."""


@dataclass(frozen=True)
class SchoolYearSlot:
    id: int
    school_id: int
    academic_year: int
    active_document_id: int | None
    candidate_document_id: int | None


@dataclass(frozen=True)
class DocumentRecord:
    id: int
    school_year_id: int
    pdf_sha256: bytes
    is_duplicate: bool


@dataclass(frozen=True)
class ExtractionRecord:
    id: uuid.UUID
    school_year_id: int
    document_id: int
    manifest_version: str
    target_kind: str
    requested_domains: tuple[str, ...]
    status: str
    extractor_version: str
    model_id: str
    lease_expires_at: datetime | None


@dataclass(frozen=True)
class PacketRecord:
    document_id: int
    extraction_id: uuid.UUID
    domain_id: str
    status: str
    is_active: bool
    created_at: datetime


async def upsert_school_year(
    conn: asyncpg.Connection, *, school_id: int, academic_year: int
) -> SchoolYearSlot:
    """Get-or-create the ``(school_id, academic_year)`` slot.

    ``DO UPDATE SET school_id = EXCLUDED.school_id`` is a deliberate no-op
    (the conflict key already guarantees equality) — it exists only to make
    ``RETURNING`` fire on the already-exists path too, so this is a true
    get-or-create in one round trip.
    """
    row = await conn.fetchrow(
        """
        INSERT INTO cds_library.cds_school_years (school_id, academic_year)
        VALUES ($1, $2)
        ON CONFLICT (school_id, academic_year) DO UPDATE SET school_id = EXCLUDED.school_id
        RETURNING id, school_id, academic_year, active_document_id, candidate_document_id
        """,
        school_id,
        academic_year,
    )
    return SchoolYearSlot(**dict(row))


async def insert_document(
    conn: asyncpg.Connection,
    *,
    school_year_id: int,
    pdf_content: bytes,
    source_kind: Literal["upload", "college_transitions"],
    retrieved_at: datetime,
    original_filename: str | None = None,
    source_page_url: str | None = None,
    original_download_url: str | None = None,
    resolved_download_url: str | None = None,
    repository_school_name: str | None = None,
) -> DocumentRecord:
    """Insert one PDF, deduped on ``(school_year_id, sha256)`` against
    non-invalidated documents already in that slot. Returns the existing row
    (``is_duplicate=True``) instead of inserting a byte-identical copy."""
    digest = sha256(pdf_content).digest()
    existing = await conn.fetchrow(
        """
        SELECT id, school_year_id, pdf_sha256 FROM cds_library.cds_documents
        WHERE school_year_id = $1 AND pdf_sha256 = $2 AND invalidated_at IS NULL
        """,
        school_year_id,
        digest,
    )
    if existing is not None:
        return DocumentRecord(
            id=existing["id"],
            school_year_id=existing["school_year_id"],
            pdf_sha256=existing["pdf_sha256"],
            is_duplicate=True,
        )
    row = await conn.fetchrow(
        """
        INSERT INTO cds_library.cds_documents
            (school_year_id, pdf_content, pdf_sha256, pdf_size_bytes, mime_type,
             original_filename, source_kind, source_page_url, original_download_url,
             resolved_download_url, repository_school_name, retrieved_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, school_year_id, pdf_sha256
        """,
        school_year_id,
        pdf_content,
        digest,
        len(pdf_content),
        _PDF_MIME_TYPE,
        original_filename,
        source_kind,
        source_page_url,
        original_download_url,
        resolved_download_url,
        repository_school_name,
        retrieved_at,
    )
    return DocumentRecord(
        id=row["id"],
        school_year_id=row["school_year_id"],
        pdf_sha256=row["pdf_sha256"],
        is_duplicate=False,
    )


async def set_candidate_document(
    conn: asyncpg.Connection, *, school_year_id: int, document_id: int
) -> None:
    """Point the slot's candidate at this document (upload -> candidate,
    PLAN §B6). Never touches ``active_document_id`` — only Approve does."""
    await conn.execute(
        """
        UPDATE cds_library.cds_school_years
        SET candidate_document_id = $2, last_action_kind = 'uploaded', last_action_at = now()
        WHERE id = $1
        """,
        school_year_id,
        document_id,
    )


def _extraction_record(row: asyncpg.Record) -> ExtractionRecord:
    return ExtractionRecord(
        id=row["id"],
        school_year_id=row["school_year_id"],
        document_id=row["document_id"],
        manifest_version=row["manifest_version"],
        target_kind=row["target_kind"],
        requested_domains=tuple(row["requested_domains"]),
        status=row["status"],
        extractor_version=row["extractor_version"],
        model_id=row["model_id"],
        lease_expires_at=row["lease_expires_at"],
    )


async def create_extraction(
    conn: asyncpg.Connection,
    *,
    school_year_id: int,
    document_id: int,
    manifest_version: str,
    target_kind: Literal["candidate", "active_update", "full_reextract"],
    requested_domains: Sequence[str],
    extractor_version: str,
    model_id: str,
) -> ExtractionRecord:
    """Insert one ``queued`` extraction row — the job the poller will later claim."""
    row = await conn.fetchrow(
        """
        INSERT INTO cds_library.cds_extractions
            (id, school_year_id, document_id, manifest_version, target_kind,
             requested_domains, status, extractor_version, model_id)
        VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8)
        RETURNING id, school_year_id, document_id, manifest_version, target_kind,
                  requested_domains, status, extractor_version, model_id, lease_expires_at
        """,
        uuid.uuid4(),
        school_year_id,
        document_id,
        manifest_version,
        target_kind,
        sorted(set(requested_domains)),
        extractor_version,
        model_id,
    )
    return _extraction_record(row)


async def claim_next_extraction(
    pool: asyncpg.Pool, *, lease_seconds: int
) -> ExtractionRecord | None:
    """Claim the oldest queued extraction with ``FOR UPDATE SKIP LOCKED``
    (PLAN §E) and mark it running with a fresh lease. Returns ``None`` when
    nothing is claimable — the poller's normal idle case, not an error."""
    async with pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow(
            """
            WITH claimed AS (
                SELECT id FROM cds_library.cds_extractions
                WHERE status = 'queued'
                ORDER BY queued_at
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE cds_library.cds_extractions e
            SET status = 'running', started_at = now(),
                lease_expires_at = now() + make_interval(secs => $1)
            FROM claimed
            WHERE e.id = claimed.id
            RETURNING e.id, e.school_year_id, e.document_id, e.manifest_version, e.target_kind,
                      e.requested_domains, e.status, e.extractor_version, e.model_id,
                      e.lease_expires_at
            """,
            lease_seconds,
        )
    return _extraction_record(row) if row is not None else None


async def renew_lease(
    conn: asyncpg.Connection, *, extraction_id: uuid.UUID, lease_seconds: int
) -> datetime:
    """Push a running extraction's lease forward (the poller's periodic
    renewal, PLAN §E). Raises ``LeaseLostError`` if the row is no longer
    running."""
    row = await conn.fetchrow(
        """
        UPDATE cds_library.cds_extractions
        SET lease_expires_at = now() + make_interval(secs => $2)
        WHERE id = $1 AND status = 'running'
        RETURNING lease_expires_at
        """,
        extraction_id,
        lease_seconds,
    )
    if row is None:
        raise LeaseLostError(f"extraction {extraction_id} is no longer running; lease not renewed")
    return row["lease_expires_at"]  # type: ignore[no-any-return]


async def complete_extraction(
    conn: asyncpg.Connection,
    *,
    extraction_id: uuid.UUID,
    status: Literal["succeeded", "partial", "failed"],
    validation_summary: dict[str, Any] | None = None,
    error_code: str | None = None,
    error_message: str | None = None,
) -> None:
    """Finish a running extraction.

    Re-checks ``status='running' AND lease_expires_at > now()`` (PLAN §E
    fencing) — a worker that lost its lease can never complete/activate
    stale results; raises ``LeaseLostError`` instead of silently overwriting
    whatever holds the row now.
    """
    row = await conn.fetchrow(
        """
        UPDATE cds_library.cds_extractions
        SET status = $2, finished_at = now(), validation_summary = $3,
            error_code = $4, error_message = $5
        WHERE id = $1 AND status = 'running' AND lease_expires_at > now()
        RETURNING id
        """,
        extraction_id,
        status,
        validation_summary or {},
        error_code,
        error_message,
    )
    if row is None:
        raise LeaseLostError(f"extraction {extraction_id} lost its lease before completion")


async def insert_packet(
    conn: asyncpg.Connection,
    *,
    settings: Any,
    document_id: int,
    extraction_id: uuid.UUID,
    manifest_version: str,
    domain_id: str,
    domain_schema_hash: bytes,
    academic_year: int,
    pdf_sha256: bytes,
    status: Literal["validated", "partial", "parse_failed"],
    packet: dict[str, Any],
    validation: dict[str, Any] | None = None,
) -> PacketRecord:
    """Write one ``cds_domain_packets`` row.

    Before it lands, ``packet`` is round-tripped through the reader's own
    ``counselle_db.packets.parse_packet_row()`` (PLAN Risk 3, §A3) against
    the live manifest for ``manifest_version`` — a packet the reader would
    reject is refused here instead of silently blackholing a domain for
    students. Raises ``PacketValidationError`` and writes nothing on
    failure. Caller is responsible for running this inside a transaction it
    can roll back (the ``INSERT`` below is not itself wrapped in one).
    """
    manifest_row = await conn.fetchrow(
        "SELECT version, content, domain_hashes FROM cds_library.cds_manifests WHERE version = $1",
        manifest_version,
    )
    if manifest_row is None:
        raise CdsStoreError(f"unknown manifest_version {manifest_version!r}")
    try:
        manifest_snapshot = compile_manifest(
            manifest_row["version"], manifest_row["content"], manifest_row["domain_hashes"]
        )
        parse_packet_row(
            {
                "packet": packet,
                "pdf_sha256": pdf_sha256,
                "domain_schema_hash": domain_schema_hash,
                "domain_id": domain_id,
                "academic_year": academic_year,
                "extraction_id": extraction_id,
                "manifest_version": manifest_version,
                "accepted_packet_status": status,
                # Informational-only fields on ParsedPacket — not part of
                # parse_packet_row's identity/shape checks (see the `checks`
                # tuple in counselle_db/packets.py), so fixing them here does
                # not weaken the self-validation gate.
                "current_definition_match": True,
                "currentness": "current",
                "document_id": document_id,
            },
            {manifest_version: manifest_snapshot},
            settings.supported_packet_extractor_versions,
        )
    except ServiceError as exc:
        raise PacketValidationError(
            f"packet for document={document_id} domain={domain_id!r} failed the reader's own "
            f"parse_packet_row() round-trip: {exc}"
        ) from exc

    row = await conn.fetchrow(
        """
        INSERT INTO cds_library.cds_domain_packets
            (document_id, extraction_id, manifest_version, domain_id, domain_schema_hash,
             status, packet, validation)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING document_id, extraction_id, domain_id, status, is_active, created_at
        """,
        document_id,
        extraction_id,
        manifest_version,
        domain_id,
        domain_schema_hash,
        status,
        packet,
        validation or {},
    )
    return PacketRecord(**dict(row))


async def activate_packet(
    conn: asyncpg.Connection, *, document_id: int, extraction_id: uuid.UUID, domain_id: str
) -> None:
    """Deactivate whatever packet is currently active for
    ``(document_id, domain_id)``, then activate the given one.

    ``activated_at`` is set only on first activation (``COALESCE``) — the
    immutability trigger forbids changing it once non-null, so re-activating
    a prior packet (rollback, PLAN §G8) keeps its original timestamp instead
    of failing the trigger. The partial unique index
    ``cds_domain_packets_one_active_idx`` enforces exactly one active packet
    per ``(document_id, domain_id)`` regardless.
    """
    async with conn.transaction():
        await conn.execute(
            """
            UPDATE cds_library.cds_domain_packets
            SET is_active = false
            WHERE document_id = $1 AND domain_id = $2 AND is_active
            """,
            document_id,
            domain_id,
        )
        result = await conn.execute(
            """
            UPDATE cds_library.cds_domain_packets
            SET is_active = true, activated_at = COALESCE(activated_at, now())
            WHERE document_id = $1 AND extraction_id = $2 AND domain_id = $3
            """,
            document_id,
            extraction_id,
            domain_id,
        )
        if result == "UPDATE 0":
            raise CdsStoreError(
                f"no packet found for document={document_id} extraction={extraction_id} "
                f"domain={domain_id!r}"
            )


@dataclass(frozen=True)
class DocumentForExtraction:
    """Everything the engine (P4) needs to run one document through a model
    call: the actual PDF bytes plus the identity facts that go into every
    packet it builds. Deliberately separate from ``cds_admin_queries`` (P3),
    which never selects ``pdf_content`` for the admin read screens — the
    engine's job is exactly the one place that legitimately needs the whole
    document in memory."""

    document_id: int
    school_year_id: int
    school_id: int
    academic_year: int
    pdf_content: bytes
    pdf_sha256: bytes
    original_filename: str | None


async def fetch_document_for_extraction(
    conn: asyncpg.Connection, *, document_id: int
) -> DocumentForExtraction:
    """Load one document's PDF bytes plus its school-year identity, for the
    engine to run an extraction against. Raises ``CdsStoreError`` if the
    document does not exist -- a queued extraction must always resolve."""
    row = await conn.fetchrow(
        """
        SELECT d.id AS document_id, d.school_year_id, sy.school_id, sy.academic_year,
               d.pdf_content, d.pdf_sha256, d.original_filename
        FROM cds_library.cds_documents d
        JOIN cds_library.cds_school_years sy ON sy.id = d.school_year_id
        WHERE d.id = $1
        """,
        document_id,
    )
    if row is None:
        raise CdsStoreError(f"document {document_id} not found")
    return DocumentForExtraction(**dict(row))


async def sweep_expired_leases(
    pool: asyncpg.Pool, *, error_code: str = "worker_lost"
) -> list[uuid.UUID]:
    """Fail every ``running`` extraction whose lease has already expired
    (PLAN §E ``recover_expired``) -- the crash-recovery mechanism: a worker
    process that died mid-run leaves its claimed row ``running`` forever
    unless something else fails it forward. Called once at poller boot (so a
    restart immediately recovers whatever the previous process abandoned)
    and once per poll loop iteration thereafter.

    A single ``WHERE``-scoped ``UPDATE`` -- safe to call repeatedly or
    concurrently from multiple boots; a row already swept (or completed by
    its own worker) simply matches zero rows on the next call.
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            """
            UPDATE cds_library.cds_extractions
            SET status = 'failed', finished_at = now(), error_code = $1,
                error_message = 'worker process lost its lease (crash, restart, or timeout)'
            WHERE status = 'running' AND lease_expires_at < now()
            RETURNING id
            """,
            error_code,
        )
    return [row["id"] for row in rows]


async def create_human_review_extraction(
    conn: asyncpg.Connection,
    *,
    school_year_id: int,
    document_id: int,
    manifest_version: str,
    requested_domains: Sequence[str],
) -> ExtractionRecord:
    """Insert one already-``succeeded`` extraction row for a human correction
    (PLAN §B5 step 2) -- distinct from :func:`create_extraction`, which
    always queues work for the poller. A correction never runs through the
    model, so it is recorded as immediately complete: ``target_kind =
    'active_update'``, ``extractor_version = 'human-review-v1'``,
    ``model_id = 'human'``."""
    row = await conn.fetchrow(
        """
        INSERT INTO cds_library.cds_extractions
            (id, school_year_id, document_id, manifest_version, target_kind,
             requested_domains, status, extractor_version, model_id, started_at, finished_at)
        VALUES ($1, $2, $3, $4, 'active_update', $5, 'succeeded', $6, 'human', now(), now())
        RETURNING id, school_year_id, document_id, manifest_version, target_kind,
                  requested_domains, status, extractor_version, model_id, lease_expires_at
        """,
        uuid.uuid4(),
        school_year_id,
        document_id,
        manifest_version,
        sorted(set(requested_domains)),
        "human-review-v1",
    )
    return _extraction_record(row)


async def reject_candidate_document(
    conn: asyncpg.Connection, *, school_year_id: int, document_id: int
) -> None:
    """Reject a candidate document (PLAN §B6 candidate -> invalidated): sets
    ``invalidated_at`` exactly once (the trigger permits setting it once) and
    clears the slot's candidate pointer if it was pointing at this document."""
    async with conn.transaction():
        result = await conn.execute(
            """
            UPDATE cds_library.cds_documents
            SET invalidated_at = now()
            WHERE id = $1 AND invalidated_at IS NULL
            """,
            document_id,
        )
        if result == "UPDATE 0":
            raise CdsStoreError(f"document {document_id} is already invalidated")
        await conn.execute(
            """
            UPDATE cds_library.cds_school_years
            SET candidate_document_id = CASE
                    WHEN candidate_document_id = $2 THEN NULL ELSE candidate_document_id
                END,
                last_action_kind = 'rejected', last_action_at = now()
            WHERE id = $1
            """,
            school_year_id,
            document_id,
        )


async def promote_candidate_document(
    conn: asyncpg.Connection, *, school_year_id: int, document_id: int
) -> None:
    """Activate a candidate document (PLAN §B6 candidate -> ACTIVE): points
    ``active_document_id`` at it and clears ``candidate_document_id`` if it
    was pointing at the same document."""
    await conn.execute(
        """
        UPDATE cds_library.cds_school_years
        SET active_document_id = $2,
            candidate_document_id = CASE
                WHEN candidate_document_id = $2 THEN NULL
                ELSE candidate_document_id
            END,
            last_action_kind = 'approved', last_action_at = now()
        WHERE id = $1
        """,
        school_year_id,
        document_id,
    )


async def retire_school_year(conn: asyncpg.Connection, *, school_year_id: int) -> None:
    """Retire a ``cds_school_years`` slot (SHIP-PLAN §1.0(a)/(b)): sets
    ``retired_at`` and ``last_action_kind = 'retired'``.

    ``retired_at`` is an existing column and already the filter every admin
    coverage query uses to hide a row (``adapters/cds_admin_queries.py``),
    but nothing wrote it before this. A fabricated-year slot has no
    legitimate future use -- retiring it is a terminal action, unlike
    :func:`reject_candidate_document`, which only ever clears a candidate
    pointer and leaves the slot open for a future legitimate upload."""
    result = await conn.execute(
        """
        UPDATE cds_library.cds_school_years
        SET retired_at = now(), last_action_kind = 'retired', last_action_at = now()
        WHERE id = $1 AND retired_at IS NULL
        """,
        school_year_id,
    )
    if result == "UPDATE 0":
        raise CdsStoreError(f"school_year {school_year_id} not found or already retired")


async def discard_active_document(
    conn: asyncpg.Connection, *, school_year_id: int, document_id: int
) -> None:
    """Discard an *active* document that never should have served students
    (SHIP-PLAN §1.0(b), §0.11) -- distinct from :func:`reject_candidate_document`,
    which only ever handles a document that is still a *candidate*.

    In one transaction: invalidate the document, clear the slot's
    ``active_document_id`` pointer, and retire the slot. All three are
    required together -- both ``active_cds_documents`` and
    ``active_cds_domain_packets`` join purely on
    ``sy.active_document_id = d.id`` with no ``d.invalidated_at`` filter
    anywhere in either view, so invalidating the document alone would not
    stop it serving; the pointer itself has to move. This is a distinct case
    from the Phase 2 ``active_update`` correction flow, which corrects an
    active document that is still good -- this discards one that never was.
    """
    async with conn.transaction():
        result = await conn.execute(
            """
            UPDATE cds_library.cds_documents
            SET invalidated_at = now()
            WHERE id = $1 AND invalidated_at IS NULL
            """,
            document_id,
        )
        if result == "UPDATE 0":
            raise CdsStoreError(f"document {document_id} is already invalidated")
        result = await conn.execute(
            """
            UPDATE cds_library.cds_school_years
            SET active_document_id = NULL,
                retired_at = now(),
                last_action_kind = 'retired',
                last_action_at = now()
            WHERE id = $1 AND active_document_id = $2 AND retired_at IS NULL
            """,
            school_year_id,
            document_id,
        )
        if result == "UPDATE 0":
            raise CdsStoreError(
                f"school_year {school_year_id} was not pointing at document "
                f"{document_id} as active, or is already retired"
            )
