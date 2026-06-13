"""The v1 protocol event types (ADR 0016, ARCHITECTURE §6).

Every event is ``{v: 1, type, data}`` — one envelope, every consumer. Clients
ignore unknown event types (forward compatibility); breaking changes bump ``v``.
"""

from typing import Any, Literal

from pydantic import BaseModel

from domain.envelope import Citation
from domain.specs import ClarifySpec, RenderSpec

PROTOCOL_VERSION = 1

EventType = Literal[
    "meta", "delta", "step", "thinking", "viz", "clarify", "sources", "usage", "done", "error"
]

StepStatus = Literal["start", "end", "error"]
StepKind = Literal[
    "db_tool", "sql", "web_search", "edu_search", "reddit_search", "viz", "skill", "research"
]
StepTier = Literal["official", "community"]
DoneStatus = Literal["complete", "awaiting_input", "cancelled"]


class Event(BaseModel):
    """The one wire envelope for every streamed event."""

    v: int = PROTOCOL_VERSION
    type: EventType
    data: dict[str, Any]


class MetaData(BaseModel):
    """First event of every stream: identifiers + the model in use.

    ``message_id``/``user_message_id`` are the turn's G1 identity pair (ADR
    0022): the assistant message being streamed and the user message that
    started the turn — minted at turn start so the live stream is addressable
    for feedback/edit. A clarify resume re-emits the parked turn's
    ``message_id``.
    """

    trace_id: str
    session_id: str
    model: str
    message_id: str
    user_message_id: str


class DeltaData(BaseModel):
    """A chunk of prose (with inline citation markers)."""

    text: str


class StepDetail(BaseModel):
    """Kind-specific receipt payload on a step's ``end``/``error`` (§27.1).

    Carries queries, domains, counts, field keys — NEVER DSNs, credentials,
    or payloads (house rule; tested). The ``sql`` kind's statement rides
    ``query`` (radical transparency — B0 decision).
    """

    query: str | None = None
    domains: list[str] | None = None
    result_count: int | None = None
    duration_ms: int | None = None
    tool: str | None = None
    field_keys: list[str] | None = None
    row_count: int | None = None
    viz_type: str | None = None
    schools: list[str] | None = None


class StepData(BaseModel):
    """One unit of agent work: a start/end pair the activity timeline renders."""

    step_id: str
    status: StepStatus
    kind: StepKind
    label: str
    tier: StepTier | None
    detail: StepDetail | None = None


class ThinkingData(BaseModel):
    """A short reasoning line interleaved in the timeline (§27.2)."""

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
    """Terminal event: the turn completed, parked on a clarify, or was cancelled."""

    status: DoneStatus


class ErrorData(BaseModel):
    """Terminal error: a user-safe message plus the trace id."""

    message: str
    trace_id: str


def ev_meta(
    trace_id: str, session_id: str, model: str, message_id: str, user_message_id: str
) -> Event:
    meta = MetaData(
        trace_id=trace_id,
        session_id=session_id,
        model=model,
        message_id=message_id,
        user_message_id=user_message_id,
    )
    return Event(type="meta", data=meta.model_dump())


def ev_delta(text: str) -> Event:
    return Event(type="delta", data=DeltaData(text=text).model_dump())


def ev_step(step: StepData) -> Event:
    data = step.model_dump()
    if data["detail"] is not None:
        # detail's unset fields are dropped (FE optionals are `?:`, not null);
        # top-level tier/detail stay explicit nulls (required-but-nullable).
        data["detail"] = {k: v for k, v in data["detail"].items() if v is not None}
    return Event(type="step", data=data)


def ev_thinking(text: str) -> Event:
    return Event(type="thinking", data=ThinkingData(text=text).model_dump())


def ev_viz(spec: RenderSpec) -> Event:
    return Event(type="viz", data=spec.model_dump())


def ev_clarify(spec: ClarifySpec) -> Event:
    return Event(type="clarify", data=spec.model_dump())


def ev_sources(sources: list[SourceEntry]) -> Event:
    return Event(type="sources", data=SourcesData(sources=sources).model_dump())


def ev_usage(usage: UsageData) -> Event:
    return Event(type="usage", data=usage.model_dump())


def ev_done(status: DoneStatus) -> Event:
    return Event(type="done", data=DoneData(status=status).model_dump())


def ev_error(message: str, trace_id: str) -> Event:
    return Event(type="error", data=ErrorData(message=message, trace_id=trace_id).model_dump())
