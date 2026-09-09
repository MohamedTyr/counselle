"""Atomic, immutable catalog snapshot for the six-view reader contract (school-data-v3)."""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from difflib import SequenceMatcher
from types import MappingProxyType
from typing import Any

import asyncpg
import structlog

from config.settings import get_settings, load_yaml_asset
from counselle_db.formatting import hex_digest
from counselle_db.models import FactCoverageRow, SchoolBasics, ServiceError

logger = structlog.get_logger(__name__)

_FUZZY_MATCH_MIN_SCORE = 0.80


def _freeze(value: Any) -> Any:
    """Recursively freeze JSON-shaped snapshot state, not only its outer mapping."""
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze(child) for key, child in value.items()})
    if isinstance(value, list | tuple):
        return tuple(_freeze(child) for child in value)
    return value


@dataclass(frozen=True)
class SectionFact:
    """One `facts:` entry — a key this school's page always declares, present or absent
    (plan §5.2: "``label:`` is what the page renders for every declared key")."""

    key: str
    label: str
    tab: str


@dataclass(frozen=True)
class SectionGroup:
    """One layout group. ``foot``/``foot_ref`` are mutually exclusive (a Phase 1 test
    pins this on the asset itself); at most one of the two is ever non-``None``.

    The committed ``facts_sections.yaml`` (Phase 1) does not yet carry the
    plan's ``chart:``/group-level ``headline`` layout hints described in §5.2
    — every group here reads its authored ``title:`` as ``label`` and no
    group carries a ``chart``.
    """

    id: str
    label: str
    foot: str | None
    foot_ref: str | None
    facts: tuple[SectionFact, ...]


@dataclass(frozen=True)
class FactsSection:
    id: str
    title: str
    tabs: tuple[str, ...]
    groups: tuple[SectionGroup, ...]


def _load_sections() -> Mapping[str, FactsSection]:
    """Parse `config/assets/facts_sections.yaml` (Phase 1) into `FactsSection`s.

    The asset has exactly one loader (this function) — `app/facts/service.py`
    reads `Catalog.snapshot.sections`, never the yaml file itself (plan §5.2).
    """
    raw = load_yaml_asset("facts_sections")
    sections: dict[str, FactsSection] = {}
    for section in raw["sections"]:
        groups = tuple(
            SectionGroup(
                id=group["id"],
                label=group["title"],
                foot=group.get("foot"),
                foot_ref=group.get("foot_ref"),
                facts=tuple(
                    SectionFact(key=fact["key"], label=fact["label"], tab=fact["tab"])
                    for fact in group["facts"]
                ),
            )
            for group in section["groups"]
        )
        sections[section["id"]] = FactsSection(
            id=section["id"],
            title=section["title"],
            tabs=tuple(section["tabs"]),
            groups=groups,
        )
    return MappingProxyType(sections)


_PROFILES_SQL = """SELECT id,name,aliases,city,state,search_name,official_domain,is_main_campus,
 basic_profile,profile_version,profile_snapshot_date,profile_sha256
 FROM cds_library.school_profiles ORDER BY id"""
# One row per school, including one with no CollegeData crawl yet at all
# (LEFT JOIN in the view) -- an empty facts store still returns every school
# with fact_count=0 and facts_updated_at=NULL, never an absent row.
_SCHOOL_DATA_STATUS_SQL = """SELECT school_id,fact_count,facts_updated_at
 FROM cds_library.school_data_status"""
# The fact-key universe for viz cell validation and the data picture (plan
# §6a/appendix F-ii): `explore.*` pseudo-keys are `school_explore` columns,
# not `fact_key`-addressable facts, and a key no school has ever reported
# can never ground a claim -- both are excluded so `CatalogSnapshot.fact_keys`
# is exactly the set `query_database`'s guard (`_is_known_fact_key`) and the
# agent's typed reads may treat as real.
_FACT_COVERAGE_SQL = """SELECT fact_key,schools_with_value,schools_total,computed_at
 FROM cds_library.fact_coverage
 WHERE fact_key NOT LIKE 'explore.%' AND schools_with_value > 0"""


def normalize_school_name(value: str) -> str:
    value = value.casefold().replace("&", " and ")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value).split())


