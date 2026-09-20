"""`bank-sync`: `settings.sat_bank_path` -> `counselle.sat_*` (plan.md §3.2).

Runs on `COUNSELLE_DB_APP_DSN` (`counselle_app` owns `counselle.*`; the
pipeline role has no grant there) -- every boot, via `scripts/entrypoint.sh`
and `scripts/dev.py::run_stack`, both after migrations. The whole sync is one
transaction guarded by `pg_advisory_xact_lock(hashtextextended('sat_bank_sync',
0))` -- a module-level key, following `app/facts/crawl.py`'s advisory-lock
precedent -- so two instances booting together serialise instead of racing
on the upsert; the lock releases automatically at commit/rollback.

Parsing and the retire-set computation are pure (`_parse_bank_lines`,
`plan_retirements`, `_question_params`, `_content_params`,
`_check_retirement_is_safe`) so they are unit-testable without a database.
Everything that touches asyncpg lives in `_is_noop` / `_apply_sync` /
`run_bank_sync`.

`_check_retirement_is_safe` is a production safety guard, not a test
convenience: it refuses (raises `BankSyncSafetyError`, caught by
`run_bank_sync` like any other sync failure) to retire an implausible share
of a populated live `sat_questions` table in one pass -- the signature of
the wrong bank file being synced against real data.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import logging
import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import asyncpg

from config.settings import Settings
from counselle_db.db import create_pool
from domain.sat.types import AnswerOption, SatQuestion

logger = logging.getLogger(__name__)

#: `pg_advisory_xact_lock(hashtextextended($1, 0))`'s key (plan §3.2).
_ADVISORY_LOCK_KEY = "sat_bank_sync"

#: Production safety guard, not a test convenience: a real bank refresh
#: retires at most a handful of stale ids per run (plan §3.6 G8 "drift" --
#: churn is measured per manifest and is always small next to the ~3,767-
#: question bank). Retiring a large share of a *populated* live table in
#: one sync is never the intended behaviour described in plan §3.2/§3.4 --
#: it is the signature of a wrong bank file being synced against the real
#: database (a fixture bank, a build that silently produced an empty/tiny
#: file, ...). Below `_RETIREMENT_GUARD_MIN_LIVE_ROWS` live rows the ratio
#: check does not apply, so a small dev/test table can still be freely
#: rebuilt end to end.
_RETIREMENT_GUARD_MIN_LIVE_ROWS = 50
_RETIREMENT_GUARD_MAX_RATIO = 0.3


class BankSyncSafetyError(RuntimeError):
    """Refused a sync that would retire an implausible share of the live
    `sat_questions` table -- see `_RETIREMENT_GUARD_MIN_LIVE_ROWS` /
    `_RETIREMENT_GUARD_MAX_RATIO` above. Never a reason to fail the boot:
    `run_bank_sync` catches this the same way it catches every other
    sync failure and boots on the bank already in place."""

#: A retiring row's natural key (`external_id` xor `ibn`) is released before
#: the questions upsert when the new bank reassigns that content id to a
#: different canonical `question_id` (plan §3.3 "Duplicates": the old id
#: normally becomes an alias of the new one). `sat_questions` carries a
#: `CHECK ((external_id IS NULL) <> (ibn IS NULL))`, so the freed column
#: can't just go to NULL -- the other column is given a synthetic, per-row
#: sentinel instead, deterministic from `question_id` so it can never
#: collide with a real bank value and never needs cleanup.
_RETIRED_IBN_SENTINEL_PREFIX = "sat-bank-sync:retired:"
_RETIRED_EXTERNAL_ID_NAMESPACE = uuid.UUID("6f2b6c0a-6c1e-4c7a-9f2a-3a6b1a9d3e21")


def _retired_ibn_sentinel(question_id: str) -> str:
    return f"{_RETIRED_IBN_SENTINEL_PREFIX}{question_id}"


def _retired_external_id_sentinel(question_id: str) -> uuid.UUID:
    return uuid.uuid5(_RETIRED_EXTERNAL_ID_NAMESPACE, question_id)

_UPSERT_QUESTION_SQL = """
    INSERT INTO counselle.sat_questions
        (question_id, external_id, ibn, u_id, source, module, domain_cd,
         skill_cd, score_band, difficulty, program, item_type, in_bluebook,
         cb_created_at, cb_updated_at, content_sha256, retired_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NULL)
    ON CONFLICT (question_id) DO UPDATE SET
        external_id = EXCLUDED.external_id,
        ibn = EXCLUDED.ibn,
        u_id = EXCLUDED.u_id,
        source = EXCLUDED.source,
        module = EXCLUDED.module,
        domain_cd = EXCLUDED.domain_cd,
        skill_cd = EXCLUDED.skill_cd,
        score_band = EXCLUDED.score_band,
        difficulty = EXCLUDED.difficulty,
        program = EXCLUDED.program,
        item_type = EXCLUDED.item_type,
        in_bluebook = EXCLUDED.in_bluebook,
        cb_created_at = EXCLUDED.cb_created_at,
        cb_updated_at = EXCLUDED.cb_updated_at,
        content_sha256 = EXCLUDED.content_sha256,
        retired_at = NULL
