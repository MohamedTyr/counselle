"""Verifier fallback behavior for sparse research evidence."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from app.research.models import VerifiedClaim
from app.research.verify import (
    _balanced_evidence_items,
    _build_evidence_text,
    _fallback_evidence_notes,
    _parse_verified_claims,
    _VerifierChunkResult,
    research_verify_node,
)


def test_balanced_evidence_keeps_distinct_db_facts_sharing_one_marker() -> None:
    """Live regression: 100 Scorecard field values shared one DB marker.

    ``_best_items_by_marker`` used to keep exactly one item per marker, so a
    single school's Scorecard citation (one marker, dozens of fields) silently
    collapsed to one surviving fact — acceptance rate and SAT scores never
    reached the verifier even though they were correctly retrieved.
    """
    db_evidence = [
        {
            "marker": "[1]",
            "source": "scorecard",
            "tier": "official",
            "field_key": "admissions.acceptance_rate",
            "display": "4.6%",
            "topic": "admissions",
            "school": "mit",
        },
        {
            "marker": "[1]",
            "source": "scorecard",
            "tier": "official",
            "field_key": "admissions.sat_average",
            "display": "1,560",
            "topic": "testing",
            "school": "mit",
        },
        {
            "marker": "[1]",
            "source": "scorecard",
            "tier": "official",
            "field_key": "cost.median_earnings_4yr",
            "display": "$161,961",
            "topic": "general",
            "school": "mit",
        },
    ]

    items = _balanced_evidence_items(db_evidence, limit=10)

    field_keys = {item["field_key"] for item in items}
    assert field_keys == {
        "admissions.acceptance_rate",
        "admissions.sat_average",
        "cost.median_earnings_4yr",
    }


def test_fallback_evidence_notes_mark_official_single_source_as_verified() -> None:
    """Per the verification policy, a single DB/official citation is sufficient —

    it does not need a second corroborating source to be "verified".
    """
    claims = _fallback_evidence_notes(
        db_evidence=[],
        web_evidence=[
            {
                "marker": "[1]",
                "title": "MIT Admissions",
                "snippet": "MIT requires all applicants to submit current application materials.",
                "citation": {"source": "edu", "tier": "official"},
            }
        ],
        max_claims=4,
    )

    assert len(claims) == 1
    assert claims[0].status == "verified"
    assert claims[0].support_markers == ["[1]"]
    assert "official" in (claims[0].note or "").lower()


def test_fallback_evidence_notes_keep_single_source_claims_limited() -> None:
    claims = _fallback_evidence_notes(
        db_evidence=[],
        web_evidence=[
            {
                "marker": "[1]",
                "title": "Community answer",
                "snippet": "A poster claims a 1550 SAT is competitive.",
                "citation": {"source": "web", "tier": "community"},
            }
        ],
        max_claims=4,
    )

    assert len(claims) == 1
    assert claims[0].status == "unsupported"
    assert claims[0].support_markers == ["[1]"]
    assert "Single-source" in (claims[0].note or "")


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


def test_fallback_evidence_notes_read_normalized_source_fields() -> None:
    claims = _fallback_evidence_notes(
        db_evidence=[],
        web_evidence=[
            {
                "marker": "[2]",
                "source": "reddit",
                "tier": "community",
                "title": "Reddit thread",
                "snippet": "Students describe the workload as intense.",
                "vintage": "Retrieved Jun 30, 2026 (Reddit community)",
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
    assert "Single-source" in (claims[0].note or "")


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
    # Fallback still honors tier: this evidence is official, so it degrades to
    # "verified" rather than punishing DB/official facts for an LLM outage.
    assert research["verification"][0]["status"] == "verified"
    assert events[-1]["data"]["status"] == "error"


@pytest.mark.asyncio
async def test_verify_parallel_chunks_preserve_success_when_one_times_out() -> None:
    events: list[dict[str, Any]] = []
    settings = SimpleNamespace(
        deep_research_max_verified_claims=2,
        deep_research_max_wall_clock_s=100,
        deep_research_soft_timeout_s=75,
        deep_research_max_parallel_tasks=2,
        effective_model_research_verifier="google_genai:gemini-2.5-flash",
    )
    state = _verify_state_with_web_markers(2)
    # Marker [2] is non-official so its fallback note stays "unsupported",
    # keeping this test's distinction between LLM-verified and fallback-noted
    # content meaningful (official-tier fallbacks now also read "verified").
    state["research"]["web_evidence"][1]["tier"] = "community"
    state["research"]["web_evidence"][1]["source"] = "web"

    async def fake_chunk(chunk: Any, **_kwargs: Any) -> _VerifierChunkResult:
        markers = {item["marker"] for item in chunk.web_evidence}
        if "[1]" in markers:
            return _VerifierChunkResult(
                [
                    VerifiedClaim(
                        claim="MIT requires tests.",
                        status="verified",
                        support_markers=["[1]"],
                    )
                ]
            )
        return _VerifierChunkResult(
            _fallback_evidence_notes([], chunk.web_evidence, chunk.max_claims),
            unavailable="timeout",
        )

    with (
        patch("app.research.verify.get_settings", return_value=settings),
        patch("app.research.verify.get_stream_writer", return_value=events.append),
        patch("app.research.verify._run_verifier_chunk", side_effect=fake_chunk),
    ):
        result = await research_verify_node(state, SimpleNamespace())

    statuses = [claim["status"] for claim in result["research"]["verification"]]
    assert "verified" in statuses
    assert "unsupported" in statuses
    assert result["research"]["caps"]["verification_unavailable"] == "partial_timeout"
    assert events[-1]["data"]["status"] == "error"


@pytest.mark.asyncio
async def test_verify_never_trusts_the_model_over_evidence_tier() -> None:
    """The verifier LLM's own judgment is never the last word on honesty.

    Even if the model ignores its prompt and (a) marks a Reddit-only claim
    "verified", or (b) marks a DB-backed claim "unsupported", the final
    persisted verification must still reflect the actual source/tier of the
    cited evidence — enforced in code, not hoped for in the prompt.
    """
    events: list[dict[str, Any]] = []
    settings = SimpleNamespace(
        deep_research_max_verified_claims=4,
        deep_research_max_wall_clock_s=100,
        deep_research_soft_timeout_s=75,
        deep_research_max_parallel_tasks=1,
        effective_model_research_verifier="google_genai:gemini-2.5-flash",
    )
    state = {
        "research": {
            "plan": {
                "user_text": "Compare MIT and a Reddit thread.",
                "schools": ["Massachusetts Institute of Technology"],
            },
            "caps": {},
            "emissions": [],
            "db_evidence": [
                {
                    "marker": "[1]",
                    "source": "scorecard",
                    "tier": "official",
                    "field_key": "admissions.acceptance_rate",
                    "display": "4.6%",
                }
            ],
            "web_evidence": [
                {
                    "marker": "[2]",
                    "source": "reddit",
                    "tier": "community",
                    "title": "Reddit thread",
                    "snippet": "Someone claims MIT admits 10% of CS applicants.",
                }
            ],
        }
    }

    async def fake_chunk(_chunk: Any, **_kwargs: Any) -> _VerifierChunkResult:
        return _VerifierChunkResult(
            [
                VerifiedClaim(
                    claim="MIT's acceptance rate is 4.6%.",
                    status="unsupported",  # model under-trusted DB evidence
                    support_markers=["[1]"],
                ),
                VerifiedClaim(
                    claim="MIT admits 10% of CS applicants.",
                    status="verified",  # model over-trusted a Reddit claim
                    support_markers=["[2]"],
                ),
            ]
        )

    with (
        patch("app.research.verify.get_settings", return_value=settings),
        patch("app.research.verify.get_stream_writer", return_value=events.append),
        patch("app.research.verify._run_verifier_chunk", side_effect=fake_chunk),
    ):
        result = await research_verify_node(state, SimpleNamespace())

    verification = result["research"]["verification"]
    by_marker = {tuple(c["support_markers"]): c["status"] for c in verification}
    assert by_marker[("[1]",)] == "verified"
    assert by_marker[("[2]",)] == "sentiment_only"


@pytest.mark.asyncio
async def test_verify_no_supported_claims_still_trusts_db_evidence() -> None:
    """Live regression: a real run had the verifier LLM return no parseable

    claims for every chunk (``no_supported_claims``), and the mechanical
    fallback used to mark every DB/official fact "unsupported" regardless of
    tier — MIT's Scorecard acceptance rate and SAT scores read as "unverified,
    single-source" even though they came straight from the authoritative DB.
    """
    events: list[dict[str, Any]] = []
    settings = SimpleNamespace(
        deep_research_max_verified_claims=4,
        deep_research_max_wall_clock_s=100,
        deep_research_soft_timeout_s=75,
        deep_research_max_parallel_tasks=2,
        effective_model_research_verifier="google_genai:gemini-2.5-flash",
    )
    state = {
        "research": {
            "plan": {
                "user_text": "What is MIT's acceptance rate?",
                "schools": ["Massachusetts Institute of Technology"],
            },
            "caps": {},
            "emissions": [],
            "db_evidence": [
                {
                    "marker": "[1]",
                    "source": "scorecard",
                    "tier": "official",
                    "field_key": "admissions.acceptance_rate",
                    "title": "Acceptance rate",
                    "display": "4.6%",
                }
            ],
            "web_evidence": [],
        }
    }

    async def fake_chunk(chunk: Any, **_kwargs: Any) -> _VerifierChunkResult:
        return _VerifierChunkResult(
            _fallback_evidence_notes(chunk.db_evidence, chunk.web_evidence, chunk.max_claims),
            unavailable="no_supported_claims",
        )

    with (
        patch("app.research.verify.get_settings", return_value=settings),
        patch("app.research.verify.get_stream_writer", return_value=events.append),
        patch("app.research.verify._run_verifier_chunk", side_effect=fake_chunk),
    ):
        result = await research_verify_node(state, SimpleNamespace())

    verification = result["research"]["verification"]
    assert len(verification) == 1
    assert verification[0]["status"] == "verified"


@pytest.mark.asyncio
async def test_verify_parallel_chunks_all_success_is_complete() -> None:
    events: list[dict[str, Any]] = []
    settings = SimpleNamespace(
        deep_research_max_verified_claims=2,
        deep_research_max_wall_clock_s=100,
        deep_research_soft_timeout_s=75,
        deep_research_max_parallel_tasks=2,
        effective_model_research_verifier="google_genai:gemini-2.5-flash",
    )
    state = _verify_state_with_web_markers(2)

    async def fake_chunk(chunk: Any, **_kwargs: Any) -> _VerifierChunkResult:
        marker = chunk.web_evidence[0]["marker"]
        return _VerifierChunkResult(
            [
                VerifiedClaim(
                    claim=f"Claim for {marker}",
                    status="verified",
                    support_markers=[marker],
                )
            ]
        )

    with (
        patch("app.research.verify.get_settings", return_value=settings),
        patch("app.research.verify.get_stream_writer", return_value=events.append),
        patch("app.research.verify._run_verifier_chunk", side_effect=fake_chunk),
    ):
        result = await research_verify_node(state, SimpleNamespace())

    assert "verification_unavailable" not in result["research"].get("caps", {})
    assert {claim["status"] for claim in result["research"]["verification"]} == {"verified"}
    assert events[-1]["data"]["status"] == "end"


def _verify_state_with_web_markers(count: int) -> dict[str, Any]:
    return {
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
                    "marker": f"[{index}]",
                    "source": "edu",
                    "tier": "official",
                    "title": f"MIT source {index}",
                    "snippet": f"MIT evidence snippet {index}.",
                    "vintage": "Retrieved Jun 30, 2026",
                }
                for index in range(1, count + 1)
            ],
        }
    }
