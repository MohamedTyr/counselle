"""Unit tests for the turn registry (B2 — app/turns.py). No DB, no LLM.

Rig: the test_run_turn pattern — memory checkpointer, FunctionModel through
the ``AppDeps.model_factory`` seam, fake asyncpg pool — with a
:class:`TurnRegistry` constructed over the rig's graph/deps/settings.

Covered (ship-plan §B2's exhaustive list):
- disconnect survival + identical replay across consumers (incl. enriched usage)
- exact replay from Last-Event-ID (mid-stream reconnect)
- double-send → StreamActive (the 409); awaiting_input releases the lock
- cancel: partial persisted + single-shot done(cancelled); idle no-op;
  cancel-on-parked unpark; cancel-before-prose (empty-partial rule)
- watchdog timeout → error, never done(cancelled)
- buffer fall-off → error event; eviction → NoActiveTurn
- the G3 history rewrite (slice, registry restore, ghost-free transcript,
  parked-edit, InvalidEditTarget on unknown/pre-MVP2/synthesized targets)
- shutdown drain; parked-interrupt durability
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable
from typing import Any
from uuid import uuid4

import pytest
from pydantic_ai.messages import (
    ModelMessage,
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel

import app.agent_node
import app.graph
from app.records import prose_of
from app.state import TemporalContext
from app.transcript import extract_transcript
from app.turns import (
    InvalidEditTarget,
    NoActiveTurn,
    StreamActive,
    TooManyConsumers,
    TooManyTurns,
    TurnRegistry,
    _RingBuffer,
)
from domain.events import (
    Event,
    UsageData,
    ev_delta,
    ev_done,
    ev_meta,
    ev_sources,
    ev_usage,
    ev_viz,
)
from domain.specs import SourceConfig
from tests.app.test_run_turn import (
    _ALL_OFF,
    _TEMPORAL,
    _WEB_ONLY,
    FakeSettings,
    Rig,
    _clarify_then_answer,
    _fn_model,
    _search_then_answer,
    _viz_spec,
)

_LONG_CHUNK = "Duke University's residential experience is widely praised by students. " * 5


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch: pytest.MonkeyPatch) -> None:
    """No DB in prepare, no asset loading in the prompt builder."""

    async def fake_temporal(catalog: Any, today: Any = None) -> TemporalContext:
        return _TEMPORAL

    monkeypatch.setattr(app.graph, "build_temporal_context", fake_temporal)
    monkeypatch.setattr(app.agent_node, "build_system_prompt", lambda *a: "Test counselor.")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _registry(rig: Rig) -> TurnRegistry:
    return TurnRegistry(deps=rig.deps, graph=rig.graph, settings=rig.settings)


def _gated_model(gate: asyncio.Event, *chunks_before: str, after: str = "") -> FunctionModel:
    """A streaming model: yields *chunks_before*, parks on *gate*, then *after*."""

    def fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[TextPart("".join(chunks_before) + after)])

    async def stream(messages: Any, info: AgentInfo) -> AsyncIterator[str]:
        for chunk in chunks_before:
            yield chunk
        await gate.wait()
        if after:
            yield after

    return FunctionModel(fn, stream_function=stream)


class Collector:
    def __init__(self, stream: AsyncIterator[tuple[Event, int]]) -> None:
        self.items: list[tuple[Event, int]] = []
        self.first_visible = asyncio.Event()
        self.task = asyncio.create_task(self._run(stream))

    async def _run(self, stream: AsyncIterator[tuple[Event, int]]) -> None:
        async for event, seq in stream:
            self.items.append((event, seq))
            if event.type in ("delta", "thinking", "step"):
                self.first_visible.set()

    async def done(self) -> list[tuple[Event, int]]:
        await self.task
        return self.items

    def types(self) -> list[str]:
        return [event.type for event, _ in self.items]


async def _eventually(condition: Callable[[], bool], timeout: float = 3.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not condition():
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("condition never became true")
        await asyncio.sleep(0.01)


async def _drain(stream: AsyncIterator[tuple[Event, int]]) -> list[tuple[Event, int]]:
    return [pair async for pair in stream]


async def _run_full_turn(
    registry: TurnRegistry,
    session_id: str,
    text: str,
    config: SourceConfig = _ALL_OFF,
    **kwargs: Any,
) -> list[tuple[Event, int]]:
    handle = await registry.start(session_id, text, config, **kwargs)
    return await _drain(handle)


async def _state_values(rig: Rig, session_id: str) -> dict[str, Any]:
    snapshot = await rig.graph.aget_state({"configurable": {"thread_id": session_id}})
    return dict(snapshot.values)


def _events(pairs: list[tuple[Event, int]]) -> list[Event]:
    return [event for event, _ in pairs]


def _prose(pairs: list[tuple[Event, int]]) -> str:
    return "".join(e.data["text"] for e in _events(pairs) if e.type == "delta")


# ---------------------------------------------------------------------------
# Disconnect survival + replay identity
# ---------------------------------------------------------------------------


async def test_disconnect_survival_second_consumer_replays_identically() -> None:
    gate = asyncio.Event()
    rig = Rig(_gated_model(gate, _LONG_CHUNK, after=" The dorms are great."))
    registry = _registry(rig)
    session_id = str(uuid4())

    first = Collector(await registry.start(session_id, "duke dorms?", _ALL_OFF))
    await asyncio.wait_for(first.first_visible.wait(), timeout=3)

    # The first consumer "disconnects" — the detached turn keeps running.
    first.task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await first.task
    assert registry.is_generating(session_id) is True

    second = registry.attach(session_id)
    gate.set()
    pairs = await _drain(second)

    types = [event.type for event, _ in pairs]
    assert types[0] == "meta"
    assert types[-1] == "done"
    assert pairs[-1][0].data["status"] == "complete"
    # Full prose despite the first consumer's death; seqs contiguous from 0.
    assert "The dorms are great." in _prose(pairs)
    assert [seq for _, seq in pairs] == list(range(len(pairs)))
    # The first consumer's prefix is byte-identical to the replay's prefix —
    # incl. the enriched usage event (enrichment is buffer-owned, not per-consumer).
    assert first.items == pairs[: len(first.items)]
    usage = next(e for e, _ in pairs if e.type == "usage")
    assert "est_cost_usd" in usage.data
    # Eviction at terminal: the registry forgot the turn.
    assert registry.is_generating(session_id) is False


async def test_exact_replay_from_last_event_id_mid_stream() -> None:
    gate = asyncio.Event()
    rig = Rig(_gated_model(gate, _LONG_CHUNK, after=" More."))
    registry = _registry(rig)
    session_id = str(uuid4())

    first = Collector(await registry.start(session_id, "hi", _ALL_OFF))
    await asyncio.wait_for(first.first_visible.wait(), timeout=3)
    seen = len(first.items)
    assert seen >= 2  # meta + ≥1 delta
    last_seq = first.items[-1][1]

    # Mid-stream reconnect with the cursor: only seq > last_seq arrives.
    reattached = registry.attach(session_id, last_event_id=last_seq)
    gate.set()
    pairs = await _drain(reattached)

    assert [seq for _, seq in pairs] == list(range(last_seq + 1, last_seq + 1 + len(pairs)))
    full = await first.done()
    assert full[seen:] == pairs[: len(full) - seen]


async def test_replay_duplicate_final_chunks_keeps_one_answer_and_one_viz() -> None:
    rig = Rig(_fn_model(_search_then_answer))
    spec_1 = _viz_spec("admissions.rate", title="First title")
    spec_2 = _viz_spec("admissions.rate", title="Second title")
    gate = asyncio.Event()

    async def duplicate_final_stream(*args: Any, **kwargs: Any) -> AsyncIterator[Event]:
        yield ev_meta("trace-1", "session-1", "model", "assistant-1", "user-1")
        yield ev_viz(spec_1)
        yield ev_viz(spec_2)
        yield ev_delta("Final answer after the card.")
        await gate.wait()
        yield ev_sources([])
        yield ev_usage(UsageData(input_tokens=1, output_tokens=1, tool_calls=0))
        yield ev_done("complete")

    registry = TurnRegistry(
        deps=rig.deps,
        graph=rig.graph,
        settings=rig.settings,
        run_turn_fn=duplicate_final_stream,
    )
    session_id = str(uuid4())

    handle = await registry.start(session_id, "compare these", _ALL_OFF)
    first = Collector(handle)
    await asyncio.wait_for(first.first_visible.wait(), timeout=3)

    replay = registry.attach(session_id)
    gate.set()
    replayed = await _drain(replay)
    full = await first.done()

    assert [(event.type, seq) for event, seq in replayed] == [
        (event.type, seq) for event, seq in full
    ]
    assert [seq for _, seq in replayed] == list(range(len(replayed)))
    assert [event.type for event, _ in replayed].count("viz") == 1
    assert _prose(replayed) == "Final answer after the card."

    turn = registry._turns.get(session_id)
    assert turn is None


# ---------------------------------------------------------------------------
# Single-flight
# ---------------------------------------------------------------------------


async def test_double_send_raises_stream_active() -> None:
    gate = asyncio.Event()
    rig = Rig(_gated_model(gate, _LONG_CHUNK))
    registry = _registry(rig)
    session_id = str(uuid4())

    handle = await registry.start(session_id, "hi", _ALL_OFF)
    try:
        with pytest.raises(StreamActive):
            await registry.start(session_id, "again", _ALL_OFF)
    finally:
        gate.set()
        await _drain(handle)


async def test_awaiting_input_releases_lock_for_the_answering_post() -> None:
    rig = Rig(_fn_model(_clarify_then_answer))
    registry = _registry(rig)
    session_id = str(uuid4())

    pairs_1 = await _run_full_turn(registry, session_id, "Is NYU good?")
    assert pairs_1[-1][0].data["status"] == "awaiting_input"
    assert registry.is_generating(session_id) is False  # the lock released

    # The answering POST is NOT 409'd and resumes to completion.
    pairs_2 = await _run_full_turn(registry, session_id, "cost")
    assert pairs_2[-1][0].data["status"] == "complete"
    assert "Focusing on cost." in _prose(pairs_2)


# ---------------------------------------------------------------------------
# Cancel (G5)
# ---------------------------------------------------------------------------


async def test_cancel_active_persists_partial_and_emits_done_cancelled() -> None:
    gate = asyncio.Event()  # never set — the model hangs mid-stream
    rig = Rig(_gated_model(gate, _LONG_CHUNK))
    registry = _registry(rig)
    session_id = str(uuid4())

    collector = Collector(await registry.start(session_id, "duke dorms?", _ALL_OFF))
    await asyncio.wait_for(collector.first_visible.wait(), timeout=3)

    outcome = await registry.cancel(session_id)
    assert outcome == "cancelled"

    pairs = await collector.done()
    types = [e.type for e, _ in pairs]
    # The single-shot terminal: exactly one done(cancelled), no error.
    assert types.count("done") == 1
    assert pairs[-1][0].data["status"] == "cancelled"
    assert "error" not in types
    thinking = "".join(e.data["text"] for e, _ in pairs if e.type == "thinking")
    assert _LONG_CHUNK.strip() in thinking
    streamed = _prose(pairs)
    assert streamed == ""

    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert record["status"] == "cancelled"
    assert record["user_text"] == "duke dorms?"
    assert prose_of(record["parts"]) == streamed
    assert _LONG_CHUNK.strip() in "".join(record["thinking"])
    assert all(message["kind"] == "request" for message in values["messages"])
    assert registry.is_generating(session_id) is False


async def test_cancel_after_done_is_idle_noop() -> None:
    rig = Rig(_fn_model(_search_then_answer))
    registry = _registry(rig)
    session_id = str(uuid4())

    await _run_full_turn(registry, session_id, "duke dorms?", _WEB_ONLY)
    records_before = (await _state_values(rig, session_id))["turn_records"]

    assert await registry.cancel(session_id) == "idle"
    # The no-op left the completed record alone.
    assert (await _state_values(rig, session_id))["turn_records"] == records_before


async def test_cancel_on_parked_unparks_and_freezes_clarify_unanswered() -> None:
    rig = Rig(_fn_model(_clarify_then_answer))
    registry = _registry(rig)
    session_id = str(uuid4())

    await _run_full_turn(registry, session_id, "Is NYU good?")

    assert await registry.cancel(session_id) == "unparked"

    snapshot = await rig.graph.aget_state({"configurable": {"thread_id": session_id}})
    record = snapshot.values["turn_records"][-1]
    # Frozen unanswered: status left awaiting_input, the answer stays null.
    assert record["status"] == "cancelled"
    assert record["clarify"]["answer"] is None
    assert record["clarify"]["spec"]["question"] == "What matters most to you?"
    # The interrupt is cleared (spike-1 mechanic b).
    assert not any(task.interrupts for task in snapshot.tasks)

    # The next plain message runs a FRESH turn (it would have been swallowed
    # as a clarify answer otherwise): the model asks its clarify again.
    pairs = await _run_full_turn(registry, session_id, "Is Duke good?")
    types = [e.type for e, _ in pairs]
    assert "clarify" in types
    assert pairs[-1][0].data["status"] == "awaiting_input"
    values = await _state_values(rig, session_id)
    assert values["turn_records"][-1]["user_text"] == "Is Duke good?"


async def test_cancel_before_prose_skips_the_model_response_append() -> None:
    gate = asyncio.Event()  # the model hangs before yielding anything
    rig = Rig(_gated_model(gate))
    registry = _registry(rig)
    session_id = str(uuid4())

    collector = Collector(await registry.start(session_id, "hi", _ALL_OFF))
    await _eventually(lambda: len(collector.items) >= 1)  # meta arrived

    assert await registry.cancel(session_id) == "cancelled"
    pairs = await collector.done()
    assert pairs[-1][0].data["status"] == "cancelled"

    values = await _state_values(rig, session_id)
    # Empty-partial rule: no prose streamed → no ModelResponse append.
    assert all(m["kind"] == "request" for m in values["messages"])
    record = values["turn_records"][-1]
    assert record["status"] == "cancelled"
    assert record["parts"] == []
    assert record["user_text"] == "hi"


async def test_cancel_after_final_partial_preserves_honest_prose_once() -> None:
    gate = asyncio.Event()
    visible = "Final partial that the student already saw. "
    hidden = "This text must not be fabricated after cancel."
    rig = Rig(_fn_model(_search_then_answer))
    session_id = str(uuid4())

    async def fake_run_turn(
        session_id: str,
        user_text: str,
        source_config: SourceConfig | None = None,
        *,
        deps: Any,
        graph: Any,
    ) -> AsyncIterator[Event]:
        messages = list(
            ModelMessagesTypeAdapter.dump_python(
                [ModelRequest(parts=[UserPromptPart(content=user_text)])],
                mode="json",
            )
        )
        await graph.aupdate_state(
            {"configurable": {"thread_id": session_id}},
            {"messages": messages, "turn_records": [], "source_registry": []},
            as_node="agent",
        )
        yield ev_meta("trace-final-cancel", session_id, "test-model", "m-final", "u-final")
        yield ev_delta(visible)
        await gate.wait()
        yield ev_delta(hidden)
        yield ev_done("complete")

    registry = TurnRegistry(
        deps=rig.deps,
        graph=rig.graph,
        settings=rig.settings,
        run_turn_fn=fake_run_turn,
    )
    collector = Collector(await registry.start(session_id, "duke dorms?", _WEB_ONLY))
    await _eventually(
        lambda: any(event.type == "delta" for event, _ in collector.items),
        timeout=3,
    )

    assert await registry.cancel(session_id) == "cancelled"
    pairs = await collector.done()

    types = [event.type for event, _ in pairs]
    assert types.count("done") == 1
    assert pairs[-1][0].data["status"] == "cancelled"
    streamed = _prose(pairs)
    assert streamed == visible
    assert hidden not in streamed

    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert record["status"] == "cancelled"
    assert prose_of(record["parts"]) == visible
    prose_messages = [
        part.get("content", "")
        for message in values["messages"]
        if message.get("kind") == "response"
        for part in message.get("parts", [])
        if part.get("part_kind") == "text"
    ]
    assert prose_messages == [visible]


async def test_cancel_mid_resume_replaces_the_parked_record() -> None:
    """Cancel during a clarify RESUME: the parked record is replaced (same
    message_id) with the answer frozen into clarify.answer."""
    rig = Rig(_fn_model(_clarify_then_answer))
    registry = _registry(rig)
    session_id = str(uuid4())

    pairs_1 = await _run_full_turn(registry, session_id, "Is NYU good?")
    meta_1 = pairs_1[0][0].data
    parked = (await _state_values(rig, session_id))["turn_records"][-1]
    assert parked["status"] == "awaiting_input"

    # Resume with a model that hangs mid-resume: swap the registry's rig model
    # by hanging the answering response.
    gate = asyncio.Event()

    def fn(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return _clarify_then_answer(messages, info)

    async def stream(messages: Any, info: AgentInfo) -> AsyncIterator[str]:
        await gate.wait()
        yield "never"

    rig.deps.model_factory = lambda: FunctionModel(fn, stream_function=stream)

    collector = Collector(await registry.start(session_id, "cost", _ALL_OFF))
    await _eventually(lambda: len(collector.items) >= 1)  # meta (reused id)
    assert collector.items[0][0].data["message_id"] == meta_1["message_id"]

    assert await registry.cancel(session_id) == "cancelled"
    await collector.done()

    records = (await _state_values(rig, session_id))["turn_records"]
    assert len(records) == 1  # replaced, not appended
    record = records[0]
    assert record["status"] == "cancelled"
    assert record["message_id"] == meta_1["message_id"]
    assert record["clarify"]["answer"] == "cost"
    assert record["synthesized_answer"] is True
    assert record["user_text"] == "Is NYU good?"


# ---------------------------------------------------------------------------
# Watchdog (G5: error, never done(cancelled))
# ---------------------------------------------------------------------------


async def test_watchdog_timeout_terminates_with_error_not_cancelled() -> None:
    gate = asyncio.Event()  # never set
    settings = FakeSettings()
    settings.turn_timeout_s = 0.1
    rig = Rig(_gated_model(gate, _LONG_CHUNK), settings=settings)
    registry = _registry(rig)
    session_id = str(uuid4())

    pairs = await _run_full_turn(registry, session_id, "hi")

    types = [e.type for e, _ in pairs]
    assert types[-1] == "error"
    assert "done" not in types  # the student didn't press stop
    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert record["status"] == "error"
    assert record["error"]["message"]
    assert prose_of(record["parts"]) == _prose(pairs)
    assert registry.is_generating(session_id) is False


# ---------------------------------------------------------------------------
# Buffer policy
# ---------------------------------------------------------------------------


async def test_consumer_falling_off_the_head_is_terminated_with_error() -> None:
    gate = asyncio.Event()
    chunks = [_LONG_CHUNK] + ["chunk " * 50 for _ in range(8)]
    settings = FakeSettings()
    settings.stream_buffer_size = 2
    rig = Rig(_gated_model(gate, *chunks), settings=settings)
    registry = _registry(rig)
    session_id = str(uuid4())

    handle = await registry.start(session_id, "hi", _ALL_OFF)
    turn = registry._turns[session_id]
    await _eventually(lambda: turn.buffer.base > 0)  # the head moved past seq 0

    pairs = await _drain(handle)  # attached at seq 0 — already evicted
    gate.set()

    assert len(pairs) == 1
    event, _ = pairs[0]
    assert event.type == "error"
    assert "fell behind" in event.data["message"]
    # never a silent skip: nothing but the terminal error reached this consumer
    await registry.cancel(session_id)


async def test_attach_after_eviction_raises_no_active_turn() -> None:
    rig = Rig(_fn_model(_search_then_answer))
    registry = _registry(rig)
    session_id = str(uuid4())

    await _run_full_turn(registry, session_id, "duke dorms?", _WEB_ONLY)

    with pytest.raises(NoActiveTurn):
        registry.attach(session_id)


async def test_parked_turn_is_not_attachable_but_record_is_durable() -> None:
    """Parked-interrupt durability: after done(awaiting_input) the task is
    gone (attach → NoActiveTurn → 204 → transcript), and the transcript
    carries the parked clarify record."""
    rig = Rig(_fn_model(_clarify_then_answer))
    registry = _registry(rig)
    session_id = str(uuid4())

    await _run_full_turn(registry, session_id, "Is NYU good?")

    with pytest.raises(NoActiveTurn):
        registry.attach(session_id)

    values = await _state_values(rig, session_id)
    transcript = extract_transcript(values["messages"], values["turn_records"])
    assistant = transcript[-1]
    assert assistant["status"] == "awaiting_input"
    assert assistant["clarify"]["spec"]["question"] == "What matters most to you?"
    assert assistant["clarify"]["answer"] is None


# ---------------------------------------------------------------------------
# The G3 history rewrite
# ---------------------------------------------------------------------------

_WEB = SourceConfig(web=True, reddit=False, edu=False)


async def test_rewrite_slices_history_and_restores_the_source_registry() -> None:
    rig = Rig(_fn_model(_search_then_answer))
    registry = _registry(rig)
    session_id = str(uuid4())

    await _run_full_turn(registry, session_id, "duke dorms?", _WEB)
    pairs_2 = await _run_full_turn(registry, session_id, "and harvard?", _WEB)
    target_user_id = pairs_2[0][0].data["user_message_id"]

    values = await _state_values(rig, session_id)
    assert len(values["turn_records"]) == 2
    assert [s["index"] for s in values["source_registry"]] == [1, 2]
    record_1 = values["turn_records"][0]

    # Edit turn 2's question (regenerate = same mechanism, same text allowed).
    pairs_3 = await _run_full_turn(
        registry, session_id, "and yale?", _WEB, replace_message_id=target_user_id
    )
    assert pairs_3[-1][0].data["status"] == "complete"

    values = await _state_values(rig, session_id)
    records = values["turn_records"]
    assert len(records) == 2
    assert records[0] == record_1  # the surviving record untouched
    assert records[1]["user_text"] == "and yale?"
    # The registry was restored from record_1's snapshot, then the new turn
    # appended its fresh source — index 2 is the NEW search, never index 3.
    indexes = [s["index"] for s in values["source_registry"]]
    assert indexes == [1, 2]
    assert values["source_registry"][1]["citation"]["url"] == "https://example.com/3"

    # Ghost-exchange-free transcript: "and harvard?" is gone everywhere.
    transcript = extract_transcript(values["messages"], records)
    texts = [entry["text"] for entry in transcript]
    assert not any("harvard" in text for text in texts)
    assert any("yale" in text for text in texts)
    # And the provider history was sliced at the offset (no harvard request).
    user_prompts = [
        part.get("content")
        for msg in values["messages"]
        if msg.get("kind") == "request"
        for part in msg.get("parts", [])
        if part.get("part_kind") == "user-prompt"
    ]
    assert "and harvard?" not in user_prompts


async def test_rewrite_of_the_first_message_restores_an_empty_registry() -> None:
    rig = Rig(_fn_model(_search_then_answer))
    registry = _registry(rig)
    session_id = str(uuid4())

    pairs_1 = await _run_full_turn(registry, session_id, "duke dorms?", _WEB)
    first_user_id = pairs_1[0][0].data["user_message_id"]

    await _run_full_turn(
        registry, session_id, "nyu dorms?", _WEB, replace_message_id=first_user_id
    )

    values = await _state_values(rig, session_id)
    assert len(values["turn_records"]) == 1
    assert values["turn_records"][0]["user_text"] == "nyu dorms?"
    # No surviving record → empty restore; the new turn minted index 1 fresh.
    assert [s["index"] for s in values["source_registry"]] == [1]


async def test_parked_edit_clears_the_interrupt_and_runs_fresh() -> None:
    rig = Rig(_fn_model(_clarify_then_answer))
    registry = _registry(rig)
    session_id = str(uuid4())

    pairs_1 = await _run_full_turn(registry, session_id, "Is NYU good?")
    parked_user_id = pairs_1[0][0].data["user_message_id"]

    # Edit the parked turn's own question — the rewrite must unpark (G4).
    pairs_2 = await _run_full_turn(
        registry, session_id, "Is Duke good?", replace_message_id=parked_user_id
    )

    # The new text ran as a FRESH question (parks on its own clarify), not as
    # the old clarify's answer.
    assert "clarify" in [e.type for e, _ in pairs_2]
    values = await _state_values(rig, session_id)
    records = values["turn_records"]
    assert len(records) == 1
    assert records[0]["user_text"] == "Is Duke good?"
    snapshot = await rig.graph.aget_state({"configurable": {"thread_id": session_id}})
    # Parked again on the NEW turn's clarify — but only one parked record.
    assert records[0]["status"] == "awaiting_input"
    assert snapshot is not None


async def test_rewrite_unknown_target_raises_invalid_edit_target() -> None:
    rig = Rig(_fn_model(_search_then_answer))
    registry = _registry(rig)
    session_id = str(uuid4())

    await _run_full_turn(registry, session_id, "duke dorms?", _WEB)
    before = await _state_values(rig, session_id)

    with pytest.raises(InvalidEditTarget):
        await registry.start(
            session_id, "edited", _WEB, replace_message_id=str(uuid4())
        )
    # The claim was released and the thread untouched.
    assert registry.is_generating(session_id) is False
    assert await _state_values(rig, session_id) == before


async def test_rewrite_pre_mvp2_history_raises_invalid_edit_target() -> None:
    """A pre-MVP2 thread (messages, no turn records) has no edit targets."""
    rig = Rig(_fn_model(_search_then_answer))
    registry = _registry(rig)
    session_id = str(uuid4())

    # Simulate a pre-MVP2 thread: serialized messages, zero turn records.
    await rig.graph.aupdate_state(
        {"configurable": {"thread_id": session_id}},
        {
            "messages": [
                {
                    "kind": "request",
                    "parts": [{"part_kind": "user-prompt", "content": "old question"}],
                },
                {
                    "kind": "response",
                    "parts": [{"part_kind": "text", "content": "old answer"}],
                },
            ]
        },
    )

    with pytest.raises(InvalidEditTarget):
        await registry.start(session_id, "edited", _WEB, replace_message_id=str(uuid4()))
    values = await _state_values(rig, session_id)
    assert len(values["messages"]) == 2  # nothing sliced


async def test_rewrite_synthesized_answer_bubble_raises_invalid_edit_target() -> None:
    rig = Rig(_fn_model(_clarify_then_answer))
    registry = _registry(rig)
    session_id = str(uuid4())

    await _run_full_turn(registry, session_id, "Is NYU good?")
    await _run_full_turn(registry, session_id, "cost")  # the resume

    record = (await _state_values(rig, session_id))["turn_records"][-1]
    assert record["synthesized_answer"] is True

    # The synthesized clarify-answer bubble carries the resume's
    # user_message_id but is never an edit target (G4 — flag, not id-absence).
    with pytest.raises(InvalidEditTarget):
        await registry.start(
            session_id, "edited", _ALL_OFF, replace_message_id=record["user_message_id"]
        )
    assert registry.is_generating(session_id) is False


# ---------------------------------------------------------------------------
# Shutdown drain
# ---------------------------------------------------------------------------


async def test_aclose_drains_in_flight_turns_and_lands_their_writes() -> None:
    gate = asyncio.Event()  # never set — the turn would hang forever
    rig = Rig(_gated_model(gate, _LONG_CHUNK))
    registry = _registry(rig)
    session_id = str(uuid4())

    collector = Collector(await registry.start(session_id, "duke dorms?", _ALL_OFF))
    await asyncio.wait_for(collector.first_visible.wait(), timeout=3)

    await registry.aclose()

    # The task is gone, the partial landed BEFORE aclose returned (so the
    # caller can safely close the pools next), the stream terminated cleanly.
    # BC-15: a shutdown drain is NOT a user cancel — the active turn is
    # terminated with `error` (status="error"), never done(cancelled). The old
    # `cancelled` assertion encoded the BC-15 bug; this correction is intentional.
    assert registry.is_generating(session_id) is False
    pairs = await collector.done()
    types = [e.type for e, _ in pairs]
    assert pairs[-1][0].type == "error"
    assert "done" not in types
    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert record["status"] == "error"
    assert prose_of(record["parts"]) == _prose(pairs)


async def test_aclose_with_a_live_turn_over_a_parked_session_drains_and_frees() -> None:
    """Shutdown drain (aclose) is robust to a parked session coexisting with a
    live turn: the live turn's partial lands and the parked session — once its
    own cancel runs — is frozen `cancelled` with the interrupt cleared."""
    # A parked session (task already gone, record durable).
    rig = Rig(_fn_model(_clarify_then_answer))
    registry = _registry(rig)
    parked_sid = str(uuid4())
    await _run_full_turn(registry, parked_sid, "Is NYU good?")  # parks

    # Cancel-on-parked is the exact mechanism aclose runs per session: freeze
    # the record cancelled, clear the interrupt.
    assert await registry.cancel(parked_sid) == "unparked"
    snap = await rig.graph.aget_state({"configurable": {"thread_id": parked_sid}})
    frozen = snap.values["turn_records"][-1]
    assert frozen["status"] == "cancelled"
    assert frozen["clarify"]["answer"] is None
    assert not any(task.interrupts for task in snap.tasks)

    # Now a genuinely in-flight turn, drained by aclose itself.
    gate = asyncio.Event()  # never set
    rig2 = Rig(_gated_model(gate, _LONG_CHUNK))
    registry2 = _registry(rig2)
    live_sid = str(uuid4())
    collector = Collector(await registry2.start(live_sid, "duke dorms?", _ALL_OFF))
    await asyncio.wait_for(collector.first_visible.wait(), timeout=3)

    await registry2.aclose()  # drains the live turn; must not raise

    assert registry2.is_generating(live_sid) is False
    pairs = await collector.done()
    # BC-15: the live turn drained by aclose ends with `error` (server-side
    # termination), not done(cancelled) — error has no `status` field, it carries
    # message/trace_id. Intentional correction of the old `cancelled` assertion.
    assert pairs[-1][0].type == "error"


# ---------------------------------------------------------------------------
# T1: external cancel still ends the stream with a terminal event (C1)
# ---------------------------------------------------------------------------


async def test_external_task_cancel_still_emits_terminal_error() -> None:
    """A turn task cancelled EXTERNALLY (not via registry.cancel) must still end
    the attached consumer's stream with a terminal `error` — never a silent
    buffer close (the honesty contract)."""
    gate = asyncio.Event()  # never set — the model hangs mid-stream
    rig = Rig(_gated_model(gate, _LONG_CHUNK))
    registry = _registry(rig)
    session_id = str(uuid4())

    collector = Collector(await registry.start(session_id, "duke dorms?", _ALL_OFF))
    await asyncio.wait_for(collector.first_visible.wait(), timeout=3)

    # Cancel the bare turn task directly — bypassing registry.cancel, so
    # cancel_requested stays False (an abrupt shutdown cancelling the task).
    turn = registry._turns[session_id]
    assert turn.task is not None
    turn.task.cancel()

    pairs = await collector.done()
    types = [e.type for e, _ in pairs]
    assert types[-1] == "error"  # terminal event, not a silent close
    assert "done" not in types  # our cancel path never ran


# ---------------------------------------------------------------------------
# T2: usage enrichment failure does not sink a correct turn (H1)
# ---------------------------------------------------------------------------


async def test_usage_enrichment_failure_passes_raw_usage_and_completes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When enrich_usage_event raises, the raw usage event passes through and
    the stream still ends with `done` (a correct turn is never failed)."""
    import app.turns as turns_module

    def boom(*args: Any, **kwargs: Any) -> Any:
        raise TypeError("usage payload mismatch")

    monkeypatch.setattr(turns_module, "enrich_usage_event", boom)

    rig = Rig(_fn_model(_search_then_answer))
    registry = _registry(rig)
    session_id = str(uuid4())

    pairs = await _run_full_turn(registry, session_id, "duke dorms?", _WEB_ONLY)
    types = [e.type for e, _ in pairs]
    assert types[-1] == "done"
    assert pairs[-1][0].data["status"] == "complete"
    # The raw usage event still passed through (un-enriched, no est_cost_usd).
    usage = next(e for e, _ in pairs if e.type == "usage")
    assert "est_cost_usd" not in usage.data or usage.data.get("est_cost_usd") is None


