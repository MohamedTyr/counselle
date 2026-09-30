"""Focused Answer's tool budget: a cap on tool rounds and on searches.

A Focused Answer may call tools in its first ``max_tool_rounds`` model
requests. After that every tool is withdrawn — function tools and the
``ask_student`` output tool alike, so a clarifying question cannot stand in
for the answer — and one instruction says to answer from what was gathered.
The turn always ends in a text answer instead of the usage-limit apology.

Searches (web, a school's site, Reddit) are capped separately at
``max_searches`` per turn: once spent, the search tools are hidden, and any
extra search the model fired in the same parallel round returns a
search-limit error instead of running.

The search count is per-turn state: build one instance per turn's agent, never
share one across turns.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pydantic_ai import RunContext
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.capabilities.abstract import WrapToolExecuteHandler
from pydantic_ai.messages import ToolCallPart
from pydantic_ai.tools import ToolDefinition

from app.tool_middleware import SEARCH_TOOLS

BUDGET_SPENT_INSTRUCTION = (
    "Your tool budget for this answer is spent and no tools are available. "
    "Write the final answer now, in prose, from the evidence you already have, "
    "citing it as usual. Do not ask the student a question. Where something you "
    "would have checked is missing, say so in one short clause; do not apologise "
    "for the budget or describe your tools."
)

SEARCH_LIMIT_ERROR = {
    "error": "tool_error",
    "root_cause": "This answer's search limit is reached; this search did not run.",
    "safe_retry": "Do not search again this turn.",
    "stop_condition": "Answer from the evidence already gathered.",
}


@dataclass
class ToolRoundBudget(AbstractCapability[Any]):
    max_tool_rounds: int
    max_searches: int
    _searches: int = field(default=0, init=False)

    def _spent(self, ctx: RunContext[Any]) -> bool:
        return ctx.run_step > self.max_tool_rounds

    async def prepare_tools(
        self, ctx: RunContext[Any], tool_defs: list[ToolDefinition]
    ) -> list[ToolDefinition]:
        if self._spent(ctx):
            return []
        if self._searches >= self.max_searches:
            return [tool for tool in tool_defs if tool.name not in SEARCH_TOOLS]
        return tool_defs

    async def prepare_output_tools(
        self, ctx: RunContext[Any], tool_defs: list[ToolDefinition]
    ) -> list[ToolDefinition]:
        return [] if self._spent(ctx) else tool_defs

    async def wrap_tool_execute(
        self,
        ctx: RunContext[Any],
        *,
        call: ToolCallPart,
        tool_def: ToolDefinition,
        args: Any,
        handler: WrapToolExecuteHandler,
    ) -> Any:
        if call.tool_name in SEARCH_TOOLS:
            # Counted before the await, so parallel calls in one round are
            # counted in order and the ones past the limit never run.
            if self._searches >= self.max_searches:
                return dict(SEARCH_LIMIT_ERROR)
            self._searches += 1
        return await handler(args)

    def get_instructions(self) -> Any:
        def budget_instruction(ctx: RunContext[Any]) -> str | None:
            return BUDGET_SPENT_INSTRUCTION if self._spent(ctx) else None

        return budget_instruction
