"""Regression test for `GET /v1/schools/explore` 500ing on every request.

`ExploreQuery` was bound via `query: ExploreQuery = Depends()`. FastAPI's
`Depends()` on a bare `BaseModel` subclass introspects *pydantic's own
generated `__signature__`* for that class rather than its `model_fields` --
and for a `default_factory` field, pydantic's signature puts the
display-only `_HAS_DEFAULT_FACTORY` sentinel in as the default (it mimics
stdlib dataclasses; the factory is never meant to be read off
`Signature.default`). FastAPI passed that sentinel straight through as the
literal default, so `ExploreQuery()` validation failed on every request that
omitted a list field -- i.e. every request. `tests/app/facts/test_service_explore.py`
never caught this because it calls `run_explore()` directly, bypassing
FastAPI's real query-binding layer entirely.

This test goes through the actual route via `TestClient`, which is the only
way to exercise `Depends()`/`Query()` binding at all -- calling `run_explore`
or `ExploreQuery(...)` directly cannot reproduce this class of bug.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
import structlog
from fastapi import FastAPI
from fastapi.testclient import TestClient
from structlog.testing import capture_logs

from adapters.facts_store import EXPLORE_COLUMNS
from api import context as api_context
from api.auth import current_active_user
from api.context import ERROR_MESSAGE, install_middleware
from api.routes import schools_facts as schools_facts_routes
from app.facts.explore_models import ExploreResponse, FilterOptions, FitProfileSummary
from app.workspace.models import Academics, Profile
from counselle_db import service as db_service
from counselle_db.admissions_fit_evidence import record_admissions_fit_batch_read_receipt
from counselle_db.models import FactValueRow
from tests.api.conftest import _test_user


def _empty_explore_response() -> ExploreResponse:
    return ExploreResponse(
        schools=(),
        page=1,
        page_size=20,
        total=0,
        total_is_capped=False,
        browsable_total=0,
        catalog_total=0,
        exclusions=(),
        sorted_null_tail=None,
        control_counts={},
        narrowest=None,
        filter_options=FilterOptions(region=(), campus_setting=(), religious_affiliation=()),
        facts_observed_from=None,
        band_caption="",
        entrance_difficulty_note="",
        majors_match_note="",
        religious_affiliation_note="",
        fit_profile_summary=FitProfileSummary(
            has_academic_candidate=False,
            has_complete_test_candidate=False,
            suggested_profile_fields=("gpa", "class_rank", "test_scores"),
        ),
    )


class _ProfileReadConnection:
    """A one-query Profile store for unmocked Explore-route composition tests."""

    def __init__(self, rows_by_user: dict[object, dict[str, object]]) -> None:
        self.rows_by_user = rows_by_user
        self.fetchrow_calls: list[tuple[str, tuple[object, ...]]] = []

    async def fetchrow(self, sql: str, *args: object) -> dict[str, object] | None:
        self.fetchrow_calls.append((sql, args))
        data = self.rows_by_user.get(args[0])
        return {"data": data} if data is not None else None


class _ProfileReadPool:
    def __init__(self, connection: _ProfileReadConnection) -> None:
        self.connection = connection

    @asynccontextmanager
    async def acquire(self):  # type: ignore[no-untyped-def]
        yield self.connection


def _route_app(*, app_pool: object) -> FastAPI:
    app = FastAPI()
    install_middleware(app, SimpleNamespace(cors_origins=[]))
    app.include_router(schools_facts_routes.router, prefix="/v1")
    app.state.runtime = SimpleNamespace(deps=SimpleNamespace(catalog=object()), app_pool=app_pool)
    app.state.settings = SimpleNamespace(
        facts_explore_page_size=24,
        facts_explore_max_page_size=100,
        facts_explore_max_count=3000,
        facts_stale_days=365,
    )
    return app


def _fit_explore_row() -> dict[str, object]:
    row: dict[str, object] = dict.fromkeys(EXPLORE_COLUMNS)
    row.update(
        school_id=1,
        name="Test University",
        city="Testville",
        state="CA",
        official_website="https://example.edu",
        facts_updated_at=None,
        total_count=1,
        region="West",
        control="public",
        hbcu=False,
        tribal=False,
        land_grant=False,
        admit_rate=Decimal("48"),
    )
    return row


def _fit_fact(
    key: str, *, value_num: int | None = None, value_text: str | None = None, value_type: str
) -> FactValueRow:
    return FactValueRow(
        fact_key=key,
        tab="admission",
        section="getting-in",
        label=key,
        value=None,
        display="Test value",
        unit=None,
        value_type=value_type,
        value_num=value_num,
        value_text=value_text,
        value_bool=None,
        value_date=None,
        reported_period=None,
        reported_period_year=None,
        observed_at=datetime.now(UTC),
    )


def test_explore_route_binds_with_no_query_params(monkeypatch: Any) -> None:
    """The exact repro: no params at all used to 500 with a pydantic
    ValidationError on the `_HAS_DEFAULT_FACTORY` sentinel."""
    mock = AsyncMock(return_value=_empty_explore_response())
    read_profile = AsyncMock(return_value=Profile())
    monkeypatch.setattr(schools_facts_routes, "run_explore", mock)
    monkeypatch.setattr(schools_facts_routes, "read_profile_or_empty", read_profile)
    app = FastAPI()
    app.include_router(schools_facts_routes.router, prefix="/v1")
    app.dependency_overrides[current_active_user] = _test_user
    app.state.runtime = SimpleNamespace(deps=SimpleNamespace(catalog=object()), app_pool=object())
    app.state.settings = object()

    client = TestClient(app)
    response = client.get("/v1/schools/explore")

    assert response.status_code == 200
    query = mock.call_args.args[1]
    assert query.state == []
    assert query.region == []
    assert query.include_missing == []
    assert mock.call_args.args[3] == Profile()
    read_profile.assert_awaited_once_with(app.state.runtime.app_pool, user_id=_test_user().id)
    assert response.headers["Cache-Control"] == "private, no-cache"


def test_explore_route_binds_repeated_query_params_into_lists(monkeypatch: Any) -> None:
    mock = AsyncMock(return_value=_empty_explore_response())
    read_profile = AsyncMock(return_value=Profile())
    monkeypatch.setattr(schools_facts_routes, "run_explore", mock)
    monkeypatch.setattr(schools_facts_routes, "read_profile_or_empty", read_profile)
    app = FastAPI()
    app.include_router(schools_facts_routes.router, prefix="/v1")
    app.dependency_overrides[current_active_user] = _test_user
    app.state.runtime = SimpleNamespace(deps=SimpleNamespace(catalog=object()), app_pool=object())
    app.state.settings = object()

    client = TestClient(app)
    response = client.get("/v1/schools/explore?state=CA&state=NY")

    assert response.status_code == 200
    query = mock.call_args.args[1]
    assert query.state == ["CA", "NY"]


def test_explore_route_uses_exactly_one_saved_owner_profile_not_url_scores(
    monkeypatch: Any,
) -> None:
    mock = AsyncMock(return_value=_empty_explore_response())
    saved_profile = Profile(
        academics=Academics(gpa_unweighted=Decimal("3.91"), gpa_scale=Decimal("4.0"))
    )
    read_profile = AsyncMock(return_value=saved_profile)
    monkeypatch.setattr(schools_facts_routes, "run_explore", mock)
    monkeypatch.setattr(schools_facts_routes, "read_profile_or_empty", read_profile)
    app = FastAPI()
    app.include_router(schools_facts_routes.router, prefix="/v1")
    app.dependency_overrides[current_active_user] = _test_user
    app.state.runtime = SimpleNamespace(deps=SimpleNamespace(catalog=object()), app_pool=object())
    app.state.settings = object()

    client = TestClient(app)
    response = client.get("/v1/schools/explore?sat_math=800&sat_ebrw=800&act=36")

    assert response.status_code == 200
    assert mock.call_args.args[3] is saved_profile
    query = mock.call_args.args[1]
    # URL-local Explore assumptions remain observable to its legacy filter path,
    # but only the server-loaded object gets an estimator input position.
    assert (query.sat_math, query.sat_ebrw, query.act) == (800, 800, 36)
    read_profile.assert_awaited_once_with(app.state.runtime.app_pool, user_id=_test_user().id)


def test_explore_route_does_not_replace_a_profile_read_failure_with_empty_profile(
    monkeypatch: Any,
) -> None:
    mock = AsyncMock(return_value=_empty_explore_response())
    read_profile = AsyncMock(side_effect=RuntimeError("database unavailable"))
    monkeypatch.setattr(schools_facts_routes, "run_explore", mock)
    monkeypatch.setattr(schools_facts_routes, "read_profile_or_empty", read_profile)
    app = FastAPI()
    app.include_router(schools_facts_routes.router, prefix="/v1")
    app.dependency_overrides[current_active_user] = _test_user
    app.state.runtime = SimpleNamespace(deps=SimpleNamespace(catalog=object()), app_pool=object())
    app.state.settings = object()

    client = TestClient(app, raise_server_exceptions=False)
    response = client.get("/v1/schools/explore")

    assert response.status_code == 500
    mock.assert_not_awaited()


def test_explore_route_observes_one_aggregate_after_profile_read_and_service_success(
    monkeypatch: Any,
) -> None:
    """The request boundary includes the select-only saved-Profile read."""
    clock_values = iter((10.0, 13.25))
    async def mock(*_: object) -> ExploreResponse:
        record_admissions_fit_batch_read_receipt(
            batch_query_latency_ms=7,
            fact_row_drop_counts={"invalid_detail_row": 2},
        )
        return _empty_explore_response()
    read_profile = AsyncMock(return_value=Profile())
    monkeypatch.setattr(schools_facts_routes, "run_explore", mock)
    monkeypatch.setattr(schools_facts_routes, "read_profile_or_empty", read_profile)
    monkeypatch.setattr(
        "counselle_db.admissions_fit_evidence._monotonic_clock", lambda: next(clock_values)
    )
    app = FastAPI()
    app.include_router(schools_facts_routes.router, prefix="/v1")
    app.dependency_overrides[current_active_user] = _test_user
    app.state.runtime = SimpleNamespace(deps=SimpleNamespace(catalog=object()), app_pool=object())
    app.state.settings = object()

    with capture_logs() as logs:
        response = TestClient(app).get("/v1/schools/explore")

    assert response.status_code == 200
    assert logs == [
        {
            "event": "admissions_fit_explore_observed",
            "outcome": "succeeded",
            "basis_counts": {},
            "category_counts": {},
            "applied_signal_counts": {},
            "unavailable_reason_counts": {},
            "validation_failure_counts": {},
            "fact_row_drop_counts": {"invalid_detail_row": 2},
            "batch_query_latency_ms": 7,
            "total_explore_latency_ms": 3250,
            "log_level": "info",
        }
    ]


def test_explore_route_profile_failure_emits_one_safe_failure_observation(
    monkeypatch: Any,
) -> None:
    clock_values = iter((50.0, 51.0))
    marker = "PROFILE-READ-SECRET"
    mock = AsyncMock(return_value=_empty_explore_response())
    read_profile = AsyncMock(side_effect=RuntimeError(marker))
    monkeypatch.setattr(schools_facts_routes, "run_explore", mock)
    monkeypatch.setattr(schools_facts_routes, "read_profile_or_empty", read_profile)
    monkeypatch.setattr(
        "counselle_db.admissions_fit_evidence._monotonic_clock", lambda: next(clock_values)
    )
    app = FastAPI()
    app.include_router(schools_facts_routes.router, prefix="/v1")
    app.dependency_overrides[current_active_user] = _test_user
    app.state.runtime = SimpleNamespace(deps=SimpleNamespace(catalog=object()), app_pool=object())
    app.state.settings = object()

    with capture_logs() as logs:
        response = TestClient(app, raise_server_exceptions=False).get("/v1/schools/explore")

    assert response.status_code == 500
    mock.assert_not_awaited()
    assert len(logs) == 1
    event = logs[0]
    assert event == {
        "event": "admissions_fit_explore_observed",
        "outcome": "failed",
        "basis_counts": {},
        "category_counts": {},
        "applied_signal_counts": {},
        "unavailable_reason_counts": {},
        "validation_failure_counts": {},
        "fact_row_drop_counts": {},
        "batch_query_latency_ms": None,
        "total_explore_latency_ms": 1000,
        "log_level": "info",
    }
    assert marker not in repr(event)


def test_explore_route_keeps_identical_queries_isolated_by_authenticated_owner(
    monkeypatch: Any,
) -> None:
    first_user = replace(_test_user(), id=uuid4())
    second_user = replace(_test_user(), id=uuid4())
    first_profile = Profile(
        academics=Academics(gpa_unweighted=Decimal("3.2"), gpa_scale=Decimal("4"))
    )
    second_profile = Profile(
        academics=Academics(gpa_unweighted=Decimal("4.0"), gpa_scale=Decimal("4"))
    )
    mock = AsyncMock(return_value=_empty_explore_response())
    read_profile = AsyncMock(side_effect=(first_profile, second_profile))
    monkeypatch.setattr(schools_facts_routes, "run_explore", mock)
    monkeypatch.setattr(schools_facts_routes, "read_profile_or_empty", read_profile)
    app = FastAPI()
    app.include_router(schools_facts_routes.router, prefix="/v1")
    app.state.runtime = SimpleNamespace(deps=SimpleNamespace(catalog=object()), app_pool=object())
    app.state.settings = object()
    app.dependency_overrides[current_active_user] = lambda: first_user

    client = TestClient(app)
    assert client.get("/v1/schools/explore?q=Example").status_code == 200
    app.dependency_overrides[current_active_user] = lambda: second_user
    assert client.get("/v1/schools/explore?q=Example").status_code == 200

    assert [call.args[3] for call in mock.await_args_list] == [first_profile, second_profile]
    assert [call.kwargs["user_id"] for call in read_profile.await_args_list] == [
        first_user.id,
        second_user.id,
    ]


def test_explore_route_hides_corrupt_persisted_profile_from_error_envelope_and_logs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The normal 500 path logs its event without persisted Profile contents."""
    marker = "SENSITIVE-PROFILE-MARKER"
    user = _test_user()
    pool = _ProfileReadPool(
        _ProfileReadConnection({user.id: {"basics": {"unknown_field": marker}}})
    )
    app = _route_app(app_pool=pool)
    app.dependency_overrides[current_active_user] = lambda: user

    # `capture_logs()` swaps structlog's global processor list in place, but a
    # module-level lazy proxy may already have resolved and cached a bound
    # logger from another test.  Rebinding this handler's logger *inside* the
    # capture gives the assertion a logger that is guaranteed to use the test
    # processor.  The scoped monkeypatch and capture context restore both
    # globals before this test returns.
    original_logger = api_context.logger
    configured_before = structlog.is_configured()
    config_before = structlog.get_config()
    processors_before = tuple(config_before["processors"])

    def restore_structlog_config() -> None:
        if configured_before:
            structlog.configure(
                processors=config_before["processors"],
                context_class=config_before["context_class"],
                wrapper_class=config_before["wrapper_class"],
                logger_factory=config_before["logger_factory"],
                cache_logger_on_first_use=config_before["cache_logger_on_first_use"],
            )
        else:
            structlog.reset_defaults()

    try:
        with monkeypatch.context() as scoped_monkeypatch, capture_logs() as logs:
            # A caller may have cached a CRITICAL filtering wrapper before this
            # test runs.  The route's error must still reach the capture sink;
            # this test owns the sink, not the application's log threshold.
            structlog.configure(wrapper_class=structlog.BoundLogger)
            scoped_monkeypatch.setattr(
                api_context, "logger", structlog.get_logger("api.context")
            )
            response = TestClient(app, raise_server_exceptions=False).get(
                "/v1/schools/explore"
            )

        # capture_logs() necessarily calls structlog.configure(). Restore an
        # initially-unconfigured process before checking the complete config,
        # and repeat that reset in the finally block below if any assertion or
        # request unexpectedly raises.
        restore_structlog_config()
        assert structlog.is_configured() is configured_before

        assert response.status_code == 500
        assert response.json()["error"]["message"] == ERROR_MESSAGE
        assert marker not in response.text
        observed = [event for event in logs if event["event"] == "admissions_fit_explore_observed"]
        unhandled = [event for event in logs if event["event"] == "unhandled_exception"]
        assert len(observed) == 1
        assert len(unhandled) == 1
        assert all(marker not in repr(event) for event in logs)
        event = unhandled[0]
        assert event["event"] == "unhandled_exception"
        assert event["log_level"] == "error"
        assert marker not in event["error"]
        assert marker not in event["traceback"]
        assert marker not in str(event)

        assert api_context.logger is original_logger
        config_after = structlog.get_config()
        assert config_after == config_before
        if configured_before:
            assert config_after["processors"] is config_before["processors"]
        assert tuple(config_after["processors"]) == processors_before
        assert (
            config_after["cache_logger_on_first_use"]
            is config_before["cache_logger_on_first_use"]
        )
    finally:
        restore_structlog_config()
        assert structlog.is_configured() is configured_before


