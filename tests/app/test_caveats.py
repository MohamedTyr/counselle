from datetime import UTC, date, datetime
from types import MappingProxyType, SimpleNamespace
from typing import cast

import pytest

from app.caveats import render_caveat
from app.prompt import render_data_picture, validate_prompt_assets
from counselle_db.catalog import CatalogSnapshot


def test_strict_caveat_slots_and_multiple_kinds() -> None:
    profile = render_caveat("profile_snapshot", snapshot_date="2026-01-01")
    partial = render_caveat("partial_packet")
    assert profile.kind == "profile_snapshot"
    assert partial.kind == "partial_packet"
    with pytest.raises(ValueError):
        render_caveat("profile_snapshot")
    with pytest.raises(ValueError):
        render_caveat("partial_packet", surprise="x")
    with pytest.raises(ValueError):
        render_caveat("invented")


def test_phase3_prompt_assets_validate_at_boot() -> None:
    validate_prompt_assets()


def test_data_picture_formats_snapshot_in_manifest_order() -> None:
    snapshot = SimpleNamespace(
        profile_snapshot_min=date(2026, 1, 1),
        profile_snapshot_max=date(2026, 2, 1),
        coverage_aggregates=MappingProxyType(
            {"covered": 2, "fully": 1, "partial": 1, "stale": 1, "by_year": {2024: 2}}
        ),
        domains=(SimpleNamespace(id="admissions"), SimpleNamespace(id="cost")),
        domain_counts={"admissions": 35, "cost": 1_002},
        refreshed_at=datetime(2026, 7, 15, tzinfo=UTC),
        schools={1: object(), 2: object()},
        current_version="5.0.1",
        total_metrics=1_037,
    )
    rendered = render_data_picture(cast(CatalogSnapshot, snapshot))
    assert "manifest 5.0.1, 1,037 metrics" in rendered
    assert "2024-25 (2)" in rendered
    assert rendered.index("admissions (35)") < rendered.index("cost (1,002)")
