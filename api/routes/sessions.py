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
from app.chat_deletion import cancel_and_drop_threads
from app.clarify_lifecycle import ClarificationConflict, ClarifyClaimBusy
from app.feedback import clear_feedback, feedback_for_session, set_feedback
from app.sessions import (
    create_session,
    encode_cursor,
    list_sessions,
    set_session_source_config,
    set_session_title,
)
from app.skills import (
    SELECTED_SKILLS_SAFE_ERROR,
    SelectedSkillValidationError,
    validate_selected_skills,
)
from app.titles import default_title
from app.transcript import extract_transcript
from app.turns import (
    InvalidEditTarget,
    InvalidResponseMode,
    InvalidSelectedSkills,
    NoActiveTurn,
    ResponseModeUnavailable,
    StreamActive,
    TooManyConsumers,
    TooManyTurns,
    TurnRegistry,
)
from domain.response_mode import ResponseMode
from domain.specs import SourceConfig

router = APIRouter(tags=["sessions"])
logger = structlog.get_logger(__name__)


# Keep the wire shape strict before the repository allowlist runs.  The global
# request-validation handler intentionally maps every error rooted at this
# field to the same safe 422 as an unknown or internal skill, so schema errors
# never reveal the public slug grammar or let a malformed selection reach a
# turn claim.
# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class CreateSessionBody(BaseModel):
    source_config: SourceConfig | None = None
    response_mode: ResponseMode | None = None


class CreateSessionResponse(BaseModel):
    session_id: str
    source_config: dict[str, Any]
    response_mode: str


class MessageBody(BaseModel):
    text: Any = None
    skills: Any = Field(
        default_factory=list,
    )
    source_config: Any = None
    # G3 (B2): a prior user_message_id — edit & regenerate via history rewrite.
    replace_message_id: Any = None
    # Accepted for forward-compat (clarify event id); ignored beyond validation.
    # run_turn detects parked interrupts autonomously — see module docstring.
    in_reply_to: Any = None
    # Optional (plan §3.3): a normal new turn should always send it; omission
    # falls back to the session's persisted mode. Clarification answers omit
    # it and inherit the parked record's mode (wired in Phase 3).
    response_mode: Any = None
    clarify_response: Any = None


