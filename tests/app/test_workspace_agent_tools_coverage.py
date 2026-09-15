"""Hermetic contract tests for the workspace agent tool read/write adapters."""

# The repository's existing test modules use long fixture-shaped assertions;
# keep this single ownership file readable without changing shared lint policy.
# ruff: noqa: E501

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock
from uuid import UUID, uuid4

import pytest

import app.workspace.agent_tools_memory as memory_tools
import app.workspace.agent_tools_profile as profile_tools
import app.workspace.agent_tools_schools as school_tools
from app.workspace.agent_tools_shared import ToolCtx
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import (
    Academics,
    ApplicationView,
    Document,
    EssaySummary,
    Memory,
    Profile,
    Rollup,
    Task,
    WorkspaceNotFoundError,
    WorkspaceValidationError,
)
from counselle_db.catalog import Catalog


def ctx() -> ToolCtx:
    return ToolCtx(
        app_pool=cast(Any, SimpleNamespace()),
        catalog=cast(Catalog, SimpleNamespace()),
        workspace_events=cast(WorkspaceEventBus, SimpleNamespace()),
        user_id=UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        tool_overflow=None,
    )


def memory(content: str, *, ident: UUID | None = None) -> Memory:
    stamp = datetime(2026, 9, 15, tzinfo=UTC)
    return Memory(
        id=ident or uuid4(),
        user_id=ctx().user_id,
        content=content,
        created_at=stamp,
        updated_at=stamp,
    )


