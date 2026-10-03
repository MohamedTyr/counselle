#!/usr/bin/env python3
"""Create/update the Render web service and verify the staging app.

The script consumes the Supabase runtime DSNs printed by
``finish_supabase_staging.py`` plus the existing model/search keys. It uses the
Render API token from ``RENDER_API_KEY`` or the logged-in Render CLI config.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
RENDER_API = "https://api.render.com/v1"
DEFAULT_OWNER_ID = "tea-d9hruev41pts73bf2gng"
DEFAULT_REPO = "https://github.com/MohamedTyr/counselle"
DEFAULT_BRANCH = "deploy/render-demo"
DEFAULT_SERVICE_NAME = "counselle"
TERMINAL_DEPLOY_STATUSES = {
    "live",
    "deactivated",
    "build_failed",
    "update_failed",
    "canceled",
    "pre_deploy_failed",
}


def _load_dotenv() -> dict[str, str]:
    values: dict[str, str] = {}
    env_path = ROOT / ".env"
    if not env_path.exists():
        return values
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value.strip().strip('"').strip("'")
    return values


def _env_value(name: str, dotenv: dict[str, str], *, fallback: str | None = None) -> str | None:
    return os.environ.get(name) or dotenv.get(name) or fallback


def _render_cli_value(key: str) -> str | None:
    path = Path.home() / ".render" / "cli.yaml"
    if not path.exists():
        return None
    parent = ""
    for raw in path.read_text(encoding="utf-8").splitlines():
        if not raw.strip():
            continue
        if not raw.startswith(" ") and raw.rstrip().endswith(":"):
            parent = raw.split(":", 1)[0].strip()
            continue
        if ":" not in raw:
            continue
        name, value = raw.split(":", 1)
        compound = f"{parent}.{name.strip()}" if raw.startswith(" ") else name.strip()
        if compound == key:
            return value.strip().strip('"').strip("'")
    return None


def _render_api_key(dotenv: dict[str, str]) -> str | None:
    return _env_value("RENDER_API_KEY", dotenv) or _render_cli_value("api.key")


def _request(
    method: str,
    path: str,
    *,
    token: str,
    body: Any | None = None,
    query: dict[str, str] | None = None,
) -> Any:
    url = f"{RENDER_API}{path}"
    if query:
        url = f"{url}?{urllib.parse.urlencode(query)}"
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "counselle-render-staging/1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = response.read()
    except urllib.error.HTTPError as exc:
        # Provider error bodies can echo submitted environment secrets.
        raise RuntimeError(f"Render API {method} {path} failed: HTTP {exc.code}") from None
    if not payload:
        return None
    return json.loads(payload.decode("utf-8"))


def _service_payload(args: argparse.Namespace, env_vars: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "type": "web_service",
        "name": args.service_name,
        "ownerId": args.owner_id,
        "repo": args.repo,
        "branch": args.branch,
        "autoDeploy": "yes",
        "envVars": env_vars,
        "serviceDetails": {
            "runtime": "docker",
            "plan": args.plan,
            "region": args.region,
            "healthCheckPath": "/v1/health",
            "envSpecificDetails": {
                "dockerContext": ".",
                "dockerfilePath": "./Containerfile",
            },
        },
    }


def _service_patch(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "repo": args.repo,
        "branch": args.branch,
        "autoDeploy": "yes",
        "serviceDetails": {
            "runtime": "docker",
            "plan": args.plan,
            "healthCheckPath": "/v1/health",
            "envSpecificDetails": {
                "dockerContext": ".",
                "dockerfilePath": "./Containerfile",
            },
        },
    }


def _find_service(token: str, *, owner_id: str, name: str) -> dict[str, Any] | None:
    results = _request(
        "GET",
        "/services",
        token=token,
        query={"ownerId": owner_id, "name": name, "type": "web_service"},
    )
    for item in results or []:
        service: dict[str, Any] = item.get("service", item)
        if service.get("name") == name:
            return service
    return None


def _get_env_vars(token: str, service_id: str) -> list[dict[str, Any]]:
    values: list[dict[str, Any]] = []
    cursor: str | None = None
    while True:
        query = {"limit": "100"}
        if cursor:
            query["cursor"] = cursor
        page = _request("GET", f"/services/{service_id}/env-vars", token=token, query=query)
        if not page:
            return values
        values.extend(item.get("envVar", item) for item in page)
        next_cursor = page[-1].get("cursor")
        if not next_cursor:
            return values
        if next_cursor == cursor:
            raise RuntimeError("Render env-var pagination did not advance")
        cursor = next_cursor


def _put_env_vars(token: str, service_id: str, env_vars: list[dict[str, Any]]) -> None:
    """Merge onto the service's existing env vars, then replace the set.

    The Render API's env-vars PUT is a full replace, not a patch: it drops
    any variable not present in the body. A bare PUT of this script's fixed
    dict would silently delete every var set out-of-band (dashboard secrets
    like a rotated `COUNSELLE_DB_ADMIN_DSN`, an operator's one-off flag), on
    every re-run. Reading the current set first and letting this script's
    keys win keeps everything else intact.
    """
    current = {item["key"]: item.get("value", "") for item in _get_env_vars(token, service_id)}
    current.update({item["key"]: item["value"] for item in env_vars})
    merged = [{"key": key, "value": value} for key, value in current.items()]
    _request("PUT", f"/services/{service_id}/env-vars", token=token, body=merged)


def _current_commit() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
    )
    return result.stdout.strip()


def _wait_for_deploy(token: str, service_id: str, deploy_id: str, timeout_s: int) -> str:
    deadline = time.monotonic() + timeout_s
    status: str = "created"
    while time.monotonic() < deadline:
        deploy = _request("GET", f"/services/{service_id}/deploys/{deploy_id}", token=token)
        status = deploy.get("status", "unknown")
        print(f"deploy {deploy_id}: {status}")
        if status in TERMINAL_DEPLOY_STATUSES:
            return status
        time.sleep(15)
    raise TimeoutError(f"deploy {deploy_id} did not finish within {timeout_s}s")


def _http_status(url: str) -> int:
    request = urllib.request.Request(url, headers={"User-Agent": "counselle-render-staging/1"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            status: int = response.status
            return status
    except urllib.error.HTTPError as exc:
        return exc.code


def _wait_for_url(base_url: str, path: str, timeout_s: int) -> None:
    deadline = time.monotonic() + timeout_s
    url = base_url.rstrip("/") + path
    last_status = 0
    while time.monotonic() < deadline:
        try:
            last_status = _http_status(url)
        except Exception:
            last_status = 0
        if last_status == 200:
            print(f"verified {url}: 200")
            return
        time.sleep(10)
    raise TimeoutError(f"{url} did not return 200; last status {last_status}")


def _remote_auth_origin(value: str | None) -> str:
    import ipaddress

    if not value:
        raise RuntimeError(
            "--auth-public-url is required when the remote service has no auth origin"
        )
    try:
        parts = urlparse(value)
        host = (parts.hostname or "").rstrip(".").lower()
        _ = parts.port
    except ValueError:
        raise RuntimeError(
            "--auth-public-url must be a public HTTPS origin without a path"
        ) from None
    try:
        private_ip = not ipaddress.ip_address(host).is_global
    except ValueError:
        private_ip = bool(host) and all(character in "0123456789." for character in host)
    if (
        parts.scheme != "https"
        or any(character.isspace() for character in value)
        or not host
        or parts.username
        or parts.password
        or parts.path not in {"", "/"}
        or parts.params
        or parts.query
        or parts.fragment
        or host in {"localhost", "0.0.0.0"}
        or host.endswith((".localhost", ".local"))
        or private_ip
    ):
        raise RuntimeError("--auth-public-url must be a public HTTPS origin without a path")
    return value.rstrip("/")


def _auth_env(
    dotenv: dict[str, str], remote: dict[str, str], *, auth_public_url: str | None
) -> dict[str, str]:
    """Preserve remote auth configuration; local dev URLs never enter deployments."""
    origin = _remote_auth_origin(auth_public_url or remote.get("COUNSELLE_AUTH_PUBLIC_URL"))

    def configured(key: str, default: str = "") -> str:
        return os.environ.get(key) or remote.get(key) or dotenv.get(key) or default

    values = {
        "COUNSELLE_AUTH_PUBLIC_URL": origin,
        "COUNSELLE_EMAIL_PROVIDER": "resend",
        "COUNSELLE_EMAIL_FROM": configured(
            "COUNSELLE_EMAIL_FROM", "Acceptra <accounts@mail.acceptra.ai>"
        ),
        "COUNSELLE_EMAIL_REPLY_TO": configured("COUNSELLE_EMAIL_REPLY_TO", "support@acceptra.ai"),
        "COUNSELLE_SUPPORT_EMAIL": configured("COUNSELLE_SUPPORT_EMAIL", "support@acceptra.ai"),
        "COUNSELLE_RESEND_API_KEY": configured("COUNSELLE_RESEND_API_KEY"),
        "COUNSELLE_JWT_SECRET": configured("COUNSELLE_JWT_SECRET") or secrets.token_urlsafe(48),
        "COUNSELLE_OAUTH_STATE_SECRET": configured("COUNSELLE_OAUTH_STATE_SECRET")
        or secrets.token_urlsafe(48),
    }
    if not values["COUNSELLE_RESEND_API_KEY"].strip():
        raise RuntimeError("COUNSELLE_RESEND_API_KEY is required for deployed authentication")
    if values["COUNSELLE_JWT_SECRET"] == values["COUNSELLE_OAUTH_STATE_SECRET"]:
        raise RuntimeError("COUNSELLE_OAUTH_STATE_SECRET must differ from COUNSELLE_JWT_SECRET")
    # Never replace intentionally closed staging gates with a developer's .env.
    for key in ("COUNSELLE_AUTH_SELF_SIGNUP_ENABLED", "COUNSELLE_PASSWORD_RESET_ENABLED"):
        values[key] = os.environ.get(key) or remote.get(key) or "true"
    google = {
        key: configured(key)
        for key in ("COUNSELLE_GOOGLE_OAUTH_CLIENT_ID", "COUNSELLE_GOOGLE_OAUTH_CLIENT_SECRET")
    }
    if any(google.values()) and not all(google.values()):
        raise RuntimeError("Google OAuth requires both client ID and client secret")
    values.update({key: value for key, value in google.items() if value})
    return values


def _required_env(
    dotenv: dict[str, str],
    *,
    remote_env: dict[str, str] | None = None,
    auth_public_url: str | None = None,
) -> list[dict[str, Any]]:
    tavily = _env_value("COUNSELLE_TAVILY_API_KEY", dotenv) or _env_value("TAVILY_API_KEY", dotenv)
    required = {
        "COUNSELLE_DB_RO_DSN": _env_value("COUNSELLE_DB_RO_DSN", dotenv),
        "COUNSELLE_DB_APP_DSN": _env_value("COUNSELLE_DB_APP_DSN", dotenv),
        # The entrypoint seeds roles/schema before migrations on every boot.
        # Keep a remotely rotated admin credential ahead of the local .env.
        "COUNSELLE_DB_ADMIN_DSN": os.environ.get("COUNSELLE_DB_ADMIN_DSN")
        or (remote_env or {}).get("COUNSELLE_DB_ADMIN_DSN")
        or dotenv.get("COUNSELLE_DB_ADMIN_DSN"),
        # Required at boot under v3, not just for the facts crawler:
        # scripts/entrypoint.sh's required_env list hard-fails with exit 1
        # if this is empty (the crosswalk-sync step needs it). Enforcing it
        # here fails this script fast instead of deploying a Render service
        # that crash-loops on every boot (docs/DEPLOY.md § environment matrix).
        "COUNSELLE_DB_PIPELINE_DSN": _env_value("COUNSELLE_DB_PIPELINE_DSN", dotenv),
        "COUNSELLE_FIREWORKS_API_KEY": _env_value("COUNSELLE_FIREWORKS_API_KEY", dotenv),
        "COUNSELLE_TAVILY_API_KEY": tavily,
    }
    missing = [key for key, value in required.items() if not value]
    if missing:
        raise RuntimeError(
            "missing required env vars: "
            + ", ".join(missing)
            + ". Run finish_supabase_staging.py first and export its DSNs."
        )
    for key in ("COUNSELLE_DB_RO_DSN", "COUNSELLE_DB_APP_DSN"):
        host = urlparse(required[key] or "").hostname
        if host in {"127.0.0.1", "localhost", "0.0.0.0"}:
            raise RuntimeError(
                f"{key} points at local host {host}; export the Supabase DSN printed by "
                "finish_supabase_staging.py before deploying to Render."
            )

    fixed = {
        "COUNSELLE_ENVIRONMENT": "staging",
        "COUNSELLE_COOKIE_SECURE": "true",
        "COUNSELLE_CHECKPOINTER": "postgres",
        "COUNSELLE_SERVE_SPA": "true",
        "COUNSELLE_SPA_DIST_DIR": "/app/frontend/dist",
        "COUNSELLE_API_HOST": "0.0.0.0",
        "COUNSELLE_DB_POOL_MIN": "1",
        "COUNSELLE_DB_POOL_MAX": "5",
        "COUNSELLE_RESPONSE_MODE_THINK_ENABLED": "false",
        "COUNSELLE_THINKING_STREAM": "false",
        # The parked CDS extraction poller must never run against the
        # facts-store schema (config/settings.py's cds_worker_enabled
        # docstring) -- set explicitly rather than relying on its default.
        "COUNSELLE_CDS_WORKER_ENABLED": "false",
        # The facts crawler is off by default even on a paid, always-on
        # instance (school-data-v3 plan §8 Q9): turning it on is a
        # deliberate step after staging verification, not a side effect of
        # this script's other env plumbing.
        "COUNSELLE_FACTS_WORKER_ENABLED": _env_value(
            "COUNSELLE_FACTS_WORKER_ENABLED", dotenv, fallback="false"
        ),
        **required,
        **_runtime_env(dotenv, remote_env or {}),
        **_auth_env(dotenv, remote_env or {}, auth_public_url=auth_public_url),
    }
    return [{"key": key, "value": value} for key, value in fixed.items()]


def _runtime_env(dotenv: dict[str, str], remote: dict[str, str]) -> dict[str, str]:
    """Validate operator-supplied boot requirements before any provider write."""
    keys = (
        "COUNSELLE_TRUSTED_PROXY_CIDR",
        "COUNSELLE_FACTS_CRAWL_USER_AGENT",
        "COUNSELLE_SAT_FETCH_USER_AGENT",
    )
    values = {
        key: (os.environ.get(key) or remote.get(key) or dotenv.get(key) or "").strip()
        for key in keys
    }
    missing = [key for key, value in values.items() if not value]
    if missing:
        raise RuntimeError(
            "missing required deployment env vars: "
            + ", ".join(missing)
            + ". Set the platform's trusted proxy CIDR and each crawler's real contact URL."
        )
    try:
        networks = [ipaddress.ip_network(part.strip()) for part in values[keys[0]].split(",")]
    except ValueError:
        raise RuntimeError(
            "COUNSELLE_TRUSTED_PROXY_CIDR must contain platform proxy IPs or network-aligned CIDRs"
        ) from None
    if any(network.prefixlen == 0 for network in networks):
        raise RuntimeError("COUNSELLE_TRUSTED_PROXY_CIDR must not trust the entire internet")
    for key in keys[1:]:
        if "<domain>" in values[key] or not re.search(r"https?://\S+", values[key]):
            raise RuntimeError(f"{key} must identify your real contact URL, without placeholders")
    return values


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-id", default=DEFAULT_OWNER_ID)
    parser.add_argument("--service-name", default=DEFAULT_SERVICE_NAME)
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--branch", default=DEFAULT_BRANCH)
    parser.add_argument("--region", default="oregon")
    parser.add_argument(
        "--auth-public-url",
        help="Exact HTTPS app origin. Required on first create; otherwise retains remote value.",
    )
    parser.add_argument(
        "--plan",
        default="0.5c-512mb",
        help=(
            "Render compute plan id (render.yaml's committed default is the "
            "paid, always-on 0.5c-512mb tier -- a free instance sleeps and "
            "never runs the facts crawl worker)."
        ),
    )
    parser.add_argument("--wait", action="store_true", help="Wait for deploy and verify URLs.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate inputs without API writes.",
    )
    parser.add_argument("--timeout-s", type=int, default=1200)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    dotenv = _load_dotenv()
    token = _render_api_key(dotenv)
    if not token:
        print("RENDER_API_KEY or logged-in Render CLI config is required", file=sys.stderr)
        return 2

    service = _find_service(token, owner_id=args.owner_id, name=args.service_name)
    remote_env = (
        {item["key"]: item.get("value", "") for item in _get_env_vars(token, service["id"])}
        if service
        else {}
    )
    try:
        env_vars = _required_env(
            dotenv, remote_env=remote_env, auth_public_url=args.auth_public_url
        )
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    commit = _current_commit()
    if args.dry_run:
        print(
            f"would create/update Render service {args.service_name!r} "
            f"from {args.repo}@{args.branch} commit {commit[:12]}"
        )
        print(f"would set {len(env_vars)} env vars")
        return 0

    if service is None:
        print(f"creating Render service {args.service_name}")
        created = _request(
            "POST",
            "/services",
            token=token,
            body=_service_payload(args, env_vars),
        )
        service = created.get("service", created)
    else:
        print(f"updating Render service {service['id']}")
        _request("PATCH", f"/services/{service['id']}", token=token, body=_service_patch(args))
        _put_env_vars(token, service["id"], env_vars)

    service_id = service["id"]
    deploy = _request(
        "POST",
        f"/services/{service_id}/deploys",
        token=token,
        body={"commitId": commit, "clearCache": "do_not_clear"},
    )
    deploy_id = deploy["id"]
    print(f"triggered deploy {deploy_id} for service {service_id}")

    if args.wait:
        status = _wait_for_deploy(token, service_id, deploy_id, args.timeout_s)
        if status != "live":
            raise RuntimeError(f"deploy ended with status {status}")
        service = _request("GET", f"/services/{service_id}", token=token)
        details = service.get("serviceDetails", {})
        url = details.get("url")
        if url:
            # There is no separate /v1/ready route -- /v1/health is the one
            # liveness/readiness endpoint the app exposes (api/routes/system.py).
            _wait_for_url(url, "/v1/health", 300)
            print(f"Render URL: {url}")
        print(f"Render dashboard: {service.get('dashboardUrl')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
