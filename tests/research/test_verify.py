"""Verifier fallback behavior for sparse research evidence."""

from __future__ import annotations

from app.research.verify import _build_evidence_text, _fallback_evidence_notes


def test_fallback_evidence_notes_keep_single_source_claims_limited() -> None:
    claims = _fallback_evidence_notes(
        db_evidence=[],
        web_evidence=[
            {
                "marker": "[1]",
                "title": "MIT Admissions",
                "snippet": "MIT requires all applicants to submit current application materials.",
                "citation": {"source": "edu"},
            }
        ],
        max_claims=4,
    )

    assert len(claims) == 1
    assert claims[0].status == "unsupported"
    assert claims[0].support_markers == ["[1]"]
    assert "Single-source evidence" in (claims[0].note or "")


def test_fallback_evidence_notes_never_promote_reddit_to_fact() -> None:
    claims = _fallback_evidence_notes(
        db_evidence=[],
        web_evidence=[
            {
                "marker": "[2]",
                "title": "Reddit thread",
                "snippet": "Students describe the workload as intense.",
                "citation": {"source": "reddit"},
            }
        ],
        max_claims=4,
    )

    assert len(claims) == 1
    assert claims[0].status == "sentiment_only"
    assert claims[0].support_markers == ["[2]"]


def test_fallback_evidence_notes_keep_general_community_sources_sentiment_only() -> None:
    claims = _fallback_evidence_notes(
        db_evidence=[],
        web_evidence=[
            {
                "marker": "[3]",
                "title": "Community answer",
                "snippet": "A poster claims a 1550 SAT is competitive.",
                "citation": {"source": "web", "tier": "community"},
            }
        ],
        max_claims=4,
    )

    assert len(claims) == 1
    assert claims[0].status == "sentiment_only"
    assert claims[0].support_markers == ["[3]"]
    assert "not policy or numbers" in (claims[0].note or "")


def test_build_evidence_text_keeps_second_school_sources_beyond_first_twenty() -> None:
    web_evidence = [
        {
            "marker": f"[{index}]",
            "title": "MIT source",
            "snippet": "MIT-only source",
            "citation": {"source": "edu"},
        }
        for index in range(1, 26)
    ]
    web_evidence.append(
        {
            "marker": "[26]",
            "title": "Stanford financial aid",
            "snippet": "Stanford financial aid source",
            "citation": {"source": "edu"},
        }
    )

    evidence_text = _build_evidence_text([], web_evidence, max_claims=10)

    assert "Stanford financial aid source" in evidence_text
