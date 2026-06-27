"""Progress helper that writes a step event AND appends to emissions.

Research nodes call this instead of writing directly to avoid duplicating
the step-construction logic in each node.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from domain.events import StepData


def research_step(
    writer: Any,
    emissions: list[Any],
    phase_id: str,
    status: str,
    label: str,
    detail: str | None = None,
    sources: list[Any] | None = None,
) -> None:
    """Emit one research step event and record it in emissions.

    Args:
        writer: LangGraph get_stream_writer() result.
        emissions: The research["emissions"] list — mutated in place.
        phase_id: The phase identifier (used as step_id prefix).
        status: "running" | "complete" | "error"
        label: Human-readable label for the timeline.
        detail: Optional detail string.
        sources: Optional source chips list.
    """
    step = StepData(
        step_id=f"research_{phase_id}_{uuid4().hex[:8]}",
        kind="research",
        tier=None,
        label=label,
        status=status,  # type: ignore[arg-type]
        detail=None,
        sources=None,
    )
    data = step.model_dump(mode="json")
    writer({"type": "step", "data": data})
    emissions.append(("step", data))
