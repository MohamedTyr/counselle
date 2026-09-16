"""Goal-mode criteria derivation and the judge call (plans/goal-mode-plan.md Part 3).

Two independent, tool-less, typed-output cheap-model calls: :func:`derive_criteria`
turns a `/goal` statement into 2-6 frozen binary criteria plus a mandatory
`not_checked_note` (§3.2, C11); :func:`judge_goal` is the loop gate (D5) —
blind to the agent's self-report, it grades those criteria against bounded
tool receipts (§3.3) and returns an already honesty-corrected
:class:`domain.goal.GoalVerdict`. The C9/C10 corrections are applied HERE, in
code, before the verdict reaches ``decide_terminal_status`` (Phase 3), so an
"achieved" decision never depends on the judge's raw, unvalidated claim.

Both models are resolved through the ADR 0011 seam in `app/model_selection.py`;
both calls share the caller's `RunUsage` (D6) so their spend counts against
the run's ledger. This module is a loop GATE, never an answer validator (D5,
AGENTS.md "No output validator was added and none may be") — it never
rewrites, blocks, or regenerates the agent's own prose.
"""

from __future__ import annotations

import asyncio
from collections.abc import Collection, Sequence
from typing import TYPE_CHECKING, Any

import structlog
from pydantic import BaseModel, ConfigDict, Field

from app.asset_format import render_slots
from app.model_selection import (
    goal_criteria_model_setting,
    goal_judge_model_setting,
    model_name_from_setting,
)
from config.settings import load_prompt
from domain.goal import CriterionVerdict, GoalCriterion, GoalVerdict, compute_checked
from domain.mutation_receipts import (
    BatchMutationBody,
    DuplicateMutationBody,
    EssayEditMutationBody,
    EssayWriteMutationBody,
    MemoryMutationBody,
    MutationBody,
    MutationChange,
    MutationOutcome,
    MutationValue,
    ProfileMutationBody,
    ReorderMutationBody,
    StateTransitionMutationBody,
    UnresolvedMutationBody,
    UpdateMutationBody,
)

if TYPE_CHECKING:
    from pydantic_ai.usage import RunUsage

    from config.settings import Settings
    from domain.events import StepData

logger = structlog.get_logger(__name__)

#: Code-owned default when the model omits `not_checked_note` after every
#: retry (§3.2). Never `None` — the closing card has no branch that can skip
#: this line, so this is what a persistently non-compliant model still gets.
DEFAULT_NOT_CHECKED_NOTE = (
    "Counselle only checked the criteria above. Anything outside your Counselle "
    "workspace — application portals, transcripts, test scores, recommendation "
    "letters — was not checked."
)


class GoalCriteriaOutput(BaseModel):
    """Typed output of the criteria-derivation call (§3.2)."""

    model_config = ConfigDict(extra="forbid")

    criteria: list[GoalCriterion] = Field(min_length=2, max_length=6)
    #: REQUIRED: nullable here would let a lenient model omit it and produce
    #: a green "Achieved" card with no scope caveat — the C11 failure this
    #: field exists to prevent.
    not_checked_note: str = Field(min_length=1)


class _RawCriterionVerdict(BaseModel):
    """The judge's raw, UNVALIDATED per-criterion claim. Never persisted or
    returned as-is: :func:`judge_goal` always runs this through
    :func:`domain.goal.compute_checked` first."""

    model_config = ConfigDict(extra="forbid")

    criterion_id: str
    met: bool
    reason: str
    evidence_step_ids: list[str] = Field(default_factory=list)


class _RawGoalVerdict(BaseModel):
    model_config = ConfigDict(extra="forbid")

    criteria: list[_RawCriterionVerdict]
    critique: str


class GoalCriteriaError(RuntimeError):
    """Criteria derivation could not complete after retries (transport/
    timeout/rate-limit, distinct from a malformed-output retry, which
    PydanticAI's own output-validation retry already handles)."""


def _vertex_model(settings: Settings, model_setting: str) -> Any:
    """The ADR 0011 provider-construction shape shared with
    `app/agent_node.py::default_model_factory` and `app/titles.py::_title_model`."""
    from pydantic_ai.models.google import GoogleModel
    from pydantic_ai.providers.google_cloud import GoogleCloudProvider

    from app.vertex import build_vertex_client

    client = build_vertex_client(settings, retry_attempts=settings.agent_model_retry_attempts)
    return GoogleModel(
        model_name_from_setting(model_setting), provider=GoogleCloudProvider(client=client)
    )


