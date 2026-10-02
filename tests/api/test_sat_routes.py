"""Route-level tests for `/v1/sat/...` (plan §4.2, §8 P3 gate).

Hermetic and mocked, mirroring `tests/api/test_workspace_routes.py`: the SQL-
backed behaviour these routes are thin HTTP over (auth scoping, the four
`status` values, grading incl. O7, retry-safe submit, import replace +
clamps, the date window) is already pinned by the live-DB tests in
`tests/app/sat/test_service_*.py` and the routine, hermetic grading vectors
in `tests/domain/sat/test_grading.py`. This file's job is the HTTP layer
those services sit behind: which user id a route hands the service, which
error class becomes which status code, the read rate limit, the import size
guard, ETag/304, and idempotent bookmark verbs — none of which the service
layer's own tests exercise.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch
from uuid import UUID, uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth import current_active_user
from api.context import install_middleware
from api.ratelimit import _RATE_LIMITER_ATTR, SlidingWindowLimiter
from api.routes import sat
from api.users_db import UserDB
from app.sat.errors import SatNotFoundError, SatValidationError
from app.sat.models import (
    SatAttemptOut,
    SatImportResult,
    SatSessionRow,
    SatSubmitResult,
)
from domain.sat.taxonomy import Taxonomy

USER_A = UUID("00000000-0000-4000-8000-00000000aaaa")
USER_B = UUID("00000000-0000-4000-8000-00000000bbbb")


def _user(user_id: UUID) -> UserDB:
    return UserDB(
        id=user_id,
        email=f"{user_id}@counselle.test",
        hashed_password="x",
        is_active=True,
        is_superuser=False,
        is_verified=True,
    )


def _app(
    *,
    user_id: UUID = USER_A,
    sat_writes_per_minute: int = 120,
    sat_question_reads_per_minute: int = 600,
    with_limiter: bool = True,
) -> FastAPI:
    app = FastAPI()
    settings = SimpleNamespace(
        cors_origins=["*"],
        sat_writes_per_minute=sat_writes_per_minute,
        sat_question_reads_per_minute=sat_question_reads_per_minute,
        sat_import_max_bytes=200,
    )
    install_middleware(app, settings)
    app.include_router(sat.router, prefix="/v1")
    app.state.settings = settings
    app.state.runtime = SimpleNamespace(app_pool=object())
    if with_limiter:
        setattr(app.state, _RATE_LIMITER_ATTR, SlidingWindowLimiter())
    app.dependency_overrides[current_active_user] = lambda: _user(user_id)
    return app


def _empty_taxonomy() -> Taxonomy:
    return Taxonomy.model_validate({"modules": [], "band_tiers": []})


def _attempt(question_id: str = "abcd1234") -> SatAttemptOut:
    return SatAttemptOut(
        id=1,
        question_id=question_id,
        module="math",
        domain_cd="H",
        skill_cd="H.A",
        score_band=3,
        user_answer="A",
        is_correct=True,
        time_spent_seconds=10,
        solved_at=datetime.now(UTC),
        local_date=date.today(),
    )


def _submit_result() -> SatSubmitResult:
    return SatSubmitResult(
        is_correct=True,
        correct_answers=("A",),
        rationale="Because.",
        attempts=(_attempt(),),
    )


# --- GET /taxonomy ----------------------------------------------------------


def test_get_taxonomy_is_cached_private() -> None:
    app = _app()
    with patch("api.routes.sat.load_taxonomy", return_value=_empty_taxonomy()):
        client = TestClient(app)
        response = client.get("/v1/sat/taxonomy")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "private, max-age=86400"


# --- auth scoping: user id always comes from the authed dependency ---------


def test_counts_scopes_to_the_authenticated_user_not_a_query_param() -> None:
    app = _app(user_id=USER_A)
    with patch(
        "api.routes.sat.service_questions.get_counts", new=AsyncMock(return_value={"H.A": 3})
    ) as mock_counts:
        client = TestClient(app)
        response = client.get("/v1/sat/counts")
    assert response.status_code == 200
    called_user_id = mock_counts.call_args.args[1]
    assert called_user_id == USER_A
    assert called_user_id != USER_B


def test_attempt_history_scopes_to_the_authenticated_user() -> None:
    app_a = _app(user_id=USER_A)
    app_b = _app(user_id=USER_B)
    with patch(
        "api.routes.sat.service_attempts.get_attempt_history",
        new=AsyncMock(return_value=[_attempt()]),
    ) as mock_history:
        TestClient(app_a).get("/v1/sat/questions/abcd1234/attempts")
        TestClient(app_b).get("/v1/sat/questions/abcd1234/attempts")
    seen_user_ids = {call.args[1] for call in mock_history.call_args_list}
    assert seen_user_ids == {USER_A, USER_B}


def test_stats_and_export_scope_to_the_authenticated_user() -> None:
    app = _app(user_id=USER_B)
    with patch(
        "api.routes.sat.service_progress.export_progress", new=AsyncMock(return_value="{}")
    ) as mock_export:
        client = TestClient(app)
        response = client.get("/v1/sat/progress/export")
    assert response.status_code == 200
    assert mock_export.call_args.args[1] == USER_B
    assert mock_export.call_args.args[1] != USER_A


# --- error mapping: app/sat/errors.py -> the envelope -----------------------


def test_unknown_question_id_maps_to_404_not_workspace_sentence() -> None:
    app = _app()
    with patch(
        "api.routes.sat.service_questions.get_question",
        new=AsyncMock(side_effect=SatNotFoundError("zzzzzzzz")),
    ):
        client = TestClient(app)
        response = client.get("/v1/sat/questions/zzzzzzzz")
    assert response.status_code == 404
    assert response.json()["error"]["message"] != "Workspace item not found."


def test_invalid_answer_maps_to_422() -> None:
    app = _app()
    with patch(
        "api.routes.sat.service_attempts.submit",
        new=AsyncMock(side_effect=SatValidationError("bad answer")),
    ):
        client = TestClient(app)
        response = client.post(
            "/v1/sat/questions/abcd1234/attempts",
            json={
                "client_attempt_id": str(uuid4()),
                "answer": "Z",
                "time_spent_seconds": 5,
                "local_date": date.today().isoformat(),
            },
        )
    assert response.status_code == 422
    assert response.json()["error"]["message"] == "bad answer"


def test_submit_success_returns_verdict_key_rationale_and_attempts() -> None:
    app = _app()
    with patch(
        "api.routes.sat.service_attempts.submit", new=AsyncMock(return_value=_submit_result())
    ):
        client = TestClient(app)
        response = client.post(
            "/v1/sat/questions/abcd1234/attempts",
            json={
                "client_attempt_id": str(uuid4()),
                "answer": "A",
                "time_spent_seconds": 5,
                "local_date": date.today().isoformat(),
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["is_correct"] is True
    assert body["correct_answers"] == ["A"]
    assert body["rationale"] == "Because."
    assert len(body["attempts"]) == 1


# --- bookmarks: idempotent verbs, not toggles -------------------------------


def test_bookmark_put_is_idempotent() -> None:
    app = _app()
    with patch(
        "api.routes.sat.service_attempts.set_bookmark", new=AsyncMock(return_value=None)
    ) as mock_set:
        client = TestClient(app)
        first = client.put("/v1/sat/bookmarks/abcd1234")
        second = client.put("/v1/sat/bookmarks/abcd1234")
    assert first.status_code == 204
    assert second.status_code == 204
    assert mock_set.await_count == 2


def test_bookmark_delete_is_idempotent() -> None:
    app = _app()
    with patch(
        "api.routes.sat.service_attempts.clear_bookmark", new=AsyncMock(return_value=None)
    ) as mock_clear:
        client = TestClient(app)
        first = client.delete("/v1/sat/bookmarks/abcd1234")
        second = client.delete("/v1/sat/bookmarks/abcd1234")
    assert first.status_code == 204
    assert second.status_code == 204
    assert mock_clear.await_count == 2


# --- ETag / 304 on GET /questions/{id} --------------------------------------


def test_question_etag_304_on_matching_if_none_match() -> None:
    app = _app()
    question = SimpleNamespace(
        question_id="abcd1234",
        external_id=None,
        ibn=None,
        u_id=uuid4(),
        source="qbank",
        module="math",
        domain_cd="H",
        skill_cd="H.A",
        score_band=3,
        difficulty="E",
        program="sat",
        item_type="mcq",
        in_bluebook=True,
        cb_created_at=None,
        cb_updated_at=None,
        content_sha256="deadbeef",
        retired_at=None,
        stimulus=None,
        stem="2 + 2 = ?",
        answer_options=(),
    )
    with patch(
        "api.routes.sat.service_questions.get_question", new=AsyncMock(return_value=question)
    ):
        client = TestClient(app)
        first = client.get("/v1/sat/questions/abcd1234")
        assert first.status_code == 200
        etag = first.headers["ETag"]
        second = client.get(
            "/v1/sat/questions/abcd1234", headers={"If-None-Match": etag}
        )
    assert second.status_code == 304


# --- the read rate limit (ADR 0044 Risk R0) ---------------------------------


def test_question_read_limit_returns_429_when_exhausted() -> None:
    app = _app(sat_question_reads_per_minute=1)
    question = SimpleNamespace(
        question_id="abcd1234",
        external_id=None,
        ibn=None,
        u_id=uuid4(),
        source="qbank",
        module="math",
        domain_cd="H",
        skill_cd="H.A",
        score_band=3,
        difficulty="E",
        program="sat",
        item_type="mcq",
        in_bluebook=True,
        cb_created_at=None,
        cb_updated_at=None,
        content_sha256="deadbeef",
        retired_at=None,
        stimulus=None,
        stem="2 + 2 = ?",
        answer_options=(),
    )
    with patch(
        "api.routes.sat.service_questions.get_question", new=AsyncMock(return_value=question)
    ):
        client = TestClient(app)
        first = client.get("/v1/sat/questions/abcd1234")
        second = client.get("/v1/sat/questions/abcd1234")
    assert first.status_code == 200
    assert second.status_code == 429
    assert "Retry-After" in second.headers


def test_missing_limiter_still_admits() -> None:
    """A missing limiter on app.state fails OPEN (api/ratelimit.py's
    documented, deliberate posture) -- never a 500."""
    app = _app(with_limiter=False, sat_question_reads_per_minute=1)
    question = SimpleNamespace(
        question_id="abcd1234",
        external_id=None,
        ibn=None,
        u_id=uuid4(),
        source="qbank",
        module="math",
        domain_cd="H",
        skill_cd="H.A",
        score_band=3,
        difficulty="E",
        program="sat",
        item_type="mcq",
        in_bluebook=True,
        cb_created_at=None,
        cb_updated_at=None,
        content_sha256="deadbeef",
        retired_at=None,
        stimulus=None,
        stem="2 + 2 = ?",
        answer_options=(),
    )
    with patch(
        "api.routes.sat.service_questions.get_question", new=AsyncMock(return_value=question)
    ):
        client = TestClient(app)
        first = client.get("/v1/sat/questions/abcd1234")
        second = client.get("/v1/sat/questions/abcd1234")
    assert first.status_code == 200
    assert second.status_code == 200


def test_sat_write_limit_returns_429_when_exhausted() -> None:
    app = _app(sat_writes_per_minute=1)
    with patch(
        "api.routes.sat.service_attempts.submit", new=AsyncMock(return_value=_submit_result())
    ):
        client = TestClient(app)
        body = {
            "client_attempt_id": str(uuid4()),
            "answer": "A",
            "time_spent_seconds": 5,
            "local_date": date.today().isoformat(),
        }
        first = client.post("/v1/sat/questions/abcd1234/attempts", json=body)
        second = client.post(
            "/v1/sat/questions/abcd1234/attempts",
            json={**body, "client_attempt_id": str(uuid4())},
        )
    assert first.status_code == 200
    assert second.status_code == 429


# --- PUT /progress: import size guard + require_json ------------------------


def test_import_413_on_declared_content_length_over_the_cap() -> None:
    app = _app()  # sat_import_max_bytes=200 in _app's settings
    client = TestClient(app)
    oversized = ("x" * 500).encode()
    response = client.put(
        "/v1/sat/progress",
        content=oversized,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json()["error"]["message"] == "That file is too large to import."


def test_import_413_on_actual_body_length_when_content_length_understates_it() -> None:
    """The post-read check: a body over the cap still 413s even when a
    (hypothetical) declared Content-Length would have let it through --
    covers the chunked-upload case where no Content-Length is declared at
    all, so the pre-read guard cannot catch it."""
    app = _app()
    app.state.settings.sat_import_max_bytes = 10
    client = TestClient(app)

    def _chunks() -> Any:
        yield b'{"attempts": []}'

    response = client.put(
        "/v1/sat/progress",
        content=_chunks(),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413


def test_import_success_returns_counts() -> None:
    app = _app()
    with patch(
        "api.routes.sat.service_progress.import_progress",
        new=AsyncMock(
            return_value=SatImportResult(attempts_imported=3, bookmarks_imported=1)
        ),
    ) as mock_import:
        client = TestClient(app)
        response = client.put(
            "/v1/sat/progress",
            json={"version": 1, "attempts": [], "bookmarks": []},
        )
    assert response.status_code == 200
    assert response.json() == {"attempts_imported": 3, "bookmarks_imported": 1}
    assert mock_import.await_count == 1


def test_import_rejects_non_json_content_type() -> None:
    app = _app()
    client = TestClient(app)
    response = client.put(
        "/v1/sat/progress",
        content=b"not json",
        headers={"Content-Type": "text/plain"},
    )
    assert response.status_code == 415


def test_import_invalid_payload_maps_to_422() -> None:
    app = _app()
    with patch(
        "api.routes.sat.service_progress.import_progress",
        new=AsyncMock(side_effect=SatValidationError("could not parse import file")),
    ):
        client = TestClient(app)
        response = client.put(
            "/v1/sat/progress",
            json={"not": "a valid liprep file, but small"},
        )
    assert response.status_code == 422


# --- date window: today defaults to server UTC date when omitted -----------


def test_export_filename_uses_the_query_today_when_given() -> None:
    app = _app()
    with patch("api.routes.sat.service_progress.export_progress", new=AsyncMock(return_value="{}")):
        client = TestClient(app)
        response = client.get("/v1/sat/progress/export?today=2026-01-15")
    assert response.status_code == 200
    assert 'filename="2026-01-15.liprep"' in response.headers["Content-Disposition"]
    assert response.headers["Cache-Control"] == "no-store"


def test_export_filename_defaults_to_todays_utc_date_when_omitted() -> None:
    app = _app()
    with patch("api.routes.sat.service_progress.export_progress", new=AsyncMock(return_value="{}")):
        client = TestClient(app)
        response = client.get("/v1/sat/progress/export")
    today = datetime.now(UTC).date().isoformat()
    assert response.status_code == 200
    assert f'filename="{today}.liprep"' in response.headers["Content-Disposition"]


# --- GET /session -----------------------------------------------------------


def test_session_by_question_id_is_a_lookup_not_a_filtered_list() -> None:
    app = _app()
    row = SatSessionRow(
        id="abcd1234",
        score_band=3,
        content_sha="deadbeef",
        bookmarked=False,
        ever_correct=False,
        ever_incorrect=False,
    )
    with patch(
        "api.routes.sat.service_questions.get_session_row", new=AsyncMock(return_value=row)
    ) as mock_row:
        client = TestClient(app)
        response = client.get("/v1/sat/session?question=abcd1234")
    assert response.status_code == 200
    assert response.json()["id"] == "abcd1234"
    mock_row.assert_awaited_once()


def test_session_empty_filters_mean_all() -> None:
    app = _app()
    with patch(
        "api.routes.sat.service_questions.list_session", new=AsyncMock(return_value=[])
    ) as mock_list:
        client = TestClient(app)
        response = client.get("/v1/sat/session")
    assert response.status_code == 200
    assert mock_list.call_args.kwargs["skills"] == []
    assert mock_list.call_args.kwargs["bands"] == []


def test_session_by_question_id_404s_through_sat_errors_not_workspace() -> None:
    app = _app()
    with patch(
        "api.routes.sat.service_questions.get_session_row",
        new=AsyncMock(side_effect=SatNotFoundError("zzzzzzzz")),
    ):
        client = TestClient(app)
        response = client.get("/v1/sat/session?question=zzzzzzzz")
    assert response.status_code == 404
