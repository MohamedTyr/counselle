"""Assembles `FactsStatusResponse` from `adapters/facts_queries.py` plus a
settings-derived "next pass" estimate (plan §4.3/§5.5, appendix ii, Unit E).

`api/routes/admin_facts.py` (Unit F) is the only caller.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import cast

import asyncpg

from adapters import facts_queries
from app.facts.models import (
    CoverageCounts,
    CrawlRunSummary,
    FactsStatusResponse,
    TabFailure,
    UnmappedLabel,
)
from config.settings import Settings
from domain.facts.models import TabName

__all__ = ["get_facts_status"]


def _duration_s(run: facts_queries.CrawlRunRow) -> float | None:
    if run.finished_at is None:
        return None
    return (run.finished_at - run.started_at).total_seconds()


def _run_summary(run: facts_queries.CrawlRunRow) -> CrawlRunSummary:
    return CrawlRunSummary(
        id=run.id,
        started_at=run.started_at,
        finished_at=run.finished_at,
        duration_s=_duration_s(run),
        status=run.status,  # type: ignore[arg-type]
        error_code=run.error_code,
        error_message=run.error_message,
        build_id=run.build_id,
        build_id_rotations=run.build_id_rotations,
        schools_seen=run.schools_seen or 0,
        pages_fetched=run.pages_fetched,
        pages_changed=run.pages_changed,
        pages_failed=run.pages_failed,
        facts_changed=run.facts_changed,
        unmapped_label_count=run.unmapped_label_count,
    )


async def _next_run_at(pool: asyncpg.Pool, settings: Settings) -> datetime | None:
    """`None` when the worker is disabled (exit test: "with the worker flag
    off, `next_run_at` is null"); the queued job's `queued_at` when a pass
    is already queued; else the last finished pass plus the enqueue
    interval; `None` if the worker has never run."""
    if not settings.facts_worker_enabled:
        return None
    queued_at: datetime | None = await pool.fetchval(
        "SELECT queued_at FROM cds_library.facts_jobs "
        "WHERE kind = 'crawl_pass' AND status = 'queued' "
        "ORDER BY queued_at DESC LIMIT 1"
    )
    if queued_at is not None:
        return queued_at
    last_finished: datetime | None = await pool.fetchval(
        "SELECT max(finished_at) FROM cds_library.crawl_runs"
    )
    if last_finished is None:
        return None
    return last_finished + timedelta(hours=settings.facts_crawl_interval_hours)


async def get_facts_status(pool: asyncpg.Pool, settings: Settings) -> FactsStatusResponse:
    last_run = await facts_queries.get_last_run(pool)
    history = await facts_queries.get_recent_runs(pool, limit=settings.facts_admin_history_limit)
    coverage_row = await facts_queries.get_coverage_counts(pool)
    tab_failure_rows = await facts_queries.get_tab_failures(pool)
    queued_or_running = await facts_queries.get_queued_or_running(pool)
    next_run_at = await _next_run_at(pool, settings)

    unmapped_labels = tuple(
        UnmappedLabel(
            source_path=entry["source_path"], label=entry["label"], schools=entry["schools"]
        )
        for entry in (last_run.unmapped_labels if last_run is not None else [])
    )
    unmapped_truncated = (
        last_run is not None and last_run.unmapped_label_count > len(unmapped_labels)
    )

    return FactsStatusResponse(
        last_run=_run_summary(last_run) if last_run is not None else None,
        next_run_at=next_run_at,
        worker_enabled=settings.facts_worker_enabled,
        queued_or_running=queued_or_running,
        coverage=CoverageCounts(
            sitemap_slugs=coverage_row.sitemap_slugs,
            crosswalk_matched=coverage_row.crosswalk_matched,
            crosswalk_unmatched=coverage_row.crosswalk_unmatched,
            schools_total=coverage_row.schools_total,
            schools_with_facts=coverage_row.schools_with_facts,
        ),
        tab_failures=tuple(
            TabFailure(tab=cast(TabName, tab), status=status, count=count)
            for tab, status, count in tab_failure_rows
        ),
        unmapped_labels=unmapped_labels,
        unmapped_labels_truncated=unmapped_truncated,
        history=tuple(_run_summary(run) for run in history),
    )
