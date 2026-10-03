"""Native auth routes against Postgres; generated accounts and captured mail only."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
import pytest_asyncio

from api.routes import auth_reauthenticate
from tests.api.conftest import _build_auth_app, _build_test_runtime

pytestmark = pytest.mark.live_db
_PASSWORD = "integration-only-original-password"


@pytest_asyncio.fixture
async def launch_auth(monkeypatch):
    mail: list[dict[str, Any]] = []

    class CapturedMail:
        async def send(self, **message):
            mail.append(message)

    monkeypatch.setattr("api.auth.build_email_sender", lambda _: CapturedMail())
    runtime, original = await _build_test_runtime()
    app = _build_auth_app(runtime)
    app.state.settings = app.state.settings.model_copy(
        update={
            "auth_attempts_per_window": 200,
            "auth_email_attempts_per_window": 50,
        }
    )
    emails: list[str] = []
    ids: list[UUID] = []
    harness = SimpleNamespace(app=app, pool=runtime.app_pool, mail=mail, ids=ids, emails=emails)
    try:
        yield harness
    finally:
        try:
            async with runtime.app_pool.acquire() as conn:
                await conn.execute(
                    "DELETE FROM counselle.users WHERE id=ANY($1::uuid[]) OR email=ANY($2::text[])",
                    ids,
                    emails,
                )
        finally:
            await original.aclose()


def _client(harness):
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=harness.app),
        base_url="http://test",
        headers={"Origin": "http://test"},
    )


def _token(harness, purpose):
    return next(
        message["token"] for message in reversed(harness.mail) if message["purpose"] == purpose
    )


async def _register(harness, client, *, verified=True):
    email = f"auth-launch-{uuid4().hex}@example.com"
    harness.emails.append(email)
    response = await client.post("/v1/auth/register", json={"email": email, "password": _PASSWORD})
    assert response.status_code == 201
    user_id = UUID(response.json()["id"])
    harness.ids.append(user_id)
    if verified:
        response = await client.post(
            "/v1/auth/verify", json={"token": _token(harness, "verify_email")}
        )
        assert response.status_code == 200
    response = await client.post("/v1/auth/login", data={"username": email, "password": _PASSWORD})
    assert response.status_code == 204
    return user_id, email


async def _login(client, email, password=_PASSWORD):
    response = await client.post("/v1/auth/login", data={"username": email, "password": password})
    assert response.status_code == 204


async def test_native_register_verify_concurrent_reset_and_two_device_revocation(launch_auth):
    h = launch_auth
    async with _client(h) as first, _client(h) as second, _client(h) as public:
        user_id, email = await _register(h, first, verified=False)
        assert (await first.get("/v1/me")).json()["is_verified"] is False
        verification = {"token": _token(h, "verify_email")}
        assert (await public.post("/v1/auth/verify", json=verification)).status_code == 200
        assert (await public.post("/v1/auth/verify", json=verification)).status_code == 400
        assert (await first.get("/v1/me")).json()["is_verified"] is True
        await _login(second, email)
        assert (
            await public.post("/v1/auth/forgot-password", json={"email": email})
        ).status_code == 202
        token = _token(h, "reset_password")
        passwords = ["integration-only-replacement-a", "integration-only-replacement-b"]
        results = await asyncio.gather(
            *[
                public.post("/v1/auth/reset-password", json={"token": token, "password": password})
                for password in passwords
            ]
        )
        assert sorted(response.status_code for response in results) == [200, 400]
        assert (await first.get("/v1/me")).status_code == 401
        assert (await second.get("/v1/me")).status_code == 401
        assert (
            await h.pool.fetchval(
                "SELECT count(*) FROM counselle.auth_sessions WHERE user_id=$1",
                user_id,
            )
            == 0
        )
        assert (
            await public.post(
                "/v1/auth/reset-password",
                json={
                    "token": token,
                    "password": "integration-only-replay-password",
                },
            )
        ).status_code == 400
        old_login = await public.post(
            "/v1/auth/login", data={"username": email, "password": _PASSWORD}
        )
        assert old_login.status_code == 400
        winner = passwords[
            next(i for i, response in enumerate(results) if response.status_code == 200)
        ]
        await _login(first, email, winner)
        assert (await first.get("/v1/me")).status_code == 200


async def test_native_email_change_requires_recent_auth_and_revokes_sessions(launch_auth):
    h = launch_auth
    async with _client(h) as first, _client(h) as second, _client(h) as public:
        user_id, old_email = await _register(h, first)
        await _login(second, old_email)
        new_email = f"auth-launch-new-{uuid4().hex}@example.com"
        h.emails.append(new_email)
        await h.pool.execute(
            "UPDATE counselle.auth_sessions SET authenticated_at=now()-interval '1 hour' "
            "WHERE user_id=$1",
            user_id,
        )
        assert (
            await first.post("/v1/auth/email/change", json={"email": new_email})
        ).status_code == 403
        assert (
            await first.post("/v1/auth/reauthenticate", json={"password": "wrong"})
        ).status_code == 400
        assert (
            await first.post("/v1/auth/reauthenticate", json={"password": _PASSWORD})
        ).status_code == 204
        assert (
            await first.post("/v1/auth/email/change", json={"email": new_email})
        ).status_code == 202
        me = (await first.get("/v1/me")).json()
        assert me["email"] == old_email and me["pending_email"] == new_email
        payload = {"token": _token(h, "email_change")}
        assert (await public.post("/v1/auth/email/confirm", json=payload)).status_code == 204
        assert (await public.post("/v1/auth/email/confirm", json=payload)).status_code == 400
        assert (await first.get("/v1/me")).status_code == 401
        assert (await second.get("/v1/me")).status_code == 401
        await _login(first, new_email)
        assert (await first.get("/v1/me")).json()["is_verified"] is True
        notified = {message["to"] for message in h.mail if message["purpose"] == "email_changed"}
        assert notified == {old_email, new_email}


async def test_native_mailbox_reauth_is_bound_to_requesting_session_and_single_use(launch_auth):
    h = launch_auth
    async with _client(h) as first, _client(h) as second:
        user_id, email = await _register(h, first)
        await _login(second, email)
        await h.pool.execute(
            "UPDATE counselle.auth_sessions SET authenticated_at=NULL WHERE user_id=$1",
            user_id,
        )
        assert (await first.post("/v1/auth/reauthenticate/email")).status_code == 202
        payload = {"token": _token(h, "reauthenticate")}
        assert (
            await second.post("/v1/auth/reauthenticate/email/confirm", json=payload)
        ).status_code == 400
        assert (
            await first.post("/v1/auth/reauthenticate/email/confirm", json=payload)
        ).status_code == 204
        assert (
            await first.post("/v1/auth/reauthenticate/email/confirm", json=payload)
        ).status_code == 400
        assert (await first.get("/v1/me")).json()["reauthentication_required"] is False
        assert (await second.get("/v1/me")).json()["reauthentication_required"] is True


async def test_native_mailbox_confirmation_cannot_restore_session_after_logout_all(
    launch_auth, monkeypatch
):
    h = launch_auth
    arrived, resume = asyncio.Event(), asyncio.Event()
    original = auth_reauthenticate.lock_account_session

    async def paused_lock(*args, **kwargs):
        arrived.set()
        await resume.wait()
        return await original(*args, **kwargs)

    async with _client(h) as first, _client(h) as second:
        user_id, email = await _register(h, first)
        await _login(second, email)
        assert (await first.post("/v1/auth/reauthenticate/email")).status_code == 202
        payload = {"token": _token(h, "reauthenticate")}
        monkeypatch.setattr(auth_reauthenticate, "lock_account_session", paused_lock)
        pending = asyncio.create_task(
            first.post("/v1/auth/reauthenticate/email/confirm", json=payload)
        )
        try:
            await asyncio.wait_for(arrived.wait(), timeout=2)
            assert (await second.post("/v1/auth/logout-all")).status_code == 204
            resume.set()
            assert (await asyncio.wait_for(pending, timeout=2)).status_code in {401, 403}
            assert (
                await h.pool.fetchval(
                    "SELECT count(*) FROM counselle.auth_sessions WHERE user_id=$1",
                    user_id,
                )
                == 0
            )
        finally:
            resume.set()
            await asyncio.gather(pending, return_exceptions=True)


async def test_native_delete_clears_cookie_and_cascades_auth_and_workspace(launch_auth):
    h = launch_auth
    async with _client(h) as client:
        user_id, _ = await _register(h, client)
        created = await client.post("/v1/sessions", json={})
        assert created.status_code == 201
        response = await client.delete("/v1/me")
        assert response.status_code == 204
        assert "Max-Age=0" in response.headers["set-cookie"]
        assert (await client.get("/v1/me")).status_code == 401
        for table in ("users", "auth_sessions", "auth_action_tokens", "sessions"):
            column = "id" if table == "users" else "user_id"
            assert (
                await h.pool.fetchval(
                    f"SELECT count(*) FROM counselle.{table} WHERE {column}=$1",
                    user_id,
                )
                == 0
            )


async def test_native_reset_link_stays_invalid_after_confirmed_email_cycle(launch_auth):
    h = launch_auth
    async with _client(h) as owner, _client(h) as public:
        user_id, original_email = await _register(h, owner)
        assert (
            await public.post("/v1/auth/forgot-password", json={"email": original_email})
        ).status_code == 202
        token = _token(h, "reset_password")
        other_email = f"auth-launch-cycle-{uuid4().hex}@example.com"
        h.emails.append(other_email)
        for target in (other_email, original_email):
            assert (
                await owner.post("/v1/auth/email/change", json={"email": target})
            ).status_code == 202
            assert (
                await public.post(
                    "/v1/auth/email/confirm", json={"token": _token(h, "email_change")}
                )
            ).status_code == 204
            await _login(owner, target)
        assert (
            await h.pool.fetchval(
                "SELECT credential_revision FROM counselle.users WHERE id=$1", user_id
            )
            == 2
        )
        assert (
            await public.post(
                "/v1/auth/reset-password", json={"token": token, "password": "attacker-reset-pass"}
            )
        ).status_code == 400
        assert (await owner.get("/v1/me")).status_code == 200
        await _login(public, original_email)
