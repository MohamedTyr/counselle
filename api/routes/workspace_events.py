"""Workspace change-event SSE route."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from fastapi import APIRouter, Depends, Request
from sse_starlette import EventSourceResponse, ServerSentEvent

from api.auth import current_active_user
from api.deps import EnvelopeError
from api.sse import SSE_HEADERS
from api.users_db import UserDB
from app.workspace.changes import WorkspaceEventBus, replay_changes
from app.workspace.models import ChangeEvent

router = APIRouter(tags=["workspace"])

# Keep this in the same "obviously beyond normal use" range as the chat SSE
# cursor guard. Absurdly large cursors are usually stale/foreign garbage; using
# them as a hard floor can starve live workspace events.
_MAX_CHANGE_ID = 10_000_000
_WORKSPACE_REPLAY_LIMIT = 1000


def parse_last_change_id(raw: str | None) -> int | None:
    """Parse ``Last-Event-ID`` for workspace replay.

    ``None`` means the header is absent: fresh connect, live-only. A present
    but malformed/negative/implausibly future value falls back to ``0`` so a
    reconnect can recover without turning that bad value into a starvation
    floor for live events.
    """
    if raw is None:
        return None
    try:
        value = int(raw)
    except ValueError:
        return 0
    if 0 <= value < _MAX_CHANGE_ID:
        return value
    return 0


def encode_workspace_sse(change: ChangeEvent) -> ServerSentEvent:
    payload = json.dumps(change.model_dump(mode="json"), separators=(",", ":"))
    return ServerSentEvent(data=payload, event=change.type, id=str(change.id))


def _should_emit_change(
    change: ChangeEvent, *, after_id: int | None, delivered_ids: set[int]
) -> bool:
    if after_id is not None and change.id <= after_id:
        return False
    if change.id in delivered_ids:
        return False
    delivered_ids.add(change.id)
    return True


async def workspace_event_stream(
    request: Any,
    user: UserDB,
    bus: WorkspaceEventBus,
    after_id: int | None,
) -> AsyncIterator[ServerSentEvent]:
    async with bus.subscribe(user.id) as queue:
        delivered_ids: set[int] = set()
        if after_id is not None:
            replay_after_id = after_id
            while True:
                replayed = await replay_changes(
                    request.app.state.runtime.app_pool,
                    user_id=user.id,
                    after_id=replay_after_id,
                    limit=_WORKSPACE_REPLAY_LIMIT,
                )
                if not replayed:
                    break
                replay_after_id = max(change.id for change in replayed)
                for change in replayed:
                    if _should_emit_change(
                        change, after_id=after_id, delivered_ids=delivered_ids
                    ):
                        yield encode_workspace_sse(change)
                if len(replayed) < _WORKSPACE_REPLAY_LIMIT:
                    break

        while True:
            try:
                change = queue.get_nowait()
            except asyncio.QueueEmpty:
                break
            if _should_emit_change(
                change, after_id=after_id, delivered_ids=delivered_ids
            ):
                yield encode_workspace_sse(change)

        while True:
            if await request.is_disconnected():
                break
            change = await queue.get()
            if _should_emit_change(
                change, after_id=after_id, delivered_ids=delivered_ids
            ):
                yield encode_workspace_sse(change)


@router.get("/workspace/events")
async def workspace_events_route(
    request: Request,
    user: UserDB = Depends(current_active_user),
) -> EventSourceResponse:
    settings = request.app.state.settings
    bus = request.app.state.runtime.deps.workspace_events
    if bus is None:
        raise EnvelopeError(500, "Workspace events are not available.")
    after_id = parse_last_change_id(request.headers.get("last-event-id"))
    return EventSourceResponse(
        workspace_event_stream(request, user, bus, after_id),
        ping=settings.sse_keepalive_s,
        headers=SSE_HEADERS,
    )
