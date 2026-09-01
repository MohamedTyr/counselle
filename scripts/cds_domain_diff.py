#!/usr/bin/env python3
"""Print which domains changed between a published manifest version and the
currently compiled ``config/cds/`` -- the cheap half of hash-scoped
incremental re-extraction (ship plan §6.8).

The expensive half already exists: ``rerun_extraction`` (`app/cds/
service_review_approve.py`) accepts an explicit ``domains`` list and, once §2.1's
`target_kind` fix ships, correctly treats a domain-scoped rerun of an
already-active document as an `active_update` whose packets land back in the
review queue instead of a dead end. What's been missing is telling an
operator *which* domains actually need that rerun instead of paying for all
thirteen every time.

This is a read-only diagnostic, not a mutation -- like
``publish_cds_manifest.py --dry-run``, it's a rare, manual, one-person action
(plan §I2/§0.6: no UI). Feed its output into the existing admin rerun
surface by hand.

Usage::

    uv run python scripts/cds_domain_diff.py --against 5.0.2
    # compares config/cds/ (compiled) against the domain_hashes published
    # under version 5.0.2, and prints changed/added/removed/unchanged.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from app.cds.manifest import CDS_CONFIG_DIR, changed_domains_since_publish
from config.settings import get_settings
from counselle_db.db import create_pool
from domain.cds.manifest_compile import ManifestError, compile_manifest


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--against",
        required=True,
        metavar="VERSION",
        help=(
            "the published cds_library.cds_manifests version to diff the compiled "
            "config/cds/ against -- typically the manifest version a target document "
            "was last extracted under"
        ),
    )
    return parser.parse_args(argv)


async def main(argv: list[str]) -> int:
    args = parse_args(argv)
    settings = get_settings()
    if not settings.db_pipeline_dsn:
        print("COUNSELLE_DB_PIPELINE_DSN is not set -- cannot read cds_library.", file=sys.stderr)
        return 1

    try:
        compiled = compile_manifest(CDS_CONFIG_DIR)
    except ManifestError as error:
        print(f"MANIFEST COMPILE FAILED: {error}", file=sys.stderr)
        return 1

    pool = await create_pool(dsn=settings.db_pipeline_dsn, settings=settings)
    try:
        diff = await changed_domains_since_publish(pool, compiled, version=args.against)
    finally:
        await pool.close()

    print(f"compiled config/cds/ version: {compiled.version}")
    print(f"compared against published:   {args.against}")
    if not diff.has_changes:
        print("\nNO CHANGES -- every domain hash matches. Nothing to rerun.")
        return 0

    print(f"\nchanged ({len(diff.changed)}): {', '.join(diff.changed) or '(none)'}")
    print(f"added ({len(diff.added)}): {', '.join(diff.added) or '(none)'}")
    print(f"removed ({len(diff.removed)}): {', '.join(diff.removed) or '(none)'}")
    print(f"unchanged ({len(diff.unchanged)}): {', '.join(diff.unchanged) or '(none)'}")
    print(
        f"\nrerun_extraction(domains={list(diff.changed_domains)!r}) "
        "is the targeted rerun to run against a document last extracted at "
        f"{args.against!r}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1:])))
