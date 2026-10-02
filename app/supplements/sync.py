"""One sync pass: read the source page, store what changed (ADR-less; see 0022).

The pass is the whole feature's data path — the CLI and the daily worker both
call :func:`run_sync`. A school is re-read by the model only when its source
block's hash changes (or ``force``), so an unchanged page costs one HTTP
request and no model calls, and the model's run-to-run variance can never
churn a school's prompts on its own.

Never destructive on failure: a page that cannot be read or parsed, or a block
the model cannot read, leaves the stored prompts exactly as they were.
"""

from __future__ import annotations

import asyncio
import csv
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import asyncpg
import structlog
import yaml

from adapters import supplements_store as store
from adapters.supplements_source import (
    SourceBlock,
    fetch_source_html,
    parse_cycle_blocks,
)
from app.supplements.extract import ExtractionFailed, extract_block
from domain.supplements import RejectedPrompt, SupplementPrompt, block_hash, prompts_hash

logger = structlog.get_logger(__name__)

_CONFIG = Path(__file__).resolve().parents[2] / "config" / "supplements"
#: Source blocks that are not one school's supplements.
_COMMON_APP_HEADING = "Common Application Essays"
_NONE_HEADING = "Colleges Without Supplemental Essays"


@dataclass
class SyncReport:
    unchanged: int = 0
    updated: list[str] = field(default_factory=list)
    failed: list[str] = field(default_factory=list)
    unmapped: list[str] = field(default_factory=list)
    stale_reviews: list[str] = field(default_factory=list)
    rejected: dict[str, list[RejectedPrompt]] = field(default_factory=dict)


@dataclass(frozen=True)
class _Review:
    checked: str
    checked_on: date | None
    corrections: list[dict[str, Any]]
    block_sha256: str | None
    #: "none" when a reviewer found the block holds no prompt to write
    #: (e.g. only an optional upload of past work).
    status: str | None


async def run_sync(pool: asyncpg.Pool, settings: Any, *, force: bool = False) -> SyncReport:
    cycle = settings.supplements_cycle
    page = await fetch_source_html(
        settings.supplements_source_url, user_agent=settings.supplements_user_agent
    )
    blocks = parse_cycle_blocks(page, cycle)
    school_map = load_school_map()
    reviews = load_reviews()
    stored = await store.load_schools(pool, cycle)
    report = SyncReport()

    by_heading = {b.heading: b for b in blocks if b.heading != _COMMON_APP_HEADING}
    none_block = by_heading.pop(_NONE_HEADING, None)
    report.unmapped = [h for h in by_heading if h not in school_map]

    semaphore = asyncio.Semaphore(settings.supplements_extract_concurrency)

    async def one(block: SourceBlock) -> None:
        async with semaphore:
            try:
                await _sync_block(
                    pool,
                    settings,
                    block,
                    school_map[block.heading],
                    stored,
                    reviews.get(block.heading),
                    report,
                    force=force,
                )
            except asyncpg.PostgresError:
                # One school's bad row must not stop the others; its old row stays.
                logger.exception("supplements_save_failed", heading=block.heading)
                report.failed.append(block.heading)

    await asyncio.gather(*(one(b) for b in by_heading.values() if b.heading in school_map))
    if none_block is not None:
        await _sync_none_list(
            pool, settings, none_block, school_map, by_heading, stored, reviews, report
        )
    logger.info(
        "supplements_sync_done",
        unchanged=report.unchanged,
        updated=len(report.updated),
        failed=report.failed,
        unmapped=report.unmapped,
        stale_reviews=report.stale_reviews,
    )
    return report


