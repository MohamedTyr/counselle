"""Google callback security regression tests, with provider and DB boundaries mocked."""

from __future__ import annotations

import time
import uuid
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

import api.auth_google as google
import api.auth_google_accounts as accounts
import api.auth_google_identity as identities
import api.auth_sessions as sessions
from api.auth import get_user_manager
from api.auth_google_identity import GoogleFlowError, GoogleIdentity
from api.users_db import UserDB
from config.settings import get_settings


def _user(**kwargs):
    return UserDB(
        id=uuid.uuid4(),
        email="student@gmail.com",
        hashed_password=None,
        is_active=True,
        is_superuser=False,
        is_verified=True,
        **kwargs,
    )


@pytest.fixture
def flow(monkeypatch):
    settings = get_settings().model_copy(
        update={
            "google_oauth_client_id": "test-client",
            "google_oauth_client_secret": "test-secret",
            "auth_public_url": "https://acceptra.ai",
            "cookie_secure": False,
        }
    )
    user = _user()
    manager = SimpleNamespace(
        user_db=SimpleNamespace(
            get_by_oauth_account=AsyncMock(return_value=user),
            get_by_email=AsyncMock(return_value=None),
        ),
        get=AsyncMock(return_value=user),
        on_after_login=AsyncMock(),
        on_after_register=AsyncMock(),
        request_verify=AsyncMock(),
    )
    now = datetime.now(UTC)
    session = sessions.AccessToken(
        token="transient",
        token_hash="session-digest",
        user_id=user.id,
        created_at=now,
        authenticated_at=now,
        expires_at=now + timedelta(days=1),
    )
    session_reader = AsyncMock(return_value=session)
    monkeypatch.setattr(sessions, "get_request_session", session_reader)
    mark_recent = AsyncMock()
    monkeypatch.setattr(sessions, "mark_session_recent", mark_recent)
    strategy = SimpleNamespace(write_token=AsyncMock(return_value="session-token"))
    oauth_strategy = Mock(return_value=strategy)
    monkeypatch.setattr(sessions, "get_oauth_session_strategy", oauth_strategy)
    token_exchange = AsyncMock(return_value={"id_token": "signed-provider-token"})
    monkeypatch.setattr(google.GoogleOAuth2, "get_access_token", token_exchange)
    identity = GoogleIdentity("123456789", "student@gmail.com", True, int(time.time()) - 1)
    verify = AsyncMock(return_value=identity)
    monkeypatch.setattr(google, "verify_google_identity", verify)
    app = FastAPI()
    app.state.settings = settings
    app.state.runtime = SimpleNamespace(app_pool=object())
    app.dependency_overrides[get_user_manager] = lambda: manager
    google.install_google_auth(app, settings)
    return SimpleNamespace(**locals())


async def _start(client, mode="login", next="/app/tasks"):
    prefix = "/v1/auth/google" + ("" if mode == "login" else f"/{mode}")
    response = await client.get(f"{prefix}/authorize", params={"next": next})
    assert response.status_code == 200
    query = parse_qs(urlsplit(response.json()["authorization_url"]).query)
    return prefix + "/callback", query["state"][0], query


@pytest.mark.asyncio
async def test_authorize_narrow_scopes_and_cookie(flow):
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as client:
        _, _, query = await _start(client)
        assert set(query["scope"][0].split()) == {"openid", "email"}
        assert query["redirect_uri"] == ["http://localhost:8000/v1/auth/google/callback"]
        assert query["nonce"]
        assert "auth_time" in query["claims"][0]
        cookie = next(iter(client.cookies.jar))
        assert cookie.path == "/v1/auth/google"
        assert cookie.has_nonstandard_attr("HttpOnly")


@pytest.mark.asyncio
async def test_returning_google_login_uses_session_strategy_and_next(flow):
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as client:
        callback, state, _ = await _start(client)
        response = await client.get(callback, params={"state": state, "code": "one-time-code"})
        assert response.status_code == 302
        assert (
            response.headers["location"] == "https://acceptra.ai/auth/callback?next=%2Fapp%2Ftasks"
        )
        assert client.cookies.get(flow.settings.cookie_name) == "session-token"
        flow.strategy.write_token.assert_awaited_once_with(flow.user)
        assert flow.oauth_strategy.call_args.args[1] == datetime.fromtimestamp(
            flow.identity.authenticated_at, UTC
        )
        assert client.cookies.get(google._cookie_name(flow.settings, "login")) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("attack", ["missing_cookie", "tampered", "wrong_purpose"])
