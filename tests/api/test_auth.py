"""B3 — auth & identity integration tests (ADR 0021).

Exercises the real fastapi-users cookie flow against the live DB:
register → login → /v1/me; wrong password → 400; OAuth-only + password → 400;
forgot/reset round-trip (console token captured from structlog); Google callback
(httpx-oauth mocked, no network); ownership 404 over the /v1/sessions inventory;
DELETE /v1/me cascade incl. active-turn cancel; content-type 415; cookie flags.

All tests are marked ``@pytest.mark.live_db`` — the Postgres container must be up.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

from tests.api.conftest import (
    _build_auth_app,
    _build_test_runtime,
    delete_user_by_email,
)

pytestmark = pytest.mark.live_db

_PW = "correct-horse-battery-staple"


def _client(app: FastAPI) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
        headers={"Origin": "http://test"},
    )


async def _register(app: FastAPI, email: str, password: str = _PW, name: str = "Ada") -> Any:
    async with _client(app) as c:
        return await c.post(
            "/v1/auth/register",
            json={"email": email, "password": password, "name": name},
        )


async def _login(app: FastAPI, email: str, password: str = _PW) -> httpx.Response:
    async with _client(app) as c:
        # Login is form-encoded (the named JSON-only exemption).
        return await c.post(
            "/v1/auth/login",
            data={"username": email, "password": password},
        )


@pytest_asyncio.fixture
async def auth_app() -> Any:
    rt, orig = await _build_test_runtime()
    app = _build_auth_app(rt)
    try:
        yield app
    finally:
        await orig.aclose()


# ---------------------------------------------------------------------------
# register → login → /v1/me
# ---------------------------------------------------------------------------


async def test_register_login_me_flow(auth_app: FastAPI) -> None:
    email = f"flow-{uuid.uuid4().hex}@counselle-test.com"
    try:
        reg = await _register(auth_app, email)
        assert reg.status_code == 201, reg.text
        assert reg.json()["name"] == "Ada"

        login = await _login(auth_app, email)
        assert login.status_code == 204
        cookie = login.cookies.get("counselle_auth")
        assert cookie

        async with _client(auth_app) as c:
            c.cookies.set("counselle_auth", cookie)
            me = await c.get("/v1/me")
        assert me.status_code == 200
        body = me.json()
        assert body["email"] == email
        assert body["name"] == "Ada"
        assert body["has_password"] is True
        assert body["google_connected"] is False
    finally:
        await delete_user_by_email(auth_app.state.runtime.app_pool, email)


async def test_wrong_password_returns_400(auth_app: FastAPI) -> None:
    email = f"wrong-{uuid.uuid4().hex}@counselle-test.com"
    try:
        await _register(auth_app, email)
        resp = await _login(auth_app, email, password="not-the-password")
        assert resp.status_code == 400
    finally:
        await delete_user_by_email(auth_app.state.runtime.app_pool, email)


async def test_cross_origin_auth_posts_are_rejected(auth_app: FastAPI) -> None:
    email = f"csrf-{uuid.uuid4().hex}@counselle-test.com"
    try:
        async with _client(auth_app) as c:
            register = await c.post(
                "/v1/auth/register",
                headers={"Origin": "https://attacker.example"},
                json={"email": email, "password": _PW, "name": "Ada"},
            )
            login = await c.post(
                "/v1/auth/login",
                headers={"Origin": "https://attacker.example"},
                data={"username": email, "password": _PW},
            )

        assert register.status_code == 403
        assert login.status_code == 403
    finally:
        await delete_user_by_email(auth_app.state.runtime.app_pool, email)


async def test_headerless_auth_post_is_rejected(auth_app: FastAPI) -> None:
    email = f"headerless-{uuid.uuid4().hex}@counselle-test.com"
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=auth_app),
            base_url="http://test",
        ) as c:
            resp = await c.post(
                "/v1/auth/register",
                json={"email": email, "password": _PW, "name": "Ada"},
            )

        assert resp.status_code == 403
    finally:
        await delete_user_by_email(auth_app.state.runtime.app_pool, email)


async def test_register_429_when_window_exhausted(
    auth_app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(auth_app.state.settings, "auth_attempts_per_window", 2, raising=False)
    monkeypatch.setattr(auth_app.state.settings, "auth_window_seconds", 60, raising=False)
    emails = [f"limited-{index}-{uuid.uuid4().hex}@counselle-test.com" for index in range(3)]
    try:
        statuses = []
        for email in emails:
            resp = await _register(auth_app, email)
            statuses.append(resp.status_code)

        assert statuses[:2] == [201, 201]
        assert statuses[2] == 429
    finally:
        auth_app.state.rate_limiter.reset()
        for email in emails:
            await delete_user_by_email(auth_app.state.runtime.app_pool, email)


async def test_oauth_only_user_password_login_returns_400(auth_app: FastAPI) -> None:
    """An OAuth-only user (hashed_password NULL) attempting password login → 400."""
    email = f"oauth-only-{uuid.uuid4().hex}@counselle-test.com"
    pool = auth_app.state.runtime.app_pool
    try:
        async with pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO counselle.users
                  (id, email, hashed_password, is_active, is_superuser, is_verified)
                VALUES ($1, $2, NULL, true, false, true)
                """,
                uuid.uuid4(),
                email,
            )
        resp = await _login(auth_app, email, password="anything")
        assert resp.status_code == 400
    finally:
        await delete_user_by_email(pool, email)


