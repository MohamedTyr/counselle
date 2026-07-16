from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from domain.envelope import Caveat, Citation, CitationEnvelope, EvidenceItem

SHA = "a" * 64


def test_source_conditional_citation_identities() -> None:
    profile = Citation(
        source="profile", tier="official", vintage="Profile 2024",
        school_unitid=1, profile_sha256=SHA,
    )
    assert profile.model_dump(mode="json")["v"] == 2
    with pytest.raises(ValidationError):
        Citation(source="reddit", tier="official", vintage="now", url="https://reddit.com/x")
    with pytest.raises(ValidationError):
        Citation(source="web", tier="community", vintage="now", url="https://example.com")


def test_web_currentness_requires_page_or_metadata_period_evidence() -> None:
    current = Citation(
        source="edu",
        tier="official",
        vintage="Retrieved Jun 10, 2026 (school's official site)",
        url="https://registrar.mit.edu/stats-reports/enrollment-statistics-year/all",
        source_period="2025-2026",
        source_period_basis="page_content",
        source_period_evidence="2025-2026 | Undergraduate 4,561",
        source_currentness="current",
    )
    assert current.source_period == "2025-2026"
    with pytest.raises(ValidationError, match="requires source-period evidence"):
        Citation(
            source="edu",
            tier="official",
            vintage="Retrieved Jun 10, 2026 (school's official site)",
            url="https://mit.edu/facts",
            source_currentness="current",
        )


def test_cds_envelope_requires_matching_exact_evidence() -> None:
    citation = Citation(
        source="cds", tier="official", vintage="CDS 2024-25", document_sha256=SHA,
        source_kind="upload", retrieved_at=datetime(2026, 1, 1, tzinfo=UTC),
        academic_year=2024, manifest_version="5.0.1", school_unitid=1,
    )
    evidence = EvidenceItem(
        eid="admissions.applicants", value_display="10", label="Applicants", page=1,
        excerpt="Applicants 10",
    )
    envelope = CitationEnvelope(
        field="admissions.applicants", label="Applicants", display="10", raw=10,
        available=True, citation=citation, evidence=evidence,
        caveats=(Caveat(kind="partial_packet", text="Partial."),),
    )
    assert envelope.evidence == evidence
    with pytest.raises(ValidationError):
        envelope.model_copy(update={"display": "11"}).__class__.model_validate(
            {**envelope.model_dump(), "display": "11"}
        )


def test_unavailable_shape_is_exact_and_uncited() -> None:
    envelope = CitationEnvelope(
        field="admissions.unknown", label="Unknown", display="not available",
        available=False,
    )
    assert envelope.citation is None
    with pytest.raises(ValidationError):
        CitationEnvelope(
            field="admissions.unknown", label="Unknown", display="N/A", available=False,
        )


def test_non_finite_nested_raw_is_rejected_by_json_schema() -> None:
    citation = Citation(
        source="web", tier="official", vintage="now", url="https://example.edu"
    )
    with pytest.raises(ValidationError):
        CitationEnvelope(
            field="x", label="x", display="x", raw={"bad": float("inf")},
            available=True, citation=citation,
        )
