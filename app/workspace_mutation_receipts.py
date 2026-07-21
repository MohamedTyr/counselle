"""Pure builders for the public mutation-receipt contract (plan §6–§8).

Beside ``app/workspace_step_receipts.py`` (which builds *read* previews), this
module builds *write* receipts. Each mutation tool calls the relevant builder
here while it still has validated request context and authoritative committed
results — ``app/tool_middleware.process_tool_result`` never builds a receipt
itself because it has neither.

Every builder truncates/bounds before constructing a model, so a
``WorkspaceMutationReceipt`` is never rejected for exceeding a size bound at
the moment it's needed. Builders reduce deterministically, in the order fixed
by §6.6: optional metadata, tail notices, tail changes, tail subjects/items.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import regex

from domain.mutation_receipts import (
    BatchMutationBody,
    BoundedDisplayText,
    DuplicateMutationBody,
    EssayEditLocation,
    EssayEditMutationBody,
    EssayEditOperation,
    EssayEditOperationKind,
    EssayWriteMode,
    EssayWriteMutationBody,
    ItemDisposition,
    MemoryMutationBody,
    MemoryOperation,
    MutationAction,
    MutationChange,
    MutationChangeOperation,
    MutationFamily,
    MutationItem,
    MutationNotice,
    MutationOmissions,
    MutationOutcome,
    MutationSubject,
    MutationValue,
    ProfileMutationBody,
    ProfileSectionChange,
    ReorderMutationBody,
    StateTransitionMutationBody,
    StateTransitionState,
    UnresolvedMutationBody,
    UnresolvedVerification,
    UpdateMutationBody,
    WorkspaceMutationReceipt,
)

# ---------------------------------------------------------------------------
# §6.6 size/omission bounds
# ---------------------------------------------------------------------------

RECEIPT_MAX_BYTES = 6_144
BATCH_ITEMS_MAX = 20
SUBJECTS_MAX = 20
CHANGES_MAX = 20
REORDER_MAX = 20
NOTICES_MAX = 6
TITLE_MAX_GRAPHEMES = 240
REASON_MAX_GRAPHEMES = 240
RECOVERY_MAX_GRAPHEMES = 320
MEMORY_NOTE_MAX_GRAPHEMES = 200

_GRAPHEME_RE = regex.compile(r"\X")


def count_graphemes(text: str) -> int:
    """Count Unicode extended grapheme clusters (handles combining marks, ZWJ)."""
    return sum(1 for _ in _GRAPHEME_RE.finditer(text))


def truncate_graphemes(text: str, max_graphemes: int) -> tuple[str, bool, int | None]:
    """Cut ``text`` to at most ``max_graphemes`` clusters.

    Returns ``(text, truncated, original_graphemes)`` — ``original_graphemes``
    is only set when truncation actually happened, matching
    :class:`~domain.mutation_receipts.BoundedDisplayText`'s cross-field
    invariant. This is the one place grapheme segmentation happens — ADR 0017
    keeps ``domain/`` to stdlib + pydantic only, so the real Unicode-aware
    truncation lives here in the app-layer builder, not in the model.
    """
    clusters = _GRAPHEME_RE.findall(text)
    if len(clusters) <= max_graphemes:
        return text, False, None
    return "".join(clusters[:max_graphemes]), True, len(clusters)


def bounded_display_text(
    text: str, *, max_graphemes: int = TITLE_MAX_GRAPHEMES
) -> BoundedDisplayText:
    """The one builder path: truncate then construct — never construct raw."""
    clipped, truncated, original = truncate_graphemes(text, max_graphemes)
    return BoundedDisplayText(text=clipped, truncated=truncated, original_graphemes=original)


def _uuid_ref(value: UUID | str | None) -> str | None:
    if value is None:
        return None
    return str(value)


def subject(title: str, resource_ref: UUID | str | None = None) -> MutationSubject:
    """Build a server-resolved subject — never a raw tool-input echo."""
    return MutationSubject(
        title=bounded_display_text(title, max_graphemes=TITLE_MAX_GRAPHEMES),
        resource_ref=_uuid_ref(resource_ref),
    )


def _bounded(text: str, *, max_graphemes: int) -> BoundedDisplayText:
    return bounded_display_text(text, max_graphemes=max_graphemes)


def notice(kind: str, code: str, message: str) -> MutationNotice:
    return MutationNotice(
        kind=kind,  # type: ignore[arg-type]
        code=code,
        message=_bounded(message, max_graphemes=REASON_MAX_GRAPHEMES),
    )


def text_value(text: str, *, max_graphemes: int = TITLE_MAX_GRAPHEMES) -> MutationValue:
    return MutationValue(kind="text", text=_bounded(text, max_graphemes=max_graphemes))


def enum_value(value: str) -> MutationValue:
    return MutationValue(kind="enum", enum=value)


def date_value(value: str) -> MutationValue:
    return MutationValue(kind="date", date=value)


def boolean_value(value: bool) -> MutationValue:
    return MutationValue(kind="boolean", boolean=value)


def reference_value(ref: MutationSubject) -> MutationValue:
    return MutationValue(kind="reference", reference=ref)


def integer_value(value: int) -> MutationValue:
    return MutationValue(kind="integer", integer=value)


def decimal_value(value: object) -> MutationValue:
    return MutationValue(kind="decimal", decimal=str(value))


_TEXT_LIST_MAX_ITEMS = 20


def text_list_value(items: list[str]) -> MutationValue:
    return MutationValue(kind="text_list", list_items=tuple(items[:_TEXT_LIST_MAX_ITEMS]))


def change(
    field_key: str,
    operation: MutationChangeOperation,
    *,
    before: MutationValue | None = None,
    after: MutationValue | None = None,
) -> MutationChange:
    return MutationChange(field_key=field_key, operation=operation, before=before, after=after)


def batch_item(
    input_index: int,
    disposition: ItemDisposition,
    *,
    item_subject: MutationSubject | None = None,
    reason: str | None = None,
    recovery: str | None = None,
) -> MutationItem:
    return MutationItem(
        input_index=input_index,
        disposition=disposition,
        subject=item_subject,
        reason=_bounded(reason, max_graphemes=REASON_MAX_GRAPHEMES) if reason else None,
        recovery=_bounded(recovery, max_graphemes=RECOVERY_MAX_GRAPHEMES) if recovery else None,
    )


def _reduce_items_for_bounds(items: list[MutationItem]) -> tuple[MutationItem, ...]:
    """Under size pressure, drop optional item detail first — never a row.

    The core ``{input_index, disposition}`` skeleton is mandatory (§6.6); when
    the item count itself exceeds the bound, item detail is stripped from the
    tail first rather than dropping rows, since every requested position must
    have exactly one disposition entry (§6.4).
    """
    if len(items) <= BATCH_ITEMS_MAX:
        return tuple(items)
    # This should not happen in practice (BATCH_MAX tool input is <=20), but
    # keep the contract honest: strip detail from the tail before failing.
    stripped = [
        MutationItem(input_index=item.input_index, disposition=item.disposition)
        if index >= BATCH_ITEMS_MAX
        else item
        for index, item in enumerate(items)
    ]
    return tuple(stripped[:BATCH_ITEMS_MAX]) if len(stripped) > BATCH_ITEMS_MAX else tuple(stripped)


def outcome_for_batch(items: list[MutationItem]) -> MutationOutcome:
    """Derive the business outcome from per-item dispositions (§5)."""
    dispositions = {item.disposition for item in items}
    if "unknown" in dispositions:
        return "unknown"
    changed = sum(1 for item in items if item.disposition == "changed")
    incomplete = any(d in dispositions for d in ("failed", "skipped", "not_attempted"))
    if changed == 0:
        return "failed" if all(d == "failed" for d in dispositions) else "no_change"
    return "partial" if incomplete else "success"


def batch_receipt(
    *,
    family: MutationFamily,
    action: MutationAction,
    items: list[MutationItem],
    outcome: MutationOutcome | None = None,
    notices: list[MutationNotice] | None = None,
) -> WorkspaceMutationReceipt:
    resolved_outcome = outcome or outcome_for_batch(items)
    return WorkspaceMutationReceipt(
        family=family,
        action=action,
        outcome=resolved_outcome,
        body=BatchMutationBody(items=_reduce_items_for_bounds(items)),
        notices=tuple((notices or [])[:NOTICES_MAX]),
    )


def _fits_budget(receipt: WorkspaceMutationReceipt) -> bool:
    return len(_dump_bytes(receipt.model_dump(mode="json", by_alias=True))) <= RECEIPT_MAX_BYTES


def update_receipt(
    *,
    family: MutationFamily,
    action: MutationAction,
    update_subject: MutationSubject,
    changes: list[MutationChange],
    outcome: MutationOutcome = "success",
    notices: list[MutationNotice] | None = None,
) -> WorkspaceMutationReceipt:
    bounded_changes = list(changes[:CHANGES_MAX])
    omitted = 0
    while True:
        receipt = WorkspaceMutationReceipt(
            family=family,
            action=action,
            outcome=outcome,
            body=UpdateMutationBody(subject=update_subject, changes=tuple(bounded_changes)),
            notices=tuple((notices or [])[:NOTICES_MAX]),
            omissions=MutationOmissions(changes=omitted),
        )
        # §6.6: reduce deterministically (tail changes) before overflow rather
        # than let an oversized receipt reach attach_mutation's hard reject.
        if _fits_budget(receipt) or len(bounded_changes) <= 1:
            return receipt
        bounded_changes = bounded_changes[:-1]
        omitted += 1


def state_transition_receipt(
    *,
    family: MutationFamily,
    action: MutationAction,
    state: StateTransitionState,
    subjects: list[MutationSubject],
    outcome: MutationOutcome = "success",
    cascade: MutationNotice | None = None,
) -> WorkspaceMutationReceipt:
    return WorkspaceMutationReceipt(
        family=family,
        action=action,
        outcome=outcome,
        body=StateTransitionMutationBody(
            state=state, subjects=tuple(subjects[:SUBJECTS_MAX]), cascade=cascade
        ),
    )


def duplicate_receipt(
    *,
    family: MutationFamily,
    source: MutationSubject,
    copy: MutationSubject,
) -> WorkspaceMutationReceipt:
    return WorkspaceMutationReceipt(
        family=family,
        action="duplicate",
        outcome="success",
        body=DuplicateMutationBody.model_validate({"source": source, "copy": copy}),
    )


def reorder_receipt(
    *,
    family: MutationFamily,
    new_order: list[MutationSubject],
    old_ranks: list[int] | None = None,
    moved_index: int | None = None,
    moved_from_rank: int | None = None,
    outcome: MutationOutcome = "success",
) -> WorkspaceMutationReceipt:
    return WorkspaceMutationReceipt(
        family=family,
        action="reorder",
        outcome=outcome,
        body=ReorderMutationBody(
            new_order=tuple(new_order[:REORDER_MAX]),
            old_ranks=tuple(old_ranks) if old_ranks is not None else None,
            moved_index=moved_index,
            moved_from_rank=moved_from_rank,
        ),
    )


def essay_edit_operation(
    *,
    kind: EssayEditOperationKind,
    before_words: int,
    after_words: int,
    paragraph_start: int | None = None,
    paragraph_end: int | None = None,
    word_start: int | None = None,
    word_end: int | None = None,
) -> EssayEditOperation:
    if paragraph_start is not None and paragraph_end is not None:
        location = EssayEditLocation(
            kind="paragraph_range", start=paragraph_start, end=paragraph_end
        )
    elif word_start is not None and word_end is not None:
        location = EssayEditLocation(kind="word_range", start=word_start, end=word_end)
    else:
        location = EssayEditLocation(kind="unavailable")
    return EssayEditOperation(
        location=location, operation=kind, before_words=before_words, after_words=after_words
    )


def essay_edit_receipt(
    *,
    essay_subject: MutationSubject,
    operations: list[EssayEditOperation],
    final_word_count: int,
    word_limit: int | None = None,
) -> WorkspaceMutationReceipt:
    return WorkspaceMutationReceipt(
        family="essay_content",
        action="edit",
        outcome="success",
        body=EssayEditMutationBody(
            subject=essay_subject,
            operations=tuple(operations[:BATCH_ITEMS_MAX]),
            final_word_count=final_word_count,
            word_limit=word_limit,
        ),
    )


def essay_write_receipt(
    *,
    essay_subject: MutationSubject,
    mode: EssayWriteMode,
    final_word_count: int,
    previous_word_count: int | None = None,
    word_limit: int | None = None,
) -> WorkspaceMutationReceipt:
    return WorkspaceMutationReceipt(
        family="essay_content",
        action="write",
        outcome="success",
        body=EssayWriteMutationBody(
            subject=essay_subject,
            mode=mode,
            previous_word_count=previous_word_count,
            final_word_count=final_word_count,
            word_limit=word_limit,
        ),
    )


def profile_section(
    section_key: str, section_label: str, changes: list[MutationChange]
) -> ProfileSectionChange:
    return ProfileSectionChange(
        section_key=section_key, section_label=section_label, changes=tuple(changes[:CHANGES_MAX])
    )


def profile_receipt(sections: list[ProfileSectionChange]) -> WorkspaceMutationReceipt:
    return WorkspaceMutationReceipt(
        family="profile",
        action="update",
        outcome="success",
        body=ProfileMutationBody(sections=tuple(sections[:10])),
    )


def memory_receipt(
    *,
    operation: MemoryOperation,
    note_count: int,
    active_notes: list[str] | None = None,
) -> WorkspaceMutationReceipt:
    notes = tuple(
        bounded_display_text(text, max_graphemes=MEMORY_NOTE_MAX_GRAPHEMES)
        for text in (active_notes or [])
    )
    return WorkspaceMutationReceipt(
        family="memory",
        action=operation,
        outcome="success",
        body=MemoryMutationBody(operation=operation, note_count=note_count, active_notes=notes),
    )


_VERIFICATION_BY_FAMILY: dict[MutationFamily, UnresolvedVerification] = {
    "task": "task_list",
    "school": "school_list",
    "essay": "essay_list",
    "essay_content": "essay_list",
    "activity": "activity_list",
    "honor": "honor_list",
    "profile": "profile",
    "memory": "memory_list",
}


def unresolved_receipt(
    *,
    family: MutationFamily,
    action: MutationAction,
    outcome: MutationOutcome,
    attempted_count: int | None = None,
) -> WorkspaceMutationReceipt:
    """The synthesized terminal receipt for pre-invocation rejection or
    commit-ambiguous cancellation (§5, §7.4). ``outcome`` must be
    ``failed`` (proven no-commit) or ``unknown`` (commit cannot be disproved).
    """
    return WorkspaceMutationReceipt(
        family=family,
        action=action,
        outcome=outcome,
        body=UnresolvedMutationBody(
            family=family,
            verification=_VERIFICATION_BY_FAMILY[family],
            attempted_count=attempted_count,
        ),
    )


#: The exact 29-tool presentation registry (§7.4) — the sole source used to
#: synthesize a terminal unresolved receipt for pre-invocation rejection or a
#: commit-ambiguous close. Never derived from untrusted call arguments.
WRITE_TOOL_FAMILY_ACTION: dict[str, tuple[MutationFamily, MutationAction]] = {
    "create_tasks": ("task", "create"),
    "update_task": ("task", "update"),
    "archive_tasks": ("task", "archive"),
    "restore_task": ("task", "restore"),
    "add_schools": ("school", "create"),
    "update_school": ("school", "update"),
    "archive_schools": ("school", "archive"),
    "restore_school": ("school", "restore"),
    "create_essays": ("essay", "create"),
    "update_essay": ("essay", "update"),
    "duplicate_essay": ("essay", "duplicate"),
    "archive_essays": ("essay", "archive"),
    "restore_essay": ("essay", "restore"),
    "edit_essay": ("essay_content", "edit"),
    "write_essay": ("essay_content", "write"),
    "create_activities": ("activity", "create"),
    "update_activity": ("activity", "update"),
    "archive_activities": ("activity", "archive"),
    "restore_activity": ("activity", "restore"),
    "reorder_activities": ("activity", "reorder"),
    "create_honors": ("honor", "create"),
    "update_honor": ("honor", "update"),
    "archive_honors": ("honor", "archive"),
    "restore_honor": ("honor", "restore"),
    "reorder_honors": ("honor", "reorder"),
    "update_profile": ("profile", "update"),
    "remember": ("memory", "remember"),
    "update_memory": ("memory", "update_memory"),
    "forget": ("memory", "forget"),
}


def attach_mutation(
    payload: dict[str, Any], receipt: WorkspaceMutationReceipt
) -> dict[str, Any]:
    """Attach a built receipt to a tool payload's ``public_receipt`` (§6.7).

    Merges with any existing ``public_receipt`` (e.g. a top-level ``ui`` key
    is demoted into it later by ``app.tool_middleware.demote_tool_ui``).
    Enforces the receipt byte budget (§6.6) — this is the single call site
    every mutation tool goes through, so the bound can never be silently
    skipped.
    """
    dumped = receipt.model_dump(mode="json", by_alias=True)
    serialized_bytes = len(_dump_bytes(dumped))
    if serialized_bytes > RECEIPT_MAX_BYTES:
        # A builder bug let an oversized receipt through — fail safe rather
        # than ship an over-budget payload; callers see this in tests, not
        # in production (builders bound their own inputs before this point).
        raise ValueError(
            f"mutation receipt exceeds {RECEIPT_MAX_BYTES} bytes ({serialized_bytes} bytes)"
        )
    existing = payload.get("public_receipt")
    receipt_dict = dict(existing) if isinstance(existing, dict) else {}
    receipt_dict["mutation"] = dumped
    return {**payload, "public_receipt": receipt_dict, "mutation_contract": 1}


def _dump_bytes(value: Any) -> bytes:
    from pydantic_core import to_json

    return to_json(value)
