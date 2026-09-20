#!/usr/bin/env python3
"""Counselle local dev launcher — start and stop the whole stack with one command.

    ./scripts/dev.py            # sync, migrate, start API + frontend, open the app
    ./scripts/dev.py stop       # free the dev ports and exit
    ./scripts/dev.py --check    # validate toolchain + config + ports, then exit
    ./scripts/dev.py reset-db   # nuke and rebuild the local dev database (destructive)

What a normal start does, in order: validate the toolchain (uv, node, npm) and
config (required env), sync locked Python + frontend deps, wake the existing local
database container when needed, apply pending Counselle-schema migrations (local DB
only unless ``--allow-remote-migrations``),
select free ports, start both hot-reloading servers, wait for real health,
prefix their live logs, open the browser, and tear the whole stack down cleanly
on Ctrl+C (or if either server dies).

Backend: ``uv run uvicorn api.main:create_app --factory`` (default :8000).
Frontend: ``npm run dev`` in ``frontend/`` (Vite, default :5173, proxies /v1).
Stdlib only — it shells out to ``uv`` and ``npm``; nothing here imports the app.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from typing import NoReturn
from urllib.parse import unquote, urlsplit

REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIR = REPO_ROOT / "frontend"
MIGRATIONS_DIR = REPO_ROOT / "migrations"
ENV_FILE = REPO_ROOT / ".env"
COMPOSE_FILE = REPO_ROOT / "deploy" / "docker-compose.dev.yml"
SETUP_DB_SQL = REPO_ROOT / "scripts" / "setup_db.sql"
SEED_READER_DB_PY = REPO_ROOT / "scripts" / "seed_reader_db.py"
FACTS_MODULE_MARKER = REPO_ROOT / "app" / "facts" / "__main__.py"

DEFAULT_API_HOST = "127.0.0.1"
DEFAULT_API_PORT = 8000
DEFAULT_WEB_HOST = "localhost"
DEFAULT_WEB_PORT = 5173
DEFAULT_DB_PORT = 5433
COMPOSE_DB_CONTAINER_NAME = "counselle-db-v3"
MIN_NODE = (22, 12)
HEALTH_TIMEOUT_S = 120
PORT_SCAN_LIMIT = 20
SHUTDOWN_GRACE_S = 8
DB_PROBE_TIMEOUT_S = 0.5
DB_START_TIMEOUT_S = 30.0
REQUIRED_ENV = ("COUNSELLE_DB_RO_DSN", "COUNSELLE_DB_APP_DSN", "COUNSELLE_JWT_SECRET")
LOCAL_HOSTS = {"", "localhost", "127.0.0.1", "::1", "0.0.0.0"}


# ---------------------------------------------------------------------------
# Tiny terminal helpers
# ---------------------------------------------------------------------------

_USE_COLOR = sys.stdout.isatty() and os.environ.get("NO_COLOR") is None
_COLORS = {"api": "36", "web": "35", "ok": "32", "warn": "33", "err": "31", "info": "34"}


def _c(text: str, code: str) -> str:
    if not _USE_COLOR:
        return text
    return f"\033[{code}m{text}\033[0m"


def info(msg: str) -> None:
    print(f"{_c('▸', _COLORS['info'])} {msg}", flush=True)


def ok(msg: str) -> None:
    print(f"{_c('✓', _COLORS['ok'])} {msg}", flush=True)


def warn(msg: str) -> None:
    print(f"{_c('!', _COLORS['warn'])} {msg}", flush=True)


def fail(msg: str) -> None:
    print(f"{_c('✗', _COLORS['err'])} {msg}", file=sys.stderr, flush=True)


def die(msg: str, code: int = 1) -> NoReturn:
    fail(msg)
    raise SystemExit(code)


# ---------------------------------------------------------------------------
# Environment (.env) — the launcher reads it itself; yoyo and port logic need it
# ---------------------------------------------------------------------------


def load_env_file() -> dict[str, str]:
    """Parse ``.env`` into a dict (real ``os.environ`` still wins over the file)."""
    values: dict[str, str] = {}
    if not ENV_FILE.exists():
        return values
    for raw in ENV_FILE.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        line = line.removeprefix("export ").strip()
        if "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        if key:
            values[key] = val
    return values


def merged_env(file_env: dict[str, str]) -> dict[str, str]:
    """Child-process env: .env values as the base, real environment overriding."""
    env = {**file_env, **os.environ}
    return env


def env_get(file_env: dict[str, str], key: str) -> str | None:
    return os.environ.get(key) or file_env.get(key) or None


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def check_toolchain() -> None:
    for tool in ("uv", "node", "npm"):
        if shutil.which(tool) is None:
            die(f"'{tool}' is not on PATH — install it before running the dev stack.")
    node_ver = subprocess.run(
        ["node", "--version"], capture_output=True, text=True, check=False
    ).stdout.strip()
    match = re.match(r"v?(\d+)\.(\d+)", node_ver)
    if match:
        got = (int(match.group(1)), int(match.group(2)))
        if got < MIN_NODE:
            die(f"Node {node_ver} is too old — need >= {MIN_NODE[0]}.{MIN_NODE[1]}.")
    ok(f"toolchain: uv, npm, node {node_ver or '?'}")


def check_config(file_env: dict[str, str]) -> None:
    if not ENV_FILE.exists():
        die(".env not found — copy .env.example to .env and fill the required keys.")
    missing = [k for k in REQUIRED_ENV if not env_get(file_env, k)]
    if missing:
        die("missing required env: " + ", ".join(missing) + " (see .env.example)")
    # Authoritative check: let the app's own settings loader validate everything
    # (DSN shape, JWT length, cross-field rules) rather than re-deriving it here.
    proc = subprocess.run(
        [
            "uv",
            "run",
            "--quiet",
            "python",
            "-c",
            "from config.settings import get_settings; get_settings()",
        ],
        cwd=REPO_ROOT,
        env=merged_env(file_env),
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout).strip().splitlines()
        die("config validation failed:\n    " + "\n    ".join(detail[-6:]))
    ok("config: required env present and settings load cleanly")


# ---------------------------------------------------------------------------
# Ports
# ---------------------------------------------------------------------------


def port_free(host: str, port: int) -> bool:
    """Return whether every address used by ``host`` can bind ``port``."""
    addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    checked: set[tuple[int, tuple[object, ...]]] = set()
    for family, socktype, proto, _, address in addresses:
        key = (family, address)
        if key in checked:
            continue
        checked.add(key)
        try:
            with socket.socket(family, socktype, proto) as sock:
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind(address)
        except OSError:
            return False
    return bool(checked)


def free_port(host: str, label: str, desired: int, *, kill: bool) -> int:
    """Return a bindable port for ``desired``: free it with fuser, or scan onward."""
    if port_free(host, desired):
        return desired
    if kill and _fuser_kill(desired):
        time.sleep(0.5)
        if port_free(host, desired):
            warn(f"{label}: freed busy port {desired}")
            return desired
    for candidate in range(desired + 1, desired + 1 + PORT_SCAN_LIMIT):
        if port_free(host, candidate):
            warn(f"{label}: port {desired} busy → using {candidate} instead")
            return candidate
    die(f"{label}: no free port near {desired} (tried {PORT_SCAN_LIMIT}) — free it or pass --kill.")
    raise AssertionError  # unreachable, satisfies type checkers


def _fuser_kill(port: int) -> bool:
    """Free a TCP port with fuser (never pkill-by-pattern — that matches our own shell)."""
    if shutil.which("fuser") is None:
        return False
    subprocess.run(["fuser", "-k", f"{port}/tcp"], capture_output=True, text=True, check=False)
    return True


def stop_stack(host: str, api_port: int, web_port: int) -> None:
    info(f"freeing dev ports {api_port} (api) and {web_port} (web)…")
    if shutil.which("fuser") is None:
        die("fuser not available — cannot free ports automatically on this system.")
    for label, port in (("api", api_port), ("web", web_port)):
        _fuser_kill(port)
        ok(f"{label}: freed :{port}")


# ---------------------------------------------------------------------------
# Sync + migrate
# ---------------------------------------------------------------------------


def sync_deps(file_env: dict[str, str]) -> None:
    info("syncing Python deps (uv sync)…")
    _run_checked(["uv", "sync"], cwd=REPO_ROOT, env=merged_env(file_env), what="uv sync")
    if (FRONTEND_DIR / "node_modules").exists():
        info("syncing frontend deps (npm install)…")
        cmd = ["npm", "install", "--no-audit", "--no-fund"]
    else:
        info("installing frontend deps (npm ci)…")
        cmd = ["npm", "ci", "--no-audit", "--no-fund"]
    _run_checked(cmd, cwd=FRONTEND_DIR, env=merged_env(file_env), what=" ".join(cmd))
    ok("dependencies synced")


def _run_checked(cmd: list[str], *, cwd: Path, env: dict[str, str], what: str) -> None:
    proc = subprocess.run(cmd, cwd=cwd, env=env, check=False)
    if proc.returncode != 0:
        die(f"{what} failed (exit {proc.returncode}).")


def dsn_is_local(dsn: str) -> bool:
    host = (urlsplit(dsn).hostname or "").lower()
    return host in LOCAL_HOSTS


def wait_for_database(dsn: str, timeout: float) -> bool:
    """Wait until the configured Postgres accepts an authenticated connection."""
    deadline = time.monotonic() + timeout
    env = {**os.environ, "COUNSELLE_DEV_DB_DSN": dsn}
    command = [
        "uv",
        "run",
        "--quiet",
        "python",
        "-c",
        (
            "import os, psycopg2; "
            "connection = psycopg2.connect(os.environ['COUNSELLE_DEV_DB_DSN'], connect_timeout=1); "
            "connection.close()"
        ),
    ]
    while True:
        proc = subprocess.run(command, env=env, capture_output=True, text=True, check=False)
        if proc.returncode == 0:
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.4)


def find_container_publishing(port: int) -> tuple[str, str] | None:
    """Return the sole existing Docker container publishing ``port``."""
    proc = subprocess.run(
        ["docker", "ps", "-a", "--filter", f"publish={port}", "--format", "{{.ID}}\t{{.Names}}"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        return None
    matches = [line.split("\t", 1) for line in proc.stdout.splitlines() if "\t" in line]
    if len(matches) != 1:
        return None
    container_id, name = matches[0]
    return container_id, name


def ensure_local_database(file_env: dict[str, str]) -> None:
    """Wake the existing container for a configured local DB when its port is down."""
    app_dsn = env_get(file_env, "COUNSELLE_DB_APP_DSN")
    if not app_dsn or not dsn_is_local(app_dsn):
        return

    parsed = urlsplit(app_dsn)
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 5432
    if wait_for_database(app_dsn, DB_PROBE_TIMEOUT_S):
        ok(f"database ready at {host}:{port}")
        return

    if shutil.which("docker") is None:
        die("local database is down and Docker is not available to start it.")
    container = find_container_publishing(port)
    if container is None:
        die(
            f"local database is not reachable at {host}:{port}, and no single Docker "
            "container publishing that port could be identified."
        )
    container_id, container_name = container

    info(f"starting local database container {container_name}…")
    proc = subprocess.run(
        ["docker", "start", container_id],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout).strip().splitlines()
        suffix = f" ({detail[-1]})" if detail else ""
        die(f"could not start local database container {container_name}{suffix}")
    if not wait_for_database(app_dsn, DB_START_TIMEOUT_S):
        die(f"local database did not become ready at {host}:{port} within {DB_START_TIMEOUT_S:g}s.")
    ok(f"database ready at {host}:{port}")


def apply_migrations(file_env: dict[str, str], *, allow_remote: bool) -> None:
    app_dsn = env_get(file_env, "COUNSELLE_DB_APP_DSN")
    if not app_dsn:
        die("COUNSELLE_DB_APP_DSN is unset — cannot apply migrations.")
    if not dsn_is_local(app_dsn) and not allow_remote:
        warn(
            "COUNSELLE_DB_APP_DSN is not a local database — skipping migrations. "
            "Pass --allow-remote-migrations to run them anyway."
        )
        return
    where = "local" if dsn_is_local(app_dsn) else "REMOTE"
    info(f"applying pending migrations ({where} db) via yoyo…")
    sep = "&" if urlsplit(app_dsn).query else "?"
    database = f"{app_dsn}{sep}schema=counselle"
    _run_checked(
        ["uv", "run", "yoyo", "apply", "--batch", "--database", database, str(MIGRATIONS_DIR)],
        cwd=REPO_ROOT,
        env=merged_env(file_env),
        what="yoyo apply",
    )
    ok("migrations up to date")


def sync_sat_bank(file_env: dict[str, str]) -> None:
    """`python -m app.sat bank-sync` (plan.md §3.2) -- every boot, after
    migrations, mirroring `scripts/entrypoint.sh`. A no-op once the bank
    file's sha256 already matches what's live; app/sat/bank_sync.py never
    fails the boot."""
    info("syncing the SAT question bank (python -m app.sat bank-sync)…")
    _run_checked(
        ["uv", "run", "python", "-m", "app.sat", "bank-sync"],
        cwd=REPO_ROOT,
        env=merged_env(file_env),
        what="app.sat bank-sync",
    )
    ok("sat bank synced")


# ---------------------------------------------------------------------------
# reset-db (school-data-v3, plan §6c / appendix G-iv): the one command that
# ever drops the local dev database. Every other boot path (container/prod
# self-seed via scripts/seed_reader_db.py) only creates-if-missing and
# loads-if-empty.
# ---------------------------------------------------------------------------


def _dsn_password(dsn: str) -> str:
    password = unquote(urlsplit(dsn).password or "")
    if not password:
        die(f"DSN carries no password: {dsn!r}")
    return password


def _run_psql(dsn: str, *, args: list[str], env: dict[str, str], what: str) -> None:
    if shutil.which("psql") is None:
        die("'psql' is not on PATH — required for reset-db.")
    _run_checked(["psql", dsn, "-v", "ON_ERROR_STOP=1", *args], cwd=REPO_ROOT, env=env, what=what)


def _print_grant_verification_summary(admin_dsn: str, file_env: dict[str, str]) -> None:
    """Mirror Phase 0's own DB exit test locally (appendix G-iv step 9)."""
    info("verifying reader/writer grants…")
    script = """
\\echo -- cds_library_reader: must see exactly the six views, denied on every base table
SET ROLE cds_library_reader;
SELECT count(*) AS reader_visible_views FROM information_schema.views
  WHERE table_schema = 'cds_library';
SELECT bool_and(NOT has_table_privilege('cds_library_reader', 'cds_library.' || t, 'SELECT'))
  AS reader_denied_all_base_tables
  FROM unnest(ARRAY['schools','collegedata_schools','page_snapshots','school_pages',
                     'school_facts','school_explore_rows','fact_coverage_counts',
                     'facts_jobs','crawl_runs']) AS t;
RESET ROLE;
\\echo -- cds_library_app: INSERT/SELECT/UPDATE on the eight new tables, SELECT-only on schools
SET ROLE cds_library_app;
SELECT bool_and(has_table_privilege('cds_library_app', 'cds_library.' || t, 'INSERT'))
  AS app_can_insert_all_new_tables
  FROM unnest(ARRAY['collegedata_schools','page_snapshots','school_pages','school_facts',
                     'school_explore_rows','fact_coverage_counts','facts_jobs',
                     'crawl_runs']) AS t;
SELECT has_table_privilege('cds_library_app', 'cds_library.page_snapshots', 'DELETE')
  AS app_can_delete_page_snapshots;
SELECT NOT has_table_privilege('cds_library_app', 'cds_library.schools', 'INSERT')
  AS app_denied_write_on_schools;
RESET ROLE;
"""
    proc = subprocess.run(
        ["psql", admin_dsn, "-v", "ON_ERROR_STOP=1"],
        input=script,
        cwd=REPO_ROOT,
        env=merged_env(file_env),
        text=True,
        capture_output=True,
        check=False,
    )
    print(proc.stdout, end="")
    if proc.returncode != 0:
        warn(f"grant verification query failed: {proc.stderr.strip()}")


