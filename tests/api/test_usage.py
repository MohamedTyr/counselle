"""Tests for app/usage.py — cost estimation, event enrichment, turn_complete log."""

from __future__ import annotations

import logging
from dataclasses import dataclass

import pytest

from app.usage import enrich_usage_event, estimate_cost, log_turn_complete
from domain.events import Event, UsageData, ev_usage

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

PRICES: dict[str, tuple[float, float]] = {
    "gemini-2.5-pro": (1.25, 10.0),
    "gemini-2.5-flash": (0.30, 2.50),
}


@dataclass
class FakeSettings:
    """Minimal settings stub for enrich_usage_event."""

    usage_accounting: bool = True
    model_prices: dict[str, tuple[float, float]] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.model_prices is None:
            self.model_prices = dict(PRICES)


def _usage_event(
    input_tokens: int = 100,
    output_tokens: int = 50,
    tool_calls: int = 2,
) -> Event:
    return ev_usage(
        UsageData(input_tokens=input_tokens, output_tokens=output_tokens, tool_calls=tool_calls)
    )


# ---------------------------------------------------------------------------
# estimate_cost
# ---------------------------------------------------------------------------


class TestEstimateCost:
    def test_known_model_exact_arithmetic_pro(self) -> None:
        # 1000 input @ $1.25/1M + 500 output @ $10.00/1M
        # = 0.00125 + 0.005 = 0.00625
        cost = estimate_cost("gemini-2.5-pro", 1000, 500, PRICES)
        assert cost == pytest.approx(0.00625)

    def test_known_model_exact_arithmetic_flash(self) -> None:
        # 2000 input @ $0.30/1M + 1000 output @ $2.50/1M
        # = 0.0006 + 0.0025 = 0.0031
        cost = estimate_cost("gemini-2.5-flash", 2000, 1000, PRICES)
        assert cost == pytest.approx(0.0031)

    def test_zero_tokens_gives_zero_cost(self) -> None:
        cost = estimate_cost("gemini-2.5-pro", 0, 0, PRICES)
        assert cost == pytest.approx(0.0)

    def test_unknown_model_returns_none(self) -> None:
        cost = estimate_cost("gpt-4o", 1000, 500, PRICES)
        assert cost is None

    def test_suffix_match_strips_provider_prefix(self) -> None:
        # "google-vertex:gemini-2.5-pro" should match "gemini-2.5-pro"
        cost_bare = estimate_cost("gemini-2.5-pro", 1000, 500, PRICES)
        cost_qualified = estimate_cost("google-vertex:gemini-2.5-pro", 1000, 500, PRICES)
        assert cost_qualified == pytest.approx(cost_bare)

    def test_suffix_match_flash_with_prefix(self) -> None:
        cost_bare = estimate_cost("gemini-2.5-flash", 500, 200, PRICES)
        cost_qualified = estimate_cost("google-vertex:gemini-2.5-flash", 500, 200, PRICES)
        assert cost_qualified == pytest.approx(cost_bare)

    def test_unknown_provider_prefix_but_also_unknown_bare_returns_none(self) -> None:
        cost = estimate_cost("anthropic:claude-3-haiku", 1000, 500, PRICES)
        assert cost is None

    def test_exact_match_takes_priority_over_suffix(self) -> None:
        # If the full qualified name is in prices, use that entry.
        prices_with_full = dict(PRICES)
        prices_with_full["google-vertex:gemini-2.5-pro"] = (99.0, 99.0)
        cost = estimate_cost("google-vertex:gemini-2.5-pro", 1_000_000, 0, prices_with_full)
        assert cost == pytest.approx(99.0)


# ---------------------------------------------------------------------------
# enrich_usage_event
# ---------------------------------------------------------------------------


