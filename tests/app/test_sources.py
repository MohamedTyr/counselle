from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.sources import SourceRegistry, source_key
from domain.envelope import Citation, EvidenceItem

SHA = "a" * 64


def cds() -> Citation:
    return Citation(
        source="cds",
        tier="official",
        vintage="Common Data Set 2024-25",
        document_sha256=SHA,
        source_kind="upload",
        retrieved_at=datetime(2026, 1, 1, tzinfo=UTC),
        academic_year=2024,
        manifest_version="5.0.1",
        school_unitid=1,
    )


def evidence(eid: str = "admissions.applicants") -> EvidenceItem:
    return EvidenceItem(
        eid=eid, value_display="10", label="Applicants", page=2, excerpt="Applicants 10"
    )


def test_conditional_identity_and_marker_lookup() -> None:
    registry = SourceRegistry()
    assert registry.register_source(cds(), "School — Common Data Set 2024-25") == "[1]"
    assert (
        registry.register_source(cds().model_copy(update={"vintage": "other"}), "ignored") == "[1]"
    )
    assert registry.lookup_marker("[1]") is not None
    assert registry.lookup_marker("[001]") is None
    assert source_key(cds()) == ("cds", SHA)


def test_pending_is_runtime_only_and_exact_use_promotes() -> None:
    registry = SourceRegistry()
    marker = registry.register_source(cds(), "School — Common Data Set 2024-25")
    registry.register_pending_evidence(marker, evidence())
    assert "Applicants 10" not in str(registry.dump_state())
    assert not registry.promote_pending_evidence(1, "admissions.invented")
    assert registry.promote_pending_evidence(1, "admissions.applicants")
    assert registry.entries[0].evidence_seen_eids == ("admissions.applicants",)


def test_fork_rollback_and_commit_are_immutable() -> None:
    registry = SourceRegistry()
    registry.register_source(cds(), "School")
    candidate = registry.fork()
    candidate.register_used_evidence(1, evidence())
    assert registry.entries[0].evidence == ()
    registry.commit_from(candidate)
    assert registry.entries[0].evidence
    assert registry.entries[0].evidence[0].eid == "admissions.applicants"


def test_annotated_domain_row_hides_excerpt_and_gives_composite_marker() -> None:
    registry = SourceRegistry()
    payload = {
        "citation": cds().model_dump(mode="json"),
        "source_label": "School",
        "evidence": evidence().model_dump(mode="json"),
        "display": "10",
    }
    annotated = registry.annotate_envelopes(payload)
    assert annotated["marker"] == "[1][[evidence:1:admissions.applicants]]"
    assert "evidence" not in annotated
    assert "Applicants 10" not in str(annotated)


def test_wire_evidence_is_sorted_without_mutating_state() -> None:
    registry = SourceRegistry()
    registry.register_source(cds(), "School")
    registry.register_used_evidence(1, evidence("admissions.zed").model_copy(update={"page": 4}))
    registry.register_used_evidence(1, evidence("admissions.alpha").model_copy(update={"page": 1}))
    wire = registry.entries_for_wire()[0]
    assert [item.eid for item in wire.evidence] == ["admissions.alpha", "admissions.zed"]
    assert [item.eid for item in registry.entries[0].evidence] == [
        "admissions.zed",
        "admissions.alpha",
    ]


def test_evidence_cap_omitted_count_and_internal_round_trip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.sources.get_settings", lambda: SimpleNamespace(source_evidence_max_items=1)
    )
    registry = SourceRegistry()
    registry.register_source(cds(), "School")
    registry.register_used_evidence(1, evidence("admissions.first"))
    registry.register_used_evidence(1, evidence("admissions.second"))

    restored = SourceRegistry(registry.dump_state())
    wire = restored.entries_for_wire()[0]
    assert [item.eid for item in wire.evidence] == ["admissions.first"]
    assert wire.evidence_omitted_count == 1
    public = restored.wire_dump()[0]
    assert public["evidence_omitted_count"] == 1
    assert "evidence_seen_eids" not in public


def test_entries_property_does_not_expose_a_mutable_registry_list() -> None:
    registry = SourceRegistry()
    registry.register_source(cds(), "School")
    assert isinstance(registry.entries, tuple)
