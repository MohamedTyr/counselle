from __future__ import annotations

from typing import Any

import pytest

from app import viz
from app.sources import SourceRegistry
from app.viz import (
    _build_spec,
    _comparison_spec,
    _domains,
    _stat_block_spec,
    _validate_viz_request,
    _viz_result_from_spec,
    _with_domains,
    render_viz,
)
from counselle_db.models import (
    CompareResult,
    CompareRow,
    ResolveMatch,
    SchoolBasics,
    ServiceError,
)
from domain.envelope import Citation, CitationEnvelope
from domain.specs import RenderSpec, SchoolRef, VizRow


def envelope(field: str, *, available: bool = True) -> CitationEnvelope:
    return CitationEnvelope(
        field=field,
        label=field,
        display="42" if available else "not available",
        raw=42 if available else None,
        available=available,
        unit="number",
        citation=Citation(source="ipeds", tier="official", vintage="IPEDS 2024", raw_table="x"),
    )


def spec_with_cells(
    cells: list[CitationEnvelope],
    *,
    school: SchoolRef | None = None,
    title: str = "A vs B",
) -> RenderSpec:
    return RenderSpec(
        type="comparison_table",
        title=title,
        schools=[school or SchoolRef(unitid=1, name="A")],
        rows=[VizRow(label="row", cells=cells)],
    )


def fake_catalog() -> Any:
    return object()


def test_with_domains_attaches_domains_immutably() -> None:
    original = SchoolRef(unitid=1, name="A")
    [updated] = _with_domains([original], {1: "duke.edu"})
    [missing] = _with_domains([SchoolRef(unitid=2, name="B")], {1: "duke.edu"})
    assert updated.domain == "duke.edu"
    assert original.domain is None
    assert missing.domain is None


def test_validate_viz_request_rejections() -> None:
    with pytest.raises(ServiceError, match="at least one unitid"):
        _validate_viz_request("comparison_table", [], ["field"])
    with pytest.raises(ServiceError, match="comparison_table needs field_keys"):
        _validate_viz_request("comparison_table", [1], None)
    with pytest.raises(ServiceError, match="stat_block needs field_keys"):
        _validate_viz_request("stat_block", [1], [])
    with pytest.raises(ServiceError, match="unknown viz type"):
        _validate_viz_request("pie", [1], ["field"])


def test_viz_result_from_spec_all_unavailable_is_honest_error() -> None:
    result, emitted = _viz_result_from_spec(
        spec_with_cells([envelope("x", available=False)]), SourceRegistry()
    )
    assert result["ok"] is False
    assert "do not invent values" in result["error"]
    assert emitted is None


def test_viz_result_from_spec_available_cells_register_sources_and_emit_spec() -> None:
    registry = SourceRegistry()
    result, emitted = _viz_result_from_spec(
        spec_with_cells([envelope("x", available=True), envelope("y", available=False)]),
        registry,
    )
    assert result == {
        "ok": True,
        "viz": "comparison_table rendered with 1 values",
        "sources": ["[1]"],
    }
    assert emitted is not None
    assert emitted["type"] == "comparison_table"
    assert len(registry.entries) == 1