class SteerBody(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class TranscriptEntry(BaseModel):
    role: str  # "user" | "assistant"
    text: str
    ts: str | None


class SessionResponse(BaseModel):
    session_id: str
    title: str | None
    created_at: str | None
    source_config: dict[str, Any] | None
    response_mode: str
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


def _response_mode_unavailable(
    response_mode: ResponseMode | None, settings: Any
) -> bool:
    """True when *response_mode* is well-formed but administratively disabled.

    Malformed values never reach here — FastAPI rejects them as 422 before the
    route body executes (plan §3.3: "well-formed but unavailable" is distinct
    from invalid input).
    """
    return response_mode is ResponseMode.THINK and not settings.response_mode_think_enabled


#: Upper bound on a sane Last-Event-ID — well past any real buffer seq; a value
#: at/above this is treated as garbage (full replay) rather than trusted.
_MAX_EVENT_ID = 10_000_000


def _parse_last_event_id(raw: str | None) -> int | None:
    """Parse + clamp the ``Last-Event-ID`` header → a valid seq, or ``None``.

    A malformed, negative, or absurdly large value degrades to ``None`` (full
    replay) — never a 500. Only ``0 <= n < _MAX_EVENT_ID`` is honoured.

    The ceiling is a sanity bound on garbage, NOT relevance: a cursor from a
    PREVIOUS turn can be small yet still foreign to the current turn's buffer.
    The real guard is server-side in ``TurnRegistry._follow`` (BC-06): a cursor
    ahead of the buffer's ``next_seq`` triggers a full replay from the head,
    never a silent skip.
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


def _error_json(
    status_code: int, message: str, trace_id: str | None, *, code: str | None = None
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"message": message, "trace_id": trace_id, "code": code}},
    )


def _valid_message_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    if not value or len(value) > 4000:
        return None
    return value


def _valid_short_string(value: Any, *, max_length: int) -> str | None:
    if not isinstance(value, str):
        return None
    if len(value) > max_length:
        return None
    return value


def _clarify_malformed(
    trace_id: str | None,
    message: str = "That clarification answer is malformed.",
) -> JSONResponse:
    return _error_json(422, message, trace_id, code="malformed_response")


def _invalid_request(
    trace_id: str | None,
    message: str = "Invalid message request.",
) -> JSONResponse:
    return _error_json(422, message, trace_id)


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
    trace_id = getattr(request.state, "trace_id", None)

    requested_mode = body.response_mode if body else None
    if _response_mode_unavailable(requested_mode, settings):
        return _error_json(
            503, "Think is temporarily unavailable. Try again, or switch to Quick.", trace_id
        )
    response_mode = requested_mode or ResponseMode.QUICK

    effective = (body.source_config if body else None) or SourceConfig.defaults_from(settings)
    session_id = await create_session(
        runtime.app_pool,
        effective.model_dump(mode="json"),
        user_id=str(user.id),
        response_mode=response_mode,
    )
    return JSONResponse(
        status_code=201,
        content={
            "session_id": session_id,
            "source_config": effective.model_dump(mode="json"),
            "response_mode": response_mode.value,
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
    text = _valid_message_text(body.text)

    registry = _registry(request)
    pending_v2_reply = False
    if body.clarify_response is None and body.in_reply_to is None:
        try:
            pending_v2_reply = await registry.has_pending_v2_clarification(sid)
        except Exception:
            logger.warning(
                "pending clarification classification failed", session_id=sid, exc_info=True
            )
            pending_v2_reply = False

    if body.clarify_response is not None or body.in_reply_to is not None or pending_v2_reply:
        in_reply_to = _valid_short_string(body.in_reply_to, max_length=64)
        if body.clarify_response is not None and body.in_reply_to is None:
            return _clarify_malformed(trace_id)  # type: ignore[return-value]
        if body.clarify_response is not None and in_reply_to is None:
            return _clarify_malformed(trace_id)  # type: ignore[return-value]
        if body.clarify_response is not None and not isinstance(body.clarify_response, dict):
            return _clarify_malformed(trace_id)  # type: ignore[return-value]
        if body.clarify_response is not None and body.text is not None:
            return _clarify_malformed(trace_id)  # type: ignore[return-value]
        if body.clarify_response is None and text is None:
            return _clarify_malformed(trace_id)  # type: ignore[return-value]
        if (
            body.skills != []
            or body.source_config is not None
            or body.replace_message_id is not None
            or body.response_mode is not None
        ):
            return _clarify_malformed(
                trace_id, "Clarification answers can't change turn settings."
            )  # type: ignore[return-value]
        try:
            prepared = await registry.accept_clarification(
                sid,
                in_reply_to=in_reply_to,
                widget_response_payload=body.clarify_response,
                composer_text=text if body.clarify_response is None else None,
            )
            inherited_mode = ResponseMode(prepared.inherited_response_mode)
            stream = await registry.start_continuation(
                sid,
                prepared,
                user_id=str(user.id),
                response_mode=inherited_mode,
            )
        except ClarificationConflict as exc:
            logger.info("clarification answer rejected", session_id=sid, code=exc.code)
            return _error_json(  # type: ignore[return-value]
                409,
                "That clarification was already answered or is no longer current.",
                trace_id,
                code=exc.code,
            )
        except ValueError:
            logger.warning("stored clarification response mode is invalid", session_id=sid)
            return _error_json(  # type: ignore[return-value]
                409,
                "That clarification was already answered or is no longer current.",
                trace_id,
                code="clarification_stale",
            )
        except StreamActive:
            return _error_json(  # type: ignore[return-value]
                409,
                "That clarification is already continuing.",
                trace_id,
                code="clarification_conflict_active_turn",
            )
        except ClarifyClaimBusy:
            return _error_json(  # type: ignore[return-value]
                409,
                "That clarification is already being handled.",
                trace_id,
                code="clarification_conflict_active_turn",
            )
        except TooManyTurns:
            return _error_json(  # type: ignore[return-value]
                503, "We're at capacity right now — please try again in a moment.", trace_id
            )
        except ResponseModeUnavailable:
            return _error_json(  # type: ignore[return-value]
                503, "Think is temporarily unavailable. Try again, or switch to Quick.", trace_id
            )
        return _sse_response(stream, request)

    if text is None:
        return _error_json(422, "Message text is required.", trace_id)  # type: ignore[return-value]
    if not isinstance(body.skills, list):
        logger.warning(
            "invalid explicit skill selection",
            session_id=sid,
            reason="invalid_selected_skills_schema",
        )
        return _error_json(422, SELECTED_SKILLS_SAFE_ERROR, trace_id)  # type: ignore[return-value]
    if any(not isinstance(item, str) for item in body.skills):
        logger.warning(
            "invalid explicit skill selection",
            session_id=sid,
            reason="invalid_selected_skill_item_schema",
        )
        return _error_json(422, SELECTED_SKILLS_SAFE_ERROR, trace_id)  # type: ignore[return-value]
    try:
        selected_skills = validate_selected_skills(body.skills)
    except SelectedSkillValidationError as exc:
        logger.warning("invalid explicit skill selection", session_id=sid, reason=exc.reason)
        return _error_json(422, SELECTED_SKILLS_SAFE_ERROR, trace_id)  # type: ignore[return-value]
    requested_source_config: SourceConfig | None = None
    if body.source_config is not None:
        try:
            requested_source_config = SourceConfig.model_validate(body.source_config)
        except Exception:
            return _invalid_request(trace_id, "Invalid source settings.")  # type: ignore[return-value]
    requested_response_mode: ResponseMode | None = None
    if body.response_mode is not None:
        try:
            requested_response_mode = ResponseMode(body.response_mode)
        except ValueError:
            return _invalid_request(trace_id, "Invalid response mode.")  # type: ignore[return-value]
    replace_message_id = (
        _valid_short_string(body.replace_message_id, max_length=64)
        if body.replace_message_id is not None
        else None
    )
    if body.replace_message_id is not None and replace_message_id is None:
        return _invalid_request(trace_id, "That message can't be edited.")  # type: ignore[return-value]

    # Well-formed but administratively disabled is a 503, not a 422 (plan §3.3);
    # checked before any claim/write.
    if _response_mode_unavailable(requested_response_mode, settings):
        return _error_json(  # type: ignore[return-value]
            503, "Think is temporarily unavailable. Try again, or switch to Quick.", trace_id
        )

    # BC-12: claim before side-effect writes.
    # Claim the session FIRST (single-flight): a rejected start (409/503/422)
    # must NOT mutate the stored source-config or stamp a title from a prompt
    # that never ran (BC-12). The per-turn effective config is passed into
    # start() directly; the sticky persistence + default title land only after
    # the claim succeeds.
    try:
        stream = await registry.start(
            sid,
            text,
            requested_source_config,
            user_id=str(user.id),
            replace_message_id=replace_message_id,
            selected_skills=selected_skills,
            response_mode=requested_response_mode,
            session_response_mode=ResponseMode(
                row.get("response_mode") or ResponseMode.QUICK.value
            ),
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
    except InvalidSelectedSkills:
        logger.warning(
            "invalid explicit skill selection",
            session_id=sid,
            reason="registry_revalidation_failed",
        )
        return _error_json(422, SELECTED_SKILLS_SAFE_ERROR, trace_id)  # type: ignore[return-value]
    except ResponseModeUnavailable:
        # The registry-level guard (the real authority — the earlier
        # `_response_mode_unavailable` check above is a fast-fail UX nicety
        # only); catches an implicit session-sticky Think that's since been
        # disabled, and a parked-resume mode no longer available.
        return _error_json(  # type: ignore[return-value]
            503, "Think is temporarily unavailable. Try again, or switch to Quick.", trace_id
        )
    except InvalidResponseMode:
        logger.warning("response mode conflicts with pending clarification", session_id=sid)
        return _error_json(  # type: ignore[return-value]
            422, "That response mode conflicts with the pending clarification.", trace_id
        )

    # The claim succeeded — now persist the side effects (BC-12).
    # Source-config stickiness (PRD story 10): upsert the per-message toggle so
    # it survives devices/cleared storage; the session read seeds the dropdown.
    if requested_source_config is not None:
        await set_session_source_config(pool, sid, requested_source_config.model_dump(mode="json"))
    # Default title on first message: stamp the (truncated) question so the chat
    # has a name immediately; the on_turn_complete hook may upgrade it later.
    if row.get("title") is None:
        await set_session_title(pool, sid, default_title(text, settings.title_max_len))

    return _sse_response(stream, request)


@router.post(
    "/sessions/{session_id}/steer",
    dependencies=[Depends(require_json), Depends(message_rate_limit)],
)
async def steer_session(
    session_id: UUID,
    body: SteerBody,
    request: Request,
    _user: UserDB = Depends(current_active_user),
    _row: dict[str, Any] = Depends(owned_session),
) -> JSONResponse:
    """Queue a user steering message for the active assistant run.

    Active steerable turn → 202 with the queued user_message_id. Idle/no
    steerable run → 409 with the explicit idle status so the client can submit
    the text as the next normal message.
    """
    sid = str(session_id)
    try:
        user_message_id = _registry(request).steer(sid, body.text)
    except NoActiveTurn:
        return JSONResponse(status_code=409, content={"status": "idle"})
    return JSONResponse(
        status_code=202,
        content={"status": "queued", "user_message_id": user_message_id},
    )


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
            "response_mode": row.get("response_mode") or ResponseMode.QUICK.value,
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
            "response_mode": row.get("response_mode") or ResponseMode.QUICK.value,
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
    sid = str(session_id)
    pool = request.app.state.runtime.app_pool
    failed = await cancel_and_drop_threads(
        request.app.state.turn_registry,
        request.app.state.runtime.checkpointer,
        [sid],
    )
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
