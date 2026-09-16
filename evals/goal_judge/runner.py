"""Goal-judge eval runner (plans/goal-mode-plan.md §3.8, §6.2).

Scores `app.goal_judge.judge_goal` against `cases.yaml`'s hand-labeled `test`
split, reporting TPR and TNR SEPARATELY plus the false-positive rate — never
raw accuracy, which the plan forbids as the gate metric (an always-"met"
judge scores ~95% on a system that fails 5% of the time while catching
nothing). Also sanity-checks `criteria_examples.yaml`'s hand labels against a
small rule-based §3.2 constraint checker.

See README.md for what this dataset is (SYNTHETIC, hand-labeled) and is not
(real goal-run traces — the goal loop does not exist yet).

Usage:
    uv run python -m evals.goal_judge.runner --dry-run   # no model calls
    uv run python -m evals.goal_judge.runner --smoke 3   # a few real calls
    uv run python -m evals.goal_judge.runner             # full test split
"""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml
from pydantic_ai.usage import RunUsage

from app.goal_judge import judge_goal
from config.settings import get_settings
from domain.events import StepData, StepDetail
from domain.goal import GoalCriterion
from domain.mutation_receipts import (
    BatchMutationBody,
    BoundedDisplayText,
    DuplicateMutationBody,
    EssayEditLocation,
    EssayEditMutationBody,
    EssayEditOperation,
    EssayWriteMutationBody,
    MemoryMutationBody,
    MutationAction,
    MutationBody,
    MutationChange,
    MutationItem,
    MutationOutcome,
    MutationSubject,
    MutationValue,
    ProfileMutationBody,
    ProfileSectionChange,
    ReorderMutationBody,
    UnresolvedMutationBody,
    UpdateMutationBody,
    WorkspaceMutationReceipt,
)

CASES_PATH = Path(__file__).parent / "cases.yaml"
CRITERIA_EXAMPLES_PATH = Path(__file__).parent / "criteria_examples.yaml"


def _subject(title: str) -> MutationSubject:
    return MutationSubject(title=BoundedDisplayText(text=title))


_DEFAULT_ACTION = {"reorder": "reorder", "duplicate": "duplicate"}


def _build_mutation(r: dict[str, Any]) -> WorkspaceMutationReceipt:
    receipt_type = r["type"]
    family = r["family"]
    action: MutationAction = r.get("action") or _DEFAULT_ACTION[receipt_type]  # type: ignore[assignment]
    outcome: MutationOutcome = r.get("outcome", "success")
    body: MutationBody

    if outcome in ("failed", "unknown") and receipt_type == "mutation" and "field_key" not in r:
        body = UnresolvedMutationBody(
            family=family, verification=r.get("verification", f"{family}_list")
        )
        return WorkspaceMutationReceipt(family=family, action=action, outcome=outcome, body=body)

    if receipt_type == "mutation" and family == "memory":
        body = MemoryMutationBody(
            operation=action,  # type: ignore[arg-type]
            note_count=1,
            active_notes=(BoundedDisplayText(text=r["note_text"]),),
        )
    elif receipt_type == "mutation" and family == "essay_content" and action == "write":
        body = EssayWriteMutationBody(
            subject=_subject(r["label"]),
            mode="drafted",
            previous_word_count=r.get("previous_word_count"),
            final_word_count=r["final_word_count"],
            word_limit=r.get("word_limit"),
        )
    elif receipt_type == "mutation" and family == "essay_content" and action == "edit":
        final_count = r["final_word_count"]
        body = EssayEditMutationBody(
            subject=_subject(r["label"]),
            operations=(
                EssayEditOperation(
                    location=EssayEditLocation(kind="unavailable"),
                    operation="replace",
                    before_words=0,
                    after_words=final_count,
                ),
            ),
            final_word_count=final_count,
            word_limit=r.get("word_limit"),
        )
    elif receipt_type == "mutation" and family == "profile":
        change = MutationChange(
            field_key=r["field_key"],
            operation="set",
            after=MutationValue(kind="text", text=BoundedDisplayText(text=str(r["value"]))),
        )
        body = ProfileMutationBody(
            sections=(
                ProfileSectionChange(
                    section_key="testing", section_label="Testing plan", changes=(change,)
                ),
            )
        )
    elif receipt_type == "mutation":
        body = UpdateMutationBody(
            subject=_subject(r["label"]),
            changes=(
                MutationChange(
                    field_key=r["field_key"],
                    operation="set",
                    after=MutationValue(kind="text", text=BoundedDisplayText(text=str(r["value"]))),
                ),
            ),
        )
    elif receipt_type == "batch":
        dispositions = r["dispositions"]
        outcome = "success" if all(d == "changed" for d in dispositions) else "partial"
        items = tuple(
            MutationItem(input_index=i, disposition=d, subject=_subject(f"Item {i}"))
            for i, d in enumerate(dispositions)
        )
        body = BatchMutationBody(items=items)
    elif receipt_type == "reorder":
        body = ReorderMutationBody(new_order=tuple(_subject(t) for t in r["new_order"]))
    elif receipt_type == "duplicate":
        body = DuplicateMutationBody(
            source=_subject(r["source_title"]), copy=_subject(r["copy_title"])
        )
    else:
        raise ValueError(f"unknown receipt type {receipt_type!r}")

    return WorkspaceMutationReceipt(family=family, action=action, outcome=outcome, body=body)


