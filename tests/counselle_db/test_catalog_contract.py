from __future__ import annotations

from copy import deepcopy
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from typing import Any, cast

import pytest

from counselle_db.catalog import Catalog
from counselle_db.models import ServiceError


class _AsyncContext:
    def __init__(self, value: object) -> None:
        self.value = value

    async def __aenter__(self) -> object:
        return self.value

    async def __aexit__(self, *_: object) -> None:
        return None


def _profile_row(
    unitid: int = 1,
    *,
    name: str = "Example University",
    aliases: tuple[str, ...] = ("Example U",),
    search_name: str = "example university",
    basic_profile: dict[str, Any] | None = None,
    profile_sha256: bytes = b"p" * 32,
) -> dict[str, Any]:
    return {
        "id": unitid,
        "name": name,
        "aliases": list(aliases),
        "city": "Boston",
        "state": "MA",
        "search_name": search_name,
        "official_domain": "example.edu",
        "is_main_campus": True,
        "basic_profile": (
            basic_profile if basic_profile is not None else {"identity": {"sector": "Private"}}
        ),
        "profile_version": "profile-v1",
        "profile_snapshot_date": date(2026, 1, 2),
        "profile_sha256": profile_sha256,
    }


def _status_row(
    school_id: int = 1,
    *,
    fact_count: int = 0,
    facts_updated_at: datetime | None = None,
) -> dict[str, Any]:
    return {"school_id": school_id, "fact_count": fact_count, "facts_updated_at": facts_updated_at}


class _CatalogConnection:
    def __init__(
        self, profiles: list[dict[str, Any]], status: list[dict[str, Any]]
    ) -> None:
        self.profiles = profiles
        self.status = status
        self.fetches: list[str] = []
        self.transactions: list[dict[str, object]] = []

    def transaction(self, **kwargs: object) -> _AsyncContext:
        self.transactions.append(kwargs)
        return _AsyncContext(self)

    async def fetch(self, sql: str, *_: object) -> list[dict[str, Any]]:
        self.fetches.append(sql)
        if "school_data_status" in sql:
            return deepcopy(self.status)
        if "school_profiles" in sql:
            return deepcopy(self.profiles)
        raise AssertionError(f"unexpected SQL: {sql}")


class _CatalogPool:
    def __init__(self, connection: _CatalogConnection) -> None:
        self.connection = connection
        self.acquire_count = 0

    def acquire(self) -> _AsyncContext:
        self.acquire_count += 1
        return _AsyncContext(self.connection)


@pytest.fixture(autouse=True)
def _catalog_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "counselle_db.catalog.get_settings",
        lambda: SimpleNamespace(facts_stale_days=120, data_catalog_refresh_seconds=3600),
    )


async def test_catalog_load_is_one_atomic_read_and_builds_the_full_snapshot() -> None:
    now = datetime.now(UTC)
    fresh = now - timedelta(days=1)
    connection = _CatalogConnection(
        [
            _profile_row(1, basic_profile={"identity": {"sector": "Private"}}),
            _profile_row(
                2,
                name="Second College",
                aliases=(),
                search_name="second college",
                basic_profile={"location": {"city": "Providence"}},
                profile_sha256=b"q" * 32,
            ),
        ],
        [
            _status_row(1, fact_count=12, facts_updated_at=fresh),
            _status_row(2, fact_count=0, facts_updated_at=None),
        ],
    )
    pool = _CatalogPool(connection)

    catalog = await Catalog.load(cast(Any, pool))

    assert pool.acquire_count == 1
    assert connection.transactions == [{"isolation": "repeatable_read", "readonly": True}]
    assert len(connection.fetches) == 2
    snapshot = catalog.snapshot
    assert set(snapshot.schools) == {1, 2}
    assert snapshot.schools[1].basics.name == "Example University"
    assert snapshot.name_index["example u"] == (1,)
    # "Example University" is both the name and the search_name here, so the
    # index legitimately carries the unitid twice for that normalized key.
    assert snapshot.name_index["example university"] == (1, 1)
    assert set(snapshot.profile_groups) == {"identity", "location"}
    assert snapshot.profile_snapshot_min == date(2026, 1, 2)
    assert snapshot.profile_snapshot_max == date(2026, 1, 2)
    assert snapshot.schools_with_facts == 1
    assert snapshot.facts_updated_min == fresh
    assert snapshot.facts_updated_max == fresh
    assert snapshot.stale_facts_count == 0
    # fact_keys fills from fact_coverage in Phase 3 (still empty here);
    # sections fills from facts_sections.yaml in Phase 2 (this phase) — the
    # real committed asset, six sections keyed by id.
    assert snapshot.fact_keys == {}
    assert set(snapshot.sections) == {
        "getting-in",
        "money",
        "academics",
        "campus-life",
        "outcomes",
        "applying",
    }
    getting_in = snapshot.sections["getting-in"]
    assert getting_in.title == "Getting in"
    assert any(group.id == "selectivity-rating" for group in getting_in.groups)