# ---------------------------------------------------------------------------
# T3: fall-off error carries buffer.base - 1 as its seq (H3)
# ---------------------------------------------------------------------------


async def test_fall_off_error_seq_reflects_buffer_base_not_stale_position() -> None:
    """A consumer that falls off the head gets an error whose seq is
    `buffer.base - 1`, so a reconnecting client's cursor cleanly signals
    'everything before here is gone'."""
    gate = asyncio.Event()
    chunks = [_LONG_CHUNK] + ["chunk " * 50 for _ in range(8)]
    settings = FakeSettings()
    settings.stream_buffer_size = 2
    rig = Rig(_gated_model(gate, *chunks), settings=settings)
    registry = _registry(rig)
    session_id = str(uuid4())

    handle = await registry.start(session_id, "hi", _ALL_OFF)
    turn = registry._turns[session_id]
    await _eventually(lambda: turn.buffer.base > 0)
    base_at_fall = turn.buffer.base

    pairs = await _drain(handle)  # attached at seq 0 — already evicted
    gate.set()

    assert len(pairs) == 1
    event, seq = pairs[0]
    assert event.type == "error"
    # The error seq is the buffer base minus one — not the stale seq 0 cursor.
    assert seq == base_at_fall - 1
    await registry.cancel(session_id)


