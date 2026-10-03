"""Opaque auth sessions: storage, expiry, revocation and live-stream checks."""

from __future__ import annotations

import asyncio
import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from api.auth_sessions import (
    AsyncpgAccessTokenDatabase,
    get_request_session,
    get_session_strategy,
    mark_session_recent,
    require_recent_auth,
    revoke_user_sessions,
    stream_with_session,
)


def _row(**overrides):
    now = datetime.now(UTC)
    return {
        "token_hash": hashlib.sha256(b"opaque-secret").hexdigest(),
        "user_id": uuid.uuid4(),
        "created_at": now,
        "authenticated_at": now,
        "expires_at": now + timedelta(days=30),
        **overrides,
    }


def _request(pool, token="opaque-secret"):
    settings = SimpleNamespace(
        cookie_name="auth",
        jwt_lifetime_seconds=3600,
        auth_recent_seconds=600,
        auth_session_poll_seconds=0.005,
    )
    app = SimpleNamespace(
        state=SimpleNamespace(
            runtime=SimpleNamespace(app_pool=pool),
            settings=settings,
        )
    )
    return Request(
        {
            "type": "http",
            "app": app,
            "headers": [
                (b"cookie", f"auth={token}".encode()),
            ],
        }
    )


async def test_native_strategy_returns_raw_cookie_but_stores_only_hash():
    row = _row()
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value=row))
    strategy = get_session_strategy(_request(pool))
    raw_token = await strategy.write_token(
        SimpleNamespace(
            id=row["user_id"],
            hashed_password="stored-hash",
            email="before@example.com",
            credential_revision=0,
        ),
    )
    assert len(raw_token) >= 40
    args = pool.fetchrow.call_args.args
    assert raw_token not in args
    assert hashlib.sha256(raw_token.encode()).hexdigest() == args[1]
    assert "opaque-secret" not in repr(await strategy.database.get_by_token("opaque-secret"))


async def test_native_logout_deletes_existing_hash_without_hashing_twice():
    row = _row()
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value=row), execute=AsyncMock())
    strategy = get_session_strategy(_request(pool))
    await strategy.destroy_token("opaque-secret", SimpleNamespace(id=row["user_id"]))
    assert pool.execute.call_args.args[1:] == (row["token_hash"], row["user_id"])


async def test_lookup_enforces_db_expiry_and_native_max_age():
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value=None))
    db = AsyncpgAccessTokenDatabase(pool, 3600)
    cutoff = datetime.now(UTC) - timedelta(hours=1)
    assert await db.get_by_token("opaque-secret", cutoff) is None
    query, hashed, age = pool.fetchrow.call_args.args
    assert hashed == hashlib.sha256(b"opaque-secret").hexdigest()
    assert age == cutoff
    assert "expires_at > now()" in query
    assert "is_active" in query
    assert "created_at >= $2" in query


async def test_oversized_or_missing_cookie_does_not_query_database():
    pool = SimpleNamespace(fetchrow=AsyncMock())
    assert await get_request_session(_request(pool, "")) is None
    assert await get_request_session(_request(pool, "a" * 4097)) is None
    pool.fetchrow.assert_not_awaited()


async def test_session_must_belong_to_authenticated_user():
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value=_row()))
    assert await get_request_session(_request(pool), SimpleNamespace(id=uuid.uuid4())) is None


async def test_stale_session_requires_reauthentication():
    pool = SimpleNamespace(
        fetchrow=AsyncMock(
            return_value=_row(
                authenticated_at=datetime.now(UTC) - timedelta(minutes=11),
            )
        )
    )
    with pytest.raises(HTTPException) as err:
        await require_recent_auth(_request(pool))
    assert err.value.status_code == 403
    assert err.value.detail == "REAUTHENTICATION_REQUIRED"


async def test_recent_session_is_accepted():
    row = _row()
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value=row))
    session = await require_recent_auth(_request(pool), SimpleNamespace(id=row["user_id"]))
    assert session.token_hash == row["token_hash"]


async def test_revoked_session_cannot_be_marked_recent():
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as err:
        await mark_session_recent(_request(pool))
    assert err.value.status_code == 401