def _abbreviations() -> Mapping[str, str]:
    """Common abbreviation -> full-name expansions (config/assets/abbreviations.yaml).

    Substring/ILIKE-style matching never finds "MIT" inside "Massachusetts
    Institute of Technology" — expand the query before searching. Deliberately
    uncached beyond ``load_yaml_asset``'s own cache: a second cache layer here
    would need coupling into ``reset_config_caches()`` (audit L4) for no real
    benefit — normalizing ~40 keys is too cheap to be worth it.
    """
    raw = load_yaml_asset("abbreviations")
    if not isinstance(raw, dict):
        raise ValueError("abbreviations asset must be a mapping")
    return MappingProxyType({normalize_school_name(k): v for k, v in raw.items()})


@dataclass(frozen=True)
class SchoolRecord:
    basics: SchoolBasics
    aliases: tuple[str, ...]
    search_name: str
    is_main_campus: bool
    basic_profile: Mapping[str, Any]
    profile_version: str
    profile_snapshot_date: date
    profile_sha256: str


@dataclass(frozen=True)
class CatalogSnapshot:
    refreshed_at: datetime
    schools: Mapping[int, SchoolRecord]
    name_index: Mapping[str, tuple[int, ...]]
    profile_groups: tuple[str, ...]
    profile_snapshot_min: date
    profile_snapshot_max: date
    # CollegeData facts-store aggregates (cds_library.school_data_status).
    # Genuinely zero/None while the facts store is empty (Phase 0-1) — not a
    # placeholder, the real count of an empty crawl.
    schools_with_facts: int
    facts_updated_min: datetime | None
    facts_updated_max: datetime | None
    stale_facts_count: int
    # `fact_keys` -> its `FactCoverageRow` (school-data-v3 Phase 3):
    # `fact_coverage` filtered to non-`explore.*` rows with
    # `schools_with_value > 0` -- the fact-key universe for `query_database`'s
    # guard, viz cell validation, and the data picture. `sections` was filled
    # from `facts_sections.yaml` in Phase 2 (`get_facts`, the facts route).
    fact_keys: Mapping[str, Any]
    sections: Mapping[str, Any]