async def _run_with_retries(agent: Any, prompt: str, *, usage: RunUsage, settings: Settings) -> Any:
    """Retry transient failures up to ``goal_judge_retries`` times with
    exponential backoff (§3.7/C12). Returns ``None`` (never raises) after
    exhaustion; each caller turns that into its own honest terminal state."""
    from pydantic_ai.usage import UsageLimits

    limits = UsageLimits(
        request_limit=settings.goal_max_model_requests,
        total_tokens_limit=settings.goal_max_total_tokens,
    )
    for attempt in range(settings.goal_judge_retries + 1):
        try:
            result = await agent.run(prompt, usage=usage, usage_limits=limits)
            return result.output
        except Exception:  # noqa: BLE001 - expected on a long run, see docstring
            logger.warning("goal model call attempt failed", attempt=attempt, exc_info=True)
            if attempt < settings.goal_judge_retries:
                await asyncio.sleep(2**attempt)
    return None


async def derive_criteria(
    statement: str, *, settings: Settings, usage: RunUsage
) -> tuple[tuple[GoalCriterion, ...], str]:
    """`/goal` statement -> (criteria, not_checked_note). Always returns a
    non-empty note (§3.2): a missing required field is a pydantic
    ValidationError PydanticAI retries on its own; if still blank,
    :data:`DEFAULT_NOT_CHECKED_NOTE` is substituted. Raises
    :class:`GoalCriteriaError` if the call itself never completes."""
    from pydantic_ai import Agent

    agent: Agent[None, GoalCriteriaOutput] = Agent(
        _vertex_model(settings, goal_criteria_model_setting(settings)),
        output_type=GoalCriteriaOutput,
    )
    prompt = render_slots(
        load_prompt("goal_criteria"), ("goal_statement",), goal_statement=statement
    )
    output = await _run_with_retries(agent, prompt, usage=usage, settings=settings)
    if output is None:
        raise GoalCriteriaError("criteria derivation failed after retries")
    note = output.not_checked_note.strip() or DEFAULT_NOT_CHECKED_NOTE
    return tuple(output.criteria[: settings.goal_max_criteria]), note


def unknown_step_ids(receipts: Sequence[StepData]) -> frozenset[str]:
    """Subset of *receipts* with mutation outcome `"unknown"` (§27.8, a write
    with no terminal proof) — fed to `compute_checked` so citing ONLY these
    forces `met=False` in code, never left to the judge's prompt (§3.4)."""
    return frozenset(
        r.step_id
        for r in receipts
        if r.detail is not None
        and r.detail.mutation is not None
        and r.detail.mutation.outcome == "unknown"
    )


#: Plain-English framing per outcome, stated as a fact about what the tool
#: proved rather than what it "did" — this is the fix for evidence
#: literalism: a bare `outcome=success` token asks the judge to infer a
#: correction that the receipt already states outright. `no_change` reads
#: as "nothing happened" unless we say plainly that it means the opposite:
#: the tool checked and confirmed the desired state already held.
_OUTCOME_FRAMING: dict[MutationOutcome, str] = {
    "success": "PROVEN: this write completed; the fact above is now true.",
    "no_change": (
        "PROVEN: the tool checked the current state and found it already "
        "matched the desired outcome, so no write was needed. This is "
        "affirmative proof the criterion already held — not an absence of "
        "evidence."
    ),
    "partial": (
        "PARTIALLY PROVEN: only some of this write's targets changed; do not "
        "treat the untouched ones as done."
    ),
    "failed": "NOT PROVEN: this write did not take effect.",
    "unknown": "NOT PROVEN: this write has no confirmed outcome.",
}


def _display_value(value: MutationValue) -> str:
    """Render one typed `MutationValue` as plain text (whichever variant it
    carries) — this is the concrete fact a receipt exists to prove."""
    if value.text is not None:
        return value.text.text
    if value.enum is not None:
        return value.enum
    if value.list_items is not None:
        return ", ".join(value.list_items)
    if value.reference is not None:
        return value.reference.title.text
    if value.reference_list is not None:
        return ", ".join(r.title.text for r in value.reference_list)
    if value.date is not None:
        return value.date
    if value.datetime is not None:
        return value.datetime
    if value.integer is not None:
        return str(value.integer)
    if value.decimal is not None:
        return value.decimal
    if value.boolean is not None:
        return "true" if value.boolean else "false"
    if value.count is not None:
        return str(value.count)
    if value.word_budget_used is not None:
        limit = f" (limit {value.word_budget_limit})" if value.word_budget_limit else ""
        return f"{value.word_budget_used} words{limit}"
    return "(value)"  # unreachable: MutationValue._payload_matches_kind guarantees one branch


def _change_fact(change: MutationChange) -> str:
    if change.operation in ("clear", "delete"):
        return f"{change.field_key} was {change.operation}d"
    if change.operation == "state_only":
        return f"{change.field_key} changed"
    after = _display_value(change.after) if change.after is not None else "?"
    if change.operation == "move":
        before = _display_value(change.before) if change.before is not None else "?"
        return f"{change.field_key} moved from {before!r} to {after!r}"
    return f"{change.field_key} set to {after!r}"


