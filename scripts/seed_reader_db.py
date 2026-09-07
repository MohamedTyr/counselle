#!/usr/bin/env python3
"""Bootstrap the database on every boot (school-data-v3, plan §6c/appendix G-i).

Render's managed Postgres starts out empty, so the container provisions it
itself rather than depending on an operator's laptop. Under v3 this script
owns three independently-idempotent, always-run phases, run in order on
every boot when ``COUNSELLE_DB_ADMIN_DSN`` is set:

1. Role reconciliation: ``counselle_app``, ``counselle_ro``,
   ``cds_library_reader``, ``cds_library_owner``, and (only when
   ``COUNSELLE_DB_PIPELINE_DSN`` is configured) ``cds_library_app``.
2. Schema DDL: execute ``deploy/seed/cds_library_schema.sql`` unconditionally
   -- every statement in it is ``IF NOT EXISTS`` / ``CREATE OR REPLACE`` / a
   ``DROP TRIGGER IF EXISTS`` guard, including every object grant (plan
   §3.3: that seed file is the single source of every cds_library grant now,
   not this script), so a schema change made after first deploy is never
   silently skipped.
3. Data load, gated: ``cds_library.schools`` is loaded from
   ``deploy/seed/schools.csv.gz`` once, the first time the table is found
   empty.

``COUNSELLE_DB_ADMIN_DSN`` being unset is a hard failure now, not a
degraded-mode skip: under v3 this script's seed step owns the whole
cds_library schema, so skipping it would leave the reader/writer roles with
nothing to select or write.

Requires an admin DSN because neither runtime role may create schemas,
roles, or extensions.
"""

from __future__ import annotations

import gzip
import os
import sys
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import psycopg
from psycopg import sql

ROOT = Path(__file__).resolve().parents[1]
SEED_DIR = ROOT / "deploy" / "seed"
SEED_FILE = SEED_DIR / "cds_library_schema.sql"
SCHOOLS_ARCHIVE = SEED_DIR / "schools.csv.gz"

# Column order of deploy/seed/schools.csv.gz, matching cds_library.schools
# (created_at is excluded -- it takes its own DEFAULT now()).
SCHOOLS_COLUMNS = (
    "id",
    "name",
    "aliases",
    "city",
    "state",
    "postal_code",
    "latitude",
    "longitude",
    "official_website",
    "official_domain",
    "general_phone",
    "is_currently_operating",
    "is_main_campus",
    "search_name",
    "basic_profile",
    "profile_provenance",
    "profile_version",
    "profile_snapshot_date",
    "profile_sha256",
    "imported_at",
)

# Migrations declare these, but installing an extension needs CREATE on the
# database, which the unprivileged app role deliberately lacks. Install them
# here so the migration's IF NOT EXISTS becomes a no-op. Schema placement is
# contractual (plan §3.4): `vector` in `public` (migrations/0003 writes
# `public.vector(768)`), `pg_trgm` in `counselle` (`similarity()` callers use
# `search_path = counselle, pg_catalog`). A bare `CREATE EXTENSION pg_trgm`
# from the admin connection lands it in `public` instead, where it silently
# never resolves for those callers.
REQUIRED_EXTENSIONS = (("pg_trgm", "counselle"), ("vector", "public"))


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


def _fetchone(cur: psycopg.Cursor, query: str) -> tuple[Any, ...]:
    """Fetch the single row a scalar ``SELECT`` always returns.

    A bare ``SELECT <expr>`` with no ``FROM``/``WHERE`` clause returns
    exactly one row on any live connection; ``None`` here would mean the
    cursor never ran the query it's paired with, which signals a bug, not a
    legitimate empty result.
    """
    row = cur.fetchone()
    if row is None:
        raise RuntimeError(f"expected exactly one row, got none, from query: {query!r}")
    return row


def _schools_is_loaded(cur: psycopg.Cursor) -> bool:
    query = "SELECT to_regclass('cds_library.schools') IS NOT NULL"
    cur.execute(query)
    if not _fetchone(cur, query)[0]:
        return False
    query = "SELECT EXISTS (SELECT 1 FROM cds_library.schools)"
    cur.execute(query)
    return bool(_fetchone(cur, query)[0])


