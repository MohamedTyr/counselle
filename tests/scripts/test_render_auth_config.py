"""Remote auth configuration must never inherit a localhost email destination."""

from __future__ import annotations

import io
import os
import urllib.error
from email.message import Message
from pathlib import Path
from typing import Any
from unittest.mock import Mock

import pytest
import yaml

from scripts import finish_render_staging as deploy


@pytest.fixture(autouse=True)
def clean_auth_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in os.environ:
        if key.startswith("COUNSELLE_"):
            monkeypatch.delenv(key)


def _local_values() -> dict[str, str]:
    return {
        "COUNSELLE_AUTH_PUBLIC_URL": "http://localhost:5173",
        "COUNSELLE_EMAIL_PROVIDER": "console",
        "COUNSELLE_RESEND_API_KEY": "fake-local-sending-key",
        "COUNSELLE_JWT_SECRET": "fake-local-signing-key",
        "COUNSELLE_DB_RO_DSN": "postgresql://reader:fake@database.example/db",
        "COUNSELLE_DB_APP_DSN": "postgresql://app:fake@database.example/db",
        "COUNSELLE_DB_ADMIN_DSN": "postgresql://admin:fake@database.example/db",
        "COUNSELLE_DB_PIPELINE_DSN": "postgresql://writer:fake@database.example/db",
        "COUNSELLE_FIREWORKS_API_KEY": "fake-model-key",
        "COUNSELLE_TAVILY_API_KEY": "fake-search-key",
        "COUNSELLE_TRUSTED_PROXY_CIDR": "10.20.0.0/16",
        "COUNSELLE_FACTS_CRAWL_USER_AGENT": "TestBot/1.0 (+https://operator.example/contact)",
        "COUNSELLE_SAT_FETCH_USER_AGENT": "TestBot/1.0 (+https://operator.example/contact)",
    }


def test_remote_origin_and_secrets_win_over_local_dotenv() -> None:
    remote = {
        "COUNSELLE_AUTH_PUBLIC_URL": "https://preview.onrender.com",
        "COUNSELLE_RESEND_API_KEY": "fake-remote-sending-key",
        "COUNSELLE_JWT_SECRET": "fake-remote-signing-key",
        "COUNSELLE_OAUTH_STATE_SECRET": "fake-remote-state-key",
        "COUNSELLE_AUTH_SELF_SIGNUP_ENABLED": "false",
        "COUNSELLE_PASSWORD_RESET_ENABLED": "false",
    }
    values = deploy._auth_env(_local_values(), remote, auth_public_url=None)
    for key, value in remote.items():
        assert values[key] == value
    assert values["COUNSELLE_EMAIL_PROVIDER"] == "resend"


def test_first_create_requires_explicit_origin_even_if_dotenv_has_https() -> None:
    local = {**_local_values(), "COUNSELLE_AUTH_PUBLIC_URL": "https://acceptra.ai"}
    with pytest.raises(RuntimeError, match="--auth-public-url is required"):
        deploy._auth_env(local, {}, auth_public_url=None)


@pytest.mark.parametrize(
    "origin",
    [
        "http://acceptra.ai",
        "https://localhost",
        "https://localhost.",
        "https://127.1",
        "https://[broken",
        "https://acceptra.ai:bad",
        "https://127.0.0.1",
        "https://[::1]",
        "https://10.0.0.1",
        "https://acceptra.ai/login",
        "https://user:secret@acceptra.ai",
        "https://acceptra.ai?token=private",
        "https://acceptra.ai/#fragment",
    ],
)
def test_invalid_remote_origins_are_rejected_without_echoing_values(origin: str) -> None:
    with pytest.raises(RuntimeError) as error:
        deploy._auth_env(_local_values(), {}, auth_public_url=origin)
    assert origin not in str(error.value)


