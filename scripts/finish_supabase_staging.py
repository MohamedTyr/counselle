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
import secrets
import subprocess
import sys
from pathlib import Path
from urllib.parse import ParseResult, quote, unquote, urlparse, urlunparse

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DUMP = ROOT / "artifacts" / "deploy" / "counselle-supabase.dump"
SETUP_SQL = ROOT / "scripts" / "setup_db.sql"


def _run(command: list[str], *, env: dict[str, str] | None = None) -> None:
    subprocess.run(command, check=True, env=env)


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
        check=True,
        text=True,
        capture_output=True,
    )
    return result.stdout.strip()


def _verify_reader(ro_dsn: str) -> None:
    views = [
        "school_profiles",
        "active_cds_documents",
        "active_cds_domain_packets",
        "cds_document_sources",
        "cds_manifest_snapshots",
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
    }
    _run(["psql", args.admin_dsn, "-f", str(SETUP_SQL)], env=env)

    ro_dsn = _runtime_dsn(args.admin_dsn, role="counselle_ro", password=ro_password)
    app_dsn = _runtime_dsn(args.admin_dsn, role="counselle_app", password=app_password)
    _verify_reader(ro_dsn)

    print("\nRender secret env vars:")
    print(f"COUNSELLE_DB_RO_DSN={ro_dsn}")
    print(f"COUNSELLE_DB_APP_DSN={app_dsn}")
    print("\nKeep these out of Git. Paste them into the Render Blueprint secret prompts.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
