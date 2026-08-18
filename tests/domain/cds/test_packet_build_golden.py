"""The P1 second hard gate: rebuild a live packet from its own stored
``provider_contract`` + metrics through ``packet_build.build_packet`` and
assert byte-equality against the stored packet.

This proves the new builder reproduces the shipped v8 contract exactly, using
a real packet from the live database rather than a hand-built fixture. Picks
a fully-verified packet (no invalid/conflict/not_extracted metrics) so every
metric can be reconstructed as a claim without guessing at lost information
(an ``invalid`` metric's original bad value isn't retained in the stored
packet — only its diagnostic code — so it can't be losslessly replayed; the
non-golden unit tests in ``test_packet_build.py`` cover that path directly).

Read-only: connects with ``counselle_ro`` (the same role the agent's read path
uses), never writes anything.
"""

from __future__ import annotations

import json
from typing import Any

import asyncpg
import pytest

from config.settings import get_settings
from domain.cds.claims import Finding
from domain.cds.packet_build import build_packet

pytestmark = pytest.mark.live_db

_GOLDEN_QUERY = """
    SELECT * FROM cds_library.active_cds_domain_packets
    WHERE accepted_packet_status = 'validated'
      AND (packet->'counts'->>'invalid')::int = 0
      AND (packet->'counts'->>'conflict')::int = 0
      AND (packet->'counts'->>'not_extracted')::int = 0
    ORDER BY document_id, domain_id
    LIMIT 1
"""
_MANIFEST_QUERY = """
    SELECT content, domain_hashes FROM cds_library.cds_manifest_snapshots WHERE version = $1
"""


def _as_dict(value: Any) -> dict[str, Any]:
    return json.loads(value) if isinstance(value, str) else dict(value)


async def _fetch_golden_packet() -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    connection = await asyncpg.connect(get_settings().db_ro_dsn)
    try:
        packet_row = await connection.fetchrow(_GOLDEN_QUERY)
        if packet_row is None:
            pytest.skip("no fully-verified live packet available for the golden test")
        manifest_row = await connection.fetchrow(_MANIFEST_QUERY, packet_row["manifest_version"])
        assert manifest_row is not None, "packet references a manifest version with no snapshot"
        content = _as_dict(manifest_row["content"])
        domain_hashes = _as_dict(manifest_row["domain_hashes"])
        return dict(packet_row), content, domain_hashes
    finally:
        await connection.close()


def _findings_from_verified_metrics(metrics: dict[str, Any]) -> list[Finding]:
    findings: list[Finding] = []
    for ref, metric in metrics.items():
        if metric["extraction_status"] != "verified":
            continue
        evidence = metric["evidence"]
        findings.append(Finding(
            metric_id=ref,
            availability_status=metric["availability_status"],
            value=metric["value"],
            raw_value=metric["raw_value"],
            page_number=evidence["page_number"],
            section=evidence.get("section"),
            row_label=evidence.get("row_label"),
            column_label=evidence.get("column_label"),
            excerpt=evidence["excerpt"],
        ))
    return findings


async def test_rebuild_a_live_packet_byte_identical_from_its_own_contract() -> None:
    row, manifest_content, domain_hashes = await _fetch_golden_packet()
    packet = _as_dict(row["packet"])
    findings = _findings_from_verified_metrics(packet["metrics"])
    assert findings, "golden packet must have at least one verified metric"

    rebuilt = build_packet(
        manifest_content=manifest_content,
        domain_hashes=domain_hashes,
        domain_id=packet["domain_id"],
        findings=findings,
        provider_contract=packet["provider_contract"],
        document_page_count=max(finding.page_number for finding in findings),
        document_sha256=bytes(row["pdf_sha256"]),
        academic_year=packet["academic_year"],
        extraction_id=packet["extraction_id"],
        manifest_version=packet["manifest_version"],
        model_id=packet["model_id"],
        extractor_version=packet["extractor_version"],
    )

    def canonical(value: dict[str, Any]) -> str:
        return json.dumps(value, sort_keys=True, separators=(",", ":"))

    assert canonical(rebuilt) == canonical(packet)
