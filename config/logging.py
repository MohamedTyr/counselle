"""Structured logging setup: structlog with JSON output, ISO timestamps, trace ids.

Logs go to STDERR: the counselle-db MCP server speaks JSON-RPC over stdout, so
anything printed there corrupts the protocol channel.
"""

import logging
import sys

import structlog

_configured = False


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
    _configured = True


def bind_trace_id(trace_id: str) -> None:
    """Bind a trace id into the logging context for all subsequent log calls."""
    structlog.contextvars.bind_contextvars(trace_id=trace_id)
