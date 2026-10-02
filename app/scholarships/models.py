"""Wire models for the scholarship routes (plan §5).

The editable fields come from `domain.scholarships.types.ScholarshipDraft`
(`extra="forbid"`); these add what each route reads or returns.
`frontend/src/api/scholarships/types.ts` is the hand-maintained mirror.
"""

from __future__ import annotations

import datetime as dt
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from domain.scholarships.types import ScholarshipDraft, ScholarshipStatus

RevisionAction = Literal[
    "create", "update", "publish", "unpublish", "archive", "restore", "checked"
]


class ScholarshipCreateIn(ScholarshipDraft):
    status: ScholarshipStatus = "draft"


class ScholarshipUpdateIn(ScholarshipCreateIn):
    """A full replacement of the editable fields plus status."""

    expected_version: int


class StatusChangeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: ScholarshipStatus
    expected_version: int | None = None


class _Record(ScholarshipDraft):
    id: UUID
    created_at: dt.datetime


class ScholarshipPublic(_Record):
    """What students get. The publish CHECK forbids a null `last_checked_on`."""

    last_checked_on: dt.date


class ScholarshipList(BaseModel):
    items: list[ScholarshipPublic]


class AdminScholarship(_Record):
    status: ScholarshipStatus
    version: int
    updated_at: dt.datetime
    updated_by_email: str | None


class RevisionOut(BaseModel):
    version: int
    action: RevisionAction
    actor_email: str | None
    created_at: dt.datetime
    #: Top-level snapshot keys that differ from the previous revision.
    changed: list[str]
    #: Plain JSON, so an old snapshot never fails to parse after a model change.
    snapshot: dict[str, Any]


class SavedIds(BaseModel):
    ids: list[UUID]


__all__ = [
    "AdminScholarship",
    "RevisionAction",
    "RevisionOut",
    "SavedIds",
    "ScholarshipCreateIn",
    "ScholarshipList",
    "ScholarshipPublic",
    "ScholarshipUpdateIn",
    "StatusChangeIn",
]
