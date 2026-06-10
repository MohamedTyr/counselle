"""Spec types: clarify spec (ARCHITECTURE §12.1), render spec (§17), events (§6)."""

import pytest
from pydantic import ValidationError

from domain.envelope import Citation, CitationEnvelope
from domain.events import Event, ev_delta
from domain.specs import (
    ClarifyOption,
    ClarifySpec,
    RenderSpec,
    SchoolRef,
    ScoreBand,
    VizRow,
)


def _options(n: int) -> list[ClarifyOption]:
    return [ClarifyOption(label=f"Option {i}", hint=f"hint {i}") for i in range(n)]


def _clarify(n_options: int) -> ClarifySpec:
    return ClarifySpec(
        question="Good for what? A few things shape the answer:",
        header="What matters",
        multi_select=False,
        options=_options(n_options),
    )


def _cell(field: str) -> CitationEnvelope:
    return CitationEnvelope(
        field=field,
        label=field,
        display="700",
        raw=700,
        available=True,
        unit="count",
        citation=Citation(
            source="ipeds",
            tier="official",
            vintage="IPEDS 2024-25 (provisional)",
            raw_table="raw.ipeds_adm2024",
        ),
    )


def _score_band_spec(rows: list[VizRow]) -> RenderSpec:
    return RenderSpec(
        type="score_band",
        title="SAT middle 50% at Duke",
        schools=[SchoolRef(unitid=198419, name="Duke University")],
        rows=rows,
        band=ScoreBand(test="sat"),
    )


# --- ClarifySpec: 2-4 options, never an intake form ---


def test_clarify_spec_accepts_two_to_four_options() -> None:
    # Arrange / Act / Assert
    for n in (2, 3, 4):
        spec = _clarify(n)
        assert len(spec.options) == n
        assert spec.v == 1


def test_clarify_spec_rejects_a_single_option() -> None:
    # Arrange / Act / Assert
    with pytest.raises(ValidationError):
        _clarify(1)


def test_clarify_spec_rejects_five_options() -> None:
    # Arrange / Act / Assert
    with pytest.raises(ValidationError):
        _clarify(5)


# --- RenderSpec score_band: never a fabricated SAT composite ---


def test_score_band_accepts_separate_sat_section_rows() -> None:
    # Arrange
    rows = [
        VizRow(
            label="SAT EBRW",
            cells=[_cell("admissions.sat_ebrw_25"), _cell("admissions.sat_ebrw_75")],
        ),
        VizRow(
            label="SAT Math",
            cells=[_cell("admissions.sat_math_25"), _cell("admissions.sat_math_75")],
        ),
    ]

    # Act
    spec = _score_band_spec(rows)

    # Assert
    assert spec.type == "score_band"
    assert spec.v == 1
    assert len(spec.rows) == 2


def test_score_band_rejects_a_fabricated_sat_composite_row() -> None:
    # IPEDS SAT percentiles are per SECTION — summing EBRW + Math into one
    # "composite" row fabricates a 1600-scale number (ARCHITECTURE §17).
    # Arrange
    composite_row = VizRow(
        label="SAT composite",
        cells=[_cell("admissions.sat_ebrw_25"), _cell("admissions.sat_math_25")],
    )

    # Act / Assert
    with pytest.raises(ValidationError):
        _score_band_spec([composite_row])


# --- Event envelope: versioned protocol (ARCHITECTURE §6) ---


def test_event_serializes_with_protocol_version_one() -> None:
    # Arrange
    event = ev_delta("Duke admits about ")

    # Act
    dumped = event.model_dump()

    # Assert
    assert isinstance(event, Event)
    assert dumped["v"] == 1
    assert dumped["type"] == "delta"
    assert dumped["data"]["text"] == "Duke admits about "
