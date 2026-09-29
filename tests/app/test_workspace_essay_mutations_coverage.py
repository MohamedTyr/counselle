"""Hermetic contract coverage for the general essay mutation tools.

These tests deliberately stub the workspace service boundary.  The service has
its own live-DB coverage; this module verifies the agent-facing validation,
error shapes, and mutation receipts without requiring a database.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any, cast
from uuid import UUID, uuid4

import pytest

from app.workspace import agent_tools_essays_mutations as mutations
from app.workspace.agent_tools_shared import EssayDraft, ToolCtx
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import Essay, WorkspaceNotFoundError


class _Acquire:
    def __init__(self, connection: _Connection) -> None:
        self.connection = connection

    async def __aenter__(self) -> _Connection:
        return self.connection

    async def __aexit__(self, *_args: object) -> None:
        return None


class _Connection:
    def __init__(self, probe: dict[str, Any] | None = None) -> None:
        self.probe = probe
        self.queries: list[tuple[str, tuple[Any, ...]]] = []

    def fetchrow(self, query: str, *args: Any) -> Any:
        self.queries.append((query, args))
        return _Awaitable(self.probe)


class _Awaitable:
    def __init__(self, value: Any) -> None:
        self.value = value

    def __await__(self):  # type: ignore[no-untyped-def]
        async def _result() -> Any:
            return self.value

        return _result().__await__()


class _Pool:
    def __init__(self, connection: _Connection | None = None) -> None:
        self.connection = connection or _Connection()

    def acquire(self) -> _Acquire:
        return _Acquire(self.connection)


NOW = datetime(2026, 9, 15, 12, 0, tzinfo=UTC)
USER_ID = uuid4()


def _ctx(pool: Any | None = None) -> ToolCtx:
    return ToolCtx(
        app_pool=pool or _Pool(),
        catalog=cast(Any, object()),
        workspace_events=WorkspaceEventBus(),
        user_id=USER_ID,
        tool_overflow=None,
    )


def _essay(
    *,
    essay_id: UUID | None = None,
    title: str = "Personal statement",
    application_id: UUID | None = None,
    archived_at: datetime | None = None,
    deadline: date | None = None,
    word_limit: int | None = 650,
) -> Essay:
    return Essay(
        id=essay_id or uuid4(),
        user_id=USER_ID,
        application_id=application_id,
        title=title,
        essay_type="Personal statement",
        status="Drafting",
        prompt="Tell us your story.",
        word_limit=word_limit,
        word_count=12,
        school_name="Example University" if application_id else None,
        deadline=deadline,
        created_at=NOW,
        updated_at=NOW,
        archived_at=archived_at,
    )


def _links(monkeypatch: pytest.MonkeyPatch, apps: list[Any] | None = None) -> None:
    async def active(_ctx: ToolCtx) -> tuple[list[Any], list[Any]]:
        return apps or [], []

    monkeypatch.setattr(mutations, "active_workspace_links", active)


@pytest.mark.asyncio
async def test_create_rejects_empty_batch_and_duplicate_within_batch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _links(monkeypatch)
    tool: Any = mutations.make_create_essays_tool(_ctx())

    too_small = await tool.function(essays=[])
    assert too_small["status"] == "error"
    assert "1-20" in too_small["error"]

    drafts = [EssayDraft(title="Same"), EssayDraft(title=" same ")]
    duplicate = await tool.function(essays=drafts)
    assert duplicate["status"] == "error"
    assert duplicate["retryable"] is True
    assert "same batch" in duplicate["error"]


@pytest.mark.asyncio
async def test_create_duplicate_existing_is_non_retryable_and_success_has_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _links(monkeypatch)
    existing_id = uuid4()
    pool = _Pool(_Connection({"id": existing_id, "title": "Existing"}))
    create_tool: Any = mutations.make_create_essays_tool(_ctx(pool))
    duplicate = await create_tool.function(essays=[EssayDraft(title="Existing")])
    assert duplicate["status"] == "error"
    assert duplicate["retryable"] is False
    assert str(existing_id) in duplicate["error"]

    pool = _Pool()
    created = _essay(title="New draft", application_id=None, word_limit=None)
    seen: list[Any] = []

    async def create_batch(*_args: Any, **kwargs: Any) -> list[Essay]:
        seen.append(kwargs["drafts"])
        return [created]

    monkeypatch.setattr(mutations, "create_essays_batch", create_batch)
    create_tool = mutations.make_create_essays_tool(_ctx(pool))
    result = await create_tool.function(
        essays=[EssayDraft(title="New draft", content_markdown="A first draft.")]
    )
    assert result["status"] == "ok"
    assert result["essays"][0]["title"] == "New draft"
    assert result["public_receipt"]["mutation"]["action"] == "create"
    assert seen and seen[0][0].status == "Drafting"


@pytest.mark.asyncio
async def test_update_validates_id_fields_links_and_date_then_returns_typed_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _links(monkeypatch)
    tool: Any = mutations.make_update_essay_tool(_ctx())
    empty = await tool.function(essay_id=str(uuid4()))
    assert empty["status"] == "error"
    assert "No fields" in empty["error"]

    stale = await tool.function(essay_id="not-an-id", title="x")
    assert stale["status"] == "error"
    assert stale["retryable"] is False

    bad_limit = await tool.function(essay_id=str(uuid4()), word_limit="many")
    assert "not a valid number" in bad_limit["error"]
    bad_date = await tool.function(essay_id=str(uuid4()), deadline="15/09/2026")
    assert bad_date["status"] == "error"

    app_id = uuid4()
    app = type("Application", (), {"id": app_id, "school_name": "Example University"})()
    _links(monkeypatch, [app])
    essay = _essay(application_id=None, deadline=None, word_limit=None)
    updated = _essay(
        essay_id=essay.id,
        title="Updated",
        application_id=app_id,
        deadline=date(2026, 10, 1),
    )
    before_calls: list[Any] = []

    async def update(*_args: Any, **kwargs: Any) -> tuple[Essay, Essay]:
        before_calls.append(kwargs)
        return updated, essay

    monkeypatch.setattr(mutations, "update_essay", update)
    result = await tool.function(
        essay_id=str(essay.id),
        title="Updated",
        application_id=str(app_id),
        prompt="clear",
        word_limit=500,
        deadline="2026-10-01",
    )
    assert result["status"] == "ok"
    assert result["essay"]["title"] == "Updated"
    receipt = result["public_receipt"]["mutation"]
    assert receipt["action"] == "update"
    assert {c["field_key"] for c in receipt["body"]["changes"]} >= {
        "school",
        "word_limit",
        "deadline",
        "prompt",
    }
    assert before_calls and before_calls[0]["data"].prompt is None


@pytest.mark.asyncio
async def test_update_clears_fields_and_reports_unknown_application(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    unknown = str(uuid4())
    _links(monkeypatch, [])
    clear_tool: Any = mutations.make_update_essay_tool(_ctx())
    result = await clear_tool.function(essay_id=str(uuid4()), application_id=unknown)
    assert result["status"] == "error"
    assert "application_id" in result["error"]
    assert "link_targets" in result

    app_id = uuid4()
    app = type("Application", (), {"id": app_id, "school_name": "Example University"})()
    _links(monkeypatch, [app])
    before = _essay(application_id=app_id, deadline=date(2026, 9, 30), word_limit=650)
    after = _essay(essay_id=before.id, application_id=None, deadline=None, word_limit=None)

    async def update(*_args: Any, **_kwargs: Any) -> tuple[Essay, Essay]:
        return after, before

    monkeypatch.setattr(mutations, "update_essay", update)
    update_tool: Any = mutations.make_update_essay_tool(_ctx())
    result = await update_tool.function(
        essay_id=str(before.id), application_id="clear", word_limit="clear", deadline="clear"
    )
    changes = result["public_receipt"]["mutation"]["body"]["changes"]
    assert {c["operation"] for c in changes} == {"clear"}


@pytest.mark.asyncio
async def test_duplicate_handles_stale_id_and_returns_source_copy_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    original = _essay(title="Original")
    copy = _essay(title="Copy of Original")

    async def get(*_args: Any, **_kwargs: Any) -> Essay:
        return original

    async def duplicate(*_args: Any, **_kwargs: Any) -> Essay:
        return copy

    monkeypatch.setattr(mutations, "get_essay", get)
    monkeypatch.setattr(mutations, "duplicate_essay", duplicate)
    tool: Any = mutations.make_duplicate_essay_tool(_ctx())
    stale = await tool.function(essay_id="bad")
    assert stale["status"] == "error"
    result = await tool.function(essay_id=str(original.id))
    assert result["status"] == "ok"
    receipt = result["public_receipt"]["mutation"]
    assert receipt["action"] == "duplicate"
    assert receipt["body"]["source"]["resource_ref"] == str(original.id)


@pytest.mark.asyncio
async def test_archive_batch_reports_invalid_missing_and_changed_items(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    archived = _essay(title="Archive me")

    async def archive(*_args: Any, **kwargs: Any) -> Essay:
        if kwargs["essay_id"] == archived.id:
            return archived
        raise WorkspaceNotFoundError

    monkeypatch.setattr(mutations, "_archive_essay_service", archive)
    ids = ["bad", str(archived.id), str(uuid4())]
    archive_tool: Any = mutations.make_archive_essays_tool(_ctx())
    result = await archive_tool.function(essay_ids=ids)
    assert result["status"] == "warning"
    assert result["archived"] == [str(archived.id)]
    assert len(result["skipped"]) == 2
    items = result["public_receipt"]["mutation"]["body"]["items"]
    assert [item["disposition"] for item in items] == ["skipped", "changed", "skipped"]


@pytest.mark.asyncio
async def test_restore_checks_state_and_returns_transition_receipt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    essay_id = uuid4()
    tool: Any = mutations.make_restore_essay_tool(_ctx(_Pool(_Connection(None))))
    missing = await tool.function(essay_id=str(essay_id))
    assert missing["status"] == "error"

    already = _Pool(_Connection({"title": "Live", "archived_at": None, "app_archived_at": None}))
    already_tool: Any = mutations.make_restore_essay_tool(_ctx(already))
    result = await already_tool.function(essay_id=str(essay_id))
    assert result["status"] == "error"
    assert "not archived" in result["error"]

    blocked = _Pool(_Connection({"title": "Child", "archived_at": NOW, "app_archived_at": NOW}))
    blocked_tool: Any = mutations.make_restore_essay_tool(_ctx(blocked))
    result = await blocked_tool.function(essay_id=str(essay_id))
    assert "school that is also archived" in result["error"]

    restored = _essay(essay_id=essay_id, archived_at=None)
    monkeypatch.setattr(mutations, "_restore_essay_service", _async_return(restored))
    live = _Pool(_Connection({"title": "Child", "archived_at": NOW, "app_archived_at": None}))
    live_tool: Any = mutations.make_restore_essay_tool(_ctx(live))
    result = await live_tool.function(essay_id=str(essay_id))
    assert result["status"] == "ok"
    receipt = result["public_receipt"]["mutation"]
    assert receipt["action"] == "restore"
    assert receipt["body"]["state"] == "restored"


def _async_return(value: Essay) -> Any:
    async def _return(*_args: Any, **_kwargs: Any) -> Essay:
        return value

    return _return
