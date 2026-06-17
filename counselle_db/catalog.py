"""The in-memory fields catalog + decode maps + data calendar (ARCHITECTURE §8).

Loaded once at server start from ``public.fields``; refreshed hourly via
:meth:`Catalog.maybe_refresh` (callers decide when to call it — KISS). Decode
maps are fetched lazily per coded column from ``raw.ipeds_valuesets24`` and
cached forever (IPEDS codes are static — DATABASE_GUIDE R1). Scorecard has no
decode table, so its few coded columns use the hardcoded maps from §8.
"""

import asyncio
import re
from datetime import UTC, datetime, timedelta
from typing import NamedTuple

import asyncpg
import structlog
from pydantic import BaseModel

from counselle_db.db import fetch
from counselle_db.models import ServiceError
from domain.normalize import FieldMeta
from domain.urls import registrable_domain
from domain.vintage import vintage_for

logger = structlog.get_logger(__name__)

_REFRESH_INTERVAL = timedelta(hours=1)

#: Scorecard coded columns — hardcoded, no decode endpoint exists (DATABASE_GUIDE §8).
_DEGREE_LEVELS = {
    "0": "Non-degree-granting",
    "1": "Certificate",
    "2": "Associate degree",
    "3": "Bachelor's degree",
    "4": "Graduate degree",
}
SCORECARD_DECODE_MAPS: dict[str, dict[str, str]] = {
    "PREDDEG": _DEGREE_LEVELS,
    "HIGHDEG": _DEGREE_LEVELS,
    "CONTROL": {"1": "Public", "2": "Private (nonprofit)", "3": "Private (for-profit)"},
    "MAIN": {"0": "Branch campus", "1": "Main campus"},
}

#: Scorecard field-of-study credential levels (DATABASE_GUIDE §8, full CREDLEV decode).
CREDLEV_DECODE: dict[int, str] = {
    1: "Undergraduate certificate",
    2: "Associate degree",
    3: "Bachelor's degree",
    4: "Post-baccalaureate certificate",
    5: "Master's degree",
    6: "Doctoral degree",
    7: "First-professional degree",
    8: "Graduate certificate",
    99: "Non-credential program",
}

_IPEDS_CYCLE_RE = re.compile(r"IPEDS(\d{4})")

_FIELDS_SQL = """
SELECT key, label, category, data_type, source, raw_table, raw_column
FROM fields WHERE enabled
"""

# Valuesets store bare uppercase table names ('ADM2024'); fields store FQ names
# ('raw.ipeds_adm2024') — verified live 2026-06-10 (phase-2 Slice A note).
_DECODE_SQL = """
SELECT "Codevalue", "ValueLabel"
FROM raw.ipeds_valuesets24
WHERE lower("TableName") = lower(replace($1, 'raw.ipeds_', ''))
  AND lower("VarName") = lower($2)
"""

_FILES_SQL = "SELECT filename, downloaded_at, source FROM raw.files ORDER BY id"

_VALUESETS_COUNT_SQL = "SELECT count(*) FROM raw.ipeds_valuesets24"

_SCHOOL_NAMES_SQL = "SELECT unitid, name FROM schools"

# unitid → website, for the activity-timeline school logos (MVP2 §27.1). A
# separate query, NOT a join onto _SCHOOL_NAMES_SQL: field_values is keyed
# (unitid, field_key, cycle_year) — DISTINCT ON keeps the newest row per school
# and guards against a school ever carrying the field across two cycles. `value`
# is jsonb (a JSON string scalar like "www.aamu.edu/"), so `#>> '{}'` unwraps it
# to bare text. ~2.7k rows, one extra query at load (hits the field_key index).
_SCHOOL_WEBSITES_SQL = """
SELECT DISTINCT ON (unitid) unitid, value #>> '{}' AS website
FROM field_values
WHERE field_key = 'institution.website' AND value IS NOT NULL
ORDER BY unitid, cycle_year DESC NULLS LAST
"""

_CDS_CALENDAR_SQL = """
SELECT (SELECT value FROM settings WHERE key = 'current_cycle_year') AS cycle_year,
       (SELECT count(DISTINCT unitid) FROM field_values
         WHERE source = 'cds' AND value IS NOT NULL)                 AS extracted_schools
"""


class CalendarEntry(BaseModel):
    """One source's vintage + knowledge cutoff, derived live (never hardcoded)."""

    source: str
    vintage: str
    cutoff_note: str