async def test_reauthentication_cannot_resurrect_session_revoked_during_request():
    pool = SimpleNamespace(fetchrow=AsyncMock(side_effect=[_row(), None]))
    with pytest.raises(HTTPException) as err:
        await mark_session_recent(_request(pool))
    assert err.value.status_code == 401
    query = pool.fetchrow.call_args.args[0]
    assert query.startswith("UPDATE")
    assert "expires_at > now()" in query


async def test_revoke_all_uses_passed_transaction_connection():
    conn = SimpleNamespace(execute=AsyncMock())
    user_id = uuid.uuid4()
    await revoke_user_sessions(conn, user_id)
    query, actual = conn.execute.call_args.args
    assert actual == user_id
    assert "DELETE FROM counselle.auth_sessions" in query


async def test_idle_stream_stops_after_revocation_and_closes_source():
    row = _row()
    pool = SimpleNamespace(fetchrow=AsyncMock(side_effect=[row, None]))
    closed = asyncio.Event()

    async def events():
        try:
            yield "first"
            await asyncio.Event().wait()
        finally:
            closed.set()

    stream = stream_with_session(_request(pool), events(), poll_seconds=0.005)
    assert await anext(stream) == "first"
    with pytest.raises(StopAsyncIteration):
        await asyncio.wait_for(anext(stream), timeout=1)
    assert closed.is_set()


async def test_missing_auth_prevents_stream_delivery():
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value=None))

    async def events():
        yield "private data"

    assert [item async for item in stream_with_session(_request(pool), events())] == []


async def test_session_db_outage_does_not_continue_stream():
    row = _row()
    pool = SimpleNamespace(fetchrow=AsyncMock(side_effect=[row, RuntimeError("db unavailable")]))

    async def events():
        yield "first"
        await asyncio.Event().wait()

    stream = stream_with_session(_request(pool), events(), poll_seconds=0.005)
    assert await anext(stream) == "first"
    with pytest.raises(RuntimeError, match="db unavailable"):
        await asyncio.wait_for(anext(stream), timeout=1)


async def test_missing_oauth_auth_time_never_counts_as_recent():
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value=_row(authenticated_at=None)))
    with pytest.raises(HTTPException) as err:
        await require_recent_auth(_request(pool))
    assert err.value.detail == "REAUTHENTICATION_REQUIRED"


async def test_oauth_strategy_does_not_invent_fresh_authentication():
    from api.auth_sessions import get_oauth_session_strategy

    row = _row(authenticated_at=None)
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value=row))
    strategy = get_oauth_session_strategy(_request(pool), authenticated_at=None)
    await strategy.write_token(
        SimpleNamespace(
            id=row["user_id"],
            hashed_password="stored-hash",
            email="before@example.com",
            credential_revision=0,
        )
    )
    args = pool.fetchrow.call_args.args
    assert args[3] is False
    assert args[4] is None


async def test_oauth_refresh_keeps_verified_claim_time():
    verified_time = datetime.now(UTC) - timedelta(seconds=90)
    row = _row()
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value=row))
    await mark_session_recent(_request(pool), authenticated_at=verified_time)
    assert pool.fetchrow.call_args.args[3] == verified_time


async def test_future_authentication_time_does_not_bypass_age_check():
    pool = SimpleNamespace(
        fetchrow=AsyncMock(
            return_value=_row(
                authenticated_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
    )
    with pytest.raises(HTTPException) as err:
        await require_recent_auth(_request(pool))
    assert err.value.detail == "REAUTHENTICATION_REQUIRED"


async def test_update_cannot_extend_expiry_or_switch_user():
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value=_row()))
    db = AsyncpgAccessTokenDatabase(pool, 3600)
    session = await db.get_by_token("opaque-secret")
    with pytest.raises(ValueError, match="Only authenticated_at"):
        await db.update(session, {"user_id": uuid.uuid4()})
    assert pool.fetchrow.await_count == 1


async def test_expired_or_revoked_session_requires_login():
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as err:
        await require_recent_auth(_request(pool))
    assert err.value.status_code == 401


async def test_busy_stream_checks_revocation_between_frames():
    row = _row()
    pool = SimpleNamespace(fetchrow=AsyncMock(side_effect=[row, None]))
    closed = asyncio.Event()

    async def events():
        try:
            while True:
                await asyncio.sleep(0.002)
                yield "frame"
        finally:
            closed.set()

    received = []
    async for item in stream_with_session(_request(pool), events(), poll_seconds=0.005):
        received.append(item)
    assert received
    assert len(received) < 5
    assert closed.is_set()


