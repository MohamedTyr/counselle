"""The agent node — one PydanticAI run with the tool loop (Phase 4 Slice F).

Design (notes-p4-apis §1/§3/§4/§6/§7):

- **Per-turn objects rebuild from state** at the top of every execution: the
  source registry from ``state["source_registry"]``, the source config, the
  message history. On an ``interrupt()`` resume LangGraph RE-EXECUTES this node
  from the start — the whole PydanticAI run replays (model re-billed, prior
  tools re-run). That is the documented LangGraph pattern; it is correct here
  precisely because nothing per-turn lives outside state + locals.
- **User message convention:** the runner (``app/run_turn.py``) appends the new
  user message — a serialized ``ModelRequest`` with one ``UserPromptPart`` — to
  ``state["messages"]`` before invoking the graph. This node splits it back out:
  ``messages[:-1]`` is the ``message_history``, the tail's prompt text is the
  ``user_prompt``. One state key, one convention, replay-safe (the tail is still
  there on re-execution).
- **Clarify:** Agent V1 does not mount ``ask_student`` in the PydanticAI toolset.
  The legacy interrupt plumbing still exists below this node, so
  ``GraphInterrupt`` is allowed to propagate if a lower-level path raises it,
  but the V1 agent is expected to make reasonable assumptions and continue.
- **Streaming:** text reaches the client mid-run via the LangGraph custom
  stream (``get_stream_writer()``, notes §7). The first chunk of a text part
  arrives inside ``PartStartEvent`` (not as a delta) — both are forwarded.
  ``render_viz`` stages specs locally; staged cards flush once when final
  answer prose starts.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import TYPE_CHECKING, Any
from uuid import uuid4

from langgraph.config import get_stream_writer
from langgraph.errors import GraphInterrupt
from pydantic_ai import Agent, Tool
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import (
    ModelMessage,
    ModelMessagesTypeAdapter,
    ModelRequest,
    UserPromptPart,
)
from pydantic_ai.models import Model
from pydantic_ai.run import AgentRunResultEvent
from pydantic_ai.usage import UsageLimits

from app import viz as viz_mod
from app.plan_tool import make_write_plan_tool
from app.prompt import build_system_prompt
from app.records import Emission, append_or_replace, build_turn_record, now_iso
from app.skills import load_skill
from app.sources import SourceRegistry
from app.steps import CloseReason, EmissionRouter, StepMapper
from app.tool_middleware import ToolMiddlewareContext, process_tool_result
from app.tool_overflow import ToolResultStore
from app.toolset import GATEABLE_TOOLS, build_tools, make_tool_deps
from app.turn_persistence import partial_messages, resolve_offset
from app.viz_placement import StreamingVizMarkerStripper, chunks_from_viz_markers
from config.settings import get_settings, load_yaml_asset
from domain.events import UsageData
from domain.specs import SourceConfig

if TYPE_CHECKING:
    from app.graph import GraphDeps  # circular at runtime: graph imports run_agent_node

logger = logging.getLogger(__name__)


def _close_router_safely(router: EmissionRouter, reason: CloseReason) -> None:
    """Best-effort router closure inside an except block.

    A ``close()`` failure here must never mask the original exception — on the
    GraphInterrupt path the re-raise is lifecycle-critical for legacy/lower-level
    interrupt callers, so closing the timeline is strictly best-effort.
    """
    try:
        router.close(reason)
    except Exception:
        logger.warning("router.close(%r) raised — continuing", reason, exc_info=True)


def _close_router_and_flush_final_safely(
    router: EmissionRouter,
    final_writer: _FinalContentPlacementWriter,
    reason: CloseReason,
) -> None:
    _close_router_safely(router, reason)
    final_writer.flush_final()

#: The clean cut-off message when the run hits a request/token budget.
_TOOL_BUDGET_MESSAGE = (
    "\n\nI hit my tool budget for this turn, so I'm stopping here — this is what "
    "I have so far. Ask me to continue and I'll pick up where I left off."
)


@dataclass
class TurnDeps:
    """The PydanticAI run deps: what tool hooks reach via ``ctx.deps``.

    ``annotate_mcp_result`` (app/toolset.py) reads ``ctx.deps.registry`` to
    route every counselle-db result through the source registry.
    """

    registry: SourceRegistry
    tool_overflow: ToolMiddlewareContext | None = None


def model_name_from_setting(model_setting: str) -> str:
    """``"google-vertex:gemini-2.5-pro"`` → ``"gemini-2.5-pro"`` (notes §1: the
    provider prefix is unusable with our Express-mode key; only the bare model
    name feeds the explicit GoogleModel constructor)."""
    return model_setting.split(":", 1)[-1]


def default_model_factory(settings: Any) -> Model:
    """The real Gemini on Vertex Express Mode (notes §1 — the ONLY working auth path)."""
    from pydantic_ai.models.google import GoogleModel
    from pydantic_ai.providers.google_cloud import GoogleCloudProvider

    if not settings.vertex_api_key:
        raise RuntimeError(
            "COUNSELLE_VERTEX_API_KEY is not set — the counselor model cannot "
            "authenticate (Vertex Express Mode key required)."
        )
    return GoogleModel(
        model_name_from_setting(settings.model_counselor),
        provider=GoogleCloudProvider(api_key=settings.vertex_api_key),
    )


def _split_user_message(raw_messages: list[dict[str, Any]]) -> tuple[list[ModelMessage], str]:
    """Split serialized state messages into (history, new user prompt text).

    The runner's convention puts the new user message last (module docstring).
    """
    messages = ModelMessagesTypeAdapter.validate_python(raw_messages)
    if not messages or not isinstance(messages[-1], ModelRequest):
        raise ValueError(
            "state['messages'] must end with the new user ModelRequest — "
            "the runner appends it before invoking the graph"
        )
    prompt_parts = [part for part in messages[-1].parts if isinstance(part, UserPromptPart)]
    if not prompt_parts:
        raise ValueError("the tail ModelRequest carries no UserPromptPart")
    return list(messages[:-1]), str(prompt_parts[-1].content)


def _make_render_viz_tool(
    catalog: Any,
    registry: SourceRegistry,
    viz_list: list[dict[str, Any]],
    viz_signature_indexes: dict[str, int],
    tool_overflow: ToolMiddlewareContext | None,
) -> Tool[Any]:
    """The per-turn render_viz wrapper: closes over (catalog, registry, viz_list)
    and stages successful specs for the final-answer flush."""

    async def render_viz(
        type: viz_mod.VizType,
        unitids: list[int],
        field_keys: list[str] | None = None,
        title: str | None = None,
    ) -> dict[str, Any]:
        result = await viz_mod.render_viz(
            catalog,
            registry,
            viz_list,
            type,
            unitids,
            field_keys,
            title,
            viz_signature_indexes,
        )
        return process_tool_result(result, tool_overflow, tool_name="render_viz")  # type: ignore[no-any-return]

    render_viz.__doc__ = viz_mod.render_viz.__doc__  # the LLM-facing contract, verbatim
    return Tool(render_viz, takes_ctx=False)


def _make_load_skill_tool(tool_overflow: ToolMiddlewareContext | None) -> Tool[Any]:
    async def load_skill_tool(name: str) -> Any:
        """Load one admissions workflow skill by name.

        Use this before specialized work like dossier assembly, school
        comparison, essay brainstorming, or activity framing. The skill body is
        returned only when requested, so the agent can keep context focused.

        Args:
            name: The skill name from the system prompt's available-skill list.
        """
        return process_tool_result(load_skill(name), tool_overflow, tool_name="load_skill")

    load_skill_tool.__name__ = "load_skill"
    return Tool(load_skill_tool, takes_ctx=False)


def _make_read_tool_result_tool(store: ToolResultStore) -> Tool[Any]:
    async def read_tool_result(handle: str) -> Any:
        """Read back a full oversized tool result spilled earlier in this run.

        Use this only when an overflow summary says the complete payload is
        needed. Pass the exact handle from the overflow result.

        Args:
            handle: The spilled tool-result handle.
        """
        return store.read(handle)

    return Tool(read_tool_result, takes_ctx=False)


class _FinalContentPlacementWriter:
    def __init__(
        self,
        staged_specs: list[dict[str, Any]],
        writer: Callable[[dict[str, Any]], None],
    ) -> None:
        self._staged_specs = staged_specs
        self._writer = writer
        self._final_started = False
        self._buffering = False
        self._flushed = False
        self._text_chunks: list[str] = []
        self._stripper = StreamingVizMarkerStripper()

    def start_final(self) -> None:
        if self._final_started or self._flushed:
            return
        self._final_started = True
        self._buffering = bool(self._staged_specs)

    def write(self, chunk: dict[str, Any]) -> None:
        if self._buffering and not self._flushed:
            kind = chunk.get("type")
            if kind == "delta":
                if (text := chunk.get("text")) is not None:
                    self._text_chunks.append(text)
                return
            self.flush_final()
        elif self._final_started and chunk.get("type") == "delta":
            stripped = self._stripper.feed(str(chunk.get("text") or ""))
            if stripped:
                self._writer({"type": "delta", "text": stripped})
            return
        self._writer(chunk)

    def flush_final(self) -> None:
        if self._flushed:
            if self._final_started and (stripped := self._stripper.flush()):
                self._writer({"type": "delta", "text": stripped})
            return
        if not self._final_started:
            return
        self._buffering = False
        self._flushed = True
        if not self._staged_specs:
            if stripped := self._stripper.flush():
                self._writer({"type": "delta", "text": stripped})
            return
        final_text = "".join(self._text_chunks)
        self._text_chunks = []
        for kind, payload in chunks_from_viz_markers(final_text, self._staged_specs):
            if kind == "delta":
                self._writer({"type": "delta", "text": payload})
            elif kind == "viz":
                self._writer({"type": "viz", "spec": payload})


def _make_recording_writer(
    writer: Any, emissions: list[Emission]
) -> Callable[[dict[str, Any]], None]:
    """Wrap the LangGraph custom-stream writer so the node keeps the full
    ordered emission stream — the turn record (B1b) is built from exactly
    what streamed, so the record can never drift from what the student saw."""

    def recording(chunk: dict[str, Any]) -> None:
        # .get + skip-if-absent: a malformed chunk must not KeyError mid-stream
        # (the live writer still sees it — recording is observation only).
        kind = chunk.get("type")
        if kind == "delta":
            if (text := chunk.get("text")) is not None:
                emissions.append(("delta", text))
        elif kind == "viz":
            if (spec := chunk.get("spec")) is not None:
                emissions.append(("viz", spec))
        elif kind == "step":
            if (data := chunk.get("data")) is not None:
                emissions.append(("step", data))
        elif kind == "thinking" and (text := chunk.get("text")) is not None:
            emissions.append(("thinking", text))
        elif kind == "narration" and (text := chunk.get("text")) is not None:
            emissions.append(("narration", text))
        writer(chunk)

    return recording


def _turn_ids(state: Any) -> dict[str, Any]:
    """The turn's G1 identity from state, minting fallbacks for direct graph
    invocations that bypass ``run_turn`` (tests, pre-B1b checkpoints)."""
    ids = dict(state.get("turn_ids") or {})
    ids.setdefault("message_id", str(uuid4()))
    ids.setdefault("user_message_id", str(uuid4()))
    return ids


def _resume_clarify(
    prior_records: list[dict[str, Any]], ids: dict[str, Any]
) -> tuple[dict[str, Any] | None, bool]:
    """``(clarify, synthesized_answer)`` for the record being built.

    A resume replaces the parked record (same ``message_id``, G4): the new
    record carries the parked spec plus the answer (the resume text rides
    ``turn_ids`` because ``Command(resume)`` never enters ``messages`` —
    that is WHY story 25 needs this), and flags the transcript read to
    synthesize the student's answer bubble.
    """
    resume_text = ids.get("resume_text")
    if resume_text is None or not prior_records:
        return None, False
    parked = prior_records[-1]
    # str() both sides: a legacy/non-string stored id must still match.
    if parked.get("status") != "awaiting_input" or str(parked.get("message_id")) != str(
        ids["message_id"]
    ):
        return None, False
    spec = (parked.get("clarify") or {}).get("spec")
    if spec is None:
        return None, False  # pre-B1b parked thread: no spec to carry
    return {"spec": spec, "answer": resume_text}, True


async def run_agent_node(state: Any, deps: GraphDeps) -> dict[str, Any]:
    """One agent turn: rebuild from state, run the agent, return the delta."""
    settings = getattr(deps, "settings", None) or get_settings()
    emissions: list[Emission] = []
    recording_writer = _make_recording_writer(get_stream_writer(), emissions)

    # --- rebuild per-turn objects from state (replay-safe, module docstring) ---
    registry = SourceRegistry(state.get("source_registry") or [])
    source_config = SourceConfig.model_validate(state["source_config"])
    history, user_text = _split_user_message(state["messages"])
    viz_list: list[dict[str, Any]] = []
    viz_signature_indexes: dict[str, int] = {}
    final_writer = _FinalContentPlacementWriter(viz_list, recording_writer)
    writer = final_writer.write
    today = date.fromisoformat(state["temporal"]["today"])
    overflow_store = ToolResultStore(state.get("tool_result_store") or {})
    tool_overflow = ToolMiddlewareContext(
        registry=registry,
        overflow_store=overflow_store,
        max_result_chars=settings.agent_tool_result_max_chars,
    )

    # --- assemble the toolset (ADR 0013: disabled sources never constructed) ---
    tool_deps = getattr(deps, "tool_deps", None) or make_tool_deps(settings, deps.catalog)
    extra_tools: list[Tool[Any]] = [
        Tool(make_write_plan_tool(), takes_ctx=False),
        _make_render_viz_tool(
            deps.catalog, registry, viz_list, viz_signature_indexes, tool_overflow
        ),
        _make_read_tool_result_tool(overflow_store),
        _make_load_skill_tool(tool_overflow),
    ]
    tools = build_tools(
        source_config,
        tool_deps,
        registry,
        today,
        extra_tools=extra_tools,
        tool_overflow=tool_overflow,
    )
    mcp_toolset = getattr(deps, "mcp_toolset", None)

    model_factory = getattr(deps, "model_factory", None) or (
        lambda: default_model_factory(settings)
    )
    model_settings = None
    if getattr(settings, "thinking_summaries", False):
        # Native Gemini thought summaries → `thinking` events (B0 spike 2).
        # A non-Google model simply ignores the google_* key.
        from pydantic_ai.models.google import GoogleModelSettings

        model_settings = GoogleModelSettings(google_thinking_config={"include_thoughts": True})
    agent: Agent[TurnDeps, str] = Agent(
        model_factory(),
        instructions=build_system_prompt(
            state["temporal"]["context"],
            deps.catalog.school_count,
        ),
        deps_type=TurnDeps,
        tools=tools,
        toolsets=[mcp_toolset] if mcp_toolset is not None else None,
        model_settings=model_settings,
    )
    limits = UsageLimits(
        request_limit=settings.agent_max_model_requests,
        total_tokens_limit=settings.agent_max_total_tokens,
    )

    # --- the emission router (steps/thinking/delta — ARCHITECTURE §27.1–27.2) ---
    resolve_name = getattr(deps.catalog, "school_name", None) or (lambda unitid: None)
    resolve_domain = getattr(deps.catalog, "school_domain", None) or (lambda unitid: None)
    router = EmissionRouter(
        writer=writer,
        mapper=StepMapper(load_yaml_asset("step_labels"), resolve_name, resolve_domain),
        threshold=settings.thinking_threshold_chars,  # CFG-07: Settings-sourced
        unmounted=GATEABLE_TOOLS - {tool.name for tool in tools},
        on_final_start=final_writer.start_final,
    )

    # --- the run; only UsageLimitExceeded is handled locally. GraphInterrupt
    #     still flies for legacy/lower-level callers, after open steps close. ---
    messages_out = state["messages"]
    usage = UsageData(input_tokens=0, output_tokens=0, tool_calls=0)
    result = None
    try:
        # `async with agent` enters the MCP toolset for the run (notes §2 lifecycle).
        async with (
            agent,
            agent.run_stream_events(
                user_text,
                message_history=history or None,
                deps=TurnDeps(registry=registry, tool_overflow=tool_overflow),
                usage_limits=limits,
            ) as stream,
        ):
            async for event in stream:
                router.handle(event)
                if isinstance(event, AgentRunResultEvent):
                    result = event.result
    except UsageLimitExceeded:
        _close_router_and_flush_final_safely(router, final_writer, "budget")
        writer({"type": "delta", "text": _TOOL_BUDGET_MESSAGE})
    except GraphInterrupt:
        _close_router_and_flush_final_safely(router, final_writer, "interrupt")
        raise
    except Exception:
        _close_router_and_flush_final_safely(router, final_writer, "error")
        raise
    else:
        # Deliberately NOT guarded: a close() failure on the happy path is a
        # real turn failure (the final flush/steps never reached the student).
        router.close("complete")
        final_writer.flush_final()

    if result is not None:
        messages_out = ModelMessagesTypeAdapter.dump_python(result.all_messages(), mode="json")
        run_usage = result.usage  # property in 1.107 (notes §4)
        usage = UsageData(
            input_tokens=run_usage.input_tokens or 0,
            output_tokens=run_usage.output_tokens or 0,
            tool_calls=run_usage.tool_calls or 0,
        )
    else:
        # Tool-budget path: result never materialized — preserve the streamed
        # prose (the budget delta above included) as a partial ModelResponse
        # (the empty-partial rule, owned by turn_persistence — audit H1).
        messages_out, _ = partial_messages(state["messages"], emissions)

    # --- the turn record (B1b, G1/G2): built from exactly what streamed ---
    ids = _turn_ids(state)
    prior_records = list(state.get("turn_records") or [])
    clarify, synthesized = _resume_clarify(prior_records, ids)
    # messages_offset: run_turn computes the authoritative value per path (new
    # turn vs resume) and threads it through turn_ids — the node never
    # recomputes it. resolve_offset's fallback covers direct-graph invocations
    # only (tests, pre-B1b checkpoints), where the tail is the user request.
    offset = resolve_offset(ids.get("messages_offset"), state["messages"])
    record_user_text = (
        str(prior_records[-1].get("user_text") or user_text)
        if synthesized and prior_records
        else user_text
    )
    # user_text is the turn's QUESTION even on a synthesized legacy clarify
    # continuation. Agent V1 may feed a compatibility prompt to the model, but
    # the persisted record stays self-contained around the original question so
    # the read can render it id-less next to the synthesized answer bubble.
    record = build_turn_record(
        emissions,
        ids=ids,
        status="complete",
        sources=registry.dump(),
        user_text=record_user_text,
        usage=usage.model_dump(mode="json"),
        clarify=clarify,
        ts=now_iso(),
        messages_offset=offset,
        synthesized_answer=synthesized,
    )

    emitted_viz = [payload for kind, payload in emissions if kind == "viz"]
    return {
        "messages": messages_out,
        "source_registry": registry.dump(),
        "viz_emitted": emitted_viz,
        "usage": usage.model_dump(mode="json"),
        "tool_result_store": overflow_store.dump(),
        "pending_clarify": None,
        "turn_records": append_or_replace(prior_records, record),
    }
