"""Read queries over `cds_library.*` base tables for the CDS admin surface (plan §C).

Every function here takes the *pipeline pool* (`Runtime.pipeline_pool`,
`cds_library_app` role — INSERT/SELECT/UPDATE on the base tables, per
plan §C1) — never the reader pool, because the admin screens need candidate
documents, failed extractions, and inactive packets, none of which the five
`cds_library_reader` views expose (they only ever show the *active* document).

Hard rule: never select `pdf_content` here. It is the PDF bytes and is huge;
only the dedicated page-image route (P5) touches it, one page at a time.

Parameterized SQL only (`$1`, `$2`, ...) — no f-string interpolation of values.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import asyncpg

from adapters.cds_admin_types import (
    CoverageCell,
    CoverageCounters,
    CoverageResult,
    CoverageRow,
    DocumentMeta,
    DocumentReview,
    DomainPacketSummary,
    DuplicateDocumentRef,
    EvidenceRow,
    ExtractionRow,
    FlagRow,
    JobStatusRow,
    MetricRow,
    SchoolSummary,
)
from adapters.cds_store import _PENDING_ACTIVE_UPDATE_PREDICATE_SQL

# One school-picker/coverage search predicate, reused everywhere a school name
# or alias is matched. `$N` here is the lowercased, trimmed query text.
_SCHOOL_SEARCH_PREDICATE = """
  ({param}::text IS NULL OR
   search_name LIKE {param}::text || '%' OR
   name ILIKE '%' || {param}::text || '%' OR
   EXISTS (SELECT 1 FROM unnest(aliases) AS alias WHERE alias ILIKE '%' || {param}::text || '%'))
"""

_SEARCH_SCHOOLS_SQL = f"""
SELECT id, name, state, city
FROM cds_library.schools
WHERE {_SCHOOL_SEARCH_PREDICATE.format(param="$1")}
ORDER BY (search_name LIKE $1 || '%') DESC, name
LIMIT $2
"""

# The coverage grid. Bounded by the number of school-year *slots* that exist
# (i.e. schools with any CDS activity) — never by the full 2,746-school
# catalog, because `schools` is only ever reached via `sy.school_id`, an
# indexed lookup keyed off `cds_school_years`. Verified via EXPLAIN ANALYZE at
# 2,005 synthetic slots / 2,026 extractions / 6,217 packets: 15.66ms total
# (see the P3 verification report) — comfortably fast at the full realistic
# ceiling (every one of the 2,746 IPEDS schools with CDS coverage).
_COVERAGE_SQL = f"""
WITH slots AS (
  SELECT sy.id AS school_year_id, sy.school_id, s.name, s.state, sy.academic_year,
         sy.active_document_id, sy.candidate_document_id
  FROM cds_library.cds_school_years sy
  JOIN cds_library.schools s ON s.id = sy.school_id
  WHERE sy.retired_at IS NULL
    AND {_SCHOOL_SEARCH_PREDICATE.format(param="$1")}
),
target_docs AS (
  SELECT active_document_id AS document_id FROM slots WHERE active_document_id IS NOT NULL
  UNION
  SELECT candidate_document_id FROM slots WHERE candidate_document_id IS NOT NULL
),
latest_extractions AS (
  SELECT DISTINCT ON (e.document_id) e.document_id, e.id, e.status, e.error_code,
         e.extractor_version, e.finished_at
  FROM cds_library.cds_extractions e
  JOIN target_docs td ON td.document_id = e.document_id
  ORDER BY e.document_id, e.queued_at DESC
),
packet_counts AS (
  SELECT p.document_id,
         count(*) FILTER (WHERE is_active) AS n_active,
         count(*) FILTER (WHERE is_active AND status = 'partial') AS n_active_partial,
         count(*) AS n_total
  FROM cds_library.cds_domain_packets p
  JOIN target_docs td ON td.document_id = p.document_id
  GROUP BY p.document_id
),
live_jobs AS (
  SELECT school_year_id, id AS extraction_id, status
  FROM cds_library.cds_extractions
  WHERE status IN ('queued', 'running')
)
SELECT slots.school_id, slots.name, slots.state, slots.academic_year, slots.school_year_id,
       slots.active_document_id, slots.candidate_document_id,
       CASE
         WHEN lj.extraction_id IS NOT NULL THEN 'processing'
         WHEN slots.active_document_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM cds_library.cds_extractions
           WHERE document_id = slots.active_document_id AND {_PENDING_ACTIVE_UPDATE_PREDICATE_SQL}
         ) THEN 'correction_pending'
         WHEN slots.active_document_id IS NOT NULL THEN 'approved'
         WHEN slots.candidate_document_id IS NOT NULL AND COALESCE(cand_pc.n_total, 0) > 0
           THEN 'needs_review'
         WHEN slots.candidate_document_id IS NOT NULL AND cand_x.status = 'failed' THEN 'failed'
         WHEN slots.candidate_document_id IS NOT NULL THEN 'processing'
         ELSE 'none'
       END AS cell_status,
       lj.extraction_id AS live_extraction_id, lj.status AS live_job_status,
       cand_x.id AS cand_extraction_id, cand_x.error_code AS cand_error_code,
       cand_x.extractor_version AS cand_extractor_version, cand_x.finished_at AS cand_finished_at,
       act_x.id AS act_extraction_id, act_x.extractor_version AS act_extractor_version,
       act_x.finished_at AS act_finished_at,
       cand_pc.n_total AS cand_total_domains,
       act_pc.n_active AS act_active_domains, act_pc.n_active_partial AS act_partial_domains
