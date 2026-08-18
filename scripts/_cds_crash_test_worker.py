#!/usr/bin/env python3
"""Internal helper for `scripts/verify_cds_engine.py`'s crash-recovery gate.

Starts a real `app.cds.jobs.Poller` against the live pipeline pool and then
sleeps forever -- the parent script SIGKILLs this process once it observes
the target extraction has moved to `running`, simulating an unplanned worker
crash mid-run. Not a general-purpose entrypoint; do not run standalone
outside the verification script.
"""

from __future__ import annotations

import asyncio
import sys

from app.cds.jobs import Poller
from config.settings import get_settings
from counselle_db.db import create_pool


async def main() -> None:
    settings = get_settings()
    pool = await create_pool(dsn=settings.db_pipeline_dsn, settings=settings)
    poller = Poller(pool, settings)
    await poller.start()
    print("worker-ready", flush=True)
    await asyncio.sleep(3600)


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