# ---------------------------------------------------------------------------
# T4: global concurrent-turn cap (H6)
# ---------------------------------------------------------------------------


async def test_global_concurrent_turn_cap_raises_too_many_turns() -> None:
    """Exceeding max_concurrent_turns raises TooManyTurns (the route → 503)."""
    gate = asyncio.Event()  # never set — turns hang, holding the claim
    settings = FakeSettings()
    settings.max_concurrent_turns = 2
    rig = Rig(_gated_model(gate, _LONG_CHUNK), settings=settings)
    registry = _registry(rig)

    h1 = await registry.start(str(uuid4()), "a", _ALL_OFF)
    h2 = await registry.start(str(uuid4()), "b", _ALL_OFF)
    try:
        with pytest.raises(TooManyTurns):
            await registry.start(str(uuid4()), "c", _ALL_OFF)
    finally:
        gate.set()
        await _drain(h1)
        await _drain(h2)


async def test_registry_reads_settings_directly() -> None:
    """CFG-02: the registry reads its knobs straight off the settings object — no
    getattr fallback that could mask a stale/duplicated default. Distinctive
    values flow through to the live concurrency cap and the byte budget."""
    gate = asyncio.Event()  # never set — turns hang, holding the claim
    settings = FakeSettings()
    settings.max_concurrent_turns = 3
    settings.stream_buffer_bytes = 4242
    rig = Rig(_gated_model(gate, _LONG_CHUNK), settings=settings)
    registry = _registry(rig)

    # The Phase-1 byte budget is read directly (no getattr fallback masking it).
    assert registry._buffer_bytes_budget == 4242

    handles = [await registry.start(str(uuid4()), str(i), _ALL_OFF) for i in range(3)]
    try:
        with pytest.raises(TooManyTurns):  # the 4th exceeds max_concurrent_turns=3
            await registry.start(str(uuid4()), "overflow", _ALL_OFF)
    finally:
        gate.set()
        for handle in handles:
            await _drain(handle)


