"""Unit + equivalence tests for the single terminal-persistence owner.

``app/turn_persistence.py`` (audit H1/H2) owns the empty-partial rule, the one
``aupdate_state`` payload builder, and the lifecycle predicates
(``is_parked``/``parked_record``/``resolve_offset``/``AGENT_NODE``). These were
four "KEEP IN SYNC" copies before; the headline equivalence tests pin the record
shape per status so a future drift is caught (the prose invariant is the
honesty surface — ARCHITECTURE §27.7 G2).
"""

from __future__ import annotations

from typing import Any

import pytest
from pydantic_ai.messages import (
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)

from app.records import (
    Emission,
    append_or_replace,
    build_turn_record,
    now_iso,
)
from app.turn_persistence import (
    AGENT_NODE,
    build_terminal_update,
    is_parked,
    parked_record,
    partial_messages,
    resolve_offset,
)

# ---------------------------------------------------------------------------
# Wire-shape helpers (the serialized message dicts the checkpointer stores)
# ---------------------------------------------------------------------------


def _request(text: str) -> dict[str, Any]:
    req = ModelRequest(parts=[UserPromptPart(content=text)])
    out: dict[str, Any] = ModelMessagesTypeAdapter.dump_python([req], mode="json")[0]
    return out


def _response(text: str) -> dict[str, Any]:
    resp = ModelResponse(parts=[TextPart(content=text)])
    out: dict[str, Any] = ModelMessagesTypeAdapter.dump_python([resp], mode="json")[0]
    return out


_IDS = {"message_id": "m-1", "user_message_id": "u-1"}


@pytest.fixture
def _hermetic(monkeypatch: pytest.MonkeyPatch) -> None:
    """No DB in prepare, no asset loading in the prompt builder — for the
    integration tests that drive run_turn over the test_run_turn Rig."""
    import app.agent_node
    import app.graph
    from app.state import TemporalContext
    from tests.app.test_run_turn import _TEMPORAL

    async def fake_temporal(catalog: Any, today: Any = None) -> TemporalContext:
        return _TEMPORAL

    monkeypatch.setattr(app.graph, "build_temporal_context", fake_temporal)
    monkeypatch.setattr(app.agent_node, "build_system_prompt", lambda ctx: "Test counselor.")


# ---------------------------------------------------------------------------
# partial_messages — the empty-partial rule (one owner)
# ---------------------------------------------------------------------------


def test_partial_messages_appends_when_prose_and_request_tail() -> None:
    messages = [_request("duke dorms?")]
    emissions: list[Emission] = [("delta", "The dorms "), ("delta", "are great.")]
    out, changed = partial_messages(messages, emissions)

    assert changed is True
    assert len(out) == 2
    assert out[0] == messages[0]  # original untouched (new list)
    assert out[-1]["kind"] == "response"
    text = "".join(
        p.get("content", "") for p in out[-1]["parts"] if p.get("part_kind") == "text"
    )
    assert text == "The dorms are great."
    # Immutability: the input list is not mutated.
    assert len(messages) == 1


def test_partial_messages_no_prose_returns_unchanged() -> None:
    messages = [_request("hi")]
    out, changed = partial_messages(messages, [("step", {"x": 1})])
    assert changed is False
    assert out is messages


def test_partial_messages_response_tail_returns_unchanged() -> None:
    # Prose streamed but the tail is a response (no request to anchor) → no-op.
    messages = [_request("hi"), _response("prior")]
    out, changed = partial_messages(messages, [("delta", "more")])
    assert changed is False
    assert out is messages


def test_partial_messages_empty_messages_returns_unchanged() -> None:
    out, changed = partial_messages([], [("delta", "orphan prose")])
    assert changed is False
    assert out == []


# ---------------------------------------------------------------------------
# resolve_offset
# ---------------------------------------------------------------------------


def test_resolve_offset_explicit_int_wins() -> None:
    assert resolve_offset(7, [_request("a"), _response("b")]) == 7
    assert resolve_offset(0, []) == 0


def test_resolve_offset_request_tail_is_len_minus_one() -> None:
    messages = [_response("prior"), _request("now")]
    assert resolve_offset(None, messages) == len(messages) - 1


def test_resolve_offset_response_tail_is_len() -> None:
    messages = [_request("q"), _response("a")]
    assert resolve_offset(None, messages) == len(messages)


def test_resolve_offset_empty_is_zero() -> None:
    assert resolve_offset(None, []) == 0


# ---------------------------------------------------------------------------
# is_parked / parked_record
# ---------------------------------------------------------------------------


def _rec(message_id: str, status: str, **extra: Any) -> dict[str, Any]:
    return {"message_id": message_id, "status": status, **extra}


