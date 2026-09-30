"""Focused Answer's tool-round budget.

A Focused Answer may call tools in its first ``max_tool_rounds`` model
requests. After that every tool is withdrawn — function tools and the
``ask_student`` output tool alike, so a clarifying question cannot stand in
for the answer — and one instruction says to answer from what was gathered.
The turn always ends in a text answer instead of the usage-limit apology.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pydantic_ai import RunContext
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.tools import ToolDefinition

BUDGET_SPENT_INSTRUCTION = (
    "Your tool budget for this answer is spent and no tools are available. "
    "Write the final answer now, in prose, from the evidence you already have, "
    "citing it as usual. Do not ask the student a question. Where something you "
    "would have checked is missing, say so in one short clause; do not apologise "
    "for the budget or describe your tools."
)


@dataclass
class ToolRoundBudget(AbstractCapability[Any]):
    max_tool_rounds: int

    def _spent(self, ctx: RunContext[Any]) -> bool:
        return ctx.run_step > self.max_tool_rounds

    async def prepare_tools(
        self, ctx: RunContext[Any], tool_defs: list[ToolDefinition]
    ) -> list[ToolDefinition]:
        return [] if self._spent(ctx) else tool_defs

    async def prepare_output_tools(
        self, ctx: RunContext[Any], tool_defs: list[ToolDefinition]
    ) -> list[ToolDefinition]:
        return [] if self._spent(ctx) else tool_defs

    def get_instructions(self) -> Any:
        def budget_instruction(ctx: RunContext[Any]) -> str | None:
            return BUDGET_SPENT_INSTRUCTION if self._spent(ctx) else None

        return budget_instruction
