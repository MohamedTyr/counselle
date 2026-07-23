"""B4 — chat management, feedback, rate limiting, runtime config.

Most tests run against the live DB (the ``live_app`` fixture stamps
:data:`TEST_USER_ID` and uses the real ``counselle.*`` schema). Pure-logic tests
(``default_title``, the cursor codec, the limiter, the config season selection)
are hermetic.
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from api.ratelimit import SlidingWindowLimiter, auth_rate_limit, message_rate_limit
from app.feedback import feedback_for_session, set_feedback
from app.sessions import (
    create_session,
    decode_cursor_for_test,
    encode_cursor,
    list_sessions,
)
from app.titles import default_title
from tests.api.conftest import TEST_USER_ID, delete_session

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _new_session(app: FastAPI, *, title: str | None = None) -> str:
    pool = app.state.runtime.app_pool
    return await create_session(
        pool, {"web": True, "reddit": True, "edu": True}, title, user_id=str(TEST_USER_ID)
    )


# ---------------------------------------------------------------------------
# default_title (pure)
# ---------------------------------------------------------------------------


def test_default_title_short_passthrough() -> None:
    assert default_title("How does aid work?", 60) == "How does aid work?"


def test_default_title_truncates_on_word_boundary_with_ellipsis() -> None:
    text = "Compare Williams and Amherst on class size and financial aid generosity"
    out = default_title(text, 30)
    assert len(out) <= 30
    assert out.endswith("…")
    assert " " not in out[-2:]  # cut landed on a word boundary


def test_default_title_collapses_whitespace() -> None:
    assert default_title("  hello   world  ", 60) == "hello world"


# ---------------------------------------------------------------------------
# cursor codec (pure)
# ---------------------------------------------------------------------------


def test_cursor_roundtrip() -> None:
    ts = datetime(2026, 6, 13, 12, 0, 0, tzinfo=UTC)
    sid = str(uuid.uuid4())
    decoded = decode_cursor_for_test(encode_cursor(ts, sid))
    assert decoded is not None
    assert decoded == (ts, sid)


def test_cursor_garbage_decodes_to_none() -> None:
    assert decode_cursor_for_test("!!!not-base64!!!") is None


# ---------------------------------------------------------------------------
# Rate limiter (pure)
# ---------------------------------------------------------------------------


def test_limiter_messages_admits_then_blocks() -> None:
    limiter = SlidingWindowLimiter()
    for _ in range(3):
        assert limiter.check_message("u1", per_hour=3, per_day=100) is None
    retry = limiter.check_message("u1", per_hour=3, per_day=100)
    assert retry is not None and retry > 0


def test_limiter_daily_cap_does_not_spend_hourly_token() -> None:
    limiter = SlidingWindowLimiter()
    # Day cap of 1: the 1st admits (hour=1, day=1); the 2nd is day-blocked.
    assert limiter.check_message("u2", per_hour=100, per_day=1) is None
    assert limiter.check_message("u2", per_hour=100, per_day=1) is not None
    # The blocked call must have spent NO hourly token for u2. Prove it directly:
    # peek u2's hourly window — it must still report exactly 1 hit (not 2), so a
    # generous-day re-check would only see headroom of (per_hour - 1).
    hour_hits = len(limiter._hits["turns:h:u2"])  # noqa: SLF001 — white-box invariant check
    assert hour_hits == 1, f"day-blocked call wrongly spent an hourly token (hits={hour_hits})"


def test_limiter_auth_per_ip() -> None:
    limiter = SlidingWindowLimiter()
    for _ in range(2):
        assert limiter.check_auth("1.2.3.4", attempts=2, window_s=60) is None
    assert limiter.check_auth("1.2.3.4", attempts=2, window_s=60) is not None
    # A different IP is unaffected.
    assert limiter.check_auth("5.6.7.8", attempts=2, window_s=60) is None


def test_limiter_reset() -> None:
    limiter = SlidingWindowLimiter()
    limiter.check_message("u", per_hour=1, per_day=1)
    limiter.reset()
    assert limiter.check_message("u", per_hour=1, per_day=1) is None


async def test_rate_limit_dependencies_read_settings_knobs() -> None:
    """CFG-02: route dependencies pass Settings values through directly."""
    calls: list[tuple[str, dict[str, Any]]] = []

    class Recorder:
        def check_message(self, user_id: str, *, per_hour: int, per_day: int) -> None:
            calls.append(
                ("message", {"user_id": user_id, "per_hour": per_hour, "per_day": per_day})
            )
            return None

        def check_auth(self, ip: str, *, attempts: int, window_s: int) -> None:
            calls.append(("auth", {"ip": ip, "attempts": attempts, "window_s": window_s}))
            return None

    settings = type(
        "SettingsStub",
        (),
        {
            "turns_per_hour": 7,
            "turns_per_day": 11,
            "auth_attempts_per_window": 13,
            "auth_window_seconds": 17,
        },
    )()
    request = type(
        "RequestStub",
        (),
        {
            "app": type("AppStub", (), {"state": type("StateStub", (), {})()})(),
            "client": type("ClientStub", (), {"host": "203.0.113.7"})(),
        },
    )()
    request.app.state.settings = settings
    request.app.state.rate_limiter = Recorder()

    await message_rate_limit(request, type("UserStub", (), {"id": "user-1"})())
    await auth_rate_limit(request)

    assert calls == [
        ("message", {"user_id": "user-1", "per_hour": 7, "per_day": 11}),
        ("auth", {"ip": "203.0.113.7", "attempts": 13, "window_s": 17}),
    ]


# ---------------------------------------------------------------------------
# Chat management (live_db)
# ---------------------------------------------------------------------------


@pytest.mark.live_db
async def test_list_search_pagination(live_app: FastAPI) -> None:
    pool = live_app.state.runtime.app_pool
    ids = [await _new_session(live_app, title=f"Chat about UNC {i}") for i in range(3)]
    other = await _new_session(live_app, title="Williams comparison")
    try:
        async with await _client(live_app) as client:
            # search narrows to titles matching the query
            r = await client.get("/v1/sessions", params={"q": "UNC"})
            assert r.status_code == 200
            body = r.json()
            titles = {s["title"] for s in body["sessions"]}
            assert all("UNC" in t for t in titles)
            assert "Williams comparison" not in titles

            # pagination: limit 2 over the 3 UNC chats → a next_cursor
            r1 = await client.get("/v1/sessions", params={"q": "UNC", "limit": 2})
            page1 = r1.json()
            assert len(page1["sessions"]) == 2
            assert page1["next_cursor"] is not None
            r2 = await client.get(
                "/v1/sessions",
                params={"q": "UNC", "limit": 2, "cursor": page1["next_cursor"]},
            )
            page2 = r2.json()
            assert len(page2["sessions"]) == 1
            seen = {s["session_id"] for s in page1["sessions"] + page2["sessions"]}
            assert seen == set(ids)
            # each row carries is_generating + source_config
            assert page2["sessions"][0]["is_generating"] is False
            assert page2["sessions"][0]["source_config"] is not None
    finally:
        for sid in [*ids, other]:
            await delete_session(pool, sid)


@pytest.mark.live_db
async def test_list_is_user_scoped(live_app: FastAPI) -> None:
    pool = live_app.state.runtime.app_pool
    foreign_user = uuid.uuid4()
    async with pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO counselle.users (id, email, is_active, is_verified) "
            "VALUES ($1, $2, true, true)",
            foreign_user,
            f"foreign-{foreign_user}@t.test",
        )
    foreign_sid = await create_session(
        pool, {"web": True, "reddit": True, "edu": True}, "Not mine", user_id=str(foreign_user)
    )
    mine = await _new_session(live_app, title="Mine")
    try:
        rows = await list_sessions(pool, str(TEST_USER_ID))
        ids = {r["session_id"] for r in rows}
        assert mine in ids
        assert foreign_sid not in ids
    finally:
        await delete_session(pool, mine)
        async with pool.acquire() as conn:
            await conn.execute("DELETE FROM counselle.users WHERE id = $1", foreign_user)


@pytest.mark.live_db
async def test_rename_session(live_app: FastAPI) -> None:
    pool = live_app.state.runtime.app_pool
    sid = await _new_session(live_app, title="old")
    try:
        async with await _client(live_app) as client:
            r = await client.patch(f"/v1/sessions/{sid}", json={"title": "New Title"})
            assert r.status_code == 200
            assert r.json()["title"] == "New Title"
            # empty title → 422
            r2 = await client.patch(f"/v1/sessions/{sid}", json={"title": "   "})
            assert r2.status_code == 422
    finally:
        await delete_session(pool, sid)


@pytest.mark.live_db
async def test_rename_ownership_404(live_app: FastAPI) -> None:
    async with await _client(live_app) as client:
        r = await client.patch(
            "/v1/sessions/00000000-0000-4000-8000-00000000dead", json={"title": "x"}
        )
        assert r.status_code == 404


@pytest.mark.live_db
async def test_delete_cancels_then_removes(live_app: FastAPI) -> None:
    pool = live_app.state.runtime.app_pool
    sid = await _new_session(live_app, title="to delete")
    async with await _client(live_app) as client:
        r = await client.delete(f"/v1/sessions/{sid}")
        assert r.status_code == 204
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT 1 FROM counselle.sessions WHERE session_id = $1", sid
        )
    assert row is None


@pytest.mark.live_db
async def test_source_config_stickiness_roundtrip(live_app: FastAPI) -> None:
    pool = live_app.state.runtime.app_pool
    sid = await _new_session(live_app, title="cfg")
    try:
        from app.sessions import get_session, set_session_source_config

        new_cfg = {"web": False, "reddit": True, "edu": False, "reddit_subreddits": ["chanceme"]}
        await set_session_source_config(pool, sid, new_cfg)
        row = await get_session(pool, sid)
        assert row is not None
        assert row["source_config"] == new_cfg
    finally:
        await delete_session(pool, sid)


@pytest.mark.live_db
async def test_default_title_set_on_first_message(live_app: FastAPI) -> None:
    """A titleless session gets the truncated question on first send."""
    pool = live_app.state.runtime.app_pool
    sid = await _new_session(live_app, title=None)
    try:
        async with await _client(live_app) as client, client.stream(
            "POST", f"/v1/sessions/{sid}/messages", json={"text": "How does need-based aid work?"}
        ) as resp:
            assert resp.status_code == 200
            async for _ in resp.aiter_lines():
                pass
        from app.sessions import get_session

        row = await get_session(pool, sid)
        assert row is not None
        assert row["title"] == "How does need-based aid work?"
    finally:
        await delete_session(pool, sid)


# ---------------------------------------------------------------------------
# Auto-title hook (model + swallow paths)
# ---------------------------------------------------------------------------


@pytest.mark.live_db
async def test_auto_titler_model_path(live_app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> None:
    """When the title model returns a title, the default is upgraded."""
    pool = live_app.state.runtime.app_pool
    runtime = live_app.state.runtime
    settings = live_app.state.settings
    sid = await _new_session(live_app, title=None)
    try:
        from app import titles

        # Seed the default title (as the messages route would) + a fake transcript.
        from app.sessions import get_session, set_session_title

        seed = default_title("How does aid work?", settings.title_max_len)
        await set_session_title(pool, sid, seed)

        async def fake_transcript(rt: Any, session_id: str) -> list[dict[str, Any]]:
            return [
                {"role": "user", "text": "How does aid work?"},
                {"role": "assistant", "text": "Need-based aid covers..."},
            ]

        async def fake_generate(rt: Any, s: Any, u: str, a: str) -> str:
            return "Understanding Need-Based Aid"

        monkeypatch.setattr(titles, "_read_transcript", fake_transcript)
        monkeypatch.setattr(titles, "_generate_title", fake_generate)

        hook = titles.make_auto_titler(pool, runtime, settings)
        await hook(sid)

        row = await get_session(pool, sid)
        assert row is not None
        assert row["title"] == "Understanding Need-Based Aid"
    finally:
        await delete_session(pool, sid)


@pytest.mark.live_db
async def test_auto_titler_swallows_failure(
    live_app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A title-model failure leaves the derived default standing (no raise)."""
    pool = live_app.state.runtime.app_pool
    runtime = live_app.state.runtime
    settings = live_app.state.settings
    sid = await _new_session(live_app, title=None)
    try:
        from app import titles
        from app.sessions import get_session, set_session_title

        default = default_title("How does aid work?", settings.title_max_len)
        await set_session_title(pool, sid, default)

        async def fake_transcript(rt: Any, session_id: str) -> list[dict[str, Any]]:
            return [
                {"role": "user", "text": "How does aid work?"},
                {"role": "assistant", "text": "Need-based aid covers..."},
            ]

        async def boom(rt: Any, s: Any, u: str, a: str) -> str:
            raise RuntimeError("model down")

        monkeypatch.setattr(titles, "_read_transcript", fake_transcript)
        monkeypatch.setattr(titles, "_generate_title", boom)

        hook = titles.make_auto_titler(pool, runtime, settings)
        await hook(sid)  # must not raise

        row = await get_session(pool, sid)
        assert row is not None
        assert row["title"] == default  # default stands
    finally:
        await delete_session(pool, sid)