async def test_catalog_counts_a_school_stale_only_when_older_than_the_configured_cutoff(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "counselle_db.catalog.get_settings",
        lambda: SimpleNamespace(facts_stale_days=30, data_catalog_refresh_seconds=3600),
    )
    now = datetime.now(UTC)
    connection = _CatalogConnection(
        [_profile_row(1), _profile_row(2, name="Fresh U", search_name="fresh u")],
        [
            _status_row(1, fact_count=5, facts_updated_at=now - timedelta(days=45)),
            _status_row(2, fact_count=5, facts_updated_at=now - timedelta(days=1)),
        ],
    )
    snapshot = (await Catalog.load(cast(Any, _CatalogPool(connection)))).snapshot
    assert snapshot.schools_with_facts == 2
    assert snapshot.stale_facts_count == 1


@pytest.mark.parametrize(
    ("profiles", "message"),
    [
        ([], "profile catalog is empty"),
        ([_profile_row(1), _profile_row(1)], "invalid or duplicated"),
        ([{**_profile_row(1), "name": "  "}], "invalid or duplicated"),
        ([{**_profile_row(1), "search_name": ""}], "invalid or duplicated"),
        ([{**_profile_row(1), "aliases": ["Ok", "  "]}], "invalid or duplicated"),
        ([{**_profile_row(1), "basic_profile": "not-a-dict"}], "invalid or duplicated"),
        ([{**_profile_row(1), "profile_sha256": b"short"}], "invalid or duplicated"),
        ([{**_profile_row(1), "id": 0}], "invalid or duplicated"),
    ],
)
async def test_catalog_rejects_invalid_snapshot_state(
    profiles: list[dict[str, Any]], message: str
) -> None:
    pool = _CatalogPool(_CatalogConnection(profiles, []))
    with pytest.raises(ServiceError, match=message):
        await Catalog.load(cast(Any, pool))


async def test_refresh_cadence_skips_within_window_reloads_when_forced_and_is_atomic_on_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _CatalogConnection([_profile_row()], [_status_row(fact_count=1)])
    pool = _CatalogPool(connection)
    catalog = await Catalog.load(cast(Any, pool))
    original = catalog.snapshot

    monkeypatch.setattr(
        "counselle_db.catalog.get_settings",
        lambda: SimpleNamespace(facts_stale_days=120, data_catalog_refresh_seconds=3600),
    )
    assert await catalog.maybe_refresh() is original
    assert pool.acquire_count == 1  # cadence not elapsed -- no second read

    connection.profiles = []
    assert await catalog.maybe_refresh(force=True) is original  # failed reload keeps truth
    assert catalog.snapshot is original

    connection.profiles = [_profile_row(name="Renamed University")]
    refreshed = await catalog.maybe_refresh(force=True)
    assert refreshed is not original
    assert refreshed.schools[1].basics.name == "Renamed University"
    assert catalog.snapshot is refreshed
