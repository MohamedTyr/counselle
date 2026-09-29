"""Hermetic contract coverage for the essay content agent tools.

The live-db tests cover the persistence path.  These tests pin the tool's
decision branches and payload contract with typed, in-memory doubles so that
validation and failure behavior remains inexpensive to exercise.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast
from uuid import uuid4

import pytest

from app.workspace import agent_tools_essays_content as content_tools
from app.workspace import essay_markdown
from app.workspace.agent_tools_essays_content import EditItem
from app.workspace.agent_tools_shared import ToolCtx
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import Essay, WorkspaceNotFoundError, WorkspaceValidationError
from app.workspace_mutation_receipts import essay_write_receipt, subject


def _essay(
    *,
    text: str = "The old draft.",
    word_count: int = 3,
    word_limit: int | None = None,
    status: str = "Drafting",
    updated_at: datetime | None = None,
    suggestions: list[dict[str, Any]] | None = None,
) -> Essay:
    now = updated_at or datetime(2026, 9, 15, 12, tzinfo=UTC)
    return Essay.model_construct(
        id=uuid4(),
        user_id=uuid4(),
        title="Personal statement",
        essay_type="Personal Statement",
        status=status,
        content=essay_markdown.to_tiptap(text),
        word_count=word_count,
        word_limit=word_limit,
        comments=[],
        suggestions=suggestions or [],
        updated_at=now,
        created_at=now,
        application_id=None,
        prompt=None,
        archived_via_application=None,
        school_name=None,
        school_city=None,
        school_state=None,
        school_website_url=None,
        deadline=None,
        archived_at=None,
    )


def _ctx(*, suggest: bool = False) -> ToolCtx:
    return ToolCtx(
        app_pool=cast(Any, object()),
        catalog=cast(Any, object()),
        workspace_events=WorkspaceEventBus(),
        user_id=uuid4(),
        tool_overflow=None,
        write_mode="suggest" if suggest else "direct",
        turn_message_id="turn-123" if suggest else None,
    )


def _version(essay: Essay) -> str:
    return essay.updated_at.isoformat()


@pytest.mark.asyncio
async def test_apply_content_write_success_includes_warning_footer_and_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    before = _essay(word_count=4, word_limit=2, status="Not started")
    saved = _essay(word_count=4, word_limit=2, status="Not started", updated_at=before.updated_at)

    async def fake_update(*args: Any, **kwargs: Any) -> Essay:
        assert kwargs["essay_id"] == before.id
        assert kwargs["data"].expected_updated_at == before.updated_at
        return saved

    monkeypatch.setattr(content_tools, "update_essay", fake_update)
    receipt = essay_write_receipt(
        essay_subject=subject(saved.title, saved.id),
        mode="replaced",
        previous_word_count=1,
        final_word_count=saved.word_count,
        word_limit=saved.word_limit,
    )

    result = await content_tools._apply_content_write(
        _ctx(), str(before.id), _version(before), saved.content, build_mutation=lambda _: receipt
    )

    assert result["status"] == "ok"
    assert result["words"] == "4/2"
    assert result["warning"].startswith("Over the word limit")
    assert 'status is still "Not started"' in result["footer"]
    assert result["public_receipt"]["mutation"]["action"] == "write"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("essay_id", "expected_version", "exception", "expected"),
    [
        ("not-a-uuid", "2026-09-15T12:00:00+00:00", None, "No active essay"),
        (str(uuid4()), "not-a-date", None, "changed"),
        (str(uuid4()), "2026-09-15T12:00:00+00:00", WorkspaceNotFoundError(), "No active essay"),
        (str(uuid4()), "2026-09-15T12:00:00+00:00", WorkspaceValidationError(), "changed"),
    ],
)
async def test_apply_content_write_maps_invalid_stale_and_validation_failures(
    monkeypatch: pytest.MonkeyPatch,
    essay_id: str,
    expected_version: str,
    exception: Exception | None,
    expected: str,
) -> None:
    if exception is not None:

        async def fake_update(*args: Any, **kwargs: Any) -> Essay:
            raise exception

        monkeypatch.setattr(content_tools, "update_essay", fake_update)

    result = await content_tools._apply_content_write(
        _ctx(), essay_id, expected_version, {"type": "doc"}
    )
    assert result["status"] == "error"
    assert (
        expected.lower() in result["error"].lower()
        or expected.lower() in result["recovery"].lower()
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("count", [0, 21])
async def test_edit_rejects_batches_outside_one_to_twenty(count: int) -> None:
    result = await content_tools._edit_essay_impl(
        _ctx(), str(uuid4()), "bad-version", [EditItem(old_text="a", new_text="b")] * count
    )
    assert result["status"] == "error"
    assert result["retryable"] is True
    assert "1-20" in result["error"]


@pytest.mark.asyncio
async def test_edit_rejects_missing_essay_and_stale_version(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    essay = _essay()

    async def missing(*args: Any, **kwargs: Any) -> Essay:
        raise WorkspaceNotFoundError()

    monkeypatch.setattr(content_tools, "get_essay", missing)
    missing_result = await content_tools._edit_essay_impl(
        _ctx(), str(essay.id), _version(essay), [EditItem(old_text="old", new_text="new")]
    )
    assert missing_result["retryable"] is False

    monkeypatch.setattr(content_tools, "get_essay", lambda *a, **k: _async_return(essay))
    stale = await content_tools._edit_essay_impl(
        _ctx(),
        str(essay.id),
        "2020-01-01T00:00:00+00:00",
        [EditItem(old_text="old", new_text="new")],
    )
    assert stale["retryable"] is True
    assert "changed" in stale["error"]


async def _async_return(value: Essay) -> Essay:
    return value


@pytest.mark.asyncio
async def test_edit_direct_maps_edit_error_and_builds_redacted_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    essay = _essay(text="Keep this sentence.", word_count=3)
    monkeypatch.setattr(content_tools, "get_essay", lambda *a, **k: _async_return(essay))

    result = await content_tools._edit_essay_impl(
        _ctx(), str(essay.id), _version(essay), [EditItem(old_text="missing", new_text="x")]
    )
    assert result["status"] == "error"
    assert result["error"].startswith("edits[0]:")

    saved = _essay(text="Keep this changed sentence.", word_count=4)

    async def fake_update(*args: Any, **kwargs: Any) -> Essay:
        return saved

    monkeypatch.setattr(content_tools, "update_essay", fake_update)
    result = await content_tools._edit_essay_impl(
        _ctx(),
        str(essay.id),
        _version(essay),
        [EditItem(old_text="this", new_text="this changed")],
    )
    operation = result["public_receipt"]["mutation"]["body"]["operations"][0]
    assert result["summary"] == "Applied 1 edit."
    assert operation["operation"] == "replace"
    assert "old_text" not in result["public_receipt"]
    assert "new_text" not in result["public_receipt"]


@pytest.mark.asyncio
async def test_edit_suggest_mode_delegates_rationales_and_never_updates_content(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    essay = _essay(text="A true story.")
    monkeypatch.setattr(content_tools, "get_essay", lambda *a, **k: _async_return(essay))
    calls: list[Any] = []

    async def fake_suggest(*args: Any, **kwargs: Any) -> dict[str, Any]:
        calls.append((args, kwargs))
        return {"status": "ok", "suggestion_ids": ["s1"]}

    monkeypatch.setattr(content_tools, "suggest_edits", fake_suggest)
    result = await content_tools._edit_essay_impl(
        _ctx(suggest=True),
        str(essay.id),
        _version(essay),
        [EditItem(old_text="true", new_text="honest", rationale="be specific")],
    )
    assert result == {"status": "ok", "suggestion_ids": ["s1"]}
    assert calls[0][1]["rationales"] == ["be specific"]


@pytest.mark.asyncio
async def test_write_rejects_blank_and_stale_or_missing_essay(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    blank = await content_tools._write_essay_impl(_ctx(), str(uuid4()), "bad", " \n")
    assert blank["retryable"] is False
    assert "never blanked" in blank["error"]

    async def missing(*args: Any, **kwargs: Any) -> Essay:
        raise WorkspaceNotFoundError()

    monkeypatch.setattr(content_tools, "get_essay", missing)
    result = await content_tools._write_essay_impl(_ctx(), str(uuid4()), "v", "Draft")
    assert result["retryable"] is False


@pytest.mark.asyncio
async def test_write_direct_and_suggest_full_redraft_paths(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    before = _essay(text="Old draft.", word_count=2)
    saved = _essay(text="New draft now.", word_count=3)
    monkeypatch.setattr(content_tools, "get_essay", lambda *a, **k: _async_return(before))
    monkeypatch.setattr(content_tools, "update_essay", lambda *a, **k: _async_return(saved))

    direct = await content_tools._write_essay_impl(
        _ctx(), str(before.id), _version(before), "New draft now."
    )
    assert direct["summary"] == "Replaced the essay's content."
    assert direct["public_receipt"]["mutation"]["body"]["mode"] == "replaced"

    suggestions: list[Any] = []

    async def fake_suggest(*args: Any, **kwargs: Any) -> dict[str, Any]:
        suggestions.append((args, kwargs))
        return {"status": "ok", "suggestion_ids": ["full"]}

    monkeypatch.setattr(content_tools, "suggest_edits", fake_suggest)
    proposed = await content_tools._suggest_full_redraft(
        _ctx(suggest=True), before, _version(before), "Entirely new draft."
    )
    assert proposed["suggestion_ids"] == ["full"]
    assert suggestions[0][1]["rationales"] == ["Full redraft of the essay."]


@pytest.mark.asyncio
async def test_suggest_full_redraft_empty_essay_commits_directly_with_drafted_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    before = _essay(text="", word_count=0, status="Not started")
    saved = _essay(text="First draft.", word_count=2, status="Not started")
    monkeypatch.setattr(content_tools, "update_essay", lambda *a, **k: _async_return(saved))

    result = await content_tools._suggest_full_redraft(
        _ctx(suggest=True), before, _version(before), "First draft."
    )
    assert result["summary"].startswith("Drafted the essay directly")
    assert result["public_receipt"]["mutation"]["body"]["mode"] == "drafted"


@pytest.mark.asyncio
async def test_public_tool_wrappers_run_result_middleware(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _ctx()
    seen: list[str] = []

    async def fake_edit(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"status": "ok", "value": "edit"}

    async def fake_write(*args: Any, **kwargs: Any) -> dict[str, Any]:
        return {"status": "ok", "value": "write"}

    monkeypatch.setattr(content_tools, "_edit_essay_impl", fake_edit)
    monkeypatch.setattr(content_tools, "_write_essay_impl", fake_write)

    def middleware(
        result: Any, context: Any, *, tool_name: str | None = None, **kwargs: Any
    ) -> Any:
        seen.append(tool_name or "")
        return {**result, "processed": True}

    monkeypatch.setattr(content_tools, "process_tool_result", middleware)
    edit_result = await cast(Any, content_tools.make_edit_essay_tool(ctx).function)(
        essay_id="id", expected_version="v", edits=[]
    )
    write_result = await cast(Any, content_tools.make_write_essay_tool(ctx).function)(
        essay_id="id", expected_version="v", content_markdown="draft"
    )
    assert edit_result["processed"] is True
    assert write_result["processed"] is True
    assert seen == ["edit_essay", "write_essay"]