FROM slots
LEFT JOIN live_jobs lj ON lj.school_year_id = slots.school_year_id
LEFT JOIN latest_extractions cand_x ON cand_x.document_id = slots.candidate_document_id
LEFT JOIN latest_extractions act_x ON act_x.document_id = slots.active_document_id
LEFT JOIN packet_counts cand_pc ON cand_pc.document_id = slots.candidate_document_id
LEFT JOIN packet_counts act_pc ON act_pc.document_id = slots.active_document_id
ORDER BY slots.name, slots.academic_year
"""

# Schools with zero cds_school_years rows at all — the "all_schools" search
# path (plan §D endpoint #1: "all_schools=true + q searches the full 2,746 for
# empty-cell upload targets"). Only ever run with a non-blank `q`, and always
# LIMIT-capped — never a bare dump of the catalog.
_UNLISTED_SCHOOLS_SQL = f"""
SELECT s.id AS school_id, s.name, s.state
FROM cds_library.schools s
WHERE {_SCHOOL_SEARCH_PREDICATE.format(param="$1")}
  AND NOT EXISTS (
    SELECT 1 FROM cds_library.cds_school_years sy
    WHERE sy.school_id = s.id AND sy.retired_at IS NULL
  )
ORDER BY (s.search_name LIKE $1 || '%') DESC, s.name
LIMIT $2
"""

_YEARS_SQL = """
SELECT DISTINCT academic_year FROM cds_library.cds_school_years
WHERE retired_at IS NULL ORDER BY academic_year
"""

# The real catalog size for the "All schools" find-mode idle prompt
# (DESIGN.md §3.9: "Search 2,746 schools by name to add a document.") — the
# number must come from the DB, never be hardcoded.
_SCHOOL_COUNT_SQL = "SELECT count(*) FROM cds_library.schools"

_DOCUMENT_META_SQL = """
SELECT d.id, d.school_year_id, sy.school_id, s.name AS school_name, sy.academic_year,
       encode(d.pdf_sha256, 'hex') AS pdf_sha256, d.pdf_size_bytes, d.original_filename,
       d.source_kind, d.retrieved_at, d.invalidated_at, d.superseded_at,
       COALESCE(sy.candidate_document_id = d.id, false) AS is_candidate,
       COALESCE(sy.active_document_id = d.id, false) AS is_active
FROM cds_library.cds_documents d
JOIN cds_library.cds_school_years sy ON sy.id = d.school_year_id
JOIN cds_library.schools s ON s.id = sy.school_id
WHERE d.id = $1
"""

_DOCUMENT_EXTRACTIONS_SQL = """
SELECT id, document_id, target_kind, status, requested_domains, extractor_version, model_id,
       queued_at, started_at, finished_at, error_code, error_message, validation_summary
