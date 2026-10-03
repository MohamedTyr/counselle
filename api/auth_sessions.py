"""Revocable opaque login sessions, separate from conversation sessions.

The native FastAPI Users database strategy owns token generation. The adapter
stores only SHA-256 digests and returns the raw token transiently on creation.
Reads retain the digest separately, so native logout never hashes it twice.
"""

from __future__ import annotations

import asyncio
import hashlib
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException, Request
from fastapi_users.authentication.strategy.db import DatabaseStrategy

from config.settings import get_settings

_DEFAULT_AUTH_TIME = object()
_COLUMNS = "token_hash, user_id, created_at, authenticated_at, expires_at"


@dataclass(frozen=True)
class AccessToken:
    """A session record; ``token`` is raw only when returned by ``create``."""

    token: str = field(repr=False)
    token_hash: str = field(repr=False)
    user_id: uuid.UUID
    created_at: datetime
    authenticated_at: datetime | None
    expires_at: datetime


def _session(row: Any, *, raw_token: str | None = None) -> AccessToken:
    return AccessToken(token=raw_token or row["token_hash"], **dict(row))


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# The library protocol declares writable attributes; session records stay immutable.
class SessionDatabaseStrategy(DatabaseStrategy[Any, uuid.UUID, AccessToken]):  # type: ignore[type-var]
    """Bind issuance to the credentials read during authentication.

    The native strategy still generates the opaque token. A credential change
    racing the login cannot issue a session after the change revoked old ones.
    """

    def _create_access_token_dict(self, user: Any) -> dict[str, Any]:
        return {
            **super()._create_access_token_dict(user),
            "credential_hash": user.hashed_password,
            "credential_email": user.email,
            "credential_revision": user.credential_revision,
        }


class AsyncpgAccessTokenDatabase:
    """Native AccessTokenDatabase protocol over a pool or transaction connection."""

    def __init__(
        self,
        pool: Any,
        lifetime_seconds: int,
        *,
        authenticated_at: Any = _DEFAULT_AUTH_TIME,
    ) -> None:
        if lifetime_seconds <= 0:
            raise ValueError("Session lifetime must be positive")
        self._pool = pool
        self._lifetime_seconds = lifetime_seconds
        self._authenticated_at = authenticated_at

    async def get_by_token(
        self,
        token: str,
        max_age: datetime | None = None,
    ) -> AccessToken | None:
        if not token or len(token) > 4096:
            return None
        row = await self._pool.fetchrow(
            "SELECT s.token_hash, s.user_id, s.created_at, s.authenticated_at, s.expires_at "
            "FROM counselle.auth_sessions s JOIN counselle.users u ON u.id = s.user_id "
            "WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active "
            "AND ($2::timestamptz IS NULL OR s.created_at >= $2)",
            _digest(token),
            max_age,
        )
        return _session(row) if row is not None else None

    async def create(self, create_dict: dict[str, Any]) -> AccessToken:
        raw_token = create_dict["token"]
        if not isinstance(raw_token, str) or len(raw_token) < 32:
            raise ValueError("Session token requires at least 32 characters")
        default_auth_time = self._authenticated_at is _DEFAULT_AUTH_TIME
        row = await self._pool.fetchrow(
            "INSERT INTO counselle.auth_sessions "
            "(token_hash, user_id, authenticated_at, expires_at) "
            "SELECT $1, u.id, CASE WHEN $3 THEN now() ELSE $4::timestamptz END, "
            "now() + $5 * interval '1 second' FROM counselle.users u "
            "WHERE u.id = $2 AND u.is_active "
            "AND u.hashed_password IS NOT DISTINCT FROM $6::text "
            "AND lower(u.email) = lower($7::text) "
            "AND u.credential_revision = $8::bigint "
            "FOR UPDATE OF u RETURNING " + _COLUMNS,
            _digest(raw_token),
            create_dict["user_id"],
            default_auth_time,
            None if default_auth_time else self._authenticated_at,
            self._lifetime_seconds,
            create_dict["credential_hash"],
            create_dict["credential_email"],
            create_dict["credential_revision"],
        )
        if row is None:
            raise HTTPException(401, detail="LOGIN_CREDENTIALS_CHANGED")
        return _session(row, raw_token=raw_token)

    async def update(self, access_token: AccessToken, update_dict: dict[str, Any]) -> AccessToken:
        """Only explicit reauthentication may change a session record."""
        if set(update_dict) != {"authenticated_at"}:
            raise ValueError("Only authenticated_at may be updated")
        row = await self._pool.fetchrow(
            "UPDATE counselle.auth_sessions SET authenticated_at = $3 "
            "WHERE token_hash = $1 AND user_id = $2 AND expires_at > now() "
            "RETURNING " + _COLUMNS,
            access_token.token_hash,
            access_token.user_id,
            update_dict["authenticated_at"],
        )
        if row is None:
            raise HTTPException(401, detail="SESSION_EXPIRED")
        return _session(row)

    async def delete(self, access_token: AccessToken) -> None:
        await self._pool.execute(
            "DELETE FROM counselle.auth_sessions WHERE token_hash = $1 AND user_id = $2",
            access_token.token_hash,
            access_token.user_id,
        )