def _check_target_container(file_env: dict[str, str]) -> None:
    """Refuse to proceed if port COUNSELLE_DB_PORT is already claimed by a
    container other than the school-data-v3 compose service (finding 4): the
    pre-existing counselle-data-pipeline-db-1 container defaults to the same
    5433 port, and reset-db must not guess which database it just dropped."""
    if shutil.which("docker") is None:
        return
    port = int(env_get(file_env, "COUNSELLE_DB_PORT") or DEFAULT_DB_PORT)
    container = find_container_publishing(port)
    if container is None:
        return
    _container_id, name = container
    if name != COMPOSE_DB_CONTAINER_NAME:
        die(
            f"port {port} is already claimed by container {name!r}, not the "
            f"school-data-v3 container ({COMPOSE_DB_CONTAINER_NAME!r}) — refusing to "
            "reset-db. Stop the other container first (never remove it)."
        )


def reset_db(file_env: dict[str, str], *, allow_remote: bool = False) -> int:
    admin_dsn = env_get(file_env, "COUNSELLE_DB_ADMIN_DSN")
    app_dsn = env_get(file_env, "COUNSELLE_DB_APP_DSN")
    ro_dsn = env_get(file_env, "COUNSELLE_DB_RO_DSN")
    pipeline_dsn = env_get(file_env, "COUNSELLE_DB_PIPELINE_DSN")
    if not admin_dsn:
        die("COUNSELLE_DB_ADMIN_DSN is required for reset-db (see .env.example).")
    if not app_dsn or not ro_dsn:
        die("COUNSELLE_DB_APP_DSN and COUNSELLE_DB_RO_DSN are required for reset-db.")

    for name, dsn in (
        ("COUNSELLE_DB_ADMIN_DSN", admin_dsn),
        ("COUNSELLE_DB_APP_DSN", app_dsn),
        ("COUNSELLE_DB_RO_DSN", ro_dsn),
    ):
        if not dsn_is_local(dsn) and not allow_remote:
            die(
                f"{name} is not a local database — refusing to reset-db, which drops "
                "cds_library and counselle entirely. Pass --allow-remote-reset to run it anyway."
            )

    _check_target_container(file_env)

    warn(
        "about to DROP the cds_library and counselle schemas — every school, account, "
        "session, workspace, and student profile in the local dev database."
    )
    try:
        reply = input("Type 'reset' to continue: ").strip()
    except EOFError:
        reply = ""
    if reply != "reset":
        die("reset-db aborted — confirmation not given.")

    env = merged_env(file_env)

    info(f"bringing up the local dev database container ({COMPOSE_FILE.name})…")
    _run_checked(
        ["docker", "compose", "-f", str(COMPOSE_FILE), "up", "-d", "db"],
        cwd=REPO_ROOT,
        env=env,
        what="docker compose up db",
    )
    if not wait_for_database(admin_dsn, DB_START_TIMEOUT_S):
        die("local dev database did not become ready in time.")
    ok("database container ready")

    warn("dropping cds_library and counselle schemas — the one destructive step…")
    drop_sql = "DROP SCHEMA IF EXISTS cds_library CASCADE; DROP SCHEMA IF EXISTS counselle CASCADE;"
    _run_psql(admin_dsn, args=["-c", drop_sql], env=env, what="drop schemas")
    ok("schemas dropped")

    info("provisioning roles (scripts/setup_db.sql)…")
    setup_env = {
        **env,
        "COUNSELLE_RO_PASSWORD": _dsn_password(ro_dsn),
        "COUNSELLE_APP_PASSWORD": _dsn_password(app_dsn),
    }
    if pipeline_dsn:
        setup_env["COUNSELLE_PIPELINE_PASSWORD"] = _dsn_password(pipeline_dsn)
    _run_psql(admin_dsn, args=["-f", str(SETUP_DB_SQL)], env=setup_env, what="scripts/setup_db.sql")
    ok("roles provisioned")

    info("seeding the cds_library schema + schools (scripts/seed_reader_db.py)…")
    _run_checked(
        ["uv", "run", "python", str(SEED_READER_DB_PY)],
        cwd=REPO_ROOT,
        env=env,
        what="scripts/seed_reader_db.py",
    )
    ok("cds_library seeded")

    # app.facts (the crosswalk loader) lands in Phase 1 — reset-db must stay
    # usable before then, so this step degrades to a warning rather than a
    # hard failure when the module doesn't exist yet.
    if FACTS_MODULE_MARKER.exists():
        info("syncing the CollegeData crosswalk (python -m app.facts crosswalk-sync)…")
        _run_checked(
            ["uv", "run", "python", "-m", "app.facts", "crosswalk-sync"],
            cwd=REPO_ROOT,
            env=env,
            what="app.facts crosswalk-sync",
        )
        ok("crosswalk synced")
    else:
        warn("app.facts is not implemented yet (lands in Phase 1) — skipping crosswalk-sync")

    info("applying counselle migrations from a clean ledger…")
    apply_migrations(file_env, allow_remote=False)
    sync_sat_bank(file_env)

    _print_grant_verification_summary(admin_dsn, file_env)
    ok("reset-db complete")
    return 0


