#!/usr/bin/env python3
"""Publish the compiled ``config/cds/`` manifest as the new
``cds_library.cds_manifests`` current row (ship plan §1.2).

Ported from the retired pipeline repo's ``publish_manifest``
(``counselle-data-pipeline/src/counselle_data_pipeline/library/manifest.py:641-689``)
-- its transaction shape is preserved deliberately: advisory lock -> ``SELECT
... WHERE is_current FOR UPDATE`` -> refuse if the target version already
exists with different content -> ``INSERT`` the new row with
``is_current = false`` -> demote the old current row -> promote the new one.
The demote-then-promote ordering matters because of the partial unique index
``cds_manifests_one_current_idx UNIQUE (is_current) WHERE is_current``.

This is a rare, manual, one-person action (plan §I2/§0.6) -- there is
deliberately no UI and no queue/extraction side effect: publishing is a
definition change, never a spend trigger.

``--dry-run`` is the default and always available: it prints the version, the
new content hash, the per-domain hash diff against the currently published
manifest, and how many active packets will flip
``current_definition_match`` -- then exits without writing. Pass
``--publish`` to actually commit.

Usage::

    uv run python scripts/publish_cds_manifest.py              # dry run
    uv run python scripts/publish_cds_manifest.py --publish     # commit
"""

from __future__ import annotations

import argparse
import asyncio
import sys

import asyncpg

from app.cds.manifest import CDS_CONFIG_DIR, diff_domain_hashes
from config.settings import get_settings
from counselle_db.db import create_pool
from domain.cds.manifest_compile import CompiledManifest, ManifestError, compile_manifest

_ADVISORY_LOCK_SQL = "SELECT pg_advisory_xact_lock(hashtext('cds_library:manifest-publish'))"
_IN_FLIGHT_STATUSES = ("queued", "running")


class PublishRefused(Exception):
    """The publish was refused inside the transaction -- never a partial write."""


async def _current_row(conn: asyncpg.Connection) -> asyncpg.Record | None:
    return await conn.fetchrow(
        "SELECT version, domain_hashes, encode(content_sha256, 'hex') AS content_sha256 "
        "FROM cds_library.cds_manifests WHERE is_current FOR UPDATE"
    )


async def _existing_target_row(conn: asyncpg.Connection, version: str) -> asyncpg.Record | None:
    return await conn.fetchrow(
        "SELECT encode(content_sha256, 'hex') AS content_sha256 "
        "FROM cds_library.cds_manifests WHERE version = $1 FOR UPDATE",
        version,
    )


async def _refuse_if_extraction_in_flight(conn: asyncpg.Connection) -> None:
    in_flight = await conn.fetchval(
        "SELECT count(*) FROM cds_library.cds_extractions WHERE status = ANY($1)",
        list(_IN_FLIGHT_STATUSES),
    )
    if in_flight:
        raise PublishRefused(
            f"refusing to publish: {in_flight} extraction(s) are queued/running -- their "
            "packets would fail identity checks the moment the new manifest becomes current "
            "(ship plan risk 4). Wait for them to finish and retry."
        )


async def _count_packets_that_will_flip(
    conn: asyncpg.Connection, compiled: CompiledManifest
) -> int:
    """Active packets that currently read `current_definition_match = true`
    (against the still-current manifest) but would read `false` once
    `compiled`'s domain hashes become current -- i.e. what §0.5's caveat will
    newly cover the moment this manifest is published."""
    rows = await conn.fetch(
        "SELECT domain_id, encode(domain_schema_hash, 'hex') AS hash_hex, "
        "current_definition_match FROM cds_library.active_cds_domain_packets"
    )
    return sum(
        1
        for row in rows
        if row["current_definition_match"]
        and row["hash_hex"] != compiled.domain_hashes.get(row["domain_id"])
    )


async def publish(pool: asyncpg.Pool, compiled: CompiledManifest, *, do_publish: bool) -> None:
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(_ADVISORY_LOCK_SQL)
        current_row = await _current_row(conn)
        existing_target = await _existing_target_row(conn, compiled.version)
        if (
            existing_target is not None
            and existing_target["content_sha256"] != compiled.content_sha256
        ):
            raise PublishRefused(
                f"manifest version {compiled.version!r} already exists in "
                f"cds_library.cds_manifests with different content "
                f"(content_sha256={existing_target['content_sha256']}, compiled="
                f"{compiled.content_sha256}) -- 5.x manifests are immutable, this version "
                "cannot be reused for different content"
            )
        domain_diff = diff_domain_hashes(
            current_row["domain_hashes"] if current_row is not None else None, compiled
        )
        flip_count = await _count_packets_that_will_flip(conn, compiled)

        print(f"version:              {compiled.version}")
        print(f"content_sha256:       {compiled.content_sha256}")
        print(f"currently published:  {current_row['version'] if current_row else '(none)'}")
        print(
            f"changed domain hashes ({len(domain_diff.changed_domains)}): "
            f"{', '.join(domain_diff.changed_domains) or '(none)'}"
        )
        print(f"active packets that will flip current_definition_match=false: {flip_count}")

        if not do_publish:
            print("\nDRY RUN -- no write performed. Pass --publish to commit.")
            return  # nothing was written; the transaction commits with no changes

        # Only checked immediately before the actual write: an in-flight
        # extraction started by someone else must not block the read-only
        # diagnostic above, only the write itself (ship plan risk 4).
        await _refuse_if_extraction_in_flight(conn)

        inserted = existing_target is None
        if inserted:
            await conn.execute(
                """INSERT INTO cds_library.cds_manifests
                (version, content_sha256, content, domain_hashes,
                 extractor_contract_version, is_current)
                VALUES ($1, decode($2, 'hex'), $3::jsonb, $4::jsonb, $5, false)""",
                compiled.version,
                compiled.content_sha256,
                compiled.content,
                compiled.domain_hashes,
                compiled.content["extraction_contract_version"],
            )
        await conn.execute(
            "UPDATE cds_library.cds_manifests SET is_current = false "
            "WHERE is_current AND version <> $1",
            compiled.version,
        )
        await conn.execute(
            "UPDATE cds_library.cds_manifests SET is_current = true WHERE version = $1",
            compiled.version,
        )
        result_row = await conn.fetchrow(
            "SELECT version, encode(content_sha256, 'hex') AS content_sha256, is_current "
            "FROM cds_library.cds_manifests WHERE version = $1",
            compiled.version,
        )

    print(
        f"\nPUBLISHED: version={result_row['version']} "
        f"content_sha256={result_row['content_sha256']} is_current={result_row['is_current']}"
    )


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--publish",
        action="store_true",
        help="actually commit the publish (default is a dry run that only prints the diff)",
    )
    return parser.parse_args(argv)


async def main(argv: list[str]) -> int:
    args = parse_args(argv)
    settings = get_settings()
    if not settings.db_pipeline_dsn:
        print("COUNSELLE_DB_PIPELINE_DSN is not set -- cannot publish.", file=sys.stderr)
        return 1

    try:
        compiled = compile_manifest(CDS_CONFIG_DIR)
    except ManifestError as error:
        print(f"MANIFEST COMPILE FAILED: {error}", file=sys.stderr)
        return 1

    pool = await create_pool(dsn=settings.db_pipeline_dsn, settings=settings)
    try:
        await publish(pool, compiled, do_publish=args.publish)
    except PublishRefused as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        return 1
    finally:
        await pool.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv[1:])))
