"""The goal-mode iteration controller (plans/goal-mode-plan.md §2.5, §2.6, §6.3).

Pure decision logic + wire-shape builders — no I/O beyond what its callers
hand it (the judge call itself lives in ``app/goal_judge.py``;
``run_agent_node`` owns the actual loop and every model/judge call).
:func:`domain.goal.decide_terminal_status` is THE single source of truth for
the six terminal states — :class:`GoalLoopController` is the stateful wrapper
around it that tracks iteration/stall/cost bookkeeping across rounds, never a
second copy of the decision itself.
"""

from __future__ import annotations

import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from app.plan_tool import PlanItem, render_plan
from domain.events import GoalCriterionView, GoalPhase, GoalStepDetail
from domain.goal import (
    GoalCriterion,
    GoalLedger,
    GoalLimits,
    GoalStatus,
    GoalVerdict,
    decide_terminal_status,
    is_stalled,
)

if TYPE_CHECKING:
    from config.settings import Settings

#: One user-facing sentence per terminal status (§0.1) — the wrap-up prompt
#: and the "final" step both cite the same fixed vocabulary, never model prose.
_STATUS_REASON: dict[GoalStatus, str] = {
    "achieved": "Every criterion was met and checked.",
    "partial": "Stopped after repeated tool failures; some criteria remain.",
    "stopped_budget": "Stopped: the run's budget (requests, tokens, cost, or time) was reached.",
    "stopped_no_progress": "Stopped: no new progress across consecutive rounds.",
    "stopped_user": "Stopped: you asked Counselle to stop.",
    "stopped_check_failed": "Stopped: the independent check could not complete.",
}

_PHASE_LABEL: dict[GoalPhase, str] = {
    "criteria": "Set goal criteria",
    "check": "Checked progress against the goal",
    "final": "Finished the goal run",
}


def phase_label(phase: GoalPhase) -> str:
    return _PHASE_LABEL[phase]


def status_reason(status: GoalStatus) -> str:
    """The fixed, code-owned sentence for a terminal status (§0.1) — the
    wrap-up prompt and the "final" step cite this, never model prose.
    """
    return _STATUS_REASON[status]


def goal_limits_from_settings(settings: Settings) -> GoalLimits:
    """Build the frozen :class:`GoalLimits` this run is judged against."""
    return GoalLimits(
        max_iterations=settings.goal_max_iterations,
        max_wall_clock_s=settings.goal_max_wall_clock_s,
        max_cost_usd=settings.goal_max_cost_usd,
        max_consecutive_tool_errors=settings.goal_max_consecutive_tool_errors,
    )


def criterion_views(
    criteria: Sequence[GoalCriterion],
    verdict: GoalVerdict | None,
    checked_by_id: dict[str, bool],
) -> list[GoalCriterionView]:
    """The wire view of every frozen criterion against the latest verdict
    (or none yet, before the first check) — C9's "not checked" is the
    default, never inferred as a pass.
    """
    by_id = {v.criterion_id: v for v in (verdict.criteria if verdict is not None else ())}
    views: list[GoalCriterionView] = []
    for criterion in criteria:
        v = by_id.get(criterion.id)
        views.append(
            GoalCriterionView(
                id=criterion.id,
                text=criterion.text,
                met=v.met if v is not None else None,
                checked=checked_by_id.get(criterion.id, False),
                reason=v.reason if v is not None else None,
                evidence_step_ids=v.evidence_step_ids if v is not None else (),
            )
        )
    return views


