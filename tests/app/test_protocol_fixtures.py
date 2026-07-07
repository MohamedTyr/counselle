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
from domain.envelope import Citation, CitationEnvelope
from domain.events import Event
from domain.specs import RenderSpec, SchoolRef, SourceConfig, VizRow
from tests.app.test_run_turn import _TEMPORAL, Rig, _fn_model

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures" / "protocol"

_WEB = SourceConfig(web=True, reddit=False, edu=False)
_OFF = SourceConfig(web=False, reddit=False, edu=False)


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch: pytest.MonkeyPatch) -> None:
    """No DB in prepare, no asset loading, canned viz spec (no catalog)."""

    async def fake_temporal(catalog: Any, today: Any = None) -> TemporalContext:
        return _TEMPORAL

    async def fake_build_spec(
        catalog: Any,
        type: str,
        unitids: list[int],
        field_keys: Any,
        title: Any,
    ) -> RenderSpec:
        return _CANNED_SPEC

    monkeypatch.setattr(app.graph, "build_temporal_context", fake_temporal)
    monkeypatch.setattr(app.agent_node, "build_system_prompt", lambda *a: "Test counselor.")
    monkeypatch.setattr(app.viz, "_build_spec", fake_build_spec)


_CANNED_SPEC = RenderSpec(
    v=1,
    type="stat_block",
    title="Duke University at a glance",
    schools=[SchoolRef(unitid=198419, name="Duke University")],
    rows=[
        VizRow(
            label="Acceptance rate",
            cells=[
                CitationEnvelope(
                    v=1,
                    field="admissions.acceptance_rate",
                    label="Acceptance rate",
                    display="6.8%",
                    raw=0.068,
                    available=True,
                    unit="percent",
                    citation=Citation(
                        source="ipeds",
                        tier="official",
                        vintage="IPEDS 2024-25 (provisional)",
                        caveat=None,
                        raw_table="adm",
                        url=None,
                    ),
                )
            ],
        )
    ],
)


# ---------------------------------------------------------------------------
# The deterministic models
# ---------------------------------------------------------------------------


def _returned_tools(messages: list[ModelMessage]) -> set[str]:
    last = messages[-1]
    if not isinstance(last, ModelRequest):
        return set()
    return {
        part.tool_name for part in last.parts if isinstance(part, ToolReturnPart)
    }


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
                        "type": "stat_block",
                        "unitids": [198419],
                        "field_keys": ["admissions.acceptance_rate"],
                    },
                )
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
                        "type": "stat_block",
                        "unitids": [198419],
                        "field_keys": ["admissions.acceptance_rate"],
                    },
                )
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


class _HangingFinalAgent:
    def __init__(self, model: _HangingFinalModel, *args: Any, **kwargs: Any) -> None:
        self.model = model

    async def __aenter__(self) -> _HangingFinalAgent:
        return self

    async def __aexit__(self, *exc: Any) -> None:
        return None

    def run_stream_events(self, *args: Any, **kwargs: Any) -> _HangingFinalStream:
        return _HangingFinalStream(self.model.prose)


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
    if isinstance(obj, list):
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
    """The full dossier turn: thinking + steps + viz + sources + usage."""
    rig = Rig(_fn_model(_dossier_model))
    rig.settings.thinking_threshold_chars = 1_000
    registry = TurnRegistry(deps=rig.deps, graph=rig.graph, settings=rig.settings)
    session_id = str(uuid4())

    events = await _registry_turn(rig, registry, session_id, "Tell me about Duke", _WEB)

    types = [event.type for event in events]
    assert {"meta", "thinking", "step", "viz", "delta", "sources", "usage", "done"} <= set(types)
    work_end = max(
        index
        for index, event in enumerate(events)
        if event.type in {"step", "thinking"}
    )
    delta_positions = [index for index, event in enumerate(events) if event.type == "delta"]
    viz_position = types.index("viz")
    assert len(delta_positions) == 2
    assert work_end < delta_positions[0] < viz_position < delta_positions[1]
    assert "[[viz:" not in "".join(
        event.data["text"] for event in events if event.type == "delta"
    )
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
        rig.deps.model_factory = cast(Any, lambda: _hanging_model(
            "Cost-wise, Duke meets full demonstrated need for every admitted "
            "student, and around half the class receives some form of aid. The "
            "sticker price looks intimidating, but the net price for aided "
            "families is dramatically lower, and there are no loans in the aid "
            "packages for families under the income thresholds."
        ))
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
