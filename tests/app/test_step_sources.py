"""Unit tests for per-step source chips (app/steps.py + domain/events.py).

Covers StepMapper.sources_for per kind (web→host label, reddit→title label,
db/viz→school label + favicon, empty otherwise, dedup, cap), the ev_step
None-drop, and that the router attaches sources only on a clean ``end``.
"""

from __future__ import annotations

from typing import Any

import pytest

from app.steps import _MAX_STEP_SOURCES, EmissionRouter, StepMapper
from config.settings import load_yaml_asset
from domain.events import StepData, StepSource, ev_step
from domain.urls import favicon_url

_NAMES = {198419: "Duke University", 221999: "Vanderbilt University"}
_DOMAINS = {198419: "duke.edu", 221999: "vanderbilt.edu"}


@pytest.fixture(scope="module")
def mapper() -> StepMapper:
    labels = load_yaml_asset("step_labels")
    assert isinstance(labels, dict)
    return StepMapper(labels, _NAMES.get, _DOMAINS.get)


def _results(*items: dict[str, Any]) -> dict[str, Any]:
    return {"results": list(items)}


# -- search kinds ----------------------------------------------------------


def test_web_sources_label_is_host(mapper: StepMapper) -> None:
    content = _results(
        {"url": "https://www.usnews.com/best", "title": "Best colleges"},
        {"url": "https://eecs.mit.edu/grad", "title": "EECS"},
    )
    sources = mapper.sources_for("search_web", {"query": "x"}, content)
    assert sources is not None
    assert [s.label for s in sources] == ["usnews.com", "eecs.mit.edu"]
    assert sources[0].favicon == favicon_url("usnews.com")
    assert sources[0].url == "https://www.usnews.com/best"


def test_reddit_sources_label_is_title(mapper: StepMapper) -> None:
    content = _results({"url": "https://reddit.com/r/x/1", "title": "MIT EECS culture is no joke"})
    sources = mapper.sources_for("search_reddit", {"query": "x"}, content)
    assert sources is not None
    assert sources[0].label == "MIT EECS culture is no joke"
    # favicon derives from the result host (reddit.com), not a hardcoded asset.
    assert sources[0].favicon == favicon_url("reddit.com")


def test_reddit_long_title_is_truncated(mapper: StepMapper) -> None:
    long_title = "x" * 400
    content = _results({"url": "https://reddit.com/r/x/1", "title": long_title})
    sources = mapper.sources_for("search_reddit", {"query": "x"}, content)
    assert sources is not None
    assert len(sources[0].label) < len(long_title)
    assert sources[0].label.endswith("…")


def test_search_dedups_by_url_then_caps(mapper: StepMapper) -> None:
    dupes = [{"url": "https://a.com/1", "title": "A"}, {"url": "https://a.com/1", "title": "A2"}]
    many = [{"url": f"https://s{i}.com/x", "title": str(i)} for i in range(_MAX_STEP_SOURCES + 5)]
    deduped = mapper.sources_for("search_web", {}, _results(*dupes))
    assert deduped is not None and len(deduped) == 1  # same url collapsed
    capped = mapper.sources_for("search_web", {}, _results(*many))
    assert capped is not None and len(capped) == _MAX_STEP_SOURCES


def test_search_no_results_is_none(mapper: StepMapper) -> None:
    assert mapper.sources_for("search_web", {}, {"error": "boom"}) is None
    assert mapper.sources_for("search_web", {}, None) is None
    assert mapper.sources_for("search_web", {}, {"results": []}) is None


def test_search_skips_non_http_scheme(mapper: StepMapper) -> None:
    # A javascript:/data: url from a tool result never reaches the wire.
    content = _results(
        {"url": "javascript:alert(1)", "title": "evil"},
        {"url": "data:text/html,x", "title": "inline"},
        {"url": "https://ok.com/x", "title": "OK"},
    )
    sources = mapper.sources_for("search_web", {"query": "x"}, content)
    assert sources is not None
    assert [s.label for s in sources] == ["ok.com"]


# -- school kinds (db / viz) ----------------------------------------------


def test_db_school_source_has_name_and_favicon(mapper: StepMapper) -> None:
    sources = mapper.sources_for("get_values", {"unitid": 198419}, {"rows": []})
    assert sources is not None
    assert sources[0].label == "Duke University"
    assert sources[0].favicon == favicon_url("duke.edu")
    assert sources[0].url == "https://duke.edu"


def test_viz_multi_school_sources(mapper: StepMapper) -> None:
    sources = mapper.sources_for(
        "render_viz", {"columns": [{"unitid": 198419}, {"unitid": 221999}]}, {}
    )
    assert sources is not None
    assert [s.label for s in sources] == ["Duke University", "Vanderbilt University"]


def test_db_unknown_school_yields_none(mapper: StepMapper) -> None:
    # No name and no domain resolvable → no chip → None (not []).
    assert mapper.sources_for("get_values", {"unitid": 999999}, {"rows": []}) is None


