"""Honesty-critical tests for the goal-mode core (plans/goal-mode-plan.md §6.2).

This is the module the plan calls "the honesty-critical phase of the whole
feature" — a rubber-stamping judge or a mis-derived terminal status makes
every other guarantee in the feature decorative. Every terminal-state test
here targets :func:`decide_terminal_status` directly, per the plan's
instruction that there be exactly one copy of this decision logic.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from domain.goal import (
    CriterionVerdict,
    GoalCriterion,
    GoalLedger,
    GoalLimits,
    GoalVerdict,
    compute_checked,
    decide_terminal_status,
    flat_checks_after,
    is_stalled,
    validate_evidence_ids,
)


def _limits(**overrides: object) -> GoalLimits:
    defaults: dict[str, object] = {
        "max_iterations": 6,
        "max_wall_clock_s": 3600.0,
        "max_cost_usd": 3.0,
        "max_consecutive_tool_errors": 3,
        "max_flat_checks": 2,
    }
    defaults.update(overrides)
    return GoalLimits(**defaults)  # type: ignore[arg-type]


def _verdict(*, met_ids: tuple[str, ...] = (), unmet_ids: tuple[str, ...] = ()) -> GoalVerdict:
    criteria = tuple(
        CriterionVerdict(criterion_id=cid, met=True, reason="done", evidence_step_ids=("s1",))
        for cid in met_ids
    ) + tuple(
        CriterionVerdict(criterion_id=cid, met=False, reason="not done", evidence_step_ids=())
        for cid in unmet_ids
    )
    return GoalVerdict(criteria=criteria, critique="round summary")


class TestDecideTerminalStatus:
    """All six terminal states (§2.6), including the two honesty-load-bearing
    budget/achievement interactions the plan calls out explicitly (C3)."""

    def test_cancelled_wins_over_everything_else(self) -> None:
        verdict = _verdict(met_ids=("c1",))
        ledger = GoalLedger(iteration=99)
        status = decide_terminal_status(
            verdict=verdict,
            ledger=ledger,
            limits=_limits(max_iterations=1),
            stalled=True,
            cancelled=True,
        )
        assert status == "stopped_user"

    def test_judge_failure_is_verdict_none(self) -> None:
        status = decide_terminal_status(
            verdict=None, ledger=GoalLedger(), limits=_limits(), stalled=False, cancelled=False
        )
        assert status == "stopped_check_failed"

    def test_budget_exhausted_with_all_criteria_met_is_achieved(self) -> None:
        """A limit firing after every criterion is met is still an
        achievement (C3) — achieved must be checked BEFORE budget."""
        verdict = _verdict(met_ids=("c1", "c2"))
        ledger = GoalLedger(iteration=10, elapsed_s=9999.0, cost_usd=999.0)
        status = decide_terminal_status(
            verdict=verdict,
            ledger=ledger,
            limits=_limits(max_iterations=1, max_wall_clock_s=1, max_cost_usd=0.01),
            stalled=False,
            cancelled=False,
        )
        assert status == "achieved"

    def test_budget_exhausted_with_one_unmet_is_stopped_budget_never_achieved(self) -> None:
        verdict = _verdict(met_ids=("c1",), unmet_ids=("c2",))
        ledger = GoalLedger(iteration=6)
        status = decide_terminal_status(
            verdict=verdict,
            ledger=ledger,
            limits=_limits(max_iterations=6),
            stalled=False,
            cancelled=False,
        )
        assert status == "stopped_budget"

    def test_budget_exhausted_with_one_unassessed_is_stopped_budget_never_achieved(self) -> None:
        """C9: an omitted (never-assessed, `met=None`) criterion must be as
        disqualifying for "achieved" as a genuinely unmet one -- the run
        must not be reported as an accomplishment while a criterion's true
        state is unknown, not just when it is known-failed."""
        criteria = (
            CriterionVerdict(criterion_id="c1", met=True, reason="done", evidence_step_ids=("s1",)),
            CriterionVerdict(criterion_id="c2", met=None, reason="", evidence_step_ids=()),
        )
        verdict = GoalVerdict(criteria=criteria, critique="ran out of time")
        ledger = GoalLedger(iteration=6)
        status = decide_terminal_status(
            verdict=verdict,
            ledger=ledger,
            limits=_limits(max_iterations=6),
            stalled=False,
            cancelled=False,
        )
        assert status == "stopped_budget"

    def test_wall_clock_exhaustion_is_stopped_budget(self) -> None:
        verdict = _verdict(unmet_ids=("c1",))
        ledger = GoalLedger(elapsed_s=4000.0)
        status = decide_terminal_status(
            verdict=verdict,
            ledger=ledger,
            limits=_limits(max_wall_clock_s=3600.0),
            stalled=False,
            cancelled=False,
        )
        assert status == "stopped_budget"

    def test_cost_exhaustion_is_stopped_budget(self) -> None:
        verdict = _verdict(unmet_ids=("c1",))
        ledger = GoalLedger(cost_usd=5.0)
        status = decide_terminal_status(
            verdict=verdict,
            ledger=ledger,
            limits=_limits(max_cost_usd=3.0),
            stalled=False,
            cancelled=False,
        )
        assert status == "stopped_budget"

    def test_no_cost_cap_never_triggers_budget_on_cost_alone(self) -> None:
        verdict = _verdict(unmet_ids=("c1",))
        ledger = GoalLedger(cost_usd=999.0)
        status = decide_terminal_status(
            verdict=verdict,
            ledger=ledger,
            limits=_limits(max_cost_usd=None, max_iterations=999, max_wall_clock_s=999999.0),
            stalled=False,
            cancelled=False,
        )
        assert status is None

    def test_stalled_is_stopped_no_progress(self) -> None:
        verdict = _verdict(unmet_ids=("c1",))
        status = decide_terminal_status(
            verdict=verdict, ledger=GoalLedger(), limits=_limits(), stalled=True, cancelled=False
        )
        assert status == "stopped_no_progress"

    def test_consecutive_tool_errors_is_partial_not_stopped_budget(self) -> None:
        verdict = _verdict(unmet_ids=("c1",))
        ledger = GoalLedger(consecutive_tool_errors=3)
        status = decide_terminal_status(
            verdict=verdict,
            ledger=ledger,
            limits=_limits(max_consecutive_tool_errors=3),
            stalled=False,
            cancelled=False,
        )
        assert status == "partial"

    def test_no_terminal_condition_returns_none(self) -> None:
        verdict = _verdict(unmet_ids=("c1",))
        status = decide_terminal_status(
            verdict=verdict, ledger=GoalLedger(), limits=_limits(), stalled=False, cancelled=False
        )
        assert status is None


class TestIsStalled:
    """Stalling is judged from the check's results alone — the agent's plan,
    or its absence, is never an input to stopping a run."""

    def test_first_check_is_never_flat(self) -> None:
        assert flat_checks_after(None, frozenset(), 0) == 0

    def test_a_check_that_meets_nothing_new_counts_as_flat(self) -> None:
        assert flat_checks_after(frozenset({"c1"}), frozenset({"c1"}), 0) == 1
        assert flat_checks_after(frozenset({"c1"}), frozenset({"c1"}), 1) == 2

    def test_a_newly_met_criterion_resets_the_count(self) -> None:
        assert flat_checks_after(frozenset({"c1"}), frozenset({"c1", "c2"}), 1) == 0

    def test_losing_a_criterion_is_not_progress(self) -> None:
        assert flat_checks_after(frozenset({"c1", "c2"}), frozenset({"c1"}), 0) == 1

    def test_stalled_only_once_the_limit_of_flat_checks_is_reached(self) -> None:
        assert is_stalled(1, _limits(max_flat_checks=2)) is False
        assert is_stalled(2, _limits(max_flat_checks=2)) is True


class TestGoalVerdictMetIsDerived:
    def test_met_true_only_when_every_criterion_met(self) -> None:
        verdict = _verdict(met_ids=("c1", "c2"))
        assert verdict.met is True

    def test_met_false_when_any_criterion_unmet(self) -> None:
        verdict = _verdict(met_ids=("c1",), unmet_ids=("c2",))
        assert verdict.met is False

    def test_met_false_when_criteria_empty(self) -> None:
        verdict = GoalVerdict(criteria=(), critique="nothing judged")
        assert verdict.met is False

    def test_met_false_when_a_criterion_was_never_assessed(self) -> None:
        """C9: a criterion the judge omitted entirely carries `met=None`
        (never assessed), not `False` (assessed and failed) -- but either
        way, `GoalVerdict.met` must never be True while one is unknown."""
        criteria = (
            CriterionVerdict(criterion_id="c1", met=True, reason="done", evidence_step_ids=("s1",)),
            CriterionVerdict(criterion_id="c2", met=None, reason="", evidence_step_ids=()),
        )
        verdict = GoalVerdict(criteria=criteria, critique="round summary")
        assert verdict.met is False

    def test_met_is_not_a_settable_field(self) -> None:
        verdict = _verdict(met_ids=("c1",))
        with pytest.raises((ValidationError, AttributeError, TypeError)):
            verdict.met = False  # type: ignore[misc]

    def test_verdict_and_criteria_are_frozen(self) -> None:
        criterion = GoalCriterion(id="c1", text="x")
        with pytest.raises(ValidationError):
            criterion.id = "c2"


class TestValidateEvidenceIds:
    def test_filters_out_ids_not_in_bundle(self) -> None:
        valid = validate_evidence_ids(("s1", "s2", "hallucinated"), {"s1", "s2"})
        assert valid == frozenset({"s1", "s2"})

    def test_empty_citations_yield_empty_set(self) -> None:
        assert validate_evidence_ids((), {"s1"}) == frozenset()


class TestComputeChecked:
    def test_no_evidence_at_all_is_not_met_and_not_checked(self) -> None:
        """C9: absence of evidence is not met, and it is checked=False —
        distinct from a criterion the judge actually evidenced and found
        unmet."""
        checked, met = compute_checked(True, (), {"s1", "s2"}, unknown_step_ids=())
        assert checked is False
        assert met is False

    def test_reason_citing_only_invalid_ids_does_not_support_met_true(self) -> None:
        """C10: the judge's own prose (and a fabricated step_id) is not
        evidence either."""
        checked, met = compute_checked(
            True, ("hallucinated-1", "hallucinated-2"), {"s1"}, unknown_step_ids=()
        )
        assert checked is False
        assert met is False

    def test_valid_citation_with_met_true_is_met(self) -> None:
        checked, met = compute_checked(True, ("s1",), {"s1", "s2"}, unknown_step_ids=())
        assert checked is True
        assert met is True

    def test_valid_citation_with_met_false_is_checked_but_not_met(self) -> None:
        checked, met = compute_checked(False, ("s1",), {"s1", "s2"}, unknown_step_ids=())
        assert checked is True
        assert met is False

    def test_unknown_mutation_outcome_is_not_met_even_if_judge_said_met(self) -> None:
        """A mutation receipt with outcome='unknown' has no terminal proof
        (§27.8) — citing ONLY such receipts must never support met=True,
        regardless of what the judge claimed."""
        checked, met = compute_checked(True, ("s1",), {"s1", "s2"}, unknown_step_ids={"s1"})
        assert checked is True  # it WAS checked -- there was valid evidence
        assert met is False  # but that evidence proves nothing

    def test_mixed_known_and_unknown_citations_can_still_be_met(self) -> None:
        """Citing one unknown receipt alongside one real one must not sink an
        otherwise-proven criterion -- only ALL-unknown evidence is forced
        unmet."""
        checked, met = compute_checked(True, ("s1", "s2"), {"s1", "s2"}, unknown_step_ids={"s1"})
        assert checked is True
        assert met is True

    def test_partial_valid_citations_mixed_with_invalid_still_count(self) -> None:
        checked, met = compute_checked(
            True, ("s1", "hallucinated"), {"s1", "s2"}, unknown_step_ids=()
        )
        assert checked is True
        assert met is True


class TestEvidenceBoundingNeverStarvesPriorCitations:
    """This is a contract on `app.goal_judge.select_evidence`, but the
    underlying honesty guarantee -- that `compute_checked` never flips a
    previously-evidenced criterion to unchecked just because the caller
    forgot to retain its evidence -- is proven here at the pure-function
    level: as long as the bundle still contains a criterion's previously
    cited step_id, compute_checked keeps deriving checked=True from it."""

    def test_previously_cited_id_still_present_keeps_checked_true(self) -> None:
        bundle_with_retained_evidence = {"s1", "s2", "s3", "s4", "s5"}
        checked, met = compute_checked(
            True, ("s1",), bundle_with_retained_evidence, unknown_step_ids=()
        )
        assert checked is True
        assert met is True

    def test_dropping_a_previously_cited_id_flips_to_unchecked_not_a_false_failure(self) -> None:
        """If a bundle-selection bug DID drop a cited receipt, the honest
        failure mode is 'not checked', never a false 'not met' presented as
        a genuine finding -- this is the safety net C9 relies on even when
        the evidence-retention rule in select_evidence is violated."""
        bundle_missing_the_citation = {"s2", "s3"}
        checked, met = compute_checked(
            True, ("s1",), bundle_missing_the_citation, unknown_step_ids=()
        )
        assert checked is False
        assert met is False


class TestGoalLedgerCarry:
    """An `ask_student` pause must carry a goal run's cumulative totals
    forward, so a resumed segment is judged against the whole goal's budget
    rather than a fresh one."""

    def test_to_carry_round_trips_through_from_carry(self) -> None:
        ledger = GoalLedger(
            requests_used=9,
            tokens_used=12_345,
            cost_usd=1.25,
            elapsed_s=42.5,
            iteration=3,
            consecutive_tool_errors=1,
        )
        restored = GoalLedger.from_carry(ledger.to_carry())
        assert restored.iteration == 3
        assert restored.cost_usd == 1.25
        assert restored.elapsed_s == 42.5
        assert restored.consecutive_tool_errors == 1
        # Never carried: each segment recomputes these from its own turn's
        # RunUsage, which carries no cross-turn meaning.
        assert restored.requests_used == 0
        assert restored.tokens_used == 0

    def test_from_carry_of_none_is_a_fresh_ledger(self) -> None:
        assert GoalLedger.from_carry(None) == GoalLedger()
        assert GoalLedger.from_carry({}) == GoalLedger()
