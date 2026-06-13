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

from typing import Any, Literal
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, Path, Query, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sse_starlette import EventSourceResponse

from api.auth import current_active_user
from api.deps import EnvelopeError, owned_session, require_json
from api.ratelimit import message_rate_limit
from api.sse import SSE_HEADERS, encode_sse
from api.users_db import UserDB
from app.feedback import clear_feedback, feedback_for_session, set_feedback
from app.sessions import (
    create_session,
    encode_cursor,
    list_sessions,
    set_session_source_config,
    set_session_title,
)
from app.titles import default_title
from app.transcript import extract_transcript
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


#: Generous sentinel ceiling on a rename title — the route re-validates against
#: settings.title_max_len; the model can't read settings at class-definition time.
_RENAME_TITLE_PYDANTIC_CEIL = 200


class RenameSessionBody(BaseModel):
    # title bounds: min 1 (no empty rename); the upper bound here is a generous
    # sentinel — the route validates the real ceiling against settings.title_max_len.
    title: str = Field(min_length=1, max_length=_RENAME_TITLE_PYDANTIC_CEIL)


class FeedbackBody(BaseModel):
    rating: Literal["up", "down"] | None


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


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.post("/sessions", status_code=201, dependencies=[Depends(require_json)])
async def create_session_route(
    request: Request,
    body: CreateSessionBody | None = None,
    user: UserDB = Depends(current_active_user),
) -> JSONResponse:
    """Create a new counselle.sessions row and return {session_id, source_config}.

    Requires auth; the row is stamped with the authed ``user_id``. The body is
    optional; if ``source_config`` is omitted the settings defaults are used
    (via :meth:`SourceConfig.defaults_from`).
    """
    settings = request.app.state.settings
    runtime = request.app.state.runtime

    effective = (body.source_config if body else None) or SourceConfig.defaults_from(settings)
    session_id = await create_session(
        runtime.app_pool, effective.model_dump(mode="json"), user_id=str(user.id)
    )
    return JSONResponse(
        status_code=201,
        content={
            "session_id": session_id,
            "source_config": effective.model_dump(mode="json"),
        },
    )


@router.post(
    "/sessions/{session_id}/messages",
    dependencies=[Depends(require_json), Depends(message_rate_limit)],
)
async def post_message(
    session_id: UUID,
    body: MessageBody,
    request: Request,
    user: UserDB = Depends(current_active_user),
    row: dict[str, Any] = Depends(owned_session),
) -> EventSourceResponse:
    """Start one counselor turn and stream it as SSE.

    FastAPI validates ``session_id`` as a UUID before this handler runs —
    a malformed id (e.g. ``"not-a-uuid"``) is rejected with 422, never 500.

    Requires auth + ownership (foreign/unknown → 404 via ``owned_session``);
    409 when a turn is already in flight (the registry's single-flight lock);
    422 when ``replace_message_id`` is not an editable target (G3: pre-MVP2 turns
    and synthesized clarify-answer bubbles). The turn runs as a DETACHED task —
    dropping this response does not stop it (reattach via GET .../stream).
    """
    sid = str(session_id)
    trace_id = getattr(request.state, "trace_id", None)
    settings = request.app.state.settings
    pool = request.app.state.runtime.app_pool

    # Source-config stickiness (PRD story 10): a per-message toggle is upserted
    # onto the row so it survives devices/cleared storage; the session read seeds
    # the dropdown from it. Done before the turn starts.
    if body.source_config is not None:
        await set_session_source_config(pool, sid, body.source_config.model_dump(mode="json"))

    # Default title on first message: stamp the (truncated) question so the chat
    # has a name immediately; the on_turn_complete hook may upgrade it later.
    if row.get("title") is None:
        await set_session_title(pool, sid, default_title(body.text, settings.title_max_len))

    try:
        stream = await _registry(request).start(
            sid,
            body.text,
            body.source_config,
            user_id=str(user.id),
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
    _row: dict[str, Any] = Depends(owned_session),
) -> EventSourceResponse:
    """Reattach to the in-flight turn (B2, §27.3).

    Requires auth + ownership (foreign/unknown → 404). Reads the standard
    ``Last-Event-ID`` request header; the registry replays every buffered event
    with ``seq > Last-Event-ID`` (absent header → from seq 0), then follows live.
    No active turn (idle, parked, or evicted at the terminal) → 204 — the client
    falls back to the transcript (complete, G2).
    """
    sid = str(session_id)
    settings = request.app.state.settings

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
    _row: dict[str, Any] = Depends(owned_session),
) -> Response:
    """Cancel the in-flight turn (G5).

    Requires auth + ownership (foreign/unknown → 404). Active → 202 (partial
    persisted; the stream terminates with the single-shot ``done(cancelled)``);
    parked clarify → 204 + unpark (the clarify freezes unanswered); idle —
    including cancel racing completion — → 204 no-op.
    """
    sid = str(session_id)
    outcome = await _registry(request).cancel(sid)
    return Response(status_code=202 if outcome == "cancelled" else 204)


