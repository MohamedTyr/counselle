"""One crawl pass: discovery -> per-school 6-tab fetch -> mapper -> one
transaction per school -> `adapters/facts_store.py` (plan §4.1-§4.4, Unit E).

`run_crawl_pass` is called both by `app/facts/jobs.py`'s poller and by
`python -m app.facts --once` (one shared code path, appendix J-iii).
`run_remap_pass` is `python -m app.facts remap`'s identical mapper+SCD2
block over `school_pages.latest_snapshot_id`, no network, no `school_pages`
writes.

**Two running passes are impossible** (plan §3.4): a non-blocking
`pg_try_advisory_lock` is held on one dedicated connection for the pass's
whole duration; a worker that cannot take it stamps its own `facts_jobs`
claim `error`/`pass_already_running` and returns without ever touching the
`crawl_runs` row the original owner still holds.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal, cast

import asyncpg
import structlog

from adapters import facts_jobs_store, facts_store
from adapters.collegedata.fetch import (
    AllowedPathViolation,
    BuildIdNotFoundError,
    BuildIdRotationLimitExceeded,
    CollegeDataFetcher,
    FetchConfig,
    ResponseTooLargeError,
    RobotsDisallowedError,
    TooManyRateLimitBlocks,
    build_client,
)
from adapters.collegedata.parse import (
    ParsedPage,
    ParseError,
    content_hash,
    parse_page,
    snapshot_body,
)
from app.facts.explore_projection import (
    UnmappedControlError,
    ipeds_filter_columns,
    project_explore_row,
)
from app.facts.mapper import load_facts_keys, map_snapshot
from config.settings import Settings
from domain.facts.models import TAB_NAMES, TabName

logger = structlog.get_logger(__name__)

_ADVISORY_LOCK_KEY = "facts_crawl_pass"
# `TAB_NAMES` is `tuple[str, ...]` (it also mirrors the DB domain function,
# tests/domain/facts/test_tab_names.py pins it); this module needs the
# `TabName` Literal to index `dict[TabName, ...]`s below.
_TABS = cast("tuple[TabName, ...]", TAB_NAMES)


@dataclass
class _SchoolCounters:
    pages_fetched: int = 0
    pages_changed: int = 0
    pages_failed: int = 0
    facts_changed: int = 0
    unmapped: list[tuple[str, str]] = field(default_factory=list)  # (source_path, label)
    # One entry per page/mapper failure this school produced this pass
    # (e.g. "parse_error", "http_error", "mapper_error") -- the poison-pill
    # school's own failure(s), always recorded, never silently dropped
    # (Finding 1). Aggregated into `_PassCounters.failures_by_kind`, which
    # `close_run` writes to `crawl_runs.failures_by_kind` for the dashboard.
    failure_kinds: list[str] = field(default_factory=list)


@dataclass
class _PassCounters:
    schools_seen: int = 0
    pages_fetched: int = 0
    pages_changed: int = 0
    pages_failed: int = 0
    facts_changed: int = 0
    unmapped_samples: Counter[tuple[str, str]] = field(default_factory=Counter)
    failures_by_kind: Counter[str] = field(default_factory=Counter)

    def add(self, school: _SchoolCounters) -> None:
        self.schools_seen += 1
        self.pages_fetched += school.pages_fetched
        self.pages_changed += school.pages_changed
        self.pages_failed += school.pages_failed
        self.facts_changed += school.facts_changed
        self.unmapped_samples.update(school.unmapped)
        self.failures_by_kind.update(school.failure_kinds)


def _mapper_version() -> str:
    """sha256 prefix of `facts_keys.yaml`'s content (plan §4.4) — never
    hand-bumped. `load_facts_keys` reads the same `lru_cache`d asset, so
    this is a cheap re-hash of already-loaded bytes, not a second file read
    at steady state."""
    from config.settings import get_asset_settings

    path = get_asset_settings().assets_dir / "facts_keys.yaml"
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return digest[:12]


def _fetch_config(settings: Settings) -> FetchConfig:
    return FetchConfig(
        rps=settings.facts_crawl_rps,
        request_timeout_s=settings.facts_crawl_request_timeout_s,
        user_agent=settings.facts_crawl_user_agent,
        max_build_rotations=settings.facts_crawl_max_build_rotations,
        max_response_bytes=settings.facts_crawl_max_response_bytes,
    )


async def _write_school(
    conn: asyncpg.Connection,
    *,
    school_id: int,
    pages: Mapping[TabName, ParsedPage],
    changed_tabs: frozenset[TabName],
    snapshot_ids: Mapping[TabName, int],
    snapshot_sha256: Mapping[TabName, bytes],
    mapper_version: str,
    fallback_cycle_year: int | None,
) -> tuple[facts_store.FactsWriteResult, list[tuple[str, str]]]:
    """Map + SCD2-write + explore-row upsert, all inside the caller's
    per-school transaction (plan §4.2). Returns the write result and
    `(source_path, label)` for every unmapped fact this school produced
    this pass.

    `ipeds_filter_columns` is called (and allowed to raise
    `UnmappedControlError`) *before* any facts are written for this school:
    an unmapped `classification.control` must abort this school's write
    entirely (plan §5.3), never leave facts committed with no matching,
    honest explore row."""
    map_result = map_snapshot(pages, fallback_cycle_year=fallback_cycle_year)
    basic_profile = await facts_store.get_school_basic_profile(conn, school_id=school_id)
    ipeds_filter_columns(basic_profile)
    write_result = await facts_store.write_school_facts(
        conn,
        school_id=school_id,
        changed_tabs=tuple(changed_tabs),
        rows=map_result.facts,
        snapshot_ids=snapshot_ids,
        snapshot_sha256=snapshot_sha256,
        mapper_version=mapper_version,
    )
    current_facts = await facts_store.get_current_facts(conn, school_id=school_id)
    explore_values = project_explore_row(basic_profile, current_facts)
    await facts_store.upsert_explore_row(
        conn, school_id=school_id, values=explore_values, mapper_version=mapper_version
    )
    unmapped = [
        (row.source_path, row.label)
        for row in map_result.facts
        if row.fact_key.startswith("unmapped:")
    ]
    return write_result, unmapped


def _wrap_top_level(profile: Mapping[str, Any]) -> dict[str, Any]:
    """`parse_page` expects the raw `/_next/data/...json` shape
    (`{"pageProps": {"profile": ...}}`); `FetchedPage.profile` is already
    the extracted `profile` dict — this is the one-line adapter between
    Unit C's fetcher and Unit D's parser (see Unit E's final report)."""
    return {"pageProps": {"profile": profile}}


async def _process_school_live(
    fetcher: CollegeDataFetcher,
    pool: asyncpg.Pool,
    *,
    school_id: int,
    slug: str,
    settings: Settings,
    mapper_version: str,
) -> _SchoolCounters:
    """Fetch all six tabs at the paced rate, then one transaction (plan
    §4.2).

    Finding 1 (school-data-v3 fix review) drew the per-school-vs-pass-fatal
    line at the exception's *cause*, not merely "did it come out of
    `fetch_tab`": a cause specific to this one school (a delisted slug, one
    oversized response) is recorded as a page failure and this school is
    skipped, same as the pre-existing mapper/parser guard below; a cause
    that means the crawler can no longer trust its own request construction
    or the site's live permission grant is raised to the caller, which
    closes the whole pass as `aborted` (`_run_crawl_pass_locked`) rather
    than burning through the remaining schools one poisoned request at a
    time:

    - `ResponseTooLargeError` (one adversarial/malformed response for this
      slug/tab) and `BuildIdNotFoundError` (raised via `fetch_tab` ->
      `_handle_not_found`'s rotation-confirmation re-fetch of *this slug's
      own* HTML college-search page, when that page has vanished — one
      school's data going missing, not a site-wide signal) are per-school:
      caught here, recorded as an `http_error` page failure, this school's
      loop continues to its next tab.
    - `RobotsDisallowedError` (the live document has withdrawn permission
      for a path every school's crawl depends on) and `AllowedPathViolation`
      (this module's own URL construction produced a `/api/*` path — a
      construction-time invariant broken for every future call, not this
      school's data) are pass-fatal: left to propagate, caught by
      `_run_crawl_pass_locked`, closed via `_abort_pass`.
    - `BuildIdRotationLimitExceeded`/`TooManyRateLimitBlocks` (already
      pass-fatal, unchanged by this finding) also propagate to the same
      `_run_crawl_pass_locked` handler.

    A single tab whose fetched JSON does not parse into the typed shape
    (`ParseError`) or whose profile carries a non-finite float (`content_hash`'s
    own `ValueError`) is recorded as a `parse_error` page failure — same as
    an ordinary fetch failure — rather than raised past this school."""
    counters = _SchoolCounters()
    pages: dict[TabName, ParsedPage] = {}
    changed_tabs: set[TabName] = set()
    snapshot_ids: dict[TabName, int] = {}
    snapshot_sha256: dict[TabName, bytes] = {}
    outcomes: list[tuple[TabName, Any, bytes | None, str]] = []

    for tab in _TABS:
        try:
            fetched = await fetcher.fetch_tab(slug, tab)
        except (ResponseTooLargeError, BuildIdNotFoundError):
            # Per-school fetch failure (see the docstring's classification)
            # -- record and move on to this school's next tab, never raise
            # past this school.
            logger.warning(
                "facts_crawl_fetch_failed",
                school_id=school_id,
                slug=slug,
                tab=tab,
                exc_info=True,
            )
            counters.pages_fetched += 1
            counters.pages_failed += 1
            counters.failure_kinds.append("fetch_error")
            outcomes.append((tab, None, None, "http_error"))
            continue
        counters.pages_fetched += 1
        if fetched.page_status != "ok":
            outcomes.append((tab, fetched, None, fetched.page_status))
            counters.pages_failed += 1
            counters.failure_kinds.append(fetched.page_status)
            continue
        assert fetched.profile is not None
        try:
            sha = content_hash(fetched.profile)
            parsed = parse_page(tab, _wrap_top_level(fetched.profile))
        except (ParseError, ValueError):
            logger.warning(
                "facts_crawl_page_shape_failed",
                school_id=school_id,
                slug=slug,
                tab=tab,
                exc_info=True,
            )
            outcomes.append((tab, fetched, None, "parse_error"))
            counters.pages_failed += 1
            counters.failure_kinds.append("parse_error")
            continue
        outcomes.append((tab, fetched, sha, "ok"))
        pages[tab] = parsed

    async with pool.acquire() as conn, conn.transaction():
        for tab, fetched, new_sha, status in outcomes:
            if new_sha is None:
                await facts_store.record_page_failure(
                    conn, school_id=school_id, tab=tab, status=status
                )
                continue
            current_sha = await facts_store.get_current_page_hash(
                conn, school_id=school_id, tab=tab
            )
            if current_sha == new_sha:
                await facts_store.record_page_unchanged(conn, school_id=school_id, tab=tab)
                continue
            result = await facts_store.record_page_changed(
                conn,
                school_id=school_id,
                tab=tab,
                http_status=fetched.http_status,
                build_id=fetched.build_id,
                content_sha256=new_sha,
                body=snapshot_body(fetched.profile),
                retention_per_page=settings.facts_snapshot_retention_per_page,
            )
            changed_tabs.add(tab)
            snapshot_ids[tab] = result.snapshot_id
            snapshot_sha256[tab] = new_sha
            counters.pages_changed += 1

        if changed_tabs:
            fallback_year = None
            if "admission" not in pages:
                fallback_year = await facts_store.get_stored_deadline_year(
                    conn, school_id=school_id
                )
            # A shape the mapper cannot handle (an unhandled-length header/body
            # array, a sentence regex that never matches, ...) must skip and
            # record this school, never take down the pass (Finding 1's
            # poison-pill livelock). The page writes above still commit --
            # `last_attempted_at` for every tab is already bumped, so this
            # school is not reselected by `schools_pending_this_run` within
            # this same pass; only its facts for this pass are skipped.
            try:
                write_result, unmapped = await _write_school(
                    conn,
                    school_id=school_id,
                    pages=pages,
                    changed_tabs=frozenset(changed_tabs),
                    snapshot_ids=snapshot_ids,
                    snapshot_sha256=snapshot_sha256,
                    mapper_version=mapper_version,
                    fallback_cycle_year=fallback_year,
                )
                counters.facts_changed = write_result.inserted + write_result.closed_withdrawn
                counters.unmapped = unmapped
            except UnmappedControlError as exc:
                # Not a mapper crash -- a genuinely unmapped IPEDS value.
                # No facts were written for this school (the check runs
                # before any write, plan §5.3); surfaced only via the
                # dashboard's unmapped labels, same as an unmapped fact key.
                logger.warning(
                    "facts_crawl_unmapped_control",
                    school_id=school_id,
                    slug=slug,
                    label=exc.label,
                )
                counters.unmapped = [(exc.source_path, exc.label)]
            except Exception:
                logger.exception(
                    "facts_crawl_mapper_failed", school_id=school_id, slug=slug
                )
                counters.failure_kinds.append("mapper_error")

    return counters


async def _fetch_all_bodies(
    conn: asyncpg.Connection, *, school_id: int
) -> dict[TabName, tuple[Mapping[str, Any], bytes]]:
    rows = await conn.fetch(
        """
        SELECT sp.tab, ps.body, ps.content_sha256
        FROM cds_library.school_pages sp
        JOIN cds_library.page_snapshots ps ON ps.id = sp.latest_snapshot_id
        WHERE sp.school_id = $1
        """,
        school_id,
    )
    def _body(row: asyncpg.Record) -> Mapping[str, Any]:
        raw = row["body"]
        parsed: Mapping[str, Any] = json.loads(raw) if isinstance(raw, str) else raw
        return parsed

    return {row["tab"]: (_body(row), row["content_sha256"]) for row in rows}


async def _process_school_remap(
    pool: asyncpg.Pool, *, school_id: int, mapper_version: str
) -> _SchoolCounters:
    """`python -m app.facts remap` (plan §4.2/appendix J-iv): the identical
    mapper+SCD2 block over `school_pages.latest_snapshot_id`, no network,
    `changed_tabs = all six tabs with a stored snapshot`.

    Same poison-pill guard as `_process_school_live` (Finding 1): a stored
    body that no longer parses under the current typed shape, or a shape
    the mapper can't handle, is recorded and skipped rather than raised
    past this school."""
    counters = _SchoolCounters()
    async with pool.acquire() as conn, conn.transaction():
        bodies = await _fetch_all_bodies(conn, school_id=school_id)
        if not bodies:
            return counters
        pages: dict[TabName, ParsedPage] = {}
        for tab, (body, _sha) in bodies.items():
            try:
                pages[tab] = parse_page(tab, _wrap_top_level(body))
            except (ParseError, ValueError):
                logger.warning(
                    "facts_remap_page_shape_failed", school_id=school_id, tab=tab, exc_info=True
                )
                counters.failure_kinds.append("parse_error")
        if not pages:
            return counters
        snapshot_ids: dict[TabName, int] = {}
        snapshot_id_rows = await conn.fetch(
            "SELECT tab, latest_snapshot_id FROM cds_library.school_pages WHERE school_id = $1",
            school_id,
        )
        for row in snapshot_id_rows:
            if row["latest_snapshot_id"] is not None:
                snapshot_ids[row["tab"]] = row["latest_snapshot_id"]
        snapshot_sha256 = {tab: sha for tab, (_body, sha) in bodies.items() if tab in pages}
        try:
            write_result, unmapped = await _write_school(
                conn,
                school_id=school_id,
                pages=pages,
                changed_tabs=frozenset(pages.keys()),
                snapshot_ids=snapshot_ids,
                snapshot_sha256=snapshot_sha256,
                mapper_version=mapper_version,
                fallback_cycle_year=None,
            )
            counters.facts_changed = write_result.inserted + write_result.closed_withdrawn
            counters.unmapped = unmapped
        except UnmappedControlError as exc:
            logger.warning(
                "facts_remap_unmapped_control", school_id=school_id, label=exc.label
            )
            counters.unmapped = [(exc.source_path, exc.label)]
        except Exception:
            logger.exception("facts_remap_mapper_failed", school_id=school_id)
            counters.failure_kinds.append("mapper_error")
    return counters


def _unmapped_sample(
    samples: Counter[tuple[str, str]], *, limit: int
) -> list[dict[str, Any]]:
    ranked = samples.most_common(limit)
    return [
        {"source_path": source_path, "label": label, "schools": count}
        for (source_path, label), count in ranked
    ]


async def _abort_pass(
    pool: asyncpg.Pool,
    *,
    run_id: int,
    job_id: int,
    claimed_started_at: datetime,
    error_code: str,
    error_message: str,
    fetcher: CollegeDataFetcher,
) -> None:
    async with pool.acquire() as conn, conn.transaction():
        await facts_jobs_store.close_run(
            conn,
            run_id=run_id,
            status="aborted",
            build_id=fetcher.build_id,
            build_id_rotations=fetcher.build_id_rotations,
            rate_backoffs=fetcher.rate_backoffs,
            error_code=error_code,
            error_message=error_message,
        )
        await facts_jobs_store.complete_job(
            conn,
            job_id=job_id,
            claimed_started_at=claimed_started_at,
            status="error",
            error_code=error_code,
            error_message=error_message,
        )
    logger.error("facts_crawl_pass_aborted", error_code=error_code, error_message=error_message)


async def run_crawl_pass(
    pool: asyncpg.Pool,
    settings: Settings,
    *,
    job_id: int,
    claimed_started_at: datetime,
    limit: int | None = None,
) -> None:
    """The live crawl pass. Shared by the poller and `--once` (appendix
    J-iii: "no second code path"). `limit` (CLI-only, plan deliverable 16 —
    "`--once [--limit N]`") caps how many pending schools this call
    processes, for proving the machinery on a small slice without a full
    crawl. `claimed_started_at` is the `started_at` this caller's own
    `claim_next_job` call returned -- threaded into every `complete_job`
    call so a worker whose claim was superseded by a sweep-and-reclaim can
    never stamp a status onto a claim it no longer holds (Finding 3)."""
    async with pool.acquire() as conn:
        run = await facts_jobs_store.get_or_open_run(conn, job_id=job_id)

    lock_conn = await pool.acquire()
    try:
        got_lock = await lock_conn.fetchval(
            "SELECT pg_try_advisory_lock(hashtext($1))", _ADVISORY_LOCK_KEY
        )
        if not got_lock:
            # The narrow reachable contention path (plan §3.4): a sweep
            # re-queued this job while its original worker is still alive.
            # Stamp only this claim's own job row -- never crawl_runs, which
            # the original worker still owns and will close itself.
            async with pool.acquire() as conn:
                await facts_jobs_store.complete_job(
                    conn,
                    job_id=job_id,
                    claimed_started_at=claimed_started_at,
                    status="error",
                    error_code="pass_already_running",
                )
            return
        await _run_crawl_pass_locked(
            pool,
            settings,
            job_id=job_id,
            claimed_started_at=claimed_started_at,
            run=run,
            limit=limit,
        )
    finally:
        await lock_conn.execute("SELECT pg_advisory_unlock(hashtext($1))", _ADVISORY_LOCK_KEY)
        await pool.release(lock_conn)


async def _run_crawl_pass_locked(
    pool: asyncpg.Pool,
    settings: Settings,
    *,
    job_id: int,
    claimed_started_at: datetime,
    run: facts_jobs_store.CrawlRunRecord,
    limit: int | None = None,
) -> None:
    load_facts_keys()  # fail fast on a broken facts_keys.yaml before any network I/O
    mapper_version = _mapper_version()
    config = _fetch_config(settings)
    client = build_client(config)
    fetcher = CollegeDataFetcher(config, client)
    totals = _PassCounters()
    try:
        slugs = await fetcher.discover_slugs()
        async with pool.acquire() as conn:
            previous_started_at = await facts_store.previous_run_started_at(
                conn, exclude_run_id=run.id
            )
            await facts_store.touch_seen_slugs(conn, slugs=slugs)
            await facts_store.insert_unmatched_slugs(conn, slugs=slugs)
        if slugs:
            await fetcher.resolve_build_id(slugs[0])

        pending = await facts_jobs_store.schools_pending_this_run(
            pool, run_started_at=run.started_at
        )
        if limit is not None:
            pending = pending[:limit]
        for school_id, slug in pending:
            school_counters = await _process_school_live(
                fetcher,
                pool,
                school_id=school_id,
                slug=slug,
                settings=settings,
                mapper_version=mapper_version,
            )
            totals.add(school_counters)
            async with pool.acquire() as conn, conn.transaction():
                await facts_jobs_store.bump_run_counters(
                    conn,
                    run_id=run.id,
                    pages_fetched=school_counters.pages_fetched,
                    pages_changed=school_counters.pages_changed,
                    pages_failed=school_counters.pages_failed,
                    facts_changed=school_counters.facts_changed,
                    schools_seen=1,
                )
    except (
        BuildIdRotationLimitExceeded,
        TooManyRateLimitBlocks,
        RobotsDisallowedError,
        AllowedPathViolation,
    ) as exc:
        # Pass-fatal exceptions only (Finding 1's classification, docstring
        # on `_process_school_live`) -- a per-school fetch failure
        # (`ResponseTooLargeError`/`BuildIdNotFoundError`) never reaches
        # here, it's caught and recorded inside that per-school call.
        if isinstance(exc, BuildIdRotationLimitExceeded):
            error_code = "build_id_rotation_limit"
        elif isinstance(exc, TooManyRateLimitBlocks):
            error_code = "blocked"
        elif isinstance(exc, RobotsDisallowedError):
            error_code = "robots_disallowed"
        else:
            error_code = "allowed_path_violation"
        await _abort_pass(
            pool,
            run_id=run.id,
            job_id=job_id,
            claimed_started_at=claimed_started_at,
            error_code=error_code,
            error_message=str(exc),
            fetcher=fetcher,
        )
        return
    finally:
        await client.aclose()

    async with pool.acquire() as conn, conn.transaction():
        await facts_store.rewrite_fact_coverage_counts(conn)
        if previous_started_at is not None:
            await facts_store.retire_absent_slugs(
                conn,
                previous_run_started_at=previous_started_at,
                max_fraction=settings.facts_retirement_max_fraction,
                min_floor=settings.facts_retirement_min_floor,
            )
        status: Literal["succeeded", "partial"] = (
            "partial" if totals.pages_failed > 0 or totals.failures_by_kind else "succeeded"
        )
        await facts_jobs_store.close_run(
            conn,
            run_id=run.id,
            status=status,
            build_id=fetcher.build_id,
            build_id_rotations=fetcher.build_id_rotations,
            rate_backoffs=fetcher.rate_backoffs,
            sitemap_slugs=len(slugs),
            crosswalk_matched=len(pending),
            failures_by_kind=dict(totals.failures_by_kind),
            unmapped_label_count=len(totals.unmapped_samples),
            unmapped_labels=_unmapped_sample(
                totals.unmapped_samples, limit=settings.facts_admin_unmapped_limit
            ),
        )
        await facts_jobs_store.complete_job(
            conn, job_id=job_id, claimed_started_at=claimed_started_at, status="done"
        )
    if len(totals.unmapped_samples) > settings.facts_unmapped_alert_threshold:
        logger.error(
            "facts_crawl_shape_drift",
            unmapped_label_count=len(totals.unmapped_samples),
            threshold=settings.facts_unmapped_alert_threshold,
        )
    logger.info(
        "facts_crawl_pass_finished",
        run_id=run.id,
        schools_seen=totals.schools_seen,
        pages_fetched=totals.pages_fetched,
        pages_changed=totals.pages_changed,
        pages_failed=totals.pages_failed,
        facts_changed=totals.facts_changed,
        status=status,
    )


async def run_remap_pass(
    pool: asyncpg.Pool, settings: Settings, *, job_id: int, claimed_started_at: datetime
) -> None:
    """`python -m app.facts remap` (plan §4.2): no network, no
    `school_pages` writes, over every crosswalk-matched school."""
    async with pool.acquire() as conn:
        run = await facts_jobs_store.get_or_open_run(conn, job_id=job_id)
    load_facts_keys()
    mapper_version = _mapper_version()
    totals = _PassCounters()
    schools = await pool.fetch(
        """
        SELECT school_id FROM cds_library.collegedata_schools
        WHERE retired_at IS NULL AND school_id IS NOT NULL
        ORDER BY school_id
        """
    )
    for row in schools:
        school_counters = await _process_school_remap(
            pool, school_id=row["school_id"], mapper_version=mapper_version
        )
        totals.add(school_counters)

    async with pool.acquire() as conn, conn.transaction():
        await facts_store.rewrite_fact_coverage_counts(conn)
        await facts_jobs_store.close_run(
            conn,
            run_id=run.id,
            status="succeeded",
            failures_by_kind=dict(totals.failures_by_kind),
            unmapped_label_count=len(totals.unmapped_samples),
            unmapped_labels=_unmapped_sample(
                totals.unmapped_samples, limit=settings.facts_admin_unmapped_limit
            ),
        )
        await facts_jobs_store.complete_job(
            conn, job_id=job_id, claimed_started_at=claimed_started_at, status="done"
        )
    logger.info(
        "facts_remap_pass_finished",
        run_id=run.id,
        schools_seen=totals.schools_seen,
        facts_changed=totals.facts_changed,
    )
