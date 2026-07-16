from __future__ import annotations

from datetime import UTC, date, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from app.agent_node import _make_render_viz_tool
from app.sources import SourceRegistry
from app.viz import render_viz
from counselle_db.models import (
    AvailabilitySummary,
    DomainResult,
    DomainRow,
    ProfileGroup,
    ProfileGroupResult,
    ProfileLeaf,
    SchoolBasics,
)
from domain.envelope import Citation
from domain.specs import (
    ColumnInput,
    MetricCellInput,
    ProfileCellInput,
    SourcedCellInput,
    UnavailableCellInput,
    VizRowInput,
)


def _catalog() -> SimpleNamespace:
    return SimpleNamespace(snapshot=SimpleNamespace(schools={}, metrics={}, profile_groups=()))


def _db_catalog() -> SimpleNamespace:
    school = SchoolBasics(unitid=1, name="Canonical School", official_domain="school.edu")
    return SimpleNamespace(
        snapshot=SimpleNamespace(
            schools={1: SimpleNamespace(basics=school)},
            metrics={"admissions.one": object(), "admissions.two": object()},
            profile_groups=(),
        )
    )


def _registry() -> SourceRegistry:
    registry = SourceRegistry()
    registry.register_source(
        Citation(
            source="web",
            tier="official",
            vintage="Retrieved 2026-07-15",
            url="https://example.edu/facts",
        ),
        "Example facts",
    )
    return registry


@pytest.mark.asyncio
async def test_sourced_and_unavailable_cells_render_with_compact_ack() -> None:
    registry = _registry()
    emitted: list[dict[str, object]] = []
    result = await render_viz(
        _catalog(),
        registry,
        emitted,
        "comparison_table",
        [ColumnInput(name="One"), ColumnInput(name="Two")],
        [
            VizRowInput(
                label="Rate",
                cells=(
                    SourcedCellInput(display="42%", raw=42, marker="[1]"),
                    UnavailableCellInput(unavailable=True),
                ),
            )
        ],
    )
    assert result == {
        "ok": True,
        "status": "rendered",
        "placement_marker": "[[viz:1]]",
        "cell_count": 2,
        "available_count": 1,
        "unavailable_count": 1,
        "source_count": 1,
        "sources": ["[1]"],
        "public_receipt": {
            "viz_type": "comparison_table",
            "value_count": 1,
            "schools": ["One", "Two"],
            "sources": ["[1]"],
        },
    }
    assert "result_for_agent" not in result
    assert emitted[0]["v"] == 2
    assert emitted[0]["columns"][0]["unitid"] is None  # type: ignore[index]


@pytest.mark.asyncio
async def test_rejection_rolls_back_card_and_registry_byte_for_byte() -> None:
    registry = _registry()
    before = registry.dump_state()
    emitted: list[dict[str, object]] = []
    result = await render_viz(
        _catalog(),
        registry,
        emitted,
        "comparison_table",
        [ColumnInput(name="One"), ColumnInput(name="Two")],
        [
            VizRowInput(
                label="Rate",
                cells=(
                    SourcedCellInput(display="42%", marker="[1]"),
                    SourcedCellInput(display="invented", marker="[99]"),
                ),
            )
        ],
    )
    assert result["ok"] is False
    assert result["status"] == "rejected"
    assert result["valid_cells"] == 1
    assert emitted == []
    assert registry.dump_state() == before


