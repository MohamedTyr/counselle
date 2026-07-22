"""The turn runner: graph/agent events → domain ``Event`` stream (Slice F).

``run_turn`` is THE function the API wraps in Phase 5 — every frontend consumes
exactly this stream (ADR 0016). Per turn it:

1. Ensures the ``counselle.sessions`` row exists (created with the request's
   source config or the settings defaults), and touches it on completion.
2. Detects a parked clarify on the thread — the last turn record's
   ``status == "awaiting_input"`` is the SOLE signal (B1b; the parked-record
   write empties ``tasks[*].interrupts``, so there is no OR-on-interrupt
   fallback — audit BC-14). Agent V1 no longer mounts ``ask_student``, so a
   parked answer is migrated into a fresh V1 prompt that includes the original
   question, the parked clarify prompt/options, and the student's clarification
   answer while reusing the parked ``message_id``. Otherwise the text becomes a new serialized user
   ``ModelRequest`` appended to the prior messages (the agent node's tail
   convention, app/agent_node.py).
3. Streams with ``stream_mode=["custom", "updates"]``: custom ``delta``/``viz``
   chunks become ``delta``/``viz`` events live; a legacy ``__interrupt__``
   update becomes ``clarify`` + ``done(awaiting_input)``. A native v2
   ``ask_student`` result (the agent node's structured output, not an
   interrupt) ends the same graph run normally, so the post-commit read
   detects it as the latest turn record's ``awaiting_input`` status and emits
   ``clarify`` -> ``sources`` -> optional ``usage`` -> ``done(awaiting_input)``
   — the model's pre-question citations/usage are honest, unlike the legacy
   interrupt path. Any other completed run ends with ``sources`` (the registry
   verbatim — the LLM never built citation metadata), ``usage``, and
   ``done(complete)``.
4. Persists the turn record (B1b, ship-plan G2): the node writes the complete
   record in its state delta; this runner writes the parked-clarify record
   (after ``done(awaiting_input)``) and the error record (best-effort) via
   ``graph.aupdate_state``.

``meta`` is emitted here with a fresh uuid4 trace id; Phase 5 wraps it with
real tracing. Errors never propagate: the stream ends with a user-safe
``error`` event (details go to the log, never the student).
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any
from uuid import uuid4

import asyncpg
import pydantic_ai.exceptions
from pydantic import TypeAdapter
from pydantic_ai.messages import (
    ModelMessagesTypeAdapter,
    ModelRequest,
    UserPromptPart,
)

from app.clarification import latest_awaiting_v2_clarify_spec
from app.graph import GraphDeps
from app.model_selection import UnsupportedCounselorProvider, counselor_model_selection
from app.records import Emission, FinalEmissionDeduper
from app.sessions import get_session, touch_session
from app.skills import SelectedSkillValidationError, validate_selected_skills
from app.sources import SourceRegistry
from app.turn_persistence import AGENT_NODE, build_terminal_update, parked_record
from config.settings import get_settings
from domain.clarification import ClarifyResponseV2, ContinuationIntent, mark_continuation_running
from domain.events import (
    Event,
    StepData,
    UsageData,
    ev_clarify,
    ev_clarify_response,
    ev_delta,
    ev_done,
    ev_error,
    ev_meta,
    ev_narration,
    ev_sources,
    ev_step,
    ev_thinking,
    ev_usage,
    ev_user_message,
    ev_viz,
)
from domain.response_mode import ResponseMode
from domain.specs import ClarifySpec, SourceConfig, parse_render_spec

if TYPE_CHECKING:
    # Deferred to avoid a real-time cycle: app.clarify_lifecycle imports
    # nothing from this module, but keeping the dependency type-only here
    # documents that run_turn.py stays the wiring layer (plan "File-level
    # change map": schema/validation/lifecycle logic lives in the focused
    # module, not scattered into run_turn.py).
    from app.clarify_lifecycle import PreparedContinuation

logger = logging.getLogger(__name__)

_USER_SAFE_ERROR = "Something went wrong on our side — please try that again."
_USER_CANCELLED_CONTINUATION_MARKER = (
    "[Request interrupted by user - the previous run was stopped; its completed "
    "steps above are real.]"
)
_SERVER_ERROR_CONTINUATION_MARKER = (
    "[Previous run ended early on the server; its completed steps above are real.]"
)

# app/sessions.py's create_session mints its own uuid; the runner must ensure a
# row under the CALLER's session_id (= thread_id), so it carries this one
# idempotent insert itself (parameterized; ADR 0019).
_ENSURE_SESSION_SQL = """
INSERT INTO counselle.sessions (session_id, source_config, response_mode)
VALUES ($1, $2, $3)
ON CONFLICT (session_id) DO NOTHING
"""


async def _ensure_session(
    pool: asyncpg.Pool | None,
    session_id: str,
    requested: SourceConfig | None,
    settings: Any,
    response_mode: ResponseMode,
) -> SourceConfig:
    """Create the session row if missing; return the turn's effective source config.

    Precedence: the request's explicit config > the session row's stored config
    > the settings defaults. With no app pool (unit tests) the row step is
    skipped and precedence collapses to request > defaults.

    ``response_mode`` seeds a freshly-created row with the turn's actual mode
    (plan §4.2) — an explicit direct/eval Think call must not silently take the
    DB column's ``'quick'`` default; that default is the compatibility backstop
    for call sites that predate this parameter, not the source of truth here.
    """
    if pool is None:
        return requested or SourceConfig.defaults_from(settings)
    row = await get_session(pool, session_id)
    if row is None:
        effective = requested or SourceConfig.defaults_from(settings)
        async with pool.acquire() as conn:
            await conn.execute(
                _ENSURE_SESSION_SQL,
                session_id,
                effective.model_dump(mode="json"),
                response_mode.value,
            )
        return effective
    if requested is not None:
        return requested
    stored = row.get("source_config")
    if stored:
        return SourceConfig.model_validate(stored)
    return SourceConfig.defaults_from(settings)


def _serialized_user_message(user_text: str) -> list[dict[str, Any]]:
    """The new user turn as one serialized ModelRequest (the node's tail convention)."""
    request = ModelRequest(parts=[UserPromptPart(content=user_text)])
    return list(ModelMessagesTypeAdapter.dump_python([request], mode="json"))


def _parked_compat_prompt(parked: dict[str, Any], answer: str) -> str:
    question = str(parked.get("user_text") or "the previous question")
    clarify = parked.get("clarify")
    spec = clarify.get("spec") if isinstance(clarify, dict) else None
    clarify_lines: list[str] = []
    if isinstance(spec, dict):
        if spec.get("header"):
            clarify_lines.append(f"Header: {spec['header']}")
        if spec.get("question"):
            clarify_lines.append(f"Question: {spec['question']}")
        options = spec.get("options")
        if isinstance(options, list) and options:
            clarify_lines.append("Options:")
            for option in options:
                if not isinstance(option, dict):
                    continue
                label = str(option.get("label") or "").strip()
                hint = str(option.get("hint") or "").strip()
                if label and hint:
                    clarify_lines.append(f"- {label}: {hint}")
                elif label:
                    clarify_lines.append(f"- {label}")
    clarify_context = (
        "The earlier clarification prompt was:\n"
        + "\n".join(clarify_lines)
        + "\n\n"
        if clarify_lines
        else ""
    )
    return (
        f"{question}\n\n"
        f"{clarify_context}"
        "The student answered the earlier clarification prompt with:\n"
        f"{answer}\n\n"
        "Continue using that answer as the relevant assumption. Do not ask another "
        "clarifying question."
    )


def _parked_resume_clarify(
    parked: dict[str, Any] | None, answer: str | None
) -> tuple[dict[str, Any] | None, bool]:
    if parked is None or answer is None:
        return None, False
    clarify = parked.get("clarify")
    if not isinstance(clarify, dict):
        return None, True
    spec = clarify.get("spec")
    if spec is None:
        return None, True
    return {"spec": spec, "answer": answer}, True


async def _write_failure_record(
    graph: Any,
    config: dict[str, Any],
    *,
    emissions: list[Emission],
    ids: dict[str, Any],
    user_text: str | None,
    trace_id: str,
    messages_offset: int | None,
    fallback_messages: list[dict[str, Any]] | None,
    registry_dump: list[Any],
    parked_resume: dict[str, Any] | None = None,
    partial_history: list[dict[str, Any]] | None = None,
    emissions_len_at_snapshot: int = 0,
    selected_skills: Sequence[str] | None = None,
    continuation_of: str | None = None,
) -> None:
    """Best-effort error persistence (G2): the error turn record plus — when
    prose streamed — a partial ``ModelResponse`` so ``messages`` keeps exactly
    the streamed prose (the prose invariant). The caller guards this call: a
    record-write failure must never mask the turn error.

    # B2: if THIS write fails after the messages append landed but before the
    # record write, the double-failure corner leaves prose without a record —
    # B2's turn registry single-flight lock owns turn-lifecycle recovery.
    """
    prose = "".join(text for kind, text in emissions if kind == "delta")
    if not user_text and not prose and not continuation_of:
        # Ghost-turn guard: with no user text to anchor the turn and no prose
        # streamed, a record would render as an empty userless error bubble on
        # reload — the live error event already reached the student, so skip.
        # Phase 3 (plan Phase 3 bullet on A2's ghost-turn guard): a widget-
        # origin A2 that errors before any prose is an intentionally userless
        # continuation, NOT a ghost turn — ``continuation_of`` is itself a
        # valid durable anchor, so this record must still be written.
        logger.info("skipping anchorless empty error record (trace_id=%s)", trace_id)
        return
    snapshot = await graph.aget_state(config)
    messages = list(snapshot.values.get("messages") or []) if snapshot else []
    records = list(snapshot.values.get("turn_records") or []) if snapshot else []
    restored_fallback = fallback_messages is not None and len(messages) < len(fallback_messages)
    if restored_fallback:
        # The run died before the input checkpoint landed — restore the turn's
        # input so the record's offset points at a real user message.
        messages = list(fallback_messages or [])
    # Resolve the offset against the pre-append messages (the caller's explicit
    # value wins; the None fallback is the pre-refactor max(len-1, 0)) so the
    # anchor is byte-identical regardless of whether the partial later appends.
    offset = messages_offset if messages_offset is not None else max(len(messages) - 1, 0)
    # The single terminal-persistence owner (audit H1): the empty-partial rule,
    # the record build, and the record anchoring all live in build_terminal_update.
    clarify, synthesized_answer = _parked_resume_clarify(
        parked_resume, ids.get("resume_text") if isinstance(ids.get("resume_text"), str) else None
    )
    update = build_terminal_update(
        messages=messages,
        records=records,
        emissions=emissions,
        ids=ids,
        status="error",
        sources=SourceRegistry(registry_dump).wire_dump(),
        user_text=user_text,
        messages_offset=offset,
        error={"message": _USER_SAFE_ERROR, "trace_id": trace_id},
        clarify=clarify,
        synthesized_answer=synthesized_answer,
        partial_history=partial_history,
        emissions_len_at_snapshot=emissions_len_at_snapshot,
        selected_skills=selected_skills,
        continuation_of=continuation_of,
    )
    if continuation_of is not None:
        # A2 reached a terminal state (error) — clear the durable intent in
        # the SAME update that commits the terminal record (plan architecture
        # decision §4: "cleared only in the same terminal update that commits
        # A2"), so a hard restart afterward never sees a stale "running" intent.
        update["continuation_intent"] = None
    if restored_fallback:
        # Equivalence with the pre-refactor code: a fallback restore ALWAYS
        # persists the restored messages, even when the empty-partial rule
        # appended nothing (build_terminal_update only sets "messages" when the
        # partial changed it).
        update.setdefault("messages", messages)
    await graph.aupdate_state(config, update)


@dataclass
class _TurnInput:
    """The assembled graph input for one turn (resume vs new — audit M3)."""

    graph_input: Any
    turn_ids: dict[str, Any]
    messages_offset: int


class _ResumePrewriteError(Exception):
    """The resume pre-run ``aupdate_state`` failed (audit BC-11).

    Distinguishes a resume pre-write failure from any other prepare failure: the
    caller turns this into an ``ev_error`` and returns WITHOUT writing a record,
    leaving the thread parked so the student can retry the answer. Every OTHER
    prepare failure (e.g. ``_ensure_session``) keeps today's error-record path.
    """


def _prompt_with_interruption_marker(
    user_text: str,
    prior_records: list[dict[str, Any]],
    prior_messages: list[dict[str, Any]],
) -> str:
    if not prior_records:
        return user_text
    previous = prior_records[-1]
    if previous.get("partial_history") != "snapshot":
        return user_text
    status = previous.get("status")
    if status not in {"interrupted", "cancelled", "error"}:
        return user_text
    offset = previous.get("messages_offset")
    if not isinstance(offset, int) or len(prior_messages) <= offset + 1:
        return user_text
    marker = (
        _USER_CANCELLED_CONTINUATION_MARKER
        if status in {"interrupted", "cancelled"}
        else _SERVER_ERROR_CONTINUATION_MARKER
    )
    return f"{marker}\n\n{user_text}"


def _selected_skills_from_turn_ids(turn_ids: dict[str, Any]) -> list[str]:
    """Read the checkpoint transport field without erasing corrupt falsy data.

    Direct helper callers and pre-feature checkpoints can omit the key.  Once
    it is present, however, it must be the same validated list that entered
    the turn; values such as ``False`` must not silently become ``[]`` while a
    terminal record is being written.
    """
    raw = turn_ids.get("selected_skills")
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise SelectedSkillValidationError("selected skills in turn ids are malformed")
    return validate_selected_skills(raw)


def _selected_skills_from_parked_record(parked: dict[str, Any]) -> list[str]:
    """Validate the parked turn's durable selection without falsy coercion."""
    raw = parked.get("skills", [])
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise SelectedSkillValidationError("parked selected skills are malformed")
    return validate_selected_skills(raw)


async def _prepare_turn_input(
    graph: Any,
    deps: GraphDeps,
    settings: Any,
    *,
    session_id: str,
    user_text: str,
    source_config: SourceConfig | None,
    snapshot: Any,
    parked: dict[str, Any] | None,
    turn_ids: dict[str, Any],
    response_mode: ResponseMode,
) -> _TurnInput:
    """Build the graph input for this turn: parked-compat continuation vs new.

    Parked detection is the caller's (the record via ``parked_record``); a
    parked continuation reuses the parked ``message_id`` and carries its
    ``messages_offset`` forward, a new turn appends the serialized user
    ``ModelRequest``. The pre-run parked-answer ``aupdate_state`` lives here
    too — its failure raises
    :class:`_ResumePrewriteError` (the BC-11 path: the caller turns it into an
    ``ev_error`` + return, leaving the thread parked).
    """
    effective_config = await _ensure_session(
        deps.app_pool, session_id, source_config, settings, response_mode
    )
    if parked is not None:
        # Agent V1 does not mount ask_student, so do not replay the old
        # interrupt continuation. Feed the student's answer back to the current
        # agent as an explicit compatibility prompt, while preserving the
        # parked record's id/offset so the transcript still replaces the parked
        # assistant entry and renders the answer as synthesized.
        parked_offset = parked.get("messages_offset")
        prior_messages = list(snapshot.values.get("messages") or []) if snapshot else []
        if isinstance(parked_offset, int):
            messages_offset = parked_offset
        else:
            messages_offset = max(len(prior_messages) - 1, 0)
        turn_ids = {
            **turn_ids,
            "messages_offset": messages_offset,
            "resume_text": user_text,
            "selected_skills": _selected_skills_from_turn_ids(turn_ids),
        }
        try:
            await graph.aupdate_state(
                {"configurable": {"thread_id": session_id}},
                {"turn_ids": turn_ids},
                as_node=AGENT_NODE,
            )
        except Exception as exc:
            raise _ResumePrewriteError from exc
        base_messages = prior_messages[:messages_offset]
        compat_prompt = _parked_compat_prompt(parked, user_text)
        graph_input = {
            "messages": base_messages + _serialized_user_message(compat_prompt),
            "source_config": effective_config.model_dump(mode="json"),
            "turn_ids": turn_ids,
        }
        return _TurnInput(graph_input, turn_ids, messages_offset)
    prior = list(snapshot.values.get("messages") or []) if snapshot else []
    prior_records = list(snapshot.values.get("turn_records") or []) if snapshot else []
    messages_offset = len(prior)
    turn_ids = {
        **turn_ids,
        "messages_offset": messages_offset,
        "selected_skills": _selected_skills_from_turn_ids(turn_ids),
    }
    prompt = _prompt_with_interruption_marker(user_text, prior_records, prior)
    graph_input = {
        "messages": prior + _serialized_user_message(prompt),
        "source_config": effective_config.model_dump(mode="json"),
        "source_registry": [],
        "turn_ids": turn_ids,
    }
    return _TurnInput(graph_input, turn_ids, messages_offset)


async def _finish_failed_turn(
    *,
    deps: GraphDeps,
    session_id: str,
    trace_id: str,
    graph: Any,
    config: dict[str, Any],
    emissions: list[Emission],
    turn_ids: dict[str, Any],
    record_user_text: str | None,
    messages_offset: int | None,
    graph_input: Any,
    last_registry_dump: list[Any],
    parked: dict[str, Any] | None,
    selected_skills: Sequence[str],
) -> None:
    """Shared cleanup + best-effort failure-record write for a failed turn.

    Called from both the ``UnexpectedModelBehavior``-specific except and the
    generic catch-all in ``run_turn`` — extracted so the distinct logging
    added for tool-retry-budget exhaustion doesn't duplicate this ~50-line
    tail.
    """
    # Kick the MCP supervisor for prompt recovery (FIX 3) — the probe is
    # cheap and idempotent; call guarded so it can never mask the original error.
    on_failure = getattr(deps, "on_failure", None)
    if on_failure is not None:
        try:
            on_failure()
        except Exception:
            logger.warning(
                "on_failure hook raised (trace_id=%s) — ignoring", trace_id, exc_info=True
            )
    # The error turn record (+ streamed-prose preservation) — best-effort:
    # a record-write failure must never mask the turn error.
    try:
        partial_history = None
        emissions_len_at_snapshot = 0
        handle_store = getattr(deps, "run_handles", None)
        handle = handle_store.get(session_id) if handle_store is not None else None
        if handle is not None and handle.messages_snapshot:
            partial_history = list(handle.messages_snapshot)
            emissions_len_at_snapshot = handle.emissions_len_at_snapshot
        if handle is not None:
            for message in handle.drain_steers():
                handle.queued_at_terminal.append(message)
                emissions.append(
                    (
                        "user",
                        {
                            "text": message.text,
                            "user_message_id": message.user_message_id,
                            "injected": False,
                        },
                    )
                )
        await _write_failure_record(
            graph,
            config,
            emissions=emissions,
            ids=turn_ids,
            user_text=record_user_text,
            trace_id=trace_id,
            messages_offset=messages_offset,
            fallback_messages=graph_input["messages"] if isinstance(graph_input, dict) else None,
            registry_dump=last_registry_dump,
            parked_resume=parked,
            partial_history=partial_history,
            emissions_len_at_snapshot=emissions_len_at_snapshot,
            selected_skills=selected_skills,
        )
    except Exception:
        logger.warning(
            "error turn-record write failed (trace_id=%s) — ignoring",
            trace_id,
            exc_info=True,
        )


async def _finish_failed_continuation(
    *,
    graph: Any,
    config: dict[str, Any],
    emissions: list[Emission],
    turn_ids: dict[str, Any],
    prepared: PreparedContinuation,
    trace_id: str,
    messages_offset: int,
    registry_dump: list[Any],
) -> None:
    """A2's twin of ``_finish_failed_turn``: routes through the SAME single
    terminal-persistence owner (``_write_failure_record`` ->
    ``build_terminal_update``, plan Phase 3 bullet 5), passing
    ``continuation_of`` so the ghost-turn guard keeps this record even for a
    widget-origin A2 with no user text and no streamed prose (plan Phase 3,
    "A2 is an intentionally userless assistant continuation").
    """
    try:
        await _write_failure_record(
            graph,
            config,
            emissions=emissions,
            ids=turn_ids,
            user_text=prepared.record_user_text if prepared.project_user else None,
            trace_id=trace_id,
            messages_offset=messages_offset,
            fallback_messages=None,
            registry_dump=registry_dump,
            selected_skills=list(prepared.inherited_skills),
            continuation_of=prepared.root_message_id,
        )
    except Exception:
        logger.warning(
            "A2 error turn-record write failed (trace_id=%s) — ignoring",
            trace_id,
            exc_info=True,
        )


async def run_continuation_turn(
    session_id: str,
    prepared: PreparedContinuation,
    source_config: SourceConfig | None = None,
    *,
    deps: GraphDeps,
    graph: Any,
    user_id: str | None = None,
    response_mode: ResponseMode = ResponseMode.QUICK,
) -> AsyncIterator[Event]:
    """A2: a fresh run over A1's completed history (plan architecture decision
    §5 / Phase 3).

    Never parked-detected (acceptance already resolved A1's pending state
    before this is called) and never advertises ``ask_student``: the agent
    node reads ``turn_ids["continuation_of"]`` and restricts to
    ``output_type=[str]`` for any turn carrying it, so
    ``ask_student_output_type()`` (Phase 2) is never even considered here — a
    second clarification round stays impossible even if the model ignores the
    prompt (plan architecture decision §5).

    ``prepared.model_input_text`` is the server-rendered contextual payload —
    content transport only, never a new instruction hierarchy, never persisted
    as ``user_text`` for a widget-origin A2 (``prepared.project_user`` is
    False in that case).
    """
    settings = getattr(deps, "settings", None) or get_settings()
    trace_id = str(uuid4())
    try:
        selection = counselor_model_selection(response_mode, settings)
    except UnsupportedCounselorProvider:
        logger.exception(
            "counselor model selection failed for A2 (trace_id=%s, session_id=%s)",
            trace_id,
            session_id,
        )
        yield ev_error(_USER_SAFE_ERROR, trace_id)
        return

    message_id = prepared.continuation_message_id
    user_message_id = prepared.user_message_id or prepared.trigger_request_id
    config = {"configurable": {"thread_id": session_id}}

    turn_ids: dict[str, Any] = {
        "message_id": message_id,
        "user_message_id": user_message_id,
        "session_id": session_id,
        "user_id": user_id,
        "selected_skills": list(prepared.inherited_skills),
        "response_mode": selection.response_mode.value,
        "model": selection.model_setting,
        # Phase 3 identity additions (plan "SSE additions" / "Turn-record
        # identity"): read by the agent node to restrict A2's output type and
        # by the record builder to stamp ``continuation_of``.
        "continuation_of": prepared.root_message_id,
        "project_user": prepared.project_user,
        "response_origin": prepared.origin,
        "trigger_request_id": prepared.trigger_request_id,
        # The exact transcript projection (module docstring / agent_node.py's
        # record-building branch) — None for widget origin, U2's exact text
        # for reply origin. Never the server-rendered model_input_text.
        "record_user_text": prepared.record_user_text if prepared.project_user else None,
    }
    yield ev_meta(
        trace_id,
        session_id,
        turn_ids["model"],
        message_id,
        user_message_id,
        turn_ids["response_mode"],
        continuation_of=prepared.root_message_id,
        response_origin=prepared.origin,
        project_user=prepared.project_user,
        editable_root_message_id=prepared.editable_root_message_id,
    )
    yield ev_clarify_response(
        clarify_message_id=prepared.root_message_id,
        continuation_message_id=prepared.continuation_message_id,
        response=TypeAdapter(ClarifyResponseV2).validate_python(prepared.response_payload),
    )

    emissions: list[Emission] = []
    last_registry_dump: list[Any] = []
    last_usage_dict_inline: dict[str, Any] | None = None
    messages_offset = prepared.messages_offset

    inherited_source_config = (
        SourceConfig.model_validate(prepared.inherited_source_config)
        if prepared.inherited_source_config is not None
        else source_config
    )
    effective_config = await _ensure_session(
        deps.app_pool, session_id, inherited_source_config, settings, response_mode
    )
    graph_input = {
        "messages": prepared.completed_message_history
        + _serialized_user_message(prepared.model_input_text),
        "source_config": effective_config.model_dump(mode="json"),
        "turn_ids": turn_ids,
    }

    # Move the durable intent "accepted" -> "running" before A2's first model
    # request (plan architecture decision §4): a hard restart after this point
    # must never auto-replay A2's tools. Best-effort — a write failure here
    # does not abort the turn (the intent staying "accepted" is a safe,
    # idempotent-retry state, not a correctness hazard on its own).
    try:
        snapshot = await graph.aget_state(config)
        raw_intent = snapshot.values.get("continuation_intent") if snapshot else None
        if isinstance(raw_intent, dict):
            intent = ContinuationIntent.model_validate(raw_intent)
            running_intent = mark_continuation_running(intent)
            await graph.aupdate_state(
                config, {"continuation_intent": running_intent.model_dump(mode="json")}
            )
    except Exception:
        logger.warning(
            "failed to mark continuation intent running (trace_id=%s, session_id=%s)",
            trace_id,
            session_id,
            exc_info=True,
        )

    try:
        async for mode, chunk in graph.astream(
            graph_input, config, stream_mode=["custom", "updates"]
        ):
            if mode == "custom" and isinstance(chunk, dict):
                kind = chunk.get("type")
                if kind == "delta":
                    if (text := chunk.get("text")) is not None:
                        emissions.append(("delta", text))
                        yield ev_delta(text)
                elif kind == "step":
                    if (data := chunk.get("data")) is not None:
                        emissions.append(("step", data))
                        yield ev_step(StepData.model_validate(data))
                elif kind == "thinking":
                    if (text := chunk.get("text")) is not None:
                        emissions.append(("thinking", text))
                        yield ev_thinking(text)
                elif kind == "narration":
                    if (text := chunk.get("text")) is not None:
                        emissions.append(("narration", text))
                        yield ev_narration(text)
                elif kind == "viz" and (spec := chunk.get("spec")) is not None:
                    emissions.append(("viz", spec))
                    yield ev_viz(parse_render_spec(spec))
            elif mode == "updates" and isinstance(chunk, dict):
                for node_update in chunk.values():
                    if isinstance(node_update, dict):
                        sr = node_update.get("source_registry")
                        if sr is not None:
                            last_registry_dump = sr
                        us = node_update.get("usage")
                        if us is not None:
                            last_usage_dict_inline = us

        if deps.app_pool is not None:
            try:
                await touch_session(deps.app_pool, session_id)
            except Exception:
                logger.warning(
                    "touch_session failed for A2 (session_id=%s) — turn continues",
                    session_id,
                    exc_info=True,
                )

        try:
            final = await graph.aget_state(config)
            entries = SourceRegistry(final.values.get("source_registry") or []).entries_for_wire()
            usage_dict: dict[str, Any] | None = final.values.get("usage")
        except Exception:
            logger.error(
                "Failed to build ev_sources post-run for A2 (trace_id=%s, session_id=%s)"
                " — falling back to in-stream registry",
                trace_id,
                session_id,
                exc_info=True,
            )
            entries = SourceRegistry(last_registry_dump).entries_for_wire()
            usage_dict = last_usage_dict_inline
        try:
            # Clear the durable intent now that A2 committed a terminal
            # "complete" record (plan architecture decision §4: cleared only
            # once A2 is committed) — best-effort, matching touch_session above.
            await graph.aupdate_state(config, {"continuation_intent": None})
        except Exception:
            logger.warning(
                "failed to clear continuation intent after A2 success"
                " (trace_id=%s, session_id=%s)",
                trace_id,
                session_id,
                exc_info=True,
            )
        yield ev_sources(entries)
        if usage_dict:
            yield ev_usage(UsageData.model_validate(usage_dict))
        yield ev_done("complete")
    except Exception:
        logger.exception(
            "A2 continuation failed (trace_id=%s, session_id=%s)", trace_id, session_id
        )
        await _finish_failed_continuation(
            graph=graph,
            config=config,
            emissions=emissions,
            turn_ids=turn_ids,
            prepared=prepared,
            trace_id=trace_id,
            messages_offset=messages_offset,
            registry_dump=last_registry_dump,
        )
        yield ev_error(_USER_SAFE_ERROR, trace_id)


async def run_turn(
    session_id: str,
    user_text: str,
    source_config: SourceConfig | None = None,
    *,
    deps: GraphDeps,
    graph: Any,
    user_id: str | None = None,
    selected_skills: Sequence[str] = (),
    selected_skills_inherited: bool = False,
    response_mode: ResponseMode = ResponseMode.QUICK,
) -> AsyncIterator[Event]:
    """Run one counselor turn on ``thread_id = session_id``, yielding wire events."""
    settings = getattr(deps, "settings", None) or get_settings()
    trace_id = str(uuid4())
    # Server-owned Quick/Think resolution (plans/quick-think-response-mode.md
    # §3.2/§5.2): the registry already validated/inherited *response_mode*
    # before spawning this turn; resolving it here (rather than trusting a
    # separately-threaded model string) is the single source that meta,
    # turn_ids, and the agent node's own re-resolution all agree with by
    # construction — never `settings.model_counselor` directly.
    try:
        selection = counselor_model_selection(response_mode, settings)
    except UnsupportedCounselorProvider:
        logger.exception(
            "counselor model selection failed (trace_id=%s, session_id=%s, response_mode=%s)",
            trace_id,
            session_id,
            response_mode.value,
        )
        yield ev_error(_USER_SAFE_ERROR, trace_id)
        return
    # G1 message identity: the turn's two UUIDs, minted at start so the live
    # stream is addressable for feedback/edit (ADR 0022). A clarify resume
    # reuses the parked record's message_id — detected BEFORE ev_meta so the
    # first event already carries the reused id.
    message_id = str(uuid4())
    user_message_id = str(uuid4())
    config = {"configurable": {"thread_id": session_id}}

    snapshot: Any = None
    prefetch_exc: Exception | None = None
    try:
        snapshot = await graph.aget_state(config)
    except Exception as exc:  # surfaced inside the main try → error event
        prefetch_exc = exc
    prior_records: list[dict[str, Any]] = (
        list(snapshot.values.get("turn_records") or []) if snapshot else []
    )
    # Parked-detection (B0 spike 1 / BC-14): the turn record is the SOLE source
    # of truth — the parked-record write empties tasks[*].interrupts, so there
    # is no OR-on-interrupt fallback (a torn write could leave a stale interrupt
    # the now-cancelled record already disclaims).
    parked = parked_record(prior_records)
    if parked is not None:
        message_id = str(parked["message_id"])
    # B2: a parked thread where the next POST is NOT a resume (e.g. a cancel
    # races in) can ghost the parked record — B2's turn registry single-flight
    # lock owns concurrent-turn lifecycle; no guard here.
    # The record-anchoring question: on a resume this turn's question is the
    # PARKED record's user_text (the live user_text is the clarify ANSWER,
    # which rides clarify.answer, never the user bubble).
    record_user_text: str | None = (
        parked.get("user_text") if parked is not None else user_text
    )
    # Registry.start rejects a non-empty clarify-answer request, then marks
    # its server-owned inherited selection explicitly.  Direct callers may
    # never select skills midway through a parked clarify run, even if they
    # happen to repeat the same names.
    effective_selected_skills: list[Any] = list(selected_skills)
    try:
        requested_selected_skills = validate_selected_skills(effective_selected_skills)
        if parked is not None:
            parked_selected_skills = _selected_skills_from_parked_record(parked)
            if requested_selected_skills:
                if not selected_skills_inherited:
                    raise SelectedSkillValidationError("clarify resume selects skills")
                if requested_selected_skills != parked_selected_skills:
                    raise SelectedSkillValidationError("clarify resume replaces selected skills")
            effective_selected_skills = parked_selected_skills
        else:
            effective_selected_skills = requested_selected_skills
    except SelectedSkillValidationError:
        logger.warning(
            "invalid selected skills in direct or restored turn state "
            "(session_id=%s, trace_id=%s)",
            session_id,
            trace_id,
        )
        yield ev_error(_USER_SAFE_ERROR, trace_id)
        return

    turn_ids: dict[str, Any] = {
        "message_id": message_id,
        "user_message_id": user_message_id,
        "session_id": session_id,
        # Unauthenticated callers (eval runner, CLI) pass no user_id, and it
        # stays None here — that's the mount-gate signal a later phase reads
        # off turn_ids (ADR 0013: unmounted, not hidden).
        "user_id": user_id,
        "selected_skills": list(effective_selected_skills),
        # msgpack-plain strings (app/state.py's serde rule) — the agent node
        # re-resolves the model from response_mode rather than trusting this
        # string directly; it rides turn_ids purely for record/audit fidelity.
        "response_mode": selection.response_mode.value,
        "model": selection.model_setting,
    }
    yield ev_meta(
        trace_id,
        session_id,
        turn_ids["model"],
        message_id,
        user_message_id,
        turn_ids["response_mode"],
    )
    emissions: list[Emission] = []
    final_emissions = FinalEmissionDeduper()
    # The last source_registry/usage dumps from the updates stream — the FIX 2
    # fallback AND the parked/error records' sources snapshot.
    last_registry_dump: list[Any] = []
    last_usage_dict_inline: dict[str, Any] | None = None
    last_turn_records_dump: list[Any] = []
    messages_offset: int | None = None
    graph_input: Any = None
    try:
        if prefetch_exc is not None:
            raise prefetch_exc
        try:
            turn_input = await _prepare_turn_input(
                graph,
                deps,
                settings,
                session_id=session_id,
                user_text=user_text,
                source_config=source_config,
                snapshot=snapshot,
                parked=parked,
                turn_ids=turn_ids,
                response_mode=response_mode,
            )
        except _ResumePrewriteError:
            # BC-11: the resume pre-write failed — leave the thread parked (the
            # awaiting_input record stays last), write NO record, end with error
            # so the student can retry the answer.
            logger.exception(
                "resume pre-write failed — leaving the thread parked "
                "(trace_id=%s, session_id=%s)",
                trace_id,
                session_id,
            )
            yield ev_error(_USER_SAFE_ERROR, trace_id)
            return
        graph_input = turn_input.graph_input
        turn_ids = turn_input.turn_ids
        messages_offset = turn_input.messages_offset

        interrupted = False
        clarify_dump: dict[str, Any] | None = None
        async for mode, chunk in graph.astream(
            graph_input, config, stream_mode=["custom", "updates"]
        ):
            if mode == "custom" and isinstance(chunk, dict):
                # The runner's emission feed mirrors the node's: the parked
                # and error records are built from exactly what streamed.
                # .get + skip-if-absent: a malformed chunk must never
                # KeyError mid-stream.
                kind = chunk.get("type")
                if kind == "delta":
                    if (text := chunk.get("text")) is not None:
                        emissions.append(("delta", text))
                        yield ev_delta(text)
                elif kind == "step":
                    if (data := chunk.get("data")) is not None:
                        emissions.append(("step", data))
                        yield ev_step(StepData.model_validate(data))
                elif kind == "thinking":
                    if (text := chunk.get("text")) is not None:
                        emissions.append(("thinking", text))
                        yield ev_thinking(text)
                elif kind == "narration":
                    if (text := chunk.get("text")) is not None:
                        emissions.append(("narration", text))
                        yield ev_narration(text)
                elif kind == "user_message":
                    data = chunk.get("data")
                    if isinstance(data, dict):
                        text = str(data.get("text") or "")
                        user_message_id = str(data.get("user_message_id") or "")
                        injected = bool(data.get("injected"))
                        if text and user_message_id:
                            payload = {
                                "text": text,
                                "user_message_id": user_message_id,
                                "injected": injected,
                            }
                            emissions.append(("user", payload))
                            yield ev_user_message(text, user_message_id, injected=injected)
                elif kind == "viz" and (spec := chunk.get("spec")) is not None:
                    if not final_emissions.keep(kind, spec):
                        continue
                    emissions.append(("viz", spec))
                    yield ev_viz(parse_render_spec(spec))
            elif mode == "updates" and isinstance(chunk, dict):
                if "__interrupt__" in chunk:
                    interrupt = chunk["__interrupt__"][0]
                    spec = ClarifySpec.model_validate(interrupt.value)
                    clarify_dump = spec.model_dump(mode="json")
                    yield ev_clarify(spec)
                    interrupted = True
                # Capture registry and usage from the node's state update so we
                # have a fallback if the post-run aget_state call fails (FIX 2).
                for node_update in chunk.values():
                    if isinstance(node_update, dict):
                        sr = node_update.get("source_registry")
                        if sr is not None:
                            last_registry_dump = sr
                        us = node_update.get("usage")
                        if us is not None:
                            last_usage_dict_inline = us
                        tr = node_update.get("turn_records")
                        if tr is not None:
                            last_turn_records_dump = tr

        # Fix 3: touch_session must not fail a successful turn — wrap it.
        if deps.app_pool is not None:
            try:
                await touch_session(deps.app_pool, session_id)
            except Exception:
                logger.warning(
                    "touch_session failed (session_id=%s) — turn continues",
                    session_id,
                    exc_info=True,
                )

        if interrupted:
            parked_registry = deps.parked_sources.restore(session_id, message_id, user_id)
            if parked_registry is not None:
                last_registry_dump = parked_registry.dump_state()
            yield ev_done("awaiting_input")
            # The parked turn record (G2/G4) — written after done per spike 1:
            # the write sticks, interrupts clear (detection moves onto the
            # record). Routed through the single terminal-persistence owner
            # (audit H1) — but the parked write only
            # ever touches turn_records, never messages (messages=[] makes the
            # empty-partial rule a no-op).
            try:
                update = build_terminal_update(
                    messages=[],
                    records=prior_records,
                    emissions=emissions,
                    ids=turn_ids,
                    status="awaiting_input",
                    sources=SourceRegistry(last_registry_dump).wire_dump(),
                    user_text=record_user_text,
                    messages_offset=messages_offset,
                    clarify={"spec": clarify_dump, "answer": None} if clarify_dump else None,
                    selected_skills=_selected_skills_from_turn_ids(turn_ids),
                )
                await graph.aupdate_state(config, {"turn_records": update["turn_records"]})
            except Exception:
                logger.error(
                    "parked turn-record write failed (trace_id=%s, session_id=%s)",
                    trace_id,
                    session_id,
                    exc_info=True,
                )
            return

        # Build the sources event from graph state; on failure fall back to the
        # registry dump captured from the updates stream (FIX 2) so inline
        # citation markers already seen by the student still resolve.
        try:
            final = await graph.aget_state(config)
            entries = SourceRegistry(
                final.values.get("source_registry") or []
            ).entries_for_wire()
            usage_dict: dict[str, Any] | None = final.values.get("usage")
            pending_v2_spec = latest_awaiting_v2_clarify_spec(final.values.get("turn_records"))
        except Exception:
            logger.error(
                "Failed to build ev_sources post-run (trace_id=%s, session_id=%s)"
                " — falling back to in-stream registry",
                trace_id,
                session_id,
                exc_info=True,
            )
            entries = SourceRegistry(last_registry_dump).entries_for_wire()
            usage_dict = last_usage_dict_inline
            pending_v2_spec = latest_awaiting_v2_clarify_spec(last_turn_records_dump)
        if pending_v2_spec is not None:
            # Native v2 ask_student pending (plan Phase 2, distinct from the
            # legacy `__interrupt__` branch above): pre-question citations and
            # usage must still surface honestly before the widget parks, so
            # the exact post-commit order is clarify -> sources -> optional
            # usage -> done(awaiting_input).
            yield ev_clarify(pending_v2_spec)
        yield ev_sources(entries)
        if usage_dict:
            yield ev_usage(UsageData.model_validate(usage_dict))
        yield ev_done("awaiting_input" if pending_v2_spec is not None else "complete")
    except pydantic_ai.exceptions.UnexpectedModelBehavior as exc:
        # Distinct from the generic catch below so a tool that exhausts its
        # retry budget (see app/agent_node.py Agent(retries=2)) is easy to spot
        # in logs instead of blending into an opaque traceback. User-visible
        # behavior is unchanged — same cleanup, same _USER_SAFE_ERROR.
        logger.error(
            "agent tool exceeded retry budget (trace_id=%s, session_id=%s): %s",
            trace_id,
            session_id,
            exc,
            exc_info=True,
        )
        await _finish_failed_turn(
            deps=deps,
            session_id=session_id,
            trace_id=trace_id,
            graph=graph,
            config=config,
            emissions=emissions,
            turn_ids=turn_ids,
            record_user_text=record_user_text,
            messages_offset=messages_offset,
            graph_input=graph_input,
            last_registry_dump=last_registry_dump,
            parked=parked,
            selected_skills=_selected_skills_from_turn_ids(turn_ids),
        )
        yield ev_error(_USER_SAFE_ERROR, trace_id)
    except pydantic_ai.exceptions.ModelHTTPError as exc:
        # Caught separately from the generic catch-all below (plan §5.4): in
        # the pinned pydantic-ai version this is NOT an UnexpectedModelBehavior
        # subclass. Only the explicit provider-capacity/not-found statuses get
        # `code="model_unavailable"` and mode-aware copy — 400/401/403 and
        # anything else fall through to the generic user-safe message so a
        # content-filter or auth error is never told "try Quick instead".
        logger.error(
            "model http error (trace_id=%s, session_id=%s, status=%s, model=%s,"
            " response_mode=%s)",
            trace_id,
            session_id,
            exc.status_code,
            turn_ids.get("model"),
            turn_ids.get("response_mode"),
        )
        await _finish_failed_turn(
            deps=deps,
            session_id=session_id,
            trace_id=trace_id,
            graph=graph,
            config=config,
            emissions=emissions,
            turn_ids=turn_ids,
            record_user_text=record_user_text,
            messages_offset=messages_offset,
            graph_input=graph_input,
            last_registry_dump=last_registry_dump,
            parked=parked,
            selected_skills=_selected_skills_from_turn_ids(turn_ids),
        )
        if exc.status_code in (404, 429, 503):
            safe_message = (
                "Think is temporarily unavailable. Try again, or switch to Quick."
                if turn_ids.get("response_mode") == ResponseMode.THINK.value
                else _USER_SAFE_ERROR
            )
            yield ev_error(safe_message, trace_id, code="model_unavailable")
        else:
            yield ev_error(_USER_SAFE_ERROR, trace_id)
    except Exception:
        logger.exception("turn failed (trace_id=%s, session_id=%s)", trace_id, session_id)
        await _finish_failed_turn(
            deps=deps,
            session_id=session_id,
            trace_id=trace_id,
            graph=graph,
            config=config,
            emissions=emissions,
            turn_ids=turn_ids,
            record_user_text=record_user_text,
            messages_offset=messages_offset,
            graph_input=graph_input,
            last_registry_dump=last_registry_dump,
            parked=parked,
            selected_skills=_selected_skills_from_turn_ids(turn_ids),
        )
        yield ev_error(_USER_SAFE_ERROR, trace_id)
