"""Persistent credential revisions guard recovery and concurrent account actions."""

from dataclasses import asdict, replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from api.auth_account_security import lock_account_session
from api.routes.auth_account import _confirm_email
from api.users_db import AsyncpgUserDatabase, UserDB


@pytest.fixture
def database():
    user = UserDB(
        uuid4(), "owner@example.com", "stored-hash", True, False, True, credential_revision=4
    )
    conn = SimpleNamespace(
        execute=AsyncMock(),
        fetchrow=AsyncMock(),
        fetchval=AsyncMock(),
        fetch=AsyncMock(return_value=[]),
    )
    scope = AsyncMock()
    scope.__aenter__.return_value = conn
    conn.transaction = Mock(return_value=scope)
    acquire = AsyncMock()
    acquire.__aenter__.return_value = conn
    pool = SimpleNamespace(acquire=Mock(return_value=acquire))
    return SimpleNamespace(
        user=user, conn=conn, pool=pool, scope=scope, db=AsyncpgUserDatabase(pool)
    )


async def test_password_replacement_atomically_checks_and_advances_revision(database):
    h = database
    h.conn.fetchrow.return_value = asdict(replace(h.user, credential_revision=5))
    updated = await h.db.replace_password(h.user, "new-hash")
    assert updated.credential_revision == 5
    query, *args = h.conn.fetchrow.await_args.args
    assert "credential_revision = credential_revision + 1" in query
    assert "credential_revision = $5" in query
    assert args[-1] == h.user.credential_revision
    assert any("auth_sessions" in call.args[0] for call in h.conn.execute.await_args_list)
    assert any("auth_action_tokens" in call.args[0] for call in h.conn.execute.await_args_list)
    h.scope.__aexit__.assert_awaited_once_with(None, None, None)


async def test_password_replacement_rejects_stale_revision_without_revoking(database):
    h = database
    h.conn.fetchrow.return_value = None
    assert await h.db.replace_password(h.user, "new-hash") is None
    h.conn.execute.assert_not_awaited()


async def test_email_confirmation_advances_revision_before_revoking(database):
    h = database
    h.conn.fetchval.return_value = h.user.id
    h.conn.fetchrow.side_effect = [
        {"email": h.user.email},
        {"user_id": h.user.id, "email": "new@example.com"},
    ]
    assert await _confirm_email(h.pool, "single-use-token") == (h.user.email, "new@example.com")
    calls = h.conn.execute.await_args_list
    assert "credential_revision=credential_revision+1" in calls[0].args[0]
    assert "auth_sessions" in calls[1].args[0]
    h.scope.__aexit__.assert_awaited_once_with(None, None, None)


async def test_account_action_rejects_stale_revision_before_session_lock(database):
    h = database
    h.conn.fetchval.return_value = None
    with pytest.raises(HTTPException) as error:
        await lock_account_session(h.conn, h.user, "session-digest")
    assert error.value.detail == "SESSION_EXPIRED"
    h.conn.fetchval.assert_awaited_once()
    query, *args = h.conn.fetchval.await_args.args
    assert "credential_revision=$4" in query
    assert args[-1] == h.user.credential_revision


async def test_hash_upgrade_preserves_revision_but_rejects_stale_snapshot(database):
    h = database
    h.conn.fetchrow.return_value = asdict(h.user)
    assert (await h.db.upgrade_password_hash(h.user, "better-hash")).credential_revision == 4
    query, *args = h.conn.fetchrow.await_args.args
    assert "credential_revision=$5" in query
    assert "credential_revision + 1" not in query
    assert args[-1] == 4


@pytest.mark.parametrize("changes", [{"email": "new@example.com"}, {"hashed_password": None}])
async def test_generic_credential_updates_advance_revision_and_revoke(database, changes):
    h = database
    h.conn.fetchrow.return_value = asdict(replace(h.user, credential_revision=5))
    assert (await h.db.update(h.user, changes)).credential_revision == 5
    calls = h.conn.execute.await_args_list
    assert "credential_revision = credential_revision + 1" in calls[0].args[0]
    assert "auth_sessions" in calls[1].args[0]
    assert "auth_action_tokens" in calls[2].args[0]


async def test_revision_cannot_be_set_through_generic_update(database):
    h = database
    h.conn.fetchrow.return_value = asdict(h.user)
    assert (await h.db.update(h.user, {"credential_revision": 0})).credential_revision == 4
    h.conn.execute.assert_not_awaited()


async def test_profile_edit_does_not_advance_revision_or_revoke(database):
    h = database
    h.conn.fetchrow.return_value = asdict(h.user)
    await h.db.update(h.user, {"name": "Owner"})
    h.conn.execute.assert_awaited_once()
    assert "credential_revision" not in h.conn.execute.await_args.args[0]