@pytest.mark.asyncio
async def test_max_cells_rejects_before_catalog_or_source_work(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class ExplodingCatalog:
        @property
        def snapshot(self) -> object:
            raise AssertionError("catalog must not be read before max-cell rejection")

    monkeypatch.setattr("app.viz.get_settings", lambda: SimpleNamespace(viz_max_cells=1))
    registry = _registry()
    before = registry.dump_state()
    result = await render_viz(
        ExplodingCatalog(),  # type: ignore[arg-type]
        registry,
        [],
        "comparison_table",
        [ColumnInput(name="One"), ColumnInput(name="Two")],
        [
            VizRowInput(
                label="Rate",
                cells=(
                    SourcedCellInput(display="1", marker="[1]"),
                    SourcedCellInput(display="2", marker="[1]"),
                ),
            )
        ],
    )
    assert result["status"] == "rejected"
    assert registry.dump_state() == before


@pytest.mark.asyncio
async def test_all_unavailable_is_canonical_honesty_rejection() -> None:
    result = await render_viz(
        _catalog(),
        SourceRegistry(),
        [],
        "stat_block",
        [ColumnInput(name="One")],
        [VizRowInput(label="Value", cells=(UnavailableCellInput(unavailable=True),))],
    )
    assert result["status"] == "rejected"
    assert "tell the student honestly" in result["rejected_cells"][0]["reason"]


@pytest.mark.asyncio
async def test_official_database_marker_cannot_be_laundered_as_sourced() -> None:
    registry = SourceRegistry()
    registry.register_source(
        Citation(
            source="profile",
            tier="official",
            vintage="Profile snapshot 2024-12-31",
            school_unitid=1,
            profile_sha256="a" * 64,
        ),
        "School profile",
    )
    result = await render_viz(
        _catalog(),
        registry,
        [],
        "stat_block",
        [ColumnInput(name="One")],
        [VizRowInput(label="Value", cells=(SourcedCellInput(display="42", marker="[1]"),))],
    )
    assert result["ok"] is False
    assert "not an external" in result["rejected_cells"][0]["reason"]


def test_actual_agent_tool_schema_has_only_v2_shape() -> None:
    tool = _make_render_viz_tool(_catalog(), SourceRegistry(), [], {}, None)
    schema = tool.function_schema.json_schema
    properties = schema["properties"]
    assert {"type", "columns", "rows", "title"} == set(properties)
    assert "unitids" not in properties
    assert "field_keys" not in properties
    assert "JsonValue" not in schema.get("$defs", {})


@pytest.mark.asyncio
async def test_metric_reads_are_grouped_once_and_column_is_canonicalized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[int, str]] = []

    async def fake_get_domain(_catalog: object, unitid: int, domain_id: str) -> DomainResult:
        calls.append((unitid, domain_id))
        rows = tuple(
            DomainRow(
                ref=f"admissions.{name}",
                label=name.title(),
                display=str(value),
                available=True,
                value=value,
                vintage="Common Data Set 2024-25",
                evidence={
                    "eid": f"admissions.{name}",
                    "value_display": str(value),
                    "label": name.title(),
                    "page": 7,
                    "excerpt": f"{name} {value}",
                },
            )
            for name, value in (("one", 1), ("two", 2))
        )
        return DomainResult(
            school=SchoolBasics(unitid=1, name="Canonical School", official_domain="school.edu"),
            domain_id="admissions",
            academic_year=2024,
            document_id=1,
            document_sha256="b" * 64,
            source_kind="upload",
            retrieved_at=datetime(2026, 7, 15, tzinfo=UTC),
            manifest_version="5.0.1",
            rows=rows,
            availability=AvailabilitySummary(configured=2, verified=2, not_in_template_version=0),
            summary="2 of 2 metrics verified",
        )

    monkeypatch.setattr("app.viz.get_domain", fake_get_domain)
    emitted: list[dict[str, object]] = []
    result = await render_viz(
        _db_catalog(),
        SourceRegistry(),
        emitted,
        "stat_block",
        [ColumnInput(unitid=1, name="Model lie", domain="attacker.example")],
        [
            VizRowInput(label="One", cells=(MetricCellInput(metric_ref="admissions.one"),)),
            VizRowInput(label="Two", cells=(MetricCellInput(metric_ref="admissions.two"),)),
        ],
    )
    assert result["ok"] is True
    assert calls == [(1, "admissions")]
    assert emitted[0]["columns"] == [
        {"unitid": 1, "name": "Canonical School", "domain": "school.edu"}
    ]


