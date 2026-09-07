"""Routine (no DB) unit test for `app/facts/service_admin.py`'s
`next_run_at` rule (plan §7 Phase 1 exit criteria: "with the worker flag
off, `next_run_at` is null")."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.facts.service_admin import _next_run_at


class _ExplodingPool:
    """Any attribute access means the disabled-worker short-circuit didn't
    happen -- `_next_run_at` must return `None` before ever touching the
    pool."""

    def __getattr__(self, name: str) -> object:
        raise AssertionError(f"pool.{name} was called while the worker is disabled")


async def test_next_run_at_is_none_when_worker_disabled() -> None:
    settings = SimpleNamespace(facts_worker_enabled=False, facts_crawl_interval_hours=24)
    result = await _next_run_at(_ExplodingPool(), settings)  # type: ignore[arg-type]
    assert result is None


@pytest.mark.parametrize("enabled", [True])
async def test_next_run_at_requires_pool_when_worker_enabled(enabled: bool) -> None:
    settings = SimpleNamespace(facts_worker_enabled=enabled, facts_crawl_interval_hours=24)
    with pytest.raises(AssertionError):
        await _next_run_at(_ExplodingPool(), settings)  # type: ignore[arg-type]
