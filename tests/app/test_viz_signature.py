from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from app.viz_signature import viz_payload_signature
from domain.envelope import Citation, CitationEnvelope, EvidenceItem
from domain.specs import SchoolRef, TabularRenderSpec, VizRow


class Unserializable:
    pass


def test_viz_payload_signature_handles_non_json_safe_payloads() -> None:
    payload = {
        "decimal": Decimal("1.23"),
        42: {"object": Unserializable()},
    }

    signature = viz_payload_signature(payload)

    assert isinstance(signature, str)
    assert signature


def _spec(*, available: bool, title: str = "One") -> TabularRenderSpec:
    return TabularRenderSpec(
        type="stat_block",
        title=title,
        columns=(SchoolRef(unitid=None, name="Web School", domain="example.edu"),),
        rows=(
            VizRow(
                label="Value",
                cells=(
                    CitationEnvelope(
                        field=None,
                        label="Value",
                        display="not available",
                        available=False,
                    ),
                ),
            ),
        ),
    )


def test_signature_ignores_title_and_decorative_domain_but_not_availability() -> None:
    first = _spec(available=False)
    decorated = first.model_copy(
        update={
            "title": "Different",
            "columns": (first.columns[0].model_copy(update={"domain": "other.edu"}),),
        }
    )
    assert viz_payload_signature(first) == viz_payload_signature(decorated)


def test_opaque_signature_uses_the_complete_payload() -> None:
    one = {"v": 3, "type": "community_card", "title": "A", "items": [1]}
    two = {"v": 3, "type": "community_card", "title": "A", "items": [2]}
    assert viz_payload_signature(one) != viz_payload_signature(two)


def _cds_spec() -> TabularRenderSpec:
    return TabularRenderSpec(
        type="stat_block",
        title="One",
        columns=(SchoolRef(unitid=1, name="School", domain="school.edu"),),
        rows=(
            VizRow(
                label="Rate",
                cells=(
                    CitationEnvelope(
                        field="admissions.rate",
                        label="Rate",
                        display="5%",
                        raw=0.05,
                        available=True,
                        citation=Citation(
                            source="cds",
                            tier="official",
                            vintage="Common Data Set 2024-25",
                            document_sha256="a" * 64,
                            source_kind="upload",
                            retrieved_at=datetime(2026, 7, 15, tzinfo=UTC),
                            academic_year=2024,
                            manifest_version="5.0.1",
                            school_unitid=1,
                        ),
                        evidence=EvidenceItem(
                            eid="admissions.rate",
                            value_display="5%",
                            label="Rate",
                            page=1,
                            excerpt="Rate 5%",
                        ),
                        marker="[1]",
                    ),
                ),
            ),
        ),
    )


def test_signature_changes_for_every_truth_and_provenance_dimension() -> None:
    original = _cds_spec()
    cell = original.rows[0].cells[0]
    assert cell.citation is not None and cell.evidence is not None
    mutations = [
        cell.model_copy(update={"display": "6%"}),
        cell.model_copy(update={"raw": 0.06}),
        cell.model_copy(update={"marker": "[2]"}),
        cell.model_copy(
            update={"citation": cell.citation.model_copy(update={"document_sha256": "b" * 64})}
        ),
        cell.model_copy(
            update={"citation": cell.citation.model_copy(update={"profile_sha256": "c" * 64})}
        ),
        cell.model_copy(
            update={
                "citation": cell.citation.model_copy(
                    update={"vintage": "Common Data Set 2023-24", "academic_year": 2023}
                )
            }
        ),
        cell.model_copy(
            update={"citation": cell.citation.model_copy(update={"tier": "community"})}
        ),
        cell.model_copy(
            update={
                "evidence": cell.evidence.model_copy(update={"excerpt": "Different exact evidence"})
            }
        ),
    ]
    baseline = viz_payload_signature(original)
    for mutation in mutations:
        changed = original.model_copy(
            update={"rows": (original.rows[0].model_copy(update={"cells": (mutation,)}),)}
        )
        assert viz_payload_signature(changed) != baseline


def test_available_and_unavailable_cells_never_collide() -> None:
    available = _cds_spec()
    unavailable = available.model_copy(
        update={
            "rows": (
                VizRow(
                    label="Rate",
                    cells=(
                        CitationEnvelope(
                            field="admissions.rate",
                            label="Rate",
                            display="not available",
                            available=False,
                        ),
                    ),
                ),
            )
        }
    )
    assert viz_payload_signature(available) != viz_payload_signature(unavailable)
