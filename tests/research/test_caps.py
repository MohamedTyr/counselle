"""Unit tests for cap enforcement in the research pipeline.

Tests that soft timeout and db_unavailable flags affect the synthesize output.
No live calls — all mocked.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

from app.research.caps import elapsed_seconds, remaining_time_seconds, soft_timeout_hit
from app.research.models import ResearchCaps, VerifiedClaim
from app.research.synthesize import (
    _LIMITATION_NOTE,
    _aggregate_usage,
    _build_partial_report,
    _build_synthesis_prompt,
)
from app.research.usage import record_model_usage


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

    def test_verification_unavailable_in_prompt(self) -> None:
        caps = _make_caps(verification_unavailable="timeout")
        prompt = _build_synthesis_prompt("test question", [], caps, False, False)
        lower = prompt.lower()
        assert "cross-checking did not complete" in lower
        assert "not fully verified claims" in lower

    def test_today_is_available_to_synthesizer(self) -> None:
        caps = _make_caps()
        prompt = _build_synthesis_prompt(
            "test question",
            [],
            caps,
            False,
            False,
            today="2026-06-27",
        )
        assert "**Today:** 2026-06-27" in prompt

    def test_soft_timeout_helper_marks_elapsed_runs(self) -> None:
        started = datetime(2026, 6, 27, tzinfo=UTC)
        research: dict[str, Any] = {"caps": {"started_at": started.isoformat()}}
        settings = SimpleNamespace(deep_research_soft_timeout_s=75)

        hit = soft_timeout_hit(
            research,
            settings,
            now=started + timedelta(seconds=76),
        )

        assert hit is True
        assert research["caps"]["soft_timeout_hit"] is True

    def test_soft_timeout_helper_leaves_fresh_runs_open(self) -> None:
        started = datetime(2026, 6, 27, tzinfo=UTC)
        research: dict[str, Any] = {"caps": {"started_at": started.isoformat()}}
        settings = SimpleNamespace(deep_research_soft_timeout_s=75)

        hit = soft_timeout_hit(
            research,
            settings,
            now=started + timedelta(seconds=10),
        )

        assert hit is False
        assert "soft_timeout_hit" not in research["caps"]

    def test_elapsed_and_remaining_time_helpers(self) -> None:
        started = datetime(2026, 6, 27, tzinfo=UTC)
        research: dict[str, Any] = {"caps": {"started_at": started.isoformat()}}

        assert elapsed_seconds(research, now=started + timedelta(seconds=12)) == 12
        assert (
            remaining_time_seconds(
                research,
                100,
                reserve_s=10,
                cap_s=30,
                now=started + timedelta(seconds=50),
            )
            == 30
        )
        assert (
            remaining_time_seconds(
                research,
                100,
                reserve_s=10,
                cap_s=30,
                now=started + timedelta(seconds=95),
            )
            == 0
        )

    def test_partial_report_is_clean_and_cited(self) -> None:
        report = _build_partial_report(
            "Compare MIT and Stanford.",
            [
                VerifiedClaim(
                    claim="MIT requires SAT or ACT scores.",
                    status="unsupported",
                    support_markers=["[1]"],
                    note="Official source.",
                )
            ],
            db_unavailable=False,
            external_unavailable=False,
            reason="The research run used its time budget.",
        )

        assert report.startswith("## Partial report")
        assert "Limited evidence: MIT requires SAT or ACT scores. [1]" in report
        assert "This took too long" not in report
        assert "| Feature" not in report

    def test_partial_report_distinguishes_model_failure_from_timeout(self) -> None:
        report = _build_partial_report(
            "Compare MIT and Stanford.",
            [],
            db_unavailable=False,
            external_unavailable=False,
            reason="The final write-up stopped before completion (ModelHTTPError).",
        )

        assert "before the time limit" not in report
        assert "model provider quota or availability issue" in report


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
        research: dict[str, object] = {
            "usage": {
                "input_tokens": 120,
                "output_tokens": 30,
                "tool_calls": 1,
                "est_cost_usd": 0.05,
            }
        }
        result = _aggregate_usage(research, None)
        assert result["input_tokens"] == 120
        assert result["output_tokens"] == 30
        assert result["tool_calls"] == 1
        assert result["est_cost_usd"] == 0.05

    def test_unknown_cost_when_no_usage(self) -> None:
        result = _aggregate_usage({}, None)
        assert result["input_tokens"] == 0
        assert result["output_tokens"] == 0
        assert result["tool_calls"] == 0
        assert result["est_cost_usd"] is None

    def test_record_model_usage_accumulates_tokens_and_known_cost(self) -> None:
        research: dict[str, object] = {}
        settings = SimpleNamespace(
            model_prices={"gemini-2.5-flash": (0.30, 2.50)},
        )

        record_model_usage(
            research,
            SimpleNamespace(input_tokens=1000, output_tokens=100, tool_calls=0),
            model_name="google-vertex:gemini-2.5-flash",
            settings=settings,
        )
        record_model_usage(
            research,
            SimpleNamespace(input_tokens=500, output_tokens=50, tool_calls=1),
            model_name="google-vertex:gemini-2.5-flash",
            settings=settings,
        )

        result = _aggregate_usage(research, None)
        assert result["input_tokens"] == 1500
        assert result["output_tokens"] == 150
        assert result["tool_calls"] == 1
        assert result["est_cost_usd"] == 0.000825


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
