"""Session routes: POST /v1/sessions, POST /v1/sessions/{id}/messages (SSE),
GET /v1/sessions/{id}.

Phase 5 Slice B implementation (phase-5-api.md Slice B route table).

Single-flight claim set
-----------------------
``app.state.active_sessions`` is a ``set[str]`` of session_ids whose turns are
currently in flight.  The 409 guard uses a synchronous check-and-set against
this set — there is no ``await`` between the membership check and the add, so
under asyncio's cooperative scheduling the operation is atomic (no context
switch can occur without an explicit ``await``).  The streaming generator's
``finally`` block always discards the id, so the set never grows beyond the
count of concurrently active turns.

Multi-replica note: this is an in-process guard only.  A multi-replica
deployment needs a Postgres advisory lock per ARCHITECTURE §23.

``in_reply_to`` field
---------------------
The field is accepted and validated (forward-compat: clarify event id from the
client) but intentionally ignored beyond that.  ``run_turn`` detects a parked
interrupt autonomously via ``graph.aget_state(...).tasks[*].interrupts``; the
resume path is triggered by that detection, not by this field.
"""

from __future__ import annotations

import logging
import time
from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sse_starlette import EventSourceResponse

from api.sse import SSE_HEADERS, encode_sse
from api.usage import enrich_usage_event, log_turn_complete
from app.run_turn import _USER_SAFE_ERROR, run_turn
from app.sessions import create_session, get_session
from domain.events import ev_error
from domain.specs import SourceConfig

router = APIRouter(tags=["sessions"])
logger = structlog.get_logger(__name__)
_log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class CreateSessionBody(BaseModel):
    source_config: SourceConfig | None = None


class CreateSessionResponse(BaseModel):
    session_id: str
    source_config: dict[str, Any]


class MessageBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    source_config: SourceConfig | None = None
    # Accepted for forward-compat (clarify event id); ignored beyond validation.
    # run_turn detects parked interrupts autonomously — see module docstring.
    in_reply_to: str | None = None


class TranscriptEntry(BaseModel):
    role: str  # "user" | "assistant"
    text: str
    ts: str | None


class SessionResponse(BaseModel):
    session_id: str
    title: str | None
    created_at: str | None
    source_config: dict[str, Any] | None
    transcript: list[dict[str, Any]]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_active_sessions(app: Any) -> set[str]:
    """Return (and lazily create) the in-flight session claim set on app.state."""
    if not hasattr(app.state, "active_sessions"):
        app.state.active_sessions = set()
    return app.state.active_sessions  # type: ignore[no-any-return]