async def test_domains_extracts_registrable_domains(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_compare_schools(
        _catalog: object, unitids: list[int], field_keys: list[str]
    ) -> CompareResult:
        assert field_keys == ["institution.website"]
        return CompareResult(
            schools=[
                SchoolBasics(unitid=unitids[0], name="A"),
                SchoolBasics(unitid=unitids[1], name="B"),
            ],
            rows=[
                CompareRow(
                    field="institution.website",
                    label="Website",
                    cells=[
                        envelope("institution.website").model_copy(
                            update={"display": "https://www.duke.edu/"}
                        ),
                        envelope("institution.website", available=False),
                    ],
                )
            ],
        )

    monkeypatch.setattr(viz, "compare_schools", fake_compare_schools)

    assert await _domains(fake_catalog(), [198419, 166683]) == {
        198419: "duke.edu",
        166683: None,
    }


async def test_domains_degrades_to_empty_on_lookup_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def failing_compare_schools(
        _catalog: object, _unitids: list[int], _field_keys: list[str]
    ) -> CompareResult:
        raise RuntimeError("db down")

    monkeypatch.setattr(viz, "compare_schools", failing_compare_schools)

    assert await _domains(fake_catalog(), [1]) == {}


async def test_comparison_spec_builds_rows_and_title(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_compare_schools(
        _catalog: object, unitids: list[int], field_keys: list[str]
    ) -> CompareResult:
        if field_keys == ["institution.website"]:
            return CompareResult(
                schools=[SchoolBasics(unitid=unitid, name=str(unitid)) for unitid in unitids],
                rows=[
                    CompareRow(
                        field="institution.website",
                        label="Website",
                        cells=[envelope("institution.website") for _unitid in unitids],
                    )
                ],
            )
        assert field_keys == ["admissions.acceptance_rate"]
        return CompareResult(
            schools=[
                SchoolBasics(unitid=198419, name="Duke University"),
                SchoolBasics(unitid=166683, name="MIT"),
            ],
            rows=[
                CompareRow(
                    field="admissions.acceptance_rate",
                    label="Acceptance rate",
                    cells=[
                        envelope("admissions.acceptance_rate"),
                        envelope("admissions.acceptance_rate"),
                    ],
                )
            ],
        )

    monkeypatch.setattr(viz, "compare_schools", fake_compare_schools)

    spec = await _comparison_spec(
        fake_catalog(), [198419, 166683], ["admissions.acceptance_rate"], None
    )

    assert spec.type == "comparison_table"
    assert spec.title == "Duke University vs MIT"
    assert [school.unitid for school in spec.schools] == [198419, 166683]
    assert spec.rows[0].label == "Acceptance rate"


async def test_comparison_spec_rejects_unknown_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_compare_schools(
        _catalog: object, _unitids: list[int], _field_keys: list[str]
    ) -> CompareResult:
        return CompareResult(
            schools=[SchoolBasics(unitid=1, name="A")],
            rows=[],
            errors=[],
        )

    monkeypatch.setattr(viz, "compare_schools", fake_compare_schools)

    with pytest.raises(ServiceError, match="unknown field key"):
        await _comparison_spec(fake_catalog(), [1], ["missing"], None)


async def test_stat_block_spec_resolves_school_and_filters_field_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_resolve_school(_catalog: object, query: str) -> ResolveMatch:
        assert query == "198419"
        return ResolveMatch(
            school=SchoolBasics(unitid=198419, name="Duke University"),
            coverage_tier="cds_extracted",
            tier_explanation="CDS extracted",
        )

    async def fake_get_values(_catalog: object, unitid: int, field_keys: list[str]) -> list[object]:
        assert unitid == 198419
        assert field_keys == ["admissions.acceptance_rate"]
        return [envelope("admissions.acceptance_rate")]

    async def fake_domains(_catalog: object, unitids: list[int]) -> dict[int, str | None]:
        assert unitids == [198419]
        return {198419: "duke.edu"}

    monkeypatch.setattr(viz, "resolve_school", fake_resolve_school)
    monkeypatch.setattr(viz, "get_values", fake_get_values)
    monkeypatch.setattr(viz, "_domains", fake_domains)

    spec = await _stat_block_spec(
        fake_catalog(), [198419], ["admissions.acceptance_rate"], None
    )

    assert spec.type == "stat_block"
    assert spec.title == "Duke University — key facts"
    assert spec.schools[0].domain == "duke.edu"
    assert spec.rows[0].label == "admissions.acceptance_rate"


async def test_build_spec_dispatches_by_type(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[str] = []

    async def fake_comparison_spec(
        _catalog: object,
        _unitids: list[int],
        _field_keys: list[str] | None,
        _title: str | None,
    ) -> RenderSpec:
        called.append("comparison")
        return spec_with_cells([envelope("x")])

    async def fake_stat_block_spec(
        _catalog: object,
        _unitids: list[int],
        _field_keys: list[str] | None,
        _title: str | None,
    ) -> RenderSpec:
        called.append("stat")
        return spec_with_cells([envelope("x")]).model_copy(update={"type": "stat_block"})

    monkeypatch.setattr(viz, "_comparison_spec", fake_comparison_spec)
    monkeypatch.setattr(viz, "_stat_block_spec", fake_stat_block_spec)

    comparison = await _build_spec(fake_catalog(), "comparison_table", [1], ["x"], None)
    stat_block = await _build_spec(fake_catalog(), "stat_block", [1], ["x"], None)
    assert comparison.type == "comparison_table"
    assert stat_block.type == "stat_block"
    assert called == ["comparison", "stat"]


async def test_render_viz_returns_service_errors_without_emitting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_build_spec(
        _catalog: object,
        _type: str,
        _unitids: list[int],
        _field_keys: list[str] | None,
        _title: str | None,
    ) -> RenderSpec:
        raise ServiceError("bad request")

    emitted: list[dict[str, object]] = []
    monkeypatch.setattr(viz, "_build_spec", fake_build_spec)

    result = await render_viz(fake_catalog(), SourceRegistry(), emitted, "stat_block", [1], ["x"])

    assert result == {"ok": False, "error": "bad request"}
    assert emitted == []


async def test_render_viz_returns_honest_db_error_without_emitting(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_build_spec(
        _catalog: object,
        _type: str,
        _unitids: list[int],
        _field_keys: list[str] | None,
        _title: str | None,
    ) -> RenderSpec:
        raise RuntimeError("db down")

    emitted: list[dict[str, object]] = []
    monkeypatch.setattr(viz, "_build_spec", fake_build_spec)

    result = await render_viz(fake_catalog(), SourceRegistry(), emitted, "stat_block", [1], ["x"])

    assert result["ok"] is False
    assert "do not invent values" in result["error"]
    assert emitted == []


async def test_render_viz_emits_available_spec(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_build_spec(
        _catalog: object,
        _type: str,
        _unitids: list[int],
        _field_keys: list[str] | None,
        _title: str | None,
    ) -> RenderSpec:
        return spec_with_cells([envelope("x")])

    emitted: list[dict[str, object]] = []
    monkeypatch.setattr(viz, "_build_spec", fake_build_spec)

    result = await render_viz(
        fake_catalog(), SourceRegistry(), emitted, "comparison_table", [1], ["x"]
    )

    assert result["ok"] is True
    assert len(emitted) == 1


async def test_render_viz_stages_once_for_equivalent_successful_specs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    specs = [
        spec_with_cells([envelope("x")], title="First title"),
        spec_with_cells([envelope("x")], title="Second title"),
    ]

    async def fake_build_spec(
        _catalog: object,
        _type: str,
        _unitids: list[int],
        _field_keys: list[str] | None,
        _title: str | None,
    ) -> RenderSpec:
        return specs.pop(0)

    registry = SourceRegistry()
    emitted: list[dict[str, object]] = []
    monkeypatch.setattr(viz, "_build_spec", fake_build_spec)

    first = await render_viz(
        fake_catalog(), registry, emitted, "comparison_table", [1], ["x"]
    )
    second = await render_viz(
        fake_catalog(), registry, emitted, "comparison_table", [1], ["x"]
    )

    assert first["ok"] is True
    assert second["ok"] is True
    assert first["sources"] == ["[1]"]
    assert second["sources"] == ["[1]"]
    assert len(emitted) == 1
    assert emitted[0]["title"] == "First title"


async def test_render_viz_stages_distinct_specs_separately(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    specs = [
        spec_with_cells([envelope("x")]),
        spec_with_cells([envelope("y")]),
        spec_with_cells([envelope("x")], school=SchoolRef(unitid=2, name="B")),
    ]

    async def fake_build_spec(
        _catalog: object,
        _type: str,
        _unitids: list[int],
        _field_keys: list[str] | None,
        _title: str | None,
    ) -> RenderSpec:
        return specs.pop(0)

    emitted: list[dict[str, object]] = []
    monkeypatch.setattr(viz, "_build_spec", fake_build_spec)

    first = await render_viz(
        fake_catalog(), SourceRegistry(), emitted, "comparison_table", [1], ["x"]
    )
    second = await render_viz(
        fake_catalog(), SourceRegistry(), emitted, "comparison_table", [1], ["y"]
    )
    third = await render_viz(
        fake_catalog(), SourceRegistry(), emitted, "comparison_table", [2], ["x"]
    )

    assert first["ok"] is True
    assert second["ok"] is True
    assert third["ok"] is True
    assert len(emitted) == 3


async def test_render_viz_unavailable_spec_stages_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_build_spec(
        _catalog: object,
        _type: str,
        _unitids: list[int],
        _field_keys: list[str] | None,
        _title: str | None,
    ) -> RenderSpec:
        return spec_with_cells([envelope("x", available=False)])

    emitted: list[dict[str, object]] = []
    monkeypatch.setattr(viz, "_build_spec", fake_build_spec)

    result = await render_viz(
        fake_catalog(), SourceRegistry(), emitted, "comparison_table", [1], ["x"]
    )

    assert result["ok"] is False
    assert "do not invent values" in result["error"]
    assert emitted == []
