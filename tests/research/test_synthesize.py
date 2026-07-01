"""Synthesis contract regressions for deep research."""

from __future__ import annotations

from app.research.models import VerifiedClaim
from app.research.synthesize import _ensure_required_sections


def test_ensure_required_sections_appends_empty_evidence_notes() -> None:
    report = _ensure_required_sections(
        "## Bottom line\n\nMIT has limited evidence in this run.",
        db_evidence=[],
        web_evidence=[],
        verification=[],
    )

    assert "## DB-backed facts" in report
    assert "No Counselle database evidence was available" in report
    assert "## Student sentiment" in report
    assert "No Reddit or student-sentiment evidence was found" in report


def test_ensure_required_sections_detects_h3_headers() -> None:
    """Live regression: Gemini wrote '### DB-backed facts', not '##'.

    The old regex only matched exactly two hashes, so it never saw the
    model's own DB-backed facts section and appended a duplicate generic one
    right after it in the rendered report.
    """
    report = _ensure_required_sections(
        "### Bottom line\n\nAnswer.\n\n"
        "### DB-backed facts\n\n"
        "*   **Stanford:** has need-based aid [18, 21].\n\n"
        "### Next checks\n\nDo X.",
        db_evidence=[{"marker": "[18]", "source": "cds"}],
        web_evidence=[],
        verification=[],
    )

    assert report.count("DB-backed facts") == 1
    assert "No Counselle database evidence" not in report
    assert "### Student sentiment" not in report
    assert "## Student sentiment" in report


def test_ensure_required_sections_preserves_existing_headers_and_notes_evidence() -> None:
    report = _ensure_required_sections(
        "## DB-backed facts\n\nExisting DB section.\n\n## Bottom line\n\nAnswer.",
        db_evidence=[{"marker": "[1]", "source": "cds"}],
        web_evidence=[{"marker": "[2]", "source": "reddit"}],
        verification=[
            VerifiedClaim(
                claim="Students describe the workload as intense.",
                status="sentiment_only",
                support_markers=["[2]"],
            )
        ],
    )

    assert report.count("## DB-backed facts") == 1
    assert "## Student sentiment" in report
    assert "Student-sentiment evidence was retrieved" in report
