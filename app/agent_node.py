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
- **Clarify (v2):** the normal run advertises ``ask_student`` as a PydanticAI
  structured OUTPUT tool (``ToolOutput(ClarifyDraftV2, name="ask_student")``,
  ``app/clarification.py``) — not a mounted function tool and not the legacy
  ``langgraph.types.interrupt()`` path. ``end_strategy="early"`` means a
  sibling function-tool call in the same model response is skipped, never
  raced with the clarification output (plans/clarifying-questions.md,
  architecture decision §1). A ``ClarifyDraftV2`` result ends the turn
  ``awaiting_input`` with no final-answer delta instead of ``complete``. The
  legacy interrupt plumbing still exists below this node purely for parked/
  resumed v1 checkpoint compatibility — ``GraphInterrupt`` is still allowed to
  propagate if that lower-level path raises it.
- **Streaming:** text reaches the client mid-run via the LangGraph custom
  stream (``get_stream_writer()``, notes §7). The first chunk of a text part
  arrives inside ``PartStartEvent`` (not as a delta) — both are forwarded.
  ``render_viz`` stages specs locally; staged cards flush once when final
  answer prose starts.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import TYPE_CHECKING, Any, cast
from uuid import UUID, uuid4

from langgraph.config import get_stream_writer
from langgraph.errors import GraphInterrupt
from pydantic_ai import Agent, Tool
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import (
    ModelMessage,
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)
from pydantic_ai.models import Model
from pydantic_ai.usage import UsageLimits
from pydantic_graph import End

from app import viz as viz_mod
from app.clarification import ask_student_output_type, build_pending_clarification
from app.evidence_markers import EvidenceMarkerStripper, scrub_evidence_tokens
from app.model_selection import counselor_model_selection
from app.plan_tool import PlanReminder, PlanState, make_write_plan_tool
from app.prompt import build_system_prompt, render_source_availability
from app.pydantic_iter_nodes import CallToolsNode, ModelRequestNode
from app.records import Emission, append_or_replace, build_turn_record, now_iso
from app.skills import (
    SelectedSkillValidationError,
    make_load_skill_tool,
    render_selected_skills,
    validate_selected_skills,
)
from app.sources import SourceRegistry
from app.steps import CloseReason, EmissionRouter, StepMapper
from app.student_context import STUDENT_CONTEXT_UNAUTHENTICATED
from app.tool_middleware import ToolMiddlewareContext, process_tool_result
from app.tool_overflow import ToolResultStore
from app.toolset import GATEABLE_TOOLS, build_tools, make_tool_deps
from app.turn_persistence import partial_messages, resolve_offset
from app.viz_placement import StreamingVizMarkerStripper
from app.workspace.agent_tools import build_workspace_tools
from config.settings import get_settings, load_yaml_asset
from domain.clarification import ClarifyDraftV2
from domain.events import UsageData
from domain.response_mode import ResponseMode
from domain.specs import ColumnInput, SourceConfig, VizRowInput

if TYPE_CHECKING:
    from app.graph import GraphDeps  # circular at runtime: graph imports run_agent_node
    from app.run_handle import RunHandle, SteeringMessage

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


def _empty_resolve_completion(emissions: list[Emission]) -> str | None:
    """Return a safe terminal answer when resolution succeeded but prose did not."""
    if any(kind == "delta" and str(payload).strip() for kind, payload in emissions):
        return None
    for kind, payload in reversed(emissions):
        if kind != "step" or not isinstance(payload, dict) or payload.get("status") != "end":
            continue
        detail = payload.get("detail")
        if not isinstance(detail, dict) or detail.get("tool") != "resolve_school":
            continue
        schools = detail.get("schools")
        if detail.get("result_count") == 1:
            subject = (
                str(schools[0]) if isinstance(schools, list) and schools else "the requested school"
            )
            return (
                f"I identified {subject}, but I couldn't verify enough information to "
                "complete the answer. Any missing value is unavailable, not zero, and I "
                "won't invent it."
            )
    return None


