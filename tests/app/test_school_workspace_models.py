"""Honesty-critical validation for school reference and tracking contracts."""

import pytest
from pydantic import ValidationError

from app.workspace.models import (
    ApplicationCreate,
    ApplicationPatch,
    ChecklistMap,
    TaskCreate,
)
from app.workspace.service_reference import _vintage_matches_cycle


def test_new_application_requires_explicit_cycle() -> None:
    with pytest.raises(ValidationError):
        ApplicationCreate(unitid=166027, list_type="Target", round="RD")


def test_checklist_is_closed_and_statuses_are_kind_specific() -> None:
    with pytest.raises(ValidationError):
        ApplicationPatch(checklist={"teacher_rec": {"status": "submitted"}})
    with pytest.raises(ValidationError):
        ApplicationPatch(checklist={"fee": {"status": "submitted"}})
    assert ApplicationPatch(checklist={"fee": None}).checklist is not None
    assert ChecklistMap(root={}).root == {}


def test_task_requirement_kind_is_an_open_validated_slug() -> None:
    assert TaskCreate(title="Prepare portfolio", requirement_kind="architecture_portfolio")
    with pytest.raises(ValidationError):
        TaskCreate(title="Bad", requirement_kind="Not A Slug")


def test_platform_patch_defers_persisted_state_validation_to_service() -> None:
    assert ApplicationPatch(platform="other").platform == "other"
    assert ApplicationPatch(platform="other", platform_other="QuestBridge").platform_other


def test_test_policy_vintage_must_match_application_cycle() -> None:
    assert _vintage_matches_cycle("CDS 2026-27", 2027)
    assert not _vintage_matches_cycle("CDS 2025-26", 2027)
    assert not _vintage_matches_cycle("CDS 2027-28", 2027)
