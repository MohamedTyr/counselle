"""Shared `live_db` fixtures for the facts store adapter tests (Unit E)."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator
from pathlib import Path

import asyncpg
import pytest

from config.settings import get_settings
from counselle_db.db import create_pool

_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


def _admin_dsn_from_dotenv() -> str:
    """`COUNSELLE_DB_ADMIN_DSN` isn't a `Settings` field (it's read directly
    from the environment by `scripts/dev.py`/`scripts/seed_reader_db.py`),
    and the routine test run deliberately never `source .env` (it causes
    two unrelated spurious failures). Parse the one line this fixture
    needs directly out of the file instead of mutating `os.environ`."""
    value = os.environ.get("COUNSELLE_DB_ADMIN_DSN")
    if value:
        return value
    if not _ENV_FILE.exists():
        return ""
    for line in _ENV_FILE.read_text().splitlines():
        key, _, val = line.strip().partition("=")
        if key == "COUNSELLE_DB_ADMIN_DSN":
            return val.strip().strip('"').strip("'")
    return ""


@pytest.fixture
async def pipeline_pool() -> AsyncIterator[asyncpg.Pool]:
    """A small pool on the `cds_library_app` role (`COUNSELLE_DB_PIPELINE_DSN`)
    — the same DSN and jsonb-codec setup `adapters/facts_store.py` writes
    through (`counselle_db.db.create_pool` registers the jsonb/json codec
    every production pipeline pool has). Function-scoped to stay inside
    whatever event loop pytest-asyncio hands this test.

    **`cds_library_app` has no DELETE grant** on any of these tables except
    `page_snapshots` (plan §3.3) — test cleanup that needs to delete rows
    (crawl_runs/facts_jobs/school_facts/school_pages) must use
    `admin_pool` below, never this one.
    """
    settings = get_settings()
    assert settings.db_pipeline_dsn is not None, "COUNSELLE_DB_PIPELINE_DSN is not set"
    pool = await create_pool(dsn=settings.db_pipeline_dsn, settings=settings)
    try:
        yield pool
    finally:
        await pool.close()


@pytest.fixture
async def admin_pool() -> AsyncIterator[asyncpg.Pool]:
    """A pool on `COUNSELLE_DB_ADMIN_DSN` (superuser, read directly from the
    environment like `scripts/dev.py`/`scripts/seed_reader_db.py` do — it is
    not a `Settings` field) — test-cleanup only. Production code never uses
    this DSN; `adapters/facts_store.py` writes exclusively through the
    `cds_library_app`-authenticated `pipeline_pool`."""
    settings = get_settings()
    admin_dsn = _admin_dsn_from_dotenv()
    assert admin_dsn, "COUNSELLE_DB_ADMIN_DSN is not set (checked env and .env)"
    pool = await create_pool(dsn=admin_dsn, settings=settings)
    try:
        yield pool
    finally:
        await pool.close()
