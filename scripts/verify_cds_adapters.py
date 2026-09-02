#!/usr/bin/env python3
"""P2 verification script for `adapters/cds_gemini.py`, `adapters/cds_pdf.py`,
and `adapters/cds_store.py` (plan §H row P2).

Runs, in order:

1. A real Gemini call (`cds_gemini.generate_structured`) against
   `artifacts/cds-corpus/harvard_2024-2025.pdf` for a small hand-written
   schema — prints findings, token usage, latency, and a cost estimate.
   **This makes a real, billed API call.**
2. `cds_pdf.render_page_png` against the same PDF — verifies PNG magic
   bytes + dimensions and saves one page to `artifacts/` for visual review.
3. `cds_pdf.detect_corrupt_text_layer` across all 15 corpus PDFs — prints
   true/false positive counts.
4. `cds_store`'s full school-year -> document -> extraction -> packet chain
   against the LIVE `cds_library_app`-role DB, inside one transaction that
   is always rolled back. Prints row counts before/after to prove nothing
   was left behind.

Usage: ``uv run python scripts/verify_cds_adapters.py``
"""

from __future__ import annotations

import asyncio
import glob
import os
import uuid
from datetime import UTC, datetime
from typing import Any

import asyncpg
from pydantic import BaseModel, Field

from adapters import cds_gemini, cds_pdf, cds_store
from app.cds.manifest import load_compiled_manifest
from config.settings import get_settings
from counselle_db.db import create_pool

_CORPUS_DIR = "artifacts/cds-corpus"
_HARVARD_PDF = os.path.join(_CORPUS_DIR, "harvard_2024-2025.pdf")
_OUTPUT_PNG = "artifacts/cds-adapters-verify-page1.png"

# Vertex AI PayGo pricing for gemini-3.1-flash-lite, USD/1M tokens
# (recon-vertex.md §4e — cross-check against cloud.google.com pricing before
# relying on this outside this one-off report; not wired into
# Settings.model_prices, which has no entry for this model yet).
_INPUT_PRICE_PER_1M = 0.25
_OUTPUT_PRICE_PER_1M = 1.50

# recon-cds-corpus.md §5: a real domain/metric from the live current
# manifest, used to build a realistic packet for the rollback demo.
_DEMO_DOMAIN_ID = "academics"
_DEMO_METRIC_REF = "academics.special_study_accelerated_program"
_DEMO_DOMAIN_SCHEMA_HASH_HEX = "74f96589b5523c2bd28021736471a1bc41d05b003fc6c7a2b635f6281fb0ae36"
# Whatever manifest is actually current, per the same compiled source of
# truth production reads (app/cds/manifest.py) -- never a hardcoded version
# string that silently drifts behind a manifest bump.
_DEMO_MANIFEST_VERSION = load_compiled_manifest().version
_DEMO_SCHOOL_ID = 100654  # Alabama A&M University — same probe row recon-db-live.md used
_DEMO_ACADEMIC_YEAR = 2099  # far future, never collides with real coverage


class DemoFinding(BaseModel):
    metric: str
    value: str
    page_number: int = Field(ge=1)
    excerpt: str = Field(min_length=1)


class DemoExtraction(BaseModel):
    school_name: str
    academic_year: str
    findings: list[DemoFinding]


_DEMO_PROMPT = """You are reading a Common Data Set (CDS) PDF for a US university.

Return:
- school_name: the institution's name (from the A0/A1 respondent information section)
- academic_year: the CDS reporting year exactly as printed (e.g. "2024-2025")
- findings: exactly one entry for the C1 statistic "Total first-time,
  first-year students who applied" (men + women + another gender combined,
  Fall term). For that one finding set metric="c1_total_applicants", value
  to the number as printed, page_number to the 1-indexed physical page it
  appears on, and excerpt to a short verbatim snippet from that page
  containing the number.
"""


async def verify_gemini_call() -> None:
    print("\n=== 1. cds_gemini.generate_structured (real API call) ===")
    settings = get_settings()
    with open(_HARVARD_PDF, "rb") as handle:
        pdf_bytes = handle.read()

    result = await cds_gemini.generate_structured(
        settings=settings,
        prompt=_DEMO_PROMPT,
        response_schema=DemoExtraction,
        pdf_bytes=pdf_bytes,
        max_output_tokens=2048,
    )
    parsed = result.parsed
    assert isinstance(parsed, DemoExtraction)

    print(f"model_id:        {result.model_id}")
    print(f"finish_reason:   {result.finish_reason}")
    print(f"latency_seconds: {result.latency_seconds:.2f}")
    print(f"school_name:     {parsed.school_name!r}")
    print(f"academic_year:   {parsed.academic_year!r}")
    for finding in parsed.findings:
        print(
            f"  finding: {finding.metric}={finding.value!r} page={finding.page_number} "
            f"excerpt={finding.excerpt!r}"
        )

    usage = result.usage
    cost = (usage.prompt_tokens / 1_000_000) * _INPUT_PRICE_PER_1M + (
        usage.output_tokens / 1_000_000
    ) * _OUTPUT_PRICE_PER_1M
    print(
        f"usage: prompt={usage.prompt_tokens} output={usage.output_tokens} "
        f"thoughts={usage.thoughts_tokens} cached={usage.cached_tokens} "
        f"total={usage.total_tokens}"
    )
    print(
        f"estimated cost: ${cost:.6f} "
        f"(gemini-3.1-flash-lite @ ${_INPUT_PRICE_PER_1M}/${_OUTPUT_PRICE_PER_1M} per 1M in/out)"
    )