@pytest.mark.asyncio
async def test_profile_reads_are_grouped_once_and_source_label_names_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[int, tuple[str, ...]]] = []

    async def fake_profile(_catalog: object, unitid: int, groups: list[str]) -> ProfileGroupResult:
        calls.append((unitid, tuple(groups)))
        return ProfileGroupResult(
            school=SchoolBasics(unitid=1, name="Canonical School"),
            profile_version="2024",
            profile_snapshot_date=date(2024, 12, 31),
            profile_sha256="c" * 64,
            groups=(
                ProfileGroup(
                    id="location",
                    rows=(
                        ProfileLeaf(
                            ref="location.city",
                            label="City",
                            display="Durham",
                            available=True,
                            value="Durham",
                        ),
                        ProfileLeaf(
                            ref="location.state",
                            label="State",
                            display="NC",
                            available=True,
                            value="NC",
                        ),
                    ),
                ),
            ),
            valid_groups=("location",),
        )

    monkeypatch.setattr("app.viz.get_school_profile", fake_profile)
    registry = SourceRegistry()
    result = await render_viz(
        SimpleNamespace(
            snapshot=SimpleNamespace(
                schools={
                    1: SimpleNamespace(basics=SchoolBasics(unitid=1, name="Canonical School"))
                },
                metrics={},
                profile_groups=("location",),
            )
        ),
        registry,
        [],
        "stat_block",
        [ColumnInput(unitid=1)],
        [
            VizRowInput(label="City", cells=(ProfileCellInput(profile_field="location.city"),)),
            VizRowInput(label="State", cells=(ProfileCellInput(profile_field="location.state"),)),
        ],
    )
    assert result["ok"] is True
    assert calls == [(1, ("location",))]
    assert registry.entries[0].label == "Canonical School — Profile snapshot 2024-12-31"


