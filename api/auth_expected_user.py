"""Bind account actions to the account displayed when the browser initiated them."""

from uuid import UUID

from fastapi import HTTPException, Request

from api.users_db import UserDB


def require_expected_user(request: Request, user: UserDB) -> None:
    """Reject a stale tab's private request; older clients may omit the header."""
    require_expected_user_id(request.headers.get("x-expected-user-id"), user)


def require_expected_user_id(expected: str | None, user: UserDB) -> None:
    """Validate an explicit account binding from a supported transport."""
    if expected is None:
        return
    try:
        expected_id = UUID(expected)
    except ValueError as exc:
        raise HTTPException(409, "ACCOUNT_CHANGED") from exc
    if expected_id != user.id:
        raise HTTPException(409, "ACCOUNT_CHANGED")
