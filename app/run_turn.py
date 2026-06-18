"""The turn runner: graph/agent events → domain ``Event`` stream (Slice F).

``run_turn`` is THE function the API wraps in Phase 5 — every frontend consumes
exactly this stream (ADR 0016). Per turn it:

1. Ensures the ``counselle.sessions`` row exists (created with the request's
   source config or the settings defaults), and touches it on completion.
2. Detects a parked clarify on the thread — the last turn record's
   ``status == "awaiting_input"`` is the SOLE signal (B1b; the parked-record
   write empties ``tasks[*].interrupts``, so there is no OR-on-interrupt
   fallback — audit BC-14) — if parked, the user's text is the **answer** and
   the graph resumes via ``Command(resume=text)`` (the parked ``message_id`` is
   reused in ``meta``); otherwise the text becomes a new serialized user
   ``ModelRequest`` appended to the prior messages (the agent node's tail
   convention, app/agent_node.py).
3. Streams with ``stream_mode=["custom", "updates"]``: custom ``delta``/``viz``
   chunks become ``delta``/``viz`` events live; an ``__interrupt__`` update
   becomes ``clarify`` + ``done(awaiting_input)``; a completed run ends with
   ``sources`` (the registry verbatim — the LLM never built citation metadata),
   ``usage``, and ``done(complete)``.
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
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

import asyncpg
from langgraph.types import Command
from pydantic_ai.messages import (
    ModelMessagesTypeAdapter,
    ModelRequest,
    UserPromptPart,
)

from app.graph import GraphDeps
from app.records import Emission, FinalEmissionDeduper
from app.sessions import get_session, touch_session
from app.turn_persistence import build_terminal_update, parked_record
from config.settings import get_settings
from domain.events import (
    Event,
    SourceEntry,
    StepData,
    UsageData,
    ev_clarify,
    ev_delta,
    ev_done,
    ev_error,
    ev_meta,
    ev_sources,
    ev_step,
    ev_thinking,
    ev_usage,
    ev_viz,
)
from domain.specs import ClarifySpec, RenderSpec, SourceConfig

logger = logging.getLogger(__name__)

_USER_SAFE_ERROR = "Something went wrong on our side — please try that again."

# app/sessions.py's create_session mints its own uuid; the runner must ensure a
# row under the CALLER's session_id (= thread_id), so it carries this one
# idempotent insert itself (parameterized; ADR 0019).
_ENSURE_SESSION_SQL = """
INSERT INTO counselle.sessions (session_id, source_config)
VALUES ($1, $2)
ON CONFLICT (session_id) DO NOTHING
"""


async def _ensure_session(
    pool: asyncpg.Pool | None,
    session_id: str,
    requested: SourceConfig | None,
    settings: Any,
) -> SourceConfig:
    """Create the session row if missing; return the turn's effective source config.

    Precedence: the request's explicit config > the session row's stored config
    > the settings defaults. With no app pool (unit tests) the row step is
    skipped and precedence collapses to request > defaults.
    """
    if pool is None:
        return requested or SourceConfig.defaults_from(settings)
    row = await get_session(pool, session_id)
    if row is None:
        effective = requested or SourceConfig.defaults_from(settings)
        async with pool.acquire() as conn:
            await conn.execute(_ENSURE_SESSION_SQL, session_id, effective.model_dump(mode="json"))
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
    if not user_text and not prose:
        # Ghost-turn guard: with no user text to anchor the turn and no prose
        # streamed, a record would render as an empty userless error bubble on
        # reload — the live error event already reached the student, so skip.
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
    update = build_terminal_update(
        messages=messages,
        records=records,
        emissions=emissions,
        ids=ids,
        status="error",
        sources=registry_dump,
        user_text=user_text,
        messages_offset=offset,
        error={"message": _USER_SAFE_ERROR, "trace_id": trace_id},
    )
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
) -> _TurnInput:
    """Build the graph input for this turn: resume (parked) vs new.

    Parked detection is the caller's (the record via ``parked_record``); a
    resume reuses the parked ``message_id`` and carries its ``messages_offset``
    forward, a new turn appends the serialized user ``ModelRequest``. The
    pre-run resume ``aupdate_state`` lives here too — its failure raises
    :class:`_ResumePrewriteError` (the BC-11 path: the caller turns it into an
    ``ev_error`` + return, leaving the thread parked).
    """
    effective_config = await _ensure_session(deps.app_pool, session_id, source_config, settings)
    if parked is not None:
        # The student's text answers the pending clarify (notes §7). The answer
        # rides Command(resume) and never enters messages, so it also rides
        # turn_ids into the node's record (story 25). The aupdate_state-before-
        # resume mechanic is spike-1c-proven. The replacement record must keep
        # the ORIGINAL question's index: carry the parked record's
        # messages_offset forward (G3 anchor).
        parked_offset = parked.get("messages_offset")
        if isinstance(parked_offset, int):
            messages_offset = parked_offset
        else:
            prior_messages = list(snapshot.values.get("messages") or []) if snapshot else []
            messages_offset = max(len(prior_messages) - 1, 0)
        turn_ids = {**turn_ids, "messages_offset": messages_offset}
        try:
            await graph.aupdate_state(
                {"configurable": {"thread_id": session_id}},
                {"turn_ids": {**turn_ids, "resume_text": user_text}},
            )
        except Exception as exc:
            raise _ResumePrewriteError from exc
        return _TurnInput(Command(resume=user_text), turn_ids, messages_offset)
    prior = list(snapshot.values.get("messages") or []) if snapshot else []
    messages_offset = len(prior)
    turn_ids = {**turn_ids, "messages_offset": messages_offset}
    graph_input = {
        "messages": prior + _serialized_user_message(user_text),
        "source_config": effective_config.model_dump(mode="json"),
        "turn_ids": turn_ids,
    }
    return _TurnInput(graph_input, turn_ids, messages_offset)


async def run_turn(
    session_id: str,
    user_text: str,
    source_config: SourceConfig | None = None,
    *,
    deps: GraphDeps,
    graph: Any,
) -> AsyncIterator[Event]:
    """Run one counselor turn on ``thread_id = session_id``, yielding wire events."""
    settings = getattr(deps, "settings", None) or get_settings()
    trace_id = str(uuid4())
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
    yield ev_meta(trace_id, session_id, settings.model_counselor, message_id, user_message_id)

    turn_ids: dict[str, Any] = {"message_id": message_id, "user_message_id": user_message_id}
    emissions: list[Emission] = []
    final_emissions = FinalEmissionDeduper()
    # The last source_registry/usage dumps from the updates stream — the FIX 2
    # fallback AND the parked/error records' sources snapshot.
    last_registry_dump: list[Any] = []
    last_usage_dict_inline: dict[str, Any] | None = None
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
                elif kind == "viz" and (spec := chunk.get("spec")) is not None:
                    if not final_emissions.keep(kind, spec):
                        continue
                    emissions.append(("viz", spec))
                    yield ev_viz(RenderSpec.model_validate(spec))
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
            yield ev_done("awaiting_input")
            # The parked turn record (G2/G4) — written after done per spike 1:
            # the write sticks, interrupts clear (detection moves onto the
            # record), Command(resume) still works. Routed through the single
            # terminal-persistence owner (audit H1) — but the parked write only
            # ever touches turn_records, never messages (messages=[] makes the
            # empty-partial rule a no-op).
            try:
                update = build_terminal_update(
                    messages=[],
                    records=prior_records,
                    emissions=emissions,
                    ids=turn_ids,
                    status="awaiting_input",
                    sources=last_registry_dump,
                    user_text=record_user_text,
                    messages_offset=messages_offset,
                    clarify={"spec": clarify_dump, "answer": None} if clarify_dump else None,
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
            entries = [
                SourceEntry.model_validate(entry)
                for entry in (final.values.get("source_registry") or [])
            ]
            usage_dict: dict[str, Any] | None = final.values.get("usage")
        except Exception:
            logger.error(
                "Failed to build ev_sources post-run (trace_id=%s, session_id=%s)"
                " — falling back to in-stream registry",
                trace_id,
                session_id,
                exc_info=True,
            )
            entries = [SourceEntry.model_validate(entry) for entry in last_registry_dump]
            usage_dict = last_usage_dict_inline
        yield ev_sources(entries)
        if usage_dict:
            yield ev_usage(UsageData.model_validate(usage_dict))
        yield ev_done("complete")
    except Exception:
        logger.exception("turn failed (trace_id=%s, session_id=%s)", trace_id, session_id)
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
            await _write_failure_record(
                graph,
                config,
                emissions=emissions,
                ids=turn_ids,
                user_text=record_user_text,
                trace_id=trace_id,
                messages_offset=messages_offset,
                fallback_messages=graph_input["messages"]
                if isinstance(graph_input, dict)
                else None,
                registry_dump=last_registry_dump,
            )
        except Exception:
            logger.warning(
                "error turn-record write failed (trace_id=%s) — ignoring",
                trace_id,
                exc_info=True,
            )
        yield ev_error(_USER_SAFE_ERROR, trace_id)
