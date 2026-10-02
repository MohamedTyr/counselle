"""The read-only `search_scholarships` agent tool (plan §7, D12).

It reports what a published record says (the stored rules, dates and
code-computed `closed`/`stale` flags) and never a fit verdict: fit is
computed only in the browser, so there is no second copy of that logic here
to drift from what the student page shows. The code-built `how_to_say_it`
and `note` strings never say "eligible" or "qualify"; admin-entered text
(`summary`, `student_must_check`) passes through verbatim, because rewording
a sponsor's rule would itself be dishonest.
"""

from __future__ import annotations

import datetime as dt
from typing import Any
from uuid import UUID

import asyncpg
from pydantic_ai import Tool

from app.scholarships import rows
from app.scholarships.models import ScholarshipPublic
from app.tool_middleware import ToolMiddlewareContext, process_tool_result
from domain.scholarships.publish import STALE_AFTER_DAYS, deadline_passed, is_stale
from domain.scholarships.types import Award

TOOL_NAME = "search_scholarships"
DEFAULT_LIMIT = 8
MAX_LIMIT = 25
NOT_LISTED_NOTE = "This scholarship is no longer listed."

_AWARD_KIND_WORDS = {
    "varies": "Amount varies",
    "full_tuition": "Full tuition",
    "full_ride": "Full ride",
}

NOT_CHECKED = (
    "Counselle has not checked these rules against the student's profile. "
    "List each rule and let the student confirm it."
)

_SEARCH_SQL = (
    rows.SELECT_SQL
    + """
 WHERE s.status = 'published'
   AND ($1::uuid IS NULL OR s.id IN (
         SELECT scholarship_id FROM counselle.scholarship_saves WHERE user_id = $1))
   AND ($2::text IS NULL
        OR s.name ILIKE $2 ESCAPE '\\' OR s.sponsor ILIKE $2 ESCAPE '\\'
        OR s.summary ILIKE $2 ESCAPE '\\'
        OR array_to_string(s.fields, ' ') ILIKE $2 ESCAPE '\\'
        OR array_to_string(s.other_eligibility, ' ') ILIKE $2 ESCAPE '\\')
 ORDER BY s.deadline_on NULLS LAST, s.name
"""
)

_ONE_SQL = rows.SELECT_SQL + " WHERE s.status = 'published' AND s.id = $1"


def _like_pattern(query: str | None) -> str | None:
    text = (query or "").strip()
    if not text:
        return None
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _money(value: int | None) -> str:
    return f"${value:,}" if value is not None else "an unstated amount"


def award_words(award: Award) -> str:
    if award.kind == "fixed":
        words = _money(award.amount)
    elif award.kind == "range":
        words = f"{_money(award.min)} to {_money(award.max)}"
    else:
        words = _AWARD_KIND_WORDS[award.kind]
    if award.renewable:
        words += f", renewable for {award.years} years" if award.years else ", renewable"
    return words


def render_row(record: ScholarshipPublic, today: dt.date) -> dict[str, Any]:
    deadline = record.deadline
    row: dict[str, Any] = {
        "id": str(record.id),
        "name": record.name,
        "sponsor": record.sponsor,
        "summary": record.summary,
        "award": award_words(record.award),
        "deadline": deadline.date.isoformat() if deadline.date else "rolling",
        "closed": deadline_passed(deadline, today),
    }
    if deadline.kind == "fixed" and deadline.date is not None:
        row["days_until_deadline"] = (deadline.date - today).days
    if deadline.opens_on is not None:
        row["opens_on"] = deadline.opens_on.isoformat()
    row["rules"] = [rule.model_dump(mode="json") for rule in record.eligibility]
    row["student_must_check"] = list(record.other_eligibility)
    if record.fields:
        row["fields"] = list(record.fields)
    row["requirements"] = record.requirements.model_dump(mode="json")
    row["apply_url"] = record.apply_url
    row["last_checked_on"] = record.last_checked_on.isoformat()
    row["stale"] = is_stale(record.last_checked_on, today)
    return row


def _one_how_to_say_it(row: dict[str, Any]) -> str:
    parts = [NOT_CHECKED]
    if row["closed"]:
        parts.append(f"Deadline passed on {row['deadline']}; say it is closed this cycle.")
    if row["stale"]:
        parts.append(
            f"Last checked on {row['last_checked_on']}, more than {STALE_AFTER_DAYS} days ago; "
            "tell the student to confirm the details on the sponsor's site."
        )
    return " ".join(parts)