@pytest.mark.asyncio
async def test_profile_typo_is_unknown_while_present_null_leaf_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[int, tuple[str, ...]]] = []

    async def fake_profile(_catalog: object, unitid: int, groups: list[str]) -> ProfileGroupResult:
        calls.append((unitid, tuple(groups)))
        return ProfileGroupResult(
            school=SchoolBasics(unitid=1, name="Canonical School"),
            profile_version="2024",
            profile_snapshot_date=date(2024, 12, 31),
            profile_sha256="c" * 64,
            groups=(
                ProfileGroup(
                    id="location",
                    rows=(
                        ProfileLeaf(
                            ref="location.city",
                            label="City",
                            display="Durham",
                            available=True,
                            value="Durham",
                        ),
                        ProfileLeaf(
                            ref="location.coordinates.latitude",
                            label="Latitude",
                            display=None,
                            available=False,
                        ),
                        ProfileLeaf(
                            ref="location.state",
                            label="State",
                            display="NC",
                            available=True,
                            value="NC",
                        ),
                    ),
                ),
            ),
            valid_groups=("location",),
        )

    monkeypatch.setattr("app.viz.get_school_profile", fake_profile)
    registry = SourceRegistry()
    before = registry.dump_state()
    emitted: list[dict[str, object]] = []
    result = await render_viz(
        SimpleNamespace(
            snapshot=SimpleNamespace(
                schools={
                    1: SimpleNamespace(basics=SchoolBasics(unitid=1, name="Canonical School"))
                },
                metrics={},
                profile_groups=("location",),
            )
        ),
        registry,
        emitted,
        "stat_block",
        [ColumnInput(unitid=1)],
        [
            VizRowInput(label="City", cells=(ProfileCellInput(profile_field="location.citty"),)),
            VizRowInput(
                label="Latitude",
                cells=(ProfileCellInput(profile_field="location.coordinates.latitude"),),
            ),
        ],
    )

    assert result["status"] == "rejected"
    assert calls == [(1, ("location",))]
    assert emitted == []
    assert registry.dump_state() == before
    reasons = [defect["reason"] for defect in result["rejected_cells"]]
    assert reasons[0] == (
        "unknown profile_field 'location.citty' — did you mean "
        "'location.city', 'location.state', 'location.coordinates.latitude'?"
    )
    assert reasons[1] == (
        "'location.coordinates.latitude' is unavailable; replace this cell "
        'with {"unavailable":true}'
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("type_", "columns", "rows", "max_cells", "reason"),
    [
        ("stat_block", [ColumnInput(name="One"), ColumnInput(name="Two")], [], 100, "row"),
        (
            "comparison_table",
            [ColumnInput(name="One")],
            [VizRowInput(label="X", cells=(UnavailableCellInput(unavailable=True),))],
            100,
            "two columns",
        ),
        (
            "stat_block",
            [ColumnInput(name="One")],
            [
                VizRowInput(
                    label="X",
                    cells=(
                        UnavailableCellInput(unavailable=True),
                        UnavailableCellInput(unavailable=True),
                    ),
                )
            ],
            100,
            "cells",
        ),
        (
            "comparison_table",
            [ColumnInput(name="One"), ColumnInput(name="Two")],
            [
                VizRowInput(
                    label="X",
                    cells=(
                        UnavailableCellInput(unavailable=True),
                        UnavailableCellInput(unavailable=True),
                    ),
                )
            ],
            1,
            "maximum",
        ),
        (
            "comparison_table",
            [
                ColumnInput(name="Same", domain="one.edu"),
                ColumnInput(name=" same ", domain="two.edu"),
            ],
            [
                VizRowInput(
                    label="X",
                    cells=(
                        UnavailableCellInput(unavailable=True),
                        UnavailableCellInput(unavailable=True),
                    ),
                )
            ],
            100,
            "duplicate web-only",
        ),
    ],
)
async def test_structural_defects_reject_before_catalog_or_source_io(
    monkeypatch: pytest.MonkeyPatch,
    type_: str,
    columns: list[ColumnInput],
    rows: list[VizRowInput],
    max_cells: int,
    reason: str,
) -> None:
    class ExplodingCatalog:
        @property
        def snapshot(self) -> object:
            raise AssertionError("catalog I/O forbidden for structural defects")

    class ExplodingRegistry(SourceRegistry):
        def fork(self) -> SourceRegistry:
            raise AssertionError("source I/O forbidden for structural defects")

    monkeypatch.setattr("app.viz.get_settings", lambda: SimpleNamespace(viz_max_cells=max_cells))
    result = await render_viz(ExplodingCatalog(), ExplodingRegistry(), [], type_, columns, rows)
    assert result["status"] == "rejected"
    assert any(reason in defect["reason"] for defect in result["rejected_cells"])


@pytest.mark.asyncio
async def test_unknown_refs_web_db_ref_and_missing_value_are_aggregated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_domain(_catalog: object, unitid: int, domain_id: str) -> DomainResult:
        del unitid, domain_id
        return DomainResult(
            school=SchoolBasics(unitid=1, name="Canonical School"),
            domain_id="admissions",
            academic_year=2024,
            document_id=1,
            document_sha256="d" * 64,
            source_kind="upload",
            retrieved_at=datetime(2026, 7, 15, tzinfo=UTC),
            manifest_version="5.0.1",
            rows=(
                DomainRow(
                    ref="admissions.one",
                    label="One",
                    display=None,
                    available=False,
                    vintage="Common Data Set 2024-25",
                ),
            ),
            availability=AvailabilitySummary(configured=1, verified=0, not_in_template_version=0),
            summary="unavailable",
        )

    monkeypatch.setattr("app.viz.get_domain", fake_domain)
    result = await render_viz(
        _db_catalog(),
        SourceRegistry(),
        [],
        "comparison_table",
        [ColumnInput(unitid=1), ColumnInput(name="Web School")],
        [
            VizRowInput(
                label="Unknown",
                cells=(
                    MetricCellInput(metric_ref="admissions.on"),
                    MetricCellInput(metric_ref="admissions.one"),
                ),
            ),
            VizRowInput(
                label="Missing",
                cells=(
                    MetricCellInput(metric_ref="admissions.one"),
                    UnavailableCellInput(unavailable=True),
                ),
            ),
        ],
    )
    reasons = [defect["reason"] for defect in result["rejected_cells"]]
    assert len(reasons) == 3
    assert any("did you mean" in reason for reason in reasons)
    assert any("web-only" in reason for reason in reasons)
    assert any('{"unavailable":true}' in reason for reason in reasons)


