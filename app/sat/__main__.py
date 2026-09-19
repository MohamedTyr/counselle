"""`python -m app.sat` — the SAT practice bank pipeline CLI (plan
plans/sat-practice/plan.md §3.2).

    python -m app.sat fetch [--run <name>] [--root <dir>]

Subparsers so later work on this plan (`build`, `audit`, `bank-sync`,
`export-liprep-json`) can each be added as one `add_parser(...)` block
dispatching to its own function -- no shared argument-parsing to fight.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from collections.abc import Callable, Coroutine
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from app.sat.fetch import run_fetch
from config.settings import get_settings

logger = logging.getLogger(__name__)

#: Default root for `fetch`'s output (plan §3.2) -- gitignored, lossless.
_DEFAULT_FETCH_ROOT = Path("artifacts/sat-practice/raw")


def _default_run_name() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")


async def _run_fetch_command(args: argparse.Namespace) -> int:
    run_dir = Path(args.root) / (args.run or _default_run_name())
    settings = get_settings()
    summary = await run_fetch(settings, run_dir)
    print(f"run: {run_dir}")
    print(
        f"stubs={summary.stub_count} unique_content_ids={summary.unique_content_ids} "
        f"fetched={summary.details_fetched} skipped={summary.details_skipped} "
        f"failed={summary.details_failed}"
    )
    if not summary.ok:
        print(
            f"FAILED: {len(summary.failures)} detail(s) failed, see {run_dir / 'failures.json'}",
            file=sys.stderr,
        )
        return 1
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.sat")
    subparsers = parser.add_subparsers(dest="command", required=True)

    fetch_parser = subparsers.add_parser("fetch", help="download the raw question bank")
    fetch_parser.add_argument("--run", default=None, help="run name (default: UTC timestamp)")
    fetch_parser.add_argument("--root", default=str(_DEFAULT_FETCH_ROOT), help="output root dir")
    fetch_parser.set_defaults(handler=_run_fetch_command)

    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = _build_parser()
    args = parser.parse_args(argv)
    handler = cast("Callable[[argparse.Namespace], Coroutine[Any, Any, int]]", args.handler)
    return asyncio.run(handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