def test_explicit_origin_and_exported_secret_override_remote(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("COUNSELLE_RESEND_API_KEY", "fake-rotated-key")
    remote = {"COUNSELLE_AUTH_PUBLIC_URL": "https://old.onrender.com"}
    result = deploy._auth_env(_local_values(), remote, auth_public_url="https://acceptra.ai/")
    assert result["COUNSELLE_AUTH_PUBLIC_URL"] == "https://acceptra.ai"
    assert result["COUNSELLE_RESEND_API_KEY"] == "fake-rotated-key"
    assert result["COUNSELLE_PASSWORD_RESET_ENABLED"] == "true"


def test_missing_resend_and_partial_google_fail_before_deployment() -> None:
    with pytest.raises(RuntimeError, match="RESEND_API_KEY"):
        deploy._auth_env({}, {}, auth_public_url="https://acceptra.ai")
    with pytest.raises(RuntimeError, match="both client ID and client secret"):
        deploy._auth_env(
            {**_local_values(), "COUNSELLE_GOOGLE_OAUTH_CLIENT_ID": "fake-client"},
            {},
            auth_public_url="https://acceptra.ai",
        )


def test_full_env_builder_includes_email_and_google_config() -> None:
    local = {
        **_local_values(),
        "COUNSELLE_GOOGLE_OAUTH_CLIENT_ID": "fake-client",
        "COUNSELLE_GOOGLE_OAUTH_CLIENT_SECRET": "fake-client-secret",
    }
    result = {
        item["key"]: item["value"]
        for item in deploy._required_env(local, auth_public_url="https://acceptra.ai")
    }
    assert result["COUNSELLE_EMAIL_PROVIDER"] == "resend"
    assert result["COUNSELLE_GOOGLE_OAUTH_CLIENT_ID"] == "fake-client"
    assert result["COUNSELLE_EMAIL_REPLY_TO"] == "support@acceptra.ai"
    assert result["COUNSELLE_JWT_SECRET"] != result["COUNSELLE_OAUTH_STATE_SECRET"]
    for key in RUNTIME_KEYS:
        assert result[key] == local[key]


RUNTIME_KEYS = (
    "COUNSELLE_TRUSTED_PROXY_CIDR",
    "COUNSELLE_FACTS_CRAWL_USER_AGENT",
    "COUNSELLE_SAT_FETCH_USER_AGENT",
)


@pytest.mark.parametrize("key", RUNTIME_KEYS)
def test_runtime_config_is_required_on_first_create(key: str) -> None:
    local = {name: value for name, value in _local_values().items() if name != key}
    with pytest.raises(RuntimeError, match=key):
        deploy._required_env(local, auth_public_url="https://acceptra.ai")


def test_admin_dsn_preserves_remote_and_accepts_explicit_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key = "COUNSELLE_DB_ADMIN_DSN"
    remote = {key: "postgresql://admin:fake-remote@database.example/db"}
    for exported in (False, True):
        if exported:
            monkeypatch.setenv(key, _local_values()[key])
        values = {
            item["key"]: item["value"]
            for item in deploy._required_env(
                _local_values(), remote_env=remote, auth_public_url="https://acceptra.ai"
            )
        }
        assert values[key] == (_local_values()[key] if exported else remote[key])


def test_runtime_config_preserves_remote_and_accepts_explicit_overrides(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    remote = {
        "COUNSELLE_TRUSTED_PROXY_CIDR": "10.30.0.0/16",
        "COUNSELLE_FACTS_CRAWL_USER_AGENT": "RemoteBot/1.0 (+https://operator.example/bot)",
        "COUNSELLE_SAT_FETCH_USER_AGENT": "RemoteBot/1.0 (+https://operator.example/bot)",
    }
    for exported in (False, True):
        if exported:
            for key in RUNTIME_KEYS:
                monkeypatch.setenv(key, _local_values()[key])
        values = {
            item["key"]: item["value"]
            for item in deploy._required_env(
                _local_values(), remote_env=remote, auth_public_url="https://acceptra.ai"
            )
        }
        for key in RUNTIME_KEYS:
            assert values[key] == (_local_values()[key] if exported else remote[key])


@pytest.mark.parametrize(
    "value", ["*", "0.0.0.0/0", "::/0", "10.0.0.0/8,*", "10.0.0.7/24", "invalid", " "]
)
def test_runtime_proxy_rejects_unrestricted_or_invalid_trust(value: str) -> None:
    with pytest.raises(RuntimeError, match="COUNSELLE_TRUSTED_PROXY_CIDR"):
        deploy._required_env(
            {**_local_values(), "COUNSELLE_TRUSTED_PROXY_CIDR": value},
            auth_public_url="https://acceptra.ai",
        )


@pytest.mark.parametrize("key", RUNTIME_KEYS[1:])
@pytest.mark.parametrize("value", ["CounselleBot/1.0 (+https://<domain>/bot)", "Bot/1.0", " "])
def test_runtime_crawler_requires_configured_contact(key: str, value: str) -> None:
    with pytest.raises(RuntimeError, match=key):
        deploy._required_env({**_local_values(), key: value}, auth_public_url="https://acceptra.ai")


@pytest.mark.parametrize("key", (*RUNTIME_KEYS, "COUNSELLE_DB_ADMIN_DSN"))
def test_missing_runtime_config_stops_first_create_before_any_write(
    key: str, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    from types import SimpleNamespace

    monkeypatch.setattr(
        deploy,
        "_parse_args",
        lambda: SimpleNamespace(
            owner_id="owner", service_name="app", auth_public_url="https://acceptra.ai"
        ),
    )
    monkeypatch.setattr(
        deploy, "_load_dotenv", lambda: {k: v for k, v in _local_values().items() if k != key}
    )
    monkeypatch.setattr(deploy, "_render_api_key", lambda values: "fake-api-key")
    request = Mock(return_value=[])
    monkeypatch.setattr(deploy, "_request", request)
    assert deploy.main() == 2
    request.assert_called_once_with(
        "GET",
        "/services",
        token="fake-api-key",
        query={"ownerId": "owner", "name": "app", "type": "web_service"},
    )
    output = capsys.readouterr()
    assert key in output.err
    assert "fake-" not in output.out + output.err


def test_blueprint_prompts_for_auth_origin_and_provider_secrets() -> None:
    config = yaml.safe_load((Path(__file__).parents[2] / "render.yaml").read_text())
    env = {item["key"]: item for item in config["services"][0]["envVars"]}
    for key in (
        "COUNSELLE_AUTH_PUBLIC_URL",
        "COUNSELLE_RESEND_API_KEY",
        "COUNSELLE_GOOGLE_OAUTH_CLIENT_ID",
        "COUNSELLE_GOOGLE_OAUTH_CLIENT_SECRET",
        *RUNTIME_KEYS,
    ):
        assert env[key]["sync"] is False
        assert "value" not in env[key]
    assert env["COUNSELLE_EMAIL_PROVIDER"]["value"] == "resend"
    assert env["COUNSELLE_OAUTH_STATE_SECRET"]["generateValue"] is True


def test_render_error_never_exposes_provider_response_secrets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    error = urllib.error.HTTPError(
        "https://api.render.com", 400, "bad", Message(), io.BytesIO(b'{"echo":"fake-private-key"}')
    )
    monkeypatch.setattr("urllib.request.urlopen", Mock(side_effect=error))
    with pytest.raises(RuntimeError) as raised:
        deploy._request("PUT", "/services/fake/env-vars", token="fake-api-token")
    assert "fake-private-key" not in str(raised.value)
    assert "fake-api-token" not in str(raised.value)
    assert "HTTP 400" in str(raised.value)


def test_dry_run_reads_remote_without_writes_or_secret_output(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    from types import SimpleNamespace

    monkeypatch.setattr(
        deploy,
        "_parse_args",
        lambda: SimpleNamespace(
            owner_id="owner",
            service_name="app",
            repo="repo",
            branch="main",
            dry_run=True,
            auth_public_url=None,
        ),
    )
    monkeypatch.setattr(deploy, "_load_dotenv", _local_values)
    monkeypatch.setattr(deploy, "_render_api_key", lambda values: "fake-api-key")
    monkeypatch.setattr(deploy, "_current_commit", lambda: "abcdef0123456789")
    calls: list[str] = []

    def request(method: str, path: str, **kwargs: Any) -> Any:
        calls.append(method)
        assert method == "GET"
        if path == "/services":
            return [{"service": {"id": "service", "name": "app"}}]
        return [
            {"envVar": {"key": "COUNSELLE_AUTH_PUBLIC_URL", "value": "https://app.onrender.com"}}
        ]

    monkeypatch.setattr(deploy, "_request", request)
    assert deploy.main() == 0
    assert calls == ["GET", "GET"]
    assert "fake-" not in capsys.readouterr().out


def test_paginated_remote_auth_and_unrelated_variables_survive_full_replace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = [
        {
            "envVar": {"key": f"EXISTING_{index}", "value": f"value-{index}"},
            "cursor": f"cursor-{index}",
        }
        for index in range(20)
    ]
    later_values = {
        "COUNSELLE_AUTH_PUBLIC_URL": "https://existing.onrender.com",
        "COUNSELLE_RESEND_API_KEY": "fake-remote-key",
        "COUNSELLE_JWT_SECRET": "fake-remote-jwt",
        "COUNSELLE_AUTH_SELF_SIGNUP_ENABLED": "false",
        "LATE_UNRELATED": "preserved",
    }
    second = [
        {"envVar": {"key": key, "value": value}, "cursor": f"late-{index}"}
        for index, (key, value) in enumerate(later_values.items())
    ]
    writes: list[Any] = []

    def request(method: str, path: str, **kwargs: Any) -> Any:
        if method == "PUT":
            writes.append(kwargs["body"])
            return None
        cursor = kwargs["query"].get("cursor")
        return first if cursor is None else second if cursor == "cursor-19" else []

    monkeypatch.setattr(deploy, "_request", request)
    remote = {item["key"]: item["value"] for item in deploy._get_env_vars("fake-token", "service")}
    auth = deploy._auth_env(_local_values(), remote, auth_public_url=None)
    assert auth["COUNSELLE_RESEND_API_KEY"] == "fake-remote-key"
    assert auth["COUNSELLE_JWT_SECRET"] == "fake-remote-jwt"
    assert auth["COUNSELLE_AUTH_SELF_SIGNUP_ENABLED"] == "false"
    deploy._put_env_vars(
        "fake-token", "service", [{"key": key, "value": value} for key, value in auth.items()]
    )
    assert len(writes) == 1
    merged = {item["key"]: item["value"] for item in writes[0]}
    assert merged["LATE_UNRELATED"] == "preserved"
    assert all(merged[f"EXISTING_{index}"] == f"value-{index}" for index in range(20))
