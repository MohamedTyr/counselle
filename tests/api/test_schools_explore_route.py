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

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth import current_active_user
from api.routes import schools_facts as schools_facts_routes
from app.facts.explore_models import ExploreResponse, FilterOptions
from tests.api.conftest import _test_user


def _empty_explore_response() -> ExploreResponse:
    return ExploreResponse(
        schools=(),
        page=1,
        page_size=24,
        total=0,
        total_is_capped=False,
        exclusions=(),
        sorted_null_tail=None,
        control_counts={"public": 0, "private": 0, "private_for_profit": 0},
        narrowest=None,
        filter_options=FilterOptions(region=(), campus_setting=(), religious_affiliation=()),
        facts_observed_from=None,
        entrance_difficulty_note="",
        majors_match_note="",
        religious_affiliation_note="",
    )


def _route_client(monkeypatch: Any) -> tuple[TestClient, AsyncMock]:
    mock = AsyncMock(return_value=_empty_explore_response())
    monkeypatch.setattr(schools_facts_routes, "run_explore", mock)
    app = FastAPI()
    app.include_router(schools_facts_routes.router, prefix="/v1")
    app.dependency_overrides[current_active_user] = _test_user
    app.state.runtime = SimpleNamespace(deps=SimpleNamespace(catalog=object()))
    app.state.settings = object()
    return TestClient(app), mock


def test_explore_route_binds_with_no_query_params(monkeypatch: Any) -> None:
    """The exact repro: no params at all used to 500 with a pydantic
    ValidationError on the `_HAS_DEFAULT_FACTORY` sentinel."""
    client, mock = _route_client(monkeypatch)

    response = client.get("/v1/schools/explore")

    assert response.status_code == 200
    query = mock.call_args.args[1]
    assert query.state == []
    assert query.region == []
    assert query.include_missing == []
    assert response.headers["Cache-Control"] == "private, max-age=60"


def test_explore_route_binds_repeated_query_params_into_lists(monkeypatch: Any) -> None:
    client, mock = _route_client(monkeypatch)

    response = client.get("/v1/schools/explore?state=CA&state=NY")

    assert response.status_code == 200
    query = mock.call_args.args[1]
    assert query.state == ["CA", "NY"]