def _apply_seed(cur: psycopg.Cursor) -> None:
    """Run the whole v3 seed file in one statement.

    psycopg has no equivalent of psql's ``\\set``/``\\if`` meta-commands, so
    lines starting with ``\\`` (just ``\\set ON_ERROR_STOP on`` today) are
    stripped before the rest is sent as a single multi-statement query.
    Postgres wraps a multi-statement simple-query string in one implicit
    transaction, so this is at least as strict as ``ON_ERROR_STOP``: any
    single failing statement rolls back the whole seed atomically rather
    than leaving a half-applied schema (verified empirically against
    PostgreSQL 16).
    """
    if not SEED_FILE.exists():
        raise SystemExit(f"missing seed file: {SEED_FILE}")
    statements = "\n".join(
        line for line in SEED_FILE.read_text(encoding="utf-8").splitlines()
        if not line.lstrip().startswith("\\")
    )
    cur.execute(statements)


def _load_schools(cur: psycopg.Cursor) -> None:
    if not SCHOOLS_ARCHIVE.exists():
        raise SystemExit(f"missing seed archive: {SCHOOLS_ARCHIVE}")
    target = sql.Identifier("cds_library", "schools")
    # Reached only on an unseeded or half-seeded database, so clearing first
    # keeps a retry after an interrupted load from doubling up rows. CASCADE
    # is required because collegedata_schools/page_snapshots/etc. hold an FK
    # to schools -- Postgres checks that structurally, not by row count --
    # but it is a no-op in practice: this only runs while schools is empty,
    # and nothing can hold a live FK to a school_id that never existed.
    cur.execute(sql.SQL("TRUNCATE {} CASCADE").format(target))
    columns = sql.SQL(", ").join(sql.Identifier(name) for name in SCHOOLS_COLUMNS)
    statement = sql.SQL("COPY {} ({}) FROM STDIN WITH (FORMAT csv)").format(target, columns)
    with cur.copy(statement) as copy, gzip.open(SCHOOLS_ARCHIVE, "rb") as source:
        while chunk := source.read(1 << 20):
            copy.write(chunk)
    print("seeded cds_library.schools", flush=True)


def _finalize_reader_role(cur: psycopg.Cursor, database: str, ro_role: str) -> None:
    """Session defaults the object grants (in the seed file) don't cover.

    Read-only is enforced by this session default, not just by the SELECT
    grants deploy/seed/cds_library_schema.sql applies.
    """
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
    for extension, ext_schema in REQUIRED_EXTENSIONS:
        cur.execute(
            sql.SQL("CREATE EXTENSION IF NOT EXISTS {} SCHEMA {}").format(
                sql.Identifier(extension), sql.Identifier(ext_schema)
            )
        )


def main() -> int:
    admin_dsn = os.environ.get("COUNSELLE_DB_ADMIN_DSN", "")
    if not admin_dsn:
        raise SystemExit(
            "COUNSELLE_DB_ADMIN_DSN is required -- the v3 seed owns the whole "
            "cds_library schema (plan §3.3), so skipping database bootstrap "
            "is not a degraded mode."
        )

    app_role, app_password = _credentials("COUNSELLE_DB_APP_DSN", "counselle_app")
    ro_role, ro_password = _credentials("COUNSELLE_DB_RO_DSN", "counselle_ro")
    pipeline_dsn = os.environ.get("COUNSELLE_DB_PIPELINE_DSN", "")

    with psycopg.connect(admin_dsn, autocommit=True) as conn, conn.cursor() as cur:
        query = "SELECT current_database()"
        cur.execute(query)
        database = _fetchone(cur, query)[0]

        # cds_library_app must always exist (NOLOGIN if unconfigured): the
        # seed's GRANT statements name it unconditionally (plan §3.3), so a
        # deployment with neither the facts crawler nor the parked CDS admin
        # pipeline configured still needs the role to exist, just inert.
        pipeline_password: str | None = None
        if pipeline_dsn:
            _, pipeline_password = _credentials("COUNSELLE_DB_PIPELINE_DSN", "cds_library_app")

        _ensure_role(cur, app_role, app_password)
        _ensure_role(cur, ro_role, ro_password)
        _ensure_role(cur, "cds_library_reader", None)
        _ensure_role(cur, "cds_library_owner", None)
        _ensure_role(cur, "cds_library_app", pipeline_password)

        _prepare_app_schema(cur, database, app_role)

        print("applying cds_library schema (always-run, idempotent)", flush=True)
        _apply_seed(cur)

        if _schools_is_loaded(cur):
            print("cds_library.schools already seeded", flush=True)
        else:
            print("seeding cds_library.schools", flush=True)
            _load_schools(cur)

        _finalize_reader_role(cur, database, ro_role)

    print("database bootstrap complete", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