def _replace_empty_final_response(
    messages: list[dict[str, Any]], fallback: str
) -> list[dict[str, Any]]:
    """Keep provider history aligned with the code-owned streamed fallback."""
    replacement = ModelMessagesTypeAdapter.dump_python(
        [ModelResponse(parts=[TextPart(content=fallback)])], mode="json"
    )[0]
    if messages and messages[-1].get("kind") == "response":
        return [*messages[:-1], {**messages[-1], "parts": replacement["parts"]}]
    return [*messages, replacement]


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


def default_model_factory(settings: Any, model_setting: str) -> Model:
    """The real Gemini on Vertex Express Mode (notes §1 — the ONLY working auth path).

    ``model_setting`` is the already-resolved per-turn setting (Quick's
    ``settings.model_counselor`` or Think's ``settings.model_counselor_think`` —
    plans/quick-think-response-mode.md §3.2/§5.2); this factory never re-reads a
    global default itself.
    """
    from pydantic_ai.models.google import GoogleModel
    from pydantic_ai.providers.google_cloud import GoogleCloudProvider

    if not settings.vertex_api_key:
        raise RuntimeError(
            "COUNSELLE_VERTEX_API_KEY is not set — the counselor model cannot "
            "authenticate (Vertex Express Mode key required)."
        )
    return GoogleModel(
        model_name_from_setting(model_setting),
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
        type: str,
        columns: list[ColumnInput],
        rows: list[VizRowInput],
        title: str | None = None,
    ) -> dict[str, Any]:
        result = await viz_mod.render_viz(
            catalog,
            registry,
            viz_list,
            type,
            columns,
            rows,
            title,
            viz_signature_indexes,
        )
        return process_tool_result(result, tool_overflow, tool_name="render_viz")  # type: ignore[no-any-return]

    render_viz.__doc__ = viz_mod.render_viz.__doc__  # the LLM-facing contract, verbatim
    return Tool(render_viz, takes_ctx=False)


def _make_load_skill_tool(tool_overflow: ToolMiddlewareContext | None) -> Tool[Any]:
    """Mount the single validated ``load_skill`` menu (``app.skills``) as a Tool.

    The docstring/menu is built once from the live on-disk registry in
    ``app.skills.make_load_skill_tool`` — there is exactly one place that
    enumerates skill names, never a second handwritten menu here. This wrapper
    only adds the per-turn overflow middleware.
    """
    base_load_skill_tool = make_load_skill_tool()

    async def load_skill_tool(name: str) -> Any:
        return process_tool_result(
            await base_load_skill_tool(name), tool_overflow, tool_name="load_skill"
        )

    load_skill_tool.__doc__ = base_load_skill_tool.__doc__
    load_skill_tool.__name__ = "load_skill"
    return Tool(load_skill_tool, takes_ctx=False)


def _make_read_tool_result_tool(store: ToolResultStore, registry: SourceRegistry) -> Tool[Any]:
    async def read_tool_result(handle: str) -> Any:
        """Read back a full oversized tool result spilled earlier in this run.

        Use this only when an overflow summary says the complete payload is
        needed. Pass the exact handle from the overflow result.

        Args:
            handle: The spilled tool-result handle.
        """
        return registry.restore_pending_evidence_tokens(store.read(handle))

    return Tool(read_tool_result, takes_ctx=False)


_VIZ_MARKER_START = "[[viz:"