async def test_registry_raises_without_phase1_settings_fields() -> None:
    """CFG-02 regression guard: a settings stub MISSING a Phase-1 field
    (``stream_buffer_bytes``) now raises AttributeError in __init__ instead of
    silently using a baked literal (the drift smell the getattr removal kills)."""

    class _MissingField:
        max_concurrent_turns = 50
        stream_buffer_size = 20_000
        max_consumers_per_turn = 8
        turn_timeout_s = 180
        model_counselor = "x"
        persist_partial_timeout_s = 5.0
        # stream_buffer_bytes deliberately absent

    rig = Rig(_gated_model(asyncio.Event()))
    with pytest.raises(AttributeError):
        TurnRegistry(deps=rig.deps, graph=rig.graph, settings=_MissingField())


async def test_per_turn_consumer_cap_raises_too_many_consumers() -> None:
    """Attaching past max_consumers_per_turn raises TooManyConsumers (→ 429)."""
    gate = asyncio.Event()  # never set — the turn stays live so consumers persist
    settings = FakeSettings()
    settings.max_consumers_per_turn = 2
    rig = Rig(_gated_model(gate, _LONG_CHUNK), settings=settings)
    registry = _registry(rig)
    session_id = str(uuid4())

    handle1 = await registry.start(session_id, "hi", _ALL_OFF)  # consumer 1 (starter)
    c1 = Collector(handle1)
    await asyncio.wait_for(c1.first_visible.wait(), timeout=3)
    handle2 = registry.attach(session_id)  # consumer 2
    c2 = Collector(handle2)
    await _eventually(lambda: registry._turns[session_id].consumers >= 2)

    try:
        with pytest.raises(TooManyConsumers):
            registry.attach(session_id)  # consumer 3 — over the cap
    finally:
        gate.set()
        await registry.cancel(session_id)
        await c1.done()
        await c2.done()


