"""Read-side SQL for `GET /v1/admin/facts/unmapped` (plan §5.5).

Deliberately separate from `adapters/facts_queries.py`, which is not
touched here — see the plan's file-ownership split in
`../specs/school-data-v3/plan/school-data-v3.md` §7/PHASES.md: that module's `unmapped_labels`
is the last pass's already-bounded JSON sample
(`facts_admin_unmapped_limit`) embedded in `FactsStatusResponse` for the
collapsed dashboard summary. This module instead reads the *live*,
uncapped population straight from `cds_library.school_facts` — a shape
change at CollegeData can surface thousands of distinct labels, and the
plan (appendix E, F23) requires those live behind their own paged
endpoint rather than inside the polled status payload.

An "unmapped" fact is one the mapper could not recognise: it lands as
`fact_key = 'unmapped:<source_path>'`, per `app/facts/mapper.py`
(``domain.facts`` never sees this string — see `PHASES.md`'s
`unmapped:*` grep rule).
"""

from __future__ import annotations

from dataclasses import dataclass

import asyncpg

__all__ = ["UnmappedLabelPage", "UnmappedLabelRow", "get_unmapped_labels_page"]


@dataclass(frozen=True)
class UnmappedLabelRow:
    source_path: str
    label: str
    school_count: int


@dataclass(frozen=True)
class UnmappedLabelPage:
    items: list[UnmappedLabelRow]
    total: int


async def get_unmapped_labels_page(
    pool: asyncpg.Pool, *, page: int, page_size: int
) -> UnmappedLabelPage:
    """Page `page` (1-indexed) of every distinct `(source_path, label)` pair
    currently live under `fact_key LIKE 'unmapped:%'`, ordered by how many
    schools carry it (the labels most worth a human's attention first)."""
    offset = (page - 1) * page_size
    total = await pool.fetchval(
        "SELECT count(*) FROM ("
        "  SELECT 1 FROM cds_library.school_facts"
        "  WHERE valid_to IS NULL AND fact_key LIKE 'unmapped:%'"
        "  GROUP BY source_path, label"
        ") distinct_labels"
    )
    rows = await pool.fetch(
        "SELECT source_path, label, count(DISTINCT school_id) AS school_count"
        " FROM cds_library.school_facts"
        " WHERE valid_to IS NULL AND fact_key LIKE 'unmapped:%'"
        " GROUP BY source_path, label"
        " ORDER BY school_count DESC, source_path, label"
        " LIMIT $1 OFFSET $2",
        page_size,
        offset,
    )
    items = [
        UnmappedLabelRow(
            source_path=row["source_path"], label=row["label"], school_count=row["school_count"]
        )
        for row in rows
    ]
    return UnmappedLabelPage(items=items, total=total or 0)
