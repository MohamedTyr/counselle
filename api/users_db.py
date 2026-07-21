"""The custom asyncpg user-database adapter for fastapi-users (B3, ADR 0021).

fastapi-users ships SQLAlchemy/Beanie adapters; Counselle uses raw asyncpg
everywhere (the app pool already carries a json codec), so we implement the
eight-method :class:`fastapi_users.db.BaseUserDatabase` protocol directly.

The user model is a plain dataclass — fastapi-users only needs attribute access
(``UserProtocol``: ``id, email, hashed_password, is_active, is_superuser,
is_verified`` + an ``oauth_accounts`` iterable). No SQLAlchemy, no pydantic.
``hashed_password`` is ``str | None`` (OAuth-only users have no password).

This module is the ``api/`` layer — direct asyncpg is consistent with the app
pool usage already in the session routes. Parameterized SQL only.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

import asyncpg
from fastapi_users.db import BaseUserDatabase

from app.onboarding import merge_initial_onboarding_settings

# The oauth_accounts columns fastapi-users round-trips, in table order.
_OAUTH_COLS = (
    "oauth_name",
    "access_token",
    "expires_at",
    "refresh_token",
    "account_id",
    "account_email",
)
# The user columns we expose to fastapi-users update/create paths.
_USER_COLS = (
    "email",
    "hashed_password",
    "is_active",
    "is_superuser",
    "is_verified",
    "name",
    "settings",
)


@dataclass
class OAuthAccountDB:
    """One linked OAuth account (satisfies fastapi-users' ``OAuthAccountProtocol``)."""

    id: uuid.UUID
    oauth_name: str
    access_token: str
    account_id: str
    account_email: str
    expires_at: int | None = None
    refresh_token: str | None = None


@dataclass
class UserDB:
    """The user row fastapi-users operates on (``UserOAuthProtocol``)."""

    id: uuid.UUID
    email: str
    hashed_password: str | None
    is_active: bool
    is_superuser: bool
    is_verified: bool
    name: str | None = None
    settings: dict[str, Any] = field(default_factory=dict)
    oauth_accounts: list[OAuthAccountDB] = field(default_factory=list)


def _user_from_row(row: asyncpg.Record, oauth: list[OAuthAccountDB]) -> UserDB:
    return UserDB(
        id=row["id"],
        email=row["email"],
        hashed_password=row["hashed_password"],
        is_active=row["is_active"],
        is_superuser=row["is_superuser"],
        is_verified=row["is_verified"],
        name=row["name"],
        settings=row["settings"] or {},
        oauth_accounts=oauth,
    )


def _oauth_from_row(row: asyncpg.Record) -> OAuthAccountDB:
    return OAuthAccountDB(
        id=row["id"],
        oauth_name=row["oauth_name"],
        access_token=row["access_token"],
        account_id=row["account_id"],
        account_email=row["account_email"],
        expires_at=row["expires_at"],
        refresh_token=row["refresh_token"],
    )


# UserDB carries ``hashed_password: str | None`` (OAuth-only users have none),
# while fastapi-users' ``UserProtocol`` over-narrows it to ``str``. The adapter
# stores/returns None correctly at runtime (spike-verified); the type-var
# variance check is the only objection, so it is suppressed here.
class AsyncpgUserDatabase(BaseUserDatabase[UserDB, uuid.UUID]):  # type: ignore[type-var]
    """asyncpg-backed fastapi-users database adapter (the app pool)."""

    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    # -- reads ----------------------------------------------------------------

    async def get(self, id: uuid.UUID) -> UserDB | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM counselle.users WHERE id = $1", id
            )
            if row is None:
                return None
            return _user_from_row(row, await self._load_oauth(conn, id))

    async def get_by_email(self, email: str) -> UserDB | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM counselle.users WHERE lower(email) = lower($1)", email
            )
            if row is None:
                return None
            return _user_from_row(row, await self._load_oauth(conn, row["id"]))

    async def get_by_oauth_account(self, oauth: str, account_id: str) -> UserDB | None:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT u.* FROM counselle.users u
                JOIN counselle.oauth_accounts oa ON oa.user_id = u.id
                WHERE oa.oauth_name = $1 AND oa.account_id = $2
                """,
                oauth,
                account_id,
            )
            if row is None:
                return None
            return _user_from_row(row, await self._load_oauth(conn, row["id"]))

    async def _load_oauth(
        self, conn: asyncpg.Connection, user_id: uuid.UUID
    ) -> list[OAuthAccountDB]:
        rows = await conn.fetch(
            "SELECT * FROM counselle.oauth_accounts WHERE user_id = $1", user_id
        )
        return [_oauth_from_row(r) for r in rows]

    # -- writes ---------------------------------------------------------------

    async def create(self, create_dict: dict[str, Any]) -> UserDB:
        new_id = uuid.uuid4()
        values = {key: create_dict.get(key) for key in _USER_COLS}
        # Every new user (password or Google OAuth — both flow through this one
        # `create`) starts version-1 onboarding at not_started/basics (README
        # §7.1–7.2). Preserves any other supplied settings; never overwrites an
        # explicitly-supplied trusted onboarding state (e.g. a future fixture).
        values["settings"] = merge_initial_onboarding_settings(values.get("settings"))
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO counselle.users
                  (id, email, hashed_password, is_active, is_superuser,
                   is_verified, name, settings)
                VALUES ($1, $2, $3,
                        COALESCE($4, true), COALESCE($5, false),
                        COALESCE($6, false), $7, $8)
                """,
                new_id,
                values["email"],
                values["hashed_password"],
                values["is_active"],
                values["is_superuser"],
                values["is_verified"],
                values["name"],
                values["settings"],
            )
        created = await self.get(new_id)
        if created is None:
            raise RuntimeError(f"user {new_id} missing immediately after insert")
        return created

    async def update(self, user: UserDB, update_dict: dict[str, Any]) -> UserDB:
        cols = [key for key in update_dict if key in _USER_COLS]
        if cols:
            assignments = ", ".join(f"{col} = ${i + 2}" for i, col in enumerate(cols))
            args = [update_dict[col] for col in cols]
            async with self._pool.acquire() as conn:
                await conn.execute(
                    # `assignments` interpolates ONLY column names drawn from the
                    # fixed _USER_COLS allowlist (never user input); all values
                    # bind via $N. Safe by construction.
                    f"UPDATE counselle.users SET {assignments} WHERE id = $1",  # nosec B608
                    user.id,
                    *args,
                )
        refreshed = await self.get(user.id)
        if refreshed is None:
            raise RuntimeError(f"user {user.id} missing immediately after update")
        return refreshed

    async def delete(self, user: UserDB) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute("DELETE FROM counselle.users WHERE id = $1", user.id)

    # -- oauth accounts -------------------------------------------------------

    async def add_oauth_account(
        self, user: UserDB, create_dict: dict[str, Any]
    ) -> UserDB:
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO counselle.oauth_accounts
                  (id, user_id, oauth_name, access_token, expires_at,
                   refresh_token, account_id, account_email)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                """,
                uuid.uuid4(),
                user.id,
                create_dict["oauth_name"],
                create_dict["access_token"],
                create_dict.get("expires_at"),
                create_dict.get("refresh_token"),
                create_dict["account_id"],
                create_dict["account_email"],
            )
        refreshed = await self.get(user.id)
        if refreshed is None:
            raise RuntimeError(f"user {user.id} missing immediately after oauth-account insert")
        return refreshed

    async def update_oauth_account(  # type: ignore[override]  # OAP narrowed to our concrete type
        self, user: UserDB, oauth_account: OAuthAccountDB, update_dict: dict[str, Any]
    ) -> UserDB:
        cols = [key for key in update_dict if key in _OAUTH_COLS]
        if cols:
            assignments = ", ".join(f"{col} = ${i + 2}" for i, col in enumerate(cols))
            args = [update_dict[col] for col in cols]
            async with self._pool.acquire() as conn:
                await conn.execute(
                    # Column names from the fixed _OAUTH_COLS allowlist only; all
                    # values bind via $N. Safe by construction.
                    f"UPDATE counselle.oauth_accounts SET {assignments} WHERE id = $1",  # nosec B608
                    oauth_account.id,
                    *args,
                )
        refreshed = await self.get(user.id)
        if refreshed is None:
            raise RuntimeError(f"user {user.id} missing immediately after oauth-account update")
        return refreshed
