"""The transcript wire shape (B1b — wire-contract §2). No DB, no network.

Runs real graph turns through the test Rig (memory checkpointer +
FunctionModel), then asserts ``extract_transcript`` serves the §2 contract
verbatim — field names, status literals, ``clarify {spec, answer}``, the
synthesized clarify-answer bubble, materialized ``parts``, the receipt string
— plus the pinned pre-MVP2 prose-only fallback (keys absent, not null).
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest
from pydantic_ai.messages import (
    ModelMessage,
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    TextPart,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
)
from pydantic_ai.models.function import AgentInfo

import app.agent_node
import app.graph
import app.viz
from app.records import build_turn_record
from app.state import TemporalContext
from app.transcript import extract_transcript
from domain.season import Season
from domain.specs import RenderSpec
from tests.app.test_run_turn import (
    _ALL_OFF,
    _WEB_ONLY,
    Rig,
    _fn_model,
    _text,
    _viz_spec,
)

_TEMPORAL = TemporalContext(
    today="2026-06-10",
    season=Season(
        phase="exploration",
        description="Rising seniors research schools.",
        entering_class="Fall 2027",
        cycle_note="It is the exploration phase for the class entering Fall 2027.",
    ),
    data_calendar=[],
    context="Today is 2026-06-10.",
)


@pytest.fixture(autouse=True)
def _hermetic(monkeypatch: pytest.MonkeyPatch) -> None:
    """Same hermetic patches as tests/app/test_run_turn.py (its autouse
    fixture does not apply across modules)."""

    async def fake_temporal(catalog: Any, today: Any = None) -> TemporalContext:
        return _TEMPORAL

    monkeypatch.setattr(app.graph, "build_temporal_context", fake_temporal)
    monkeypatch.setattr(app.agent_node, "build_system_prompt", lambda *a: "Test counselor.")


async def _transcript_of(rig: Rig, session_id: str) -> list[dict[str, Any]]:
    snapshot = await rig.graph.aget_state({"configurable": {"thread_id": session_id}})
    return extract_transcript(
        list(snapshot.values.get("messages") or []),
        list(snapshot.values.get("turn_records") or []),
    )


def _messages(*texts: str) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    for text in texts:
        messages.extend(
            ModelMessagesTypeAdapter.dump_python(
                [ModelRequest(parts=[UserPromptPart(content=text)])],
                mode="json",
            )
        )
    return messages


def _clarify_spec() -> dict[str, Any]:
    return {
        "v": 1,
        "question": "What matters most to you?",
        "header": "Pick one",
        "multi_select": False,
        "options": [
            {"label": "Cost", "hint": "affordability and aid"},
            {"label": "Academics", "hint": "programs and rigor"},
        ],
    }


def _record(
    *,
    message_id: str,
    user_message_id: str,
    user_text: str,
    status: str = "complete",
    text: str = "",
    clarify: dict[str, Any] | None = None,
    messages_offset: int = 0,
    synthesized_answer: bool = False,
    usage: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return build_turn_record(
        [("delta", text)] if text else [],
        ids={"message_id": message_id, "user_message_id": user_message_id},
        status=status,  # type: ignore[arg-type]
        sources=[],
        user_text=user_text,
        usage=usage,
        clarify=clarify,
        ts="2026-06-12T00:00:00+00:00",
        messages_offset=messages_offset,
        synthesized_answer=synthesized_answer,
    )


# ---------------------------------------------------------------------------
# The full wire-shape assertion: complete + clarify + resume in one session
# ---------------------------------------------------------------------------


async def test_transcript_wire_shape_complete_clarify_resume() -> None:
    messages = _messages("tell me about duke", "Is NYU good?")
    records = [
        _record(
            message_id="m-1",
            user_message_id="u-1",
            user_text="tell me about duke",
            text="Duke is strong in engineering.",
            messages_offset=0,
            usage={"input_tokens": 1, "output_tokens": 1, "tool_calls": 0},
        ),
        _record(
            message_id="m-2",
            user_message_id="u-2",
            user_text="Is NYU good?",
            text="Focusing on cost.",
            clarify={"spec": _clarify_spec(), "answer": "cost"},
            messages_offset=1,
            synthesized_answer=True,
            usage={"input_tokens": 1, "output_tokens": 1, "tool_calls": 0},
        ),
    ]

    transcript = extract_transcript(messages, records)
    assert [e["role"] for e in transcript] == ["user", "assistant", "user", "user", "assistant"]
    user_1, assistant_1, question_2, answer_2, assistant_2 = transcript

    # Turn 1 — the complete turn.
    assert user_1 == {
        "role": "user",
        "text": "tell me about duke",
        "ts": assistant_1["ts"],
        "message_id": "u-1",
    }
    assert assistant_1["message_id"] == "m-1"
    assert assistant_1["status"] == "complete"
    assert assistant_1["text"] == "Duke is strong in engineering."
    assert assistant_1["parts"] == [{"type": "text", "text": "Duke is strong in engineering."}]
    assert assistant_1["segments"] == [
        {"kind": "delta", "text": "Duke is strong in engineering."}
    ]
    assert assistant_1["step_record"] == {
        "steps": [],
        "narration": [],
        "thinking": [],
        "receipt": "",
    }
    assert assistant_1["sources"] == []
    assert assistant_1["usage"]["input_tokens"] >= 0
    assert assistant_1["ts"]
    assert "error" not in assistant_1 and "clarify" not in assistant_1

    # Turn 2+3 — the clarify turn, resumed: ONE assistant entry (the resumed
    # record replaced the parked one, same message_id).
    # The original question renders id-less (its parked-era record was replaced).
    assert question_2 == {"role": "user", "text": "Is NYU good?", "ts": None}
    # The synthesized answer bubble (G4): first-class, never an edit target.
    assert answer_2 == {
        "role": "user",
        "text": "cost",
        "ts": assistant_2["ts"],
        "message_id": "u-2",
        "synthesized": True,
    }
    assert assistant_2["message_id"] == "m-2"
    assert assistant_2["status"] == "complete"
    assert assistant_2["clarify"] == {
        "spec": {
            "v": 1,
            "question": "What matters most to you?",
            "header": "Pick one",
            "multi_select": False,
            "options": [
                {"label": "Cost", "hint": "affordability and aid"},
                {"label": "Academics", "hint": "programs and rigor"},
            ],
        },
        "answer": "cost",
    }
    assert assistant_2["text"] == "Focusing on cost."
    assert assistant_2["parts"] == [{"type": "text", "text": assistant_2["text"]}]


async def test_transcript_parked_turn_entry() -> None:
    messages = _messages("tell me about duke", "Is NYU good?")
    records = [
        _record(
            message_id="m-1",
            user_message_id="u-1",
            user_text="tell me about duke",
            text="Duke is strong in engineering.",
            messages_offset=0,
            usage={"input_tokens": 1, "output_tokens": 1, "tool_calls": 0},
        ),
        _record(
            message_id="m-2",
            user_message_id="u-2",
            user_text="Is NYU good?",
            status="awaiting_input",
            clarify={"spec": _clarify_spec(), "answer": None},
            messages_offset=1,
        ),
    ]

    transcript = extract_transcript(messages, records)
    assert [e["role"] for e in transcript] == ["user", "assistant", "user", "assistant"]
    parked = transcript[-1]
    assert parked["status"] == "awaiting_input"
    assert parked["message_id"] == "m-2"
    assert parked["clarify"]["answer"] is None
    assert parked["clarify"]["spec"]["question"] == "What matters most to you?"
    assert "usage" not in parked  # the parked record has no usage yet
    # The parked user entry is first-class (the turn's own ids).
    assert transcript[2]["message_id"] == "u-2"
    assert transcript[2]["text"] == "Is NYU good?"


async def test_transcript_steps_and_receipt_round_trip() -> None:
    from tests.app.test_run_turn import _search_then_answer

    rig = Rig(_fn_model(_search_then_answer))
    session_id = str(uuid4())

    await rig.turn(session_id, "duke dorms?", _WEB_ONLY)

    transcript = await _transcript_of(rig, session_id)
    assistant = transcript[-1]
    record = assistant["step_record"]
    assert record["receipt"] == "1 web search"
    assert [s["status"] for s in record["steps"]] == ["end"]
    assert record["steps"][0]["kind"] == "web_search"
    assert assistant["sources"][0]["index"] == 1


def _inline_viz_answer(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    last = messages[-1]
    returns = (
        [part for part in last.parts if isinstance(part, ToolReturnPart)]
        if isinstance(last, ModelRequest)
        else []
    )
    if returns:
        marker = _placement_marker(returns[0])
        return ModelResponse(parts=[TextPart(f"Intro before card. {marker} Outro after card.")])
    return ModelResponse(
        parts=[
            ToolCallPart(
                tool_name="render_viz",
                args={
                    "type": "comparison_table",
                    "unitids": [1],
                    "field_keys": ["admissions.rate"],
                    "title": "Inline card",
                },
            )
        ]
    )


def _placement_marker(part: ToolReturnPart) -> str:
    assert isinstance(part.content, dict)
    marker = part.content["placement_marker"]
    assert isinstance(marker, str)
    return marker


async def test_transcript_final_content_has_inline_viz_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_build_spec(
        _catalog: object,
        _type: str,
        _unitids: list[int],
        _field_keys: list[str] | None,
        _title: str | None,
    ) -> RenderSpec:
        return _viz_spec("admissions.rate", title="Inline card")

    monkeypatch.setattr(app.viz, "_build_spec", fake_build_spec)
    rig = Rig(_fn_model(_inline_viz_answer))
    session_id = str(uuid4())

    events = await rig.turn(session_id, "place the card inline", _ALL_OFF)
    transcript = await _transcript_of(rig, session_id)

    assistant = transcript[-1]
    assert assistant["text"] == _text(events)
    assert assistant["text"] == "Intro before card.  Outro after card."
    assert "[[viz:" not in assistant["text"]
    assert [part["type"] for part in assistant["parts"]] == ["text", "viz", "text"]
    assert assistant["parts"][0]["text"] == "Intro before card. "
    assert assistant["parts"][2]["text"] == " Outro after card."
    assert all("[[viz:" not in part.get("text", "") for part in assistant["parts"])


async def test_two_independent_complete_turns_each_render_own_prose() -> None:
    """Two sequential complete turns → two records; each assistant entry keeps
    its own prose and ids (the multi-record path B2's G3 rewrite leans on)."""

    def _per_turn_answer(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        question = next(
            (
                str(part.content)
                for msg in reversed(messages)
                if isinstance(msg, ModelRequest)
                for part in msg.parts
                if isinstance(part, UserPromptPart)
            ),
            "",
        )
        return ModelResponse(parts=[TextPart(f"Answer to: {question}")])

    rig = Rig(_fn_model(_per_turn_answer))
    session_id = str(uuid4())

    events_1 = await rig.turn(session_id, "about duke", _ALL_OFF)
    events_2 = await rig.turn(session_id, "about nyu", _ALL_OFF)

    transcript = await _transcript_of(rig, session_id)
    assert [e["role"] for e in transcript] == ["user", "assistant", "user", "assistant"]
    assert transcript[0]["text"] == "about duke"
    assert transcript[1]["text"] == "Answer to: about duke"
    assert transcript[1]["message_id"] == events_1[0].data["message_id"]
    assert transcript[2]["text"] == "about nyu"
    assert transcript[3]["text"] == "Answer to: about nyu"
    assert transcript[3]["message_id"] == events_2[0].data["message_id"]
    # Distinct turns → distinct assistant message ids (no cross-turn bleed).
    assert transcript[1]["message_id"] != transcript[3]["message_id"]


async def test_first_ever_turn_is_a_clarify_offset_is_sane() -> None:
    """The first message of a brand-new session triggers a clarify: the parked
    record's messages_offset must point at the real (only) user message, and the
    transcript must render the question (the first-turn-clarify offset edge)."""
    messages = _messages("Is NYU good?")
    record = _record(
        message_id="m-1",
        user_message_id="u-1",
        user_text="Is NYU good?",
        status="awaiting_input",
        clarify={"spec": _clarify_spec(), "answer": None},
        messages_offset=0,
    )
    assert record["status"] == "awaiting_input"
    assert 0 <= record["messages_offset"] < len(messages)

    transcript = extract_transcript(messages, [record])
    # A still-parked turn's user entry is first-class (its own ids + ts).
    assert transcript[0]["role"] == "user"
    assert transcript[0]["text"] == "Is NYU good?"
    assert transcript[0]["message_id"] == "u-1"
    assert transcript[1]["status"] == "awaiting_input"


# ---------------------------------------------------------------------------
# The pinned pre-MVP2 prose-only fallback (wire-contract §2: keys ABSENT)
# ---------------------------------------------------------------------------

_PRE_MVP2_MESSAGES: list[dict[str, Any]] = [
    {
        "kind": "request",
        "parts": [{"part_kind": "user-prompt", "content": "hello"}],
    },
    {
        "kind": "response",
        "timestamp": "2026-06-01T12:00:00Z",
        "parts": [{"part_kind": "text", "content": "world"}],
    },
]


def test_pre_mvp2_fallback_is_prose_only_with_keys_absent() -> None:
    transcript = extract_transcript(_PRE_MVP2_MESSAGES, [])
    assert transcript == [
        {"role": "user", "text": "hello", "ts": None},
        {"role": "assistant", "text": "world", "ts": "2026-06-01T12:00:00Z"},
    ]
    for entry in transcript:
        for key in ("message_id", "parts", "step_record", "status", "sources", "synthesized"):
            assert key not in entry  # absent, not null — the FE default path


def test_invalid_first_record_offset_clamps_fallback_and_still_serves_records() -> None:
    """A missing/None first messages_offset must degrade (clamp + warn), never
    crash the read: everything renders prose-only AND the record still serves."""
    record = {
        "message_id": "m-1",
        "user_message_id": "u-1",
        "user_text": "hello",
        "parts": [{"type": "text", "text": "world"}],
        "steps": [],
        "thinking": [],
        "receipt": "",
        "sources": [],
        "usage": None,
        "status": "complete",
        "error": None,
        "clarify": None,
        "ts": "2026-06-12T00:00:00+00:00",
        "messages_offset": None,
        "synthesized_answer": False,
    }
    transcript = extract_transcript(_PRE_MVP2_MESSAGES, [record])
    # Clamped boundary: the messages render prose-only first…
    assert transcript[0] == {"role": "user", "text": "hello", "ts": None}
    # …and the record-backed entries still follow, self-contained.
    assert transcript[-1]["text"] == "world"
    assert transcript[-1]["message_id"] == "m-1"
    assert "narration" not in transcript[-1]["step_record"]


def test_transcript_step_record_bridges_narration_and_native_thinking() -> None:
    record = build_turn_record(
        [
            ("narration", "Checking the official data."),
            ("thinking", "Native thought summary."),
            ("delta", "Done."),
        ],
        ids={"message_id": "m-1", "user_message_id": "u-1"},
        status="complete",
        sources=[],
        user_text="hello",
        messages_offset=0,
    )

    transcript = extract_transcript([], [record])
    assistant = transcript[-1]

    assert assistant["step_record"]["narration"] == ["Checking the official data."]
    assert assistant["step_record"]["thinking"] == ["Native thought summary."]


def _always_answers(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
    """A model that completes every turn (never clarifies) — for the mixed
    fallback test, which needs a *completed* record-backed turn."""
    return ModelResponse(parts=[TextPart("Here is what I have.")])


# ---------------------------------------------------------------------------
# The pre-clarify-text repro (python HIGH#1): older parked records could have
# streamed text before asking for clarification. Pre-fix, transcript prose after
# resume could be sliced from diverged provider messages and become garbled
# (observed: "Let me narrow thi"). Self-contained records (FIX 1) +
# authoritative offsets (FIX 3) fix it.
# ---------------------------------------------------------------------------


def test_pre_clarify_text_resume_keeps_question_and_prose_intact() -> None:
    messages = _messages(
        "Is NYU good?",
        "Is NYU good?\n\nThe student answered the earlier clarification prompt with:\ncost",
    )
    streamed = "Focusing on cost."
    records = [
        _record(
            message_id="m-1",
            user_message_id="u-2",
            user_text="Is NYU good?",
            text=streamed,
            clarify={"spec": _clarify_spec(), "answer": "cost"},
            messages_offset=0,
            synthesized_answer=True,
            usage={"input_tokens": 1, "output_tokens": 1, "tool_calls": 0},
        )
    ]

    transcript = extract_transcript(messages, records)
    assert [e["role"] for e in transcript] == ["user", "user", "assistant"]
    question, answer, assistant = transcript
    # The turn's user question is still correct after the resume.
    assert question == {"role": "user", "text": "Is NYU good?", "ts": None}
    assert answer["text"] == "cost" and answer.get("synthesized") is True
    # The assistant prose is intact: exactly what the record persisted —
    # never a slice of the (diverged) messages prose.
    assert assistant["text"] == streamed
    assert assistant["parts"] == [{"type": "text", "text": streamed}]
    assert assistant["status"] == "complete"


# ---------------------------------------------------------------------------
# FIX 2: no ghost error record without a user anchor or streamed prose
# ---------------------------------------------------------------------------


async def test_error_without_user_anchor_or_prose_writes_no_ghost_entry() -> None:
    from app.run_turn import _write_failure_record

    rig = Rig(_fn_model(_always_answers))
    session_id = str(uuid4())
    config: Any = {"configurable": {"thread_id": session_id}}

    await rig.turn(session_id, "tell me about duke", _ALL_OFF)
    before = list((await rig.graph.aget_state(config)).values.get("turn_records") or [])

    # An anchorless failure: no user text, no prose streamed (steps only).
    await _write_failure_record(
        rig.graph,
        config,
        emissions=[("step", {"step_id": "s1", "status": "end", "kind": "db_tool"})],
        ids={"message_id": str(uuid4()), "user_message_id": str(uuid4())},
        user_text=None,
        trace_id="t-ghost",
        messages_offset=None,
        fallback_messages=None,
        registry_dump=[],
    )

    snapshot = await rig.graph.aget_state(config)
    records = list(snapshot.values.get("turn_records") or [])
    assert records == before  # the ghost record was never written
    transcript = extract_transcript(list(snapshot.values.get("messages") or []), records)
    assert all(e.get("status") != "error" for e in transcript)


async def test_mixed_session_fallback_entries_precede_record_entries() -> None:
    """A pre-B1b checkpoint (messages, no records) gains a new recorded turn:
    the old turns render prose-only, in order, before the record-backed ones."""
    rig = Rig(_fn_model(_always_answers))
    session_id = str(uuid4())
    config: Any = {"configurable": {"thread_id": session_id}}

    await rig.turn(session_id, "tell me about duke", _ALL_OFF)
    # Strip the record — simulating a turn persisted before B1b shipped.
    await rig.graph.aupdate_state(config, {"turn_records": []})

    events_2 = await rig.turn(session_id, "thanks, more please", _ALL_OFF)

    transcript = await _transcript_of(rig, session_id)
    assert [e["role"] for e in transcript] == ["user", "assistant", "user", "assistant"]
    # Old turn: prose-only fallback shape.
    assert "message_id" not in transcript[0]
    assert "status" not in transcript[1]
    assert transcript[1]["text"] == "Here is what I have."
    # New turn: full-fidelity record-backed shape.
    assert transcript[2]["message_id"] == events_2[0].data["user_message_id"]
    assert transcript[3]["status"] == "complete"
    assert transcript[3]["message_id"] == events_2[0].data["message_id"]
