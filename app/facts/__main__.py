"""`python -m app.facts` — the facts crawl CLI (plan §4.2, Unit E).

Subcommands:

- `--once [--limit N]`: enqueues a `crawl_pass` job through `facts_jobs`
  (never bypassing the queue, plan §4.2 overriding appendix J-iii's bypass
  variant) and runs one claim in the foreground. "Already running" exits 0
  and writes nothing.
- `remap`: enqueues and runs a `remap` job (no network, no `school_pages`
  writes).
- `crosswalk-sync`: upserts the committed CSV into `collegedata_schools`
  (Unit A's `sync_crosswalk`).

All three share the identical `run_crawl_pass`/`run_remap_pass` the poller
calls — there is no second code path.
"""

from __future__ import annotations

import asyncio
import sys

from adapters import facts_jobs_store
from app.facts.crawl import run_crawl_pass, run_remap_pass
from app.facts.crosswalk import sync_crosswalk
from config.settings import get_settings
from counselle_db.db import create_pool


async def _run_job(*, kind: str, limit: int | None = None) -> int:
    settings = get_settings()
    if settings.db_pipeline_dsn is None:
        print("COUNSELLE_DB_PIPELINE_DSN is not set", file=sys.stderr)
        return 1
    pool = await create_pool(dsn=settings.db_pipeline_dsn, settings=settings)
    try:
        enqueued = await facts_jobs_store.enqueue_now(pool, kind=kind)  # type: ignore[arg-type]
        if not enqueued:
            print("already running")
            return 0
        job = await facts_jobs_store.claim_next_job(
            pool, lease_seconds=settings.facts_crawl_lease_seconds
        )
        if job is None:
            # A concurrent claimant beat us between enqueue and claim --
            # exactly the "already running" outcome from the operator's view.
            print("already running")
            return 0
        assert job.started_at is not None, "a claimed job always has started_at set"
        if kind == "remap":
            await run_remap_pass(
                pool, settings, job_id=job.id, claimed_started_at=job.started_at
            )
        else:
            await run_crawl_pass(
                pool, settings, job_id=job.id, claimed_started_at=job.started_at, limit=limit
            )
        return 0
    finally:
        await pool.close()


async def _run_crosswalk_sync() -> int:
    settings = get_settings()
    if settings.db_pipeline_dsn is None:
        print("COUNSELLE_DB_PIPELINE_DSN is not set", file=sys.stderr)
        return 1
    pool = await create_pool(dsn=settings.db_pipeline_dsn, settings=settings)
    try:
        count = await sync_crosswalk(pool)
        print(f"synced {count} crosswalk rows")
        return 0
    finally:
        await pool.close()


_USAGE = "usage: python -m app.facts (--once [--limit N] | remap | crosswalk-sync)"


def main(argv: list[str] | None = None) -> int:
    """Deliberately not argparse-subparser-shaped: the plan's three forms
    mix a flag (`--once`) with bare-word commands (`remap`,
    `crosswalk-sync`) rather than a uniform subcommand grammar — matching
    that literally is simpler as a direct dispatch than fighting argparse's
    mutually-exclusive-group/positional interaction."""
    args = list(sys.argv[1:] if argv is None else argv)
    if not args:
        print(_USAGE, file=sys.stderr)
        return 1
    if args[0] == "--once":
        limit = int(args[args.index("--limit") + 1]) if "--limit" in args else None
        return asyncio.run(_run_job(kind="crawl_pass", limit=limit))
    if args[0] == "remap":
        return asyncio.run(_run_job(kind="remap"))
    if args[0] == "crosswalk-sync":
        return asyncio.run(_run_crosswalk_sync())
    print(_USAGE, file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