# ---------------------------------------------------------------------------
# Process supervision
# ---------------------------------------------------------------------------


class Server:
    """A supervised child process whose combined output is streamed with a prefix."""

    def __init__(self, label: str, cmd: list[str], *, cwd: Path, env: dict[str, str]) -> None:
        self.label = label
        self.cmd = cmd
        self.cwd = cwd
        self.env = env
        self.proc: subprocess.Popen[str] | None = None
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        # start_new_session=True → the child leads its own process group, so we can
        # signal the whole tree (uvicorn reloader, vite, their children) at once.
        self.proc = subprocess.Popen(
            self.cmd,
            cwd=self.cwd,
            env=self.env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            start_new_session=True,
        )
        self._thread = threading.Thread(target=self._pump, daemon=True)
        self._thread.start()

    def _pump(self) -> None:
        assert self.proc is not None and self.proc.stdout is not None
        tag = _c(f"[{self.label}]", _COLORS.get(self.label, "0"))
        for line in self.proc.stdout:
            print(f"{tag} {line.rstrip()}", flush=True)

    @property
    def alive(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def stop(self) -> None:
        if self.proc is None or self.proc.poll() is not None:
            return
        try:
            os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            return
        try:
            self.proc.wait(timeout=SHUTDOWN_GRACE_S)
        except subprocess.TimeoutExpired:
            with_kill = os.getpgid(self.proc.pid)
            os.killpg(with_kill, signal.SIGKILL)


def wait_for_health(host: str, api_port: int, servers: list[Server]) -> bool:
    url = f"http://{host}:{api_port}/v1/health"
    deadline = time.monotonic() + HEALTH_TIMEOUT_S
    last_note = 0.0
    while time.monotonic() < deadline:
        for server in servers:
            if not server.alive:
                fail(f"{server.label} exited before becoming healthy.")
                return False
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status == 200:
                    return True
                note = f"api not ready (HTTP {resp.status}) — waiting on DB…"
        except (urllib.error.URLError, ConnectionError, OSError):
            note = "api not up yet — waiting…"
        now = time.monotonic()
        if now - last_note > 5:
            info(note)
            last_note = now
        time.sleep(0.5)
    fail(f"api did not become healthy within {HEALTH_TIMEOUT_S}s.")
    return False


def wait_for_tcp(host: str, port: int, timeout: float = 30.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1):
                return True
        except OSError:
            pass
        time.sleep(0.4)
    return False


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------


def run_stack(args: argparse.Namespace, file_env: dict[str, str]) -> int:
    check_toolchain()
    check_config(file_env)

    api_port = free_port(args.host, "api", args.api_port, kill=args.kill)
    web_port = free_port(DEFAULT_WEB_HOST, "web", args.web_port, kill=args.kill)

    if args.check:
        ok("check-only: toolchain, config, and ports all good — not starting servers.")
        return 0

    if not args.no_install:
        sync_deps(file_env)
    ensure_local_database(file_env)
    if not args.no_migrate:
        apply_migrations(file_env, allow_remote=args.allow_remote_migrations)
        sync_sat_bank(file_env)

    base_env = merged_env(file_env)
    api_env = {**base_env, "COUNSELLE_API_HOST": args.host, "COUNSELLE_API_PORT": str(api_port)}
    web_env = {
        **base_env,
        "VITE_DEV_PORT": str(web_port),
        "VITE_API_PROXY_TARGET": f"http://{args.host}:{api_port}",
    }

    api = Server(
        "api",
        [
            "uv",
            "run",
            "uvicorn",
            "api.main:create_app",
            "--factory",
            "--reload",
            "--host",
            args.host,
            "--port",
            str(api_port),
        ],
        cwd=REPO_ROOT,
        env=api_env,
    )
    web = Server(
        "web",
        ["npm", "run", "dev", "--", "--port", str(web_port), "--strictPort"],
        cwd=FRONTEND_DIR,
        env=web_env,
    )
    servers = [api, web]

    stopping = threading.Event()

    def shutdown(*_: object) -> None:
        if stopping.is_set():
            return
        stopping.set()
        print(flush=True)
        info("shutting down the stack…")
        for server in reversed(servers):
            server.stop()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    info(f"starting api on http://{args.host}:{api_port} (hot reload)…")
    api.start()
    info(f"starting frontend on http://localhost:{web_port} …")
    web.start()

    if not wait_for_health(args.host, api_port, servers):
        shutdown()
        return 1
    ok(f"api healthy at http://{args.host}:{api_port}/v1/health")

    if wait_for_tcp(DEFAULT_WEB_HOST, web_port):
        ok(f"frontend live at http://localhost:{web_port}")
    else:
        warn("frontend did not open a port yet — it may still be starting.")

    app_url = f"http://localhost:{web_port}"
    if not args.no_open and not stopping.is_set():
        info(f"opening {app_url}")
        try:
            webbrowser.open(app_url)
        except Exception:
            warn("could not open a browser automatically.")

    if api_port != DEFAULT_API_PORT:
        warn(
            f"api is on {api_port}, not {DEFAULT_API_PORT} — if Google OAuth is enabled, "
            f"register the callback as http://localhost:{api_port}/v1/auth/google/callback"
        )

    ok(f"stack up — open {app_url} · Ctrl+C to stop")

    # Supervise: exit as soon as either server dies (or we were asked to stop).
    while not stopping.is_set():
        for server in servers:
            if not server.alive:
                code = server.proc.returncode if server.proc else "?"
                fail(f"{server.label} exited (code {code}).")
                shutdown()
                break
        time.sleep(0.5)

    for server in servers:
        server.stop()
    ok("stack stopped.")
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="dev.py",
        description="Start and stop the Counselle full-stack dev environment.",
    )
    parser.add_argument(
        "action",
        nargs="?",
        default="start",
        choices=("start", "stop", "reset-db"),
        help=(
            "start the stack (default), stop: free the dev ports and exit, or "
            "reset-db: nuke and rebuild the local dev database (destructive)."
        ),
    )
    parser.add_argument(
        "--host", default=DEFAULT_API_HOST, help="API bind host (default 127.0.0.1)."
    )
    parser.add_argument(
        "--api-port", type=int, default=int(os.environ.get("COUNSELLE_API_PORT", DEFAULT_API_PORT))
    )
    parser.add_argument(
        "--web-port",
        type=int,
        default=DEFAULT_WEB_PORT,
        help="Vite dev-server port (default 5173).",
    )
    parser.add_argument(
        "--check", action="store_true", help="Validate toolchain, config, and ports, then exit."
    )
    parser.add_argument("--no-install", action="store_true", help="Skip dependency sync.")
    parser.add_argument("--no-migrate", action="store_true", help="Skip applying migrations.")
    parser.add_argument("--no-open", action="store_true", help="Do not open a browser.")
    parser.add_argument(
        "--kill",
        action="store_true",
        help="Free a busy target port with fuser instead of picking another.",
    )
    parser.add_argument(
        "--allow-remote-migrations",
        action="store_true",
        help="Permit migrations against a non-local database (off by default).",
    )
    parser.add_argument(
        "--allow-remote-reset",
        action="store_true",
        help="Permit reset-db against a non-local database (off by default).",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    os.chdir(REPO_ROOT)
    file_env = load_env_file()
    if args.action == "stop":
        stop_stack(args.host, args.api_port, args.web_port)
        return 0
    if args.action == "reset-db":
        return reset_db(file_env, allow_remote=args.allow_remote_reset)
    try:
        return run_stack(args, file_env)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
