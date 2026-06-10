"""Checkpointer factory: durable Postgres saver in ``counselle.*`` (ADR 0019).

The Python ``AsyncPostgresSaver`` has **no schema parameter** (eng-review D3,
notes-p4-apis §8). Mechanism: append ``options=-csearch_path%3Dcounselle,public``
to the app DSN so ``.setup()`` creates its four ``checkpoint*`` tables in the
``counselle`` schema, then fail fast if any checkpoint table ever exists outside
it (a wrong search_path would silently scatter tables into ``public``).

``checkpointer="memory"`` (Settings) swaps in :class:`InMemorySaver` for tests —
same seam, different adapter.
"""

from typing import Any

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import AsyncConnection
from psycopg.rows import dict_row

#: psycopg conninfo `options` that pins the saver's tables to counselle.* —
#: %3D is the URL-encoded `=` (verified, notes-p4-apis §8).
_SEARCH_PATH_OPTIONS = "options=-csearch_path%3Dcounselle,public"

_CHECKPOINT_TABLES_SQL = """
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_name LIKE 'checkpoint%'
"""


def dsn_with_search_path(dsn: str) -> str:
    """Append the counselle search_path options to a DSN (``&`` if it has a query)."""
    separator = "&" if "?" in dsn else "?"
    return f"{dsn}{separator}{_SEARCH_PATH_OPTIONS}"


async def assert_checkpoint_schema(conn: Any) -> None:
    """Fail-fast (eng-review D3): every checkpoint table must live in ``counselle``.

    ``conn`` is a psycopg ``AsyncConnection`` with ``row_factory=dict_row`` (or
    any object whose ``execute()`` returns a cursor of dict rows). Raises
    ``RuntimeError`` if a ``checkpoint%`` table exists outside the ``counselle``
    schema, or if none exists inside it (i.e. setup never ran / ran elsewhere).
    """
    cursor = await conn.execute(_CHECKPOINT_TABLES_SQL)
    rows = await cursor.fetchall()
    strays = [
        f"{row['table_schema']}.{row['table_name']}"
        for row in rows
        if row["table_schema"] != "counselle"
    ]
    if strays:
        raise RuntimeError(
            "checkpoint tables exist outside the counselle schema: "
            f"{sorted(strays)} — the checkpointer DSN search_path is wrong; "
            "refusing to boot (ADR 0019 / eng-review D3)"
        )
    if not rows:
        raise RuntimeError(
            "no checkpoint tables found in the counselle schema — the saver's "
            "setup() did not run (or ran against another database); refusing to boot"
        )


async def build_checkpointer(settings: Any) -> AsyncPostgresSaver | InMemorySaver:
    """Build the session checkpointer per ``settings.checkpointer``.

    Postgres mode owns a long-lived autocommit ``AsyncConnection`` (the three
    connection kwargs replicate ``from_conn_string`` — notes-p4-apis §8); it is
    reachable as ``saver.conn`` and the caller closes it at shutdown.
    """
    if settings.checkpointer == "memory":
        return InMemorySaver()
    dsn = dsn_with_search_path(settings.db_app_dsn)
    conn = await AsyncConnection.connect(
        dsn, autocommit=True, prepare_threshold=0, row_factory=dict_row
    )
    try:
        saver = AsyncPostgresSaver(conn)
        await saver.setup()
        await assert_checkpoint_schema(conn)
    except BaseException:
        await conn.close()
        raise
    return saver