async def test_state_attacks_fail_before_code_exchange(flow, attack):
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as client:
        callback, state, _ = await _start(client)
        if attack == "missing_cookie":
            client.cookies.clear()
        elif attack == "tampered":
            state = state[:-4] + "xxxx"
        else:
            callback = "/v1/auth/google/reauth/callback"
        response = await client.get(callback, params={"state": state, "code": "code"})
        assert "error=oauth_invalid_state" in response.headers["location"]
        flow.token_exchange.assert_not_awaited()


@pytest.mark.asyncio
async def test_provider_cancellation_returns_retryable_error(flow):
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as client:
        callback, state, _ = await _start(client)
        response = await client.get(callback, params={"state": state, "error": "access_denied"})
        assert "error=oauth_cancelled" in response.headers["location"]
        flow.token_exchange.assert_not_awaited()


@pytest.mark.asyncio
async def test_same_email_does_not_link_or_login(flow):
    flow.manager.user_db.get_by_oauth_account.return_value = None
    flow.manager.user_db.get_by_email.return_value = flow.user
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as client:
        callback, state, _ = await _start(client)
        response = await client.get(callback, params={"state": state, "code": "code"})
        assert "error=account_exists" in response.headers["location"]
        flow.strategy.write_token.assert_not_awaited()


@pytest.mark.asyncio
async def test_associate_requires_recent_auth_at_start_and_finish(flow, monkeypatch):
    link = AsyncMock()
    monkeypatch.setattr(google, "associate_google_user", link)
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as client:
        callback, state, _ = await _start(client, "associate")
        flow.session_reader.return_value = replace(flow.session, authenticated_at=None)
        response = await client.get(callback, params={"state": state, "code": "code"})
        assert "error=recent_auth_required" in response.headers["location"]
        link.assert_not_awaited()
        denied = await client.get("/v1/auth/google/associate/authorize")
        assert denied.status_code == 403


@pytest.mark.asyncio
async def test_associate_is_bound_to_original_session(flow):
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as client:
        callback, state, _ = await _start(client, "associate")
        flow.session_reader.return_value = replace(flow.session, token_hash="a-second-session")
        response = await client.get(callback, params={"state": state, "code": "code"})
        assert "error=oauth_invalid_state" in response.headers["location"]
        flow.token_exchange.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("auth_time", [None, 1])
async def test_stale_google_sso_cannot_mark_session_recent(flow, auth_time):
    flow.verify.return_value = replace(flow.identity, authenticated_at=auth_time)
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as client:
        callback, state, _ = await _start(client, "reauth")
        response = await client.get(callback, params={"state": state, "code": "code"})
        assert "error=oauth_reauth_required" in response.headers["location"]
        flow.mark_recent.assert_not_awaited()


@pytest.mark.asyncio
async def test_reauth_requires_same_google_identity(flow):
    flow.manager.user_db.get_by_oauth_account.return_value = _user()
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as client:
        callback, state, _ = await _start(client, "reauth")
        response = await client.get(callback, params={"state": state, "code": "code"})
        assert "error=oauth_identity_mismatch" in response.headers["location"]
        flow.mark_recent.assert_not_awaited()


@pytest.mark.asyncio
async def test_reauth_uses_actual_provider_auth_time(flow):
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as client:
        callback, state, _ = await _start(client, "reauth")
        response = await client.get(callback, params={"state": state, "code": "code"})
        assert "error=" not in response.headers["location"]
        assert flow.mark_recent.await_args.kwargs["authenticated_at"] == datetime.fromtimestamp(
            flow.identity.authenticated_at, UTC
        )


@pytest.mark.asyncio
async def test_legacy_google_account_is_found_without_email_matching(flow):
    flow.manager.user_db.get_by_oauth_account.side_effect = [None, flow.user]
    assert await accounts.find_google_user(flow.manager.user_db, flow.identity) == flow.user
    assert flow.manager.user_db.get_by_oauth_account.await_args.args == (
        "google",
        "people/123456789",
    )
    flow.manager.user_db.get_by_email.assert_not_awaited()