@pytest.mark.asyncio
async def test_memory_rejects_invalid_batch_empty_and_long_note(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert (await memory_tools._remember_impl(ctx(), []))["retryable"] is True
    result = await memory_tools._remember_impl(ctx(), [" "])
    assert result["error"] == "notes[0] is empty."
    result = await memory_tools._remember_impl(ctx(), ["x" * 201])
    assert "cap is 200" in result["error"]


@pytest.mark.asyncio
async def test_memory_remember_normalizes_and_handles_service_capacity(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = SimpleNamespace(
        list_memories=AsyncMock(side_effect=[[], []]),
        create_memories=AsyncMock(side_effect=WorkspaceValidationError("capacity")),
    )
    monkeypatch.setattr(memory_tools, "service_memory", service)
    result = await memory_tools._remember_impl(ctx(), ["  likes   physics  "])
    assert result["status"] == "error"
    assert result["recovery"].startswith("Merge related")


@pytest.mark.asyncio
async def test_memory_remember_success_returns_rows_and_usage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created = memory("likes physics")
    service = SimpleNamespace(
        list_memories=AsyncMock(side_effect=[[], [created]]),
        create_memories=AsyncMock(return_value=[created]),
    )
    monkeypatch.setattr(memory_tools, "service_memory", service)
    result = await memory_tools._remember_impl(ctx(), [" likes   physics "])
    assert result["status"] == "ok"
    assert result["notes"][0]["content"] == "likes physics"
    assert result["public_receipt"]["mutation"]["body"]["operation"] == "remember"


@pytest.mark.asyncio
async def test_memory_update_errors_cover_stale_ambiguous_duplicate_and_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first_id = UUID("11111111-1111-1111-1111-111111111111")
    second_id = UUID("11111111-1111-1111-1111-111111111112")
    first, second = memory("old", ident=first_id), memory("other", ident=second_id)
    service = SimpleNamespace(list_memories=AsyncMock(return_value=[first, second]))
    monkeypatch.setattr(memory_tools, "service_memory", service)
    assert "empty" in (await memory_tools._update_memory_impl(ctx(), "old", " "))["error"]
    assert "cap" in (await memory_tools._update_memory_impl(ctx(), "old", "x" * 201))["error"]
    assert (
        "more than one"
        in (await memory_tools._update_memory_impl(ctx(), "11111111", "new"))["error"]
    )
    assert (
        "current ids"
        in (await memory_tools._update_memory_impl(ctx(), "deadbeef", "new"))["recovery"]
    )

    service.list_memories = AsyncMock(return_value=[first, second])
    assert (
        "already remembered"
        in (await memory_tools._update_memory_impl(ctx(), str(first_id), "other"))["error"]
    )

    updated = memory("new", ident=first_id)
    service.update_memory = AsyncMock(return_value=updated)
    service.list_memories = AsyncMock(return_value=[first])
    result = await memory_tools._update_memory_impl(ctx(), "11111111", " new ")
    assert result["status"] == "ok"
    assert result["note"]["content"] == "new"


@pytest.mark.asyncio
async def test_memory_update_maps_service_errors_and_forget_archive_race(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ident = UUID("33333333-3333-3333-3333-333333333333")
    existing = memory("old", ident=ident)
    service = SimpleNamespace(
        list_memories=AsyncMock(return_value=[existing]),
        update_memory=AsyncMock(side_effect=WorkspaceNotFoundError()),
    )
    monkeypatch.setattr(memory_tools, "service_memory", service)
    result = await memory_tools._update_memory_impl(ctx(), str(ident), "new")
    assert result["status"] == "error" and result["retryable"] is False
    service.update_memory.side_effect = WorkspaceValidationError("other validation")
    result = await memory_tools._update_memory_impl(ctx(), str(ident), "new")
    assert result["retryable"] is True and "other validation" in result["error"]
    service.update_memory.side_effect = WorkspaceValidationError("capacity reached")
    result = await memory_tools._update_memory_impl(ctx(), str(ident), "new")
    assert "capacity" in result["error"].lower()
    service.archive_memory = AsyncMock(side_effect=WorkspaceNotFoundError())
    result = await memory_tools._forget_impl(ctx(), [str(ident)])
    assert result["status"] == "error"


@pytest.mark.asyncio
async def test_memory_forget_reports_ambiguous_stale_and_archived_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first_id = UUID("22222222-2222-2222-2222-222222222221")
    second_id = UUID("22222222-2222-2222-2222-222222222222")
    service = SimpleNamespace(
        list_memories=AsyncMock(
            return_value=[memory("one", ident=first_id), memory("two", ident=second_id)]
        ),
        archive_memory=AsyncMock(),
    )
    monkeypatch.setattr(memory_tools, "service_memory", service)
    result = await memory_tools._forget_impl(ctx(), ["22222222", "deadbeef", str(first_id)])
    assert result["status"] == "warning"
    assert len(result["forgotten"]) == 1
    assert {row["id"] for row in result["skipped"]} == {"22222222", "deadbeef"}
    service.list_memories = AsyncMock(return_value=[])
    result = await memory_tools._forget_impl(ctx(), ["deadbeef"])
    assert result["status"] == "error"


def school(name: str = "North College", *, archived: bool = False) -> ApplicationView:
    stamp = datetime(2026, 9, 15, tzinfo=UTC)
    return ApplicationView(
        id=uuid4(),
        user_id=ctx().user_id,
        school_unitid=123,
        school_name=name,
        school_city="Boston",
        school_state="MA",
        status="Applying",
        list_type="Target",
        round="RD",
        deadline=date(2027, 1, 1),
        aid_deadline=date(2026, 12, 1),
        scholarship_deadline=None,
        notes="n" * 121,
        intended_major="Physics",
        test_plan="submit",
        cycle_year=2027,
        created_at=stamp,
        updated_at=stamp,
        archived_at=stamp if archived else None,
        progress=Rollup(completed=2, total=4),
        essays=Rollup(completed=1, total=2),
    )


class _Acquire:
    def __init__(self, connection: object) -> None:
        self.connection = connection

    async def __aenter__(self) -> object:
        return self.connection

    async def __aexit__(self, *_args: object) -> None:
        return None


@pytest.mark.asyncio
async def test_schools_search_clamps_limit_and_renders_locations_and_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hit = SimpleNamespace(unitid=123, name="North College", city="Boston", state="MA", on_list=True)
    search = AsyncMock(return_value=[hit])
    monkeypatch.setattr(school_tools, "search_schools", search)
    result = await school_tools._search_schools_impl(ctx(), "north", 100)
    assert result["schools"] == [
        {"unitid": 123, "name": "North College", "location": "Boston, MA", "on_list": True}
    ]
    assert search.await_args is not None
    assert search.await_args.kwargs["limit"] == 25
    search.return_value = []
    result = await school_tools._search_schools_impl(ctx(), "missing", 0)
    assert result["schools"] == []
    assert "try" in result["footer"].lower()


@pytest.mark.asyncio
async def test_schools_view_active_all_archived_and_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    active = [school("Active")]
    row = {
        "id": uuid4(),
        "school_unitid": 999,
        "list_type": "Reach",
        "round": "EA",
        "status": "Considering",
        "deadline": None,
        "archived_at": datetime(2026, 8, 1, tzinfo=UTC),
    }
    conn = SimpleNamespace(fetch=AsyncMock(return_value=[row]))
    pool = SimpleNamespace(acquire=lambda: _Acquire(conn))
    catalog = SimpleNamespace(school_name=lambda unitid: "Archived College")
    test_ctx = ToolCtx(
        pool,
        cast(Catalog, catalog),
        cast(WorkspaceEventBus, SimpleNamespace()),
        ctx().user_id,
        None,
    )
    monkeypatch.setattr(school_tools, "list_applications", AsyncMock(return_value=active))
    result = await school_tools._view_schools_impl(test_ctx, "all", 1)
    assert len(result["schools"]) == 1
    assert result["schools"][0]["state"] == "active"
    result = await school_tools._view_schools_impl(test_ctx, "archived", 5)
    assert result["schools"][0]["school"] == "Archived College"
    conn.fetch.return_value = []
    school_tools.list_applications.return_value = []  # type: ignore[attr-defined]
    result = await school_tools._view_schools_impl(test_ctx, "active", 5)
    assert result["schools"] == []


@pytest.mark.asyncio
async def test_get_school_rejects_bad_id_and_renders_detail(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    result = await school_tools._get_school_impl(ctx(), "not-a-uuid")
    assert result["status"] == "error"
    app = school()
    task = Task(
        id=uuid4(),
        user_id=ctx().user_id,
        title="Submit form",
        status="todo",
        category="form",
        priority="med",
        assignee="student",
        created_at=app.created_at,
        updated_at=app.updated_at,
        due_at=datetime(2027, 1, 1, tzinfo=UTC),
    )
    essay = EssaySummary(
        id=uuid4(),
        user_id=ctx().user_id,
        title="Why us",
        essay_type="Supplement",
        status="Drafting",
        preview="why",
        created_at=app.created_at,
        updated_at=app.updated_at,
    )
    monkeypatch.setattr(
        school_tools,
        "get_application_detail",
        AsyncMock(return_value=SimpleNamespace(application=app, tasks=[task], essays=[essay])),
    )
    result = await school_tools._get_school_impl(ctx(), str(app.id))
    assert result["status"] == "ok"
    assert result["tasks"][0]["due"] == "2027-01-01"
    assert result["essays"][0]["type"] == "Supplement"


@pytest.mark.asyncio
async def test_profile_patch_empty_clear_and_receipt_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    result = await profile_tools._update_profile_impl(ctx())
    assert result["status"] == "error"
    updated = Profile(academics=Academics(gpa_unweighted=Decimal("3.8")))
    monkeypatch.setattr(profile_tools, "update_profile", AsyncMock(return_value=updated))
    result = await profile_tools._update_profile_impl(
        ctx(), academics=Academics(gpa_unweighted=Decimal("3.8"))
    )
    assert result["status"] == "ok"
    assert (
        result["public_receipt"]["mutation"]["body"]["sections"][0]["changes"][0]["operation"]
        == "set"
    )
    monkeypatch.setattr(profile_tools, "update_profile", AsyncMock(return_value=Profile()))
    result = await profile_tools._update_profile_impl(ctx(), basics="clear")
    assert (
        result["public_receipt"]["mutation"]["body"]["sections"][0]["changes"][0]["operation"]
        == "clear"
    )


def document(*, status: str = "extracted", archived: bool = False) -> Document:
    return Document(
        id=uuid4(),
        user_id=ctx().user_id,
        title="Transcript",
        doc_type="transcript",
        filename="transcript.pdf",
        mime="application/pdf",
        size_bytes=2048,
        text_status=cast(Any, status),
        summary=None,
        created_at=datetime(2026, 9, 15, tzinfo=UTC),
        archived_at=datetime(2026, 9, 1, tzinfo=UTC) if archived else None,
    )


@pytest.mark.asyncio
async def test_profile_document_views_filter_all_and_read_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    active, archived = document(), document(archived=True)
    monkeypatch.setattr(profile_tools, "list_documents", AsyncMock(return_value=[active, archived]))
    result = await profile_tools._view_documents_impl(ctx(), "all")
    assert [row["state"] for row in result["documents"]] == ["active", "archived"]
    result = await profile_tools._view_documents_impl(ctx(), "archived")
    assert len(result["documents"]) == 1
    result = await profile_tools._view_documents_impl(ctx(), "active")
    assert len(result["documents"]) == 1
    monkeypatch.setattr(profile_tools, "list_documents", AsyncMock(return_value=[]))
    result = await profile_tools._view_documents_impl(ctx(), "active")
    assert result["documents"] == []

    first = document()
    second = document()
    # Deliberately share the displayed prefix to exercise the ambiguity guard.
    first = first.model_copy(update={"id": UUID("44444444-4444-4444-4444-444444444441")})
    second = second.model_copy(update={"id": UUID("44444444-4444-4444-4444-444444444442")})
    monkeypatch.setattr(profile_tools, "list_documents", AsyncMock(return_value=[first, second]))
    result = await profile_tools._read_document_impl(ctx(), "44444444")
    assert "more than one" in result["error"]
    result = await profile_tools._read_document_impl(ctx(), "deadbeef")
    assert result["retryable"] is False


@pytest.mark.asyncio
async def test_profile_read_document_status_not_found_and_success(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    unreadable = document(status="failed")
    monkeypatch.setattr(profile_tools, "list_documents", AsyncMock(return_value=[unreadable]))
    monkeypatch.setattr(profile_tools, "get_document", AsyncMock(return_value=unreadable))
    result = await profile_tools._read_document_impl(ctx(), str(unreadable.id))
    assert result["status"] == "error" and "can't be read" in result["error"]
    monkeypatch.setattr(
        profile_tools, "get_document", AsyncMock(side_effect=WorkspaceNotFoundError())
    )
    result = await profile_tools._read_document_impl(ctx(), str(unreadable.id))
    assert result["status"] == "error"

    extracted = document()
    content = SimpleNamespace(extracted_text="student text")
    monkeypatch.setattr(profile_tools, "list_documents", AsyncMock(return_value=[extracted]))
    monkeypatch.setattr(profile_tools, "get_document", AsyncMock(return_value=extracted))
    monkeypatch.setattr(profile_tools, "read_document", AsyncMock(return_value=content))
    result = await profile_tools._read_document_impl(ctx(), str(extracted.id))
    assert result["status"] == "ok" and "student text" in result["content"]
    profile_tools.read_document.side_effect = profile_tools.WorkspaceNotFoundError()  # type: ignore[attr-defined]
    result = await profile_tools._read_document_impl(ctx(), str(extracted.id))
    assert result["status"] == "error"


def test_profile_typed_values_and_document_helpers() -> None:
    assert profile_tools._typed_exact_value(True).kind == "boolean"
    assert profile_tools._typed_exact_value(3).kind == "integer"
    assert profile_tools._typed_exact_value(["a", 2]).kind == "text_list"
    assert profile_tools._typed_exact_value(3.5).kind == "text"
    assert profile_tools._size_display(1) == "1 KB"
    assert profile_tools._size_display(1024 * 1024) == "1.0 MB"
    stamp = datetime(2026, 9, 15, tzinfo=UTC)
    document = Document(
        id=uuid4(),
        user_id=ctx().user_id,
        title="Resume",
        doc_type="resume",
        filename="r.pdf",
        mime="application/pdf",
        size_bytes=2048,
        text_status="extracted",
        summary="s",
        created_at=stamp,
    )
    assert profile_tools._document_row(document, state="active")["summary"] == "s"
    assert profile_tools._document_state(document, "all") == "active"
