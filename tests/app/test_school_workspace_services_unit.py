"""Fast service regressions for the school workspace honesty contract."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, cast
from uuid import uuid4

import pytest

from app.workspace import service_applications, service_reference, service_utils
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import ApplicationCreate, ApplicationView
from domain.envelope import Citation, CitationEnvelope


class _AsyncContext:
    def __init__(self, value: object | None = None) -> None:
        self.value = value or self

    async def __aenter__(self) -> object:
        return self.value

    async def __aexit__(self, *_: object) -> None:
        return None


class _AddApplicationConnection:
    def __init__(self) -> None:
        self.application_id = uuid4()
        self.queries: list[str] = []

    def transaction(self) -> _AsyncContext:
        return _AsyncContext()

    async def fetchrow(self, query: str, *_: object) -> dict[str, object]:
        self.queries.append(query)
        return {"id": self.application_id}

    async def fetchval(self, query: str, *_: object) -> int:
        self.queries.append(query)
        return 1


class _Pool:
    def __init__(self, connection: _AddApplicationConnection) -> None:
        self.connection = connection

    def acquire(self) -> _AsyncContext:
        return _AsyncContext(self.connection)


class _IdentityPool:
    def __init__(self) -> None:
        self.query = ""

    async def fetch(self, query: str, *_: object) -> list[dict[str, object]]:
        self.query = query
        return [{"unitid": 1, "name": "Example University", "city": None, "state": "MA"}]


def _test_policy(*, vintage: str, source: str, raw: str) -> CitationEnvelope:
    return CitationEnvelope(
        field="test_policy",
        label="Test policy",
        display=raw,
        raw=raw,
        available=True,
        unit="text",
        citation=Citation(
            source=cast(Any, source),
            tier="official",
            vintage=vintage,
        ),
    )


async def test_test_policy_uses_compatible_preference_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stale_preferred = _test_policy(vintage="CDS 2024-25", source="cds", raw="Optional")
    compatible_fallback = _test_policy(
        vintage="IPEDS 2026-27", source="ipeds", raw="Required"
    )

    async def fake_get_values(*_: object) -> list[CitationEnvelope]:
        return [stale_preferred, compatible_fallback]

    monkeypatch.setattr(service_reference, "get_values", fake_get_values)

    result = await service_reference._compatible_test_policy(
        cast(Any, object()), unitid=1, cycle_year=2027
    )

    assert result == compatible_fallback


async def test_stale_test_policy_is_unavailable_and_requires_portal_verification(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stale = _test_policy(vintage="CDS 2024-25", source="cds", raw="Optional")

    async def fake_get_values(*_: object) -> list[CitationEnvelope]:
        return [stale]

    monkeypatch.setattr(service_reference, "get_values", fake_get_values)

    result = await service_reference._compatible_test_policy(
        cast(Any, object()), unitid=1, cycle_year=2027
    )

    assert result is not None
    assert result.available is False
    assert result.raw is None
    assert result.display == "not available for this application cycle"
    assert result.citation.caveat is not None
    assert "verify" in result.citation.caveat.lower()
    assert "portal" in result.citation.caveat.lower()


async def test_add_application_creates_only_the_application_and_no_children(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    connection = _AddApplicationConnection()
    application = ApplicationView.model_construct(id=connection.application_id)

    async def fake_application_view(*_: object, **__: object) -> ApplicationView:
        return application

    monkeypatch.setattr(
        service_applications, "_application_view_by_id", fake_application_view
    )
    catalog = SimpleNamespace(school_name=lambda unitid: "Example University")

    result = await service_applications.add_application(
        cast(Any, _Pool(connection)),
        cast(Any, catalog),
        WorkspaceEventBus(),
        user_id=uuid4(),
        actor="student",
        data=ApplicationCreate(unitid=1, cycle_year=2027, list_type="Target", round="RD"),
    )

    object_inserts = [
        query
        for query in connection.queries
        if "INSERT INTO counselle.applications" in query
        or "INSERT INTO counselle.tasks" in query
        or "INSERT INTO counselle.essays" in query
    ]
    assert result.application is application
    assert len(object_inserts) == 1
    assert "INSERT INTO counselle.applications" in object_inserts[0]
    assert all("counselle.tasks" not in query for query in connection.queries)
    assert all("counselle.essays" not in query for query in connection.queries)


async def test_school_identity_does_not_require_optional_pipeline_city_column() -> None:
    pool = _IdentityPool()
    catalog = SimpleNamespace(
        pool=pool,
        school_domain=lambda unitid: "example.edu",
    )

    identities = await service_utils.school_identities(cast(Any, catalog), [1])

    assert "NULL::text AS city" in pool.query
    assert identities[1].city is None
    assert identities[1].state == "MA"
    assert identities[1].website_url == "https://example.edu"
