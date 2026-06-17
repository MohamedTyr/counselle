"""CFG-03: the password-minimum-length floor is sourced from Settings.

A pure unit test — no live DB. ``UserManager.validate_password`` reads
``self._settings.password_min_length`` for BOTH the check and the message, so a
deployer can tune the floor in one place (no drifting literal).
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi_users.exceptions import InvalidPasswordException

from api.auth import UserManager


def _manager(min_length: int) -> UserManager:
    settings = SimpleNamespace(
        jwt_secret="x" * 32,
        email_provider="console",
        email_from="noreply@counselle.app",
        password_min_length=min_length,
    )
    # validate_password never touches the user_db, so a bare stub is enough.
    return UserManager(SimpleNamespace(), settings)  # type: ignore[arg-type]


async def test_validate_password_uses_settings() -> None:
    """A custom floor (12) rejects short passwords and names the floor in the
    message; a 12-char password passes."""
    manager = _manager(12)
    with pytest.raises(InvalidPasswordException) as excinfo:
        await manager.validate_password("short", None)
    assert "12" in str(excinfo.value.reason)
    # A 12-char password passes (no exception).
    await manager.validate_password("a" * 12, None)


async def test_validate_password_default_floor() -> None:
    """The default floor (8) rejects a 7-char password and admits an 8-char one."""
    manager = _manager(8)
    with pytest.raises(InvalidPasswordException):
        await manager.validate_password("a" * 7, None)
    await manager.validate_password("a" * 8, None)