async def test_closing_stream_cancels_pending_wait_and_closes_source():
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value=_row()))
    closed = asyncio.Event()

    async def events():
        try:
            yield "first"
            await asyncio.Event().wait()
        finally:
            closed.set()

    stream = stream_with_session(_request(pool), events())
    assert await anext(stream) == "first"
    waiting = asyncio.create_task(anext(stream))
    await asyncio.sleep(0)
    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting
    assert closed.is_set()


async def test_issuance_rejects_credentials_changed_during_login():
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value=None))
    strategy = get_session_strategy(_request(pool))
    with pytest.raises(HTTPException) as err:
        await strategy.write_token(
            SimpleNamespace(
                id=uuid.uuid4(),
                hashed_password="old-hash",
                email="before@example.com",
                credential_revision=0,
            )
        )
    assert err.value.detail == "LOGIN_CREDENTIALS_CHANGED"
    query, *args = pool.fetchrow.call_args.args
    assert "FOR UPDATE OF u" in query
    assert "u.hashed_password IS NOT DISTINCT FROM $6::text" in query
    assert args[-3:] == ["old-hash", "before@example.com", 0]
    assert "lower(u.email) = lower($7::text)" in query


async def test_issuance_binds_email_as_well_as_password():
    row = _row()
    pool = SimpleNamespace(fetchrow=AsyncMock(return_value=row))
    strategy = get_session_strategy(_request(pool))
    await strategy.write_token(
        SimpleNamespace(
            id=row["user_id"],
            hashed_password="same-hash",
            email="before@example.com",
            credential_revision=0,
        )
    )
    query, *args = pool.fetchrow.call_args.args
    assert "lower(u.email) = lower($7::text)" in query
    assert args[-2:] == ["before@example.com", 0]
    assert "u.credential_revision = $8::bigint" in query


@pytest.fixture
async def scratch_pool():
    """Opt-in disposable DB only; never create auth tables in a developer DB."""
    import os
    from pathlib import Path

    import asyncpg

    dsn = os.environ.get("COUNSELLE_AUTH_SCRATCH_DSN")
    if not dsn:
        pytest.skip("Set COUNSELLE_AUTH_SCRATCH_DSN to a disposable auth_session_test_* DB")
    pool = await asyncpg.create_pool(dsn, min_size=2, max_size=4)
    try:
        database = await pool.fetchval("SELECT current_database()")
        assert database.startswith("auth_session_test_"), "Refusing non-scratch database"
        await pool.execute("CREATE SCHEMA IF NOT EXISTS counselle")
        await pool.execute(
            "CREATE TABLE IF NOT EXISTS counselle.users (id uuid PRIMARY KEY, "
            "email text NOT NULL, hashed_password text, is_active boolean NOT NULL DEFAULT true, "
            "credential_revision bigint NOT NULL DEFAULT 0)"
        )
        if not await pool.fetchval("SELECT to_regclass('counselle.auth_sessions')"):
            migration = Path(__file__).parents[2] / "migrations/0022_auth_launch.sql"
            await pool.execute(migration.read_text())
        yield pool
    finally:
        await pool.close()


async def _scratch_user(pool):
    user = SimpleNamespace(
        id=uuid.uuid4(),
        email="before@example.com",
        hashed_password="old-hash",
        credential_revision=0,
    )
    await pool.execute(
        "INSERT INTO counselle.users (id,email,hashed_password) VALUES ($1,$2,$3)",
        user.id,
        user.email,
        user.hashed_password,
    )
    return user


async def _wait_until_db_lock(pool, pid):
    for _ in range(200):
        if await pool.fetchval(
            "SELECT wait_event_type = 'Lock' FROM pg_stat_activity WHERE pid=$1",
            pid,
        ):
            return
        await asyncio.sleep(0.01)
    pytest.fail("Concurrent SQL did not reach the expected row lock")


