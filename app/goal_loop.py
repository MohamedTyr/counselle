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
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from domain.events import GoalCriterionView, GoalPhase, GoalStepDetail
from domain.goal import (
    GoalCriterion,
    GoalLedger,
    GoalLimits,
    GoalStatus,
    GoalVerdict,
    decide_terminal_status,
    flat_checks_after,
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
    "awaiting_input": "Paused: Counselle needs your answer to continue.",
}

#: Step kinds that describe how the agent worked rather than what it did —
#: never sent to the judge as evidence, and never carried into a resumed run.
NOT_GOAL_EVIDENCE_KINDS = frozenset({"goal", "write_plan", "compaction"})

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
        max_flat_checks=settings.goal_stall_iterations,
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
    # Active seconds already spent in segments before this one — an
    # `ask_student` pause must not let wall-clock time spent waiting for the
    # student count against `max_wall_clock_s`, so this segment's own
    # monotonic clock (`started_monotonic`) starts fresh and this is added on
    # top of it, never the other way around.
    prior_elapsed_s: float = 0.0
    _prev_met: frozenset[str] | None = field(default=None, repr=False)
    _flat_checks: int = field(default=0, repr=False)

    def stamp_elapsed(self, ledger: GoalLedger) -> None:
        """Refresh *ledger*'s active-time total from this segment's own
        monotonic clock. `decide()` calls this itself; an exit path that
        ends a segment WITHOUT calling `decide()` this round — an
        `ask_student` pause, a hard budget stop, a cancellation, a crash —
        must call it directly, or the final step it emits reports a stale
        elapsed time left over from the previous round's `decide()` call.
        """
        ledger.elapsed_s = self.prior_elapsed_s + (time.monotonic() - self.started_monotonic)

    def decide(
        self,
        *,
        verdict: GoalVerdict | None,
        ledger: GoalLedger,
        cancelled: bool = False,
    ) -> GoalDecision:
        self.stamp_elapsed(ledger)
        met_ids = frozenset(c.criterion_id for c in (verdict.criteria if verdict else ()) if c.met)
        flat_checks = flat_checks_after(self._prev_met, met_ids, self._flat_checks)
        stalled = is_stalled(flat_checks, self.limits)
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
            self._flat_checks = flat_checks
            return GoalDecision(False, None, "")
        return GoalDecision(True, status, _STATUS_REASON[status])

    def carry_state(self, ledger: GoalLedger) -> dict[str, Any]:
        """What a pausing run persists onto the goal record so the next
        segment resumes the same budgets and stall tracking (the inverse of
        :meth:`from_carry`)."""
        carried = ledger.to_carry()
        carried["prev_met_ids"] = sorted(self._prev_met) if self._prev_met is not None else None
        carried["flat_checks"] = self._flat_checks
        return carried

    @classmethod
    def from_carry(
        cls,
        statement: str,
        criteria: tuple[GoalCriterion, ...],
        limits: GoalLimits,
        carried: Mapping[str, Any] | None,
    ) -> tuple[GoalLedger, GoalLoopController]:
        """Rebuild the ledger + controller a resumed goal turn continues
        from, seeded with the totals an ``ask_student`` pause carried
        forward, so a resumed run is judged against the WHOLE goal's budget
        and stall tracking, never a fresh one per segment. ``carried`` is a
        prior segment's :meth:`carry_state`, or ``None`` for a goal run's
        first segment, which seeds a completely fresh pair.
        """
        ledger = GoalLedger.from_carry(carried)
        prev_met_ids = carried.get("prev_met_ids") if carried else None
        controller = cls(
            statement=statement,
            criteria=criteria,
            limits=limits,
            prior_elapsed_s=ledger.elapsed_s,
            _prev_met=frozenset(prev_met_ids) if prev_met_ids is not None else None,
            _flat_checks=int(carried.get("flat_checks", 0)) if carried else 0,
        )
        return ledger, controller

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
            "Keep working on the outstanding criteria. Do not restate what is already done. "
            "If you genuinely cannot continue without the student's answer, ask with "
            "ask_student; the run pauses until they reply."
        )
        lines.append("</goal-check>")
        return "\n".join(lines)