def build_step(r: dict[str, Any]) -> StepData:
    """Build a real `domain.events.StepData` from one `cases.yaml` receipt
    entry — proves every case parses into the actual wire/receipt types
    `app.goal_judge` consumes, not a look-alike stand-in."""
    if r["type"] == "summary":
        detail = StepDetail(summary=r["summary"])
    else:
        detail = StepDetail(mutation=_build_mutation(r))
    return StepData(
        step_id=r["step_id"],
        status="end",
        kind=r.get("kind", "workspace"),
        label=r.get("label", "Workspace update"),
        tier=None,
        tool=r.get("tool"),
        detail=detail,
    )


@dataclass(frozen=True)
class JudgeCase:
    id: str
    split: str
    adversarial: bool
    statement: str
    criteria: tuple[GoalCriterion, ...]
    receipts: tuple[StepData, ...]
    final_text: str
    prior_cited_step_ids: tuple[str, ...]
    labels: dict[str, bool]


def load_cases() -> list[JudgeCase]:
    raw = yaml.safe_load(CASES_PATH.read_text())
    cases = []
    for c in raw:
        cases.append(
            JudgeCase(
                id=c["id"],
                split=c["split"],
                adversarial=bool(c.get("adversarial", False)),
                statement=c["statement"],
                criteria=tuple(GoalCriterion(id=cr["id"], text=cr["text"]) for cr in c["criteria"]),
                receipts=tuple(build_step(r) for r in c.get("receipts", [])),
                final_text=c["final_text"],
                prior_cited_step_ids=tuple(c.get("prior_cited_step_ids", [])),
                labels=c["labels"],
            )
        )
    return cases


# ---------------------------------------------------------------------------
# Criteria-step audit (§3.2 constraint sanity check — rule-based, no model call)
# ---------------------------------------------------------------------------

#: Phrases that, on their own, signal a criterion is claiming coverage
#: Counselle cannot observe (C11) — a heuristic, not a substitute for review.
_C11_MARKERS = (
    "portal",
    "submit",
    "submitted",
    "recommendation letter",
    "recommendation letters",
    "transcript",
    "test score",
    "test scores",
    "financial aid has been",
    "awarded",
    "received by the school",
    "received by every school",
)
_VAGUE_SCALE_MARKERS = (
    "sufficiently",
    "meaningfully",
    "reads well",
    "on track",
    "feels",
    "looks good",
    "progressing well",
    "in good shape",
    "ready to submit",
)


def audit_criteria_set(criteria_texts: list[str], not_checked_note: str) -> set[str]:
    """Heuristic §3.2 constraint check. Returns the set of violated
    constraint tags among {"binary", "checkable", "c11"} — a sanity aid for
    the hand labels in criteria_examples.yaml, not a certified validator."""
    violated: set[str] = set()
    if not not_checked_note.strip():
        violated.add("checkable")  # a blank note is itself a structural defect
    for text in criteria_texts:
        lowered = text.lower()
        if any(m in lowered for m in _C11_MARKERS):
            violated.add("c11")
        if any(m in lowered for m in _VAGUE_SCALE_MARKERS):
            violated.add("binary")
    if len(criteria_texts) > 6:
        violated.add("binary")
    return violated


def run_criteria_audit() -> None:
    raw = yaml.safe_load(CRITERIA_EXAMPLES_PATH.read_text())
    agree = 0
    for c in raw:
        texts = [cr["text"] for cr in c["criteria"]]
        detected = audit_criteria_set(texts, c["not_checked_note"])
        expected_reject = c["verdict"] == "reject"
        heuristic_reject = bool(detected)
        matches = heuristic_reject == expected_reject
        agree += matches
        flag = "OK" if matches else "MISMATCH"
        print(f"[{flag}] {c['id']}: verdict={c['verdict']} heuristic_violated={sorted(detected)}")
    print(f"\ncriteria audit: heuristic agreed with hand label on {agree}/{len(raw)} examples")