class TestEnrichUsageEvent:
    def test_fills_est_cost_usd(self) -> None:
        event = _usage_event(input_tokens=1000, output_tokens=500)
        settings = FakeSettings()
        enriched = enrich_usage_event(event, "gemini-2.5-pro", settings)

        usage = UsageData.model_validate(enriched.data)
        assert usage.est_cost_usd == pytest.approx(0.00625)

    def test_preserves_v_and_type(self) -> None:
        event = _usage_event()
        settings = FakeSettings()
        enriched = enrich_usage_event(event, "gemini-2.5-pro", settings)

        assert enriched.v == event.v
        assert enriched.type == event.type

    def test_preserves_token_counts_and_tool_calls(self) -> None:
        event = _usage_event(input_tokens=300, output_tokens=150, tool_calls=5)
        settings = FakeSettings()
        enriched = enrich_usage_event(event, "gemini-2.5-flash", settings)

        usage = UsageData.model_validate(enriched.data)
        assert usage.input_tokens == 300
        assert usage.output_tokens == 150
        assert usage.tool_calls == 5

    def test_none_for_unknown_model(self) -> None:
        event = _usage_event()
        settings = FakeSettings()
        enriched = enrich_usage_event(event, "unknown-model", settings)

        usage = UsageData.model_validate(enriched.data)
        assert usage.est_cost_usd is None

    def test_does_not_mutate_original(self) -> None:
        event = _usage_event()
        settings = FakeSettings()
        original_data = dict(event.data)
        enrich_usage_event(event, "gemini-2.5-pro", settings)
        assert event.data == original_data

    def test_usage_accounting_false_returns_event_unchanged(self) -> None:
        event = _usage_event()
        settings = FakeSettings(usage_accounting=False)
        result = enrich_usage_event(event, "gemini-2.5-pro", settings)
        assert result is event

    def test_suffix_match_works_in_enrich(self) -> None:
        event = _usage_event(input_tokens=1000, output_tokens=500)
        settings = FakeSettings()
        enriched = enrich_usage_event(event, "google-vertex:gemini-2.5-pro", settings)

        usage = UsageData.model_validate(enriched.data)
        assert usage.est_cost_usd == pytest.approx(0.00625)


# ---------------------------------------------------------------------------
# log_turn_complete
# ---------------------------------------------------------------------------


class TestLogTurnComplete:
    def test_emits_one_structured_line_with_required_fields(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger="app.usage"):
            log_turn_complete(
                logging.getLogger("app.usage"),
                session_id="sess-123",
                trace_id="trace-abc",
                usage={"input_tokens": 100, "output_tokens": 50, "tool_calls": 3},
                duration_ms=420,
                est_cost_usd=0.00625,
            )

        assert len(caplog.records) == 1
        record = caplog.records[0]
        assert record.message == "turn_complete"

    def test_none_cost_accepted(self, caplog: pytest.LogCaptureFixture) -> None:
        with caplog.at_level(logging.INFO, logger="app.usage"):
            log_turn_complete(
                logging.getLogger("app.usage"),
                session_id="sess-xyz",
                trace_id="trace-xyz",
                usage={"input_tokens": 0, "output_tokens": 0, "tool_calls": 0},
                duration_ms=100,
                est_cost_usd=None,
            )
        assert len(caplog.records) == 1

    def test_extra_fields_are_set_on_record(self, caplog: pytest.LogCaptureFixture) -> None:
        with caplog.at_level(logging.INFO, logger="app.usage"):
            log_turn_complete(
                logging.getLogger("app.usage"),
                session_id="s1",
                trace_id="t1",
                usage={"input_tokens": 200, "output_tokens": 100, "tool_calls": 1},
                duration_ms=300,
                est_cost_usd=0.001,
            )
        record = caplog.records[0]
        assert record.__dict__["session_id"] == "s1"
        assert record.__dict__["trace_id"] == "t1"
        assert record.__dict__["input_tokens"] == 200
        assert record.__dict__["output_tokens"] == 100
        assert record.__dict__["tool_calls"] == 1
        assert record.__dict__["duration_ms"] == 300
        assert record.__dict__["est_cost_usd"] == pytest.approx(0.001)
