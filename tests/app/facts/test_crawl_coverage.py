"""Hermetic coverage for the crawl coordinator's failure boundaries.

These tests deliberately replace the network, parser, mapper, and facts store
with small fakes.  They pin the coordinator contract without requiring a
database or making a real CollegeData request.
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, cast

import pytest

from adapters.collegedata.fetch import (
    CollegeDataFetcher,
    FetchedPage,
    ResponseTooLargeError,
)
from app.facts import crawl
from config.settings import Settings
from domain.facts.models import TAB_NAMES


class _ConnContext:
    async def __aenter__(self) -> _ConnContext:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    def transaction(self) -> _ConnContext:
        return self


class _Pool:
    def acquire(self) -> _ConnContext:
        return _ConnContext()


def _settings() -> SimpleNamespace:
    return SimpleNamespace(
        facts_snapshot_retention_per_page=3,
        facts_unmapped_alert_threshold=100,
        facts_admin_unmapped_limit=10,
        current_admissions_cycle_year=2027,
    )


def _page(tab: str, profile: dict[str, Any] | None = None) -> FetchedPage:
    return FetchedPage(
        tab=cast(Any, tab),
        url="https://example.test/page",
        page_status="ok",
        http_status=200,
        build_id="build-1",
        profile=profile or {"tab": tab},
        fetched_at=datetime.now(UTC),
    )


class _Fetcher:
    build_id = "build-1"
    build_id_rotations = 0
    rate_backoffs = 0

    def __init__(self, outcomes: dict[str, object]) -> None:
        self.outcomes = outcomes
        self.calls: list[str] = []

    async def fetch_tab(self, _slug: str, tab: str) -> FetchedPage:
        self.calls.append(tab)
        outcome = self.outcomes.get(tab, _page(tab))
        if isinstance(outcome, BaseException):
            raise outcome
        assert isinstance(outcome, FetchedPage)
        return outcome


@pytest.mark.asyncio
async def test_process_school_continues_after_per_school_fetch_and_parse_failures(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """One bad tab is recorded while later tabs and the transaction proceed."""
    first_tab, second_tab = TAB_NAMES[:2]
    fetcher = _Fetcher(
        {
            first_tab: ResponseTooLargeError("oversized"),
            second_tab: _page(second_tab),
        }
    )
    recorded: list[tuple[str, str]] = []
    changed: list[str] = []

    async def record_failure(_conn: object, *, school_id: int, tab: str, status: str) -> None:
        assert school_id == 42
        recorded.append((tab, status))

    async def record_changed(_conn: object, **kwargs: object) -> SimpleNamespace:
        changed.append(str(kwargs["tab"]))
        return SimpleNamespace(snapshot_id=len(changed), is_new_snapshot=True, pruned=0)

    async def current_hash(_conn: object, **_kwargs: object) -> bytes | None:
        return None

    async def write_school(
        _conn: object, **_kwargs: object
    ) -> tuple[SimpleNamespace, list[tuple[str, str]]]:
        return SimpleNamespace(inserted=2, closed_withdrawn=1), [("x.y", "Unknown")]

    monkeypatch.setattr(crawl.facts_store, "record_page_failure", record_failure)  # type: ignore[attr-defined]
    monkeypatch.setattr(crawl.facts_store, "record_page_changed", record_changed)  # type: ignore[attr-defined]
    monkeypatch.setattr(crawl.facts_store, "get_current_page_hash", current_hash)  # type: ignore[attr-defined]
    monkeypatch.setattr(crawl, "_write_school", write_school)
    monkeypatch.setattr(crawl, "content_hash", lambda _profile: b"new-hash")
    monkeypatch.setattr(crawl, "parse_page", lambda tab, _body: SimpleNamespace(tab=tab))
    monkeypatch.setattr(crawl, "snapshot_body", lambda profile: profile)

    result = await crawl._process_school_live(
        cast(CollegeDataFetcher, fetcher),
        _Pool(),
        school_id=42,
        slug="school",
        settings=cast(Settings, _settings()),
        mapper_version="v1",
    )

    assert fetcher.calls == list(TAB_NAMES)
    assert recorded == [(first_tab, "http_error")]
    assert changed == list(TAB_NAMES[1:])
    assert result.pages_fetched == len(TAB_NAMES)
    assert result.pages_failed == 1
    assert result.pages_changed == len(TAB_NAMES) - 1
    assert result.facts_changed == 3
    assert result.unmapped == [("x.y", "Unknown")]


@pytest.mark.asyncio
async def test_process_school_records_not_found_and_parse_error_without_writing_them(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first_tab, second_tab, parse_error_tab = TAB_NAMES[:3]
    fetcher = _Fetcher(
        {
            first_tab: FetchedPage(
                tab=cast(Any, first_tab),
                url="fake",
                page_status="not_found",
                fetched_at=datetime.now(UTC),
            ),
            second_tab: _page(second_tab),
            parse_error_tab: _page(parse_error_tab),
        }
    )
    failures: list[tuple[str, str]] = []
    changed: list[str] = []

    async def record_failure(_conn: object, *, school_id: int, tab: str, status: str) -> None:
        failures.append((tab, status))

    async def record_changed(_conn: object, **kwargs: object) -> SimpleNamespace:
        changed.append(str(kwargs["tab"]))
        return SimpleNamespace(snapshot_id=1, is_new_snapshot=True, pruned=0)

    async def current_hash(_conn: object, **_kwargs: object) -> bytes | None:
        return None

    async def write_school(
        _conn: object, **kwargs: object
    ) -> tuple[SimpleNamespace, list[tuple[str, str]]]:
        assert kwargs["changed_tabs"] == frozenset(set(TAB_NAMES) - {first_tab, parse_error_tab})
        return SimpleNamespace(inserted=0, closed_withdrawn=0), []

    def parse(tab: str, _body: object) -> object:
        if tab == parse_error_tab:
            raise ValueError("malformed typed page")
        return SimpleNamespace(tab=tab)

    monkeypatch.setattr(crawl.facts_store, "record_page_failure", record_failure)  # type: ignore[attr-defined]
    monkeypatch.setattr(crawl.facts_store, "record_page_changed", record_changed)  # type: ignore[attr-defined]
    monkeypatch.setattr(crawl.facts_store, "get_current_page_hash", current_hash)  # type: ignore[attr-defined]
    monkeypatch.setattr(crawl, "_write_school", write_school)
    monkeypatch.setattr(crawl, "content_hash", lambda _profile: b"hash")
    monkeypatch.setattr(crawl, "parse_page", parse)
    monkeypatch.setattr(crawl, "snapshot_body", lambda profile: profile)

    result = await crawl._process_school_live(
        cast(CollegeDataFetcher, fetcher),
        _Pool(),
        school_id=9,
        slug="school",
        settings=cast(Settings, _settings()),
        mapper_version="v1",
    )

    assert failures == [(first_tab, "not_found"), (parse_error_tab, "parse_error")]
    assert changed == [tab for tab in TAB_NAMES if tab not in {first_tab, parse_error_tab}]
    assert result.pages_failed == 2
    assert result.failure_kinds == ["not_found", "parse_error"]


def test_pass_counters_and_unmapped_sample_are_ranked_and_aggregated() -> None:
    first = crawl._SchoolCounters(
        pages_fetched=6,
        pages_changed=2,
        pages_failed=1,
        facts_changed=4,
        unmapped=[("a", "label"), ("a", "label")],
        failure_kinds=["parse_error"],
    )
    second = crawl._SchoolCounters(
        pages_fetched=6,
        pages_changed=1,
        pages_failed=2,
        facts_changed=3,
        unmapped=[("b", "other")],
        failure_kinds=["fetch_error", "fetch_error"],
    )
    totals = crawl._PassCounters()
    totals.add(first)
    totals.add(second)

    assert totals.schools_seen == 2
    assert totals.pages_fetched == 12
    assert totals.pages_changed == 3
    assert totals.pages_failed == 3
    assert totals.facts_changed == 7
    assert totals.failures_by_kind == Counter({"fetch_error": 2, "parse_error": 1})
    assert crawl._unmapped_sample(totals.unmapped_samples, limit=1) == [
        {"source_path": "a", "label": "label", "schools": 2}
    ]


def test_top_level_adapter_preserves_profile_shape() -> None:
    profile = {"admissions": {"rate": 0.5}, "null": None}
    assert crawl._wrap_top_level(profile) == {"pageProps": {"profile": profile}}