# ---------------------------------------------------------------------------
# BC-01: shared byte budget on the ring buffer
# ---------------------------------------------------------------------------


async def test_byte_budget_evicts_oldest_when_over_budget() -> None:
    """A tiny byte budget (event count cap untouched) evicts the head by BYTES;
    a consumer attached at seq 0 then gets the honest fell-off-head error."""
    gate = asyncio.Event()  # never set — the model streams then parks
    chunks = [_LONG_CHUNK] + ["chunk " * 80 for _ in range(8)]
    settings = FakeSettings()
    settings.stream_buffer_size = 20_000  # event cap never fires
    settings.stream_buffer_bytes = 2_000  # the byte budget bites
    rig = Rig(_gated_model(gate, *chunks), settings=settings)
    registry = _registry(rig)
    session_id = str(uuid4())

    handle = await registry.start(session_id, "hi", _ALL_OFF)
    turn = registry._turns[session_id]
    # Eviction is driven by bytes, not the (huge) event cap.
    await _eventually(lambda: turn.buffer.base > 0)

    pairs = await _drain(handle)  # attached at seq 0 — already evicted by bytes
    assert len(pairs) == 1
    event, _ = pairs[0]
    assert event.type == "error"
    assert "fell behind" in event.data["message"]

    gate.set()
    await registry.cancel(session_id)


