"""Atomic, immutable catalog snapshot for the five-view reader contract."""

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
from pydantic import BaseModel, ConfigDict

from config.settings import get_db_child_settings
from counselle_db.models import SchoolBasics, ServiceError
from counselle_db.packets import (
    ManifestDomain,
    ManifestMetric,
    ManifestSnapshot,
    compile_manifest,
    hex_digest,
)

# Local seam retained for focused catalog tests.
get_settings = get_db_child_settings

logger = structlog.get_logger(__name__)


def _freeze(value: Any) -> Any:
    """Recursively freeze JSON-shaped snapshot state, not only its outer mapping."""
    if isinstance(value, dict):
        return MappingProxyType({key: _freeze(child) for key, child in value.items()})
    if isinstance(value, list | tuple):
        return tuple(_freeze(child) for child in value)
    return value


class CalendarEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    source: str
    vintage: str
    cutoff_note: str


_MANIFEST_SQL = """SELECT version,content_sha256,content,domain_hashes,published_at,
 extractor_contract_version,is_current
 FROM cds_library.cds_manifest_snapshots ORDER BY published_at"""
_PROFILES_SQL = """SELECT id,name,aliases,city,state,search_name,official_domain,is_main_campus,
 basic_profile,profile_version,profile_snapshot_date,profile_sha256
 FROM cds_library.school_profiles ORDER BY id"""
_COVERAGE_SQL = """WITH selected_documents AS (
 SELECT DISTINCT ON (school_id) * FROM cds_library.active_cds_documents
 ORDER BY school_id,academic_year DESC,document_id DESC)
 SELECT d.school_id,d.academic_year,d.document_id,d.currentness,d.staleness_reason,
 d.latest_extraction_status,d.latest_error_code,p.domain_id,p.accepted_packet_status
 FROM selected_documents d LEFT JOIN cds_library.active_cds_domain_packets p
 ON p.school_id=d.school_id AND p.document_id=d.document_id"""


def normalize_school_name(value: str) -> str:
    value = value.casefold().replace("&", " and ")
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value).split())


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
    current_version: str
    current_hash: str
    current_contract: str
    published_at: datetime
    manifests: Mapping[str, ManifestSnapshot]
    domains: tuple[ManifestDomain, ...]
    metrics: Mapping[str, ManifestMetric]
    total_metrics: int
    domain_counts: Mapping[str, int]
    schools: Mapping[int, SchoolRecord]
    name_index: Mapping[str, tuple[int, ...]]
    profile_groups: tuple[str, ...]
    profile_snapshot_min: date
    profile_snapshot_max: date
    coverage: Mapping[int, Mapping[str, Any]]
    coverage_aggregates: Mapping[str, Any]


