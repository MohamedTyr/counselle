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
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date
from typing import TYPE_CHECKING, Any, cast
from uuid import UUID, uuid4

from langgraph.config import get_stream_writer
from langgraph.errors import GraphInterrupt
from pydantic_ai import Agent, Tool
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import (
    FunctionToolResultEvent,
    ModelMessage,
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    TextPart,
    ThinkingPart,
    UserPromptPart,
)
from pydantic_ai.models import Model
from pydantic_ai.tools import RunContext
from pydantic_ai.usage import RunUsage, UsageLimits
from pydantic_ai_harness.experimental.compaction import (
    ClearToolResults,
    SummarizingCompaction,
    TieredCompaction,
)
from pydantic_graph import End

from app import viz as viz_mod
from app.clarification import ask_student_output_type, build_pending_clarification
from app.goal_judge import GoalCriteriaError, derive_criteria, judge_goal
from app.goal_loop import (
    NOT_GOAL_EVIDENCE_KINDS,
    GoalDecision,
    GoalLoopController,
    build_goal_step_detail,
    goal_limits_from_settings,
    phase_label,
    status_reason,
)
from app.llm import build_model
from app.model_selection import (
    counselor_model_selection,
    goal_agent_model_setting,
    goal_criteria_model_setting,
    goal_judge_model_setting,
)
from app.model_selection import model_name_from_setting as model_name_from_setting
from app.plan_tool import PlanReminder, PlanState, make_write_plan_tool
from app.prompt import (
    ESSAY_CONTEXT_UNAVAILABLE,
    build_essay_system_prompt,
    build_system_prompt,
    render_essay_context,
    render_goal_mode,
    render_source_availability,
)
from app.pydantic_iter_nodes import CallToolsNode, ModelRequestNode
from app.records import (
    Emission,
    append_or_replace,
    build_turn_record,
    find_root_user_message_id,
    now_iso,
)
from app.skills import (
    FOCUSED_ANSWER,
    SelectedSkillValidationError,
    make_load_skill_tool,
    render_selected_skills,
    validate_selected_skills,
    with_default_response_mode,
    without_response_mode,
)
from app.sources import SourceRegistry
from app.steps import CloseReason, EmissionRouter, StepMapper
from app.student_context import STUDENT_CONTEXT_UNAUTHENTICATED
from app.tool_budget import ToolRoundBudget
from app.tool_middleware import ToolMiddlewareContext, process_tool_result
from app.tool_overflow import ToolResultStore
from app.toolset import GATEABLE_TOOLS, build_db_tools, build_tools, make_tool_deps
from app.turn_persistence import partial_messages, resolve_offset
from app.usage import estimate_cost
from app.viz_placement import StreamingVizMarkerStripper
from app.workspace.agent_tools import build_workspace_tools
from app.workspace.agent_tools_shared import WriteMode
from app.workspace.models import Essay, WorkspaceNotFoundError
from app.workspace.service_essays import get_essay
from config.settings import get_settings, load_yaml_asset
from domain.clarification import ClarifyDraftV2
from domain.events import GoalPhase, StepData, StepDetail, UsageData, ev_step
from domain.goal import GoalCriterion, GoalLedger, GoalStatus, GoalVerdict
from domain.response_mode import ResponseMode
from domain.specs import ColumnInput, SourceConfig, VizRowInput
from domain.surface import Surface

if TYPE_CHECKING:
    from app.graph import GraphDeps  # circular at runtime: graph imports run_agent_node
    from app.run_handle import RunHandle, SteeringMessage
    from config.settings import ReasoningEffort

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


#: The clean cut-off message when the run hits a request/token budget.
_TOOL_BUDGET_MESSAGE = (
    "\n\nI hit my tool budget for this turn, so I'm stopping here — this is what "
    "I have so far. Ask me to continue and I'll pick up where I left off."
)


def _requested_work_narration(user_text: str) -> str | None:
    """Return code-owned pre-tool narration only when the student asked for it."""
    if _forbid_work_narration(user_text):
        return None
    if not (
        re.search(r"\b(?:keep|use|show|emit|include)\s+(?:work\s+)?narration\b", user_text, re.I)
        or re.search(r"\bnarrate\s+(?:your\s+)?work\b", user_text, re.I)
        or re.search(r"\btell me what (?:you are|you're) doing\b", user_text, re.I)
        or re.search(r"\btalk me through (?:your\s+)?(?:steps?|work)\b", user_text, re.I)
    ):
        return None
    return "I will check the requested evidence before answering."


def _forbid_work_narration(user_text: str) -> bool:
    return bool(
        re.search(
            r"\b("
            r"no\s+(?:work\s+)?narration|"
            r"without\s+(?:work\s+)?narration|"
            r"(?:skip|avoid)\s+(?:the\s+)?(?:work\s+)?narration|"
            r"(?:don't|do not)\s+(?:use\s+)?(?:the\s+)?(?:work\s+)?narration|"
            r"(?:don't|do not)\s+narrate\s+(?:your\s+)?work"
            r")\b",
            user_text,
            re.I,
        )
    )


def _explicit_plan_request(user_text: str) -> bool:
    if _forbid_plan_request(user_text):
        return False
    plan_object = r"(?:(?:a|the|your)\s+)?plan"
    return bool(
        re.search(
            r"\b("
            r"(?:use|call)\s+(?:the\s+)?(?:write_plan|planning tool|plan tool)|"
            rf"(?:make|show|write|give me|outline)\s+{plan_object}|"
            rf"show me\s+{plan_object}|"
            r"plan this out|"
            r"walk me through (?:your\s+)?plan"
            r")\b",
            user_text,
            re.I,
        )
    )