async def test_byte_budget_refunded_at_finalize() -> None:
    """Every event's bytes are refunded by drop_all at finalize; two full turns
    in a row both return the accumulator to 0 (no leak across turns)."""
    rig = Rig(_fn_model(_search_then_answer))
    registry = _registry(rig)

    await _run_full_turn(registry, str(uuid4()), "duke dorms?", _WEB_ONLY)
    assert registry._buffer_bytes_used == 0

    await _run_full_turn(registry, str(uuid4()), "harvard dorms?", _WEB_ONLY)
    assert registry._buffer_bytes_used == 0


async def test_byte_budget_never_evicts_the_only_event() -> None:
    """A budget smaller than any single event still leaves the sole event
    readable — the `len(self._events) > 1` guard prevents an empty buffer."""
    gate = asyncio.Event()  # never set — park after meta
    settings = FakeSettings()
    settings.stream_buffer_bytes = 1  # smaller than any event
    rig = Rig(_gated_model(gate), settings=settings)  # no chunks → meta then park
    registry = _registry(rig)
    session_id = str(uuid4())

    handle = await registry.start(session_id, "hi", _ALL_OFF)
    turn = registry._turns[session_id]
    await _eventually(lambda: turn.buffer.next_seq >= 1)  # meta landed
    # The sole event is still readable despite the 1-byte budget.
    assert len(turn.buffer._events) > 0
    assert turn.buffer.next_seq >= 1

    gate.set()
    await registry.cancel(session_id)
    await _drain(handle)


