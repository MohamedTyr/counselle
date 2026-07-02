"""Runtime cap helpers for deep research."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


def soft_timeout_hit(
    research: dict[str, Any],
    settings: Any,
    *,
    now: datetime | None = None,
) -> bool:
    """Mark and return whether the research run has passed its soft timeout."""
    caps = dict(research.get("caps") or {})
    if caps.get("soft_timeout_hit"):
        research["caps"] = caps
        return True

    started_raw = caps.get("started_at")
    if not isinstance(started_raw, str):
        research["caps"] = caps
        return False
    try:
        started = datetime.fromisoformat(started_raw)
    except ValueError:
        research["caps"] = caps
        return False
    if started.tzinfo is None:
        started = started.replace(tzinfo=UTC)

    current = now or datetime.now(UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    elapsed_s = (current - started).total_seconds()
    if elapsed_s >= float(getattr(settings, "deep_research_soft_timeout_s", 75)):
        caps["soft_timeout_hit"] = True
        research["caps"] = caps
        return True

    research["caps"] = caps
    return False


def elapsed_seconds(
    research: dict[str, Any],
    *,
    now: datetime | None = None,
) -> float | None:
    """Elapsed seconds since the research cap timer started."""
    caps = dict(research.get("caps") or {})
    started_raw = caps.get("started_at")
    if not isinstance(started_raw, str):
        return None
    try:
        started = datetime.fromisoformat(started_raw)
    except ValueError:
        return None
    if started.tzinfo is None:
        started = started.replace(tzinfo=UTC)

    current = now or datetime.now(UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    return max(0.0, (current - started).total_seconds())


def remaining_time_seconds(
    research: dict[str, Any],
    total_seconds: float,
    *,
    reserve_s: float = 0.0,
    cap_s: float | None = None,
    now: datetime | None = None,
) -> float:
    """Remaining runtime budget after reserving time for cleanup/fallback."""
    elapsed = elapsed_seconds(research, now=now)
    remaining = total_seconds if elapsed is None else total_seconds - elapsed
    remaining = max(0.0, remaining - reserve_s)
    if cap_s is not None:
        remaining = min(remaining, cap_s)
    return remaining