# ---------------------------------------------------------------------------
# forgot / reset round-trip (console token)
# ---------------------------------------------------------------------------


async def test_forgot_reset_roundtrip(auth_app: FastAPI, monkeypatch: Any) -> None:
    import api.auth

    email = f"reset-{uuid.uuid4().hex}@counselle-test.com"
    pool = auth_app.state.runtime.app_pool
    captured: dict[str, str] = {}

    class _Capture:
        async def send(self, *, to: str, subject: str, token: str, link: str | None = None) -> None:
            captured["token"] = token

    try:
        await _register(auth_app, email)

        # Patch the email-sender factory the per-request manager calls.
        monkeypatch.setattr(api.auth, "build_email_sender", lambda settings: _Capture())

        async with _client(auth_app) as c:
            forgot = await c.post("/v1/auth/forgot-password", json={"email": email})
        assert forgot.status_code == 202  # always 202 (no existence leak)
        token = captured.get("token")
        assert token, "console email sender did not capture a reset token"

        new_pw = "brand-new-password-123"
        async with _client(auth_app) as c:
            reset = await c.post(
                "/v1/auth/reset-password", json={"token": token, "password": new_pw}
            )
        assert reset.status_code == 200

        # The new password now logs in.
        relog = await _login(auth_app, email, password=new_pw)
        assert relog.status_code == 204
    finally:
        await delete_user_by_email(pool, email)


# ---------------------------------------------------------------------------
# Google OAuth callback (mocked httpx-oauth)
# ---------------------------------------------------------------------------


async def test_google_callback_creates_oauth_only_user(monkeypatch: Any) -> None:
    """A mocked Google callback creates a user with NULL password (honest has_password)."""
    from api.auth import UserManager

    email = f"google-{uuid.uuid4().hex}@counselle-test.com"
    rt, orig = await _build_test_runtime()
    pool = rt.app_pool
    try:
        from api.users_db import AsyncpgUserDatabase
        from config.settings import get_settings

        manager = UserManager(AsyncpgUserDatabase(pool), get_settings())
        user = await manager.oauth_callback(
            "google",
            "access-tok",
            f"acct-{uuid.uuid4().hex}",
            email,
            None,
            None,
            associate_by_email=True,
            is_verified_by_default=True,
        )
        assert user.email == email
        assert user.hashed_password is None  # the gotcha-1 null-hash forcing
        assert any(a.oauth_name == "google" for a in user.oauth_accounts)
        # OAuth users flow through the same AsyncpgUserDatabase.create as password
        # users, so they get the same version-1 onboarding seed (README §7.2).
        assert user.settings["onboarding"]["status"] == "not_started"
        assert user.settings["onboarding"]["current_step"] == "basics"
    finally:
        await delete_user_by_email(pool, email)
        await orig.aclose()


# ---------------------------------------------------------------------------
# ownership 404 over the /v1/sessions route inventory
# ---------------------------------------------------------------------------


