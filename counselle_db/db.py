"""asyncpg pool factory for the read-only pipeline DB (ADR 0012).

The pool connects as ``counselle_ro`` (read-only role). The role already carries
``statement_timeout``/``default_transaction_read_only`` server-side; we set the
timeout per-connection too so a misconfigured role can't silently drop the cap.
A jsonb/json codec makes the reader views' jsonb columns (``school_profiles.basic_profile``,
``active_cds_domain_packets.packet``, ``cds_manifest_snapshots.content``) arrive as native
Python objects (DATABASE_GUIDE §2).
"""

import json
from typing import Protocol

import asyncpg

from config.settings import (
    DEFAULT_DB_POOL_MAX,
    DEFAULT_DB_POOL_MIN,
    DEFAULT_DB_STATEMENT_TIMEOUT_MS,
    get_settings,
)


class PoolSettings(Protocol):
    """The DB connection settings shared by the app and isolated MCP child."""

    db_ro_dsn: str
    db_statement_timeout_ms: int
    db_pool_min: int
    db_pool_max: int


async def _init_connection(conn: asyncpg.Connection) -> None:
    """Register jsonb/json codecs so values arrive as Python objects."""
    for type_name in ("jsonb", "json"):
        await conn.set_type_codec(
            type_name, encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
        )


async def create_pool(
    dsn: str | None = None, *, settings: PoolSettings | None = None
) -> asyncpg.Pool:
    """Create a DB pool without crossing the app/MCP credential boundary.

    Normal app callers use the application settings (and therefore the repo
    ``.env``). The independently launched MCP child passes its already-loaded
    ``DbChildSettings`` explicitly. An explicit DSN never instantiates either
    settings surface; it uses the connection defaults below unless a settings
    object is also supplied.
    """
    if settings is None and dsn is None:
        settings = get_settings()
    if dsn is None:
        assert settings is not None
        resolved_dsn = settings.db_ro_dsn
    else:
        resolved_dsn = dsn
    pool_min = settings.db_pool_min if settings is not None else DEFAULT_DB_POOL_MIN
    pool_max = settings.db_pool_max if settings is not None else DEFAULT_DB_POOL_MAX
    statement_timeout_ms = (
        settings.db_statement_timeout_ms
        if settings is not None
        else DEFAULT_DB_STATEMENT_TIMEOUT_MS
    )
    return await asyncpg.create_pool(
        resolved_dsn,
        min_size=pool_min,
        max_size=pool_max,
        init=_init_connection,
        server_settings={"statement_timeout": str(statement_timeout_ms)},
    )

