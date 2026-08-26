#!/usr/bin/env python3
"""Dispose of the 16 polluted ``cds_school_years`` rows a 2026-08-18
dogfooding session left behind (SHIP-PLAN.md §0.11, Phase 1.0).

Four disposal mechanisms for four distinct situations -- do not apply one
mechanism to all 16 rows uniformly, the years and states genuinely differ:

(a) 12 fabricated-year Alabama A&M rows (school_year_id 4008, 4009, 4011,
    4012, 4013, 4020, 4021, 4022, 4024, 4028, 4029, 4030 -- years 2091-2195,
    none legitimate): reject each live candidate document through the
    existing, already-legal service path (``app.cds.service_review.
    reject_document``, the same function the admin API's reject endpoint
    calls), then retire the slot. Row 4009 has no candidate (its two
    documents are already orphaned/invalidated) -- retire only.
(b) Amherst College (school_year_id=4015, document_id=2013) -- active,
    never a candidate, honesty-critical: it is live in the student read
    path right now under a fabricated year (2091), serving 2 real packets
    (class_size, identity). Discarded via the new
    ``cds_store.discard_active_document`` (invalidate the document, clear
    the active pointer, retire the slot -- one transaction).
(c) Stanford (school_year_id=4026) and Dartmouth (school_year_id=4027) --
    real years (2025, 2024) contaminated by a dogfooding candidate upload.
    Reject the candidate via the same path as (a). Do NOT retire -- these
    are legitimate CDS years a future real upload may still need.
(d) Yale University (school_year_id=3, document_id=3) -- a real school's
    real next CDS year (2025), stuck on 6 consecutive
    ``identity_year_mismatch`` failures since 2026-07-14. Per owner
    decision: reject the stuck candidate via the same path as (a)/(c). Do
    NOT retire -- 2025 is real; Yale may still need to re-upload.

Usage::

    uv run python scripts/dispose_cds_pollution.py             # dry-run (default)
    uv run python scripts/dispose_cds_pollution.py --execute    # writes

Reuses the app's own write path -- ``app.cds.service_review.reject_document``
for every reject -- and only adds bare adapter calls for the two writes that
have no service-layer equivalent yet: ``cds_store.retire_school_year`` and
``cds_store.discard_active_document``. This is UPDATE-only throughout:
``cds_library_app`` holds no DELETE grant on any table (verified live,
§0.11).
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from dataclasses import dataclass
from uuid import UUID

import asyncpg

from adapters import cds_store
from app.cds import service_review
from app.cds.errors import CdsAdminValidationError
from config.settings import get_settings
from counselle_db.db import create_pool

# school_year_id -> document_id for the 11 Alabama A&M rows with a live
# candidate (case a). Row 4009 (year 2092) has no candidate -- see
# _RETIRE_ONLY below.
_REJECT_AND_RETIRE: dict[int, int] = {
    4008: 2008,
    4011: 2010,
    4012: 2011,
    4013: 2012,
    4020: 2015,
    4021: 2016,
    4022: 2017,
    4024: 2018,
    4028: 2021,
    4029: 2022,
    4030: 2023,
}

# Row 4009: no candidate document to reject -- retire the orphaned slot only.
_RETIRE_ONLY: tuple[int, ...] = (4009,)

# Amherst College -- case (b), the honesty-critical one.
_DISCARD_ACTIVE_SCHOOL_YEAR_ID = 4015
_DISCARD_ACTIVE_DOCUMENT_ID = 2013

# Stanford + Dartmouth -- case (c): reject the contaminated candidate, but
# the year is real, so do NOT retire the slot.
_REJECT_ONLY: dict[int, int] = {
    4026: 2019,  # Stanford University, 2025
    4027: 2020,  # Dartmouth College, 2024
}

# Yale University -- case (d): owner decision is to reject the stuck
# candidate (6x identity_year_mismatch since 2026-07-14). 2025 is Yale's
# real next CDS year -- do NOT retire.
_YALE_SCHOOL_YEAR_ID = 3
_YALE_DOCUMENT_ID = 3

_REJECT_REASON = (
    "SHIP-PLAN §1.0 pollution disposal: 2026-08-18 dogfooding-session artifact, "
    "never a legitimate CDS document for this school-year slot"
)
_YALE_REJECT_REASON = (
    "SHIP-PLAN §1.0(d) owner decision: candidate stuck on 6x consecutive "
    "identity_year_mismatch since 2026-07-14, unresolved for 6 weeks -- rejected, "
    "not retried. 2025 remains Yale's legitimate next CDS year; the slot is not retired."
)


@dataclass(frozen=True)
class _PlannedAction:
    school_year_id: int
    label: str
    steps: tuple[str, ...]


def _plan_actions() -> list[_PlannedAction]:
    actions: list[_PlannedAction] = []
    for school_year_id, document_id in sorted(_REJECT_AND_RETIRE.items()):
        actions.append(
            _PlannedAction(
                school_year_id=school_year_id,
                label=f"school_year={school_year_id} document={document_id} (case a)",
                steps=(
                    f"reject_document(document_id={document_id}) "
                    "via app.cds.service_review.reject_document",
                    f"retire_school_year(school_year_id={school_year_id})",
                ),
            )
        )
    for school_year_id in _RETIRE_ONLY:
        actions.append(
            _PlannedAction(
                school_year_id=school_year_id,
                label=f"school_year={school_year_id} (case a, orphaned slot, no candidate)",
                steps=(f"retire_school_year(school_year_id={school_year_id})",),
            )
        )
    actions.append(
        _PlannedAction(
            school_year_id=_DISCARD_ACTIVE_SCHOOL_YEAR_ID,
            label=(
                f"school_year={_DISCARD_ACTIVE_SCHOOL_YEAR_ID} "
                f"document={_DISCARD_ACTIVE_DOCUMENT_ID} (case b, Amherst, honesty-critical)"
            ),
            steps=(
                f"discard_active_document(school_year_id={_DISCARD_ACTIVE_SCHOOL_YEAR_ID}, "
                f"document_id={_DISCARD_ACTIVE_DOCUMENT_ID}) "
                "-- invalidate document, clear active_document_id, retire slot",
            ),
        )
    )
    for school_year_id, document_id in sorted(_REJECT_ONLY.items()):
        actions.append(
            _PlannedAction(
                school_year_id=school_year_id,
                label=f"school_year={school_year_id} document={document_id} (case c, NOT retired)",
                steps=(
                    f"reject_document(document_id={document_id}) "
                    "via app.cds.service_review.reject_document",
                ),
            )
        )
    actions.append(
        _PlannedAction(
            school_year_id=_YALE_SCHOOL_YEAR_ID,
            label=(
                f"school_year={_YALE_SCHOOL_YEAR_ID} document={_YALE_DOCUMENT_ID} "
                "(case d, Yale, NOT retired)"
            ),
            steps=(
                f"reject_document(document_id={_YALE_DOCUMENT_ID}) "
                "via app.cds.service_review.reject_document",
            ),
        )
    )
    return actions


async def _pick_actor_user_id(app_pool: asyncpg.Pool) -> UUID:
    async with app_pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id FROM counselle.users WHERE is_superuser ORDER BY id LIMIT 1"
        )
    if row is None:
        raise SystemExit("no superuser found in counselle.users -- cannot attribute audit rows")
    return row["id"]  # type: ignore[no-any-return]


async def _reject(
    app_pool: asyncpg.Pool,
    pipeline_pool: asyncpg.Pool,
    *,
    document_id: int,
    actor_user_id: UUID,
    reason: str,
) -> None:
    try:
        await service_review.reject_document(
            app_pool,
            pipeline_pool,
            document_id=document_id,
            actor_user_id=actor_user_id,
            reason=reason,
        )
    except CdsAdminValidationError as exc:
        raise SystemExit(f"reject_document({document_id}) refused: {exc}") from exc


async def _execute(app_pool: asyncpg.Pool, pipeline_pool: asyncpg.Pool) -> None:
    actor_user_id = await _pick_actor_user_id(app_pool)
    print(f"Attributing audit rows to actor_user_id={actor_user_id}\n")

    for school_year_id, document_id in sorted(_REJECT_AND_RETIRE.items()):
        print(f"[case a] rejecting document {document_id} (school_year {school_year_id})")
        await _reject(
            app_pool, pipeline_pool, document_id=document_id, actor_user_id=actor_user_id,
            reason=_REJECT_REASON,
        )
        print(f"[case a] retiring school_year {school_year_id}")
        async with pipeline_pool.acquire() as conn:
            await cds_store.retire_school_year(conn, school_year_id=school_year_id)

    for school_year_id in _RETIRE_ONLY:
        print(f"[case a] retiring orphaned school_year {school_year_id} (no candidate)")
        async with pipeline_pool.acquire() as conn:
            await cds_store.retire_school_year(conn, school_year_id=school_year_id)

    print(
        f"[case b] discarding active document {_DISCARD_ACTIVE_DOCUMENT_ID} "
        f"(school_year {_DISCARD_ACTIVE_SCHOOL_YEAR_ID}, Amherst College)"
    )
    async with pipeline_pool.acquire() as conn:
        await cds_store.discard_active_document(
            conn,
            school_year_id=_DISCARD_ACTIVE_SCHOOL_YEAR_ID,
            document_id=_DISCARD_ACTIVE_DOCUMENT_ID,
        )

    for school_year_id, document_id in sorted(_REJECT_ONLY.items()):
        print(
            f"[case c] rejecting document {document_id} (school_year {school_year_id}), "
            "slot NOT retired"
        )
        await _reject(
            app_pool, pipeline_pool, document_id=document_id, actor_user_id=actor_user_id,
            reason=_REJECT_REASON,
        )

    print(
        f"[case d] rejecting Yale candidate document {_YALE_DOCUMENT_ID} "
        f"(school_year {_YALE_SCHOOL_YEAR_ID}), slot NOT retired"
    )
    await _reject(
        app_pool, pipeline_pool, document_id=_YALE_DOCUMENT_ID, actor_user_id=actor_user_id,
        reason=_YALE_REJECT_REASON,
    )


def _print_dry_run(actions: list[_PlannedAction]) -> None:
    print("DRY RUN -- no writes will be made. Pass --execute to apply.\n")
    for action in actions:
        print(action.label)
        for step in action.steps:
            print(f"  - {step}")
    print(f"\n{len(actions)} school-year rows planned for disposal.")


async def _run(*, execute: bool) -> int:
    settings = get_settings()
    if not settings.db_pipeline_dsn:
        raise SystemExit("COUNSELLE_DB_PIPELINE_DSN is not configured")

    actions = _plan_actions()
    if not execute:
        _print_dry_run(actions)
        return 0

    # counselle_db.db.create_pool, not bare asyncpg.create_pool -- it registers
    # the jsonb codec in _init_connection, without which any cds_library read
    # fails with a pydantic validation error.
    app_pool = await create_pool(dsn=settings.db_app_dsn, settings=settings)
    pipeline_pool = await create_pool(dsn=settings.db_pipeline_dsn, settings=settings)
    try:
        await _execute(app_pool, pipeline_pool)
    finally:
        await app_pool.close()
        await pipeline_pool.close()
    print("\nDone.")
    return 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--execute", action="store_true", help="perform the writes (default is dry-run)"
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    return asyncio.run(_run(execute=args.execute))


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
