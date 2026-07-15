"""The v1 protocol event types (ADR 0016, ARCHITECTURE §6).

Every event is ``{v: 1, type, data}`` — one envelope, every consumer. Clients
ignore unknown event types (forward compatibility); breaking changes bump ``v``.
"""

from collections.abc import Mapping
from typing import Any, Literal

from pydantic import BaseModel, field_validator

from domain.envelope import Citation
from domain.specs import ClarifySpec, RenderSpec

PROTOCOL_VERSION = 1

EventType = Literal[
    "meta",
    "delta",
    "step",
    "narration",
    "thinking",
    "user_message",
    "viz",
    "clarify",
    "sources",
    "usage",
    "done",
    "error",
]

StepStatus = Literal["start", "end", "error"]
StepKind = Literal[
    "db_tool",
    "sql",
    "web_search",
    "edu_search",
    "reddit_search",
    "viz",
    "skill",
    "research",
    "write_plan",
    "workspace",
    "memory",
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

    Public, student-safe receipt fields only; never raw tool results, DSNs,
    credentials, or hidden backend payloads. The ``sql`` kind's statement rides
    ``query`` for transparent receipts.

    Honesty invariant: ``field_keys`` and ``row_count`` are eng/debug-only —
    they expose DB schema internals and MUST NOT be rendered in student-facing
    UI. Public plan receipts ride ``items``/``completed``/``total``.
    """

    query: str | None = None
    summary: str | None = None
    domains: list[str] | None = None
    result_count: int | None = None
    value_count: int | None = None
    duration_ms: int | None = None
    tool: str | None = None
    domain_id: str | None = None
    field_keys: list[str] | None = None
    row_count: int | None = None
    viz_type: str | None = None
    schools: list[str] | None = None
    items: list[dict[str, str]] | None = None
    completed: int | None = None
    total: int | None = None
    next_actions: list[str] | None = None
    error: str | None = None


class StepSource(BaseModel):
    """One source chip on a completed step (§27.1): a favicon + a label.

    The favicon is a CDN URL derived live from the source host — a school's
    ``institution.website`` domain, or a search result's URL host — never a
    stored/hardcoded logo. ``label`` is the host (web/edu), the school name
    (db/viz), or the post title (reddit). ``url`` is the result link when one
    exists. Display-only; honesty rules live in the citation envelope, not here.
    """

    label: str
    favicon: str | None = None
    url: str | None = None


class ToolUi(BaseModel):
    """Structured public UI payload for a completed tool step.

    The raw tool result's top-level ``ui`` key is stripped before the model sees
    it; the step event receives this public copy from ``public_receipt.ui`` for
    widget rendering.
    """

    widget: str
    data: dict[str, Any]

    @field_validator("widget")
    @classmethod
    def widget_must_be_non_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("widget must be non-blank")
        return value


def valid_tool_ui(value: Any) -> bool:
    """Return True for tool UI payloads that can cross the step-event seam."""
    return (
        isinstance(value, Mapping)
        and isinstance(value.get("widget"), str)
        and bool(value["widget"].strip())
        and isinstance(value.get("data"), Mapping)
    )


def tool_ui_from_payload(value: Any) -> ToolUi | None:
    """Build a validated ToolUi from a public receipt payload."""
    if not valid_tool_ui(value):
        return None
    return ToolUi(widget=str(value["widget"]), data=dict(value["data"]))


class StepData(BaseModel):
    """One unit of agent work: a start/end pair the activity timeline renders."""

    step_id: str
    status: StepStatus
    kind: StepKind
    label: str
    tier: StepTier | None
    detail: StepDetail | None = None
    #: Source chips, populated only on the ``end`` event (None otherwise). None
    #: so ``ev_step`` drops it on the wire — an empty list would serialize as
    #: ``[]`` (FE optional is ``?:``, not ``[]``).
    sources: list[StepSource] | None = None
    ui: ToolUi | None = None


class NarrationData(BaseModel):
    """The agent's loud talk — model prose said out loud while still working
    (before/between tool calls). Shown inline as a visible prose beat, in
    stream order. Replaces routing this text into ``thinking``."""

    text: str


class ThinkingData(BaseModel):
    """A native raw-reasoning line (Gemini thought summaries via
    ``include_thoughts``), interleaved in the timeline. ONLY emitted when
    the effective ``thinking_stream`` setting is on — collapsed by default,
    never shown as prose. ``thinking_summaries`` is deprecated compatibility
    config only. Never carries narration; see :class:`NarrationData` for that."""

    text: str


class UserMessageData(BaseModel):
    """A user message sent while an assistant run is active.

    ``injected=False`` is the immediate acknowledgement. ``injected=True`` is
    emitted only after the agent run accepted the text through PydanticAI's
    public enqueue API.
    """

    text: str
    user_message_id: str
    injected: bool


class SourceEntry(BaseModel):
    """One deduplicated source for the turn, referenced by inline markers."""

    index: int
    citation: Citation
    label: str
    #: Short page description — the search-result snippet / meta description.
    #: Present for web/edu/reddit results; ``None`` for structured DB sources
    #: (CDS/IPEDS) that have no page. Rendered as the source row's body line.
    snippet: str | None = None


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
    if data["sources"] is None:
        # FE optional (`sources?:`) — drop entirely rather than send null/[].
        del data["sources"]
    else:
        # Each source's unset favicon/url are dropped too (mirror the detail
        # None-drop): the FE optionals are `?:`, not null — a null favicon
        # would crash the chip's `favicon.startsWith` guard.
        data["sources"] = [{k: v for k, v in s.items() if v is not None} for s in data["sources"]]
    if data["ui"] is None:
        # FE optional (`ui?:`) — drop entirely rather than send null.
        del data["ui"]
    return Event(type="step", data=data)


def ev_narration(text: str) -> Event:
    return Event(type="narration", data=NarrationData(text=text).model_dump())


def ev_thinking(text: str) -> Event:
    return Event(type="thinking", data=ThinkingData(text=text).model_dump())


def ev_user_message(text: str, user_message_id: str, *, injected: bool) -> Event:
    return Event(
        type="user_message",
        data=UserMessageData(
            text=text,
            user_message_id=user_message_id,
            injected=injected,
        ).model_dump(),
    )


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
