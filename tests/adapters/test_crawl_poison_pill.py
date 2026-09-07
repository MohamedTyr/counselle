"""`live_db` exit tests for the Finding 1 poison-pill fix (plan §4.2, Unit E):
a single school whose page shape breaks the mapper, or whose body breaks the
typed parser, must be recorded and skipped -- the pass itself must still
reach `close_run`/`complete_job` and process every other school. Before this
fix, either failure escaped `_process_school_live` uncaught, propagated
through `run_crawl_pass` to the poller's catch-all, and left the job/run rows
stuck `running` forever (the livelock this pins against a regression).

Reuses `tests/adapters/conftest.py`'s `pipeline_pool`/`admin_pool` fixtures
(the exact roles `app/facts/crawl.py` writes through) and drives the real
`run_crawl_pass` end to end -- only the network fetcher and the pending-
schools list are faked, so the transaction/lock/close_run/complete_job
machinery is exercised for real, exactly as the poller runs it.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

import asyncpg
import pytest

from adapters import facts_jobs_store
from adapters.collegedata.fetch import (
    BuildIdNotFoundError,
    FetchedPage,
    ResponseTooLargeError,
    RobotsDisallowedError,
)
from app.facts import crawl
from app.facts.mapper import map_snapshot as _real_map_snapshot
from config.settings import get_settings
from domain.facts.models import TAB_NAMES, TabName
from domain.facts.normalize import NormalizeError

pytestmark = pytest.mark.live_db

_TABS = cast("tuple[TabName, ...]", TAB_NAMES)
_FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "collegedata" / "Berea-College"


def _load_fixture_profiles() -> dict[TabName, dict[str, Any]]:
    """One real, known-good fixture body per tab (reused verbatim for every
    fake school here) -- guarantees `parse_page` succeeds unless a test
    deliberately corrupts it."""
    profiles: dict[TabName, dict[str, Any]] = {}
    for tab in _TABS:
        top_level = json.loads((_FIXTURE_DIR / f"{tab}.json").read_text(encoding="utf-8"))
        profiles[tab] = top_level["pageProps"]["profile"]
    return profiles


async def _wipe_schools(pool: asyncpg.Pool, school_ids: list[int]) -> None:
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute("DELETE FROM cds_library.crawl_runs")
        await conn.execute("DELETE FROM cds_library.facts_jobs")
        await conn.execute(
            "DELETE FROM cds_library.school_facts WHERE school_id = ANY($1::int[])", school_ids
        )
        await conn.execute(
            "DELETE FROM cds_library.school_explore_rows WHERE school_id = ANY($1::int[])",
            school_ids,
        )
        # `school_pages.latest_snapshot_id` FK-references `page_snapshots.id`
        # -- clear the referencing row before the referenced one.
        await conn.execute(
            "DELETE FROM cds_library.school_pages WHERE school_id = ANY($1::int[])", school_ids
        )
        await conn.execute(
            "DELETE FROM cds_library.page_snapshots WHERE school_id = ANY($1::int[])", school_ids
        )


async def _pick_two_pristine_schools(pool: asyncpg.Pool) -> list[tuple[int, str]]:
    """Two real, crosswalk-matched schools with **no** existing
    `school_pages` rows -- safe to overwrite and fully wipe in cleanup
    without needing to restore any prior real crawl data."""
    rows = await pool.fetch(
        """
        SELECT cs.school_id, cs.slug
        FROM cds_library.collegedata_schools cs
        WHERE cs.retired_at IS NULL AND cs.school_id IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM cds_library.school_pages sp WHERE sp.school_id = cs.school_id
          )
        ORDER BY cs.school_id
        LIMIT 2
        """
    )
    assert len(rows) == 2, "need two never-crawled schools in cds_library for this test"
    return [(row["school_id"], row["slug"]) for row in rows]


@pytest.fixture
async def two_schools(
    pipeline_pool: asyncpg.Pool, admin_pool: asyncpg.Pool
) -> AsyncIterator[list[tuple[int, str]]]:
    schools = await _pick_two_pristine_schools(pipeline_pool)
    school_ids = [school_id for school_id, _slug in schools]
    await _wipe_schools(admin_pool, school_ids)
    try:
        yield schools
    finally:
        await _wipe_schools(admin_pool, school_ids)


class _FakeFetcher:
    """Stands in for `CollegeDataFetcher`: serves canned `FetchedPage`s for
    exactly the two fake schools under test, no network."""

    def __init__(
        self,
        pages_by_slug: Mapping[str, Mapping[TabName, dict[str, Any]]],
        *,
        raise_for: Mapping[tuple[str, TabName], Exception] | None = None,
    ) -> None:
        self._pages_by_slug = pages_by_slug
        # (slug, tab) -> exception `fetch_tab` raises instead of returning a
        # `FetchedPage` -- Finding 1's per-school fetch-failure case
        # (`ResponseTooLargeError`/`BuildIdNotFoundError` out of the real
        # `CollegeDataFetcher.fetch_tab`).
        self._raise_for = dict(raise_for or {})
        self.build_id = "fake-build-id"
        self.build_id_rotations = 0
        self.rate_backoffs = 0

    async def discover_slugs(self) -> tuple[str, ...]:
        return tuple(self._pages_by_slug)

    async def resolve_build_id(self, slug: str) -> str:
        return self.build_id

    async def fetch_tab(self, slug: str, tab: TabName) -> FetchedPage:
        exc = self._raise_for.get((slug, tab))
        if exc is not None:
            raise exc
        profile = self._pages_by_slug[slug].get(tab)
        if profile is None:
            return FetchedPage(
                tab=tab, url="fake://x", page_status="not_found", fetched_at=datetime.now(UTC)
            )
        return FetchedPage(
            tab=tab,
            url="fake://x",
            page_status="ok",
            http_status=200,
            build_id=self.build_id,
            profile=profile,
            fetched_at=datetime.now(UTC),
        )


class _FakeClient:
    async def aclose(self) -> None:
        return None


def _patch_fetcher_and_pending(
    monkeypatch: pytest.MonkeyPatch,
    *,
    fetcher: _FakeFetcher,
    pending: list[tuple[int, str]],
) -> None:
    # `_fetch_config`/`build_client`/`CollegeDataFetcher` are all bypassed by
    # `_FakeFetcher` -- stub `_fetch_config` too so the routine `.env`'s
    # documented placeholder `facts_crawl_user_agent` (never a real contact
    # URL, ADR 0037 R0) never fails `FetchConfig`'s own validation for a
    # config this test never actually uses.
    monkeypatch.setattr(crawl, "_fetch_config", lambda settings: None)
    monkeypatch.setattr(crawl, "CollegeDataFetcher", lambda *a, **kw: fetcher)
    monkeypatch.setattr(crawl, "build_client", lambda *a, **kw: _FakeClient())

    async def fake_pending(
        pool: asyncpg.Pool, *, run_started_at: datetime
    ) -> list[tuple[int, str]]:
        return pending

    monkeypatch.setattr(facts_jobs_store, "schools_pending_this_run", fake_pending)


async def test_a_mapper_failure_is_recorded_and_the_pass_completes(
    monkeypatch: pytest.MonkeyPatch, two_schools: list[tuple[int, str]], pipeline_pool: asyncpg.Pool
) -> None:
    """A school whose mapped shape breaks a handler (the real bug: `paired_
    header`/`address_from_body_array`/`_single` raising `NormalizeError`
    uncaught) must not crash the pass -- the other school still gets its
    facts written, and the run/job both finalize instead of sticking
    `running` forever."""
    (poison_id, poison_slug), (good_id, good_slug) = two_schools
    profiles = _load_fixture_profiles()
    fetcher = _FakeFetcher({poison_slug: profiles, good_slug: profiles})
    _patch_fetcher_and_pending(
        monkeypatch, fetcher=fetcher, pending=[(poison_id, poison_slug), (good_id, good_slug)]
    )

    calls = {"n": 0}

    def fake_map_snapshot(pages: Any, **kwargs: Any) -> Any:
        calls["n"] += 1
        if calls["n"] == 1:
            raise NormalizeError("simulated poison-pill mapper failure")
        return _real_map_snapshot(pages, **kwargs)

    monkeypatch.setattr(crawl, "map_snapshot", fake_map_snapshot)

    pool = pipeline_pool
    settings = get_settings()
    enqueued = await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    assert enqueued
    job = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert job is not None and job.started_at is not None

    await crawl.run_crawl_pass(
        pool, settings, job_id=job.id, claimed_started_at=job.started_at
    )

    job_row = await pool.fetchrow(
        "SELECT status FROM cds_library.facts_jobs WHERE id = $1", job.id
    )
    assert job_row is not None
    assert job_row["status"] == "done"  # never left `running`

    run_row = await pool.fetchrow(
        "SELECT status, failures_by_kind FROM cds_library.crawl_runs WHERE job_id = $1", job.id
    )
    assert run_row is not None
    assert run_row["status"] in ("succeeded", "partial")
    failures = run_row["failures_by_kind"]  # jsonb -> dict via the pool's codec
    assert failures.get("mapper_error") == 1

    poison_facts = await pool.fetchval(
        "SELECT count(*) FROM cds_library.school_facts WHERE school_id = $1", poison_id
    )
    assert poison_facts == 0  # the poison school's facts were never written

    poison_pages = await pool.fetchval(
        "SELECT count(*) FROM cds_library.school_pages WHERE school_id = $1", poison_id
    )
    assert poison_pages == len(_TABS)  # but its page bookkeeping still committed

    good_facts = await pool.fetchval(
        "SELECT count(*) FROM cds_library.school_facts WHERE school_id = $1", good_id
    )
    assert good_facts > 0  # the pass continued past the poison school


async def test_b_parser_failure_is_recorded_and_the_pass_completes(
    monkeypatch: pytest.MonkeyPatch, two_schools: list[tuple[int, str]], pipeline_pool: asyncpg.Pool
) -> None:
    """A school with one tab whose body no longer fits any of the nine
    closed `bodyContent` shapes (`ParseError`, real cause: CollegeData
    prints a shape `parse.py` doesn't model) must not crash the pass."""
    (poison_id, poison_slug), (good_id, good_slug) = two_schools
    good_profiles = _load_fixture_profiles()
    poison_profiles = dict(good_profiles)
    broken_overview = dict(poison_profiles["overview"])
    broken_overview["bodyContent"] = [
        *broken_overview.get("bodyContent", []),
        {"type": "NoSuchNodeType", "whatever": True},
    ]
    poison_profiles = {**poison_profiles, "overview": broken_overview}

    fetcher = _FakeFetcher({poison_slug: poison_profiles, good_slug: good_profiles})
    _patch_fetcher_and_pending(
        monkeypatch, fetcher=fetcher, pending=[(poison_id, poison_slug), (good_id, good_slug)]
    )

    pool = pipeline_pool
    settings = get_settings()
    enqueued = await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    assert enqueued
    job = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert job is not None and job.started_at is not None

    await crawl.run_crawl_pass(
        pool, settings, job_id=job.id, claimed_started_at=job.started_at
    )

    job_row = await pool.fetchrow(
        "SELECT status FROM cds_library.facts_jobs WHERE id = $1", job.id
    )
    assert job_row is not None
    assert job_row["status"] == "done"  # never left `running`

    run_row = await pool.fetchrow(
        "SELECT status FROM cds_library.crawl_runs WHERE job_id = $1", job.id
    )
    assert run_row is not None
    assert run_row["status"] == "partial"  # a real page failure happened

    overview_status = await pool.fetchval(
        "SELECT last_status FROM cds_library.school_pages "
        "WHERE school_id = $1 AND tab = 'overview'",
        poison_id,
    )
    assert overview_status == "parse_error"

    other_tab_status = await pool.fetchval(
        "SELECT last_status FROM cds_library.school_pages "
        "WHERE school_id = $1 AND tab = 'admission'",
        poison_id,
    )
    assert other_tab_status == "ok"  # the other five tabs of the same school still wrote fine

    good_facts = await pool.fetchval(
        "SELECT count(*) FROM cds_library.school_facts WHERE school_id = $1", good_id
    )
    assert good_facts > 0  # the pass continued past the poison school


async def test_c_fetch_failure_is_recorded_and_the_pass_completes(
    monkeypatch: pytest.MonkeyPatch, two_schools: list[tuple[int, str]], pipeline_pool: asyncpg.Pool
) -> None:
    """Finding 1 (school-data-v3 fix review): a per-school fetch failure --
    `ResponseTooLargeError`/`BuildIdNotFoundError` raised out of
    `fetcher.fetch_tab` itself, not merely a non-'ok' `FetchedPage` -- must
    not crash the pass either. Before this fix, `_process_school_live` had
    no `try`/`except` around the `fetch_tab` call at all, so either
    exception propagated past this school, out of `run_crawl_pass`, into
    the poller's `mark_job_crashed` safety net, aborting the whole pass
    instead of skipping the one poisoned tab."""
    (poison_id, poison_slug), (good_id, good_slug) = two_schools
    profiles = _load_fixture_profiles()
    fetcher = _FakeFetcher(
        {poison_slug: profiles, good_slug: profiles},
        raise_for={
            (poison_slug, "overview"): ResponseTooLargeError("simulated oversized response"),
            (poison_slug, "admission"): BuildIdNotFoundError(
                "simulated vanished college-search page"
            ),
        },
    )
    _patch_fetcher_and_pending(
        monkeypatch, fetcher=fetcher, pending=[(poison_id, poison_slug), (good_id, good_slug)]
    )

    pool = pipeline_pool
    settings = get_settings()
    enqueued = await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    assert enqueued
    job = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert job is not None and job.started_at is not None

    await crawl.run_crawl_pass(
        pool, settings, job_id=job.id, claimed_started_at=job.started_at
    )

    job_row = await pool.fetchrow(
        "SELECT status FROM cds_library.facts_jobs WHERE id = $1", job.id
    )
    assert job_row is not None
    assert job_row["status"] == "done"  # never left `running`

    run_row = await pool.fetchrow(
        "SELECT status, failures_by_kind FROM cds_library.crawl_runs WHERE job_id = $1", job.id
    )
    assert run_row is not None
    assert run_row["status"] == "partial"  # two real fetch failures happened
    failures = run_row["failures_by_kind"]
    assert failures.get("fetch_error") == 2

    overview_status = await pool.fetchval(
        "SELECT last_status FROM cds_library.school_pages "
        "WHERE school_id = $1 AND tab = 'overview'",
        poison_id,
    )
    assert overview_status == "http_error"

    admission_status = await pool.fetchval(
        "SELECT last_status FROM cds_library.school_pages "
        "WHERE school_id = $1 AND tab = 'admission'",
        poison_id,
    )
    assert admission_status == "http_error"

    other_tab_status = await pool.fetchval(
        "SELECT last_status FROM cds_library.school_pages "
        "WHERE school_id = $1 AND tab = 'money-matters'",
        poison_id,
    )
    assert other_tab_status == "ok"  # the school's other four tabs still wrote fine

    good_facts = await pool.fetchval(
        "SELECT count(*) FROM cds_library.school_facts WHERE school_id = $1", good_id
    )
    assert good_facts > 0  # the pass continued past the poison school


async def test_d_robots_disallowed_aborts_the_pass_gracefully(
    monkeypatch: pytest.MonkeyPatch, two_schools: list[tuple[int, str]], pipeline_pool: asyncpg.Pool
) -> None:
    """Finding 1's other half: a pass-fatal cause (`RobotsDisallowedError`
    here, standing in for the site withdrawing permission for a path every
    school's crawl depends on) must still close the pass gracefully via
    `_abort_pass` -- `crawl_runs.status = 'aborted'` and `facts_jobs.status
    = 'error'` -- rather than reaching the poller's ungraceful
    `mark_job_crashed` / `error_code='worker_crashed'` fallback, which is
    what a bare, uncaught exception out of `run_crawl_pass` produces."""
    (poison_id, poison_slug), (good_id, good_slug) = two_schools
    profiles = _load_fixture_profiles()
    fetcher = _FakeFetcher(
        {poison_slug: profiles, good_slug: profiles},
        raise_for={(poison_slug, "overview"): RobotsDisallowedError("simulated live disallow")},
    )
    _patch_fetcher_and_pending(
        monkeypatch, fetcher=fetcher, pending=[(poison_id, poison_slug), (good_id, good_slug)]
    )

    pool = pipeline_pool
    settings = get_settings()
    enqueued = await facts_jobs_store.enqueue_now(pool, kind="crawl_pass")
    assert enqueued
    job = await facts_jobs_store.claim_next_job(pool, lease_seconds=180)
    assert job is not None and job.started_at is not None

    await crawl.run_crawl_pass(
        pool, settings, job_id=job.id, claimed_started_at=job.started_at
    )

    job_row = await pool.fetchrow(
        "SELECT status, error_code FROM cds_library.facts_jobs WHERE id = $1", job.id
    )
    assert job_row is not None
    assert job_row["status"] == "error"
    assert job_row["error_code"] == "robots_disallowed"  # not 'worker_crashed'

    run_row = await pool.fetchrow(
        "SELECT status, error_code FROM cds_library.crawl_runs WHERE job_id = $1", job.id
    )
    assert run_row is not None
    assert run_row["status"] == "aborted"
    assert run_row["error_code"] == "robots_disallowed"