def test_is_parked_true_on_awaiting_input_tail() -> None:
    records = [_rec("m-1", "complete"), _rec("m-2", "awaiting_input")]
    assert is_parked(records) is True
    assert parked_record(records) == records[-1]


def test_is_parked_false_on_non_awaiting_tail() -> None:
    records = [_rec("m-1", "awaiting_input"), _rec("m-2", "complete")]
    assert is_parked(records) is False
    assert parked_record(records) is None


def test_is_parked_false_on_empty() -> None:
    assert is_parked([]) is False
    assert parked_record([]) is None


# ---------------------------------------------------------------------------
# build_terminal_update — sets messages key iff the partial changed it
# ---------------------------------------------------------------------------


def test_build_terminal_update_sets_messages_only_when_partial_changed() -> None:
    messages = [_request("duke dorms?")]
    update = build_terminal_update(
        messages=messages,
        records=[],
        emissions=[("delta", "Streamed.")],
        ids=_IDS,
        status="cancelled",
        sources=[],
        user_text="duke dorms?",
        messages_offset=0,
    )
    assert "messages" in update
    assert update["messages"][-1]["kind"] == "response"
    assert len(update["turn_records"]) == 1
    assert update["turn_records"][-1]["status"] == "cancelled"


def test_build_terminal_update_omits_messages_when_no_partial() -> None:
    update = build_terminal_update(
        messages=[_request("hi")],
        records=[],
        emissions=[],  # no prose → no append
        ids=_IDS,
        status="error",
        sources=[],
        user_text="hi",
        messages_offset=0,
        error={"message": "boom", "trace_id": "t-1"},
    )
    assert "messages" not in update
    assert update["turn_records"][-1]["status"] == "error"


# ---------------------------------------------------------------------------
# H1 parked-record write — only turn_records, never messages
# ---------------------------------------------------------------------------


def test_parked_write_does_not_mutate_messages() -> None:
    """The parked-record write (run_turn passes ``messages=[]``) must produce an
    update with NO ``messages`` key — the parked path only writes
    ``turn_records`` (audit H1, parked-record write). Even though the emissions
    carry streamed prose, the empty-partial rule is a no-op against the empty
    ``messages`` list, so the parked write never touches the provider history."""
    update = build_terminal_update(
        messages=[],  # parked write never touches messages
        records=[_rec("m-0", "complete")],
        emissions=[("delta", "Let me check that for you.")],
        ids=_IDS,
        status="awaiting_input",
        sources=[],
        user_text="Is NYU good?",
        messages_offset=0,
        clarify={"spec": {"question": "Which campus?"}, "answer": None},
    )
    assert "messages" not in update  # the parked write writes only the record
    assert "turn_records" in update
    assert update["turn_records"][-1]["status"] == "awaiting_input"


# ---------------------------------------------------------------------------
# Equivalence: build_terminal_update == the pre-refactor hand-built record
# ---------------------------------------------------------------------------


def _record_fields_minus_ts(record: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in record.items() if k != "ts"}


@pytest.mark.parametrize(
    ("status", "emissions", "clarify", "synthesized"),
    [
        (
            "complete",
            [
                ("step", {"step_id": "s1", "status": "end", "kind": "web_search"}),
                ("delta", "Done [1]."),
            ],
            None,
            False,
        ),
        ("error", [("delta", "Half a sentence")], None, False),
        ("cancelled", [("delta", "Streamed before stop.")], None, False),
        (
            "awaiting_input",
            [("delta", "Let me check.")],
            {"spec": {"question": "Which campus?"}, "answer": None},
            False,
        ),
    ],
)
def test_build_terminal_update_record_equals_hand_built(
    status: str,
    emissions: list[Emission],
    clarify: dict[str, Any] | None,
    synthesized: bool,
) -> None:
    """The headline equivalence anchor: the record produced via
    build_terminal_update is identical (modulo ts) to the record the
    pre-refactor inline code produced for the same inputs."""
    messages = [_request("the question?")]
    sources = [{"index": 1, "citation": {"url": "https://example.com/1"}}]
    error = {"message": "boom", "trace_id": "t-1"} if status == "error" else None
    usage = (
        {"input_tokens": 1, "output_tokens": 2, "tool_calls": 1}
        if status == "complete"
        else None
    )

    # The pre-refactor inline construction (the empty-partial rule + the record).
    prose = "".join(text for kind, text in emissions if kind == "delta")
    inline_messages = list(messages)
    if prose and inline_messages and inline_messages[-1].get("kind") == "request":
        partial = ModelResponse(parts=[TextPart(content=prose)])
        inline_messages = inline_messages + list(
            ModelMessagesTypeAdapter.dump_python([partial], mode="json")
        )
    expected = build_turn_record(
        emissions,
        ids=_IDS,
        status=status,  # type: ignore[arg-type]
        sources=sources,
        user_text="the question?",
        usage=usage,
        error=error,
        clarify=clarify,
        ts=now_iso(),
        messages_offset=0,
        synthesized_answer=synthesized,
    )

    update = build_terminal_update(
        messages=messages,
        records=[],
        emissions=emissions,
        ids=_IDS,
        status=status,  # type: ignore[arg-type]
        sources=sources,
        user_text="the question?",
        messages_offset=0,
        usage=usage,
        error=error,
        clarify=clarify,
        synthesized_answer=synthesized,
    )
    produced = update["turn_records"][-1]
    assert _record_fields_minus_ts(produced) == _record_fields_minus_ts(expected)
    # The messages delta matches the inline empty-partial result. Compare the
    # appended prose, not the full serialized dict (each ModelResponse mints a
    # fresh timestamp — not part of the prose invariant).
    if prose:
        out_messages = update.get("messages")
        assert out_messages is not None
        assert len(out_messages) == len(inline_messages) == 2
        assert out_messages[-1]["kind"] == "response"
        produced_text = "".join(
            p.get("content", "")
            for p in out_messages[-1]["parts"]
            if p.get("part_kind") == "text"
        )
        assert produced_text == prose
    else:
        assert "messages" not in update


