"""Read-only school reference catalog assembly for one application cycle."""

from __future__ import annotations

import re

import asyncpg

from app.workspace.models import (
    ReferenceProvenance,
    SchoolEssayPrompt,
    SchoolPromptGroup,
    SchoolReference,
    SchoolRequirement,
)
from counselle_db.catalog import Catalog
from counselle_db.service import get_domain
from domain.envelope import Citation, CitationEnvelope


async def get_school_reference(
    app_pool: asyncpg.Pool,
    catalog: Catalog,
    *,
    unitid: int,
    cycle_year: int | None,
) -> SchoolReference:
    """Load published app-owned facts and compatible pipeline test policy.

    Query failures intentionally propagate. A database failure must never be
    represented as an honestly loaded, empty catalog.
    """
    if cycle_year is None:
        return SchoolReference(status="cycle_required", cycle_year=None)

    async with app_pool.acquire() as conn:
        group_rows = await conn.fetch(
            """
            SELECT * FROM counselle.school_prompt_groups
            WHERE school_unitid = $1 AND cycle_year = $2
              AND state = 'published' AND retired_at IS NULL
            ORDER BY label, id
            """,
            unitid,
            cycle_year,
        )
        prompt_rows = await conn.fetch(
            """
            SELECT * FROM counselle.school_essay_prompts
            WHERE school_unitid = $1 AND cycle_year = $2
              AND state = 'published' AND retired_at IS NULL
              AND (
                group_id IS NULL OR EXISTS (
                  SELECT 1 FROM counselle.school_prompt_groups g
                  WHERE g.id = school_essay_prompts.group_id
                    AND g.school_unitid = school_essay_prompts.school_unitid
                    AND g.cycle_year = school_essay_prompts.cycle_year
                    AND g.state = 'published' AND g.retired_at IS NULL
                )
              )
            ORDER BY ordinal, id
            """,
            unitid,
            cycle_year,
        )
        requirement_rows = await conn.fetch(
            """
            SELECT * FROM counselle.school_requirements
            WHERE school_unitid = $1 AND cycle_year = $2
              AND state = 'published' AND retired_at IS NULL
            ORDER BY kind, id
            """,
            unitid,
            cycle_year,
        )

    test_policy = await _compatible_test_policy(catalog, unitid, cycle_year)
    groups = [_prompt_group(row) for row in group_rows]
    prompts = [_prompt(row) for row in prompt_rows]
    requirements = [_requirement(row) for row in requirement_rows]
    return SchoolReference(
        status="loaded",
        cycle_year=cycle_year,
        populated=bool(
            groups or prompts or requirements or (test_policy and test_policy.available)
        ),
        prompt_groups=groups,
        prompts=prompts,
        requirements=requirements,
        test_policy=test_policy,
    )


def _provenance(row: asyncpg.Record) -> ReferenceProvenance:
    return ReferenceProvenance(
        source=row["source"],
        source_url=row["source_url"],
        verified_at=row["verified_at"],
        published_at=row["published_at"],
    )


def _prompt_group(row: asyncpg.Record) -> SchoolPromptGroup:
    return SchoolPromptGroup(
        id=row["id"],
        school_unitid=row["school_unitid"],
        cycle_year=row["cycle_year"],
        label=row["label"],
        choice_min=row["choice_min"],
        provenance=_provenance(row),
    )


def _prompt(row: asyncpg.Record) -> SchoolEssayPrompt:
    return SchoolEssayPrompt(
        id=row["id"],
        school_unitid=row["school_unitid"],
        cycle_year=row["cycle_year"],
        ordinal=row["ordinal"],
        prompt=row["prompt"],
        word_limit=row["word_limit"],
        applicability=row["applicability"],
        audience=row["audience"],
        group_id=row["group_id"],
        provenance=_provenance(row),
    )


def _requirement(row: asyncpg.Record) -> SchoolRequirement:
    return SchoolRequirement(
        id=row["id"],
        school_unitid=row["school_unitid"],
        cycle_year=row["cycle_year"],
        kind=row["kind"],
        label=row["label"],
        applicability=row["applicability"],
        audience=row["audience"],
        detail=row["detail"],
        provenance=_provenance(row),
    )


async def _compatible_test_policy(
    catalog: Catalog, unitid: int, cycle_year: int
) -> CitationEnvelope | None:
    domain = await get_domain(catalog, unitid, "admissions")
    available = [
        row
        for row in domain.rows
        if row.available and row.ref == "admissions.test_policy_clarification"
    ]
    if not available:
        return None
    row = available[0]
    envelope = CitationEnvelope(
        field=row.ref,
        label=row.label,
        display=row.display or "",
        raw=row.value,
        available=True,
        citation=Citation(source="cds", tier="official", vintage=row.vintage, caveat=None),
    )
    if _vintage_matches_cycle(envelope.citation.vintage, cycle_year):
        return envelope
    caveat = (
        f"Source vintage does not match the {cycle_year - 1}-{str(cycle_year)[-2:]} "
        "application cycle; verify the current policy in the school's application portal."
    )
    return envelope.model_copy(
        update={
            "available": False,
            "display": "not available for this application cycle",
            "raw": None,
            "citation": envelope.citation.model_copy(update={"caveat": caveat}),
        }
    )


def _vintage_matches_cycle(vintage: str, cycle_year: int) -> bool:
    normalized = vintage.replace("–", "-").replace("—", "-")
    prior = cycle_year - 1
    return bool(
        re.search(
            rf"\b{prior}\s*[-/]\s*(?:{cycle_year}|{str(cycle_year)[-2:]})\b",
            normalized,
        )
    )
