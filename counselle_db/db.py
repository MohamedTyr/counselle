"""asyncpg pool factory + fetch helper for the read-only pipeline DB (ADR 0012).

The pool connects as ``counselle_ro`` (read-only role). The role already carries
``statement_timeout``/``default_transaction_read_only`` server-side; we set the
timeout per-connection too so a misconfigured role can't silently drop the cap.
A jsonb/json codec makes ``field_values.value`` (and ``settings.value``) arrive
as native Python objects (DATABASE_GUIDE §2).
"""

import json

import asyncpg

from config.settings import get_db_child_settings


async def _init_connection(conn: asyncpg.Connection) -> None:
    """Register jsonb/json codecs so values arrive as Python objects."""
    for type_name in ("jsonb", "json"):
        await conn.set_type_codec(
            type_name, encoder=json.dumps, decoder=json.loads, schema="pg_catalog"
        )


async def create_pool(dsn: str | None = None) -> asyncpg.Pool:
    """Create the read-only pool on COUNSELLE_DB_RO_DSN (sizes/timeout from Settings)."""
    settings = get_db_child_settings()
    return await asyncpg.create_pool(
        dsn or settings.db_ro_dsn,
        min_size=settings.db_pool_min,
        max_size=settings.db_pool_max,
        init=_init_connection,
        server_settings={"statement_timeout": str(settings.db_statement_timeout_ms)},
    )


def vector_literal(vec: list[float]) -> str:
    """pgvector text input format: '[0.1,0.2,...]' — cast to ::vector in SQL."""
    return "[" + ",".join(str(value) for value in vec) + "]"


async def fetch(pool: asyncpg.Pool, sql: str, *args: object) -> list[asyncpg.Record]:
    """Run one parameterized SELECT and return the rows."""
    async with pool.acquire() as conn:
        rows: list[asyncpg.Record] = await conn.fetch(sql, *args)
        return rows
