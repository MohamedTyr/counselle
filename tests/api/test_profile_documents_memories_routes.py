"""Phase 5 profile/document/memory route tests: upload multipart, ownership scoping."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth import current_active_user
from api.context import install_middleware
from api.ratelimit import _RATE_LIMITER_ATTR, SlidingWindowLimiter
from api.routes import documents, memories, profile
from app.workspace.changes import WorkspaceEventBus
from app.workspace.models import Document, Memory, Profile, WorkspaceNotFoundError
from tests.api.conftest import TEST_USER_ID, _test_user

_UNKNOWN_UUID = "00000000-0000-4000-8000-000000000001"


def _await_kwargs(mock: AsyncMock) -> Any:
    """Assert the mock was awaited and return its kwargs (mypy-friendly)."""
    call = mock.await_args
    assert call is not None
    return call.kwargs


def _app(*, authed: bool = True, workspace_writes_per_minute: int = 240) -> FastAPI:
    app = FastAPI()
    settings = SimpleNamespace(
        cors_origins=["*"],
        sse_keepalive_s=15,
        workspace_writes_per_minute=workspace_writes_per_minute,
        document_extraction_timeout_s=8.0,
    )
    install_middleware(app, settings)
    app.include_router(profile.router, prefix="/v1")
    app.include_router(documents.router, prefix="/v1")
    app.include_router(memories.router, prefix="/v1")
    app.state.settings = settings
    app.state.runtime = SimpleNamespace(
        app_pool=object(),
        deps=SimpleNamespace(
            catalog=object(),
            workspace_events=WorkspaceEventBus(),
            workspace_seeding_template=object(),
            document_summary_generator=None,
        ),
    )
    setattr(app.state, _RATE_LIMITER_ATTR, SlidingWindowLimiter())
    if authed:
        app.dependency_overrides[current_active_user] = _test_user
    return app


def _profile() -> Profile:
    return Profile()


def _document(document_id: UUID | None = None) -> Document:
    return Document(
        id=document_id or uuid4(),
        user_id=TEST_USER_ID,
        title="Transcript",
        doc_type="transcript",
        filename="transcript.pdf",
        mime="application/pdf",
        size_bytes=100,
        text_status="extracted",
        created_at=datetime.now(UTC),
    )


def _memory(memory_id: UUID | None = None) -> Memory:
    return Memory(
        id=memory_id or uuid4(),
        user_id=TEST_USER_ID,
        content="prefers blunt feedback",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )


# ---------------------------------------------------------------------------
# Auth required on every surface
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/v1/profile"),
        ("get", "/v1/documents"),
        ("get", "/v1/memories"),
    ],
)
def test_routes_require_auth(method: str, path: str) -> None:
    with TestClient(_app(authed=False), raise_server_exceptions=False) as client:
        response = getattr(client, method)(path)

    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Profile
# ---------------------------------------------------------------------------


def test_get_profile_route_scopes_to_authenticated_user() -> None:
    service = AsyncMock(return_value=_profile())
    with (
        patch("api.routes.profile.get_profile", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.get("/v1/profile")

    assert response.status_code == 200
    assert _await_kwargs(service)["user_id"] == TEST_USER_ID


def test_patch_profile_route_uses_student_actor_and_authenticated_user_id() -> None:
    service = AsyncMock(return_value=_profile())
    with (
        patch("api.routes.profile.update_profile", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.patch(
            "/v1/profile", json={"basics": {"preferred_name": "Maya"}}
        )

    assert response.status_code == 200
    kwargs = _await_kwargs(service)
    assert kwargs["user_id"] == TEST_USER_ID
    assert kwargs["actor"] == "student"


# ---------------------------------------------------------------------------
# Documents — multipart upload
# ---------------------------------------------------------------------------


def test_upload_document_route_parses_multipart_and_calls_service() -> None:
    document = _document()
    service = AsyncMock(return_value=document)
    with (
        patch("api.routes.documents.upload_document", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.post(
            "/v1/documents",
            data={"title": "My Transcript", "doc_type": "transcript"},
            files={"file": ("transcript.pdf", b"%PDF-1.4 fake", "application/pdf")},
            headers={"Origin": "http://testserver"},
        )

    assert response.status_code == 201
    kwargs = _await_kwargs(service)
    assert kwargs["user_id"] == TEST_USER_ID
    assert kwargs["actor"] == "student"
    upload = kwargs["data"]
    assert upload.title == "My Transcript"
    assert upload.doc_type == "transcript"
    assert upload.filename == "transcript.pdf"
    assert upload.mime == "application/pdf"
    assert upload.content == b"%PDF-1.4 fake"


def test_upload_document_route_defaults_doc_type_when_omitted() -> None:
    service = AsyncMock(return_value=_document())
    with (
        patch("api.routes.documents.upload_document", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.post(
            "/v1/documents",
            data={"title": "Notes"},
            files={"file": ("notes.txt", b"hello", "text/plain")},
            headers={"Origin": "http://testserver"},
        )

    assert response.status_code == 201
    assert _await_kwargs(service)["data"].doc_type == "other"


def test_upload_document_route_rejects_oversized_file_without_calling_service() -> None:
    service = AsyncMock()
    oversized = b"x" * (15 * 1024 * 1024 + 1)
    with (
        patch("api.routes.documents.upload_document", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.post(
            "/v1/documents",
            data={"title": "Big file"},
            files={"file": ("big.txt", oversized, "text/plain")},
            headers={"Origin": "http://testserver"},
        )

    assert response.status_code == 413
    assert "15 MiB" in response.json()["error"]["message"]
    service.assert_not_awaited()


def test_upload_document_route_rejects_empty_file_without_calling_service() -> None:
    service = AsyncMock()
    with (
        patch("api.routes.documents.upload_document", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.post(
            "/v1/documents",
            data={"title": "Empty file"},
            files={"file": ("empty.txt", b"", "text/plain")},
            headers={"Origin": "http://testserver"},
        )

    assert response.status_code == 422
    service.assert_not_awaited()


def test_upload_document_route_surfaces_service_validation_error_as_422() -> None:
    from app.workspace.models import WorkspaceValidationError

    service = AsyncMock(side_effect=WorkspaceValidationError("unsupported document type"))
    with (
        patch("api.routes.documents.upload_document", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.post(
            "/v1/documents",
            data={"title": "Weird file"},
            files={"file": ("weird.exe", b"MZ", "application/octet-stream")},
            headers={"Origin": "http://testserver"},
        )

    assert response.status_code == 422
    assert "unsupported document type" in response.json()["error"]["message"]


def test_upload_document_route_requires_auth() -> None:
    with TestClient(_app(authed=False), raise_server_exceptions=False) as client:
        response = client.post(
            "/v1/documents",
            data={"title": "Transcript"},
            files={"file": ("transcript.pdf", b"%PDF-1.4 fake", "application/pdf")},
        )

    assert response.status_code == 401


# ---------------------------------------------------------------------------
# Ownership scoping — foreign or unknown ids never leak; always 404, never 403
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("patch_target", "method", "path"),
    [
        ("api.routes.documents.archive_document", "delete", f"/v1/documents/{_UNKNOWN_UUID}"),
        ("api.routes.memories.archive_memory", "delete", f"/v1/memories/{_UNKNOWN_UUID}"),
    ],
)
def test_foreign_or_unknown_ids_map_to_404_never_403(
    patch_target: str, method: str, path: str
) -> None:
    with (
        patch(patch_target, new=AsyncMock(side_effect=WorkspaceNotFoundError())),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = getattr(client, method)(path)

    assert response.status_code == 404
    assert response.status_code != 403
    assert response.json()["error"]["message"] == "Workspace item not found."


def test_archive_document_route_scopes_to_authenticated_user() -> None:
    document_id = uuid4()
    service = AsyncMock(return_value=None)
    with (
        patch("api.routes.documents.archive_document", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.delete(f"/v1/documents/{document_id}")

    assert response.status_code == 204
    kwargs = _await_kwargs(service)
    assert kwargs["user_id"] == TEST_USER_ID
    assert kwargs["actor"] == "student"
    assert kwargs["document_id"] == document_id


def test_archive_memory_route_scopes_to_authenticated_user() -> None:
    memory_id = uuid4()
    service = AsyncMock(return_value=None)
    with (
        patch("api.routes.memories.archive_memory", new=service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        response = client.delete(f"/v1/memories/{memory_id}")

    assert response.status_code == 204
    kwargs = _await_kwargs(service)
    assert kwargs["user_id"] == TEST_USER_ID
    assert kwargs["actor"] == "student"
    assert kwargs["memory_id"] == memory_id


def test_list_documents_and_memories_scope_to_authenticated_user() -> None:
    documents_service = AsyncMock(return_value=[_document()])
    memories_service = AsyncMock(return_value=[_memory()])
    with (
        patch("api.routes.documents.list_documents", new=documents_service),
        patch("api.routes.memories.list_memories", new=memories_service),
        TestClient(_app(), raise_server_exceptions=False) as client,
    ):
        doc_response = client.get("/v1/documents")
        mem_response = client.get("/v1/memories")

    assert doc_response.status_code == 200
    assert mem_response.status_code == 200
    assert _await_kwargs(documents_service)["user_id"] == TEST_USER_ID
    assert _await_kwargs(memories_service)["user_id"] == TEST_USER_ID