def test_explore_route_uses_each_owners_saved_scores_not_opposing_url_scores(
    monkeypatch: Any,
) -> None:
    """Real route → Profile SELECT → Explore assembly keeps URL scores out of fit.

    The 48% baseline deliberately sits inside the +/-4 required-test window:
    saved weak scores must stay Target even against strong URL values, while
    saved strong scores must become Safety even against weak URL values.
    """
    lower_user = replace(_test_user(), id=uuid4())
    higher_user = replace(_test_user(), id=uuid4())
    pool = _ProfileReadPool(
        _ProfileReadConnection(
            {
                lower_user.id: {"testing": {"sat": {"math": 400, "ebrw": 400}}},
                higher_user.id: {"testing": {"sat": {"math": 800, "ebrw": 800}}},
            }
        )
    )
    app = _route_app(app_pool=pool)
    active_user = lower_user
    app.dependency_overrides[current_active_user] = lambda: active_user
    facts = (
        _fit_fact(
            "admissions.test_policy_sat_or_act", value_text="required", value_type="enum"
        ),
        _fit_fact("class_profile.sat_math_p25", value_num=600, value_type="count"),
        _fit_fact("class_profile.sat_math_p75", value_num=700, value_type="count"),
        _fit_fact("class_profile.sat_ebrw_p25", value_num=600, value_type="count"),
        _fit_fact("class_profile.sat_ebrw_p75", value_num=700, value_type="count"),
    )

    async def fake_fit_executor(
        catalog: object, statement: tuple[str, list[object]], *, max_page_size: int
    ) -> tuple[tuple[dict[str, object], ...], dict[int, tuple[FactValueRow, ...]]]:
        del catalog, statement
        assert max_page_size == 24
        return (_fit_explore_row(),), {1: facts}

    async def fake_explore(
        catalog: object, statements: list[object]
    ) -> tuple[tuple[dict[str, int], ...], ...]:
        del catalog
        assert len(statements) == 6
        return (({"n": 1},), ({"n": 1},), (), (), (), ())

    monkeypatch.setattr(db_service, "explore_with_admissions_fit_facts", fake_fit_executor)
    monkeypatch.setattr(db_service, "explore", fake_explore)

    client = TestClient(app)
    lower = client.get("/v1/schools/explore?sat_math=800&sat_ebrw=800&act=36")
    active_user = higher_user
    higher = client.get("/v1/schools/explore?sat_math=200&sat_ebrw=200&act=1")

    assert lower.status_code == higher.status_code == 200
    lower_fit = lower.json()["schools"][0]["fit"]
    higher_fit = higher.json()["schools"][0]["fit"]
    assert lower_fit["category"] == "Target"
    assert lower_fit["signals"] == [
        {"factor": "testing", "source": "sat", "assessment": "weak"}
    ]
    assert higher_fit["category"] == "Safety"
    assert higher_fit["signals"] == [
        {"factor": "testing", "source": "sat", "assessment": "strong"}
    ]
