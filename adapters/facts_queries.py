"""Read-side SQL for the facts admin dashboard (plan §4.3/§5.5, Unit E).

Mirrors `adapters/cds_admin_queries.py`'s role: every function here takes
the *pipeline pool* (`Runtime.pipeline_pool`, `cds_library_app` role) and
returns plain records/dicts — `app/facts/service_admin.py` assembles the
typed `FactsStatusResponse` from them. Parameterized SQL only.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

import asyncpg

__all__ = [
    "CoverageCounts",
    "CrawlRunRow",
    "get_coverage_counts",
    "get_last_run",
    "get_queued_or_running",
    "get_recent_runs",
    "get_tab_failures",
]

_RUN_COLUMNS = """
    id, started_at, finished_at, status, error_code, error_message,
    build_id, build_id_rotations, schools_seen, pages_fetched, pages_changed,
    pages_failed, facts_changed, unmapped_label_count, unmapped_labels
"""


@dataclass(frozen=True)
class CrawlRunRow:
    id: int
    started_at: datetime
    finished_at: datetime | None
    status: str
    error_code: str | None
    error_message: str | None
    build_id: str | None
    build_id_rotations: int
    schools_seen: int | None
    pages_fetched: int
    pages_changed: int
    pages_failed: int
    facts_changed: int
    unmapped_label_count: int
    unmapped_labels: list[dict[str, Any]]


def _run_row(row: asyncpg.Record) -> CrawlRunRow:
    return CrawlRunRow(**dict(row))


async def get_last_run(pool: asyncpg.Pool) -> CrawlRunRow | None:
    """The most recently *started* run, whatever its status — the "last
    run" the dashboard header shows, including a still-`running` one."""
    row = await pool.fetchrow(
        f"SELECT {_RUN_COLUMNS} FROM cds_library.crawl_runs "  # nosec B608
        "ORDER BY started_at DESC LIMIT 1"
    )
    return _run_row(row) if row is not None else None


async def get_recent_runs(pool: asyncpg.Pool, *, limit: int) -> list[CrawlRunRow]:
    """The last `limit` runs, newest first (`FactsStatusResponse.history`)."""
    rows = await pool.fetch(
        f"SELECT {_RUN_COLUMNS} FROM cds_library.crawl_runs "  # nosec B608
        "ORDER BY started_at DESC LIMIT $1",
        limit,
    )
    return [_run_row(row) for row in rows]


async def get_queued_or_running(pool: asyncpg.Pool) -> bool:
    """Whether a `crawl_pass` job is currently queued or running — governs
    the admin dashboard's "Run a pass now" button state (plan §5.5)."""
    row = await pool.fetchval(
        "SELECT 1 FROM cds_library.facts_jobs "
        "WHERE kind = 'crawl_pass' AND status IN ('queued', 'running') LIMIT 1"
    )
    return row is not None


@dataclass(frozen=True)
class CoverageCounts:
    sitemap_slugs: int | None
    crosswalk_matched: int
    crosswalk_unmatched: int
    schools_total: int
    schools_with_facts: int


async def get_coverage_counts(pool: asyncpg.Pool) -> CoverageCounts:
    """`FactsStatusResponse.coverage` (plan appendix ii): the last pass's
    sitemap count plus live crosswalk/explore-row totals (not pass-scoped —
    always current)."""
    row = await pool.fetchrow(
        """
        SELECT
            (SELECT sitemap_slugs FROM cds_library.crawl_runs
             WHERE sitemap_slugs IS NOT NULL ORDER BY started_at DESC LIMIT 1) AS sitemap_slugs,
            (SELECT count(*) FROM cds_library.collegedata_schools
             WHERE retired_at IS NULL AND school_id IS NOT NULL) AS crosswalk_matched,
            (SELECT count(*) FROM cds_library.collegedata_schools
             WHERE retired_at IS NULL AND school_id IS NULL) AS crosswalk_unmatched,
            (SELECT count(*) FROM cds_library.schools) AS schools_total,
            (SELECT count(*) FROM cds_library.school_explore_rows WHERE retired_at IS NULL)
                AS schools_with_facts
        """
    )
    assert row is not None
    return CoverageCounts(**dict(row))


async def get_tab_failures(pool: asyncpg.Pool) -> list[tuple[str, str, int]]:
    """`(tab, last_status, count)` for every non-`ok` page, grouped —
    `FactsStatusResponse.tab_failures` (plan appendix ii)."""
    rows = await pool.fetch(
        """
        SELECT tab, last_status, count(*) AS count
        FROM cds_library.school_pages
        WHERE last_status <> 'ok'
        GROUP BY tab, last_status
        ORDER BY count DESC
        """
    )
    return [(row["tab"], row["last_status"], row["count"]) for row in rows]
