from app.parked_sources import ParkedSourceStore
from app.sources import SourceRegistry
from tests.app.test_sources import cds, evidence


def test_parked_registry_preserves_pending_and_is_identity_bound() -> None:
    registry = SourceRegistry()
    marker = registry.register_source(cds(), "School")
    registry.register_pending_evidence(marker, evidence())
    store = ParkedSourceStore()
    store.park("session", "message", "user", registry)

    assert store.restore("session", "message", "other") is None
    restored = store.restore("session", "message", "user")
    assert restored is not None
    assert restored.promote_pending_evidence(1, "admissions.applicants")
    assert restored.entries_for_wire()[0].evidence[0].eid == "admissions.applicants"


def test_parked_registry_clear_is_turn_and_session_scoped() -> None:
    registry = SourceRegistry()
    registry.register_source(cds(), "School")
    store = ParkedSourceStore()
    store.park("session", "old", "user", registry)
    store.park("session", "new", "user", registry)
    store.clear("session", "old", "user")
    assert store.restore("session", "old", "user") is None
    assert store.restore("session", "new", "user") is not None
    store.clear_session("session")
    assert store.restore("session", "new", "user") is None
