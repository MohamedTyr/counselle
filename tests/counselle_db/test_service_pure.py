from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from counselle_db import service
from counselle_db.models import FieldKeyError, ServiceError
from counselle_db.service import (
    _CONTROL_DISPLAY,
    _apply_fallback,
    _campus_rank,
    _decode_hints_for,
    _enrollment_count,
    _fos_count,
    _fos_number,
    _guard_sql,
    _shortlist_sections,
    compare_schools,
    envelope_for,
    get_diversity,
    get_programs,
    get_values,
    national_benchmark,
    query_database,
)
from domain.envelope import Citation, CitationEnvelope
from domain.normalize import FieldMeta


class Row(dict[str, object]):
    def __iter__(self) -> Any:
        return iter(self.values())


class FakeCatalog:
    pool = object()
    scorecard_filename = "Most-Recent-Cohorts-Institution_05192025.csv"
    ipeds_cycle_year = 2024

    def __init__(self) -> None:
        self.fields_by_key = {
            "admissions.acceptance_rate": FieldMeta(
                key="admissions.acceptance_rate",
                label="Acceptance rate",
                category="admissions",
                data_type="percent",
                source="scorecard",
                raw_table="field_values",
            ),
            "cost.tuition": FieldMeta(
                key="cost.tuition",
                label="Tuition",
                category="cost",
                data_type="currency",
                source="ipeds",
                raw_table="field_values",
            ),
            "institution.control_code": FieldMeta(
                key="institution.control_code",
                label="Control",
                category="institution",
                data_type="int",
                source="ipeds",
                raw_table="field_values",
            ),
            "institution.name": FieldMeta(
                key="institution.name",
                label="Name",
                category="institution",
                data_type="text",
                source="ipeds",
                raw_table="field_values",
            ),
        }

    async def decode_map_for(self, meta: FieldMeta) -> dict[str, str] | None:
        if meta.key == "institution.control_code":
            return {"1": "Public"}
        return None


def fake_catalog() -> Any:
    return FakeCatalog()


def envelope(field: str, *, available: bool) -> CitationEnvelope:
    return CitationEnvelope(
        field=field,
        label=field,
        display="value" if available else "not available",
        raw="value" if available else None,
        available=available,
        citation=Citation(source="ipeds", tier="official", vintage="IPEDS 2024"),
    )


@pytest.mark.parametrize(
    ("name", "rank"),
    [
        ("Duke University", 0),
        ("Penn State - Harrisburg", 1),
        ("X - Main Campus", 0),
        ("X - main campus", 0),
    ],
)
def test_campus_rank(name: str, rank: int) -> None:
    assert _campus_rank(name) == rank


@pytest.mark.parametrize(
    ("text", "expected"),
    [(None, None), ("1234", 1234.0), ("PS", None), ("NA", None), ("", None), ("12.5", 12.5)],
)
def test_fos_number(text: str | None, expected: float | None) -> None:
    assert _fos_number(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [(None, None), ("1234", 1234), ("PS", None), ("NA", None), ("", None), ("12.5", 12)],
)
def test_fos_count(text: str | None, expected: int | None) -> None:
    assert _fos_count(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [(None, None), ("500", 500), ("-2", None), ("abc", None), ("500.0", 500)],
)
def test_enrollment_count(text: str | None, expected: int | None) -> None:
    assert _enrollment_count(text) == expected


def test_control_display_decode_or_passthrough() -> None:
    assert _CONTROL_DISPLAY.get("public", "public") == "Public"
    assert _CONTROL_DISPLAY.get("tribal", "tribal") == "tribal"


def test_shortlist_sections_filters_and_rejects_unknown() -> None:
    all_sections = _shortlist_sections(None)
    picked = _shortlist_sections(["b"])
    assert len(all_sections) >= 6
    assert [section["id"] for section in picked] == ["B"]
    with pytest.raises(ServiceError, match="no such dossier sections"):
        _shortlist_sections(["Z"])