def _forbid_plan_request(user_text: str) -> bool:
    return bool(
        re.search(
            r"\b("
            r"no\s+(?:write_plan|planning tool|plan tool)|"
            r"without\s+(?:a\s+)?(?:write_plan|planning tool|plan tool)|"
            r"(?:skip|avoid)\s+(?:the\s+)?(?:write_plan|planning tool|plan)|"
            r"(?:don't|do not)\s+(?:use|call)?\s*(?:the\s+)?"
            r"(?:write_plan|planning tool|plan tool)|"
            r"(?:don't|do not)\s+write\s+(?:a\s+)?plan|"
            r"(?:don't|do not)\s+make\s+(?:a\s+)?plan"
            r")\b",
            user_text,
            re.I,
        )
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

    ``surface`` records which surface originated this turn (ADR 0037); the
    essay surface's DB-tool narrowing itself happens earlier, at toolset
    construction time (``build_db_tools(..., surface=surface)``,
    app/toolset.py) — an ADR 0013 unmount, never a runtime denial in a tool
    hook.
    """

    registry: SourceRegistry
    tool_overflow: ToolMiddlewareContext | None = None
    surface: Surface = Surface.CHAT


def default_model_factory(
    settings: Any, model_setting: str, reasoning_effort: ReasoningEffort
) -> Model:
    """The turn's live model, built through the one provider seam
    (:func:`app.llm.build_model`, ADR 0011/0043).

    ``model_setting`` and ``reasoning_effort`` are the already-resolved
    per-turn values (Quick's or Think's, plans/quick-think-response-mode.md
    §3.2/§5.2); this factory never re-reads a global default itself. The
    effort rides on the model as its default settings, so every agent run on
    it — including the goal-only summarizing compaction tier, which runs with
    no settings of its own — reasons at the turn's effort.
    """
    return build_model(settings, model_setting, reasoning_effort=reasoning_effort)


def _strip_thinking(messages: Sequence[ModelMessage]) -> list[ModelMessage]:
    """Drop earlier turns' ``ThinkingPart``s from the history sent to the model.

    Checkpointed history can hold another provider's thoughts, which
    PydanticAI would inline as ``<think>`` text in assistant messages, and
    DeepSeek's multi-turn contract drops earlier reasoning anyway. A response
    left with no parts is dropped. Returns a new list; the checkpoint is
    never rewritten.
    """
    stripped: list[ModelMessage] = []
    for message in messages:
        if isinstance(message, ModelResponse):
            parts = [part for part in message.parts if not isinstance(part, ThinkingPart)]
            if not parts:
                continue
            if len(parts) != len(message.parts):
                message = replace(message, parts=parts)
        stripped.append(message)
    return stripped


def _split_user_message(raw_messages: list[dict[str, Any]]) -> tuple[list[ModelMessage], str]:
    """Split serialized state messages into (history, new user prompt text).

    The runner's convention puts the new user message last (module docstring).
    The history comes back without earlier turns' thinking (:func:`_strip_thinking`).
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
    return _strip_thinking(messages[:-1]), str(prompt_parts[-1].content)


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


_VIZ_MARKER_START = "[[viz:"


class _StreamingVizMarkerPlacer:
    def __init__(
        self,
        staged_specs: list[dict[str, Any]],
        writer: Callable[[dict[str, Any]], None],
        *,
        emitted_indexes: set[int] | None = None,
    ) -> None:
        self._staged_specs = staged_specs
        self._writer = writer
        self._pending = ""
        # Goal mode (C7 + spike S7 correction): carried forward across a
        # per-iteration rebuild so a card already shown is never re-emitted,
        # and a marker fragment split across the boundary is never dropped.
        self._emitted_indexes: set[int] = set(emitted_indexes) if emitted_indexes else set()

    @property
    def emitted_indexes(self) -> set[int]:
        return self._emitted_indexes

    @property
    def pending(self) -> str:
        return self._pending

    @pending.setter
    def pending(self, value: str) -> None:
        self._pending = value

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
    ) -> None:
        self._staged_specs = staged_specs
        self._writer = writer
        self._final_started = False
        self._flushed = False
        self._placer = _StreamingVizMarkerPlacer(staged_specs, writer)
        self._stripper = StreamingVizMarkerStripper()

    def start_final(self) -> None:
        if self._final_started or self._flushed:
            return
        self._final_started = True

    def begin_iteration(self) -> None:
        """Goal mode only (C7): reset the two one-way latches and rebuild the
        two stateful nested parsers for the new iteration.

        The writer itself is mutated in place, never rebound — ``EmissionRouter``
        holds bound methods on this exact instance (``write``/``start_final``).
        Both ``emitted_indexes`` (C7) AND ``pending`` (spike S7 correction) are
        carried forward: ``_staged_specs`` is never cleared, and a viz marker
        split across the iteration boundary must not leak a literal ``]]``
        into the next iteration's answer text.
        """
        self._final_started = False
        self._flushed = False
        old_pending = self._placer.pending
        self._placer = _StreamingVizMarkerPlacer(
            self._staged_specs, self._writer, emitted_indexes=self._placer.emitted_indexes
        )
        self._placer.pending = old_pending
        self._stripper = StreamingVizMarkerStripper()

    def write(self, chunk: dict[str, Any]) -> None:
        if chunk.get("type") == "delta":
            clean = str(chunk.get("text") or "")
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
        messages = ModelMessagesTypeAdapter.dump_python(run.all_messages(), mode="json")
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


def _surface_from_ids(ids: dict[str, Any]) -> Surface:
    """The turn's originating surface from ``turn_ids`` — chat for any absent/
    malformed value (a pre-feature checkpoint or a direct-graph test call)."""
    raw = ids.get("surface")
    if raw is None:
        return Surface.CHAT
    try:
        return Surface(raw)
    except ValueError:
        logger.warning("unknown surface %r in turn_ids — defaulting to chat", raw)
        return Surface.CHAT


#: The workspace tools an essay-surface turn keeps (plan Part 1 §3.2 + C9):
#: the one essay's own read/edit/write/status control, every workspace READ
#: (the student's real material — the anti-fabrication supply), and memory
#: writes. Every other workspace mutation is never mounted (ADR 0013).
_ESSAY_SURFACE_WORKSPACE_TOOLS: frozenset[str] = frozenset(
    {
        "view_essays",
        "read_essay",
        "edit_essay",
        "write_essay",
        "update_essay",
        "view_activities",
        "view_documents",
        "read_document",
        "view_schools",
        "get_school",
        "search_schools",
        "view_tasks",
        "search_tasks",
        "remember",
        "update_memory",
    }
)


async def _load_turn_essay(deps: GraphDeps, ids: dict[str, Any]) -> Essay | None:
    """The essay this turn is about, read once at turn start.

    Reuses ``service_essays.get_essay`` — the same ``WHERE user_id = $1`` read
    ``read_essay``/``edit_essay`` already run, so ownership is enforced by the
    service, never by anything the model or the client supplied. ``None`` when
    it is deleted, archived, or not this student's: ``get_essay`` draws no
    distinction between those, and neither may we.
    """
    user_id, essay_id = ids.get("user_id"), ids.get("essay_id")
    if not (user_id and essay_id and deps.app_pool):
        return None
    try:
        return await get_essay(
            deps.app_pool, deps.catalog, user_id=UUID(str(user_id)), essay_id=UUID(str(essay_id))
        )
    except WorkspaceNotFoundError:
        return None


def _essay_context_block(essay: Essay | None, ids: dict[str, Any], max_chars: int) -> str:
    """The essay-surface prompt's ``essay_context`` slot for this turn.

    An unreadable essay degrades to the unavailable block — the turn continues
    and can still answer, instead of dying as a generic error.
    """
    if essay is None:
        return ESSAY_CONTEXT_UNAVAILABLE
    selection = ids.get("essay_selection")
    return render_essay_context(
        essay,
        selection=str(selection) if selection else None,
        max_chars=max_chars,
    )


def _write_mode(surface: Surface, essay: Essay | None) -> WriteMode:
    """How this turn's content writes land (plan Part 1 §5.2).

    The essay panel proposes rather than writes — every change is reviewable —
    with one exception: an essay that is still empty when the turn starts has
    nothing to review a first draft against, so that draft is committed
    directly. The chat surface is unchanged and always writes directly.

    A property of the turn's *starting* state, not of which tool gets called:
    "a full draft into an empty essay" is a one-time event, and the next turn
    re-evaluates against the content this one produced.
    """
    if surface is not Surface.ESSAY:
        return "direct"
    return "direct" if essay is not None and essay.word_count == 0 else "suggest"


@dataclass
class _CompactionBeat(ClearToolResults):
    """``ClearToolResults`` instrumented to disclose itself as a stream beat.

    D11/§4.2 (plans/goal-mode-plan.md): mounted on every turn, goal or not.
    0.4.0 exposes no compact-fired hook, so this detects an actual clear the
    same way the library does internally — ``compact()`` returns the same
    list object when it declined to clear (no clearable pairs, or
    ``min_clear_tokens`` not reached) and a new one when it did.
    """

    on_clear: Callable[[], None] | None = None

    async def compact(
        self, messages: list[ModelMessage], ctx: RunContext[Any]
    ) -> list[ModelMessage]:
        cleared = await super().compact(messages, ctx)
        if cleared is not messages and self.on_clear is not None:
            self.on_clear()
        return cleared


@dataclass
class _SummarizingBeat(SummarizingCompaction):
    """``SummarizingCompaction`` instrumented to disclose itself, and to
    degrade rather than abort the run when the summary call fails.

    D11/§4.2 (plans/goal-mode-plan.md): the expensive tier, goal turns only.
    Like ``_CompactionBeat``, 0.4.0 exposes no compact-fired hook, so a real
    summarization is detected the same way the library decides internally —
    ``compact()`` hands back the same list object when it declined (no cutoff
    above the preserved tail).

    **Failure is survivable.** A goal run is the long, unattended case, so a
    summary call that times out, is rate-limited, or trips the inner run's own
    request limit must not take the whole run with it: the failure is logged
    and the un-summarized history is handed straight back. The cheap tier has
    already run by then, and ``target_tokens`` is a cost guard rather than a
    context-window limit, so the next request simply goes out longer than the
    target instead of not going out at all. ``CancelledError`` is not an
    ``Exception``, so cancelling a turn stays immediate.
    """

    on_summary: Callable[[], None] | None = None

    async def compact(
        self, messages: list[ModelMessage], ctx: RunContext[Any]
    ) -> list[ModelMessage]:
        try:
            summarized = await super().compact(messages, ctx)
        except Exception:
            logger.warning(
                "goal compaction: summarization failed, continuing on the un-summarized history",
                exc_info=True,
            )
            return messages
        if summarized is not messages and self.on_summary is not None:
            self.on_summary()
        return summarized


