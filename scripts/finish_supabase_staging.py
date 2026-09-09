#!/usr/bin/env python3
"""Restore the local Counselle dump into Supabase and emit Render env values.

This is intentionally a narrow operator script for the five-user
Render Free + Supabase Free staging target. It never writes secrets to files:
generated role passwords are printed once so the operator can paste them into
Render's secret env vars.
"""

from __future__ import annotations

import argparse
import os
import re
import secrets
import subprocess
import sys
from pathlib import Path
from urllib.parse import ParseResult, quote, unquote, urlparse, urlunparse

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DUMP = ROOT / "artifacts" / "deploy" / "counselle-supabase.dump"
SETUP_SQL = ROOT / "scripts" / "setup_db.sql"

# Matches the password segment of a postgresql://user:password@host DSN so it
# can be masked out of anything that might reach a terminal or CI log.
_DSN_PASSWORD_RE = re.compile(r"(://[^:/@\s]+:)([^@\s]+)(@)")


def _redact(text: str) -> str:
    """Mask any DSN password embedded in ``text`` (CLAUDE.md: never log secrets)."""
    return _DSN_PASSWORD_RE.sub(r"\1***\3", text)


def _run(command: list[str], *, env: dict[str, str] | None = None) -> None:
    """Run a subprocess without letting a DSN's password reach the log on failure.

    Several call sites here pass an admin DSN with an embedded password as a
    bare argument (``pg_restore --dbname``, ``psql``). ``subprocess.run``'s
    default ``check=True`` raises ``CalledProcessError``, whose string form
    includes the full command list -- that would print the live password to
    the terminal or CI log. Capture output instead of letting it stream
    unfiltered, and redact the command and any captured output before
    re-raising.
    """
    result = subprocess.run(command, env=env, capture_output=True, text=True)
    if result.stdout:
        sys.stdout.write(result.stdout)
    if result.returncode != 0:
        sys.stderr.write(_redact(result.stderr))
        redacted_command = [_redact(arg) for arg in command]
        raise subprocess.CalledProcessError(result.returncode, redacted_command)


def _secret_from_env(name: str) -> str:
    value = os.environ.get(name)
    return value if value else secrets.token_urlsafe(32)


def _runtime_user(admin_user: str, role: str) -> str:
    # Supabase pooler usernames are commonly postgres.<project-ref>. Preserve
    # that suffix for runtime roles: counselle_app.<project-ref>.
    if "." in admin_user:
        return f"{role}.{admin_user.split('.', 1)[1]}"
    return role


def _runtime_dsn(admin_dsn: str, *, role: str, password: str) -> str:
    parsed = urlparse(admin_dsn)
    admin_user = unquote(parsed.username or "postgres")
    username = quote(_runtime_user(admin_user, role), safe="")
    encoded_password = quote(password, safe="")
    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    netloc = f"{username}:{encoded_password}@{host}{port}"
    return urlunparse(
        ParseResult(
            scheme=parsed.scheme or "postgresql",
            netloc=netloc,
            path=parsed.path or "/postgres",
            params="",
            query=parsed.query,
            fragment="",
        )
    )


def _psql_scalar(dsn: str, sql: str) -> str:
    result = subprocess.run(
        ["psql", dsn, "-Atqc", sql],
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        sys.stderr.write(_redact(result.stderr))
        raise subprocess.CalledProcessError(
            result.returncode, ["psql", _redact(dsn), "-Atqc", sql]
        )
    return result.stdout.strip()


def _verify_reader(ro_dsn: str) -> None:
    # The six cds_library_reader views (school-data-v3 plan §3.2; the exact
    # grant list lives in deploy/seed/cds_library_schema.sql).
    views = [
        "school_profiles",
        "current_school_facts",
        "school_facts_sql",
        "school_explore",
        "school_data_status",
        "fact_coverage",
    ]
    for view in views:
        count = _psql_scalar(ro_dsn, f"select count(*) from cds_library.{view};")
        print(f"verified cds_library.{view}: {count} rows")

    denied = subprocess.run(
        ["psql", ro_dsn, "-Atqc", "select count(*) from cds_library.schools;"],
        text=True,
        capture_output=True,
    )
    if denied.returncode == 0:
        raise RuntimeError("reader role can select cds_library.schools; expected denial")
    print("verified reader base-table denial")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--admin-dsn",
        default=os.environ.get("SUPABASE_ADMIN_DSN"),
        help="Supabase admin/postgres connection string, or SUPABASE_ADMIN_DSN.",
    )
    parser.add_argument(
        "--dump",
        type=Path,
        default=DEFAULT_DUMP,
        help=f"Custom-format pg_dump archive. Default: {DEFAULT_DUMP}",
    )
    parser.add_argument(
        "--skip-restore",
        action="store_true",
        help="Skip pg_restore and only run role bootstrap/verification.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    if not args.admin_dsn:
        print("SUPABASE_ADMIN_DSN or --admin-dsn is required", file=sys.stderr)
        return 2
    if not args.dump.exists():
        print(f"dump not found: {args.dump}", file=sys.stderr)
        return 2

    ro_password = _secret_from_env("COUNSELLE_RO_PASSWORD")
    app_password = _secret_from_env("COUNSELLE_APP_PASSWORD")
    # cds_library_app (ADR 0038): the facts crawler's write role. Always
    # provisioned with a login password here, matching setup_db.sql's
    # role-always-exists contract -- the crawler is optional at runtime
    # (COUNSELLE_DB_PIPELINE_DSN unset just leaves the worker off), but the
    # role and its DSN are provisioned up front so turning it on later is a
    # flag flip, not another staging bootstrap.
    pipeline_password = _secret_from_env("COUNSELLE_PIPELINE_PASSWORD")

    if not args.skip_restore:
        print(f"restoring {args.dump} into Supabase")
        _run(
            [
                "pg_restore",
                "--exit-on-error",
                "--no-owner",
                "--no-acl",
                "--dbname",
                args.admin_dsn,
                str(args.dump),
            ]
        )

    print("bootstrapping Counselle runtime roles")
    env = {
        **os.environ,
        "COUNSELLE_RO_PASSWORD": ro_password,
        "COUNSELLE_APP_PASSWORD": app_password,
        "COUNSELLE_PIPELINE_PASSWORD": pipeline_password,
    }
    _run(["psql", args.admin_dsn, "-f", str(SETUP_SQL)], env=env)

    ro_dsn = _runtime_dsn(args.admin_dsn, role="counselle_ro", password=ro_password)
    app_dsn = _runtime_dsn(args.admin_dsn, role="counselle_app", password=app_password)
    pipeline_dsn = _runtime_dsn(args.admin_dsn, role="cds_library_app", password=pipeline_password)
    _verify_reader(ro_dsn)

    print("\nRender secret env vars:")
    print(f"COUNSELLE_DB_RO_DSN={ro_dsn}")
    print(f"COUNSELLE_DB_APP_DSN={app_dsn}")
    print(f"COUNSELLE_DB_PIPELINE_DSN={pipeline_dsn}")
    print("  # required at boot under v3 (crosswalk-sync); turning the facts")
    print("  # crawler itself on is the separate COUNSELLE_FACTS_WORKER_ENABLED flag")
    print("\nKeep these out of Git. Paste them into the Render Blueprint secret prompts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
