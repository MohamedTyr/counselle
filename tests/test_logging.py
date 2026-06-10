"""Tests for structured logging setup (config/logging.py)."""

import json
from collections.abc import Iterator
from datetime import datetime

import pytest
import structlog

from config.logging import bind_trace_id, setup_logging


@pytest.fixture(autouse=True)
def _reset_structlog() -> Iterator[None]:
    """Keep structlog config and bound contextvars from leaking between tests."""
    structlog.contextvars.clear_contextvars()
    yield
    structlog.contextvars.clear_contextvars()
    structlog.reset_defaults()


def test_log_call_emits_json_with_trace_id_timestamp_and_level(
    capsys: pytest.CaptureFixture[str],
) -> None:
    setup_logging("INFO", force=True)
    bind_trace_id("abc123")

    structlog.get_logger().info("hello", school="MIT")

    output = capsys.readouterr().err.strip()
    payload = json.loads(output)  # valid JSON, single line
    assert payload["trace_id"] == "abc123"
    assert payload["level"] == "info"
    assert payload["event"] == "hello"
    assert payload["school"] == "MIT"
    # ISO timestamp — fromisoformat raises if it is anything else.
    datetime.fromisoformat(payload["timestamp"])


def test_level_filtering_suppresses_below_threshold(
    capsys: pytest.CaptureFixture[str],
) -> None:
    setup_logging("WARNING", force=True)

    structlog.get_logger().info("too quiet")

    assert capsys.readouterr().err == ""


def test_unknown_level_raises_value_error() -> None:
    with pytest.raises(ValueError, match="Unknown log level"):
        setup_logging("LOUD", force=True)


def test_setup_logging_is_idempotent_without_force(
    capsys: pytest.CaptureFixture[str],
) -> None:
    setup_logging("WARNING", force=True)
    setup_logging("INFO")  # no-op: already configured

    structlog.get_logger().info("still filtered")

    assert capsys.readouterr().err == ""