@pytest.mark.live_db
async def test_scratch_session_sql_roundtrip(scratch_pool):
    user = await _scratch_user(scratch_pool)
    strategy = get_session_strategy(_request(scratch_pool))
    raw = await strategy.write_token(user)
    row = await scratch_pool.fetchrow(
        "SELECT * FROM counselle.auth_sessions WHERE user_id=$1",
        user.id,
    )
    assert row["token_hash"] == hashlib.sha256(raw.encode()).hexdigest()
    assert raw not in dict(row).values()
    assert (await strategy.database.get_by_token(raw)).user_id == user.id
    await strategy.destroy_token(raw, user)
    assert await strategy.database.get_by_token(raw) is None


@pytest.mark.live_db
@pytest.mark.parametrize("changed_field", ["hashed_password", "email"])
async def test_scratch_credential_change_blocks_inflight_stale_login(scratch_pool, changed_field):
    user = await _scratch_user(scratch_pool)
    async with scratch_pool.acquire() as mutation, scratch_pool.acquire() as login:
        transaction = mutation.transaction()
        await transaction.start()
        pending = None
        try:
            # Column is the closed parametrized test vocabulary, never user input.
            await mutation.execute(
                f"UPDATE counselle.users SET {changed_field}=$2 WHERE id=$1",
                user.id,
                "changed@example.com" if changed_field == "email" else "new-hash",
            )
            await revoke_user_sessions(mutation, user.id)
            strategy = get_session_strategy(_request(login))
            pending = asyncio.create_task(strategy.write_token(user))
            await _wait_until_db_lock(scratch_pool, login.get_server_pid())
            await transaction.commit()
            with pytest.raises(HTTPException) as err:
                await pending
            assert err.value.detail == "LOGIN_CREDENTIALS_CHANGED"
            assert (
                await scratch_pool.fetchval(
                    "SELECT count(*) FROM counselle.auth_sessions WHERE user_id=$1",
                    user.id,
                )
                == 0
            )
        finally:
            if pending is not None and not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
            if mutation.is_in_transaction():
                await transaction.rollback()


@pytest.mark.live_db
@pytest.mark.parametrize("changed_field", ["hashed_password", "email"])
async def test_scratch_login_first_is_revoked_by_credential_change(scratch_pool, changed_field):
    user = await _scratch_user(scratch_pool)
    async with scratch_pool.acquire() as login, scratch_pool.acquire() as mutation:
        transaction = login.transaction()
        await transaction.start()
        pending = None

        async def change_credentials():
            async with mutation.transaction():
                await mutation.execute(
                    f"UPDATE counselle.users SET {changed_field}=$2 WHERE id=$1",
                    user.id,
                    "changed@example.com" if changed_field == "email" else "new-hash",
                )
                await revoke_user_sessions(mutation, user.id)

        try:
            strategy = get_session_strategy(_request(login))
            raw = await strategy.write_token(user)
            pending = asyncio.create_task(change_credentials())
            await _wait_until_db_lock(scratch_pool, mutation.get_server_pid())
            await transaction.commit()
            await pending
            assert await strategy.database.get_by_token(raw) is None
        finally:
            if pending is not None and not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
            if login.is_in_transaction():
                await transaction.rollback()


@pytest.mark.live_db
async def test_scratch_email_cycle_blocks_inflight_stale_login(scratch_pool):
    user = await _scratch_user(scratch_pool)
    async with scratch_pool.acquire() as mutation, scratch_pool.acquire() as login:
        transaction = mutation.transaction()
        await transaction.start()
        pending = None
        try:
            for email in ("changed@example.com", user.email):
                await mutation.execute(
                    "UPDATE counselle.users SET email=$2, "
                    "credential_revision=credential_revision+1 WHERE id=$1",
                    user.id,
                    email,
                )
            strategy = get_session_strategy(_request(login))
            pending = asyncio.create_task(strategy.write_token(user))
            await _wait_until_db_lock(scratch_pool, login.get_server_pid())
            await transaction.commit()
            with pytest.raises(HTTPException) as err:
                await pending
            assert err.value.detail == "LOGIN_CREDENTIALS_CHANGED"
            assert (
                await scratch_pool.fetchval(
                    "SELECT count(*) FROM counselle.auth_sessions WHERE user_id=$1", user.id
                )
                == 0
            )
        finally:
            if pending is not None and not pending.done():
                pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
            if mutation.is_in_transaction():
                await transaction.rollback()