class _SourceFiles(NamedTuple):
    """What ``raw.files`` tells us about the loaded source datasets."""

    scorecard_filename: str | None
    scorecard_loaded_at: datetime | None
    ipeds_cycle_year: int | None
    ipeds_loaded_at: datetime | None


def _scan_source_files(rows: list[asyncpg.Record]) -> _SourceFiles:
    """Derive the per-source dataset facts from ``raw.files`` (pure — no instance state)."""
    scorecard_filename: str | None = None
    scorecard_loaded_at: datetime | None = None
    ipeds_cycle_year: int | None = None
    ipeds_loaded_at: datetime | None = None
    for row in rows:
        filename, source = row["filename"], row["source"]
        if source == "scorecard" and filename.endswith(".zip"):
            scorecard_filename = filename
            scorecard_loaded_at = row["downloaded_at"]
        elif source == "ipeds" and filename.endswith(".accdb"):
            ipeds_loaded_at = row["downloaded_at"]
            match = _IPEDS_CYCLE_RE.search(filename)
            if match:
                ipeds_cycle_year = int(match.group(1))
            else:
                ipeds_cycle_year = None
                logger.warning("unparseable IPEDS filename (no cycle year)", filename=filename)
    return _SourceFiles(scorecard_filename, scorecard_loaded_at, ipeds_cycle_year, ipeds_loaded_at)


