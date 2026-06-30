"""Verifier fallback behavior for sparse research evidence."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.research.verify import (
    _build_evidence_text,
    _fallback_evidence_notes,
    _parse_verified_claims,
    research_verify_node,
)


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


def test_fallback_evidence_notes_do_not_treat_general_web_as_sentiment() -> None:
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
    assert claims[0].status == "unsupported"
    assert claims[0].support_markers == ["[3]"]
    assert "Single-source evidence" in (claims[0].note or "")


def test_build_evidence_text_keeps_second_school_sources_beyond_first_twenty() -> None:
    web_evidence = [
        {
            "marker": f"[{index}]",
            "title": "MIT admissions source",
            "snippet": "MIT admissions-only source",
            "citation": {"source": "edu"},
        }
        for index in range(1, 76)
    ]
    web_evidence.append(
        {
            "marker": "[76]",
            "title": "Stanford financial aid",
            "snippet": "Stanford financial aid source",
            "citation": {"source": "edu"},
        }
    )

    evidence_text = _build_evidence_text(
        [],
        web_evidence,
        max_claims=10,
        schools=["Massachusetts Institute of Technology", "Stanford University"],
    )

    assert "Stanford financial aid source" in evidence_text


def test_parse_verified_claims_rejects_empty_or_unknown_markers() -> None:
    claims = _parse_verified_claims(
        """
        [
          {
            "claim": "MIT requires test scores.",
            "status": "verified",
            "support_markers": ["[1]"],
            "note": null
          },
          {
            "claim": "Stanford has a policy with no citation.",
            "status": "verified",
            "support_markers": [],
            "note": null
          },
          {
            "claim": "Unknown marker should not pass.",
            "status": "verified",
            "support_markers": ["[99]"],
            "note": null
          }
        ]
        """,
        max_claims=10,
        allowed_markers={"[1]", "[2]"},
    )

    assert len(claims) == 1
    assert claims[0].claim == "MIT requires test scores."
    assert claims[0].support_markers == ["[1]"]


@pytest.mark.asyncio
async def test_verify_timeout_is_recorded_and_step_is_not_green() -> None:
    events: list[dict[str, Any]] = []
    settings = SimpleNamespace(
        deep_research_max_verified_claims=4,
        deep_research_max_wall_clock_s=100,
        deep_research_soft_timeout_s=75,
        effective_model_research_verifier="google_genai:gemini-2.5-flash",
    )

    class FakeAgent:
        def __init__(self, *_args: object, **_kwargs: object) -> None:
            pass

        def run(self, _prompt: str) -> object:
            return object()

    state = {
        "research": {
            "plan": {
                "user_text": "Does MIT require tests?",
                "schools": ["Massachusetts Institute of Technology"],
            },
            "caps": {},
            "emissions": [],
            "db_evidence": [],
            "web_evidence": [
                {
                    "marker": "[1]",
                    "title": "Tests & scores | MIT Admissions",
                    "snippet": "MIT requires the SAT or ACT.",
                    "citation": {"source": "edu", "tier": "official"},
                }
            ],
        }
    }

    with (
        patch("app.research.verify.get_settings", return_value=settings),
        patch("app.research.verify.get_stream_writer", return_value=events.append),
        patch("app.research.verify.build_research_model", return_value=object()),
        patch("app.research.verify.Agent", FakeAgent),
        patch("app.research.verify.asyncio.wait_for", new_callable=AsyncMock) as wait_for,
    ):
        wait_for.side_effect = TimeoutError

        result = await research_verify_node(state, SimpleNamespace())

    research = result["research"]
    assert research["caps"]["verification_unavailable"] == "timeout"
    assert research["verification"][0]["status"] == "unsupported"
    assert events[-1]["data"]["status"] == "error"