def test_build_terminal_update_offset_matches_explicit() -> None:
    """resolve_offset is computed against the post-append messages, but an
    explicit offset always wins (the normal path) — pin that equivalence."""
    messages = [_response("prior turn"), _request("now")]
    update = build_terminal_update(
        messages=messages,
        records=[],
        emissions=[("delta", "answer")],
        ids=_IDS,
        status="complete",
        sources=[],
        user_text="now",
        messages_offset=1,
    )
    assert update["turn_records"][-1]["messages_offset"] == 1


# ---------------------------------------------------------------------------
# build_terminal_update uses append_or_replace (resume replaces the parked rec)
# ---------------------------------------------------------------------------


def test_build_terminal_update_replaces_parked_record_same_id() -> None:
    parked = _rec("m-1", "awaiting_input", clarify={"spec": {"q": "?"}, "answer": None})
    update = build_terminal_update(
        messages=[],
        records=[parked],
        emissions=[("delta", "resolved")],
        ids={"message_id": "m-1", "user_message_id": "u-2"},
        status="cancelled",
        sources=[],
        user_text="orig question",
        messages_offset=0,
        clarify={"spec": {"q": "?"}, "answer": "the answer"},
    )
    records = update["turn_records"]
    assert len(records) == 1  # replaced, not appended
    assert records[0]["status"] == "cancelled"
    assert records[0]["message_id"] == "m-1"


def test_build_terminal_update_append_or_replace_is_the_records_helper() -> None:
    # The builder uses the shared append_or_replace; a non-matching id appends.
    prior = [_rec("m-0", "complete")]
    update = build_terminal_update(
        messages=[],
        records=prior,
        emissions=[],
        ids=_IDS,
        status="error",
        sources=[],
        user_text="hi",
        messages_offset=0,
        error={"message": "x", "trace_id": "t"},
    )
    assert update["turn_records"] == append_or_replace(
        prior, update["turn_records"][-1]
    )
    assert len(update["turn_records"]) == 2


# ---------------------------------------------------------------------------
# AGENT_NODE drift guard — the constant equals the node the graph registered
# ---------------------------------------------------------------------------


def test_agent_node_matches_the_compiled_graph_node() -> None:
    """A rename of the agent node must not silently break unpark/rewrite: the
    shared AGENT_NODE constant is the node app.graph.build_graph registers."""
    from langgraph.checkpoint.memory import InMemorySaver

    from app.graph import GraphDeps, build_graph

    graph = build_graph(InMemorySaver(), GraphDeps(catalog=None))  # type: ignore[arg-type]
    nodes = graph.get_graph().nodes
    assert AGENT_NODE in nodes
    assert AGENT_NODE == "agent"


# ---------------------------------------------------------------------------
# Integration: BC-11 resume-failure orphan + BC-14 parked-OR desync
# (these reuse the test_run_turn Rig; no DB, no LLM)
# ---------------------------------------------------------------------------


def _types(events: list[Any]) -> list[str]:
    return [event.type for event in events]