def _make_compaction_beat_emitter(
    writer: Callable[[dict[str, Any]], None],
    *,
    step_prefix: str = "compaction",
    label: str = "Compacted the conversation to keep working",
) -> Callable[[], None]:
    """A ``compaction`` step beat, one line, C4: the model never mentions it.

    Emitted as a single ``end`` (no ``start``) — by the time either tier can
    report, the edit it describes is already complete, so there is no
    in-progress phase to show. *label* is what distinguishes the two tiers on
    the surface: the frontend renders it verbatim, so blanking old tool
    results and rewriting earlier turns into a summary never read as the same
    event.
    """
    counter = 0

    def _emit() -> None:
        nonlocal counter
        counter += 1
        step = StepData(
            step_id=f"{step_prefix}-{counter}",
            status="end",
            kind="compaction",
            label=label,
            tier=None,
        )
        writer({"type": "step", "data": ev_step(step).data})

    return _emit


def _clear_tool_results_tier(
    settings: Any, writer: Callable[[dict[str, Any]], None]
) -> _CompactionBeat:
    """The cheap, zero-LLM tier — mounted directly on every turn (D11) and
    again as the first tier a goal turn escalates through."""
    return _CompactionBeat(
        max_messages=settings.compaction_clear_tool_results_after_messages,
        keep_pairs=settings.compaction_clear_tool_keep_pairs,
        min_clear_tokens=settings.compaction_min_clear_tokens,
        on_clear=_make_compaction_beat_emitter(writer),
    )


def compaction_capabilities(
    settings: Any, writer: Callable[[dict[str, Any]], None], *, goal_mode: bool
) -> list[Any]:
    """The compaction capabilities for one turn, in chain order (D11).

    Every turn gets the cheap tier. A goal turn additionally gets the
    escalating :class:`TieredCompaction`, which re-runs the cheap pass and
    then pays for a summary only if the history is still above
    ``goal_compaction_target_tokens``. The cheap tier appears twice on
    purpose: the standalone one fires on its own message-count trigger, while
    the one inside the escalation fires on the token budget — a history of few
    but enormous messages is over budget without ever reaching the message
    count, and paying a model to summarize what blanking would have reclaimed
    for free is the one thing the escalation exists to avoid. Whichever
    declines to act returns its input unchanged and emits no beat.

    The summarizing tier takes ``model=None``: it inherits the running agent's
    model, which on a goal turn is already the cheap tier
    (:func:`goal_agent_model_setting`), so it needs no second model knob and —
    more importantly — never re-resolves a model-setting string through
    PydanticAI's generic inference, which would bypass ``app/llm.py``'s key,
    retries and reasoning effort (ADR 0011: one seam). Its usage folds into the run's shared
    ``RunUsage``, so the summary's tokens are priced in the agent's own slice
    at the agent's own rate, and its request counts against
    ``goal_max_model_requests`` like any other — it is a real request.
    """
    capabilities: list[Any] = [_clear_tool_results_tier(settings, writer)]
    if not goal_mode:
        return capabilities
    capabilities.append(
        TieredCompaction(
            tiers=[
                _clear_tool_results_tier(settings, writer),
                _SummarizingBeat(
                    model=None,
                    # `TieredCompaction` drives each tier's `compact()`
                    # directly and owns the trigger, so this threshold is
                    # never consulted; it is set to the same budget so the
                    # tier still reads honestly on its own.
                    max_tokens=settings.goal_compaction_target_tokens,
                    keep_tokens=settings.goal_compaction_keep_tokens,
                    preserve_first_user_message=True,  # C2 — non-negotiable
                    incremental=True,  # anchored update, no summary decay
                    on_summary=_make_compaction_beat_emitter(
                        writer,
                        step_prefix="compaction-summary",
                        label="Summarized the earlier conversation to keep working",
                    ),
                ),
            ],
            target_tokens=settings.goal_compaction_target_tokens,
        )
    )
    return capabilities


def _goal_step(
    *,
    phase: GoalPhase,
    statement: str,
    criteria: Any,
    verdict: GoalVerdict | None,
    checked_by_id: dict[str, bool],
    ledger: GoalLedger,
    limits: Any,
    not_checked_note: str,
    requests_limit: int = 0,
    tokens_limit: int = 0,
    status: GoalStatus | None = None,
) -> StepData:
    """One `kind:"goal"` beat (§2.6) — a single ``end`` event, no ``start``:
    like the compaction beat, the fact it reports is already complete by the
    time it is known. Step ids are distinct per phase/iteration (§2.6's
    step-id discipline) so `build_segments` never merges two rounds into one.
    """
    detail = build_goal_step_detail(
        phase=phase,
        statement=statement,
        criteria=criteria,
        verdict=verdict,
        checked_by_id=checked_by_id,
        ledger=ledger,
        limits=limits,
        not_checked_note=not_checked_note,
        requests_limit=requests_limit,
        tokens_limit=tokens_limit,
        status=status,
    )
    return StepData(
        step_id=f"goal-{phase}-{ledger.iteration}",
        status="end",
        kind="goal",
        label=phase_label(phase),
        tier=None,
        detail=StepDetail(goal=detail),
    )


@dataclass
class _RunOnceResult:
    result: Any  # AgentRunResult[str | ClarifyDraftV2] | None — None on budget
    hit_budget: bool
    completion_fallback: str | None
    # True when any tool call this iteration returned an error/retry
    # (detected via the same `StepMapper.result_is_error` check the step
    # receipt uses) — wires `domain.goal.decide_terminal_status`'s
    # `consecutive_tool_errors` counter.
    had_tool_error: bool = False


