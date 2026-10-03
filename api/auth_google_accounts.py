"""Atomic Google account creation and explicit association."""

from __future__ import annotations

import uuid

import asyncpg

from api.auth_google_identity import GoogleFlowError, GoogleIdentity
from api.users_db import AsyncpgUserDatabase, UserDB
from app.onboarding import merge_initial_onboarding_settings


async def find_google_user(user_db: AsyncpgUserDatabase, identity: GoogleIdentity) -> UserDB | None:
    canonical = await user_db.get_by_oauth_account("google", identity.subject)
    legacy = await user_db.get_by_oauth_account("google", identity.account_ids[1])
    if canonical and legacy and canonical.id != legacy.id:
        raise GoogleFlowError("oauth_identity_mismatch")
    return canonical or legacy


async def _insert_account(
    conn: asyncpg.Connection, user_id: uuid.UUID, identity: GoogleIdentity
) -> None:
    # No Google API is used after sign-in, so neither access nor refresh tokens
    # need retention. The legacy NOT NULL column intentionally stores "".
    await conn.execute(
        """INSERT INTO counselle.oauth_accounts
           (id, user_id, oauth_name, access_token, account_id, account_email)
           VALUES ($1, $2, 'google', '', $3, $4)""",
        uuid.uuid4(),
        user_id,
        identity.subject,
        identity.email,
    )


async def create_google_user(
    pool: asyncpg.Pool, identity: GoogleIdentity, *, signup_enabled: bool
) -> UserDB:
    if not signup_enabled:
        raise GoogleFlowError("signup_disabled")
    user_id = uuid.uuid4()
    try:
        async with pool.acquire() as conn, conn.transaction():
            await conn.execute(
                """INSERT INTO counselle.users
                   (id, email, hashed_password, is_active, is_superuser, is_verified, settings)
                   VALUES ($1, $2, NULL, true, false, $3, $4)""",
                user_id,
                identity.email,
                identity.email_authoritative,
                merge_initial_onboarding_settings(None),
            )
            await _insert_account(conn, user_id, identity)
    except asyncpg.UniqueViolationError as exc:
        # Concurrent signup must roll back BOTH rows, never strand a workspace.
        raise GoogleFlowError("account_exists") from exc
    user = await AsyncpgUserDatabase(pool).get(user_id)
    if user is None:
        raise RuntimeError("Google user missing after committed registration")
    return user


async def associate_google_user(
    pool: asyncpg.Pool,
    user: UserDB,
    identity: GoogleIdentity,
    *,
    session_hash: str,
    recent_seconds: int,
) -> None:
    if not user.is_verified:
        raise GoogleFlowError("email_not_verified")
    try:
        async with pool.acquire() as conn, conn.transaction():
            # Both the current row and the initiating snapshot must prove local
            # email ownership before adding a durable sign-in credential.
            verified = await conn.fetchval(
                """SELECT is_verified FROM counselle.users
                   WHERE id = $1 AND email = $2
                     AND hashed_password IS NOT DISTINCT FROM $3 AND is_active = true
                     AND credential_revision = $4
                   FOR UPDATE""",
                user.id,
                user.email,
                user.hashed_password,
                user.credential_revision,
            )
            if verified is None:
                raise GoogleFlowError()
            if not verified:
                raise GoogleFlowError("email_not_verified")
            # A reset can revoke the initiating session while this callback
            # waits for the user lock. Recheck and lock that session here so
            # credential revocation cannot race the new provider association.
            recent = await conn.fetchval(
                """SELECT true FROM counselle.auth_sessions
                   WHERE token_hash = $1 AND user_id = $2 AND expires_at > clock_timestamp()
                     AND authenticated_at <= clock_timestamp()
                     AND authenticated_at >= clock_timestamp() - $3 * interval '1 second'
                   FOR UPDATE""",
                session_hash,
                user.id,
                recent_seconds,
            )
            if not recent:
                raise GoogleFlowError("recent_auth_required")
            rows = await conn.fetch(
                """SELECT user_id, account_id FROM counselle.oauth_accounts
                   WHERE oauth_name = 'google' AND (user_id = $1 OR account_id = ANY($2::text[]))
                   FOR UPDATE""",
                user.id,
                list(identity.account_ids),
            )
            if any(row["user_id"] != user.id for row in rows):
                raise GoogleFlowError("account_exists")
            if any(row["account_id"] not in identity.account_ids for row in rows):
                raise GoogleFlowError("oauth_identity_mismatch")
            if not rows:
                # A Google identity may use a different address, but cannot
                # silently bridge a second existing Counselle account.
                email_owner = await conn.fetchval(
                    "SELECT id FROM counselle.users WHERE lower(email) = lower($1)",
                    identity.email,
                )
                if email_owner is not None and email_owner != user.id:
                    raise GoogleFlowError("account_exists")
                await _insert_account(conn, user.id, identity)
    except asyncpg.UniqueViolationError as exc:
        raise GoogleFlowError("account_exists") from exc
