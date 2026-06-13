"""Session routes: POST /v1/sessions, POST /v1/sessions/{id}/messages (SSE),
GET /v1/sessions/{id}/stream (reattach), POST /v1/sessions/{id}/cancel,
GET /v1/sessions/{id}.

B2: the routes are dumb callers into :class:`app.turns.TurnRegistry`
(``app.state.turn_registry``, created in the lifespan). The registry owns the
single-flight lock (409), seq stamping, usage enrichment, the after-commit
error fallback, the ``turn_complete`` log, cancel/unpark (G5), and the G3
history rewrite. The MVP1 ``app.state.active_sessions`` claim set is gone.

Multi-replica note: the registry is an in-process guard only. A multi-replica
deployment needs a Postgres advisory lock per ARCHITECTURE §23.

``in_reply_to`` field
---------------------
The field is accepted and validated (forward-compat: clarify event id from the
client) but intentionally ignored beyond that.  ``run_turn`` detects a parked
clarify autonomously via the last turn record; the resume path is triggered by
that detection, not by this field.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import structlog
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sse_starlette import EventSourceResponse

from api.sse import SSE_HEADERS, encode_sse
from app.records import prose_of
from app.sessions import create_session, get_session
from app.turns import (
    InvalidEditTarget,
    NoActiveTurn,
    StreamActive,
    TooManyConsumers,
    TooManyTurns,
    TurnRegistry,
)
from domain.specs import SourceConfig

router = APIRouter(tags=["sessions"])
logger = structlog.get_logger(__name__)


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
    # G3 (B2): a prior user_message_id — edit & regenerate via history rewrite.
    replace_message_id: str | None = Field(default=None, max_length=64)
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


def _registry(request: Request) -> TurnRegistry:
    """The process-wide turn registry, created in the lifespan."""
    return request.app.state.turn_registry  # type: ignore[no-any-return]


#: Upper bound on a sane Last-Event-ID — well past any real buffer seq; a value
#: at/above this is treated as garbage (full replay) rather than trusted.
_MAX_EVENT_ID = 10_000_000


def _parse_last_event_id(raw: str | None) -> int | None:
    """Parse + clamp the ``Last-Event-ID`` header → a valid seq, or ``None``.

    A malformed, negative, or absurdly large value degrades to ``None`` (full
    replay) — never a 500. Only ``0 <= n < _MAX_EVENT_ID`` is honoured.
    """
    if raw is None:
        return None
    try:
        value = int(raw)
    except ValueError:
        return None
    if 0 <= value < _MAX_EVENT_ID:
        return value
    return None


def _error_json(status_code: int, message: str, trace_id: str | None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"message": message, "trace_id": trace_id}},
    )


async def _session_404(request: Request, sid: str) -> JSONResponse | None:
    """The unknown-session guard shared by every /sessions/{id} route."""
    runtime = request.app.state.runtime
    trace_id = getattr(request.state, "trace_id", None)
    row = await get_session(runtime.app_pool, sid)
    if row is None:
        return _error_json(404, "Session not found.", trace_id)
    return None


def _sse_response(
    stream: Any, request: Request
) -> EventSourceResponse:
    """Wrap a registry attach handle (an async iterator of ``(event, seq)``)
    in an EventSourceResponse — the seq is the buffer's, never the route's."""
    settings = request.app.state.settings

    async def _encoded() -> Any:
        async for event, seq in stream:
            yield encode_sse(event, seq)

    return EventSourceResponse(
        _encoded(),
        ping=settings.sse_keepalive_s,
        headers=SSE_HEADERS,
    )


def _prose_only_entries(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The pre-MVP2 fallback: serialized ModelMessages → prose-only entries.

    The pinned fallback shape (wire-contract §2): ``{role, text, ts}`` — no
    ``message_id``, no ``parts``, no ``step_record``, no ``status`` (absent,
    not null). Mapping rules:

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


def _user_entries_for_record(record: dict[str, Any]) -> list[dict[str, Any]]:
    """The user entries a turn record stands for (wire-contract §2.1).

    Self-contained: the question comes from ``record["user_text"]``, never
    from a ``messages`` slice. On a resumed clarify (``synthesized_answer``)
    the record's fresh ``user_message_id`` belongs to the synthesized answer
    bubble (G4) — the original question still renders, but id-less (its
    parked-era record was replaced). A record with neither yields nothing.
    """
    question = record.get("user_text")
    entries: list[dict[str, Any]] = []
    if record.get("synthesized_answer"):
        if question:
            entries.append({"role": "user", "text": question, "ts": None})
        answer = (record.get("clarify") or {}).get("answer")
        entries.append(
            {
                "role": "user",
                "text": answer or "",
                "ts": record.get("ts"),
                "message_id": record.get("user_message_id"),
                "synthesized": True,
            }
        )
    elif question:
        entries.append(
            {
                "role": "user",
                "text": question,
                "ts": record.get("ts"),
                "message_id": record.get("user_message_id"),
            }
        )
    return entries


def _assistant_entry_for_record(record: dict[str, Any]) -> dict[str, Any]:
    """One turn record → the assistant transcript entry (wire-contract §2.2).

    ``parts`` is served straight from the record (materialized at write time
    — the read never reconstructs prose from ``messages``); ``text`` derives
    from the same parts via :func:`prose_of`.
    """
    parts = list(record.get("parts") or [])
    entry: dict[str, Any] = {
        "role": "assistant",
        "text": prose_of(parts),
        "ts": record.get("ts"),
        "message_id": record.get("message_id"),
        "parts": parts,
        "step_record": {
            "steps": record.get("steps") or [],
            "thinking": record.get("thinking") or [],
            "receipt": record.get("receipt") or "",
        },
        "sources": record.get("sources") or [],
        "status": record.get("status"),
    }
    if record.get("usage") is not None:
        entry["usage"] = record["usage"]
    if record.get("status") == "error" and record.get("error") is not None:
        entry["error"] = record["error"]
    if record.get("clarify") is not None:
        entry["clarify"] = record["clarify"]
    return entry


def _pre_mvp2_boundary(messages: list[dict[str, Any]], records: list[dict[str, Any]]) -> int:
    """Where the prose-only fallback ends: the FIRST record's offset.

    Records are in insertion order (the overwrite channel appends), so
    ``records[0]`` is the oldest — its offset is the boundary. A missing /
    non-int / out-of-range offset clamps to ``len(messages)`` with a warning:
    the read must degrade, never crash.
    """
    if not records:
        return len(messages)
    first = records[0].get("messages_offset")
    if not isinstance(first, int) or not 0 <= first <= len(messages):
        logger.warning(
            "first turn record has invalid messages_offset — clamping the "
            "pre-MVP2 fallback boundary to len(messages)",
            messages_offset=first,
        )
        return len(messages)
    return first


def _extract_transcript(
    messages: list[dict[str, Any]],
    turn_records: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """The full-fidelity transcript (B1b, wire-contract §2).

    Turn records (G2) drive the MVP2 entries and are SELF-CONTAINED — the
    user text and the materialized parts live on the record; no ``messages``
    slicing. Messages not covered by any record (pre-MVP2 turns) fall back to
    the prose-only shape, in order, BEFORE the record-backed entries.
    """
    records = turn_records or []
    entries = _prose_only_entries(messages[: _pre_mvp2_boundary(messages, records)])
    for record in records:
        entries.extend(_user_entries_for_record(record))
        entries.append(_assistant_entry_for_record(record))
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
    """Start one counselor turn and stream it as SSE.

    FastAPI validates ``session_id`` as a UUID before this handler runs —
    a malformed id (e.g. ``"not-a-uuid"``) is rejected with 422, never 500.

    Returns 404 when the session row is unknown; 409 when a turn is already
    in flight (the registry's single-flight lock); 422 when
    ``replace_message_id`` is not an editable target (G3: pre-MVP2 turns and
    synthesized clarify-answer bubbles). The turn runs as a DETACHED task —
    dropping this response does not stop it (reattach via GET .../stream).
    """
    sid = str(session_id)
    trace_id = getattr(request.state, "trace_id", None)

    not_found = await _session_404(request, sid)
    if not_found is not None:
        return not_found  # type: ignore[return-value]

    try:
        stream = await _registry(request).start(
            sid,
            body.text,
            body.source_config,
            replace_message_id=body.replace_message_id,
        )
    except StreamActive:
        return _error_json(  # type: ignore[return-value]
            409, "A turn is already streaming for this session.", trace_id
        )
    except TooManyTurns:
        return _error_json(  # type: ignore[return-value]
            503, "We're at capacity right now — please try again in a moment.", trace_id
        )
    except InvalidEditTarget:
        # Never forward str(exc) to the client — the message is internal; a
        # fixed user-safe line goes out, the detail is logged server-side.
        logger.warning("invalid edit target", session_id=sid, exc_info=True)
        return _error_json(422, "That message can't be edited.", trace_id)  # type: ignore[return-value]

    return _sse_response(stream, request)


@router.get("/sessions/{session_id}/stream")
async def stream_session(
    session_id: UUID,
    request: Request,
) -> EventSourceResponse:
    """Reattach to the in-flight turn (B2, §27.3).

    Reads the standard ``Last-Event-ID`` request header; the registry replays
    every buffered event with ``seq > Last-Event-ID`` (absent header → from
    seq 0), then follows live. No active turn (idle, parked, or evicted at the
    terminal) → 204 — the client falls back to the transcript (complete, G2).
    """
    sid = str(session_id)
    settings = request.app.state.settings

    not_found = await _session_404(request, sid)
    if not_found is not None:
        return not_found  # type: ignore[return-value]

    if not getattr(settings, "reattach_enabled", True):
        return Response(status_code=204)  # type: ignore[return-value]

    raw = request.headers.get("last-event-id")
    last_event_id = _parse_last_event_id(raw)

    try:
        stream = _registry(request).attach(sid, last_event_id)
    except NoActiveTurn:
        return Response(status_code=204)  # type: ignore[return-value]
    except TooManyConsumers:
        trace_id = getattr(request.state, "trace_id", None)
        return _error_json(  # type: ignore[return-value]
            429, "Too many open connections for this answer — please close one and retry.", trace_id
        )

    return _sse_response(stream, request)


@router.post("/sessions/{session_id}/cancel")
async def cancel_session(
    session_id: UUID,
    request: Request,
) -> Response:
    """Cancel the in-flight turn (G5).

    Active → 202 (partial persisted; the stream terminates with the
    single-shot ``done(cancelled)``); parked clarify → 204 + unpark (the
    clarify freezes unanswered); idle — including cancel racing completion —
    → 204 no-op.
    """
    sid = str(session_id)

    not_found = await _session_404(request, sid)
    if not_found is not None:
        return not_found

    outcome = await _registry(request).cancel(sid)
    return Response(status_code=202 if outcome == "cancelled" else 204)


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
        return _error_json(404, "Session not found.", trace_id)

    # Pull message history from the checkpointer
    config = {"configurable": {"thread_id": sid}}
    try:
        snapshot = await runtime.graph.aget_state(config)
        if snapshot is None:
            messages: list[dict[str, Any]] = []
            turn_records: list[dict[str, Any]] = []
        else:
            messages = list(snapshot.values.get("messages") or [])
            turn_records = list(snapshot.values.get("turn_records") or [])
    except Exception:
        logger.exception("failed to load checkpointer state", session_id=sid)
        return _error_json(
            500, "Failed to load session transcript — please try again.", trace_id
        )

    try:
        transcript = _extract_transcript(messages, turn_records)
    except Exception:
        # A corrupt record (missing required id, malformed shape) must degrade
        # to an honest error, never a 500 stacktrace to the client.
        logger.exception("failed to extract transcript", session_id=sid)
        return _error_json(
            500, "Failed to load session transcript — please try again.", trace_id
        )

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
