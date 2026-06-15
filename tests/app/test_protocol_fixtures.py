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
from typing import Any
from uuid import uuid4

import pytest
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

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
    monkeypatch.setattr(app.agent_node, "build_system_prompt", lambda ctx: "Test counselor.")
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


def _dossier_model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    """search_web → render_viz → cited answer (steps + viz + sources + usage)."""
    returned = _returned_tools(messages)
    if "render_viz" in returned:
        return ModelResponse(
            parts=[
                TextPart(
                    "Duke's housing is consistently well reviewed by students [1]. "
                    "The acceptance-rate snapshot above puts the campus in context — "
                    "selective, residential, and heavily first-year focused. "
                    "Ask me about specific dorms whenever you want to go deeper."
                )
            ]
        )
    if "search_web" in returned:
        return ModelResponse(
            parts=[
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
            TextPart("Let me look at Duke's housing first."),  # pre-tool → thinking
            ToolCallPart(tool_name="search_web", args={"query": "Duke University dorms"}),
        ]
    )


def _clarify_model(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    returned = _returned_tools(messages)
    if "ask_student" in returned:
        last = messages[-1]
        assert isinstance(last, ModelRequest)
        answer = next(
            part.content for part in last.parts if isinstance(part, ToolReturnPart)
        )
        return ModelResponse(parts=[TextPart(f"Focusing on {answer}, then.")])
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


def _hanging_model(prose: str) -> FunctionModel:
    """Streams *prose* then hangs forever — the cancel target."""
    import asyncio

    def fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[TextPart(prose)])

    async def stream(messages: Any, info: AgentInfo) -> AsyncIterator[str]:
        yield prose
        await asyncio.Event().wait()

    return FunctionModel(fn, stream_function=stream)


# ---------------------------------------------------------------------------
# Normalization (stable ids, zeroed timestamps/durations)
# ---------------------------------------------------------------------------

_ID_FIELDS = {"trace_id", "session_id", "message_id", "user_message_id", "step_id"}


def normalize(obj: Any, ids: dict[str, str] | None = None) -> Any:
    """Deterministic fixture form: every id field maps to a stable token in
    first-seen order (the SAME raw id always maps to the SAME token — so a
    clarify resume's reused message_id stays visibly reused), timestamps and
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
    registry = TurnRegistry(deps=rig.deps, graph=rig.graph, settings=rig.settings)
    session_id = str(uuid4())

    events = await _registry_turn(rig, registry, session_id, "Tell me about Duke", _WEB)

    types = [event.type for event in events]
    assert {"meta", "thinking", "step", "viz", "delta", "sources", "usage", "done"} <= set(types)
    _check_or_regen("turn_full", {"events": normalize(_dump(events))})


async def test_golden_clarify_turn_events_park_and_resume() -> None:
    """The clarify pair: park (clarify + done(awaiting_input)) then resume —
    one shared id map so the resume's reused message_id stays visibly equal."""
    rig = Rig(_fn_model(_clarify_model))
    registry = TurnRegistry(deps=rig.deps, graph=rig.graph, settings=rig.settings)
    session_id = str(uuid4())

    park = await _registry_turn(rig, registry, session_id, "Is NYU good?", _OFF)
    resume = await _registry_turn(rig, registry, session_id, "Cost", _OFF)

    assert park[-1].data["status"] == "awaiting_input"
    assert resume[-1].data["status"] == "complete"

    ids: dict[str, str] = {}
    payload = {
        "park": normalize(_dump(park), ids),
        "resume": normalize(_dump(resume), ids),
    }
    # The reuse property must survive normalization (G1/G4).
    assert payload["park"][0]["data"]["message_id"] == payload["resume"][0]["data"]["message_id"]
    _check_or_regen("turn_clarify", payload)


async def test_golden_cancelled_turn_events() -> None:
    """A cancelled turn: prose, then the single-shot done(cancelled)."""
    import asyncio

    prose = (
        "Here's what stands out about Duke's housing: the first-year East "
        "Campus model keeps the entire class together, the quad culture is "
        "strong, and upperclass housing is guaranteed all four years. "
        "Students consistently rate the community feel above the buildings "
        "themselves, which matters more than any amenity list."
    )
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


async def test_golden_full_fidelity_transcript() -> None:
    """One session, three turns — dossier, clarify park + resume, cancelled —
    serialized through the transcript read (wire-contract §2)."""
    import asyncio

    rig = Rig(_fn_model(_dossier_model))
    registry = TurnRegistry(deps=rig.deps, graph=rig.graph, settings=rig.settings)
    session_id = str(uuid4())

    await _registry_turn(rig, registry, session_id, "Tell me about Duke", _WEB)

    rig.deps.model_factory = lambda: _fn_model(_clarify_model)
    await _registry_turn(rig, registry, session_id, "Is it right for me?", _OFF)
    await _registry_turn(rig, registry, session_id, "Cost", _OFF)

    rig.deps.model_factory = lambda: _hanging_model(
        # > the 240-char thinking threshold, so it streams live as deltas
        # before the cancel lands (the same constraint a real turn has).
        "Cost-wise, Duke meets full demonstrated need for every admitted "
        "student, and around half the class receives some form of aid. The "
        "sticker price looks intimidating, but the net price for aided "
        "families is dramatically lower, and there are no loans in the aid "
        "packages for families under the income thresholds."
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
    clarify_entry = assistant_entries[1]
    assert clarify_entry["clarify"]["answer"] == "Cost"
    synthesized = [e for e in transcript if e.get("synthesized")]
    assert len(synthesized) == 1
    assert assistant_entries[2]["status"] == "cancelled"

    _check_or_regen("transcript", {"transcript": normalize(transcript)})