class _StreamingVizMarkerPlacer:
    def __init__(
        self,
        staged_specs: list[dict[str, Any]],
        writer: Callable[[dict[str, Any]], None],
    ) -> None:
        self._staged_specs = staged_specs
        self._writer = writer
        self._pending = ""
        self._emitted_indexes: set[int] = set()

    def feed(self, text: str) -> None:
        if not text:
            return
        self._pending += text
        self._drain_pending(final=False)

    def flush(self, *, emit_fallback: bool) -> None:
        self._drain_pending(final=True)
        if not emit_fallback:
            return
        for index, spec in enumerate(self._staged_specs):
            if index not in self._emitted_indexes:
                self._writer({"type": "viz", "spec": spec})
                self._emitted_indexes.add(index)

    def _drain_pending(self, *, final: bool) -> None:
        while self._pending:
            marker_start = self._pending.find(_VIZ_MARKER_START)
            if marker_start == -1:
                self._emit_non_marker_tail(final=final)
                return
            if marker_start > 0:
                self._emit_delta(self._pending[:marker_start])
                self._pending = self._pending[marker_start:]
                continue

            marker_body_start = len(_VIZ_MARKER_START)
            marker_end = self._pending.find("]]", marker_body_start)
            if marker_end == -1:
                whitespace_index = _first_whitespace_index(self._pending[marker_body_start:])
                if whitespace_index is None:
                    if final:
                        self._pending = ""
                    return
                self._pending = self._pending[marker_body_start + whitespace_index :]
                continue

            marker_value = self._pending[marker_body_start:marker_end]
            if marker_value.isdigit():
                index = int(marker_value) - 1
                if 0 <= index < len(self._staged_specs) and index not in self._emitted_indexes:
                    self._writer({"type": "viz", "spec": self._staged_specs[index]})
                    self._emitted_indexes.add(index)
            cursor = marker_end + 2
            while cursor < len(self._pending) and self._pending[cursor] == "]":
                cursor += 1
            self._pending = self._pending[cursor:]

    def _emit_non_marker_tail(self, *, final: bool) -> None:
        keep_len = 0 if final else _trailing_viz_marker_prefix_len(self._pending)
        emit_text = self._pending if keep_len == 0 else self._pending[:-keep_len]
        self._pending = "" if keep_len == 0 else self._pending[-keep_len:]
        if emit_text:
            self._emit_delta(emit_text)

    def _emit_delta(self, text: str) -> None:
        if text:
            self._writer({"type": "delta", "text": text})


def _first_whitespace_index(text: str) -> int | None:
    return next((index for index, char in enumerate(text) if char.isspace()), None)


def _trailing_viz_marker_prefix_len(text: str) -> int:
    return next(
        (
            length
            for length in range(min(len(text), len(_VIZ_MARKER_START) - 1), 0, -1)
            if text.endswith(_VIZ_MARKER_START[:length])
        ),
        0,
    )


class _FinalContentPlacementWriter:
    def __init__(
        self,
        staged_specs: list[dict[str, Any]],
        writer: Callable[[dict[str, Any]], None],
        registry: SourceRegistry | None = None,
    ) -> None:
        self._staged_specs = staged_specs
        self._writer = writer
        # The evidence stripper removes the hidden ``[[evidence:n:eid]]`` tokens
        # from the visible stream and, on a valid token, promotes that exact CDS
        # row into the sources rail. This is provenance display only — it never
        # inspects or withholds the agent's prose. Accuracy is the agent's job,
        # enforced solely by the inline ``[n]`` citations it writes.
        self._evidence = EvidenceMarkerStripper(
            registry.promote_pending_evidence if registry else lambda _index, _eid: False
        )
        self._final_started = False
        self._flushed = False
        self._placer = _StreamingVizMarkerPlacer(staged_specs, writer)
        self._stripper = StreamingVizMarkerStripper()

    def start_final(self) -> None:
        if self._final_started or self._flushed:
            return
        self._final_started = True

    def write(self, chunk: dict[str, Any]) -> None:
        if chunk.get("type") == "delta":
            clean = self._evidence.feed(str(chunk.get("text") or ""))
            if self._final_started:
                self._write_final_text(clean)
                return
            if not clean:
                return
            chunk = {"type": "delta", "text": clean}
        if self._final_started and not self._flushed and self._staged_specs:
            self.flush_final()
        self._writer(chunk)

    def flush_final(self) -> None:
        if not self._final_started:
            return
        if clean := self._evidence.flush():
            self._write_final_text(clean)
        self._finish_output()

    def _finish_output(self) -> None:
        if not self._flushed:
            self._flushed = True
            if self._staged_specs:
                self._placer.flush(emit_fallback=True)
        if stripped := self._stripper.flush():
            self._writer({"type": "delta", "text": stripped})

    def _write_final_text(self, text: str) -> None:
        if not text:
            return
        if self._staged_specs and not self._flushed:
            self._placer.feed(text)
            return
        if stripped := self._stripper.feed(text):
            self._writer({"type": "delta", "text": stripped})


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
        elif kind == "user_message" and isinstance(chunk.get("data"), dict):
            data = dict(chunk["data"])
            if data.get("text") and data.get("user_message_id"):
                emissions.append(
                    (
                        "user",
                        {
                            "text": str(data["text"]),
                            "user_message_id": str(data["user_message_id"]),
                            "injected": bool(data.get("injected")),
                        },
                    )
                )
        writer(chunk)

    return recording


