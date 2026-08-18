#!/usr/bin/env python3
"""P4 verification script for `app/cds/{manifest,engine,jobs,detect}.py`
(plan §H row P4).

Runs, in order (real, billed Gemini calls; real writes against a school-year
slot this script creates and never against the 5 pre-existing slots):

1. An end-to-end extraction: create a fresh test school-year/document, queue
   an extraction for all 13 domains, claim + run it through `app.cds.engine`,
   and independently re-validate every stored packet through the reader's
   own `counselle_db.packets.parse_packet_row()`.
2. A real crash-recovery drill: start a real `app.cds.jobs.Poller` in a
   subprocess against a second fresh extraction, SIGKILL it once the row is
   observably `running`, then sweep stale leases (what the next boot does)
   and confirm the row lands on `failed`/`worker_lost`.
3. `app.cds.detect.detect_school_year` against all 15 corpus PDFs, scored
   against each file's own filename (school + year are encoded in every
   corpus filename), printed as a table.

Usage: ``uv run python scripts/verify_cds_engine.py``
"""

from __future__ import annotations

import asyncio
import glob
import os
import signal
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import asyncpg

from adapters import cds_store
from app.cds import detect, engine, manifest
from config.settings import get_settings
from counselle_db.db import create_pool
from counselle_db.packets import compile_manifest as reader_compile_manifest
from counselle_db.packets import parse_packet_row

_CORPUS_DIR = "artifacts/cds-corpus"
_HARVARD_PDF = os.path.join(_CORPUS_DIR, "harvard_2024-2025.pdf")
# Alabama A&M University -- same probe school recon-db-live.md and
# scripts/verify_cds_adapters.py already used for a throwaway test row. Far-
# future academic years so these never collide with real coverage or with
# each other across repeated runs of this script.
_TEST_SCHOOL_ID = 100654
_TEST_YEAR_MAIN = 2091
_TEST_YEAR_CRASH = 2092

# Filename -> (expected school substring, expected first academic year).
_CORPUS_EXPECTATIONS: dict[str, tuple[str, int]] = {
    "amherst_2024-2025_secA.pdf": ("amherst", 2024),
    # The catalog's IPEDS legal name, not the common name -- see
    # app.cds.detect's `_token_fallback_search`/`_cap_ambiguous_campus_extensions`.
    "caltech_2024-2025.pdf": ("california institute of technology", 2024),
    "cmu_2024-2025.pdf": ("carnegie mellon", 2024),
    "cornell_2022-2023.pdf": ("cornell", 2022),
    "dartmouth_2024-2025.pdf": ("dartmouth", 2024),
    "florida_2023-2024.pdf": ("florida", 2023),
    "harvard_2024-2025.pdf": ("harvard", 2024),
    "michigan_2023-2024.pdf": ("michigan", 2023),
    "michigan_2024-2025.pdf": ("michigan", 2024),
    "ohio-state_2023-2024.pdf": ("ohio state", 2023),
    "ohio-state_2024-2025.pdf": ("ohio state", 2024),
    "pennstate_2022-2023.pdf": ("pennsylvania state", 2022),
    "reed_2023-2024_secC.pdf": ("reed", 2023),
    "spelman_2023-2024.pdf": ("spelman", 2023),
    "ucf_2023-2024.pdf": ("central florida", 2023),
}


async def _fresh_test_slot(
    pool: asyncpg.Pool, *, academic_year: int, pdf_path: str
) -> tuple[int, int]:
    with open(pdf_path, "rb") as handle:
        pdf_content = handle.read()
    async with pool.acquire() as conn:
        slot = await cds_store.upsert_school_year(
            conn, school_id=_TEST_SCHOOL_ID, academic_year=academic_year
        )
        doc = await cds_store.insert_document(
            conn,
            school_year_id=slot.id,
            pdf_content=pdf_content,
            source_kind="upload",
            retrieved_at=datetime.now(UTC),
            original_filename=os.path.basename(pdf_path),
        )
        await cds_store.set_candidate_document(
            conn, school_year_id=slot.id, document_id=doc.id
        )
    return slot.id, doc.id


