"""Read-only school reference catalog assembly for one application cycle."""

from __future__ import annotations

import re

from app.caveats import render_caveat
from app.workspace.models import SchoolReference
from counselle_db.catalog import Catalog
from counselle_db.service import get_domain
from domain.envelope import Citation, CitationEnvelope, EvidenceItem


async def get_school_reference(
    catalog: Catalog,
    *,
    unitid: int,
    cycle_year: int | None,
) -> SchoolReference:
    """Load the compatible pipeline test policy for one application cycle.

    Query failures intentionally propagate. A database failure must never be
    represented as an honestly loaded, empty catalog.
    """
    if cycle_year is None:
        return SchoolReference(status="cycle_required", cycle_year=None)

    test_policy = await _compatible_test_policy(catalog, unitid, cycle_year)
    return SchoolReference(
        status="loaded",
        cycle_year=cycle_year,
        populated=bool(test_policy and test_policy.available),
        test_policy=test_policy,
    )


async def _compatible_test_policy(
    catalog: Catalog, unitid: int, cycle_year: int
) -> CitationEnvelope | None:
    domain = await get_domain(catalog, unitid, "admissions")
    available = [
        row
        for row in domain.rows
        if row.available and row.ref == "admissions.test_policy_clarification"
    ]
    if not available:
        return None
    row = available[0]
    citation = Citation(
        source="cds",
        tier="official",
        vintage=row.vintage,
        document_sha256=domain.document_sha256,
        source_kind=domain.source_kind,
        retrieved_at=domain.retrieved_at,
        academic_year=domain.academic_year,
        manifest_version=domain.manifest_version,
        school_unitid=unitid,
    )
    envelope = CitationEnvelope(
        field=row.ref,
        label=row.label,
        display=row.display or "",
        unit=row.unit,
        raw=row.value,
        available=True,
        citation=citation,
        evidence=EvidenceItem.model_validate(row.evidence),
    )
    if _vintage_matches_cycle(citation.vintage, cycle_year):
        return envelope
    return CitationEnvelope(
        field=row.ref,
        label=row.label,
        display="not available",
        available=False,
        caveats=(render_caveat("stale_edition", edition=row.vintage),),
    )


def _vintage_matches_cycle(vintage: str, cycle_year: int) -> bool:
    normalized = vintage.replace("–", "-").replace("—", "-")
    prior = cycle_year - 1
    return bool(
        re.search(
            rf"\b{prior}\s*[-/]\s*(?:{cycle_year}|{str(cycle_year)[-2:]})\b",
            normalized,
        )
    )