class Catalog:
    def __init__(self, pool: asyncpg.Pool, snapshot: CatalogSnapshot):
        self.pool = pool
        self._snapshot = snapshot
        self._last_attempt = snapshot.refreshed_at

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
    async def load(cls, pool: asyncpg.Pool) -> Catalog:
        return cls(pool, await cls._load_snapshot(pool))

    @staticmethod
    async def _load_snapshot(pool: asyncpg.Pool) -> CatalogSnapshot:
        async with (
            pool.acquire() as conn,
            conn.transaction(isolation="repeatable_read", readonly=True),
        ):
            manifest_rows = await conn.fetch(_MANIFEST_SQL)
            profile_rows = await conn.fetch(_PROFILES_SQL)
            coverage_rows = await conn.fetch(_COVERAGE_SQL)
            now = datetime.now(UTC)
        if not profile_rows:
            raise ServiceError("The school profile catalog is empty.")
        current_rows = [row for row in manifest_rows if row["is_current"]]
        if len(current_rows) != 1:
            raise ServiceError("The CDS catalog must have exactly one current manifest.")
        manifests: dict[str, ManifestSnapshot] = {}
        for row in manifest_rows:
            content = row["content"]
            root_version = content.get("root", {}).get("version")
            if (
                root_version != row["version"]
                or row["version"] in manifests
                or len(bytes(row["content_sha256"])) != 32
                or not row["extractor_contract_version"]
            ):
                raise ServiceError("Manifest snapshot identity is inconsistent.")
            manifests[row["version"]] = compile_manifest(
                row["version"], content, row["domain_hashes"]
            )
        current_row = current_rows[0]
        current = manifests[current_row["version"]]
        metrics = {metric.ref: metric for domain in current.domains for metric in domain.metrics}
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
        coverage: dict[int, dict[str, Any]] = {}
        for row in coverage_rows:
            existing = coverage.get(row["school_id"])
            if existing is not None and existing["document_id"] != row["document_id"]:
                raise ServiceError("Selected-document coverage contains duplicate schools.")
            item = coverage.setdefault(
                row["school_id"],
                {
                    "academic_year": row["academic_year"],
                    "document_id": row["document_id"],
                    "currentness": row["currentness"],
                    "staleness_reason": row["staleness_reason"],
                    "latest_status": row["latest_extraction_status"],
                    "latest_error_code": row["latest_error_code"],
                    "domains": [],
                    "partials": 0,
                },
            )
            if row["accepted_packet_status"]:
                item["domains"].append(row["domain_id"])
                item["partials"] += row["accepted_packet_status"] == "partial"
        order = {domain.id: index for index, domain in enumerate(current.domains)}
        for item in coverage.values():
            item["domains"].sort(key=lambda domain: order.get(domain, 10**9))
        covered = sum(bool(item["domains"]) for item in coverage.values())
        fully = sum(
            len(item["domains"]) == len(current.domains) and item["partials"] == 0
            for item in coverage.values()
        )
        by_year: dict[int, int] = {}
        stale = 0
        for item in coverage.values():
            if item["domains"]:
                by_year[item["academic_year"]] = by_year.get(item["academic_year"], 0) + 1
                stale += item["currentness"] == "stale"
        return CatalogSnapshot(
            refreshed_at=now,
            current_version=current.version,
            current_hash=hex_digest(current_row["content_sha256"]),
            current_contract=current_row["extractor_contract_version"],
            published_at=current_row["published_at"],
            manifests=MappingProxyType(manifests),
            domains=current.domains,
            metrics=MappingProxyType(metrics),
            total_metrics=len(metrics),
            domain_counts=MappingProxyType({d.id: len(d.metrics) for d in current.domains}),
            schools=MappingProxyType(schools),
            name_index=MappingProxyType({k: tuple(v) for k, v in names.items()}),
            profile_groups=tuple(sorted(groups)),
            profile_snapshot_min=min(dates),
            profile_snapshot_max=max(dates),
            coverage=_freeze(coverage),
            coverage_aggregates=_freeze(
                {
                    "covered": covered,
                    "fully": fully,
                    "partial": covered - fully,
                    "stale": stale,
                    "by_year": by_year,
                }
            ),
        )

    async def maybe_refresh(self, *, force: bool = False) -> CatalogSnapshot:
        cadence = timedelta(seconds=get_settings().data_catalog_refresh_seconds)
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

    async def domain(self, domain_id: str) -> ManifestDomain:
        match = next((d for d in self._snapshot.domains if d.id == domain_id), None)
        if match is None:
            await self.maybe_refresh(force=True)
            match = next((d for d in self._snapshot.domains if d.id == domain_id), None)
        if match is None:
            valid = ", ".join(d.id for d in self._snapshot.domains)
            raise ServiceError(f"Unknown CDS domain. Valid domains: {valid}")
        return match

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
        exact = self._snapshot.name_index.get(normalized, ())
        ids: set[int] = set(exact)
        if not ids:
            ids = {
                unitid
                for name, values in self._snapshot.name_index.items()
                if normalized in name or name.startswith(normalized)
                for unitid in values
            }
        scored: list[tuple[float, SchoolRecord]] = []
        pool = ids or set(self._snapshot.schools)
        for unitid in pool:
            record = self._snapshot.schools[unitid]
            score = max(
                SequenceMatcher(None, normalized, normalize_school_name(name)).ratio()
                for name in (record.basics.name, *record.aliases)
            )
            if score >= 0.55:
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
