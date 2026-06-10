"""Shared live-DB fixtures for the counselle_db integration suite (phase-2 Slice D).

The pool connects as ``counselle_ro`` using ``COUNSELLE_DB_RO_DSN`` from the repo
``.env`` (pydantic-settings reads it when pytest runs from the repo root). The
pipeline DB container (``ascensia-data-pipeline-db-1``) must be running.

One pool per module: the ``catalog`` fixture is module-scoped on a module-scoped
event loop, and every test in this directory is pinned to that same loop (an
asyncpg pool cannot be shared across event loops).
"""

import inspect
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio

from counselle_db.catalog import Catalog
from counselle_db.db import create_pool

_HERE = Path(__file__).parent


def pytest_collection_modifyitems(items: list[pytest.Item]) -> None:
    """Run every async test in this directory on the module-scoped event loop."""
    for item in items:
        if Path(item.path).parent != _HERE:
            continue
        function = getattr(item, "function", None)
        if function is not None and inspect.iscoroutinefunction(function):
            item.add_marker(pytest.mark.asyncio(loop_scope="module"), append=False)


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def catalog() -> AsyncIterator[Catalog]:
    """A live read-only pool with the fields catalog loaded — one pool per module."""
    pool = await create_pool()
    try:
        yield await Catalog.load(pool)
    finally:
        await pool.close()