async def test_foreign_session_404_over_inventory(auth_app: FastAPI) -> None:
    """A second user can touch none of the first user's session routes (all 404)."""
    owner = f"owner-{uuid.uuid4().hex}@counselle-test.com"
    intruder = f"intruder-{uuid.uuid4().hex}@counselle-test.com"
    pool = auth_app.state.runtime.app_pool
    try:
        await _register(auth_app, owner)
        owner_login = await _login(auth_app, owner)
        owner_cookie = owner_login.cookies["counselle_auth"]

        # Owner creates a session.
        async with _client(auth_app) as c:
            c.cookies.set("counselle_auth", owner_cookie)
            created = await c.post("/v1/sessions", json={})
        sid = created.json()["session_id"]

        await _register(auth_app, intruder)
        intruder_login = await _login(auth_app, intruder)
        intruder_cookie = intruder_login.cookies["counselle_auth"]

        async with _client(auth_app) as c:
            c.cookies.set("counselle_auth", intruder_cookie)
            get_resp = await c.get(f"/v1/sessions/{sid}")
            msg_resp = await c.post(f"/v1/sessions/{sid}/messages", json={"text": "hi"})
            steer_resp = await c.post(f"/v1/sessions/{sid}/steer", json={"text": "hi"})
            stream_resp = await c.get(f"/v1/sessions/{sid}/stream")
            cancel_resp = await c.post(f"/v1/sessions/{sid}/cancel")

        assert get_resp.status_code == 404
        assert msg_resp.status_code == 404
        assert steer_resp.status_code == 404
        assert stream_resp.status_code == 404
        assert cancel_resp.status_code == 404

        # Unauthenticated → 401 on the same routes.
        async with _client(auth_app) as c:
            assert (await c.get(f"/v1/sessions/{sid}")).status_code == 401
    finally:
        await delete_user_by_email(pool, owner)
        await delete_user_by_email(pool, intruder)


# ---------------------------------------------------------------------------
# DELETE /v1/me cascade incl. active-turn cancel
# ---------------------------------------------------------------------------


async def test_delete_me_cancels_active_turn_and_cascades() -> None:
    email = f"del-{uuid.uuid4().hex}@counselle-test.com"
    gate = asyncio.Event()  # never set — the turn hangs

    async def hung_run_turn(sid: str, text: str, *args: Any, **kwargs: Any) -> Any:
        from domain.events import ev_meta

        yield ev_meta("t-del", sid, "model-x", "m-del", "um-del")
        await gate.wait()

    rt, orig = await _build_test_runtime()
    app = _build_auth_app(rt, run_turn_fn=hung_run_turn)
    pool = rt.app_pool
    try:
        await _register(app, email)
        login = await _login(app, email)
        cookie = login.cookies["counselle_auth"]

        async with _client(app) as c:
            c.cookies.set("counselle_auth", cookie)
            created = await c.post("/v1/sessions", json={})
        sid = created.json()["session_id"]

        # Start a hung turn through the registry so DELETE must cancel it.
        await app.state.turn_registry.start(sid, "hang", user_id=None)
        assert app.state.turn_registry.is_generating(sid) is True

        async with _client(app) as c:
            c.cookies.set("counselle_auth", cookie)
            resp = await c.delete("/v1/me")
        assert resp.status_code == 204
        assert app.state.turn_registry.is_generating(sid) is False

        # The user row (and its session, via FK cascade) is gone.
        async with pool.acquire() as conn:
            user_row = await conn.fetchrow(
                "SELECT 1 FROM counselle.users WHERE lower(email) = lower($1)", email
            )
            sess_row = await conn.fetchrow(
                "SELECT 1 FROM counselle.sessions WHERE session_id = $1", uuid.UUID(sid)
            )
        assert user_row is None
        assert sess_row is None
    finally:
        gate.set()
        await delete_user_by_email(pool, email)
        await orig.aclose()


async def test_delete_me_partial_failure_aborts_and_signals() -> None:
    """A failing ``adelete_thread`` → 500 envelope AND the user + session rows survive."""
    email = f"delfail-{uuid.uuid4().hex}@counselle-test.com"

    rt, orig = await _build_test_runtime()
    app = _build_auth_app(rt)
    pool = rt.app_pool

    async def boom(_sid: str) -> None:
        raise RuntimeError("checkpoint delete blew up")

    try:
        await _register(app, email)
        cookie = (await _login(app, email)).cookies["counselle_auth"]
        async with _client(app) as c:
            c.cookies.set("counselle_auth", cookie)
            created = await c.post("/v1/sessions", json={})
        sid = created.json()["session_id"]

        # Force the thread-delete to fail for this user's only session.
        app.state.runtime.checkpointer.adelete_thread = boom

        async with _client(app) as c:
            c.cookies.set("counselle_auth", cookie)
            resp = await c.delete("/v1/me")
        assert resp.status_code == 500, resp.text
        assert resp.json()["error"]["message"].startswith("Account deletion didn't fully complete")

        # Rows must NOT have been deleted — the operation stays retryable.
        async with pool.acquire() as conn:
            user_row = await conn.fetchrow(
                "SELECT 1 FROM counselle.users WHERE lower(email) = lower($1)", email
            )
            sess_row = await conn.fetchrow(
                "SELECT 1 FROM counselle.sessions WHERE session_id = $1", uuid.UUID(sid)
            )
        assert user_row is not None
        assert sess_row is not None
    finally:
        await delete_user_by_email(pool, email)
        await orig.aclose()


