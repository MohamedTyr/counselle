"""The agent node — one PydanticAI run with the tool loop (Phase 4 Slice F).

Design (notes-p4-apis §1/§3/§4/§6/§7):

- **Per-turn objects rebuild from state** at the top of every execution: the
  source registry from ``state["source_registry"]``, the source config, the
  message history. On an ``interrupt()`` resume LangGraph RE-EXECUTES this node
  from the start — the whole PydanticAI run replays (model re-billed, pre-clarify
  tools re-run). That is the documented LangGraph pattern; it is correct here
  precisely because nothing per-turn lives outside state + locals.
- **User message convention:** the runner (``app/run_turn.py``) appends the new
  user message — a serialized ``ModelRequest`` with one ``UserPromptPart`` — to
  ``state["messages"]`` before invoking the graph. This node splits it back out:
  ``messages[:-1]`` is the ``message_history``, the tail's prompt text is the
  ``user_prompt``. One state key, one convention, replay-safe (the tail is still
  there on re-execution).
- **Clarify:** ``ask_student`` calls ``langgraph.types.interrupt()``. It is
  mounted through a thin **async** wrapper so pydantic-ai runs it in the node's
  own task (a sync tool would go to a worker thread) — the config ContextVar
  stays visible and the raised ``GraphInterrupt`` propagates straight out of the
  run. Nothing here catches broad exceptions around the run; only
  ``UsageLimitExceeded`` is caught (the tool-budget bound, notes §6). If the
  model ever issued parallel tool calls each containing an interrupt, resume
  matching could misorder — accepted MVP1 risk; the prompt enforces one clarify
  round per turn.
- **Streaming:** text reaches the client mid-run via the LangGraph custom
  stream (``get_stream_writer()``, notes §7). The first chunk of a text part
  arrives inside ``PartStartEvent`` (not as a delta) — both are forwarded.
  ``render_viz`` writes a ``viz`` chunk the moment the spec is built.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date
from typing import TYPE_CHECKING, Any

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
from app.clarify import ask_student
from app.prompt import build_system_prompt
from app.skills import make_load_skill_tool
from app.sources import SourceRegistry
from app.steps import CloseReason, EmissionRouter, StepMapper
from app.toolset import GATEABLE_TOOLS, build_tools, make_tool_deps
from config.settings import get_settings, load_yaml_asset
from domain.events import UsageData
from domain.specs import SourceConfig

if TYPE_CHECKING:
    from app.graph import GraphDeps  # circular at runtime: graph imports run_agent_node

logger = logging.getLogger(__name__)


def _close_router_safely(router: EmissionRouter, reason: CloseReason) -> None:
    """Best-effort router closure inside an except block.

    A ``close()`` failure here must never mask the original exception — on the
    GraphInterrupt path the re-raise is honesty-critical (the clarify must
    park the turn), so closing the timeline is strictly best-effort.
    """
    try:
        router.close(reason)
    except Exception:
        logger.warning("router.close(%r) raised — continuing", reason, exc_info=True)

#: The clean cut-off message when the run hits settings.max_tool_rounds (notes §6).
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
    writer: Any,
) -> Tool[Any]:
    """The per-turn render_viz wrapper: closes over (catalog, registry, viz_list)
    and streams the spec as a ``viz`` custom chunk the moment it is appended."""

    async def render_viz(
        type: viz_mod.VizType,
        unitids: list[int],
        field_keys: list[str] | None = None,
        test: viz_mod.TestName | None = None,
        title: str | None = None,
    ) -> dict[str, Any]:
        result = await viz_mod.render_viz(
            catalog, registry, viz_list, type, unitids, field_keys, test, title
        )
        if result.get("ok"):
            writer({"type": "viz", "spec": viz_list[-1]})
        return result

    render_viz.__doc__ = viz_mod.render_viz.__doc__  # the LLM-facing contract, verbatim
    return Tool(render_viz, takes_ctx=False)


def _make_ask_student_tool() -> Tool[Any]:
    """``ask_student`` behind an async shim so it runs in the node's own task.

    pydantic-ai executes *sync* tools in a worker thread; ``interrupt()`` must
    run where LangGraph's config ContextVar lives and its ``GraphInterrupt``
    must unwind the node's task — so the shim is async and calls the sync
    implementation inline (it never blocks: ``interrupt()`` raises).
    """

    async def ask_student_async(
        question: str,
        header: str,
        options: list[dict[str, Any]] | None = None,
        multi_select: bool = False,
    ) -> str:
        return ask_student(question, header, options, multi_select)

    ask_student_async.__doc__ = ask_student.__doc__
    ask_student_async.__name__ = "ask_student"
    return Tool(ask_student_async, takes_ctx=False)


async def run_agent_node(state: Any, deps: GraphDeps) -> dict[str, Any]:
    """One counselor turn: rebuild from state, run the agent, return the delta."""
    settings = getattr(deps, "settings", None) or get_settings()
    writer = get_stream_writer()

    # --- rebuild per-turn objects from state (replay-safe, module docstring) ---
    registry = SourceRegistry(state.get("source_registry") or [])
    source_config = SourceConfig.model_validate(state["source_config"])
    history, user_text = _split_user_message(state["messages"])
    viz_list: list[dict[str, Any]] = []
    today = date.fromisoformat(state["temporal"]["today"])

    # --- assemble the toolset (ADR 0013: disabled sources never constructed) ---
    tool_deps = getattr(deps, "tool_deps", None) or make_tool_deps(settings, deps.catalog)
    extra_tools: list[Tool[Any]] = [
        _make_render_viz_tool(deps.catalog, registry, viz_list, writer),
        _make_ask_student_tool(),
        Tool(make_load_skill_tool(), takes_ctx=False),
    ]
    tools = build_tools(source_config, tool_deps, registry, today, extra_tools=extra_tools)
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
        instructions=build_system_prompt(state["temporal"]["context"]),
        deps_type=TurnDeps,
        tools=tools,
        toolsets=[mcp_toolset] if mcp_toolset is not None else None,
        model_settings=model_settings,
    )
    limits = UsageLimits(request_limit=settings.max_tool_rounds)  # notes §6

    # --- the emission router (steps/thinking/delta — ARCHITECTURE §27.1–27.2) ---
    resolve_name = getattr(deps.catalog, "school_name", None) or (lambda unitid: None)
    router = EmissionRouter(
        writer=writer,
        mapper=StepMapper(load_yaml_asset("step_labels"), resolve_name),
        unmounted=GATEABLE_TOOLS - {tool.name for tool in tools},
    )

    # --- the run; only UsageLimitExceeded is caught (GraphInterrupt MUST fly,
    #     but the router closes open steps first so nothing shimmers forever) ---
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
                deps=TurnDeps(registry=registry),
                usage_limits=limits,
            ) as stream,
        ):
            async for event in stream:
                router.handle(event)
                if isinstance(event, AgentRunResultEvent):
                    result = event.result
    except UsageLimitExceeded:
        _close_router_safely(router, "budget")
        writer({"type": "delta", "text": _TOOL_BUDGET_MESSAGE})
    except GraphInterrupt:
        _close_router_safely(router, "interrupt")
        raise
    except Exception:
        _close_router_safely(router, "error")
        raise
    else:
        # Deliberately NOT guarded: a close() failure on the happy path is a
        # real turn failure (the final flush/steps never reached the student).
        router.close("complete")

    if result is not None:
        messages_out = ModelMessagesTypeAdapter.dump_python(result.all_messages(), mode="json")
        run_usage = result.usage  # property in 1.107 (notes §4)
        usage = UsageData(
            input_tokens=run_usage.input_tokens or 0,
            output_tokens=run_usage.output_tokens or 0,
            tool_calls=run_usage.tool_calls or 0,
        )

    return {
        "messages": messages_out,
        "source_registry": registry.dump(),
        "viz_emitted": viz_list,
        "usage": usage.model_dump(mode="json"),
        "pending_clarify": None,
    }
