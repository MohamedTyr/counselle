"""SSE encoding helpers for the v1 event protocol (ADR 0016, ARCHITECTURE §6).

Every domain :class:`~domain.events.Event` is encoded as one SSE message:

    id: <seq>\\r\\n
    event: <type>\\r\\n
    data: <compact-json>\\r\\n
    \\r\\n

The route merges :data:`SSE_HEADERS` into the response headers.  Keepalive
comments (``": ping"``) are handled automatically by
``sse-starlette``'s ``EventSourceResponse(ping=settings.sse_keepalive_s)`` —
the ``ping`` parameter is the interval in seconds.
"""

from __future__ import annotations

import json

from sse_starlette import ServerSentEvent

from domain.events import Event

# Headers the route must merge to prevent proxy/CDN buffering of the SSE stream.
# Cache-Control: no-store  — no caching of the live stream.
# X-Accel-Buffering: no    — disables nginx proxy_buffering for this response.
SSE_HEADERS: dict[str, str] = {
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
    # Belt-and-suspenders against MIME-sniffing of the event-stream body.
    "X-Content-Type-Options": "nosniff",
}


def encode_sse(event: Event, seq: int) -> ServerSentEvent:
    """Encode one domain event as an SSE frame.

    Args:
        event: The domain protocol event to encode.
        seq:   Monotonically increasing sequence number for the ``id:`` field.
               Clients use this for reconnect/Last-Event-ID; it is unique within
               a turn's buffer but NOT across turns. A client that persists a
               Last-Event-ID across a turn boundary is handled safely
               server-side (BC-06): a cursor ahead of the new turn's buffer
               triggers a full replay, never a silent skip. The ``v:1`` field on
               every frame is accepted wire overhead (no protocol change this
               phase — master plan §5).

    Returns:
        A :class:`sse_starlette.sse.ServerSentEvent` ready to be yielded from
        an ``EventSourceResponse`` generator.  The ``data`` field is the compact
        JSON serialisation of ``event.model_dump()``.  The ``event`` field is the
        protocol event type (``"meta"``, ``"delta"``, etc.).
    """
    payload = json.dumps(event.model_dump(), separators=(",", ":"))
    return ServerSentEvent(
        data=payload,
        event=event.type,
        id=str(seq),
    )
