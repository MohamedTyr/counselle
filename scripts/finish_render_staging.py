#!/usr/bin/env python3
"""Create/update the Render Free web service and verify the staging app.

The script consumes the Supabase runtime DSNs printed by
``finish_supabase_staging.py`` plus the existing model/search keys. It uses the
Render API token from ``RENDER_API_KEY`` or the logged-in Render CLI config.
"""

from __future__ import annotations

import argparse
import json
import os
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
        message = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Render API {method} {path} failed: {exc.code} {message}") from exc
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
            "plan": "free",
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
            "plan": "free",
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
        service = item.get("service", item)
        if service.get("name") == name:
            return service
    return None


def _put_env_vars(token: str, service_id: str, env_vars: list[dict[str, Any]]) -> None:
    _request("PUT", f"/services/{service_id}/env-vars", token=token, body=env_vars)


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
    status = "created"
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
            return response.status
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


def _required_env(dotenv: dict[str, str]) -> list[dict[str, Any]]:
    tavily = _env_value("COUNSELLE_TAVILY_API_KEY", dotenv) or _env_value("TAVILY_API_KEY", dotenv)
    required = {
        "COUNSELLE_DB_RO_DSN": _env_value("COUNSELLE_DB_RO_DSN", dotenv),
        "COUNSELLE_DB_APP_DSN": _env_value("COUNSELLE_DB_APP_DSN", dotenv),
        "COUNSELLE_VERTEX_API_KEY": _env_value("COUNSELLE_VERTEX_API_KEY", dotenv),
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
        "COUNSELLE_AUTH_SELF_SIGNUP_ENABLED": "false",
        "COUNSELLE_PASSWORD_RESET_ENABLED": "false",
        "COUNSELLE_CHECKPOINTER": "postgres",
        "COUNSELLE_SERVE_SPA": "true",
        "COUNSELLE_SPA_DIST_DIR": "/app/frontend/dist",
        "COUNSELLE_API_HOST": "0.0.0.0",
        "COUNSELLE_DB_POOL_MIN": "1",
        "COUNSELLE_DB_POOL_MAX": "5",
        "COUNSELLE_RESPONSE_MODE_THINK_ENABLED": "false",
        "COUNSELLE_THINKING_STREAM": "false",
        "COUNSELLE_JWT_SECRET": _env_value("COUNSELLE_JWT_SECRET", dotenv)
        or secrets.token_urlsafe(48),
        **required,
    }
    return [{"key": key, "value": value} for key, value in fixed.items()]


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner-id", default=DEFAULT_OWNER_ID)
    parser.add_argument("--service-name", default=DEFAULT_SERVICE_NAME)
    parser.add_argument("--repo", default=DEFAULT_REPO)
    parser.add_argument("--branch", default=DEFAULT_BRANCH)
    parser.add_argument("--region", default="oregon")
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

    try:
        env_vars = _required_env(dotenv)
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

    service = _find_service(token, owner_id=args.owner_id, name=args.service_name)
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
            _wait_for_url(url, "/v1/health", 300)
            _wait_for_url(url, "/v1/ready", 300)
            print(f"Render URL: {url}")
        print(f"Render dashboard: {service.get('dashboardUrl')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