async def test_oauth_callback_compensates_on_null_hash_failure(monkeypatch: Any) -> None:
    """If the null-hash update fails for a brand-new OAuth user, the row is removed."""
    from api.auth import UserManager
    from api.users_db import AsyncpgUserDatabase
    from config.settings import get_settings

    email = f"oauthfail-{uuid.uuid4().hex}@counselle-test.com"
    rt, orig = await _build_test_runtime()
    pool = rt.app_pool
    try:
        user_db = AsyncpgUserDatabase(pool)
        manager = UserManager(user_db, get_settings())

        async def boom(_user: Any, _update: dict[str, Any]) -> Any:
            raise RuntimeError("null-hash update blew up")

        monkeypatch.setattr(user_db, "update", boom)

        with pytest.raises(RuntimeError):
            await manager.oauth_callback(
                "google",
                "access-tok",
                f"acct-{uuid.uuid4().hex}",
                email,
                None,
                None,
                associate_by_email=True,
                is_verified_by_default=True,
            )

        # No stranded user row survived the compensation.
        from fastapi_users.exceptions import UserNotExists

        with pytest.raises(UserNotExists):
            await manager.get_by_email(email)
    finally:
        await delete_user_by_email(pool, email)
        await orig.aclose()


async def test_patch_me_both_fields_atomic(auth_app: FastAPI) -> None:
    """PATCH name + settings together persists both (single atomic UPDATE).

    ``settings`` is now an RFC 7396-style top-level *patch*, not a replacement
    (README §19.4) — a fresh user's onboarding key (seeded at registration)
    must survive an unrelated settings write, so it stays present afterward.
    """
    email = f"patch-{uuid.uuid4().hex}@counselle-test.com"
    pool = auth_app.state.runtime.app_pool
    try:
        await _register(auth_app, email)
        cookie = (await _login(auth_app, email)).cookies["counselle_auth"]
        async with _client(auth_app) as c:
            c.cookies.set("counselle_auth", cookie)
            before = (await c.get("/v1/me")).json()
            patched = await c.patch(
                "/v1/me", json={"name": "Grace", "settings": {"theme": "dark"}}
            )
            assert patched.status_code == 200, patched.text
            me = await c.get("/v1/me")
        body = me.json()
        assert body["name"] == "Grace"
        assert body["settings"]["theme"] == "dark"
        assert body["settings"]["onboarding"] == before["settings"]["onboarding"]
    finally:
        await delete_user_by_email(pool, email)


async def test_patch_me_rejects_reserved_onboarding_key(auth_app: FastAPI) -> None:
    """A generic settings write can never set or clear the reserved onboarding key."""
    email = f"patch-onb-{uuid.uuid4().hex}@counselle-test.com"
    pool = auth_app.state.runtime.app_pool
    try:
        await _register(auth_app, email)
        cookie = (await _login(auth_app, email)).cookies["counselle_auth"]
        async with _client(auth_app) as c:
            c.cookies.set("counselle_auth", cookie)
            resp = await c.patch(
                "/v1/me", json={"settings": {"onboarding": {"status": "completed"}}}
            )
        assert resp.status_code == 422
    finally:
        await delete_user_by_email(pool, email)


async def test_patch_me_rejects_clearing_settings_entirely(auth_app: FastAPI) -> None:
    """``settings: null`` (clear-everything) is rejected, not a full wipe."""
    email = f"patch-null-{uuid.uuid4().hex}@counselle-test.com"
    pool = auth_app.state.runtime.app_pool
    try:
        await _register(auth_app, email)
        cookie = (await _login(auth_app, email)).cookies["counselle_auth"]
        async with _client(auth_app) as c:
            c.cookies.set("counselle_auth", cookie)
            resp = await c.patch("/v1/me", json={"settings": None})
        assert resp.status_code == 422
    finally:
        await delete_user_by_email(pool, email)