def build_goal_step_detail(
    *,
    phase: GoalPhase,
    statement: str,
    criteria: Sequence[GoalCriterion],
    verdict: GoalVerdict | None,
    checked_by_id: dict[str, bool],
    ledger: GoalLedger,
    limits: GoalLimits,
    not_checked_note: str,
    requests_limit: int = 0,
    tokens_limit: int = 0,
    status: GoalStatus | None = None,
    critique: str | None = None,
) -> GoalStepDetail:
    """The code-owned ledger + criteria payload for one `kind:"goal"` beat
    (§2.6) — every field here is computed, never model-authored.
    """
    views = criterion_views(criteria, verdict, checked_by_id)
    return GoalStepDetail(
        phase=phase,
        statement=statement,
        status=status,
        iteration=ledger.iteration,
        max_iterations=limits.max_iterations,
        criteria=views,
        critique=critique if critique is not None else (verdict.critique if verdict else None),
        met_count=sum(1 for v in views if v.met),
        total_count=len(views),
        unchecked_count=sum(1 for v in views if not v.checked),
        not_checked_note=not_checked_note,
        requests_used=ledger.requests_used,
        requests_limit=requests_limit,
        tokens_used=ledger.tokens_used,
        tokens_limit=tokens_limit,
        est_cost_usd=ledger.cost_usd,
        cost_limit_usd=limits.max_cost_usd,
        elapsed_s=ledger.elapsed_s,
    )


@dataclass(frozen=True)
class GoalDecision:
    """One call's verdict on whether the run keeps going (§2.5)."""

    stop: bool
    status: GoalStatus | None  # None while the run continues
    reason: str


@dataclass
class GoalLoopController:
    """Stateful wrapper around :func:`domain.goal.decide_terminal_status` —
    tracks iteration/stall/cost bookkeeping across rounds; the terminal-state
    decision itself is made exactly once, in ``domain/goal.py`` (§6.2's "one
    copy of this logic" rule).
    """

    statement: str
    criteria: tuple[GoalCriterion, ...]
    limits: GoalLimits
    started_monotonic: float = field(default_factory=time.monotonic)
    avg_cost_per_iteration: float = 0.0
    _prev_met: frozenset[str] | None = field(default=None, repr=False)
    _prev_plan_signature: str | None = field(default=None, repr=False)

    def plan_signature(self, plan_items: list[PlanItem]) -> str:
        return render_plan(plan_items)

    def decide(
        self,
        *,
        verdict: GoalVerdict | None,
        ledger: GoalLedger,
        plan_signature: str,
        cancelled: bool = False,
    ) -> GoalDecision:
        ledger.elapsed_s = time.monotonic() - self.started_monotonic
        met_ids = frozenset(c.criterion_id for c in (verdict.criteria if verdict else ()) if c.met)
        stalled = is_stalled(self._prev_met, met_ids, self._prev_plan_signature, plan_signature)
        # D14: a PROJECTED-cost check, before another round is allowed to
        # spend — the only *hard*, library-enforced ceilings are requests/
        # tokens; this is the soft, before-you-spend cost guard.
        if (
            not cancelled
            and verdict is not None
            and not verdict.met
            and self.limits.max_cost_usd is not None
            and ledger.cost_usd + self.avg_cost_per_iteration > self.limits.max_cost_usd
        ):
            return GoalDecision(True, "stopped_budget", _STATUS_REASON["stopped_budget"])
        status = decide_terminal_status(
            verdict=verdict, ledger=ledger, limits=self.limits, stalled=stalled, cancelled=cancelled
        )
        if status is None:
            self._prev_met = met_ids
            self._prev_plan_signature = plan_signature
            return GoalDecision(False, None, "")
        return GoalDecision(True, status, _STATUS_REASON[status])

    def nudge_text(self, verdict: GoalVerdict) -> str:
        """The next round's model prompt (§2.5) — carries the judge's
        finding forward; never restates what is already done.
        """
        by_id = {c.id: c.text for c in self.criteria}
        unmet = [c for c in verdict.criteria if not c.met]
        met_n = len(verdict.criteria) - len(unmet)
        lines = [f"<goal-check>\nNot done yet. Met: {met_n} of {len(verdict.criteria)}."]
        if unmet:
            lines.append("Still outstanding:")
            lines.extend(f"  - [{c.criterion_id}] {by_id.get(c.criterion_id, '')}" for c in unmet)
        if verdict.critique:
            lines.append(f"Judge note: {verdict.critique}")
        lines.append(
            "Keep working on the outstanding criteria. Do not restate what is already done."
        )
        lines.append("</goal-check>")
        return "\n".join(lines)
