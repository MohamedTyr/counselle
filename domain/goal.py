"""Goal-mode honesty core (plans/goal-mode-plan.md Part 0, Part 3, §2.5, §2.6).

Pure stdlib + pydantic (ADR 0017): no I/O, no model calls, no ``app``/
``adapters``/``api`` imports. Where the six terminal states (§2.6) and the
C9/C10 honesty corrections are decided — exactly one copy of this logic (§6.2).

``GoalStepDetail``/``GoalCriterionView``/``GoalPhase`` ship with
``domain/events.py`` in Phase 3 — NOT here. ``GoalLoopController``/
``GoalDecision`` are Phase 3's, in ``app/goal_loop.py``.
"""

from __future__ import annotations

from collections.abc import Collection, Iterable, Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

# THE single source of truth for the terminal states (§0.1, §2.5, §2.6,
# §5.3). Imported by domain/events.py's GoalStepDetail (Phase 3) and
# app/goal_loop.py's GoalLoopController — never redefined elsewhere.
# ``awaiting_input`` is the one state :func:`decide_terminal_status` never
# returns: it is not a judgment about the goal but the agent's own explicit
# pause (an ``ask_student`` output), set by the loop before any check runs.
# The run resumes as a clarify continuation carrying the same frozen criteria.
GoalStatus = Literal[
    "achieved",  # every criterion met AND checked
    "partial",  # stopped for a non-limit reason (tool-error escalation)
    "stopped_budget",  # a limit stopped it: iterations, wall clock, cost, tokens, requests
    "stopped_no_progress",  # stalled for goal_stall_iterations
    "stopped_user",  # the student pressed Stop
    "stopped_check_failed",  # the judge itself failed after its retries (C12)
    "awaiting_input",  # the agent asked the student a question; resumes with their answer
]


