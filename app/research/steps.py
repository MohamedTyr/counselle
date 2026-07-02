"""Progress helper that writes a step event AND appends to emissions.

Research nodes call this instead of writing directly to avoid duplicating
the step-construction logic in each node.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, Literal

from domain.events import StepData, StepDetail, StepKind, StepSource, StepStatus, StepTier, ev_step

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
    detail: StepDetail | dict[str, Any] | str | None = None,
    sources: Sequence[StepSource | dict[str, Any]] | None = None,
    *,
    kind: StepKind = "research",
    tier: StepTier | None = None,
) -> None:
    """Emit one research step event and record it in emissions.

    Args:
        writer: LangGraph get_stream_writer() result.
        emissions: The research["emissions"] list — mutated in place.
        phase_id: The phase identifier (used as step_id prefix).
        status: "running" | "complete" | "error"
        label: Human-readable label for the timeline.
        detail: Optional receipt payload. A string is stored as a safe tool
            label for legacy callers.
        sources: Optional source chips list.
        kind: Protocol step kind for the phase.
        tier: Optional source tier for the phase.
    """
    step_status = _STATUS_MAP[status]
    step = StepData(
        step_id=f"research_{phase_id}",
        kind=kind,
        tier=tier,
        label=label,
        status=step_status,
        detail=_coerce_detail(detail),
        sources=_coerce_sources(sources) if step_status != "start" else None,
    )
    data = ev_step(step).data
    writer({"type": "step", "data": data})
    emissions.append(("step", data))


def _coerce_detail(detail: StepDetail | dict[str, Any] | str | None) -> StepDetail | None:
    if detail is None:
        return None
    if isinstance(detail, StepDetail):
        return detail
    if isinstance(detail, str):
        return StepDetail(tool=detail)
    return StepDetail.model_validate(detail)


def _coerce_sources(
    sources: Sequence[StepSource | dict[str, Any]] | None,
) -> list[StepSource] | None:
    if not sources:
        return None
    return [
        source if isinstance(source, StepSource) else StepSource.model_validate(source)
        for source in sources
    ]
