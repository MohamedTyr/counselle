"""Progress helper that writes a step event AND appends to emissions.

Research nodes call this instead of writing directly to avoid duplicating
the step-construction logic in each node.
"""

from __future__ import annotations

from typing import Any, Literal

from domain.events import StepData, StepStatus, ev_step

_STATUS_MAP: dict[str, StepStatus] = {
    "running": "start",
    "complete": "end",
    "error": "error",
    "start": "start",
    "end": "end",
}

ResearchStepStatus = Literal["running", "complete", "error", "start", "end"]


def research_step(
    writer: Any,
    emissions: list[Any],
    phase_id: str,
    status: ResearchStepStatus,
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
    step_status = _STATUS_MAP[status]
    step = StepData(
        step_id=f"research_{phase_id}",
        kind="research",
        tier=None,
        label=label,
        status=step_status,
        detail=None,
        sources=None,
    )
    data = ev_step(step).data
    writer({"type": "step", "data": data})
    emissions.append(("step", data))
