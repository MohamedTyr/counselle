"""The turn runner: graph/agent events → domain ``Event`` stream (Slice F).

``run_turn`` is THE function the API wraps in Phase 5 — every frontend consumes
exactly this stream (ADR 0016). Per turn it:

1. Ensures the ``counselle.sessions`` row exists (created with the request's
   source config or the settings defaults), and touches it on completion.
2. Detects a pending ``ask_student`` interrupt on the thread (notes-p4-apis §7:
   ``graph.aget_state(...).tasks[*].interrupts``) — if parked, the user's text
   is the **answer** and the graph resumes via ``Command(resume=text)``;
   otherwise the text becomes a new serialized user ``ModelRequest`` appended
   to the prior messages (the agent node's tail convention, app/agent_node.py).
3. Streams with ``stream_mode=["custom", "updates"]``: custom ``delta``/``viz``
   chunks become ``delta``/``viz`` events live; an ``__interrupt__`` update
   becomes ``clarify`` + ``done(awaiting_input)``; a completed run ends with
   ``sources`` (the registry verbatim — the LLM never built citation metadata),
   ``usage``, and ``done(complete)``.

``meta`` is emitted here with a fresh uuid4 trace id; Phase 5 wraps it with
real tracing. Errors never propagate: the stream ends with a user-safe
``error`` event (details go to the log, never the student).
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from typing import Any
from uuid import uuid4

import asyncpg
from langgraph.types import Command
from pydantic_ai.messages import ModelMessagesTypeAdapter, ModelRequest, UserPromptPart

from app.graph import GraphDeps
from app.sessions import get_session, touch_session
from config.settings import get_settings
from domain.events import (
    Event,
    SourceEntry,
    UsageData,
    ev_clarify,
    ev_delta,
    ev_done,
    ev_error,
    ev_meta,
    ev_sources,
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
    yield ev_meta(trace_id, session_id, settings.model_counselor)

    config = {"configurable": {"thread_id": session_id}}
    try:
        effective_config = await _ensure_session(deps.app_pool, session_id, source_config, settings)

        snapshot = await graph.aget_state(config)
        parked = bool(snapshot and any(task.interrupts for task in snapshot.tasks))
        graph_input: Any
        if parked:
            # The student's text answers the pending clarify (notes §7).
            graph_input = Command(resume=user_text)
        else:
            prior = list(snapshot.values.get("messages") or []) if snapshot else []
            graph_input = {
                "messages": prior + _serialized_user_message(user_text),
                "source_config": effective_config.model_dump(mode="json"),
            }

        interrupted = False
        # Capture the last source_registry dump emitted by the agent node as a
        # fallback for FIX 2 — used when the post-run aget_state fails.
        last_registry_dump: list[Any] = []
        last_usage_dict_inline: dict[str, Any] | None = None
        async for mode, chunk in graph.astream(
            graph_input, config, stream_mode=["custom", "updates"]
        ):
            if mode == "custom" and isinstance(chunk, dict):
                if chunk.get("type") == "delta":
                    yield ev_delta(chunk["text"])
                elif chunk.get("type") == "viz":
                    yield ev_viz(RenderSpec.model_validate(chunk["spec"]))
            elif mode == "updates" and isinstance(chunk, dict):
                if "__interrupt__" in chunk:
                    interrupt = chunk["__interrupt__"][0]
                    yield ev_clarify(ClarifySpec.model_validate(interrupt.value))
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
        yield ev_error(_USER_SAFE_ERROR, trace_id)