def test_db_no_unitid_is_none(mapper: StepMapper) -> None:
    assert mapper.sources_for("resolve_school", {"query": "duke"}, {"rows": []}) is None


def test_db_school_name_no_domain_is_inert_chip() -> None:
    # A unitid resolving to a NAME but NO domain → an inert chip: a label, but
    # favicon=None and url=None (no website to link, no favicon to derive).
    labels = load_yaml_asset("step_labels")
    assert isinstance(labels, dict)
    mapper = StepMapper(labels, {424242: "Mystery College"}.get, lambda _u: None)
    sources = mapper.sources_for("get_values", {"unitid": 424242}, {"rows": []})
    assert sources is not None
    assert len(sources) == 1
    assert sources[0].label == "Mystery College"
    assert sources[0].favicon is None
    assert sources[0].url is None


# -- ev_step drop rule -----------------------------------------------------


def _step(**kw: Any) -> StepData:
    base = dict(step_id="s1", status="end", kind="db_tool", label="x", tier=None, detail=None)
    base.update(kw)
    return StepData(**base)  # type: ignore[arg-type]


def test_ev_step_drops_sources_when_none() -> None:
    assert "sources" not in ev_step(_step(sources=None)).data


def test_ev_step_keeps_sources_when_present() -> None:
    data = ev_step(_step(sources=[StepSource(label="duke.edu", favicon="f", url="u")])).data
    assert data["sources"] == [{"label": "duke.edu", "favicon": "f", "url": "u"}]


def test_ev_step_drops_none_keys_from_each_source() -> None:
    # An inert chip (name only, no favicon/url) must not send `null` favicon/url
    # on the wire — the FE optionals are `?:`, and a null would crash the chip.
    data = ev_step(_step(sources=[StepSource(label="Mystery College")])).data
    assert data["sources"] == [{"label": "Mystery College"}]
    assert "favicon" not in data["sources"][0]
    assert "url" not in data["sources"][0]


# -- router attaches sources on end only -----------------------------------


class _FakePart:
    """A FunctionToolResultEvent.part stand-in (success path — not a RetryPromptPart)."""

    def __init__(self, tool_call_id: str, content: Any) -> None:
        self.tool_call_id = tool_call_id
        self.content = content


class _FakeResult:
    """A FunctionToolResultEvent stand-in exposing ``.part``."""

    def __init__(self, tool_call_id: str, content: Any) -> None:
        self.part = _FakePart(tool_call_id, content)


def _router() -> tuple[EmissionRouter, list[dict[str, Any]]]:
    chunks: list[dict[str, Any]] = []
    labels = load_yaml_asset("step_labels")
    assert isinstance(labels, dict)
    mapper = StepMapper(labels, _NAMES.get, _DOMAINS.get)
    return EmissionRouter(writer=chunks.append, mapper=mapper), chunks


def test_router_emits_sources_on_end(mapper: StepMapper) -> None:
    from app.steps import MappedStep, _OpenStep

    router, chunks = _router()
    open_step = _OpenStep(
        step_id="s1",
        tool_name="search_web",
        args={"query": "x"},
        mapped=MappedStep(
            kind="web_search", tier=None, label="Searching", tool="search_web"
        ),
        started=0.0,
    )
    router._open["tc1"] = open_step
    router._finish_step(_FakeResult("tc1", _results({"url": "https://a.com/1", "title": "A"})))  # type: ignore[arg-type]
    end = next(c for c in chunks if c["type"] == "step" and c["data"]["status"] == "end")
    assert end["data"]["sources"] == [
        {"label": "a.com", "favicon": favicon_url("a.com"), "url": "https://a.com/1"}
    ]


def test_router_omits_sources_on_error(mapper: StepMapper) -> None:
    from app.steps import MappedStep, _OpenStep

    router, chunks = _router()
    router._open["tc1"] = _OpenStep(
        step_id="s1",
        tool_name="search_web",
        args={"query": "x"},
        mapped=MappedStep(
            kind="web_search", tier=None, label="Searching", tool="search_web"
        ),
        started=0.0,
    )
    # An {"error": ...} result is the error shape (Tavily never raises).
    router._finish_step(_FakeResult("tc1", {"error": "rate limited"}))  # type: ignore[arg-type]
    err = next(c for c in chunks if c["type"] == "step" and c["data"]["status"] == "error")
    assert "sources" not in err["data"]


def test_router_close_synthesized_steps_have_no_sources() -> None:
    """A budget/interrupt/error close() force-closes open steps with no sources."""
    from app.steps import MappedStep, _OpenStep

    router, chunks = _router()
    router._open["tc1"] = _OpenStep(
        step_id="s1",
        tool_name="search_web",
        args={"query": "x"},
        mapped=MappedStep(
            kind="web_search", tier=None, label="Searching", tool="search_web"
        ),
        started=0.0,
    )
    router.close("budget")
    closed = next(c for c in chunks if c["type"] == "step" and c["data"]["status"] == "error")
    assert "sources" not in closed["data"]