async def _run_once(
    agent: Agent[TurnDeps, str | ClarifyDraftV2],
    prompt: str,
    history: list[ModelMessage] | None,
    *,
    turn_deps: TurnDeps,
    usage: RunUsage | None,
    limits: UsageLimits,
    router: EmissionRouter,
    final_writer: _FinalContentPlacementWriter,
    recording_writer: Callable[[dict[str, Any]], None],
    writer: Callable[[dict[str, Any]], None],
    emissions: list[Emission],
    handle: RunHandle | None,
    parked_store: Any,
    parked_session_id: str,
    message_id: str,
    parked_user_id: str | None,
    registry: SourceRegistry,
) -> _RunOnceResult:
    """One ``agent.iter()`` pass (C7): begins/closes the per-iteration
    emitters, streams events through *router*, and reports the outcome.

    Deliberately never calls ``final_writer.flush_final()`` on any path
    (spike correction, plans/goal-mode-plan.md §6.0/S7): that call is
    genuinely turn-terminal (fallback-dumps every unplaced staged viz card
    and discards — never carries forward — an in-flight marker fragment), so
    it may run only ONCE, after the true last iteration (including any
    §2.7 wrap-up), never at a non-terminal iteration boundary. The caller
    owns that single call, in a ``finally`` around the whole run (single call
    for an ordinary turn; after the loop + wrap-up for a goal turn) — the
    same shape as the ``_record_uninjected_steers`` extraction below.
    """
    router.begin_iteration()
    final_writer.begin_iteration()
    result: Any = None
    hit_budget = False
    completion_fallback: str | None = None
    had_tool_error = False
    try:
        async with (
            agent,
            agent.iter(
                prompt,
                message_history=history,
                deps=turn_deps,
                usage=usage,
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
                            if isinstance(tool_event, FunctionToolResultEvent):
                                content = (
                                    None
                                    if isinstance(tool_event.part, RetryPromptPart)
                                    else getattr(tool_event.part, "content", None)
                                )
                                if StepMapper.result_is_error(tool_event.part, content):
                                    had_tool_error = True
                    record_replayable_snapshot(run, handle, emissions_len=len(emissions))
                    _emit_injected_steers(run, handle, recording_writer)
                    node = await run.next(tool_node)
                    record_replayable_snapshot(run, handle, emissions_len=len(emissions))
                else:
                    _emit_injected_steers(run, handle, recording_writer)
                    node = await run.next(node)
            result = run.result
    except UsageLimitExceeded:
        _close_router_safely(router, "budget")
        hit_budget = True
        writer({"type": "delta", "text": _TOOL_BUDGET_MESSAGE})
    except asyncio.CancelledError:
        _close_router_safely(router, "interrupt")
        raise
    except GraphInterrupt:
        _close_router_safely(router, "interrupt")
        if parked_store is not None:
            parked_store.park(parked_session_id, message_id, parked_user_id, registry)
        raise
    except Exception:
        _close_router_safely(router, "error")
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
            # staged before the question still flushes deterministically —
            # and deliberately bypass _empty_resolve_completion below: a
            # clarification result must never synthesize a false delta.
            final_writer.start_final()
        else:
            completion_fallback = _empty_resolve_completion(emissions)
            if completion_fallback:
                writer({"type": "delta", "text": completion_fallback})
    return _RunOnceResult(
        result=result,
        hit_budget=hit_budget,
        completion_fallback=completion_fallback,
        had_tool_error=had_tool_error,
    )


def _usage_tokens(usage: RunUsage) -> tuple[int, int]:
    """``(input_tokens, output_tokens)`` snapshot of a shared ``RunUsage`` at
    one point in time — the unit `_price_usage_delta`'s per-slice pricing
    diffs between."""
    return (usage.input_tokens or 0, usage.output_tokens or 0)


def _price_usage_delta(
    before: tuple[int, int], after: tuple[int, int], model_setting: str, settings: Any
) -> float:
    """Price the token delta between two ``_usage_tokens`` snapshots at
    *model_setting*'s own rate.

    ``shared_usage`` aggregates the agent's own iterations AND the
    ``judge_goal``/``derive_criteria`` calls onto one ``RunUsage`` (D6).
    Pricing that cumulative total at a single model's rate silently prices
    judge/criteria spend at the agent's rate — the moment
    ``model_goal_judge``/``model_goal_criteria`` diverge from the agent's
    tier (a documented, live owner option), the ledger understates what the
    run actually cost. Each slice is priced at its own model, in dollars;
    only the resulting dollar amounts are ever summed, never the token
    counts.
    """
    input_delta = max(0, after[0] - before[0])
    output_delta = max(0, after[1] - before[1])
    cost = estimate_cost(model_setting, input_delta, output_delta, settings.model_prices)
    return cost if cost is not None else 0.0


def _update_goal_ledger_totals(ledger: GoalLedger, usage: RunUsage) -> None:
    """Refresh the ledger's aggregate request/token counts from the shared
    ``RunUsage`` (D6) — the only source `controller.decide` and the "check"/
    "final" steps read those two fields from. Cost is priced separately, per
    call, at each call's own model rate (`_price_usage_delta`), and is never
    recomputed from this aggregate."""
    ledger.requests_used = usage.requests
    ledger.tokens_used = (usage.input_tokens or 0) + (usage.output_tokens or 0)


def _goal_wrapup_prompt(
    status: GoalStatus,
    verdict: GoalVerdict | None,
    criteria: tuple[GoalCriterion, ...],
    not_checked_note: str,
    today: date | None = None,
) -> str:
    """§2.7's wrap-up prompt: states the stop reason, what was accomplished,
    what remains, what was never checked, and what to do next — never
    "achieved" (C3), and this run never calls any tool."""
    met_ids = {c.criterion_id for c in verdict.criteria if c.met} if verdict is not None else set()
    unmet = [c.text for c in criteria if c.id not in met_ids]
    lines = [
        "<goal-wrapup>",
        f"This run is ending: {status_reason(status)}",
        "Write ONE final answer to the student, in plain prose, that:",
        "1. Says plainly the run stopped before everything was done.",
        "2. Names specifically what WAS accomplished.",
        "3. Names which of the criteria below remain unmet.",
        "4. Says what was never checked at all.",
        "5. Says what the student (or a follow-up request) should do next.",
        "You have no tools this round — do not attempt to call one. Never say "
        "the goal was achieved.",
        f"Scope note: {not_checked_note}",
    ]
    if unmet:
        lines.append("Still outstanding: " + "; ".join(unmet))
    lines.append("</goal-wrapup>")
    return "\n".join(lines)


def _emit_goal_final_step(
    writer: Callable[[dict[str, Any]], None],
    *,
    controller: GoalLoopController,
    ledger: GoalLedger,
    usage_snapshot: tuple[int, int],
    shared_usage: RunUsage,
    model_setting: str,
    settings: Any,
    statement: str,
    criteria: tuple[GoalCriterion, ...],
    verdict: GoalVerdict | None,
    checked_by_id: dict[str, bool],
    goal_limits: Any,
    not_checked_note: str,
    status: GoalStatus | None,
) -> None:
    """The one "final" goal step an abnormally-ending segment ever gets —
    shared by the cancel path and the generic-exception path so both stamp
    the ledger's active time, price the last usage slice, and stream the
    same beat the same way, whichever exit hit. Best-effort: whichever call
    was interrupted (agent, judge, or wrap-up) is priced at the agent's
    rate, since which one was in flight isn't knowable here — a rare race,
    and the ledger is documented as a soft estimate regardless.
    """
    controller.stamp_elapsed(ledger)
    _update_goal_ledger_totals(ledger, shared_usage)
    ledger.cost_usd += _price_usage_delta(
        usage_snapshot, _usage_tokens(shared_usage), model_setting, settings
    )
    writer(
        {
            "type": "step",
            "data": ev_step(
                _goal_step(
                    phase="final",
                    statement=statement,
                    criteria=criteria,
                    verdict=verdict,
                    checked_by_id=checked_by_id,
                    ledger=ledger,
                    limits=goal_limits,
                    not_checked_note=not_checked_note,
                    requests_limit=settings.goal_max_model_requests,
                    tokens_limit=settings.goal_max_total_tokens,
                    status=status,
                )
            ).data,
        }
    )


# Steps the goal check never sees. It judges what the run produced; how the
# agent organised its own work (its plan) and the run's housekeeping are not
# evidence of anything the student asked for.
async def _run_goal_loop(
    agent: Agent[TurnDeps, str | ClarifyDraftV2],
    statement: str,
    history: list[ModelMessage] | None,
    *,
    criteria: tuple[GoalCriterion, ...],
    not_checked_note: str,
    today: date | None = None,
    limits: UsageLimits,
    goal_limits: Any,
    settings: Any,
    model_setting: str,
    reasoning_effort: ReasoningEffort,
    instructions: str,
    injected_model_factory: Callable[[], Model] | None,
    shared_usage: RunUsage,
    run_once_kwargs: dict[str, Any],
    initial_cost_usd: float = 0.0,
    prior_receipts: Sequence[StepData] = (),
    resume_prompt: str | None = None,
    carried_state: Mapping[str, Any] | None = None,
) -> tuple[Any, str | None, dict[str, Any]]:
    """The goal iteration loop (§2.1, §2.5): repeat `_run_once` + the judge
    until :class:`~app.goal_loop.GoalLoopController` says stop, then (unless
    achieved) a §2.7 wrap-up on a second, tool-less Agent. Emits the "check"
    step every round and, on a clean stop, the "final" step exactly once, at
    the true end. A cancellation or an unhandled exception (a provider
    error, a timeout, a tool crash) instead emits a status-less final step
    via :func:`_emit_goal_final_step` before propagating, so the ledger and
    last verdict still reach the student on the stream (the turn record
    itself is never built on either path, same as an ordinary turn's
    cancel/error path) — an exception carries no judged terminal state, so
    it is never claimed as one; the frontend's crash rule (`isInterruptedGoal`,
    §5.3) renders the status-less step as "Stopped — interrupted".

    *initial_cost_usd* is the already-priced cost of any `derive_criteria`
    spend the caller made against `shared_usage` before this loop started —
    the ledger's running dollar total picks up from there rather than
    re-pricing that spend at the agent's rate.

    A resumed run — a goal run that paused on ``ask_student`` and is now
    continuing with the student's answer — passes that answer as
    *resume_prompt* (the first round's prompt, in place of the statement),
    the paused run's tool receipts as *prior_receipts* (which the judge sees
    alongside this turn's own so work done before the question is not
    re-proven from scratch), and its ledger/stall totals as *carried_state* —
    so this segment's budgets and stall tracking pick up where the paused
    one left off rather than resetting.

    Returns ``(result, completion_fallback, carried_state)`` — the third
    element is this segment's own totals in the same shape *carried_state*
    takes, for the caller to persist when the run pauses again.

    An ``ask_student`` output ends the loop at once with ``awaiting_input``:
    no check, no nudge, no wrap-up — the question is the turn's output, and
    the run resumes as a clarify continuation carrying the same criteria.
    """
    ledger, controller = GoalLoopController.from_carry(
        statement, criteria, goal_limits, carried_state
    )
    ledger.cost_usd += initial_cost_usd
    # The token-count snapshot the next `_price_usage_delta` call diffs
    # against — advanced after every priced slice (agent iteration, judge
    # call, or wrap-up), never rewound.
    usage_snapshot = _usage_tokens(shared_usage)
    judge_model_setting = goal_judge_model_setting(settings)
    prompt = resume_prompt if resume_prompt is not None else statement
    iter_history = history
    result: Any = None
    completion_fallback: str | None = None
    verdict: GoalVerdict | None = None
    checked_by_id: dict[str, bool] = {}
    cited_step_ids: frozenset[str] = frozenset()
    decision = GoalDecision(False, None, "")
    writer = run_once_kwargs["writer"]
    try:
        while True:
            ledger.iteration += 1
            outcome = await _run_once(
                agent, prompt, iter_history, usage=shared_usage, limits=limits, **run_once_kwargs
            )
            result = outcome.result
            completion_fallback = outcome.completion_fallback
            _update_goal_ledger_totals(ledger, shared_usage)
            agent_snapshot = _usage_tokens(shared_usage)
            agent_slice_cost = _price_usage_delta(
                usage_snapshot, agent_snapshot, model_setting, settings
            )
            ledger.cost_usd += agent_slice_cost
            usage_snapshot = agent_snapshot
            # Wires `goal_max_consecutive_tool_errors`: this is the only
            # place that increments the counter `domain.goal`'s `partial`
            # branch reads.
            ledger.consecutive_tool_errors = (
                ledger.consecutive_tool_errors + 1 if outcome.had_tool_error else 0
            )
            if outcome.hit_budget:
                # Breaks before `decide()` runs this round, so this segment's
                # active time would otherwise carry the PREVIOUS round's
                # stamp — stamp it here so the final step below reports this
                # round's own elapsed time.
                controller.stamp_elapsed(ledger)
                decision = GoalDecision(True, "stopped_budget", status_reason("stopped_budget"))
                break
            if result is not None and isinstance(result.output, ClarifyDraftV2):
                # Same reason as `hit_budget` above: a pause also breaks
                # before `decide()` runs this round.
                controller.stamp_elapsed(ledger)
                decision = GoalDecision(True, "awaiting_input", status_reason("awaiting_input"))
                break
            if result is not None:
                iter_history = result.all_messages()
            final_text = (
                result.output if result is not None and isinstance(result.output, str) else ""
            )
            receipts = [
                StepData.model_validate(payload)
                for kind, payload in run_once_kwargs["emissions"]
                if kind == "step"
                and isinstance(payload, dict)
                and payload.get("status") != "start"
                and payload.get("kind") not in NOT_GOAL_EVIDENCE_KINDS
            ]
            receipts = [*prior_receipts, *receipts]
            judged = await judge_goal(
                statement=statement,
                criteria=criteria,
                receipts=receipts,
                final_text=final_text,
                prior_cited_step_ids=cited_step_ids,
                settings=settings,
                usage=shared_usage,
                today=today,
            )
            if judged is None:
                verdict, checked_by_id = None, {}
            else:
                verdict, checked_by_id = judged
                cited_step_ids = frozenset(
                    sid for c in verdict.criteria for sid in c.evidence_step_ids
                )
            _update_goal_ledger_totals(ledger, shared_usage)
            judge_snapshot = _usage_tokens(shared_usage)
            judge_slice_cost = _price_usage_delta(
                usage_snapshot, judge_snapshot, judge_model_setting, settings
            )
            ledger.cost_usd += judge_slice_cost
            usage_snapshot = judge_snapshot
            # Project from THIS round's actual cost, not a lifetime mean —
            # per-iteration cost trends upward across a run (each round
            # re-sends accumulated history), so an average dragged down by
            # cheap early rounds under-projects the next, pricier one.
            controller.avg_cost_per_iteration = agent_slice_cost + judge_slice_cost
            writer(
                {
                    "type": "step",
                    "data": ev_step(
                        _goal_step(
                            phase="check",
                            statement=statement,
                            criteria=criteria,
                            verdict=verdict,
                            checked_by_id=checked_by_id,
                            ledger=ledger,
                            limits=goal_limits,
                            not_checked_note=not_checked_note,
                            requests_limit=settings.goal_max_model_requests,
                            tokens_limit=settings.goal_max_total_tokens,
                        )
                    ).data,
                }
            )
            decision = controller.decide(verdict=verdict, ledger=ledger)
            if decision.stop:
                break
            # `decide_terminal_status` returns "stopped_check_failed"
            # unconditionally when `verdict is None` (domain/goal.py), so
            # `decision.stop` is always True on that path and the loop has
            # already broken above — a fresh verdict is guaranteed here.
            assert verdict is not None
            prompt = controller.nudge_text(verdict)

        goal_status: GoalStatus = decision.status or "stopped_budget"
        if goal_status not in ("achieved", "awaiting_input"):
            # §2.7: a SECOND, tool-less Agent — `Agent.iter`'s `toolsets=` is
            # additive, never a way to disable mounted tools, so "no tool
            # calls" is made structural by simply never passing `tools=` here.
            wrapup_agent: Agent[TurnDeps, str] = Agent(
                injected_model_factory()
                if injected_model_factory is not None
                else default_model_factory(settings, model_setting, reasoning_effort),
                instructions=instructions,
                deps_type=TurnDeps,
                output_type=[str],
                end_strategy="early",
            )
            wrapup_limits = UsageLimits(
                request_limit=settings.goal_max_model_requests,
                # No token ceiling on the wrap-up. The main loop and the
                # wrap-up would otherwise share one token backstop
                # (`goal_max_total_tokens`), so a run stopped by that
                # backstop left the wrap-up's own call immediately
                # re-raising `UsageLimitExceeded` — replacing the goal-aware
                # explanation with the generic tool-budget message on
                # exactly the run where an honest Partial mattered most. The
                # wrap-up is a single tool-less call already bounded by its
                # own request limit, so no token ceiling is needed here.
                total_tokens_limit=None,
            )
            wrapup_prompt = _goal_wrapup_prompt(goal_status, verdict, criteria, not_checked_note)
            wrapup_outcome = await _run_once(
                wrapup_agent,
                wrapup_prompt,
                iter_history,
                usage=shared_usage,
                limits=wrapup_limits,
                **run_once_kwargs,
            )
            result = wrapup_outcome.result
            completion_fallback = wrapup_outcome.completion_fallback
            _update_goal_ledger_totals(ledger, shared_usage)
            wrapup_snapshot = _usage_tokens(shared_usage)
            ledger.cost_usd += _price_usage_delta(
                usage_snapshot, wrapup_snapshot, model_setting, settings
            )
            usage_snapshot = wrapup_snapshot
    except asyncio.CancelledError:
        # §2.8: the ledger/last verdict must reach the student BEFORE this
        # propagates — streamed now, since the turn record is never built on
        # a cancelled turn (same as an ordinary turn's cancel path). Covers
        # cancellation during the main loop AND during the wrap-up run above.
        #
        # `CancelledError` arrives here from several causes `app/turns.py`
        # keeps apart and the exception itself cannot carry: the student
        # pressing Stop (`_cancel_active` -> done(cancelled)), a shutdown
        # drain (`_drain_active_with_error` -> error, BC-15 — the student
        # never pressed anything) and the turn watchdog. The registry marks
        # its own — and only its own — student cancel on the run handle, so
        # "stopped_user" is claimed when that mark is present and NOTHING is
        # claimed otherwise. The direction is deliberate: an unset flag, an
        # absent handle, or a future termination path that knows nothing
        # about the flag all fall back to claiming nothing, never to telling
        # a student who was redeployed out from under them that they stopped
        # it themselves.
        cancel_status: GoalStatus | None = None
        if getattr(run_once_kwargs.get("handle"), "cancelled_by_user", False):
            # Through the controller, so the terminal state is still decided
            # in exactly one place (`domain.goal.decide_terminal_status`).
            cancel_status = controller.decide(
                verdict=verdict,
                ledger=ledger,
                cancelled=True,
            ).status
        _emit_goal_final_step(
            writer,
            controller=controller,
            ledger=ledger,
            usage_snapshot=usage_snapshot,
            shared_usage=shared_usage,
            model_setting=model_setting,
            settings=settings,
            statement=statement,
            criteria=criteria,
            verdict=verdict,
            checked_by_id=checked_by_id,
            goal_limits=goal_limits,
            not_checked_note=not_checked_note,
            status=cancel_status,
        )
        raise
    except Exception:
        # A crash mid-run (a provider error, a timeout, an unhandled tool
        # exception) is not one of the six judged terminal states — no
        # criterion was assessed against it, so none is claimed. The final
        # step below carries no status; the frontend's crash rule
        # (`isInterruptedGoal`, §5.3) renders that the same way it renders a
        # cancellation with no claimed status: "Stopped — interrupted".
        _emit_goal_final_step(
            writer,
            controller=controller,
            ledger=ledger,
            usage_snapshot=usage_snapshot,
            shared_usage=shared_usage,
            model_setting=model_setting,
            settings=settings,
            statement=statement,
            criteria=criteria,
            verdict=verdict,
            checked_by_id=checked_by_id,
            goal_limits=goal_limits,
            not_checked_note=not_checked_note,
            status=None,
        )
        raise

    _emit_goal_final_step(
        writer,
        controller=controller,
        ledger=ledger,
        usage_snapshot=usage_snapshot,
        shared_usage=shared_usage,
        model_setting=model_setting,
        settings=settings,
        statement=statement,
        criteria=criteria,
        verdict=verdict,
        checked_by_id=checked_by_id,
        goal_limits=goal_limits,
        not_checked_note=not_checked_note,
        status=goal_status,
    )
    return result, completion_fallback, controller.carry_state(ledger)


async def run_agent_node(state: Any, deps: GraphDeps) -> dict[str, Any]:
    """One agent turn: rebuild from state, run the agent, return the delta."""
    settings = getattr(deps, "settings", None) or get_settings()
    emissions: list[Emission] = []
    recording_writer = _make_recording_writer(get_stream_writer(), emissions)

    # --- rebuild per-turn objects from state (replay-safe, module docstring) ---
    ids = _turn_ids(state)
    # D10: the harness mode this turn runs under (plans/goal-mode-plan.md
    # §2.4) — absent/malformed reads as an ordinary turn, never as goal mode.
    goal_mode = bool(ids.get("goal_mode"))
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
    requested_narration = _requested_work_narration(user_text)
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
    # Hoisted ahead of the toolset block (was read further down, after tools
    # were already built) so a future mount gate can read
    # `ids.get("user_id")` before deciding which tools to construct (ADR
    # 0013: unmounted, not hidden — gating after construction is too late).
    # ``ids`` was validated above because it also keys runtime-only parked evidence.

    # The turn's originating surface (plan Part 1 §1): selects the system
    # prompt and narrows the tool profile. Read before tool assembly — ADR
    # 0013 gates at construction, never after.
    surface = _surface_from_ids(ids)
    # Read the panel's essay once, before tool assembly: it decides both the
    # write mode the content tools are built with and the prompt's essay block,
    # and one read keeps those two from disagreeing about the same turn.
    turn_essay = await _load_turn_essay(deps, ids) if surface is Surface.ESSAY else None
    write_mode = _write_mode(surface, turn_essay)

    # --- assemble the toolset (ADR 0013: disabled sources never constructed) ---
    tool_deps = getattr(deps, "tool_deps", None) or make_tool_deps(settings, deps.catalog)
    plan_state = PlanState()
    extra_tools: list[Tool[Any]] = [*build_db_tools(deps.catalog, tool_overflow, surface=surface)]
    if surface is Surface.CHAT:
        # Data visualization is a chat-surface answer format; the essay panel
        # never renders one, so the tool is not constructed there (ADR 0013).
        extra_tools.append(
            _make_render_viz_tool(
                deps.catalog, registry, viz_list, viz_signature_indexes, tool_overflow
            )
        )
    extra_tools.append(_make_read_tool_result_tool(overflow_store))
    extra_tools.append(_make_load_skill_tool(tool_overflow))
    if goal_mode or (
        not _forbid_plan_request(user_text)
        and (requested_narration is None or _explicit_plan_request(user_text))
    ):
        # C1: a goal turn always mounts write_plan, bypassing BOTH clauses of
        # the ordinary suppression gate — the run narrates its own plan
        # regardless of what this turn's text says about narration/planning.
        extra_tools.insert(0, Tool(make_write_plan_tool(plan_state), takes_ctx=False))
    # Workspace tools (ADR 0013: unmounted, not hidden) — only exist this turn
    # when the turn carries an authenticated user AND the app pool + workspace
    # event bus are wired in (eval runner / CLI pass no user_id → unmounted).
    workspace_events = getattr(deps, "workspace_events", None)
    user_id = ids.get("user_id")
    if user_id and deps.app_pool and workspace_events:
        workspace_tools = build_workspace_tools(
            deps.app_pool,
            deps.catalog,
            workspace_events,
            UUID(user_id),
            tool_overflow,
            write_mode=write_mode,
            turn_message_id=message_id,
        )
        if surface is Surface.ESSAY:
            workspace_tools = [
                tool for tool in workspace_tools if tool.name in _ESSAY_SURFACE_WORKSPACE_TOOLS
            ]
        extra_tools.extend(workspace_tools)
    tools = build_tools(
        source_config,
        tool_deps,
        registry,
        today,
        extra_tools=extra_tools,
        tool_overflow=tool_overflow,
    )

    # Server-owned Quick/Think resolution (plans/quick-think-response-mode.md
    # §5.2): the node never accepts a browser model ID or trusts an old
    # checkpoint's model string — it re-resolves from the SAME pure function
    # run_turn used, off the response_mode run_turn already persisted into
    # turn_ids, so meta/turn_ids/usage/model-invoked can never diverge.
    response_mode = _response_mode_from_ids(ids)
    selection = counselor_model_selection(response_mode, settings)
    # D15: a goal turn runs on the cheap tier by default, not the counselor
    # tier re-resolved above — a real quality/cost tradeoff, made explicit
    # rather than inherited. `goal_model` empty falls back to `model_cheap`,
    # the same "" => model_cheap seam `app/model_selection.py` already uses
    # for the judge/criteria calls. Read only for a goal turn — never touched
    # on an ordinary turn, so a minimal test double need not carry the knob.
    goal_model_setting = goal_agent_model_setting(settings) if goal_mode else ""
    injected_model_factory = getattr(deps, "model_factory", None)
    student_context = state.get("student_context") or STUDENT_CONTEXT_UNAUTHENTICATED
    if surface is Surface.ESSAY:
        base_instructions = build_essay_system_prompt(
            state["temporal"]["context"],
            student_context,
            _essay_context_block(turn_essay, ids, settings.essay_context_max_chars),
        )
    else:
        base_instructions = build_system_prompt(
            state["temporal"]["context"],
            student_context,
            state.get("data_picture", "Live data picture unavailable in this test harness."),
        )
    # R2: render_source_availability must describe what was actually mounted,
    # not merely what was requested — build_tools additionally gates .edu on
    # a nonempty catalog (empty-catalog demo deployments), and if the prompt
    # claims ".edu is enabled and mounted" while no such tool exists, the
    # model's call gets pydantic-ai's unknown-tool retry (not a teaching
    # payload) and the step is silently suppressed (search_school_site is in
    # GATEABLE_TOOLS - mounted) with no disclosure to the student.
    mounted_names = {tool.name for tool in tools}
    source_instructions = render_source_availability(
        source_config.model_copy(
            update={"edu": source_config.edu and "search_school_site" in mounted_names}
        )
    )
    # A chat turn always runs in a response mode (Focused Answer unless one
    # was chosen). A goal turn runs in goal mode instead, and the essay panel
    # has no mode picker, so both keep the selection as sent.
    selected_skills: list[str] = list(ids["selected_skills"])
    if goal_mode:
        selected_skills = without_response_mode(selected_skills)
    elif surface is Surface.CHAT:
        selected_skills = with_default_response_mode(selected_skills)
    selected_instructions = render_selected_skills(selected_skills)
    tool_budget = (
        [
            ToolRoundBudget(
                settings.focused_answer_max_tool_rounds, settings.focused_answer_max_searches
            )
        ]
        if surface is Surface.CHAT and FOCUSED_ANSWER in selected_skills
        else []
    )
    # D6: one shared RunUsage for the WHOLE turn — the agent's own iterations
    # AND (goal mode only) the criteria/judge calls — so every dollar spent
    # on this turn counts against one ledger (never invisible to it). Named
    # distinctly from the `usage`/`UsageData` wire-shape variable below, which
    # this feeds at the end of the run.
    shared_usage = RunUsage()
    goal_limits = goal_limits_from_settings(settings) if goal_mode else None
    goal_criteria: tuple[GoalCriterion, ...] = ()
    goal_not_checked_note = ""
    goal_instructions = ""
    goal_initial_cost_usd = 0.0
    goal_criteria_failed = False
    goal_statement = user_text
    goal_prior_receipts: list[StepData] = []
    inherited_goal = ids.get("goal") if goal_mode else None
    if isinstance(inherited_goal, dict):
        # A resumed run (the student answered the question the run paused
        # on): the statement, criteria and note are the ones frozen at goal
        # start, never re-derived — the answer changes what the agent does,
        # not what it is judged against.
        goal_statement = str(inherited_goal["statement"])
        goal_criteria = tuple(GoalCriterion.model_validate(c) for c in inherited_goal["criteria"])
        goal_not_checked_note = str(inherited_goal["not_checked_note"])
        goal_prior_receipts = [
            StepData.model_validate(step) for step in inherited_goal.get("prior_steps") or []
        ]
    if goal_mode:
        assert goal_limits is not None  # narrows for mypy; true whenever goal_mode
        # D12/C2: derived and frozen ONCE, before the agent is constructed —
        # never rebuilt per iteration. A derivation failure is this turn's
        # only honest option: fail the turn rather than run ungoverned.
        criteria_usage_before = _usage_tokens(shared_usage)
        try:
            if not isinstance(inherited_goal, dict):
                goal_criteria, goal_not_checked_note = await derive_criteria(
                    user_text, settings=settings, usage=shared_usage, today=today
                )
        except GoalCriteriaError:
            # §5.2 point 3b: derivation giving out is the SAME fact as the
            # judge giving out mid-run (C12), so it lands on the same
            # terminal state — a "final" step carrying `stopped_check_failed`
            # and no criteria, which the goal card renders as its own
            # actionable message. Left to propagate, it would reach
            # run_turn's generic failure path instead: a "something went
            # wrong on our side" banner with no goal card at all.
            logger.warning("goal criteria derivation failed", exc_info=True)
            goal_criteria_failed = True
        # `derive_criteria` spends against `shared_usage` before the
        # loop (and its ledger) exists — priced here, at its own model's
        # rate, and handed to `_run_goal_loop` as the ledger's starting
        # dollar total rather than folded into the agent-priced total later.
        goal_initial_cost_usd = _price_usage_delta(
            criteria_usage_before,
            _usage_tokens(shared_usage),
            goal_criteria_model_setting(settings),
            settings,
        )
        # The ledger a criteria-failure "final" step reports: derivation is
        # the only thing that spent anything on this turn, so its spend is
        # the whole truth — reported, never rounded away to a clean zero.
        criteria_ledger = GoalLedger()
        _update_goal_ledger_totals(criteria_ledger, shared_usage)
        criteria_ledger.cost_usd = goal_initial_cost_usd
        if not goal_criteria_failed:
            goal_instructions = render_goal_mode(goal_statement, goal_criteria, today)
        writer(
            {
                "type": "step",
                "data": ev_step(
                    _goal_step(
                        phase="final" if goal_criteria_failed else "criteria",
                        statement=goal_statement,
                        criteria=goal_criteria,
                        verdict=None,
                        checked_by_id={},
                        ledger=criteria_ledger if goal_criteria_failed else GoalLedger(),
                        limits=goal_limits,
                        not_checked_note=goal_not_checked_note,
                        requests_limit=settings.goal_max_model_requests,
                        tokens_limit=settings.goal_max_total_tokens,
                        status="stopped_check_failed" if goal_criteria_failed else None,
                    )
                ).data,
            }
        )
    instructions = "\n\n".join(
        part
        for part in (
            base_instructions,
            source_instructions,
            selected_instructions,
            goal_instructions,
        )
        if part
    )
    # Phase 3 (plan architecture decision §5): a continuation turn (A2) is
    # identified by `turn_ids["continuation_of"]` (set by
    # app/run_turn.py's run_continuation_turn) and restricts to a text-only
    # output — ask_student is not merely unlikely to be re-emitted, it is not
    # in the advertised schema at all, so a second clarification round stays
    # impossible even if the model ignores the prompt. A goal turn is the
    # exception: it may pause on ask_student as often as it genuinely needs
    # the student's answer, and each resumed run is itself a goal turn.
    is_continuation = ids.get("continuation_of") is not None
    output_type: list[Any] = (
        [str] if (is_continuation and not goal_mode) else ask_student_output_type()
    )
    agent: Agent[TurnDeps, str | ClarifyDraftV2] = Agent(
        injected_model_factory()
        if injected_model_factory is not None
        else default_model_factory(
            settings,
            goal_model_setting if goal_mode else selection.model_setting,
            selection.reasoning_effort,
        ),
        instructions=instructions,
        deps_type=TurnDeps,
        tools=tools,
        # A tool that fails once for a transient/schema reason gets one more chance
        # before the turn dies (pydantic_ai default is 1; see
        # plans/fix-search-fields-resilience.md Bug C).
        retries=2,
        capabilities=[
            PlanReminder(plan_state),
            *compaction_capabilities(settings, writer, goal_mode=goal_mode),
            *tool_budget,
        ],
        # Normal-run output: prose or one validated ask_student draft
        # (app/clarification.py — factored out so an A2 continuation run can
        # pass output_type=[str] without duplicating this list). A2 never
        # includes ClarifyDraftV2 (above).
        output_type=output_type,
        # Explicit (plan Phase 2 bullet 2): PydanticAI's own default is already
        # "early", but a sibling function-tool call being skipped rather than
        # executed is safety-critical here, so it must never depend on an
        # unstated library default.
        end_strategy="early",
    )
    limits = (
        UsageLimits(
            # §2.7: a reserve is held back so the wrap-up (a second, tool-less
            # Agent run over the SAME shared usage) always has room.
            request_limit=settings.goal_max_model_requests - settings.goal_wrapup_reserve_requests,
            total_tokens_limit=settings.goal_max_total_tokens,
        )
        if goal_mode
        else UsageLimits(
            request_limit=settings.agent_max_model_requests,
            total_tokens_limit=settings.agent_max_total_tokens,
        )
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
        emit_thinking=settings.thinking_stream,
    )

    # --- the run. GraphInterrupt still flies for legacy/lower-level callers,
    #     after open steps close. `_run_once` (C7) owns the per-iteration
    #     begin/close lifecycle; this function owns how many times it runs
    #     and the one true-terminal `flush_final()` (spike correction, §6.0). ---
    messages_out = state["messages"]
    usage = UsageData(input_tokens=0, output_tokens=0, tool_calls=0)
    handle = None
    session_id = ids.get("session_id")
    handle_store = getattr(deps, "run_handles", None)
    if handle_store is not None and session_id is not None:
        handle = handle_store.get(str(session_id))
    result: Any = None
    completion_fallback: str | None = None
    goal_carried_state: dict[str, Any] | None = None
    turn_deps = TurnDeps(registry=registry, tool_overflow=tool_overflow, surface=surface)
    run_once_kwargs: dict[str, Any] = dict(
        turn_deps=turn_deps,
        router=router,
        final_writer=final_writer,
        recording_writer=recording_writer,
        writer=writer,
        emissions=emissions,
        handle=handle,
        parked_store=parked_store,
        parked_session_id=parked_session_id,
        message_id=message_id,
        parked_user_id=parked_user_id,
        registry=registry,
    )
    try:
        if requested_narration:
            recording_writer({"type": "narration", "text": requested_narration})
        if goal_criteria_failed:
            # C2/D12: the criteria are the contract the run is graded
            # against. Without them there is nothing to govern a loop with,
            # so the turn ends here — as an ordinary completed turn, so the
            # `stopped_check_failed` card emitted above is what the student
            # gets, rather than a generic error banner on top of it. No
            # model call is made; `result` stays None.
            pass
        elif not goal_mode:
            outcome = await _run_once(
                agent, user_text, history or None, usage=None, limits=limits, **run_once_kwargs
            )
            result = None if outcome.hit_budget else outcome.result
            completion_fallback = outcome.completion_fallback
        else:
            assert goal_limits is not None
            result, completion_fallback, goal_carried_state = await _run_goal_loop(
                agent,
                goal_statement,
                history or None,
                criteria=goal_criteria,
                not_checked_note=goal_not_checked_note,
                today=today,
                limits=limits,
                goal_limits=goal_limits,
                settings=settings,
                model_setting=goal_model_setting,
                reasoning_effort=selection.reasoning_effort,
                instructions=instructions,
                injected_model_factory=injected_model_factory,
                shared_usage=shared_usage,
                run_once_kwargs=run_once_kwargs,
                initial_cost_usd=goal_initial_cost_usd,
                prior_receipts=goal_prior_receipts,
                resume_prompt=user_text if isinstance(inherited_goal, dict) else None,
                carried_state=inherited_goal.get("ledger")
                if isinstance(inherited_goal, dict)
                else None,
            )
    finally:
        # THE one true-terminal call (spike S7 correction): fires exactly
        # once, after the single ordinary iteration or after the goal loop's
        # last iteration and any §2.7 wrap-up — on every exit path, including
        # a re-raised cancellation/interrupt/error, so a staged viz card or
        # an in-flight marker fragment is never silently lost.
        final_writer.flush_final()

    # Both a normal answer and the handled tool-budget answer are terminal.
    if parked_store is not None:
        parked_store.clear(parked_session_id, message_id, parked_user_id)

    if result is not None:
        messages_out = ModelMessagesTypeAdapter.dump_python(result.all_messages(), mode="json")
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
        result.output if result is not None and isinstance(result.output, ClarifyDraftV2) else None
    )
    is_clarify_result = clarify_draft is not None
    if clarify_draft is not None:
        clarify = build_pending_clarification(clarify_draft)
        # Phase 4 (plan architecture decision §3): the ordered pointer to
        # where the question sits in the replay chronology — always last,
        # since the question IS this run's terminal output. No payload: the
        # spec itself lives only on ``record["clarify"]``.
        emissions.append(("clarify", {}))
    # messages_offset: run_turn computes the authoritative value per path (new
    # turn vs resume) and threads it through turn_ids — the node never
    # recomputes it. resolve_offset's fallback covers direct-graph invocations
    # only (tests, pre-B1b checkpoints), where the tail is the user request.
    offset = resolve_offset(ids.get("messages_offset"), state["messages"])
    continuation_of = ids.get("continuation_of")
    if continuation_of is not None:
        # Phase 3 (plan "Turn-record identity"): `user_text` here is the
        # split MODEL prompt (the server-rendered clarify payload for a
        # widget origin, or the exact composer text for a reply origin) —
        # never the transcript projection by itself. run_continuation_turn
        # threads the exact projection (None for widget, U2's exact text for
        # reply) through turn_ids["record_user_text"] precisely so this never
        # accidentally becomes an editable user bubble/record anchor.
        record_user_text = ids.get("record_user_text")
    elif synthesized and prior_records:
        # user_text is the turn's QUESTION even on a synthesized legacy clarify
        # continuation. Agent V1 may feed a compatibility prompt to the model,
        # but the persisted record stays self-contained around the original
        # question so the read can render it id-less next to the synthesized
        # answer bubble.
        record_user_text = str(prior_records[-1].get("user_text") or user_text)
    else:
        record_user_text = user_text
    # Phase 4 ("Persist an immutable source_config snapshot on every v2 A1"):
    # only a fresh v2 ask_student result gets one — legacy v1 and ordinary
    # turns keep relying on the session-level sticky config, never a claimed
    # inheritance the record itself doesn't prove.
    record_source_config = source_config.model_dump(mode="json") if is_clarify_result else None
    # Phase 4 ("Expose editable_root_message_id=U1"): A1 names itself; A2
    # (continuation) resolves A1's own user_message_id from the
    # already-persisted prior records rather than duplicating it through a
    # second transport field.
    if continuation_of is not None:
        editable_root_message_id = find_root_user_message_id(prior_records, continuation_of)
    elif is_clarify_result:
        editable_root_message_id = str(ids["user_message_id"])
    else:
        editable_root_message_id = None
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
        # The student's own selection, not the run's effective one (defaulted
        # mode, or modes dropped on a goal turn): the UI rebuilds its picker
        # from this and a parked turn resumes with it.
        selected_skills=ids["selected_skills"],
        continuation_of=continuation_of,
        source_config=record_source_config,
        editable_root_message_id=editable_root_message_id,
        trigger_request_id=ids.get("trigger_request_id") if continuation_of is not None else None,
        response_origin=ids.get("response_origin") if continuation_of is not None else None,
        project_user=ids.get("project_user") if continuation_of is not None else None,
        goal=(
            {
                "statement": goal_statement,
                "criteria": [c.model_dump(mode="json") for c in goal_criteria],
                "not_checked_note": goal_not_checked_note,
                "prior_steps": [s.model_dump(mode="json") for s in goal_prior_receipts],
                # This segment's ledger/stall totals, so the next resume's
                # budgets and stall tracking pick up where this one left
                # off rather than starting over.
                "ledger": goal_carried_state,
            }
            if goal_mode and is_clarify_result
            else None
        ),
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