@router.get("/sessions/{session_id}")
async def get_session_route(
    session_id: UUID,
    request: Request,
    user: UserDB = Depends(current_active_user),
    row: dict[str, Any] = Depends(owned_session),
) -> JSONResponse:
    """Fetch session metadata and the conversation transcript.

    FastAPI validates ``session_id`` as a UUID before this handler runs —
    a malformed id is rejected with 422, never 500. Requires auth + ownership
    (foreign/unknown → 404 via ``owned_session``).

    Transcript is reconstructed from the LangGraph checkpointer's message
    history (``graph.aget_state`` → ``state.values["messages"]``).  See
    :func:`app.transcript.extract_transcript` for the mapping rules.
    """
    sid = str(session_id)
    runtime = request.app.state.runtime
    trace_id = getattr(request.state, "trace_id", None)

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

    # The honesty join (B4): the caller's thumbs, keyed on assistant message_id,
    # so a rating survives reload. A read failure must not sink the transcript —
    # degrade to no feedback (the prose is still honest).
    feedback_by_id: dict[str, str] = {}
    try:
        feedback_by_id = await feedback_for_session(
            runtime.app_pool, user_id=str(user.id), session_id=sid
        )
    except Exception:
        logger.exception("failed to load feedback — serving transcript without it", session_id=sid)

    try:
        transcript = extract_transcript(messages, turn_records, feedback_by_id)
    except Exception:
        # A corrupt record (missing required id, malformed shape) must degrade
        # to an honest error, never a 500 stacktrace to the client.
        logger.exception("failed to extract transcript", session_id=sid)
        return _error_json(
            500, "Failed to load session transcript — please try again.", trace_id
        )

    return JSONResponse(
        content={
            "session_id": row["session_id"],
            "title": row.get("title"),
            "created_at": _iso(row.get("created_at")),
            "source_config": row.get("source_config"),
            "transcript": transcript,
        }
    )


def _iso(value: Any) -> str | None:
    """A datetime → isoformat, passing through None/strings unchanged."""
    if value is not None and hasattr(value, "isoformat"):
        return str(value.isoformat())
    return value if value is None else str(value)


@router.get("/sessions")
async def list_sessions_route(
    request: Request,
    user: UserDB = Depends(current_active_user),
    q: str | None = Query(default=None),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=50),
) -> JSONResponse:
    """The authed user's chat list — keyset-paginated, optional title search.

    Each row carries ``is_generating`` (a live turn exists) and the stored
    ``source_config`` (story 10 seed). ``next_cursor`` is null on the last page.
    """
    pool = request.app.state.runtime.app_pool
    registry = _registry(request)
    rows = await list_sessions(pool, str(user.id), q=q, cursor=cursor, limit=limit)

    sessions = [
        {
            "session_id": row["session_id"],
            "title": row.get("title"),
            "created_at": _iso(row.get("created_at")),
            "updated_at": _iso(row.get("updated_at")),
            "source_config": row.get("source_config"),
            "is_generating": registry.is_generating(row["session_id"]),
        }
        for row in rows
    ]
    next_cursor: str | None = None
    if len(rows) == limit:
        last = rows[-1]
        next_cursor = encode_cursor(last["updated_at"], last["session_id"])
    return JSONResponse(content={"sessions": sessions, "next_cursor": next_cursor})


@router.patch("/sessions/{session_id}", dependencies=[Depends(require_json)])
async def rename_session_route(
    session_id: UUID,
    body: RenameSessionBody,
    request: Request,
    row: dict[str, Any] = Depends(owned_session),
) -> JSONResponse:
    """Rename a chat (owned). Does NOT bump ``updated_at`` — a rename isn't activity."""
    settings = request.app.state.settings
    title = body.title.strip()
    if not title:
        raise EnvelopeError(422, "Title cannot be empty.")
    if len(title) > settings.title_max_len:
        raise EnvelopeError(422, f"Title must be at most {settings.title_max_len} characters.")
    sid = str(session_id)
    pool = request.app.state.runtime.app_pool
    await set_session_title(pool, sid, title)
    return JSONResponse(
        content={
            "session_id": sid,
            "title": title,
            "created_at": _iso(row.get("created_at")),
            "source_config": row.get("source_config"),
        }
    )


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session_route(
    session_id: UUID,
    request: Request,
    _row: dict[str, Any] = Depends(owned_session),
) -> Response:
    """Delete one chat: cancel any live turn FIRST, drop its checkpoint thread,
    then the row — the me.py honest pattern (abort 500 if the thread fails,
    row intact/retryable)."""
    from api.routes.me import _cancel_and_drop_threads

    sid = str(session_id)
    pool = request.app.state.runtime.app_pool
    failed = await _cancel_and_drop_threads(request, [sid])
    if failed:
        logger.error("session delete aborted — checkpoint thread survived", session_id=sid)
        raise EnvelopeError(500, "Deleting this chat didn't fully complete — please try again.")
    async with pool.acquire() as conn:
        await conn.execute("DELETE FROM counselle.sessions WHERE session_id = $1", session_id)
    return Response(status_code=204)


@router.post(
    "/sessions/{session_id}/messages/{message_id}/feedback",
    dependencies=[Depends(require_json)],
)
async def feedback_route(
    session_id: UUID,
    body: FeedbackBody,
    request: Request,
    message_id: str = Path(..., max_length=128),
    user: UserDB = Depends(current_active_user),
    _row: dict[str, Any] = Depends(owned_session),
) -> Response:
    """Set/clear the caller's thumbs on an assistant message (owned session).

    ``rating: null`` clears (204); ``up``/``down`` upserts (200 ``{rating}``).
    ``message_id`` is the assistant message_id (a path str).
    """
    pool = request.app.state.runtime.app_pool
    if body.rating is None:
        await clear_feedback(pool, user_id=str(user.id), message_id=message_id)
        return Response(status_code=204)
    await set_feedback(
        pool,
        user_id=str(user.id),
        session_id=str(session_id),
        message_id=message_id,
        rating=body.rating,
    )
    return JSONResponse(content={"rating": body.rating})
