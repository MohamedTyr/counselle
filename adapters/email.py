"""Transactional authentication email, with console and Resend delivery."""

from __future__ import annotations

import asyncio
from html import escape
from string import Template
from typing import Any, Literal, Protocol
from urllib.parse import urlsplit

import httpx
import structlog
from pydantic import SecretStr

from config.settings import get_asset_settings, load_yaml_asset

logger = structlog.get_logger(__name__)
_RESEND_URL = "https://api.resend.com/emails"

EmailPurpose = Literal[
    "verify_email",
    "reset_password",
    "google_signin_help",
    "email_change",
    "password_changed",
    "email_changed",
    "reauthenticate",
]


class EmailDeliveryError(RuntimeError):
    """Delivery was not confirmed; contains no provider body or credentials."""


class EmailSender(Protocol):
    """Send a versioned account email. Tokens are for the dev console only."""

    async def send(
        self,
        *,
        to: str,
        subject: str,
        purpose: EmailPurpose,
        token: str = "",
        link: str | None = None,
    ) -> None: ...


def _render_email(purpose: EmailPurpose, link: str | None, reply_to: str) -> tuple[str, str]:
    content = load_yaml_asset("email/messages")[purpose]
    action = content.get("action")
    if action:
        url = urlsplit(link or "")
        if url.scheme not in {"https", "http"} or not url.hostname or url.username:
            raise ValueError("account email requires an absolute http(s) link")
    action_html = (
        f'<p><a href="{escape(link or "", quote=True)}">{escape(action)}</a></p>' if action else ""
    )
    values = {
        "title": escape(content["title"]),
        "body": escape(content["body"]),
        "action": action_html,
        "note": escape(content["note"]),
        "reply_to": escape(reply_to, quote=True),
    }
    template = get_asset_settings().assets_dir / "email" / "message.html"
    html = Template(template.read_text(encoding="utf-8")).substitute(values)
    text_values = {
        **values,
        "title": content["title"],
        "body": content["body"],
        "note": content["note"],
        "action": f"{action}: {link}\n" if action else "",
        "reply_to": reply_to,
    }
    text_template = get_asset_settings().assets_dir / "email" / "message.txt"
    text = Template(text_template.read_text(encoding="utf-8")).substitute(text_values)
    return html, text


class ConsoleEmailSender:
    """Development only: log the token/link instead of dispatching an email."""

    def __init__(self, *, email_from: str) -> None:
        self._email_from = email_from

    async def send(
        self,
        *,
        to: str,
        subject: str,
        purpose: EmailPurpose,
        token: str = "",
        link: str | None = None,
    ) -> None:
        logger.info(
            "console_email",
            email_from=self._email_from,
            to=to,
            subject=subject,
            purpose=purpose,
            token=token,
            link=link,
        )


class ResendEmailSender:
    """Send with a bounded deadline; never expose provider responses in errors."""

    def __init__(
        self,
        *,
        email_from: str,
        email_reply_to: str,
        api_key: str,
        timeout_seconds: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._email_from = email_from
        self._email_reply_to = email_reply_to
        self._api_key = api_key
        self._timeout_seconds = timeout_seconds
        self._transport = transport

    async def send(
        self,
        *,
        to: str,
        subject: str,
        purpose: EmailPurpose,
        token: str = "",
        link: str | None = None,
    ) -> None:
        html, text = _render_email(purpose, link, self._email_reply_to)
        payload = {
            "from": self._email_from,
            "to": [to],
            "subject": subject,
            "reply_to": self._email_reply_to,
            "html": html,
            "text": text,
        }
        try:
            async with (
                asyncio.timeout(self._timeout_seconds),
                httpx.AsyncClient(
                    timeout=self._timeout_seconds,
                    transport=self._transport,
                    follow_redirects=False,
                ) as client,
            ):
                response = await client.post(
                    _RESEND_URL,
                    headers={"Authorization": f"Bearer {self._api_key}"},
                    json=payload,
                )
                response.raise_for_status()
                result = response.json()
                if not isinstance(result, dict) or not isinstance(result.get("id"), str):
                    raise ValueError("missing message id")
                if not result["id"].strip():
                    raise ValueError("empty message id")
        except (httpx.HTTPError, TimeoutError, ValueError) as exc:
            logger.warning(
                "auth_email_delivery_failed",
                provider="resend",
                purpose=purpose,
                error_type=type(exc).__name__,
                status_code=exc.response.status_code
                if isinstance(exc, httpx.HTTPStatusError)
                else None,
            )
            raise EmailDeliveryError("Account email delivery failed") from None
        logger.info("auth_email_accepted", provider="resend", purpose=purpose)


def build_email_sender(settings: Any) -> EmailSender:
    """Construct the configured sender; fail fast on invalid provider configuration."""
    provider = settings.email_provider
    if provider == "console":
        return ConsoleEmailSender(email_from=settings.email_from)
    if provider == "resend":
        key = settings.resend_api_key
        api_key = key.get_secret_value() if isinstance(key, SecretStr) else key
        if not api_key:
            raise ValueError("resend_api_key is required for Resend email delivery")
        return ResendEmailSender(
            email_from=settings.email_from,
            email_reply_to=settings.email_reply_to,
            api_key=api_key,
            timeout_seconds=settings.email_timeout_seconds,
        )
    raise ValueError(f"unsupported email_provider: {provider!r}")