# ---------------------------------------------------------------------------
# Feedback (live_db)
# ---------------------------------------------------------------------------


@pytest.mark.live_db
async def test_feedback_toggle_and_clear(live_app: FastAPI) -> None:
    pool = live_app.state.runtime.app_pool
    sid = await _new_session(live_app, title="fb")
    mid = "assistant-msg-1"
    try:
        async with await _client(live_app) as client:
            r = await client.post(
                f"/v1/sessions/{sid}/messages/{mid}/feedback", json={"rating": "up"}
            )
            assert r.status_code == 200 and r.json() == {"rating": "up"}

            # idempotent toggle up→down (unique on (user, message_id))
            await client.post(
                f"/v1/sessions/{sid}/messages/{mid}/feedback", json={"rating": "down"}
            )
            fb = await feedback_for_session(pool, user_id=str(TEST_USER_ID), session_id=sid)
            assert fb == {mid: "down"}

            # clear
            r2 = await client.post(
                f"/v1/sessions/{sid}/messages/{mid}/feedback", json={"rating": None}
            )
            assert r2.status_code == 204
            fb2 = await feedback_for_session(pool, user_id=str(TEST_USER_ID), session_id=sid)
            assert fb2 == {}
    finally:
        await delete_session(pool, sid)


@pytest.mark.live_db
async def test_feedback_ownership_404(live_app: FastAPI) -> None:
    async with await _client(live_app) as client:
        r = await client.post(
            "/v1/sessions/00000000-0000-4000-8000-00000000dead/messages/m/feedback",
            json={"rating": "up"},
        )
        assert r.status_code == 404


