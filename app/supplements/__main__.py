"""`python -m app.supplements` — the supplements sync CLI.

- `sync [--force]`: one pass (the same `run_sync` the daily worker runs);
  `--force` re-reads every block with the model, not just changed ones.
- `backfill`: create the required supplemental essays for every school
  already on a student's list (adding a school does this from now on).
- `export <dir>`: write the stored prompts, with school names, to
  `supplements.csv` and `supplements.json` in <dir>.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import sys
from pathlib import Path

from app.supplements.sync import SyncReport, run_sync
from config.settings import get_settings
from counselle_db.db import create_pool

_EXPORT_SQL = """
SELECT s.school_unitid, s.status, s.checked, s.checked_on, s.source_heading,
       s.changed_at, p.ordinal, p.prompt, p.context, p.word_limit, p.requirement,
       p.group_label, p.choose_count, p.applies_to
FROM counselle.supplement_schools s
LEFT JOIN counselle.supplement_prompts p USING (school_unitid, cycle)
WHERE s.cycle = $1
ORDER BY s.school_unitid, p.ordinal
"""


async def _sync(force: bool) -> int:
    settings = get_settings()
    pool = await create_pool(dsn=settings.db_app_dsn, settings=settings)
    try:
        _print_report(await run_sync(pool, settings, force=force))
    finally:
        await pool.close()
    return 0


async def _export(out_dir: Path) -> int:
    settings = get_settings()
    app_pool = await create_pool(dsn=settings.db_app_dsn, settings=settings)
    ro_pool = await create_pool(dsn=settings.db_ro_dsn, settings=settings)
    try:
        rows = await app_pool.fetch(_EXPORT_SQL, settings.supplements_cycle)
        names = {
            r["id"]: r["name"]
            for r in await ro_pool.fetch(
                "SELECT id, name FROM cds_library.school_profiles WHERE id = ANY($1::int[])",
                list({r["school_unitid"] for r in rows}),
            )
        }
    finally:
        await app_pool.close()
        await ro_pool.close()
    records = [
        {"school": names.get(r["school_unitid"], ""), **{k: _plain(v) for k, v in r.items()}}
        for r in rows
    ]
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "supplements.json").write_text(
        json.dumps(records, indent=1, ensure_ascii=False), encoding="utf-8"
    )
    with (out_dir / "supplements.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(records[0]))
        writer.writeheader()
        writer.writerows(records)
    print(f"{len(records)} rows, {len(names)} schools -> {out_dir}")
    return 0


async def _backfill() -> int:
    from app.workspace.service_supplements import backfill_required_essays

    settings = get_settings()
    pool = await create_pool(dsn=settings.db_app_dsn, settings=settings)
    try:
        print(f"created {await backfill_required_essays(pool)} essays")
    finally:
        await pool.close()
    return 0


def _plain(value: object) -> object:
    return value.isoformat() if hasattr(value, "isoformat") else value


def _print_report(report: SyncReport) -> None:
    print(f"unchanged: {report.unchanged} | updated: {len(report.updated)}")
    for label, items in (
        ("failed", report.failed),
        ("unmapped headings", report.unmapped),
        ("stale reviews (block changed since review)", report.stale_reviews),
    ):
        if items:
            print(f"{label}: {', '.join(items)}")
    for heading, rejected in report.rejected.items():
        for r in rejected:
            print(f"rejected [{heading}] {r.reason}: {r.prompt[:100]}")


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m app.supplements")
    sub = parser.add_subparsers(dest="command", required=True)
    sync = sub.add_parser("sync")
    sync.add_argument("--force", action="store_true")
    sub.add_parser("backfill")
    export = sub.add_parser("export")
    export.add_argument("out_dir", type=Path)
    args = parser.parse_args()
    if args.command == "sync":
        return asyncio.run(_sync(args.force))
    if args.command == "backfill":
        return asyncio.run(_backfill())
    return asyncio.run(_export(args.out_dir))


if __name__ == "__main__":
    sys.exit(main())