async def verify_render_page_png() -> None:
    print("\n=== 2. cds_pdf.render_page_png ===")
    with open(_HARVARD_PDF, "rb") as handle:
        pdf_bytes = handle.read()

    page_count = await cds_pdf.get_page_count(pdf_bytes)
    png_bytes = await cds_pdf.render_page_png(pdf_bytes, 1, dpi=150)

    assert png_bytes[:8] == b"\x89PNG\r\n\x1a\n", "not a valid PNG (bad magic bytes)"
    # Read width/height straight from the IHDR chunk (bytes 16-24) rather
    # than pulling in an image library just for this assertion.
    width = int.from_bytes(png_bytes[16:20], "big")
    height = int.from_bytes(png_bytes[20:24], "big")
    assert width > 0 and height > 0, "PNG reports zero dimensions"

    os.makedirs("artifacts", exist_ok=True)
    with open(_OUTPUT_PNG, "wb") as out:
        out.write(png_bytes)

    print(f"document page_count: {page_count}")
    print(f"page 1 PNG: {len(png_bytes)} bytes, {width}x{height}, magic OK")
    print(f"saved to: {_OUTPUT_PNG}")

    sub_bytes, page_map = await cds_pdf.narrow_document(pdf_bytes, [3, 5])
    sub_pages = await cds_pdf.get_page_count(sub_bytes)
    print(f"narrow_document([3, 5]) -> {sub_pages}-page sub-PDF, page_map={page_map}")
    assert sub_pages == 2
    assert page_map == {1: 3, 2: 5}


async def verify_corrupt_text_detector() -> None:
    print("\n=== 3. cds_pdf.detect_corrupt_text_layer across the 15-file corpus ===")
    paths = sorted(glob.glob(os.path.join(_CORPUS_DIR, "*.pdf")))
    assert paths, f"no PDFs found in {_CORPUS_DIR} — is the corpus checked out?"

    true_positive = false_positive = true_negative = false_negative = 0
    for path in paths:
        with open(path, "rb") as handle:
            pdf_bytes = handle.read()
        report = await cds_pdf.detect_corrupt_text_layer(pdf_bytes)
        expected_corrupt = "caltech" in os.path.basename(path)
        if report.is_corrupt and expected_corrupt:
            true_positive += 1
        elif report.is_corrupt and not expected_corrupt:
            false_positive += 1
        elif not report.is_corrupt and expected_corrupt:
            false_negative += 1
        else:
            true_negative += 1
        print(
            f"  {os.path.basename(path):40s} is_corrupt={report.is_corrupt!s:5} "
            f"control_chars={report.control_char_count:5d} "
            f"affected_pages={len(report.affected_pages)}"
        )

    print(
        f"true_positive={true_positive} false_positive={false_positive} "
        f"true_negative={true_negative} false_negative={false_negative} "
        f"(expected: 1 true_positive [caltech], 14 true_negative, 0 of either false)"
    )
    assert true_positive == 1 and false_positive == 0 and false_negative == 0


def _build_demo_packet(*, extraction_id: uuid.UUID, document_sha256_hex: str) -> dict[str, Any]:
    return {
        "document_sha256": document_sha256_hex,
        "academic_year": _DEMO_ACADEMIC_YEAR,
        "extraction_id": str(extraction_id),
        "manifest_version": _DEMO_MANIFEST_VERSION,
        "domain_id": _DEMO_DOMAIN_ID,
        "domain_schema_hash": _DEMO_DOMAIN_SCHEMA_HASH_HEX,
        "extractor_version": "counselle-cds-v1",
        "model_id": "gemini-3.1-flash-lite",
        "status": "validated",
        "counts": {"verified": 1, "not_extracted": 0, "conflict": 0, "invalid": 0},
        "metrics": {
            _DEMO_METRIC_REF: {
                "extraction_status": "verified",
                "availability_status": "reported",
                "value": True,
                "raw_value": "Yes",
                "evidence": {
                    "page_number": 1,
                    "excerpt": (
                        "Accelerated program: Yes (P2 rollback verification demo, not real data)."
                    ),
                    "section": None,
                    "row_label": None,
                    "column_label": None,
                },
                "diagnostic_code": None,
            }
        },
    }


_ROW_COUNT_TABLES = (
    "cds_school_years",
    "cds_documents",
    "cds_extractions",
    "cds_domain_packets",
)


async def _row_counts(conn: asyncpg.Connection) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in _ROW_COUNT_TABLES:
        counts[table] = await conn.fetchval(f"SELECT count(*) FROM cds_library.{table}")
    return counts


