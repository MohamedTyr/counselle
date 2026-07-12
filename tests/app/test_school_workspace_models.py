"""Honesty-critical validation for school reference and tracking contracts."""

from datetime import UTC, date, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.workspace.models import (
    ApplicationCreate,
    ApplicationPatch,
    ChecklistMap,
    SchoolRequirement,
    TaskCreate,
)
from app.workspace.service_reference import _vintage_matches_cycle


def test_new_application_requires_explicit_cycle() -> None:
    with pytest.raises(ValidationError):
        ApplicationCreate(unitid=166027, list_type="Target", round="RD")  # type: ignore[call-arg]


def test_checklist_is_closed_and_statuses_are_kind_specific() -> None:
    with pytest.raises(ValidationError):
        ApplicationPatch(checklist={"teacher_rec": {"status": "submitted"}})
    with pytest.raises(ValidationError):
        ApplicationPatch(checklist={"fee": {"status": "submitted"}})
    assert ApplicationPatch(checklist={"fee": None}).checklist is not None
    assert ChecklistMap(root={}).root == {}


def test_reference_and_task_kinds_are_open_validated_slugs() -> None:
    assert TaskCreate(title="Prepare portfolio", requirement_kind="architecture_portfolio")
    with pytest.raises(ValidationError):
        TaskCreate(title="Bad", requirement_kind="Not A Slug")

    requirement = SchoolRequirement(
        id=uuid4(),
        school_unitid=166027,
        cycle_year=2027,
        kind="architecture_portfolio",
        label="Architecture portfolio",
        applicability="conditional",
        provenance={
            "source": "Admissions office",
            "source_url": "https://example.edu/admissions",
            "verified_at": date(2026, 7, 12),
            "published_at": datetime.now(UTC),
        },
    )
    assert requirement.kind == "architecture_portfolio"

    with pytest.raises(ValidationError):
        SchoolRequirement(
            **requirement.model_dump(exclude={"kind", "detail"}),
            kind="fee",
            detail={"amount_cents": -1},
        )
    with pytest.raises(ValidationError):
        SchoolRequirement(
            **requirement.model_dump(exclude={"kind", "detail"}),
            kind="teacher_rec",
            detail={"count": 2, "receipt_confirmed": True},
        )
    for kind, detail in (
        ("form", {"form_url": "http://insecure.example"}),
        ("testing", {"policy": "recommended"}),
        ("css_profile", {"deadline": "not-a-date"}),
    ):
        with pytest.raises(ValidationError):
            SchoolRequirement(
                **requirement.model_dump(exclude={"kind", "detail"}),
                kind=kind,
                detail=detail,
            )

    unknown = SchoolRequirement(
        **requirement.model_dump(exclude={"kind", "detail"}),
        kind="architecture_portfolio",
        detail={"future_shape": {"remains": "generic"}},
    )
    assert unknown.detail["future_shape"] == {"remains": "generic"}


def test_platform_patch_defers_persisted_state_validation_to_service() -> None:
    assert ApplicationPatch(platform="other").platform == "other"
    assert ApplicationPatch(platform="other", platform_other="QuestBridge").platform_other


def test_test_policy_vintage_must_match_application_cycle() -> None:
    assert _vintage_matches_cycle("CDS 2026-27", 2027)
    assert not _vintage_matches_cycle("CDS 2025-26", 2027)
    assert not _vintage_matches_cycle("CDS 2027-28", 2027)
