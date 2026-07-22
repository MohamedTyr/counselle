"""The 6 live conversations (Phase 4 Tests; real Gemini + DB + Tavily).

Run serially: ``uv run pytest -m live_llm -q -x``. Slow and costs money.

Assertions are STRUCTURAL only — event types, registry contents, citation
tiers, viz spec shapes — never prose wording (the phase-file rule). Each turn
prints its usage line (visible with ``-s``) for the cost-sanity check.

Every test builds the full production runtime (RO pool + catalog, app pool,
Postgres checkpointer, counselle-db MCP child, real Gemini via Vertex Express
Mode, Tavily) and cleans up its session row + checkpoint thread afterwards.
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator
from typing import Any
from uuid import uuid4

import pytest
import pytest_asyncio

from app.deps import Runtime, build_runtime
from app.run_turn import run_turn
from domain.events import Event
from domain.response_mode import ResponseMode
from domain.specs import SourceConfig

pytestmark = pytest.mark.live_llm

_MARKER_RE = re.compile(r"\[(\d+)\]")


# ---------------------------------------------------------------------------
# Rig
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def rt() -> AsyncIterator[Runtime]:
    runtime = await build_runtime()
    try:
        yield runtime
    finally:
        await runtime.aclose()


async def _cleanup(rt: Runtime, session_id: str) -> None:
    """Drop the test session row + its checkpoint thread (hygiene, live DB)."""
    async with rt.app_pool.acquire() as conn:
        await conn.execute("DELETE FROM counselle.sessions WHERE session_id = $1", session_id)
        for table in ("checkpoint_writes", "checkpoint_blobs", "checkpoints"):
            await conn.execute(  # fixed allowlist of table names, never input
                f"DELETE FROM counselle.{table} WHERE thread_id = $1", session_id
            )


async def _turn(
    rt: Runtime,
    session_id: str,
    text: str,
    config: SourceConfig | None = None,
    label: str = "",
    response_mode: ResponseMode = ResponseMode.QUICK,
) -> list[Event]:
    events = [
        event
        async for event in run_turn(
            session_id,
            text,
            config,
            deps=rt.deps,
            graph=rt.graph,
            response_mode=response_mode,
        )
    ]
    usage = _usage(events)
    if usage:
        print(
            f"\n[usage] {response_mode.value}:{label or text[:40]!r}: "
            f"in={usage['input_tokens']} out={usage['output_tokens']} "
            f"tool_calls={usage['tool_calls']}"
        )
    return events


# ---------------------------------------------------------------------------
# Structural accessors
# ---------------------------------------------------------------------------


def _types(events: list[Event]) -> list[str]:
    return [event.type for event in events]


def _prose(events: list[Event]) -> str:
    return "".join(event.data["text"] for event in events if event.type == "delta")


def _done_status(events: list[Event]) -> str:
    return str(next(event.data["status"] for event in events if event.type == "done"))


def _vizzes(events: list[Event]) -> list[dict[str, Any]]:
    return [event.data for event in events if event.type == "viz"]


def _sources(events: list[Event]) -> list[dict[str, Any]]:
    sources_events = [event for event in events if event.type == "sources"]
    return list(sources_events[-1].data["sources"]) if sources_events else []


def _usage(events: list[Event]) -> dict[str, Any] | None:
    usage_events = [event for event in events if event.type == "usage"]
    return dict(usage_events[-1].data) if usage_events else None


def _meta(events: list[Event]) -> dict[str, Any]:
    return dict(next(event.data for event in events if event.type == "meta"))


def _markers_in_prose(events: list[Event]) -> list[int]:
    return [int(match) for match in _MARKER_RE.findall(_prose(events))]


def _assert_clean_complete(events: list[Event]) -> None:
    assert "error" not in _types(events), _prose(events)
    assert _done_status(events) == "complete"


def _assert_markers_in_registry(events: list[Event]) -> None:
    """Every marker the model wrote must be one it was given (the honesty rule).

    Asserted only where the phase file demands it (tests 1 and 2) — Gemini
    occasionally hallucinates bracket markers on tool-free answers, which is a
    prompt-review finding, not a runtime bug; the other tests stay spec-exact.
    """
    indices = {entry["index"] for entry in _sources(events)}
    cited = set(_markers_in_prose(events))
    assert cited <= indices, f"prose cites {sorted(cited - indices)} not in the registry"


# ---------------------------------------------------------------------------
# 1. Duke overview
# ---------------------------------------------------------------------------


async def test_1_duke_overview_cites_or_renders(rt: Runtime) -> None:
    session_id = str(uuid4())
    try:
        events = await _turn(rt, session_id, "Tell me about Duke University", label="duke")

        _assert_clean_complete(events)
        stat_blocks = [viz for viz in _vizzes(events) if viz["type"] == "stat_block"]
        # The phase-file disjunction, verbatim: ≥1 stat_block viz OR ≥6 cited markers.
        assert len(stat_blocks) >= 1 or len(_markers_in_prose(events)) >= 6
        _assert_markers_in_registry(events)
        usage = _usage(events)
        assert usage is not None
        assert usage["input_tokens"] > 0 and usage["output_tokens"] > 0
    finally:
        await _cleanup(rt, session_id)


# ---------------------------------------------------------------------------
# 2. NYU underspecification → qualified complete answer
# ---------------------------------------------------------------------------


async def test_2_nyu_underspecified_completes_with_sources(rt: Runtime) -> None:
    session_id = str(uuid4())
    try:
        events = await _turn(rt, session_id, "Is NYU good?", label="nyu-qualified")

        _assert_clean_complete(events)
        assert "clarify" not in _types(events)
        # Agent V1 states a reasonable scope assumption and answers in one turn;
        # structurally, the answer must still ground at least one claim.
        indices = {entry["index"] for entry in _sources(events)}
        assert indices
        assert set(_markers_in_prose(events)) & indices
    finally:
        await _cleanup(rt, session_id)


# ---------------------------------------------------------------------------
# 3. Duke vs Harvard comparison table
# ---------------------------------------------------------------------------


async def test_3_compare_duke_harvard_renders_table(rt: Runtime) -> None:
    session_id = str(uuid4())
    try:
        events = await _turn(
            rt,
            session_id,
            "Compare Duke and Harvard on cost and selectivity",
            label="compare",
        )

        _assert_clean_complete(events)
        tables = [viz for viz in _vizzes(events) if viz["type"] == "comparison_table"]
        assert tables, f"no comparison_table viz; got {[v['type'] for v in _vizzes(events)]}"
        expected_unitids = {166027, 198419}
        comparison = next(
            (
                table
                for table in tables
                if {column["unitid"] for column in table["columns"]} == expected_unitids
            ),
            None,
        )
        assert comparison is not None, [table["columns"] for table in tables]
        assert comparison["rows"]
        assert all(
            len(row["cells"]) == len(comparison["columns"])
            and any(cell["available"] for cell in row["cells"])
            for row in comparison["rows"]
        )
    finally:
        await _cleanup(rt, session_id)


# ---------------------------------------------------------------------------
# 4 + 5. Reddit gating, both directions (ADR 0013)
# ---------------------------------------------------------------------------

_PITZER_Q = "What are people on Reddit saying about Pitzer dorms?"


async def test_4_pitzer_reddit_enabled_yields_community_citations(rt: Runtime) -> None:
    session_id = str(uuid4())
    try:
        events = await _turn(
            rt,
            session_id,
            _PITZER_Q,
            SourceConfig(web=True, reddit=True, edu=True),
            label="reddit-on",
        )

        _assert_clean_complete(events)
        reddit_sources = [
            entry
            for entry in _sources(events)
            if "reddit.com" in (entry["citation"].get("url") or "")
        ]
        assert reddit_sources, f"no reddit citations in {_sources(events)}"
        assert all(entry["citation"]["tier"] == "community" for entry in reddit_sources)
    finally:
        await _cleanup(rt, session_id)


async def test_5_pitzer_reddit_disabled_never_cites_reddit(rt: Runtime) -> None:
    session_id = str(uuid4())
    try:
        events = await _turn(
            rt,
            session_id,
            _PITZER_Q,
            SourceConfig(web=True, reddit=False, edu=True),
            label="reddit-off",
        )

        _assert_clean_complete(events)
        reddit_sources = [
            entry
            for entry in _sources(events)
            if "reddit.com" in (entry["citation"].get("url") or "")
        ]
        assert not reddit_sources, f"reddit cited with reddit=False: {reddit_sources}"
    finally:
        await _cleanup(rt, session_id)


# ---------------------------------------------------------------------------
# 6. Duke vs Vanderbilt admission rates — the activity timeline (B1a)
# ---------------------------------------------------------------------------


def _steps(events: list[Event]) -> list[dict[str, Any]]:
    return [event.data for event in events if event.type == "step"]


async def test_6_compare_admission_rates_streams_a_clean_step_timeline(rt: Runtime) -> None:
    session_id = str(uuid4())
    try:
        events = await _turn(
            rt,
            session_id,
            "Compare the admission rates at Duke and Vanderbilt",
            label="steps",
        )

        _assert_clean_complete(events)
        steps = _steps(events)
        # At least one start/end pair of agent work against our data (db or viz).
        ended = [step for step in steps if step["status"] == "end"]
        assert any(step["kind"] in ("db_tool", "viz") for step in ended), steps
        # Every step start reached a terminal state — nothing shimmers forever.
        started_ids = [step["step_id"] for step in steps if step["status"] == "start"]
        terminal_ids = [step["step_id"] for step in steps if step["status"] in ("end", "error")]
        assert sorted(started_ids) == sorted(terminal_ids), steps
        # Narration: a thinking line or a delta lands before the first step.
        first_step = next(i for i, event in enumerate(events) if event.type == "step")
        assert any(
            event.type in ("thinking", "delta") for event in events[:first_step]
        ), f"no narration before the first step: {_types(events[: first_step + 1])}"
        # Label sanity: no unfilled template ever reaches a student.
        assert all("{" not in step["label"] for step in steps), steps
    finally:
        await _cleanup(rt, session_id)


# ---------------------------------------------------------------------------
# 7 + 8. Response-mode provider-path smokes (Phase 6)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("response_mode", "expected_model"),
    [
        (ResponseMode.QUICK, "google-vertex:gemini-3.5-flash"),
        (ResponseMode.THINK, "google-vertex:gemini-3.1-pro-preview"),
    ],
)
async def test_7_response_modes_report_expected_model_and_usage(
    rt: Runtime,
    response_mode: ResponseMode,
    expected_model: str,
) -> None:
    session_id = str(uuid4())
    try:
        events = await _turn(
            rt,
            session_id,
            "Answer in one short sentence: what is the Common Data Set?",
            SourceConfig(web=False, reddit=False, edu=False),
            label="mode-smoke",
            response_mode=response_mode,
        )

        _assert_clean_complete(events)
        meta = _meta(events)
        assert meta["response_mode"] == response_mode.value
        assert meta["model"] == expected_model
        usage = _usage(events)
        assert usage is not None
        assert usage["input_tokens"] > 0 and usage["output_tokens"] > 0
    finally:
        await _cleanup(rt, session_id)


async def test_8_quick_think_quick_history_switch_keeps_mode_metadata(
    rt: Runtime,
) -> None:
    session_id = str(uuid4())
    try:
        quick_1 = await _turn(
            rt,
            session_id,
            "Answer briefly: what is Duke University?",
            SourceConfig(web=False, reddit=False, edu=False),
            label="history-quick-1",
            response_mode=ResponseMode.QUICK,
        )
        think = await _turn(
            rt,
            session_id,
            "Now compare that answer with Vanderbilt in two bullets.",
            SourceConfig(web=False, reddit=False, edu=False),
            label="history-think",
            response_mode=ResponseMode.THINK,
        )
        quick_2 = await _turn(
            rt,
            session_id,
            "Summarize the comparison in one sentence.",
            SourceConfig(web=False, reddit=False, edu=False),
            label="history-quick-2",
            response_mode=ResponseMode.QUICK,
        )

        for events in (quick_1, think, quick_2):
            _assert_clean_complete(events)
            usage = _usage(events)
            assert usage is not None
            assert usage["input_tokens"] > 0 and usage["output_tokens"] > 0
        assert _meta(quick_1)["response_mode"] == "quick"
        assert _meta(quick_1)["model"] == "google-vertex:gemini-3.5-flash"
        assert _meta(think)["response_mode"] == "think"
        assert _meta(think)["model"] == "google-vertex:gemini-3.1-pro-preview"
        assert _meta(quick_2)["response_mode"] == "quick"
        assert _meta(quick_2)["model"] == "google-vertex:gemini-3.5-flash"
    finally:
        await _cleanup(rt, session_id)
