"""Live DB gate for migration 0018's essay_prompt_drafts -> essays conversion.

specs/essay-creation-simplification/plan/implementation-plan.md Sec 8 names this as one
of two honesty-critical tests the refactor must have: the conversion INSERT is "the one
step that can destroy student data." It has never run against real data (production
count of active, unconverted drafts was 0 when written), so it is unrun everywhere that
still has rows -- staging, prod, any fresh dev DB -- and had no automated guard before
this test.

The migration has already applied locally, so counselle.essay_prompt_drafts no longer
exists there. This test never touches that table: it runs the migration's actual INSERT
statement (read live off disk, schema-qualifiers retargeted -- see
_conversion_statement) against three distinctly-prefixed scratch tables, all created and
seeded inside a transaction it always rolls back, so nothing it does is ever committed.

Deviation from a true scratch *schema*: COUNSELLE_DB_APP_DSN's role (counselle_app) has
CREATE on the `counselle` schema it owns but not CREATE on the database itself (verified
via has_database_privilege), so `CREATE SCHEMA` is not available to it. The scratch
tables below live inside `counselle` under a `_migration0018_test_` prefix instead of a
separate schema -- distinct from (and never named) `essay_prompt_drafts`, and never
committed, so this still cannot collide with or mutate real data.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio

from config.settings import get_settings
from counselle_db.db import create_pool

pytestmark = pytest.mark.live_db

# Fixed literal, never derived from external/user input -- the one place this file
# interpolates an identifier into SQL text rather than parameterizing it, because
# asyncpg cannot bind table names.
_PREFIX = "_migration0018_test_"

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[2] / "migrations" / "0018_drop_essay_prompt_drafts.sql"
)

_OLDER = datetime(2026, 1, 5, 12, 0, tzinfo=UTC)
_NEWER = datetime(2026, 2, 10, 9, 30, tzinfo=UTC)


def _conversion_statement() -> str:
    """Pull migration 0018's INSERT...SELECT verbatim from the file on disk and
    retarget its counselle.* qualifiers at the prefixed scratch tables. Reading it live
    (instead of hand-copying the SQL into this test) means a future edit to the real
    migration either flows through here unchanged or trips the sanity asserts below --
    a drifted copy would otherwise guard nothing while looking like it does."""
    sql = _MIGRATION_PATH.read_text()
    start = sql.index("INSERT INTO counselle.essays")
    end = sql.index(";", start) + 1
    statement = sql[start:end]
    assert "FROM counselle.essay_prompt_drafts" in statement
    assert "a.archived_at IS NOT NULL" in statement
    return statement.replace("counselle.", f"counselle.{_PREFIX}")


async def _build_scratch_tables(conn: asyncpg.Connection) -> None:
    """Minimal reconstruction of the tables the conversion touches -- essay_prompt_drafts
    per 0013's DDL (migrations/0013_essay_prompt_drafts.sql), plus the columns of
    essays/applications/users the INSERT actually reads or writes. Only the conversion
    statement itself carries the strict read-from-file requirement; this supporting
    DDL is not the step that can destroy data."""
    p = _PREFIX
    await conn.execute(f"CREATE TABLE counselle.{p}users (id uuid PRIMARY KEY)")
    await conn.execute(
        f"""CREATE TABLE counselle.{p}applications (
              id uuid PRIMARY KEY,
              user_id uuid NOT NULL REFERENCES counselle.{p}users(id),
              archived_at timestamptz)"""
    )
    await conn.execute(
        f"""CREATE TABLE counselle.{p}essays (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              user_id uuid NOT NULL,
              application_id uuid,
              title text NOT NULL,
              essay_type text NOT NULL,
              status text NOT NULL,
              prompt text,
              word_limit integer,
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now())"""
    )
    await conn.execute(
        f"""CREATE TABLE counselle.{p}essay_prompt_drafts (
              id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
              user_id uuid NOT NULL REFERENCES counselle.{p}users(id),
              application_id uuid NOT NULL REFERENCES counselle.{p}applications(id),
              prompt text NOT NULL,
              word_limit integer,
              converted_to_essay_id uuid REFERENCES counselle.{p}essays(id),
              created_at timestamptz NOT NULL DEFAULT now(),
              updated_at timestamptz NOT NULL DEFAULT now(),
              archived_at timestamptz)"""
    )


async def _seed_six_cases(conn: asyncpg.Connection, user_id: UUID) -> None:
    """One draft per behavior in the plan's Sec 8 checklist: an ordinary active draft
    (1), a NULL word_limit (2), an archived draft (3), an already-converted draft (4),
    a draft under an archived application (5, the subtle one), and a second active
    draft with a distinct, older-than-"now" timestamp to check relative ordering (6)."""
    p = _PREFIX
    active_app, archived_app = uuid4(), uuid4()
    await conn.execute(
        f"""INSERT INTO counselle.{p}applications (id, user_id, archived_at)
            VALUES ($1, $3, NULL), ($2, $3, now())""",
        active_app,
        archived_app,
        user_id,
    )
    already_essay = await conn.fetchval(
        f"""INSERT INTO counselle.{p}essays (user_id, application_id, title, essay_type, status)
            VALUES ($1, $2, 'Pre-existing essay', 'Supplement', 'Not started')
            RETURNING id""",
        user_id,
        active_app,
    )
    rows = [
        ("Why Duke?", 650, active_app, None, None, _OLDER, _OLDER),
        ("No word limit here.", None, active_app, None, None, _OLDER, _OLDER),
        ("This draft was deleted.", 100, active_app, datetime.now(UTC), None, _OLDER, _OLDER),
        ("Already converted before.", 100, active_app, None, already_essay, _OLDER, _OLDER),
        ("Archived application draft.", 100, archived_app, None, None, _OLDER, _OLDER),
        ("Newer draft.", 200, active_app, None, None, _NEWER, _NEWER),
    ]
    values = [
        (user_id, app, prompt, wl, arch, conv, ca, ua)
        for prompt, wl, app, arch, conv, ca, ua in rows
    ]
    await conn.executemany(
        f"""INSERT INTO counselle.{p}essay_prompt_drafts
              (user_id, application_id, prompt, word_limit, archived_at,
               converted_to_essay_id, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)""",
        values,
    )


@pytest_asyncio.fixture
async def app_pool() -> AsyncIterator[asyncpg.Pool]:
    pool = await create_pool(dsn=get_settings().db_app_dsn)
    try:
        yield pool
    finally:
        await pool.close()


async def test_migration_0018_conversion_preserves_active_drafts_exactly(
    app_pool: asyncpg.Pool,
) -> None:
    statement = _conversion_statement()
    async with app_pool.acquire() as conn:
        tr = conn.transaction()
        await tr.start()
        try:
            await _build_scratch_tables(conn)
            user_id = uuid4()
            await conn.execute(
                f"INSERT INTO counselle.{_PREFIX}users (id) VALUES ($1)", user_id
            )
            await _seed_six_cases(conn, user_id)

            await conn.execute(statement)

            rows = await conn.fetch(
                f"""SELECT prompt, word_limit, created_at, updated_at
                    FROM counselle.{_PREFIX}essays WHERE title = 'Untitled supplement'"""
            )
            by_prompt = {row["prompt"]: row for row in rows}

            assert len(rows) == 3  # only the two active-app/active-draft cases convert
            assert by_prompt["Why Duke?"]["word_limit"] == 650
            assert by_prompt["Why Duke?"]["created_at"] == _OLDER
            assert by_prompt["Why Duke?"]["updated_at"] == _OLDER
            assert by_prompt["No word limit here."]["word_limit"] is None
            assert "This draft was deleted." not in by_prompt
            assert "Already converted before." not in by_prompt
            assert "Archived application draft." not in by_prompt
            assert by_prompt["Why Duke?"]["updated_at"] < by_prompt["Newer draft."]["updated_at"]
        finally:
            await tr.rollback()
