"""HTTP response models for the facts admin surface (plan appendix ii,
Unit E). `api/routes/admin_facts.py` (Unit F) serves these; this unit only
defines the shape and assembles it (`app/facts/service_admin.py`).

Reuses `counselle_db.models.FrozenModel` (`extra="forbid", frozen=True`) —
the one model-config convention this repo already has, per ADR 0017's
accepted `app/` -> `counselle_db` import direction.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from counselle_db.models import FrozenModel
from domain.facts.models import TabName

__all__ = [
    "CoverageCounts",
    "CrawlRunSummary",
    "CrawlStatus",
    "FactsStatusResponse",
    "TabFailure",
    "UnmappedLabel",
]

CrawlStatus = Literal["running", "succeeded", "partial", "failed", "aborted"]


class CrawlRunSummary(FrozenModel):
    id: int
    started_at: datetime
    finished_at: datetime | None
    duration_s: float | None
    status: CrawlStatus
    error_code: str | None = None
    error_message: str | None = None
    build_id: str | None = None
    build_id_rotations: int = 0
    schools_seen: int = 0
    pages_fetched: int = 0
    pages_changed: int = 0
    pages_failed: int = 0
    facts_changed: int = 0
    unmapped_label_count: int = 0


class TabFailure(FrozenModel):
    tab: TabName
    status: str
    count: int


class UnmappedLabel(FrozenModel):
    source_path: str
    label: str
    schools: int


class CoverageCounts(FrozenModel):
    sitemap_slugs: int | None
    crosswalk_matched: int
    crosswalk_unmatched: int
    schools_total: int
    schools_with_facts: int


class FactsStatusResponse(FrozenModel):
    last_run: CrawlRunSummary | None
    next_run_at: datetime | None
    worker_enabled: bool
    queued_or_running: bool
    coverage: CoverageCounts
    tab_failures: tuple[TabFailure, ...]
    unmapped_labels: tuple[UnmappedLabel, ...]
    unmapped_labels_truncated: bool
    history: tuple[CrawlRunSummary, ...]