async def test_patch_me_settings_write_does_not_clobber_concurrent_onboarding(
    auth_app: FastAPI,
) -> None:
    """A ``PATCH /v1/me`` settings write must not lose a concurrent onboarding write.

    Regression test for the HIGH-severity race: the old handler merged the
    incoming settings patch against ``current_active_user``'s snapshot (taken
    at the start of the request) and blindly overwrote the whole ``settings``
    column. If ``PATCH /v1/onboarding`` committed an update between that
    snapshot and the ``/v1/me`` write, the onboarding progress was silently
    reverted.

    We simulate the interleaving by overriding ``current_active_user`` to
    return a deliberately *stale* :class:`UserDB` snapshot (settings as they
    were before a concurrent onboarding write), then apply the real onboarding
    write directly against the DB, then PATCH ``/v1/me`` through the stale
    dependency. The fixed handler must source its merge from a fresh
    ``SELECT ... FOR UPDATE`` inside its own transaction, not from the stale
    dependency snapshot, so the onboarding key must survive.
    """
    from app.onboarding import OnboardingCommand, update_onboarding_progress

    email = f"race-{uuid.uuid4().hex}@counselle-test.com"
    pool = auth_app.state.runtime.app_pool
    try:
        await _register(auth_app, email)
        cookie = (await _login(auth_app, email)).cookies["counselle_auth"]

        # The "stale" snapshot: settings as fetched right after registration,
        # standing in for what `current_active_user` read at request start.
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT id, email, hashed_password, is_active, is_superuser, "
                "is_verified, name, settings FROM counselle.users WHERE lower(email) = lower($1)",
                email,
            )
        assert row is not None
        stale_settings = dict(row["settings"] or {})
        assert "onboarding" in stale_settings

        from api.users_db import UserDB

        stale_user = UserDB(
            id=row["id"],
            email=row["email"],
            hashed_password=row["hashed_password"],
            is_active=row["is_active"],
            is_superuser=row["is_superuser"],
            is_verified=row["is_verified"],
            name=row["name"],
            settings=stale_settings,
            oauth_accounts=[],
        )

        # The "concurrent" write: PATCH /v1/onboarding commits for real,
        # advancing onboarding past the stale snapshot the /v1/me handler
        # will be handed.
        await update_onboarding_progress(pool, row["id"], OnboardingCommand(action="start"))
        advanced = await update_onboarding_progress(
            pool, row["id"], OnboardingCommand(action="advance", step="basics")
        )
        assert advanced.current_step == "academics"

        from api.auth import current_active_user

        async def _stale_user() -> Any:
            return stale_user

        auth_app.dependency_overrides[current_active_user] = _stale_user
        try:
            async with _client(auth_app) as c:
                c.cookies.set("counselle_auth", cookie)
                patched = await c.patch("/v1/me", json={"settings": {"theme": "dark"}})
        finally:
            del auth_app.dependency_overrides[current_active_user]

        assert patched.status_code == 200, patched.text
        body = patched.json()
        assert body["settings"]["theme"] == "dark"
        # The concurrent onboarding advance must survive — not the stale
        # "basics" step captured in the pre-race snapshot.
        assert body["settings"]["onboarding"]["current_step"] == "academics"

        async with pool.acquire() as conn:
            after = await conn.fetchrow(
                "SELECT settings FROM counselle.users WHERE id = $1", row["id"]
            )
        assert after is not None
        assert after["settings"]["onboarding"]["current_step"] == "academics"
        assert after["settings"]["theme"] == "dark"
    finally:
        await delete_user_by_email(pool, email)


async def test_register_short_password_rejected(auth_app: FastAPI) -> None:
    """A <8-char password is rejected at register (InvalidPasswordException → 400)."""
    email = f"shortpw-{uuid.uuid4().hex}@counselle-test.com"
    pool = auth_app.state.runtime.app_pool
    try:
        resp = await _register(auth_app, email, password="short")
        assert resp.status_code == 400, resp.text
    finally:
        await delete_user_by_email(pool, email)


# ---------------------------------------------------------------------------
# content-type 415 + cookie flags
# ---------------------------------------------------------------------------


async def test_non_json_content_type_returns_415(auth_app: FastAPI) -> None:
    email = f"ct-{uuid.uuid4().hex}@counselle-test.com"
    pool = auth_app.state.runtime.app_pool
    try:
        await _register(auth_app, email)
        cookie = (await _login(auth_app, email)).cookies["counselle_auth"]
        async with _client(auth_app) as c:
            c.cookies.set("counselle_auth", cookie)
            resp = await c.post(
                "/v1/sessions",
                content=b"name=x",
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
        assert resp.status_code == 415
    finally:
        await delete_user_by_email(pool, email)


async def test_login_cookie_flags(auth_app: FastAPI) -> None:
    email = f"flags-{uuid.uuid4().hex}@counselle-test.com"
    pool = auth_app.state.runtime.app_pool
    try:
        await _register(auth_app, email)
        login = await _login(auth_app, email)
        set_cookie = login.headers.get("set-cookie", "")
        assert "counselle_auth=" in set_cookie
        assert "HttpOnly" in set_cookie
        assert "SameSite=lax" in set_cookie
        # cookie_secure defaults to False in tests, so no Secure flag.
        assert "Secure" not in set_cookie
        assert "Max-Age=2592000" in set_cookie  # 30 days
    finally:
        await delete_user_by_email(pool, email)
