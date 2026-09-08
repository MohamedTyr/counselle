from datetime import UTC, datetime

from app.sources import SourceRegistry, source_key
from domain.envelope import Citation

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


def test_conditional_identity_and_marker_lookup() -> None:
    registry = SourceRegistry()
    assert registry.register_source(cds(), "School — Common Data Set 2024-25") == "[1]"
    assert (
        registry.register_source(cds().model_copy(update={"vintage": "other"}), "ignored") == "[1]"
    )
    assert registry.lookup_marker("[1]") is not None
    assert registry.lookup_marker("[001]") is None
    assert source_key(cds()) == ("cds", SHA)


def test_fork_rollback_and_commit_are_immutable() -> None:
    registry = SourceRegistry()
    registry.register_source(cds(), "School")
    candidate = registry.fork()
    other = cds().model_copy(update={"document_sha256": "b" * 64})
    candidate.register_source(other, "Other School")
    assert len(registry.entries) == 1
    registry.commit_from(candidate)
    assert len(registry.entries) == 2
    assert registry.entries[1].citation.document_sha256 == "b" * 64


def test_entries_property_does_not_expose_a_mutable_registry_list() -> None:
    registry = SourceRegistry()
    registry.register_source(cds(), "School")
    assert isinstance(registry.entries, tuple)
