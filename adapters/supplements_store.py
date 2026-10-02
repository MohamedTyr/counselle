"""Reads and writes ``counselle.supplement_schools`` / ``supplement_prompts``."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

import asyncpg

from domain.supplements import SupplementPrompt


@dataclass(frozen=True)
class StoredSchool:
    unitid: int
    status: str
    block_sha256: str | None
    prompts_sha256: str
    checked: str
    checked_on: date | None


@dataclass(frozen=True)
class SchoolRow:
    """Everything one school's row holds, as sync computed it."""

    unitid: int
    status: str
    source_url: str
    source_heading: str
    block_sha256: str | None
    prompts_sha256: str
    checked: str
    checked_on: date | None
    prompts: list[SupplementPrompt]


async def load_schools(pool: asyncpg.Pool, cycle: str) -> dict[int, StoredSchool]:
    rows = await pool.fetch(
        """
        SELECT school_unitid, status, block_sha256, prompts_sha256, checked, checked_on
        FROM counselle.supplement_schools WHERE cycle = $1
        """,
        cycle,
    )
    return {
        row["school_unitid"]: StoredSchool(
            unitid=row["school_unitid"],
            status=row["status"],
            block_sha256=row["block_sha256"],
            prompts_sha256=row["prompts_sha256"],
            checked=row["checked"],
            checked_on=row["checked_on"],
        )
        for row in rows
    }


async def load_prompts(pool: asyncpg.Pool, cycle: str, unitid: int) -> list[SupplementPrompt]:
    rows = await pool.fetch(
        """
        SELECT prompt, context, word_limit, requirement, group_label, choose_count, applies_to
        FROM counselle.supplement_prompts
        WHERE cycle = $1 AND school_unitid = $2 ORDER BY ordinal
        """,
        cycle,
        unitid,
    )
    return [_prompt(row) for row in rows]


async def mark_observed(pool: asyncpg.Pool, cycle: str, unitids: list[int]) -> None:
    await pool.execute(
        """
        UPDATE counselle.supplement_schools SET observed_at = now()
        WHERE cycle = $1 AND school_unitid = ANY($2::int[])
        """,
        cycle,
        unitids,
    )


async def save_school(pool: asyncpg.Pool, cycle: str, row: SchoolRow, *, changed: bool) -> None:
    """Upsert the school and replace its prompts, all or nothing."""
    async with pool.acquire() as conn, conn.transaction():
        await conn.execute(
            """
            INSERT INTO counselle.supplement_schools
              (school_unitid, cycle, status, source_url, source_heading, block_sha256,
               prompts_sha256, checked, checked_on)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (school_unitid, cycle) DO UPDATE SET
              status = EXCLUDED.status,
              source_url = EXCLUDED.source_url,
              source_heading = EXCLUDED.source_heading,
              block_sha256 = EXCLUDED.block_sha256,
              prompts_sha256 = EXCLUDED.prompts_sha256,
              checked = EXCLUDED.checked,
              checked_on = EXCLUDED.checked_on,
              observed_at = now(),
              changed_at = CASE WHEN $10 THEN now()
                                ELSE counselle.supplement_schools.changed_at END
            """,
            row.unitid,
            cycle,
            row.status,
            row.source_url,
            row.source_heading,
            row.block_sha256,
            row.prompts_sha256,
            row.checked,
            row.checked_on,
            changed,
        )
        await conn.execute(
            "DELETE FROM counselle.supplement_prompts WHERE cycle = $1 AND school_unitid = $2",
            cycle,
            row.unitid,
        )
        await conn.executemany(
            """
            INSERT INTO counselle.supplement_prompts
              (school_unitid, cycle, ordinal, prompt, context, word_limit, requirement,
               group_label, choose_count, applies_to)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            """,
            [
                (
                    row.unitid,
                    cycle,
                    ordinal,
                    p.prompt,
                    p.context,
                    p.word_limit,
                    p.requirement,
                    p.group,
                    p.choose_count,
                    p.applies_to,
                )
                for ordinal, p in enumerate(row.prompts, 1)
            ],
        )


def _prompt(row: Any) -> SupplementPrompt:
    return SupplementPrompt(
        prompt=row["prompt"],
        context=row["context"],
        word_limit=row["word_limit"],
        requirement=row["requirement"],
        group=row["group_label"],
        choose_count=row["choose_count"],
        applies_to=row["applies_to"],
    )