async def verify_store_write_chain() -> None:
    print("\n=== 4. cds_store full write chain (rolled back, never committed) ===")
    settings = get_settings()
    if not settings.db_pipeline_dsn:
        print("SKIPPED: COUNSELLE_DB_PIPELINE_DSN is not configured")
        return

    pool = await create_pool(dsn=settings.db_pipeline_dsn, settings=settings)
    try:
        async with pool.acquire() as conn:
            before = await _row_counts(conn)
            print(f"row counts before: {before}")

            tx = conn.transaction()
            await tx.start()
            try:
                slot = await cds_store.upsert_school_year(
                    conn, school_id=_DEMO_SCHOOL_ID, academic_year=_DEMO_ACADEMIC_YEAR
                )
                print(f"upsert_school_year -> id={slot.id}")

                document = await cds_store.insert_document(
                    conn,
                    school_year_id=slot.id,
                    pdf_content=b"%PDF-1.4 P2 rollback verification fixture, not a real CDS PDF.",
                    source_kind="upload",
                    retrieved_at=datetime.now(UTC),
                    original_filename="p2-verify-fixture.pdf",
                )
                print(f"insert_document -> id={document.id} is_duplicate={document.is_duplicate}")

                await cds_store.set_candidate_document(
                    conn, school_year_id=slot.id, document_id=document.id
                )
                print("set_candidate_document -> ok")

                extraction = await cds_store.create_extraction(
                    conn,
                    school_year_id=slot.id,
                    document_id=document.id,
                    manifest_version=_DEMO_MANIFEST_VERSION,
                    target_kind="candidate",
                    requested_domains=[_DEMO_DOMAIN_ID],
                    extractor_version="counselle-cds-v1",
                    model_id="gemini-3.1-flash-lite",
                )
                print(f"create_extraction -> id={extraction.id} status={extraction.status}")

                # Mirrors claim_next_extraction's UPDATE, scoped to this one
                # row by id (claim_next_extraction itself acquires its own
                # pool connection, which can't see this uncommitted row —
                # exercised separately, safely, below).
                await conn.execute(
                    """
                    UPDATE cds_library.cds_extractions
                    SET status = 'running', started_at = now(),
                        lease_expires_at = now() + make_interval(secs => $2)
                    WHERE id = $1 AND status = 'queued'
                    """,
                    extraction.id,
                    settings.cds_extraction_lease_seconds,
                )
                lease_expires_at = await cds_store.renew_lease(
                    conn,
                    extraction_id=extraction.id,
                    lease_seconds=settings.cds_extraction_lease_seconds,
                )
                print(f"renew_lease -> lease_expires_at={lease_expires_at}")

                packet = _build_demo_packet(
                    extraction_id=extraction.id, document_sha256_hex=document.pdf_sha256.hex()
                )
                packet_record = await cds_store.insert_packet(
                    conn,
                    settings=settings,
                    document_id=document.id,
                    extraction_id=extraction.id,
                    manifest_version=_DEMO_MANIFEST_VERSION,
                    domain_id=_DEMO_DOMAIN_ID,
                    domain_schema_hash=bytes.fromhex(_DEMO_DOMAIN_SCHEMA_HASH_HEX),
                    academic_year=_DEMO_ACADEMIC_YEAR,
                    pdf_sha256=document.pdf_sha256,
                    status="validated",
                    packet=packet,
                )
                print(
                    f"insert_packet -> domain={packet_record.domain_id} "
                    f"status={packet_record.status} (parse_packet_row round-trip passed)"
                )

                await cds_store.complete_extraction(
                    conn, extraction_id=extraction.id, status="succeeded"
                )
                print("complete_extraction -> succeeded")

                await cds_store.activate_packet(
                    conn,
                    document_id=document.id,
                    extraction_id=extraction.id,
                    domain_id=_DEMO_DOMAIN_ID,
                )
                print("activate_packet -> ok")

                await cds_store.promote_candidate_document(
                    conn, school_year_id=slot.id, document_id=document.id
                )
                print("promote_candidate_document -> ok")

                mid_counts = await _row_counts(conn)
                print(f"row counts mid-transaction (uncommitted): {mid_counts}")
            finally:
                await tx.rollback()
                print("transaction rolled back")

            after = await _row_counts(conn)
            print(f"row counts after rollback: {after}")
            assert after == before, "rollback left residue — row counts changed!"
            print("VERIFIED: row counts unchanged before/after")

        # Safe to exercise for real: with the rollback above, there are no
        # queued rows this run could have created, and recon-db-live.md
        # confirms the live DB currently has 0 queued/running extractions.
        # A 0-row UPDATE is a no-op regardless of whether it "commits".
        claimed = await cds_store.claim_next_extraction(
            pool, lease_seconds=settings.cds_extraction_lease_seconds
        )
        print(f"claim_next_extraction (live pool, expect no queued work): {claimed}")
    finally:
        await pool.close()


async def main() -> None:
    await verify_gemini_call()
    await verify_render_page_png()
    await verify_corrupt_text_detector()
    await verify_store_write_chain()
    print("\nAll P2 adapter verifications completed.")


if __name__ == "__main__":
    asyncio.run(main())
