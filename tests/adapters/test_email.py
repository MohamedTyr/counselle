"""Transactional email contract and safe provider failure behavior."""

import asyncio
import json
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from pydantic import SecretStr
from structlog.testing import capture_logs

from adapters.email import (
    ConsoleEmailSender,
    EmailDeliveryError,
    ResendEmailSender,
    build_email_sender,
)


def sender(handler: Any, *, timeout: float = 1.0) -> ResendEmailSender:
    return ResendEmailSender(
        email_from="Acceptra <accounts@mail.acceptra.ai>",
        email_reply_to="support@acceptra.ai",
        api_key="provider-secret",
        timeout_seconds=timeout,
        transport=httpx.MockTransport(handler),
    )


async def test_resend_sends_branded_multipart_email_with_reply_to() -> None:
    requests: list[httpx.Request] = []

    def accept(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"id": "message-id"})

    with capture_logs() as logs:
        await sender(accept).send(
            to="student@example.com",
            subject="Verify your email",
            purpose="verify_email",
            token="console-only-token",
            link="https://acceptra.ai/verify?token=secret&next=app",
        )
    request = requests[0]
    body = json.loads(request.content)
    assert str(request.url) == "https://api.resend.com/emails"
    assert request.headers["authorization"] == "Bearer provider-secret"
    assert body["from"] == "Acceptra <accounts@mail.acceptra.ai>"
    assert body["to"] == ["student@example.com"]
    assert body["reply_to"] == "support@acceptra.ai"
    assert body["subject"] == "Verify your email"
    assert "Acceptra" in body["html"] and "Acceptra" in body["text"]
    assert "token=secret&amp;next=app" in body["html"]
    assert "token=secret&next=app" in body["text"]
    assert "console-only-token" not in request.content.decode()
    assert "secret" not in repr(logs)
    assert "student@example.com" not in repr(logs)


@pytest.mark.parametrize(
    "purpose",
    [
        "verify_email",
        "reset_password",
        "google_signin_help",
        "email_change",
        "password_changed",
        "email_changed",
        "reauthenticate",
    ],
)
async def test_every_template_renders(purpose: Any) -> None:
    def accept(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["html"] and body["text"]
        assert "support@acceptra.ai" in body["text"]
        assert "$" not in body["html"]
        return httpx.Response(200, json={"id": "message-id"})

    await sender(accept).send(
        to="student@example.com",
        subject="Account update",
        purpose=purpose,
        link="https://acceptra.ai/login",
    )


@pytest.mark.parametrize("purpose", ["password_changed", "email_changed"])
async def test_security_notifications_work_without_a_link(purpose: Any) -> None:
    def accept(request: httpx.Request) -> httpx.Response:
        assert 'href="None"' not in json.loads(request.content)["html"]
        return httpx.Response(200, json={"id": "message-id"})

    await sender(accept).send(to="student@example.com", subject="Updated", purpose=purpose)


@pytest.mark.parametrize("status", [301, 401, 422, 429, 503])
async def test_provider_error_does_not_expose_response_or_credentials(status: int) -> None:
    def reject(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, text="SECRET echoed by provider")

    with capture_logs() as logs, pytest.raises(EmailDeliveryError) as failure:
        await sender(reject).send(
            to="student@example.com",
            subject="Reset",
            purpose="reset_password",
            token="SECRET",
            link="https://acceptra.ai/reset?token=SECRET",
        )
    assert "SECRET" not in str(failure.value)
    assert "SECRET" not in repr(logs)
    assert logs[0]["status_code"] == status
    assert logs[0]["error_type"] == "HTTPStatusError"
    assert failure.value.__suppress_context__


@pytest.mark.parametrize("payload", [None, {}, {"id": None}, {"id": ""}, []])
async def test_invalid_success_response_is_a_delivery_failure(payload: Any) -> None:
    with pytest.raises(EmailDeliveryError):
        await sender(lambda request: httpx.Response(200, json=payload)).send(
            to="student@example.com",
            subject="Updated",
            purpose="password_changed",
        )


async def test_network_errors_are_sanitized() -> None:
    def fail(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("SECRET", request=request)

    with pytest.raises(EmailDeliveryError, match="delivery failed") as failure:
        await sender(fail).send(
            to="student@example.com",
            subject="Updated",
            purpose="password_changed",
        )
    assert "SECRET" not in str(failure.value)
    assert failure.value.__suppress_context__


async def test_overall_delivery_deadline_is_bounded() -> None:
    async def slow(request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(1)
        return httpx.Response(200, json={"id": "message-id"})

    with pytest.raises(EmailDeliveryError):
        await sender(slow, timeout=0.01).send(
            to="student@example.com",
            subject="Updated",
            purpose="password_changed",
        )


@pytest.mark.parametrize("link", [None, "javascript:alert(1)", "https:///bad", "//evil.test"])
async def test_action_email_requires_valid_http_link(link: str | None) -> None:
    with pytest.raises(ValueError, match="link"):
        await sender(lambda request: pytest.fail("must not send")).send(
            to="student@example.com",
            subject="Verify",
            purpose="verify_email",
            link=link,
        )


async def test_html_escapes_link_and_subject() -> None:
    def accept(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert "<script>" not in body["html"]
        assert "token=&quot;&gt;&lt;script&gt;" in body["html"]
        return httpx.Response(200, json={"id": "message-id"})

    await sender(accept).send(
        to="student@example.com",
        subject="<script>",
        purpose="verify_email",
        link='https://acceptra.ai/verify?token="><script>',
    )


async def test_console_preserves_development_link_and_token() -> None:
    with capture_logs() as logs:
        await ConsoleEmailSender(email_from="dev@example.com").send(
            to="student@example.com",
            subject="Verify",
            purpose="verify_email",
            token="dev-token",
            link="http://localhost:5173/verify?token=dev-token",
        )
    assert logs[0]["token"] == "dev-token"
    assert logs[0]["link"] == "http://localhost:5173/verify?token=dev-token"


def test_factory_accepts_secretstr_and_console() -> None:
    settings = SimpleNamespace(
        email_provider="resend",
        email_from="accounts@mail.acceptra.ai",
        email_reply_to="support@acceptra.ai",
        resend_api_key=SecretStr("key"),
        email_timeout_seconds=10.0,
    )
    assert isinstance(build_email_sender(settings), ResendEmailSender)
    assert isinstance(
        build_email_sender(
            SimpleNamespace(
                email_provider="console",
                email_from="dev@example.com",
            )
        ),
        ConsoleEmailSender,
    )


@pytest.mark.parametrize("key", [None, "", SecretStr("")])
def test_factory_rejects_missing_key(key: Any) -> None:
    with pytest.raises(ValueError, match="resend_api_key"):
        build_email_sender(SimpleNamespace(email_provider="resend", resend_api_key=key))


def test_factory_rejects_unknown_provider() -> None:
    with pytest.raises(ValueError, match="unsupported"):
        build_email_sender(SimpleNamespace(email_provider="unknown"))
