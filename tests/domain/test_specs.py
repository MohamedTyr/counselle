"""Spec types: clarify spec (ARCHITECTURE §12.1), events (§6)."""

import pytest
from pydantic import ValidationError

from domain.events import Event, ev_delta
from domain.specs import (
    ClarifyOption,
    ClarifySpec,
    ColumnInput,
    MetricCellInput,
    OpaqueRenderSpec,
    ProfileCellInput,
    SourcedCellInput,
    TabularRenderSpec,
    UnavailableCellInput,
    VizRowInput,
    parse_render_spec,
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


@pytest.mark.parametrize(
    "payload, expected",
    [
        ({"metric_ref": "admissions.applicants_total"}, MetricCellInput),
        ({"profile_field": "location.city"}, ProfileCellInput),
        ({"display": "42%", "raw": 42, "marker": "[1]"}, SourcedCellInput),
        ({"unavailable": True}, UnavailableCellInput),
    ],
)
def test_cell_variants_are_exact_and_strict(payload: dict[str, object], expected: type) -> None:
    row = VizRowInput.model_validate({"label": "Applicants", "cells": [payload]})
    assert isinstance(row.cells[0], expected)
    with pytest.raises(ValidationError):
        VizRowInput.model_validate(
            {"label": "Applicants", "cells": [{**payload, "unexpected": True}]}
        )


def test_cell_variants_are_mutually_exclusive() -> None:
    with pytest.raises(ValidationError):
        VizRowInput.model_validate(
            {
                "label": "Applicants",
                "cells": [{"metric_ref": "admissions.total", "unavailable": True}],
            }
        )


def test_column_identity_and_domain_are_strict() -> None:
    assert ColumnInput(name="Web School", domain="Example.EDU.").domain == "example.edu"
    with pytest.raises(ValidationError):
        ColumnInput()
    with pytest.raises(ValidationError):
        ColumnInput(name="Web School", domain="https://example.edu/path")


def test_known_render_parser_is_strict_and_opaque_types_survive() -> None:
    known = {
        "v": 2,
        "type": "stat_block",
        "title": "Facts",
        "columns": [{"unitid": 1, "name": "School", "domain": None}],
        "rows": [
            {
                "label": "Missing",
                "cells": [
                    {
                        "v": 2,
                        "field": None,
                        "label": "Missing",
                        "display": "not available",
                        "raw": None,
                        "available": False,
                        "unit": None,
                        "citation": None,
                        "evidence": None,
                        "caveats": [],
                        "marker": None,
                    }
                ],
            }
        ],
    }
    assert isinstance(parse_render_spec(known), TabularRenderSpec)
    with pytest.raises(ValidationError):
        parse_render_spec({**known, "extra": True})
    available_without_marker = {
        **known,
        "rows": [
            {
                "label": "Value",
                "cells": [
                    {
                        **known["rows"][0]["cells"][0],
                        "display": "42",
                        "available": True,
                        "citation": {
                            "v": 2,
                            "source": "web",
                            "tier": "official",
                            "vintage": "Retrieved today",
                            "url": "https://example.edu/facts",
                        },
                    }
                ],
            }
        ],
    }
    with pytest.raises(ValidationError):
        parse_render_spec(available_without_marker)

    opaque = parse_render_spec(
        {"v": 9, "type": "community_card", "title": "Voices", "items": [{"x": 1}]}
    )
    assert isinstance(opaque, OpaqueRenderSpec)
    assert opaque.model_dump(mode="json")["items"] == [{"x": 1}]
