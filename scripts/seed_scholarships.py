#!/usr/bin/env python3
"""Seed placeholder scholarships into a local dev database (plan §8.4).

    uv run python scripts/seed_scholarships.py --dev

Production starts empty and admins enter records by hand (plan D3), so this
refuses to run without ``--dev`` or against a non-local database. Names are
modelled on well-known programs, but amounts, dates and rules are
illustrative, not checked facts.

Dates in ``seed_scholarships.json`` are offsets from today
(``deadline_in_days``, ``opens_in_days``, ``checked_days_ago``), so the
"closing soon", "stale" and "closed" examples stay correct whenever this
runs. Each record is created through ``app.scholarships.service`` as the
first superuser, so it passes validation and gets a revision. A published
record that has gone stale since it was checked can't be created stale, so
it is created checked today and then backdated, the way it would age.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import sys
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

import asyncpg

from app.scholarships import service
from app.scholarships.models import ScholarshipCreateIn, StatusChangeIn
from config.settings import get_settings
from counselle_db.db import create_pool
from domain.scholarships.publish import is_stale

SEED_FILE = Path(__file__).with_name("seed_scholarships.json")
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1"})

_BACKDATE_CHECK_SQL = "UPDATE counselle.scholarships SET last_checked_on = $1 WHERE id = $2"

_FIRST_SUPERUSER_SQL = """
SELECT id FROM counselle.users WHERE is_superuser ORDER BY created_at NULLS LAST, id LIMIT 1
"""


def _offset(today: dt.date, days: int | None) -> str | None:
    return None if days is None else (today + dt.timedelta(days=days)).isoformat()


def resolve(seed: dict[str, Any], today: dt.date) -> tuple[ScholarshipCreateIn, str]:
    """A seed record's create body and its final status (archived records are
    created as drafts, then archived)."""
    record = dict(seed)
    status = record.pop("status", "published")
    deadline = dict(record.pop("deadline"))
    deadline["date"] = _offset(today, record.pop("deadline_in_days", None))
    deadline["opens_on"] = _offset(today, record.pop("opens_in_days", None))
    record["deadline"] = deadline
    record["last_checked_on"] = _offset(today, -record.pop("checked_days_ago", 0))
    create_status = "draft" if status == "archived" else status
    return ScholarshipCreateIn.model_validate({**record, "status": create_status}), status


async def seed(pool: asyncpg.Pool, actor: UUID, records: list[dict[str, Any]]) -> int:
    today = dt.datetime.now(dt.UTC).date()
    for raw in records:
        body, status = resolve(raw, today)
        checked_on = body.last_checked_on
        aged = body.status == "published" and is_stale(checked_on, today)
        if aged:
            body = body.model_copy(update={"last_checked_on": today})
        created = await service.create(pool, body, actor)
        if aged:
            await pool.execute(_BACKDATE_CHECK_SQL, checked_on, created.id)
        if status == "archived":
            await service.change_status(pool, created.id, StatusChangeIn(status="archived"), actor)
    return len(records)


async def run() -> int:
    dsn = get_settings().db_app_dsn
    if urlsplit(dsn).hostname not in LOCAL_HOSTS:
        print("Refusing to seed: the app database is not on localhost.", file=sys.stderr)
        return 1
    pool = await create_pool(dsn=dsn)
    try:
        actor = await pool.fetchval(_FIRST_SUPERUSER_SQL)
        if actor is None:
            print("Run scripts/promote_admin.py first.", file=sys.stderr)
            return 1
        count = await seed(pool, actor, json.loads(SEED_FILE.read_text()))
    finally:
        await pool.close()
    print(f"Seeded {count} scholarships.")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dev", action="store_true", help="required: confirms a dev database")
    args = parser.parse_args(argv)
    if not args.dev:
        print("Refusing to seed without --dev.", file=sys.stderr)
        return 1
    return asyncio.run(run())


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