FROM cds_library.cds_extractions
WHERE document_id = $1
ORDER BY queued_at DESC
"""

# Most recent packet per domain for this document, regardless of extraction
# outcome or active flag — a candidate document's packets are never active,
# and a document mid-review may have several extraction attempts per domain.
_DOCUMENT_PACKETS_SQL = """
SELECT DISTINCT ON (domain_id) domain_id, extraction_id, status, is_active, created_at,
       packet, validation
FROM cds_library.cds_domain_packets
WHERE document_id = $1
ORDER BY domain_id, created_at DESC
"""

# Dedupe check for the upload staging table (plan §D endpoint #3): has this
# exact PDF (by content hash) already been ingested anywhere in cds_library,
# regardless of which school-year slot it landed in?
#
# `sy.retired_at IS NULL` is defense-in-depth, not a behaviour change under
# the current data: every disposal path (`reject_candidate_document`,
# `discard_active_document`) invalidates the document *before* the slot is
# retired, so a retired slot's document is already excluded by
# `invalidated_at IS NULL` alone. It exists because that invariant was
# violated once already (SHIP-PLAN §0.11 document 2009 / school-year 4009:
# retired with nothing left to reject, so the document itself was never
# invalidated and stayed reachable by this exact query) — see
# `adapters.cds_store.invalidate_orphaned_document`, which fixed the data.
# This clause stops the *class* of bug from leaking a dead slot's document
# into the duplicate-upload UI again, without touching documents that
# genuinely aren't pointed to by a *live* slot's candidate (an unreviewed
# candidate superseded by a newer upload to the same still-open slot stays
# a real duplicate match — that slot's `retired_at` is still NULL).
_DOCUMENT_BY_SHA256_SQL = """
SELECT d.id, d.school_year_id, sy.school_id, s.name AS school_name, sy.academic_year
FROM cds_library.cds_documents d
JOIN cds_library.cds_school_years sy ON sy.id = d.school_year_id
JOIN cds_library.schools s ON s.id = sy.school_id
WHERE d.pdf_sha256 = $1 AND d.invalidated_at IS NULL AND sy.retired_at IS NULL
ORDER BY d.retrieved_at DESC
LIMIT 1
"""

# Does this school-year slot already have an active or candidate document
# (plan §D "replaces_existing" staging status)?
_SLOT_HAS_DOCUMENT_SQL = """
SELECT active_document_id, candidate_document_id
FROM cds_library.cds_school_years
WHERE school_id = $1 AND academic_year = $2 AND retired_at IS NULL
"""

_JOB_STATUS_SQL = """
SELECT e.id AS extraction_id, sy.school_id, s.name AS school_name, sy.academic_year,
       e.document_id, e.status, e.queued_at, e.started_at, e.finished_at, e.error_code,
       e.validation_summary