class GoalCriterion(BaseModel):
    """One frozen, binary acceptance criterion (§3.2) — derived once at goal
    start, never mutated: the contract the run is graded against."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str  # "c1".."c6" — stable for the run
    text: str  # one binary, checkable sentence


class CriterionVerdict(BaseModel):
    """One criterion's judged outcome for one round (§3.4).

    ``met`` is already CODE-CORRECTED (C9/C10 via :func:`compute_checked`) —
    never the judge's raw claim. ``evidence_step_ids`` is exactly what the
    judge cited, unfiltered, so a hallucinated id stays visible for audit
    (C10). ``checked`` is deliberately NOT a field: it is derived fresh from
    ``evidence_step_ids`` against the bundle actually sent, wherever that
    bundle is known, rather than baked in and left able to go stale.

    ``met`` is ``bool | None``: ``None`` means the judge never assessed this
    criterion at all (it was omitted from the judge's raw response) — a
    distinct state from ``False`` (assessed and not satisfied). C9 forbids
    representing "not checked" as "checked and failed"; typing ``met`` as
    ``bool`` would force exactly that collapse on every omitted criterion.
    ``None`` behaves as falsy everywhere this is combined with ``all()``/
    truthiness (:attr:`GoalVerdict.met`, callers' met/unmet derivations), so
    the "achieved only if every criterion is genuinely met" invariant holds
    without a criterion ever needing special-casing.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    criterion_id: str
    met: bool | None  # binary, code-corrected; None = never assessed (C9). Not a score.
    reason: str  # one sentence naming what it relied on
    evidence_step_ids: tuple[str, ...] = ()  # C10 — as cited, validated elsewhere


class GoalVerdict(BaseModel):
    """The judge's full verdict for one round (§3.4). ``met`` is derived,
    never settable, so ``met=true`` beside a failing/unchecked criterion is
    impossible — the overall verdict is always derived, never generated."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    criteria: tuple[CriterionVerdict, ...]
    critique: str

    @property
    def met(self) -> bool:
        # `all()` treats a criterion's `met=None` (never assessed, C9) exactly
        # like `met=False`: an unassessed criterion can never contribute to
        # "achieved" — unknown is not evidence of success.
        return bool(self.criteria) and all(c.met for c in self.criteria)


@dataclass
class GoalLedger:
    """The mutable spend/progress record a goal run accumulates (§2.5, §2.6).
    Flattened onto ``GoalStepDetail``'s ledger fields at emit time (Phase 3);
    this is the one source of truth those fields are populated *from*."""

    requests_used: int = 0
    tokens_used: int = 0
    cost_usd: float = 0.0
    elapsed_s: float = 0.0
    iteration: int = 0
    consecutive_tool_errors: int = 0

    def to_carry(self) -> dict[str, Any]:
        """The totals that survive an ``ask_student`` pause: iteration
        count, cost, active elapsed time, and consecutive tool errors — a
        resumed goal turn is judged against the whole goal's budget, never a
        fresh one per segment. Never ``requests_used``/``tokens_used``: those
        back pydantic-ai's own per-run ``UsageLimits``, a hard per-segment
        safety stop rather than the run's budget, so each segment gets a
        fresh ``UsageLimits`` and these two fields are recomputed fresh from
        that segment's own ``RunUsage`` rather than carried across a pause.
        """
        return {
            "iteration": self.iteration,
            "cost_usd": self.cost_usd,
            "elapsed_s": self.elapsed_s,
            "consecutive_tool_errors": self.consecutive_tool_errors,
        }

    @classmethod
    def from_carry(cls, carried: Mapping[str, Any] | None) -> GoalLedger:
        """The inverse of :meth:`to_carry` — a fresh ledger seeded with a
        prior segment's totals, or an empty one for a goal run's first
        segment (``carried`` is ``None``)."""
        if not carried:
            return cls()
        return cls(
            iteration=int(carried.get("iteration", 0)),
            cost_usd=float(carried.get("cost_usd", 0.0)),
            elapsed_s=float(carried.get("elapsed_s", 0.0)),
            consecutive_tool_errors=int(carried.get("consecutive_tool_errors", 0)),
        )


@dataclass(frozen=True)
class GoalLimits:
    """Thresholds :func:`decide_terminal_status` checks the ledger against.

    Owned here, not in ``app/goal_loop.py`` (ADR 0017 forbids ``domain``
    importing ``app``; there must be exactly one limits shape) —
    ``GoalLoopController`` (Phase 3) builds one from ``Settings`` and reuses
    it. Cost is a post-hoc ``cost_usd >= max_cost_usd`` check; D14's
    *projected*, before-you-spend check is the controller's own job.
    """

    max_iterations: int
    max_wall_clock_s: float
    max_cost_usd: float | None
    max_consecutive_tool_errors: int
    max_flat_checks: int


def decide_terminal_status(
    *,
    verdict: GoalVerdict | None,
    ledger: GoalLedger,
    limits: GoalLimits,
    stalled: bool,
    cancelled: bool,
) -> GoalStatus | None:
    """Map *(verdict, ledger, limits, stalled, cancelled)* to a terminal
    :data:`GoalStatus`, or ``None`` if the run should keep going (§2.5, §6.2).

    ``verdict=None`` is the C12 judge-failure signal: the caller passes a
    verdict only when the judge produced one; after ``goal_judge_retries`` is
    exhausted it passes ``None``. There is no separate ``judge_failed`` flag
    — "the judge failed" and "there is no fresh verdict" are the same fact.
    Precedence mirrors §2.5; see the inline comments below for the order and
    why each check comes before the next.
    """
    if cancelled:
        return "stopped_user"  # the student's Stop always wins
    if verdict is None:
        return "stopped_check_failed"  # C12 — can't evaluate .met on nothing
    if verdict.met:
        # Checked BEFORE any budget check: a limit firing only after every
        # criterion is already met still reports as an achievement, never a
        # downgrade (C3).
        return "achieved"
    budget_exhausted = (
        ledger.iteration >= limits.max_iterations
        or ledger.elapsed_s >= limits.max_wall_clock_s
        or (limits.max_cost_usd is not None and ledger.cost_usd >= limits.max_cost_usd)
    )
    if budget_exhausted:
        return "stopped_budget"
    if stalled:
        return "stopped_no_progress"
    if ledger.consecutive_tool_errors >= limits.max_consecutive_tool_errors:
        return "partial"  # a non-limit stop, distinct from stopped_budget
    return None


def calendar_context(today: date | None) -> str:
    """Today and the weeks around it, spelled out as dates. The criteria
    writer, the agent and the judge all read this same text, so "this week"
    is one fixed range rather than three models' separate arithmetic."""
    if today is None:
        return "(not given)"
    monday = today - timedelta(days=today.weekday())

    def week(start: date) -> str:
        return f"{start.isoformat()} (Monday) to {(start + timedelta(days=6)).isoformat()} (Sunday)"

    return (
        f"Today is {today.strftime('%A')}, {today.isoformat()}.\n"
        f"This week: {week(monday)}.\n"
        f"Next week: {week(monday + timedelta(days=7))}."
    )


def flat_checks_after(
    prev_met_criterion_ids: frozenset[str] | None,
    current_met_criterion_ids: frozenset[str],
    flat_checks: int,
) -> int:
    """The running count of consecutive checks that met nothing new. The
    first check has no previous state and is never flat; a check that meets
    a criterion the one before it did not resets the count."""
    if prev_met_criterion_ids is None:
        return 0
    if current_met_criterion_ids - prev_met_criterion_ids:
        return 0
    return flat_checks + 1


def is_stalled(flat_checks: int, limits: GoalLimits) -> bool:
    """True when ``max_flat_checks`` checks in a row met nothing new (§2.5).

    Judged from the check's own results and nothing else. How the agent
    works — whether it keeps a plan, what the plan says, whether it changed
    — is the agent's business and is never an input to stopping a run.
    """
    return flat_checks >= limits.max_flat_checks


def validate_evidence_ids(
    evidence_step_ids: Iterable[str], bundle_step_ids: Collection[str]
) -> frozenset[str]:
    """Subset of *evidence_step_ids* actually in the evidence bundle sent to
    the judge (C10) — a fabricated ``step_id`` is filtered out, never trusted."""
    bundle = (
        bundle_step_ids if isinstance(bundle_step_ids, (set, frozenset)) else set(bundle_step_ids)
    )
    return frozenset(sid for sid in evidence_step_ids if sid in bundle)


def compute_checked(
    verdict_met: bool,
    evidence_step_ids: Iterable[str],
    bundle_step_ids: Collection[str],
    unknown_step_ids: Collection[str] = (),
) -> tuple[bool, bool]:
    """Derive ``(checked, met)`` for one criterion, purely from citations
    validated against the evidence bundle actually sent (§3.4).

    Citing nothing valid -> ``checked=False`` -> ``met=False``: the C9 "not
    done" vs "never checked" distinction, and C10's guard against the judge's
    own prose — a ``reason`` naming no valid ``step_id`` cannot support
    ``met=True`` regardless of what it claims. Citing only ``"unknown"``-
    outcome receipts forces ``met=False`` even if the judge said
    ``met=True`` — §27.8's honesty vocabulary honored in code, not prompt.

    ``unknown_step_ids`` is the subset of *bundle_step_ids* whose
    ``WorkspaceMutationReceipt.outcome == "unknown"`` — computed by the
    caller (which has the actual receipts); this stays pure and
    receipt-shape-agnostic.
    """
    valid = validate_evidence_ids(evidence_step_ids, bundle_step_ids)
    checked = bool(valid)
    all_unknown = checked and valid.issubset(set(unknown_step_ids))
    met = bool(verdict_met and checked and not all_unknown)
    return checked, met