def _extract_transcript(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map serialized ModelMessages to transcript entries.

    Mapping rules:
    - ``kind == "request"`` → role ``"user"``, text from the first
      ``user-prompt`` part's ``content``.  Parts of other kinds (tool-return,
      system) are skipped; if no user-prompt part exists the message is skipped.
    - ``kind == "response"`` → role ``"assistant"``, text from the concatenated
      ``text`` parts (``part_kind == "text"``).  Tool-call parts are skipped.
      If a response has no text parts it is skipped entirely (tool-only round).
    - ``ts`` is taken from the message-level ``timestamp`` field when present.
    """
    entries: list[dict[str, Any]] = []
    for msg in messages:
        kind = msg.get("kind")
        ts = msg.get("timestamp") or None
        if kind == "request":
            for part in msg.get("parts", []):
                if part.get("part_kind") == "user-prompt":
                    content = part.get("content", "")
                    if content:
                        entries.append({"role": "user", "text": content, "ts": ts})
                    break  # only the first user-prompt part
        elif kind == "response":
            text_parts = [
                p.get("content", "") for p in msg.get("parts", []) if p.get("part_kind") == "text"
            ]
            combined = "".join(text_parts)
            if combined:
                entries.append({"role": "assistant", "text": combined, "ts": ts})
    return entries


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/sessions", status_code=201)
async def create_session_route(
    request: Request,
    body: CreateSessionBody | None = None,
) -> JSONResponse:
    """Create a new counselle.sessions row and return {session_id, source_config}.

    The body is optional; if ``source_config`` is omitted the settings defaults
    are used (via :meth:`SourceConfig.defaults_from`).
    """
    settings = request.app.state.settings
    runtime = request.app.state.runtime

    effective = (body.source_config if body else None) or SourceConfig.defaults_from(settings)
    session_id = await create_session(runtime.app_pool, effective.model_dump(mode="json"))
    return JSONResponse(
        status_code=201,
        content={
            "session_id": session_id,
            "source_config": effective.model_dump(mode="json"),
        },
    )


@router.post("/sessions/{session_id}/messages")
async def post_message(
    session_id: UUID,
    body: MessageBody,
    request: Request,
) -> EventSourceResponse:
    """Stream one counselor turn as SSE.

    FastAPI validates ``session_id`` as a UUID before this handler runs —
    a malformed id (e.g. ``"not-a-uuid"``) is rejected with 422, never 500.

    Returns 404 when the session row is unknown; 409 when a turn is already
    in flight for this session (single-flight atomic claim-set, in-process).

    The claim set uses a synchronous check-and-add with no ``await`` between
    them — under asyncio's cooperative scheduling this is atomic.  The
    generator's ``finally`` block always discards the claim so the set never
    grows beyond the count of concurrently active turns.  Multi-replica
    deployments need a Postgres advisory lock (ARCHITECTURE §23).
    """
    sid = str(session_id)
    settings = request.app.state.settings
    runtime = request.app.state.runtime
    trace_id = getattr(request.state, "trace_id", None)

    # 404 guard: check BEFORE streaming (avoids sending SSE headers for a 404)
    row = await get_session(runtime.app_pool, sid)
    if row is None:
        return JSONResponse(  # type: ignore[return-value]
            status_code=404,
            content={"error": {"message": "Session not found.", "trace_id": trace_id}},
        )

    # 409 single-flight guard — atomic sync check-and-claim (no await between)
    active = _get_active_sessions(request.app)
    if sid in active:
        return JSONResponse(  # type: ignore[return-value]
            status_code=409,
            content={
                "error": {
                    "message": "A turn is already streaming for this session.",
                    "trace_id": trace_id,
                }
            },
        )
    active.add(sid)  # claim — released in generator's finally

    async def _stream() -> Any:
        seq = 0
        start_mono = time.monotonic()
        last_usage_event = None
        try:
            try:
                async for event in run_turn(
                    sid,
                    body.text,
                    body.source_config,
                    deps=runtime.deps,
                    graph=runtime.graph,
                ):
                    # Enrich usage events with cost estimate
                    if event.type == "usage":
                        event = enrich_usage_event(event, settings.model_counselor, settings)
                        last_usage_event = event

                    yield encode_sse(event, seq)
                    seq += 1
            except Exception:
                # An exception escaped run_turn (e.g. in enrich_usage_event or
                # encode_sse) AFTER Starlette committed the 200 response — the
                # client would otherwise see a silently dropped connection.
                # Yield a terminal error event so the client always gets a clean
                # protocol end, then let the finally block run normally.
                logger.exception(
                    "stream error after response committed",
                    session_id=sid,
                    trace_id=trace_id,
                )
                error_event = ev_error(_USER_SAFE_ERROR, trace_id or "")
                try:
                    yield encode_sse(error_event, seq)
                except Exception:
                    # encode_sse itself failed — fall back to a hand-built SSE frame
                    import json

                    raw = json.dumps(error_event.model_dump(), separators=(",", ":"))
                    yield f"id: {seq}\r\nevent: error\r\ndata: {raw}\r\n\r\n"
        finally:
            active.discard(sid)
            # Emit turn_complete log after stream ends (including on cancel)
            duration_ms = int((time.monotonic() - start_mono) * 1000)
            usage_data = {}
            est_cost = None
            if last_usage_event is not None:
                usage_data = last_usage_event.data
                est_cost = usage_data.get("est_cost_usd")
            log_turn_complete(
                _log,
                session_id=sid,
                trace_id=trace_id or "",
                usage=usage_data,
                duration_ms=duration_ms,
                est_cost_usd=est_cost,
            )

    return EventSourceResponse(
        _stream(),
        ping=settings.sse_keepalive_s,
        headers=SSE_HEADERS,
    )


@router.get("/sessions/{session_id}")
async def get_session_route(
    session_id: UUID,
    request: Request,
) -> JSONResponse:
    """Fetch session metadata and the conversation transcript.

    FastAPI validates ``session_id`` as a UUID before this handler runs —
    a malformed id is rejected with 422, never 500.

    Transcript is reconstructed from the LangGraph checkpointer's message
    history (``graph.aget_state`` → ``state.values["messages"]``).  See
    :func:`_extract_transcript` for the mapping rules.  Returns 404 for an
    unknown session.
    """
    sid = str(session_id)
    runtime = request.app.state.runtime
    trace_id = getattr(request.state, "trace_id", None)

    row = await get_session(runtime.app_pool, sid)
    if row is None:
        return JSONResponse(
            status_code=404,
            content={"error": {"message": "Session not found.", "trace_id": trace_id}},
        )

    # Pull message history from the checkpointer
    config = {"configurable": {"thread_id": sid}}
    try:
        snapshot = await runtime.graph.aget_state(config)
        messages: list[dict[str, Any]] = list(snapshot.values.get("messages") or [])
    except Exception:
        logger.exception("failed to load checkpointer state", session_id=sid)
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "message": "Failed to load session transcript — please try again.",
                    "trace_id": trace_id,
                }
            },
        )

    transcript = _extract_transcript(messages)

    created_at = row.get("created_at")
    if created_at is not None and hasattr(created_at, "isoformat"):
        created_at = created_at.isoformat()

    return JSONResponse(
        content={
            "session_id": row["session_id"],
            "title": row.get("title"),
            "created_at": created_at,
            "source_config": row.get("source_config"),
            "transcript": transcript,
        }
    )
