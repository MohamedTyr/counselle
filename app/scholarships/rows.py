"""The only row <-> model mapping for `counselle.scholarships` (plan D7).

DB columns are flat; the API nests `award`, `deadline` and `requirements`.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.scholarships.models import AdminScholarship, ScholarshipPublic
from domain.scholarships.types import ScholarshipDraft, ScholarshipStatus

#: Every editable column, in the order `columns_from_draft` returns them.
EDITABLE_COLUMNS: tuple[str, ...] = (
    "name",
    "sponsor",
    "summary",
    "apply_url",
    "source_url",
    "logo_url",
    "award_kind",
    "award_amount",
    "award_min",
    "award_max",
    "renewable",
    "renewal_years",
    "awards_count",
    "deadline_kind",
    "deadline_on",
    "opens_on",
    "recurs_annually",
    "basis",
    "fields",
    "eligibility",
    "other_eligibility",
    "essays",
    "recommendations",
    "needs_transcript",
    "needs_financial_docs",
    "needs_interview",
    "last_checked_on",
)

#: The admin read: every column plus the last editor's email.
SELECT_SQL = (
    "SELECT s.id, s.status, s.version, s.created_at, s.updated_at, "
    + ", ".join(f"s.{column}" for column in EDITABLE_COLUMNS)
    + ", u.email AS updated_by_email"
    + " FROM counselle.scholarships s LEFT JOIN counselle.users u ON u.id = s.updated_by"
)


def draft_from_row(row: Mapping[str, Any]) -> ScholarshipDraft:
    return ScholarshipDraft.model_validate(_nested(row))


def _nested(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "name": row["name"],
        "sponsor": row["sponsor"],
        "summary": row["summary"],
        "apply_url": row["apply_url"],
        "source_url": row["source_url"],
        "logo_url": row["logo_url"],
        "award": {
            "kind": row["award_kind"],
            "amount": row["award_amount"],
            "min": row["award_min"],
            "max": row["award_max"],
            "renewable": row["renewable"],
            "years": row["renewal_years"],
            "awards_count": row["awards_count"],
        },
        "deadline": {
            "kind": row["deadline_kind"],
            "date": row["deadline_on"],
            "opens_on": row["opens_on"],
            "recurs_annually": row["recurs_annually"],
        },
        "basis": list(row["basis"]),
        "fields": list(row["fields"]),
        "eligibility": row["eligibility"],
        "other_eligibility": list(row["other_eligibility"]),
        "requirements": {
            "essays": row["essays"],
            "recommendations": row["recommendations"],
            "transcript": row["needs_transcript"],
            "financial_documents": row["needs_financial_docs"],
            "interview": row["needs_interview"],
        },
        "last_checked_on": row["last_checked_on"],
    }


def public_from_row(row: Mapping[str, Any]) -> ScholarshipPublic:
    return ScholarshipPublic.model_validate(
        {**_nested(row), "id": row["id"], "created_at": row["created_at"]}
    )


def admin_from_row(row: Mapping[str, Any]) -> AdminScholarship:
    return AdminScholarship.model_validate(
        {
            **_nested(row),
            "id": row["id"],
            "created_at": row["created_at"],
            "status": row["status"],
            "version": row["version"],
            "updated_at": row["updated_at"],
            "updated_by_email": row["updated_by_email"],
        }
    )


def columns_from_draft(draft: ScholarshipDraft) -> list[Any]:
    """Values for `EDITABLE_COLUMNS`, in order."""
    award, deadline, requirements = draft.award, draft.deadline, draft.requirements
    return [
        draft.name,
        draft.sponsor,
        draft.summary,
        draft.apply_url,
        draft.source_url,
        draft.logo_url,
        award.kind,
        award.amount,
        award.min,
        award.max,
        award.renewable,
        award.years,
        award.awards_count,
        deadline.kind,
        deadline.date,
        deadline.opens_on,
        deadline.recurs_annually,
        list(draft.basis),
        list(draft.fields),
        [rule.model_dump(mode="json") for rule in draft.eligibility],
        list(draft.other_eligibility),
        [essay.model_dump(mode="json") for essay in requirements.essays],
        requirements.recommendations,
        requirements.transcript,
        requirements.financial_documents,
        requirements.interview,
        draft.last_checked_on,
    ]


def snapshot(draft: ScholarshipDraft, status: ScholarshipStatus) -> dict[str, Any]:
    """A revision snapshot: the editable fields plus status (plan §3.3)."""
    return {**draft.model_dump(mode="json"), "status": status}


__all__ = [
    "EDITABLE_COLUMNS",
    "SELECT_SQL",
    "admin_from_row",
    "columns_from_draft",
    "draft_from_row",
    "public_from_row",
    "snapshot",
]