FROM cds_library.cds_extractions e
JOIN cds_library.cds_school_years sy ON sy.id = e.school_year_id
JOIN cds_library.schools s ON s.id = sy.school_id
WHERE e.id = ANY($1::uuid[])
ORDER BY e.queued_at
"""


def _normalize(q: str | None) -> str | None:
    if q is None:
        return None
    normalized = q.strip().lower()
    return normalized or None


async def coverage_years(pool: asyncpg.Pool) -> list[int]:
    """Distinct academic years with any (non-retired) school-year slot."""
    async with pool.acquire() as conn:
        rows = await conn.fetch(_YEARS_SQL)
    return [int(row["academic_year"]) for row in rows]


async def search_schools(pool: asyncpg.Pool, q: str, *, limit: int = 20) -> list[SchoolSummary]:
    """Typeahead over the full 2,746-school catalog (upload screen's picker)."""
    normalized = _normalize(q)
    if normalized is None:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(_SEARCH_SCHOOLS_SQL, normalized, limit)
    return [
        SchoolSummary(id=row["id"], name=row["name"], state=row["state"], city=row["city"])
        for row in rows
    ]


def _cell_from_row(row: asyncpg.Record) -> CoverageCell:
    status: str = row["cell_status"]
    if status == "processing":
        return CoverageCell(
            status="processing",
            school_year_id=row["school_year_id"],
            extraction_id=str(row["live_extraction_id"]) if row["live_extraction_id"] else None,
            job_status=row["live_job_status"],
        )
    if status in ("approved", "correction_pending"):
        return CoverageCell(
            status=status,  # type: ignore[arg-type]
            school_year_id=row["school_year_id"],
            document_id=row["active_document_id"],
            extraction_id=str(row["act_extraction_id"]) if row["act_extraction_id"] else None,
            extractor_version=row["act_extractor_version"],
            updated_at=row["act_finished_at"],
            active_domains=row["act_active_domains"],
            partial_domains=row["act_partial_domains"],
        )
    if status in ("needs_review", "failed"):
        return CoverageCell(
            status=status,  # type: ignore[arg-type]
            school_year_id=row["school_year_id"],
            document_id=row["candidate_document_id"],
            extraction_id=str(row["cand_extraction_id"]) if row["cand_extraction_id"] else None,
            extractor_version=row["cand_extractor_version"],
            error_code=row["cand_error_code"],
            updated_at=row["cand_finished_at"],
            candidate_domains=row["cand_total_domains"],
        )
    return CoverageCell(status="none", school_year_id=row["school_year_id"])


def _counters_from_groups(groups: dict[int, CoverageRow], years: list[int]) -> CoverageCounters:
    """Header counters over the filtered set (plan §D endpoint #1, §F3's
    "N schools · N editions · N needs review · N failed" line). Per-status
    counts are school counts (a school with 2 needs_review years counts once),
    matching the sentence's grain; `missing` is school×year cells with no
    document at all, within the same filtered set."""
    per_status = {"needs_review": 0, "processing": 0, "approved": 0, "failed": 0}
    editions = 0
    missing = 0
    for cell_row in groups.values():
        seen: set[str] = set()
        for year in years:
            cell = cell_row.cells.get(year)
            status = cell.status if cell else "none"
            if status == "none":
                missing += 1
                continue
            editions += 1
            if status in per_status and status not in seen:
                per_status[status] += 1
                seen.add(status)
    return CoverageCounters(
        schools=len(groups),
        editions=editions,
        needs_review=per_status["needs_review"],
        processing=per_status["processing"],
        approved=per_status["approved"],
        failed=per_status["failed"],
        missing=missing,
    )


def _group_activity_rows(rows: list[asyncpg.Record]) -> dict[int, CoverageRow]:
    groups: dict[int, CoverageRow] = {}
    for row in rows:
        school_id = row["school_id"]
        existing = groups.get(school_id)
        cells = dict(existing.cells) if existing else {}
        cells[row["academic_year"]] = _cell_from_row(row)
        groups[school_id] = CoverageRow(
            school_id=school_id, name=row["name"], state=row["state"], cells=cells
        )
    return groups


async def coverage_grid(
    pool: asyncpg.Pool,
    *,
    q: str | None = None,
    year_filter: list[int] | None = None,
    status_filter: list[str] | None = None,
    missing_year: int | None = None,
    all_schools: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> CoverageResult:
    """The Screen-1 coverage grid: schools × years, one status per cell.

    Default scope is schools with >=1 `cds_school_years` row (bounded by CDS
    activity, not the 2,746-school catalog). `all_schools=True` additionally
    surfaces catalog schools with zero rows, but only when `q` is set — it
    never dumps the full catalog.

    `all_schools=True` with a blank `q` is the find-mode *idle* state
    (DESIGN.md §3.1 move 2 / §3.9): the toggle changes what search reaches,
    not what is rendered, so this always answers with zero rows — never the
    with-documents activity subset the base query would otherwise return —
    and `total` is the real school-catalog count, so the UI's search prompt
    can say "Search 2,746 schools..." with a true number.
    """
    normalized = _normalize(q)
    is_find_mode_idle = all_schools and normalized is None
    years = await coverage_years(pool)
    async with pool.acquire() as conn:
        activity_rows = await conn.fetch(_COVERAGE_SQL, normalized)
        groups = _group_activity_rows(activity_rows)
        if all_schools and normalized is not None:
            unlisted = await conn.fetch(_UNLISTED_SCHOOLS_SQL, normalized, limit)
            for row in unlisted:
                groups.setdefault(
                    row["school_id"],
                    CoverageRow(
                        school_id=row["school_id"], name=row["name"], state=row["state"], cells={}
                    ),
                )
        if is_find_mode_idle:
            school_count = await conn.fetchval(_SCHOOL_COUNT_SQL)
    filtered = _apply_filters(
        groups, status_filter=status_filter, missing_year=missing_year, year_filter=year_filter
    )
    counters = _counters_from_groups(filtered, years)
    ordered = sorted(filtered.values(), key=lambda r: r.name)
    if is_find_mode_idle:
        return CoverageResult(years=years, rows=[], counters=counters, total=int(school_count))
    page = ordered[offset : offset + limit]
    return CoverageResult(years=years, rows=page, counters=counters, total=len(ordered))


def _apply_filters(
    groups: dict[int, CoverageRow],
    *,
    status_filter: list[str] | None,
    missing_year: int | None,
    year_filter: list[int] | None = None,
) -> dict[int, CoverageRow]:
    result = groups
    if year_filter:
        wanted_years = set(year_filter)
        result = {
            sid: row
            for sid, row in result.items()
            if any(
                year in wanted_years and cell.status != "none"
                for year, cell in row.cells.items()
            )
        }
    if status_filter:
        wanted = set(status_filter)
        result = {
            sid: row
            for sid, row in result.items()
            if any(cell.status in wanted for cell in row.cells.values())
        }
    if missing_year is not None:
        result = {
            sid: row
            for sid, row in result.items()
            if missing_year not in row.cells or row.cells[missing_year].status == "none"
        }
    return result


def _evidence_from_raw(raw: dict[str, Any] | None) -> EvidenceRow | None:
    if not isinstance(raw, dict):
        return None
    return EvidenceRow(
        page_number=raw.get("page_number"),
        excerpt=raw.get("excerpt"),
        section=raw.get("section"),
        row_label=raw.get("row_label"),
        column_label=raw.get("column_label"),
    )


def _metrics_from_packet(packet: dict[str, Any]) -> tuple[list[MetricRow], bool]:
    raw_metrics = packet.get("metrics")
    if not isinstance(raw_metrics, dict):
        return [], True
    metrics: list[MetricRow] = []
    for ref, raw in raw_metrics.items():
        if not isinstance(raw, dict):
            continue
        metrics.append(
            MetricRow(
                ref=ref,
                extraction_status=raw.get("extraction_status"),
                availability_status=raw.get("availability_status"),
                value=raw.get("value"),
                raw_value=raw.get("raw_value"),
                evidence=_evidence_from_raw(raw.get("evidence")),
                diagnostic_code=raw.get("diagnostic_code"),
            )
        )
    return metrics, False


async def get_document_review(pool: asyncpg.Pool, document_id: int) -> DocumentReview | None:
    """Everything Screen 3 needs: document metadata, extraction runs, and the
    most recent packet per domain (with evidence + validation flags)."""
    async with pool.acquire() as conn:
        doc_row = await conn.fetchrow(_DOCUMENT_META_SQL, document_id)
        if doc_row is None:
            return None
        extraction_rows = await conn.fetch(_DOCUMENT_EXTRACTIONS_SQL, document_id)
        packet_rows = await conn.fetch(_DOCUMENT_PACKETS_SQL, document_id)
    document = DocumentMeta(
        id=doc_row["id"],
        school_year_id=doc_row["school_year_id"],
        school_id=doc_row["school_id"],
        school_name=doc_row["school_name"],
        academic_year=doc_row["academic_year"],
        pdf_sha256=doc_row["pdf_sha256"],
        pdf_size_bytes=doc_row["pdf_size_bytes"],
        original_filename=doc_row["original_filename"],
        source_kind=doc_row["source_kind"],
        retrieved_at=doc_row["retrieved_at"],
        invalidated_at=doc_row["invalidated_at"],
        superseded_at=doc_row["superseded_at"],
        is_candidate=doc_row["is_candidate"],
        is_active=doc_row["is_active"],
    )
    extractions = [
        ExtractionRow(
            id=str(row["id"]),
            document_id=row["document_id"],
            target_kind=row["target_kind"],
            status=row["status"],
            requested_domains=list(row["requested_domains"]),
            extractor_version=row["extractor_version"],
            model_id=row["model_id"],
            queued_at=row["queued_at"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            error_code=row["error_code"],
            error_message=row["error_message"],
            progress=row["validation_summary"] or {},
        )
        for row in extraction_rows
    ]
    domains = [_domain_summary_from_row(row) for row in packet_rows]
    return DocumentReview(document=document, extractions=extractions, domains=domains)


def _flags_from_validation(raw: dict[str, Any] | None) -> list[FlagRow]:
    if not isinstance(raw, dict):
        return []
    raw_flags = raw.get("flags")
    if not isinstance(raw_flags, list):
        return []
    return [FlagRow.model_validate(flag) for flag in raw_flags if isinstance(flag, dict)]


def _domain_summary_from_row(row: asyncpg.Record) -> DomainPacketSummary:
    packet = row["packet"] or {}
    metrics, unparseable = _metrics_from_packet(packet)
    counts_raw = packet.get("counts") if isinstance(packet, dict) else None
    counts = {k: int(v) for k, v in counts_raw.items()} if isinstance(counts_raw, dict) else {}
    provider_contract = packet.get("provider_contract") if isinstance(packet, dict) else None
    return DomainPacketSummary(
        domain_id=row["domain_id"],
        extraction_id=str(row["extraction_id"]),
        status=row["status"],
        is_active=row["is_active"],
        created_at=row["created_at"],
        counts=counts,
        metrics=metrics,
        flags=_flags_from_validation(row["validation"]),
        provider_contract=provider_contract if isinstance(provider_contract, dict) else None,
        unparseable=unparseable,
    )


async def job_status(pool: asyncpg.Pool, extraction_ids: list[UUID]) -> list[JobStatusRow]:
    """Live status for the upload screen's job-polling list (endpoint #8)."""
    if not extraction_ids:
        return []
    async with pool.acquire() as conn:
        rows = await conn.fetch(_JOB_STATUS_SQL, extraction_ids)
    return [
        JobStatusRow(
            extraction_id=str(row["extraction_id"]),
            school_id=row["school_id"],
            school_name=row["school_name"],
            academic_year=row["academic_year"],
            document_id=row["document_id"],
            status=row["status"],
            queued_at=row["queued_at"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            error_code=row["error_code"],
            progress=row["validation_summary"] or {},
        )
        for row in rows
    ]


async def find_document_by_sha256(
    pool: asyncpg.Pool, sha256: bytes
) -> DuplicateDocumentRef | None:
    """Has this exact PDF already been ingested anywhere in `cds_library`
    (any school-year slot)? Backs the upload staging table's `duplicate`
    status (plan §D endpoint #3)."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(_DOCUMENT_BY_SHA256_SQL, sha256)
    if row is None:
        return None
    return DuplicateDocumentRef(
        document_id=row["id"],
        school_year_id=row["school_year_id"],
        school_id=row["school_id"],
        school_name=row["school_name"],
        academic_year=row["academic_year"],
    )


async def schools_by_ids(pool: asyncpg.Pool, school_ids: set[int]) -> dict[int, str]:
    """``school_id -> name`` for a small set of ids (the upload staging
    table's display name, plan §D endpoints #4/#5)."""
    if not school_ids:
        return {}
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT id, name FROM cds_library.schools WHERE id = ANY($1::int[])",
            list(school_ids),
        )
    return {row["id"]: row["name"] for row in rows}


async def slot_has_document(pool: asyncpg.Pool, *, school_id: int, academic_year: int) -> bool:
    """Does `(school_id, academic_year)` already have an active or candidate
    document? Backs the upload staging table's `replaces_existing` status."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(_SLOT_HAS_DOCUMENT_SQL, school_id, academic_year)
    if row is None:
        return False
    return row["active_document_id"] is not None or row["candidate_document_id"] is not None
