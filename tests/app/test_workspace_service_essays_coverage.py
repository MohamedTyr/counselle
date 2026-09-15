"""Hermetic contract coverage for the essay workspace service.

The fakes implement only the asyncpg boundary.  They deliberately record SQL,
transactions, and returned rows so these tests exercise service decisions and
the post-commit event contract without a database or network.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, cast
from uuid import uuid4

import pytest

from app.workspace import service_essays as service
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import (
    EssayCreate,
    EssayPatch,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)


class _AsyncContext:
    def __init__(self, value: Any) -> None:
        self.value = value
        self.entered = False

    async def __aenter__(self) -> Any:
        self.entered = True
        return self.value

    async def __aexit__(self, *_: object) -> None:
        return None


class _Conn:
    def __init__(
        self,
        *,
        fetch_rows: list[dict[str, Any]] | None = None,
        fetchrow_values: list[dict[str, Any] | None] | None = None,
    ) -> None:
        self.fetch_rows = fetch_rows or []
        self.fetchrow_values = list(fetchrow_values or [])
        self.calls: list[tuple[str, tuple[object, ...]]] = []
        self.transactions: list[_AsyncContext] = []

    def transaction(self) -> _AsyncContext:
        context = _AsyncContext(self)
        self.transactions.append(context)
        return context

    async def fetch(self, sql: str, *args: object) -> list[dict[str, Any]]:
        self.calls.append((sql, args))
        return self.fetch_rows

    async def fetchrow(self, sql: str, *args: object) -> dict[str, Any] | None:
        self.calls.append((sql, args))
        if self.fetchrow_values:
            return self.fetchrow_values.pop(0)
        return None

    async def fetchval(self, sql: str, *args: object) -> int:
        self.calls.append((sql, args))
        return 41


class _Acquire:
    def __init__(self, conn: _Conn) -> None:
        self.conn = conn

    async def __aenter__(self) -> _Conn:
        return self.conn

    async def __aexit__(self, *_: object) -> None:
        return None


class _Pool:
    def __init__(self, conn: _Conn) -> None:
        self.conn = conn
        self.acquire_count = 0

    def acquire(self) -> _Acquire:
        self.acquire_count += 1
        return _Acquire(self.conn)


class _CatalogPool:
    async def fetch(self, _sql: str, _unitids: list[int]) -> list[dict[str, Any]]:
        return []


class _Catalog:
    def __init__(self) -> None:
        self.pool = _CatalogPool()

    def school_domain(self, _unitid: int) -> None:
        return None


def _catalog() -> Any:
    return cast(Any, _Catalog())


USER = uuid4()
ESSAY = uuid4()
APPLICATION = uuid4()
NOW = datetime(2027, 1, 1, tzinfo=UTC)


def _row(**changes: object) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": ESSAY,
        "user_id": USER,
        "application_id": None,
        "title": "Personal statement",
        "essay_type": "Personal statement",
        "status": "Drafting",
        "prompt": "Tell us your story.",
        "content": {
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "hello world"}]}
            ],
        },
        "word_count": 2,
        "word_limit": 650,
        "deadline": None,
        "comments": [],
        "suggestions": [],
        "archived_via_application": None,
        "created_at": NOW,
        "updated_at": NOW,
        "archived_at": None,
        "school_unitid": None,
        "comment_count": 0,
        "suggestion_count": 0,
    }
    row.update(changes)
    return row


def _draft(**changes: Any) -> EssayCreate:
    values: dict[str, Any] = {"title": "Draft", "application_id": None}
    values.update(changes)
    return EssayCreate(**values)


async def _read_event(bus: WorkspaceEventBus, operation: Any) -> Any:
    async with bus.subscribe(USER) as queue:
        result = await operation()
        return result, await queue.get()


async def test_list_get_and_formatting_helpers() -> None:
    row = _row(school_unitid=123, comment_count=1, suggestion_count=2)
    pool = _Pool(_Conn(fetch_rows=[row], fetchrow_values=[row]))
    catalog = _catalog()
    summaries = await service.list_essays(pool, catalog, user_id=USER)
    assert summaries[0].preview == "hello world"
    assert (
        await service.get_essay(pool, catalog, user_id=USER, essay_id=ESSAY)
    ).title == "Personal statement"
    assert "archived_at IS NULL" in pool.conn.calls[0][0]
    assert service.tiptap_preview({"content": [{"text": "a"}, {"text": "b"}]}) == "a b"
    assert service._word_count({"content": [{"text": "a"}, {"text": " b  c"}]}) == 3
    assert service._word_count(None) == 0
    assert service._tiptap_text([{"text": "x"}, "ignored"]) == ["x"]


async def test_get_missing_and_create_validates_application_records_event() -> None:
    missing_pool = _Pool(_Conn(fetchrow_values=[None]))
    with pytest.raises(WorkspaceNotFoundError):
        await service.get_essay(missing_pool, _catalog(), user_id=USER, essay_id=ESSAY)

    row = _row(
        application_id=APPLICATION,
        content={
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "one two"}]}],
        },
    )
    conn = _Conn(fetchrow_values=[{"id": APPLICATION}, row, row])
    pool = _Pool(conn)
    bus = WorkspaceEventBus()
    result, event = await _read_event(
        bus,
        lambda: service.create_essay(
            pool,
            _catalog(),
            bus,
            user_id=USER,
            actor="student",
            data=_draft(application_id=APPLICATION, content=row["content"]),
        ),
    )
    assert result.id == ESSAY and event.type == "essay.created"
    assert conn.transactions[0].entered
    insert = next(args for sql, args in conn.calls if "INSERT INTO counselle.essays" in sql)
    assert insert[7] == 2  # server-derived word count
    assert any("FOR UPDATE" in sql for sql, _ in conn.calls)


async def test_create_batch_is_transactional_and_empty_batch_does_not_acquire() -> None:
    first = _row(id=uuid4(), title="one")
    second = _row(id=uuid4(), title="two")
    conn = _Conn(
        fetch_rows=[first, second],
        fetchrow_values=[{"id": APPLICATION}, first, {"id": APPLICATION}, second],
    )
    pool = _Pool(conn)
    result = await service.create_essays_batch(
        pool,
        _catalog(),
        WorkspaceEventBus(),
        user_id=USER,
        actor="counselle",
        drafts=[
            _draft(title="one", application_id=APPLICATION),
            _draft(title="two", application_id=APPLICATION),
        ],
    )
    assert [essay.id for essay in result] == [first["id"], second["id"]]
    assert len(conn.transactions) == 1
    assert "ANY($2::uuid[])" in conn.calls[-1][0]


async def test_update_revalidates_link_derives_count_supports_before_and_stale_guard() -> None:
    old = _row(application_id=None)
    current = _row(application_id=None)
    changed = _row(
        title="Updated",
        content={
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "one two three"}]}
            ],
        },
    )
    conn = _Conn(fetchrow_values=[old, current, changed, changed])
    bus = WorkspaceEventBus()
    after, before = await service.update_essay(
        _Pool(conn),
        _catalog(),
        bus,
        user_id=USER,
        actor="student",
        essay_id=ESSAY,
        data=EssayPatch(title="Updated", content=changed["content"], expected_updated_at=NOW),
        with_before=True,
    )
    assert after.title == "Updated" and before.title == "Personal statement"
    update_args = next(args for sql, args in conn.calls if "SET title = CASE" in sql)
    assert update_args[15] == 3
    assert any("FOR UPDATE" in sql for sql, _ in conn.calls)

    with pytest.raises(WorkspaceValidationError, match="expected_updated_at"):
        service._check_not_stale(NOW, NOW.replace(year=2028))


async def test_append_and_resolve_suggestions_accept_reject_stale_and_all() -> None:
    suggestion_id = uuid4()
    suggestion = {"id": str(suggestion_id), "old_text": "hello", "new_text": "goodbye"}
    row = _row(suggestions=[suggestion])
    appended = _row(
        suggestions=[suggestion, {"id": str(uuid4()), "old_text": "world", "new_text": "earth"}]
    )
    conn = _Conn(
        fetchrow_values=[
            row,
            appended,
            row,
            row,
            _row(
                content={
                    "type": "doc",
                    "content": [
                        {
                            "type": "paragraph",
                            "content": [{"type": "text", "text": "goodbye world"}],
                        }
                    ],
                }
            ),
        ]
    )
    pool = _Pool(conn)
    bus = WorkspaceEventBus()
    result = await service.append_suggestions(
        pool, bus, user_id=USER, actor="counselle", essay_id=ESSAY, suggestions=[suggestion]
    )
    assert len(result.suggestions) == 2
    accepted = await service.resolve_suggestion(
        pool,
        _catalog(),
        bus,
        user_id=USER,
        actor="student",
        essay_id=ESSAY,
        suggestion_id=suggestion_id,
        accept=True,
    )
    assert accepted.id == ESSAY
    all_row = _row(suggestions=[suggestion])
    all_conn = _Conn(fetchrow_values=[all_row, _row(suggestions=[]), _row(suggestions=[])])
    all_result = await service.resolve_all_suggestions(
        _Pool(all_conn),
        _catalog(),
        bus,
        user_id=USER,
        actor="student",
        essay_id=ESSAY,
        accept=False,
    )
    assert all_result["applied"] == 1 and all_result["skipped"] == []
    assert service._find_suggestion([suggestion], suggestion_id) == suggestion
    assert service._find_suggestion([], suggestion_id) is None

    stale_row = _row(
        suggestions=[suggestion],
        content={
            "type": "doc",
            "content": [
                {"type": "paragraph", "content": [{"type": "text", "text": "no matching text"}]}
            ],
        },
    )
    stale_conn = _Conn(fetchrow_values=[stale_row])
    with pytest.raises(WorkspaceValidationError, match="stale"):
        await service.resolve_suggestion(
            _Pool(stale_conn),
            _catalog(),
            bus,
            user_id=USER,
            actor="student",
            essay_id=ESSAY,
            suggestion_id=suggestion_id,
            accept=True,
        )


async def test_duplicate_archive_restore_and_error_paths_publish_events() -> None:
    row = _row()
    copy = _row(id=uuid4(), title="Copy of Personal statement")
    conn = _Conn(fetchrow_values=[row, copy, copy])
    pool = _Pool(conn)
    bus = WorkspaceEventBus()
    duplicated = await service.duplicate_essay(
        pool, _catalog(), bus, user_id=USER, actor="student", essay_id=ESSAY
    )
    assert duplicated.title.startswith("Copy of")
    archive_conn = _Conn(fetchrow_values=[_row(archived_at=NOW)])
    archived = await service.archive_essay(
        _Pool(archive_conn), bus, user_id=USER, actor="student", essay_id=ESSAY
    )
    assert archived.archived_at == NOW
    restore_conn = _Conn(
        fetchrow_values=[
            _row(archived_at=NOW),
            _row(archived_at=NOW),
            _row(archived_at=None),
            _row(archived_at=None),
        ]
    )
    restored = await service.restore_essay(
        _Pool(restore_conn), _catalog(), bus, user_id=USER, actor="student", essay_id=ESSAY
    )
    assert restored.archived_at is None
    assert any("archived_at IS NOT NULL" in sql for sql, _ in restore_conn.calls)

    operations: tuple[Callable[[], Awaitable[Any]], ...] = (
        lambda: service.archive_essay(
            _Pool(_Conn(fetchrow_values=[None])), bus, user_id=USER, actor="student", essay_id=ESSAY
        ),
        lambda: service.duplicate_essay(
            _Pool(_Conn(fetchrow_values=[None])),
            _catalog(),
            bus,
            user_id=USER,
            actor="student",
            essay_id=ESSAY,
        ),
    )
    for operation in operations:
        with pytest.raises(WorkspaceNotFoundError):
            await operation()


def test_pure_helpers_cover_nested_and_length_boundaries() -> None:
    content = {"type": "doc", "content": [{"content": [{"text": "a" * 200}, {"text": "tail"}]}]}
    assert len(service.tiptap_preview(content, max_chars=5)) == 5
    assert service._apply_suggestion(
        {
            "type": "doc",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": "old"}]}],
        },
        {"old_text": "old", "new_text": "new"},
    )
    with pytest.raises(WorkspaceValidationError):
        service._check_not_stale(NOW, NOW.replace(day=2))