# ---------------------------------------------------------------------------
# Judge scoring
# ---------------------------------------------------------------------------


async def score_case(case: JudgeCase) -> dict[str, tuple[bool | None, bool]]:
    """Return {criterion_id: (predicted_met, true_met)} for one case.

    ``predicted_met`` is ``None`` when the judge never assessed the criterion
    at all (omitted from its raw response, C9) — a distinct outcome from a
    predicted ``False``, and never coerced to one here: doing so would score
    "the judge didn't check" as "the judge correctly caught a failure" (a
    true negative) or "the judge missed a pass" (a false negative), neither
    of which is what happened. :func:`run_judge_eval` excludes ``None``
    predictions from TPR/TNR/FPR and reports them as their own count instead.
    """
    settings = get_settings()
    result = await judge_goal(
        statement=case.statement,
        criteria=case.criteria,
        receipts=list(case.receipts),
        final_text=case.final_text,
        prior_cited_step_ids=case.prior_cited_step_ids,
        settings=settings,
        usage=RunUsage(),
    )
    if result is None:
        # A judge failure on an eval case is itself a finding, not a crash;
        # score every criterion as a predicted "not met".
        return {c.id: (False, case.labels[c.id]) for c in case.criteria}
    verdict, _checked = result
    by_id = {v.criterion_id: v.met for v in verdict.criteria}
    # `judge_goal` always returns one `CriterionVerdict` per input criterion
    # (never assessed -> `met=None`, C9), so `by_id` covers every id here;
    # `None` is the honest default if that ever stopped holding, not `False`.
    return {c.id: (by_id.get(c.id), case.labels[c.id]) for c in case.criteria}


async def run_judge_eval(cases: list[JudgeCase]) -> None:
    tp = fp = tn = fn = unassessed = 0
    for case in cases:
        outcomes = await score_case(case)
        for _criterion_id, (predicted, true) in outcomes.items():
            if predicted is None:
                # The judge never assessed this criterion (C9) — not a
                # prediction of any kind, so it cannot be scored as a hit or
                # a miss. Counting it as False here would silently rebuild
                # the exact "not done" == "not checked" conflation this
                # honesty correction exists to remove.
                unassessed += 1
            elif true and predicted:
                tp += 1
            elif true and not predicted:
                fn += 1
            elif not true and predicted:
                fp += 1
            else:
                tn += 1
        print(f"scored {case.id} ({'adversarial' if case.adversarial else 'standard'})")

    total = tp + fp + tn + fn
    tpr = tp / (tp + fn) if (tp + fn) else float("nan")
    tnr = tn / (tn + fp) if (tn + fp) else float("nan")
    fpr = fp / (fp + tn) if (fp + tn) else float("nan")
    agreement = (tp + tn) / total if total else float("nan")
    print(
        f"\nn={total} TP={tp} FP={fp} TN={tn} FN={fn} unassessed={unassessed}\n"
        f"TPR={tpr:.3f}  TNR={tnr:.3f}  FPR={fpr:.3f}  overall agreement={agreement:.3f}\n"
        f"gate (§6.2/§3.8): TPR > 0.90 AND TNR > 0.90 -> "
        f"{'PASS' if tpr > 0.90 and tnr > 0.90 else 'FAIL'}"
    )
    if unassessed:
        print(
            f"NOTE: {unassessed} criterion-cases were never assessed by the judge "
            "(omitted from its response) and are excluded from the rates above — "
            "this is itself a judge-quality signal worth investigating, not noise."
        )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="evals.goal_judge.runner")
    parser.add_argument("--dry-run", action="store_true", help="parse all cases, call no model")
    parser.add_argument(
        "--smoke", type=int, default=None, help="run only the first N test cases live"
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    cases = load_cases()
    test_cases = [c for c in cases if c.split == "test"]
    other = len(cases) - len(test_cases)
    print(f"loaded {len(cases)} cases ({len(test_cases)} test, {other} train/dev)")

    run_criteria_audit()

    if args.dry_run:
        print("\n--dry-run: cases parsed successfully, no model calls made.")
        return

    subset = test_cases[: args.smoke] if args.smoke else test_cases
    if args.smoke:
        print(f"\n--smoke {args.smoke}: running a small live subset only (real cost).")
    asyncio.run(run_judge_eval(subset))


if __name__ == "__main__":
    main()