async def _queue_extraction(
    pool: asyncpg.Pool, *, school_year_id: int, document_id: int, domains: tuple[str, ...]
) -> str:
    compiled = manifest.load_compiled_manifest()
    async with pool.acquire() as conn:
        record = await cds_store.create_extraction(
            conn,
            school_year_id=school_year_id,
            document_id=document_id,
            manifest_version=compiled.version,
            target_kind="candidate",
            requested_domains=domains,
            extractor_version=engine.EXTRACTOR_VERSION,
            model_id=get_settings().model_cds_extract.split(":", 1)[-1],
        )
    return str(record.id)


async def run_end_to_end(pool: asyncpg.Pool, settings: Any) -> None:
    print("\n=== 1. End-to-end extraction (Harvard 2024-2025, all 13 domains) ===")
    compiled = manifest.load_compiled_manifest()
    school_year_id, document_id = await _fresh_test_slot(
        pool, academic_year=_TEST_YEAR_MAIN, pdf_path=_HARVARD_PDF
    )
    print(f"test slot: school_year_id={school_year_id} document_id={document_id}")
    await _queue_extraction(
        pool,
        school_year_id=school_year_id,
        document_id=document_id,
        domains=manifest.domain_ids(compiled),
    )
    claimed = await cds_store.claim_next_extraction(pool, lease_seconds=900)
    assert claimed is not None and claimed.document_id == document_id, (
        "expected to claim the extraction just queued -- is another worker running "
        "against this same DB?"
    )
    print(f"claimed extraction {claimed.id}, running...")
    started = time.monotonic()
    await engine.run_extraction(pool, settings, claimed)
    elapsed = time.monotonic() - started

    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT status, validation_summary FROM cds_library.cds_extractions WHERE id = $1",
            claimed.id,
        )
        packet_rows = await conn.fetch(
            "SELECT domain_id, status, packet, domain_schema_hash FROM "
            "cds_library.cds_domain_packets WHERE extraction_id = $1 ORDER BY domain_id",
            claimed.id,
        )
        manifest_row = await conn.fetchrow(
            "SELECT version, content, domain_hashes FROM cds_library.cds_manifests "
            "WHERE version = $1",
            compiled.version,
        )

    print(f"extraction status: {row['status']}  wall_clock={elapsed:.1f}s")
    summary = row["validation_summary"] or {}
    print(f"cost estimate: ${summary.get('cost_usd_estimate', 0):.4f}")
    print(f"usage_total:   {summary.get('usage_total')}")
    print("calls:")
    for call in summary.get("calls", []):
        print(f"  {call}")
    print(f"\n{len(packet_rows)} packets written for extraction {claimed.id}:")
    snapshot = reader_compile_manifest(
        manifest_row["version"], manifest_row["content"], manifest_row["domain_hashes"]
    )
    accepted = 0
    for packet_row in packet_rows:
        parsed = parse_packet_row(
            {
                "packet": packet_row["packet"],
                "pdf_sha256": (await _document_sha(pool, document_id)),
                "domain_schema_hash": packet_row["domain_schema_hash"],
                "domain_id": packet_row["domain_id"],
                "academic_year": _TEST_YEAR_MAIN,
                "extraction_id": claimed.id,
                "manifest_version": compiled.version,
                "accepted_packet_status": packet_row["status"],
                "current_definition_match": True,
                "currentness": "current",
                "document_id": document_id,
            },
            {compiled.version: snapshot},
            settings.supported_packet_extractor_versions,
        )
        accepted += 1
        print(
            f"  {packet_row['domain_id']:16s} status={packet_row['status']:10s} "
            f"counts={parsed.packet.counts.model_dump()}  parse_packet_row: ACCEPTED"
        )
    print(f"\n{accepted}/{len(packet_rows)} packets independently ACCEPTED by parse_packet_row().")
    for domain_id, outcome in summary.get("domains", {}).items():
        if outcome.get("status") is None:
            print(f"  (no packet stored for {domain_id}: {outcome.get('error')})")


async def _document_sha(pool: asyncpg.Pool, document_id: int) -> bytes:
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT pdf_sha256 FROM cds_library.cds_documents WHERE id = $1", document_id
        )
    return bytes(row["pdf_sha256"])


