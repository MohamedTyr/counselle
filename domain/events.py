"""The v1 protocol event types (ADR 0016, ARCHITECTURE §6).

Every event is ``{v: 1, type, data}`` — one envelope, every consumer. Clients
ignore unknown event types (forward compatibility); breaking changes bump ``v``.
"""

from typing import Any, Literal

from pydantic import BaseModel

from domain.envelope import Citation
from domain.specs import ClarifySpec, RenderSpec

PROTOCOL_VERSION = 1

EventType = Literal["meta", "delta", "viz", "clarify", "sources", "usage", "done", "error"]


class Event(BaseModel):
    """The one wire envelope for every streamed event."""

    v: int = PROTOCOL_VERSION
    type: EventType
    data: dict[str, Any]


class MetaData(BaseModel):
    """First event of every stream: identifiers + the model in use."""

    trace_id: str
    session_id: str
    model: str


class DeltaData(BaseModel):
    """A chunk of prose (with inline citation markers)."""

    text: str


class SourceEntry(BaseModel):
    """One deduplicated source for the turn, referenced by inline markers."""

    index: int
    citation: Citation
    label: str


class SourcesData(BaseModel):
    """The turn's full deduplicated citation list."""

    sources: list[SourceEntry]


class UsageData(BaseModel):
    """Token + cost accounting for the turn (ARCHITECTURE §19)."""

    input_tokens: int
    output_tokens: int
    est_cost_usd: float | None = None
    tool_calls: int


class DoneData(BaseModel):
    """Terminal event: the turn completed or parked on a clarify question."""

    status: Literal["complete", "awaiting_input"]


class ErrorData(BaseModel):
    """Terminal error: a user-safe message plus the trace id."""

    message: str
    trace_id: str


def ev_meta(trace_id: str, session_id: str, model: str) -> Event:
    meta = MetaData(trace_id=trace_id, session_id=session_id, model=model)
    return Event(type="meta", data=meta.model_dump())


def ev_delta(text: str) -> Event:
    return Event(type="delta", data=DeltaData(text=text).model_dump())


def ev_viz(spec: RenderSpec) -> Event:
    return Event(type="viz", data=spec.model_dump())


def ev_clarify(spec: ClarifySpec) -> Event:
    return Event(type="clarify", data=spec.model_dump())


def ev_sources(sources: list[SourceEntry]) -> Event:
    return Event(type="sources", data=SourcesData(sources=sources).model_dump())


def ev_usage(usage: UsageData) -> Event:
    return Event(type="usage", data=usage.model_dump())


def ev_done(status: Literal["complete", "awaiting_input"]) -> Event:
    return Event(type="done", data=DoneData(status=status).model_dump())


def ev_error(message: str, trace_id: str) -> Event:
    return Event(type="error", data=ErrorData(message=message, trace_id=trace_id).model_dump())
