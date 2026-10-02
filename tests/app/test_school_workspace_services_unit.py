"""Fast service regressions for the school workspace honesty contract."""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from typing import Any, cast
from uuid import uuid4

import pytest

from app.workspace import service_applications, service_reference, service_utils
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import ApplicationCreate, ApplicationView
from counselle_db.models import FactsQueryResult, FactValueRow, SchoolBasics, SchoolFactsStatus
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


def _test_policy_facts_result(*, value: str, observed_at: datetime) -> FactsQueryResult:
    row = FactValueRow(
        fact_key="admissions.test_policy_sat_or_act",
        tab="admissions",
        section="getting-in",
        label="Test policy",
        value=value,
        display=value,
        unit=None,
        value_type="text",
        value_num=None,
        value_text=value,
        value_bool=None,
        value_date=None,
        reported_period=None,
        reported_period_year=None,
        observed_at=observed_at,
    )
    return FactsQueryResult(
        school=SchoolBasics(unitid=1, name="Canonical School"),
        status=SchoolFactsStatus(
            facts_updated_at=observed_at, fact_count=1, has_collegedata=True, tabs={}
        ),
        rows=(row,),
        profile_snapshot_date=date(2026, 1, 1),
    )


async def test_test_policy_reads_the_current_get_facts_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fresh = datetime.now(UTC) - timedelta(days=5)

    async def fake_get_facts(*_: object, **__: object) -> FactsQueryResult:
        return _test_policy_facts_result(value="Required", observed_at=fresh)

    monkeypatch.setattr(service_reference, "get_facts", fake_get_facts)

    catalog = SimpleNamespace(settings=SimpleNamespace(facts_stale_days=120))
    result = await service_reference._compatible_test_policy(cast(Any, catalog), unitid=1)

    assert result is not None
    assert result.available
    assert result.raw == "Required"
    assert result.citation is not None
    assert result.citation.source == "db"


async def test_stale_test_policy_is_unavailable_and_requires_portal_verification(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    stale = datetime.now(UTC) - timedelta(days=200)

    async def fake_get_facts(*_: object, **__: object) -> FactsQueryResult:
        return _test_policy_facts_result(value="Optional", observed_at=stale)

    monkeypatch.setattr(service_reference, "get_facts", fake_get_facts)

    catalog = SimpleNamespace(settings=SimpleNamespace(facts_stale_days=120))
    result = await service_reference._compatible_test_policy(cast(Any, catalog), unitid=1)

    assert result is not None
    assert result.available is False
    assert result.raw is None
    assert result.display == "not available"
    assert result.citation is None
    assert result.caveats[0].kind == "stale_facts"


async def test_add_application_creates_only_the_application_and_no_children(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No tasks, ever; essays only through the supplements catalog step."""
    connection = _AddApplicationConnection()
    application = ApplicationView.model_construct(id=connection.application_id)
    supplement_calls: list[dict[str, object]] = []

    async def fake_application_view(*_: object, **__: object) -> ApplicationView:
        return application

    async def fake_required_essays(*_: object, **kwargs: object) -> int:
        supplement_calls.append(kwargs)
        return 0

    monkeypatch.setattr(service_applications, "_application_view_by_id", fake_application_view)
    monkeypatch.setattr(
        service_applications, "create_required_essays_for_new_application", fake_required_essays
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
    assert [call["application_id"] for call in supplement_calls] == [connection.application_id]


class _DeadlineFactsPool:
    """Answers both `_views_from_rows` queries, dispatched on the SQL text —
    `school_profiles` for identities, `current_school_facts` for deadlines."""

    def __init__(self, fact_rows: list[dict[str, object]]) -> None:
        self.fact_rows = fact_rows

    async def fetch(self, query: str, *_: object) -> list[dict[str, object]]:
        if "school_profiles" in query:
            return [{"unitid": 1, "name": "Example University", "city": None, "state": "MA"}]
        assert "current_school_facts" in query
        return self.fact_rows


def _application_row(*, deadline: date | None, round_: str = "ED") -> dict[str, object]:
    now = datetime.now(UTC)
    return {
        "id": uuid4(),
        "user_id": uuid4(),
        "school_unitid": 1,
        "status": "Applying",
        "list_type": "Target",
        "round": round_,
        "deadline": deadline,
        "aid_deadline": None,
        "scholarship_deadline": None,
        "notes": None,
        "intended_major": None,
        "test_plan": None,
        "cycle_year": 2027,
        "checklist": {},
        "platform": None,
        "platform_other": None,
        "created_at": now,
        "updated_at": now,
        "archived_at": None,
        "task_completed": 0,
        "task_total": 0,
        "essay_completed": 0,
        "essay_total": 0,
    }


async def test_views_from_rows_prefers_the_students_own_deadline() -> None:
    pool = _DeadlineFactsPool(
        fact_rows=[
            {
                "school_id": 1,
                "fact_key": "deadlines.early_decision",
                "value_date": date(2026, 12, 15),
                "reported_period": "2026-27",
                "observed_at": datetime.now(UTC),
            }
        ]
    )
    catalog = SimpleNamespace(
        pool=pool,
        school_domain=lambda unitid: "example.edu",
        settings=SimpleNamespace(facts_stale_days=120),
    )
    rows = [_application_row(deadline=date(2026, 11, 1))]

    views = await service_applications._views_from_rows(cast(Any, catalog), cast(Any, rows))

    assert views[0].deadline == date(2026, 11, 1)
    assert views[0].deadline_source == "student"
    assert views[0].deadline_checked_at is None
    assert views[0].deadline_inherited_date == date(2026, 12, 15)
    assert views[0].deadline_inherited_checked_at is not None


async def test_views_from_rows_inherits_from_facts_when_unset() -> None:
    checked = datetime.now(UTC)
    pool = _DeadlineFactsPool(
        fact_rows=[
            {
                "school_id": 1,
                "fact_key": "deadlines.early_decision",
                "value_date": date(2026, 11, 1),
                "reported_period": "2026-27",
                "observed_at": checked,
            }
        ]
    )
    catalog = SimpleNamespace(
        pool=pool,
        school_domain=lambda unitid: "example.edu",
        settings=SimpleNamespace(facts_stale_days=120),
    )
    rows = [_application_row(deadline=None)]

    views = await service_applications._views_from_rows(cast(Any, catalog), cast(Any, rows))

    assert views[0].deadline == date(2026, 11, 1)
    assert views[0].deadline_source == "facts"
    assert views[0].deadline_checked_at == checked.date()
    assert views[0].deadline_inherited_date == date(2026, 11, 1)
    assert views[0].deadline_inherited_checked_at == checked.date()


async def test_school_identity_does_not_require_optional_pipeline_city_column() -> None:
    pool = _IdentityPool()
    catalog = SimpleNamespace(
        pool=pool,
        school_domain=lambda unitid: "example.edu",
    )

    identities = await service_utils.school_identities(cast(Any, catalog), [1])

    assert "id AS unitid, name, city, state, official_domain" in pool.query
    assert identities[1].city is None
    assert identities[1].state == "MA"
    assert identities[1].website_url == "https://example.edu"
