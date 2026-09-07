"""The committed CollegeData<->IPEDS crosswalk CSV: loader + DB sync (plan §2/§4.6).

``config/facts/collegedata_crosswalk.csv`` is built once, offline, by
``scripts/build_crosswalk.py`` (Unit A) — a six-stage automatic matching
ladder plus a hand-reviewed adjudication pass, never an LLM at build or run
time (D7). This module is the CSV's **only** loader; nothing else in the
codebase parses it directly. ``load_crosswalk()`` is registered with
``config.settings.reset_config_caches()`` so a test or a hot-reloaded dev
server never serves a stale copy after the file changes on disk.

``sync_crosswalk()`` upserts the CSV into ``cds_library.collegedata_schools``
(seeded empty) — the one write this module performs, run by
``python -m app.facts crosswalk-sync`` (Unit E's ``__main__.py``, not built
here) and by ``dev.py reset-db`` / the Phase 4 bootstrap. It is idempotent:
re-running it with an unchanged CSV changes no row.
"""

from __future__ import annotations

import csv
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType

import asyncpg

_CSV_PATH = (
    Path(__file__).resolve().parents[2] / "config" / "facts" / "collegedata_crosswalk.csv"
)

# Mirrors `collegedata_schools.match_method`'s CHECK constraint verbatim
# (deploy/seed/cds_library_schema.sql) — the one place both this loader and
# `scripts/build_crosswalk.py` cite the same set, each pinned to the DDL by
# its own test.
VALID_METHODS: frozenset[str] = frozenset(
    {
        "exact",
        "exact_city",
        "trigram",
        "trigram_city",
        "token_city",
        "single_city",
        "manual",
        "unmatched",
    }
)

_UPSERT_SQL = """
    INSERT INTO cds_library.collegedata_schools
        (slug, school_id, match_method, matched_at, note)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (slug) DO UPDATE SET
        school_id = EXCLUDED.school_id,
        match_method = EXCLUDED.match_method,
        matched_at = EXCLUDED.matched_at,
        note = EXCLUDED.note
"""  # nosec B608
# `last_seen_in_sitemap_at`/`retired_at` are deliberately untouched here —
# they are crawl-pass bookkeeping (Unit E's `app/facts/crawl.py` territory),
# not something a CSV sync should stamp; touching either would make a
# second, otherwise-identical sync look like a change.


@dataclass(frozen=True)
class CrosswalkEntry:
    """One row of the committed CSV, typed."""

    slug: str
    unitid: int | None
    method: str
    matched_at: datetime | None
    note: str


@lru_cache
def load_crosswalk() -> Mapping[str, CrosswalkEntry]:
    """slug -> ``CrosswalkEntry``, keyed exactly as committed. ``unitid`` is
    ``None`` only for a ``method="unmatched"`` row — never a guess."""
    entries: dict[str, CrosswalkEntry] = {}
    with _CSV_PATH.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            if row["method"] not in VALID_METHODS:
                raise ValueError(f"{row['slug']}: method {row['method']!r} outside the CHECK set")
            entries[row["slug"]] = CrosswalkEntry(
                slug=row["slug"],
                unitid=int(row["unitid"]) if row["unitid"] else None,
                method=row["method"],
                matched_at=datetime.fromisoformat(row["matched_at"]) if row["matched_at"] else None,
                note=row["note"],
            )
    return MappingProxyType(entries)


async def sync_crosswalk(pool: asyncpg.Pool) -> int:
    """Upsert every committed CSV row into ``cds_library.collegedata_schools``.

    Idempotent: re-running with an unchanged CSV updates every row to the
    same values it already holds, inserting nothing new and changing no
    other column. A row whose ``method`` is ``unmatched`` is still written, with
    ``school_id = NULL`` — the dashboard's "needs adjudication" list reads
    these, they are never silently absent (plan §4.6).

    Returns the number of rows upserted.
    """
    entries = load_crosswalk()
    rows = [
        (entry.slug, entry.unitid, entry.method, entry.matched_at, entry.note)
        for entry in entries.values()
    ]
    async with pool.acquire() as conn, conn.transaction():
        await conn.executemany(_UPSERT_SQL, rows)
    return len(rows)