async def _sync_block(
    pool: asyncpg.Pool,
    settings: Any,
    block: SourceBlock,
    unitids: list[int],
    stored: dict[int, store.StoredSchool],
    review: _Review | None,
    report: SyncReport,
    *,
    force: bool,
) -> None:
    cycle = settings.supplements_cycle
    digest = block_hash(block.text)
    review = _current_review(review, digest, block.heading, report)
    previous = [stored.get(u) for u in unitids]
    unchanged_block = all(p is not None and p.block_sha256 == digest for p in previous)

    if review and review.status == "none":
        prompts = []
    elif unchanged_block and not force:
        prompts = await store.load_prompts(pool, cycle, unitids[0])
    else:
        try:
            prompts, rejected = await extract_block(settings, block.heading, block.text)
        except ExtractionFailed:
            report.failed.append(block.heading)
            return
        if rejected:
            report.rejected[block.heading] = rejected
        if not prompts:
            # A block with nothing verifiable is a failed read, never "no supplements".
            report.failed.append(block.heading)
            return

    prompts = _apply_corrections(prompts, review)
    checked, checked_on = (review.checked, review.checked_on) if review else ("unchecked", None)
    digest_prompts = prompts_hash(prompts)
    for unitid, before in zip(unitids, previous, strict=True):
        row = store.SchoolRow(
            unitid=unitid,
            status="prompts" if prompts else "none",
            source_url=settings.supplements_source_url,
            source_heading=block.heading,
            block_sha256=digest,
            prompts_sha256=digest_prompts,
            checked=checked,
            checked_on=checked_on,
            prompts=prompts,
        )
        if before and (before.block_sha256, before.prompts_sha256, before.checked) == (
            digest,
            digest_prompts,
            checked,
        ):
            report.unchanged += 1
            await store.mark_observed(pool, cycle, [unitid])
            continue
        changed = before is None or before.prompts_sha256 != digest_prompts
        await store.save_school(pool, cycle, row, changed=changed)
        report.updated.append(block.heading)


async def _sync_none_list(
    pool: asyncpg.Pool,
    settings: Any,
    block: SourceBlock,
    school_map: dict[str, list[int]],
    with_blocks: dict[str, SourceBlock],
    stored: dict[int, store.StoredSchool],
    reviews: dict[str, _Review],
    report: SyncReport,
) -> None:
    """Schools the source lists as having no supplements.

    A school that also has its own block (e.g. program-only prompts) keeps the
    block: "no general supplement" is not "nothing to write".
    """
    covered = {u for h in with_blocks for u in school_map.get(h, [])}
    for name in (line.strip() for line in block.text.splitlines()):
        if not name:
            continue
        if name not in school_map:
            report.unmapped.append(name)
            continue
        review = reviews.get(name)
        checked, checked_on = (review.checked, review.checked_on) if review else ("unchecked", None)
        for unitid in school_map[name]:
            if unitid in covered:
                continue
            before = stored.get(unitid)
            empty = prompts_hash([])
            if before and (before.status, before.prompts_sha256, before.checked) == (
                "none",
                empty,
                checked,
            ):
                report.unchanged += 1
                await store.mark_observed(pool, settings.supplements_cycle, [unitid])
                continue
            await store.save_school(
                pool,
                settings.supplements_cycle,
                store.SchoolRow(
                    unitid=unitid,
                    status="none",
                    source_url=settings.supplements_source_url,
                    source_heading=name,
                    block_sha256=None,
                    prompts_sha256=empty,
                    checked=checked,
                    checked_on=checked_on,
                    prompts=[],
                ),
                changed=before is None or before.prompts_sha256 != empty,
            )
            report.updated.append(name)


def _current_review(
    review: _Review | None, digest: str, heading: str, report: SyncReport
) -> _Review | None:
    """A review pinned to an older version of the block no longer applies."""
    if review and review.block_sha256 and not digest.startswith(review.block_sha256):
        report.stale_reviews.append(heading)
        return None
    return review


def _apply_corrections(
    prompts: list[SupplementPrompt], review: _Review | None
) -> list[SupplementPrompt]:
    if not review:
        return prompts
    corrected = []
    for prompt in prompts:
        fixes = [
            fix for fix in review.corrections if fix["match"].casefold() in prompt.prompt.casefold()
        ]
        if any(fix.get("drop") for fix in fixes):
            continue
        for fix in fixes:
            prompt = prompt.model_copy(update={k: v for k, v in fix.items() if k != "match"})
        corrected.append(prompt)
    return corrected


def load_school_map() -> dict[str, list[int]]:
    mapping: dict[str, list[int]] = defaultdict(list)
    with (_CONFIG / "icc_schools.csv").open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            mapping[row["heading"]].append(int(row["unitid"]))
    return dict(mapping)


def load_reviews() -> dict[str, _Review]:
    data = yaml.safe_load((_CONFIG / "reviews.yaml").read_text(encoding="utf-8"))
    return {
        heading: _Review(
            checked=entry["checked"],
            checked_on=entry.get("checked_on"),
            corrections=entry.get("corrections", []),
            block_sha256=entry.get("block_sha256"),
            status=entry.get("status"),
        )
        for heading, entry in (data.get("schools") or {}).items()
    }