def test_apply_fallback_branches() -> None:
    primary = envelope("primary", available=True)
    unavailable = envelope("primary", available=False)
    fallback = envelope("fallback", available=True)
    assert (
        _apply_fallback({"key": "primary", "fallback": "fallback"}, {"primary": primary})
        is primary
    )
    assert (
        _apply_fallback(
            {"key": "primary", "fallback": "fallback"},
            {"primary": unavailable, "fallback": fallback},
        )
        is fallback
    )
    assert (
        _apply_fallback({"key": "primary", "fallback": "fallback"}, {"primary": unavailable})
        is unavailable
    )
    assert _apply_fallback({"key": "primary"}, {}) is None


async def test_envelope_for_normalizes_dates_and_cites() -> None:
    catalog = fake_catalog()
    env = await envelope_for(
        catalog,
        1,
        catalog.fields_by_key["admissions.acceptance_rate"],
        0.074,
        None,
    )
    assert env.display == "7.4%"
    assert env.available is True
    assert env.citation.source == "scorecard"
    assert "published May 2025" in env.citation.vintage


async def test_get_values_returns_errors_and_missing_envelopes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch(_pool: object, _sql: str, _unitid: int, _keys: list[str]) -> list[Row]:
        return [
            Row(
                field_key="admissions.acceptance_rate",
                value=0.1,
                cycle_year=None,
            )
        ]

    catalog = fake_catalog()
    monkeypatch.setattr(service, "fetch", fake_fetch)

    results = await get_values(
        catalog,
        1,
        ["admissions.acceptance_rate", "cost.tuition", "missing.key"],
    )

    assert isinstance(results[0], CitationEnvelope)
    assert results[0].display == "10%"
    assert isinstance(results[1], CitationEnvelope)
    assert results[1].available is False
    assert isinstance(results[2], FieldKeyError)


async def test_compare_schools_builds_missing_cells_and_field_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch(_pool: object, sql: str, *args: object) -> list[Row]:
        if "FROM schools" in sql:
            return [
                Row(
                    unitid=1,
                    name="A",
                    city="A City",
                    state="NC",
                    control="public",
                    level="4-year",
                ),
                Row(
                    unitid=2,
                    name="B",
                    city="B City",
                    state="MA",
                    control="public",
                    level="4-year",
                ),
            ]
        return [Row(unitid=1, field_key="cost.tuition", value=50000, cycle_year=2024)]

    monkeypatch.setattr(service, "fetch", fake_fetch)

    result = await compare_schools(fake_catalog(), [1, 2], ["cost.tuition", "missing.key"])

    assert [school.unitid for school in result.schools] == [1, 2]
    assert result.rows[0].cells[0].display == "$50,000"
    assert result.rows[0].cells[1].available is False
    assert result.errors[0].field == "missing.key"


async def test_compare_schools_rejects_bad_shapes_and_missing_schools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    with pytest.raises(ServiceError, match="compare 1"):
        await compare_schools(fake_catalog(), [], ["cost.tuition"])
    with pytest.raises(ServiceError, match="compare 1"):
        await compare_schools(fake_catalog(), [1], [])

    async def fake_fetch(_pool: object, _sql: str, *_args: object) -> list[Row]:
        return []

    monkeypatch.setattr(service, "fetch", fake_fetch)
    with pytest.raises(ServiceError, match="not in our database"):
        await compare_schools(fake_catalog(), [1], ["cost.tuition"])