# ---------------------------------------------------------------------------
# BC-02: the consumer slot is claimed inside _follow (no leak on undriven handle)
# ---------------------------------------------------------------------------


async def test_undriven_handle_does_not_leak_a_consumer_slot() -> None:
    """A handle from attach() that is never iterated must claim no slot; closing
    a never-iterated generator must not over-decrement."""
    gate = asyncio.Event()  # never set — turn stays live
    rig = Rig(_gated_model(gate, _LONG_CHUNK))
    registry = _registry(rig)
    session_id = str(uuid4())

    c1 = Collector(await registry.start(session_id, "hi", _ALL_OFF))
    await asyncio.wait_for(c1.first_visible.wait(), timeout=3)
    turn = registry._turns[session_id]
    await _eventually(lambda: turn.consumers >= 1)
    before = turn.consumers

    # A second handle that is NEVER iterated.
    handle = registry.attach(session_id)
    await asyncio.sleep(0)
    assert turn.consumers == before  # the un-iterated handle claimed nothing

    await handle.aclose()  # type: ignore[attr-defined]  # closed but never driven
    await asyncio.sleep(0)
    assert turn.consumers == before  # no over-decrement

    gate.set()
    await registry.cancel(session_id)
    await c1.done()


# ---------------------------------------------------------------------------
# BC-03: concurrent cancels → exactly one terminal + one persist
# ---------------------------------------------------------------------------


async def test_concurrent_cancel_produces_exactly_one_terminal_and_one_persist() -> None:
    gate = asyncio.Event()  # never set — the model hangs mid-stream
    rig = Rig(_gated_model(gate, _LONG_CHUNK))
    registry = _registry(rig)
    session_id = str(uuid4())

    collector = Collector(await registry.start(session_id, "duke dorms?", _ALL_OFF))
    await asyncio.wait_for(collector.first_visible.wait(), timeout=3)

    persist_calls = 0
    original = registry._persist_partial

    async def counting_persist(*args: Any, **kwargs: Any) -> None:
        nonlocal persist_calls
        persist_calls += 1
        await original(*args, **kwargs)

    registry._persist_partial = counting_persist  # type: ignore[method-assign]

    outcomes = await asyncio.gather(
        registry.cancel(session_id), registry.cancel(session_id)
    )
    assert set(outcomes) == {"cancelled", "idle"}

    pairs = await collector.done()
    types = [e.type for e, _ in pairs]
    assert types.count("done") == 1
    assert pairs[-1][0].data["status"] == "cancelled"
    assert "error" not in types

    values = await _state_values(rig, session_id)
    assert len(values["turn_records"]) == 1
    assert values["turn_records"][-1]["status"] == "cancelled"
    assert persist_calls == 1


# ---------------------------------------------------------------------------
# BC-04: external cancel racing our cancel → a single terminal, nothing after
# ---------------------------------------------------------------------------


async def test_external_cancel_racing_our_cancel_yields_single_terminal() -> None:
    gate = asyncio.Event()  # never set — the model hangs mid-stream
    rig = Rig(_gated_model(gate, _LONG_CHUNK))
    registry = _registry(rig)
    session_id = str(uuid4())

    collector = Collector(await registry.start(session_id, "duke dorms?", _ALL_OFF))
    await asyncio.wait_for(collector.first_visible.wait(), timeout=3)

    turn = registry._turns[session_id]
    assert turn.task is not None

    async def _external() -> None:
        turn.task.cancel()  # type: ignore[union-attr]

    await asyncio.gather(_external(), registry.cancel(session_id))

    pairs = await collector.done()
    types = [e.type for e, _ in pairs]
    terminals = [t for t in types if t in ("done", "error")]
    assert len(terminals) == 1  # exactly one terminal
    assert types[-1] in ("done", "error")  # nothing follows it


# ---------------------------------------------------------------------------
# BC-05: append after close is a no-op
# ---------------------------------------------------------------------------


def test_append_after_close_is_a_noop(caplog: pytest.LogCaptureFixture) -> None:
    buffer = _RingBuffer(10, on_charge=lambda n: 1_000, on_refund=lambda n: None)
    buffer.append(ev_delta("hi"))
    assert buffer.next_seq == 1
    buffer.close()
    with caplog.at_level("WARNING"):
        buffer.append(ev_done("complete"))
    assert buffer.next_seq == 1  # the post-close append was dropped
    assert len(buffer._events) == 1
    assert any("append after close" in r.message for r in caplog.records)


# ---------------------------------------------------------------------------
# BC-06: a foreign/future Last-Event-ID full-replays (never a silent skip)
# ---------------------------------------------------------------------------