def _turn_ids(state: Any) -> dict[str, Any]:
    """The turn's G1 identity from state, minting fallbacks for direct graph
    invocations that bypass ``run_turn`` (tests, pre-B1b checkpoints)."""
    ids = dict(state.get("turn_ids") or {})
    ids.setdefault("message_id", str(uuid4()))
    ids.setdefault("user_message_id", str(uuid4()))
    raw_selected_skills = ids.get("selected_skills", [])
    if not isinstance(raw_selected_skills, list):
        raise SelectedSkillValidationError("selected skills in checkpoint are malformed")
    # Checkpoint state is untrusted at this boundary: only the immutable public
    # registry may turn a name into prompt instructions. An invalid restored
    # value raises safely through run_turn's ordinary error path.
    ids["selected_skills"] = validate_selected_skills(raw_selected_skills)
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


def _tool_call_id(part: dict[str, Any]) -> str | None:
    raw = part.get("tool_call_id") or part.get("id")
    return str(raw) if raw else None


def is_provider_replayable(messages: list[dict[str, Any]]) -> bool:
    """Conservative serialized-history check for tool-call pairing.

    A snapshot with a tool call but no later tool return is not replay-safe.
    Unknown or id-less tool-call shapes are treated as unsafe.
    """
    waiting: set[str] = set()
    for message in messages:
        parts = message.get("parts")
        if not isinstance(parts, list):
            return False
        for part in parts:
            if not isinstance(part, dict):
                return False
            kind = part.get("part_kind")
            if kind == "tool-call":
                tool_call_id = _tool_call_id(part)
                if tool_call_id is None:
                    return False
                waiting.add(tool_call_id)
            elif kind in {"tool-return", "function-tool-result", "retry-prompt"}:
                tool_call_id = _tool_call_id(part)
                if tool_call_id is None or tool_call_id not in waiting:
                    return False
                waiting.remove(tool_call_id)
    return not waiting


def record_replayable_snapshot(
    run: Any,
    handle: RunHandle | None,
    *,
    emissions_len: int,
) -> None:
    if handle is None:
        return
    try:
        messages = scrub_evidence_tokens(
            ModelMessagesTypeAdapter.dump_python(run.all_messages(), mode="json")
        )
    except Exception:
        logger.warning("failed to serialize active run messages snapshot", exc_info=True)
        return
    if not isinstance(messages, list) or not all(isinstance(item, dict) for item in messages):
        return
    if not is_provider_replayable(messages):
        return
    handle.record_snapshot(messages, emissions_len=emissions_len)


def _steering_payload(message: SteeringMessage, *, injected: bool) -> dict[str, Any]:
    return {
        "text": message.text,
        "user_message_id": message.user_message_id,
        "injected": injected,
    }


def _emit_injected_steers(
    run: Any,
    handle: RunHandle | None,
    writer: Callable[[dict[str, Any]], None],
) -> None:
    if handle is None:
        return
    for message in handle.drain_steers():
        run.enqueue(message.text, priority="asap")
        writer({"type": "user_message", "data": _steering_payload(message, injected=True)})


def _record_uninjected_steers(
    handle: RunHandle | None,
    emissions: list[Emission],
) -> None:
    if handle is None:
        return
    for message in handle.drain_steers():
        payload = _steering_payload(message, injected=False)
        handle.queued_at_terminal.append(message)
        emissions.append(("user", payload))


