from datetime import UTC, date, datetime
from types import MappingProxyType, SimpleNamespace
from typing import cast, get_args

import pytest

from app.caveats import caveat_catalog, render_caveat
from app.prompt import render_data_picture, validate_prompt_assets
from config.settings import load_yaml_asset
from counselle_db.catalog import CatalogSnapshot
from domain.envelope import CaveatKind


def test_strict_caveat_slots_and_multiple_kinds() -> None:
    profile = render_caveat("profile_snapshot", snapshot_date="2026-01-01")
    not_collected = render_caveat("not_collected")
    assert profile.kind == "profile_snapshot"
    assert not_collected.kind == "not_collected"
    with pytest.raises(ValueError):
        render_caveat("profile_snapshot")
    with pytest.raises(ValueError):
        render_caveat("not_collected", surprise="x")
    with pytest.raises(ValueError):
        render_caveat("invented")  # type: ignore[arg-type]
    not_fetched = render_caveat("not_fetched", cause="Counselle has not checked this yet")
    assert not_fetched.kind == "not_fetched"


def test_caveat_kind_set_is_pinned_across_yaml_assertion_and_type() -> None:
    """school-data-v3 Phase 3, Unit D: the final eight-kind vocabulary is
    spelled out exactly once (`CaveatKind`); `caveats.yaml` and
    `caveat_catalog()`'s own assertion must both equal it."""
    literal_kinds = set(get_args(CaveatKind))
    yaml_kinds = set(cast(dict[str, object], load_yaml_asset("caveats")))
    catalog_kinds = set(caveat_catalog())
    assert literal_kinds == yaml_kinds == catalog_kinds
    assert len(literal_kinds) == 8


def test_phase3_prompt_assets_validate_at_boot() -> None:
    validate_prompt_assets()


def test_data_picture_formats_snapshot_ranges_and_thousands_separators() -> None:
    snapshot = SimpleNamespace(
        refreshed_at=datetime(2026, 7, 15, tzinfo=UTC),
        schools={1: object(), 2: object()},
        profile_snapshot_min=date(2026, 1, 1),
        profile_snapshot_max=date(2026, 2, 1),
        facts_updated_min=datetime(2026, 6, 1, tzinfo=UTC),
        facts_updated_max=datetime(2026, 6, 3, tzinfo=UTC),
        schools_with_facts=1_234,
        stale_facts_count=56,
        fact_keys=MappingProxyType({f"key.{i}": object() for i in range(1_500)}),
        sections=MappingProxyType({"cost": object(), "admissions": object()}),
    )
    rendered = render_data_picture(cast(CatalogSnapshot, snapshot))
    assert "profile snapshot date(s): 2026-01-01–2026-02-01" in rendered
    assert "last crawled: 2026-06-01–2026-06-03" in rendered
    assert "1,234 schools with collected facts" in rendered
    assert "56 are stale" in rendered
    assert "Fact keys tracked: 1,500" in rendered
    assert "Sections: admissions, cost" in rendered


def test_data_picture_renders_the_honest_not_yet_collected_state() -> None:
    """Phase 0-2: the facts store has no rows yet and facts_sections.yaml
    hasn't shipped -- fact_keys/sections/facts_updated_* are empty/None and
    must render an explicit not-yet-collected state, never a bare 0 or an
    empty list that would understate what's on file (CLAUDE.md principle 3:
    never lie to a student)."""
    snapshot = SimpleNamespace(
        refreshed_at=datetime(2026, 7, 15, tzinfo=UTC),
        schools={1: object()},
        profile_snapshot_min=date(2026, 1, 1),
        profile_snapshot_max=date(2026, 1, 1),
        facts_updated_min=None,
        facts_updated_max=None,
        schools_with_facts=0,
        stale_facts_count=0,
        fact_keys=MappingProxyType({}),
        sections=MappingProxyType({}),
    )
    rendered = render_data_picture(cast(CatalogSnapshot, snapshot))
    assert "last crawled: none yet" in rendered
    assert "Fact keys tracked: not yet collected" in rendered
    assert "Sections: not yet collected" in rendered