class Catalog:
    """The fields catalog, decode-map cache, and live data calendar."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool
        self.fields_by_key: dict[str, FieldMeta] = {}
        self.school_names: dict[int, str] = {}
        self.school_domains: dict[int, str] = {}
        #: Live coverage count (= len(school_names)) — derived from the DB and
        #: refreshed for free with the hourly catalog reload (CFG-01, ADR 0018
        #: bucket 3). NEVER a hardcoded literal: the count drifts on every
        #: pipeline re-ingest and a stale number would lie to a student about
        #: coverage (CLAUDE.md principle 3). 0 until the first _reload().
        self.school_count: int = 0
        self.scorecard_filename: str | None = None
        self.ipeds_cycle_year: int | None = None
        self.loaded_at: datetime = datetime.min.replace(tzinfo=UTC)
        self._decode_cache: dict[tuple[str, str], dict[str, str] | None] = {}
        self._ipeds_loaded_at: datetime | None = None
        self._scorecard_loaded_at: datetime | None = None
        # Serializes concurrent refreshes: N stale callers would each launch a full
        # _reload (a thundering herd) — only the first waiter reloads (audit M1).
        self._reload_lock = asyncio.Lock()

    def school_name(self, unitid: int) -> str | None:
        """The school's display name, or None when the unitid is unknown.

        In-memory (loaded with the catalog, ~2.7k rows) so hot paths — step
        labels (MVP2 §27.1) — never touch the pool.
        """
        return self.school_names.get(unitid)

    def school_domain(self, unitid: int) -> str | None:
        """The school's registrable website domain (e.g. ``stanford.edu``), or None.

        In-memory like ``school_name`` — feeds the timeline's school-logo chip
        (a favicon derived from this domain). The only honest fact we have is the
        school's own website domain; the "logo" is derived from it client-side.
        """
        return self.school_domains.get(unitid)

    @classmethod
    async def load(cls, pool: asyncpg.Pool) -> "Catalog":
        """Load the catalog once at server start (decode source must be non-empty)."""
        valueset_count = (await fetch(pool, _VALUESETS_COUNT_SQL))[0]["count"]
        if not valueset_count:
            raise RuntimeError("ipeds valuesets table is empty — decode maps unavailable (R1 risk)")
        catalog = cls(pool)
        await catalog._reload()
        return catalog

    async def maybe_refresh(self) -> None:
        """Reload the catalog if it is older than an hour (callers decide when).

        On failure, the stale catalog is served (callers continue normally) and
        the next retry is deferred by ~10 minutes to avoid a thundering herd of
        reload attempts during a DB blip. The initial load (via ``load()``) still
        raises on failure — only the periodic refresh serves stale.
        """
        if datetime.now(UTC) - self.loaded_at < _REFRESH_INTERVAL:
            return
        async with self._reload_lock:
            # Double-check: a concurrent caller may have reloaded while we waited
            # on the lock — only the first waiter reloads (audit M1).
            if datetime.now(UTC) - self.loaded_at < _REFRESH_INTERVAL:
                return
            try:
                await self._reload()
            except Exception:
                logger.warning(
                    "catalog refresh failed — serving stale catalog",
                    exc_info=True,
                )
                # Advance loaded_at so the next attempt happens in ~10 minutes,
                # not on every subsequent call (thundering herd prevention).
                self.loaded_at = datetime.now(UTC) - (_REFRESH_INTERVAL - timedelta(minutes=10))

    async def _reload(self) -> None:
        # Build everything into locals first; a failed query mid-reload must never
        # leave a half-updated catalog that is then treated as fresh.
        field_rows = await fetch(self.pool, _FIELDS_SQL)
        new_fields = {row["key"]: FieldMeta(**dict(row)) for row in field_rows}
        files = _scan_source_files(await fetch(self.pool, _FILES_SQL))
        name_rows = await fetch(self.pool, _SCHOOL_NAMES_SQL)
        new_names = {row["unitid"]: row["name"] for row in name_rows}
        website_rows = await fetch(self.pool, _SCHOOL_WEBSITES_SQL)
        new_domains = {
            row["unitid"]: domain
            for row in website_rows
            if (domain := registrable_domain(row["website"] or "")) is not None
        }
        # Every query succeeded — swap the instance state, loaded_at last.
        self.fields_by_key = new_fields
        self.school_names = new_names
        self.school_count = len(new_names)  # CFG-01: live coverage count, no extra query
        self.school_domains = new_domains
        self.scorecard_filename = files.scorecard_filename
        self._scorecard_loaded_at = files.scorecard_loaded_at
        self.ipeds_cycle_year = files.ipeds_cycle_year
        self._ipeds_loaded_at = files.ipeds_loaded_at
        self.loaded_at = datetime.now(UTC)

    async def decode_map_for(self, meta: FieldMeta) -> dict[str, str] | None:
        """The code→label map for a coded int field; None when the field isn't coded (R1)."""
        if meta.data_type != "int":
            return None
        if meta.source == "scorecard":
            return SCORECARD_DECODE_MAPS.get((meta.raw_column or "").upper())
        if meta.source != "ipeds" or not meta.raw_table or not meta.raw_column:
            return None  # CDS strings need no decode (R7)
        cache_key = (meta.raw_table, meta.raw_column)
        if cache_key not in self._decode_cache:
            rows = await fetch(self.pool, _DECODE_SQL, meta.raw_table, meta.raw_column)
            decoded = {row["Codevalue"]: row["ValueLabel"] for row in rows}
            self._decode_cache[cache_key] = decoded or None  # codes are static: cache forever
        return self._decode_cache[cache_key]

    async def data_calendar(self) -> list[CalendarEntry]:
        """Per-source vintage + cutoff, derived live (ARCHITECTURE §8)."""
        cds_rows = await fetch(self.pool, _CDS_CALENDAR_SQL)
        if not cds_rows:
            raise ServiceError("data calendar unavailable: settings table returned no rows")
        cds_row = cds_rows[0]
        cds_year = cds_row["cycle_year"] if isinstance(cds_row["cycle_year"], int) else None
        return [
            self._ipeds_entry(),
            self._scorecard_entry(),
            self._cds_entry(cds_year, cds_row["extracted_schools"]),
        ]

    def _ipeds_entry(self) -> CalendarEntry:
        vintage, _ = vintage_for("ipeds", self.ipeds_cycle_year)
        loaded = _loaded_suffix(self._ipeds_loaded_at)
        return CalendarEntry(
            source="ipeds",
            vintage=vintage,
            cutoff_note=(
                f"Provisional federal data for the fall {self.ipeds_cycle_year} collection"
                f"{loaded}; later developments are not in this source."
            ),
        )

    def _scorecard_entry(self) -> CalendarEntry:
        vintage, _ = vintage_for("scorecard", None, scorecard_filename=self.scorecard_filename)
        loaded = _loaded_suffix(self._scorecard_loaded_at)
        return CalendarEntry(
            source="scorecard",
            vintage=vintage,
            cutoff_note=(
                f"Most-recent cohorts as of publication{loaded}; "
                "earnings figures lag the entry cohort by years."
            ),
        )

    def _cds_entry(self, cycle_year: int | None, extracted_schools: int) -> CalendarEntry:
        vintage, _ = vintage_for("cds", cycle_year)
        return CalendarEntry(
            source="cds",
            vintage=vintage,
            cutoff_note=(
                f"Extracted for {extracted_schools} school(s) so far; "
                "all other schools fall back to IPEDS/Scorecard."
            ),
        )


def _loaded_suffix(loaded_at: datetime | None) -> str:
    return f" (loaded {loaded_at:%Y-%m-%d})" if loaded_at else ""
