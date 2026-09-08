"""Finding 8 (Phase 2 review): `etag_response` must not keep serving a 304
across the staleness boundary.

`is_stale` depends on `observed_at` *and* wall-clock time against
`facts_stale_days` (`domain/facts/state.py::is_stale`) -- it can flip with
no change to `observed_at` at all. `_facts_vintage` is what
`GET /v1/schools/{unitid}/facts` feeds `etag_response` as `vintage`; this
pins that it changes when staleness flips, so a client's cached ETag from
before the boundary can never satisfy `If-None-Match` after it.
"""

from __future__ import annotations

from api.routes.schools_facts import _facts_vintage
from app.facts.response_models import (
    DeadlinesBlock,
    SchoolFactsResponse,
    SchoolIdentity,
)


def _facts(*, observed_at: str | None, is_stale: bool) -> SchoolFactsResponse:
    return SchoolFactsResponse(
        identity=SchoolIdentity(
            unitid=1,
            name="Test University",
            city=None,
            state=None,
            control=None,
            undergraduates=None,
            website_url=None,
            domain=None,
        ),
        has_collegedata=True,
        observed_at=observed_at,
        is_stale=is_stale,
        freshness_line=None,
        deadlines=DeadlinesBlock(rows=(), foot=""),
        sections=(),
    )


def test_vintage_is_none_when_nothing_has_been_observed() -> None:
    # `etag_response` never mints an ETag for "nothing observed yet" --
    # `_facts_vintage` must preserve that by staying `None`, not "None:False".
    assert _facts_vintage(_facts(observed_at=None, is_stale=False)) is None


def test_vintage_changes_when_staleness_flips_with_the_same_observed_at() -> None:
    fresh = _facts_vintage(_facts(observed_at="2026-01-01T00:00:00Z", is_stale=False))
    stale = _facts_vintage(_facts(observed_at="2026-01-01T00:00:00Z", is_stale=True))
    assert fresh is not None
    assert stale is not None
    assert fresh != stale


def test_vintage_changes_when_observed_at_changes() -> None:
    first = _facts_vintage(_facts(observed_at="2026-01-01T00:00:00Z", is_stale=False))
    second = _facts_vintage(_facts(observed_at="2026-02-01T00:00:00Z", is_stale=False))
    assert first != second