"""

_UPSERT_CONTENT_SQL = """
    INSERT INTO counselle.sat_question_content
        (question_id, stimulus, stem, answer_options, correct_answers, rationale)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (question_id) DO UPDATE SET
        stimulus = EXCLUDED.stimulus,
        stem = EXCLUDED.stem,
        answer_options = EXCLUDED.answer_options,
        correct_answers = EXCLUDED.correct_answers,
        rationale = EXCLUDED.rationale
"""

_UPSERT_ALIAS_SQL = """
    INSERT INTO counselle.sat_question_aliases (alias_id, question_id)
    VALUES ($1, $2)
    ON CONFLICT (alias_id) DO UPDATE SET question_id = EXCLUDED.question_id
"""

_UPSERT_META_SQL = """
    INSERT INTO counselle.sat_bank_meta (id, content_sha256, question_count, fetched_at)
    VALUES (true, $1, $2, $3)
    ON CONFLICT (id) DO UPDATE SET
        content_sha256 = EXCLUDED.content_sha256,
        question_count = EXCLUDED.question_count,
        fetched_at = EXCLUDED.fetched_at,
        synced_at = now()
"""


class BankFileError(ValueError):
    """`bank.jsonl.gz` does not match the shape its own contract promises --
    never expected against a build this module trusts, so this is left to
    surface as a hard failure rather than swallowed (the sha256 check below
    is the guard against a corrupted or truncated file)."""


@dataclass(frozen=True)
class _BankRow:
    question: SatQuestion
    aliases: tuple[str, ...]


def _parse_bank_lines(raw: bytes) -> tuple[_BankRow, ...]:
    """Decompressed `bank.jsonl.gz` bytes -> rows, in file order (the
    contract guarantees the file is sorted by `question_id`)."""
    rows: list[_BankRow] = []
    for lineno, line in enumerate(raw.decode("utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise BankFileError(f"bank.jsonl.gz line {lineno} is not valid JSON") from exc
        try:
            question = SatQuestion.model_validate(payload["question"])
        except Exception as exc:
            raise BankFileError(f"bank.jsonl.gz line {lineno}: invalid question") from exc
        aliases = tuple(payload.get("aliases") or ())
        rows.append(_BankRow(question=question, aliases=aliases))
    return tuple(rows)


def _verify_content_sha256(gz_bytes: bytes, expected_sha256: str) -> bool:
    return hashlib.sha256(gz_bytes).hexdigest() == expected_sha256


def plan_retirements(
    existing_live_ids: Iterable[str], new_ids: Iterable[str]
) -> frozenset[str]:
    """Question ids currently live (`retired_at IS NULL`) that are absent
    from the new bank (plan §3.2: "set `retired_at` on rows absent from the
    new bank"). The reverse -- clearing `retired_at` on a row that
    returned -- needs no separate plan: the questions upsert above sets
    `retired_at = NULL` unconditionally for every row present in the new
    bank, whether it was previously retired or not."""
    return frozenset(existing_live_ids) - frozenset(new_ids)


def _check_retirement_is_safe(*, live_count: int, retire_count: int) -> None:
    """Raises `BankSyncSafetyError` if retiring `retire_count` of
    `live_count` currently-live rows looks like a wrong bank synced against
    real data rather than the intended small drift (plan §3.6 G8). Pure so
    the threshold is unit-testable without a database."""
    if live_count < _RETIREMENT_GUARD_MIN_LIVE_ROWS or retire_count == 0:
        return
    ratio = retire_count / live_count
    if ratio > _RETIREMENT_GUARD_MAX_RATIO:
        raise BankSyncSafetyError(
            f"refusing to retire {retire_count} of {live_count} live sat_questions rows "
            f"({ratio:.0%}, over the {_RETIREMENT_GUARD_MAX_RATIO:.0%} guard) -- this looks "
            "like the wrong bank file synced against real data, not the bank's own drift; "
            "sync aborted, nothing changed"
        )


def _answer_options_json(options: tuple[AnswerOption, ...]) -> list[dict[str, Any]]:
    return [opt.model_dump(mode="json") for opt in options]


def _question_params(q: SatQuestion) -> tuple[Any, ...]:
    return (
        q.question_id,
        q.external_id,
        q.ibn,
        q.u_id,
        q.source,
        q.module,
        q.domain_cd,
        q.skill_cd,
        q.score_band,
        q.difficulty,
        q.program,
        q.item_type,
        q.in_bluebook,
        q.cb_created_at,
        q.cb_updated_at,
        q.content_sha256,
    )


def _content_params(q: SatQuestion) -> tuple[Any, ...]:
    return (
        q.question_id,
        q.stimulus,
        q.stem,
        _answer_options_json(q.answer_options),
        list(q.correct_answers),
        q.rationale,
    )


async def _is_noop(conn: asyncpg.Connection, *, manifest_sha256: str) -> bool:
    """The no-op test (plan §3.2): manifest sha matches the recorded sync
    AND the live row count still matches what that sync produced -- a
    truncated table or a swapped file re-syncs. Two cheap queries; the file
    is never decompressed or parsed for this check."""
    meta = await conn.fetchrow(
        "SELECT content_sha256, question_count FROM counselle.sat_bank_meta LIMIT 1"
    )
    if meta is None or meta["content_sha256"] != manifest_sha256:
        return False
    live_count = await conn.fetchval(
        "SELECT count(*) FROM counselle.sat_questions WHERE retired_at IS NULL"
    )
    return bool(live_count == meta["question_count"])


async def _release_colliding_natural_keys(
    conn: asyncpg.Connection, *, rows: tuple[_BankRow, ...]
) -> None:
    """A content id can move to a different canonical `question_id` between
    syncs (plan §3.3 "Duplicates"): the new bank files it under Q2 while
    some other row Q1 -- Q1 may or may not itself be in the new bank, e.g.
    two surviving rows can simply swap keys, or a longer rotation among
    several surviving rows -- still holds it as its natural key.
    `ON CONFLICT (question_id)` doesn't catch that: upserting Q2 would raise
    a `UniqueViolation` on `external_id`/`ibn`, and those constraints aren't
    `DEFERRABLE`.

    The release is per-row, not per-bank: for every (question_id,
    external_id, ibn) the new bank wants, free that key from *any* row
    currently holding it under a *different* question_id, in one set-based
    statement (`unnest`, so the whole set is compared against the table's
    pre-statement snapshot -- a swap or an N-way rotation resolves in a
    single pass, no ordering dependency). The holder's own upsert below then
    overwrites the sentinel with its real value in the same transaction; a
    row that lost its key and stays retired (plan §3.2's original case)
    keeps the sentinel, satisfying `sat_questions`' xor `CHECK` -- never
    deletes a row (plan: "Never deletes"). A no-change sync matches nothing,
    since a row already holding its own wanted key is excluded by
    `question_id <> incoming.question_id`."""
    question_ids = [r.question.question_id for r in rows]
    external_ids = [r.question.external_id for r in rows]
    ibns = [r.question.ibn for r in rows]

    colliding_external = await conn.fetch(
        """
        SELECT DISTINCT q.question_id
        FROM counselle.sat_questions q,
             unnest($1::text[], $2::uuid[]) AS incoming(question_id, external_id)
        WHERE q.external_id = incoming.external_id
          AND q.question_id <> incoming.question_id
        """,
        question_ids,
        external_ids,
    )
    if colliding_external:
        await conn.executemany(
            "UPDATE counselle.sat_questions SET external_id = NULL, ibn = $2 "
            "WHERE question_id = $1",
            [
                (r["question_id"], _retired_ibn_sentinel(r["question_id"]))
                for r in colliding_external
            ],
        )

    colliding_ibn = await conn.fetch(
        """
        SELECT DISTINCT q.question_id
        FROM counselle.sat_questions q,
             unnest($1::text[], $2::text[]) AS incoming(question_id, ibn)
        WHERE q.ibn = incoming.ibn
          AND q.question_id <> incoming.question_id
        """,
        question_ids,
        ibns,
    )
    if colliding_ibn:
        await conn.executemany(
            "UPDATE counselle.sat_questions SET ibn = NULL, external_id = $2 "
            "WHERE question_id = $1",
            [
                (r["question_id"], _retired_external_id_sentinel(r["question_id"]))
                for r in colliding_ibn
            ],
        )


async def _apply_sync(
    conn: asyncpg.Connection,
    *,
    rows: tuple[_BankRow, ...],
    manifest_sha256: str,
    fetched_at: datetime,
    existing_live_ids: frozenset[str] | None = None,
) -> tuple[int, int]:
    """Upserts questions -> content -> aliases (FK order), retires rows
    absent from the new bank, then writes the meta row. Returns
    `(question_count, retired_count)` for the caller's log line.

    `existing_live_ids` defaults to `None`, which preserves this function's
    original behaviour exactly: the live universe is every currently-live
    `sat_questions` row, queried fresh. A caller may instead pass the set of
    ids its own sync should be judged against -- this exists solely so the
    `eeeeee%`-namespaced live tests (`tests/app/sat/test_bank_sync.py`) can
    exercise a real sync end to end, with the retirement-safety guard
    computing its ratio over that reserved namespace rather than the whole
    (now real, thousands-of-rows) table. `run_bank_sync` never passes it."""
    new_ids = frozenset(row.question.question_id for row in rows)
    if existing_live_ids is None:
        existing_live_ids = frozenset(
            r["question_id"]
            for r in await conn.fetch(
                "SELECT question_id FROM counselle.sat_questions WHERE retired_at IS NULL"
            )
        )
    to_retire = plan_retirements(existing_live_ids, new_ids)
    _check_retirement_is_safe(live_count=len(existing_live_ids), retire_count=len(to_retire))

    await _release_colliding_natural_keys(conn, rows=rows)

    # An id the previous bank filed as an alias can become a canonical
    # question_id in this one (plan §3.3): drop the stale alias row so the
    # PK lookup wins over the alias table, without pruning any other alias
    # (old deep links and imported attempts may still use them).
    await conn.execute(
        "DELETE FROM counselle.sat_question_aliases WHERE alias_id = ANY($1::text[])",
        list(new_ids),
    )

    await conn.executemany(_UPSERT_QUESTION_SQL, [_question_params(r.question) for r in rows])
    await conn.executemany(_UPSERT_CONTENT_SQL, [_content_params(r.question) for r in rows])
    alias_params = [(alias, r.question.question_id) for r in rows for alias in r.aliases]
    if alias_params:
        await conn.executemany(_UPSERT_ALIAS_SQL, alias_params)

    if to_retire:
        await conn.execute(
            "UPDATE counselle.sat_questions SET retired_at = now() "
            "WHERE question_id = ANY($1::text[])",
            list(to_retire),
        )

    await conn.execute(_UPSERT_META_SQL, manifest_sha256, len(rows), fetched_at)
    return len(rows), len(to_retire)


async def run_bank_sync(settings: Settings) -> int:
    """The CLI's `bank-sync` subcommand (plan §3.2). Always returns 0 --
    every failure mode here is "boot on the bank the app already has",
    logged, never a startup failure. `scripts/entrypoint.sh` runs this under
    `set -eu` before `exec uvicorn`, so an unexpected exception anywhere in
    the sync (a DB error, a malformed bank row, ...) must not propagate: the
    transaction context manager below rolls back on its way out, and the
    catch-all here logs the traceback and still returns 0."""
    bank_path = settings.sat_bank_path
    manifest_path = bank_path.with_name("MANIFEST.json")
    if not bank_path.exists() or not manifest_path.exists():
        logger.warning("sat bank file not found at %s -- skipping bank-sync", bank_path)
        return 0

    try:
        manifest = json.loads(manifest_path.read_text())
        manifest_sha256 = manifest["content_sha256"]

        pool = await create_pool(dsn=settings.db_app_dsn, settings=settings)
        try:
            async with pool.acquire() as conn, conn.transaction():
                await conn.execute(
                    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", _ADVISORY_LOCK_KEY
                )
                if await _is_noop(conn, manifest_sha256=manifest_sha256):
                    return 0

                gz_bytes = bank_path.read_bytes()
                if not _verify_content_sha256(gz_bytes, manifest_sha256):
                    logger.error(
                        "sat bank file sha256 does not match MANIFEST.json -- leaving %s"
                        " unchanged",
                        "counselle.sat_questions",
                    )
                    return 0

                rows = _parse_bank_lines(gzip.decompress(gz_bytes))
                fetched_at = datetime.fromisoformat(manifest["fetched_at"])
                synced, retired = await _apply_sync(
                    conn, rows=rows, manifest_sha256=manifest_sha256, fetched_at=fetched_at
                )
                logger.info("sat bank synced: %d questions, %d retired", synced, retired)
                return 0
        finally:
            await pool.close()
    except BankSyncSafetyError as exc:
        logger.error("sat bank-sync refused: %s", exc)
        return 0
    except Exception:
        logger.error(
            "sat bank-sync failed unexpectedly -- booting on the bank already in place",
            exc_info=True,
        )
        return 0