def _settings(request: Request) -> Any:
    return getattr(request.app.state, "settings", None) or get_settings()


def _database(
    request: Request,
    *,
    authenticated_at: Any = _DEFAULT_AUTH_TIME,
) -> AsyncpgAccessTokenDatabase:
    return AsyncpgAccessTokenDatabase(
        request.app.state.runtime.app_pool,
        _settings(request).jwt_lifetime_seconds,
        authenticated_at=authenticated_at,
    )


def get_session_strategy(request: Request) -> SessionDatabaseStrategy:
    """FastAPI dependency shared by password and OAuth authentication backends."""
    return SessionDatabaseStrategy(_database(request), _settings(request).jwt_lifetime_seconds)


def get_oauth_session_strategy(
    request: Request,
    authenticated_at: datetime | None,
) -> SessionDatabaseStrategy:
    """Use Google's verified authentication time; absent claims are not recent."""
    return SessionDatabaseStrategy(
        _database(request, authenticated_at=authenticated_at),
        _settings(request).jwt_lifetime_seconds,
    )


async def get_request_session(request: Request, user: Any = None) -> AccessToken | None:
    raw_token = request.cookies.get(_settings(request).cookie_name)
    if not raw_token:
        return None
    session = await _database(request).get_by_token(raw_token)
    if session is not None and user is not None and str(session.user_id) != str(user.id):
        return None
    return session


async def require_recent_auth(
    request: Request,
    user: Any = None,
    *,
    max_age_seconds: int | None = None,
) -> AccessToken:
    session = await get_request_session(request, user)
    if session is None:
        raise HTTPException(401, detail="SESSION_EXPIRED")
    max_age = (
        max_age_seconds
        if max_age_seconds is not None
        else getattr(
            _settings(request),
            "auth_recent_seconds",
            600,
        )
    )
    age = (
        (datetime.now(UTC) - session.authenticated_at).total_seconds()
        if session.authenticated_at
        else None
    )
    if age is None or not 0 <= age <= max_age:
        raise HTTPException(403, detail="REAUTHENTICATION_REQUIRED")
    return session


async def mark_session_recent(
    request: Request,
    user: Any = None,
    *,
    authenticated_at: datetime | None = None,
) -> AccessToken:
    """Call only after a credential check; a revoked session cannot be recreated."""
    session = await get_request_session(request, user)
    if session is None:
        raise HTTPException(401, detail="SESSION_EXPIRED")
    return await _database(request).update(
        session,
        {"authenticated_at": authenticated_at or datetime.now(UTC)},
    )


async def revoke_user_sessions(pool_or_conn: Any, user_id: uuid.UUID) -> None:
    """Accept an existing connection so credential change and revocation are atomic."""
    await pool_or_conn.execute("DELETE FROM counselle.auth_sessions WHERE user_id = $1", user_id)


async def revoke_request_session(request: Request) -> None:
    session = await get_request_session(request)
    if session is not None:
        await _database(request).delete(session)


async def stream_with_session[T](
    request: Request,
    events: AsyncIterator[T],
    *,
    poll_seconds: float | None = None,
) -> AsyncIterator[T]:
    """Close an active stream after expiry/revocation, including on other workers.

    Poll while idle as well as while yielding frames. Only the subscription is
    closed; detached work keeps its existing lifecycle. DB failures fail closed.
    """
    interval = (
        poll_seconds
        if poll_seconds is not None
        else getattr(
            _settings(request),
            "auth_session_poll_seconds",
            5.0,
        )
    )
    if interval <= 0:
        raise ValueError("Session poll interval must be positive")
    iterator = aiter(events)
    pending: asyncio.Future[T] | None = None
    try:
        if await get_request_session(request) is None:
            return
        next_check = time.monotonic() + interval
        while True:
            if pending is None:
                pending = asyncio.ensure_future(anext(iterator))
            done, _ = await asyncio.wait({pending}, timeout=max(0, next_check - time.monotonic()))
            if time.monotonic() >= next_check:
                if await get_request_session(request) is None:
                    return
                next_check = time.monotonic() + interval
            if done:
                completed, pending = pending, None
                try:
                    yield completed.result()
                except StopAsyncIteration:
                    return
    finally:
        if pending is not None:
            pending.cancel()
            with suppress(asyncio.CancelledError, StopAsyncIteration):
                await pending
        close = getattr(iterator, "aclose", None)
        if close is not None:
            await close()