@pytest.mark.live_db
async def test_feedback_read_path_hydration(live_app: FastAPI) -> None:
    """A rating set via the route shows up on the assistant entry after 'reload'."""
    pool = live_app.state.runtime.app_pool
    sid = await _new_session(live_app, title="hydration")
    try:
        # Stream one turn so a turn record (with a message_id) exists.
        async with await _client(live_app) as client:
            async with client.stream(
                "POST", f"/v1/sessions/{sid}/messages", json={"text": "hello"}
            ) as resp:
                async for _ in resp.aiter_lines():
                    pass
            # Read the transcript to learn the assistant message_id.
            r = await client.get(f"/v1/sessions/{sid}")
            transcript = r.json()["transcript"]
            assistant = [e for e in transcript if e["role"] == "assistant"]
            assert assistant, "expected an assistant entry"
            mid = assistant[0]["message_id"]
            assert mid

            await client.post(
                f"/v1/sessions/{sid}/messages/{mid}/feedback", json={"rating": "up"}
            )
            # Reload: the rating is joined onto the assistant entry.
            r2 = await client.get(f"/v1/sessions/{sid}")
            t2 = r2.json()["transcript"]
            a2 = [e for e in t2 if e["role"] == "assistant" and e["message_id"] == mid]
            assert a2[0]["feedback"] == {"rating": "up"}
    finally:
        await delete_session(pool, sid)


