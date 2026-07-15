from __future__ import annotations

from typing import Any, cast

import pytest

from counselle_db.packets import ManifestMetric, PacketEvidence, ParsedMetric, read_metric


def _definition(kind: str = "number") -> ManifestMetric:
    return ManifestMetric(
        ref="cost.tuition", description="Tuition", type=cast(Any, kind), unit="percent"
    )


def test_raw_percentage_is_never_scaled_and_caveats_accumulate() -> None:
    metric = ParsedMetric(
        ref="cost.tuition",
        extraction_status="verified",
        availability_status="reported",
        value=0.1,
        raw_value=" 10% ",
        evidence=PacketEvidence(page_number=1, excerpt="10%"),
    )
    row = read_metric(
        metric,
        _definition(),
        academic_year=2025,
        packet_status="partial",
        definition_match=False,
        currentness="stale",
    )
    assert row.display == "10%"
    assert row.vintage == "CDS 2025-26"
    assert row.caveat_kinds == ("partial_packet", "definition_drift", "stale_edition")


@pytest.mark.parametrize(
    "status", ["not_reported", "not_applicable", "suppressed", "not_in_template_version"]
)
def test_verified_unavailable_states_return_no_value(status: str) -> None:
    metric = ParsedMetric(
        ref="cost.tuition",
        extraction_status="verified",
        availability_status=cast(Any, status),
        value=None,
        raw_value=None,
        evidence=PacketEvidence(page_number=1, excerpt="blank"),
    )
    row = read_metric(
        metric,
        _definition(),
        academic_year=2025,
        packet_status="validated",
        definition_match=True,
        currentness="current",
    )
    assert not row.available
    assert row.value is None
    assert status in row.caveat_kinds
