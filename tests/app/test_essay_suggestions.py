"""Unit gate for suggest-mode essay writes (plans/essay-ai-panel.md Part 1 §5).

These earn their place under the honesty carve-out: a suggestion that anchors
against the wrong text, or an accept that applies the wrong span, silently
corrupts a student's essay. Everything here runs without a database — the
validation and text projections that decide correctness are pure.
"""

from __future__ import annotations

from typing import Any, cast
from uuid import uuid4

import pytest

from api.deps import EnvelopeError
from api.routes.workspace_common import map_workspace_errors
from app.agent_node import _write_mode
from app.prompt import render_essay_context
from app.workspace import essay_markdown
from app.workspace.agent_tools_essays_suggestions import suggest_edits
from app.workspace.agent_tools_shared import ToolCtx
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import Essay, WorkspaceValidationError
from app.workspace.service_essays import STALE_SUGGESTION_MESSAGE
from domain.surface import Surface

# --------------------------------------------------------------------------
# to_plain_text — the anchoring vocabulary (Part 0 C3)
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("markdown", "plain"),
    [
        ("I love **pizza**.", "I love pizza."),
        ("_italic_ text", "italic text"),
        ("~~struck~~ out", "struck out"),
        ("`code` span", "code span"),
        ("[Harvard](https://harvard.edu) is a school", "Harvard is a school"),
        ("# Heading one", "Heading one"),
        ("- first item", "first item"),
        ("1. numbered item", "numbered item"),
        ("> quoted line", "quoted line"),
        ("escaped \\* star", "escaped * star"),
        ("", ""),
    ],
)
def test_to_plain_text_strips_every_markdown_syntax(markdown: str, plain: str) -> None:
    """Every formatted span survives as its rendered text, syntax gone.

    This is the exact bug Part 0 C3 exists to prevent: the live editor
    document carries formatting as marks, so anchoring the *markdown* string
    ``"I love **pizza**."`` inside a document reading ``"I love pizza."``
    never matches and the suggestion goes stale the instant it is created.
    """
    assert essay_markdown.to_plain_text(markdown) == plain


def test_to_plain_text_leaves_no_block_separators() -> None:
    """Blocks join with nothing, matching ProseMirror's own ``textContent``.

    Deliberately unlike ``to_markdown``, whose separators vary by container —
    plain text is only ever substring-anchored and diffed, never reparsed.
    """
    assert essay_markdown.to_plain_text("A\n\nB") == "AB"
    assert essay_markdown.to_plain_text("- one\n- two") == "onetwo"


# --------------------------------------------------------------------------
# write_mode — which sink this turn's writes land in (§5.2)
# --------------------------------------------------------------------------


def _essay(word_count: int) -> Essay:
    return cast(
        Essay, cast(Any, type("_E", (), {"word_count": word_count, "id": uuid4()}))()
    )


def test_write_mode_suggests_on_the_essay_surface_except_an_empty_first_draft() -> None:
    assert _write_mode(Surface.ESSAY, _essay(120)) == "suggest"
    # Nothing to review a first draft against, so it is committed directly.
    assert _write_mode(Surface.ESSAY, _essay(0)) == "direct"
    # An unreadable essay must not silently become a direct write.
    assert _write_mode(Surface.ESSAY, None) == "suggest"
    # The main chat is untouched (Part 0 §0.4 open question, left as direct).
    assert _write_mode(Surface.CHAT, _essay(120)) == "direct"


# --------------------------------------------------------------------------
# Suggest-mode batch validation is independent, and all-or-nothing (§5.3)
# --------------------------------------------------------------------------


def _doc(text: str) -> dict[str, Any]:
    return {
        "type": "doc",
        "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
    }


def _essay_with_content(text: str) -> Essay:
    return Essay.model_validate(
        {
            "id": uuid4(),
            "user_id": uuid4(),
            "title": "Draft",
            "essay_type": "Personal statement",
            "status": "Drafting",
            "content": _doc(text),
            "word_count": len(text.split()),
            "created_at": "2026-09-04T12:00:00+00:00",
            "updated_at": "2026-09-04T12:00:00+00:00",
        }
    )


