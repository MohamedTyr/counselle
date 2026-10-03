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


@pytest.mark.parametrize(
    "path",
    [
        "/v1/auth/google/callback?code=provider-code&state=signed-state&next=%2Fapp",
        "/reset-password?token=password-reset-secret&next=%2Faccount",
        "/verify-email?token=email-verification-secret",
        "/reauthenticate?token=account-control-secret",
    ],
)
def test_native_uvicorn_access_logs_redact_auth_secrets_and_keep_request_details(path):
    import io
    import logging

    from uvicorn.logging import AccessFormatter

    setup_logging("INFO", force=True)
    output = io.StringIO()
    handler = logging.StreamHandler(output)
    handler.setFormatter(AccessFormatter('%(client_addr)s "%(request_line)s" %(status_code)s'))
    access_logger = logging.getLogger("uvicorn.access")
    previous = (access_logger.handlers, access_logger.level, access_logger.propagate)
    access_logger.handlers = [handler]
    access_logger.setLevel(logging.INFO)
    access_logger.propagate = False
    try:
        access_logger.info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:1000", "GET", path, "1.1", 302)
    finally:
        access_logger.handlers, access_logger.level, access_logger.propagate = previous
    rendered = output.getvalue()
    assert path.split("?")[0] in rendered
    assert "GET" in rendered and "302" in rendered
    assert "[REDACTED]" in rendered
    for secret in (
        "provider-code",
        "signed-state",
        "password-reset-secret",
        "email-verification-secret",
        "account-control-secret",
    ):
        assert secret not in rendered
    if "next=" in path:
        assert "next=" in rendered


def test_access_log_redaction_handles_duplicate_and_encoded_keys_without_mutating_record():
    import logging

    from config.logging import _AuthQueryFilter

    target = "/auth?%74oken=first&TOKEN=second&%73tate=third&page=2&token=&flag"
    original = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        "server",
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("client", "GET", target, "1.1", 200),
        None,
    )
    safe = _AuthQueryFilter().filter(original)
    assert isinstance(safe, logging.LogRecord)
    assert (
        safe.args[2]
        == "/auth?%74oken=[REDACTED]&TOKEN=[REDACTED]&%73tate=[REDACTED]"
        "&page=2&token=[REDACTED]&flag"
    )
    assert original.args[2] == target


def test_access_logs_without_auth_secrets_remain_unchanged_and_filter_is_installed_once():
    import logging

    from config.logging import _AuthQueryFilter

    setup_logging("INFO", force=True)
    setup_logging("INFO", force=True)
    filters = logging.getLogger("uvicorn.access").filters
    assert sum(isinstance(item, _AuthQueryFilter) for item in filters) == 1
    original = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        "server",
        1,
        '%s - "%s %s HTTP/%s" %d',
        ("client", "GET", "/v1/schools?page=2", "1.1", 200),
        None,
    )
    assert _AuthQueryFilter().filter(original) is True
    assert original.args[2] == "/v1/schools?page=2"