async def test_national_benchmark_normalizes_stats_and_rejects_bad_fields(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch(_pool: object, _sql: str, *_args: object) -> list[Row]:
        return [Row(n=10, median=0.5, mean=0.55, p25=0.25, p75=0.75)]

    catalog = fake_catalog()
    monkeypatch.setattr(service, "fetch", fake_fetch)

    result = await national_benchmark(catalog, "admissions.acceptance_rate")

    assert result.median.display == "50%"
    assert result.citation.caveat is not None
    assert "National distribution across 10" in result.citation.caveat
    with pytest.raises(ServiceError, match="unknown field key"):
        await national_benchmark(catalog, "missing")
    with pytest.raises(ServiceError, match="not numeric"):
        await national_benchmark(catalog, "institution.name")


async def test_national_benchmark_rejects_empty_distribution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch(_pool: object, _sql: str, *_args: object) -> list[Row]:
        return [Row(n=0, median=None, mean=None, p25=None, p75=None)]

    monkeypatch.setattr(service, "fetch", fake_fetch)

    with pytest.raises(ServiceError, match="no values stored"):
        await national_benchmark(fake_catalog(), "admissions.acceptance_rate")


async def test_get_programs_decodes_suppressed_cells_and_filters_cip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch(_pool: object, _sql: str, *_args: object) -> list[Row]:
        return [
            Row(
                CIPCODE="11.0101",
                CIPDESC="Computer Science",
                CREDLEV="3",
                CREDDESC=None,
                IPEDSCOUNT2="12.5",
                DEBT_ALL_STGP_ANY_MDN="PS",
                DEBT_ALL_STGP_ANY_MDN10YRPAY="100.25",
                EARN_MDN_1YR="NA",
                EARN_MDN_4YR="75000",
                EARN_MDN_5YR="",
            ),
            Row(
                CIPCODE="52.0201",
                CIPDESC="Business",
                CREDLEV="3",
                CREDDESC="Bachelor's Degree",
                IPEDSCOUNT2="10",
                DEBT_ALL_STGP_ANY_MDN="1",
                DEBT_ALL_STGP_ANY_MDN10YRPAY="2",
                EARN_MDN_1YR="3",
                EARN_MDN_4YR="4",
                EARN_MDN_5YR="5",
            ),
        ]

    monkeypatch.setattr(service, "fetch", fake_fetch)

    programs = await get_programs(fake_catalog(), 1, cip_prefix="11")

    assert len(programs) == 1
    assert programs[0].completions == 12
    assert programs[0].debt_median is None
    assert programs[0].earnings_4yr == 75000.0
    with pytest.raises(ServiceError, match="unknown credlev"):
        await get_programs(fake_catalog(), 1, credlev=999)


async def test_get_diversity_maps_rows_and_empty_result(monkeypatch: pytest.MonkeyPatch) -> None:
    race_values = {
        f"{stem}{suffix}": "1"
        for stem, _label in service._RACE_GROUPS
        for suffix in ("T", "M", "W")
    }
    row = Row(EFTOTLT="100", EFTOTLM="40", EFTOTLW="-2", **race_values)
    calls = 0

    async def fake_fetch(_pool: object, _sql: str, *_args: object) -> list[Row]:
        nonlocal calls
        calls += 1
        return [row] if calls == 1 else []

    monkeypatch.setattr(service, "fetch", fake_fetch)

    diversity = await get_diversity(fake_catalog(), 1)

    assert diversity is not None
    assert diversity.total == 100
    assert diversity.women is None
    assert len(diversity.by_race) == len(service._RACE_GROUPS)
    assert await get_diversity(fake_catalog(), 1) is None


def test_guard_sql_and_decode_hints_cover_escape_hatch_rules() -> None:
    assert _guard_sql(" select 1; ") == "select 1"
    for sql in [
        "select 1; select 2",
        "with moved as (delete from schools returning *) select * from moved",
        "select pg_sleep(1)",
        "explain select 1",
    ]:
        with pytest.raises(ServiceError):
            _guard_sql(sql)
    assert _decode_hints_for(
        fake_catalog(),
        ["admissions.acceptance_rate", "institution.control_code", "value", "other"],
    ) == {
        "admissions.acceptance_rate": "0–1 fraction — multiply by 100 before quoting (R2).",
        "institution.control_code": (
            "may be a coded enum — decode via counselle.decode_ipeds before quoting (R1)."
        ),
        "value": (
            "raw field_values payload — percents are 0–1 fractions, coded ints "
            "need decoding, '-2'/range tokens are sentinels (R1/R2/R4)."
        ),
    }


async def test_query_database_wraps_rows_and_truncates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_fetch(_pool: object, sql: str, *_args: object) -> list[Row]:
        assert "LIMIT $1" in sql
        return [
            Row(**{"admissions.acceptance_rate": 0.1}),
            Row(**{"admissions.acceptance_rate": 0.2}),
        ]

    monkeypatch.setattr(service, "fetch", fake_fetch)
    monkeypatch.setattr(service, "get_settings", lambda: SimpleNamespace(db_row_cap=1))

    result = await query_database(fake_catalog(), "select admissions.acceptance_rate")

    assert result.columns == ["admissions.acceptance_rate"]
    assert result.rows == [[0.1]]
    assert result.row_count == 1
    assert result.truncated is True
    assert "admissions.acceptance_rate" in result.decode_hints
