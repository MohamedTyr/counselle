"""Structured logging setup: structlog with JSON output, ISO timestamps, trace ids.

Logs go to STDERR: the counselle-db MCP server speaks JSON-RPC over stdout, so
anything printed there corrupts the protocol channel.
"""

import logging
import sys
from copy import copy
from urllib.parse import unquote_plus

import structlog

_configured = False
_SENSITIVE_QUERY_KEYS = frozenset(
    {
        "token",
        "code",
        "state",
        "access_token",
        "refresh_token",
        "id_token",
        "client_secret",
        "code_verifier",
        "password",
        "error_description",
    }
)


def _redact_auth_query(target: str) -> str:
    path, separator, query = target.partition("?")
    if not separator:
        return target
    parts = []
    for part in query.split("&"):
        key, equals, _value = part.partition("=")
        if equals and unquote_plus(key).casefold() in _SENSITIVE_QUERY_KEYS:
            parts.append(f"{key}=[REDACTED]")
        else:
            parts.append(part)
    return f"{path}?{'&'.join(parts)}"


class _AuthQueryFilter(logging.Filter):
    """Redact native Uvicorn access-log URLs, including same-origin SPA routes.

    Uvicorn supplies (client, method, target, HTTP version, status) as log args.
    Return a new record (Python 3.12+) so the request and original record stay
    unchanged; access logging still keeps the method, path, status, and ordinary
    query values useful for diagnosing requests.
    """

    def filter(self, record: logging.LogRecord) -> bool | logging.LogRecord:
        args = record.args
        if not isinstance(args, tuple) or len(args) != 5 or not isinstance(args[2], str):
            return True
        target = _redact_auth_query(args[2])
        if target == args[2]:
            return True
        safe_record = copy(record)
        safe_record.args = (*args[:2], target, *args[3:])
        return safe_record


def _protect_access_logs() -> None:
    access_logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(item, _AuthQueryFilter) for item in access_logger.filters):
        access_logger.addFilter(_AuthQueryFilter())


def setup_logging(level: str, *, force: bool = False) -> None:
    """Configure structlog: JSON renderer, ISO timestamps, contextvar merging.

    Idempotent: repeat calls are no-ops unless ``force=True`` (tests use force,
    which also disables logger caching so reconfiguration takes effect).
    """
    global _configured
    if _configured and not force:
        return
    level_number = logging.getLevelNamesMapping().get(level.upper())
    if level_number is None:
        raise ValueError(f"Unknown log level: {level!r}")
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level_number),
        logger_factory=structlog.PrintLoggerFactory(sys.stderr),
        cache_logger_on_first_use=not force,
    )
    _protect_access_logs()
    _configured = True


def bind_trace_id(trace_id: str) -> None:
    """Bind a trace id into the logging context for all subsequent log calls."""
    structlog.contextvars.bind_contextvars(trace_id=trace_id)