async def test_foreign_last_event_id_full_replays_not_silent_skip() -> None:
    """A cursor from a PREVIOUS turn (ahead of the new turn's fresh buffer) must
    full-replay the new turn from the head, never block forever, never skip."""
    rig = Rig(_fn_model(_search_then_answer))
    registry = _registry(rig)
    session_id = str(uuid4())

    pairs_1 = await _run_full_turn(registry, session_id, "duke dorms?", _WEB_ONLY)
    top_seq = pairs_1[-1][1]

    # A SECOND turn on the same session — new buffer at base 0. Hang it so we
    # can attach mid-stream with a far-ahead foreign cursor.
    gate = asyncio.Event()
    rig.deps.model_factory = lambda: _gated_model(gate, _LONG_CHUNK, after=" done.")
    c1 = Collector(await registry.start(session_id, "harvard?", _ALL_OFF))
    await asyncio.wait_for(c1.first_visible.wait(), timeout=3)

    reattached = registry.attach(session_id, last_event_id=top_seq + 5)
    c2 = Collector(reattached)
    await asyncio.wait_for(c2.first_visible.wait(), timeout=3)
    # The reattached consumer replays from the head: first seq is 0 and it sees
    # the new turn's meta (no silent skip).
    assert c2.items[0][1] == 0
    assert c2.items[0][0].type == "meta"

    gate.set()
    pairs = await c2.done()
    # Not blocked forever: it terminates with the new turn's terminal.
    assert pairs[-1][0].type == "done"
    assert pairs[-1][0].data["status"] == "complete"
    await c1.done()


async def test_caught_up_cursor_waits_then_follows_live() -> None:
    """A cursor exactly at next_seq (caught up) is NOT treated as foreign — it
    waits then follows live contiguously (guards the seq == next_seq edge)."""
    gate = asyncio.Event()
    rig = Rig(_gated_model(gate, _LONG_CHUNK, after=" More."))
    registry = _registry(rig)
    session_id = str(uuid4())

    first = Collector(await registry.start(session_id, "hi", _ALL_OFF))
    await asyncio.wait_for(first.first_visible.wait(), timeout=3)
    last_seq = first.items[-1][1]

    reattached = registry.attach(session_id, last_event_id=last_seq)
    gate.set()
    pairs = await _drain(reattached)
    # Contiguous from last_seq + 1 — the caught-up cursor followed live.
    assert [seq for _, seq in pairs] == list(range(last_seq + 1, last_seq + 1 + len(pairs)))
    await first.done()


# ---------------------------------------------------------------------------
# BC-07: _observe is pure, synchronous, and O(1) (enrichment only on usage)
# ---------------------------------------------------------------------------


async def test_observe_is_pure_and_non_blocking(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.turns as turns_module

    rig = Rig(_fn_model(_search_then_answer))
    registry = _registry(rig)

    # _observe is a plain def, not a coroutine.
    assert not asyncio.iscoroutinefunction(registry._observe)

    from app.turns import _RingBuffer as _RB
    from app.turns import _Turn

    turn = _Turn(
        session_id="s",
        user_text="hi",
        user_id=None,
        buffer=_RB(10, on_charge=lambda n: 1_000, on_refund=lambda n: None),
    )

    # A delta passes through unchanged and appends exactly once to emissions.
    delta = ev_delta("hi")
    out = registry._observe(turn, delta)
    assert out is delta
    assert turn.emissions == [("delta", "hi")]

    # Enrichment is invoked only for usage events — never per delta/step/thinking.
    calls = 0

    def spy(event: Event, model: str, settings: Any) -> Event:
        nonlocal calls
        calls += 1
        return event

    monkeypatch.setattr(turns_module, "enrich_usage_event", spy)
    registry._observe(turn, ev_delta("more"))
    assert calls == 0  # a delta triggered no enrichment
    registry._observe(turn, Event(type="usage", data={"input_tokens": 1, "output_tokens": 1}))
    assert calls == 1  # exactly one enrichment for the one usage event


# ---------------------------------------------------------------------------
# BC-08: a hung partial-persist still finalizes + frees the claim
# ---------------------------------------------------------------------------


async def test_partial_persist_db_hang_still_finalizes_and_frees_the_claim() -> None:
    gate = asyncio.Event()  # never set — the model hangs mid-stream
    settings = FakeSettings()
    settings.persist_partial_timeout_s = 0.05
    rig = Rig(_gated_model(gate, _LONG_CHUNK), settings=settings)
    registry = _registry(rig)
    session_id = str(uuid4())

    # Wedge the DB: aupdate_state hangs forever.
    async def hang(*args: Any, **kwargs: Any) -> None:
        await asyncio.sleep(1e9)

    registry._graph.aupdate_state = hang

    collector = Collector(await registry.start(session_id, "duke dorms?", _ALL_OFF))
    await asyncio.wait_for(collector.first_visible.wait(), timeout=3)

    # The cancel must NOT hang despite the wedged DB.
    outcome = await asyncio.wait_for(registry.cancel(session_id), timeout=2)
    assert outcome == "cancelled"

    pairs = await collector.done()
    assert pairs[-1][0].type == "done"
    assert pairs[-1][0].data["status"] == "cancelled"
    assert registry.is_generating(session_id) is False  # claim freed despite hang


async def test_partial_persist_timeout_does_not_emit_double_terminal() -> None:
    gate = asyncio.Event()  # never set
    settings = FakeSettings()
    settings.persist_partial_timeout_s = 0.05
    rig = Rig(_gated_model(gate, _LONG_CHUNK), settings=settings)
    registry = _registry(rig)
    session_id = str(uuid4())

    async def hang(*args: Any, **kwargs: Any) -> None:
        await asyncio.sleep(1e9)

    registry._graph.aupdate_state = hang

    collector = Collector(await registry.start(session_id, "hi", _ALL_OFF))
    await asyncio.wait_for(collector.first_visible.wait(), timeout=3)

    await asyncio.wait_for(registry.cancel(session_id), timeout=2)
    pairs = await collector.done()
    types = [e.type for e, _ in pairs]
    terminals = [t for t in types if t in ("done", "error")]
    assert len(terminals) == 1  # exactly one terminal despite the timeout


# ---------------------------------------------------------------------------
# BC-15: shutdown drain terminates an active turn with `error`, not `cancelled`
# ---------------------------------------------------------------------------


async def test_aclose_terminates_active_turn_with_error_not_cancelled() -> None:
    gate = asyncio.Event()  # never set
    rig = Rig(_gated_model(gate, _LONG_CHUNK))
    registry = _registry(rig)
    session_id = str(uuid4())

    collector = Collector(await registry.start(session_id, "duke dorms?", _ALL_OFF))
    await asyncio.wait_for(collector.first_visible.wait(), timeout=3)

    await registry.aclose()

    pairs = await collector.done()
    types = [e.type for e, _ in pairs]
    assert pairs[-1][0].type == "error"  # NOT done
    assert "done" not in types
    values = await _state_values(rig, session_id)
    record = values["turn_records"][-1]
    assert record["status"] == "error"
    assert prose_of(record["parts"]) == _prose(pairs)
    assert registry.is_generating(session_id) is False