def _body_fact(body: MutationBody) -> str:
    """The one concrete, typed fact this receipt's body proves — the piece
    `_receipt_text` used to drop on the floor, leaving the judge nothing but
    `outcome=success family=... action=...` to reason from."""
    if isinstance(body, UpdateMutationBody):
        changes = "; ".join(_change_fact(c) for c in body.changes)
        return f'"{body.subject.title.text}": {changes}'
    if isinstance(body, BatchMutationBody):
        changed = [
            item.subject.title.text if item.subject else f"item {item.input_index}"
            for item in body.items
            if item.disposition == "changed"
        ]
        subjects = f" ({', '.join(changed)})" if changed else ""
        return f"{body.changed_count}/{body.total_count} items changed{subjects}"
    if isinstance(body, StateTransitionMutationBody):
        subjects = ", ".join(s.title.text for s in body.subjects)
        return f"{body.state}: {subjects}"
    if isinstance(body, DuplicateMutationBody):
        return f'copied "{body.source.title.text}" to "{body.copy_subject.title.text}"'
    if isinstance(body, ReorderMutationBody):
        return "new order: " + ", ".join(s.title.text for s in body.new_order)
    if isinstance(body, EssayEditMutationBody):
        return f'"{body.subject.title.text}": edited, final_word_count={body.final_word_count}'
    if isinstance(body, EssayWriteMutationBody):
        return f'"{body.subject.title.text}": {body.mode}, final_word_count={body.final_word_count}'
    if isinstance(body, ProfileMutationBody):
        return "; ".join(
            f"{s.section_label}: " + "; ".join(_change_fact(c) for c in s.changes)
            for s in body.sections
        )
    if isinstance(body, MemoryMutationBody):
        notes = "; ".join(n.text for n in body.active_notes)
        return f"{body.operation}: {notes}" if notes else body.operation
    if isinstance(body, UnresolvedMutationBody):
        return f"no resolved subject (verify via {body.verification})"
    return ""


def _receipt_text(receipt: StepData, *, carried_from_prior_round: bool = False) -> str:
    """Render one receipt into the compact text sent to the judge, stating
    plainly what it proves rather than leaving the judge to infer it from
    bare type/outcome tokens. Prefers the typed mutation fact (§27.8's
    evidence) over the free-text `summary`, included only as context."""
    detail = receipt.detail
    lines = [f"[{receipt.step_id}] {receipt.kind}:{receipt.tool or receipt.label}"]
    if detail is not None:
        if detail.mutation is not None:
            m = detail.mutation
            fact = _body_fact(m.body)
            lines.append(f"  outcome={m.outcome} family={m.family} action={m.action}")
            if fact:
                lines.append(f"  fact: {fact}")
            lines.append(f"  {_OUTCOME_FRAMING[m.outcome]}")
        if detail.summary:
            lines.append(
                f"  read-only verification: {detail.summary}\n"
                "  This is a direct, current-state check, not a mutation — it is "
                "equally valid proof when it confirms or contradicts a criterion."
            )
        if detail.error:
            lines.append(f"  error={detail.error}")
    if carried_from_prior_round:
        lines.append(
            "  (cited by an earlier round of this same goal and carried forward — "
            "counts exactly as much as evidence produced this round)"
        )
    return "\n".join(lines)


def select_evidence(
    receipts: Sequence[StepData], *, always_keep_step_ids: Collection[str], max_chars: int
) -> tuple[list[StepData], int]:
    """Bound the evidence bundle sent to the judge (§3.3). *receipts* is the
    full cumulative-from-goal-start set, oldest-first; selection is
    newest-first plus every receipt in *always_keep_step_ids* (a prior
    verdict's citations), so evidence already cited never ages out into a
    false "unchecked". Returns ``(selected, dropped_count)``."""
    always = set(always_keep_step_ids)
    kept = [r for r in receipts if r.step_id in always]
    rest_newest_first = [r for r in reversed(receipts) if r.step_id not in always]

    selected = list(kept)
    used_chars = sum(len(_receipt_text(r)) for r in selected)
    dropped = 0
    for receipt in rest_newest_first:
        size = len(_receipt_text(receipt))
        if used_chars + size > max_chars:
            dropped += 1
            continue
        selected.append(receipt)
        used_chars += size
    return selected, dropped