@pytest.mark.live_db
async def test_feedback_cascade_on_session_delete(live_app: FastAPI) -> None:
    """Deleting a session cascades its feedback rows away (FK CASCADE)."""
    pool = live_app.state.runtime.app_pool
    sid = await _new_session(live_app, title="cascade")
    await set_feedback(
        pool, user_id=str(TEST_USER_ID), session_id=sid, message_id="m1", rating="up"
    )
    await delete_session(pool, sid)
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT 1 FROM counselle.feedback WHERE session_id = $1", sid
        )
    assert rows == []


# ---------------------------------------------------------------------------
# Rate limiting on the message route (live_db, tiny window)
# ---------------------------------------------------------------------------


@pytest.mark.live_db
async def test_messages_429_when_window_exhausted(
    live_app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    pool = live_app.state.runtime.app_pool
    # Shrink the per-hour cap to 1 for this app's settings instance.
    monkeypatch.setattr(live_app.state.settings, "turns_per_hour", 1, raising=False)
    monkeypatch.setattr(live_app.state.settings, "turns_per_day", 100, raising=False)
    sid = await _new_session(live_app, title="rl")
    try:
        async with await _client(live_app) as client:
            # first send admits (drain the stream)
            async with client.stream(
                "POST", f"/v1/sessions/{sid}/messages", json={"text": "one"}
            ) as resp:
                assert resp.status_code == 200
                async for _ in resp.aiter_lines():
                    pass
            # second is over the window → 429 + Retry-After
            r = await client.post(f"/v1/sessions/{sid}/messages", json={"text": "two"})
            assert r.status_code == 429
            assert "Retry-After" in r.headers
            # reset the limiter → next send passes again
            live_app.state.rate_limiter.reset()
            async with client.stream(
                "POST", f"/v1/sessions/{sid}/messages", json={"text": "three"}
            ) as resp2:
                assert resp2.status_code == 200
                async for _ in resp2.aiter_lines():
                    pass
    finally:
        await delete_session(pool, sid)


# ---------------------------------------------------------------------------
# /v1/config (live_db for auth; hermetic season)
# ---------------------------------------------------------------------------


@pytest.mark.live_db
async def test_config_shape(live_app: FastAPI) -> None:
    async with await _client(live_app) as client:
        r = await client.get("/v1/config")
        assert r.status_code == 200
        body = r.json()
        assert set(body) == {
            "greeting",
            "season_note",
            "conversation_starters",
            "default_source_config",
            "skills",
            "skill_modes",
            "max_selected_skills",
            "current_admissions_cycle_year",
            "default_response_mode",
            "response_modes",
        }
        assert isinstance(body["greeting"], str) and body["greeting"]
        assert isinstance(body["conversation_starters"], list) and body["conversation_starters"]
        cfg = body["default_source_config"]
        assert set(cfg) >= {"web", "edu", "reddit", "reddit_subreddits"}
        assert body["max_selected_skills"] == 3
        assert body["default_response_mode"] == "quick"
        assert body["response_modes"][0] == {
            "id": "quick",
            "model": "google-vertex:gemini-3.5-flash",
            "model_display_name": "Gemini 3.5 Flash",
            "preview": False,
        }
        assert {mode["id"] for mode in body["response_modes"]} <= {"quick", "think"}
        assert body["skills"] == [
            {
                "name": "school-comparison",
                "display_name": "School comparison",
                "description": "Compare schools across cost, admissions, outcomes, and fit.",
            },
            {
                "name": "school-deep-dive",
                "display_name": "School deep dive",
                "description": "Build a cited, in-depth look at one school.",
            },
        ]
        assert body["skill_modes"] == [
            {
                "name": "focused-answer",
                "display_name": "Focused Answer",
                "description": "Clear, direct help without unnecessary exploration.",
                "order": 10,
                "default": True,
            },
            {
                "name": "deep-research",
                "display_name": "Deep Research",
                "description": "A thorough, multi-source investigation for complex decisions.",
                "order": 20,
                "default": False,
            },
            {
                "name": "guided-counselor",
                "display_name": "Guided Counselor",
                "description": "Work through it together, one thoughtful question at a time.",
                "order": 30,
                "default": False,
            },
        ]


@pytest.mark.live_db
async def test_auth_login_429_when_window_exhausted(monkeypatch: pytest.MonkeyPatch) -> None:
    """Per-IP auth window: repeated login attempts over the cap → 429 + Retry-After."""
    from tests.api.conftest import _build_auth_app, _build_test_runtime

    rt, orig = await _build_test_runtime()
    app = _build_auth_app(rt)
    monkeypatch.setattr(app.state.settings, "auth_attempts_per_window", 2, raising=False)
    monkeypatch.setattr(app.state.settings, "auth_window_seconds", 60, raising=False)
    try:
        async with await _client(app) as client:
            saw_429 = False
            for _ in range(4):
                r = await client.post(
                    "/v1/auth/login",
                    data={"username": "nobody@t.test", "password": "x" * 8},
                    headers={"Origin": "http://test"},
                )
                if r.status_code == 429:
                    saw_429 = True
                    assert "Retry-After" in r.headers
                    break
            assert saw_429, "expected a 429 once the per-IP auth window was exhausted"
            # reset → next attempt is no longer rate-limited (back to 400/credential failure)
            app.state.rate_limiter.reset()
            r2 = await client.post(
                "/v1/auth/login",
                data={"username": "nobody@t.test", "password": "x" * 8},
                headers={"Origin": "http://test"},
            )
            assert r2.status_code != 429
    finally:
        await orig.aclose()


def test_config_season_selection_frozen_clock() -> None:
    """A June date selects the pre-application greeting (frozen-clock season test)."""
    from api.routes.config import _season_copy

    copy = _season_copy(date(2026, 6, 15))
    assert "list" in copy["greeting"].lower() or "building" in copy["greeting"].lower()
    assert copy["season_note"]  # pre-application has a note
