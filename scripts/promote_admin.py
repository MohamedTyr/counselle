#!/usr/bin/env python3
"""Flip ``counselle.users.is_superuser`` for a user by email (plan §D1).

    uv run python scripts/promote_admin.py --email a@b.c            # grant
    uv run python scripts/promote_admin.py --email a@b.c --revoke   # revoke

No route, no UI, no RBAC table — ``is_superuser`` is a flat boolean and this
is the only way to set it today (`api.auth.current_superuser` gates the CDS
admin router, ADR 0032 recon §2). Connects with ``settings.db_app_dsn``
(``counselle_app`` role, owns ``counselle.*``); parameterized SQL only.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

import asyncpg

from config.settings import get_settings

_UPDATE_SQL = """
    UPDATE counselle.users
    SET is_superuser = $1
    WHERE email = $2
    RETURNING id, email, is_superuser
"""


async def promote(email: str, *, grant: bool) -> int:
    settings = get_settings()
    conn = await asyncpg.connect(settings.db_app_dsn)
    try:
        row = await conn.fetchrow(_UPDATE_SQL, grant, email)
    finally:
        await conn.close()

    if row is None:
        print(f"No user found with email {email!r}", file=sys.stderr)
        return 1

    action = "granted" if grant else "revoked"
    print(f"is_superuser {action} for {row['email']} (id={row['id']})")
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--email", required=True, help="the user's account email")
    parser.add_argument(
        "--revoke", action="store_true", help="revoke superuser instead of granting it"
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    return asyncio.run(promote(args.email, grant=not args.revoke))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