async def run_crash_recovery(pool: asyncpg.Pool, settings: Any) -> None:
    print("\n=== 2. Crash-recovery drill (SIGKILL mid-run, sweep on next boot) ===")
    school_year_id, document_id = await _fresh_test_slot(
        pool, academic_year=_TEST_YEAR_CRASH, pdf_path=_HARVARD_PDF
    )
    extraction_id = await _queue_extraction(
        pool, school_year_id=school_year_id, document_id=document_id, domains=("admissions",)
    )
    print(f"queued extraction {extraction_id} for the crash test")

    env = dict(os.environ)
    env["COUNSELLE_CDS_EXTRACTION_LEASE_SECONDS"] = "5"
    env["COUNSELLE_CDS_WORKER_POLL_SECONDS"] = "1"
    proc = subprocess.Popen(  # noqa: S603 -- fixed, repo-local script; not user input
        [sys.executable, "scripts/_cds_crash_test_worker.py"],
        env=env,
        cwd=str(Path(__file__).resolve().parents[1]),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        claimed_at = await _wait_for_status(pool, extraction_id, "running", timeout_seconds=20)
        print(f"worker subprocess pid={proc.pid} claimed it at {claimed_at}; sending SIGKILL now")
        proc.send_signal(signal.SIGKILL)
        proc.wait(timeout=10)
        print(f"subprocess exit code: {proc.returncode} (killed)")

        # Give the 5s test lease time to actually expire before sweeping --
        # a real boot's sweep only recovers leases that have already lapsed.
        await asyncio.sleep(6)
        swept = await cds_store.sweep_expired_leases(pool)
        print(f"sweep_expired_leases() on next boot recovered: {[str(i) for i in swept]}")

        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT status, error_code FROM cds_library.cds_extractions WHERE id = $1",
                extraction_id,
            )
        print(f"final extraction status: status={row['status']} error_code={row['error_code']}")
        assert row["status"] == "failed"
        assert row["error_code"] == "worker_lost"
        print("PASS: killed extraction recovered to failed/worker_lost on next boot's sweep.")
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=10)


async def _wait_for_status(
    pool: asyncpg.Pool, extraction_id: str, status: str, *, timeout_seconds: float
) -> datetime:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT status, started_at FROM cds_library.cds_extractions WHERE id = $1",
                extraction_id,
            )
        if row is not None and row["status"] == status:
            return row["started_at"]  # type: ignore[no-any-return]
        await asyncio.sleep(0.5)
    raise TimeoutError(f"extraction {extraction_id} never reached status={status!r}")


async def run_detection_accuracy(pool: asyncpg.Pool, settings: Any) -> None:
    print("\n=== 3. app.cds.detect.detect_school_year across the 15-file corpus ===")
    paths = sorted(glob.glob(os.path.join(_CORPUS_DIR, "*.pdf")))
    assert paths, f"no PDFs found in {_CORPUS_DIR} -- is the corpus checked out?"

    correct = 0
    rows: list[str] = []
    for path in paths:
        name = os.path.basename(path)
        expected_substring, expected_year = _CORPUS_EXPECTATIONS.get(name, ("", 0))
        with open(path, "rb") as handle:
            pdf_content = handle.read()
        result = await detect.detect_school_year(
            settings=settings, pool=pool, pdf_content=pdf_content
        )
        best = result.best_match
        name_ok = bool(
            best is not None and expected_substring and expected_substring in best.name.casefold()
        )
        year_ok = result.detected_academic_year == expected_year
        ok = name_ok and year_ok
        correct += int(ok)
        rows.append(
            f"  {'PASS' if ok else 'FAIL'}  {name:32s} "
            f"detected=({result.detected_name!r}, {result.detected_academic_year}) "
            f"best_match=({best.name if best else None!r}, score={best.score if best else 0:.2f}) "
            f"expected=({expected_substring!r}, {expected_year}) error={result.error}"
        )
    print("\n".join(rows))
    print(f"\n{correct}/{len(paths)} correct (gate: >=13/15).")
    print("Cornell and Caltech named explicitly per the verification gate:")
    for row in rows:
        if "cornell" in row.lower() or "caltech" in row.lower():
            print(f"  {row.strip()}")


async def main() -> None:
    settings = get_settings()
    if not settings.db_pipeline_dsn:
        print("COUNSELLE_DB_PIPELINE_DSN is not set -- cannot run the live P4 verification.")
        return
    pool = await create_pool(dsn=settings.db_pipeline_dsn, settings=settings)
    try:
        await run_end_to_end(pool, settings)
        await run_crash_recovery(pool, settings)
        await run_detection_accuracy(pool, settings)
    finally:
        await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
