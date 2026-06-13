"""Transactional email senders (B3, ADR 0021).

MVP2 ships the ``console`` arm only: it logs the recipient, subject, and the
token/link to structlog. The token here is a password-reset / verification
token — a short-lived, single-use credential that is fine to surface in the dev
console (it is the whole point of the console sender). Real secrets (API keys,
DSNs) are NEVER logged anywhere.

``build_email_sender(settings)`` switches on ``settings.email_provider``; only
``"console"`` is implemented for MVP2, and an unknown provider fails fast.
"""

from __future__ import annotations

from typing import Any, Protocol

import structlog

logger = structlog.get_logger(__name__)


class EmailSender(Protocol):
    """The transactional-email seam. Implementations send one message."""

    async def send(self, *, to: str, subject: str, token: str, link: str | None = None) -> None:
        ...


class ConsoleEmailSender:
    """Dev sender: logs the message to structlog instead of dispatching it."""

    def __init__(self, *, email_from: str) -> None:
        self._email_from = email_from

    async def send(
        self, *, to: str, subject: str, token: str, link: str | None = None
    ) -> None:
        logger.info(
            "console_email",
            email_from=self._email_from,
            to=to,
            subject=subject,
            token=token,
            link=link,
        )


def build_email_sender(settings: Any) -> EmailSender:
    """Construct the configured email sender; fail fast on an unknown provider."""
    provider = settings.email_provider
    if provider == "console":
        return ConsoleEmailSender(email_from=settings.email_from)
    raise ValueError(f"unsupported email_provider: {provider!r}")
