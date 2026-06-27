"""Unit tests for cap enforcement in the research pipeline.

Tests that soft timeout and db_unavailable flags affect the synthesize output.
No live calls — all mocked.
"""

from __future__ import annotations

from app.research.models import ResearchCaps, VerifiedClaim
from app.research.synthesize import _LIMITATION_NOTE, _aggregate_usage, _build_synthesis_prompt


def _make_caps(**kwargs: bool | int | float | str) -> ResearchCaps:
    return ResearchCaps(started_at="2026-06-27T00:00:00+00:00", **kwargs)  # type: ignore[arg-type]


class TestSoftTimeoutFlag:
    def test_limitation_note_is_non_empty(self) -> None:
        assert len(_LIMITATION_NOTE) > 0
        assert (
            "time" in _LIMITATION_NOTE.lower()
            or "incomplete" in _LIMITATION_NOTE.lower()
        )

    def test_soft_timeout_caps_field(self) -> None:
        caps = _make_caps(soft_timeout_hit=True)
        assert caps.soft_timeout_hit is True

    def test_soft_timeout_in_prompt(self) -> None:
        caps = _make_caps(soft_timeout_hit=True)
        prompt = _build_synthesis_prompt("test question", [], caps, False, False)
        lower = prompt.lower()
        assert (
            "time limit" in lower or "soft" in lower or "missing" in lower
        )


class TestDbUnavailableFlag:
    def test_db_unavailable_in_prompt(self) -> None:
        caps = _make_caps()
        prompt = _build_synthesis_prompt(
            "test question", [], caps, db_unavailable=True, external_unavailable=False
        )
        assert "database" in prompt.lower() or "unavailable" in prompt.lower()

    def test_no_flag_no_db_mention(self) -> None:
        caps = _make_caps()
        prompt = _build_synthesis_prompt("test question", [], caps, False, False)
        assert "database was unavailable" not in prompt.lower()


class TestAggregateUsage:
    def test_returns_usage_dict(self) -> None:
        research: dict[str, object] = {"caps": {"est_cost_usd": 0.05}}
        result = _aggregate_usage(research, None)
        assert "input_tokens" in result
        assert "output_tokens" in result
        assert "tool_calls" in result
        assert result["est_cost_usd"] == 0.05

    def test_zero_cost_when_no_caps(self) -> None:
        result = _aggregate_usage({}, None)
        assert result["est_cost_usd"] == 0.0


class TestVerifiedClaim:
    def test_verified_claim_model(self) -> None:
        claim = VerifiedClaim(
            claim="MIT acceptance rate is 4%",
            status="verified",
            support_markers=["[1]", "[2]"],
        )
        assert claim.status == "verified"
        assert len(claim.support_markers) == 2
        assert claim.note is None

    def test_sentiment_only_claim(self) -> None:
        claim = VerifiedClaim(
            claim="Students love the campus vibe",
            status="sentiment_only",
            support_markers=["[3]"],
            note="Reddit only",
        )
        assert claim.status == "sentiment_only"
