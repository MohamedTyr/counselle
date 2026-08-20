#!/usr/bin/env python3
"""Bootstrap the staging database on first boot.

Render's managed Postgres starts out empty, so the container provisions it
itself rather than depending on an operator's laptop: create the cds_library
reader contract (ADR 0012), load the seed extract shipped in ``deploy/seed``,
and reconcile the ``counselle_app`` / ``counselle_ro`` roles that the runtime
DSNs authenticate as (ADR 0019, ADR 0032).

Idempotent: a database that already holds the reader contract is left alone,
so this costs two cheap queries on every warm start. Requires an admin DSN
because neither runtime role may create schemas or roles.
"""

from __future__ import annotations

import gzip
import os
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
SEED_DIR = ROOT / "deploy" / "seed"
SCHEMA_FILE = SEED_DIR / "schema.sql"

# Migrations declare these, but installing an extension needs CREATE on the
# database, which the unprivileged app role deliberately lacks. Install them
# here so the migration's IF NOT EXISTS becomes a no-op.
REQUIRED_EXTENSIONS = ("pg_trgm", "vector")

# Load order is free: the reader contract is denormalised and carries no
# foreign keys between these five surfaces.
READER_TABLES = (
    "active_cds_documents",
    "active_cds_domain_packets",
    "cds_document_sources",
    "cds_manifest_snapshots",
    "school_profiles",
)


def _credentials(dsn_env: str, expected_role: str) -> tuple[str, str]:
    """Read the role name and password the runtime will authenticate with."""
    dsn = os.environ.get(dsn_env, "")
    if not dsn:
        raise SystemExit(f"missing required environment variable: {dsn_env}")
    parsed = urlparse(dsn)
    user = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    if not user or not password:
        raise SystemExit(f"{dsn_env} must carry both a username and a password")
    # Supabase-style "role.tenant" usernames collapse back to the bare role.
    role = user.split(".", 1)[0]
    if role != expected_role:
        raise SystemExit(f"{dsn_env} must authenticate as {expected_role}, got {role}")
    return role, password


def _ensure_role(cur: psycopg.Cursor, role: str, password: str | None) -> None:
    cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,))
    if cur.fetchone() is None:
        cur.execute(
            sql.SQL(
                "CREATE ROLE {} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION"
            ).format(sql.Identifier(role))
        )
    login = sql.SQL("LOGIN") if password else sql.SQL("NOLOGIN")
    cur.execute(sql.SQL("ALTER ROLE {} {}").format(sql.Identifier(role), login))
    if password:
        cur.execute(
            sql.SQL("ALTER ROLE {} PASSWORD {}").format(
                sql.Identifier(role), sql.Literal(password)
            )
        )


def _reader_contract_is_loaded(cur: psycopg.Cursor) -> bool:
    cur.execute("SELECT to_regclass('cds_library.school_profiles') IS NOT NULL")
    if not cur.fetchone()[0]:
        return False
    cur.execute("SELECT EXISTS (SELECT 1 FROM cds_library.school_profiles)")
    return bool(cur.fetchone()[0])


def _load_reader_contract(cur: psycopg.Cursor) -> None:
    cur.execute(SCHEMA_FILE.read_text(encoding="utf-8"))
    for table in READER_TABLES:
        archive = SEED_DIR / f"{table}.csv.gz"
        if not archive.exists():
            raise SystemExit(f"missing seed archive: {archive}")
        target = sql.Identifier("cds_library", table)
        # Reached only on an unseeded or half-seeded database, so clearing first
        # keeps a retry after an interrupted load from doubling up rows.
        cur.execute(sql.SQL("TRUNCATE {}").format(target))
        statement = sql.SQL("COPY {} FROM STDIN WITH (FORMAT csv)").format(target)
        with cur.copy(statement) as copy, gzip.open(archive, "rb") as source:
            while chunk := source.read(1 << 20):
                copy.write(chunk)
        print(f"seeded cds_library.{table}", flush=True)


def _grant_reader_contract(cur: psycopg.Cursor, database: str, ro_role: str) -> None:
    cur.execute("GRANT USAGE ON SCHEMA cds_library TO cds_library_reader")
    cur.execute(
        sql.SQL("GRANT SELECT ON {} TO cds_library_reader").format(
            sql.SQL(", ").join(
                sql.Identifier("cds_library", table) for table in READER_TABLES
            )
        )
    )
    cur.execute(
        sql.SQL("GRANT cds_library_reader TO {}").format(sql.Identifier(ro_role))
    )
    # Read-only is enforced by the session default, not just by the grants.
    cur.execute(
        sql.SQL("ALTER ROLE {} SET default_transaction_read_only = on").format(
            sql.Identifier(ro_role)
        )
    )
    cur.execute(
        sql.SQL("ALTER ROLE {} IN DATABASE {} SET search_path = cds_library, pg_catalog").format(
            sql.Identifier(ro_role), sql.Identifier(database)
        )
    )


def _prepare_app_schema(cur: psycopg.Cursor, database: str, app_role: str) -> None:
    # Assigning ownership requires membership in the target role, and a managed
    # provider's auto-grant to the admin user arrives with SET disabled.
    cur.execute(
        sql.SQL("GRANT {} TO CURRENT_USER WITH SET TRUE").format(
            sql.Identifier(app_role)
        )
    )
    cur.execute(
        sql.SQL("CREATE SCHEMA IF NOT EXISTS counselle AUTHORIZATION {}").format(
            sql.Identifier(app_role)
        )
    )
    cur.execute(
        sql.SQL("ALTER SCHEMA counselle OWNER TO {}").format(sql.Identifier(app_role))
    )
    cur.execute(
        sql.SQL("ALTER ROLE {} IN DATABASE {} SET search_path = counselle, pg_catalog").format(
            sql.Identifier(app_role), sql.Identifier(database)
        )
    )
    for extension in REQUIRED_EXTENSIONS:
        cur.execute(
            sql.SQL("CREATE EXTENSION IF NOT EXISTS {}").format(
                sql.Identifier(extension)
            )
        )


def main() -> int:
    admin_dsn = os.environ.get("COUNSELLE_DB_ADMIN_DSN", "")
    if not admin_dsn:
        print("COUNSELLE_DB_ADMIN_DSN unset; skipping database bootstrap", flush=True)
        return 0

    app_role, app_password = _credentials("COUNSELLE_DB_APP_DSN", "counselle_app")
    ro_role, ro_password = _credentials("COUNSELLE_DB_RO_DSN", "counselle_ro")

    with psycopg.connect(admin_dsn, autocommit=True) as conn, conn.cursor() as cur:
        cur.execute("SELECT current_database()")
        database = cur.fetchone()[0]

        _ensure_role(cur, app_role, app_password)
        _ensure_role(cur, ro_role, ro_password)
        _ensure_role(cur, "cds_library_reader", None)
        _prepare_app_schema(cur, database, app_role)

        if _reader_contract_is_loaded(cur):
            print("cds_library reader contract already present", flush=True)
        else:
            print("seeding cds_library reader contract", flush=True)
            _load_reader_contract(cur)

        _grant_reader_contract(cur, database, ro_role)

    print("database bootstrap complete", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