@pytest.mark.asyncio
async def test_conflicting_legacy_and_canonical_identities_fail_closed(flow):
    flow.manager.user_db.get_by_oauth_account.side_effect = [flow.user, _user()]
    with pytest.raises(GoogleFlowError, match="oauth_identity_mismatch"):
        await accounts.find_google_user(flow.manager.user_db, flow.identity)


@pytest.mark.parametrize(
    "path",
    [
        "https://evil.test",
        "//[",
        "//evil.test",
        "/\\evil.test",
        "/%2Fevil.test",
        "/%252Fevil.test",
        "/%0devil",
        "/\x00evil",
    ],
)
def test_redirects_reject_external_or_ambiguous_paths(path):
    assert google.safe_next(path) == "/app"


def _claims(**kwargs):
    return {
        "sub": "123456789",
        "email": "student@gmail.com",
        "email_verified": True,
        "nonce": "nonce",
        **kwargs,
    }


@pytest.mark.parametrize(
    "claims",
    [
        _claims(email_verified=False),
        _claims(email_verified="true"),
        _claims(nonce="other"),
        _claims(sub="people/123"),
        _claims(email="not-an-email"),
    ],
)
def test_google_identity_rejects_unverified_or_invalid_claims(claims):
    with pytest.raises(GoogleFlowError):
        identities.identity_from_claims(claims, "nonce")


def test_third_party_google_email_requires_local_verification():
    identity = identities.identity_from_claims(_claims(email="student@example.com"), "nonce")
    assert not identity.email_authoritative
    hosted = identities.identity_from_claims(
        _claims(email="student@example.com", hd="example.com"), "nonce"
    )
    assert hosted.email_authoritative


@pytest.mark.asyncio
async def test_google_verifier_checks_client_and_nonce(monkeypatch):
    verify = Mock(return_value=_claims())
    monkeypatch.setattr(identities, "verify_oauth2_token", verify)
    result = await identities.verify_google_identity({"id_token": "signed"}, "client-id", "nonce")
    assert result.subject == "123456789"
    assert verify.call_args.args[0] == "signed"
    assert verify.call_args.args[2] == "client-id"
    verify.return_value = _claims(azp="different-client")
    with pytest.raises(GoogleFlowError):
        await identities.verify_google_identity({"id_token": "signed"}, "client-id", "nonce")


@pytest.fixture
def transaction():
    conn = SimpleNamespace(
        execute=AsyncMock(), fetch=AsyncMock(return_value=[]), fetchval=AsyncMock(return_value=True)
    )
    scope = AsyncMock()
    scope.__aenter__.return_value = conn
    conn.transaction = Mock(return_value=scope)
    acquire = AsyncMock()
    acquire.__aenter__.return_value = conn
    pool = SimpleNamespace(acquire=Mock(return_value=acquire))
    return SimpleNamespace(conn=conn, pool=pool, scope=scope)


@pytest.mark.asyncio
async def test_google_signup_creates_null_password_and_account_in_one_transaction(
    flow, transaction, monkeypatch
):
    monkeypatch.setattr(accounts.AsyncpgUserDatabase, "get", AsyncMock(return_value=flow.user))
    result = await accounts.create_google_user(transaction.pool, flow.identity, signup_enabled=True)
    assert result == flow.user
    calls = transaction.conn.execute.await_args_list
    assert len(calls) == 2
    assert "NULL, true, false" in calls[0].args[0]
    assert calls[0].args[3] is True
    assert calls[0].args[1] == calls[1].args[2]
    assert calls[1].args[3] == flow.identity.subject
    transaction.scope.__aexit__.assert_awaited_once_with(None, None, None)


@pytest.mark.asyncio
async def test_google_signup_third_party_email_is_unverified(flow, transaction, monkeypatch):
    monkeypatch.setattr(accounts.AsyncpgUserDatabase, "get", AsyncMock(return_value=flow.user))
    identity = replace(flow.identity, email="student@example.com", email_authoritative=False)
    await accounts.create_google_user(transaction.pool, identity, signup_enabled=True)
    assert transaction.conn.execute.await_args_list[0].args[3] is False