async def test_bc11_failed_resume_prewrite_leaves_the_thread_parked(
    _hermetic: None,
) -> None:
    """A resume whose pre-run aupdate_state raises ends the stream with an
    error AND leaves the parked awaiting_input record last (thread still
    parked) — write NO error record. A subsequent normal message is then
    detected as a resume, not a new turn."""
    from tests.app.test_run_turn import Rig, _clarify_then_answer, _fn_model

    rig = Rig(_fn_model(_clarify_then_answer))
    session_id = "bc11-" + "s"

    # Turn 1 parks on a clarify.
    events_1 = await rig.turn(session_id, "Is NYU good?")
    assert next(e.data["status"] for e in events_1 if e.type == "done") == "awaiting_input"
    config: Any = {"configurable": {"thread_id": session_id}}
    parked_before = (await rig.graph.aget_state(config)).values["turn_records"][-1]
    assert parked_before["status"] == "awaiting_input"

    # Wedge ONLY the resume pre-write (the turn_ids+resume_text aupdate_state).
    original = rig.graph.aupdate_state

    async def patched(cfg: Any, values: Any = None, *args: Any, **kwargs: Any) -> Any:
        if isinstance(values, dict) and "turn_ids" in values:
            tids = values.get("turn_ids") or {}
            if isinstance(tids, dict) and "resume_text" in tids:
                raise RuntimeError("resume pre-write blip")
        return await original(cfg, values, *args, **kwargs)

    rig.graph.aupdate_state = patched  # type: ignore[assignment]

    # The answering POST: the resume pre-write fails.
    events_2 = await rig.turn(session_id, "cost")
    assert "error" in _types(events_2)
    assert "done" not in _types(events_2)  # no terminal done — just the error

    # The thread is STILL parked: the awaiting_input record is unchanged, no
    # error record was appended after it.
    records_after = (await rig.graph.aget_state(config)).values["turn_records"]
    assert records_after[-1]["status"] == "awaiting_input"
    assert records_after[-1]["message_id"] == parked_before["message_id"]
    assert len(records_after) == 1  # no orphaned error record appended

    # Unwedge: a subsequent normal message is detected as a RESUME (reuses the
    # parked message_id), not a fresh turn.
    rig.graph.aupdate_state = original  # type: ignore[method-assign]  # restore
    events_3 = await rig.turn(session_id, "cost")
    meta_3 = next(e.data for e in events_3 if e.type == "meta")
    assert meta_3["message_id"] == parked_before["message_id"]  # resume, not new turn
    assert next(e.data["status"] for e in events_3 if e.type == "done") == "complete"


def test_bc14_parked_record_ignores_interrupts_entirely() -> None:
    """The parked predicate is record-only — there is no OR-on-interrupt
    (audit BC-14). is_parked/parked_record inspect the records list and nothing
    else, so a torn write (record cancelled but a stale interrupt lingering in
    snapshot.tasks) can never re-trip the resume path."""
    import inspect

    import app.turn_persistence as tp

    # The predicates take ONLY the records list — no snapshot / tasks param.
    assert list(inspect.signature(is_parked).parameters) == ["records"]
    assert list(inspect.signature(parked_record).parameters) == ["records"]
    # A cancelled tail is never parked, even though a real thread could still
    # carry a stale interrupt at that moment.
    assert is_parked([_rec("m-1", "cancelled")]) is False
    assert parked_record([_rec("m-1", "cancelled")]) is None
    # The predicate body never reads tasks/interrupts — record only.
    body = inspect.getsource(tp.is_parked).split('"""')[-1]
    assert "task" not in body and "interrupt" not in body


async def test_bc14_cancelled_record_runs_a_fresh_turn_not_a_resume(
    _hermetic: None,
) -> None:
    """A thread whose last record is cancelled (the unpark froze it) is NOT
    parked: the record is the sole signal, so the next message runs a FRESH
    turn (its own clarify), never swallowed as a stale clarify answer."""
    from tests.app.test_run_turn import Rig, _clarify_then_answer, _fn_model

    rig = Rig(_fn_model(_clarify_then_answer))
    session_id = "bc14-s"
    config: Any = {"configurable": {"thread_id": session_id}}

    # Park, then freeze the record to cancelled via the overwrite channel.
    await rig.turn(session_id, "Is NYU good?")
    snap = await rig.graph.aget_state(config)
    records = list(snap.values["turn_records"])
    parked_id = records[-1]["message_id"]
    records[-1] = {**records[-1], "status": "cancelled"}
    await rig.graph.aupdate_state(config, {"turn_records": records})
    frozen = (await rig.graph.aget_state(config)).values["turn_records"][-1]
    assert frozen["status"] == "cancelled"

    # The next message runs a FRESH turn (record wins — not a resume).
    events = await rig.turn(session_id, "Is Duke good?")
    assert "clarify" in _types(events)
    new_record = (await rig.graph.aget_state(config)).values["turn_records"][-1]
    assert new_record["user_text"] == "Is Duke good?"
    assert new_record["message_id"] != parked_id  # a new turn id, not the resumed one