def test_essay_context_block_never_carries_the_write_guard_version_token() -> None:
    """The prompt block is prose the model quotes from; the token is plumbing.

    A live essay turn ended with ``**Expected Version:**
    `2026-09-05T04:19:42.081700+00:00` `` in the student's answer — the model
    narrated an ``edit_essay`` call instead of making one, and reproduced this
    block's version line verbatim because the block told it to. ``read_essay``
    is the token's single source (both content tools' docstrings already say
    "Always read_essay first"), so it must not appear here at all.
    """
    essay = _essay_with_content("A first sentence about bread.")
    rendered = render_essay_context(essay, selection=None, max_chars=8_000)

    assert essay.updated_at.isoformat() not in rendered
    assert "expected_version" not in rendered
    # The essay id is still handed over — it is the one identifier a tool call
    # cannot be made without — and the read_essay instruction replaces the token.
    assert str(essay.id) in rendered
    assert "read_essay" in rendered


def _exploding_ctx() -> ToolCtx:
    """A ``ToolCtx`` whose pool detonates on use.

    Validation runs entirely before the write, so a batch that fails must
    never reach the database — the pool asserts that rather than a comment.
    """

    class _NoPool:
        def acquire(self, *_: object, **__: object) -> object:
            raise AssertionError("a failed suggest batch must not touch the database")

    return ToolCtx(
        app_pool=cast(Any, _NoPool()),
        catalog=cast(Any, None),
        workspace_events=WorkspaceEventBus(),
        user_id=uuid4(),
        tool_overflow=None,
        write_mode="suggest",
        turn_message_id=str(uuid4()),
    )


async def test_suggest_rejects_a_cross_dependent_batch_whole_and_writes_nothing() -> None:
    """Edit 1 only becomes findable once edit 0 lands — which never happens.

    ``apply_edits`` validates a *direct* batch cumulatively, and that is right
    there: the whole batch commits as one document. Suggestions are accepted
    one at a time in any order, so a cross-dependent pair would go stale (or
    match text nobody proposed) for no reason the student could see. Rejecting
    the batch at creation turns "the edits are independent" into a precondition.
    """
    essay = _essay_with_content("The board hissed.")
    result = await suggest_edits(
        _exploding_ctx(),
        essay,
        [
            essay_markdown.Edit(old_text="hissed", new_text="hissed back"),
            essay_markdown.Edit(old_text="hissed back", new_text="hissed back loudly"),
        ],
    )

    assert result["status"] == "error"
    assert result["retryable"] is True
    # The real position in the caller's batch, not the 0 the single-edit
    # apply_edits call raised.
    assert result["error"].startswith("edits[1]:")
    assert "findable in the original text" in result["recovery"]


async def test_suggest_remaps_the_failing_edit_index_to_its_batch_position() -> None:
    essay = _essay_with_content("repeat and repeat again.")
    result = await suggest_edits(
        _exploding_ctx(),
        essay,
        [
            essay_markdown.Edit(old_text="again", new_text="once more"),
            essay_markdown.Edit(old_text="missing text", new_text="x"),
            essay_markdown.Edit(old_text="repeat", new_text="echo"),
        ],
    )

    assert result["status"] == "error"
    assert result["error"].startswith("edits[1]:")


# --------------------------------------------------------------------------
# The stale-accept status (§6.3) — 422, not 409
# --------------------------------------------------------------------------


async def test_stale_suggestion_maps_to_422_not_409() -> None:
    """``map_workspace_errors`` reserves 409 for the literal "already active".

    The stale message must not contain that phrase, or a stale accept would
    surface as a conflict the client has no way to resolve.
    """
    assert "already active" not in STALE_SUGGESTION_MESSAGE

    async def _raise() -> None:
        raise WorkspaceValidationError(STALE_SUGGESTION_MESSAGE)

    with pytest.raises(EnvelopeError) as excinfo:
        await map_workspace_errors(_raise)
    assert excinfo.value.status_code == 422
    assert excinfo.value.message == STALE_SUGGESTION_MESSAGE