class Catalog:
    def __init__(self, pool: asyncpg.Pool, snapshot: CatalogSnapshot, *, settings: Any = None):
        self.pool = pool
        self._snapshot = snapshot
        self._last_attempt = snapshot.refreshed_at
        self.settings = settings

    @property
    def snapshot(self) -> CatalogSnapshot:
        return self._snapshot

    @property
    def school_count(self) -> int:
        return len(self._snapshot.schools)

    @property
    def school_names(self) -> Mapping[int, str]:
        return MappingProxyType(
            {unitid: record.basics.name for unitid, record in self._snapshot.schools.items()}
        )

    @classmethod
    async def load(cls, pool: asyncpg.Pool, *, settings: Any = None) -> Catalog:
        return cls(
            pool,
            await cls._load_snapshot(pool),
            settings=settings,
        )

    @staticmethod
    async def _load_snapshot(pool: asyncpg.Pool) -> CatalogSnapshot:
        # Deliberately the global settings, not an injected instance: this is
        # a bare @staticmethod (tests monkeypatch it wholesale with a
        # single-argument replacement), and facts_stale_days is not something
        # a caller needs to override per Catalog instance.
        settings = get_settings()
        async with (
            pool.acquire() as conn,
            conn.transaction(isolation="repeatable_read", readonly=True),
        ):
            profile_rows = await conn.fetch(_PROFILES_SQL)
            status_rows = await conn.fetch(_SCHOOL_DATA_STATUS_SQL)
            fact_coverage_rows = await conn.fetch(_FACT_COVERAGE_SQL)
            now = datetime.now(UTC)
        if not profile_rows:
            raise ServiceError("The school profile catalog is empty.")
        schools: dict[int, SchoolRecord] = {}
        names: dict[str, list[int]] = {}
        groups: set[str] = set()
        dates: list[date] = []
        for row in profile_rows:
            unitid = row["id"]
            aliases = row["aliases"] or ()
            if (
                not isinstance(unitid, int)
                or unitid <= 0
                or unitid in schools
                or not isinstance(row["name"], str)
                or not row["name"].strip()
                or not isinstance(row["search_name"], str)
                or not row["search_name"].strip()
                or any(not isinstance(alias, str) or not alias.strip() for alias in aliases)
                or not isinstance(row["basic_profile"], dict)
                or len(bytes(row["profile_sha256"])) != 32
            ):
                raise ServiceError("School profile identity is invalid or duplicated.")
            profile = row["basic_profile"]
            groups.update(k for k, value in profile.items() if isinstance(value, dict))
            record = SchoolRecord(
                basics=SchoolBasics(
                    unitid=unitid,
                    name=row["name"],
                    city=row["city"],
                    state=row["state"],
                    official_domain=row["official_domain"],
                ),
                aliases=tuple(aliases),
                search_name=row["search_name"],
                is_main_campus=bool(row["is_main_campus"]),
                basic_profile=_freeze(profile),
                profile_version=row["profile_version"],
                profile_snapshot_date=row["profile_snapshot_date"],
                profile_sha256=hex_digest(row["profile_sha256"]),
            )
            schools[unitid] = record
            dates.append(record.profile_snapshot_date)
            for name in (record.basics.name, record.search_name, *record.aliases):
                normalized = normalize_school_name(name)
                if normalized:
                    names.setdefault(normalized, []).append(unitid)
        stale_cutoff = now - timedelta(days=settings.facts_stale_days)
        schools_with_facts = 0
        stale_facts_count = 0
        updated_ats: list[datetime] = []
        for row in status_rows:
            if row["fact_count"]:
                schools_with_facts += 1
            updated_at = row["facts_updated_at"]
            if updated_at is not None:
                updated_ats.append(updated_at)
                if updated_at < stale_cutoff:
                    stale_facts_count += 1
        return CatalogSnapshot(
            refreshed_at=now,
            schools=MappingProxyType(schools),
            name_index=MappingProxyType({k: tuple(v) for k, v in names.items()}),
            profile_groups=tuple(sorted(groups)),
            profile_snapshot_min=min(dates),
            profile_snapshot_max=max(dates),
            schools_with_facts=schools_with_facts,
            facts_updated_min=min(updated_ats) if updated_ats else None,
            facts_updated_max=max(updated_ats) if updated_ats else None,
            stale_facts_count=stale_facts_count,
            fact_keys=MappingProxyType(
                {
                    row["fact_key"]: FactCoverageRow(
                        fact_key=row["fact_key"],
                        schools_with_value=row["schools_with_value"],
                        schools_total=row["schools_total"],
                        as_of=row["computed_at"],
                    )
                    for row in fact_coverage_rows
                }
            ),
            sections=_load_sections(),
        )

    async def maybe_refresh(self, *, force: bool = False) -> CatalogSnapshot:
        settings = self.settings or get_settings()
        cadence = timedelta(seconds=settings.data_catalog_refresh_seconds)
        now = datetime.now(UTC)
        if not force and now - self._last_attempt < cadence:
            return self._snapshot
        self._last_attempt = now
        try:
            fresh = await self._load_snapshot(self.pool)
        except Exception:
            logger.warning("catalog_refresh_failed", exc_info=True)
            return self._snapshot
        self._snapshot = fresh
        return fresh

    def school_name(self, unitid: int) -> str | None:
        record = self._snapshot.schools.get(unitid)
        return record.basics.name if record else None

    def school_domain(self, unitid: int) -> str | None:
        record = self._snapshot.schools.get(unitid)
        return record.basics.official_domain if record else None

    def resolve_candidates(self, query: str) -> tuple[SchoolRecord, ...]:
        normalized = normalize_school_name(query)
        if query.isdigit() and int(query) in self._snapshot.schools:
            return (self._snapshot.schools[int(query)],)
        expansion = _abbreviations().get(normalized)
        if expansion is not None:
            normalized = normalize_school_name(expansion)
        exact = self._snapshot.name_index.get(normalized, ())
        ids: set[int] = set(exact)
        if not ids:
            ids = {
                unitid
                for name, values in self._snapshot.name_index.items()
                if normalized in name or name.startswith(normalized)
                for unitid in values
            }
        # A substring/prefix/abbreviation hit is already a strong, targeted
        # signal — the similarity ratio below is only a discovery mechanism
        # for the untargeted whole-catalog fallback, and must not re-filter
        # targeted hits (e.g. "Yale" vs "Yale University" scores well under
        # the threshold purely from length, despite being an exact match).
        targeted = bool(ids)
        pool = ids or set(self._snapshot.schools)
        scored: list[tuple[float, SchoolRecord]] = []
        for unitid in pool:
            record = self._snapshot.schools[unitid]
            score = max(
                SequenceMatcher(None, normalized, normalize_school_name(name)).ratio()
                for name in (record.basics.name, *record.aliases)
            )
            if targeted or score >= _FUZZY_MATCH_MIN_SCORE:
                scored.append((score, record))
        scored.sort(
            key=lambda pair: (
                not pair[1].is_main_campus,
                -pair[0],
                pair[1].basics.name,
                pair[1].basics.unitid,
            )
        )
        return tuple(record for _, record in scored[:5])