def _render_evidence_block(
    selected: Sequence[StepData],
    dropped: int,
    final_text: str,
    *,
    carried_step_ids: Collection[str] = (),
) -> str:
    carried = set(carried_step_ids)
    receipts_text = (
        "\n\n".join(
            _receipt_text(r, carried_from_prior_round=r.step_id in carried) for r in selected
        )
        or "(no tool receipts this round)"
    )
    dropped_marker = f'<dropped-receipts count="{dropped}"/>\n' if dropped else ""
    final = final_text.strip() or "(no final text this round)"
    return (
        f"{dropped_marker}<tool-receipts>\n{receipts_text}\n</tool-receipts>\n\n"
        f"<final-text>\n{final}\n</final-text>"
    )


def _render_criteria_block(criteria: Sequence[GoalCriterion]) -> str:
    return "\n".join(f"- [{c.id}] {c.text}" for c in criteria)


async def judge_goal(
    *,
    statement: str,
    criteria: Sequence[GoalCriterion],
    receipts: Sequence[StepData],
    final_text: str,
    prior_cited_step_ids: Collection[str],
    settings: Settings,
    usage: RunUsage,
) -> tuple[GoalVerdict, dict[str, bool]] | None:
    """The judge call (D4, D5, §3). Returns ``None`` after
    ``goal_judge_retries`` failed attempts — feed that into
    ``decide_terminal_status(verdict=None, ...)`` for `"stopped_check_failed"`.

    On success returns ``(verdict, checked_by_criterion_id)``: every
    `verdict.criteria[i].met` is already CODE-CORRECTED (C9/C10 via
    `compute_checked`), so `verdict.met` is honest by construction, not
    convention; `checked_by_criterion_id` is C9's per-criterion "never
    checked" flag, returned because `CriterionVerdict` doesn't carry it.

    *receipts* is bounded internally via :func:`select_evidence`.
    *prior_cited_step_ids* is what a PREVIOUS round cited (empty on round
    one) — evidence retention only; this round's `checked` is always fresh.
    """
    from pydantic_ai import Agent

    selected, dropped = select_evidence(
        receipts,
        always_keep_step_ids=prior_cited_step_ids,
        max_chars=settings.goal_judge_evidence_max_chars,
    )
    bundle_step_ids = frozenset(r.step_id for r in selected)
    unknown_ids = unknown_step_ids(selected)

    prompt = render_slots(
        load_prompt("goal_judge"),
        ("goal_statement", "criteria_block", "evidence_block"),
        goal_statement=statement,
        criteria_block=_render_criteria_block(criteria),
        evidence_block=_render_evidence_block(
            selected, dropped, final_text, carried_step_ids=prior_cited_step_ids
        ),
    )
    from pydantic_ai.settings import ModelSettings

    # Pinned to temperature=0: the judge is a grader, not a creative writer,
    # and the eval gate must be able to attribute a score change to a prompt
    # or rendering fix rather than to run-to-run sampling noise — the same
    # 32 cases scored TPR 0.882, then 0.824, then 0.765 across three runs of
    # the unpinned judge with no code change between them.
    agent: Agent[None, _RawGoalVerdict] = Agent(
        _vertex_model(settings, goal_judge_model_setting(settings)),
        output_type=_RawGoalVerdict,
        model_settings=ModelSettings(temperature=0.0),
    )
    raw = await _run_with_retries(agent, prompt, usage=usage, settings=settings)
    if raw is None:
        return None

    checked_by_id: dict[str, bool] = {}
    corrected: list[CriterionVerdict] = []
    raw_by_id = {v.criterion_id: v for v in raw.criteria}
    for criterion in criteria:
        rv = raw_by_id.get(criterion.id)
        if rv is None:
            # Omitted entirely: the judge never assessed this criterion at
            # all -> checked=False, met=None (C9). `None` is the honest
            # "unknown", never a stand-in for "checked and failed" —
            # `CriterionVerdict.met` is typed `bool | None` for exactly this
            # case. `checked_by_id[id] = False` is the "never attempted"
            # signal that reaches the wire as `GoalCriterionView.checked`;
            # every consumer of `.met` (`GoalVerdict.met`'s all-criteria-met
            # computation, `app/goal_loop.py`'s `met_ids`/`unmet`
            # derivations, `app/agent_node.py`'s wrap-up prompt, and the
            # frontend `CriterionMark` gate) treats `None` as falsy, so an
            # unassessed criterion never counts as met anywhere.
            checked_by_id[criterion.id] = False
            corrected.append(
                CriterionVerdict(
                    criterion_id=criterion.id, met=None, reason="", evidence_step_ids=()
                )
            )
            continue
        checked, met = compute_checked(rv.met, rv.evidence_step_ids, bundle_step_ids, unknown_ids)
        checked_by_id[criterion.id] = checked
        corrected.append(
            CriterionVerdict(
                criterion_id=criterion.id,
                met=met,
                reason=rv.reason,
                evidence_step_ids=tuple(rv.evidence_step_ids),
            )
        )
    return GoalVerdict(criteria=tuple(corrected), critique=raw.critique), checked_by_id