@pytest.mark.asyncio
async def test_staging_failure_rolls_back_registry_and_cards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    registry = _registry()
    before = registry.dump_state()
    emitted: list[dict[str, object]] = []
    monkeypatch.setattr(
        "app.viz._stage_render_spec", lambda *args: (_ for _ in ()).throw(RuntimeError("boom"))
    )
    result = await render_viz(
        _catalog(),
        registry,
        emitted,
        "stat_block",
        [ColumnInput(name="One")],
        [VizRowInput(label="Value", cells=(SourcedCellInput(display="1", marker="[1]"),))],
    )
    assert result["status"] == "rejected"
    assert emitted == []
    assert registry.dump_state() == before


@pytest.mark.asyncio
async def test_source_markers_are_reported_in_numeric_order() -> None:
    registry = SourceRegistry()
    for index in range(1, 11):
        registry.register_source(
            Citation(
                source="web",
                tier="official",
                vintage=f"Retrieved {index}",
                url=f"https://example.edu/{index}",
            ),
            str(index),
        )
    result = await render_viz(
        _catalog(),
        registry,
        [],
        "comparison_table",
        [ColumnInput(name="One"), ColumnInput(name="Two")],
        [
            VizRowInput(
                label="Value",
                cells=(
                    SourcedCellInput(display="10", marker="[10]"),
                    SourcedCellInput(display="2", marker="[2]"),
                ),
            )
        ],
    )
    assert result["sources"] == ["[2]", "[10]"]


@pytest.mark.asyncio
async def test_mixed_cds_editions_attach_comparison_caveat(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    schools = {
        unitid: SimpleNamespace(basics=SchoolBasics(unitid=unitid, name=f"School {unitid}"))
        for unitid in (1, 2)
    }
    catalog = SimpleNamespace(
        snapshot=SimpleNamespace(
            schools=schools,
            metrics={"admissions.one": object()},
            profile_groups=(),
        )
    )

    async def fake_domain(_catalog: object, unitid: int, _domain: str) -> DomainResult:
        year = 2024 if unitid == 1 else 2023
        return DomainResult(
            school=schools[unitid].basics,
            domain_id="admissions",
            academic_year=year,
            document_id=unitid,
            document_sha256=str(unitid) * 64,
            source_kind="upload",
            retrieved_at=datetime(2026, 7, 15, tzinfo=UTC),
            manifest_version="5.0.1" if unitid == 1 else "4.9.0",
            rows=(
                DomainRow(
                    ref="admissions.one",
                    label="One",
                    display=str(unitid),
                    available=True,
                    value=unitid,
                    vintage=f"Common Data Set {year}-{str(year + 1)[-2:]}",
                    evidence={
                        "eid": "admissions.one",
                        "value_display": str(unitid),
                        "label": "One",
                        "page": 1,
                        "excerpt": str(unitid),
                    },
                ),
            ),
            availability=AvailabilitySummary(configured=1, verified=1, not_in_template_version=0),
            summary="verified",
        )

    monkeypatch.setattr("app.viz.get_domain", fake_domain)
    emitted: list[dict[str, Any]] = []
    result = await render_viz(
        catalog,
        SourceRegistry(),
        emitted,
        "comparison_table",
        [ColumnInput(unitid=1), ColumnInput(unitid=2)],
        [
            VizRowInput(
                label="One",
                cells=(
                    MetricCellInput(metric_ref="admissions.one"),
                    MetricCellInput(metric_ref="admissions.one"),
                ),
            )
        ],
    )
    assert result["ok"] is True
    cells = emitted[0]["rows"][0]["cells"]
    assert all(
        any(caveat["kind"] == "edition_mismatch_comparison" for caveat in cell["caveats"])
        for cell in cells
    )