def _response_mode_from_ids(ids: dict[str, Any]) -> ResponseMode:
    """The turn's response mode from ``turn_ids`` — Quick for any absent/
    malformed value (a pre-feature checkpoint or a direct-graph test call)."""
    raw = ids.get("response_mode")
    if raw is None:
        return ResponseMode.QUICK
    try:
        return ResponseMode(raw)
    except ValueError:
        logger.warning("unknown response_mode %r in turn_ids — defaulting to quick", raw)
        return ResponseMode.QUICK


async def run_agent_node(state: Any, deps: GraphDeps) -> dict[str, Any]:
    """One agent turn: rebuild from state, run the agent, return the delta."""
    settings = getattr(deps, "settings", None) or get_settings()
    emissions: list[Emission] = []
    recording_writer = _make_recording_writer(get_stream_writer(), emissions)

    # --- rebuild per-turn objects from state (replay-safe, module docstring) ---
    ids = _turn_ids(state)
    parked_session_id = str(ids.get("session_id") or "")
    message_id = str(ids["message_id"])
    parked_user_id = str(ids["user_id"]) if ids.get("user_id") is not None else None
    parked_store = getattr(deps, "parked_sources", None)
    restored_registry = (
        parked_store.restore(parked_session_id, message_id, parked_user_id)
        if parked_store is not None and ids.get("resume_text") is not None
        else None
    )
    if parked_store is not None and ids.get("resume_text") is None:
        parked_store.clear_session(parked_session_id)
    registry = restored_registry or SourceRegistry(state.get("source_registry") or [])
    source_config = SourceConfig.model_validate(state["source_config"])
    history, user_text = _split_user_message(state["messages"])
    viz_list: list[dict[str, Any]] = []
    viz_signature_indexes: dict[str, int] = {}
    final_writer = _FinalContentPlacementWriter(viz_list, recording_writer, registry)
    writer = final_writer.write
    today = date.fromisoformat(state["temporal"]["today"])
    overflow_store = ToolResultStore(state.get("tool_result_store") or {})
    tool_overflow = ToolMiddlewareContext(
        registry=registry,
        overflow_store=overflow_store,
        max_result_chars=settings.agent_tool_result_max_chars,
    )
    # Hoisted ahead of the toolset block (was read further down, after tools
    # were already built) so a future mount gate can read
    # `ids.get("user_id")` before deciding which tools to construct (ADR
    # 0013: unmounted, not hidden — gating after construction is too late).
    # ``ids`` was validated above because it also keys runtime-only parked evidence.

    # --- assemble the toolset (ADR 0013: disabled sources never constructed) ---
    tool_deps = getattr(deps, "tool_deps", None) or make_tool_deps(settings, deps.catalog)
    plan_state = PlanState()
    extra_tools: list[Tool[Any]] = [
        Tool(make_write_plan_tool(plan_state), takes_ctx=False),
        _make_render_viz_tool(
            deps.catalog, registry, viz_list, viz_signature_indexes, tool_overflow
        ),
        _make_read_tool_result_tool(overflow_store, registry),
        _make_load_skill_tool(tool_overflow),
    ]
    # Workspace tools (ADR 0013: unmounted, not hidden) — only exist this turn
    # when the turn carries an authenticated user AND the app pool + workspace
    # event bus are wired in (eval runner / CLI pass no user_id → unmounted).
    workspace_events = getattr(deps, "workspace_events", None)
    user_id = ids.get("user_id")
    if user_id and deps.app_pool and workspace_events:
        extra_tools.extend(
            build_workspace_tools(
                deps.app_pool,
                deps.catalog,
                workspace_events,
                UUID(user_id),
                tool_overflow,
            )
        )
    tools = build_tools(
        source_config,
        tool_deps,
        registry,
        today,
        extra_tools=extra_tools,
        tool_overflow=tool_overflow,
    )
    mcp_toolset = getattr(deps, "mcp_toolset", None)

    # Server-owned Quick/Think resolution (plans/quick-think-response-mode.md
    # §5.2): the node never accepts a browser model ID or trusts an old
    # checkpoint's model string — it re-resolves from the SAME pure function
    # run_turn used, off the response_mode run_turn already persisted into
    # turn_ids, so meta/turn_ids/usage/model-invoked can never diverge.
    response_mode = _response_mode_from_ids(ids)
    selection = counselor_model_selection(response_mode, settings)
    injected_model_factory = getattr(deps, "model_factory", None)
    # Native Gemini thought output → `thinking` events, requested only for
    # Think (subject to thinking_stream); non-Google models ignore the
    # google_* key. Always explicit about thinking_level — never rely on a
    # provider default that can differ by model or change over time.
    from pydantic_ai.models.google import GoogleModelSettings

    model_settings = GoogleModelSettings(
        google_thinking_config={
            # google-genai's ThinkingConfigDict types this against its own
            # ThinkingLevel enum; pydantic-ai's own internals cast a bare
            # level string the same way (models/google.py) — the plain
            # "MINIMAL"/"HIGH" string is what the wire actually accepts.
            "thinking_level": cast(Any, selection.thinking_level),
            "include_thoughts": selection.include_thoughts,
        }
    )
    base_instructions = build_system_prompt(
        state["temporal"]["context"],
        state.get("student_context") or STUDENT_CONTEXT_UNAUTHENTICATED,
        state.get("data_picture", "Live data picture unavailable in this test harness."),
    )
    source_instructions = render_source_availability(source_config)
    selected_instructions = render_selected_skills(ids["selected_skills"])
    instructions = "\n\n".join(
        part for part in (base_instructions, source_instructions, selected_instructions) if part
    )
    agent: Agent[TurnDeps, str | ClarifyDraftV2] = Agent(
        injected_model_factory()
        if injected_model_factory is not None
        else default_model_factory(settings, selection.model_setting),
        instructions=instructions,
        deps_type=TurnDeps,
        tools=tools,
        toolsets=[mcp_toolset] if mcp_toolset is not None else None,
        model_settings=model_settings,
        # A tool that fails once for a transient/schema reason gets one more chance
        # before the turn dies (pydantic_ai default is 1; see
        # plans/fix-search-fields-resilience.md Bug C).
        retries=2,
        capabilities=[PlanReminder(plan_state)],
        # Normal-run output: prose or one validated ask_student draft
        # (app/clarification.py — factored out so a future A2 continuation run
        # can pass output_type=[str] without duplicating this list).
        output_type=ask_student_output_type(),
        # Explicit (plan Phase 2 bullet 2): PydanticAI's own default is already
        # "early", but a sibling function-tool call being skipped rather than
        # executed is safety-critical here, so it must never depend on an
        # unstated library default.
        end_strategy="early",
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
    handle = None
    session_id = ids.get("session_id")
    handle_store = getattr(deps, "run_handles", None)
    if handle_store is not None and session_id is not None:
        handle = handle_store.get(str(session_id))
    result = None
    completion_fallback: str | None = None
    try:
        # `async with agent` enters the MCP toolset for the run (notes §2 lifecycle).
        async with (
            agent,
            agent.iter(
                user_text,
                message_history=history or None,
                deps=TurnDeps(registry=registry, tool_overflow=tool_overflow),
                usage_limits=limits,
            ) as run,
        ):
            node = run.next_node
            while not isinstance(node, End):
                _emit_injected_steers(run, handle, recording_writer)
                if Agent.is_model_request_node(node):
                    model_node: ModelRequestNode[Any, str | ClarifyDraftV2] = node
                    async with model_node.stream(run.ctx) as stream:
                        async for model_event in stream:
                            router.handle(model_event)
                    _emit_injected_steers(run, handle, recording_writer)
                    node = await run.next(model_node)
                    if isinstance(node, End):
                        record_replayable_snapshot(run, handle, emissions_len=len(emissions))
                elif Agent.is_call_tools_node(node):
                    tool_node: CallToolsNode[Any, str | ClarifyDraftV2] = node
                    async with tool_node.stream(run.ctx) as stream:
                        async for tool_event in stream:
                            router.handle(tool_event)
                    record_replayable_snapshot(run, handle, emissions_len=len(emissions))
                    _emit_injected_steers(run, handle, recording_writer)
                    node = await run.next(tool_node)
                    record_replayable_snapshot(run, handle, emissions_len=len(emissions))
                else:
                    _emit_injected_steers(run, handle, recording_writer)
                    node = await run.next(node)
            result = run.result
            _record_uninjected_steers(handle, emissions)
    except UsageLimitExceeded:
        _close_router_and_flush_final_safely(router, final_writer, "budget")
        writer({"type": "delta", "text": _TOOL_BUDGET_MESSAGE})
        final_writer.flush_final()
    except asyncio.CancelledError:
        _close_router_and_flush_final_safely(router, final_writer, "interrupt")
        raise
    except GraphInterrupt:
        _close_router_and_flush_final_safely(router, final_writer, "interrupt")
        if parked_store is not None:
            parked_store.park(parked_session_id, message_id, parked_user_id, registry)
        raise
    except Exception:
        _close_router_and_flush_final_safely(router, final_writer, "error")
        if parked_store is not None:
            parked_store.clear(parked_session_id, message_id, parked_user_id)
        raise
    else:
        # Deliberately NOT guarded: a close() failure on the happy path is a
        # real turn failure (the final flush/steps never reached the student).
        router.close("complete")
        if result is not None and isinstance(result.output, ClarifyDraftV2):
            # ask_student output: the model never streamed final-answer prose
            # (the question IS the output), so final_writer never saw a
            # natural start_final() call. Force it here so any render_viz
            # staged before the question still flushes deterministically
            # (plan Phase 2: never lose staged visible work merely because the
            # run ended in a question) — and deliberately bypass
            # _empty_resolve_completion below: a clarification result must
            # never synthesize a false final-answer delta.
            final_writer.start_final()
            final_writer.flush_final()
        else:
            final_writer.flush_final()
            completion_fallback = _empty_resolve_completion(emissions)
            if completion_fallback:
                writer({"type": "delta", "text": completion_fallback})

    # Both a normal answer and the handled tool-budget answer are terminal.
    if parked_store is not None:
        parked_store.clear(parked_session_id, message_id, parked_user_id)

    if result is not None:
        messages_out = scrub_evidence_tokens(
            ModelMessagesTypeAdapter.dump_python(result.all_messages(), mode="json")
        )
        if completion_fallback:
            messages_out = _replace_empty_final_response(
                cast(list[dict[str, Any]], messages_out), completion_fallback
            )
        run_usage = result.usage
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

    _record_uninjected_steers(handle, emissions)

    # --- the turn record (B1b, G1/G2): built from exactly what streamed ---
    prior_records = list(state.get("turn_records") or [])
    clarify, synthesized = _resume_clarify(prior_records, ids)
    # A v2 ask_student result (normal run only — Phase 3's future A2
    # continuation excludes the output type entirely, so this can't collide
    # with a legitimate second round): overrides any legacy resume clarify
    # metadata computed above, since a fresh clarification always wins.
    clarify_draft: ClarifyDraftV2 | None = (
        result.output
        if result is not None and isinstance(result.output, ClarifyDraftV2)
        else None
    )
    is_clarify_result = clarify_draft is not None
    if clarify_draft is not None:
        clarify = build_pending_clarification(clarify_draft)
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
        status="awaiting_input" if is_clarify_result else "complete",
        sources=registry.wire_dump(),
        user_text=record_user_text,
        usage=usage.model_dump(mode="json"),
        clarify=clarify,
        ts=now_iso(),
        messages_offset=offset,
        synthesized_answer=synthesized,
        selected_skills=ids["selected_skills"],
    )

    emitted_viz = [payload for kind, payload in emissions if kind == "viz"]
    return {
        "messages": messages_out,
        "source_registry": registry.dump_state(),
        "viz_emitted": emitted_viz,
        "usage": usage.model_dump(mode="json"),
        "tool_result_store": overflow_store.dump(),
        "pending_clarify": None,
        "turn_records": append_or_replace(prior_records, record),
    }
