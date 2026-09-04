"""Suggest-mode writes for ``edit_essay``/``write_essay`` (plan Part 1 §5).

Same model vocabulary as a direct write — ``{old_text, new_text}`` pairs — with
a different sink: instead of committing new content, each edit becomes one
pending suggestion in ``essays.suggestions`` for the student to accept or
reject. Split out of ``agent_tools_essays_content.py`` to keep both files small
and this mode's rules in one readable place.

Two rules make this more than a re-routed write:

* **Each edit is validated independently, against the original document.**
  ``apply_edits`` validates a batch cumulatively — edit *i* is matched against
  the buffer edits *0..i-1* already mutated, which is right when the whole
  batch commits as one document. Suggestions don't: the student accepts them
  one at a time, in any order. A cross-dependent edit would therefore fail (or,
  worse, match different text) at accept time, for no reason the student can
  see. So every edit must stand on its own against the essay as it is now.
* **The batch is all-or-nothing.** One unusable edit fails the whole call with
  a retryable error and stores nothing, rather than leaving the student a
  partial set of suggestions the agent never described.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from app.workspace import essay_markdown
from app.workspace.agent_tools_essays import words_display
from app.workspace.agent_tools_shared import ToolCtx, essay_edit_error, stale_essay_error, today
from app.workspace.models import Essay, WorkspaceNotFoundError
from app.workspace.service_essays import append_suggestions

_BATCH_INDEPENDENCE_RECOVERY = (
    " Edits in one batch must each be findable in the original text — write edits that "
    "don't depend on each other landing first."
)

_SUGGESTION_FOOTER = (
    "These are suggestions, not applied yet — the student reviews and accepts or rejects "
    "each one. Say what you changed and why; don't claim the essay now reads differently."
)


async def suggest_edits(
    ctx: ToolCtx,
    essay: Essay,
    edits: list[essay_markdown.Edit],
    *,
    rationales: list[str] | None = None,
) -> dict[str, Any]:
    """Validate ``edits`` independently, then store them as pending suggestions.

    Returns the tool payload — the same ``status``/``words``/``version`` shape
    a direct write returns, so the model needs no new success vocabulary.
    """
    unusable = _first_unusable_edit(essay, edits)
    if unusable is not None:
        return unusable

    created_at = datetime.now(UTC).isoformat()
    suggestions = [
        _suggestion(
            edit,
            essay=essay,
            created_at=created_at,
            rationale=(rationales[index] if rationales is not None else ""),
            turn_message_id=ctx.turn_message_id,
        )
        for index, edit in enumerate(edits)
    ]
    try:
        updated = await append_suggestions(
            ctx.app_pool,
            ctx.workspace_events,
            user_id=ctx.user_id,
            actor="counselle",
            essay_id=essay.id,
            suggestions=suggestions,
        )
    except WorkspaceNotFoundError:
        return stale_essay_error(str(essay.id))

    plural = "s" if len(suggestions) != 1 else ""
    return {
        "status": "ok",
        "today": today(),
        "words": words_display(updated.word_count, updated.word_limit),
        "version": updated.updated_at.isoformat(),
        "summary": f"Proposed {len(suggestions)} suggested edit{plural} for the student to review.",
        "suggestion_ids": [suggestion["id"] for suggestion in suggestions],
        "footer": _SUGGESTION_FOOTER,
    }


def _first_unusable_edit(
    essay: Essay, edits: list[essay_markdown.Edit]
) -> dict[str, Any] | None:
    """The error payload for the first edit that can't stand on its own, if any.

    Each edit is checked against the *original* document, never a running
    mutated copy, so a batch whose members depend on each other landing in
    order is refused here rather than becoming suggestions that go stale the
    moment the student accepts one out of order.
    """
    for index, edit in enumerate(edits):
        try:
            essay_markdown.apply_edits(essay.content, [edit])
        except essay_markdown.EssayEditError as exc:
            # The raised index is always 0 (one edit per call); the model must
            # be told which edit in *its* batch failed.
            return essay_edit_error(
                index, exc.reason, exc.detail, recovery_suffix=_BATCH_INDEPENDENCE_RECOVERY
            )
    return None


def _suggestion(
    edit: essay_markdown.Edit,
    *,
    essay: Essay,
    created_at: str,
    rationale: str,
    turn_message_id: str | None,
) -> dict[str, Any]:
    """One persisted suggestion (plan Part 0 C3).

    ``old_text``/``new_text`` are markdown — the server's own apply vocabulary,
    identical to ``edit_essay``'s. The ``_plain`` twins are the same spans with
    markdown syntax stripped, which is the only form that can be anchored
    against the live editor document (where a bold span is a mark, not literal
    ``**``). Storing both is what keeps a suggestion on formatted text from
    going stale the instant it's created.

    No ``status`` and no ``kind`` are stored: a resolved suggestion is removed
    from the array, so every persisted row is pending by definition, and the
    kind follows from an empty ``new_text``.
    """
    return {
        "id": str(uuid4()),
        "old_text": edit.old_text,
        "new_text": edit.new_text,
        "old_text_plain": essay_markdown.to_plain_text(edit.old_text),
        "new_text_plain": essay_markdown.to_plain_text(edit.new_text),
        "rationale": rationale,
        "actor": "counselle",
        "created_at": created_at,
        "essay_version_at_creation": essay.updated_at.isoformat(),
        "turn_message_id": turn_message_id,
    }
