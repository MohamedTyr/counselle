"""The golden contract fixtures (B2 — ship-plan §B2, wire-contract).

Both sides assert against the SAME committed JSON files:

- this module generates the events/transcript from deterministic
  ``FunctionModel`` runs THROUGH THE TURN REGISTRY, normalizes them (stable
  ids, zeroed timestamps/durations), and asserts equality with
  ``tests/fixtures/protocol/*.json``;
- ``frontend/src/test/protocol-fixtures.test.ts`` loads the same files via
  ``fs.readFileSync`` and asserts the protocol.ts types accept them.

Drift on either side = a red test on that side.

Regenerate after an intentional contract change::

    REGEN_PROTOCOL_FIXTURES=1 uv run pytest tests/app/test_protocol_fixtures.py
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

import pytest
from pydantic_ai import FinalResultEvent
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    PartStartEvent,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo

import app.agent_node
import app.graph
import app.viz
from app.state import TemporalContext
from app.transcript import extract_transcript
from app.turns import TurnRegistry
from domain.envelope import Caveat, Citation, CitationEnvelope, EvidenceItem
from domain.events import Event, StepData, StepDetail, ToolUi, ev_step
from domain.specs import RenderSpec, SchoolRef, SourceConfig, VizRow
from tests.app.test_run_turn import _TEMPORAL, Rig, _fn_model

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures" / "protocol"

_WEB = SourceConfig(web=True, reddit=False, edu=False)
_OFF = SourceConfig(web=False, reddit=False, edu=False)


def test_step_event_contract_allows_optional_tool_ui() -> None:
    event = ev_step(
        StepData(
            step_id="s1",
            status="end",
            kind="write_plan",
            label="Updating the plan",
            tier=None,
            detail=StepDetail(completed=1, total=1),
            ui=ToolUi(widget="task_added", data={"task_id": "t1", "title": "Visit Duke"}),
        )
    )

    assert event.data["ui"] == {
        "widget": "task_added",
        "data": {"task_id": "t1", "title": "Visit Duke"},
    }


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch: pytest.MonkeyPatch) -> None:
    """No DB in prepare, no asset loading, canned viz spec (no catalog)."""

    async def fake_temporal(catalog: Any, today: Any = None) -> TemporalContext:
        return _TEMPORAL

    async def fake_render_viz(
        catalog: Any,
        registry: Any,
        viz_emitted: list[dict[str, Any]],
        type: str,
        columns: Any,
        rows: Any,
        title: Any = None,
        viz_signature_indexes: Any = None,
    ) -> dict[str, Any]:
        del catalog, type, columns, rows, title, viz_signature_indexes
        registry.register_source(_CDS_CITATION, "Duke University — Common Data Set 2024-25")
        registry.register_used_evidence(2, _EVIDENCE)
        registry.register_source(_PROFILE_CITATION, "Duke University — Profile snapshot 2024-12-31")
        viz_emitted.append(_CANNED_SPEC.model_dump(mode="json"))
        return {
            "ok": True,
            "status": "rendered",
            "placement_marker": "[[viz:1]]",
            "cell_count": 4,
            "available_count": 3,
            "unavailable_count": 1,
            "source_count": 3,
            "sources": ["[1]", "[2]", "[3]"],
            "public_receipt": {
                "viz_type": "comparison_table",
                "value_count": 3,
                "schools": ["Duke University", "Example College"],
                "sources": ["[1]", "[2]", "[3]"],
            },
        }

    monkeypatch.setattr(app.graph, "build_temporal_context", fake_temporal)
    monkeypatch.setattr(app.agent_node, "build_system_prompt", lambda *a: "Test counselor.")
    monkeypatch.setattr(app.viz, "render_viz", fake_render_viz)


_EVIDENCE = EvidenceItem(
    eid="admissions.acceptance_rate",
    value_display="6.8%",
    label="Acceptance rate",
    page=7,
    section="C1",
    row_label="Total first-time applicants",
    column_label="Percent admitted",
    excerpt="Applicants admitted: 6.8%",
)
_CDS_CITATION = Citation(
    source="cds",
    tier="official",
    vintage="Common Data Set 2024-25",
    document_sha256="a" * 64,
    source_kind="upload",
    retrieved_at=datetime(2026, 7, 15, tzinfo=UTC),
    academic_year=2024,
    manifest_version="5.0.1",
    school_unitid=198419,
)
_PROFILE_CITATION = Citation(
    source="profile",
    tier="official",
    vintage="Profile snapshot 2024-12-31",
    school_unitid=198419,
    profile_sha256="b" * 64,
)
_CANNED_SPEC = RenderSpec(
    type="comparison_table",
    title="Duke University comparison",
    columns=[
        SchoolRef(unitid=198419, name="Duke University", domain="duke.edu"),
        SchoolRef(unitid=None, name="Example College", domain="example.edu"),
    ],
    rows=[
        VizRow(
            label="Acceptance rate",
            cells=[
                CitationEnvelope(
                    field="admissions.acceptance_rate",
                    label="Acceptance rate",
                    display="6.8%",
                    raw=0.068,
                    available=True,
                    unit="percent",
                    citation=_CDS_CITATION,
                    evidence=_EVIDENCE,
                    caveats=(
                        Caveat(kind="stale_edition", text="This value is from 2024-25."),
                        Caveat(kind="edition_mismatch_comparison", text="Editions differ."),
                    ),
                    marker="[2]",
                ),
                CitationEnvelope(
                    field=None,
                    label="Acceptance rate",
                    display="7.1%",
                    raw=0.071,
                    available=True,
                    unit="percent",
                    citation=Citation(
                        source="web",
                        tier="official",
                        vintage="Retrieved Jun 10, 2026 (live web)",
                        url="https://example.com/1",
                    ),
                    marker="[1]",
                ),
            ],
        ),
        VizRow(
            label="Campus setting",
            cells=[
                CitationEnvelope(
                    field="location.locale",
                    label="Campus setting",
                    display="Large city",
                    raw="large_city",
                    available=True,
                    citation=_PROFILE_CITATION,
                    marker="[3]",
                ),
                CitationEnvelope(
                    field=None,
                    label="Campus setting",
                    display="not available",
                    available=False,
                ),
            ],
        ),
    ],
)


# ---------------------------------------------------------------------------
# The deterministic models
# ---------------------------------------------------------------------------


def _returned_tools(messages: list[ModelMessage]) -> set[str]:
    last = messages[-1]
    if not isinstance(last, ModelRequest):
        return set()
    return {part.tool_name for part in last.parts if isinstance(part, ToolReturnPart)}


def _returned_tool_content(messages: list[ModelMessage], tool_name: str) -> dict[str, Any]:
    last = messages[-1]
    if not isinstance(last, ModelRequest):
        return {}
    for part in last.parts:
        if isinstance(part, ToolReturnPart) and part.tool_name == tool_name:
            assert isinstance(part.content, dict)
            return part.content
    return {}


def _dossier_model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    """search_web → render_viz → cited answer (steps + viz + sources + usage)."""
    returned = _returned_tools(messages)
    if "render_viz" in returned:
        marker = _returned_tool_content(messages, "render_viz")["placement_marker"]
        return ModelResponse(
            parts=[
                TextPart(
                    "Duke's housing is consistently well reviewed by students [1]. "
                    f"{marker} "
                    "The acceptance-rate snapshot puts the campus in context — "
                    "selective, residential, and heavily first-year focused. "
                    "Ask me about specific dorms whenever you want to go deeper."
                )
            ]
        )
    if "search_web" in returned:
        return ModelResponse(
            parts=[
                TextPart("Let me look at Duke's housing first."),
                ToolCallPart(
                    tool_name="render_viz",
                    args={
                        "type": "comparison_table",
                        "columns": [
                            {"unitid": 198419},
                            {"name": "Example College", "domain": "example.edu"},
                        ],
                        "rows": [
                            {
                                "label": "Acceptance rate",
                                "cells": [
                                    {"metric_ref": "admissions.acceptance_rate"},
                                    {"display": "7.1%", "raw": 0.071, "marker": "[1]"},
                                ],
                            },
                            {
                                "label": "Campus setting",
                                "cells": [
                                    {"profile_field": "location.locale"},
                                    {"unavailable": True},
                                ],
                            },
                        ],
                    },
                ),
            ]
        )
    return ModelResponse(
        parts=[
            ToolCallPart(tool_name="search_web", args={"query": "Duke University dorms"}),
        ]
    )


def _transcript_dossier_model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    returned = _returned_tools(messages)
    if "render_viz" in returned:
        marker = _returned_tool_content(messages, "render_viz")["placement_marker"]
        return ModelResponse(
            parts=[
                TextPart(
                    "Duke's housing is consistently well reviewed by students [1]. "
                    f"{marker} "
                    "The acceptance-rate snapshot puts the campus in context — "
                    "selective, residential, and heavily first-year focused. "
                    "Ask me about specific dorms whenever you want to go deeper."
                )
            ]
        )
    if "search_web" in returned:
        return ModelResponse(
            parts=[
                TextPart("Let me look at Duke's housing first."),
                ToolCallPart(
                    tool_name="render_viz",
                    args={
                        "type": "comparison_table",
                        "columns": [
                            {"unitid": 198419},
                            {"name": "Example College", "domain": "example.edu"},
                        ],
                        "rows": [
                            {
                                "label": "Acceptance rate",
                                "cells": [
                                    {"metric_ref": "admissions.acceptance_rate"},
                                    {"display": "7.1%", "raw": 0.071, "marker": "[1]"},
                                ],
                            },
                            {
                                "label": "Campus setting",
                                "cells": [
                                    {"profile_field": "location.locale"},
                                    {"unavailable": True},
                                ],
                            },
                        ],
                    },
                ),
            ]
        )
    return ModelResponse(
        parts=[
            ToolCallPart(tool_name="search_web", args={"query": "Duke University dorms"}),
        ]
    )


def _ask_student_probe_model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    if "ask_student" not in {tool.name for tool in info.function_tools}:
        return ModelResponse(parts=[TextPart("Proceeding without a clarify event.")])
    return ModelResponse(
        parts=[
            ToolCallPart(
                tool_name="ask_student",
                args={
                    "question": "What matters most to you?",
                    "header": "Pick one",
                    "options": [
                        {"label": "Cost", "hint": "affordability and aid"},
                        {"label": "Academics", "hint": "programs and rigor"},
                    ],
                },
            )
        ]
    )


class _HangingFinalModel:
    def __init__(self, prose: str) -> None:
        self.prose = prose


class _HangingFinalStream:
    def __init__(self, prose: str) -> None:
        self.prose = prose

    async def __aenter__(self) -> _HangingFinalStream:
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    def __aiter__(self) -> AsyncIterator[Any]:
        return self._events()

    async def _events(self) -> AsyncIterator[Any]:
        import asyncio

        yield FinalResultEvent(tool_name=None, tool_call_id=None)
        yield PartStartEvent(index=0, part=TextPart(content=self.prose))
        await asyncio.Event().wait()


class _HangingModelRequestNode:
    def __init__(self, prose: str) -> None:
        self.prose = prose

    def stream(self, ctx: Any) -> _HangingFinalStream:
        return _HangingFinalStream(self.prose)


class _HangingIterRun:
    def __init__(self, prose: str) -> None:
        self.ctx = object()
        self.next_node: Any = _HangingModelRequestNode(prose)
        self.result = None

    async def __aenter__(self) -> _HangingIterRun:
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    async def next(self, node: Any) -> Any:
        raise AssertionError("hanging final stream should be cancelled before next()")

    def all_messages(self) -> list[Any]:
        return []


class _HangingIterContext:
    def __init__(self, prose: str) -> None:
        self.prose = prose

    async def __aenter__(self) -> _HangingIterRun:
        return _HangingIterRun(self.prose)

    async def __aexit__(self, *exc: Any) -> None:
        return None


class _HangingFinalAgent:
    def __init__(self, model: _HangingFinalModel, *args: Any, **kwargs: Any) -> None:
        self.model = model

    async def __aenter__(self) -> _HangingFinalAgent:
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    def run_stream_events(self, *args: Any, **kwargs: Any) -> _HangingFinalStream:
        return _HangingFinalStream(self.model.prose)

    def iter(self, *args: Any, **kwargs: Any) -> _HangingIterContext:
        return _HangingIterContext(self.model.prose)

    @staticmethod
    def is_model_request_node(node: Any) -> bool:
        return isinstance(node, _HangingModelRequestNode)

    @staticmethod
    def is_call_tools_node(node: Any) -> bool:
        return False


def _hanging_model(prose: str) -> _HangingFinalModel:
    return _HangingFinalModel(prose)


# ---------------------------------------------------------------------------
# Normalization (stable ids, zeroed timestamps/durations)
# ---------------------------------------------------------------------------

_ID_FIELDS = {"trace_id", "session_id", "message_id", "user_message_id", "step_id"}


def normalize(obj: Any, ids: dict[str, str] | None = None) -> Any:
    """Deterministic fixture form: every id field maps to a stable token in
    first-seen order (the SAME raw id always maps to the SAME token — so a
    reused message_ids stay visibly reused), timestamps and
    durations zero out. Returns a new structure; never mutates."""
    if ids is None:
        ids = {}
    return _normalize(obj, ids)


def _normalize(obj: Any, ids: dict[str, str]) -> Any:
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for key, value in obj.items():
            if key in _ID_FIELDS and isinstance(value, str) and value:
                out[key] = ids.setdefault(value, f"id-{len(ids) + 1}")
            elif key == "ts" and isinstance(value, str):
                out[key] = "2026-01-01T00:00:00+00:00"
            elif key == "duration_ms" and isinstance(value, int):
                out[key] = 0
            else:
                out[key] = _normalize(value, ids)
        return out
    if isinstance(obj, list | tuple):
        return [_normalize(item, ids) for item in obj]
    return obj


def _check_or_regen(name: str, payload: Any) -> None:
    """Golden-file assert; ``REGEN_PROTOCOL_FIXTURES=1`` rewrites instead."""
    path = FIXTURES_DIR / f"{name}.json"
    if os.environ.get("REGEN_PROTOCOL_FIXTURES") == "1":
        FIXTURES_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        return
    assert path.is_file(), (
        f"missing fixture {path} — run REGEN_PROTOCOL_FIXTURES=1 uv run pytest "
        f"tests/app/test_protocol_fixtures.py"
    )
    committed = json.loads(path.read_text(encoding="utf-8"))
    assert payload == committed, (
        f"protocol drift against {path.name} — if the change is intentional, "
        f"regenerate with REGEN_PROTOCOL_FIXTURES=1 (and re-run the frontend "
        f"fixture test)"
    )


# ---------------------------------------------------------------------------
# Fixture runs (through the registry — the same machinery production uses)
# ---------------------------------------------------------------------------


def _dump(events: list[Event]) -> list[dict[str, Any]]:
    return [event.model_dump() for event in events]


async def _registry_turn(
    rig: Rig, registry: TurnRegistry, session_id: str, text: str, config: SourceConfig
) -> list[Event]:
    handle = await registry.start(session_id, text, config)
    return [event async for event, _seq in handle]


async def test_golden_full_turn_events() -> None:
    """The full dossier turn: narration + steps + viz + sources + usage."""
    rig = Rig(_fn_model(_dossier_model))
    rig.settings.thinking_threshold_chars = 1_000
    registry = TurnRegistry(deps=rig.deps, graph=rig.graph, settings=rig.settings)
    session_id = str(uuid4())

    events = await _registry_turn(rig, registry, session_id, "Tell me about Duke", _WEB)

    types = [event.type for event in events]
    assert {"meta", "narration", "step", "viz", "delta", "sources", "usage", "done"} <= set(types)
    work_end = max(
        index for index, event in enumerate(events) if event.type in {"step", "narration"}
    )
    delta_positions = [index for index, event in enumerate(events) if event.type == "delta"]
    viz_position = types.index("viz")
    assert len(delta_positions) == 2
    assert work_end < delta_positions[0] < viz_position < delta_positions[1]
    assert "[[viz:" not in "".join(event.data["text"] for event in events if event.type == "delta")
    viz = next(event.data for event in events if event.type == "viz")
    assert viz["v"] == 2
    assert [column["unitid"] for column in viz["columns"]] == [198419, None]
    cells = [cell for row in viz["rows"] for cell in row["cells"]]
    assert {cell["citation"]["source"] for cell in cells if cell["available"]} == {
        "cds",
        "profile",
        "web",
    }
    assert any(not cell["available"] and cell["marker"] is None for cell in cells)
    cds = next(cell for cell in cells if (cell.get("citation") or {}).get("source") == "cds")
    assert cds["evidence"]["eid"] == "admissions.acceptance_rate"
    assert len(cds["caveats"]) == 2
    render_end = next(
        event.data
        for event in events
        if event.type == "step" and event.data["kind"] == "viz" and event.data["status"] == "end"
    )
    assert "result_for_agent" not in render_end
    _check_or_regen("turn_full", {"events": normalize(_dump(events))})


async def test_agent_v1_no_clarify_turn_events() -> None:
    """Agent V1 does not mount ask_student, so the probe completes normally."""
    rig = Rig(_fn_model(_ask_student_probe_model))
    registry = TurnRegistry(deps=rig.deps, graph=rig.graph, settings=rig.settings)
    session_id = str(uuid4())

    events = await _registry_turn(rig, registry, session_id, "Is NYU good?", _OFF)

    assert "clarify" not in [event.type for event in events]
    assert events[-1].data["status"] == "complete"
    _check_or_regen("turn_no_clarify", {"events": normalize(_dump(events))})


async def test_golden_cancelled_turn_events(monkeypatch: pytest.MonkeyPatch) -> None:
    """A cancelled turn: prose, then the single-shot done(cancelled)."""
    import asyncio

    prose = (
        "Here's what stands out about Duke's housing: the first-year East "
        "Campus model keeps the entire class together, the quad culture is "
        "strong, and upperclass housing is guaranteed all four years. "
        "Students consistently rate the community feel above the buildings "
        "themselves, which matters more than any amenity list."
    )
    monkeypatch.setattr(app.agent_node, "Agent", _HangingFinalAgent)
    rig = Rig(_hanging_model(prose))
    registry = TurnRegistry(deps=rig.deps, graph=rig.graph, settings=rig.settings)
    session_id = str(uuid4())

    collected: list[Event] = []
    got_delta = asyncio.Event()

    async def consume(handle: Any) -> None:
        async for event, _seq in handle:
            collected.append(event)
            if event.type == "delta":
                got_delta.set()

    task = asyncio.create_task(consume(await registry.start(session_id, "Duke dorms?", _OFF)))
    await asyncio.wait_for(got_delta.wait(), timeout=3)
    assert await registry.cancel(session_id) == "cancelled"
    await task

    assert collected[-1].type == "done"
    assert collected[-1].data["status"] == "cancelled"
    _check_or_regen("turn_cancelled", {"events": normalize(_dump(collected))})


async def test_golden_full_fidelity_transcript(monkeypatch: pytest.MonkeyPatch) -> None:
    """One session, three turns — dossier, ask-student probe, cancelled —
    serialized through the transcript read (wire-contract §2)."""
    import asyncio

    rig = Rig(_fn_model(_dossier_model))
    rig.settings.thinking_threshold_chars = 1_000
    registry = TurnRegistry(deps=rig.deps, graph=rig.graph, settings=rig.settings)
    session_id = str(uuid4())

    await _registry_turn(rig, registry, session_id, "Tell me about Duke", _WEB)

    rig.deps.model_factory = lambda: _fn_model(_ask_student_probe_model)
    await _registry_turn(rig, registry, session_id, "Is it right for me?", _OFF)

    with monkeypatch.context() as cancel_patch:
        cancel_patch.setattr(app.agent_node, "Agent", _HangingFinalAgent)
        rig.deps.model_factory = cast(
            Any,
            lambda: _hanging_model(
                "Cost-wise, Duke meets full demonstrated need for every admitted "
                "student, and around half the class receives some form of aid. The "
                "sticker price looks intimidating, but the net price for aided "
                "families is dramatically lower, and there are no loans in the aid "
                "packages for families under the income thresholds."
            ),
        )
        got_delta = asyncio.Event()
        drained = asyncio.Event()

        async def consume(handle: Any) -> None:
            async for event, _seq in handle:
                if event.type == "delta":
                    got_delta.set()
            drained.set()

        task = asyncio.create_task(
            consume(await registry.start(session_id, "What does it cost?", _OFF))
        )
        await asyncio.wait_for(got_delta.wait(), timeout=3)
        assert await registry.cancel(session_id) == "cancelled"
        await task
        assert drained.is_set()

    snapshot = await rig.graph.aget_state({"configurable": {"thread_id": session_id}})
    transcript = extract_transcript(
        list(snapshot.values.get("messages") or []),
        list(snapshot.values.get("turn_records") or []),
    )
    # Spot-check the §2 wire shape before pinning.
    assistant_entries = [e for e in transcript if e["role"] == "assistant"]
    assert len(assistant_entries) == 3
    assert all("step_record" in e and "parts" in e and "status" in e for e in assistant_entries)
    dossier_entry = assistant_entries[0]
    assert [part["type"] for part in dossier_entry["parts"]] == ["text", "viz", "text"]
    assert "[[viz:" not in dossier_entry["text"]
    assert all("[[viz:" not in part.get("text", "") for part in dossier_entry["parts"])
    clarify_entry = assistant_entries[1]
    assert "clarify" not in clarify_entry
    assert "Proceeding without a clarify event." in clarify_entry["text"]
    synthesized = [e for e in transcript if e.get("synthesized")]
    assert synthesized == []
    assert assistant_entries[2]["status"] == "cancelled"
    _check_or_regen("transcript", {"transcript": normalize(transcript)})
