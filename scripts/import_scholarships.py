#!/usr/bin/env python3
"""Import researched scholarship records into the local database.

    uv run python scripts/import_scholarships.py plans/scholarship-seed/scholarships.json

The file is a JSON array of ``{"row", "outcome", "skip_reason", "notes", "record"}``
entries (the research format in ``plans/scholarship-seed/``); entries with
``outcome == "skip"`` are ignored. It may instead be an array of flat
``counselle.scholarships`` rows, as an export of the table gives; their ids,
statuses and timestamps are ignored. Each record is created through
``app.scholarships.service`` as the first superuser, so it passes the same
validation and gets the same revision row as one entered in the admin editor.
A record that passes every publish check is published; any other is left a
draft for an admin to finish. A record whose name matches a live draft
replaces that draft (and publishes it when it now passes); one matching a
published record is skipped, so a re-run only adds or completes.

``--archive-others`` archives every non-archived record whose name is not in
the file, which is how the illustrative dev seed gives way to the real list.
Like ``seed_scholarships.py`` this refuses a non-local database.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import json
import sys
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

import asyncpg

from app.scholarships import service
from app.scholarships.models import ScholarshipCreateIn, ScholarshipUpdateIn, StatusChangeIn
from app.scholarships.rows import draft_from_row
from config.settings import get_settings
from counselle_db.db import create_pool
from domain.scholarships.publish import publish_problems
from domain.scholarships.types import ScholarshipDraft, ScholarshipStatus

LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1"})

_FIRST_SUPERUSER_SQL = """
SELECT id FROM counselle.users WHERE is_superuser ORDER BY created_at NULLS LAST, id LIMIT 1
"""


def load_drafts(path: Path) -> list[ScholarshipDraft]:
    entries = json.loads(path.read_text())
    return [
        draft_from_row(entry)
        if "outcome" not in entry
        else ScholarshipDraft.model_validate(entry["record"])
        for entry in entries
        if entry.get("outcome", "record") == "record"
    ]


async def run_import(
    pool: asyncpg.Pool, actor: UUID, drafts: list[ScholarshipDraft], archive_others: bool
) -> None:
    today = dt.datetime.now(dt.UTC).date()
    existing = await service.list_all(pool)
    live = {record.name: record for record in existing if record.status != "archived"}
    published = drafted = skipped = 0
    for draft in drafts:
        current = live.get(draft.name)
        if current is not None and current.status == "published":
            skipped += 1
            continue
        status: ScholarshipStatus = "draft" if publish_problems(draft, today) else "published"
        if current is None:
            body = ScholarshipCreateIn(**draft.model_dump(), status=status)
            live[draft.name] = await service.create(pool, body, actor)
        else:
            update = ScholarshipUpdateIn(
                **draft.model_dump(), status=status, expected_version=current.version
            )
            live[draft.name] = await service.update(pool, current.id, update, actor)
        published += status == "published"
        drafted += status == "draft"
    archived = 0
    if archive_others:
        wanted = {draft.name for draft in drafts}
        for record in existing:
            if record.status != "archived" and record.name not in wanted:
                await service.change_status(
                    pool, record.id, StatusChangeIn(status="archived"), actor
                )
                archived += 1
    print(
        f"Published {published}, left {drafted} as drafts, skipped {skipped} already published, "
        f"archived {archived}."
    )


async def run(path: Path, archive_others: bool) -> int:
    dsn = get_settings().db_app_dsn
    if urlsplit(dsn).hostname not in LOCAL_HOSTS:
        print("Refusing to import: the app database is not on localhost.", file=sys.stderr)
        return 1
    drafts = load_drafts(path)
    pool = await create_pool(dsn=dsn)
    try:
        actor = await pool.fetchval(_FIRST_SUPERUSER_SQL)
        if actor is None:
            print("Run scripts/promote_admin.py first.", file=sys.stderr)
            return 1
        await run_import(pool, actor, drafts, archive_others)
    finally:
        await pool.close()
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument(
        "--archive-others", action="store_true", help="archive records not in the file"
    )
    args = parser.parse_args(argv)
    return asyncio.run(run(args.file, args.archive_others))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