def _list_how_to_say_it(shown: list[dict[str, Any]], total: int, closed_omitted: int) -> str:
    if total == 0:
        parts = ["No listed scholarships match."]
    else:
        parts = [NOT_CHECKED]
        if total > len(shown):
            parts.append(f"Showing {len(shown)} of {total} matches; say there are more.")
        if any(row["closed"] for row in shown):
            parts.append(
                "Rows with closed: true have passed their deadline; never present them as open."
            )
        if any(row["stale"] for row in shown):
            parts.append(
                "Rows with stale: true may be out of date; tell the student to confirm them on the "
                "sponsor's site."
            )
    if closed_omitted:
        parts.append(f"{closed_omitted} closed scholarships were left out.")
    return " ".join(parts)


async def _find_one(pool: asyncpg.Pool, scholarship_id: str, today: dt.date) -> dict[str, Any]:
    try:
        key = UUID(scholarship_id)
    except ValueError:
        return {"found": False, "note": NOT_LISTED_NOTE}
    record = await pool.fetchrow(_ONE_SQL, key)
    if record is None:
        return {"found": False, "note": NOT_LISTED_NOTE}
    row = render_row(rows.public_from_row(record), today)
    return {"found": True, "scholarship": row, "how_to_say_it": _one_how_to_say_it(row)}


async def search(
    pool: asyncpg.Pool,
    user_id: UUID,
    *,
    query: str | None = None,
    saved_only: bool = False,
    scholarship_id: str | None = None,
    include_closed: bool = False,
    limit: int = DEFAULT_LIMIT,
    today: dt.date | None = None,
) -> dict[str, Any]:
    """The tool's payload, before result middleware."""
    today = today or dt.datetime.now(dt.UTC).date()
    if scholarship_id:
        return await _find_one(pool, scholarship_id, today)
    records = await pool.fetch(_SEARCH_SQL, user_id if saved_only else None, _like_pattern(query))
    matching = [render_row(rows.public_from_row(record), today) for record in records]
    keep_closed = include_closed or saved_only
    kept = matching if keep_closed else [row for row in matching if not row["closed"]]
    shown = kept[: max(1, min(limit, MAX_LIMIT))]
    closed_omitted = len(matching) - len(kept)
    return {
        "scholarships": shown,
        "total_matching": len(kept),
        "truncated": len(kept) > len(shown),
        "closed_omitted": closed_omitted,
        "how_to_say_it": _list_how_to_say_it(shown, len(kept), closed_omitted),
    }


def build_scholarship_tools(
    app_pool: asyncpg.Pool, user_id: UUID, overflow: ToolMiddlewareContext | None
) -> list[Tool[Any]]:
    """The scholarship tools for one authenticated chat turn."""

    async def search_scholarships(
        query: str | None = None,
        saved_only: bool = False,
        scholarship_id: str | None = None,
        include_closed: bool = False,
        limit: int = DEFAULT_LIMIT,
    ) -> dict[str, Any]:
        """Look up scholarships listed on Counselle's Scholarships page, or the
        student's saved ones, and report what each record states.

        Each row carries the award in words, the deadline (a date or "rolling"),
        `closed` (the deadline has passed), the structured `rules` exactly as
        stored (for example {"kind": "state", "any_of": ["TX"]} or
        {"kind": "gpa_min", "value": 3.0}), `student_must_check` (the sponsor's
        other conditions, verbatim), `last_checked_on` and `stale` (not checked
        against the sponsor's site for a long time). Follow `how_to_say_it`.

        Honesty rules:
        - Never tell the student they qualify or are eligible for a scholarship.
          Counselle has not compared these rules with their profile here. List
          the rules in plain words and let the student confirm each one; the
          Scholarships page shows their own fit read.
        - Never infer ethnicity, gender, religion or any other attribute from
          anything the student said. Read `student_must_check` lines out as
          written.
        - Never present a row with closed: true as open.
        - If `truncated` is true, say there are more matches than you listed.

        Args:
            query: Words to match in the name, sponsor, summary, fields of study
                or other conditions (e.g. "engineering", "Texas"). Omit to list.
            saved_only: Only the student's saved scholarships, including closed
                ones.
            scholarship_id: One scholarship's id, when the student asked about a
                specific one (an "Ask Counselle" request includes it).
            include_closed: Include scholarships whose deadline has passed.
            limit: Maximum rows, soonest deadline first (default 8, max 25).
        """
        payload = await search(
            app_pool,
            user_id,
            query=query,
            saved_only=saved_only,
            scholarship_id=scholarship_id,
            include_closed=include_closed,
            limit=limit,
        )
        return process_tool_result(payload, overflow, tool_name=TOOL_NAME)  # type: ignore[no-any-return]

    return [Tool(search_scholarships, takes_ctx=False, name=TOOL_NAME)]


__all__ = ["award_words", "build_scholarship_tools", "render_row", "search"]