@pytest.mark.asyncio
async def test_google_signup_collision_rolls_back_user_and_account(flow, transaction):
    import asyncpg

    transaction.conn.execute.side_effect = [None, asyncpg.UniqueViolationError()]
    with pytest.raises(GoogleFlowError, match="account_exists"):
        await accounts.create_google_user(transaction.pool, flow.identity, signup_enabled=True)
    assert transaction.scope.__aexit__.await_args.args[0] is asyncpg.UniqueViolationError


@pytest.mark.asyncio
async def test_disabled_google_signup_does_not_write(flow, transaction):
    with pytest.raises(GoogleFlowError, match="signup_disabled"):
        await accounts.create_google_user(transaction.pool, flow.identity, signup_enabled=False)
    transaction.conn.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_google_link_is_atomic_and_does_not_retain_provider_tokens(flow, transaction):
    transaction.conn.fetchval.side_effect = [True, True, None]
    await accounts.associate_google_user(
        transaction.pool,
        flow.user,
        flow.identity,
        session_hash=flow.session.token_hash,
        recent_seconds=600,
    )
    transaction.scope.__aexit__.assert_awaited_once_with(None, None, None)
    values = transaction.conn.execute.await_args.args
    assert "'google', ''" in values[0]
    assert values[2] == flow.user.id
    assert values[3] == flow.identity.subject


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "collision", ["identity_owned", "already_linked", "email_owned", "inactive"]
)
async def test_google_link_rejects_conflicts(flow, transaction, collision):
    transaction.conn.fetchval.side_effect = [collision != "inactive", True, uuid.uuid4()]
    if collision == "identity_owned":
        transaction.conn.fetch.return_value = [
            {"user_id": uuid.uuid4(), "account_id": flow.identity.subject}
        ]
    elif collision == "already_linked":
        transaction.conn.fetch.return_value = [{"user_id": flow.user.id, "account_id": "987654321"}]
    with pytest.raises(GoogleFlowError):
        await accounts.associate_google_user(
            transaction.pool,
            flow.user,
            flow.identity,
            session_hash=flow.session.token_hash,
            recent_seconds=600,
        )
    transaction.conn.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_link_same_provider_identity_is_idempotent(flow, transaction):
    transaction.conn.fetch.return_value = [
        {"user_id": flow.user.id, "account_id": flow.identity.subject}
    ]
    await accounts.associate_google_user(
        transaction.pool,
        flow.user,
        flow.identity,
        session_hash=flow.session.token_hash,
        recent_seconds=600,
    )
    transaction.conn.execute.assert_not_awaited()


@pytest.mark.asyncio
async def test_provider_token_failure_never_sets_login_cookie(flow):
    flow.verify.side_effect = ValueError("token verification failed")
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as client:
        callback, state, _ = await _start(client)
        response = await client.get(callback, params={"state": state, "code": "code"})
        assert "error=oauth_failed" in response.headers["location"]
        assert client.cookies.get(flow.settings.cookie_name) is None
        flow.strategy.write_token.assert_not_awaited()


@pytest.mark.asyncio
async def test_inactive_google_user_cannot_login(flow):
    flow.manager.user_db.get_by_oauth_account.return_value = replace(flow.user, is_active=False)
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as client:
        callback, state, _ = await _start(client)
        response = await client.get(callback, params={"state": state, "code": "code"})
        assert "error=oauth_failed" in response.headers["location"]
        flow.strategy.write_token.assert_not_awaited()


@pytest.mark.asyncio
async def test_new_google_signup_calls_registration_hook_once(flow, monkeypatch):
    flow.manager.user_db.get_by_oauth_account.return_value = None
    create = AsyncMock(return_value=flow.user)
    monkeypatch.setattr(google, "create_google_user", create)
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as client:
        callback, state, _ = await _start(client)
        response = await client.get(callback, params={"state": state, "code": "code"})
        assert "error=" not in response.headers["location"]
        flow.manager.on_after_register.assert_awaited_once()
        flow.manager.request_verify.assert_not_awaited()


@pytest.mark.asyncio
async def test_google_link_rechecks_revocation_after_acquiring_user_lock(flow, transaction):
    transaction.conn.fetchval.side_effect = [True, None]
    with pytest.raises(GoogleFlowError, match="recent_auth_required"):
        await accounts.associate_google_user(
            transaction.pool,
            flow.user,
            flow.identity,
            session_hash=flow.session.token_hash,
            recent_seconds=600,
        )
    queries = transaction.conn.fetchval.await_args_list
    assert "counselle.users" in queries[0].args[0]
    assert "counselle.auth_sessions" in queries[1].args[0]
    assert "FOR UPDATE" in queries[1].args[0]
    assert queries[1].args[1:] == (flow.session.token_hash, flow.user.id, 600)
    transaction.conn.execute.assert_not_awaited()
    transaction.conn.fetch.assert_not_awaited()


@pytest.mark.asyncio
async def test_unverified_local_account_cannot_start_google_association(flow, monkeypatch):
    link = AsyncMock()
    monkeypatch.setattr(google, "associate_google_user", link)
    flow.manager.get.return_value = replace(flow.user, is_verified=False)
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as client:
        response = await client.get("/v1/auth/google/associate/authorize")
        assert response.status_code == 403
        assert response.json()["detail"] == "EMAIL_NOT_VERIFIED"
        assert not client.cookies
    flow.token_exchange.assert_not_awaited()
    link.assert_not_awaited()


@pytest.mark.asyncio
async def test_google_association_rechecks_verification_before_token_exchange(flow, monkeypatch):
    link = AsyncMock()
    monkeypatch.setattr(google, "associate_google_user", link)
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as client:
        callback, state, _ = await _start(client, "associate")
        flow.manager.get.return_value = replace(flow.user, is_verified=False)
        response = await client.get(callback, params={"state": state, "code": "code"})
        assert "error=email_not_verified" in response.headers["location"]
    flow.token_exchange.assert_not_awaited()
    link.assert_not_awaited()


@pytest.mark.asyncio
async def test_google_association_rechecks_verification_after_token_exchange(flow, monkeypatch):
    link = AsyncMock()
    monkeypatch.setattr(google, "associate_google_user", link)
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as client:
        callback, state, _ = await _start(client, "associate")
        flow.manager.get.side_effect = [flow.user, replace(flow.user, is_verified=False)]
        response = await client.get(callback, params={"state": state, "code": "code"})
        assert "error=email_not_verified" in response.headers["location"]
    flow.token_exchange.assert_awaited_once()
    link.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("verified_at_lock", [False, None])
async def test_google_link_requires_verified_unchanged_account_under_lock(
    flow, transaction, verified_at_lock
):
    transaction.conn.fetchval.return_value = verified_at_lock
    with pytest.raises(GoogleFlowError):
        await accounts.associate_google_user(
            transaction.pool,
            flow.user,
            flow.identity,
            session_hash=flow.session.token_hash,
            recent_seconds=600,
        )
    query = transaction.conn.fetchval.await_args_list[0].args
    assert "is_verified" in query[0]
    assert "email = $2" in query[0]
    assert "hashed_password IS NOT DISTINCT FROM $3" in query[0]
    assert "FOR UPDATE" in query[0]
    assert query[1:] == (
        flow.user.id,
        flow.user.email,
        flow.user.hashed_password,
        flow.user.credential_revision,
    )
    transaction.conn.execute.assert_not_awaited()
    transaction.conn.fetch.assert_not_awaited()


@pytest.mark.asyncio
async def test_google_link_rejects_unverified_snapshot_even_if_verified_while_waiting(
    flow, transaction
):
    with pytest.raises(GoogleFlowError, match="email_not_verified"):
        await accounts.associate_google_user(
            transaction.pool,
            replace(flow.user, is_verified=False),
            flow.identity,
            session_hash=flow.session.token_hash,
            recent_seconds=600,
        )
    transaction.conn.execute.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["login", "reauth"])
async def test_unverified_google_account_can_still_login_and_reauthenticate(flow, mode):
    user = replace(flow.user, is_verified=False)
    flow.manager.get.return_value = user
    flow.manager.user_db.get_by_oauth_account.return_value = user
    async with AsyncClient(
        transport=ASGITransport(app=flow.app), base_url="http://localhost:8000"
    ) as client:
        callback, state, _ = await _start(client, mode)
        response = await client.get(callback, params={"state": state, "code": "code"})
        assert "error=" not in response.headers["location"]
